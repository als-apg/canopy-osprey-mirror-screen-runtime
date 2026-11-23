// The words of the confirmation dialog, as pure functions of the run's writes,
// what the run says (`WriteDialogText`: the screen's `confirmTitle`,
// `confirmText`, `confirmVerb` and `confirmKind`, the widget's label and
// action) and the live data of the channels.
//
// The title is a question saying what happens, and the confirm button says
// the action. Both come from the screen when it gives them; otherwise they are
// built here:
//
//   what the run is                       title                           button
//   a press of a labelled control         "<label>?"                      "<label>"
//   one value set (an entry, a slider)    "Set <label or channel> to      "Set"
//                                          <value> <unit>?"
//   one staged value applied              "Set <channel> to <value>       "Set"
//                                          <unit>?"
//   several values, no labelled press     "Apply N changes?"              "Apply N"
//   one write, nothing else known         "Write <value> to <channel>?"   "Write"
//
// A press and its release on one channel (a momentary button under a dialog)
// count as one change. A label longer than VERB_LABEL_MAX is not used as the
// button's word.

import type { PVData } from '@slaclab/canopy-client';
import type { WriteDialogText, WriteRequest } from '@slaclab/canopy-screen-widgets';
import type { ControlLimits } from './gate.js';

/** What "now" says for a channel that has no live value. */
export const NOT_CONNECTED = 'not connected';
/** What "now" says for a connected channel that holds no value. */
export const NO_VALUE = 'no value';
/** What the difference says when the write changes nothing. */
export const NO_CHANGE = 'no change';
/** The longest widget label used as the confirm button's word. */
export const VERB_LABEL_MAX = 24;

/** A value as it is written: text in quotes, anything else as it prints. */
export function formatValue(value: WriteRequest['value']): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** True for a momentary press and its release on one channel: one pulse. */
export function isPulse(writes: readonly WriteRequest[]): boolean {
  return (
    writes.length === 2 &&
    writes[0]!.release !== true &&
    writes[1]!.release === true &&
    writes[0]!.pv === writes[1]!.pv
  );
}

/** How many changes the run makes: its writes, a pulse counted once. */
export function changeCount(writes: readonly WriteRequest[]): number {
  return isPulse(writes) ? 1 : writes.length;
}

/** The unit a channel states, or '' when it states none or is not known. */
export function unitOf(data: PVData | undefined): string {
  return typeof data?.units === 'string' ? data.units.trim() : '';
}

/**
 * The value a write sends, as text: the item chosen by its index, else the
 * value, a number with the channel's `unit`.
 */
export function writtenText(w: WriteRequest, unit: string): string {
  if (w.chosen !== undefined) return w.chosen;
  const value = formatValue(w.value);
  return typeof w.value === 'number' && unit !== '' ? `${value} ${unit}` : value;
}

/** The text a value was typed as, when it reads differently from the value. */
export function enteredNote(w: WriteRequest): string | null {
  if (w.chosen !== undefined) return null;
  const entered = w.entered?.trim();
  if (entered === undefined || entered === formatValue(w.value)) return null;
  return `(entered ${JSON.stringify(entered)})`;
}

/**
 * What a channel holds now, as text; `known` is false when it has no live
 * value, and the text then says so plainly.
 */
export function nowText(data: PVData | undefined): { text: string; known: boolean } {
  if (!data?.connected) return { text: NOT_CONNECTED, known: false };
  const unit = unitOf(data);
  if (typeof data.displayValue === 'string' && data.displayValue !== '') {
    const shown = data.displayValue;
    const bare = typeof data.value === 'number' && unit !== '' && !shown.endsWith(unit);
    return { text: bare ? `${shown} ${unit}` : shown, known: true };
  }
  if (data.value === undefined || data.value === null || data.value === '') {
    return { text: NO_VALUE, known: false };
  }
  return { text: String(data.value), known: true };
}

/** The decimals a number prints with. */
function decimals(n: number): number {
  const text = String(n);
  const exponent = /e-(\d+)$/.exec(text);
  const fraction = /\.(\d+)/.exec(text);
  return (fraction ? fraction[1]!.length : 0) + (exponent ? Number(exponent[1]) : 0);
}

/**
 * How far a numeric write moves the channel from its live value, signed
 * ("+0.0150"), or null where that is not a number minus a number: text, an
 * item chosen by index, an enum channel, no live value.
 */
export function differenceText(data: PVData | undefined, w: WriteRequest): string | null {
  if (w.chosen !== undefined || typeof w.value !== 'number') return null;
  if (!data?.connected || typeof data.value !== 'number' || data.enumChoices !== undefined) {
    return null;
  }
  const difference = w.value - data.value;
  if (!Number.isFinite(difference)) return null;
  const stated = Number.isInteger(data.precision) && data.precision > 0 ? data.precision : 0;
  const places = Math.min(12, Math.max(stated, decimals(w.value), decimals(data.value)));
  const text = difference.toFixed(places);
  if (Number(text) === 0) return NO_CHANGE;
  return difference > 0 ? `+${text}` : text;
}

/** The limits row: "<low> … <high> <unit>". */
export function limitsText(limits: ControlLimits, unit: string): string {
  const range = `${limits.low} … ${limits.high}`;
  return unit === '' ? range : `${range} ${unit}`;
}

/** A label as a question. */
function question(label: string): string {
  const bare = label.replace(/[\s.:…]+$/u, '');
  if (bare === '') return `${label}?`;
  return bare.endsWith('?') ? bare : `${bare}?`;
}

/** Whether the run is the press of a labelled control. */
function labelledPress(say: WriteDialogText | null): say is WriteDialogText & { label: string } {
  return say?.label !== undefined && say.action !== 'set' && say.action !== 'apply';
}

/**
 * The dialog's title: the screen's, else a question built from the run (see
 * the table above). `unit` gives the unit of a channel ('' for none).
 */
export function dialogTitle(
  writes: readonly WriteRequest[],
  say: WriteDialogText | null,
  unit: (pv: string) => string
): string {
  if (say?.title !== undefined) return say.title;
  if (labelledPress(say)) return question(say.label);
  const n = changeCount(writes);
  if (n === 0) return 'Write?';
  if (n !== 1) return `Apply ${n} changes?`;
  const w = writes[0]!;
  const value = writtenText(w, unit(w.pv));
  if (say?.action === 'set') return `Set ${say.label ?? w.pv} to ${value}?`;
  if (say?.action === 'apply') return `Set ${w.pv} to ${value}?`;
  return `Write ${value} to ${w.pv}?`;
}

/** The word on the confirm button: the screen's, else built from the run. */
export function dialogVerb(writes: readonly WriteRequest[], say: WriteDialogText | null): string {
  if (say?.verb !== undefined) return say.verb;
  if (labelledPress(say) && say.label.length <= VERB_LABEL_MAX) return say.label;
  const n = changeCount(writes);
  if (n > 1) return `Apply ${n}`;
  return say?.action === 'set' || say?.action === 'apply' ? 'Set' : 'Write';
}
