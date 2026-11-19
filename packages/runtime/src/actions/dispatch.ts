// Widget action dispatch for the Canopy screen runtime.
//
// A pure function over injected callbacks: the viewer supplies PV writes,
// manifest lookup, navigation and error display, so every Action variant can
// be exercised without a browser or a running viewer.
//
// Machine writes of one click go through the provided write gate as one run
// (at most one confirmation dialog, one summary toast; a node that sets
// `confirmWrites` asks for the dialog whatever the gate's own rule); a decline or a run
// that stopped skips the rest of the action list. Every write that does not
// go through the gate (a local channel, or any write with no gate) goes
// through one call, `dispatchLocalWrite`: it is the only put in this module.
//
// `apply_staged` writes the values staged in its scope as one gate run of its
// own, at its place in the list, in the order they were staged. The run stops
// at the first write that is refused or unknown, as every run does: what was
// sent stays sent, and the summary names the channel it stopped at. A value
// leaves the staging store only when its write was confirmed; a declined
// dialog, a stopped run and an unconfirmed write keep theirs. `clear_staged`
// drops a scope unwritten.
//
// `open_webpage` and `open_display` only open http(s) or relative URLs; any
// other scheme (`javascript:`, `data:`, ...) and protocol-relative `//host`
// URLs are refused with an error, since a URL may carry macro values taken
// from the viewer's query string.

import type { Action, MacroValues } from '@slaclab/canopy-screen-ir';
import type {
  StagingStore,
  WriteGateService,
  WriteOutcome,
  WriteRunOptions,
  WriteRunResult,
} from '@slaclab/canopy-screen-widgets';
import { isGateBypass } from '../channels.js';
import { substituteMacros } from '../macros.js';
import type { RuntimeAction } from './staged.js';

type MaybePromise<T> = T | Promise<T>;

export interface ActionContext {
  /** Effective macros of the screen hosting the widget. */
  readonly macros: MacroValues;
  readonly pvService: {
    put(pvName: string, value: string | number): MaybePromise<unknown>;
  };
  /**
   * Map a display file to a viewer URL, or `null`/`undefined` when no screen
   * exists for it. The caller resolves relative paths against the declaring
   * document; the file handed in has only had macros substituted.
   */
  resolveManifest(file: string): MaybePromise<string | null | undefined>;
  /** Replace the current screen. */
  navigate(url: string): void;
  /** Open a URL in a new tab/window. */
  openWindow(url: string): void;
  /**
   * Plot `pvs` in the viewer's data browser (Trace), as its "Plot in Data
   * Browser" does: the first ones up to its cap, in the most recently used
   * instance's time range. Absent where there is no workspace.
   */
  plotPVs?(pvs: readonly string[]): void;
  /** Close the screen hosting the widget. */
  close(): void;
  /** Surface a user-visible error. */
  showError(message: string): void;
  /**
   * The write gate for machine writes, or null/absent: then every write goes
   * straight through `pvService` (mock and fixture mode, the builder).
   */
  readonly gate?: WriteGateService | null;
  /**
   * The node asks for the confirmation dialog before its click's machine
   * writes (its `confirmWrites` prop). Read only with a gate; it adds a
   * dialog and never removes the gate's own.
   */
  readonly confirm?: boolean;
  /**
   * The screen's staged values, read by `apply_staged` and `clear_staged`;
   * with none, both do nothing.
   */
  readonly staging?: StagingStore | null;
}

// Action kinds the runtime refuses to run; each is warned about once.
const warned = new Set<string>();

/** Reset the once-per-kind warning memory (tests). */
export function resetActionWarnings(): void {
  warned.clear();
}

function warnOnce(kind: string): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  console.warn(`[canopy-screen-runtime] '${kind}' actions are not supported and were ignored`);
}

