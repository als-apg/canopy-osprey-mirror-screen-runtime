import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry.js';
import { PolygonWidget } from './PolygonWidget.js';
import { MIN_HIT_WIDTH } from './shapeHit.js';

afterEach(cleanup);

const baseProps: WidgetRendererProps = {
  id: 'poly-1',
  layout: { x: 0, y: 0, width: 100, height: 100 },
  props: {},
  isSelected: false,
} as unknown as WidgetRendererProps;

function renderWith(props: Record<string, unknown>) {
  return render(<PolygonWidget {...baseProps} props={props} />);
}

describe('PolygonWidget', () => {
  it('renders a closed <polygon> with the given points and stroke', () => {
    const { container } = renderWith({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 20, y: 0 },
      ],
      lineColor: '#ff0000',
      lineWidth: 3,
    });
    const poly = container.querySelector('polygon');
    expect(poly).not.toBeNull();
    expect(poly!.getAttribute('points')).toBe('0,0 10,20 20,0');
    expect(poly!.getAttribute('stroke')).toBe('#ff0000');
    expect(poly!.getAttribute('stroke-width')).toBe('3');
    // closed shape, no fill by default
    expect(poly!.getAttribute('fill')).toBe('none');
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('renders an open <polyline> when closed is false', () => {
    const { container } = renderWith({
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(container.querySelector('polygon')).toBeNull();
  });

  it('applies fillColor when fill is enabled', () => {
    const { container } = renderWith({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      fill: true,
      fillColor: '#00ff00',
    });
    expect(container.querySelector('polygon')!.getAttribute('fill')).toBe('#00ff00');
  });

  it('falls back to a triangle when no points are provided', () => {
    const { container } = renderWith({});
    // 3 fallback vertices spanning the 100x100 bounds
    expect(container.querySelector('polygon')!.getAttribute('points')).toBe('50,0 100,100 0,100');
  });

  describe('hitArea', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
    ];
    const target = (container: HTMLElement) =>
      container.querySelector<SVGElement>('[data-canopy-hit]');

    it('draws nothing for the pointer without it: one shape, inert', () => {
      const { container } = renderWith({ points });
      expect(target(container)).toBeNull();
      const svg = container.querySelector('svg')!;
      expect(svg.children).toHaveLength(1);
      expect((svg.children[0] as SVGElement).style.pointerEvents).toBe('none');
    });

    it('"shape" adds an unpainted copy of a closed polygon, met over its inside', () => {
      const { container } = renderWith({ points, lineWidth: 3, hitArea: 'shape', hitWidth: 40 });
      const hit = target(container)!;
      expect(hit.tagName).toBe('polygon');
      expect(hit.getAttribute('points')).toBe('0,0 10,20 20,0');
      expect(hit.getAttribute('fill')).toBe('none');
      expect(hit.getAttribute('stroke')).toBe('none');
      expect(hit.style.pointerEvents).toBe('all');
      // hitWidth widens open lines only.
      expect(hit.getAttribute('stroke-width')).toBe('3');
      // The drawn shape is unchanged and stays inert.
      const drawn = container.querySelector<SVGElement>('polygon:not([data-canopy-hit])')!;
      expect(drawn.getAttribute('stroke-width')).toBe('3');
      expect(drawn.style.pointerEvents).toBe('none');
    });

    it('"shape" adds a copy of an open polyline, met along its path at hitWidth', () => {
      const { container } = renderWith({ points, closed: false, hitArea: 'shape', hitWidth: 24 });
      const hit = target(container)!;
      expect(hit.tagName).toBe('polyline');
      expect(hit.style.pointerEvents).toBe('stroke');
      expect(hit.getAttribute('stroke-width')).toBe('24');
      expect(hit.getAttribute('stroke-linecap')).toBe('round');
    });

    it('"shape" on an open polyline without hitWidth is met at the minimum width', () => {
      const { container } = renderWith({ points, closed: false, hitArea: 'shape' });
      expect(target(container)!.getAttribute('stroke-width')).toBe(String(MIN_HIT_WIDTH));
    });

    it('draws no target without points, or for another hitArea', () => {
      expect(target(renderWith({ hitArea: 'shape' }).container)).toBeNull();
      expect(target(renderWith({ points, hitArea: 'box' }).container)).toBeNull();
    });
  });
});
