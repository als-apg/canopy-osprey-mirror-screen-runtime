// Formulas over many channels in the page: a roll-up in fixture mode, live
// changes over loc:// inputs, and the evaluator's vector arithmetic.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPVService } from '@slaclab/canopy-client';
import type { FormulaDeclaration, Rule } from '@slaclab/canopy-screen-ir';
import type { FormulaResultMeta, FormulaScalarValue, FormulaSpec } from '../formula.js';
import { FixturePVService } from '../pv/FixturePVService.js';
import { compileFormulaSpec, compileRule } from './compileRule.js';
import { createFixtureFormulaSubscriber } from './fixtureFormulas.js';
import { createLocalAwareFormulaSubscriber, type LocalPVLike } from './localFormula.js';
import { analyzePyExpr, evaluatePyExpr, PyExprError } from './pyExpr.js';

const WORST: FormulaDeclaration = {
  name: 'worst',
  kind: 'scalar',
  expression: 'max(severity({*}))',
  bindings: { '0': '${R}:PS1', '1': '${R}:PS2', '2': '${R}:FAN' },
};
const LIGHT: Rule = {
  id: 'r',
  name: 'light',
  targetProperty: 'fillColor',
  default: 'green',
  pvs: [{ name: 'formula://worst', trigger: true }],
  conditions: [
    { expression: '{0} >= 2', value: 'red' },
    { expression: '{0} == 1', value: 'yellow' },
  ],
} as Rule;
const MACROS = { R: 'RACK:A' };

function locals(): LocalPVService {
  const l = new LocalPVService();
  l.connect();
  return l;
}

function inFixture(
  pvs: ConstructorParameters<typeof FixturePVService>[0]['pvs'],
  spec: FormulaSpec
) {
  const fixture = new FixturePVService({ pvs });
  fixture.connect();
  const results: [FormulaScalarValue, FormulaResultMeta | undefined][] = [];
  const errors: Error[] = [];
  createFixtureFormulaSubscriber(locals(), fixture).subscribe(spec, {
    onResult: (value, meta) => results.push([value, meta]),
    onError: (error) => errors.push(error),
  });
  return { results, errors };
}

function ladder(): FormulaSpec {
  const compiled = compileRule(LIGHT, [WORST], MACROS);
  if (compiled.kind !== 'ladder') throw new Error('expected a ladder');
  return compiled.spec;
}

describe('a roll-up light in fixture mode', () => {
  it('takes the default arm while every member is well', () => {
    const { results, errors } = inFixture(
      { 'RACK:A:PS1': 1, 'RACK:A:PS2': 1, 'RACK:A:FAN': 1 },
      ladder()
    );
    expect(errors).toEqual([]);
    expect(results.map(([value]) => value)).toEqual([-1]);
  });

  it('takes the arm of the worst member', () => {
    const { results } = inFixture(
      { 'RACK:A:PS1': 1, 'RACK:A:PS1.SEVR': 1, 'RACK:A:PS2': 1, 'RACK:A:FAN': 1 },
      ladder()
    );
    expect(results.map(([value]) => value)).toEqual([1]);
  });

  it('takes the worst arm for a member that is disconnected or not recorded', () => {
    const cases: ConstructorParameters<typeof FixturePVService>[0]['pvs'][] = [
      { 'RACK:A:PS1': 1, 'RACK:A:PS2': { value: 1, connected: false }, 'RACK:A:FAN': 1 },
      { 'RACK:A:PS1': 1, 'RACK:A:FAN': 1 },
    ];
    for (const pvs of cases) {
      const { results, errors } = inFixture(pvs, ladder());
      expect(errors).toEqual([]);
      expect(results).toEqual([
        [
          0,
          {
            severity: 'INVALID',
            vectorInputs: { count: 3, missing: ['RACK:A:PS2'], more: 0 },
          },
        ],
      ]);
    }
  });

  it('answers a widget channel bound to the formula, naming the recorded channels', () => {
    const { results } = inFixture(
      { 'RACK:A:PS1': 1, 'RACK:A:PS1.SEVR': 2, 'RACK:A:PS2': 1 },
      compileFormulaSpec(WORST, MACROS)
    );
    expect(results).toEqual([
      [3, { severity: 'INVALID', vectorInputs: { count: 3, missing: ['RACK:A:FAN'], more: 0 } }],
    ]);
  });
});

