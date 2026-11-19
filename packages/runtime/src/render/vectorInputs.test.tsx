// A node fed by a formula over many channels says on hover how many members
// the formula has and which of them have no value: through a rule (a light
// coloured by a roll-up) and through a `formula://` widget channel.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import type {
  FormulaResultMeta,
  FormulaSpec,
  FormulaSubscribeOptions,
  FormulaSubscriber,
} from '../formula.js';
import { FormulaSubscriberContext } from '../formula.js';
import { createFormulaEngineSubscriber } from '../rules/formulaEngineAdapter.js';
import { ScreenRenderer } from './ScreenRenderer.js';
import { vectorInputsText } from './vectorInputs.js';

class Stub implements FormulaSubscriber {
  readonly subscriptions: { spec: FormulaSpec; options: FormulaSubscribeOptions }[] = [];
  subscribe(spec: FormulaSpec, options: FormulaSubscribeOptions): () => void {
    this.subscriptions.push({ spec, options });
    return () => {};
  }
  push(value: number, meta: FormulaResultMeta, index = 0): void {
    act(() => this.subscriptions[index]!.options.onResult(value, meta));
  }
}

const WORST = {
  name: 'worst',
  kind: 'scalar' as const,
  expression: 'max(severity({*}))',
  bindings: { '0': 'RACK:A:PS1', '1': 'RACK:A:PS2', '2': 'RACK:A:FAN' },
};

function doc(children: WidgetNode[]): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 's',
    metadata: { title: 's', source: { type: 'hand-authored' }, size: { width: 400, height: 300 } },
    macros: [],
    formulas: [WORST],
    root: {
      id: 'root',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children,
    },
  };
}

const LIGHT: WidgetNode = {
  id: 'light',
  type: 'rectangle',
  props: { fillColor: '#888888' },
  geometry: { x: 10, y: 10, width: 20, height: 20 },
  rules: [
    {
      id: 'r',
      name: 'state',
      targetProperty: 'fillColor',
      default: '#24a148',
      pvs: [{ name: 'formula://worst', trigger: true }],
      conditions: [{ expression: '{0} >= 2', value: '#da1e28' }],
    },
  ],
} as WidgetNode;

const READOUT: WidgetNode = {
  id: 'readout',
  type: 'pv-label',
  props: { pv: 'formula://worst' },
  geometry: { x: 10, y: 40, width: 120, height: 20 },
};

let pv: MockPVService;
let stub: Stub;

beforeAll(() => registerBuiltinWidgets());
beforeEach(() => {
  pv = new MockPVService();
  pv.connect();
  stub = new Stub();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  pv.disconnect();
  vi.restoreAllMocks();
});

function show(children: WidgetNode[]) {
  const view = render(
    <PVServiceProvider service={pv}>
      <FormulaSubscriberContext.Provider value={stub}>
        <ScreenRenderer screen={doc(children)} />
      </FormulaSubscriberContext.Provider>
    </PVServiceProvider>
  );
  return (id: string) => view.container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
}

describe('vectorInputsText', () => {
  it('says how many channels, and which have no value', () => {
    expect(vectorInputsText({ count: 240, missing: [], more: 0 })).toBe(
      '240 channels, all with a value'
    );
    expect(vectorInputsText({ count: 1, missing: [], more: 0 })).toBe('1 channel, with a value');
    expect(vectorInputsText({ count: 240, missing: ['A:1'], more: 0 })).toBe(
      '240 channels, 1 without a value: A:1'
    );
    expect(vectorInputsText({ count: 240, missing: ['A:1', 'A:2'], more: 28 })).toBe(
      '240 channels, 30 without a value: A:1, A:2 +28 more'
    );
  });
});

describe('a node coloured by a roll-up rule', () => {
  it('has no hover text before a result', () => {
    const node = show([LIGHT]);
    expect(node('light').getAttribute('title')).toBeNull();
    expect(node('light').getAttribute('data-vector-count')).toBeNull();
  });

  it('names the members without a value on hover, and follows the results', () => {
    const node = show([LIGHT]);
    stub.push(0, {
      severity: 'INVALID',
      vectorInputs: { count: 3, missing: ['RACK:A:FAN'], more: 0 },
    });
    expect(node('light').getAttribute('title')).toBe('3 channels, 1 without a value: RACK:A:FAN');
    expect(node('light').getAttribute('data-vector-count')).toBe('3');
    expect(node('light').getAttribute('data-vector-missing')).toBe('1');
    expect(node('light').style.pointerEvents).toBe('auto');

    stub.push(-1, { severity: 'NO_ALARM', vectorInputs: { count: 3, missing: [], more: 0 } });
    expect(node('light').getAttribute('title')).toBe('3 channels, all with a value');
    expect(node('light').getAttribute('data-vector-missing')).toBe('0');
  });

  it('says nothing for a rule whose formula has no vector token', () => {
    const node = show([LIGHT]);
    stub.push(0, { severity: 'MAJOR' });
    expect(node('light').getAttribute('title')).toBeNull();
  });
});

describe('a widget bound to a roll-up formula', () => {
  it('names the members without a value on hover', () => {
    const node = show([READOUT]);
    stub.push(3, {
      severity: 'INVALID',
      vectorInputs: { count: 3, missing: ['RACK:A:PS2', 'RACK:A:FAN'], more: 0 },
    });
    expect(node('readout').getAttribute('title')).toBe(
      '3 channels, 2 without a value: RACK:A:PS2, RACK:A:FAN'
    );
    stub.push(0, { severity: 'NO_ALARM', vectorInputs: { count: 3, missing: [], more: 0 } });
    expect(node('readout').getAttribute('title')).toBe('3 channels, all with a value');
  });

  it('a widget on a plain channel has no such text', () => {
    const node = show([{ ...READOUT, props: { pv: 'SOME:PV' } }]);
    expect(node('readout').getAttribute('title')).toBeNull();
  });
});

describe('the server frame', () => {
  it('hands vectorInputs on as result metadata, and drops what is not of that shape', () => {
    let deliver: ((data: { kind: string; scalar: Record<string, unknown> | null }) => void) | null =
      null;
    const subscriber = createFormulaEngineSubscriber({
      subscribe(_spec, options) {
        deliver = options.onResult as typeof deliver;
        return () => {};
      },
    });
    const metas: (FormulaResultMeta | undefined)[] = [];
    subscriber.subscribe(
      { kind: 'scalar', expression: 'max({*})', bindings: { a: 'A' } },
      { onResult: (_value, meta) => metas.push(meta) }
    );
    const frame = (vectorInputs: unknown) =>
      deliver!({ kind: 'scalar', scalar: { value: 1, severity: 'NO_ALARM', vectorInputs } });
    frame({ count: 3, missing: ['A'], more: 2 });
    frame(undefined);
    frame({ count: '3', missing: [], more: 0 });
    frame({ count: 3, missing: [1], more: 0 });
    expect(metas.map((m) => m?.vectorInputs)).toEqual([
      { count: 3, missing: ['A'], more: 2 },
      undefined,
      undefined,
      undefined,
    ]);
  });
});
