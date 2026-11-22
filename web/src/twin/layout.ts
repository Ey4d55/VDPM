/**
 * Schematic plan layout of a circuit for the 3D track twin.
 *
 * The circuit data hold the order, length, radius and reference speed of each
 * segment but no coordinates or turn directions. To draw a closed lap we keep
 * what the model uses and choose only what it does not:
 *
 *   - every corner is drawn with its true radius r (the quantity in F_c = m v^2 / r);
 *   - turn directions and angles follow real circuits: tight corners turn
 *     further than fast ones and some corners turn the other way, with the
 *     signed angles summing to one full turn;
 *   - straight lengths are adjusted by the smallest weighted least-squares
 *     change that closes the loop exactly, keeping every heading;
 *   - a deterministic search keeps the candidate that neither crosses nor
 *     touches itself and has a circuit-like footprint.
 *
 * Positions are therefore schematic; the physics shown on the layout always
 * uses the circuit's own segment lengths, radii and speeds.
 */
import type { Circuit } from "../engine";

export interface LayoutSegment {
  index: number;
  kind: "straight" | "corner";
  name: string;
  /** Index among the corners, or null for straights. */
  cornerIndex: number | null;
  /** True segment length and its start along the true lap, m. */
  length: number;
  start: number;
  speed: number;
  radius: number | null;
  /** Drawn geometry, in metres of the plan. */
  drawnLength: number;
  x0: number;
  y0: number;
  heading0: number;
  /** Signed turning angle of the drawn arc, rad (0 for straights). */
  turn: number;
  /** Centre of curvature of a corner arc. */
  cx: number;
  cy: number;
}

export interface Layout {
  segments: LayoutSegment[];
  lapLength: number;
  /** Largest relative change applied to any straight to close the loop. */
  maxStraightChange: number;
  /** Residual closure gap after the adjustment, m (0 when closed exactly). */
  residual: number;
  residualX: number;
  residualY: number;
}

export interface Pose {
  x: number;
  y: number;
  heading: number;
  segment: LayoutSegment;
  /** Fraction through the segment, 0..1. */
  t: number;
}

const TAU = 2 * Math.PI;

/** Lay out the lap for given signed turning angles (positive = left). */
export function layoutFromTurns(circuit: Circuit, turns: number[]): Layout {
  const segs = circuit.segments;
  const lapLength = segs.reduce((a, s) => a + s.length, 0);
  const headings: number[] = [];
  let h = 0;
  for (let i = 0; i < segs.length; i++) {
    headings.push(h);
    h += turns[i]!;
  }
  const straightIdx = segs.flatMap((s, i) => (s.kind === "corner" ? [] : [i]));
  const arc = (i: number): [number, number] => {
    const r = segs[i]!.radius ?? 0;
    const a0 = headings[i]!;
    const a1 = a0 + turns[i]!;
    const side = Math.sign(turns[i]!) || 1;
    return [side * r * (Math.sin(a1) - Math.sin(a0)), side * r * (-Math.cos(a1) + Math.cos(a0))];
  };

  // Close the loop: l_j = l0_j (1 + u_j . lambda), minimising sum l0 (u.lambda)^2,
  // with straights that would shrink below 15 % held at that floor.
  const lengths = segs.map((s) => s.length);
  const floor = 0.15;
  const fixed = new Set<number>();
  for (let iter = 0; iter < 8 && straightIdx.length > 0; iter++) {
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i]!.kind === "corner") {
        const [dx, dy] = arc(i);
        gx += dx;
        gy += dy;
      } else {
        gx += lengths[i]! * Math.cos(headings[i]!);
        gy += lengths[i]! * Math.sin(headings[i]!);
      }
    }
    if (Math.hypot(gx, gy) < 1e-9 * lapLength) break;
    let a = 0;
    let b = 0;
    let c = 0;
    const free = straightIdx.filter((j) => !fixed.has(j));
    for (const j of free) {
      const ux = Math.cos(headings[j]!);
      const uy = Math.sin(headings[j]!);
      const w = segs[j]!.length;
      a += w * ux * ux;
      b += w * ux * uy;
      c += w * uy * uy;
    }
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-9 * (a + c) * (a + c)) break;
    const lx = (-gx * c + gy * b) / det;
    const ly = (-gy * a + gx * b) / det;
    let clamped = false;
    for (const j of free) {
      const u = Math.cos(headings[j]!) * lx + Math.sin(headings[j]!) * ly;
      const next = lengths[j]! + segs[j]!.length * u;
      if (next < floor * segs[j]!.length) {
        lengths[j] = floor * segs[j]!.length;
        fixed.add(j);
        clamped = true;
      } else {
        lengths[j] = next;
      }
    }
    if (!clamped) break;
  }

  // Walk the lap.
  const out: LayoutSegment[] = [];
  let x = 0;
  let y = 0;
  let start = 0;
  let ci = 0;
  let maxChange = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const heading0 = headings[i]!;
    const turn = turns[i]!;
    const corner = s.kind === "corner";
    const r = s.radius ?? 0;
    const side = Math.sign(turn) || 1;
    const drawnLength = corner ? r * Math.abs(turn) : lengths[i]!;
    if (!corner) maxChange = Math.max(maxChange, Math.abs(lengths[i]! / s.length - 1));
    const cx = corner ? x - side * r * Math.sin(heading0) : x;
    const cy = corner ? y + side * r * Math.cos(heading0) : y;
    out.push({
      index: i,
      kind: s.kind,
      name: s.name,
      cornerIndex: corner ? ci++ : null,
      length: s.length,
      start,
      speed: s.speed,
      radius: corner ? r : null,
      drawnLength,
      x0: x,
      y0: y,
      heading0,
      turn,
      cx,
      cy,
    });
    if (corner) {
      x = cx + side * r * Math.sin(heading0 + turn);
      y = cy - side * r * Math.cos(heading0 + turn);
    } else {
      x += drawnLength * Math.cos(heading0);
      y += drawnLength * Math.sin(heading0);
    }
    start += s.length;
  }
  return { segments: out, lapLength, maxStraightChange: maxChange, residual: Math.hypot(x, y), residualX: x, residualY: y };
}

