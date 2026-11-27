// @vitest-environment jsdom
// The right-click menu of a value the screen computes: what it says about the
// inputs without listing them, what it hands to the host, and the window that
// lists the inputs.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { FormulaDeclaration, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import { ScreenRenderer } from './ScreenRenderer.js';
import { ActionHostContext } from '../actions/ActionHostContext.js';
import type { ActionHost } from '../actions/ActionHostContext.js';
import { computedValueOf, namePattern } from './computedMenu.js';

let service: MockPVService;

beforeAll(() => {
  registerBuiltinWidgets();
});

beforeEach(() => {
  service = new MockPVService();
  service.connect();
});

afterEach(() => {
  cleanup();
  service.disconnect();
  vi.restoreAllMocks();
});

function makeHost(extra: Partial<ActionHost> = {}): ActionHost {
  return {
    resolveManifest: () => null,
    navigate: vi.fn(),
    openWindow: vi.fn(),
    close: vi.fn(),
    showError: vi.fn(),
    ...extra,
  };
}

/** A formula over `count` channels `S:M<i>:X`, the mean of their squares. */
function over(name: string, count: number): FormulaDeclaration {
  const tokens = Array.from({ length: count }, (_, i) => `c${i}`);
  return {
    name,
    expression: `(${tokens.map((t) => `{${t}} ** 2`).join(' + ')}) / ${count}`,
    bindings: Object.fromEntries(tokens.map((t, i) => [t, `S:M${i + 1}:X`])),
  };
}

const FORMULAS: FormulaDeclaration[] = [
  over('few', 3),
  over('many', 40),
  { name: 'one', expression: '{v} * 1000', bindings: { v: 'A:RB', unused: 'B:RB' } },
  { name: 'own', expression: '{v} + 0', bindings: { v: 'loc://entry<VString>("")' } },
];

function tile(id: string, formula: string, title?: string): WidgetNode {
  return {
    id,
    type: 'pv-label',
    props: { pv: `formula://${formula}`, ...(title ? { menuTitle: title } : {}) },
    geometry: { x: 10, y: 10, width: 100, height: 30 },
  };
}

function show(children: WidgetNode[], host: ActionHost): ReactNode {
  const doc: ScreenJSON = {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 'top',
    metadata: {
      title: 'top',
      source: { type: 'hand-authored' },
      size: { width: 400, height: 300 },
    },
    macros: [],
    formulas: FORMULAS,
    root: {
      id: 'root',
      type: 'absolute-canvas',
      props: { width: 400, height: 300 },
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children,
    },
  };
  return (
    <PVServiceProvider service={service}>
      <ActionHostContext.Provider value={host}>
        <ScreenRenderer screen={doc} />
      </ActionHostContext.Provider>
    </PVServiceProvider>
  );
}

const wrapper = (id: string) => document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
const item = (name: string | RegExp) => screen.getByRole('menuitem', { name });

describe('namePattern', () => {
  it('writes names that differ in their numbers as one pattern', () => {
    expect(namePattern(['S01:BPM1:X', 'S01:BPM2:X', 'S01:BPM10:X'])).toBe('S01:BPM*:X');
    expect(namePattern(['S01:BPM1:X', 'S02:BPM1:X'])).toBe('S*:BPM1:X');
  });

  it('names the largest family and counts the others', () => {
    expect(namePattern(['A1:T', 'A2:T', 'A3:T', 'B1:P'])).toBe('A*:T and 1 more family');
    expect(namePattern(['A1:T', 'A2:T', 'B1:P', 'C1:Q'])).toBe('A*:T and 2 more families');
  });
});

