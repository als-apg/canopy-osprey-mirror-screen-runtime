// Closed polygon (PyDMDrawingIrregularPolygon) / open polygon (polyline) render.
// Vertex editing lives in the builder; this is the render-only runtime widget.
//
// The drawn shape takes no pointer events. With `hitArea: 'shape'` the widget
// adds an invisible copy that does: the pointer then meets the node on its
// shape (shapeHit.ts) and not on its box. A closed polygon is met over its
// inside and its outline; an open one along its path, widened to `hitWidth`
// (authored px; default the line width, at least MIN_HIT_WIDTH).
import { useMemo } from 'react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry.js';
import { readHitShape } from './shapeHit.js';

interface Point {
  x: number;
  y: number;
}

export function PolygonWidget({ layout, props, isSelected }: WidgetRendererProps) {
  const lineColor = (props.lineColor as string) ?? '#6f6f6f';
  const lineWidth = (props.lineWidth as number) ?? 2;
  const lineStyle = (props.lineStyle as string) ?? 'solid';
  const closed = (props.closed as boolean) ?? true;
  const fill = (props.fill as boolean) ?? false;
  const fillColor = (props.fillColor as string) ?? lineColor;

  // Points are stored relative to widget layout (0,0 = top-left of widget bounds).
  const rawPoints = props.points as Point[] | undefined;
  const points: Point[] = useMemo(() => {
    if (rawPoints && rawPoints.length >= 2) return rawPoints;
    // Fallback: a triangle spanning the widget bounds so an empty polygon is still visible.
    return [
      { x: layout.width / 2, y: 0 },
      { x: layout.width, y: layout.height },
      { x: 0, y: layout.height },
    ];
  }, [rawPoints, layout.width, layout.height]);

  const pointsAttr = useMemo(() => points.map((p) => `${p.x},${p.y}`).join(' '), [points]);
  const hitShape = readHitShape(props);

  const dashArray = useMemo(() => {
    switch (lineStyle) {
      case 'dashed':
        return `${lineWidth * 4} ${lineWidth * 3}`;
      case 'dotted':
        return `${lineWidth} ${lineWidth * 2}`;
      default:
        return undefined;
    }
  }, [lineStyle, lineWidth]);

  const shapeProps = {
    points: pointsAttr,
    fill: fill ? fillColor : 'none',
    stroke: lineColor,
    strokeWidth: lineWidth,
    strokeDasharray: dashArray,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    style: { pointerEvents: 'none' as const },
  };
  // The pointer target: unpainted, so it shows nowhere (print and export
  // included), and met by the pointer where the shape would be painted.
  const hitProps = hitShape && {
    'data-canopy-hit': '',
    points: pointsAttr,
    fill: 'none',
    stroke: 'none',
    strokeWidth: hitShape.strokeWidth,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    style: { pointerEvents: closed ? ('all' as const) : ('stroke' as const) },
  };

  return (
    <svg
      className={`polygon-widget ${isSelected ? 'polygon-widget--selected' : ''}`}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{ overflow: 'visible', outline: isSelected ? '2px solid #0f62fe' : 'none' }}
    >
      {closed ? <polygon {...shapeProps} /> : <polyline {...shapeProps} />}
      {hitProps && (closed ? <polygon {...hitProps} /> : <polyline {...hitProps} />)}
    </svg>
  );
}
