// A text entry with a `stage` scope: Enter stages the value and writes
// nothing, the field shows the staged value until it is dropped, and an entry
// without the prop (or without a store) writes exactly as before.
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry.js';
import type { WriteGateService, WriteRequest } from '../writeGate/types.js';
import type { StagingStore } from '../staging/staging.js';

const puts: Array<[string, unknown]> = [];
let pvState: Record<string, { connected: boolean; value: number | string }> = {};

vi.mock('@slaclab/canopy-react', () => ({
  usePV: (address?: string) => ({
    address: address ?? '',
    connected: (address && pvState[address]?.connected) || false,
    value: address ? pvState[address]?.value : undefined,
    displayValue: address ? String(pvState[address]?.value ?? '') : '',
    severity: 0,
    precision: 0,
    put: (v: unknown) => {
      if (address) puts.push([address, v]);
    },
  }),
}));

const W = await import('./CarbonWidgets.js');
const { WriteGate } = await import('../writeGate/WriteGate.js');
const { Staging, createStagingStore } = await import('../staging/staging.js');

let runs: WriteRequest[][] = [];
const gate: WriteGateService = {
  confirmWrites: () => false,
  run: async (writes) => {
    runs.push([...writes]);
    return writes.map(() => ({
      outcome: 'confirmed' as const,
      code: null,
      status: null,
      detail: 'written',
      coalesced: false,
    }));
  },
};

let store: StagingStore;

beforeEach(() => {
  puts.length = 0;
  pvState = { 'SIM:SP': { connected: true, value: 1 }, 'SIM:TXT': { connected: true, value: 'a' } };
  runs = [];
  store = createStagingStore();
});
afterEach(cleanup);

const base = {
  id: 'w-1',
  layout: { x: 0, y: 0, width: 200, height: 32 },
  isSelected: false,
  isEditing: false,
} as unknown as WidgetRendererProps;

function renderEntry(props: Record<string, unknown>, staging: StagingStore | null = store) {
  const Comp = W.CarbonPVTextInput as React.FC<WidgetRendererProps>;
  return render(
    <WriteGate.Provider value={gate}>
      <Staging.Provider value={staging}>
        <Comp {...base} props={props} />
      </Staging.Provider>
    </WriteGate.Provider>
  );
}

const input = () => document.querySelector('input') as HTMLInputElement;
const box = () => document.querySelector('.carbon-pv-input') as HTMLElement;
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function enter(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: 'Enter' });
  await flush();
}

describe('a staging text entry', () => {
  it('Enter stages the parsed value and writes nothing', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('2.50');
    expect(store.list('view')).toEqual([{ pv: 'SIM:SP', value: 2.5, entered: '2.50' }]);
    expect(runs).toEqual([]);
    expect(puts).toEqual([]);
  });

  it('shows the staged value, marked, in place of the live one', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    expect(input().value).toBe('1');
    expect(box().getAttribute('data-staged')).toBeNull();
    await enter('2.50');
    // The value that will be sent, with the decimals as typed.
    expect(input().value).toBe('2.50');
    expect(box().getAttribute('data-staged')).toBe('true');
    expect(box().classList.contains('carbon-pv-input--staged')).toBe(true);
  });

  it('returns to the live value when the store drops the staged one', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('2.50');
    act(() => store.clearScope('view'));
    expect(input().value).toBe('1');
    expect(box().getAttribute('data-staged')).toBeNull();
  });

  it('Escape drops the text being entered first, then the staged value', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('2.50');
    fireEvent.change(input(), { target: { value: '9' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('2.50');
    expect(store.list('view')).toHaveLength(1);
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(store.list('view')).toEqual([]);
    expect(input().value).toBe('1');
    expect(runs).toEqual([]);
  });

  it('stages nothing for a number it cannot parse', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('abc');
    expect(store.list('view')).toEqual([]);
    expect(runs).toEqual([]);
  });

  it('stages the text of a text channel', async () => {
    renderEntry({ pvName: 'SIM:TXT', stage: 'view' });
    await enter('hello');
    expect(store.list('view')).toEqual([{ pv: 'SIM:TXT', value: 'hello', entered: 'hello' }]);
  });

  it('leaving the field with typed text stages it', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    fireEvent.change(input(), { target: { value: '3' } });
    fireEvent.blur(input());
    await flush();
    expect(store.list('view')).toEqual([{ pv: 'SIM:SP', value: 3, entered: '3' }]);
    expect(runs).toEqual([]);
  });

  it('shows what a text channel will be sent when the text starts with a number', async () => {
    renderEntry({ pvName: 'SIM:TXT', stage: 'view' });
    await enter('12abc');
    expect(store.list('view')).toEqual([{ pv: 'SIM:TXT', value: 12, entered: '12abc' }]);
    expect(input().value).toBe('12');
  });

  it('drops its staged value when it unmounts', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('4');
    expect(store.count('view')).toBe(1);
    cleanup();
    expect(store.count('view')).toBe(0);
  });

  it('drops its staged value when its channel changes', async () => {
    pvState['SIM:OTHER'] = { connected: true, value: 7 };
    const view = renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('4');
    const Comp = W.CarbonPVTextInput as React.FC<WidgetRendererProps>;
    view.rerender(
      <WriteGate.Provider value={gate}>
        <Staging.Provider value={store}>
          <Comp {...base} props={{ pvName: 'SIM:OTHER', stage: 'view' }} />
        </Staging.Provider>
      </WriteGate.Provider>
    );
    await flush();
    expect(store.list('view')).toEqual([]);
    expect(input().value).toBe('7');
  });

  it('drops its staged value when its scope changes', async () => {
    const view = renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('4');
    const Comp = W.CarbonPVTextInput as React.FC<WidgetRendererProps>;
    view.rerender(
      <WriteGate.Provider value={gate}>
        <Staging.Provider value={store}>
          <Comp {...base} props={{ pvName: 'SIM:SP', stage: 'other' }} />
        </Staging.Provider>
      </WriteGate.Provider>
    );
    await flush();
    expect(store.count('view')).toBe(0);
    expect(store.count('other')).toBe(0);
  });
});

