// The dropdown of a channel with enum strings: when the screen states no
// items it offers the channel's own strings, shows the string of the live
// value, and writes the string chosen.
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry.js';
import type { WriteGateService, WriteRequest } from '../writeGate/types.js';

let pvState: { connected: boolean; value: number | string; enumChoices?: string[] };

vi.mock('@slaclab/canopy-react', () => ({
  usePV: (address?: string) => ({
    address: address ?? '',
    connected: pvState.connected,
    value: pvState.value,
    displayValue: String(pvState.value),
    enumChoices: pvState.enumChoices,
    severity: 0,
    precision: 0,
    put: () => {
      throw new Error('a write must go through the gate');
    },
  }),
}));

const W = await import('./CarbonWidgets.js');
const { WriteGate } = await import('../writeGate/WriteGate.js');

let runs: WriteRequest[][] = [];
const gate: WriteGateService = {
  confirmWrites: () => false,
  run: async (writes) => {
    runs.push([...writes]);
    return writes.map(() => ({
      outcome: 'confirmed' as const,
      code: null,
      status: null,
      detail: '',
      coalesced: false,
    }));
  },
};

function show(props: Record<string, unknown>) {
  const Dropdown = W.CarbonPVDropdown as React.FC<WidgetRendererProps>;
  return render(
    <WriteGate.Provider value={gate}>
      <Dropdown
        id="d"
        type="PVDropdown"
        layout={{ x: 0, y: 0, width: 160, height: 32 }}
        props={{ pvName: 'SIM:MODE', ...props }}
        isSelected={false}
        isEditing={false}
      />
    </WriteGate.Provider>
  );
}

const options = () => {
  fireEvent.click(screen.getByRole('combobox'));
  return screen.getAllByRole('option').map((o) => o.textContent);
};

beforeEach(() => {
  runs = [];
  pvState = { connected: true, value: 1, enumChoices: ['Off', 'Standby', 'On'] };
});
afterEach(cleanup);

describe('dropdown of an enum channel', () => {
  it('offers the strings of the channel when the screen states no items', () => {
    show({});
    expect(options()).toEqual(['Off', 'Standby', 'On']);
  });

  it('shows the string of the live value, given as index or as string', () => {
    show({});
    expect(screen.getByRole('combobox').textContent).toContain('Standby');
    cleanup();
    pvState.value = 'On';
    show({});
    expect(screen.getByRole('combobox').textContent).toContain('On');
  });

  it('writes the string chosen, through the gate', async () => {
    show({});
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'On' }));
    await act(async () => {});
    expect(runs).toEqual([[{ pv: 'SIM:MODE', value: 'On' }]]);
  });

  it('keeps the items the screen states', () => {
    show({ customItems: ['A', 'B'] });
    expect(options()).toEqual(['A', 'B']);
  });

  it('takes the strings of the channel when the screen states an empty list', () => {
    show({ customItems: [] });
    expect(options()).toEqual(['Off', 'Standby', 'On']);
  });

  it('shows the value as it is for an index the channel has no string for', () => {
    pvState.value = 7;
    show({});
    expect(screen.getByRole('combobox').textContent).toContain('7');
  });

  it('keeps the placeholder items of a channel without enum strings', () => {
    pvState = { connected: true, value: 2 };
    show({});
    expect(screen.getByRole('combobox').textContent).toContain('2');
    expect(options()).toEqual(['Option 1', 'Option 2', 'Option 3']);
  });
});
