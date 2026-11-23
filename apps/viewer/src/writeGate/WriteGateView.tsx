// The screen's write gate in React: created per screen, provided to the
// widgets and the action dispatcher through the widgets' WriteGate context,
// and rendered as one confirmation dialog (Carbon modal) and the summary
// toasts (Carbon toasts).
//
// DOM contract (read by the run drivers): data-testid `canopy-write-dialog`
// on the dialog, `canopy-write-confirm` / `canopy-write-decline` on its two
// buttons, `canopy-write-toast` on each toast's text (exactly the summary)
// with `data-outcome` set to the summary's outcome ('confirmed' for
// "written", an outcome kind, 'coalesced', or 'guarded' for a run the window's
// input guard refused: "screen just changed, nothing sent").
// Further dialog hooks: the dialog carries `data-target-kind` ('machine' |
// 'simulation' | 'test' | 'unknown') and `data-target-notice` for what is
// written to, named in its first line (class `canopy-write-target`), and
// `data-kind` 'consequence' for a write the screen marks as one with
// consequences; `canopy-write-title`, `canopy-write-text` (the screen's
// sentence), `canopy-write-current` (each "now" value) and
// `canopy-write-value` (each value about to be written).
//
// The dialog, top to bottom: the target; a title that is a question saying
// what happens; the screen's sentence, when it gives one; the writes; Cancel
// and the confirm button, which says the action. One change is drawn as
// labelled rows (channel, now, writes, and for a value the operator chose the
// step it makes and the channel's control limits), several as a table with
// right-aligned "now" and "writes" columns. "now" is the value the channel
// holds, read live from the screen's PV service while the dialog is open; a
// channel with no live value says "not connected". The wording is built in
// dialogWords.ts.
//
// Keys: focus starts on Cancel, and nothing makes the confirm button the
// answer to Enter. Escape and the close mark decline. The dialog opens inside
// the event that asked for it (a text input's Enter keydown), and the browser
// delivers the rest of that key press to the button that now holds focus;
// Cancel ignores an Enter it did not see go down, so the key that opened the
// dialog cannot answer it.
// Each toast sits in a `canopy-write-toasts__item` wrapper that holds it (the
// gate's holdToast/releaseToast) while hovered or focused.
//
// Where the toasts go (toastHost.tsx): under a workspace's WriteToastHost
// they are portalled into its one shared, viewport-level column, as one group
// per screen (`data-screen-title`), each toast headed by the screen's tab
// title (`canopy-write-toast-screen`, outside the contract element); without
// one they render in place, in the screen's own fixed stack, as before. The
// dialog always renders in place: a fixed, viewport-level child of its
// screen, hidden and inert with it.

import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  ComposedModal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ToastNotification,
} from '@carbon/react';
import type { PVData, PVWriteOrigin } from '@slaclab/canopy-client';
import { PVServiceContext } from '@slaclab/canopy-react';
import { WriteGate } from '@slaclab/canopy-screen-widgets';
import type { WriteRequest } from '@slaclab/canopy-screen-widgets';
import {
  changeCount,
  dialogTitle,
  dialogVerb,
  differenceText,
  enteredNote,
  isPulse,
  limitsText,
  nowText,
  unitOf,
  writtenText,
} from './dialogWords.js';
import { createWriteGate } from './gate.js';
import type { ScreenWriteGate, WriteBackend, WriteDialogState, WriteToastState } from './gate.js';
import { TOASTS_STYLE, useWriteToastHost } from './toastHost.js';
import './WriteGateView.css';

/**
 * The gate of one open screen, or null without a backend (mock and fixture
 * mode): the widgets then write straight through. A new gate per `key` (the
 * screen); queued runs are dropped when the screen changes or unmounts.
 */
