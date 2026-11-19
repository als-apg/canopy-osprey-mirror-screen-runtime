// Staged values in a rendered screen: a value lives only while its entry is
// on screen with the same channel, each screen instance answers for itself
// and the instances it embeds, and a scope being written takes no second
// Apply.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { WriteGate, registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { WriteGateService, WriteOutcome, WriteRequest } from '@slaclab/canopy-screen-widgets';
import type { PropertyValue, Rule, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import type { FormulaScalarValue, FormulaSpec, FormulaSubscribeOptions } from '../formula.js';
import { FormulaSubscriberContext } from '../formula.js';
import { ScreenRenderer } from './ScreenRenderer.js';

/** Delivers a result to every rule subscription of the screen. */
class StubSubscriber {
  readonly subscriptions: { spec: FormulaSpec; options: FormulaSubscribeOptions }[] = [];

  subscribe(spec: FormulaSpec, options: FormulaSubscribeOptions): () => void {
    this.subscriptions.push({ spec, options });
    return () => {};
  }

  push(value: FormulaScalarValue): void {
    act(() => {
      for (const s of this.subscriptions) s.options.onResult(value);
    });
  }
}

let service: MockPVService;
let stub: StubSubscriber;
let runs: WriteRequest[][];
/** Each run waits here when set, until the test resolves it. */
let pending: Array<(o: WriteOutcome[]) => void> | null;

const confirmed = (): WriteOutcome => ({
  outcome: 'confirmed',
  code: null,
  status: null,
  detail: 'written',
  coalesced: false,
});

const gate: WriteGateService = {
  confirmWrites: () => false,
  run: (writes) => {
    runs.push([...writes]);
    if (pending === null) return Promise.resolve(writes.map(confirmed));
    return new Promise((resolve) => pending!.push(resolve));
  },
};

beforeAll(() => {
  registerBuiltinWidgets();
});

beforeEach(() => {
  service = new MockPVService();
  service.connect();
  stub = new StubSubscriber();
  runs = [];
  pending = null;
});

afterEach(() => {
  cleanup();
  service.disconnect();
  vi.restoreAllMocks();
});

function wrap(children: ReactNode) {
  return (
    <PVServiceProvider service={service}>
      <FormulaSubscriberContext.Provider value={stub}>
        <WriteGate.Provider value={gate}>{children}</WriteGate.Provider>
      </FormulaSubscriberContext.Provider>
    </PVServiceProvider>
  );
}

function doc(id: string, children: WidgetNode[], macros: ScreenJSON['macros'] = []): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id,
    metadata: { title: id, source: { type: 'hand-authored' }, size: { width: 400, height: 300 } },
    macros,
    root: {
      id: `${id}-root`,
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children,
    },
  };
}

function entry(id: string, pv: string, y: number, rules?: Rule[]): WidgetNode {
  return {
    id,
    type: 'pv-text-input',
    props: { pv, stage: 'set' },
    geometry: { x: 10, y, width: 100, height: 30 },
    ...(rules ? { rules } : {}),
  };
}

function button(id: string, label: string, type: 'apply_staged' | 'clear_staged', x = 10) {
  return {
    id,
    type: 'regular-button',
    props: { label, actions: [{ type, scope: 'set' }] as unknown as PropertyValue },
    geometry: { x, y: 200, width: 100, height: 30 },
  } satisfies WidgetNode;
}

function embed(id: string, file: string, ch: string, y: number, rules?: Rule[]): WidgetNode {
  return {
    id,
    type: 'embedded-display',
    props: { file, macros: { CH: ch } },
    geometry: { x: 0, y, width: 400, height: 80 },
    ...(rules ? { rules } : {}),
  };
}

/**
 * A rule on `targetProperty`: `initial` by default, `changed` on its one arm.
 * The stub delivers arm indexes: 0 is the arm, -1 the default.
 */
function rule(
  targetProperty: string,
  initial: FormulaScalarValue,
  changed: FormulaScalarValue
): Rule {
  return {
    id: `r-${targetProperty}`,
    name: targetProperty,
    targetProperty,
    default: initial,
    pvs: [{ name: 'RULE:PV', trigger: true }],
    conditions: [{ expression: '{0} == 1', value: changed }],
  } as unknown as Rule;
}
const ARM = 0;
const DEFAULT = -1;

