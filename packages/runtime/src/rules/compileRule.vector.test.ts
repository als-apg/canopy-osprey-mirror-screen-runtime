// Vector tokens (`{*}`, `{g.*}`) and the status functions `severity()` and
// `connected()` through the compiler. Each case pins the exact spec sent.

import { describe, expect, it } from 'vitest';
import type { FormulaDeclaration, Rule } from '@slaclab/canopy-screen-ir';
import { compileFormulaSpec, compileRule, RuleCompileError } from './compileRule.js';

const WORST: FormulaDeclaration = {
  name: 'worst',
  kind: 'scalar',
  expression: 'max(severity({*}))',
  bindings: { '0': '${R}:PS1:STATE', '1': '${R}:PS2:STATE', '2': '${R}:FAN:STATE' },
};
const DEV: FormulaDeclaration = {
  name: 'dev',
  kind: 'scalar',
  expression: 'nanmax(abs({set.*} - {read.*}))',
  bindings: {
    'set.1': 'PUMP:1:SETPOINT',
    'read.1': 'PUMP:1:CURRENT',
    'set.2': 'PUMP:2:SETPOINT',
    'read.2': 'PUMP:2:CURRENT',
  },
};
const MACROS = { R: 'RACK:A' };

function rule(pvs: string[], conditions: [string, string][], extra: Partial<Rule> = {}): Rule {
  return {
    id: 'r',
    name: 'r',
    targetProperty: 'fillColor',
    default: '#888888',
    pvs: pvs.map((name) => ({ name, trigger: true })),
    conditions: conditions.map(([expression, value]) => ({ expression, value })),
    ...extra,
  } as Rule;
}

function ladder(r: Rule, formulas: FormulaDeclaration[] = []) {
  const compiled = compileRule(r, formulas, MACROS);
  if (compiled.kind !== 'ladder') throw new Error(`expected a ladder, got ${compiled.kind}`);
  return compiled.spec;
}

describe('compileFormulaSpec with vector tokens', () => {
  it('{*} keeps every binding', () => {
    expect(compileFormulaSpec(WORST, MACROS)).toEqual({
      kind: 'scalar',
      expression: 'max(severity({*}))',
      bindings: { '0': 'RACK:A:PS1:STATE', '1': 'RACK:A:PS2:STATE', '2': 'RACK:A:FAN:STATE' },
    });
  });

  it('{g.*} keeps the bindings of each group named', () => {
    expect(compileFormulaSpec(DEV, {})).toEqual({
      kind: 'scalar',
      expression: DEV.expression,
      bindings: DEV.bindings,
    });
  });

  it('drops a binding that no plain token names and no vector token matches', () => {
    const spec = compileFormulaSpec(
      { ...DEV, expression: 'max({set.*}) + {lim}', bindings: { ...DEV.bindings, lim: 'L' } },
      {}
    );
    expect(spec.bindings).toEqual({
      'set.1': 'PUMP:1:SETPOINT',
      'set.2': 'PUMP:2:SETPOINT',
      lim: 'L',
    });
  });

  it('a group of more than one level is inside the group above it', () => {
    const spec = compileFormulaSpec(
      {
        name: 'n',
        expression: 'max({f.g.*})',
        bindings: { 'f.g.1': 'A', 'f.h.1': 'B', 'f.g': 'C' },
      },
      {}
    );
    expect(spec.bindings).toEqual({ 'f.g.1': 'A' });
  });

  it('a token that is itself a binding key is a plain token', () => {
    const spec = compileFormulaSpec(
      { name: 'n', expression: '{g.*} + 1', bindings: { 'g.*': 'A', 'g.1': 'B' } },
      {}
    );
    expect(spec.bindings).toEqual({ 'g.*': 'A' });
  });

  it('rejects a vector token with no member', () => {
    expect(() =>
      compileFormulaSpec({ name: 'n', expression: 'max({g.*})', bindings: { 'h.1': 'A' } }, {})
    ).toThrow(/unbound token\(s\): g\.\*/);
    expect(() => compileFormulaSpec({ name: 'n', expression: 'max({*})' }, {})).toThrow(
      RuleCompileError
    );
  });

  it('rejects a vector token in a formula that is not scalar', () => {
    expect(() => compileFormulaSpec({ ...WORST, kind: 'waveform' }, MACROS)).toThrow(
      /vector token.*scalar/
    );
  });

  it('leaves an authored expression with bare names as before', () => {
    expect(
      compileFormulaSpec({ name: 'n', expression: 'A * 2', bindings: { A: 'X', B: 'Y' } }, {})
    ).toEqual({ kind: 'scalar', expression: '{A} * 2', bindings: { A: 'X' } });
  });
});

