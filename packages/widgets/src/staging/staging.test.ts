// The staging store: a value exists only while an entry for its channel is
// attached; a store answers for itself and the stores below it; a scope being
// written is busy above and below.
import { describe, expect, it, vi } from 'vitest';
import { createStagingStore, hasStage, stageScope, stagedText } from './staging.js';
import type { StagingStore } from './staging.js';

/** A store with entries attached for `pvs` in `scope`. */
function attached(store: StagingStore, scope: string, ...pvs: string[]) {
  return pvs.map((pv) => store.attach(scope, pv));
}

describe('a store alone', () => {
  it('holds one value per channel and scope, in the order first staged', () => {
    const store = createStagingStore();
    attached(store, 'view', 'A', 'B');
    attached(store, 'other', 'A');
    store.set('view', { pv: 'A', value: 1 });
    store.set('view', { pv: 'B', value: 2, entered: '2.0' });
    store.set('view', { pv: 'A', value: 3 });
    store.set('other', { pv: 'A', value: 9 });
    expect(store.list('view')).toEqual([
      { pv: 'A', value: 3 },
      { pv: 'B', value: 2, entered: '2.0' },
    ]);
    expect(store.count('view')).toBe(2);
    expect(store.get('view', 'B')).toEqual({ pv: 'B', value: 2, entered: '2.0' });
    expect(store.list('other')).toEqual([{ pv: 'A', value: 9 }]);
    expect(store.list('none')).toEqual([]);
  });

  it('stages nothing for a channel with no entry attached', () => {
    const store = createStagingStore();
    expect(store.set('view', { pv: 'A', value: 1 })).toBe(false);
    expect(store.list('view')).toEqual([]);
    const detach = store.attach('view', 'A');
    expect(store.set('view', { pv: 'A', value: 1 })).toBe(true);
    detach();
    expect(store.set('view', { pv: 'A', value: 2 })).toBe(false);
  });

  it('drops a value when the last entry for its channel detaches', () => {
    const store = createStagingStore();
    const [first, second] = attached(store, 'view', 'A', 'A');
    store.set('view', { pv: 'A', value: 1 });
    first();
    first();
    expect(store.list('view')).toEqual([{ pv: 'A', value: 1 }]);
    second();
    expect(store.list('view')).toEqual([]);
  });

  it('clears one channel, and with `only` just the value it was handed', () => {
    const store = createStagingStore();
    attached(store, 'view', 'A', 'B');
    const sent = { pv: 'A', value: 1 };
    store.set('view', sent);
    store.set('view', { pv: 'B', value: 2 });
    const again = { pv: 'A', value: 5 };
    store.set('view', again);
    store.clear('view', 'A', sent);
    expect(store.get('view', 'A')).toBe(again);
    store.clear('view', 'A', again);
    expect(store.list('view')).toEqual([{ pv: 'B', value: 2 }]);
  });

  it('notifies on a change and not on a clear of nothing', () => {
    const store = createStagingStore();
    attached(store, 'view', 'A');
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.clear('view', 'A');
    store.clearScope('view');
    expect(listener).not.toHaveBeenCalled();
    const before = store.version();
    store.set('view', { pv: 'A', value: 1 });
    store.clear('view', 'A');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.version()).not.toBe(before);
    stop();
    store.set('view', { pv: 'A', value: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('linked stores', () => {
  function tree() {
    const top = createStagingStore();
    const left = createStagingStore(top);
    const right = createStagingStore(top);
    const deep = createStagingStore(left);
    for (const s of [left, right, deep]) s.link();
    attached(top, 'set', 'T');
    attached(left, 'set', 'L');
    attached(right, 'set', 'R');
    attached(deep, 'set', 'D');
    right.set('set', { pv: 'R', value: 1 });
    deep.set('set', { pv: 'D', value: 2 });
    top.set('set', { pv: 'T', value: 3 });
    left.set('set', { pv: 'L', value: 4 });
    return { top, left, right, deep };
  }
  const pvs = (s: StagingStore) => s.list('set').map((v) => v.pv);

  it('a store lists its own values and those below it, never a sibling or an ancestor', () => {
    const { top, left, right, deep } = tree();
    expect(pvs(top)).toEqual(['R', 'D', 'T', 'L']);
    expect(pvs(left)).toEqual(['D', 'L']);
    expect(pvs(right)).toEqual(['R']);
    expect(pvs(deep)).toEqual(['D']);
    expect([top, left, right, deep].map((s) => s.count('set'))).toEqual([4, 2, 1, 1]);
    expect(left.get('set', 'D')).toBeUndefined();
  });

  it('clears its own values and those below it only', () => {
    const { top, left, deep } = tree();
    left.clearScope('set');
    expect(pvs(top)).toEqual(['R', 'T']);
    deep.clear('set', 'T');
    expect(pvs(top)).toEqual(['R', 'T']);
    top.clear('set', 'R');
    expect(pvs(top)).toEqual(['T']);
    expect(left.count('set')).toBe(0);
  });

  it('an unlinked store is no longer answered for', () => {
    const top = createStagingStore();
    const child = createStagingStore(top);
    const unlink = child.link();
    attached(child, 'set', 'C');
    child.set('set', { pv: 'C', value: 1 });
    expect(top.count('set')).toBe(1);
    unlink();
    expect(top.count('set')).toBe(0);
  });

  it('a change below notifies a listener above', () => {
    const { top, deep } = tree();
    const listener = vi.fn();
    top.subscribe(listener);
    deep.set('set', { pv: 'D', value: 7 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a scope being written is busy in the store, above it and below it, not beside it', () => {
    const { top, left, right, deep } = tree();
    const end = left.begin('set');
    expect([top, left, right, deep].map((s) => s.busy('set'))).toEqual([true, true, false, true]);
    expect(left.busy('other')).toBe(false);
    end();
    end();
    expect([top, left, right, deep].map((s) => s.busy('set'))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('stageScope', () => {
  it('is the stage prop when a non-empty string, else null', () => {
    expect(stageScope({ stage: 'view' })).toBe('view');
    for (const stage of ['', true, 1, null, undefined]) expect(stageScope({ stage })).toBeNull();
    expect(stageScope({})).toBeNull();
  });
});

describe('own values, held values, covering runs', () => {
  function pair() {
    const top = createStagingStore();
    const card = createStagingStore(top);
    card.link();
    top.attach('set', 'X');
    card.attach('set', 'X');
    const above = { pv: 'X', value: 1 };
    const below = { pv: 'X', value: 2 };
    top.set('set', above);
    card.set('set', below);
    return { top, card, above, below };
  }

  it('drop removes the value of this instance only', () => {
    const { top, card, below } = pair();
    top.drop('set', 'X');
    expect(top.list('set')).toEqual([below]);
    expect(card.get('set', 'X')).toBe(below);
  });

  it('holds says whether that very value is still there, here or below', () => {
    const { top, card, above, below } = pair();
    expect(top.holds('set', above)).toBe(true);
    expect(top.holds('set', below)).toBe(true);
    expect(card.holds('set', above)).toBe(false);
    expect(top.holds('set', { pv: 'X', value: 1 })).toBe(false);
    card.set('set', { pv: 'X', value: 2 });
    expect(top.holds('set', below)).toBe(false);
  });

  it('writing is a run started here or above, not one below', () => {
    const { top, card } = pair();
    const endCard = card.begin('set');
    expect([top.writing('set'), card.writing('set')]).toEqual([false, true]);
    endCard();
    const endTop = top.begin('set');
    expect([top.writing('set'), card.writing('set')]).toEqual([true, true]);
    endTop();
    expect(card.writing('set')).toBe(false);
  });
});

describe('hasStage', () => {
  it('is true for any stage but an absent one', () => {
    for (const stage of ['set', '', true, 0]) expect(hasStage({ stage })).toBe(true);
    for (const stage of [undefined, null]) expect(hasStage({ stage })).toBe(false);
    expect(hasStage({})).toBe(false);
  });
});

describe('stagedText', () => {
  const text = (value: number | string, entered?: string, decimals?: number) =>
    stagedText(entered === undefined ? { pv: 'A', value } : { pv: 'A', value, entered }, decimals);

  it('keeps the decimals the operator typed', () => {
    expect(text(2.5, '2.50')).toBe('2.50');
    expect(text(2.5, ' 2.50 ')).toBe('2.50');
    expect(text(3, '3')).toBe('3');
    expect(text(-0.5, '-.50')).toBe('-0.50');
    expect(text(7, '7.')).toBe('7');
  });

  it('takes the given precision for a number typed another way', () => {
    expect(text(0.001, '1e-3', 4)).toBe('0.0010');
    expect(text(16, '0x10', 2)).toBe('16.00');
  });

  it('never drops digits of the value and never shows an exponent', () => {
    expect(text(0.001, '1e-3', 2)).toBe('0.001');
    expect(text(1e-7, '1e-7')).toBe('0.0000001');
    expect(text(1.5e-9, '1.5e-9')).toBe('0.0000000015');
    expect(text(1e21, '1e21')).toBe('1000000000000000000000');
    expect(text(1e3, '1e3')).toBe('1000');
  });

  it('shows what a text channel will be sent', () => {
    expect(text('on', 'on')).toBe('on');
    expect(text(12, '12abc')).toBe('12');
  });
});