const TURN_CACHE = new Map<string, number[]>();

/** Small deterministic PRNG, so a circuit always gets the same layout. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Score a candidate layout: lower is better. Crossings and near-touches are
 * heavily penalised; small changes to straights and a compact, circuit-like
 * aspect ratio are preferred.
 */
export function scoreLayout(l: Layout): number {
  if (l.residual > 1e-6 * l.lapLength) return Infinity;
  const drawn = l.segments.reduce((a, s) => a + s.drawnLength, 0);
  const n = 260;
  const step = drawn / n;
  const pts: [number, number, number][] = [];
  let acc = 0;
  for (const seg of l.segments) {
    const k = Math.max(1, Math.round(seg.drawnLength / step));
    for (let j = 0; j < k; j++) {
      const p = pointOn(seg, j / k);
      pts.push([p.x, p.y, acc + (j / k) * seg.drawnLength]);
    }
    acc += seg.drawnLength;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const span = Math.max(w, h);
  const clear = 0.06 * span;
  const arcGap = 3 * clear;
  let penalty = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const along = Math.min(pts[j]![2] - pts[i]![2], drawn - (pts[j]![2] - pts[i]![2]));
      if (along < arcGap) continue;
      const d = Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]);
      if (d < clear) penalty += (clear - d) / clear;
    }
  }
  const aspect = Math.max(w, h) / Math.max(1e-9, Math.min(w, h));
  // Use of the bounding box: real circuits fill their footprint unevenly but not sparsely.
  const fill = drawn / (w + h);
  return penalty * 100 + l.maxStraightChange * 2 + Math.abs(aspect - 1.55) * 0.6 + Math.abs(fill - 2.6) * 0.3;
}

/**
 * Plan layout used by the track twin. Corner radii and segment order come from
 * the circuit; turn directions and angles are chosen as on real circuits
 * (tight corners turn further than fast ones, and some corners turn the other
 * way), from a deterministic search that rejects layouts that cross or touch.
 */
