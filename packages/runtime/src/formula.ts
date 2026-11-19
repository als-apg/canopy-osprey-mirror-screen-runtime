// Client-side Formula Engine formula contracts.
//
// `FormulaSpec` mirrors the wire shape of Canopy's `canopy.contracts.formula.
// FormulaSpec` (camelCase on the wire): `kind`, `expression`, `bindings`.
// The expression grammar is the Formula Engine's sandboxed Python-expression
// subset (Canopy src/canopy/formula_engine/language/grammar.py): arithmetic,
// comparisons, boolean ops, `a if cond else b` conditionals, and the
// SAFE_FUNCS call whitelist. PV inputs appear as `{token}` placeholders whose
// token text maps 1:1 onto `bindings` keys; the Formula Engine rejects specs
// whose bindings are unused or whose tokens are unbound, and rejects
// `formula:`-prefixed binding values (no formula-of-formula), which is why
// the rule compiler inlines screen formulas instead of referencing them.

import { createContext, useContext } from 'react';

export type FormulaKind = 'scalar' | 'timeseries' | 'waveform';

/** A complete formula request, ready to subscribe against the Formula Engine. */
export interface FormulaSpec {
  readonly kind: FormulaKind;
  readonly expression: string;
  readonly bindings: Readonly<Record<string, string>>;
}

/** Scalar result value delivered to rule subscribers. */
export type FormulaScalarValue = number | string | boolean;

/** Alarm severity of a formula result as the Formula Engine reports it (worst input severity). */
export type FormulaSeverity = 'NO_ALARM' | 'MINOR' | 'MAJOR' | 'INVALID';

/**
 * The members of a formula's vector tokens (`{*}`, `{g.*}`), summed up: how
 * many there are and which have no value. Only a formula with a vector token
 * has it.
 */
export interface FormulaVectorInputs {
  /** Number of channels the vector tokens name. */
  readonly count: number;
  /** Channels that are disconnected or have no sample, in member order; capped. */
  readonly missing: readonly string[];
  /** Number of further such channels that `missing` does not name. */
  readonly more: number;
}

/** `value` as a members summary, or undefined when it is not of that shape. */
export function asVectorInputs(value: unknown): FormulaVectorInputs | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { count, missing, more } = value as Record<string, unknown>;
  if (!Number.isInteger(count) || !Number.isInteger(more) || !Array.isArray(missing)) {
    return undefined;
  }
  if (!missing.every((name) => typeof name === 'string')) return undefined;
  return { count: count as number, missing: missing as string[], more: more as number };
}

/** Most channels without a value that one hover names, over all formulas of a node. */
export const VECTOR_MISSING_NAMED = 20;

/** One formula's members summary, with the channels its vector tokens name. */
export interface VectorSource {
  /** The member channels; empty when they are not known. */
  readonly members: readonly string[];
  readonly inputs: FormulaVectorInputs | undefined;
}

/**
 * One summary for the formulas feeding one node. Formulas with the same
 * members count once (one formula read by two rules); at most
 * `VECTOR_MISSING_NAMED` channels are named, the rest counted in `more`.
 */
export function combineVectorInputs(
  sources: readonly VectorSource[]
): FormulaVectorInputs | undefined {
  const seen = new Set<string>();
  const distinct: FormulaVectorInputs[] = [];
  for (const { members, inputs } of sources) {
    if (inputs === undefined) continue;
    if (members.length > 0) {
      const key = members.join('\n');
      if (seen.has(key)) continue;
      seen.add(key);
    }
    distinct.push(inputs);
  }
  if (distinct.length === 0) return undefined;
  const names = [...new Set(distinct.flatMap((d) => d.missing))];
  return {
    count: distinct.reduce((sum, d) => sum + d.count, 0),
    missing: names.slice(0, VECTOR_MISSING_NAMED),
    more:
      Math.max(names.length - VECTOR_MISSING_NAMED, 0) +
      distinct.reduce((sum, d) => sum + d.more, 0),
  };
}

/** What a node says when its formula was asked and nothing came back. */
export const NO_ANSWER = 'no answer from the formula service';

let startTimeoutMs = 3000;

/**
 * How long a consumer waits for the first result, null value or error of a
 * formula before it stops showing "no result yet" and shows that it has no
 * state. The server holds a first result for its start window (1 s); this is
 * that window plus margin.
 */
export function formulaStartTimeoutMs(): number {
  return startTimeoutMs;
}

/** Set `formulaStartTimeoutMs` (one setting for the whole runtime). */
export function setFormulaStartTimeoutMs(ms: number): void {
  startTimeoutMs = ms;
}

/**
 * Optional per-result metadata. Rules ignore it; formula-backed widget
 * channels (see ScreenPVService) surface it as the channel's alarm state.
 */
export interface FormulaResultMeta {
  /** Worst severity across the formula's inputs; absent = not reported. */
  readonly severity?: FormulaSeverity;
  /** Result timestamp, epoch ms (Formula Engine: the newest input sample used). */
  readonly timestampMs?: number;
  /** The members of the formula's vector tokens; absent = it has none. */
  readonly vectorInputs?: FormulaVectorInputs;
}

/**
 * A formula subscription error that keeps its origin's `code` and whether it
 * is `retryable` (the subscription stays live and a later result supersedes
 * it). Raised by the Formula Engine adapter for every error frame and by local formula
 * evaluation for a dropped input; rule consumers read `retryable` to mark a
 * widget stale instead of failed.
 */
export class FormulaError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(`${code}: ${message}`);
    this.name = 'FormulaError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface FormulaSubscribeOptions {
  /** Re-evaluation poll interval; omitted/0 = event-driven (on PV change). */
  intervalMs?: number;
  onResult: (value: FormulaScalarValue, meta?: FormulaResultMeta) => void;
  /**
   * The formula was evaluated and has no value to give (the server sends a
   * number that JSON cannot hold as `null`). What the consumer showed before
   * no longer holds; `meta` is that of the evaluation.
   */
  onNoValue?: (meta?: FormulaResultMeta) => void;
  onError?: (error: Error) => void;
}

/**
 * The runtime's only view of a live formula service. The SDK's Formula Engine
 * service satisfies this shape; tests use scripted stubs. The returned
 * function unsubscribes.
 */
export interface FormulaSubscriber {
  subscribe(spec: FormulaSpec, options: FormulaSubscribeOptions): () => void;
}

/**
 * Context carrying the app's FormulaSubscriber. When absent, widget rules are
 * inert: base props render unchanged (there is nothing to evaluate against).
 */
export const FormulaSubscriberContext = createContext<FormulaSubscriber | null>(null);

/** The ambient FormulaSubscriber, or null when the app runs without the Formula Engine. */
export function useFormulaSubscriber(): FormulaSubscriber | null {
  return useContext(FormulaSubscriberContext);
}
