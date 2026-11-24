// Clickable-area affordances and the resting outline, both drawn on a node's
// positioned wrapper.
//
// - A node whose click runs actions shows a pointer cursor; while hovered it
//   draws a layer over its box: a translucent accent fill, an accent outline
//   and, when the node carries `props.hoverLabel`, that label inside its box,
//   bottom-left unless `props.hoverLabelPlacement` names another corner or
//   `center`. The layer and the label are inert to the pointer, so clicks
//   still reach the wrapper.
// - A polygon carrying `props.hitArea: 'shape'` is met by the pointer on its
//   drawn shape and not on its box (the Polygon widget draws the target):
//   over the inside of a closed polygon, along an open one widened to
//   `props.hitWidth`. Its hover layer is the shape itself, outlined and
//   tinted, with one label that stays upright whatever turns the node. The
//   label is centred on `props.hoverLabelAt` (`[x, y]` in the node's own
//   coordinates) or, without it, on a point inside the shape, and is moved
//   only as far as it takes to stay inside the screen.
// - Nodes that share a hover group (hoverGroups.ts) are highlighted together:
//   the same layer on every member, at half strength on the related ones, and
//   the label on the hovered node alone.
// - The label may show live values: `props.hoverLabelLines`, a list of short
//   lines under the optional `hoverLabel`, each fixed text (`{ text }`) or
//   the value of a channel (`{ label, pv, precision }`), formatted as a text
//   readout formats it. A channel is subscribed only while its label shows.
// - Any node may carry `props.outlineColor` (a color, after role resolution a
//   CSS string) and `props.outlineWidth` (authored px, default 2): an outline
//   drawn just inside its box. Being plain props, both are rule targets, so a
//   rule can tint the outline from live data.
//
// Colors come from scheme roles, so both themes work: the accent is
// `ActiveText`, the label chip uses `Background` and `Text`.

import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { usePV } from '@slaclab/canopy-react';
import type { ColorRole, FlatScheme } from '@slaclab/canopy-screen-ir';
import { displayText, readHitShape, shapeLabelPoint } from '@slaclab/canopy-screen-widgets';
import type { HitShape } from '@slaclab/canopy-screen-widgets';
import { resolveRole } from '../theme/resolveRoles.js';

const ACCENT: ColorRole = { $role: 'ActiveText', fallback: '#0f62fe', fallbackDark: '#78a9ff' };
const LABEL_BACKGROUND: ColorRole = {
  $role: 'Background',
  fallback: '#ffffff',
  fallbackDark: '#161616',
};
const LABEL_TEXT: ColorRole = { $role: 'Text', fallback: '#161616', fallbackDark: '#f4f4f4' };

/** Opacity of the accent fill over a hovered node. */
const FILL_OPACITY = 0.14;
const HOVER_OUTLINE_WIDTH = 2;
/** Opacity of the whole highlight on a node that is only related to the hovered one. */
const RELATED_OPACITY = 0.45;
/** Opacity factor of a node that steps back behind a hovered group. */
export const DIMMED_OPACITY = 0.35;

/** How strongly a node is highlighted: as the hovered node, or as one related to it. */
export type HoverLevel = 'strong' | 'related';

const levelOpacity = (level: HoverLevel) => (level === 'related' ? RELATED_OPACITY : undefined);
const DEFAULT_OUTLINE_WIDTH = 2;

/** The resting outline `props` asks for, as wrapper style, or null for none. */
export function restingOutline(
  props: Readonly<Record<string, unknown>>
): Pick<CSSProperties, 'outline' | 'outlineOffset'> | null {
  const color = props.outlineColor;
  if (typeof color !== 'string' || color === '') return null;
  const raw = props.outlineWidth;
  const width = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_OUTLINE_WIDTH;
  if (width <= 0) return null;
  return { outline: `${width}px solid ${color}`, outlineOffset: -width };
}

