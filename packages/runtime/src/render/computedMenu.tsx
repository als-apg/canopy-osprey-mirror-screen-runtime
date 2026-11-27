// The right-click menu of a value the screen computes from machine channels
// (a `formula://` channel), and the window that lists those channels. The
// menu has the same few lines for two inputs and for two hundred: it names
// them by their pattern and never lists them; the list is the window's.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePV } from '@slaclab/canopy-react';
import type { FormulaDeclaration, MacroValues, PropertyValue } from '@slaclab/canopy-screen-ir';
import { isGateBypass } from '../channels.js';
import { formulaName, isFormulaRef } from '../formulaRef.js';
import { substituteMacros } from '../macros.js';
import { resolveRole } from '../theme/resolveRoles.js';
import { SchemeContext } from '../theme/schemeContext.js';
import { nodeChannelSources } from './collectPVs.js';
import { HOST, HostPortal } from './popupMenu.js';
import type { MenuAnchor } from './popupMenu.js';
import {
  EDGE,
  HEAD,
  HINT,
  ITEM,
  MENU,
  NAME,
  PvMenu,
  RULE,
  SEVERITY,
  SUB,
  WIDTH,
  copyText,
  valueText,
} from './pvMenu.js';
import type { PvMenuHost } from './pvMenu.js';

/** A value a node shows that the screen computes. */
export interface ComputedValue {
  /** The channel the node reads: `formula://<name>`. */
  readonly channel: string;
  /** What the node calls the value, when it says. */
  readonly title: string | null;
  /** The machine channels the value is computed from, each once, in formula order. */
  readonly inputs: readonly string[];
  /** The expression, with each input's token replaced by its channel. */
  readonly expression: string;
  /** The decimals the node shows the value with, when it sets them. */
  readonly precision: number | null;
}

// The most channels one history plot takes.
const PLOT_MAX = 12;

/**
 * The computed value `props` show, or null: the first `formula://` channel of
 * the node whose formula reads at least one machine channel.
 */
export function computedValueOf(
  type: string,
  props: Readonly<Record<string, PropertyValue>>,
  formulas: readonly FormulaDeclaration[] | undefined,
  macros: MacroValues
): ComputedValue | null {
  for (const { name } of nodeChannelSources(type, props)) {
    if (!isFormulaRef(name)) continue;
    const decl = (formulas ?? []).find((f) => f.name === formulaName(name));
    if (!decl) continue;
    const bound = Object.entries(decl.bindings ?? {}).map(
      ([token, channel]) => [token, substituteMacros(String(channel), macros)] as const
    );
    const used = bound.filter(([token]) => decl.expression.includes(`{${token}}`));
    const inputs = [...new Set(used.map(([, channel]) => channel))].filter(
      (channel) => !isGateBypass(channel)
    );
    if (inputs.length === 0) continue;
    let expression = decl.expression;
    for (const [token, channel] of used) expression = expression.split(`{${token}}`).join(channel);
    const title =
      typeof props.menuTitle === 'string' && props.menuTitle !== '' ? props.menuTitle : null;
    const precision =
      typeof props.precision === 'number' && props.precision >= 0 ? props.precision : null;
    return { channel: name, title, inputs, expression, precision };
  }
  return null;
}

/**
 * One line for many names. Names that differ only in their numbers are one
 * family, written with `*` for the numbers that differ; the largest family
 * is named and the others counted.
 */
export function namePattern(names: readonly string[]): string {
  const families = new Map<string, string[][]>();
  for (const name of names) {
    const parts = name.split(/(\d+)/);
    const shape = parts.map((piece, i) => (i % 2 === 1 ? '#' : piece)).join('');
    families.set(shape, [...(families.get(shape) ?? []), parts]);
  }
  const ranked = [...families.values()].sort((a, b) => b.length - a.length);
  const lead = ranked[0]!;
  const first = lead[0]!;
  const pattern = first
    .map((piece, i) => (i % 2 === 1 && lead.some((p) => p[i] !== piece) ? '*' : piece))
    .join('');
  if (ranked.length === 1) return pattern;
  const others = ranked.length - 1;
  return `${pattern} and ${others} more ${others === 1 ? 'family' : 'families'}`;
}

interface Entry {
  readonly label: string;
  readonly hint?: string;
  readonly run: (() => void) | undefined;
}

