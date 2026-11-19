// Staged values: what an operator typed into an entry that stages instead of
// writing (the entry's `stage` prop names a scope). A staged value is held
// here until an `apply_staged` action writes the scope through the write gate
// or a `clear_staged` action (or Escape in the entry) drops it. Staging writes
// nothing.
//
// One store per screen instance: the top screen has one, and each embedded
// screen instance has its own, linked to the store of the screen embedding
// it. A store answers for its own values and those of the instances below
// it, never for a sibling's or an ancestor's: an Apply on a parent view
// writes the rows it embeds, an Apply inside one embedded card only that card.
//
// A value exists only while an entry for its channel and scope is mounted
// (`attach`): it is dropped when the last such entry goes (unmounted, hidden
// by a rule, bound to another channel), so no value is ever written that is
// not on screen. Values are listed in the order their channels were first
// staged; that is the order they are written.
//
// While a run writes a scope (`begin`), the scope is busy in the store that
// started it, in every store above it and in every store below it: a second
// Apply or Clear there does nothing. Staging stays possible meanwhile.

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import type { WriteValue } from '../writeGate/types.js';

/** One staged value: the channel, the parsed value, and the text as typed. */
export interface StagedValue {
  readonly pv: string;
  readonly value: WriteValue;
  /** The entry's text, for a value typed into a numeric entry. */
  readonly entered?: string;
}

export interface StagingStore {
  /** The value this instance holds for `pv` in `scope`, or undefined. */
  get(scope: string, pv: string): StagedValue | undefined;
  /**
   * A mounted entry for `pv` in `scope`. The returned function detaches it;
   * when the last one detaches, the channel's value is dropped.
   */
  attach(scope: string, pv: string): () => void;
  /**
   * Stage `staged` in `scope`, replacing what its channel held there. False,
   * and nothing staged, when no entry is attached for the channel.
   */
  set(scope: string, staged: StagedValue): boolean;
  /**
   * Drop what `pv` holds in `scope`, in this instance or one below it. With
   * `only`, drop it only while it is still that very value: one staged again
   * since stays.
   */
  clear(scope: string, pv: string, only?: StagedValue): void;
  /** Drop what `pv` holds in `scope` in this instance only, not below it. */
  drop(scope: string, pv: string): void;
  /**
   * Whether `staged` is still held, as that very value, in this instance or
   * one below it: its entry is still mounted on the same channel and nothing
   * replaced or dropped the value.
   */
  holds(scope: string, staged: StagedValue): boolean;
  /**
   * An apply on this store found `pv` staged with different values in
   * `scope` (here and below). The values of that channel in this store's
   * reach are marked for as long as they disagree: when one is staged again
   * or dropped and the rest agree, every mark goes.
   */
  conflict(scope: string, pv: string): void;
  /** Whether `staged` is marked as in conflict. */
  marked(staged: StagedValue): boolean;
  /** Drop every value of `scope`, in this instance and those below it. */
  clearScope(scope: string): void;
  /** The values of `scope` in this instance and those below it, in staging order. */
  list(scope: string): readonly StagedValue[];
  /** How many values `list(scope)` holds. */
  count(scope: string): number;
  /** Whether a run is writing `scope` here, in a store above or in one below. */
  busy(scope: string): boolean;
  /**
   * Whether a run that covers this instance is writing `scope`: one started
   * here or in a store above. Its staged entries are locked meanwhile.
   */
  writing(scope: string): boolean;
  /** A run starts writing `scope`; the returned function ends it. */
  begin(scope: string): () => void;
  /** Make this store reachable from its parent; the returned function undoes it. */
  link(): () => void;
  /** Changes on every change in the tree of linked stores. */
  version(): number;
  subscribe(listener: () => void): () => void;
}

interface Held {
  staged: StagedValue;
  order: number;
}

interface Node {
  parent: Node | null;
  children: Set<Node>;
  /** scope → channel → value */
  values: Map<string, Map<string, Held>>;
  /** scope → channel → mounted entries */
  entries: Map<string, Map<string, number>>;
  /** scope → runs writing it, started here */
  runs: Map<string, number>;
}

/** What the stores of one tree share. */
interface Shared {
  order: number;
  version: number;
  listeners: Set<() => void>;
  /** Channels an apply found in conflict, with the store whose reach it read. */
  conflicts: { node: Node; scope: string; pv: string }[];
}

function below(node: Node): Node[] {
  const all = [node];
  for (const child of node.children) all.push(...below(child));
  return all;
}

