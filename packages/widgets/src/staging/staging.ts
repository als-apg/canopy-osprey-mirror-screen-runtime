// Staged values: what an operator typed into an entry that stages instead of
// writing (the entry's `stage` prop names a scope). A staged value is held
// here, per screen, until an `apply_staged` action writes the scope through
// the write gate or a `clear_staged` action (or Escape in the entry) drops it.
//
// Staging writes nothing. The store holds one value per channel and scope, in
// the order the channels were first staged; that is the order they are written.

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { WriteValue } from '../writeGate/types.js';

/** One staged value: the channel, the parsed value, and the text as typed. */
export interface StagedValue {
  readonly pv: string;
  readonly value: WriteValue;
  /** The entry's text, for a value typed into a numeric entry. */
  readonly entered?: string;
}

export interface StagingStore {
  /** The value staged for `pv` in `scope`, or undefined. */
  get(scope: string, pv: string): StagedValue | undefined;
  /** Stage `staged` in `scope`, replacing what its channel held there. */
  set(scope: string, staged: StagedValue): void;
  /**
   * Drop what `pv` holds in `scope`. With `only`, drop it only while it is
   * still that very value: one staged again since stays.
   */
  clear(scope: string, pv: string, only?: StagedValue): void;
  /** Drop every value of `scope`. */
  clearScope(scope: string): void;
  /** The values of `scope`, in the order their channels were first staged. */
  list(scope: string): readonly StagedValue[];
  subscribe(listener: () => void): () => void;
}

const NOTHING: readonly StagedValue[] = Object.freeze([]);

export function createStagingStore(): StagingStore {
  const scopes = new Map<string, Map<string, StagedValue>>();
  const lists = new Map<string, readonly StagedValue[]>();
  const listeners = new Set<() => void>();
  const changed = (scope: string) => {
    lists.delete(scope);
    if (scopes.get(scope)?.size === 0) scopes.delete(scope);
    for (const l of [...listeners]) l();
  };
  return {
    get: (scope, pv) => scopes.get(scope)?.get(pv),
    set(scope, staged) {
      let values = scopes.get(scope);
      if (values === undefined) scopes.set(scope, (values = new Map()));
      values.set(staged.pv, staged);
      changed(scope);
    },
    clear(scope, pv, only) {
      const values = scopes.get(scope);
      const held = values?.get(pv);
      if (values === undefined || held === undefined) return;
      if (only !== undefined && held !== only) return;
      values.delete(pv);
      changed(scope);
    },
    clearScope(scope) {
      if (!scopes.has(scope)) return;
      scopes.get(scope)!.clear();
      changed(scope);
    },
    list(scope) {
      let list = lists.get(scope);
      if (list === undefined) {
        const values = scopes.get(scope);
        list = values === undefined ? NOTHING : Object.freeze([...values.values()]);
        lists.set(scope, list);
      }
      return list;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The staging store of the screen, or null where nothing provides one. */
export const Staging = createContext<StagingStore | null>(null);

/** The reserved prop that makes an entry stage: the scope's name, a non-empty string. */
export const STAGE_PROP = 'stage';

/** The scope `props` stages into, or null for an entry that writes. */
export function stageScope(props: Readonly<Record<string, unknown>>): string | null {
  const scope = props[STAGE_PROP];
  return typeof scope === 'string' && scope !== '' ? scope : null;
}

const NO_SUBSCRIPTION = () => {};

/**
 * The staging of one entry: the store and the value its channel holds in
 * `scope` now. `store` is null when the entry does not stage (no scope, no
 * store provided, or no channel).
 */
export function useStaged(
  scope: string | null,
  pv: string
): { store: StagingStore | null; staged: StagedValue | undefined } {
  const provided = useContext(Staging);
  const store = scope !== null && pv !== '' ? provided : null;
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(listener) ?? NO_SUBSCRIPTION,
    [store]
  );
  const snapshot = useCallback(
    () => (store !== null && scope !== null ? store.get(scope, pv) : undefined),
    [store, scope, pv]
  );
  return { store, staged: useSyncExternalStore(subscribe, snapshot, snapshot) };
}
