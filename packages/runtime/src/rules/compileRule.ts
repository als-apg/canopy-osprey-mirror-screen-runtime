// Rule → Formula Engine FormulaSpec compiler.
//
// Rules are stored in author form (@slaclab/canopy-screen-ir rules.ts) and
// compile client-side at subscription time; the compiled form is never
// stored. The compilation target is the Formula Engine's sandboxed Python expression
// grammar (Canopy src/canopy/formula_engine/language/grammar.py — ALLOWED_NODES
// includes ast.IfExp), so an ordered condition/value ladder becomes nested
// conditional expressions over ARM INDEXES:
//
//   0 if (c0) else (1 if (c1) else (-1))
//
// — first truthy condition wins (its index), else -1 for the default,
// exactly the Rule contract. The arm values themselves never reach the Formula Engine: the
// compiled rule keeps them raw (a ColorRole stays a ColorRole) and
// `useWidgetRules` maps the index back to its arm and resolves it against
// the active color scheme, so a scheme change recolors without
// resubscribing. Condition expressions pass through verbatim (the Formula Engine itself
// normalizes `&&`/`||`/`!` to Python operators, see formula_engine/services/parser.py
// _BOOL_REPLACEMENTS); their `{N}` placeholders are already valid Formula Engine
// tokens, and we provide bindings keyed "0", "1", ... to match.
//
// Formula Engine constraints that shape this compiler
// (formula_engine/services/parser.py and formula_service.py):
//  - every `{token}` must be bound and every binding used — so bindings
//    that end up unreferenced by any condition are dropped (a `trigger`-only
//    PV has no FormulaSpec representation; the Formula Engine re-evaluates on
//    every bound input anyway, and `trigger: false` likewise cannot be
//    represented);
//  - binding values must be PV names — `formula:`-prefixed values are rejected
//    ("formula-of-formula composition is not supported"), so a rule PV
//    binding of `formula://<name>` is INLINED: the referenced screen formula's
//    expression is substituted (parenthesized) for `{N}`, with its own
//    bindings merged in under namespaced `<name>.<key>` tokens;
//  - a vector token (`{*}`: every binding; `{g.*}`: the bindings whose key
//    starts with `g.`) uses each binding it covers, and must cover one;
//  - `severity({x})`, `connected({x})` and `label({x})` take exactly one
//    token, so they cannot be applied to an inlined formula;
//  - an expression must contain at least one `{token}`, so a rule with no
//    conditions compiles to its default, and a ladder with no live input
//    left after macro substitution is constant-folded here (evaluated once
//    with pyExpr) to the raw value of the arm it selects.
//
// Macros in rule PV bindings and in formula binding channels resolve here,
// BEFORE subscribing, per the IR contract ("resolved client-side before
// subscribing to the Formula Engine").

import type { FormulaDeclaration, MacroValues, Rule, RuleValue } from '@slaclab/canopy-screen-ir';
import type { FormulaSpec } from '../formula.js';
import { formulaName, isFormulaRef } from '../formulaRef.js';
import { substituteMacros } from '../macros.js';
import { evaluatePyExpr, PyExprError } from './pyExpr.js';

/** JSON scalar a rule may write to its target property. */
export type RuleScalar = string | number | boolean | null;

/** The default arm's index in a compiled ladder expression. */
export const DEFAULT_ARM = -1;

/**
 * A compiled rule.
 *
 * - `ladder`: a live subscription whose result is an ARM INDEX into
 *   `values` (`-1` selects `default`). Arms are kept raw — a ColorRole is
 *   not resolved here — so the subscription never depends on the scheme.
 * - `formula`: a live subscription whose scalar result IS the output
 *   (formula-arm rules are scalar-only; never arm-mapped).
 * - `static`: the raw constant arm or default; no subscription.
 *
 * A `null` arm or default means "no output" (the base prop stays); the
 * mapping in `useWidgetRules` applies that on every path.
 */
export type CompiledRule =
  | {
      readonly kind: 'ladder';
      readonly targetProperty: string;
      readonly spec: FormulaSpec;
      readonly values: readonly RuleValue[];
      readonly default: RuleValue;
    }
  | { readonly kind: 'formula'; readonly targetProperty: string; readonly spec: FormulaSpec }
  | { readonly kind: 'static'; readonly targetProperty: string; readonly value: RuleValue };

export class RuleCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleCompileError';
  }
}

/**
 * `TOKEN_RE` is global and so stateful: it is for `matchAll` only, which clones
 * it with its `lastIndex`. Presence checks use the stateless `HAS_TOKEN_RE`.
 */
const TOKEN_RE = /\{([^{}]+)\}/g;
const HAS_TOKEN_RE = /\{[^{}]+\}/;

