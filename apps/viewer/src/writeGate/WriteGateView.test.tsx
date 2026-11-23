// The write gate as the operator sees it: real widgets under a real gate over
// a fake Hare backend. One dialog per click across widget kinds, decline,
// binding change, the summary toast, and the DOM contract the run drivers
// read (canopy-write-dialog / -confirm / -decline / -toast + data-outcome).
import '../test/memoryStorage.js';
import { useState } from 'react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import type {
  HareHeartbeatState,
  HareWrites,
  WriteOutcome,
  WriteOutcomeKind,
} from '@slaclab/canopy-client';

let pvState: Record<
  string,
  { connected: boolean; value: number | string; enumChoices?: string[] }
> = {};
const directPuts: Array<[string, unknown]> = [];

vi.mock('@slaclab/canopy-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePV: (address?: string) => ({
    address: address ?? '',
    connected: (address && pvState[address]?.connected) || false,
    value: address ? pvState[address]?.value : undefined,
    displayValue: address ? String(pvState[address]?.value ?? '') : '',
    enumChoices: address ? pvState[address]?.enumChoices : undefined,
    severity: 0,
    precision: 0,
    put: (v: unknown) => {
      if (address) directPuts.push([address, v]);
    },
  }),
}));

const W = await import('@slaclab/canopy-screen-widgets');
const { PVServiceProvider } = await import('@slaclab/canopy-react');
type PVService = import('@slaclab/canopy-client').PVService;
const { createWriteGate } = await import('./gate.js');
type WriteTargetKind = import('./gate.js').WriteTargetKind;
type ControlLimits = import('./gate.js').ControlLimits;
const { ScreenWriteGateProvider } = await import('./WriteGateView.js');
const { armAgentGuard, GUARD_NOTICE } = await import('./guard.js');
type WriteBackend = import('./gate.js').WriteBackend;
type ScreenWriteGate = import('./gate.js').ScreenWriteGate;

function outcome(kind: WriteOutcomeKind, detail: string = kind, coalesced = false): WriteOutcome {
  return { outcome: kind, code: null, status: null, detail, coalesced };
}

let confirm = true;
let hb: HareHeartbeatState = { seen: true, binding: 'va@1' };
/** The socket's write statement; null is a legacy frame. */
let said: HareWrites | null = null;
let answers: WriteOutcome[] = [];
let sent: Array<[string, unknown]> = [];
let sentConfirmed: boolean[] = [];
const hbListeners = new Set<(s: HareHeartbeatState) => void>();
/** What the backend says of its target, and the control limits its channels state. */
let targetLabel: string | null = 'VA simulator';
let targetKind: WriteTargetKind | null = null;
let targetNotice: 'fallback' | 'unservable' | null = null;
let limits: Record<string, ControlLimits> = {};

const backend: WriteBackend = {
  heartbeat: () => hb,
  linkUp: () => true,
  submit: async (pv, value, options) => {
    sent.push([pv, value]);
    sentConfirmed.push(options.confirmed === true);
    return answers.shift() ?? outcome('confirmed', 'written');
  },
  onHeartbeat: (l) => {
    hbListeners.add(l);
    return () => hbListeners.delete(l);
  },
  confirmWrites: () => confirm,
  machineLabel: () => targetLabel,
  targetKind: () => targetKind,
  targetNotice: () => targetNotice,
  controlLimits: (pv) => limits[pv] ?? null,
  writes: () => ({ writes: said, seen: said !== null }),
};

