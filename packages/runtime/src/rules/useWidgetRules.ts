// React binding for widget rules: compile at subscription time, subscribe
// through the ambient FormulaSubscriber, surface per-rule latest outputs.

import { useEffect, useMemo, useState } from 'react';
import type { FormulaDeclaration, MacroValues, Rule } from '@slaclab/canopy-screen-ir';
import { useFormulaSubscriber } from '../formula.js';
import type { CompiledRule, RuleScalar } from './compileRule.js';
import { compileRule, RuleCompileError } from './compileRule.js';

const NO_RULES: readonly (CompiledRule | undefined)[] = [];
const NO_RESULTS: ReadonlyMap<CompiledRule, RuleScalar> = new Map();

/**
 * Latest output per rule, aligned by index with `rules` (`undefined` until a
 * first result arrives). Static-compiling rules (no conditions / no live
 * inputs) are derived directly from compilation; only live subscription
 * results touch state. Rules that fail to compile are contained: a console
 * warning, no output, the widget keeps its base props. Without a
 * FormulaSubscriber in context, only static rules produce outputs.
 *
 * Callers must pass stable identities (the renderer memoizes `macros`); the
 * subscriptions re-establish when any input changes.
 */
export function useWidgetRules(
  rules: readonly Rule[] | undefined,
  formulas: readonly FormulaDeclaration[] | undefined,
  macros: MacroValues
): readonly (RuleScalar | undefined)[] {
  const subscriber = useFormulaSubscriber();

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

  // Live results keyed by the compiled rule's identity: when inputs change,
  // `compiled` is rebuilt and stale entries simply stop being read — no
  // synchronous reset needed.
  const [results, setResults] = useState<ReadonlyMap<CompiledRule, RuleScalar>>(NO_RESULTS);

  useEffect(() => {
    if (!subscriber) return;
    const unsubscribes: (() => void)[] = [];
    for (const rule of compiled) {
      if (!rule || rule.kind !== 'formula') continue;
      unsubscribes.push(
        subscriber.subscribe(rule.spec, {
          onResult: (value) => {
            setResults((prev) => {
              const next = new Map(prev);
              next.set(rule, value);
              return next;
            });
          },
          onError: (error) => {
            console.warn(
              `rule targeting '${rule.targetProperty}' subscription error: ${error.message}`
            );
          },
        })
      );
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [compiled, subscriber]);

  return useMemo(
    () =>
      compiled.map((rule) => {
        if (!rule) return undefined;
        if (rule.kind === 'static') return rule.value;
        return results.get(rule);
      }),
    [compiled, results]
  );
}
