// The channels the vector tokens of a compiled formula name.

import type { FormulaSpec } from '../formula.js';
import { analyzePyExpr, PyExprError } from './pyExpr.js';

/** The member channels of `spec`'s vector tokens; empty when it has none or cannot be read. */
export function vectorMembers(spec: FormulaSpec): readonly string[] {
  try {
    const { members } = analyzePyExpr(spec.expression, Object.keys(spec.bindings));
    return members.map((key) => spec.bindings[key]!);
  } catch (err) {
    if (err instanceof PyExprError) return [];
    throw err;
  }
}
