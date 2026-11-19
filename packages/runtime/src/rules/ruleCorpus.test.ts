// Every rule and formula in the repository's JSON fixtures compiles to
// exactly the bytes recorded in __fixtures__/compiled-corpus.json. A change
// to the compiler that alters what an existing screen sends shows up here.
//
// Regenerate (only when a change of the sent form is intended):
//   pnpm --filter @slaclab/canopy-screen-runtime exec vitest run src/rules/ruleCorpus.test.ts -u

import { describe, expect, it } from 'vitest';
import type { FormulaDeclaration, MacroValues, Rule } from '@slaclab/canopy-screen-ir';
import { compileFormulaSpec, compileRule } from './compileRule.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true }
    ): Record<string, string>;
  }
}

/** This file's directory from the repository root; glob keys are relative to it. */
const HERE = 'packages/runtime/src/rules';
const RECORDED = './__fixtures__/compiled-corpus.json';

/** Every JSON file of the packages and apps, as text, by path from this file. */
const sources: Record<string, string> = import.meta.glob(
  [
    '../../../../packages/**/*.json',
    '../../../../apps/**/*.json',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/__fixtures__/compiled-corpus.json',
  ],
  { query: '?raw', import: 'default', eager: true }
);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (v: Json | undefined): v is { [key: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** What compiling gives: the compiled form, or the error it throws. */
function outcome(compile: () => unknown): unknown {
  try {
    return compile();
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Walk one parsed file. A `formulas` or `macros` member applies to everything
 * below the object that holds it, as on a screen.
 */
function collect(
  value: Json,
  at: string,
  formulas: readonly FormulaDeclaration[] | undefined,
  macros: MacroValues,
  out: Record<string, unknown>
): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collect(item, `${at}/${i}`, formulas, macros, out));
    return;
  }
  if (!isObject(value)) return;

  if (isObject(value.macros) && Object.values(value.macros).every((m) => typeof m === 'string')) {
    macros = { ...macros, ...(value.macros as MacroValues) };
  }
  if (Array.isArray(value.formulas) && value.formulas.every((f) => isObject(f) && 'name' in f)) {
    formulas = value.formulas as unknown as FormulaDeclaration[];
    formulas.forEach((decl, i) => {
      out[`${at}/formulas/${i}`] = outcome(() => compileFormulaSpec(decl, macros));
    });
  }
  if (Array.isArray(value.rules)) {
    value.rules.forEach((rule, i) => {
      if (!isObject(rule) || typeof rule.targetProperty !== 'string') return;
      out[`${at}/rules/${i}`] = outcome(() =>
        compileRule(rule as unknown as Rule, formulas, macros)
      );
    });
  }
  for (const [key, child] of Object.entries(value)) {
    collect(child, `${at}/${key}`, formulas, macros, out);
  }
}

/** A glob key (`../render/x.json`) as a path from the repository root. */
function fromRoot(key: string): string {
  const parts = HERE.split('/');
  for (const part of key.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function compileCorpus(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const files = Object.entries(sources).map(([key, text]) => [fromRoot(key), text] as const);
  for (const [file, text] of files.sort(([a], [b]) => (a < b ? -1 : 1))) {
    let parsed: Json;
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      continue; // some fixtures are malformed on purpose
    }
    collect(parsed, file, undefined, {}, out);
  }
  return out;
}

describe('rule corpus', () => {
  it('compiles every fixture rule and formula to the recorded bytes', async () => {
    const corpus = compileCorpus();
    expect(Object.keys(corpus).length).toBeGreaterThan(100);
    await expect(`${JSON.stringify(corpus, null, 2)}\n`).toMatchFileSnapshot(RECORDED);
  });
});
