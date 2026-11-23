// Every widget write goes through this hook — the one place in this package
// that calls a PV handle's put (a static test holds that).
//
// With a provided WriteGate, a machine write becomes one gate run per user
// action. A local channel (loc://, formula://) and every write with no provider
// pass straight through the handle, exactly as before the gate existed.
//
// `disabled` and `reason` carry the gate's writes state for a machine write
// (a local channel or no provider is never disabled). A disabled write still
// goes to the gate, whose refusal sends nothing.
//
// A widget may ask for the confirmation dialog (`options.confirm`, the node's
// `confirmWrites` prop): its gate runs then carry `confirm: true`, and a
// momentary press is one [press, release] run, as it is when the gate itself
// asks. It changes nothing for a pass-through write.
//
// What the dialog says travels with every gate run (`options.dialog`: the
// node's `confirmTitle`, `confirmText`, `confirmVerb` and `confirmKind`, the
// widget's label and whether the run sets a value or is a press). It is read
// only by a gate that opens the dialog; it never opens one.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWriteGate, useWritesState } from './WriteGate.js';
import { WRITES_LIVE, allConfirmed } from './types.js';
import type {
  WriteDialogText,
  WriteGateService,
  WriteRequest,
  WriteRunOptions,
  WriteRunResult,
  WriteValue,
} from './types.js';

/** The part of a PV handle a write needs. */
export interface WritableHandle {
  readonly address: string;
  put(value: WriteValue): void;
}

/**
 * `'passthrough'`: written straight through the handle. `'skipped'`: nothing
 * written (no address, or a press while a hold is already in progress).
 * Otherwise the gate run's result.
 */
export type GatedWriteResult = 'passthrough' | 'skipped' | WriteRunResult;

export interface GatedWrite {
  /**
   * Steps whenever a gated run ends with anything but every write confirmed
   * (declined, refused, stopped, ...). Widgets that keep their own selection
   * state key on it, so a value that was not written is not left on screen.
   */
  resetKey: number;
  /**
   * One write as one run; `entered` is the text `value` was parsed from,
   * `chosen` the text of the item whose index `value` is, for the dialog.
   */
  write(
    value: WriteValue,
    options?: { entered?: string; chosen?: string }
  ): Promise<GatedWriteResult>;
  /**
   * A momentary press at pointerdown. With confirmation on (the gate's, or
   * the widget asking), `[press, release]`
   * is one run (both shown in the dialog, sent as a pulse). With it off, the
   * press runs now and the release is appended when the pointer comes up — a
   * window-level pointerup/pointercancel for `pointerId`, a document-level
   * lostpointercapture — or when the widget unmounts.
   */
  press(press: WriteValue, release: WriteValue, pointerId?: number): Promise<GatedWriteResult>;
  /** True while the machine does not accept this write: the widget renders inert. */
  disabled: boolean;
  /** Why it is disabled (its description and hover); null while not disabled. */
  reason: string | null;
}

/**
 * Channels that never reach the gate: they keep their per-instance router path.
 * Case-sensitive, as the runtime and its PV routers match them: `LOC://x` is a
 * machine channel and goes through the gate.
 */
const LOCAL_SCHEME = /^(loc|formula):\/\//;

/** Whether `address` is a channel that never reaches the gate (loc://, formula://). */
export function isLocalChannel(address: string): boolean {
  return LOCAL_SCHEME.test(address);
}

/** The gate a write to `address` goes through, or null to write straight through. */
function gateFor(gate: WriteGateService | null, address: string): WriteGateService | null {
  return gate === null || LOCAL_SCHEME.test(address) ? null : gate;
}

async function runGate(
  gate: WriteGateService,
  writes: readonly WriteRequest[],
  options?: WriteRunOptions
): Promise<WriteRunResult> {
  try {
    return await gate.run(writes, options);
  } catch {
    // The contract says run() never rejects; if it does, nothing is known to
    // be written, which is not all-confirmed.
    return [];
  }
}