describe('compileRule with an inlined vector formula', () => {
  it('renames {*} to the bindings of the formula', () => {
    expect(
      ladder(
        rule(
          ['formula://worst'],
          [
            ['{0} >= 2', '#da1e28'],
            ['{0} == 1', '#f1c21b'],
          ]
        ),
        [WORST]
      )
    ).toEqual({
      kind: 'scalar',
      expression:
        '0 if ((max(severity({worst.*}))) >= 2) else (1 if ((max(severity({worst.*}))) == 1) else (-1))',
      bindings: {
        'worst.0': 'RACK:A:PS1:STATE',
        'worst.1': 'RACK:A:PS2:STATE',
        'worst.2': 'RACK:A:FAN:STATE',
      },
    });
  });

  it('renames named groups, beside a plain channel of the rule', () => {
    expect(
      ladder(rule(['formula://dev', 'PUMP:LIMIT'], [['{0} > {1}', '#da1e28']]), [DEV])
    ).toEqual({
      kind: 'scalar',
      expression: '0 if ((nanmax(abs({dev.set.*} - {dev.read.*}))) > {1}) else (-1)',
      bindings: {
        'dev.set.1': 'PUMP:1:SETPOINT',
        'dev.read.1': 'PUMP:1:CURRENT',
        'dev.set.2': 'PUMP:2:SETPOINT',
        'dev.read.2': 'PUMP:2:CURRENT',
        '1': 'PUMP:LIMIT',
      },
    });
  });

  it('keeps two inlined formulas apart', () => {
    const spec = ladder(
      rule(['formula://worst', 'formula://dev'], [['{0} >= 2 or {1} > 5', 'x']]),
      [WORST, DEV]
    );
    expect(spec.expression).toBe(
      '0 if ((max(severity({worst.*}))) >= 2 or (nanmax(abs({dev.set.*} - {dev.read.*}))) > 5) else (-1)'
    );
    expect(Object.keys(spec.bindings).sort()).toEqual(
      ['dev.read.1', 'dev.read.2', 'dev.set.1', 'dev.set.2', 'worst.0', 'worst.1', 'worst.2'].sort()
    );
  });

  it('drops the bindings of an inlined formula that its tokens do not reach', () => {
    const spec = ladder(rule(['formula://part'], [['{0} > 0', 'x']]), [
      { ...DEV, name: 'part', expression: 'max({set.*})' },
    ]);
    expect(spec.bindings).toEqual({
      'part.set.1': 'PUMP:1:SETPOINT',
      'part.set.2': 'PUMP:2:SETPOINT',
    });
  });

  it('rejects an inlined vector token with no member', () => {
    expect(() =>
      compileRule(
        rule(['formula://n'], [['{0} > 0', 'x']]),
        [{ name: 'n', expression: 'max({g.*})', bindings: { 'h.1': 'A' } }],
        {}
      )
    ).toThrow(/formula 'n'.*g\.\*/);
  });

  it('rejects a formula whose vector token would reach the bindings of another', () => {
    expect(() =>
      compileRule(
        rule(['formula://a', 'formula://a.b'], [['{0} > {1}', 'x']]),
        [
          { name: 'a', expression: 'max({*})', bindings: { '1': 'A' } },
          { name: 'a.b', expression: '{x}', bindings: { x: 'B' } },
        ],
        {}
      )
    ).toThrow(/'a'.*'a\.b'/);
  });
});

describe('compileRule with status functions in a condition', () => {
  it('passes severity() and connected() on a plain channel unchanged', () => {
    expect(
      ladder(
        rule(
          ['VALVE:7:POSITION'],
          [
            ['connected({0}) == 0', '#6f6f6f'],
            ['severity({0}) >= 2', '#da1e28'],
            ['severity({0}) == 1', '#f1c21b'],
          ]
        )
      )
    ).toEqual({
      kind: 'scalar',
      expression:
        '0 if (connected({0}) == 0) else (1 if (severity({0}) >= 2) else (2 if (severity({0}) == 1) else (-1)))',
      bindings: { '0': 'VALVE:7:POSITION' },
    });
  });

  for (const fn of ['severity', 'connected']) {
    it(`rejects ${fn}() of a formula reference`, () => {
      for (const text of [`${fn}({0}) >= 2`, `${fn} ( {0} ) >= 2`]) {
        expect(() =>
          compileRule(rule(['formula://worst'], [[text, 'x']]), [WORST], MACROS)
        ).toThrow(new RegExp(`${fn}\\(\\{0\\}\\).*formula://worst`));
      }
    });
  }

  it('does not take a name that only ends in severity for the function', () => {
    expect(
      ladder(rule(['formula://worst'], [['myseverity({0}) >= 2', 'x']]), [WORST]).expression
    ).toBe('0 if (myseverity((max(severity({worst.*})))) >= 2) else (-1)');
  });

  it('still rejects a vector token written in a condition', () => {
    for (const text of ['max({*}) > 0', 'max({g.*}) > 0']) {
      expect(() => compileRule(rule(['A:B'], [[text, 'x']]), [], {})).toThrow(
        /not a \{N\} pv-index placeholder/
      );
    }
  });
});
