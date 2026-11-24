// Hover groups: one thing drawn as many nodes (a coil as two polygons and a
// row in a list) that hover as one.
//
// - A node may carry `props.hoverGroups`, group names ordered from narrow to
//   wide (`["coil-4", "circuit-main"]`). Such a node takes the pointer, on
//   its box or, a polygon with `hitArea: 'shape'`, on its shape. While the
//   pointer is on it, it is the hovered node: every node whose `hoverGroups`
//   holds the hovered node's first name is highlighted as the hovered node
//   is, every other node that holds one of its further names gets a lighter
//   highlight, and the hovered node alone shows its hover label.
// - A node may carry `props.hoverDimGroup`, the name of the drawing it is a
//   part of. While the hovered node carries the same name, the parts of that
//   drawing with neither highlight step back (reduced opacity).
//
// Names are matched across the whole rendered screen, embedded screens
// included; a macro in a name keeps the instances of an embedded screen
// apart. The store lives per rendered top screen, as the device store does.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

/** What a hover on some node of the screen makes of one node. */
export type HoverGroupRole =
  /** The node the pointer is on. */
  | 'hovered'
  /** Shares the hovered node's narrowest group. */
  | 'member'
  /** Shares one of the hovered node's wider groups only. */
  | 'related'
  /** Part of the hovered node's drawing, with neither highlight. */
  | 'dimmed';

function name(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The `hoverGroups` of `props`, narrow to wide: its non-blank strings, trimmed. */
export function hoverGroupsOf(props: Readonly<Record<string, unknown>>): string[] {
  const raw = props.hoverGroups;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map(name).filter((group) => group !== null);
}

/** The `hoverDimGroup` of `props`, or null. */
export function hoverDimGroupOf(props: Readonly<Record<string, unknown>>): string | null {
  return name(props.hoverDimGroup);
}

interface Hovered {
  /** Identifies the node. */
  readonly token: object;
  readonly groups: readonly string[];
  readonly dimGroup: string | null;
}

export class HoverGroupStore {
  // Every node the pointer is on, in the order it entered them: a node and a
  // container around it can both carry groups. The last one is the hovered node.
  private entered: Hovered[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** The role of the node `token` with these groups, or null while it has none. */
  roleOf(token: object, groups: readonly string[], dimGroup: string | null): HoverGroupRole | null {
    const hovered = this.entered.at(-1);
    if (hovered === undefined) return null;
    if (hovered.token === token) return 'hovered';
    if (groups.includes(hovered.groups[0]!)) return 'member';
    if (groups.some((group) => hovered.groups.indexOf(group) > 0)) return 'related';
    return dimGroup !== null && dimGroup === hovered.dimGroup ? 'dimmed' : null;
  }

  /** The pointer came onto the node `token`; `groups` is not empty. */
  enter(token: object, groups: readonly string[], dimGroup: string | null): void {
    this.entered = [...this.entered.filter((e) => e.token !== token), { token, groups, dimGroup }];
    this.emit();
  }

  leave(token: object): void {
    if (!this.entered.some((e) => e.token === token)) return;
    this.entered = this.entered.filter((e) => e.token !== token);
    this.emit();
  }
}

export const HoverGroupStoreContext = createContext<HoverGroupStore | null>(null);

function noSubscribe(): () => void {
  return () => {};
}

export interface HoverGroupLink {
  /** The node's role in the current hover; re-renders only when it changes. */
  role: HoverGroupRole | null;
  /** Pointer handlers of a node with `hoverGroups`; null for a node without. */
  pointer: { enter: () => void; leave: () => void } | null;
}

/**
 * Links a node to the screen's hover groups by its `hoverGroups` and
 * `hoverDimGroup` props. A node with neither subscribes to nothing. A hovered
 * node that unmounts or hides gets no mouseleave, so it leaves then.
 */
export function useHoverGroup(
  props: Readonly<Record<string, unknown>>,
  shown: boolean
): HoverGroupLink {
  const store = useContext(HoverGroupStoreContext);
  const [me] = useState<object>(() => ({}));
  // Keyed on the names, so a fresh array with the same names is the same groups.
  const key = hoverGroupsOf(props).join('\n');
  const groups = useMemo(() => (key === '' ? [] : key.split('\n')), [key]);
  const dimGroup = hoverDimGroupOf(props);
  const linked = store !== null && (groups.length > 0 || dimGroup !== null);
  const role = useSyncExternalStore(
    linked ? store.subscribe : noSubscribe,
    () => (linked ? store.roleOf(me, groups, dimGroup) : null),
    () => null
  );
  const takesPointer = store !== null && groups.length > 0 && shown;
  useEffect(() => {
    if (store === null || takesPointer) return undefined;
    store.leave(me);
    return undefined;
  }, [store, takesPointer, me]);
  useEffect(() => () => store?.leave(me), [store, me]);
  const pointer = useMemo(
    () =>
      store === null || groups.length === 0
        ? null
        : {
            enter: () => store.enter(me, groups, dimGroup),
            leave: () => store.leave(me),
          },
    [store, groups, dimGroup, me]
  );
  return { role, pointer };
}
