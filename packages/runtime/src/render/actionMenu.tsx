// A click whose actions are alternatives, not a sequence.
//
// A converter sets `props.actionsAsMenu` where the source offers a widget's
// actions as a menu (a Phoebus action button without execute_as_one): a click
// then opens a menu of them (popupMenu.tsx) and only the action picked runs.
// Without the prop a click runs every action in order.

import type { Action, MacroValues } from '@slaclab/canopy-screen-ir';
import { substituteMacros } from '../macros.js';

/**
 * Whether a click offers `actions` as a menu: `props.actionsAsMenu` is a literal
 * true and there are two or more. (The screen-ir package's readActionsAsMenu,
 * once the runtime takes an SDK that has it.)
 */
export function offersMenu(
  props: Readonly<Record<string, unknown>>,
  actions: readonly Action[]
): boolean {
  return props.actionsAsMenu === true && actions.length >= 2;
}

/** The name a menu shows for `action`: its description, else what it does. */
export function actionName(action: Action, macros: MacroValues): string {
  const description = 'description' in action ? action.description : undefined;
  if (typeof description === 'string' && description.trim() !== '')
    return substituteMacros(description, macros);
  switch (action.type) {
    case 'write_pv':
      return `Write ${String(action.value)} to ${substituteMacros(action.pvName, macros)}`;
    case 'open_display':
    case 'open_file':
      return `Open ${substituteMacros(action.file, macros)}`;
    case 'open_webpage':
      return `Open ${substituteMacros(action.url, macros)}`;
    case 'execute':
      return `Run ${action.command}`;
    case 'close_display':
      return 'Close';
  }
}