/** What a widget asks of its gate runs. */
export interface GatedWriteOptions {
  /** Ask for the confirmation dialog before every run of this widget. */
  confirm?: boolean;
  /** What the dialog says when one opens (it opens none). */
  dialog?: WriteDialogText;
}

/**
 * The reserved prop a screen sets on the node that triggers a write (the
 * writing widget itself, or the node whose click carries the actions) to ask
 * for the dialog.
 */
export const CONFIRM_WRITES_PROP = 'confirmWrites';

/**
 * The reserved props a screen sets on the same node to word the dialog: its
 * title (a question), one sentence under it, the word on the confirm button,
 * and `confirmKind: "consequence"` for a write with consequences. They word a
 * dialog that opens; none of them opens one.
 */
export const CONFIRM_TITLE_PROP = 'confirmTitle';
export const CONFIRM_TEXT_PROP = 'confirmText';
export const CONFIRM_VERB_PROP = 'confirmVerb';
export const CONFIRM_KIND_PROP = 'confirmKind';
/** The older name of `confirmText`, read when `confirmText` is not set. */
export const CONFIRM_MESSAGE_PROP = 'confirmMessage';

/**
 * Whether a `confirmWrites` value asks for the dialog: every value does,
 * except an absent one, `false` and the string "false" (in any case, spaces
 * trimmed). A value this cannot read as a plain "no" asks: `"true"`, `1`, the
 * result of a macro.
 */
export function asksToConfirm(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  return !(typeof value === 'string' && value.trim().toLowerCase() === 'false');
}

/** A prop as dialog text: a string with something in it, trimmed. */
function words(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' ? undefined : text;
}

/**
 * What a node's props, and the widget drawing it (`about`: its label, and
 * whether its runs set a value or are a press), say in the confirmation
 * dialog; undefined when they say nothing.
 */
export function dialogText(
  props: Readonly<Record<string, unknown>>,
  about?: { label?: unknown; action?: WriteDialogText['action'] }
): WriteDialogText | undefined {
  const said: WriteDialogText = {};
  const title = words(props[CONFIRM_TITLE_PROP]);
  if (title !== undefined) said.title = title;
  const text = words(props[CONFIRM_TEXT_PROP]) ?? words(props[CONFIRM_MESSAGE_PROP]);
  if (text !== undefined) said.text = text;
  const verb = words(props[CONFIRM_VERB_PROP]);
  if (verb !== undefined) said.verb = verb;
  if (words(props[CONFIRM_KIND_PROP])?.toLowerCase() === 'consequence') said.kind = 'consequence';
  const label = words(about?.label);
  if (label !== undefined) said.label = label;
  if (about?.action !== undefined) said.action = about.action;
  return Object.keys(said).length === 0 ? undefined : said;
}

/**
 * The gated-write options a widget's props ask for; `about` is what the
 * widget itself adds to the dialog's wording (see `dialogText`).
 */
export function gatedWriteOptions(
  props: Readonly<Record<string, unknown>>,
  about?: { label?: unknown; action?: WriteDialogText['action'] }
): GatedWriteOptions {
  const asks = asksToConfirm(props[CONFIRM_WRITES_PROP]);
  const dialog = dialogText(props, about);
  if (dialog === undefined) return asks ? ASKS : ASKS_NOTHING;
  return asks ? { confirm: true, dialog } : { dialog };
}

const ASKS: GatedWriteOptions = Object.freeze({ confirm: true });
const ASKS_NOTHING: GatedWriteOptions = Object.freeze({});

/** The options of a gate run: the dialog asked for, and what it says. */
function runOptions(
  asks: boolean,
  dialog: WriteDialogText | undefined
): WriteRunOptions | undefined {
  if (dialog === undefined) return asks ? { confirm: true } : undefined;
  return asks ? { confirm: true, dialog } : { dialog };
}