/** The `hoverLabel` of `props`, or null when it has none. */
export function hoverLabel(props: Readonly<Record<string, unknown>>): string | null {
  const label = props.hoverLabel;
  return typeof label === 'string' && label !== '' ? label : null;
}

/** One line of a hover label: fixed text, or the live value of a channel. */
export type HoverLabelLine =
  | { readonly text: string }
  | {
      /** What the value is, shown before it (`label: value`); absent: the value alone. */
      readonly label?: string;
      /** The channel whose value the line shows. */
      readonly pv: string;
      /** Decimals of a numeric value; absent: the channel's own precision. */
      readonly precision?: number;
      /** `false` leaves the unit out of a value formatted with `precision`. */
      readonly showUnits?: boolean;
    };

/**
 * The `hoverLabelLines` of `props`: every entry that names a channel (`pv`)
 * or carries a `text`, in order. Anything else is left out.
 */
export function hoverLabelLines(props: Readonly<Record<string, unknown>>): HoverLabelLine[] {
  const raw = props.hoverLabelLines;
  if (!Array.isArray(raw)) return [];
  const lines: HoverLabelLine[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { text, label, pv, precision, showUnits } = entry as Record<string, unknown>;
    if (typeof pv === 'string' && pv.trim() !== '') {
      lines.push({
        pv: pv.trim(),
        ...(typeof label === 'string' && label !== '' ? { label } : {}),
        ...(typeof precision === 'number' ? { precision } : {}),
        ...(showUnits === false ? { showUnits } : {}),
      });
    } else if (typeof text === 'string' && text !== '') {
      lines.push({ text });
    }
  }
  return lines;
}

/** What a line shows for a channel with no value to show, as a text readout does. */
const NO_VALUE = '---';

/**
 * The live value of one label line. Mounted only while the label shows, so
 * the channel is subscribed for that long; it starts from the value the
 * screen's PV service already holds, if any.
 */
function LineValue({ line }: { line: Extract<HoverLabelLine, { pv: string }> }) {
  const pv = usePV(line.pv);
  // A text readout's rule: the authored precision wins over the channel's.
  const text = pv.connected
    ? displayText(pv, {
        precisionFromPV: line.precision === undefined,
        precision: line.precision,
        showUnits: line.showUnits,
      })
    : NO_VALUE;
  return (
    <span
      data-pv={line.pv}
      {...(pv.connected ? {} : { 'data-pv-nostate': 'true' })}
      style={{ fontVariantNumeric: 'tabular-nums', opacity: pv.connected ? undefined : 0.6 }}
    >
      {text}
    </span>
  );
}

const LINE_STYLE: CSSProperties = { display: 'block', font: '400 13px/1.4 system-ui, sans-serif' };

/**
 * What a hover label shows: the `hoverLabel` and, under it, the
 * `hoverLabelLines`; null for a node with neither.
 */
export function hoverLabelContent(props: Readonly<Record<string, unknown>>): ReactNode | null {
  const title = hoverLabel(props);
  const lines = hoverLabelLines(props);
  if (lines.length === 0) return title;
  return (
    <>
      {title !== null && <span style={{ display: 'block' }}>{title}</span>}
      {lines.map((line, i) => (
        <span key={i} data-canopy-hover-line="" style={LINE_STYLE}>
          {'pv' in line ? (
            <>
              {line.label !== undefined && `${line.label}: `}
              <LineValue line={line} />
            </>
          ) : (
            line.text
          )}
        </span>
      ))}
    </>
  );
}

/** Where the hover label sits inside the node: flex alignment per placement. */
const PLACEMENTS = {
  'bottom-left': { alignItems: 'flex-end', justifyContent: 'flex-start' },
  'bottom-right': { alignItems: 'flex-end', justifyContent: 'flex-end' },
  'top-left': { alignItems: 'flex-start', justifyContent: 'flex-start' },
  'top-right': { alignItems: 'flex-start', justifyContent: 'flex-end' },
  center: { alignItems: 'center', justifyContent: 'center' },
} as const;