function storeOf(node: Node, shared: Shared): StagingStore & { node: Node; shared: Shared } {
  /** The values a recorded conflict still covers: none once they agree. */
  const conflicting = (c: Shared['conflicts'][number]): StagedValue[] => {
    const values = below(c.node).flatMap((n) => {
      const held = n.values.get(c.scope)?.get(c.pv);
      return held === undefined ? [] : [held.staged];
    });
    return values.some((v) => v.value !== values[0]!.value) ? values : [];
  };
  const changed = () => {
    // A conflict that no longer holds is forgotten, so it cannot come back unasked.
    shared.conflicts = shared.conflicts.filter((c) => conflicting(c).length > 0);
    shared.version += 1;
    for (const l of [...shared.listeners]) l();
  };
  const collect = (scope: string): Held[] =>
    below(node)
      .flatMap((n) => [...(n.values.get(scope)?.values() ?? [])])
      .sort((a, b) => a.order - b.order);
  const drop = (n: Node, scope: string, pv: string, only?: StagedValue): boolean => {
    const values = n.values.get(scope);
    const held = values?.get(pv);
    if (values === undefined || held === undefined) return false;
    if (only !== undefined && held.staged !== only) return false;
    values.delete(pv);
    if (values.size === 0) n.values.delete(scope);
    return true;
  };
  return {
    node,
    shared,
    get: (scope, pv) => node.values.get(scope)?.get(pv)?.staged,
    attach(scope, pv) {
      let channels = node.entries.get(scope);
      if (channels === undefined) node.entries.set(scope, (channels = new Map()));
      channels.set(pv, (channels.get(pv) ?? 0) + 1);
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        const left = (channels.get(pv) ?? 1) - 1;
        if (left > 0) {
          channels.set(pv, left);
          return;
        }
        channels.delete(pv);
        if (channels.size === 0 && node.entries.get(scope) === channels) node.entries.delete(scope);
        if (drop(node, scope, pv)) changed();
      };
    },
    set(scope, staged) {
      if ((node.entries.get(scope)?.get(staged.pv) ?? 0) === 0) return false;
      let values = node.values.get(scope);
      if (values === undefined) node.values.set(scope, (values = new Map()));
      const order = values.get(staged.pv)?.order ?? (shared.order += 1);
      values.set(staged.pv, { staged, order });
      changed();
      return true;
    },
    clear(scope, pv, only) {
      let any = false;
      for (const n of below(node)) any = drop(n, scope, pv, only) || any;
      if (any) changed();
    },
    drop(scope, pv) {
      if (drop(node, scope, pv)) changed();
    },
    holds: (scope, staged) =>
      below(node).some((n) => n.values.get(scope)?.get(staged.pv)?.staged === staged),
    clearScope(scope) {
      let any = false;
      for (const n of below(node)) any = n.values.delete(scope) || any;
      if (any) changed();
    },
    conflict(scope, pv) {
      if (shared.conflicts.some((c) => c.node === node && c.scope === scope && c.pv === pv)) return;
      shared.conflicts.push({ node, scope, pv });
      changed();
    },
    marked: (staged) =>
      shared.conflicts.some((c) => c.pv === staged.pv && conflicting(c).includes(staged)),
    list: (scope) => collect(scope).map((h) => h.staged),
    count: (scope) => below(node).reduce((sum, n) => sum + (n.values.get(scope)?.size ?? 0), 0),
    busy(scope) {
      for (let n: Node | null = node.parent; n !== null; n = n.parent) {
        if ((n.runs.get(scope) ?? 0) > 0) return true;
      }
      return below(node).some((n) => (n.runs.get(scope) ?? 0) > 0);
    },
    writing(scope) {
      for (let n: Node | null = node; n !== null; n = n.parent) {
        if ((n.runs.get(scope) ?? 0) > 0) return true;
      }
      return false;
    },
    begin(scope) {
      node.runs.set(scope, (node.runs.get(scope) ?? 0) + 1);
      changed();
      let running = true;
      return () => {
        if (!running) return;
        running = false;
        const left = (node.runs.get(scope) ?? 1) - 1;
        if (left > 0) node.runs.set(scope, left);
        else node.runs.delete(scope);
        changed();
      };
    },
    link() {
      const parent = node.parent;
      if (parent === null) return () => {};
      parent.children.add(node);
      changed();
      return () => {
        parent.children.delete(node);
        changed();
      };
    },
    version: () => shared.version,
    subscribe(listener) {
      shared.listeners.add(listener);
      return () => shared.listeners.delete(listener);
    },
  };
}

/**
 * The store of one screen instance. With `parent` (the store of the screen
 * embedding it) it answers to that store once linked (`link()`).
 */
export function createStagingStore(parent?: StagingStore | null): StagingStore {
  const above = (parent ?? null) as ReturnType<typeof storeOf> | null;
  const node: Node = {
    parent: above?.node ?? null,
    children: new Set(),
    values: new Map(),
    entries: new Map(),
    runs: new Map(),
  };
  return storeOf(
    node,
    above?.shared ?? { order: 0, version: 0, listeners: new Set(), conflicts: [] }
  );
}

/** The staging store of the screen instance, or null where nothing provides one. */
export const Staging = createContext<StagingStore | null>(null);

