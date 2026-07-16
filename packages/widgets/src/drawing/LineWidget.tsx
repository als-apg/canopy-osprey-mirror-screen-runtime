// Vertex editing (drag/add/remove points) lives in the builder; this is the
// render-only runtime widget.
import { useMemo } from 'react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry.js';

interface Point {
  x: number;
  y: number;
}

export function LineWidget({ id, layout, props, isSelected }: WidgetRendererProps) {
  const lineColor = (props.lineColor as string) ?? '#6f6f6f';
  const lineWidth = (props.lineWidth as number) ?? 2;
  const lineStyle = (props.lineStyle as string) ?? 'solid';
  const arrowStart = (props.arrowStart as boolean) ?? false;
  const arrowEnd = (props.arrowEnd as boolean) ?? true;
  const arrowSize = (props.arrowSize as number) ?? 10;

  // Points are stored relative to widget layout (0,0 = top-left of widget bounds)
  // Default: line from top-left to bottom-right
  const rawPoints = props.points as Point[] | undefined;
  const points: Point[] = useMemo(() => {
    if (rawPoints && rawPoints.length >= 2) return rawPoints;
    return [
      { x: 0, y: 0 },
      { x: layout.width, y: layout.height },
    ];
  }, [rawPoints, layout.width, layout.height]);

  // Build SVG path
  const pathD = useMemo(() => {
    if (points.length < 2) return '';
    const [first, ...rest] = points;
    return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')}`;
  }, [points]);

  // Dash array for line style
  const dashArray = useMemo(() => {
    switch (lineStyle) {
      case 'dashed':
        return `${lineWidth * 4} ${lineWidth * 3}`;
      case 'dotted':
        return `${lineWidth} ${lineWidth * 2}`;
      default:
        return 'none';
    }
  }, [lineStyle, lineWidth]);

  // Arrow marker IDs (unique per widget to avoid SVG ID conflicts)
  const startMarkerId = `arrow-start-${id}`;
  const endMarkerId = `arrow-end-${id}`;

  return (
    <svg
      className={`line-widget ${isSelected ? 'line-widget--selected' : ''}`}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* Start arrow marker */}
        {arrowStart && (
          <marker
            id={startMarkerId}
            viewBox="0 0 10 10"
            refX="2"
            refY="5"
            markerWidth={arrowSize / 2}
            markerHeight={arrowSize / 2}
            orient="auto-start-reverse"
          >
            <path d="M 10 0 L 0 5 L 10 10 Z" fill={lineColor} />
          </marker>
        )}
        {/* End arrow marker */}
        {arrowEnd && (
          <marker
            id={endMarkerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth={arrowSize / 2}
            markerHeight={arrowSize / 2}
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 Z" fill={lineColor} />
          </marker>
        )}
      </defs>

      {/* Visible line */}
      <path
        d={pathD}
        fill="none"
        stroke={lineColor}
        strokeWidth={lineWidth}
        strokeDasharray={dashArray}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerStart={arrowStart ? `url(#${startMarkerId})` : undefined}
        markerEnd={arrowEnd ? `url(#${endMarkerId})` : undefined}
        style={{ pointerEvents: 'none' }}
      />
    </svg>
  );
}
