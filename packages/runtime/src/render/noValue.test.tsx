// What a node fed by a formula draws when the formula has no value to give:
// before its first result (the server holds the first result of a roll-up
// until its members have reported), and for a result whose value is null
// (a number that JSON cannot hold). Never an arm of the rule, never the text
// "null", never the value before.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { FormulaDeclaration, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import type { FormulaResultMeta, FormulaSpec, FormulaSubscribeOptions } from '../formula.js';
import { FormulaSubscriberContext } from '../formula.js';
import { createFormulaEngineSubscriber } from '../rules/formulaEngineAdapter.js';
import { ScreenRenderer } from './ScreenRenderer.js';

/** A fake of the SDK's service: frames are pushed as the server sends them. */
class Server {
  readonly subscriptions: { spec: FormulaSpec; onResult: (data: unknown) => void }[] = [];
  subscribe(spec: FormulaSpec, options: { onResult: (data: never) => void }): () => void {
    this.subscriptions.push({ spec, onResult: options.onResult as (data: unknown) => void });
    return () => {};
  }
  frame(value: number | null, extra: Record<string, unknown> = {}, index = 0): void {
    act(() =>
      this.subscriptions[index]!.onResult({
        kind: 'scalar',
        scalar: { tsNs: 1_700_000_000_000_000_000, value, severity: 'NO_ALARM', ...extra },
      })
    );
  }
}

const NEUTRAL = '#8d8d8d';
const OK = '#24a148';
const BAD = '#da1e28';

const FORMULAS: FormulaDeclaration[] = [
  {
    name: 'worst',
    kind: 'scalar' as const,
    expression: 'max(severity({*}))',
    bindings: { '0': 'RACK:A:PS1', '1': 'RACK:A:PS2' },
  },
  {
    name: 'ratio',
    kind: 'scalar' as const,
    expression: '{a} / {b}',
    bindings: { a: 'RACK:A:U', b: 'RACK:A:I' },
  },
];

const LIGHT = {
  id: 'light',
  type: 'rectangle',
  props: { fill: true, fillColor: NEUTRAL },
  geometry: { x: 10, y: 10, width: 20, height: 20 },
  rules: [
    {
      id: 'r',
      name: 'state',
      targetProperty: 'fillColor',
      default: OK,
      pvs: [{ name: 'formula://worst', trigger: true }],
      conditions: [{ expression: '{0} >= 2', value: BAD }],
    },
  ],
} as WidgetNode;

const BAR = {
  id: 'bar',
  type: 'rectangle',
  props: { fill: true, fillColor: NEUTRAL },
  geometry: { x: 40, y: 10, width: 50, height: 20 },
  rules: [{ id: 'w', name: 'width', targetProperty: 'width', formula: 'formula://ratio' }],
} as unknown as WidgetNode;

const READOUT: WidgetNode = {
  id: 'readout',
  type: 'pv-label',
  props: { pv: 'formula://ratio' },
  geometry: { x: 10, y: 40, width: 120, height: 20 },
};

function doc(children: WidgetNode[]): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 's',
    metadata: { title: 's', source: { type: 'hand-authored' }, size: { width: 400, height: 300 } },
    macros: [],
    formulas: FORMULAS,
    root: {
      id: 'root',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children,
    },
  };
}

let pv: MockPVService;
let server: Server;

beforeAll(() => registerBuiltinWidgets());
beforeEach(() => {
  pv = new MockPVService();
  pv.connect();
  server = new Server();
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
      <FormulaSubscriberContext.Provider value={createFormulaEngineSubscriber(server)}>
        <ScreenRenderer screen={doc(children)} />
      </FormulaSubscriberContext.Provider>
    </PVServiceProvider>
  );
  return (id: string) => view.container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
}

const fill = (node: HTMLElement) =>
  (node.firstElementChild as HTMLElement).style.backgroundColor.replace(/\s/g, '');
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')})`;

describe('a roll-up light before its first result', () => {
  it('draws its own colour: not the OK arm, not the worst arm', () => {
    const node = show([LIGHT]);
    expect(fill(node('light'))).toBe(rgb(NEUTRAL));
    expect(node('light').getAttribute('data-pv-state')).toBe('pending');
    expect(node('light').getAttribute('title')).toBeNull();
  });

  it('takes the arm of the first result when it comes', () => {
    const node = show([LIGHT]);
    // A ladder answers the index of its arm; -1 is the default.
    server.frame(-1, { vectorInputs: { count: 2, missing: [], more: 0 } });
    expect(fill(node('light'))).toBe(rgb(OK));
    expect(node('light').getAttribute('data-pv-state')).toBe('connected');
  });
});

describe('a result whose value is null', () => {
  it('a ladder rule gives no output: its colour is the no-state colour', () => {
    const node = show([LIGHT]);
    server.frame(0, { severity: 'INVALID' });
    expect(fill(node('light'))).toBe(rgb(BAD));
    server.frame(null, { severity: 'INVALID' });
    expect(fill(node('light'))).toBe('var(--pydm-alarm-disconnected)');
    server.frame(-1);
    expect(fill(node('light'))).toBe(rgb(OK));
  });

  it('a formula-arm rule gives no output: the node keeps its authored size', () => {
    const node = show([BAR]);
    server.frame(80);
    expect(node('bar').style.width).toBe('80px');
    server.frame(null);
    expect(node('bar').style.width).toBe('50px');
  });

  it('a readout shows no value: not the text "null", not the value before', () => {
    const node = show([READOUT]);
    server.frame(5);
    expect(node('readout').textContent).toContain('5');
    server.frame(null, { severity: 'MAJOR' });
    expect(node('readout').textContent).not.toContain('null');
    expect(node('readout').textContent).not.toContain('5');
    // Drawn as a channel without a value is.
    expect(node('readout').getAttribute('data-pv-state')).toBe('disconnected');
    server.frame(7);
    expect(node('readout').textContent).toContain('7');
  });

  it('keeps the severity of the inputs and the members summary', () => {
    const metas: (FormulaResultMeta | undefined)[] = [];
    const options: FormulaSubscribeOptions = {
      onResult: () => {
        throw new Error('a null value is no result');
      },
      onNoValue: (meta) => metas.push(meta),
    };
    createFormulaEngineSubscriber(server).subscribe(
      { kind: 'scalar', expression: 'max({*})', bindings: { a: 'A' } },
      options
    );
    server.frame(null, {
      severity: 'MAJOR',
      vectorInputs: { count: 1, missing: [], more: 0 },
    });
    expect(metas).toEqual([
      {
        severity: 'MAJOR',
        timestampMs: 1_700_000_000_000,
        vectorInputs: { count: 1, missing: [], more: 0 },
      },
    ]);
  });
});
