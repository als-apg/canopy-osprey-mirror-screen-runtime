// The two halves joined: the runtime's `apply_staged` dispatch over the
// viewer's real write gate and a real staging store, on a fake Hare backend.
// What is sent, what stays staged and what the operator is told, on a full
// run, a stop and a decline.
import { describe, expect, it } from 'vitest';
import type { HareHeartbeatState, SubmitOptions, WriteOutcome } from '@slaclab/canopy-client';
import { dispatchActions } from '@slaclab/canopy-screen-runtime';
import type { ActionContext } from '@slaclab/canopy-screen-runtime';
import { createStagingStore } from '@slaclab/canopy-screen-widgets';
import { createWriteGate } from './gate.js';
import type { WriteBackend } from './gate.js';

const ORIGIN = { screen: 'demo/set', rev: 'r1' };
const tick = () => new Promise((r) => setTimeout(r, 0));

function outcome(kind: WriteOutcome['outcome'], detail: string = kind): WriteOutcome {
  return { outcome: kind, code: null, status: null, detail, coalesced: false };
}

function setup(answers: Array<WriteOutcome | Error>, confirmWrites = false) {
  const sent: Array<{ pv: string; value: unknown; options: SubmitOptions }> = [];
  const hb: HareHeartbeatState = { seen: true, binding: 'sim@1' };
  const backend: WriteBackend = {
    heartbeat: () => ({ ...hb }),
    linkUp: () => true,
    submit: async (pv, value, options) => {
      sent.push({ pv, value, options });
      onFirst?.();
      onFirst = null;
      const next = answers.shift() ?? outcome('confirmed', 'written');
      if (next instanceof Error) throw next;
      return next;
    },
    onHeartbeat: () => () => {},
    confirmWrites: () => confirmWrites,
    machineLabel: () => 'Simulator',
    writes: () => ({ writes: null, seen: false }),
  };
  const gate = createWriteGate(backend, ORIGIN);
  const staging = createStagingStore();
  const detachers = new Map<string, () => void>();
  for (const [pv, value] of [
    ['DEMO:A', 1],
    ['DEMO:B', 2],
    ['DEMO:C', 3],
  ] as const) {
    detachers.set(pv, staging.attach('set', pv));
    staging.set('set', { pv, value, entered: String(value) });
  }
  /** The entry of `pv` leaves the screen. */
  const detach = (pv: string) => detachers.get(pv)?.();
  let onFirst: (() => void) | null = null;
  /** The entry of `pv` leaves the screen when the first write is answered. */
  const hideOnFirstWrite = (pv: string) => {
    onFirst = () => detach(pv);
    return () => {
      onFirst = null;
    };
  };
  const calls: string[] = [];
  const ctx = (confirm: boolean): ActionContext => ({
    macros: {},
    pvService: { put: (pv) => void calls.push(`put ${pv}`) },
    resolveManifest: () => null,
    navigate: () => {},
    openWindow: () => {},
    close: () => void calls.push('close'),
    showError: (m) => void calls.push(`error ${m}`),
    gate,
    staging,
    confirm,
  });
  const press = (confirm = false) =>
    dispatchActions(
      [{ type: 'apply_staged', scope: 'set' }, { type: 'close_display' }],
      ctx(confirm)
    );
  const toasts = () => gate.getSnapshot().toasts.map((t) => [t.outcome, t.text]);
  const staged = () => staging.list('set').map((v) => v.pv);
  return { gate, staging, sent, calls, press, toasts, staged, detach, hideOnFirstWrite };
}