export function useScreenWriteGate(
  backend: WriteBackend | undefined,
  origin: PVWriteOrigin,
  key: string
): ScreenWriteGate | null {
  const gate = useMemo(
    () => (backend ? createWriteGate(backend, origin) : null),
    // origin: kept current below, without a new gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backend, key]
  );
  const screen = origin.screen;
  const rev = origin.rev ?? null;
  useLayoutEffect(() => {
    gate?.setOrigin({ screen, rev });
  }, [gate, screen, rev]);
  useEffect(() => {
    if (!gate) return;
    gate.activate();
    return () => gate.dispose();
  }, [gate]);
  return gate;
}

const NO_GATE = {
  subscribe: () => () => {},
  getSnapshot: () => null,
};

function toastKind(t: WriteToastState): 'success' | 'warning' | 'error' {
  switch (t.outcome) {
    case 'confirmed':
      return 'success';
    case 'mismatch':
    case 'unconfirmed':
    case 'unknown':
    case 'coalesced':
    case 'guarded':
      return 'warning';
    default:
      return 'error';
  }
}

/** The live data of a channel, or undefined while it has delivered none. */
type Live = (pv: string) => PVData | undefined;

/**
 * The live data of each of `pvs`, read from the PV service in context (each
 * channel subscribed once, while mounted). With no service no channel has any.
 */
function useLiveValues(pvs: readonly string[]): Live {
  const service = useContext(PVServiceContext);
  const key = [...new Set(pvs)].join('\n');
  const [received, setReceived] = useState<{ key: string; data: Record<string, PVData> }>({
    key,
    data: {},
  });
  useEffect(() => {
    if (!service || key === '') return;
    let active = true;
    const stops = key.split('\n').map((pv) =>
      service.subscribe(pv, (data) => {
        if (active) {
          setReceived((prev) => ({
            key,
            data: { ...(prev.key === key ? prev.data : {}), [pv]: data },
          }));
        }
      })
    );
    return () => {
      active = false;
      for (const stop of stops) stop();
    };
  }, [service, key]);
  return (pv) => (received.key === key ? received.data[pv] : undefined) ?? service?.getSnapshot(pv);
}

/** The "now" value of a channel: what it holds, or plainly that it holds nothing. */
function Now({ data }: { data: PVData | undefined }) {
  const now = nowText(data);
  return (
    <code
      className={now.known ? undefined : 'canopy-write-dialog__none'}
      data-testid="canopy-write-current"
      data-known={now.known ? 'true' : 'false'}
    >
      {now.text}
    </code>
  );
}

/** The value a write sends, emphasised, and the text it was typed as when that reads differently. */
function Written({ write, unit }: { write: WriteRequest; unit: string }) {
  const entered = enteredNote(write);
  return (
    <>
      <strong data-testid="canopy-write-value">{writtenText(write, unit)}</strong>
      {entered === null ? '' : ` ${entered}`}
    </>
  );
}

/**
 * One change as labelled rows; a row whose content is not known is left out.
 * `sets`: the value is one the operator chose (an entry, a slider, a staged
 * value), so the step it makes and the channel's limits are shown; the fixed
 * value of a press has neither row.
 */
