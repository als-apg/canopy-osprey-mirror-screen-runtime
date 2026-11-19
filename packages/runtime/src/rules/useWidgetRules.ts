// React binding for widget rules: compile at subscription time, subscribe
// through the ambient FormulaSubscriber, map each result onto its arm and
// resolve it against the active color scheme, surface per-rule outputs.

import { useEffect, useMemo, useState } from 'react';
import { isColorRole } from '@slaclab/canopy-screen-ir';
import type {
  FlatScheme,
  FormulaDeclaration,
  MacroValues,
  Rule,
  RuleValue,
} from '@slaclab/canopy-screen-ir';
import type { FormulaScalarValue, FormulaVectorInputs, VectorSource } from '../formula.js';
import { formulaStartTimeoutMs, NO_ANSWER, useFormulaSubscriber } from '../formula.js';
import { vectorMembers } from './vectorMembers.js';
import { resolveRole } from '../theme/resolveRoles.js';
import { useColorScheme } from '../theme/schemeContext.js';
import type { CompiledRule, RuleScalar } from './compileRule.js';
import { compileRule, DEFAULT_ARM, RuleCompileError } from './compileRule.js';

const NO_RULES: readonly (CompiledRule | undefined)[] = [];
const NO_LIVE: ReadonlyMap<CompiledRule, LiveState> = new Map();

/**
 * What one live rule's subscription has delivered so far. Presence in the
 * map means the rule has settled (a result or an error arrived).
 */
interface LiveState {
  /** The latest result; undefined after a null value. */
  readonly value: FormulaScalarValue | undefined;
  /** An error arrived since the latest result, or no answer came in time. */
  readonly stale: boolean;
  /** What failed, while stale: the error's code and message. */
  readonly problem?: string | undefined;
  /** The members summary of the latest result, when its formula has a vector token. */
  readonly vectorInputs?: FormulaVectorInputs | undefined;
}

/** The rule outputs of one node plus its live-data state. */
export interface WidgetRulesState {
  /**
   * Latest output per rule, aligned by index with `rules`; `undefined` means
   * "no output" (the widget keeps its base prop). A stale rule has no output.
   */
  readonly outputs: readonly (RuleScalar | undefined)[];
  /** Some live rule had an error since its latest result, or never got an answer. */
  readonly stale: boolean;
  /** What failed in the stale rules (code and message of each error), for the hover. */
  readonly problem: string | undefined;
  /**
   * Some live rule has delivered a result or an error — or the node has no
   * live rule to wait for (none, static only, every one failed to compile, or
   * no FormulaSubscriber in context).
   */
  readonly settled: boolean;
  /**
   * Some live rule has a result that no retryable error has made stale: the
   * renderer's live-data cue reads it for a node whose only machine channels
   * are its rules' inputs.
   */
  readonly delivered: boolean;
  /**
   * The members summary of each live rule's latest result, with the channels
   * its vector tokens name; a stale rule has none.
   */
  readonly vectorSources: readonly VectorSource[];
}

const MEMBERS = new WeakMap<CompiledRule, readonly string[]>();

/** The channels a live rule's vector tokens name (to count one formula once), read once. */
function membersOf(rule: Exclude<CompiledRule, { kind: 'static' }>): readonly string[] {
  let members = MEMBERS.get(rule);
  if (members === undefined) {
    members = vectorMembers(rule.spec);
    MEMBERS.set(rule, members);
  }
  return members;
}

function isLive(rule: CompiledRule | undefined): rule is Exclude<CompiledRule, { kind: 'static' }> {
  return rule !== undefined && rule.kind !== 'static';
}

/**
 * The raw arm a ladder result selects: the indexed condition value, the
 * default for `-1`, or `undefined` (no output) for anything that is not a
 * valid arm index — a malformed result must not corrupt the widget.
 */
function selectArm(
  rule: Extract<CompiledRule, { kind: 'ladder' }>,
  result: FormulaScalarValue
): RuleValue | undefined {
  if (typeof result !== 'number' || !Number.isInteger(result)) return undefined;
  if (result === DEFAULT_ARM) return rule.default;
  if (result >= 0 && result < rule.values.length) return rule.values[result];
  return undefined;
}

/**
 * The raw arm (or formula scalar) each compiled rule currently selects,
 * aligned by index with `compiled`. Scheme-independent: this is what a live
 * result or a static compilation says, before roles resolve.
 */
function selectArms(
  compiled: readonly (CompiledRule | undefined)[],
  live: ReadonlyMap<CompiledRule, LiveState>
): readonly (RuleValue | undefined)[] {
  return compiled.map((rule) => {
    if (!rule) return undefined;
    if (rule.kind === 'static') return rule.value;
    const state = live.get(rule);
    // A stale rule drops back to the base prop until its next result.
    if (!state || state.stale) return undefined;
    const result = state.value;
    if (result === undefined) return undefined;
    if (rule.kind === 'formula') return result;
    return selectArm(rule, result);
  });
}

/**
 * Resolve a selected arm to the scalar the widget receives: a ColorRole
 * becomes its CSS string under `flat`, `null` means no output, anything
 * else passes through.
 */
function resolveArm(arm: RuleValue | undefined, flat: FlatScheme): RuleScalar | undefined {
  if (arm === undefined || arm === null) return undefined;
  return isColorRole(arm) ? resolveRole(arm, flat) : arm;
}