/** A card: one staging entry on `sim://${CH}` and its own Apply. */
const card = (): ScreenJSON =>
  doc('card', [
    entry('c-entry', 'sim://${CH}', 0),
    button('c-apply', 'Apply card', 'apply_staged'),
  ]);

async function type(scope: HTMLElement, text: string) {
  const input = await waitFor(() => {
    const el = scope.querySelector('input') as HTMLInputElement;
    expect(el).not.toBeNull();
    expect(el.disabled).toBe(false);
    return el;
  });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
}

const node = (id: string, within_: ParentNode = document) =>
  within_.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
const count = (id: string, within_: ParentNode = document) =>
  node(id, within_).getAttribute('data-staged-count');
const apply = () => button('apply', 'Apply', 'apply_staged');
const click = (el: HTMLElement) => fireEvent.click(el.querySelector('button') as HTMLElement);

describe('a staged value goes with its entry', () => {
  it('hidden by a rule: dropped, not written, and not back when the entry returns', async () => {
    render(
      wrap(
        <ScreenRenderer
          screen={doc('top', [
            entry('e1', 'sim://sine', 50, [rule('visible', true, false)]),
            apply(),
          ])}
        />
      )
    );
    await type(node('e1'), '2.5');
    await waitFor(() => expect(count('apply')).toBe('1'));
    stub.push(ARM);
    await waitFor(() => expect(count('apply')).toBe('0'));
    expect(node('e1')).toBeNull();
    click(node('apply'));
    stub.push(DEFAULT);
    await waitFor(() => expect(node('e1')).not.toBeNull());
    expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(0);
    expect(count('apply')).toBe('0');
    expect(runs).toEqual([]);
  });

  it('a rule that binds the entry to another channel drops the value', async () => {
    render(
      wrap(
        <ScreenRenderer
          screen={doc('top', [
            entry('e1', 'sim://sine', 50, [rule('pv', 'sim://sine', 'sim://ramp')]),
            apply(),
          ])}
        />
      )
    );
    await type(node('e1'), '2.5');
    await waitFor(() => expect(count('apply')).toBe('1'));
    stub.push(ARM);
    await waitFor(() => expect(count('apply')).toBe('0'));
    expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(0);
    expect(runs).toEqual([]);
  });

  it('a change of macro values on the same screen resets the staged values', async () => {
    const top = doc('top', [entry('e1', 'sim://sine', 50), apply()], [{ name: 'X', default: 'a' }]);
    const view = render(wrap(<ScreenRenderer screen={top} macros={{ X: 'a' }} />));
    await type(node('e1'), '2.5');
    await waitFor(() => expect(count('apply')).toBe('1'));
    // The same values in a new object reset nothing.
    view.rerender(wrap(<ScreenRenderer screen={top} macros={{ X: 'a' }} />));
    expect(count('apply')).toBe('1');
    view.rerender(wrap(<ScreenRenderer screen={top} macros={{ X: 'b' }} />));
    await waitFor(() => expect(count('apply')).toBe('0'));
    expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(0);
  });

  it('a reload of the top screen (a new document) resets the staged values', async () => {
    const make = () => doc('top', [entry('e1', 'sim://sine', 50), apply()]);
    const view = render(wrap(<ScreenRenderer screen={make()} />));
    await type(node('e1'), '2.5');
    await waitFor(() => expect(count('apply')).toBe('1'));
    view.rerender(wrap(<ScreenRenderer screen={make()} />));
    await waitFor(() => expect(count('apply')).toBe('0'));
    expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(0);
  });

  it('an embed retargeted by a rule drops the values staged in it', async () => {
    const resolveScreen = vi.fn(async (ref: string) =>
      ref.includes('other') ? doc('other', []) : card()
    );
    render(
      wrap(
        <ScreenRenderer
          screen={doc('top', [
            embed('row', 'card.screen.json', 'sine', 0, [
              rule('file', 'card.screen.json', 'other.screen.json'),
            ]),
            apply(),
          ])}
          resolveScreen={resolveScreen}
        />
      )
    );
    await waitFor(() => expect(node('c-entry')).not.toBeNull());
    await type(node('c-entry'), '2.5');
    await waitFor(() => expect(count('apply')).toBe('1'));
    stub.push(ARM);
    await waitFor(() => expect(count('apply')).toBe('0'));
    click(node('apply'));
    expect(runs).toEqual([]);
  });

  it('an embed fetched again drops the values staged in it', async () => {
    const top = doc('top', [embed('row', 'card.screen.json', 'sine', 0), apply()]);
    const view = render(wrap(<ScreenRenderer screen={top} resolveScreen={async () => card()} />));
    await waitFor(() => expect(node('c-entry')).not.toBeNull());
    await type(node('c-entry'), '2.5');
    await waitFor(() => expect(count('apply')).toBe('1'));
    view.rerender(wrap(<ScreenRenderer screen={top} resolveScreen={async () => card()} />));
    await waitFor(() => expect(count('apply')).toBe('0'));
    await waitFor(() => expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(0));
  });
});

