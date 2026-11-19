// The runtime's staging actions: the guard, and reading a node's action list
// exactly as the screen IR reads one that holds only its own types.
import { describe, expect, it } from 'vitest';
import { readActions } from '@slaclab/canopy-screen-ir';
import { isStagingAction, readNodeActions } from './staged.js';

describe('isStagingAction', () => {
  it('takes apply_staged and clear_staged with a non-empty scope', () => {
    expect(isStagingAction({ type: 'apply_staged', scope: 'view' })).toBe(true);
    expect(isStagingAction({ type: 'clear_staged', scope: 'view', description: 'Reset' })).toBe(
      true
    );
  });

  it('refuses anything else', () => {
    for (const value of [
      null,
      'apply_staged',
      { type: 'apply_staged' },
      { type: 'apply_staged', scope: '' },
      { type: 'apply_staged', scope: 3 },
      { type: 'apply_staged', scope: 'view', description: 3 },
      { type: 'write_pv', pvName: 'A', value: 1 },
      { type: 'stage', scope: 'view' },
    ]) {
      expect(isStagingAction(value)).toBe(false);
    }
  });
});

describe('readNodeActions', () => {
  const IR_LISTS: unknown[] = [
    undefined,
    'nope',
    [],
    [{ type: 'write_pv', pvName: 'A', value: 1 }],
    [{ type: 'write_pv', pvName: 'A', value: 1 }, { type: 'close_display' }],
    [{ type: 'open_webpage', url: 'https://example.org/' }],
    [{ type: 'write_pv', pvName: 'A' }],
    [{ type: 'write_pv', pvName: 'A', value: 1 }, { type: 'no_such_action' }],
    [null],
  ];

  it('reads a list of screen IR actions exactly as the screen IR does', () => {
    for (const actions of IR_LISTS) {
      expect(readNodeActions({ actions })).toEqual(readActions({ actions } as never));
    }
  });

  it('takes staging actions, alone or beside screen IR actions', () => {
    const actions = [
      { type: 'apply_staged', scope: 'view' },
      { type: 'close_display' },
      { type: 'clear_staged', scope: 'other' },
    ];
    expect(readNodeActions({ actions })).toEqual(actions);
  });

  it('reads no action from a list with a malformed staging action', () => {
    expect(
      readNodeActions({ actions: [{ type: 'close_display' }, { type: 'apply_staged' }] })
    ).toEqual([]);
  });
});
