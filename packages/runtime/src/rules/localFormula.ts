// FormulaSubscriber composition: formulas whose bindings are ALL client-side
// locals (loc://) evaluate in the page against the local PV service; anything
// else goes to the wrapped (Formula Engine) subscriber. A mixed spec — locals
// and CA channels in one expression — has no evaluation venue today (the
// Formula Engine cannot see page locals) and is surfaced as a subscription
// error.

import { isLocalChannel } from '../channels.js';
import type {
  FormulaResultMeta,
  FormulaSeverity,
  FormulaSpec,
  FormulaSubscriber,
} from '../formula.js';
import { FormulaError } from '../formula.js';
import {
  analyzePyExpr,
  evaluatePyExpr,
  PyExprError,
  type PyExprInputs,
  type PyStatus,
  type PyValue,
} from './pyExpr.js';

/** Structural slice of PVService — what local evaluation needs. */
export interface LocalPVLike {
  subscribe(
    pvName: string,
    listener: (data: { value: unknown; connected: boolean; severity?: unknown }) => void
  ): () => void;
}

/**
 * A live formula with a vector token or a status function. Nothing is
 * evaluated before every input has been subscribed, and then on every
 * change; a result is delivered when its value, severity or members without
 * a value differ from the last one.
 */
function subscribeStatus(
  local: LocalPVLike,
  spec: FormulaSpec,
  inputs: PyExprInputs,
  options: Parameters<FormulaSubscriber['subscribe']>[1],
  localOptions: LocalFormulaOptions
): () => void {
  const state = new Map<string, InputState>();
  let ready = false;
  let last: string | undefined;

  const evaluate = () => {
    if (!ready) return;
    try {
      const { value, meta } = evaluateStatusFormula(spec, inputs, state, localOptions);
      if (value === null) return;
      const signature = JSON.stringify([value, meta.severity, meta.vectorInputs]);
      if (signature === last) return;
      last = signature;
      options.onResult(value, meta);
    } catch (err) {
      if (!(err instanceof PyExprError) && !(err instanceof FormulaError)) throw err;
      // The next result is delivered even when it equals the last one.
      last = undefined;
      options.onError?.(err);
    }
  };

  const unsubscribes = Object.entries(spec.bindings).map(([key, address]) =>
    local.subscribe(address, (data) => {
      state.set(key, {
        value: scalar(data.value),
        connected: data.connected,
        severity: severityNumber(data.severity),
      });
      evaluate();
    })
  );
  ready = true;
  evaluate();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

function scalar(value: unknown): PyValue {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

/** Most channels without a value that a result or an error names, as on the server. */
export const VECTOR_MISSING_LISTED = 20;

const SEVERITY_NAMES: readonly FormulaSeverity[] = ['NO_ALARM', 'MINOR', 'MAJOR', 'INVALID'];

/** A channel's severity as 0 to 3; anything past MAJOR (disconnected too) is INVALID. */
function severityNumber(severity: unknown): number {
  if (typeof severity !== 'number' || !Number.isFinite(severity) || severity <= 0) return 0;
  return Math.min(3, Math.floor(severity));
}

/** What one input of a formula over many channels last reported. */
interface InputState {
  value: PyValue;
  connected: boolean;
  severity: number;
}

/** Channel names as the server writes them in a message: `['A', 'B'] and 3 more`. */
function namedChannels(names: readonly string[], listed: number): string {
  const shown = names.slice(0, listed);
  const list = `[${shown.map((n) => `'${n}'`).join(', ')}]`;
  return shown.length === names.length ? list : `${list} and ${names.length - shown.length} more`;
}

export interface LocalFormulaOptions {
  /** The name a channel address is reported under (default: the address). */
  readonly nameOf?: (address: string) => string;
  /** Most channels without a value a result or an error names. */
  readonly missingListed?: number;
}

/**
 * One evaluation of a formula with a vector token or a status function, as
 * the server answers it. An input without a value (not connected, or no
 * sample) fails the formula only when the expression reads it as a plain
 * value; as a member of a vector token it has no number, severity 3 and
 * `connected` 0. The result's severity is the worst over all inputs, an input
 * without a value counting as INVALID.
 */
export function evaluateStatusFormula(
  spec: FormulaSpec,
  inputs: PyExprInputs,
  state: ReadonlyMap<string, InputState>,
  options: LocalFormulaOptions = {}
): { value: PyValue; meta: FormulaResultMeta } {
  const nameOf = options.nameOf ?? ((address: string) => address);
  const listed = options.missingListed ?? VECTOR_MISSING_LISTED;
  const name = (key: string) => nameOf(spec.bindings[key]!);
  const has = (key: string) => {
    const s = state.get(key);
    return s !== undefined && s.connected && s.value !== null;
  };
  const read = [...new Set([...inputs.strict, ...inputs.members, ...Object.keys(spec.bindings)])];

  const strictMissing = [...inputs.strict].filter((key) => !has(key));
  if (strictMissing.length > 0) {
    throw new FormulaError(
      'formula_input_missing',
      `PVs not available: ${namedChannels([...new Set(strictMissing.map(name))], listed)}`,
      true
    );
  }

  const values = new Map<string, PyValue>();
  const status = new Map<string, PyStatus>();
  for (const key of Object.keys(spec.bindings)) {
    const s = state.get(key);
    values.set(key, has(key) ? s!.value : null);
    status.set(key, { connected: has(key), severity: has(key) ? s!.severity : 3 });
  }
  const value = evaluatePyExpr(spec.expression, values, status);

  const absent = [...new Set(read.filter((key) => !has(key)).map(name))];
  if (typeof value === 'number' && !Number.isFinite(value)) {
    if (absent.length > 0 && Number.isNaN(value)) {
      throw new FormulaError(
        'formula_input_missing',
        `PVs not available: ${namedChannels(absent, listed)}`,
        true
      );
    }
    throw new FormulaError(
      'formula_type_error',
      `The result is not a finite number (${value})`,
      false
    );
  }

  const worst = Math.max(0, ...read.map((key) => status.get(key)!.severity));
  const meta: { severity: FormulaSeverity; vectorInputs?: FormulaResultMeta['vectorInputs'] } = {
    severity: SEVERITY_NAMES[worst]!,
  };
  if (inputs.members.length > 0) {
    const missing = [...new Set(inputs.members.filter((key) => !has(key)).map(name))];
    meta.vectorInputs = {
      count: inputs.members.length,
      missing: missing.slice(0, listed),
      more: Math.max(missing.length - listed, 0),
    };
  }
  return { value, meta };
}

/**
 * Wrap `formulaEngine` so loc-only formulas evaluate locally. `formulaEngine`
 * may be null (mock mode): loc-only formulas still work there — they need no
 * backend at all.
 *
 * A formula with a vector token or a status function is answered as the
 * server answers it (`evaluateStatusFormula`), except for the pacing: the
 * server takes the changes of an interval together, the page evaluates on
 * every change of an input.
 */
export function createLocalAwareFormulaSubscriber(
  local: LocalPVLike,
  formulaEngine: FormulaSubscriber | null,
  localOptions: LocalFormulaOptions = {}
): FormulaSubscriber {
  return {
    subscribe(spec: FormulaSpec, options) {
      const addresses = Object.values(spec.bindings);
      const localCount = addresses.filter(isLocalChannel).length;

      if (localCount === 0) {
        if (formulaEngine) return formulaEngine.subscribe(spec, options);
        return () => {};
      }
      if (localCount !== addresses.length) {
        options.onError?.(
          new Error(
            'formula mixes loc:// locals with gateway channels; no evaluation venue supports both'
          )
        );
        return () => {};
      }

      let inputs: PyExprInputs | null = null;
      try {
        inputs = analyzePyExpr(spec.expression, Object.keys(spec.bindings));
      } catch (err) {
        // A plain formula reports what it cannot parse when it evaluates, as before.
        if (!(err instanceof PyExprError)) throw err;
      }
      if (inputs?.status) return subscribeStatus(local, spec, inputs, options, localOptions);

      const values = new Map<string, PyValue>();
      const connected = new Map<string, boolean>();
      // Pre-seed every token: subscriptions deliver synchronously one by one,
      // and evaluating before the last token reports would hit "unbound
      // token" errors mid-loop.
      for (const token of Object.keys(spec.bindings)) connected.set(token, false);
      let last: PyValue | undefined;
      // Set by every reported error: the next result is delivered even when
      // it equals `last`, so a consumer's stale/error state clears.
      let deliverNext = false;

      const fail = (error: Error) => {
        deliverNext = true;
        options.onError?.(error);
      };

      const evaluate = () => {
        if ([...connected.values()].some((ok) => !ok)) return;
        try {
          const result = evaluatePyExpr(spec.expression, values);
          // null (Python None) has no FormulaScalarValue representation —
          // treat it as "no output". (Rule ladders never produce it: they
          // evaluate to an arm index, -1 for the default.)
          if (result !== null && (result !== last || deliverNext)) {
            last = result;
            deliverNext = false;
            options.onResult(result);
          }
        } catch (err) {
          if (err instanceof PyExprError) {
            fail(err);
          } else {
            throw err;
          }
        }
      };

      const unsubscribes = Object.entries(spec.bindings).map(([token, address]) =>
        local.subscribe(address, (data) => {
          // Only a connected → disconnected transition is an error: an input
          // that has never connected is still in its initial deliveries and
          // stays silent, and a repeated disconnected snapshot is one drop.
          const wasConnected = connected.get(token) === true;
          values.set(token, scalar(data.value));
          connected.set(token, data.connected);
          if (!data.connected && wasConnected) {
            fail(
              new FormulaError('input_disconnected', `local input '${address}' disconnected`, true)
            );
            return;
          }
          evaluate();
        })
      );
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
  };
}
