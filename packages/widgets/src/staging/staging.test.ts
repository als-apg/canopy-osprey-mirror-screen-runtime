// The staging store: one value per channel and scope, kept in the order the
// channels were first staged, dropped one at a time or by scope.
import { describe, expect, it, vi } from 'vitest';
import { createStagingStore, stageScope } from './staging.js';

describe('createStagingStore', () => {
  it('holds one value per channel and scope, in the order first staged', () => {
    const store = createStagingStore();
    store.set('view', { pv: 'A', value: 1 });
    store.set('view', { pv: 'B', value: 2, entered: '2.0' });
    store.set('view', { pv: 'A', value: 3 });
    store.set('other', { pv: 'A', value: 9 });
    expect(store.list('view')).toEqual([
      { pv: 'A', value: 3 },
      { pv: 'B', value: 2, entered: '2.0' },
    ]);
    expect(store.get('view', 'B')).toEqual({ pv: 'B', value: 2, entered: '2.0' });
    expect(store.list('other')).toEqual([{ pv: 'A', value: 9 }]);
    expect(store.list('none')).toEqual([]);
  });

  it('keeps one list identity until the scope changes', () => {
    const store = createStagingStore();
    store.set('view', { pv: 'A', value: 1 });
    const first = store.list('view');
    expect(store.list('view')).toBe(first);
    store.set('other', { pv: 'X', value: 1 });
    expect(store.list('view')).toBe(first);
    store.set('view', { pv: 'B', value: 1 });
    expect(store.list('view')).not.toBe(first);
  });

  it('clears one channel, and with `only` just the value it was handed', () => {
    const store = createStagingStore();
    const sent = { pv: 'A', value: 1 };
    store.set('view', sent);
    store.set('view', { pv: 'B', value: 2 });
    const again = { pv: 'A', value: 5 };
    store.set('view', again);
    store.clear('view', 'A', sent);
    expect(store.get('view', 'A')).toBe(again);
    store.clear('view', 'A', again);
    expect(store.list('view')).toEqual([{ pv: 'B', value: 2 }]);
    store.clear('view', 'B');
    expect(store.list('view')).toEqual([]);
  });

  it('clears a scope and leaves the others', () => {
    const store = createStagingStore();
    store.set('view', { pv: 'A', value: 1 });
    store.set('other', { pv: 'A', value: 2 });
    store.clearScope('view');
    expect(store.list('view')).toEqual([]);
    expect(store.list('other')).toEqual([{ pv: 'A', value: 2 }]);
  });

  it('notifies on a change and not on a clear of nothing', () => {
    const store = createStagingStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.clear('view', 'A');
    store.clearScope('view');
    expect(listener).not.toHaveBeenCalled();
    store.set('view', { pv: 'A', value: 1 });
    store.clear('view', 'A');
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    store.set('view', { pv: 'A', value: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('stageScope', () => {
  it('is the stage prop when a non-empty string, else null', () => {
    expect(stageScope({ stage: 'view' })).toBe('view');
    for (const stage of ['', true, 1, null, undefined]) expect(stageScope({ stage })).toBeNull();
    expect(stageScope({})).toBeNull();
  });
});
