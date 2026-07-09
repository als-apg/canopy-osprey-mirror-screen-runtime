// Generation-direction tests. The builder's round-trip suite (generateTSX ↔
// parseTSX) stays in the builder with parseTSX; here we pin what THIS package
// owns: the emitted import paths, the meta block, formula emission, and the
// overall file shape.

import { describe, expect, it } from 'vitest';
import type { FormulaDeclaration } from '@slaclab/canopy-screen-ir';
import { generateTSX } from './generateTSX.js';
import type { Widget } from './model.js';
import { createDefaultScreen } from './model.js';

function widget(partial: Partial<Widget> & Pick<Widget, 'id' | 'type'>): Widget {
  return {
    layout: { x: 0, y: 0, width: 100, height: 30 },
    props: {},
    zIndex: 0,
    visible: true,
    rotation: 0,
    ...partial,
  };
}

describe('generateTSX — emitted import paths', () => {
  it('emits @slaclab imports: usePV, runtime Screen/ScreenProps, unified widgets', () => {
    const screen = createDefaultScreen();
    screen.widgets['w1'] = widget({
      id: 'w1',
      type: 'PVTextDisplay',
      props: { pvName: 'DEV:RB' },
    });
    screen.widgets['w2'] = widget({ id: 'w2', type: 'Rectangle', zIndex: 1 });
    screen.widgets['w3'] = widget({ id: 'w3', type: 'PVLed', zIndex: 2 });
    screen.rootWidgetIds = ['w1', 'w2', 'w3'];

    const tsx = generateTSX(screen);
    const lines = tsx.split('\n');

    expect(lines[0]).toBe(`import { usePV } from '@slaclab/canopy-react';`);
    expect(lines[1]).toBe(`import type { ScreenProps } from '@slaclab/canopy-screen-runtime';`);
    expect(lines[2]).toBe(`import { Screen } from '@slaclab/canopy-screen-runtime';`);
    expect(lines[3]).toBe(
      `import { PVTextDisplay, PVLed, Rectangle } from '@slaclab/canopy-screen-widgets';`
    );
    // No stale placeholder module names anywhere.
    expect(tsx).not.toContain('@pydm/');
    expect(tsx).not.toContain('@canopy/');
  });

  it('omits the usePV import when no widget binds a PV', () => {
    const screen = createDefaultScreen();
    screen.widgets['w1'] = widget({ id: 'w1', type: 'StaticLabel', props: { text: 'hi' } });
    screen.rootWidgetIds = ['w1'];

    const tsx = generateTSX(screen);
    expect(tsx).not.toContain('usePV');
    expect(tsx).toContain(`import { StaticLabel } from '@slaclab/canopy-screen-widgets';`);
  });
});

describe('generateTSX — formulas (generation direction of the builder round-trip suite)', () => {
  it('emits screen-level formulas as JSON in the meta block', () => {
    const formulas: FormulaDeclaration[] = [
      { name: 'sum', kind: 'scalar', expression: 'A+B', bindings: { A: 'X:VAL', B: 'Y:VAL' } },
      { name: 'avg', kind: 'scalar', expression: '(A+B)/2', bindings: { A: 'X', B: 'Y' } },
    ];
    const screen = createDefaultScreen();
    screen.meta.formulas = formulas;
    screen.meta.macros = { P: 'DEV' };

    const tsx = generateTSX(screen);
    expect(tsx).toContain('formulas:');
    expect(tsx).toContain(JSON.stringify(formulas));
    expect(tsx).toContain(`macros: { P: 'DEV' }`);
  });

  it('omits the formulas line when there are none', () => {
    const tsx = generateTSX(createDefaultScreen());
    expect(tsx).not.toContain('formulas:');
  });
});

describe('generateTSX — golden file', () => {
  it('generates the exact file for a small screen with nesting', () => {
    const screen = createDefaultScreen();
    screen.meta.title = 'Pump Panel';
    screen.meta.macros = { P: 'DEV:1' };
    screen.widgets['g1'] = widget({
      id: 'g1',
      type: 'Group',
      layout: { x: 10, y: 10, width: 200, height: 100 },
      children: ['w1'],
    });
    screen.widgets['w1'] = widget({
      id: 'w1',
      type: 'Rectangle',
      layout: { x: 20, y: 20, width: 120, height: 24 },
    });
    screen.rootWidgetIds = ['g1'];

    expect(generateTSX(screen))
      .toBe(`import type { ScreenProps } from '@slaclab/canopy-screen-runtime';
import { Screen } from '@slaclab/canopy-screen-runtime';
import { Rectangle, Group } from '@slaclab/canopy-screen-widgets';

const screenMeta = {
  title: 'Pump Panel',
  width: 800,
  height: 600,
  backgroundColor: '#262626',
  macros: { P: 'DEV:1' },
} satisfies ScreenProps;

export default function PumpPanel({ macros }: { macros?: Record<string, string> }) {
  return (
    <Screen meta={screenMeta} macros={macros}>
      <Group x={10} y={10} w={200} h={100}>
        <Rectangle x={20} y={20} w={120} h={24} />
      </Group>
    </Screen>
  );
}
`);
  });

  it('switches to one-prop-per-line beyond four props and emits pv=', () => {
    const screen = createDefaultScreen();
    screen.widgets['w1'] = widget({
      id: 'w1',
      type: 'PVTextDisplay',
      layout: { x: 20, y: 20, width: 120, height: 24 },
      props: { pvName: '${P}:RB', precision: 2 },
    });
    screen.rootWidgetIds = ['w1'];

    const tsx = generateTSX(screen);
    expect(tsx).toContain('pv="${P}:RB"');
    expect(tsx).toContain('precision={2}');
    expect(tsx).toContain('<PVTextDisplay\n');
  });
});