export function ComputedMenu(props: {
  anchor: MenuAnchor;
  value: ComputedValue;
  host: PvMenuHost;
  openInputs: () => void;
  close: () => void;
}) {
  return (
    <HostPortal>
      <ComputedBody {...props} />
    </HostPortal>
  );
}

function ComputedBody({
  anchor,
  value,
  host,
  openInputs,
  close,
}: Parameters<typeof ComputedMenu>[0]) {
  const ref = useRef<HTMLDivElement>(null);
  const flat = useContext(SchemeContext);
  const [hover, setHover] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const pv = usePV(value.channel);
  const count = value.inputs.length;

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const all = [
          ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
        ];
        if (all.length === 0) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const from = all.indexOf(document.activeElement as HTMLElement);
        const next = from === -1 ? (step === 1 ? 0 : all.length - 1) : from + step;
        all[(next + all.length) % all.length]!.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);
  useLayoutEffect(() => {
    setHeight(ref.current?.offsetHeight ?? 0);
  }, []);

  const shown = !pv.connected
    ? 'no value'
    : typeof pv.value === 'number' && value.precision !== null
      ? pv.value.toFixed(value.precision)
      : valueText(pv);
  const severity = SEVERITY[pv.connected ? Math.min(Math.max(pv.severity, 0), 3) : 4]!;
  const groups: Entry[][] = [
    [
      { label: 'Copy value', run: pv.connected ? () => copyText(shown) : undefined },
      { label: 'Copy formula', run: () => copyText(value.expression) },
    ],
    host.plotPVs
      ? [
          count <= PLOT_MAX
            ? {
                label: `Plot history of the ${count} inputs`,
                run: () => host.plotPVs!(value.inputs),
              }
            : {
                label: 'Plot history',
                hint: `not yet for ${count} inputs`,
                run: undefined,
              },
        ]
      : [],
    [{ label: `Inputs (${count})…`, run: openInputs }],
  ].filter((group) => group.length > 0);

  const left = Math.max(EDGE, Math.min(anchor.x, window.innerWidth - WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(anchor.y, window.innerHeight - height - EDGE));
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={value.title ?? 'Computed value'}
      data-testid="canopy-computed-menu"
      style={{ ...MENU, left, top }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ ...HEAD, cursor: 'default' }}>
        <div style={{ ...NAME, fontFamily: 'inherit' }}>{value.title ?? 'Computed value'}</div>
        <div style={SUB}>{shown}</div>
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
          computed on this screen from {count} PVs
        </div>
        <div style={{ ...SUB, fontFamily: HOST.mono }} title={namePattern(value.inputs)}>
          {namePattern(value.inputs)}
        </div>
        <div style={{ ...SUB, fontFamily: HOST.mono }} title={value.expression}>
          = {value.expression}
        </div>
      </div>
      {groups.map((group, g) => (
        <div key={g}>
          <div style={RULE} />
          {group.map((entry) => (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              disabled={entry.run === undefined}
              style={{
                ...ITEM,
                background:
                  entry.run !== undefined && hover === entry.label ? HOST.hover : 'transparent',
                ...(entry.run === undefined ? { opacity: 0.45, cursor: 'default' } : {}),
              }}
              onMouseEnter={() => setHover(entry.label)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                entry.run?.();
                close();
              }}
            >
              <span style={{ whiteSpace: 'nowrap' }}>{entry.label}</span>
              {entry.hint !== undefined && <span style={HINT}>{entry.hint}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const PANEL: CSSProperties = {
  position: 'fixed',
  zIndex: HOST.z,
  top: 104,
  right: 16,
  width: 380,
  maxHeight: 'calc(100vh - 136px)',
  display: 'flex',
  flexDirection: 'column',
  background: HOST.bg,
  color: HOST.fg,
  border: `1px solid ${HOST.border}`,
  borderRadius: HOST.radius,
  boxShadow: HOST.shadow,
  font: `13px/1.35 ${HOST.ui}`,
};
const PANEL_HEAD: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 10px 4px',
};
const FIELD: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  padding: '4px 8px',
  border: `1px solid ${HOST.border}`,
  borderRadius: HOST.radiusSm,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
};
const TOOL: CSSProperties = {
  padding: '4px 8px',
  border: `1px solid ${HOST.border}`,
  borderRadius: HOST.radiusSm,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  padding: '3px 10px',
  cursor: 'context-menu',
};

/** The inputs of a computed value, one row each; a row's right click is the channel's menu. */
export function InputsPanel(props: { value: ComputedValue; host: PvMenuHost; close: () => void }) {
  return (
    <HostPortal>
      <InputsBody {...props} />
    </HostPortal>
  );
}

function InputsBody({ value, host, close }: Parameters<typeof InputsPanel>[0]) {
  const [filter, setFilter] = useState('');
  // The order "Largest first" gave when it was pressed; null = formula order.
  const [order, setOrder] = useState<readonly string[] | null>(null);
  const [menu, setMenu] = useState<{ at: MenuAnchor; name: string } | null>(null);
  const magnitudes = useRef(new Map<string, number>());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menu === null) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, menu]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (order ?? value.inputs).filter((name) => name.toLowerCase().includes(needle));
  }, [value.inputs, filter, order]);
  const largest = order !== null;
  const toggleLargest = () => {
    if (order !== null) return setOrder(null);
    const size = (name: string) => magnitudes.current.get(name) ?? -1;
    setOrder([...value.inputs].sort((a, b) => size(b) - size(a)));
  };

  return (
    <>
      <div
        role="dialog"
        aria-label={`Inputs of ${value.title ?? 'the computed value'}`}
        data-testid="canopy-inputs-panel"
        style={PANEL}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div style={PANEL_HEAD}>
          <div style={{ fontWeight: 600 }}>
            Inputs of {value.title ?? 'the computed value'}{' '}
            <span style={{ color: HOST.dim, fontWeight: 400 }}>
              {rows.length === value.inputs.length
                ? value.inputs.length
                : `${rows.length} of ${value.inputs.length}`}
            </span>
          </div>
          <button
            type="button"
            style={{ ...TOOL, border: 'none' }}
            aria-label="Close"
            onClick={close}
          >
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '4px 10px 8px' }}>
          <input
            type="search"
            placeholder="Filter by name"
            value={filter}
            style={FIELD}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            type="button"
            style={largest ? { ...TOOL, background: HOST.hover } : TOOL}
            aria-pressed={largest}
            onClick={toggleLargest}
          >
            Largest first
          </button>
        </div>
        <div style={{ ...RULE, margin: 0 }} />
        <div style={{ overflowY: 'auto', padding: '4px 0' }}>
          {rows.map((name) => (
            <InputRow
              key={name}
              name={name}
              on={menu?.name === name}
              note={(size) => magnitudes.current.set(name, size)}
              open={(at) => setMenu({ at, name })}
            />
          ))}
          {rows.length === 0 && <div style={{ ...ROW, color: HOST.dim }}>no input matches</div>}
        </div>
        <div style={{ ...RULE, margin: 0 }} />
        <div style={{ padding: '6px 10px', color: HOST.dim, fontSize: 12 }}>
          Right-click a row for that PV’s menu.
        </div>
      </div>
      {menu !== null && (
        <PvMenu
          anchor={menu.at}
          channels={[{ name: menu.name, label: 'Input' }]}
          host={host}
          close={() => setMenu(null)}
        />
      )}
    </>
  );
}