/**
 * Latest output per rule, aligned by index with `rules` (`undefined` until a
 * first result arrives, or when the selected arm is `null`). Static-compiling
 * rules (no conditions / no live inputs) are derived directly from
 * compilation; only live subscription results touch state. Ladder results
 * are arm indexes, mapped back onto the rule's raw arms by reference;
 * formula-arm scalars pass through unmapped. ColorRole arms resolve against
 * the ambient scheme in a memo keyed on the selected arms and the scheme, so
 * a scheme change recolors every output without touching a subscription.
 * Rules that fail to compile are contained: a console warning, no output,
 * the widget keeps its base props. Without a FormulaSubscriber in context,
 * only static rules produce outputs.
 *
 * A subscription error, retryable or not, marks the rule stale: its output
 * drops to the base prop until the next result, and `problem` says what
 * failed. A light never keeps the colour of a result its formula no longer
 * stands behind. A rule that got no result, null value or error within
 * `formulaStartTimeoutMs()` is stale in the same way.
 *
 * Callers must pass stable identities (the renderer memoizes `macros`); the
 * subscriptions re-establish when any input changes.
 */
export function useWidgetRulesState(
  rules: readonly Rule[] | undefined,
  formulas: readonly FormulaDeclaration[] | undefined,
  macros: MacroValues
): WidgetRulesState {
  const subscriber = useFormulaSubscriber();
  const flat = useColorScheme();

  const compiled = useMemo<readonly (CompiledRule | undefined)[]>(() => {
    if (!rules || rules.length === 0) return NO_RULES;
    return rules.map((rule) => {
      try {
        return compileRule(rule, formulas, macros);
      } catch (err) {
        if (err instanceof RuleCompileError) {
          console.warn(`rule '${rule.name}' failed to compile: ${err.message}`);
          return undefined;
        }
        throw err;
      }
    });
  }, [rules, formulas, macros]);

  // Live state keyed by the compiled rule's identity: when inputs change,
  // `compiled` is rebuilt and old entries simply stop being read — no
  // synchronous reset needed.
  const [live, setLive] = useState<ReadonlyMap<CompiledRule, LiveState>>(NO_LIVE);

  // The scheme is deliberately NOT a dependency here: subscriptions carry
  // arm indexes, never colors, so a scheme swap must not resubscribe.
  useEffect(() => {
    if (!subscriber) return;
    const unsubscribes: (() => void)[] = [];
    const update = (rule: CompiledRule, next: (prev: LiveState | undefined) => LiveState) => {
      setLive((prev) => {
        const map = new Map(prev);
        map.set(rule, next(prev.get(rule)));
        return map;
      });
    };
    for (const rule of compiled) {
      if (!isLive(rule)) continue;
      unsubscribes.push(
        subscriber.subscribe(rule.spec, {
          onResult: (value, meta) => {
            update(rule, () => ({ value, stale: false, vectorInputs: meta?.vectorInputs }));
          },
          // Evaluated, no value: no output (the base prop), and not stale.
          onNoValue: (meta) => {
            update(rule, () => ({
              value: undefined,
              stale: false,
              vectorInputs: meta?.vectorInputs,
            }));
          },
          // Any error, retryable or not: what the rule showed no longer
          // holds, and neither does the summary of the result before.
          onError: (error) => {
            console.warn(
              `rule targeting '${rule.targetProperty}' subscription error: ${error.message}`
            );
            update(rule, () => ({ value: undefined, stale: true, problem: error.message }));
          },
        })
      );
    }
    // Pending is bounded: a rule nothing has answered in time has no state.
    const live = compiled.filter(isLive);
    const timer =
      live.length === 0
        ? undefined
        : setTimeout(() => {
            setLive((prev) => {
              if (live.every((rule) => prev.has(rule))) return prev;
              const map = new Map(prev);
              for (const rule of live) {
                if (!map.has(rule))
                  map.set(rule, { value: undefined, stale: true, problem: NO_ANSWER });
              }
              return map;
            });
          }, formulaStartTimeoutMs());
    return () => {
      clearTimeout(timer);
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [compiled, subscriber]);

  const arms = useMemo(() => selectArms(compiled, live), [compiled, live]);
  const outputs = useMemo(() => arms.map((arm) => resolveArm(arm, flat)), [arms, flat]);

  const liveRules = compiled.filter(isLive);
  const stale = liveRules.some((rule) => live.get(rule)?.stale === true);
  const settled = !subscriber || liveRules.length === 0 || liveRules.some((rule) => live.has(rule));
  const delivered =
    !!subscriber &&
    liveRules.some((rule) => {
      const state = live.get(rule);
      return state !== undefined && !state.stale && state.value !== undefined;
    });

  // A stale rule has no summary: the hover says what failed instead.
  const vectorSources = useMemo(
    () =>
      compiled.filter(isLive).map((rule) => {
        const state = live.get(rule);
        return {
          members: membersOf(rule),
          inputs: state === undefined || state.stale ? undefined : state.vectorInputs,
        };
      }),
    [compiled, live]
  );
  const problems = [...new Set(liveRules.flatMap((rule) => live.get(rule)?.problem ?? []))];
  const problem = problems.length > 0 ? problems.join('; ') : undefined;

  return useMemo(
    () => ({ outputs, stale, settled, delivered, vectorSources, problem }),
    [outputs, stale, settled, delivered, vectorSources, problem]
  );
}

/**
 * The rule outputs alone: `useWidgetRulesState(...).outputs`. Kept for
 * callers that render outputs without a live-data cue.
 */
export function useWidgetRules(
  rules: readonly Rule[] | undefined,
  formulas: readonly FormulaDeclaration[] | undefined,
  macros: MacroValues
): readonly (RuleScalar | undefined)[] {
  return useWidgetRulesState(rules, formulas, macros).outputs;
}