export function useGatedWrite(handle: WritableHandle, options?: GatedWriteOptions): GatedWrite {
  const gate = useWriteGate();
  const asks = options?.confirm === true;
  const dialog = options?.dialog;
  const statement = useWritesState();
  const writes = gateFor(gate, handle.address) === null ? WRITES_LIVE : statement;
  const [resetKey, setResetKey] = useState(0);

  // The gate and handle of the latest commit, read by the stable callbacks.
  const latest = useRef({ gate, handle, asks, dialog });
  useLayoutEffect(() => {
    latest.current = { gate, handle, asks, dialog };
  });

  const mounted = useRef(false);
  // Ends the hold in progress (appends or writes its release), or null.
  const endHold = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      endHold.current?.();
    };
  }, []);

  const settle = useCallback((result: WriteRunResult) => {
    if (!allConfirmed(result) && mounted.current) setResetKey((k) => k + 1);
  }, []);

  const write = useCallback(
    async (
      value: WriteValue,
      options?: { entered?: string; chosen?: string }
    ): Promise<GatedWriteResult> => {
      const { gate, handle: h, asks, dialog } = latest.current;
      if (!h.address) return 'skipped';
      const g = gateFor(gate, h.address);
      if (g === null) {
        h.put(value);
        return 'passthrough';
      }
      const request: WriteRequest = { pv: h.address, value };
      if (options?.entered !== undefined) request.entered = options.entered;
      if (options?.chosen !== undefined) request.chosen = options.chosen;
      const result = await runGate(g, [request], runOptions(asks, dialog));
      settle(result);
      return result;
    },
    [settle]
  );

  const press = useCallback(
    async (
      pressValue: WriteValue,
      releaseValue: WriteValue,
      pointerId?: number
    ): Promise<GatedWriteResult> => {
      if (endHold.current) return 'skipped'; // one run per click
      const { gate, handle: h, asks, dialog } = latest.current;
      const pv = h.address;
      if (!pv) return 'skipped';
      const g = gateFor(gate, pv);
      const releaseWrite: WriteRequest = { pv, value: releaseValue, release: true };

      if (g !== null && (asks || g.confirmWrites())) {
        const result = await runGate(
          g,
          [{ pv, value: pressValue }, releaseWrite],
          runOptions(asks, dialog)
        );
        settle(result);
        return result;
      }

      // A hold: the release follows the pointer coming up (or unmount).
      const appended: { release?: () => void } = {};
      const tail =
        g === null
          ? null
          : new Promise<readonly WriteRequest[]>((resolve) => {
              appended.release = () => resolve([releaseWrite]);
            });

      const onPointerEnd = (e: Event) => {
        const id = (e as PointerEvent).pointerId;
        if (pointerId !== undefined && id !== undefined && id !== pointerId) return;
        end();
      };
      const end = () => {
        if (endHold.current !== end) return;
        endHold.current = null;
        window.removeEventListener('pointerup', onPointerEnd);
        window.removeEventListener('pointercancel', onPointerEnd);
        document.removeEventListener('lostpointercapture', onPointerEnd);
        if (tail === null) h.put(releaseValue);
        else appended.release?.();
      };
      endHold.current = end;
      window.addEventListener('pointerup', onPointerEnd);
      window.addEventListener('pointercancel', onPointerEnd);
      document.addEventListener('lostpointercapture', onPointerEnd);

      if (g === null || tail === null) {
        h.put(pressValue);
        return 'passthrough';
      }
      const result = await runGate(
        g,
        [{ pv, value: pressValue }],
        dialog === undefined ? { tail } : { tail, dialog }
      );
      settle(result);
      return result;
    },
    [settle]
  );

  const { disabled, reason } = writes;
  return useMemo(
    () => ({ resetKey, write, press, disabled, reason }),
    [resetKey, write, press, disabled, reason]
  );
}
