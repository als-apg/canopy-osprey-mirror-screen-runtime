// A node whose formula failed, or never answered, shows that it has no
// state: no arm of its rule, the cue, and a hover that says what failed.
// It never keeps the colour or the members summary of the result before.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { FormulaDeclaration, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import type {
  FormulaResultMeta,
  FormulaSpec,
  FormulaSubscribeOptions,
  FormulaSubscriber,
} from '../formula.js';
import {
  combineVectorInputs,
  FormulaError,
  FormulaSubscriberContext,
  formulaStartTimeoutMs,
  setFormulaStartTimeoutMs,
} from '../formula.js';
import { ScreenRenderer } from './ScreenRenderer.js';

class Stub implements FormulaSubscriber {
  readonly subscriptions: { spec: FormulaSpec; options: FormulaSubscribeOptions }[] = [];
  subscribe(spec: FormulaSpec, options: FormulaSubscribeOptions): () => void {
    this.subscriptions.push({ spec, options });
    return () => {};
  }
  result(value: number, meta: FormulaResultMeta = { severity: 'NO_ALARM' }, index = 0): void {
    act(() => this.subscriptions[index]!.options.onResult(value, meta));
  }
  error(code: string, message: string, retryable: boolean, index = 0): void {
    act(() =>
      this.subscriptions[index]!.options.onError?.(new FormulaError(code, message, retryable))
    );
  }
}

const NEUTRAL = '#8d8d8d';
const OK = '#24a148';
const BAD = '#da1e28';
/** The viewer's own colour of a node without a state: the token of the disconnected look. */
const NO_STATE = 'var(--pydm-alarm-disconnected)';
const SUMMARY = { count: 2, missing: [], more: 0 };

const FORMULAS: FormulaDeclaration[] = [
  {
    name: 'worst',
    kind: 'scalar',
    expression: 'max(severity({*}))',
    bindings: { '0': 'RACK:A:PS1', '1': 'RACK:A:PS2' },
  },
];