beforeEach(() => {
  // Carbon's modal observes its body; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  pvState = {};
  directPuts.length = 0;
  confirm = true;
  hb = { seen: true, binding: 'va@1' };
  said = null;
  answers = [];
  sent = [];
  sentConfirmed = [];
  targetLabel = 'VA simulator';
  targetKind = null;
  targetNotice = null;
  limits = {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = {
  id: 'w-1',
  layout: { x: 0, y: 0, width: 200, height: 32 },
  props: {},
  isSelected: false,
  isEditing: false,
};

let gate: ScreenWriteGate;

function renderWidget(C: unknown, props: Record<string, unknown>) {
  const Comp = C as React.FC<typeof base>;
  gate = createWriteGate(backend, { screen: 'sr/overview', rev: null });
  return render(
    <ScreenWriteGateProvider gate={gate}>
      <Comp {...base} props={props} />
    </ScreenWriteGateProvider>
  );
}

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const dialogs = () => document.querySelectorAll('[data-testid="canopy-write-dialog"]');
const toasts = () =>
  [...document.querySelectorAll('[data-testid="canopy-write-toast"]')].map((t) => [
    t.getAttribute('data-outcome'),
    t.textContent,
  ]);

/** The labelled rows of a one-change dialog as [label, content]. */
function rows(): string[][] {
  return [...document.querySelectorAll('.canopy-write-dialog__row')].map((row) => [
    row.querySelector('th')?.textContent ?? '',
    row.querySelector('td')?.textContent ?? '',
  ]);
}

async function answer(button: 'canopy-write-confirm' | 'canopy-write-decline') {
  fireEvent.click(screen.getByTestId(button));
  await flush();
}

/** One click (or keypress) of each widget kind that writes. */
const KINDS: Array<{
  name: string;
  render(): void;
  act(): void;
  writes: Array<[string, unknown]>;
}> = [
  {
    name: 'text input (Enter)',
    render: () => {
      pvState['SIM:SP'] = { connected: true, value: 1 };
      renderWidget(W.CarbonPVTextInput, { pvName: 'SIM:SP' });
    },
    act: () => {
      const input = document.querySelector('input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2.5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    },
    writes: [['SIM:SP', 2.5]],
  },
  {
    name: 'push button',
    render: () => renderWidget(W.CarbonPVButton, { controlPV: 'SIM:CMD', pressValue: '2' }),
    act: () => fireEvent.click(document.querySelector('button') as HTMLButtonElement),
    writes: [['SIM:CMD', 2]],
  },
  {
    name: 'toggle',
    render: () => {
      pvState['SIM:EN'] = { connected: true, value: 0 };
      renderWidget(W.CarbonPVToggle, { pvName: 'SIM:EN' });
    },
    act: () => fireEvent.click(screen.getByRole('switch')),
    writes: [['SIM:EN', 1]],
  },
  {
    name: 'checkbox',
    render: () => {
      pvState['SIM:CB'] = { connected: true, value: 0 };
      renderWidget(W.CarbonPVCheckbox, { pvName: 'SIM:CB', label: 'cb' });
    },
    act: () => fireEvent.click(screen.getByRole('checkbox')),
    writes: [['SIM:CB', 1]],
  },
  {
    name: 'momentary button (pulse)',
    render: () =>
      renderWidget(W.CarbonPVButton, { controlPV: 'SIM:PULSE', pressValue: 1, releaseValue: 0 }),
    act: () => {
      const btn = document.querySelector('button') as HTMLButtonElement;
      const down = createEvent.pointerDown(btn);
      Object.defineProperty(down, 'button', { value: 0 });
      Object.defineProperty(down, 'pointerId', { value: 1 });
      fireEvent(btn, down);
    },
    writes: [
      ['SIM:PULSE', 1],
      ['SIM:PULSE', 0],
    ],
  },
];

describe('one dialog per click across widget kinds', () => {
  for (const kind of KINDS) {
    it(`${kind.name}: one dialog naming the PV and value, then the writes`, async () => {
      kind.render();
      kind.act();
      await flush();
      expect(dialogs()).toHaveLength(1);
      const dialog = dialogs()[0] as HTMLElement;
      for (const [pv, value] of kind.writes) {
        expect(dialog.textContent).toContain(pv);
        expect(dialog.textContent).toContain(String(value));
      }
      expect(dialog.textContent).toContain('VA simulator');
      expect(sent).toEqual([]);
      await answer('canopy-write-confirm');
      expect(dialogs()).toHaveLength(0);
      expect(sent).toEqual(kind.writes);
      expect(directPuts).toEqual([]);
      expect(toasts()).toEqual([['confirmed', 'written']]);
    });
  }
});

describe('the dialog', () => {
  // Focus starts on Cancel, so Enter never writes. The dialog opens inside
  // the event that asked for it (a text input's Enter keydown), and the
  // browser delivers the rest of that key press to the button that now holds
  // focus: Cancel must not take an Enter it did not see go down.
  for (const kind of KINDS) {
    it(`${kind.name}: opens with focus on Cancel`, async () => {
      kind.render();
      kind.act();
      await flush();
      expect(document.activeElement).toBe(screen.getByTestId('canopy-write-decline'));
    });
  }

  it('the key press that opened the dialog cannot answer it', async () => {
    KINDS[0].render();
    KINDS[0].act();
    await flush();
    const cancel = screen.getByTestId('canopy-write-decline');
    // The opening Enter's keypress, and its auto-repeat while held.
    expect(fireEvent.keyPress(cancel, { key: 'Enter', charCode: 13 })).toBe(false);
    expect(fireEvent.keyDown(cancel, { key: 'Enter', repeat: true })).toBe(false);
    expect(fireEvent.keyPress(cancel, { key: 'Enter', charCode: 13 })).toBe(false);
    fireEvent.keyUp(cancel, { key: 'Enter' });
    expect(dialogs()).toHaveLength(1);
    // An Enter pressed on Cancel itself is let through to the button.
    expect(fireEvent.keyDown(cancel, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyPress(cancel, { key: 'Enter', charCode: 13 })).toBe(true);
    expect(sent).toEqual([]);
  });

  it('Enter on the open dialog writes nothing: the confirm button is not its default', async () => {
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    const dialog = dialogs()[0] as HTMLElement;
    for (const target of [dialog, document.activeElement as HTMLElement]) {
      fireEvent.keyDown(target, { key: 'Enter' });
      fireEvent.keyPress(target, { key: 'Enter', charCode: 13 });
      fireEvent.keyUp(target, { key: 'Enter' });
    }
    await flush();
    expect(sent).toEqual([]);
    expect(dialog.querySelector('form')).toBeNull();
    expect(screen.getByTestId('canopy-write-confirm').getAttribute('type')).toBe('button');
    expect(document.activeElement).not.toBe(screen.getByTestId('canopy-write-confirm'));
  });

  it('Escape declines: nothing is written', async () => {
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await flush();
    expect(dialogs()).toHaveLength(0);
    expect(sent).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it('the close mark declines: nothing is written', async () => {
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    fireEvent.click(document.querySelector('.cds--modal-close') as HTMLButtonElement);
    await flush();
    expect(dialogs()).toHaveLength(0);
    expect(sent).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  // Carbon's sm size is what the host's control height applies to.
  it('draws both footer buttons at the sm size', async () => {
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    for (const id of ['canopy-write-decline', 'canopy-write-confirm']) {
      expect(screen.getByTestId(id).classList.contains('cds--btn--sm')).toBe(true);
    }
  });

  it('decline sends nothing and shows no toast', async () => {
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    await answer('canopy-write-decline');
    expect(dialogs()).toHaveLength(0);
    expect(sent).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it('closes on a binding change: nothing sent, "target changed" toasted', async () => {
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    expect(dialogs()).toHaveLength(1);
    await act(async () => {
      hb = { seen: true, binding: 'va@2' };
      for (const l of [...hbListeners]) l(hb);
    });
    await flush();
    expect(dialogs()).toHaveLength(0);
    expect(sent).toEqual([]);
    expect(toasts()).toEqual([
      ['target_changed', 'the control target or its write state changed; nothing written'],
    ]);
  });

  it('stays one dialog while a second click waits its turn', async () => {
    KINDS[1].render();
    KINDS[1].act();
    KINDS[1].act();
    await flush();
    expect(dialogs()).toHaveLength(1);
    await answer('canopy-write-confirm');
    expect(dialogs()).toHaveLength(1);
    await answer('canopy-write-confirm');
    expect(sent).toEqual([
      ['SIM:CMD', 2],
      ['SIM:CMD', 2],
    ]);
  });

  it('shows no dialog with confirmWrites off', async () => {
    confirm = false;
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    expect(dialogs()).toHaveLength(0);
    expect(sent).toEqual([['SIM:CMD', 2]]);
    expect(sentConfirmed).toEqual([false]);
    expect(toasts()).toEqual([['confirmed', 'written']]);
  });

  it('under asked: a dialog with confirmWrites off, and the confirmed writes say so', async () => {
    confirm = false;
    said = { state: 'asked', reason: null, cause: 'asked' };
    KINDS[4].render();
    KINDS[4].act();
    await flush();
    expect(dialogs()).toHaveLength(1);
    expect(sent).toEqual([]);
    await answer('canopy-write-confirm');
    expect(sent).toEqual(KINDS[4].writes);
    expect(sentConfirmed).toEqual([true, true]);
    expect(toasts()).toEqual([['confirmed', 'written']]);
  });

  it("under held: the widget is inert with the hold's reason; a click opens nothing", async () => {
    const reason = 'writes are held while a watchdog flag is open';
    said = { state: 'held', reason, cause: 'session_held' };
    KINDS[1].render();
    const button = document.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe(reason);
    KINDS[1].act();
    await flush();
    expect(dialogs()).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it('drops a waiting click when the screen unmounts', async () => {
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    cleanup();
    gate.dispose();
    await flush();
    expect(sent).toEqual([]);
  });

  it('shows the parsed value beside the text it was typed as', async () => {
    pvState['SIM:SP'] = { connected: true, value: 1 };
    renderWidget(W.CarbonPVTextInput, { pvName: 'SIM:SP' });
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1e3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(dialogs()).toHaveLength(1);
    expect(screen.getByTestId('canopy-write-dialog').textContent).toContain('1000 (entered "1e3")');
    await answer('canopy-write-confirm');
    expect(sent).toEqual([['SIM:SP', 1000]]);
  });

  it('shows the item chosen when its index is written, in the dialog and in the toast', async () => {
    Element.prototype.scrollIntoView = () => {};
    pvState['SIM:MODE'] = { connected: true, value: 0, enumChoices: ['Off', 'On', 'Fault', 'On'] };
    renderWidget(W.CarbonPVDropdown, { pvName: 'SIM:MODE' });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'On (3)' }));
    await flush();
    const cell = screen.getByTestId('canopy-write-dialog').textContent ?? '';
    expect(cell).toContain('On (3)');
    expect(cell).not.toContain('entered');
    await answer('canopy-write-confirm');
    expect(sent).toEqual([['SIM:MODE', 3]]);
    expect(toasts()).toEqual([['confirmed', 'written: On (3)']]);
  });

  it('shows only the value when it reads as it was typed', async () => {
    KINDS[0].render();
    KINDS[0].act();
    await flush();
    const cell = screen.getByTestId('canopy-write-dialog').textContent ?? '';
    expect(cell).toContain('2.5');
    expect(cell).not.toContain('entered');
  });

  it('opens no dialog for a draft the field refuses', async () => {
    pvState['SIM:SP'] = { connected: true, value: 1 };
    renderWidget(W.CarbonPVTextInput, { pvName: 'SIM:SP' });
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(dialogs()).toHaveLength(0);
    expect(document.querySelector('.cds--form-requirement')?.textContent).toBe('Not a number');
    expect(sent).toEqual([]);
  });
});

describe('the input guard (an agent just changed the screen)', () => {
  for (const kind of KINDS) {
    it(`${kind.name}: a click while armed sends nothing, opens no dialog, and shows the notice`, async () => {
      for (const c of [true, false]) {
        cleanup();
        sent = [];
        confirm = c;
        kind.render();
        const arm = armAgentGuard();
        try {
          kind.act();
          await flush();
        } finally {
          arm.drop();
        }
        fireEvent.pointerUp(window, { pointerId: 1 });
        await flush();
        expect(dialogs()).toHaveLength(0);
        expect(sent).toEqual([]);
        expect(directPuts).toEqual([]);
        expect(toasts()).toEqual([['guarded', GUARD_NOTICE]]);
        const notice = screen.getByTestId('canopy-write-toast').closest('.cds--toast-notification');
        expect(notice?.className).toContain('warning');
      }
    });
  }

  it('a momentary press held before the arm still releases on pointerup', async () => {
    confirm = false;
    KINDS[4].render();
    KINDS[4].act();
    await flush();
    expect(sent).toEqual([['SIM:PULSE', 1]]);
    const arm = armAgentGuard();
    try {
      const up = createEvent.pointerUp(window);
      Object.defineProperty(up, 'pointerId', { value: 1 });
      fireEvent(window, up);
      await flush();
      expect(sent).toEqual([
        ['SIM:PULSE', 1],
        ['SIM:PULSE', 0],
      ]);
      expect(toasts()).toEqual([['confirmed', 'written']]);
    } finally {
      arm.drop();
    }
  });
});

describe('the summary toast', () => {
  it('shows the first non-confirmed detail with its outcome', async () => {
    confirm = false;
    answers = [outcome('refused', 'the write was refused; nothing written')];
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    expect(toasts()).toEqual([['refused', 'the write was refused; nothing written']]);
  });

  it('shows no toast for a coalesced result', async () => {
    confirm = false;
    answers = [outcome('confirmed', 'written', true)];
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    expect(sent).toHaveLength(1);
    expect(toasts()).toEqual([]);
  });

  it('closes when its close button is pressed', async () => {
    confirm = false;
    answers = [outcome('refused', 'no')];
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    const toast = document.querySelector('[data-testid="canopy-write-toast"]') as HTMLElement;
    const root = toast.closest('.cds--toast-notification') as HTMLElement;
    fireEvent.click(root.querySelector('button') as HTMLButtonElement);
    await flush();
    expect(toasts()).toEqual([]);
  });

  it('leaves on its own unless the pointer is over it', async () => {
    vi.useFakeTimers();
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    try {
      confirm = false;
      answers = [outcome('refused', 'no')];
      KINDS[1].render();
      KINDS[1].act();
      await advance(0);
      expect(toasts()).toEqual([['refused', 'no']]);

      const item = document.querySelector('.canopy-write-toasts__item') as HTMLElement;
      fireEvent.mouseEnter(item);
      await advance(8000);
      expect(toasts()).toEqual([['refused', 'no']]);

      fireEvent.mouseLeave(item);
      await advance(7999);
      expect(toasts()).toEqual([['refused', 'no']]);
      await advance(1);
      expect(toasts()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sits at the bottom-left of the viewport', async () => {
    confirm = false;
    answers = [outcome('refused', 'no')];
    KINDS[1].render();
    KINDS[1].act();
    await flush();
    const column = document.querySelector('.canopy-write-toasts') as HTMLElement;
    expect(column.style.left).toBe('1rem');
    expect(column.style.bottom).toBe('1rem');
    expect(column.style.right).toBe('');
  });
});

describe('without a gate (mock and fixture mode)', () => {
  it('renders nothing and the widget writes straight through', async () => {
    const Button = W.CarbonPVButton as unknown as React.FC<typeof base>;
    render(
      <ScreenWriteGateProvider gate={null}>
        <Button {...base} props={{ controlPV: 'SIM:CMD', pressValue: '2' }} />
      </ScreenWriteGateProvider>
    );
    fireEvent.click(document.querySelector('button') as HTMLButtonElement);
    await flush();
    expect(dialogs()).toHaveLength(0);
    expect(directPuts).toEqual([['SIM:CMD', 2]]);
  });
});

// ---------------------------------------------------------------------------
// The workspace's shared toast column: every docked
// screen's toasts go into one viewport-level column, each named by its tab
// title; the dialog stays with its screen.

const { WriteToastColumn, WriteToastHostContext, pinLiveToasts } = await import('./toastHost.js');

interface ScreenSpec {
  title: string;
  pv: string;
  gate: ScreenWriteGate;
  hidden?: boolean;
}

let lives: Array<[string, boolean]> = [];

/** A stand-in workspace: screens (hidden = vacated: invisible and inert) and the column. */
function Workspace({ screens, column = true }: { screens: ScreenSpec[]; column?: boolean }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const Btn = W.CarbonPVButton as unknown as React.FC<typeof base>;
  return (
    <>
      {screens.map((s) => (
        <div
          key={s.title}
          className="screen"
          data-title={s.title}
          aria-hidden={s.hidden ? true : undefined}
          inert={s.hidden ?? false}
          style={s.hidden ? { visibility: 'hidden' } : undefined}
        >
          <WriteToastHostContext.Provider
            value={
              column
                ? {
                    element,
                    title: s.title,
                    onLive: (live: boolean) => lives.push([s.title, live]),
                  }
                : null
            }
          >
            <ScreenWriteGateProvider gate={s.gate}>
              <Btn {...base} props={{ controlPV: s.pv, pressValue: '2' }} />
            </ScreenWriteGateProvider>
          </WriteToastHostContext.Provider>
        </div>
      ))}
      {column && <WriteToastColumn onElement={setElement} />}
    </>
  );
}

function twoScreens(hiddenA = false): ScreenSpec[] {
  return [
    {
      title: 'Orbit A',
      pv: 'SIM:A',
      gate: gateA ?? (gateA = createWriteGate(backend, { screen: 'sr/a', rev: null })),
      hidden: hiddenA,
    },
    {
      title: 'Orbit B',
      pv: 'SIM:B',
      gate: gateB ?? (gateB = createWriteGate(backend, { screen: 'sr/b', rev: null })),
    },
  ];
}

let gateA: ScreenWriteGate | undefined;
let gateB: ScreenWriteGate | undefined;

function activateBoth() {
  gateA!.activate();
  gateB!.activate();
}

const clickIn = (title: string) =>
  fireEvent.click(
    document.querySelector(`.screen[data-title="${title}"] button`) as HTMLButtonElement
  );
const column = () =>
  document.querySelector('[data-testid="canopy-write-toast-column"]') as HTMLElement;

describe('the shared toast column (workspace)', () => {
  beforeEach(() => {
    gateA = undefined;
    gateB = undefined;
    lives = [];
  });
  afterEach(() => {
    gateA?.dispose();
    gateB?.dispose();
  });

  it('renders two gates into one column, one group per screen, without overlap in DOM order', async () => {
    confirm = false;
    answers = [outcome('refused', 'the write was refused; nothing written')];
    render(<Workspace screens={twoScreens()} />);
    activateBoth();
    clickIn('Orbit A');
    await flush();
    clickIn('Orbit B');
    await flush();
    expect(sent).toEqual([
      ['SIM:A', 2],
      ['SIM:B', 2],
    ]);
    // One stack in the document: the column. No screen keeps its own.
    expect(document.querySelectorAll('.canopy-write-toasts')).toHaveLength(1);
    const col = column();
    expect(col.style.position).toBe('fixed');
    const inColumn = [...col.querySelectorAll('[data-testid="canopy-write-toast"]')];
    expect(inColumn).toHaveLength(2);
    expect(toasts()).toEqual([
      ['refused', 'the write was refused; nothing written'],
      ['confirmed', 'written'],
    ]);
    // Each toast sits in its own screen's group; neither contains the other.
    const groups = [...col.children] as HTMLElement[];
    expect(groups.map((g) => g.getAttribute('data-screen-title'))).toEqual(['Orbit A', 'Orbit B']);
    expect(groups[0]!.contains(inColumn[1]!)).toBe(false);
    expect(groups[1]!.contains(inColumn[0]!)).toBe(false);
    const [a, b] = inColumn.map((t) => t.closest('.cds--toast-notification') as HTMLElement);
    expect(a!.contains(b!) || b!.contains(a!)).toBe(false);
    // Nothing of a toast stays inside a screen.
    for (const s of document.querySelectorAll('.screen')) {
      expect(s.querySelector('[data-testid="canopy-write-toast"]')).toBeNull();
    }
  });

  it("prefixes each toast with its screen's tab title, outside the contract element", async () => {
    confirm = false;
    answers = [outcome('refused', 'no')];
    render(<Workspace screens={twoScreens()} />);
    activateBoth();
    clickIn('Orbit B');
    await flush();
    const text = column().querySelector('[data-testid="canopy-write-toast"]') as HTMLElement;
    expect(text.textContent).toBe('no');
    const toast = text.closest('.cds--toast-notification') as HTMLElement;
    const prefix = toast.querySelector('[data-testid="canopy-write-toast-screen"]') as HTMLElement;
    expect(prefix).not.toBeNull();
    expect(prefix.textContent).toBe('Orbit B');
    expect(text.contains(prefix)).toBe(false);
    expect(prefix.contains(text)).toBe(false);
    // The prefix precedes the summary.
    expect(prefix.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('without a host renders the inline stack as before: in the screen, fixed, no prefix', async () => {
    confirm = false;
    answers = [outcome('refused', 'no')];
    render(<Workspace screens={twoScreens()} column={false} />);
    activateBoth();
    clickIn('Orbit A');
    await flush();
    expect(column()).toBeNull();
    const stack = document.querySelector(
      '.screen[data-title="Orbit A"] .canopy-write-toasts'
    ) as HTMLElement;
    expect(stack).not.toBeNull();
    expect(stack.style.position).toBe('fixed');
    expect(stack.style.left).toBe('1rem');
    expect(stack.style.bottom).toBe('1rem');
    expect(toasts()).toEqual([['refused', 'no']]);
    expect(document.querySelector('[data-testid="canopy-write-toast-screen"]')).toBeNull();
  });

  it('keeps a toast visible and operable when its screen is hidden, and reports it live', async () => {
    confirm = false;
    answers = [outcome('refused', 'no')];
    const view = render(<Workspace screens={twoScreens()} />);
    activateBoth();
    clickIn('Orbit A');
    await flush();
    expect(lives).toContainEqual(['Orbit A', true]);
    view.rerender(<Workspace screens={twoScreens(true)} />);
    await flush();
    const text = column().querySelector('[data-testid="canopy-write-toast"]') as HTMLElement;
    expect(text.textContent).toBe('no');
    expect(text.closest('[inert]')).toBeNull();
    expect(text.closest('[aria-hidden="true"]')).toBeNull();
    // Closing it still reaches the hidden screen's gate.
    const toast = text.closest('.cds--toast-notification') as HTMLElement;
    fireEvent.click(toast.querySelector('button') as HTMLButtonElement);
    await flush();
    expect(toasts()).toEqual([]);
    expect(lives.at(-1)).toEqual(['Orbit A', false]);
  });

  it('a vacated screen keeps its open dialog hidden and inert, sends nothing, and it is still pending on re-dock', async () => {
    const view = render(<Workspace screens={twoScreens()} />);
    activateBoth();
    clickIn('Orbit A');
    await flush();
    expect(dialogs()).toHaveLength(1);
    view.rerender(<Workspace screens={twoScreens(true)} />);
    await flush();
    const dialog = dialogs()[0] as HTMLElement;
    // The dialog stays a child of its screen, so it inherits the vacate.
    const screenEl = dialog.closest('.screen') as HTMLElement;
    expect(screenEl.getAttribute('data-title')).toBe('Orbit A');
    expect(dialog.closest('[inert]')).toBe(screenEl);
    expect(dialog.closest('[aria-hidden="true"]')).toBe(screenEl);
    expect(screenEl.style.visibility).toBe('hidden');
    expect(column().contains(dialog)).toBe(false);
    expect(sent).toEqual([]);
    view.rerender(<Workspace screens={twoScreens(false)} />);
    await flush();
    expect(dialogs()).toHaveLength(1);
    expect((dialogs()[0] as HTMLElement).closest('[inert]')).toBeNull();
    expect(sent).toEqual([]);
    await answer('canopy-write-confirm');
    expect(sent).toEqual([['SIM:A', 2]]);
  });
});

describe('a widget that asks to confirm (props.confirmWrites)', () => {
  it('text input: a dialog with confirmWrites off; the confirmed write says so', async () => {
    confirm = false;
    pvState['SIM:SP'] = { connected: true, value: 1 };
    renderWidget(W.CarbonPVTextInput, { pvName: 'SIM:SP', confirmWrites: true });
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(dialogs()).toHaveLength(1);
    expect(sent).toEqual([]);
    await answer('canopy-write-confirm');
    expect(sent).toEqual([['SIM:SP', 2.5]]);
    expect(sentConfirmed).toEqual([true]);
  });

  it('push button: Cancel writes nothing', async () => {
    confirm = false;
    renderWidget(W.CarbonPVButton, { controlPV: 'SIM:CMD', pressValue: '2', confirmWrites: true });
    fireEvent.click(document.querySelector('button') as HTMLButtonElement);
    await flush();
    expect(dialogs()).toHaveLength(1);
    await answer('canopy-write-decline');
    expect(sent).toEqual([]);
    expect(directPuts).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it('momentary button: press and release are one dialog, sent as a pulse', async () => {
    confirm = false;
    renderWidget(W.CarbonPVButton, {
      controlPV: 'SIM:PULSE',
      pressValue: 1,
      releaseValue: 0,
      confirmWrites: true,
    });
    const btn = document.querySelector('button') as HTMLButtonElement;
    const down = createEvent.pointerDown(btn);
    Object.defineProperty(down, 'button', { value: 0 });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    fireEvent(btn, down);
    await flush();
    expect(dialogs()).toHaveLength(1);
    expect(sent).toEqual([]);
    await answer('canopy-write-confirm');
    expect(sent).toEqual([
      ['SIM:PULSE', 1],
      ['SIM:PULSE', 0],
    ]);
  });

  for (const value of [false, 'false', undefined]) {
    it(`confirmWrites ${JSON.stringify(value)} asks nothing: written directly, as before`, async () => {
      confirm = false;
      renderWidget(W.CarbonPVButton, {
        controlPV: 'SIM:CMD',
        pressValue: '2',
        confirmWrites: value,
      });
      fireEvent.click(document.querySelector('button') as HTMLButtonElement);
      await flush();
      expect(dialogs()).toHaveLength(0);
      expect(sent).toEqual([['SIM:CMD', 2]]);
      expect(sentConfirmed).toEqual([false]);
    });
  }

  for (const value of ['true', 1, '$(ASK)']) {
    it(`confirmWrites ${JSON.stringify(value)} asks: any value but a plain no does`, async () => {
      confirm = false;
      renderWidget(W.CarbonPVButton, {
        controlPV: 'SIM:CMD',
        pressValue: '2',
        confirmWrites: value,
      });
      fireEvent.click(document.querySelector('button') as HTMLButtonElement);
      await flush();
      expect(dialogs()).toHaveLength(1);
      expect(sent).toEqual([]);
    });
  }
});

describe("the dialog's current values", () => {
  /** A PV service holding `values`; a channel it does not hold never delivers. */
  function service(values: Record<string, string>) {
    const subscribed: string[] = [];
    const unsubscribed: string[] = [];
    const svc = {
      subscribe(pv: string, listener: (data: unknown) => void) {
        subscribed.push(pv);
        if (pv in values) listener({ connected: true, displayValue: values[pv] });
        return () => unsubscribed.push(pv);
      },
      getSnapshot: () => undefined,
      put() {},
      connect() {},
      disconnect() {},
      isConnected: true,
    };
    return { svc: svc as unknown as PVService, subscribed, unsubscribed };
  }

  function cells(): string[][] {
    return [...document.querySelectorAll('.canopy-write-dialog__columns tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? '')
    );
  }

  it('lists each channel with its live value beside the value about to be written', async () => {
    const { svc, subscribed, unsubscribed } = service({ A: '1.50 mm', B: 'Off' });
    gate = createWriteGate(backend, { screen: 'sr/overview', rev: null });
    render(
      <PVServiceProvider service={svc}>
        <ScreenWriteGateProvider gate={gate}>
          <span />
        </ScreenWriteGateProvider>
      </PVServiceProvider>
    );
    void gate.run([
      { pv: 'A', value: 2 },
      { pv: 'B', value: 'On' },
      { pv: 'C', value: 3 },
    ]);
    await flush();
    expect(
      [...document.querySelectorAll('.canopy-write-dialog__columns th')].map((h) => h.textContent)
    ).toEqual(['channel', 'now', 'writes']);
    expect(cells()).toEqual([
      ['A', '1.50 mm', '2'],
      ['B', 'Off', '"On"'],
      ['C', 'not connected', '3'],
    ]);
    expect(subscribed).toEqual(['A', 'B', 'C']);
    await answer('canopy-write-decline');
    expect(unsubscribed.sort()).toEqual(['A', 'B', 'C']);
    expect(sent).toEqual([]);
  });

  it('reads a channel written twice in one run once', async () => {
    const { svc, subscribed } = service({ P: '0' });
    gate = createWriteGate(backend, { screen: 'sr/overview', rev: null });
    render(
      <PVServiceProvider service={svc}>
        <ScreenWriteGateProvider gate={gate}>
          <span />
        </ScreenWriteGateProvider>
      </PVServiceProvider>
    );
    void gate.run([
      { pv: 'P', value: 1 },
      { pv: 'P', value: 0, release: true },
    ]);
    await flush();
    // A press and its release on one channel are one change: labelled rows.
    expect(cells()).toEqual([]);
    expect(rows()).toEqual([
      ['channel', 'P'],
      ['now', '0'],
      ['writes', '1then 0 (release)'],
    ]);
    expect(subscribed).toEqual(['P']);
  });

  it('with no PV service in context "now" says not connected and the dialog still works', async () => {
    renderWidget(W.CarbonPVButton, { controlPV: 'SIM:CMD', pressValue: '2' });
    fireEvent.click(document.querySelector('button') as HTMLButtonElement);
    await flush();
    expect(rows()).toEqual([
      ['channel', 'SIM:CMD'],
      ['now', 'not connected'],
      ['writes', '2'],
    ]);
    await answer('canopy-write-confirm');
    expect(sent).toEqual([['SIM:CMD', 2]]);
  });
});

describe('what the dialog says', () => {
  type Live = Partial<import('@slaclab/canopy-client').PVData>;

  /** A PV service whose channels hold `values`; one it does not hold never delivers. */
  function liveService(values: Record<string, Live>): PVService {
    return {
      subscribe(pv: string, listener: (data: unknown) => void) {
        if (pv in values) listener({ connected: true, ...values[pv] });
        return () => {};
      },
      getSnapshot: () => undefined,
      put() {},
      connect() {},
      disconnect() {},
      isConnected: true,
    } as unknown as PVService;
  }

  /** A widget (or nothing) under a gate, with live channel data for the dialog. */
  function renderLive(
    values: Record<string, Live>,
    C?: unknown,
    props: Record<string, unknown> = {}
  ) {
    const Comp = C as React.FC<typeof base> | undefined;
    gate = createWriteGate(backend, { screen: 'sr/overview', rev: null });
    return render(
      <PVServiceProvider service={liveService(values)}>
        <ScreenWriteGateProvider gate={gate}>
          {Comp ? <Comp {...base} props={props} /> : <span />}
        </ScreenWriteGateProvider>
      </PVServiceProvider>
    );
  }

  const dialog = () => dialogs()[0] as HTMLElement;
  const title = () => screen.getByTestId('canopy-write-title').textContent;
  const verb = () => screen.getByTestId('canopy-write-confirm').textContent;
  const target = () => document.querySelector('.canopy-write-target') as HTMLElement;
  const press = () => fireEvent.click(document.querySelector('button') as HTMLButtonElement);

  /** Types `text` into the one entry on screen and presses Enter. */
  function enter(text: string) {
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }

  describe('the target line', () => {
    it('comes first, before the title, and names what is written to', async () => {
      renderLive({}, W.CarbonPVButton, { controlPV: 'DEV:CMD', pressValue: 1 });
      press();
      await flush();
      const header = dialog().querySelector('.cds--modal-header') as HTMLElement;
      expect(header.firstElementChild).toBe(target());
      expect(target().textContent).toBe('VA simulator');
      expect(target().nextElementSibling?.textContent).toBe(title());
      // Only the name is known: the marker makes no claim about the kind.
      expect(dialog().getAttribute('data-target-kind')).toBe('unknown');
    });

    for (const [kind, text] of [
      ['machine', 'Ring · the machine'],
      ['simulation', 'Ring · not the machine'],
      ['test', 'Ring · not the machine'],
    ] as const) {
      it(`marks a ${kind} target by its kind and says it in words`, async () => {
        targetLabel = 'Ring';
        targetKind = kind;
        renderLive({}, W.CarbonPVButton, { controlPV: 'DEV:CMD', pressValue: 1 });
        press();
        await flush();
        expect(dialog().getAttribute('data-target-kind')).toBe(kind);
        expect(target().textContent).toBe(text);
      });
    }

    it('says when the target is served from the fallback', async () => {
      targetNotice = 'fallback';
      renderLive({}, W.CarbonPVButton, { controlPV: 'DEV:CMD', pressValue: 1 });
      press();
      await flush();
      expect(dialog().getAttribute('data-target-notice')).toBe('fallback');
      expect(target().textContent).toBe('VA simulator · fallback (no target record)');
    });

    it('is drawn for a target with no name too', async () => {
      targetLabel = null;
      renderLive({}, W.CarbonPVButton, { controlPV: 'DEV:CMD', pressValue: 1 });
      press();
      await flush();
      expect(target().textContent).toBe('Control target (not named)');
    });
  });

  describe('what the screen says', () => {
    const REBOOT = {
      controlPV: 'RACK1:CTRL1:Reboot',
      pressValue: 0,
      label: 'Reboot',
      confirmTitle: 'Reboot controller RACK1:CTRL1?',
      confirmText: 'It commands 2 power supplies.',
      confirmVerb: 'Reboot now',
      confirmKind: 'consequence',
    };

    it('a press with consequences: its title, its sentence as a warning, a danger button', async () => {
      limits = { 'RACK1:CTRL1:Reboot': { low: 0, high: 1 } };
      renderLive(
        { 'RACK1:CTRL1:Reboot': { value: 1, displayValue: '1' } },
        W.CarbonPVButton,
        REBOOT
      );
      press();
      await flush();
      expect(title()).toBe('Reboot controller RACK1:CTRL1?');
      const sentence = screen.getByTestId('canopy-write-text');
      expect(sentence.textContent).toBe('It commands 2 power supplies.');
      expect(sentence.classList.contains('canopy-write-dialog__text--consequence')).toBe(true);
      // The sentence sits under the title, above the writes.
      expect(
        sentence.compareDocumentPosition(screen.getByTestId('canopy-write-title')) &
          Node.DOCUMENT_POSITION_PRECEDING
      ).toBeTruthy();
      expect(sentence.nextElementSibling?.classList.contains('canopy-write-dialog__rows')).toBe(
        true
      );
      // The host contract reads the values' face at this selector.
      expect(dialog().querySelector('.canopy-write-dialog__writes td')).not.toBeNull();
      expect(dialog().getAttribute('data-kind')).toBe('consequence');
      const go = screen.getByTestId('canopy-write-confirm');
      expect(go.textContent).toBe('Reboot now');
      expect(go.classList.contains('cds--btn--danger')).toBe(true);
      expect(rows()).toEqual([
        ['channel', 'RACK1:CTRL1:Reboot'],
        ['now', '1'],
        // A press writes a fixed value: no step, no limits row.
        ['writes', '0'],
      ]);
      await answer('canopy-write-confirm');
      expect(sent).toEqual([['RACK1:CTRL1:Reboot', 0]]);
    });

    it('without confirmKind the sentence is plain and the button primary', async () => {
      renderLive({}, W.CarbonPVButton, { ...REBOOT, confirmKind: undefined });
      press();
      await flush();
      const sentence = screen.getByTestId('canopy-write-text');
      expect(sentence.classList.contains('canopy-write-dialog__text--consequence')).toBe(false);
      expect(dialog().hasAttribute('data-kind')).toBe(false);
      const go = screen.getByTestId('canopy-write-confirm');
      expect(go.classList.contains('cds--btn--primary')).toBe(true);
      expect(go.classList.contains('cds--btn--danger')).toBe(false);
    });

    it('draws no sentence when the screen gives none', async () => {
      renderLive({}, W.CarbonPVButton, { controlPV: 'DEV:CMD', pressValue: 1 });
      press();
      await flush();
      expect(screen.queryByTestId('canopy-write-text')).toBeNull();
    });

    it('reads confirmMessage as the sentence when confirmText is not set', async () => {
      pvState['DEV:PS1:Setpoint'] = { connected: true, value: 1 };
      renderLive({}, W.CarbonPVTextInput, {
        pvName: 'DEV:PS1:Setpoint',
        confirmMessage: 'The supply ramps at once.',
      });
      enter('2');
      await flush();
      expect(screen.getByTestId('canopy-write-text').textContent).toBe('The supply ramps at once.');
    });

    it('the wording opens no dialog: without one asked, the write goes straight out', async () => {
      confirm = false;
      renderLive({}, W.CarbonPVButton, REBOOT);
      press();
      await flush();
      expect(dialogs()).toHaveLength(0);
      expect(sent).toEqual([['RACK1:CTRL1:Reboot', 0]]);
      expect(sentConfirmed).toEqual([false]);
    });

    it('Cancel on a press with consequences writes nothing', async () => {
      renderLive({}, W.CarbonPVButton, REBOOT);
      press();
      await flush();
      await answer('canopy-write-decline');
      expect(dialogs()).toHaveLength(0);
      expect(sent).toEqual([]);
      expect(directPuts).toEqual([]);
      expect(toasts()).toEqual([]);
    });
  });

  describe('a title and a button word built from the run', () => {
    it('a labelled button: "<label>?" and the label on the button', async () => {
      renderLive({}, W.CarbonPVButton, { controlPV: 'DEV:CMD', pressValue: 1, label: 'Reset' });
      press();
      await flush();
      expect(title()).toBe('Reset?');
      expect(verb()).toBe('Reset');
    });

    it('a momentary button is one press: its label, and the release on the writes row', async () => {
      renderLive({ 'DEV:PULSE': { value: 0, displayValue: '0' } }, W.CarbonPVButton, {
        controlPV: 'DEV:PULSE',
        pressValue: 1,
        releaseValue: 0,
        label: 'Fire',
      });
      const btn = document.querySelector('button') as HTMLButtonElement;
      const down = createEvent.pointerDown(btn);
      Object.defineProperty(down, 'button', { value: 0 });
      Object.defineProperty(down, 'pointerId', { value: 1 });
      fireEvent(btn, down);
      await flush();
      expect(title()).toBe('Fire?');
      expect(verb()).toBe('Fire');
      expect(rows()).toEqual([
        ['channel', 'DEV:PULSE'],
        ['now', '0'],
        ['writes', '1then 0 (release)'],
      ]);
      await answer('canopy-write-confirm');
      expect(sent).toEqual([
        ['DEV:PULSE', 1],
        ['DEV:PULSE', 0],
      ]);
    });

    it('a set point: "Set <label> to <value> <unit>?", Set, and rows with unit, difference and limits', async () => {
      pvState['DEV:PS1:Setpoint'] = { connected: true, value: 0.125 };
      limits = { 'DEV:PS1:Setpoint': { low: -10, high: 10 } };
      renderLive(
        {
          'DEV:PS1:Setpoint': {
            value: 0.125,
            displayValue: '0.1250 mrad',
            units: 'mrad',
            precision: 4,
          },
        },
        W.CarbonPVTextInput,
        { pvName: 'DEV:PS1:Setpoint', label: 'corrector PS1' }
      );
      enter('0.14');
      await flush();
      expect(title()).toBe('Set corrector PS1 to 0.14 mrad?');
      expect(verb()).toBe('Set');
      expect(rows()).toEqual([
        ['channel', 'DEV:PS1:Setpoint'],
        ['now', '0.1250 mrad'],
        ['writes', '0.14 mrad+0.0150'],
        ['limits', '-10 … 10 mrad'],
      ]);
      // The value about to be written is the emphasised one.
      const value = screen.getByTestId('canopy-write-value');
      expect(value.tagName).toBe('STRONG');
      expect(value.textContent).toBe('0.14 mrad');
      expect(screen.getByTestId('canopy-write-difference').textContent).toBe('+0.0150');
      await answer('canopy-write-confirm');
      expect(sent).toEqual([['DEV:PS1:Setpoint', 0.14]]);
    });

    it('without a label the title names the channel', async () => {
      pvState['DEV:PS1:Setpoint'] = { connected: true, value: 1 };
      renderLive({ 'DEV:PS1:Setpoint': { value: 1, displayValue: '1' } }, W.CarbonPVTextInput, {
        pvName: 'DEV:PS1:Setpoint',
      });
      enter('2.5');
      await flush();
      expect(title()).toBe('Set DEV:PS1:Setpoint to 2.5?');
      expect(verb()).toBe('Set');
    });

    it('leaves out each row that is not known: no unit, no difference, no limits', async () => {
      pvState['DEV:PS1:Setpoint'] = { connected: true, value: 1 };
      // The channel never delivers: no live value, no unit; it states no limits.
      renderLive({}, W.CarbonPVTextInput, { pvName: 'DEV:PS1:Setpoint' });
      enter('2.5');
      await flush();
      expect(rows()).toEqual([
        ['channel', 'DEV:PS1:Setpoint'],
        ['now', 'not connected'],
        ['writes', '2.5'],
      ]);
      const now = screen.getByTestId('canopy-write-current');
      expect(now.getAttribute('data-known')).toBe('false');
      expect(screen.queryByTestId('canopy-write-difference')).toBeNull();
      expect(screen.queryByTestId('canopy-write-limits')).toBeNull();
    });

    it('a channel that reports itself disconnected reads "not connected", not its stale value', async () => {
      pvState['DEV:PS1:Setpoint'] = { connected: true, value: 1 };
      renderLive(
        { 'DEV:PS1:Setpoint': { connected: false, value: 0, displayValue: '0' } },
        W.CarbonPVTextInput,
        { pvName: 'DEV:PS1:Setpoint' }
      );
      enter('2.5');
      await flush();
      expect(rows()[1]).toEqual(['now', 'not connected']);
      expect(screen.queryByTestId('canopy-write-difference')).toBeNull();
    });

    it('several staged values: "Apply N changes?", "Apply N", and a table with right-aligned columns', async () => {
      renderLive({
        'DEV:PS1:Setpoint': { value: 0.125, displayValue: '0.1250 mrad', units: 'mrad' },
        'DEV:PS1:RampRate': { value: 1, displayValue: '1.0000' },
      });
      void gate.run(
        [
          { pv: 'DEV:PS1:Setpoint', value: 0.14, entered: '0.14' },
          { pv: 'DEV:PS1:RampRate', value: 0.5, entered: '0.5' },
          { pv: 'DEV:PS1:Enable', value: 1, entered: '1' },
        ],
        { dialog: { label: 'Apply', action: 'apply' } }
      );
      await flush();
      expect(title()).toBe('Apply 3 changes?');
      expect(verb()).toBe('Apply 3');
      expect(rows()).toEqual([]);
      const table = dialog().querySelector('table.canopy-write-dialog__columns') as HTMLElement;
      const heads = [...table.querySelectorAll('th')];
      expect(heads.map((h) => h.textContent)).toEqual(['channel', 'now', 'writes']);
      expect(heads.map((h) => h.classList.contains('canopy-write-dialog__n'))).toEqual([
        false,
        true,
        true,
      ]);
      const body = [...table.querySelectorAll('tbody tr')].map((tr) => [
        ...tr.querySelectorAll('td'),
      ]);
      expect(body.map((tds) => tds.map((td) => td.textContent))).toEqual([
        ['DEV:PS1:Setpoint', '0.1250 mrad', '0.14 mrad'],
        ['DEV:PS1:RampRate', '1.0000', '0.5'],
        ['DEV:PS1:Enable', 'not connected', '1'],
      ]);
      for (const tds of body) {
        // "now" and "writes" are cells of their own, right-aligned; the value is emphasised.
        expect(tds.map((td) => td.classList.contains('canopy-write-dialog__n'))).toEqual([
          false,
          true,
          true,
        ]);
        expect(tds[2].querySelector('strong')).not.toBeNull();
      }
      await answer('canopy-write-decline');
      expect(sent).toEqual([]);
    });

    it('one staged value applied reads as a set point, by its channel', async () => {
      renderLive({ 'DEV:PS1:Setpoint': { value: 1, displayValue: '1.0 A', units: 'A' } });
      void gate.run([{ pv: 'DEV:PS1:Setpoint', value: 2, entered: '2' }], {
        dialog: { label: 'Apply', action: 'apply' },
      });
      await flush();
      expect(title()).toBe('Set DEV:PS1:Setpoint to 2 A?');
      expect(verb()).toBe('Set');
    });

    it('a labelled press that writes several channels keeps its label', async () => {
      renderLive({});
      void gate.run(
        [
          { pv: 'DEV:PS1:Setpoint', value: 12.5 },
          { pv: 'DEV:PS2:Setpoint', value: -3 },
        ],
        { dialog: { label: 'Set mode A', action: 'press' } }
      );
      await flush();
      expect(title()).toBe('Set mode A?');
      expect(verb()).toBe('Set mode A');
      expect(dialog().querySelector('table.canopy-write-dialog__columns')).not.toBeNull();
    });

    it('with nothing known but the write: "Write <value> to <channel>?" and Write', async () => {
      renderLive({});
      void gate.run([{ pv: 'DEV:CMD', value: 1 }]);
      await flush();
      expect(title()).toBe('Write 1 to DEV:CMD?');
      expect(verb()).toBe('Write');
    });

    it('several writes with nothing else known: "Apply N changes?" and "Apply N"', async () => {
      renderLive({});
      void gate.run([
        { pv: 'DEV:A', value: 1 },
        { pv: 'DEV:B', value: 2 },
      ]);
      await flush();
      expect(title()).toBe('Apply 2 changes?');
      expect(verb()).toBe('Apply 2');
    });

    it('a label too long for a button stays the title; the button falls back', async () => {
      renderLive({});
      void gate.run([{ pv: 'DEV:CMD', value: 1 }], {
        dialog: { label: 'Write 1 to DEV:CMD and start the sequence', action: 'press' },
      });
      await flush();
      expect(title()).toBe('Write 1 to DEV:CMD and start the sequence?');
      expect(verb()).toBe('Write');
    });
  });
});

describe('a run refused before it reached the gate', () => {
  it('is shown as a toast where write results are', async () => {
    renderWidget(W.CarbonPVButton, { controlPV: 'SIM:CMD', pressValue: '2' });
    act(() => gate.refused?.('SIM:A: staged with different values (1 and 2); nothing written'));
    await flush();
    expect(toasts()).toEqual([
      ['refused', 'SIM:A: staged with different values (1 and 2); nothing written'],
    ]);
    expect(dialogs()).toHaveLength(0);
    expect(sent).toEqual([]);
  });
});

describe('pinLiveToasts', () => {
  const isScreen = (key: string) => !key.startsWith('@');

  it('keeps an evicted screen with a live toast mounted, in strip order', () => {
    expect(pinLiveToasts(['a', 'd'], ['a', 'b', 'c', 'd'], ['c'], isScreen)).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('ignores closed keys and non-screens, and is the mount set unchanged with no live toast', () => {
    expect(pinLiveToasts(['a'], ['a', '@trace'], ['gone', '@trace'], isScreen)).toEqual(['a']);
    expect(pinLiveToasts(['a', 'b'], ['a', 'b', 'c'], [], isScreen)).toEqual(['a', 'b']);
  });
});
