// The geometry of a polygon that meets the pointer on its drawn shape
// (`hitArea: 'shape'`) and not on its box.
//
// - A closed polygon is met over its inside (nonzero winding, as SVG fills
//   it) and on its drawn outline.
// - An open polyline is met along its path, widened to `hitWidth` with round
//   ends and joins: every point no further than half of it from the path.
//
// The Polygon widget draws exactly this as its pointer target, and the
// renderer places the hover label with it. All coordinates are the node's
// own: (0, 0) is the top-left corner of its box.

export interface ShapePoint {
  x: number;
  y: number;
}

export interface HitShape {
  points: readonly ShapePoint[];
  closed: boolean;
  /** Stroke width of the pointer target: `hitWidth` when open, the line width when closed. */
  strokeWidth: number;
}

/** The narrowest pointer target an open polyline gets without a `hitWidth`, authored px. */
export const MIN_HIT_WIDTH = 12;

const DEFAULT_LINE_WIDTH = 2;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readPoints(raw: unknown): ShapePoint[] | null {
  if (!Array.isArray(raw)) return null;
  const points: ShapePoint[] = [];
  for (const p of raw as unknown[]) {
    if (typeof p !== 'object' || p === null) return null;
    const { x, y } = p as { x?: unknown; y?: unknown };
    if (!finite(x) || !finite(y)) return null;
    points.push({ x, y });
  }
  return points;
}

/**
 * The shape `props` asks the pointer to meet, or null when the node is met on
 * its box: no `hitArea: 'shape'`, or points that draw no shape (fewer than
 * three for a closed polygon, fewer than two for an open one).
 */
export function readHitShape(props: Readonly<Record<string, unknown>>): HitShape | null {
  if (props.hitArea !== 'shape') return null;
  const points = readPoints(props.points);
  const closed = props.closed !== false;
  if (points === null || points.length < (closed ? 3 : 2)) return null;
  const lineWidth =
    finite(props.lineWidth) && props.lineWidth > 0 ? props.lineWidth : DEFAULT_LINE_WIDTH;
  if (closed) return { points, closed, strokeWidth: lineWidth };
  // An open line is never met on less than it draws.
  const hitWidth =
    finite(props.hitWidth) && props.hitWidth > 0
      ? Math.max(props.hitWidth, lineWidth)
      : Math.max(lineWidth, MIN_HIT_WIDTH);
  return { points, closed, strokeWidth: hitWidth };
}

function distanceToSegment(p: ShapePoint, a: ShapePoint, b: ShapePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the path through `points`, closed back to its start or not. */
function distanceToPath(p: ShapePoint, points: readonly ShapePoint[], closed: boolean): number {
  let best = Infinity;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    best = Math.min(best, distanceToSegment(p, points[i]!, points[(i + 1) % points.length]!));
  }
  return best;
}

/** Whether `p` lies inside the closed polygon, by the nonzero winding rule. */
function insidePolygon(p: ShapePoint, points: readonly ShapePoint[]): boolean {
  let winding = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && side > 0) winding++;
    } else if (b.y <= p.y && side < 0) {
      winding--;
    }
  }
  return winding !== 0;
}

/** Whether the pointer at `p` meets `shape`. */
export function shapeContains(shape: HitShape, p: ShapePoint): boolean {
  if (shape.closed && insidePolygon(p, shape.points)) return true;
  return distanceToPath(p, shape.points, shape.closed) <= shape.strokeWidth / 2;
}

/** How far `p` lies inside the closed polygon; negative outside. */
function clearance(p: ShapePoint, points: readonly ShapePoint[]): number {
  const d = distanceToPath(p, points, true);
  return insidePolygon(p, points) ? d : -d;
}

/** The area centroid of a closed polygon, or null when it encloses no area. */
function areaCentroid(points: readonly ShapePoint[]): ShapePoint | null {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-9) return null;
  return { x: x / (3 * area), y: y / (3 * area) };
}

