// Devices: one machine device drawn in several places of a screen (a magnet's
// symbol in the beamline sketch and its setpoint tile, a BPM's marker and its
// plot) linked by an authored `props.device` id.
//
// - A node carrying `device` is a link target: hovering it focuses the device,
//   and while one is focused every node carrying the same id draws the accent
//   outline, so the symbol and the tile find each other.
// - Every node under a node that carries `device` (an embedded tile's own
//   widgets) registers its machine channels for that device; the node itself
//   registers its own, with the role its widget gives it. A right click on a
//   link target opens a menu that plots those channels in Trace, values first.
//
// The store lives per rendered top screen (a new screen gets a new one).

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { ColorRole, FlatScheme } from '@slaclab/canopy-screen-ir';
import { resolveRole } from '../theme/resolveRoles.js';
import { FORMULA_PREFIX } from '../formulaRef.js';
import type { ScreenPVRole } from './collectPVs.js';
import { PopupMenu } from './popupMenu.js';
import type { MenuAnchor } from './popupMenu.js';

const ACCENT: ColorRole = { $role: 'ActiveText', fallback: '#0f62fe', fallbackDark: '#78a9ff' };

/** The authored device id of `props`, or null. */
export function deviceOf(props: Readonly<Record<string, unknown>>): string | null {
  const device = props.device;
  return typeof device === 'string' && device.trim() !== '' ? device.trim() : null;
}

// Values first (what a plot is for), then states and inputs, setpoints last:
// a plot takes only so many curves.
const PLOT_ORDER: readonly ScreenPVRole[] = [
  'readback',
  'plot',
  'status',
  'other',
  'rule',
  'formula',
  'control',
];

interface DeviceMenuState extends MenuAnchor {
  readonly device: string;
}

export class DeviceStore {
  private focus: string | null = null;
  private menu: DeviceMenuState | null = null;
  // device -> channel -> role -> how many nodes registered it so
  private readonly channels = new Map<string, Map<string, Map<ScreenPVRole, number>>>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getFocused = (): string | null => this.focus;
  getMenu = (): DeviceMenuState | null => this.menu;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Adds `channels` to `device`'s list in `role`; returns the undo. */
  register(device: string, channels: readonly string[], role: ScreenPVRole): () => void {
    let byChannel = this.channels.get(device);
    if (!byChannel) this.channels.set(device, (byChannel = new Map()));
    const held = byChannel;
    for (const channel of channels) {
      let roles = held.get(channel);
      if (!roles) held.set(channel, (roles = new Map()));
      roles.set(role, (roles.get(role) ?? 0) + 1);
    }
    return () => {
      for (const channel of channels) {
        const roles = held.get(channel);
        if (!roles) continue;
        const n = (roles.get(role) ?? 1) - 1;
        if (n > 0) roles.set(role, n);
        else roles.delete(role);
        if (roles.size === 0) held.delete(channel);
      }
    };
  }

  /** `device`'s channels in plot order (PLOT_ORDER by their best role), then by name. */
  channelsOf(device: string): string[] {
    const rank = (roles: Map<ScreenPVRole, number>) =>
      Math.min(...[...roles.keys()].map((role) => PLOT_ORDER.indexOf(role)));
    return [...(this.channels.get(device) ?? [])]
      .map(([channel, roles]) => ({ channel, rank: rank(roles) }))
      .sort((a, b) => a.rank - b.rank || a.channel.localeCompare(b.channel))
      .map((entry) => entry.channel);
  }

  enter(device: string): void {
    if (this.focus === device) return;
    this.focus = device;
    this.emit();
  }

  leave(): void {
    if (this.focus === null) return;
    this.focus = null;
    this.emit();
  }

  /** Opens `device`'s menu at a pointer position; false when it has no channels. */
  openMenu(device: string, x: number, y: number): boolean {
    if (this.channelsOf(device).length === 0) return false;
    this.menu = { device, x, y };
    this.emit();
    return true;
  }

  closeMenu = (): void => {
    if (this.menu === null) return;
    this.menu = null;
    this.emit();
  };
}

export const DeviceStoreContext = createContext<DeviceStore | null>(null);

/** The device a subtree's nodes register their channels under (an embedded tile's). */
export const InheritedDeviceContext = createContext<string | null>(null);

/** Whether `device` is the focused one; re-renders only when that answer flips. */
export function useDeviceFocused(device: string | null): boolean {
  const store = useContext(DeviceStoreContext);
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => (store !== null && device !== null ? store.getFocused() === device : false),
    () => false
  );
}

function noSubscribe(): () => void {
  return () => {};
}

/** Registers a node's machine channels in `role` under its device (own or inherited). */
export function useRegisterDeviceChannels(
  device: string | null,
  channels: readonly string[],
  role: ScreenPVRole
): void {
  const store = useContext(DeviceStoreContext);
  const key = channels.join('\n');
  useEffect(() => {
    if (store === null || device === null) return undefined;
    const machine = channels.filter(
      (c) => !c.startsWith(FORMULA_PREFIX) && !c.startsWith('loc://')
    );
    if (machine.length === 0) return undefined;
    return store.register(device, machine, role);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands in for channels
  }, [store, device, role, key]);
}

/**
 * Pointer handlers for a link target (`device` null: none). A node that
 * unmounts or hides while the pointer is on it gets no mouseleave, so it
 * leaves then: otherwise the highlight would stay until the next hover.
 */
export function useDeviceHover(
  device: string | null,
  shown: boolean
): { enter: () => void; leave: () => void; openMenu: (x: number, y: number) => boolean } | null {
  const store = useContext(DeviceStoreContext);
  const inside = useRef(false);
  useEffect(() => {
    if (shown || !inside.current) return;
    inside.current = false;
    store?.leave();
  }, [shown, store]);
  useEffect(
    () => () => {
      if (!inside.current) return;
      inside.current = false;
      store?.leave();
    },
    [store]
  );
  return useMemo(
    () =>
      store === null || device === null
        ? null
        : {
            enter: () => {
              inside.current = true;
              store.enter(device);
            },
            leave: () => {
              inside.current = false;
              store.leave();
            },
            openMenu: (x: number, y: number) => store.openMenu(device, x, y),
          },
    [store, device]
  );
}

/** The outline a linked node draws while its device is focused. */
export function linkedOutline(
  flat: FlatScheme
): Pick<CSSProperties, 'outline' | 'outlineOffset' | 'borderRadius'> {
  return { outline: `2px solid ${resolveRole(ACCENT, flat)}`, outlineOffset: 3, borderRadius: 4 };
}

/** The open right-click menu of a device: plot its channels in Trace. */
export function DeviceMenu({ plotPVs }: { plotPVs: (pvs: readonly string[]) => void }) {
  const store = useContext(DeviceStoreContext);
  const menu = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.getMenu() ?? null,
    () => null
  );
  if (store === null || menu === null) return null;
  return (
    <PopupMenu
      anchor={menu}
      close={store.closeMenu}
      items={[{ label: 'Open in Trace', run: () => plotPVs(store.channelsOf(menu.device)) }]}
    />
  );
}
