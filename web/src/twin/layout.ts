/**
 * Schematic plan layout of a circuit for the 3D track twin.
 *
 * The circuit data hold the order, length, radius and reference speed of each
 * segment but no coordinates or turn directions. To draw a closed lap we keep
 * what the model uses and adjust only what it does not:
 *
 *   - every corner is drawn with its true radius r (the quantity in F_c = m v^2 / r);
 *   - all corners turn the same way, and their turning angles keep the
 *     circuit's proportions (theta_i proportional to L_i / r_i) but are scaled
 *     to sum to one full turn, so that the lap can close;
 *   - straight lengths are adjusted by the smallest weighted least-squares
 *     change that closes the loop exactly, keeping every heading.
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

export function buildLayout(circuit: Circuit): Layout {
  const segs = circuit.segments;
  const lapLength = segs.reduce((a, s) => a + s.length, 0);
  const cornerWeights = segs.map((s) => (s.kind === "corner" && s.radius ? s.length / s.radius : 0));
  const totalWeight = cornerWeights.reduce((a, b) => a + b, 0);
  const nCorners = segs.filter((s) => s.kind === "corner").length;
  const turns = segs.map((s, i) =>
    s.kind !== "corner" ? 0 : totalWeight > 0 ? (TAU * cornerWeights[i]!) / totalWeight : TAU / Math.max(1, nCorners),
  );

  // Headings at the start of each segment (counter-clockwise lap).
  const headings: number[] = [];
  let h = 0;
  for (let i = 0; i < segs.length; i++) {
    headings.push(h);
    h += turns[i]!;
  }

  // Displacement of each corner arc, and the straight directions.
  let ex = 0;
  let ey = 0;
  const straightIdx: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.kind === "corner") {
      const r = s.radius ?? 0;
      const a0 = headings[i]!;
      const a1 = a0 + turns[i]!;
      ex += r * (Math.sin(a1) - Math.sin(a0));
      ey += r * (-Math.cos(a1) + Math.cos(a0));
    } else {
      straightIdx.push(i);
      ex += s.length * Math.cos(headings[i]!);
      ey += s.length * Math.sin(headings[i]!);
    }
  }

  // Close the loop: l_j = l0_j (1 + u_j . lambda), minimising sum l0 (u.lambda)^2,
  // with straights that would shrink below 15 % held at that floor.
  const lengths = segs.map((s) => s.length);
  const floor = 0.15;
  const fixed = new Set<number>();
  for (let iter = 0; iter < 6 && straightIdx.length > 0; iter++) {
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!;
      if (s.kind === "corner") {
        const r = s.radius ?? 0;
        const a0 = headings[i]!;
        const a1 = a0 + turns[i]!;
        gx += r * (Math.sin(a1) - Math.sin(a0));
        gy += r * (-Math.cos(a1) + Math.cos(a0));
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
    const drawnLength = corner ? r * Math.abs(turn) : lengths[i]!;
    if (!corner) maxChange = Math.max(maxChange, Math.abs(lengths[i]! / s.length - 1));
    const cx = corner ? x - r * Math.sin(heading0) : x;
    const cy = corner ? y + r * Math.cos(heading0) : y;
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
      x = cx + r * Math.sin(heading0 + turn);
      y = cy - r * Math.cos(heading0 + turn);
    } else {
      x += drawnLength * Math.cos(heading0);
      y += drawnLength * Math.sin(heading0);
    }
    start += s.length;
  }
  return { segments: out, lapLength, maxStraightChange: maxChange, residual: Math.hypot(x, y), residualX: x, residualY: y };
}

/** Point on a segment at fraction t of its drawn length. */
export function pointOn(seg: LayoutSegment, t: number): { x: number; y: number; heading: number } {
  if (seg.kind === "corner" && seg.radius) {
    const a = seg.heading0 + seg.turn * t;
    return { x: seg.cx + seg.radius * Math.sin(a), y: seg.cy - seg.radius * Math.cos(a), heading: a };
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