function isConvex(points: readonly ShapePoint[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const c = points[(i + 2) % points.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) continue;
    if (sign !== 0 && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return sign !== 0;
}

function vertexMean(points: readonly ShapePoint[]): ShapePoint {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

/** The point half way along an open path. */
function pathMiddle(points: readonly ShapePoint[]): ShapePoint {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    lengths.push(length);
    total += length;
  }
  let rest = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (rest <= length && length > 0) {
      const t = rest / length;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    rest -= length;
  }
  return { ...points[0]! };
}

interface Cell {
  x: number;
  y: number;
  /** Half the cell's side. */
  half: number;
  /** The most any point of the cell can score. */
  bound: number;
}

/**
 * The best-scoring point of a box, by splitting the most promising cell
 * until no cell can beat the best point found by more than `precision`.
 * `bound(score at the centre, centre, cell radius)` is the most a cell can
 * score, or -Infinity for a cell to drop.
 */
function bestPoint(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  score: (p: ShapePoint) => number,
  bound: (p: ShapePoint, radius: number) => number,
  start: ShapePoint,
  precision: number
): ShapePoint {
  let best = start;
  let bestScore = score(start);
  const queue: Cell[] = [];
  const add = (x: number, y: number, half: number) => {
    const centre = { x, y };
    const here = score(centre);
    if (here > bestScore) {
      best = centre;
      bestScore = here;
    }
    const most = bound(centre, half * Math.SQRT2);
    if (most > bestScore + precision) queue.push({ x, y, half, bound: most });
  };
  const size = Math.min(box.maxX - box.minX, box.maxY - box.minY);
  if (size <= 0) return best;
  for (let x = box.minX; x < box.maxX; x += size) {
    for (let y = box.minY; y < box.maxY; y += size) add(x + size / 2, y + size / 2, size / 2);
  }
  // A bound on the work for a shape no search settles (it does in practice
  // within a few hundred cells).
  for (let steps = 0; queue.length > 0 && steps < 20000; steps++) {
    let top = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.bound > queue[top]!.bound) top = i;
    const cell = queue.splice(top, 1)[0]!;
    if (cell.bound <= bestScore + precision) break;
    const half = cell.half / 2;
    add(cell.x - half, cell.y - half, half);
    add(cell.x + half, cell.y - half, half);
    add(cell.x - half, cell.y + half, half);
    add(cell.x + half, cell.y + half, half);
  }
  return best;
}

/** Share of the widest clearance a label point keeps to sit nearer the centroid. */
const KEPT_CLEARANCE = 0.8;

/**
 * A point well inside a closed polygon that is not convex: the point with the
 * widest clearance to the outline, then moved as near the centroid as it can
 * be while it keeps most of that clearance. So the label of an arc-shaped
 * band sits in the band, at the middle of its length.
 */
function interiorPoint(points: readonly ShapePoint[]): ShapePoint {
  const box = {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
  const centre = areaCentroid(points) ?? vertexMean(points);
  const precision = Math.max(0.25, Math.min(box.maxX - box.minX, box.maxY - box.minY) / 200);
  const depth = (p: ShapePoint) => clearance(p, points);
  const pole = bestPoint(box, depth, (p, radius) => depth(p) + radius, centre, precision);
  const widest = depth(pole);
  if (!(widest > 0)) return centre;
  const floor = widest * KEPT_CLEARANCE;
  const away = (p: ShapePoint) => Math.hypot(p.x - centre.x, p.y - centre.y);
  return bestPoint(
    box,
    (p) => (depth(p) >= floor ? -away(p) : -Infinity),
    (p, radius) => (depth(p) + radius >= floor ? -Math.max(0, away(p) - radius) : -Infinity),
    pole,
    precision
  );
}

/** `[x, y]` or `{ x, y }` as a point, or null. */
function readPoint(raw: unknown): ShapePoint | null {
  if (Array.isArray(raw)) {
    const [x, y] = raw as unknown[];
    return raw.length === 2 && finite(x) && finite(y) ? { x, y } : null;
  }
  if (typeof raw === 'object' && raw !== null) {
    const { x, y } = raw as { x?: unknown; y?: unknown };
    return finite(x) && finite(y) ? { x, y } : null;
  }
  return null;
}

/**
 * Where the hover label of `shape` is centred: `hoverLabelAt` when it names a
 * point; else the middle of an open path, the centroid of a convex polygon,
 * and for any other polygon a point well inside it.
 */
export function shapeLabelPoint(shape: HitShape, hoverLabelAt?: unknown): ShapePoint {
  const authored = readPoint(hoverLabelAt);
  if (authored !== null) return authored;
  if (!shape.closed) return pathMiddle(shape.points);
  if (isConvex(shape.points)) return areaCentroid(shape.points) ?? vertexMean(shape.points);
  return interiorPoint(shape.points);
}