function light(id: string, x: number, extra: Record<string, unknown> = {}): WidgetNode {
  return {
    id,
    type: 'rectangle',
    props: { fill: true, fillColor: NEUTRAL, ...extra },
    geometry: { x, y: 10, width: 20, height: 20 },
    rules: [
      {
        id: `${id}-r`,
        name: 'state',
        targetProperty: 'fillColor',
        default: OK,
        pvs: [{ name: 'formula://worst', trigger: true }],
        conditions: [{ expression: '{0} >= 2', value: BAD }],
      },
    ],
  } as WidgetNode;
}
const LIGHT = light('light', 10);
/** A light that takes the pointer: it opens something on a click. */
const BUTTON = light('light', 10, { actions: [{ type: 'open_screen', ref: 'x' }] });
const READOUT: WidgetNode = {
  id: 'readout',
  type: 'pv-label',
  props: { pv: 'formula://worst' },
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
  vi.useRealTimers();
  setFormulaStartTimeoutMs(3000);
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

const fill = (node: HTMLElement) =>
  (node.firstElementChild as HTMLElement).style.backgroundColor.replace(/\s/g, '');
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')})`;

describe('a rule whose formula fails after a result', () => {
  for (const retryable of [true, false]) {
    it(`drops its arm, draws the cue and says what failed (retryable: ${retryable})`, () => {
      const node = show([BUTTON]);
      stub.result(-1, { severity: 'NO_ALARM', vectorInputs: SUMMARY });
      expect(fill(node('light'))).toBe(rgb(OK));
      expect(node('light').getAttribute('data-pv-state')).toBe('connected');
      expect(node('light').getAttribute('title')).toBe('2 channels, all with a value');

      stub.error('formula_type_error', 'The result is not a finite number (nan)', retryable);
      expect(fill(node('light'))).toBe(NO_STATE);
      expect(node('light').getAttribute('data-pv-state')).toBe('disconnected');
      expect(node('light').style.outline).toContain('dashed');
      expect(node('light').getAttribute('title')).toBe(
        'formula_type_error: The result is not a finite number (nan)'
      );
      expect(node('light').getAttribute('data-vector-count')).toBeNull();

      stub.result(0, { severity: 'MAJOR', vectorInputs: SUMMARY });
      expect(fill(node('light'))).toBe(rgb(BAD));
      expect(node('light').getAttribute('data-pv-state')).toBe('connected');
      expect(node('light').getAttribute('title')).toBe('2 channels, all with a value');
    });
  }

  it('names the members the error names', () => {
    const node = show([BUTTON]);
    stub.error('formula_input_missing', "PVs not available: ['RACK:A:PS2'] and 3 more", true);
    expect(node('light').getAttribute('title')).toBe(
      "formula_input_missing: PVs not available: ['RACK:A:PS2'] and 3 more"
    );
  });

  it('a lost connection of the formula service ends the state at once', () => {
    const node = show([BUTTON]);
    stub.result(-1);
    stub.error('ws_disconnected', 'Formula connection lost.', true);
    expect(fill(node('light'))).toBe(NO_STATE);
    expect(node('light').getAttribute('data-pv-state')).toBe('disconnected');
    expect(node('light').getAttribute('title')).toBe('ws_disconnected: Formula connection lost.');
  });
});

describe('a rule whose formula never answers', () => {
  it('is pending for the start timeout, then has no state and says so', () => {
    vi.useFakeTimers();
    expect(formulaStartTimeoutMs()).toBe(3000);
    const node = show([BUTTON]);
    act(() => void vi.advanceTimersByTime(2999));
    expect(node('light').getAttribute('data-pv-state')).toBe('pending');
    expect(fill(node('light'))).toBe(rgb(NEUTRAL));
    expect(node('light').getAttribute('title')).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(node('light').getAttribute('data-pv-state')).toBe('disconnected');
    expect(node('light').style.outline).toContain('dashed');
    expect(node('light').getAttribute('title')).toBe('no answer from the formula service');
    expect(fill(node('light'))).toBe(NO_STATE);

    stub.result(-1);
    expect(fill(node('light'))).toBe(rgb(OK));
    expect(node('light').getAttribute('title')).toBeNull();
  });

  it('a result, a null value or an error within the timeout ends the wait', () => {
    vi.useFakeTimers();
    setFormulaStartTimeoutMs(500);
    const node = show([BUTTON]);
    stub.result(-1);
    act(() => void vi.advanceTimersByTime(5000));
    expect(node('light').getAttribute('data-pv-state')).toBe('connected');
    expect(node('light').getAttribute('title')).toBeNull();
  });
});

describe('the colour of a node without a state', () => {
  it('does not depend on the colour the screen authored', () => {
    // A screen that authored the OK colour as the base must not look OK.
    const green = light('light', 10, { fillColor: OK });
    const node = show([green]);
    expect(fill(node('light'))).toBe(rgb(OK));
    stub.error('formula_type_error', 'no', false);
    expect(fill(node('light'))).toBe(NO_STATE);
    expect(node('light').style.outline).toContain('dashed');
  });

  it('is drawn on every colour property a failed rule drives, and on no other property', () => {
    const rule = BUTTON.rules![0]!;
    const many = {
      ...light('light', 10, { lineColor: '#000000', lineWidth: 2 }),
      rules: [
        rule,
        { ...rule, id: 'line', targetProperty: 'lineColor' },
        {
          ...rule,
          id: 'width',
          targetProperty: 'lineWidth',
          default: 4,
          conditions: [{ expression: '{0} >= 2', value: 6 }],
        },
      ],
    } as WidgetNode;
    const node = show([many]);
    for (const index of [0, 1, 2]) stub.error('formula_type_error', 'no', false, index);
    const shape = node('light').firstElementChild as HTMLElement;
    expect(shape.style.backgroundColor).toBe(NO_STATE);
    // The width's rule has no output: the authored width stays.
    expect(shape.getAttribute('style')).toContain(`border: 2px solid ${NO_STATE}`);
  });

  it('a result without a value has no state to show either', () => {
    const node = show([light('light', 10, { fillColor: OK })]);
    stub.result(-1);
    act(() => stub.subscriptions[0]!.options.onNoValue?.({ severity: 'INVALID' }));
    expect(fill(node('light'))).toBe(NO_STATE);
    expect(node('light').getAttribute('data-pv-state')).toBe('disconnected');
    expect(node('light').style.outline).toContain('dashed');
    stub.result(-1);
    expect(fill(node('light'))).toBe(rgb(OK));
  });

  it('the cue stands out from the no-state fill: another theme colour', () => {
    const node = show([LIGHT]);
    stub.error('formula_type_error', 'no', false);
    const cue = node('light').style.outline;
    expect(cue).toContain('dashed');
    expect(cue).not.toContain('--pydm-alarm-disconnected');
    // The theme's text colour, in both modes.
    expect(cue).toMatch(/var\(--cr-\d+|light-dark\(/);
    expect(fill(node('light'))).toBe(NO_STATE);
  });
});

describe('text on a ruled background, both without a state', () => {
  it('stays readable: the background is the no-state colour, the text the theme text colour', () => {
    const rule = BUTTON.rules![0]!;
    const label = {
      id: 'label',
      type: 'text-label',
      props: { text: 'Rack A', foregroundColor: OK, backgroundColor: OK },
      geometry: { x: 10, y: 10, width: 80, height: 20 },
      rules: [
        { ...rule, id: 'fg', targetProperty: 'foregroundColor' },
        { ...rule, id: 'bg', targetProperty: 'backgroundColor' },
      ],
    } as WidgetNode;
    const node = show([label]);
    stub.error('formula_type_error', 'no', false, 0);
    stub.error('formula_type_error', 'no', false, 1);
    const html = node('label').innerHTML;
    const text = html.match(/(?<![-\w])color: ([^;"]+)/)?.[1];
    const background = html.match(/background(?:-color)?: ([^;"]+)/)?.[1];
    expect(background).toBe(NO_STATE);
    expect(text).toMatch(/^(var\(--cr-\d+, #161616\)|light-dark\(#161616)/);
    expect(text).not.toBe(background);
  });

  it('a node with only its text colour ruled keeps the cue of the disconnected look', () => {
    const rule = BUTTON.rules![0]!;
    const label = {
      id: 'label',
      type: 'text-label',
      props: { text: 'Rack A', foregroundColor: OK },
      geometry: { x: 10, y: 10, width: 80, height: 20 },
      rules: [{ ...rule, id: 'fg', targetProperty: 'foregroundColor' }],
    } as WidgetNode;
    const node = show([label]);
    stub.error('formula_type_error', 'no', false);
    expect(node('label').style.outline).toMatch(/dashed .*#da1e28/);
  });
});

describe('a widget bound to a formula that fails', () => {
  it('a result that comes after the start timeout is shown', () => {
    vi.useFakeTimers();
    const node = show([READOUT]);
    act(() => void vi.advanceTimersByTime(3000));
    expect(node('readout').getAttribute('data-pv-state')).toBe('disconnected');
    expect(node('readout').getAttribute('title')).toBe('no answer from the formula service');
    stub.result(7, { severity: 'NO_ALARM', vectorInputs: SUMMARY });
    expect(node('readout').getAttribute('data-pv-state')).toBe('connected');
    expect(node('readout').getAttribute('title')).toBe('2 channels, all with a value');
    expect(node('readout').textContent).toContain('7');
  });

  it('shows the error on hover, not the summary of the result before', () => {
    const node = show([READOUT]);
    stub.result(3, { severity: 'INVALID', vectorInputs: { count: 2, missing: ['A'], more: 0 } });
    expect(node('readout').getAttribute('title')).toBe('2 channels, 1 without a value: A');
    stub.error('formula_type_error', 'no', false);
    expect(node('readout').getAttribute('title')).toBe('formula_type_error: no');
    expect(node('readout').getAttribute('data-vector-count')).toBeNull();
    expect(node('readout').getAttribute('data-pv-state')).toBe('disconnected');
    stub.result(0, { severity: 'NO_ALARM', vectorInputs: SUMMARY });
    expect(node('readout').getAttribute('title')).toBe('2 channels, all with a value');
  });

  it('says that the formula service gave no answer after the start timeout', () => {
    vi.useFakeTimers();
    const node = show([READOUT]);
    expect(node('readout').getAttribute('title')).toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(node('readout').getAttribute('title')).toBe('no answer from the formula service');
  });
});

describe('the hover and the pointer', () => {
  it('a shape that took no pointer takes none for the hover', () => {
    const node = show([LIGHT]);
    const before = node('light').style.pointerEvents;
    stub.result(-1, { severity: 'NO_ALARM', vectorInputs: SUMMARY });
    expect(node('light').style.pointerEvents).toBe(before);
    expect(before).toBe('none');
    // The summary is still on the node for whoever reads it.
    expect(node('light').getAttribute('data-vector-count')).toBe('2');
  });
});

describe('one node fed twice by one formula', () => {
  it('counts the members once', () => {
    const twice = {
      ...BUTTON,
      rules: [
        BUTTON.rules![0]!,
        { ...BUTTON.rules![0]!, id: 'second', targetProperty: 'lineColor' },
      ],
    } as WidgetNode;
    const node = show([twice]);
    const summary = { count: 2, missing: ['RACK:A:PS2'], more: 0 };
    stub.result(0, { severity: 'INVALID', vectorInputs: summary }, 0);
    stub.result(0, { severity: 'INVALID', vectorInputs: summary }, 1);
    expect(node('light').getAttribute('title')).toBe('2 channels, 1 without a value: RACK:A:PS2');
  });

  it('names at most 20 channels over all formulas of the node', () => {
    const names = (prefix: string) => Array.from({ length: 15 }, (_, i) => `${prefix}:${i}`);
    const combined = combineVectorInputs([
      { members: names('A'), inputs: { count: 15, missing: names('A'), more: 2 } },
      { members: names('B'), inputs: { count: 15, missing: names('B'), more: 0 } },
      { members: names('A'), inputs: { count: 15, missing: names('A'), more: 2 } },
    ]);
    expect(combined).toEqual({
      count: 30,
      missing: [...names('A'), ...names('B').slice(0, 5)],
      more: 12,
    });
  });
});
