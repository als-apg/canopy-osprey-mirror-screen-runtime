// EDM write/state parity for CarbonPVButton: authored press/release values
// reach the control PV, and toggle buttons follow their readback PV.
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry.js';

const puts: Record<string, Array<number | string>> = {};
let pvState: Record<string, { connected: boolean; value: number | string }> = {};

vi.mock('@slaclab/canopy-react', () => ({
  usePV: (address?: string) => ({
    address: address ?? '',
    connected: (address && pvState[address]?.connected) || false,
    value: address ? pvState[address]?.value : undefined,
    displayValue: address ? String(pvState[address]?.value ?? '') : '',
    severity: 0,
    put: (v: number | string) => {
      if (address) (puts[address] ??= []).push(v);
    },
  }),
}));

const { CarbonPVButton } = await import('./CarbonWidgets.js');

afterEach(cleanup);
beforeEach(() => {
  for (const k of Object.keys(puts)) delete puts[k];
  pvState = {};
});

const base: WidgetRendererProps = {
  id: 'w-1',
  layout: { x: 0, y: 0, width: 100, height: 24 },
  props: {},
  isSelected: false,
  isEditing: false,
} as unknown as WidgetRendererProps;

function renderButton(props: Record<string, unknown>) {
  const C = CarbonPVButton as React.FC<WidgetRendererProps>;
  const utils = render(<C {...base} props={props} />);
  return utils.container.querySelector('button') as HTMLButtonElement;
}

describe('CarbonPVButton write values', () => {
  it('writes the authored numeric pressValue on click', () => {
    const btn = renderButton({ controlPV: 'SIM:CMD', pressValue: '2' });
    fireEvent.click(btn);
    expect(puts['SIM:CMD']).toEqual([2]);
  });

  it('writes a non-numeric pressValue as a string (enum-name writes)', () => {
    const btn = renderButton({ controlPV: 'SIM:CMD', pressValue: 'RESET' });
    fireEvent.click(btn);
    expect(puts['SIM:CMD']).toEqual(['RESET']);
  });

  it('writes press on mousedown and release on mouseup when releaseValue is set', () => {
    const btn = renderButton({ controlPV: 'SIM:CMD', pressValue: '1', releaseValue: '0' });
    fireEvent.mouseDown(btn);
    fireEvent.mouseUp(btn);
    expect(puts['SIM:CMD']).toEqual([1, 0]);
  });

  it('defaults to writing 1 when no pressValue is authored', () => {
    const btn = renderButton({ controlPV: 'SIM:CMD' });
    fireEvent.click(btn);
    expect(puts['SIM:CMD']).toEqual([1]);
  });
});

describe('CarbonPVButton toggle + readback', () => {
  it('shows onLabel and writes 0 when the readback reads nonzero', () => {
    pvState['SIM:STATE'] = { connected: true, value: 1 };
    const btn = renderButton({
      controlPV: 'SIM:CTRL',
      readbackPV: 'SIM:STATE',
      buttonType: 'toggle',
      onLabel: 'Enabled',
      offLabel: 'Disabled',
    });
    expect(btn.textContent).toBe('Enabled');
    fireEvent.click(btn);
    expect(puts['SIM:CTRL']).toEqual([0]);
  });

  it('shows offLabel and writes 1 when the readback reads zero', () => {
    pvState['SIM:STATE'] = { connected: true, value: 0 };
    const btn = renderButton({
      controlPV: 'SIM:CTRL',
      readbackPV: 'SIM:STATE',
      buttonType: 'toggle',
      onLabel: 'Enabled',
      offLabel: 'Disabled',
    });
    expect(btn.textContent).toBe('Disabled');
    fireEvent.click(btn);
    expect(puts['SIM:CTRL']).toEqual([1]);
  });
});