describe('a scope belongs to a screen instance and the instances it embeds', () => {
  async function rows() {
    render(
      wrap(
        <ScreenRenderer
          screen={doc('top', [
            embed('row1', 'card.screen.json', 'sine', 0),
            embed('row2', 'card.screen.json', 'ramp', 90),
            entry('own', 'sim://noise', 170),
            apply(),
            button('reset', 'Reset', 'clear_staged', 150),
          ])}
          resolveScreen={async () => card()}
        />
      )
    );
    const cards = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[data-testid="embedded-screen"]')];
      expect(found).toHaveLength(2);
      return found;
    });
    await type(node('c-entry', cards[0]), '1');
    await type(node('c-entry', cards[1]), '2');
    await type(node('own'), '3');
    await waitFor(() => expect(count('apply')).toBe('3'));
    return cards;
  }

  it('counts: the parent sees its rows, a card only itself', async () => {
    const cards = await rows();
    expect(count('c-apply', cards[0])).toBe('1');
    expect(count('c-apply', cards[1])).toBe('1');
    expect(count('reset')).toBe('3');
    expect(within(node('apply')).getByTestId('canopy-staged-count').textContent).toBe('3');
  });

  it("Apply inside a card writes only that card's value", async () => {
    const cards = await rows();
    click(node('c-apply', cards[0]));
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]).toEqual([{ pv: 'sim://sine', value: 1, entered: '1' }]);
    await waitFor(() => expect(count('apply')).toBe('2'));
    expect(count('c-apply', cards[1])).toBe('1');
    expect(count('c-apply', cards[0])).toBe('0');
  });

  it('Apply on the parent writes its own value and its rows, in staging order', async () => {
    await rows();
    click(node('apply'));
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0].map((w) => w.pv)).toEqual(['sim://sine', 'sim://ramp', 'sim://noise']);
    await waitFor(() => expect(count('apply')).toBe('0'));
  });

  it('Clear on the parent drops its rows too; nothing is written', async () => {
    const cards = await rows();
    click(node('reset'));
    await waitFor(() => expect(count('apply')).toBe('0'));
    expect(count('c-apply', cards[0])).toBe('0');
    expect(runs).toEqual([]);
  });
});

describe('while a run writes the scope', () => {
  it('Apply and Clear are inert, a second press does nothing, staging goes on', async () => {
    pending = [];
    render(
      wrap(
        <ScreenRenderer
          screen={doc('top', [
            entry('e1', 'sim://sine', 50),
            entry('e2', 'sim://ramp', 90),
            apply(),
            button('reset', 'Reset', 'clear_staged', 150),
          ])}
        />
      )
    );
    await type(node('e1'), '1');
    await waitFor(() => expect(count('apply')).toBe('1'));
    click(node('apply'));
    await waitFor(() => expect(runs).toHaveLength(1));
    for (const id of ['apply', 'reset']) {
      await waitFor(() => expect(node(id).getAttribute('aria-disabled')).toBe('true'));
      expect(node(id).getAttribute('title')).toBe('the staged values are being written');
    }
    click(node('apply'));
    click(node('reset'));
    await type(node('e2'), '2');
    await waitFor(() => expect(count('apply')).toBe('2'));
    expect(runs).toHaveLength(1);

    await act(async () => {
      pending![0](runs[0].map(confirmed));
    });
    await waitFor(() => expect(node('apply').getAttribute('aria-disabled')).toBeNull());
    expect(count('apply')).toBe('1');
    expect(runs[0]).toEqual([{ pv: 'sim://sine', value: 1, entered: '1' }]);
    click(node('apply'));
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(runs[1].map((w) => w.pv)).toEqual(['sim://ramp']);
  });
});

