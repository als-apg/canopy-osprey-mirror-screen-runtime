// The runtime's own action types, beside the screen IR's: `apply_staged`
// writes every value staged in a scope (entries whose `stage` prop names it)
// as one run through the write gate, and `clear_staged` drops them unwritten.
// Neither names a channel: the channels are those of the staging entries.
//
// The screen IR's `readActions` drops a list holding a type it does not know,
// so the renderer reads a node's actions with `readNodeActions`, which also
// takes these two.

import { isAction } from '@slaclab/canopy-screen-ir';
import type { Action } from '@slaclab/canopy-screen-ir';

export interface ApplyStagedAction {
  type: 'apply_staged';
  /** The staging scope to write; macros are substituted. */
  scope: string;
  description?: string;
}

export interface ClearStagedAction {
  type: 'clear_staged';
  /** The staging scope to drop; macros are substituted. */
  scope: string;
  description?: string;
}

export type StagingAction = ApplyStagedAction | ClearStagedAction;

/** Every action the runtime runs: the screen IR's and its own. */
export type RuntimeAction = Action | StagingAction;

export function isStagingAction(value: unknown): value is StagingAction {
  if (typeof value !== 'object' || value === null) return false;
  const action = value as Record<string, unknown>;
  return (
    (action.type === 'apply_staged' || action.type === 'clear_staged') &&
    typeof action.scope === 'string' &&
    action.scope !== '' &&
    (action.description === undefined || typeof action.description === 'string')
  );
}

/**
 * A node's click actions (`props.actions`): the list when every entry is a
 * screen IR action or a staging action, else none, as the screen IR's
 * `readActions` reads a list of its own types.
 */
export function readNodeActions(props: Readonly<Record<string, unknown>>): RuntimeAction[] {
  const actions = props.actions;
  if (!Array.isArray(actions)) return [];
  if (!actions.every((a) => isStagingAction(a) || isAction(a))) return [];
  return [...(actions as RuntimeAction[])];
}
