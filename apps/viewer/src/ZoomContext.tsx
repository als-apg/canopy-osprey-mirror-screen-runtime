// Viewer zoom state. Two things are remembered, per browser profile:
//
//   the display mode   fit width (the default: the screen as wide as its pane,
//                      the rest scrolls), fit page (the whole screen in view)
//                      or actual size (100%). ONE value for the viewer, in
//                      localStorage under storageKey('canopy-viewer:zoom-mode')
//                      (mount plus host scope, storageScope.ts): picking it on
//                      one screen picks it for every screen.
//   a manual zoom      a percentage stepped to with − / +, per screen. It
//                      stands ahead of the display mode on its screen until a
//                      mode is picked there.
//
// Storage failures (blocked, sandboxed, missing) are ignored: the state then
// lasts for the page's lifetime only. Two shapes:
//
//   ZoomProvider       the workspace with chrome off (`?_canopyChrome=0`),
//                      above the routes; /s/ is never zoomed. One value for
//                      the whole app: the remembered display mode, or a manual
//                      zoom mirrored to sessionStorage under
//                      storageKey('canopy-viewer:zoom'). It reads the router
//                      basename, so it needs a router above it.
//   ZoomStore          the docked workspace's per-tile zoom: the display mode
//                      and ONE localStorage record of the manual zooms under
//                      storageKey('canopy-viewer:zoom-by-screen'), a JSON map
//                      keyed `category/id`, so every tab of a screen (any
//                      macros) shares it and it outlives the session. A screen
//                      without an entry shows the display mode. A tool key
//                      (`@…`) has no zoom. Another browser tab's write arrives
//                      through the `storage` event. `latch` holds the
//                      ?_canopyZoom value for the URL's tab key in memory only
//                      (this page view), ahead of everything remembered, until
//                      a zoom is picked on that tile. Owned by WorkspacePage,
//                      which passes it the basename. A KeyedZoomProvider around
//                      each screen and that screen's tile bar (useKeyedZoom; a
//                      bar lives in dockview's tab element, a sibling subtree
//                      of the screen) read and write the same entry.
//
// ScreenPage reads either through useZoom(); the innermost provider wins.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { useHref } from 'react-router-dom';
import { browserStorage } from './screenList.js';
import { storageKey } from './storageScope.js';
import { isValidScale } from './zoom.js';

/** 'width' fits the pane's width, 'fit' the whole screen (fit page). */
export type ZoomMode = 'width' | 'fit' | 'manual';

/** The display mode remembered for the viewer. */
export type DisplayMode = 'width' | 'fit' | 'actual';

export interface ZoomState {
  mode: ZoomMode;
  /** The manual scale; ignored in the two fit modes. */
  scale: number;
}

export interface ZoomControl extends ZoomState {
  /** Pick a display mode, for every screen; this screen's manual zoom goes. */
  setFitWidth(): void;
  setFit(): void;
  setActual(): void;
  /** Step this screen to a manual scale. */
  setManual(scale: number): void;
  /** App level only: show `state` without remembering a display mode. */
  latch?(state: ZoomState): void;
}

/** The name of the app-level manual zoom record (a storageKey name). */
export const ZOOM_STORAGE_NAME = 'canopy-viewer:zoom';
/** The name of the per-screen manual zoom record (a storageKey name). */
export const ZOOM_BY_SCREEN_NAME = 'canopy-viewer:zoom-by-screen';
/** The name of the display mode record (a storageKey name). */
export const ZOOM_MODE_NAME = 'canopy-viewer:zoom-mode';
const DEFAULT_MODE: DisplayMode = 'width';
const MODE_STATES: Readonly<Record<DisplayMode, ZoomState>> = {
  width: Object.freeze({ mode: 'width', scale: 1 }) as ZoomState,
  fit: Object.freeze({ mode: 'fit', scale: 1 }) as ZoomState,
  actual: Object.freeze({ mode: 'manual', scale: 1 }) as ZoomState,
};
const DEFAULT_ZOOM = MODE_STATES[DEFAULT_MODE];

