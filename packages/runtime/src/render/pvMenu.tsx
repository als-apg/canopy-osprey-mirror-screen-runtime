// The right-click menu of a node's machine channels: what the channel is
// (name, description, value, time, severity, limits) and what to do with it
// (copy, plot its history, correlate it, open its page). The action list is
// the same for every node; on a node with several channels a switcher above
// it picks the one the list acts on, so the menu's size does not grow with
// the channel count. An entry whose host hook is absent is left out.

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePV } from '@slaclab/canopy-react';
import type { ColorRole, PropertyValue } from '@slaclab/canopy-screen-ir';
import type { ActionHost } from '../actions/ActionHostContext.js';
import type { PVInfo } from '../actions/dispatch.js';
import { isGateBypass } from '../channels.js';
import { resolveRole } from '../theme/resolveRoles.js';
import { SchemeContext } from '../theme/schemeContext.js';
import { nodeChannelSources, pvRoleOf } from './collectPVs.js';
import { HOST, HostPortal } from './popupMenu.js';
import type { MenuAnchor } from './popupMenu.js';

const ACCENT = 'var(--canopy-host-accent, var(--cds-interactive, #0f62fe))';
const ON_ACCENT = 'var(--canopy-host-on-accent, var(--cds-text-on-color, #ffffff))';

/** One channel of the menu. */
export interface PvMenuChannel {
  readonly name: string;
  /** What the channel is to the widget: "Readback", "Setpoint", a curve's name. */
  readonly label: string;
}

// What a prop key says about its channel, where the key says more than the
// widget's role does.
const KEY_LABEL: Readonly<Record<string, string>> = {
  controlPV: 'Setpoint',
  targetPV: 'Setpoint',
  readbackPV: 'Readback',
  colorPV: 'Colour',
  visibilityPV: 'Visibility',
  x_channel: 'X axis',
};
const ROLE_LABEL: Readonly<Record<string, string>> = {
  readback: 'Readback',
  control: 'Setpoint',
  status: 'Status',
  plot: 'Curve',
};

/**
 * The machine channels the menu of a node offers (`loc://` and `formula://`
 * names are the screen's own and left out), each once, a readback first.
 */
export function pvMenuChannels(
  type: string,
  props: Readonly<Record<string, PropertyValue>>
): PvMenuChannel[] {
  const out: PvMenuChannel[] = [];
  for (const { name, key, owner } of nodeChannelSources(type, props)) {
    if (isGateBypass(name) || out.some((channel) => channel.name === name)) continue;
    const curve = key === 'y_channel' && typeof owner?.name === 'string' ? owner.name.trim() : '';
    const main = key === 'pv' || key === 'pvName' || key === 'channel';
    const label =
      curve !== ''
        ? curve
        : main && type === 'pv-button'
          ? 'Command'
          : (KEY_LABEL[key] ?? ROLE_LABEL[pvRoleOf(type)] ?? 'Value');
    out.push({ name, label });
  }
  const lead = out.findIndex((channel) => channel.label === 'Readback');
  if (lead > 0) out.unshift(...out.splice(lead, 1));
  return out;
}

/** The host hooks the menu reads. */
export type PvMenuHost = Pick<
  ActionHost,
  'plotPVs' | 'addToPlot' | 'correlation' | 'pvDetails' | 'pvInfo'
>;

// Channels shown as chips; one more than fit puts the last chip's place to an
// overflow list.
const CHIPS = 3;
const WIDTH = 300;
const EDGE = 8;

const SEVERITY: ReadonlyArray<readonly [string, ColorRole]> = [
  ['OK', { $role: 'OK', fallback: '#24a148' }],
  ['MINOR', { $role: 'MINOR', fallback: '#f1c21b' }],
  ['MAJOR', { $role: 'MAJOR', fallback: '#da1e28' }],
  ['INVALID', { $role: 'INVALID', fallback: '#8a3ffc' }],
  ['Disconnected', { $role: 'DISCONNECTED', fallback: '#8d8d8d' }],
];

const MENU: CSSProperties = {
  position: 'fixed',
  zIndex: HOST.z,
  width: WIDTH,
  padding: 4,
  background: HOST.bg,
  color: HOST.fg,
  border: `1px solid ${HOST.border}`,
  borderRadius: HOST.radius,
  boxShadow: HOST.shadow,
  font: `13px/1.35 ${HOST.ui}`,
};
const CHIP_ROW: CSSProperties = { display: 'flex', gap: 4, padding: '4px 4px 6px' };
const CHIP: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  padding: '3px 6px',
  border: `1px solid ${HOST.border}`,
  borderRadius: 999,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const HEAD: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 8px 8px',
  border: 'none',
  borderRadius: HOST.radiusSm,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'copy',
};
const NAME: CSSProperties = {
  fontFamily: HOST.mono,
  fontWeight: 600,
  overflowWrap: 'anywhere',
};
const SUB: CSSProperties = {
  marginTop: 2,
  color: HOST.dim,
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const RULE: CSSProperties = { height: 1, margin: '4px 0', background: HOST.border };
const ITEM: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 12,
  width: '100%',
  textAlign: 'left',
  padding: '5px 8px',
  border: 'none',
  borderRadius: HOST.radiusSm,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};
