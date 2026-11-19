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
  for (const [pv, value] of [
    ['DEMO:A', 1],
    ['DEMO:B', 2],
    ['DEMO:C', 3],
  ] as const) {
    staging.attach('set', pv);
    staging.set('set', { pv, value, entered: String(value) });
  }
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
  return { gate, staging, sent, calls, press, toasts, staged };
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
});
