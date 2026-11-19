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
  // jsdom has no layout; the open list scrolls its selected item into view.
  Element.prototype.scrollIntoView = () => {};
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

  it('shows the live value after a choice, not the choice', async () => {
    const view = show({});
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'On' }));
    await act(async () => {});
    expect(runs).toHaveLength(1);
    expect(screen.getByRole('combobox').textContent).toContain('Standby');
    pvState.value = 2;
    view.rerender(<></>);
    cleanup();
    show({});
    expect(screen.getByRole('combobox').textContent).toContain('On');
  });

  it('does not offer an empty string', () => {
    pvState.enumChoices = ['Off', '', 'On', ''];
    pvState.value = 0;
    show({});
    expect(options()).toEqual(['Off', 'On']);
  });

  it('writes the index of a string the channel has twice', async () => {
    pvState.enumChoices = ['Off', 'On', 'Fault', 'On'];
    pvState.value = 0;
    show({});
    fireEvent.click(screen.getByRole('combobox'));
    const twice = screen.getAllByRole('option').filter((o) => o.textContent?.startsWith('On'));
    expect(twice.map((o) => o.textContent)).toEqual(['On (1)', 'On (3)']);
    fireEvent.click(twice[1]!);
    await act(async () => {});
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Fault' }));
    await act(async () => {});
    expect(runs).toEqual([[{ pv: 'SIM:MODE', value: 3 }], [{ pv: 'SIM:MODE', value: 'Fault' }]]);
  });
});

describe('dropdown with nothing to offer', () => {
  for (const [name, props] of [
    ['no items stated', {}],
    ['an empty list stated', { customItems: [] }],
  ] as const) {
    it(`${name}, channel without enum strings: offers nothing and is inert with a reason`, () => {
      pvState = { connected: true, value: 2 };
      const view = show(props);
      const box = screen.getByRole('combobox');
      expect(box.getAttribute('aria-disabled')).toBe('true');
      expect(box.getAttribute('title')).toBe('The channel states no choices');
      fireEvent.click(box);
      expect(screen.queryAllByRole('option')).toEqual([]);
      expect(view.container.textContent).not.toContain('Option');
      expect(runs).toEqual([]);
    });
  }

  it('is inert too when every enum string of the channel is empty', () => {
    pvState = { connected: true, value: 0, enumChoices: ['', ''] };
    show({});
    expect(screen.getByRole('combobox').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('dropdown with stated items', () => {
  it('shows the value as it is, also on a channel with enum strings', () => {
    show({ customItems: ['A', 'B'] });
    expect(screen.getByRole('combobox').textContent).toContain('1');
    expect(screen.getByRole('combobox').textContent).not.toContain('Standby');
    expect(options()).toEqual(['A', 'B']);
  });
});