function withQuery(url: string, macros: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams(Object.entries(macros)).toString();
  if (query === '') return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Whether `url` is safe to navigate to or open: an http(s) URL or a relative
 * one. Tabs and newlines are removed and C0 controls and spaces trimmed first,
 * as the browser's URL parser does, so `java\tscript:` is still refused.
 */
export function isOpenableUrl(url: string): boolean {
  // eslint-disable-next-line no-control-regex
  const s = url.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
  if (/^[\\/][\\/]/.test(s)) return false;
  const scheme = URL_SCHEME.exec(s);
  return scheme === null || ALLOWED_SCHEMES.has(scheme[0].toLowerCase());
}

/** Show an error and return false when `url` is not openable. */
function checkUrl(url: string, ctx: ActionContext): boolean {
  if (isOpenableUrl(url)) return true;
  ctx.showError(`Refused to open ${url}: only http, https and relative URLs are allowed`);
  return false;
}

async function openDisplay(
  action: Extract<Action, { type: 'open_display' }>,
  ctx: ActionContext
): Promise<void> {
  const file = substituteMacros(action.file, ctx.macros);
  const base = await ctx.resolveManifest(file);
  if (base === null || base === undefined) {
    ctx.showError(`No screen for ${file}`);
    return;
  }
  const macros: Record<string, string> = {};
  for (const [name, value] of Object.entries(action.macros ?? {})) {
    macros[name] = substituteMacros(value, ctx.macros);
  }
  const url = withQuery(base, macros);
  if (!checkUrl(url, ctx)) return;
  // Only tab/window open elsewhere; replace, a missing target, or an unknown
  // one all replace the current screen.
  const target: unknown = action.target;
  if (target === 'tab' || target === 'window') ctx.openWindow(url);
  else ctx.navigate(url);
}

/** Shown for an `execute` action: the viewer runs no host commands. */
const EXECUTE_NOT_AVAILABLE = "'execute' actions are not available here";

/**
 * A write that does not go through the gate: a local channel (loc://,
 * formula://) on the instance router, or any write when no gate is provided.
 */
async function dispatchLocalWrite(
  ctx: ActionContext,
  pvName: string,
  value: string | number
): Promise<void> {
  await ctx.pvService.put(pvName, value);
}

const CONTINUES = new Set(['confirmed', 'mismatch', 'unconfirmed']);

/** True when `result` sent all `n` writes and each may be followed (no stop). */
function completed(result: WriteRunResult, n: number): boolean {
  return (
    result !== 'declined' &&
    result.length === n &&
    result.every((o: WriteOutcome) => !o.coalesced && CONTINUES.has(o.outcome))
  );
}

/**
 * Write the values staged in `scope`. False when the rest of the action list
 * must not run: the dialog was declined, or the run stopped.
 */
async function applyStaged(scope: string, ctx: ActionContext): Promise<boolean> {
  const staging = ctx.staging ?? null;
  const staged = staging?.list(scope) ?? [];
  if (staging === null || staged.length === 0) return true;
  const gate = ctx.gate ?? null;
  if (gate === null) {
    for (const s of staged) {
      await dispatchLocalWrite(ctx, s.pv, typeof s.value === 'boolean' ? Number(s.value) : s.value);
      staging.clear(scope, s.pv, s);
    }
    return true;
  }
  const options: WriteRunOptions =
    ctx.confirm === true ? { confirm: true, nameStopped: true } : { nameStopped: true };
  const result = await gate
    .run(
      staged.map((s) =>
        s.entered === undefined
          ? { pv: s.pv, value: s.value }
          : { pv: s.pv, value: s.value, entered: s.entered }
      ),
      options
    )
    .catch((): WriteRunResult => []);
  if (result === 'declined') return false;
  staged.forEach((s, i) => {
    const o = result[i];
    if (o !== undefined && !o.coalesced && o.outcome === 'confirmed') staging.clear(scope, s.pv, s);
  });
  return completed(result, staged.length);
}

/**
 * Execute `actions` in declaration order, awaiting each before the next.
 *
 * With a gate, the list's machine `write_pv` actions run as ONE gate run, at
 * the position of the first of them; after a decline, or a run that stopped
 * before writing them all, the rest of the list is skipped.
 */
export async function dispatchActions(
  actions: readonly RuntimeAction[],
  ctx: ActionContext
): Promise<void> {
  const gate = ctx.gate ?? null;
  const machine =
    gate === null
      ? []
      : actions.flatMap((a) => {
          if (a.type !== 'write_pv') return [];
          const pv = substituteMacros(a.pvName, ctx.macros);
          return isGateBypass(pv) ? [] : [{ pv, value: a.value }];
        });
  let ran = false;
  for (const action of actions) {
    switch (action.type) {
      case 'write_pv': {
        const pv = substituteMacros(action.pvName, ctx.macros);
        if (gate === null || isGateBypass(pv)) {
          await dispatchLocalWrite(ctx, pv, action.value);
          break;
        }
        if (ran) break; // already sent with the click's run
        ran = true;
        const result = await (
          ctx.confirm === true ? gate.run(machine, { confirm: true }) : gate.run(machine)
        ).catch((): WriteRunResult => []);
        if (!completed(result, machine.length)) return;
        break;
      }
      case 'apply_staged': {
        if (!(await applyStaged(substituteMacros(action.scope, ctx.macros), ctx))) return;
        break;
      }
      case 'clear_staged':
        ctx.staging?.clearScope(substituteMacros(action.scope, ctx.macros));
        break;
      case 'open_display':
        await openDisplay(action, ctx);
        break;
      case 'close_display':
        ctx.close();
        break;
      case 'open_webpage': {
        const url = substituteMacros(action.url, ctx.macros);
        if (checkUrl(url, ctx)) ctx.openWindow(url);
        break;
      }
      case 'execute':
        ctx.showError(EXECUTE_NOT_AVAILABLE);
        break;
      case 'open_file':
        warnOnce(action.type);
        break;
    }
  }
}
