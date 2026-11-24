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
// - Any node may carry `props.outlineColor` (a color, after role resolution a
//   CSS string) and `props.outlineWidth` (authored px, default 2): an outline
//   drawn just inside its box. Being plain props, both are rule targets, so a
//   rule can tint the outline from live data.
//
// Colors come from scheme roles, so both themes work: the accent is
// `ActiveText`, the label chip uses `Background` and `Text`.

import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { ColorRole, FlatScheme } from '@slaclab/canopy-screen-ir';
import { readHitShape, shapeLabelPoint } from '@slaclab/canopy-screen-widgets';
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
  flat,
}: {
  label: string | null;
  placement?: HoverLabelPlacement;
  flat: FlatScheme;
}) {
  const accent = resolveRole(ACCENT, flat);
  return (
    <div
      data-canopy-hover=""
      data-placement={placement}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        outline: `${HOVER_OUTLINE_WIDTH}px solid ${accent}`,
        outlineOffset: -HOVER_OUTLINE_WIDTH,
        display: 'flex',
        padding: LABEL_INSET,
        boxSizing: 'border-box',
        ...PLACEMENTS[placement],
      }}
    >
      <div
        data-canopy-hover-fill=""
        style={{ position: 'absolute', inset: 0, background: accent, opacity: FILL_OPACITY }}
      />
      {label !== null && (
        <span style={{ position: 'relative', ...labelStyle(accent, flat) }}>{label}</span>
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

/**
 * Turns the label of a shape's hover layer upright against everything that
 * turns the node, and moves it back inside the screen where it would be cut
 * off at the edge. A no-op where the layout cannot be measured.
 */
function settleLabel(layer: HTMLElement, chip: HTMLElement): void {
  const matrix = renderedTransform(layer);
  if (matrix === null) return;
  const { a, b, c, d } = matrix;
  const upright = `translate(-50%, -50%) rotate(${(-Math.atan2(b, a) * 180) / Math.PI}deg)`;
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
  chip.style.transform = `translate(${x}px, ${y}px) ${upright}`;
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
  flat,
}: {
  shape: HitShape;
  label: string | null;
  /** `props.hoverLabelAt`, as authored. */
  labelAt?: unknown;
  rotation: number;
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
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
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
          style={{
            position: 'absolute',
            left: at.x,
            top: at.y,
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
