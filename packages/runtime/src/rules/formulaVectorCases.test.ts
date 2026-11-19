// The shared table of cases for formulas over many channels
// (__fixtures__/formula-vector-cases.json), answered by the in-page
// evaluator. The same table is meant for every evaluator of the formula
// language, so that the page and the server cannot drift apart silently.

import { describe, expect, it } from 'vitest';
import { FormulaError, type FormulaResultMeta, type FormulaSpec } from '../formula.js';
import { createLocalAwareFormulaSubscriber, type LocalPVLike } from './localFormula.js';
import table from './__fixtures__/formula-vector-cases.json' with { type: 'json' };

interface Channel {
  value?: number | string | boolean;
  severity?: number;
  down?: boolean;
  nonFinite?: 'nan' | 'inf';
  labels?: string[];
}
interface Case {
  name: string;
  expression: string;
  bindings: Record<string, string>;
  channels: Record<string, Channel>;
  missingListed?: number;
  value?: number | string | boolean;
  severity?: string;
  vectorInputs?: FormulaResultMeta['vectorInputs'] | null;
  error?: 'input_missing' | 'type_error' | 'parse_error';
  detail?: string;
}

const LOC = 'loc://';

/** The table's channels as a PV service: listed channels deliver at once. */
function service(channels: Record<string, Channel>): LocalPVLike {
  return {
    subscribe(address, listener) {
      const channel = channels[address.slice(LOC.length)];
      if (channel === undefined) {
        // No sample yet: connected, nothing to read.
        listener({ value: null, connected: true });
      } else if (channel.down) {
        listener({ value: channel.value ?? null, connected: false, severity: channel.severity });
      } else {
        const value =
          channel.nonFinite === 'nan'
            ? NaN
            : channel.nonFinite === 'inf'
              ? Infinity
              : channel.value;
        listener({
          value,
          connected: true,
          severity: channel.severity,
          enumChoices: channel.labels,
        });
      }
      return () => {};
    },
  };
}

type Outcome =
  | { value: unknown; meta: FormulaResultMeta | undefined }
  | { error: Error }
  | { nothing: true };

function run(c: Case): Outcome {
  const spec: FormulaSpec = {
    kind: 'scalar',
    expression: c.expression,
    bindings: Object.fromEntries(Object.entries(c.bindings).map(([k, v]) => [k, LOC + v])),
  };
  let outcome: Outcome = { nothing: true };
  const subscriber = createLocalAwareFormulaSubscriber(service(c.channels), null, {
    nameOf: (address) => address.slice(LOC.length),
    ...(c.missingListed !== undefined ? { missingListed: c.missingListed } : {}),
  });
  subscriber.subscribe(spec, {
    onResult: (value, meta) => (outcome = { value, meta }),
    onError: (error) => (outcome = { error }),
  });
  return outcome;
}

describe('formulas over many channels: the shared cases, in the page', () => {
  for (const c of (table as unknown as { cases: Case[] }).cases) {
    it(c.name, () => {
      const outcome = run(c);
      const plain =
        !/severity\(|connected\(|label\(/.test(c.expression) &&
        [...c.expression.matchAll(/\{([^{}]+)\}/g)].every((m) => m[1]! in c.bindings);
      if (c.error === undefined) {
        if (!('value' in outcome)) throw new Error(`no result: ${JSON.stringify(outcome)}`);
        if (typeof c.value === 'number') expect(outcome.value).toBeCloseTo(c.value, 9);
        else expect(outcome.value).toBe(c.value);
        expect(typeof outcome.value).toBe(typeof c.value);
        // A plain formula in the page reports no severity (as before this table).
        if (!plain) expect(outcome.meta?.severity).toBe(c.severity);
        expect(outcome.meta?.vectorInputs ?? null).toEqual(c.vectorInputs);
        return;
      }
      if (c.error === 'input_missing' && plain) {
        // A plain formula in the page has no result without its inputs, but
        // says so in its own way (as before this table): silence or an error.
        expect('value' in outcome).toBe(false);
        return;
      }
      if (!('error' in outcome)) throw new Error(`no error: ${JSON.stringify(outcome)}`);
      const code = outcome.error instanceof FormulaError ? outcome.error.code : 'expression';
      if (c.error === 'input_missing') {
        expect(code).toBe('formula_input_missing');
        expect((outcome.error as FormulaError).retryable).toBe(true);
        if (c.detail !== undefined) expect(outcome.error.message).toContain(c.detail);
      } else if (c.error === 'type_error') {
        expect(['formula_type_error', 'expression']).toContain(code);
        expect(outcome.error.message).toMatch(/one value|not a finite number/);
      } else {
        expect(code).toBe('expression');
      }
    });
  }
});
