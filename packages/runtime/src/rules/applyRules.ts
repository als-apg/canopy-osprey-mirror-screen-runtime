// Applying rule outputs to a widget node — pure logic, no React.
//
// Precedence contract: base props < rule output < (future) overrides.
// Multiple rules targeting the same property apply in rule order, so a later
// rule's latest output wins — EXCEPT `visible`, which composes by AND across
// the base value and every rule targeting it (a widget is visible only when
// nothing says hide).
//
// Rule outputs are type-checked against the base property value where
// feasible: when the base prop exists, the output is coerced to its type;
// an incoercible output is dropped with a console warning rather than
// corrupting the widget.

import type { Geometry, Rule } from '@slaclab/canopy-screen-ir';
import type { RuleScalar } from './compileRule.js';

const GEOMETRY_TARGETS = new Set(['x', 'y', 'width', 'height']);

export interface EffectiveNode {
  readonly props: Record<string, unknown>;
  readonly geometry: Geometry;
  readonly visible: boolean;
}

function coerceBoolean(value: RuleScalar): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '' && value !== 'false' && value !== '0';
  return false; // null
}

function coerceNumber(value: RuleScalar): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined; // null
}

/** Coerce a rule output toward the base property's type (when known). */
function coerceToBase(value: RuleScalar, base: unknown): unknown {
  if (base === undefined || base === null) return value;
  if (typeof value === typeof base) return value;
  if (typeof base === 'boolean') return coerceBoolean(value);
  if (typeof base === 'number') return coerceNumber(value);
  if (typeof base === 'string') {
    return value === null ? undefined : String(value);
  }
  // Structured base (array/object) — a scalar cannot replace it sensibly.
  return undefined;
}

/**
 * Fold per-rule outputs (aligned by index with `rules`; `undefined` = no
 * result yet) into the widget's effective props / geometry / visibility.
 */
export function applyRuleOutputs(
  baseProps: Readonly<Record<string, unknown>>,
  baseGeometry: Geometry,
  rules: readonly Rule[] | undefined,
  outputs: readonly (RuleScalar | undefined)[]
): EffectiveNode {
  const props: Record<string, unknown> = { ...baseProps };
  const geometry = { ...baseGeometry };
  // The `visible` carrier prop (exporter-stashed) is the base; absent = true.
  let visible = baseProps.visible !== false;

  (rules ?? []).forEach((rule, index) => {
    const output = outputs[index];
    if (output === undefined) return;

    const target = rule.targetProperty;
    if (target === 'visible') {
      visible = visible && coerceBoolean(output);
      return;
    }
    if (GEOMETRY_TARGETS.has(target)) {
      const n = coerceNumber(output);
      if (n === undefined) {
        console.warn(
          `rule '${rule.name}': output ${JSON.stringify(output)} is not a number for geometry '${target}'; ignored`
        );
        return;
      }
      geometry[target as 'x' | 'y' | 'width' | 'height'] = n;
      return;
    }
    const coerced = coerceToBase(output, baseProps[target]);
    if (coerced === undefined) {
      console.warn(
        `rule '${rule.name}': output ${JSON.stringify(output)} does not fit property '${target}' ` +
          `(base is ${typeof baseProps[target]}); ignored`
      );
      return;
    }
    props[target] = coerced;
  });

  return { props, geometry, visible };
}