function InputRow({
  name,
  on,
  note,
  open,
}: {
  name: string;
  on: boolean;
  note: (size: number) => void;
  open: (at: MenuAnchor) => void;
}) {
  const flat = useContext(SchemeContext);
  const pv = usePV(name);
  const [hover, setHover] = useState(false);
  const size = pv.connected && typeof pv.value === 'number' ? Math.abs(pv.value) : -1;
  useEffect(() => {
    note(size);
  });
  const severity = SEVERITY[pv.connected ? Math.min(Math.max(pv.severity, 0), 3) : 4]!;
  return (
    <div
      role="row"
      data-pv-row={name}
      style={{ ...ROW, background: on || hover ? HOST.hover : 'transparent' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open({ x: e.clientX, y: e.clientY });
      }}
    >
      <span style={{ fontFamily: HOST.mono, overflowWrap: 'anywhere' }}>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            marginRight: 8,
            borderRadius: 4,
            background: resolveRole(severity[1], flat),
          }}
        />
        {name}
      </span>
      <span
        style={{
          fontFamily: HOST.mono,
          whiteSpace: 'nowrap',
          color: pv.connected ? 'inherit' : HOST.dim,
        }}
      >
        {pv.connected ? valueText(pv) : 'no value'}
      </span>
    </div>
  );
}