function sessionStore(): Storage | undefined {
  try {
    const value = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return typeof value?.getItem === 'function' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The remembered display mode; the default when none or unreadable. */
function readMode(key: string): DisplayMode {
  try {
    const raw = browserStorage()?.getItem(key);
    return raw === 'fit' || raw === 'actual' ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/** Remembers `mode`; the default is remembered as no entry. */
function writeMode(key: string, mode: DisplayMode): void {
  try {
    const storage = browserStorage();
    if (mode === DEFAULT_MODE) storage?.removeItem(key);
    else storage?.setItem(key, mode);
  } catch {
    // Not persisted; the in-memory state still applies.
  }
}

/** A valid state, else the default fit width. */
function normalise(state: Partial<ZoomState> | null | undefined): ZoomState {
  if (state?.mode === 'manual' && isValidScale(state.scale)) {
    return { mode: 'manual', scale: state.scale };
  }
  return state?.mode === 'fit' ? MODE_STATES.fit : DEFAULT_ZOOM;
}

/** The session's manual zoom, or null when there is none. */
function readManual(key: string): ZoomState | null {
  try {
    const raw = sessionStore()?.getItem(key);
    if (!raw) return null;
    const state = normalise(JSON.parse(raw) as Partial<ZoomState>);
    return state.mode === 'manual' ? state : null;
  } catch {
    return null;
  }
}

/** Mirrors a manual zoom to the session; any other state clears the entry. */
function writeManual(key: string, state: ZoomState): void {
  try {
    if (state.mode === 'manual') sessionStore()?.setItem(key, JSON.stringify(state));
    else sessionStore()?.removeItem(key);
  } catch {
    // Not persisted; the in-memory state still applies.
  }
}

function sameZoom(a: ZoomState, b: ZoomState): boolean {
  return a.mode === b.mode && (a.mode !== 'manual' || a.scale === b.scale);
}

/** The record key of a tab key: `category/id` (macros dropped); null for a tool. */
function screenOf(key: string): string | null {
  if (key.startsWith('@')) return null;
  const q = key.indexOf('?');
  const path = q < 0 ? key : key.slice(0, q);
  return path.indexOf('/') > 0 ? path : null;
}

/** The stored record's valid manual entries; anything else reads as absent. */
function readRecord(key: string): Map<string, ZoomState> {
  const out = new Map<string, ZoomState>();
  try {
    const raw = browserStorage()?.getItem(key);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    for (const [screen, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const state = normalise(entry as Partial<ZoomState> | null);
      if (state.mode === 'manual') out.set(screen, state);
    }
  } catch {
    // Unreadable: nothing remembered.
  }
  return out;
}

/**
 * The viewer's display mode and the manual zoom per screen, from localStorage:
 * read on first use, written back on every change and re-read on the `storage`
 * event. Snapshots keep their identity until their value changes, as
 * useSyncExternalStore requires.
 */
export class ZoomStore {
  /** The remembered manual zooms by `category/id`; null until first read. */
  private record: Map<string, ZoomState> | null = null;
  /** The remembered display mode; null until first read. */
  private mode: DisplayMode | null = null;
  /** Latched zooms by exact tab key: this page view only. */
  private readonly latched = new Map<string, ZoomState>();
  private readonly listeners = new Set<() => void>();
  private readonly storageKey: string;
  private readonly modeKey: string;
  private detach: (() => void) | null = null;

  /** `basename` is the router basename the records are scoped by. */
  constructor(basename = '/') {
    this.storageKey = storageKey(ZOOM_BY_SCREEN_NAME, basename);
    this.modeKey = storageKey(ZOOM_MODE_NAME, basename);
  }

  private remembered(): Map<string, ZoomState> {
    this.record ??= readRecord(this.storageKey);
    return this.record;
  }

  /** The display mode in effect on a screen without a manual zoom. */
  displayMode(): DisplayMode {
    this.mode ??= readMode(this.modeKey);
    return this.mode;
  }

  /** The key's zoom: its latch, else its screen's manual zoom, else the display mode. */
  get(key: string): ZoomState {
    const latched = this.latched.get(key);
    if (latched !== undefined) return latched;
    const screen = screenOf(key);
    if (screen === null) return DEFAULT_ZOOM;
    return this.remembered().get(screen) ?? MODE_STATES[this.displayMode()];
  }

  /**
   * Latches `key` (the URL's tab key) at `state` for this page view, ahead of
   * everything remembered; nothing is stored. A later `set` on it drops it.
   */
  latch(key: string, state: ZoomState): void {
    if (screenOf(key) === null) return;
    this.latched.set(key, normalise(state));
    this.notify();
  }

  /**
   * Sets the key's screen zoom: a valid manual one is remembered for its
   * screen; any other state drops the screen's manual zoom, so it shows the
   * display mode (which only setMode changes). Drops the key's latch.
   */
  set(key: string, state: ZoomState): void {
    const screen = screenOf(key);
    if (screen === null) return;
    const next = normalise(state);
    const hadLatch = this.latched.delete(key);
    const changed = this.writeRecord((record) => {
      if (next.mode === 'manual') record.set(screen, next);
      else record.delete(screen);
    });
    if (hadLatch || changed) this.notify();
  }

  /**
   * Picks the display mode, for every screen, and drops the key's screen's
   * manual zoom and the key's latch, so the screen shows the mode.
   */
  setMode(key: string, mode: DisplayMode): void {
    const screen = screenOf(key);
    if (screen === null) return;
    const hadLatch = this.latched.delete(key);
    const modeChanged = this.displayMode() !== mode;
    this.mode = mode;
    writeMode(this.modeKey, mode);
    const changed = this.writeRecord((record) => record.delete(screen));
    if (hadLatch || modeChanged || changed) this.notify();
  }

  /** Applies `edit` to what is stored now (another tab may have written meanwhile). */
  private writeRecord(edit: (record: Map<string, ZoomState>) => void): boolean {
    const record = readRecord(this.storageKey);
    edit(record);
    const changed = this.adopt(record);
    try {
      const storage = browserStorage();
      if (record.size === 0) storage?.removeItem(this.storageKey);
      else storage?.setItem(this.storageKey, JSON.stringify(Object.fromEntries(record)));
    } catch {
      // Not persisted; the in-memory state still applies.
    }
    return changed;
  }

  /** Takes `next` as the record, keeping the identity of unchanged entries. */
  private adopt(next: Map<string, ZoomState>): boolean {
    const old = this.remembered();
    let changed = old.size !== next.size;
    for (const [screen, state] of next) {
      const before = old.get(screen);
      if (before !== undefined && sameZoom(before, state)) next.set(screen, before);
      else changed = true;
    }
    this.record = next;
    return changed;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private onStorage = (event: StorageEvent): void => {
    // A null key is a clear() of the whole storage area.
    const all = event.key === null;
    let changed = false;
    if (all || event.key === this.modeKey) {
      const mode = readMode(this.modeKey);
      changed = mode !== this.displayMode();
      this.mode = mode;
    }
    if (all || event.key === this.storageKey) {
      changed = this.adopt(readRecord(this.storageKey)) || changed;
    }
    if (changed) this.notify();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.detach === null && typeof window !== 'undefined') {
      window.addEventListener('storage', this.onStorage);
      this.detach = () => window.removeEventListener('storage', this.onStorage);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.detach !== null) {
        this.detach();
        this.detach = null;
      }
    };
  };
}

const ZoomContext = createContext<ZoomControl | null>(null);

/** The app-level zoom: the remembered display mode, or this session's manual zoom. */
export function ZoomProvider({ children }: { children: ReactNode }) {
  // useHref('/') is the router basename (`/` when there is none).
  const basename = useHref('/');
  const key = storageKey(ZOOM_STORAGE_NAME, basename);
  const modeKey = storageKey(ZOOM_MODE_NAME, basename);
  const [state, setState] = useState<ZoomState>(
    () => readManual(key) ?? MODE_STATES[readMode(modeKey)]
  );

  const latch = useCallback(
    (next: ZoomState) => {
      const valid = normalise(next);
      setState(valid);
      writeManual(key, valid);
    },
    [key]
  );
  const pick = useCallback(
    (mode: DisplayMode) => {
      setState(MODE_STATES[mode]);
      writeMode(modeKey, mode);
      writeManual(key, MODE_STATES.width);
    },
    [key, modeKey]
  );
  const setFitWidth = useCallback(() => pick('width'), [pick]);
  const setFit = useCallback(() => pick('fit'), [pick]);
  const setActual = useCallback(() => pick('actual'), [pick]);
  const setManual = useCallback(
    (scale: number) => {
      if (isValidScale(scale)) latch({ mode: 'manual', scale });
    },
    [latch]
  );

  const value = useMemo(
    () => ({
      mode: state.mode,
      scale: state.scale,
      setFitWidth,
      setFit,
      setActual,
      setManual,
      latch,
    }),
    [state, setFitWidth, setFit, setActual, setManual, latch]
  );
  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>;
}

/** The zoom of `key` in `store`, live, with setters that write that key. */
export function useKeyedZoom(store: ZoomStore, key: string): ZoomControl {
  const getSnapshot = useCallback(() => store.get(key), [store, key]);
  const state = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  const setFitWidth = useCallback(() => store.setMode(key, 'width'), [store, key]);
  const setFit = useCallback(() => store.setMode(key, 'fit'), [store, key]);
  const setActual = useCallback(() => store.setMode(key, 'actual'), [store, key]);
  const setManual = useCallback(
    (scale: number) => {
      if (isValidScale(scale)) store.set(key, { mode: 'manual', scale });
    },
    [store, key]
  );
  return useMemo(
    () => ({ mode: state.mode, scale: state.scale, setFitWidth, setFit, setActual, setManual }),
    [state, setFitWidth, setFit, setActual, setManual]
  );
}

/** One screen's zoom: the `zoomKey` entry of `store`, for every useZoom() below. */
export function KeyedZoomProvider({
  store,
  zoomKey,
  children,
}: {
  store: ZoomStore;
  zoomKey: string;
  children: ReactNode;
}) {
  const value = useKeyedZoom(store, zoomKey);
  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>;
}

/** The viewer's zoom state; outside a ZoomProvider it is a fixed fit width. */
export function useZoom(): ZoomControl {
  return useContext(ZoomContext) ?? FIXED_FIT;
}

const FIXED_FIT: ZoomControl = {
  ...DEFAULT_ZOOM,
  setFitWidth: () => {},
  setFit: () => {},
  setActual: () => {},
  setManual: () => {},
};