describe('a value that leaves the screen while its run is under way', () => {
  /** A gate that asks the run's check for each write once the test lets it go on. */
  function checkingGate() {
    const verdicts: Array<[string, string | null]> = [];
    let go: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      go = resolve;
    });
    const held: WriteGateService = {
      confirmWrites: () => true,
      run: async (writes, options) => {
        runs.push([...writes]);
        await waiting;
        const outcomes: WriteOutcome[] = [];
        for (const [i, w] of writes.entries()) {
          const gone = options?.check?.(w, i) ?? null;
          verdicts.push([w.pv, gone]);
          if (gone !== null) break;
          outcomes.push(confirmed());
        }
        return outcomes;
      },
    };
    return { held, verdicts, go: () => act(async () => go()) };
  }
  function show(gateUnderTest: WriteGateService, screenJson: ScreenJSON, resolveScreen?: never) {
    return render(
      <PVServiceProvider service={service}>
        <FormulaSubscriberContext.Provider value={stub}>
          <WriteGate.Provider value={gateUnderTest}>
            <ScreenRenderer screen={screenJson} resolveScreen={resolveScreen} />
          </WriteGate.Provider>
        </FormulaSubscriberContext.Provider>
      </PVServiceProvider>
    );
  }

  it('a rule hides an entry while the dialog is open: that value is not sent and the run stops', async () => {
    const g = checkingGate();
    show(
      g.held,
      doc('top', [
        entry('e1', 'sim://sine', 50),
        entry('e2', 'sim://ramp', 90, [rule('visible', true, false)]),
        entry('e3', 'sim://noise', 130),
        apply(),
      ])
    );
    await type(node('e1'), '1');
    await type(node('e2'), '2');
    await type(node('e3'), '3');
    await waitFor(() => expect(count('apply')).toBe('3'));
    click(node('apply'));
    await waitFor(() => expect(runs).toHaveLength(1));
    stub.push(ARM);
    await g.go();
    await waitFor(() => expect(node('apply').getAttribute('aria-disabled')).toBeNull());
    expect(g.verdicts).toEqual([
      ['sim://sine', null],
      ['sim://ramp', 'no longer on screen'],
    ]);
    // The first was written; the hidden one is gone; the third stays staged.
    expect(count('apply')).toBe('1');
    expect(node('e3').getAttribute('data-staged')).toBeNull();
    expect(node('e3').querySelector('[data-staged="true"]')).not.toBeNull();
  });

  it('Escape and typing in a staged entry do nothing while its run is under way', async () => {
    const g = checkingGate();
    show(g.held, doc('top', [entry('e1', 'sim://sine', 50), apply()]));
    const input = await type(node('e1'), '2.50');
    await waitFor(() => expect(count('apply')).toBe('1'));
    click(node('apply'));
    await waitFor(() => expect(runs).toHaveLength(1));
    await waitFor(() => expect(input.readOnly).toBe(true));
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.change(input, { target: { value: '9' } });
    expect(input.value).toBe('2.50');
    expect(count('apply')).toBe('1');
    await g.go();
    await waitFor(() => expect(count('apply')).toBe('0'));
    expect(g.verdicts).toEqual([['sim://sine', null]]);
  });

  it('an embedded instance retargeted mid-run: its value is not sent', async () => {
    const g = checkingGate();
    const resolveScreen = vi.fn(async (ref: string) =>
      ref.includes('other') ? doc('other', []) : card()
    );
    show(
      g.held,
      doc('top', [
        entry('own', 'sim://noise', 170),
        embed('row', 'card.screen.json', 'sine', 0, [
          rule('file', 'card.screen.json', 'other.screen.json'),
        ]),
        apply(),
      ]),
      resolveScreen as never
    );
    await waitFor(() => expect(node('c-entry')).not.toBeNull());
    await type(node('own'), '3');
    await type(node('c-entry'), '1');
    await waitFor(() => expect(count('apply')).toBe('2'));
    click(node('apply'));
    await waitFor(() => expect(runs).toHaveLength(1));
    stub.push(ARM);
    await waitFor(() => expect(node('c-entry')).toBeNull());
    await g.go();
    await waitFor(() => expect(count('apply')).toBe('0'));
    expect(g.verdicts).toEqual([
      ['sim://noise', null],
      ['sim://sine', 'no longer on screen'],
    ]);
  });
});
