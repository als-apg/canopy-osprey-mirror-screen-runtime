import { describe, expect, it } from 'vitest';
import { MIN_HIT_WIDTH, readHitShape, shapeContains, shapeLabelPoint } from './shapeHit.js';
import type { ShapePoint } from './shapeHit.js';

const CENTRE = { x: 200, y: 200 };

/** The point at `radius` and `degrees` (0 = right, 270 = straight up) around CENTRE. */
function polar(radius: number, degrees: number): ShapePoint {
  const a = (degrees * Math.PI) / 180;
  return { x: CENTRE.x + radius * Math.cos(a), y: CENTRE.y + radius * Math.sin(a) };
}

/** A band between two radii over a span of angles: the outer arc out, the inner arc back. */
function band(inner: number, outer: number, from: number, to: number): ShapePoint[] {
  const points: ShapePoint[] = [];
  for (let a = from; a <= to; a += 5) points.push(polar(outer, a));
  for (let a = to; a >= from; a -= 5) points.push(polar(inner, a));
  return points;
}

function shapeOf(props: Record<string, unknown>) {
  const shape = readHitShape({ hitArea: 'shape', ...props });
  expect(shape).not.toBeNull();
  return shape!;
}

const radiusOf = (p: ShapePoint) => Math.hypot(p.x - CENTRE.x, p.y - CENTRE.y);
const angleOf = (p: ShapePoint) =>
  ((Math.atan2(p.y - CENTRE.y, p.x - CENTRE.x) * 180) / Math.PI + 360) % 360;

describe('readHitShape', () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  it('is null unless hitArea is "shape"', () => {
    expect(readHitShape({ points: triangle })).toBeNull();
    expect(readHitShape({ points: triangle, hitArea: 'box' })).toBeNull();
    expect(readHitShape({ points: triangle, hitArea: 'shape' })).not.toBeNull();
  });

  it('is null for points that draw no shape', () => {
    expect(readHitShape({ hitArea: 'shape' })).toBeNull();
    expect(readHitShape({ hitArea: 'shape', points: triangle.slice(0, 2) })).toBeNull();
    expect(
      readHitShape({ hitArea: 'shape', closed: false, points: triangle.slice(0, 1) })
    ).toBeNull();
    expect(readHitShape({ hitArea: 'shape', points: [...triangle, { x: 'a', y: 0 }] })).toBeNull();
    expect(readHitShape({ hitArea: 'shape', points: [...triangle, { x: NaN, y: 0 }] })).toBeNull();
  });

  it('gives a closed polygon its line width, an open one its hit width', () => {
    expect(shapeOf({ points: triangle, lineWidth: 4, hitWidth: 30 }).strokeWidth).toBe(4);
    const open = { points: triangle, closed: false };
    expect(shapeOf({ ...open, lineWidth: 4, hitWidth: 30 }).strokeWidth).toBe(30);
    // Without hitWidth: the line width, at least the minimum.
    expect(shapeOf({ ...open, lineWidth: 2 }).strokeWidth).toBe(MIN_HIT_WIDTH);
    expect(shapeOf({ ...open, lineWidth: 20 }).strokeWidth).toBe(20);
    // Never narrower than the drawn line.
    expect(shapeOf({ ...open, lineWidth: 20, hitWidth: 6 }).strokeWidth).toBe(20);
    expect(shapeOf({ ...open, lineWidth: 2, hitWidth: 0 }).strokeWidth).toBe(MIN_HIT_WIDTH);
  });
});

describe('a band along an arc', () => {
  // Radii 100 to 140 over the top of the circle, from 200 to 340 degrees.
  const shape = shapeOf({ points: band(100, 140, 200, 340), lineWidth: 2 });

  it('is met inside the band', () => {
    expect(shapeContains(shape, polar(120, 270))).toBe(true);
    expect(shapeContains(shape, polar(105, 210))).toBe(true);
    expect(shapeContains(shape, polar(135, 330))).toBe(true);
  });

  it('is not met inside its bounding box but outside the band', () => {
    // Under the arc, towards the circle's centre.
    expect(shapeContains(shape, polar(50, 270))).toBe(false);
    expect(shapeContains(shape, polar(90, 270))).toBe(false);
    // The corners of the bounding box.
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    expect(shapeContains(shape, { x: Math.min(...xs) + 3, y: Math.min(...ys) + 3 })).toBe(false);
    expect(shapeContains(shape, { x: Math.max(...xs) - 3, y: Math.min(...ys) + 3 })).toBe(false);
    expect(shapeContains(shape, { x: CENTRE.x, y: Math.max(...ys) - 3 })).toBe(false);
  });

  it('is not met past its ends or its outer edge', () => {
    expect(shapeContains(shape, polar(120, 190))).toBe(false);
    expect(shapeContains(shape, polar(120, 350))).toBe(false);
    expect(shapeContains(shape, polar(145, 270))).toBe(false);
  });

  it('is met on its drawn outline, half the line width out', () => {
    const wide = shapeOf({ points: band(100, 140, 200, 340), lineWidth: 8 });
    expect(shapeContains(wide, polar(143, 270))).toBe(true);
    expect(shapeContains(wide, polar(146, 270))).toBe(false);
  });

  it('puts the label in the band, at the middle of its length', () => {
    const at = shapeLabelPoint(shape);
    expect(shapeContains(shape, at)).toBe(true);
    expect(radiusOf(at)).toBeGreaterThan(110);
    expect(radiusOf(at)).toBeLessThan(130);
    expect(Math.abs(angleOf(at) - 270)).toBeLessThan(4);
  });

  it('keeps the label in a band whose vertex mean and centroid lie outside it', () => {
    // A half ring: the middle of its points is under the arc.
    const half = shapeOf({ points: band(100, 140, 180, 360) });
    const mean = {
      x: half.points.reduce((sum, p) => sum + p.x, 0) / half.points.length,
      y: half.points.reduce((sum, p) => sum + p.y, 0) / half.points.length,
    };
    expect(shapeContains(half, mean)).toBe(false);
    const at = shapeLabelPoint(half);
    expect(shapeContains(half, at)).toBe(true);
    expect(radiusOf(at)).toBeGreaterThan(110);
    expect(radiusOf(at)).toBeLessThan(130);
    expect(Math.abs(angleOf(at) - 270)).toBeLessThan(4);
  });
});

