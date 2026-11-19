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
  memberNumber,
  PyExprError,
  type PyExprInputs,
  type PyStatus,
  type PyValue,
} from './pyExpr.js';

/** Structural slice of PVService — what local evaluation needs. */
export interface LocalPVLike {
  subscribe(
    pvName: string,
    listener: (data: {
      value: unknown;
      connected: boolean;
      severity?: unknown;
      enumChoices?: unknown;
    }) => void
  ): () => void;
}

/**
 * A live formula with a vector token or a status function. The first answer
 * waits until every input has reported once, or the start window has passed:
 * until then the formula has no result, which is not the same as a result
 * over inputs without a value. After that it is evaluated on every change; a
 * result is delivered when its value, severity or members without a value
 * differ from the last one.
 */
function subscribeStatus(
  local: LocalPVLike,
  spec: FormulaSpec,
  inputs: PyExprInputs,
  options: Parameters<FormulaSubscriber['subscribe']>[1],
  localOptions: LocalFormulaOptions
): () => void {
  const cap = localOptions.maxVectorInputs ?? MAX_VECTOR_INPUTS;
  if (inputs.members.length > cap) {
    options.onError?.(
      new FormulaError(
        'invalid_spec',
        `A formula may name at most ${cap} channels through vector tokens, got ` +
          `${inputs.members.length} (MAX_VECTOR_INPUTS)`,
        false
      )
    );
    return () => {};
  }
  const state = new Map<string, InputState>();
  const keys = Object.keys(spec.bindings);
  let started = false;
  let last: string | undefined;

  const evaluate = () => {
    if (!started) {
      if (!keys.every((key) => state.has(key))) return;
      started = true;
      clearTimeout(startTimer);
    }
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

  const startTimer = setTimeout(() => {
    started = true;
    evaluate();
  }, VECTOR_START_WINDOW_MS);
  const unsubscribes = Object.entries(spec.bindings).map(([key, address]) =>
    local.subscribe(address, (data) => {
      state.set(key, {
        value: scalar(data.value),
        sampled: data.value !== null && data.value !== undefined,
        empty:
          (data.value === null || data.value === undefined) &&
          data.connected &&
          data.severity !== undefined,
        connected: data.connected,
        severity: severityNumber(data.severity),
        labels: enumStrings(data.enumChoices),
      });
      evaluate();
    })
  );
  return () => {
    clearTimeout(startTimer);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

function scalar(value: unknown): PyValue {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

/**
 * How long a live formula over many channels waits for its inputs to report
 * before its first answer, as on the server.
 */
export const VECTOR_START_WINDOW_MS = 1000;

/** Most channels the vector tokens of one formula may name, as on the server. */
export const MAX_VECTOR_INPUTS = 1000;

/** Most channels without a value that a result or an error names, as on the server. */
export const VECTOR_MISSING_LISTED = 20;

const SEVERITY_NAMES: readonly FormulaSeverity[] = ['NO_ALARM', 'MINOR', 'MAJOR', 'INVALID'];

/** A channel's severity as 0 to 3; anything past MAJOR (disconnected too) is INVALID. */
function severityNumber(severity: unknown): number {
  if (typeof severity !== 'number' || !Number.isFinite(severity) || severity <= 0) return 0;
  return Math.min(3, Math.floor(severity));
}

/** A channel's enum strings, or undefined when it reports none. */
function enumStrings(choices: unknown): readonly string[] | undefined {
  return Array.isArray(choices) && choices.every((c) => typeof c === 'string')
    ? (choices as string[])
    : undefined;
}

/** What one input of a formula over many channels last reported. */
interface InputState {
  /** The sample as one value; null when there is none, or it is not one value. */
  value: PyValue;
  /** Whether the channel has a sample at all (an array is one, without a number). */
  sampled: boolean;
  /** A sample came (it has an alarm state) but holds no value. */
  empty?: boolean;
  connected: boolean;
  severity: number;
  /** The channel's enum strings, when it has them. */
  labels?: readonly string[] | undefined;
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
  /** Most channels the vector tokens of one formula may name. */
  readonly maxVectorInputs?: number;
}

/**
 * One evaluation of a formula with a vector token or a status function, as
 * the server answers it. An input without a value (not connected, or no
 * sample) fails the formula only when the expression reads it as a plain
 * value; as a member of a vector token it has no number, severity 3 and
 * `connected` 0. A connected member whose sample is empty has no number
 * and severity 3 too, but `connected` 1. The result's severity is the worst over all inputs, an input
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
    return s !== undefined && s.connected && s.sampled;
  };
  const unusable = [...inputs.strict].filter((key) => has(key) && state.get(key)!.value === null);
  if (unusable.length > 0) {
    throw new FormulaError(
      'formula_type_error',
      `PV '${name(unusable[0]!)}' value is not usable in a scalar formula`,
      false
    );
  }
  // An input that is there (connected, with a sample) but has no number is
  // worded apart from one that is not available.
  const there = (key: string) => {
    const s = state.get(key);
    return s !== undefined && s.connected && (s.sampled || s.empty === true);
  };
  const unusableInputs = (keys: readonly string[]) => {
    const absent = keys.filter((key) => !there(key));
    const [what, named] =
      absent.length > 0 ? ['PVs not available', absent] : ['PVs without a number', keys];
    return new FormulaError(
      'formula_input_missing',
      `${what}: ${namedChannels([...new Set(named.map(name))], listed)}`,
      true
    );
  };
  const read = [...new Set([...inputs.strict, ...inputs.members, ...Object.keys(spec.bindings)])];

  const strictMissing = [...inputs.strict].filter((key) => !has(key));
  if (strictMissing.length > 0) throw unusableInputs(strictMissing);

  const values = new Map<string, PyValue>();
  const status = new Map<string, PyStatus>();
  for (const key of Object.keys(spec.bindings)) {
    const s = state.get(key);
    values.set(key, has(key) ? s!.value : null);
    status.set(key, {
      // connected() reports the connection, nothing else: an empty sample is
      // connected, and has severity 3 like every input without a value.
      connected: there(key),
      severity: has(key) ? s!.severity : 3,
      labels: s?.labels,
    });
  }
  // A member without a number never passes for one: a formula that uses the
  // values of a vector token unguarded fails while any member has none. The
  // expression's own errors come first, the evaluation last.
  if (inputs.fault) throw inputs.fault;
  const number = (key: string) => (has(key) ? memberNumber(values.get(key)) : NaN);
  const numberless = inputs.unguarded.flatMap((token) =>
    (inputs.vectors.get(token) ?? []).filter((key) => Number.isNaN(number(key)))
  );
  if (numberless.length > 0) throw unusableInputs(numberless);
  const value = evaluatePyExpr(spec.expression, values, status);

  if (typeof value === 'number' && !Number.isFinite(value)) {
    // Named: inputs read by value that are not finite themselves, and, for a
    // result that is not a number, the inputs without a sample.
    const byValue = [...new Set([...inputs.strict, ...inputs.members])].sort();
    const culprits = byValue.filter((key) => {
      if (!has(key)) return Number.isNaN(value);
      const own = values.get(key);
      return typeof own === 'number' && !Number.isFinite(own);
    });
    if (culprits.length > 0) throw unusableInputs(culprits);
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
 * A formula with a vector token, a status function or `label()` is answered as the
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
