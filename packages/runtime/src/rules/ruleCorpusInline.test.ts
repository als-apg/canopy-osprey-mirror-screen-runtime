// The rules written inline in the test and e2e sources of the repository,
// compiled and held to __fixtures__/compiled-inline-corpus.json, beside the
// JSON fixtures of ruleCorpus.test.ts.
//
// Collected mechanically: every object literal in those sources that has a
// `targetProperty` and stands by itself (plain literals only). Left out: a
// rule built by a helper or from variables, one with a TypeScript cast or a
// spread inside, and the tests of the vector tokens, which pin their specs
// themselves. Each rule is compiled alone, with no screen formulas and no
// macros: a `formula://` reference is recorded as the error it gives.
//
// Regenerate when a test gains or loses an inline rule (the record names
// each by file and position), or when a change of the sent form is intended:
//   pnpm --filter @slaclab/canopy-screen-runtime exec vitest run src/rules/ruleCorpusInline.test.ts -u

import { describe, expect, it } from 'vitest';
import type { Rule } from '@slaclab/canopy-screen-ir';
import { compileRule } from './compileRule.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true }
    ): Record<string, string>;
  }
}

const HERE = 'packages/runtime/src/rules';
const RECORDED = './__fixtures__/compiled-inline-corpus.json';

const sources: Record<string, string> = import.meta.glob(
  [
    '../../../../packages/*/src/**/*.test.{ts,tsx}',
    '../../../../packages/*/test/**/*.{ts,tsx}',
    '../../../../apps/*/src/**/*.test.{ts,tsx}',
    '../../../../apps/*/e2e/**/*.ts',
    '!**/node_modules/**',
    // Tests of vector tokens, status functions and label(): they pin their own specs.
    '!**/compileRule.vector.test.ts',
    '!**/vectorFormulas.test.ts',
    '!**/formulaVectorCases.test.ts',
    '!**/vectorInputs.test.tsx',
    '!**/noValue.test.tsx',
    '!**/formulaProblems.test.tsx',
    '!**/ruleCorpus*.test.ts',
  ],
  { query: '?raw', import: 'default', eager: true }
);

function fromRoot(key: string): string {
  const parts = HERE.split('/');
  for (const part of key.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** Characters after which a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = new Set('(,=:[!&|?{};\n'.split(''));

/**
 * The innermost object literals of `source` that mention `targetProperty`,
 * as text. Strings, comments and regular expressions are skipped, so a brace
 * inside one does not count.
 */
function ruleLiterals(source: string): string[] {
  const found: string[] = [];
  const open: { start: number; childHas: boolean }[] = [];
  let last = '\n';
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === "'" || c === '"' || c === '`') {
      for (i += 1; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i += 1;
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    } else if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2) + 1;
      if (i === 0) break;
      continue;
    } else if (c === '/' && BEFORE_REGEX.has(last)) {
      let inClass = false;
      for (i += 1; i < source.length && (inClass || source[i] !== '/'); i++) {
        if (source[i] === '\\') i += 1;
        else if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '\n') break;
      }
    } else if (c === '{') {
      open.push({ start: i, childHas: false });
    } else if (c === '}') {
      const frame = open.pop();
      if (!frame) continue;
      const text = source.slice(frame.start, i + 1);
      const has = /\btargetProperty\b/.test(text);
      if (has && !frame.childHas) found.push(text);
      const parent = open.at(-1);
      if (parent && has) parent.childHas = true;
    }
    if (!/\s/.test(c)) last = c;
    else if (c === '\n' && last !== '\n' && BEFORE_REGEX.has(last)) last = '\n';
  }
  return found;
}

/** The literal as a rule, or undefined when it does not stand by itself or is no rule. */
function asRule(text: string): Rule | undefined {
  let value: unknown;
  try {
    value = new Function(`return (${text});`)();
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const rule = value as Record<string, unknown>;
  if (typeof rule.targetProperty !== 'string') return undefined;
  const conditional = Array.isArray(rule.pvs) && Array.isArray(rule.conditions);
  return conditional || typeof rule.formula === 'string' ? (value as Rule) : undefined;
}

describe('rule corpus: rules written inline in tests', () => {
  it('compiles each to the recorded bytes', async () => {
    const out: Record<string, unknown> = {};
    let literals = 0;
    let rules = 0;
    const files = Object.entries(sources).map(([key, text]) => [fromRoot(key), text] as const);
    for (const [file, text] of files.sort(([a], [b]) => (a < b ? -1 : 1))) {
      ruleLiterals(text).forEach((literal, n) => {
        literals += 1;
        const rule = asRule(literal);
        if (rule === undefined) return;
        rules += 1;
        try {
          out[`${file}#${n}`] = compileRule(rule, undefined, {});
        } catch (err) {
          out[`${file}#${n}`] = { error: (err as Error).message };
        }
      });
    }
    const record = {
      collected: { literals, compiled: rules, leftOut: literals - rules },
      rules: out,
    };
    expect(rules).toBeGreaterThan(20);
    await expect(`${JSON.stringify(record, null, 2)}\n`).toMatchFileSnapshot(RECORDED);
  });
});
