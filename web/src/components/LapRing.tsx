/**
 * Lap ring: the lap drawn as a ring whose arcs are exactly proportional to the
 * segment lengths, starting at the top and running clockwise. The circuit data
 * hold segment order, lengths and radii but no coordinates or turn directions,
 * so a ring is used instead of an invented track outline. Bars outside the
 * ring show each corner's safety margin; failing corners point inward.
 */
import { useMemo, type RefObject } from "react";
import type { Circuit, CircuitEvaluation } from "../engine";
import { fmt, pct } from "../format";
import type { ChartTheme } from "../theme";
import { useWidth } from "./Charts";

/** Margin colour bands used by the ring, tables and legends. */
export const MARGIN_BANDS = { tight: 0.1 } as const;

export function marginColour(theme: ChartTheme, margin: number): string {
  if (margin < 0) return theme.infeasible;
  if (margin < MARGIN_BANDS.tight) return theme.warning;
  return theme.feasible;
}

const niceCeil = (v: number): number => {
  const steps = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 10];
  return steps.find((s) => s >= v) ?? Math.ceil(v);
};

export function LapRing(props: {
  circuit: Circuit;
  evaluation: CircuitEvaluation | null;
  theme: ChartTheme;
  svgRef?: RefObject<SVGSVGElement | null>;
  height?: number;
  highlight?: number | null;
  onHover?: (cornerIndex: number | null) => void;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const t = props.theme;
  const height = props.height ?? 380;
  const cx = width / 2;
  const cy = height / 2;
  const barSpace = 46;
  const R = Math.max(60, Math.min(width, height) / 2 - barSpace - 26);

  const segs = useMemo(() => {
    const total = props.circuit.segments.reduce((a, s) => a + s.length, 0);
    let acc = 0;
    let ci = 0;
    return props.circuit.segments.map((s, i) => {
      const a0 = (acc / total) * 2 * Math.PI;
      acc += s.length;
      const a1 = (acc / total) * 2 * Math.PI;
      return { i, s, a0, a1, cornerIndex: s.kind === "corner" ? ci++ : null };
    });
  }, [props.circuit]);

  // Angle 0 at the top, increasing clockwise on screen.
  const pt = (a: number, r: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const arc = (a0: number, a1: number, r: number) => {
    const [x0, y0] = pt(a0, r);
    const [x1, y1] = pt(a1, r);
    return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };

  const ev = props.evaluation;
  const margins = ev ? ev.corners.map((c) => c.margin) : [];
  const scaleMax = niceCeil(Math.max(0.25, ...margins));
  const unit = barSpace / scaleMax;
  const binding = ev?.bindingCorner ?? null;
  const bc = ev && binding !== null ? ev.corners[binding] : null;
  const gap = 0.004; // small visual gap between segments, radians

  return (
    <div className="chart" ref={wrapRef}>
      <svg ref={props.svgRef} width={width} height={height} role="img" aria-label={`Lap ring of ${props.circuit.name} with corner safety margins`}>
        {/* Guide rings for the margin scale */}
        <circle cx={cx} cy={cy} r={R + 8 + barSpace} fill="none" stroke={t.grid} strokeDasharray="3 4" />
        <circle cx={cx} cy={cy} r={R + 8 + barSpace / 2} fill="none" stroke={t.grid} strokeDasharray="1 4" />
        <text x={cx + 4} y={cy - (R + 8 + barSpace) - 4} fontSize={10} fill={t.faint}>
          M = {fmt(scaleMax * 100, 0)} %
        </text>

        {/* Track: straights thin, corners thick and coloured */}
        {segs.map(({ i, s, a0, a1, cornerIndex }) => {
          const res = cornerIndex !== null && ev ? ev.corners[cornerIndex] : undefined;
          const isCorner = cornerIndex !== null;
          const colour = res ? marginColour(t, res.margin) : isCorner ? t.muted : t.axis;
          const hl = isCorner && props.highlight === cornerIndex;
          return (
            <path
              key={i}
              d={arc(a0 + gap, a1 - gap, R)}
              fill="none"
              stroke={colour}
              strokeWidth={isCorner ? (hl ? 12 : 9) : 3}
              strokeLinecap="butt"
              onMouseEnter={() => isCorner && props.onHover?.(cornerIndex)}
              onMouseLeave={() => props.onHover?.(null)}
              style={{ cursor: isCorner ? "pointer" : undefined }}
            >
              <title>
                {res
                  ? `${s.name}: r = ${fmt(res.radius, 0)} m, ${fmt(s.length, 0)} m long, v = ${fmt(res.speed, 1)} m/s, margin ${pct(res.margin)}`
                  : `${s.name || "Straight"}: ${fmt(s.length, 0)} m`}
              </title>
            </path>
          );
        })}

        {/* Margin bars */}
        {ev &&
          segs
            .filter((g) => g.cornerIndex !== null)
            .map(({ i, a0, a1, cornerIndex }) => {
              const m = ev.corners[cornerIndex!]!.margin;
              const mid = (a0 + a1) / 2;
              const len = m >= 0 ? Math.min(m, scaleMax) * unit : Math.max(m, -0.5) * unit;
              const r0 = m >= 0 ? R + 8 : R - 8;
              const [x0, y0] = pt(mid, r0);
              const [x1, y1] = pt(mid, r0 + len);
              const hl = props.highlight === cornerIndex;
              return (
                <line
                  key={`b${i}`}
                  x1={x0}
                  y1={y0}
                  x2={x1}
                  y2={y1}
                  stroke={marginColour(t, m)}
                  strokeWidth={hl ? 6 : 4}
                  strokeLinecap="round"
                  opacity={props.highlight === null || props.highlight === undefined || hl ? 1 : 0.45}
                />
              );
            })}

        {/* Corner labels inside the ring */}
        {segs
          .filter((g) => g.cornerIndex !== null)
          .map(({ i, s, a0, a1, cornerIndex }) => {
            const [lx, ly] = pt((a0 + a1) / 2, R - 22);
            const isBinding = cornerIndex === binding;
            return (
              <g key={`l${i}`}>
                {isBinding && <circle cx={lx} cy={ly} r={11} fill="none" stroke={t.ink} strokeWidth={1.2} strokeDasharray="2 2" />}
                <text x={lx} y={ly} dy="0.33em" textAnchor="middle" fontSize={10} fontWeight={isBinding ? 700 : 500} fill={isBinding ? t.ink : t.muted}>
                  {s.name || `T${cornerIndex! + 1}`}
                </text>
              </g>
            );
          })}

        {/* Start / finish and direction of travel */}
        <line x1={cx} x2={cx} y1={cy - R - 10} y2={cy - R + 10} stroke={t.ink} strokeWidth={2.5} />
        <path d={`M${cx + 10},${cy - R - 16} l7,4 l-7,4`} fill="none" stroke={t.ink} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        <text x={cx - 6} y={cy - R - 14} textAnchor="end" fontSize={10} fill={t.muted}>
          start
        </text>

        {/* Centre summary */}
        <text x={cx} y={cy - 22} textAnchor="middle" fontSize={15} fontWeight={650} fill={t.ink}>
          {props.circuit.name}
        </text>
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11.5} fill={t.muted}>
          {fmt(segs.reduce((a, g) => a + g.s.length, 0), 0)} m · {segs.filter((g) => g.cornerIndex !== null).length} corners
        </text>
        {bc && (
          <>
            <text x={cx} y={cy + 20} textAnchor="middle" fontSize={11} fill={t.muted}>
              {ev!.setup.name}: tightest at {ev!.cornerNames[binding!] || `T${binding! + 1}`}
            </text>
            <text x={cx} y={cy + 40} textAnchor="middle" fontSize={17} fontWeight={650} fill={marginColour(t, bc.margin)} style={{ fontVariantNumeric: "tabular-nums" }}>
              M = {pct(bc.margin)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