export type HoverLabelPlacement = keyof typeof PLACEMENTS;

/** The `hoverLabelPlacement` of `props`; bottom-left when absent or unknown. */
export function hoverLabelPlacement(props: Readonly<Record<string, unknown>>): HoverLabelPlacement {
  const placement = props.hoverLabelPlacement;
  return typeof placement === 'string' && Object.hasOwn(PLACEMENTS, placement)
    ? (placement as HoverLabelPlacement)
    : 'bottom-left';
}

/** Gap between the hover label and the node's edges, authored px. */
const LABEL_INSET = 6;

/** The label chip of a hover layer, less its position. */
function labelStyle(accent: string, flat: FlatScheme): CSSProperties {
  return {
    pointerEvents: 'none',
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${accent}`,
    background: resolveRole(LABEL_BACKGROUND, flat),
    color: resolveRole(LABEL_TEXT, flat),
    font: '600 16px/1.2 system-ui, sans-serif',
    whiteSpace: 'nowrap',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
  };
}

/** The layer a hovered clickable node draws over its box. */
export function HoverLayer({
  label,
  placement = 'bottom-left',
  level = 'strong',
  round = false,
  raised = false,
  flat,
}: {
  label: ReactNode | null;
  placement?: HoverLabelPlacement;
  level?: HoverLevel;
  /** Draw the layer as the ellipse inscribed in the box. */
  round?: boolean;
  /** Lift the label over later nodes and keep it inside the screen. */
  raised?: boolean;
  flat: FlatScheme;
}) {
  const accent = resolveRole(ACCENT, flat);
  const layerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (raised && layerRef.current !== null && labelRef.current !== null) {
      settleLabel(layerRef.current, labelRef.current, '', false);
    }
  });
  const radius = round ? '50%' : undefined;
  return (
    <div
      ref={layerRef}
      data-canopy-hover=""
      data-canopy-hover-level={level}
      data-placement={placement}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        outline: `${HOVER_OUTLINE_WIDTH}px solid ${accent}`,
        outlineOffset: -HOVER_OUTLINE_WIDTH,
        borderRadius: radius,
        opacity: levelOpacity(level),
        display: 'flex',
        padding: LABEL_INSET,
        boxSizing: 'border-box',
        ...PLACEMENTS[placement],
      }}
    >
      <div
        data-canopy-hover-fill=""
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          background: accent,
          opacity: FILL_OPACITY,
        }}
      />
      {label !== null && (
        <span
          ref={labelRef}
          data-canopy-hover-label=""
          style={{
            position: 'relative',
            ...(raised ? { zIndex: RAISED_Z } : {}),
            ...labelStyle(accent, flat),
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * The shape a polygon node is met on (`props.hitArea: 'shape'`), or null for
 * a node met on its box: every other node type, and a polygon without it.
 */
export function nodeHitShape(
  nodeType: string,
  props: Readonly<Record<string, unknown>>
): HitShape | null {
  return nodeType === 'polygon' ? readHitShape(props) : null;
}

/**
 * How the transforms of `element` and of everything around it turn and scale
 * its content (their linear part); null where it cannot be read.
 */
function renderedTransform(element: Element): DOMMatrixReadOnly | null {
  if (typeof DOMMatrixReadOnly === 'undefined') return null;
  let matrix = new DOMMatrixReadOnly();
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const transform = getComputedStyle(at).transform;
    if (!transform || transform === 'none') continue;
    matrix = new DOMMatrixReadOnly(transform).multiply(matrix);
  }
  return matrix;
}

/** How far a span from `low` to `high` moves to lie between `min` and `max`. */
function shiftInto(low: number, high: number, min: number, max: number): number {
  if (high - low > max - min || low < min) return min - low;
  return high > max ? max - high : 0;
}

/** Room kept between a shape's hover label and the screen's edge, authored px. */
const LABEL_EDGE_GAP = 4;
/** Lifts the label of a hovered group over the nodes drawn after its node. */
const RAISED_Z = 1;

/**
 * Turns the label of a shape's hover layer upright against everything that
 * turns the node, and moves it back inside the screen where it would be cut
 * off at the edge. A no-op where the layout cannot be measured. A box's
 * label (`anchor` '', `turnUpright` false) is only moved in.
 */
function settleLabel(
  layer: HTMLElement,
  chip: HTMLElement,
  anchor = 'translate(-50%, -50%)',
  turnUpright = true
): void {
  const matrix = renderedTransform(layer);
  if (matrix === null) return;
  const { a, b, c, d } = matrix;
  const turn = turnUpright ? `rotate(${(-Math.atan2(b, a) * 180) / Math.PI}deg)` : '';
  const upright = `${anchor} ${turn}`.trim();
  chip.style.transform = upright;
  const screen = layer.closest('.canopy-screen')?.getBoundingClientRect();
  const determinant = a * d - b * c;
  if (screen === undefined || screen.width === 0 || determinant === 0) return;
  const box = chip.getBoundingClientRect();
  const gap = LABEL_EDGE_GAP * Math.hypot(a, b);
  const dx = shiftInto(box.left, box.right, screen.left + gap, screen.right - gap);
  const dy = shiftInto(box.top, box.bottom, screen.top + gap, screen.bottom - gap);
  if (dx === 0 && dy === 0) return;
  // The shift is known on the display; the label moves in the node's frame.
  const x = (d * dx - c * dy) / determinant;
  const y = (a * dy - b * dx) / determinant;
  chip.style.transform = `translate(${x}px, ${y}px) ${upright}`.trim();
}

/**
 * The layer a hovered clickable shape draws: the shape itself, outlined and
 * tinted, and its label. `rotation` is the node's own, the label's turn back
 * until the rendered one is measured.
 */
export function ShapeHoverLayer({
  shape,
  label,
  labelAt,
  rotation,
  level = 'strong',
  raised = false,
  flat,
}: {
  shape: HitShape;
  label: ReactNode | null;
  /** `props.hoverLabelAt`, as authored. */
  labelAt?: unknown;
  rotation: number;
  level?: HoverLevel;
  /** Lift the label over later nodes. */
  raised?: boolean;
  flat: FlatScheme;
}) {
  const accent = resolveRole(ACCENT, flat);
  const points = shape.points.map((p) => `${p.x},${p.y}`).join(' ');
  const at = shapeLabelPoint(shape, labelAt);
  const layerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  // A group around the node may turn it too, and the point may lie near the
  // screen's edge: both are settled on the rendered layout, before paint.
  useLayoutEffect(() => {
    if (layerRef.current !== null && labelRef.current !== null) {
      settleLabel(layerRef.current, labelRef.current);
    }
  });
  return (
    <div
      ref={layerRef}
      data-canopy-hover="shape"
      data-canopy-hover-level={level}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <svg
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          opacity: levelOpacity(level),
        }}
      >
        {shape.closed ? (
          <polygon
            data-canopy-hover-fill=""
            points={points}
            fill={accent}
            fillOpacity={FILL_OPACITY}
            stroke={accent}
            strokeWidth={HOVER_OUTLINE_WIDTH}
            strokeLinejoin="round"
          />
        ) : (
          <>
            <polyline
              data-canopy-hover-fill=""
              points={points}
              fill="none"
              stroke={accent}
              strokeOpacity={FILL_OPACITY}
              strokeWidth={shape.strokeWidth}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={points}
              fill="none"
              stroke={accent}
              strokeWidth={HOVER_OUTLINE_WIDTH}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      {label !== null && (
        <span
          ref={labelRef}
          data-canopy-hover-label=""
          style={{
            position: 'absolute',
            left: at.x,
            top: at.y,
            ...(raised ? { zIndex: RAISED_Z } : {}),
            transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
            ...labelStyle(accent, flat),
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