/**
 * A `{N}` placeholder in a rule condition. The `$` lookbehind keeps an
 * unresolved `${NAME}` macro from reading as a token: it stays verbatim.
 */
const CONDITION_TOKEN_RE = /(?<!\$)\{([^{}]+)\}/g;

/** `severity({N})`, `connected({N})` or `label({N})` in a rule condition. */
const STATUS_CALL_RE = /(?<![A-Za-z0-9_.])(severity|connected|label)\s*\(\s*\{(\d+)\}\s*\)/g;

/**
 * The index ladder over `conditions`: `0 if (c0) else (1 if (c1) else (-1))`.
 * Built inside-out — the default at the tail, then each condition from last
 * to first — so evaluation order is top-to-bottom, first truthy wins.
 */
export function ladderExpression(conditions: readonly string[]): string {
  let expression = String(DEFAULT_ARM);
  for (let i = conditions.length - 1; i >= 0; i--) {
    expression = `${i} if (${conditions[i]!}) else (${expression})`;
  }
  return expression;
}

/**
 * Evaluate a token-free ladder once at compile time and return the raw value
 * of the arm it selects (never round-tripped through a Python literal).
 * Boolean spellings the Formula Engine normalizes server-side (`&&`, `||`, `!`) are
 * normalized here the same way. Anything the evaluator cannot handle —
 * typically an unresolved `${NAME}` macro — means no arm can be chosen: the
 * default wins.
 */
function foldLadder(
  conditions: readonly string[],
  values: readonly RuleValue[],
  fallback: RuleValue
): RuleValue {
  const normalized = conditions.map((c) =>
    c
      .replace(/&&/g, ' and ')
      .replace(/\|\|/g, ' or ')
      .replace(/!(?!=)/g, ' not ')
  );
  try {
    const arm = evaluatePyExpr(ladderExpression(normalized), new Map());
    if (typeof arm === 'number' && arm >= 0) return values[arm]!;
  } catch (err) {
    if (!(err instanceof PyExprError)) throw err;
  }
  return fallback;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ensure a formula expression is in Formula Engine wire form (`{token}`
 * placeholders).
 *
 * The IR authoring form writes bare binding names (`"A + B"` with bindings
 * `{A, B}` — see the screen-ir fixtures); the Formula Engine's parser
 * requires `{A} + {B}`. If the expression already contains a `{...}` token it
 * is passed through untouched (already wire form); otherwise each binding key
 * is wrapped where it appears as a standalone identifier. Binding keys shadow
 * function names, matching the Formula Engine's own namespace behavior.
 */
export function toWireExpression(expression: string, bindingKeys: readonly string[]): string {
  if (HAS_TOKEN_RE.test(expression)) return expression;

  let wire = expression;
  // Longest-first so a key that prefixes another (`A` vs `AB`) cannot split it.
  const keys = [...bindingKeys].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const re = new RegExp(`(?<![A-Za-z0-9_{])${escapeRegExp(key)}(?![A-Za-z0-9_}])`, 'g');
    wire = wire.replace(re, `{${key}}`);
  }
  return wire;
}

/** The set of `{token}` texts appearing in a wire expression. */
function tokensIn(expression: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of expression.matchAll(TOKEN_RE)) tokens.add(m[1] as string);
  return tokens;
}

/**
 * The key prefix a vector token covers, or null for a plain token. `{*}` is
 * every binding (prefix ''), `{g.*}` the bindings whose key starts with `g.`.
 * A token that is itself a binding key is always plain.
 */
function vectorPrefix(token: string, keys: ReadonlySet<string>): string | null {
  if (keys.has(token)) return null;
  if (token === '*') return '';
  return token.endsWith('.*') ? token.slice(0, -1) : null;
}

/**
 * Which binding `keys` the `tokens` of an expression use (a plain token names
 * one, a vector token every key under its prefix), and which tokens have
 * nothing bound: a plain token with no binding, a vector token with no member.
 */
function tokenUse(
  tokens: ReadonlySet<string>,
  keys: ReadonlySet<string>
): { used: Set<string>; unbound: string[]; vector: boolean } {
  const used = new Set<string>();
  const unbound: string[] = [];
  let vector = false;
  for (const token of tokens) {
    const prefix = vectorPrefix(token, keys);
    if (prefix === null) {
      if (keys.has(token)) used.add(token);
      else unbound.push(token);
      continue;
    }
    vector = true;
    const members = [...keys].filter((key) => key.startsWith(prefix));
    if (members.length === 0) unbound.push(token);
    for (const key of members) used.add(key);
  }
  return { used, unbound, vector };
}