describe('a live formula over many loc:// inputs', () => {
  function live(expression: string, keys: string[]) {
    const listeners = new Map<
      string,
      (d: { value: unknown; connected: boolean; severity?: number }) => void
    >();
    const service: LocalPVLike = {
      subscribe(address, listener) {
        listeners.set(address, listener);
        return () => listeners.delete(address);
      },
    };
    const results: [FormulaScalarValue, FormulaResultMeta | undefined][] = [];
    const errors: Error[] = [];
    const off = createLocalAwareFormulaSubscriber(service, null).subscribe(
      {
        kind: 'scalar',
        expression,
        bindings: Object.fromEntries(keys.map((k) => [k, `loc://${k}`])),
      },
      { onResult: (value, meta) => results.push([value, meta]), onError: (e) => errors.push(e) }
    );
    const send = (key: string, value: unknown, connected = true, severity = 0) =>
      listeners.get(`loc://${key}`)!({ value, connected, severity });
    return { results, errors, send, off, listeners };
  }

  afterEach(() => vi.useRealTimers());

  it('holds its first result until every member has reported, then answers every change', () => {
    const { results, errors, send } = live('sum(connected({*}))', ['a', 'b']);
    expect(results).toEqual([]);
    send('a', 1);
    expect(results).toEqual([]);
    expect(errors).toEqual([]);
    send('b', 1);
    send('b', 2);
    send('a', 1, false);
    expect(results.map(([v]) => v)).toEqual([2, 1]);
    expect(results.at(-1)![1]).toEqual({
      severity: 'INVALID',
      vectorInputs: { count: 2, missing: ['loc://a'], more: 0 },
    });
  });

  it('answers after the start window when a member has not reported by then', () => {
    vi.useFakeTimers();
    const { results, send } = live('sum(connected({*}))', ['a', 'b']);
    send('a', 1);
    vi.advanceTimersByTime(999);
    expect(results).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(results).toEqual([
      [1, { severity: 'INVALID', vectorInputs: { count: 2, missing: ['loc://b'], more: 0 } }],
    ]);
    send('b', 1);
    expect(results.map(([v]) => v)).toEqual([1, 2]);
  });

  it('does not answer after the start window once it is unsubscribed', () => {
    vi.useFakeTimers();
    const { results, off } = live('sum(connected({*}))', ['a']);
    off();
    vi.advanceTimersByTime(5000);
    expect(results).toEqual([]);
  });

  it('delivers again when only the severity changes', () => {
    const { results, send } = live('count({*})', ['a']);
    send('a', 1);
    send('a', 1, true, 2);
    send('a', 1, true, 2);
    expect(results.map(([v, meta]) => [v, meta?.severity])).toEqual([
      [1, 'NO_ALARM'],
      [1, 'MAJOR'],
    ]);
  });

  it('reports a value reduction with a member missing as a retryable error, then recovers', () => {
    const { results, errors, send } = live('max({*})', ['a', 'b']);
    send('a', 1);
    send('b', null);
    expect(results).toEqual([]);
    expect(errors.at(-1)).toMatchObject({ code: 'formula_input_missing', retryable: true });
    expect(errors.at(-1)!.message).toContain("PVs not available: ['loc://b']");
    send('b', 5);
    expect(results.map(([v]) => v)).toEqual([5]);
  });

  it('stops listening on unsubscribe', () => {
    const { off, listeners } = live('max({*})', ['a', 'b']);
    off();
    expect(listeners.size).toBe(0);
  });
});

describe('vector arithmetic in the page', () => {
  const values = new Map<string, number | string | boolean | null>([
    ['g.1', 1],
    ['g.2', 5],
    ['g.3', 9],
    ['h.1', 1],
    ['h.2', 2],
    ['lim', 4],
  ]);
  const status = new Map([...values.keys()].map((k) => [k, { severity: 0, connected: true }]));
  const ev = (expression: string) => evaluatePyExpr(expression, values, status);

  it('combines conditions member by member with * and +, and with where()', () => {
    expect(ev('count_nonzero(({g.*} > 2) * ({g.*} < 8))')).toBe(1);
    expect(ev('count_nonzero(({g.*} < 2) + ({g.*} > 8))')).toBe(2);
    expect(ev('sum(where({g.*} > {lim}, {g.*}, 0))')).toBe(14);
    expect(ev('sum(where({g.*} > {lim}, 1, -1))')).toBe(1);
    expect(ev('where({lim} > 3, 7, 8)')).toBe(7);
  });

  it('keeps a truth value through max and min, and counts through sum', () => {
    expect(ev('max({g.*} > 8)')).toBe(true);
    expect(ev('min({g.*} > 8)')).toBe(false);
    expect(ev('sum({g.*} > 2)')).toBe(2);
  });

  it('applies a function of one number to each member', () => {
    expect(ev('max(abs(0 - {g.*}))')).toBe(9);
    expect(ev('sum(-{g.*} ** 2)')).toBe(-107);
    expect(ev('mean({g.*} // 2)')).toBe(2);
  });

  it('keeps max and min of several numbers', () => {
    expect(ev('max({lim}, 9) + min({lim}, 9)')).toBe(13);
    expect(ev('max({lim})')).toBe(4);
    expect(ev('count({lim}) + sum({lim})')).toBe(5);
  });

  it('refuses vectors of different sizes, and a vector where one value is needed', () => {
    for (const expression of [
      'sum({g.*} - {h.*})',
      '1 if {g.*} else 2',
      'max({g.*}) and {g.*}',
      'not {g.*}',
      'max({g.*}, 3)',
      'sum({nope.*})',
    ]) {
      expect(() => ev(expression), expression).toThrow(PyExprError);
    }
  });

  it('says which bindings an expression reads as a plain value', () => {
    const inputs = analyzePyExpr(
      'max({g.*}) + severity({lim}) + {h.1} + connected({h.2}) + {h.2}',
      [...values.keys()]
    );
    expect([...inputs.strict].sort()).toEqual(['h.1', 'h.2']);
    expect(inputs.members).toEqual(['g.1', 'g.2', 'g.3']);
    expect(inputs.status).toBe(true);
    expect(analyzePyExpr('{lim} + 1', ['lim']).status).toBe(false);
  });
});
