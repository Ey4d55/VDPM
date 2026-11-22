/** What-if workspace: how far inputs can move before the recommendation changes. */
import { useDeferredValue, useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { Card } from "../components/Card";
import { AxisBottom, AxisLeft, ChartCard, linspace, useWidth, XYChart, type Band, type Series } from "../components/Charts";
import { Legend, Segmented } from "../components/Controls";
import { best, rankSetups, type Circuit, type CircuitWeights } from "../engine";
import { fmt, pct } from "../format";
import { useApp, type ModelState } from "../state";
import type { ChartTheme } from "../theme";
import { WsHeader } from "./common";

const PARAMS = {
  friction: "Friction μ",
  mass: "Mass m",
  airDensity: "Air density ρ",
  referenceArea: "Reference area A",
  dragCoefficient: "C_D (all setups)",
  downforceCoefficient: "C_DF (all setups)",
  lateralAcceleration: "Corner demand a_ref",
} as const;
type Param = keyof typeof PARAMS;
type Multipliers = Partial<Record<Param, number>>;

interface Outcome {
  winner: string | null;
  margins: Record<string, number>;
}

function evaluate(state: ModelState, circuit: Circuit, weights: CircuitWeights, m: Multipliers): Outcome {
  const f = (k: Param) => m[k] ?? 1;
  const vehicle = { mass: state.vehicle.mass * f("mass"), referenceArea: state.vehicle.referenceArea * f("referenceArea"), friction: state.vehicle.friction * f("friction") };
  const env = { ...state.env, airDensity: state.env.airDensity * f("airDensity") };
  const setups = state.setups.map((s) => ({ ...s, dragCoefficient: s.dragCoefficient * f("dragCoefficient"), downforceCoefficient: s.downforceCoefficient * f("downforceCoefficient") }));
  // Scaling a_ref by f scales every corner speed sqrt(a_ref r) by sqrt(f); straights are unchanged.
  const sv = Math.sqrt(f("lateralAcceleration"));
  const c: Circuit = sv === 1 ? circuit : { ...circuit, segments: circuit.segments.map((s) => (s.kind === "corner" ? { ...s, speed: s.speed * sv } : s)) };
  const r = rankSetups(vehicle, setups, c, weights, env, state.normalisation, state.gate);
  return { winner: best(r)?.name ?? null, margins: Object.fromEntries(r.entries.map((e) => [e.name, e.evaluation.minMargin])) };
}

/** Opaque blend of a colour over the panel, so adjacent heatmap cells show no seams. */
function blend(hex: string, over: string, a: number): string {
  const rgb = (h: string) => {
    const n = parseInt(h.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = rgb(hex);
  const [r2, g2, b2] = rgb(over);
  const c = (x: number, y: number) => Math.round(a * x + (1 - a) * y);
  return `rgb(${c(r1!, r2!)},${c(g1!, g2!)},${c(b1!, b2!)})`;
}

function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function WhatIf() {
  const { state, derived, theme } = useApp();
  const { circuit, weights, colours, ranking } = derived;
  const [param, setParam] = useState<Param>("friction");
  const [span, setSpan] = useState<"25" | "50">("50");
  const [xParam, setXParam] = useState<Param>("friction");
  const [yParam, setYParam] = useState<Param>("lateralAcceleration");
  const ok = ranking !== null;
  const half = Number(span) / 100;

  const sweep = useMemo(() => {
    if (!ok) return null;
    const fs = linspace(1 - half, 1 + half, 121);
    return fs.map((f) => ({ f, ...evaluate(state, circuit, weights, { [param]: f }) }));
  }, [ok, state, circuit, weights, param, half]);

  const xP = useDeferredValue(xParam);
  const yP = useDeferredValue(yParam);
  const grid = useMemo(() => {
    if (!ok || xP === yP) return null;
    const xs = linspace(0.5, 1.5, 41);
    const ys = linspace(0.5, 1.5, 31);
    return { xs, ys, cells: ys.map((y) => xs.map((x) => evaluate(state, circuit, weights, { [xP]: x, [yP]: y }).winner)) };
  }, [ok, state, circuit, weights, xP, yP]);

  if (!sweep) {
    return (
      <div className="workspace">
        <WsHeader title="What-if" lead="Fix the inputs in the sidebar first." />
      </div>
    );
  }

  const current = best(ranking!)?.name ?? null;
  const series: Series[] = state.setups.map((s) => ({ id: s.name, label: s.name, colour: colours[s.name] ?? theme.ink, points: sweep.map((p) => [(p.f - 1) * 100, p.margins[s.name]!] as [number, number]) }));
  const bands: Band[] = [];
  const changes: { at: number; to: string | null }[] = [];
  const centre = sweep.reduce((b, p, i) => (Math.abs(p.f - 1) < Math.abs(sweep[b]!.f - 1) ? i : b), 0);
  let startIdx = 0;
  for (let i = 1; i <= sweep.length; i++) {
    if (i === sweep.length || sweep[i]!.winner !== sweep[startIdx]!.winner) {
      const w = sweep[startIdx]!.winner;
      const from = (sweep[startIdx]!.f - 1) * 100;
      const to = (sweep[Math.min(i, sweep.length - 1)]!.f - 1) * 100;
      bands.push({ axis: "x", from, to, fill: w ? withAlpha(colours[w] ?? theme.muted, theme.name === "dark" ? 0.12 : 0.1) : theme.bandNeutral });
      if (i < sweep.length) {
        // Report the first sampled value, moving away from the current inputs, at which the choice differs.
        if (i <= centre) changes.push({ at: (sweep[i - 1]!.f - 1) * 100, to: sweep[i - 1]!.winner });
        else changes.push({ at: (sweep[i]!.f - 1) * 100, to: sweep[i]!.winner });
      }
      startIdx = i;
    }
  }
  const yVals = series.flatMap((s) => s.points.map((p) => p[1]));
  const yDom: [number, number] = [Math.min(-0.05, ...yVals), Math.max(0.1, ...yVals)];
  const nearestDown = [...changes].filter((c) => c.at <= 0).sort((a, b) => b.at - a.at)[0];
  const nearestUp = changes.filter((c) => c.at > 0).sort((a, b) => a.at - b.at)[0];

  const paramOptions = (Object.keys(PARAMS) as Param[]).map((k) => ({ value: k, label: PARAMS[k] }));

  return (
    <div className="workspace">
      <WsHeader
        title="What-if"
        lead="How far can an input move before the recommendation changes? Each view scales inputs around the values in the sidebar; everything else stays fixed."
      />

      <ChartCard
        title="One input at a time"
        subtitle={<>Minimum safety margin over all corners as <strong>{PARAMS[param]}</strong> changes. The background shows which setup VDPM recommends; grey means none is eligible.</>}
        theme={theme}
        extraActions={<Segmented label="Range" value={span} onChange={setSpan} options={[{ value: "25", label: "±25 %" }, { value: "50", label: "±50 %" }]} />}
        footer={<Legend items={[...series.map((s) => ({ label: s.label, colour: s.colour })), { label: "Feasibility limit M = 0", colour: theme.infeasible, kind: "dashed" as const }]} />}
      >
        {(ref) => (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <select className="select" value={param} onChange={(e) => setParam(e.target.value as Param)} aria-label="Input to vary">
                {paramOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>
                Recommended now: <strong style={{ color: "var(--ink)" }}>{current ?? "none"}</strong>.{" "}
                {nearestDown || nearestUp ? (
                  <>
                    It changes {nearestDown && <>at <span className="mono">{fmt(nearestDown.at, 1)} %</span> (to {nearestDown.to ?? "none eligible"})</>}
                    {nearestDown && nearestUp && " and "}
                    {nearestUp && <>at <span className="mono">+{fmt(nearestUp.at, 1)} %</span> (to {nearestUp.to ?? "none eligible"})</>}.
                  </>
                ) : (
                  <>It does not change within ±{span} %.</>
                )}
              </span>
            </div>
            <XYChart
              svgRef={ref}
              theme={theme}
              height={280}
              xDomain={[-half * 100, half * 100]}
              yDomain={yDom}
              xLabel={`Change in ${PARAMS[param]} (%)`}
              yLabel="Minimum margin"
              xFormat={(v) => `${v > 0 ? "+" : ""}${fmt(v, 0)}`}
              yFormat={(v) => `${fmt(v * 100, 0)} %`}
              tooltipX={(v) => `${v > 0 ? "+" : ""}${fmt(v, 1)} %`}
              tooltipY={(v) => pct(v)}
              series={series}
              bands={bands}
              refLines={[
                { axis: "y", value: 0, colour: theme.infeasible, dashed: true, label: "M = 0", labelPosition: "start" },
                { axis: "x", value: 0, colour: theme.muted, dashed: true },
              ]}
              ariaLabel={`Minimum margin of each setup as ${PARAMS[param]} changes`}
            />
          </>
        )}
      </ChartCard>

      <ChartCard
        title="Decision map"
        subtitle="The recommended setup over two inputs at once, each from −50 % to +50 %. The cross marks the current inputs."
        theme={theme}
        footer={<Legend items={[...state.setups.map((s) => ({ label: s.name, colour: blend(colours[s.name] ?? theme.muted, theme.panel, 0.78), kind: "box" as const })), { label: "None eligible", colour: theme.name === "dark" ? "#2a3140" : "#e3e6ec", kind: "box" as const }]} />}
      >
        {(ref) => (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }} className="muted">
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                Horizontal
                <select className="select" value={xParam} onChange={(e) => setXParam(e.target.value as Param)}>{paramOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              </label>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                Vertical
                <select className="select" value={yParam} onChange={(e) => setYParam(e.target.value as Param)}>{paramOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              </label>
            </div>
            {grid ? (
              <Heatmap svgRef={ref} theme={theme} grid={grid} colours={colours} xLabel={PARAMS[xP]} yLabel={PARAMS[yP]} />
            ) : (
              <Card><span className="muted">Choose two different inputs.</span></Card>
            )}
          </>
        )}
      </ChartCard>
    </div>
  );
}

function Heatmap(props: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  theme: ChartTheme;
  grid: { xs: number[]; ys: number[]; cells: (string | null)[][] };
  colours: Record<string, string>;
  xLabel: string;
  yLabel: string;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const t = props.theme;
  const height = 340;
  const m = { top: 10, right: 16, bottom: 46, left: 60 };
  const x = scaleLinear().domain([-50, 50]).range([m.left, width - m.right]);
  const y = scaleLinear().domain([-50, 50]).range([height - m.bottom, m.top]);
  const { xs, ys, cells } = props.grid;
  const dx = (x(50) - x(-50)) / (xs.length - 1);
  const dy = (y(-50) - y(50)) / (ys.length - 1);
  const none = t.name === "dark" ? "#2a3140" : "#e3e6ec";
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  return (
    <div className="chart" ref={wrapRef}>
      <svg ref={props.svgRef} width={width} height={height} role="img" aria-label={`Recommended setup over ${props.xLabel} and ${props.yLabel}`}>
        {cells.map((row, j) =>
          row.map((w, i) => (
            <rect
              key={`${i}-${j}`}
              x={x((xs[i]! - 1) * 100) - dx / 2}
              y={y((ys[j]! - 1) * 100) - dy / 2}
              width={dx + 0.5}
              height={dy + 0.5}
              fill={w ? blend(props.colours[w] ?? t.muted, t.panel, 0.78) : none}
              onMouseEnter={() => setHover({ i, j })}
              onMouseLeave={() => setHover(null)}
            />
          )),
        )}
        <AxisLeft scale={y} x={m.left - dx / 2} theme={t} label={`${props.yLabel} (%)`} format={(v) => `${v > 0 ? "+" : ""}${fmt(v, 0)}`} />
        <AxisBottom scale={x} y={height - m.bottom + dy / 2} theme={t} label={`${props.xLabel} (%)`} format={(v) => `${v > 0 ? "+" : ""}${fmt(v, 0)}`} />
        <g stroke={t.ink} strokeWidth={1.6}>
          <line x1={x(0) - 8} x2={x(0) + 8} y1={y(0)} y2={y(0)} />
          <line x1={x(0)} x2={x(0)} y1={y(0) - 8} y2={y(0) + 8} />
        </g>
      </svg>
      {hover && (
        <div className="chart-tooltip" style={{ left: Math.min(x((xs[hover.i]! - 1) * 100) + 12, width - 200), top: Math.max(4, y((ys[hover.j]! - 1) * 100) - 50) }}>
          <div className="tt-head">
            {props.xLabel} {fmt((xs[hover.i]! - 1) * 100, 0)} % · {props.yLabel} {fmt((ys[hover.j]! - 1) * 100, 0)} %
          </div>
          <div className="tt-row"><span>Recommended</span><span>{cells[hover.j]![hover.i] ?? "none eligible"}</span></div>
        </div>
      )}
    </div>
  );
}
