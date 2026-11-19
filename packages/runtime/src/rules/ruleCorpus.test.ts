// Every rule and formula in the repository's JSON fixtures compiles to
// exactly the bytes recorded in __fixtures__/compiled-corpus.json. A change
// to the compiler that alters what an existing screen sends shows up here.
//
// Regenerate (only when a change of the sent form is intended):
//   UPDATE_RULE_CORPUS=1 pnpm --filter @slaclab/canopy-screen-runtime exec vitest run src/rules/ruleCorpus.test.ts

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FormulaDeclaration, MacroValues, Rule } from '@slaclab/canopy-screen-ir';
import { compileFormulaSpec, compileRule } from './compileRule.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../../..');
const RECORDED = join(HERE, '__fixtures__/compiled-corpus.json');
const ROOTS = ['packages', 'apps'];
const SKIP = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage']);

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : jsonFiles(path);
    return entry.name.endsWith('.json') && path !== RECORDED ? [path] : [];
  });
}

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

function compileCorpus(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const files = ROOTS.flatMap((root) => jsonFiles(join(REPO, root))).sort();
  for (const file of files) {
    let parsed: Json;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8')) as Json;
    } catch {
      continue; // some fixtures are malformed on purpose
    }
    collect(parsed, relative(REPO, file).split('\\').join('/'), undefined, {}, out);
  }
  return out;
}

describe('rule corpus', () => {
  it('compiles every fixture rule and formula to the recorded bytes', () => {
    const corpus = compileCorpus();
    const text = `${JSON.stringify(corpus, null, 2)}\n`;
    if (process.env.UPDATE_RULE_CORPUS === '1') writeFileSync(RECORDED, text);
    expect(Object.keys(corpus).length).toBeGreaterThan(100);
    expect(text).toBe(readFileSync(RECORDED, 'utf8'));
  });
});