/** The reserved prop that makes an entry stage: the scope's name, a non-empty string. */
export const STAGE_PROP = 'stage';

/** The scope `props` stages into, or null for an entry with no usable one. */
export function stageScope(props: Readonly<Record<string, unknown>>): string | null {
  const scope = props[STAGE_PROP];
  return typeof scope === 'string' && scope !== '' ? scope : null;
}

/**
 * Whether `props` carry a `stage` at all. One that is present but names no
 * scope (empty after macro substitution, or not a string) still means "this
 * entry does not write": the entry is inert, it never falls back to writing.
 */
export function hasStage(props: Readonly<Record<string, unknown>>): boolean {
  return props[STAGE_PROP] !== undefined && props[STAGE_PROP] !== null;
}

/** The longest plain-decimal text a field shows before it falls back to an exponent. */
const MAX_PLAIN_LENGTH = 24;

/**
 * The shortest text that reads back as exactly `value`, written without an
 * exponent (the digits of `String(value)`, the point moved).
 */
/**
 * `value` nudged by `step`, or null when the step is no sensible nudge of
 * it: larger than the value itself, or too small to change it. For a value
 * shown with an exponent, whose last shown digit names no step.
 */
export function nudgedExactly(value: number, step: number): number | null {
  const next = value + step;
  if (next === value || Math.abs(step) > Math.abs(value) || !Number.isFinite(next)) return null;
  return next;
}

function plainNumber(value: number): string {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (match === null) return text;
  const [, sign, whole, fraction = '', exponent] = match;
  const digits = whole! + fraction;
  const point = whole!.length + Number(exponent);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * `value` as a field shows it: always text that reads back as exactly
 * `value`, never a rounded one and never `0` for a value that is not zero.
 * With `places` decimals when that is exact and short; else the shortest
 * exact plain decimal; else, when that is longer than a field can sensibly
 * show, the shortest round-trip form, which may carry an exponent.
 */
export function exactNumberText(value: number, places?: number): string {
  if (places !== undefined && Math.abs(value) < 1e21) {
    const text = value.toFixed(Math.min(Math.max(places, 0), 100));
    if (text.length <= MAX_PLAIN_LENGTH && Number(text) === value) return text;
  }
  const plain = plainNumber(value);
  return plain.length <= MAX_PLAIN_LENGTH ? plain : String(value);
}

const PLAIN_DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * The text a field shows for a staged value: exactly the value that will be
 * sent, never the raw text. A number keeps the decimals the operator typed
 * (`2.50` stays `2.50`); typed another way (`1e-3`, `0x10`) it takes
 * `decimals` (the widget's or the channel's precision) when that prints the
 * value exactly. See {@link exactNumberText}.
 */
export function stagedText(staged: StagedValue, decimals?: number): string {
  if (typeof staged.value !== 'number') return String(staged.value);
  const typed = staged.entered?.trim();
  let places = decimals;
  if (typed !== undefined && PLAIN_DECIMAL.test(typed)) {
    const dot = typed.indexOf('.');
    places = dot === -1 ? 0 : typed.length - dot - 1;
  }
  return exactNumberText(staged.value, places);
}

const NO_SUBSCRIPTION = () => {};

/**
 * The staging of one mounted entry: the store, and the value its channel
 * holds in `scope` now. `store` is null when the entry has no scope or no
 * channel, and when no store is provided. The entry is attached to the store
 * while mounted with this scope and channel.
 */
export function useStaged(
  scope: string | null,
  pv: string
): {
  store: StagingStore | null;
  staged: StagedValue | undefined;
  /** A run is writing the entry's staged value, or may: the entry is locked. */
  locked: boolean;
  /** The staged value disagrees with another staged for the same channel. */
  conflict: boolean;
} {
  const provided = useContext(Staging);
  const store = scope !== null && pv !== '' ? provided : null;
  useEffect(
    () => (store !== null && scope !== null ? store.attach(scope, pv) : undefined),
    [store, scope, pv]
  );
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(listener) ?? NO_SUBSCRIPTION,
    [store]
  );
  const snapshot = useCallback(
    () => (store !== null && scope !== null ? store.get(scope, pv) : undefined),
    [store, scope, pv]
  );
  const writing = useCallback(
    () => store !== null && scope !== null && store.writing(scope),
    [store, scope]
  );
  const staged = useSyncExternalStore(subscribe, snapshot, snapshot);
  const isWriting = useSyncExternalStore(subscribe, writing, writing);
  const marked = useCallback(() => {
    const held = store !== null && scope !== null ? store.get(scope, pv) : undefined;
    return held !== undefined && store !== null && store.marked(held);
  }, [store, scope, pv]);
  const conflict = useSyncExternalStore(subscribe, marked, marked);
  return { store, staged, locked: isWriting && staged !== undefined, conflict };
}