export function buildLayout(circuit: Circuit): Layout {
  const segs = circuit.segments;
  const corners = segs.flatMap((s, i) => (s.kind === "corner" && s.radius ? [i] : []));
  const fallback = (): Layout => {
    const w = segs.map((s) => (s.kind === "corner" && s.radius ? s.length / s.radius : 0));
    const total = w.reduce((a, b) => a + b, 0);
    return layoutFromTurns(
      circuit,
      segs.map((s, i) => (s.kind !== "corner" ? 0 : total > 0 ? (TAU * w[i]!) / total : TAU / Math.max(1, corners.length))),
    );
  };
  if (corners.length < 3) return fallback();

  const radii = corners.map((i) => segs[i]!.radius!);
  const key = `${circuit.name}|${segs.map((s) => `${s.kind[0]}${s.length.toFixed(3)}:${s.radius ?? ""}`).join(",")}`;
  const cached = TURN_CACHE.get(key);
  if (cached) return layoutFromTurns(circuit, cached);
  const rMin = Math.min(...radii);
  const rMax = Math.max(...radii);
  const deg = Math.PI / 180;
  const rand = mulberry32(hashString(key));
  let bestTurns: number[] | null = null;
  let best: Layout | null = null;
  let bestScore = Infinity;
  const candidates = 360;
  for (let c = 0; c < candidates; c++) {
    const rightShare = 0.2 + 0.2 * rand();
    const turns = segs.map(() => 0);
    let pos = 0;
    let neg = 0;
    corners.forEach((i, k) => {
      const rr = rMax > rMin ? (radii[k]! - rMin) / (rMax - rMin) : 0.5;
      const mag = Math.min(175, Math.max(18, (150 - 115 * rr) * (0.7 + 0.6 * rand()))) * deg;
      const right = rand() < rightShare;
      turns[i] = right ? -mag : mag;
      if (right) neg += mag;
      else pos += mag;
    });
    if (pos <= 0) continue;
    const scale = (TAU + neg) / pos;
    if (scale < 0.55 || scale > 1.6) continue;
    let ok = true;
    for (const i of corners) {
      if (turns[i]! > 0) {
        turns[i] = turns[i]! * scale;
        if (turns[i]! > 178 * deg) ok = false;
      }
    }
    if (!ok) continue;
    const l = layoutFromTurns(circuit, turns);
    if (l.maxStraightChange > 0.85) continue;
    const sc = scoreLayout(l);
    if (sc < bestScore) {
      bestScore = sc;
      best = l;
      bestTurns = turns;
    }
  }
  if (!best || !bestTurns) return fallback();
  if (TURN_CACHE.size > 32) TURN_CACHE.clear();
  TURN_CACHE.set(key, bestTurns);
  return best;
}

/** Point on a segment at fraction t of its drawn length. */
export function pointOn(seg: LayoutSegment, t: number): { x: number; y: number; heading: number } {
  if (seg.kind === "corner" && seg.radius) {
    const a = seg.heading0 + seg.turn * t;
    const side = Math.sign(seg.turn) || 1;
    return { x: seg.cx + side * seg.radius * Math.sin(a), y: seg.cy - side * seg.radius * Math.cos(a), heading: a };
  }
  return {
    x: seg.x0 + seg.drawnLength * t * Math.cos(seg.heading0),
    y: seg.y0 + seg.drawnLength * t * Math.sin(seg.heading0),
    heading: seg.heading0,
  };
}

/** Pose at a distance s along the true lap (wraps around). */
export function poseAt(layout: Layout, s: number): Pose {
  const L = layout.lapLength;
  const d = ((s % L) + L) % L;
  let lo = 0;
  let hi = layout.segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.segments[mid]!.start <= d) lo = mid;
    else hi = mid - 1;
  }
  const seg = layout.segments[lo]!;
  const t = Math.min(1, Math.max(0, (d - seg.start) / seg.length));
  const p = pointOn(seg, t);
  // Any closure residual is spread linearly over the lap so the car never jumps.
  const f = d / L;
  return { x: p.x - f * layout.residualX, y: p.y - f * layout.residualY, heading: p.heading, segment: seg, t };
}

/** Evenly spaced points along the drawn centreline, closed. */
export function centreline(layout: Layout, step: number): { x: number; y: number; heading: number; seg: number }[] {
  const pts: { x: number; y: number; heading: number; seg: number }[] = [];
  for (const seg of layout.segments) {
    const n = Math.max(2, Math.ceil(seg.drawnLength / step));
    for (let k = 0; k < n; k++) {
      const p = pointOn(seg, k / n);
      const f = (seg.start + (k / n) * seg.length) / layout.lapLength;
      pts.push({ x: p.x - f * layout.residualX, y: p.y - f * layout.residualY, heading: p.heading, seg: seg.index });
    }
  }
  return pts;
}

/**
 * Speed along the true lap, blending smoothly between neighbouring segments'
 * reference speeds over a short zone around each boundary. Used only to move
 * the car; every number shown uses the segment's own reference speed.
 */
export function animationSpeed(layout: Layout, s: number): number {
  const L = layout.lapLength;
  const d = ((s % L) + L) % L;
  const segs = layout.segments;
  const pose = poseAt(layout, d);
  const i = pose.segment.index;
  const seg = segs[i]!;
  const zone = Math.min(60, seg.length * 0.35);
  const prev = segs[(i - 1 + segs.length) % segs.length]!;
  const next = segs[(i + 1) % segs.length]!;
  const into = d - seg.start;
  const left = seg.start + seg.length - d;
  const smooth = (u: number) => u * u * (3 - 2 * u);
  if (into < zone) {
    const u = 0.5 + 0.5 * smooth(into / zone);
    return prev.speed + (seg.speed - prev.speed) * u;
  }
  if (left < zone) {
    const u = 0.5 + 0.5 * smooth(left / zone);
    return next.speed + (seg.speed - next.speed) * u;
  }
  return seg.speed;
}
