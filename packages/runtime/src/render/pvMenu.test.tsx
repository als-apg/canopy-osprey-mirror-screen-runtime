// @vitest-environment jsdom
// The right-click menu of a node's channels: which channels it offers, what
// its entries hand to the host, and how a node with several channels picks one.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { PropertyValue, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import { ScreenRenderer } from './ScreenRenderer.js';
import { ActionHostContext } from '../actions/ActionHostContext.js';
import type { ActionHost } from '../actions/ActionHostContext.js';
import { pvMenuChannels } from './pvMenu.js';

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

function correlationHost() {
  let x: string | null = null;
  return {
    x: () => x,
    pickX: vi.fn((pv: string) => {
      x = pv;
    }),
    plotY: vi.fn<(pv: string) => void>(),
  };
}

function node(id: string, type: string, props: Record<string, PropertyValue>): WidgetNode {
  return { id, type, props, geometry: { x: 10, y: 10, width: 100, height: 30 } };
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

const CURVES = ['X', 'Y', 'Sum', 'Q', 'Phase'].map((name) => ({
  name,
  y_channel: `BPM:1:${name}`,
}));

describe('pvMenuChannels', () => {
  it('names a channel by what it is to the widget', () => {
    expect(pvMenuChannels('pv-label', { pv: 'A:RB' })).toEqual([
      { name: 'A:RB', label: 'Readback' },
    ]);
    expect(pvMenuChannels('pv-text-input', { pv: 'A:SP' })).toEqual([
      { name: 'A:SP', label: 'Setpoint' },
    ]);
    expect(pvMenuChannels('pv-led', { pv: 'A:ON' })).toEqual([{ name: 'A:ON', label: 'Status' }]);
  });

  it('puts the readback of a button before its command', () => {
    expect(pvMenuChannels('pv-button', { pv: 'A:CMD', readbackPV: 'A:STATE' })).toEqual([
      { name: 'A:STATE', label: 'Readback' },
      { name: 'A:CMD', label: 'Command' },
    ]);
  });

  it('names a plotted channel by its curve', () => {
    expect(pvMenuChannels('waveform-plot', { curves: CURVES }).map((c) => c.label)).toEqual([
      'X',
      'Y',
      'Sum',
      'Q',
      'Phase',
    ]);
  });

  it("leaves out the screen's own channels and lists a repeated one once", () => {
    expect(
      pvMenuChannels('pv-text-input', { pv: 'loc://entry<VString>("")', targetPV: 'A:SP' })
    ).toEqual([{ name: 'A:SP', label: 'Setpoint' }]);
    expect(pvMenuChannels('pv-button', { pv: 'A:CMD', readbackPV: 'A:CMD' })).toHaveLength(1);
    expect(pvMenuChannels('pv-label', { pv: 'formula://sum' })).toEqual([]);
  });
});

describe('channel right-click menu', () => {
  it('shows the channel and copies its name', () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const host = makeHost({ pvInfo: () => ({ description: 'Quadrupole current', alarmHigh: 90 }) });
    render(show([node('rb', 'pv-label', { pv: 'A:RB' })], host));

    expect(fireEvent.contextMenu(wrapper('rb'))).toBe(false);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('A:RB')).toBeTruthy();
    expect(within(menu).getByText('Quadrupole current')).toBeTruthy();
    expect(within(menu).getByText(/alarm above 90/)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();

    fireEvent.click(item('Copy PV name'));
    expect(writeText).toHaveBeenCalledWith('A:RB');
    expect(screen.queryByRole('menu')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('keeps the browser menu with Shift, and on a node with no machine channel', () => {
    render(
      show(
        [
          node('rb', 'pv-label', { pv: 'A:RB' }),
          node('entry', 'pv-text-input', { pv: 'loc://entry<VString>("")' }),
        ],
        makeHost()
      )
    );

    expect(fireEvent.contextMenu(wrapper('rb'), { shiftKey: true })).toBe(true);
    expect(fireEvent.contextMenu(wrapper('entry'))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on an entry field for the channel it will write', () => {
    render(
      show(
        [node('entry', 'pv-text-input', { pv: 'loc://entry<VString>("")', targetPV: 'A:SP' })],
        makeHost()
      )
    );

    expect(fireEvent.contextMenu(wrapper('entry'))).toBe(false);
    expect(within(screen.getByRole('menu')).getByText('A:SP')).toBeTruthy();
  });

  it('hands the channel to the plots', () => {
    const host = makeHost({ plotPVs: vi.fn(), addToPlot: vi.fn(), pvDetails: vi.fn() });
    render(show([node('rb', 'pv-label', { pv: 'A:RB' })], host));

    fireEvent.contextMenu(wrapper('rb'));
    fireEvent.click(item('Plot history'));
    expect(host.plotPVs).toHaveBeenCalledWith(['A:RB']);

    fireEvent.contextMenu(wrapper('rb'));
    fireEvent.click(item('Add to history plot'));
    expect(host.addToPlot).toHaveBeenCalledWith('A:RB');

    fireEvent.contextMenu(wrapper('rb'));
    fireEvent.click(item('PV details…'));
    expect(host.pvDetails).toHaveBeenCalledWith('A:RB');
  });

  it('picks an X on one channel and plots another against it', () => {
    const correlation = correlationHost();
    render(
      show(
        [node('a', 'pv-label', { pv: 'A:RB' }), node('b', 'pv-label', { pv: 'B:RB' })],
        makeHost({ correlation })
      )
    );

    fireEvent.contextMenu(wrapper('a'));
    expect(item(/Correlation: add as Y/)).toHaveProperty('disabled', true);
    fireEvent.click(item(/Correlation: use as X/));
    expect(correlation.pickX).toHaveBeenCalledWith('A:RB');
    // The pick is shown; the menu stays open and its own channel cannot be the Y.
    expect(item(/Correlation: use as X/).textContent).toContain('picked');
    expect(item(/Correlation: add as Y/)).toHaveProperty('disabled', true);
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.contextMenu(wrapper('b'));
    expect(item(/Correlation: plot against/).textContent).toContain('A:RB');
    fireEvent.click(item(/Correlation: plot against/));
    expect(correlation.plotY).toHaveBeenCalledWith('B:RB');
  });

  it('acts on the channel the switcher picks', () => {
    const host = makeHost({ plotPVs: vi.fn() });
    render(show([node('plot', 'waveform-plot', { curves: CURVES })], host));

    fireEvent.contextMenu(wrapper('plot'));
    const tabs = () => screen.getAllByRole('tab');
    // Five channels: two chips and the overflow.
    expect(tabs().map((tab) => tab.textContent)).toEqual(['X', 'Y', '3 more ▾']);
    expect(within(screen.getByTestId('canopy-pv-menu-head')).getByText('BPM:1:X')).toBeTruthy();

    fireEvent.click(tabs()[1]!);
    expect(within(screen.getByTestId('canopy-pv-menu-head')).getByText('BPM:1:Y')).toBeTruthy();

    fireEvent.click(tabs()[2]!);
    fireEvent.click(item(/Phase/));
    expect(tabs()[2]!.textContent).toBe('Phase ▾');
    fireEvent.click(item('Plot history'));
    expect(host.plotPVs).toHaveBeenCalledWith(['BPM:1:Phase']);

    fireEvent.contextMenu(wrapper('plot'));
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(within(screen.getByTestId('canopy-pv-menu-head')).getByText('BPM:1:Phase')).toBeTruthy();
    fireEvent.click(item('Plot history of all 5'));
    expect(host.plotPVs).toHaveBeenLastCalledWith(CURVES.map((curve) => curve.y_channel));
  });
});