interface InlinedFormula {
  /** The formula's name: the namespace of its tokens. */
  readonly name: string;
  /** Whether the expression holds a vector token (`{<name>.*}`, `{<name>.g.*}`). */
  readonly vector: boolean;
  /** Wire expression with this formula's tokens renamed to `<name>.<key>`. */
  readonly expression: string;
  /** Channel bindings under the namespaced keys, macro-resolved. */
  readonly bindings: Readonly<Record<string, string>>;
}

/**
 * Prepare a screen formula for inlining into a rule expression: tokenize the
 * authored expression, namespace its tokens as `<name>.<key>` so multiple
 * inlined formulas (or rule `{N}` tokens) can never collide, and resolve
 * macros in its channel bindings. A vector token is namespaced the same way
 * (`{*}` to `{<name>.*}`, `{g.*}` to `{<name>.g.*}`), so it keeps meaning the
 * bindings of this formula and not every binding of the rule.
 */
function inlineFormula(decl: FormulaDeclaration, macros: MacroValues): InlinedFormula {
  const sourceBindings = decl.bindings ?? {};
  let wire = toWireExpression(decl.expression, Object.keys(sourceBindings));

  const keys = new Set(Object.keys(sourceBindings));
  const use = tokenUse(tokensIn(wire), keys);
  const memberless = use.unbound.filter((token) => vectorPrefix(token, keys) !== null);
  if (memberless.length > 0) {
    throw new RuleCompileError(
      `formula '${decl.name}' has vector token(s) with no binding: ${memberless.join(', ')}`
    );
  }
  if (use.vector) {
    wire = wire.replace(TOKEN_RE, (whole, token: string) =>
      vectorPrefix(token, keys) === null ? whole : `{${decl.name}.${token}}`
    );
  }

  const bindings: Record<string, string> = {};
  for (const [key, channel] of Object.entries(sourceBindings)) {
    const namespaced = `${decl.name}.${key}`;
    const re = new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g');
    wire = wire.replace(re, `{${namespaced}}`);
    bindings[namespaced] = substituteMacros(channel, macros);
  }
  return { name: decl.name, vector: use.vector, expression: wire, bindings };
}

/**
 * Compile a screen-level FormulaDeclaration to a standalone FormulaSpec:
 * authored expression tokenized to wire form, macros resolved in channel
 * bindings, unused bindings dropped (the Formula Engine rejects them). A
 * binding is used when a plain token names it or a vector token covers it.
 */
export function compileFormulaSpec(decl: FormulaDeclaration, macros: MacroValues): FormulaSpec {
  const sourceBindings = decl.bindings ?? {};
  const expression = toWireExpression(decl.expression, Object.keys(sourceBindings));
  const used = tokensIn(expression);
  if (used.size === 0) {
    throw new RuleCompileError(
      `formula '${decl.name}' has no {token} inputs; the Formula Engine requires at least one bound variable`
    );
  }

  const use = tokenUse(used, new Set(Object.keys(sourceBindings)));
  const bindings: Record<string, string> = {};
  for (const [key, channel] of Object.entries(sourceBindings)) {
    if (use.used.has(key)) bindings[key] = substituteMacros(channel, macros);
  }
  const unbound = use.unbound;
  if (unbound.length > 0) {
    throw new RuleCompileError(
      `formula '${decl.name}' references unbound token(s): ${unbound.join(', ')}`
    );
  }

  if (use.vector && (decl.kind ?? 'scalar') !== 'scalar') {
    throw new RuleCompileError(
      `formula '${decl.name}' has a vector token; only a scalar formula can have one`
    );
  }

  return { kind: decl.kind ?? 'scalar', expression, bindings };
}

function findFormula(
  name: string,
  formulas: readonly FormulaDeclaration[] | undefined
): FormulaDeclaration {
  const decl = (formulas ?? []).find((f) => f.name === name);
  if (!decl) {
    throw new RuleCompileError(`no formulas[] entry declares 'formula://${name}'`);
  }
  return decl;
}

/**
 * Compile one author-form rule to its runtime form.
 *
 * - Formula arm (`rule.formula`): the named screen formula's spec, directly
 *   (tokenized + macro-resolved).
 * - Conditional arm (`rule.pvs` + `rule.conditions`): a single Formula Engine
 *   expression — the arm-index ladder described in the header — plus the
 *   raw arm values and default for `useWidgetRules` to map the index onto.
 * - No conditions: a static value (the rule's raw `default`).
 * - Conditions with no live input after macro substitution: constant-folded
 *   to the raw value of the first truthy arm (else the default); an
 *   unresolved macro leaves the text verbatim and the fold falls to the
 *   default.
 *
 * A condition may apply `severity()`, `connected()` or `label()` (the enum
 * string of the value) to a `{N}` that is a plain channel; it passes through unchanged. A vector token is not accepted
 * in a condition: a rule reaches a roll-up through `formula://<name>`.
 *
 * Throws RuleCompileError on dangling `formula://` references, `{N}`
 * placeholders with no `pvs[N]`, formulas with no usable inputs, a vector
 * token with no member, and a status function applied to a formula.
 */
