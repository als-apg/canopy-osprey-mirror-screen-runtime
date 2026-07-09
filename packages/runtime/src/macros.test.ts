// Macro semantics: substitution forms, deep prop substitution, screen
// defaults ⊕ caller values, and embedded-screen macro chaining.

import { describe, expect, it } from 'vitest';
import type { ScreenJSON } from '@slaclab/canopy-screen-ir';
import {
  childMacros,
  hasMacro,
  resolveScreenMacros,
  substituteDeep,
  substituteMacros,
  substituteProps,
} from './macros.js';

describe('substituteMacros', () => {
  it('substitutes the canonical ${NAME} form', () => {
    expect(substituteMacros('${P}:PRESSURE', { P: 'DEMO:VAC1' })).toBe('DEMO:VAC1:PRESSURE');
  });

  it('substitutes the legacy $(NAME) form', () => {
    expect(substituteMacros('$(P):PRESSURE', { P: 'DEMO:VAC1' })).toBe('DEMO:VAC1:PRESSURE');
  });

  it('substitutes multiple and repeated macros in one string', () => {
    expect(substituteMacros('${A}/${B}/${A}', { A: 'x', B: 'y' })).toBe('x/y/x');
  });

  it('leaves unresolved macros verbatim so they stay visible', () => {
    expect(substituteMacros('${MISSING}:VAL', {})).toBe('${MISSING}:VAL');
    expect(hasMacro('${MISSING}:VAL')).toBe(true);
    expect(hasMacro('LI21:VAL')).toBe(false);
  });

  it('does not re-scan substituted values (no recursion)', () => {
    expect(substituteMacros('${A}', { A: '${B}', B: 'never' })).toBe('${B}');
  });
});

describe('substituteDeep / substituteProps', () => {
  it('substitutes strings nested in arrays and objects', () => {
    expect(
      substituteDeep(
        { file: '${P}.json', list: ['${P}:A', 42, null], nested: { pv: '$(P):B' } },
        { P: 'DEV' }
      )
    ).toEqual({ file: 'DEV.json', list: ['DEV:A', 42, null], nested: { pv: 'DEV:B' } });
  });

  it('substitutes across ALL string props, not just pv channels', () => {
    expect(
      substituteProps(
        { pv: '${P}:RB', label: 'Device ${P}', precision: 3, alarmBorder: true },
        { P: 'DEV' }
      )
    ).toEqual({ pv: 'DEV:RB', label: 'Device DEV', precision: 3, alarmBorder: true });
  });
});

function screenWithMacros(): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 's',
    metadata: { title: 't', source: { type: 'hand-authored' }, size: { width: 10, height: 10 } },
    macros: [
      { name: 'P', default: 'DEV:1' },
      { name: 'LABEL', default: 'Pump' },
    ],
    root: {
      id: 'w',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 10, height: 10 },
    },
  };
}

describe('resolveScreenMacros', () => {
  it('uses screen-declared defaults', () => {
    expect(resolveScreenMacros(screenWithMacros())).toEqual({ P: 'DEV:1', LABEL: 'Pump' });
  });

  it('lets caller-provided values override defaults and adds undeclared ones', () => {
    expect(resolveScreenMacros(screenWithMacros(), { P: 'DEV:9', EXTRA: 'x' })).toEqual({
      P: 'DEV:9',
      LABEL: 'Pump',
      EXTRA: 'x',
    });
  });
});

describe('childMacros', () => {
  it('resolves the node macro values against the parent, then overrides', () => {
    const parent = { PREFIX: 'DEMO:VAC1', COMMON: 'c' };
    expect(childMacros(parent, { MOTOR: '${PREFIX}:M1', COMMON: 'child' })).toEqual({
      PREFIX: 'DEMO:VAC1',
      COMMON: 'child',
      MOTOR: 'DEMO:VAC1:M1',
    });
  });

  it('passes parent macros through when the node adds none', () => {
    expect(childMacros({ A: '1' }, undefined)).toEqual({ A: '1' });
  });
});