function WriteRows({
  writes,
  live,
  gate,
  sets,
}: {
  writes: readonly WriteRequest[];
  live: Live;
  gate: ScreenWriteGate;
  sets: boolean;
}) {
  const write = writes[0]!;
  const data = live(write.pv);
  const unit = unitOf(data);
  const difference = sets ? differenceText(data, write) : null;
  const limits = sets && typeof write.value === 'number' ? gate.controlLimits(write.pv) : null;
  const release = isPulse(writes) ? writes[1]! : null;
  // A table too, with its labels as row headers: the host contract reads the
  // dialog's values at `.canopy-write-dialog__writes td`.
  return (
    <table className="canopy-write-dialog__writes canopy-write-dialog__rows">
      <tbody>
        <tr className="canopy-write-dialog__row">
          <th scope="row">channel</th>
          <td>
            <code>{write.pv}</code>
          </td>
        </tr>
        <tr className="canopy-write-dialog__row">
          <th scope="row">now</th>
          <td>
            <Now data={data} />
          </td>
        </tr>
        <tr className="canopy-write-dialog__row">
          <th scope="row">writes</th>
          <td>
            <code>
              <Written write={write} unit={unit} />
              {write.release ? ' (release)' : ''}
              {difference !== null && (
                <span className="canopy-write-dialog__more" data-testid="canopy-write-difference">
                  {difference}
                </span>
              )}
              {release !== null && (
                <span className="canopy-write-dialog__more" data-testid="canopy-write-release">
                  then {writtenText(release, unit)} (release)
                </span>
              )}
            </code>
          </td>
        </tr>
        {limits !== null && (
          <tr className="canopy-write-dialog__row">
            <th scope="row">limits</th>
            <td>
              <code data-testid="canopy-write-limits">{limitsText(limits, unit)}</code>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Several changes as a table: the channel, and right-aligned "now" and "writes". */
function WritesTable({ writes, live }: { writes: readonly WriteRequest[]; live: Live }) {
  return (
    <table className="canopy-write-dialog__writes canopy-write-dialog__columns">
      <thead>
        <tr>
          <th scope="col">channel</th>
          <th scope="col" className="canopy-write-dialog__n">
            now
          </th>
          <th scope="col" className="canopy-write-dialog__n">
            writes
          </th>
        </tr>
      </thead>
      <tbody>
        {writes.map((w, i) => {
          const data = live(w.pv);
          return (
            <tr key={i}>
              <td>
                <code>{w.pv}</code>
              </td>
              <td className="canopy-write-dialog__n">
                <Now data={data} />
              </td>
              <td className="canopy-write-dialog__n">
                <code>
                  <Written write={w} unit={unitOf(data)} />
                  {w.release ? ' (release)' : ''}
                </code>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The dialog's first line: what is written to, in words. Its marker is painted by kind. */
function targetText(dialog: WriteDialogState): string {
  let text = dialog.machine ?? 'Control target (not named)';
  if (dialog.targetKind === 'machine') text += ' \u00b7 the machine';
  else if (dialog.targetKind !== null) text += ' \u00b7 not the machine';
  if (dialog.targetNotice === 'fallback') text += ' \u00b7 fallback (no target record)';
  else if (dialog.targetNotice === 'unservable') text += ' \u00b7 cannot be served';
  return text;
}

/** The confirmation dialog of `gate`. */
function WriteDialog({ gate, dialog }: { gate: ScreenWriteGate; dialog: WriteDialogState }) {
  const live = useLiveValues(dialog.writes.map((w) => w.pv));
  const say = dialog.say;
  const consequence = say?.kind === 'consequence';
  const title = dialogTitle(dialog.writes, say, (pv) => unitOf(live(pv)));
  // Whether Cancel saw the Enter that is down go down on itself.
  const ownEnter = useRef(false);
  return (
    <ComposedModal
      open
      size="sm"
      className="canopy-write-dialog"
      data-testid="canopy-write-dialog"
      data-kind={consequence ? 'consequence' : undefined}
      data-target-kind={dialog.targetKind ?? 'unknown'}
      data-target-notice={dialog.targetNotice ?? undefined}
      preventCloseOnClickOutside
      onClose={() => {
        gate.decline(dialog.id);
        return false;
      }}
    >
      <ModalHeader
        label={targetText(dialog)}
        labelClassName="canopy-write-target"
        title={<span data-testid="canopy-write-title">{title}</span>}
      />
      <ModalBody>
        {say?.text !== undefined && (
          <p
            className={
              consequence
                ? 'canopy-write-dialog__text canopy-write-dialog__text--consequence'
                : 'canopy-write-dialog__text'
            }
            data-testid="canopy-write-text"
          >
            {say.text}
          </p>
        )}
        {changeCount(dialog.writes) === 1 ? (
          <WriteRows
            writes={dialog.writes}
            live={live}
            gate={gate}
            sets={say?.action === 'set' || say?.action === 'apply'}
          />
        ) : (
          <WritesTable writes={dialog.writes} live={live} />
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          kind="secondary"
          size="sm"
          data-testid="canopy-write-decline"
          data-modal-primary-focus
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            // The auto-repeat of the key that opened the dialog.
            if (e.repeat && !ownEnter.current) e.preventDefault();
            else ownEnter.current = true;
          }}
          onKeyPress={(e: React.KeyboardEvent) => {
            // The rest of the key press that opened the dialog.
            if (e.key === 'Enter' && !ownEnter.current) e.preventDefault();
          }}
          onKeyUp={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') ownEnter.current = false;
          }}
          onClick={() => gate.decline(dialog.id)}
        >
          Cancel
        </Button>
        <Button
          kind={consequence ? 'danger' : 'primary'}
          size="sm"
          data-testid="canopy-write-confirm"
          onClick={() => gate.confirm(dialog.id)}
        >
          {dialogVerb(dialog.writes, say)}
        </Button>
      </ModalFooter>
    </ComposedModal>
  );
}

/** The dialog and toasts of `gate` (nothing when null). */
export function WriteGateView({ gate }: { gate: ScreenWriteGate | null }) {
  const source = gate ?? NO_GATE;
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const host = useWriteToastHost();
  const live = !!gate && !!state && state.toasts.length > 0;
  const onLive = host?.onLive;
  // Tell the workspace while this screen has a toast, so it stays mounted
  // (its gate, and with it the toast, would go with it).
  useEffect(() => {
    if (!onLive) return;
    onLive(live);
    return () => {
      if (live) onLive(false);
    };
  }, [onLive, live]);
  if (!gate || !state) return null;
  const dialog = state.dialog;
  const column = host?.element ?? null;
  const toastList = state.toasts.map((t) => (
    <div
      key={t.id}
      className="canopy-write-toasts__item"
      onMouseEnter={() => gate.holdToast(t.id)}
      onMouseLeave={() => gate.releaseToast(t.id)}
      onFocus={() => gate.holdToast(t.id)}
      onBlur={() => gate.releaseToast(t.id)}
    >
      <ToastNotification
        kind={toastKind(t)}
        lowContrast
        role="status"
        title=""
        onClose={() => {
          gate.dismissToast(t.id);
          return false;
        }}
      >
        {column && (
          <div className="canopy-write-toast__screen" data-testid="canopy-write-toast-screen">
            {host!.title}
          </div>
        )}
        {/* The contract element: its text is exactly the summary (the
            run drivers compare it; Carbon's icon title and the screen
            title stay outside). */}
        <span
          className="canopy-write-toast__text"
          data-testid="canopy-write-toast"
          data-outcome={t.outcome}
        >
          {t.text}
        </span>
      </ToastNotification>
    </div>
  ));
  let toasts: React.ReactNode = null;
  if (state.toasts.length > 0) {
    toasts = column ? (
      createPortal(
        <div className="canopy-write-toasts__screen" data-screen-title={host!.title}>
          {toastList}
        </div>,
        column
      )
    ) : (
      <div className="canopy-write-toasts" style={TOASTS_STYLE}>
        {toastList}
      </div>
    );
  }
  return (
    <>
      {dialog && <WriteDialog key={dialog.id} gate={gate} dialog={dialog} />}
      {toasts}
    </>
  );
}

/** Provides `gate` to the screen below and renders its dialog and toasts. */
export function ScreenWriteGateProvider({
  gate,
  children,
}: {
  gate: ScreenWriteGate | null;
  children: React.ReactNode;
}) {
  return (
    <WriteGate.Provider value={gate}>
      {children}
      <WriteGateView gate={gate} />
    </WriteGate.Provider>
  );
}