export function compileRule(
  rule: Rule,
  screenFormulas: readonly FormulaDeclaration[] | undefined,
  macros: MacroValues
): CompiledRule {
  const targetProperty = rule.targetProperty;

  if ('formula' in rule) {
    const decl = findFormula(formulaName(rule.formula), screenFormulas);
    return { kind: 'formula', targetProperty, spec: compileFormulaSpec(decl, macros) };
  }

  if (rule.conditions.length === 0) {
    return { kind: 'static', targetProperty, value: rule.default };
  }

  // Prepare each PV binding: plain PVs bind under their `{N}` index token
  // (macro-resolved); formula:// references become inlined sub-expressions.
  const bindings: Record<string, string> = {};
  const inlined = new Map<number, InlinedFormula>();
  rule.pvs.forEach((pv, index) => {
    if (isFormulaRef(pv.name)) {
      inlined.set(index, inlineFormula(findFormula(formulaName(pv.name), screenFormulas), macros));
    } else {
      bindings[String(index)] = substituteMacros(pv.name, macros);
    }
  });

  // Rewrite each condition: `{N}` tokens that reference an inlined formula
  // become the (parenthesized) formula expression; the rest stay verbatim.
  const usedTokens = new Set<string>();
  const rewriteCondition = (expression: string): string => {
    const text = substituteMacros(expression, macros);
    // A status function takes exactly one token; an inlined formula would put
    // an expression there, which the Formula Engine refuses.
    for (const m of text.matchAll(STATUS_CALL_RE)) {
      const pv = rule.pvs[Number(m[2])];
      if (pv !== undefined && isFormulaRef(pv.name)) {
        throw new RuleCompileError(
          `condition applies ${m[1]!}({${m[2]!}}) to ${pv.name}; ` +
            `${m[1]!}() reads one channel, not a formula`
        );
      }
    }
    return text.replace(CONDITION_TOKEN_RE, (whole, token: string) => {
      if (!/^\d+$/.test(token)) {
        throw new RuleCompileError(`condition token {${token}} is not a {N} pv-index placeholder`);
      }
      const index = Number(token);
      if (rule.pvs[index] === undefined) {
        throw new RuleCompileError(
          `condition references {${token}} but the rule only binds ${rule.pvs.length} pv(s)`
        );
      }
      const sub = inlined.get(index);
      if (sub) {
        for (const t of tokensIn(sub.expression)) usedTokens.add(t);
        return `(${sub.expression})`;
      }
      usedTokens.add(token);
      return whole;
    });
  };

  const rewritten = rule.conditions.map((c) => rewriteCondition(c.expression));
  const values = rule.conditions.map((c) => c.value);

  // Merge inlined formula channel bindings, then drop anything unused
  // (trigger-only PVs; the Formula Engine rejects unused bindings).
  for (const sub of inlined.values()) Object.assign(bindings, sub.bindings);
  for (const sub of inlined.values()) {
    if (!sub.vector) continue;
    // `{<name>.*}` covers every key under `<name>.`: no other formula's may be there.
    const other = [...inlined.values()].find(
      (o) => o.name !== sub.name && o.name.startsWith(`${sub.name}.`)
    );
    if (other) {
      throw new RuleCompileError(
        `formula '${sub.name}' has a vector token and cannot be used in one rule with ` +
          `formula '${other.name}', whose name starts with it`
      );
    }
  }
  const use = tokenUse(usedTokens, new Set(Object.keys(bindings)));
  const finalBindings: Record<string, string> = {};
  for (const [key, channel] of Object.entries(bindings)) {
    if (use.used.has(key)) finalBindings[key] = channel;
  }

  if (Object.keys(finalBindings).length === 0) {
    // No live input survives macro substitution (e.g. `${CODE} == 1` with
    // CODE=1): the ladder can never change, so evaluate it once here and
    // emit the chosen arm as a static value — no subscription.
    return {
      kind: 'static',
      targetProperty,
      value: foldLadder(rewritten, values, rule.default),
    };
  }

  return {
    kind: 'ladder',
    targetProperty,
    spec: { kind: 'scalar', expression: ladderExpression(rewritten), bindings: finalBindings },
    values,
    default: rule.default,
  };
}
