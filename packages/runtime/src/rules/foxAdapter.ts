// Adapter: the SDK's FoxFormulaService → the runtime's FormulaSubscriber.
//
// Structurally typed on purpose: the runtime does not depend on
// @slaclab/canopy-client — the composition root (viewer app) constructs the
// concrete FoxFormulaService and passes it here. `FoxServiceLike` is the
// minimal shape of FoxFormulaService.subscribe; the SDK class satisfies it
// (pinned by the wiring test, which uses the real class as a dev dependency).

import type { FormulaScalarValue, FormulaSpec, FormulaSubscriber } from '../formula.js';

interface FoxScalarLike {
  value: FormulaScalarValue;
}

interface FoxResultLike {
  kind: string;
  scalar: FoxScalarLike | null;
}

interface FoxErrorLike {
  code: string;
  message: string;
}

export interface FoxServiceLike {
  subscribe(
    spec: FormulaSpec,
    options: {
      intervalMs?: number;
      onResult: (data: FoxResultLike) => void;
      onError?: (error: FoxErrorLike) => void;
    }
  ): () => void;
}

/**
 * Wrap a FoxFormulaService (or anything of its shape) as the
 * FormulaSubscriber the rule engine consumes. Scalar results feed
 * `onResult` with the bare value; non-scalar results are ignored (rules
 * target scalar widget properties); error frames map onto plain Errors.
 */
export function createFoxFormulaSubscriber(service: FoxServiceLike): FormulaSubscriber {
  return {
    subscribe(spec: FormulaSpec, { intervalMs, onResult, onError }) {
      return service.subscribe(spec, {
        ...(intervalMs !== undefined ? { intervalMs } : {}),
        onResult: (data) => {
          if (data.kind === 'scalar' && data.scalar) onResult(data.scalar.value);
        },
        onError: onError
          ? (error) => onError(new Error(`${error.code}: ${error.message}`))
          : undefined,
      });
    },
  };
}
