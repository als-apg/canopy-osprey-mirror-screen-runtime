// Adapter: the SDK's Formula Engine service → the runtime's FormulaSubscriber.
//
// Structurally typed on purpose: the runtime does not depend on
// @slaclab/canopy-client — the composition root (viewer app) constructs the
// concrete Formula Engine service and passes it here. `FormulaEngineServiceLike`
// is the minimal shape of its `subscribe`; the SDK class satisfies it (pinned
// by the wiring test, which uses the real class as a dev dependency).

import { asVectorInputs, FormulaError } from '../formula.js';
import type {
  FormulaResultMeta,
  FormulaScalarValue,
  FormulaSeverity,
  FormulaSpec,
  FormulaSubscriber,
} from '../formula.js';

interface FormulaEngineScalarLike {
  /** `null`: the result is a number that JSON cannot hold (NaN, infinite). */
  value: FormulaScalarValue | null;
  /** Wire severity (`NO_ALARM` | `MINOR` | `MAJOR` | `INVALID`). */
  severity?: string;
  /** Result timestamp, epoch ns. */
  tsNs?: number;
  /** The members of the formula's vector tokens, summed up; only such a formula has it. */
  vectorInputs?: unknown;
}

const KNOWN_SEVERITIES: ReadonlySet<string> = new Set<FormulaSeverity>([
  'NO_ALARM',
  'MINOR',
  'MAJOR',
  'INVALID',
]);

function resultMeta(scalar: FormulaEngineScalarLike): FormulaResultMeta {
  const meta: {
    severity?: FormulaSeverity;
    timestampMs?: number;
    vectorInputs?: FormulaResultMeta['vectorInputs'];
  } = {};
  const vectorInputs = asVectorInputs(scalar.vectorInputs);
  if (vectorInputs !== undefined) meta.vectorInputs = vectorInputs;
  if (scalar.severity !== undefined) {
    // Like HarePVService: a severity the server grew later reads as INVALID.
    meta.severity = KNOWN_SEVERITIES.has(scalar.severity)
      ? (scalar.severity as FormulaSeverity)
      : 'INVALID';
  }
  if (typeof scalar.tsNs === 'number' && scalar.tsNs > 0) {
    meta.timestampMs = Math.floor(scalar.tsNs / 1e6);
  }
  return meta;
}

interface FormulaEngineResultLike {
  kind: string;
  scalar: FormulaEngineScalarLike | null;
}

interface FormulaEngineErrorLike {
  code: string;
  message: string;
  /** The sdk's flag: true while the subscription stays live (a transient condition). */
  retryable?: boolean;
}

export interface FormulaEngineServiceLike {
  /**
   * The state of the service's connection, when it states one (the SDK:
   * `idle`, `connecting`, `connected`, `disconnected`).
   */
  readonly status?: string;
  subscribe(
    spec: FormulaSpec,
    options: {
      intervalMs?: number;
      onResult: (data: FormulaEngineResultLike) => void;
      onError?: (error: FormulaEngineErrorLike) => void;
    }
  ): () => void;
}

/**
 * Wrap the SDK's Formula Engine service (or anything of its shape) as the
 * FormulaSubscriber the rule engine consumes. Scalar results feed
 * `onResult` with the bare value plus its severity/timestamp metadata; a
 * scalar result whose value is null feeds `onNoValue` with the metadata;
 * non-scalar results are ignored (rules and widget channels are scalar);
 * error frames map onto FormulaErrors that keep the frame's `code` and
 * `retryable` (a frame without the flag reads as not retryable). A
 * subscription made while the service says its connection is down gets
 * `ws_disconnected` at once.
 */
export function createFormulaEngineSubscriber(
  service: FormulaEngineServiceLike
): FormulaSubscriber {
  return {
    subscribe(spec: FormulaSpec, { intervalMs, onResult, onNoValue, onError }) {
      // The service tells a lost connection only to the subscriptions it held
      // then. One made while the connection is down is told here, so that it
      // does not wait out the start timeout as "pending".
      let ended = false;
      if (onError && service.status === 'disconnected') {
        queueMicrotask(() => {
          if (ended || service.status !== 'disconnected') return;
          onError(new FormulaError('ws_disconnected', 'Formula connection lost.', true));
        });
      }
      const unsubscribe = service.subscribe(spec, {
        ...(intervalMs !== undefined ? { intervalMs } : {}),
        onResult: (data) => {
          if (data.kind !== 'scalar' || !data.scalar) return;
          const value = data.scalar.value;
          if (value === null || value === undefined) onNoValue?.(resultMeta(data.scalar));
          else onResult(value, resultMeta(data.scalar));
        },
        onError: onError
          ? (error) =>
              onError(new FormulaError(error.code, error.message, error.retryable === true))
          : undefined,
      });
      return () => {
        ended = true;
        unsubscribe();
      };
    },
  };
}