describe('an entry that does not stage writes as before', () => {
  for (const [name, props, staging] of [
    ['no stage prop', { pvName: 'SIM:SP' }, undefined],
  ] as const) {
    it(`${name}: Enter is one gate run`, async () => {
      renderEntry(props, staging === null ? null : store);
      await enter('2.5');
      expect(runs).toEqual([[{ pv: 'SIM:SP', value: 2.5, entered: '2.5' }]]);
      expect(store.list('view')).toEqual([]);
      expect(box().getAttribute('data-staged')).toBeNull();
    });
  }

  it('with a stage and no staging store it writes nothing and says why', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' }, null);
    expect(input().getAttribute('aria-disabled')).toBe('true');
    expect(input().getAttribute('title')).toContain('staging is not available');
    expect(input().readOnly).toBe(true);
    await enter('2.5');
    fireEvent.blur(input());
    await flush();
    expect(runs).toEqual([]);
    expect(puts).toEqual([]);
    expect(input().value).toBe('1');
  });

  for (const stage of ['', true, 0]) {
    it(`a stage that names no scope (${JSON.stringify(stage)}) writes nothing and says why`, async () => {
      renderEntry({ pvName: 'SIM:SP', stage });
      expect(input().getAttribute('aria-disabled')).toBe('true');
      expect(input().getAttribute('title')).toContain('names no scope');
      await enter('2.5');
      fireEvent.blur(input());
      await flush();
      expect(runs).toEqual([]);
      expect(puts).toEqual([]);
      expect(store.count('')).toBe(0);
    });
  }

  it('a local channel never stages: it is written straight through', async () => {
    pvState['loc://x'] = { connected: true, value: 1 };
    renderEntry({ pvName: 'loc://x', stage: 'view' });
    await enter('2');
    expect(puts).toEqual([['loc://x', 2]]);
    expect(store.list('view')).toEqual([]);
  });
});

describe('arrow keys on a staged value', () => {
  const up = (shift = false) => fireEvent.keyDown(input(), { key: 'ArrowUp', shiftKey: shift });

  it('step by the last digit the operator typed', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('2.50');
    up();
    expect(input().value).toBe('2.51');
    up(true);
    expect(input().value).toBe('2.61');
  });

  it('a value typed with an exponent is shown and stepped without one', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('1e-7');
    expect(input().value).toBe('0.0000001');
    up();
    expect(input().value).toBe('0.0000002');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await flush();
    expect(store.list('view')[0].value).toBeCloseTo(2e-7, 15);
    expect(input().value).not.toMatch(/e/i);
  });

  it('a value typed another way takes the precision of the widget', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view', precision: 3, precisionFromPV: false });
    await enter('0x10');
    expect(input().value).toBe('16.000');
    up();
    expect(input().value).toBe('16.001');
  });
});

describe('while a run writes the scope', () => {
  it('an entry holding a staged value is locked: no edit, no Escape, shown busy', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('2.50');
    let end = () => {};
    act(() => {
      end = store.begin('view');
    });
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(input().readOnly).toBe(true);
    expect(input().getAttribute('title')).toBe('its staged value is being written');
    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.change(input(), { target: { value: '9' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await flush();
    expect(store.list('view')).toEqual([{ pv: 'SIM:SP', value: 2.5, entered: '2.50' }]);
    expect(input().value).toBe('2.50');
    act(() => end());
    expect(box().getAttribute('aria-busy')).toBeNull();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(store.count('view')).toBe(0);
  });

  it('an entry with nothing staged stays usable', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    act(() => void store.begin('view'));
    expect(input().readOnly).toBe(false);
    await enter('3');
    expect(store.count('view')).toBe(1);
  });
});

describe('Escape in an entry of a screen that embeds others', () => {
  it("drops this instance's value only", async () => {
    const below = createStagingStore(store);
    below.link();
    below.attach('view', 'SIM:SP');
    below.set('view', { pv: 'SIM:SP', value: 8 });
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('2');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(store.list('view')).toEqual([{ pv: 'SIM:SP', value: 8 }]);
  });
});

describe('a staged value shown with an exponent', () => {
  it('is the exact value, and steps by the precision of the widget', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view', precision: 2, precisionFromPV: false });
    await enter('1e-101');
    expect(input().value).toBe('1e-101');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().value).toBe('0.01');
  });

  it('with no precision steps by one', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('1.5e300');
    expect(input().value).toBe('1.5e+300');
    expect(Number(input().value)).toBe(1.5e300);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(Number(input().value)).toBe(1.5e300 - 1);
  });
});

describe('a staged value marked as in conflict', () => {
  it('is drawn as such until the channel is staged again', async () => {
    renderEntry({ pvName: 'SIM:SP', stage: 'view' });
    await enter('2');
    act(() => store.mark([store.get('view', 'SIM:SP')!]));
    expect(box().getAttribute('data-staged-conflict')).toBe('true');
    expect(box().classList.contains('carbon-pv-input--conflict')).toBe(true);
    expect(box().getAttribute('title')).toContain('different value');
    await enter('3');
    expect(box().getAttribute('data-staged-conflict')).toBeNull();
  });
});