describe('apply_staged through the write gate', () => {
  it('writes every staged value as single-channel writes, in order, and clears them', async () => {
    const t = setup([]);
    await t.press();
    expect(t.sent.map((s) => [s.pv, s.value])).toEqual([
      ['DEMO:A', 1],
      ['DEMO:B', 2],
      ['DEMO:C', 3],
    ]);
    expect(t.sent.every((s) => s.options.confirmed === undefined)).toBe(true);
    expect(t.staged()).toEqual([]);
    expect(t.toasts()).toEqual([['confirmed', 'written']]);
    expect(t.calls).toEqual(['close']);
  });

  it('stops at a refused write: sent stays sent, the refused and the unsent stay staged', async () => {
    const t = setup([outcome('confirmed'), outcome('refused', 'above the limit')]);
    await t.press();
    expect(t.sent.map((s) => s.pv)).toEqual(['DEMO:A', 'DEMO:B']);
    expect(t.staged()).toEqual(['DEMO:B', 'DEMO:C']);
    expect(t.toasts()).toEqual([['refused', 'DEMO:B: not sent; above the limit (1 of 3 written)']]);
    expect(t.calls).toEqual([]);
    expect(t.staging.busy('set')).toBe(false);
  });

  it('stops at a readback mismatch and says the value was sent', async () => {
    const t = setup([outcome('mismatch', 'read back 0.9')]);
    await t.press();
    expect(t.sent.map((s) => s.pv)).toEqual(['DEMO:A']);
    expect(t.staged()).toEqual(['DEMO:A', 'DEMO:B', 'DEMO:C']);
    expect(t.toasts()).toEqual([
      ['mismatch', 'DEMO:A: sent, readback differs; read back 0.9 (1 of 3 written)'],
    ]);
    expect(t.calls).toEqual([]);
  });

  it('a backend that throws mid-run keeps what was confirmed before it', async () => {
    const t = setup([outcome('confirmed'), new Error('boom')]);
    await t.press();
    expect(t.sent.map((s) => s.pv)).toEqual(['DEMO:A', 'DEMO:B']);
    expect(t.staged()).toEqual(['DEMO:B', 'DEMO:C']);
    expect(t.toasts()[0][1]).toMatch(/^DEMO:B: may have been sent; .* \(1 of 3 written\)$/);
  });

  it('a node that asks: one dialog listing every value; Cancel sends nothing and keeps all staged', async () => {
    const t = setup([]);
    const pressed = t.press(true);
    await tick();
    const dialog = t.gate.getSnapshot().dialog!;
    expect(dialog.writes.map((w) => [w.pv, w.value])).toEqual([
      ['DEMO:A', 1],
      ['DEMO:B', 2],
      ['DEMO:C', 3],
    ]);
    expect(t.sent).toEqual([]);
    expect(t.staging.busy('set')).toBe(true);
    t.gate.decline(dialog.id);
    await pressed;
    expect(t.sent).toEqual([]);
    expect(t.staged()).toEqual(['DEMO:A', 'DEMO:B', 'DEMO:C']);
    expect(t.toasts()).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(t.staging.busy('set')).toBe(false);
  });

  it('a node that asks: Write sends them confirmed', async () => {
    const t = setup([]);
    const pressed = t.press(true);
    await tick();
    t.gate.confirm(t.gate.getSnapshot().dialog!.id);
    await pressed;
    expect(t.sent.map((s) => s.options.confirmed)).toEqual([true, true, true]);
    expect(t.staged()).toEqual([]);
  });

  it('the deployment asking opens the dialog without the node asking', async () => {
    const t = setup([], true);
    const pressed = t.press(false);
    await tick();
    expect(t.gate.getSnapshot().dialog).not.toBeNull();
    t.gate.decline(t.gate.getSnapshot().dialog!.id);
    await pressed;
    expect(t.sent).toEqual([]);
  });

  it('write 1 takes entry 3 off the screen: the run stops there, the rest stays staged', async () => {
    const t = setup([]);
    const detach = t.staging.attach('set', 'DEMO:X');
    t.staging.set('set', { pv: 'DEMO:X', value: 9 });
    // DEMO:C's only entry goes when the first write is answered.
    const sentBefore = t.sent.length;
    const hide = t.hideOnFirstWrite('DEMO:C');
    await t.press();
    hide();
    detach();
    expect(t.sent.slice(sentBefore).map((s) => s.pv)).toEqual(['DEMO:A', 'DEMO:B']);
    expect(t.toasts()).toEqual([
      ['refused', 'DEMO:C: not sent; no longer on screen (2 of 4 written)'],
    ]);
    expect(t.calls).toEqual([]);
  });

  it('an entry hidden while the dialog is open: confirming sends nothing', async () => {
    const t = setup([]);
    const pressed = t.press(true);
    await tick();
    t.detach('DEMO:B');
    t.gate.confirm(t.gate.getSnapshot().dialog!.id);
    await pressed;
    expect(t.sent).toEqual([]);
    expect(t.toasts()).toEqual([
      ['refused', 'DEMO:B: not sent; no longer on screen (0 of 3 written)'],
    ]);
    expect(t.staged()).toEqual(['DEMO:A', 'DEMO:C']);
  });

  it('one channel staged with two values: nothing sent, the toast names channel and values', async () => {
    const t = setup([]);
    const card = createStagingStore(t.staging);
    card.link();
    card.attach('set', 'DEMO:B');
    card.set('set', { pv: 'DEMO:B', value: 2.5, entered: '2.5' });
    await t.press(true);
    expect(t.gate.getSnapshot().dialog).toBeNull();
    expect(t.sent).toEqual([]);
    expect(t.toasts()).toEqual([
      ['refused', 'DEMO:B: staged with different values (2 and 2.5); nothing written'],
    ]);
    expect(t.calls).toEqual([]);
    expect(
      t.staging
        .list('set')
        .filter((v) => t.staging.marked(v))
        .map((v) => v.value)
    ).toEqual([2, 2.5]);
  });
});
