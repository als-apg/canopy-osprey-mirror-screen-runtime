// A stub PVService serves a fixed waveform (MockPVService is random) so the
// plotted-path assertion is deterministic.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { PVData, PVListener, PVService } from '@slaclab/canopy-client';
import { DISCONNECTED_PV } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { ScreenJSON } from '@slaclab/canopy-screen-ir';
import { ScreenRenderer } from './ScreenRenderer.js';

beforeAll(() => registerBuiltinWidgets());
afterEach(() => cleanup());

/** A PVService that serves one fixed waveform array for every subscribed PV. */
class WaveformStubService implements PVService {
  readonly isConnected = true;
  subscribed: string[] = [];
  private wave: number[];
  constructor(wave: number[]) {
    this.wave = wave;
  }
  private data(): PVData {
    return { ...DISCONNECTED_PV, connected: true, value: this.wave };
  }
  subscribe(pvName: string, listener: PVListener): () => void {
    this.subscribed.push(pvName);
    listener(this.data());
    return () => {};
  }
  put(): void {}
  getSnapshot(): PVData | undefined {
    return this.data();
  }
  connect(): void {}
  disconnect(): void {}
}

function screenWithPlot(): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 'plot',
    metadata: { title: 't', source: { type: 'hand-authored' }, size: { width: 400, height: 300 } },
    macros: [],
    root: {
      id: 'root',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children: [
        {
          id: 'w-plot',
          type: 'waveform-plot',
          geometry: { x: 0, y: 0, width: 400, height: 300 },
          props: {
            title: 'AMC ADC',
            curves: [{ y_channel: 'SIM:DEV:WF', color: '#ff0000', name: 'trace' }],
          },
        },
      ],
    },
  } as ScreenJSON;
}

describe('WaveformPlot live data', () => {
  it('subscribes to the curve y_channel and plots the waveform', async () => {
    const service = new WaveformStubService([1, 5, 2, 8, 3, 9, 4]);
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <PVServiceProvider service={service}>
          <ScreenRenderer screen={screenWithPlot()} />
        </PVServiceProvider>
      ));
    });

    expect(service.subscribed).toContain('SIM:DEV:WF');
    expect(container.querySelectorAll('[data-testid="widget-placeholder"]')).toHaveLength(0);
    // A line series draws <path>s once data arrives.
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll('path').length).toBeGreaterThan(0);
  });
});