describe('computedValueOf', () => {
  it('gives the machine channels the formula reads, each once', () => {
    const value = computedValueOf('pv-label', { pv: 'formula://one' }, FORMULAS, {});
    expect(value?.inputs).toEqual(['A:RB']);
    expect(value?.expression).toBe('A:RB * 1000');
  });

  it('is null for a machine channel, an unknown formula and one over screen channels', () => {
    expect(computedValueOf('pv-label', { pv: 'A:RB' }, FORMULAS, {})).toBeNull();
    expect(computedValueOf('pv-label', { pv: 'formula://none' }, FORMULAS, {})).toBeNull();
    expect(computedValueOf('pv-label', { pv: 'formula://own' }, FORMULAS, {})).toBeNull();
  });
});

describe('computed value right-click menu', () => {
  it('names the inputs by count and pattern and does not list them', () => {
    const host = makeHost({ plotPVs: vi.fn() });
    render(show([tile('rms', 'few', 'Orbit X RMS')], host));

    expect(fireEvent.contextMenu(wrapper('rms'))).toBe(false);
    const menu = screen.getByTestId('canopy-computed-menu');
    expect(within(menu).getByText('Orbit X RMS')).toBeTruthy();
    expect(within(menu).getByText(/from 3 PVs/)).toBeTruthy();
    expect(within(menu).getByText('S:M*:X')).toBeTruthy();
    expect(within(menu).queryByText('S:M2:X')).toBeNull();

    fireEvent.click(item('Plot history of the 3 inputs'));
    expect(host.plotPVs).toHaveBeenCalledWith(['S:M1:X', 'S:M2:X', 'S:M3:X']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('has the same entries for many inputs, without the plot of all of them', () => {
    const host = makeHost({ plotPVs: vi.fn() });
    render(show([tile('rms', 'few'), tile('all', 'many')], host));

    fireEvent.contextMenu(wrapper('rms'));
    const few = screen.getAllByRole('menuitem').length;
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.contextMenu(wrapper('all'));
    expect(screen.getAllByRole('menuitem')).toHaveLength(few);
    expect(within(screen.getByRole('menu')).getByText('Computed value')).toBeTruthy();
    expect(item(/Plot history/)).toHaveProperty('disabled', true);
    expect(item('Inputs (40)…')).toBeTruthy();
  });

  it('lists the inputs in a window, with a filter and the channel menu on a row', () => {
    const host = makeHost({ plotPVs: vi.fn() });
    render(show([tile('all', 'many', 'Orbit X RMS')], host));

    fireEvent.contextMenu(wrapper('all'));
    fireEvent.click(item('Inputs (40)…'));
    const panel = screen.getByRole('dialog', { name: 'Inputs of Orbit X RMS' });
    expect(within(panel).getAllByRole('row')).toHaveLength(40);

    fireEvent.change(within(panel).getByPlaceholderText('Filter by name'), {
      target: { value: 'm4' },
    });
    // S:M4:X and S:M40:X.
    expect(within(panel).getAllByRole('row')).toHaveLength(2);
    expect(within(panel).getByText('2 of 40')).toBeTruthy();

    fireEvent.contextMenu(within(panel).getAllByRole('row')[1]!);
    expect(within(screen.getByTestId('canopy-pv-menu-head')).getByText('S:M40:X')).toBeTruthy();
    fireEvent.click(item('Plot history'));
    expect(host.plotPVs).toHaveBeenCalledWith(['S:M40:X']);

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the channel menu itself on a value with one input', () => {
    render(show([tile('conv', 'one')], makeHost()));

    expect(fireEvent.contextMenu(wrapper('conv'))).toBe(false);
    const head = screen.getByTestId('canopy-pv-menu-head');
    expect(within(head).getByText('A:RB')).toBeTruthy();
    expect(within(head).getByText(/shown converted/)).toBeTruthy();
    expect(screen.queryByTestId('canopy-computed-menu')).toBeNull();
  });

  it('keeps the browser menu with Shift and on a formula over screen channels', () => {
    render(show([tile('rms', 'few'), tile('own', 'own')], makeHost()));

    expect(fireEvent.contextMenu(wrapper('rms'), { shiftKey: true })).toBe(true);
    expect(fireEvent.contextMenu(wrapper('own'))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
