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
    // The value that will be sent, not the text as typed.
    expect(input().value).toBe('2.5');
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
    expect(input().value).toBe('2.5');
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
    ['an empty stage', { pvName: 'SIM:SP', stage: '' }, undefined],
    ['a stage that is not a string', { pvName: 'SIM:SP', stage: true }, undefined],
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

  it('a local channel never stages: it is written straight through', async () => {
    pvState['loc://x'] = { connected: true, value: 1 };
    renderEntry({ pvName: 'loc://x', stage: 'view' });
    await enter('2');
    expect(puts).toEqual([['loc://x', 2]]);
    expect(store.list('view')).toEqual([]);
  });
});