// A hint that is a PV name is set as one.
const NAME_HINT: CSSProperties = { fontFamily: HOST.mono };
const HINT: CSSProperties = {
  minWidth: 0,
  color: HOST.dim,
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

interface Entry {
  readonly label: string;
  readonly hint?: string;
  /** Undefined: shown, but it cannot run now. */
  readonly run: (() => void) | undefined;
  /** The menu stays open after the pick (the pick changes what it says). */
  readonly keep?: boolean;
}

function copyText(text: string): void {
  const fallback = () => {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    try {
      document.execCommand('copy');
    } finally {
      area.remove();
    }
  };
  // An embedded page may hold no clipboard permission.
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
}

function numberText(value: number): string {
  return String(Number(value.toPrecision(6)));
}

/** The alarm limits a source states: both, or the one it has. */
function alarmText(info: PVInfo | null): string | null {
  const { alarmLow: low, alarmHigh: high } = info ?? {};
  if (low !== undefined && high !== undefined) {
    return `alarm ${numberText(low)} … ${numberText(high)}`;
  }
  if (high !== undefined) return `alarm above ${numberText(high)}`;
  if (low !== undefined) return `alarm below ${numberText(low)}`;
  return null;
}

export function PvMenu(props: {
  anchor: MenuAnchor;
  channels: readonly PvMenuChannel[];
  host: PvMenuHost;
  /** The channels of the device the node belongs to, in plot order. */
  deviceChannels?: (() => readonly string[]) | undefined;
  close: () => void;
}) {
  return (
    <HostPortal>
      <MenuBody {...props} />
    </HostPortal>
  );
}

function MenuBody({ anchor, channels, host, deviceChannels, close }: Parameters<typeof PvMenu>[0]) {
  const ref = useRef<HTMLDivElement>(null);
  const flat = useContext(SchemeContext);
  const [at, setAt] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [x, setX] = useState(() => host.correlation?.x() ?? null);
  const [height, setHeight] = useState(0);
  const count = channels.length;
  const channel = channels[Math.min(at, count - 1)]!;
  const pv = usePV(channel.name);
  const many = count > 1;

  const pick = useCallback((index: number) => {
    setAt(index);
    setListOpen(false);
  }, []);

  useEffect(() => {
    const items = () => [
      ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ];
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const all = items();
        if (all.length === 0) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const from = all.indexOf(document.activeElement as HTMLElement);
        const next = from === -1 ? (step === 1 ? 0 : all.length - 1) : from + step;
        all[(next + all.length) % all.length]!.focus();
        e.preventDefault();
      } else if (many && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const step = e.key === 'ArrowRight' ? 1 : count - 1;
        setAt((i) => (i + step) % count);
        setListOpen(false);
        e.preventDefault();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [close, many, count]);
  // The menu's height changes with the channel count and the open list: it is
  // measured before paint so the menu never leaves the window.
  useLayoutEffect(() => {
    setHeight(ref.current?.offsetHeight ?? 0);
  }, [at, listOpen, count]);

  const waveform = Array.isArray(pv.value);
  const shown = waveform
    ? `${(pv.value as unknown[]).length} points`
    : `${pv.displayValue}${pv.units ? ` ${pv.units}` : ''}`;
  const copied = waveform
    ? (pv.value as unknown[]).join(' ')
    : `${pv.displayValue}${pv.units ? ` ${pv.units}` : ''}`;
  const info = host.pvInfo?.(channel.name) ?? null;
  const correlation = host.correlation;
  const isX = x === channel.name;

  const groups: Entry[][] = [
    [
      { label: 'Copy PV name', run: () => copyText(channel.name) },
      { label: 'Copy value', run: pv.connected ? () => copyText(copied) : undefined },
    ],
    [
      ...(host.plotPVs
        ? [{ label: 'Plot history', run: () => host.plotPVs!([channel.name]) }]
        : []),
      ...(host.addToPlot
        ? [{ label: 'Add to history plot', run: () => host.addToPlot!(channel.name) }]
        : []),
      ...(correlation
        ? [
            {
              label: 'Correlation: use as X',
              ...(isX ? { hint: 'picked' } : {}),
              keep: true,
              run: () => {
                correlation.pickX(channel.name);
                setX(channel.name);
              },
            },
            x !== null && !isX
              ? {
                  label: 'Correlation: plot against',
                  hint: x,
                  run: () => correlation.plotY(channel.name),
                }
              : {
                  label: 'Correlation: add as Y',
                  hint: isX ? 'this is the X' : 'pick an X first',
                  run: undefined,
                },
          ]
        : []),
    ],
    host.pvDetails ? [{ label: 'PV details…', run: () => host.pvDetails!(channel.name) }] : [],
    host.plotPVs
      ? [
          ...(many
            ? [
                {
                  label: `Plot history of all ${count}`,
                  run: () => host.plotPVs!(channels.map((c) => c.name)),
                },
              ]
            : []),
          ...(deviceChannels && deviceChannels().some((name) => name !== channel.name)
            ? [
                {
                  label: 'Plot history of the device',
                  run: () => host.plotPVs!(deviceChannels()),
                },
              ]
            : []),
        ]
      : [],
  ].filter((group) => group.length > 0);

  const severity = SEVERITY[pv.connected ? Math.min(Math.max(pv.severity, 0), 3) : 4]!;
  const facts = [
    severity[0],
    pv.connected && pv.upperLimit > pv.lowerLimit
      ? `range ${numberText(pv.lowerLimit)} … ${numberText(pv.upperLimit)}`
      : null,
    alarmText(info),
  ].filter((fact) => fact !== null);
  const time =
    pv.connected && pv.timestamp > 0 ? new Date(pv.timestamp).toLocaleTimeString() : null;

  const chips = channels.slice(0, count > CHIPS ? CHIPS - 1 : CHIPS);
  const rest = channels.slice(chips.length);
  const inRest = at >= chips.length;
  const chipStyle = (on: boolean): CSSProperties =>
    on ? { ...CHIP, background: ACCENT, borderColor: ACCENT, color: ON_ACCENT } : CHIP;
  const itemStyle = (id: string, enabled: boolean, on = false): CSSProperties => ({
    ...ITEM,
    background: on || (enabled && hover === id) ? HOST.hover : 'transparent',
    ...(enabled ? {} : { opacity: 0.45, cursor: 'default' }),
  });

  const left = Math.max(EDGE, Math.min(anchor.x, window.innerWidth - WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(anchor.y, window.innerHeight - height - EDGE));
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`PV ${channel.name}`}
      data-testid="canopy-pv-menu"
      style={{ ...MENU, left, top }}
      // The menu's own right click is not another node's.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {many && (
        <div style={CHIP_ROW} role="tablist" aria-label="Channel">
          {chips.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="tab"
              aria-selected={at === i}
              title={c.name}
              style={chipStyle(at === i)}
              onClick={() => pick(i)}
            >
              {c.label}
            </button>
          ))}
          {rest.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={inRest}
              aria-expanded={listOpen}
              style={chipStyle(inRest)}
              onClick={() => setListOpen((open) => !open)}
            >
              {inRest ? channel.label : `${rest.length} more`} ▾
            </button>
          )}
        </div>
      )}
      {listOpen ? (
        rest.map((c, j) => {
          const index = chips.length + j;
          return (
            <button
              key={c.name}
              type="button"
              role="menuitem"
              style={itemStyle(c.name, true, at === index)}
              onMouseEnter={() => setHover(c.name)}
              onMouseLeave={() => setHover(null)}
              onClick={() => pick(index)}
            >
              <span style={{ whiteSpace: 'nowrap' }}>{c.label}</span>
              <span style={{ ...HINT, ...NAME_HINT }}>{c.name}</span>
            </button>
          );
        })
      ) : (
        <>
          <button
            type="button"
            style={HEAD}
            title="Copy PV name"
            data-testid="canopy-pv-menu-head"
            onClick={() => copyText(channel.name)}
          >
            <div style={NAME}>{channel.name}</div>
            {info?.description !== undefined && info.description !== '' && (
              <div style={SUB}>{info.description}</div>
            )}
            <div style={SUB}>
              {pv.connected ? [shown, time].filter(Boolean).join(' · ') : 'no value'}
            </div>
            <div style={SUB}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  marginRight: 6,
                  borderRadius: 4,
                  background: resolveRole(severity[1], flat),
                }}
              />
              {facts.join(' · ')}
            </div>
          </button>
          {groups.map((group, g) => (
            <div key={g}>
              <div style={RULE} />
              {group.map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  role="menuitem"
                  disabled={entry.run === undefined}
                  style={itemStyle(entry.label, entry.run !== undefined)}
                  onMouseEnter={() => setHover(entry.label)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    entry.run?.();
                    if (!entry.keep) close();
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap' }}>{entry.label}</span>
                  {entry.hint !== undefined && (
                    <span style={entry.hint === x ? { ...HINT, ...NAME_HINT } : HINT}>
                      {entry.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