describe('a concave polygon', () => {
  // A U: two arms 40 wide and a base 40 high around a notch.
  const u = shapeOf({
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 80 },
      { x: 120, y: 80 },
      { x: 120, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 120 },
      { x: 0, y: 120 },
    ],
  });

  it('is met in its arms and its base, not in its notch', () => {
    expect(shapeContains(u, { x: 20, y: 20 })).toBe(true);
    expect(shapeContains(u, { x: 140, y: 20 })).toBe(true);
    expect(shapeContains(u, { x: 80, y: 100 })).toBe(true);
    expect(shapeContains(u, { x: 80, y: 40 })).toBe(false);
    expect(shapeContains(u, { x: 80, y: 76 })).toBe(false);
    expect(shapeContains(u, { x: 164, y: 60 })).toBe(false);
  });

  it('puts the label inside, clear of the outline', () => {
    const at = shapeLabelPoint(u);
    expect(shapeContains(u, at)).toBe(true);
    // In the base, under the notch: the nearest the centroid can be reached.
    expect(at.y).toBeGreaterThan(90);
    expect(at.y).toBeLessThan(110);
    expect(Math.abs(at.x - 80)).toBeLessThan(4);
  });

  it('fills a self-crossing outline as SVG does (nonzero winding)', () => {
    // A five-pointed star drawn in one stroke: its middle is inside.
    const star = shapeOf({ points: [270, 54, 198, 342, 126].map((a) => polar(100, a)) });
    expect(shapeContains(star, CENTRE)).toBe(true);
    expect(shapeContains(star, polar(90, 270))).toBe(true);
    expect(shapeContains(star, polar(90, 306))).toBe(false);
  });
});

describe('a convex polygon', () => {
  it('puts the label on its centroid', () => {
    const box = shapeOf({
      points: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 60 },
        { x: 10, y: 60 },
      ],
    });
    expect(shapeLabelPoint(box)).toEqual({ x: 60, y: 40 });
    const triangle = shapeOf({
      points: [
        { x: 0, y: 0 },
        { x: 90, y: 0 },
        { x: 0, y: 30 },
      ],
    });
    const at = shapeLabelPoint(triangle);
    expect(at.x).toBeCloseTo(30);
    expect(at.y).toBeCloseTo(10);
    expect(shapeContains(triangle, at)).toBe(true);
  });
});

describe('an open polyline', () => {
  // A bent line: right along the top, then down.
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const bent = shapeOf({ points, closed: false, lineWidth: 2, hitWidth: 20 });

  it('is met within half its hit width of the path', () => {
    expect(shapeContains(bent, { x: 50, y: 9 })).toBe(true);
    expect(shapeContains(bent, { x: 50, y: -9 })).toBe(true);
    expect(shapeContains(bent, { x: 91, y: 50 })).toBe(true);
    expect(shapeContains(bent, { x: 50, y: 11 })).toBe(false);
    expect(shapeContains(bent, { x: 89, y: 50 })).toBe(false);
  });

  it('is not met inside its bounding box away from the path', () => {
    expect(shapeContains(bent, { x: 50, y: 50 })).toBe(false);
    expect(shapeContains(bent, { x: 5, y: 95 })).toBe(false);
  });

  it('has round ends', () => {
    expect(shapeContains(bent, { x: -9, y: 0 })).toBe(true);
    expect(shapeContains(bent, { x: -8, y: -8 })).toBe(false);
  });

  it('is not closed back to its start', () => {
    expect(shapeContains(bent, { x: 50, y: 50 })).toBe(false);
    const closed = shapeOf({ points });
    expect(shapeContains(closed, { x: 70, y: 30 })).toBe(true);
  });

  it('is met on the minimum width without a hitWidth', () => {
    const thin = shapeOf({ points, closed: false, lineWidth: 2 });
    expect(shapeContains(thin, { x: 50, y: MIN_HIT_WIDTH / 2 - 0.1 })).toBe(true);
    expect(shapeContains(thin, { x: 50, y: MIN_HIT_WIDTH / 2 + 0.1 })).toBe(false);
  });

  it('puts the label half way along the path', () => {
    expect(shapeLabelPoint(bent)).toEqual({ x: 100, y: 0 });
    const uneven = shapeOf({
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 90 },
      ],
    });
    expect(shapeLabelPoint(uneven)).toEqual({ x: 30, y: 30 });
  });
});

describe('hoverLabelAt', () => {
  const shape = shapeOf({ points: band(100, 140, 200, 340) });

  it('places the label where it says, as [x, y] or { x, y }', () => {
    expect(shapeLabelPoint(shape, [12, 34])).toEqual({ x: 12, y: 34 });
    expect(shapeLabelPoint(shape, { x: 56, y: 78 })).toEqual({ x: 56, y: 78 });
  });

  it('is ignored when it names no point', () => {
    const at = shapeLabelPoint(shape);
    for (const odd of [undefined, null, 'centre', [1], [1, 2, 3], ['1', 2], { x: 1 }, [NaN, 0]]) {
      expect(shapeLabelPoint(shape, odd)).toEqual(at);
    }
  });
});
