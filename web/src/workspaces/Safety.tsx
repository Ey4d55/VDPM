/** Safety workspace: one corner in detail (Sec. 4 of the manuscript). */
import { useMemo, useState } from "react";
import { Callout, Card } from "../components/Card";
import { ChartCard, HBarChart, linspace, XYChart, type BarRow, type Marker, type Series } from "../components/Charts";
import { Legend, NumberField, Segmented } from "../components/Controls";
import { IconInfo } from "../components/Icons";
import { availableLateralGrip, downforce, evaluateCorner, maxCorneringSpeed, downforceFactor, requiredLateralForce, type AeroSetup, type CornerResult, type Environment, type Vehicle } from "../engine";
import { fmt, fmtUnit, kmh, pct } from "../format";
import { useApp } from "../state";
import { FeasibleBadge, SetupName, WsHeader } from "./common";

const CASE = { speed: 30, radius: 60 };

const TORNADO: { key: string; label: string }[] = [
  { key: "friction", label: "Friction μ" },
  { key: "speed", label: "Speed v" },
  { key: "radius", label: "Radius r" },
  { key: "mass", label: "Mass m" },
  { key: "downforceCoefficient", label: "C_DF" },
  { key: "airDensity", label: "Air density ρ" },
  { key: "referenceArea", label: "Area A" },
  { key: "dragCoefficient", label: "C_D" },
];

function perturbed(key: string, f: number, v: Vehicle, s: AeroSetup, env: Environment, speed: number, radius: number): CornerResult {
  const vv = { ...v };
  const ss = { ...s };
  const ee = { ...env };
  let sp = speed;
  let r = radius;
  if (key === "friction") vv.friction *= f;
  else if (key === "mass") vv.mass *= f;
  else if (key === "referenceArea") vv.referenceArea *= f;
  else if (key === "airDensity") ee.airDensity *= f;
  else if (key === "downforceCoefficient") ss.downforceCoefficient *= f;
  else if (key === "dragCoefficient") ss.dragCoefficient *= f;
  else if (key === "speed") sp *= f;
  else if (key === "radius") r *= f;
  return evaluateCorner(vv, ss, sp, r, ee);
}

export function Safety() {
  const { state, derived, theme } = useApp();
  const { colours, circuit } = derived;
  const corners = circuit.segments.filter((s) => s.kind === "corner");
  const [mode, setMode] = useState<"case" | "corner">("case");
  const [cornerIdx, setCornerIdx] = useState(0);
  const [custom, setCustom] = useState(CASE);
  const [tornadoSetup, setTornadoSetup] = useState(0);

  const ci = Math.min(cornerIdx, corners.length - 1);
  const point = mode === "case" ? custom : { speed: corners[ci]!.speed, radius: corners[ci]!.radius! };
  const { speed, radius } = point;

  const results = useMemo(() => {
    try {
      return state.setups.map((s) => evaluateCorner(state.vehicle, s, speed, radius, state.env));
    } catch {
      return null;
    }
  }, [state.setups, state.vehicle, state.env, speed, radius]);

  const isTable2 =
    mode === "case" && speed === CASE.speed && radius === CASE.radius && state.vehicle.mass === 800 && state.vehicle.referenceArea === 1.5 && state.vehicle.friction === 1.5 && state.env.airDensity === 1.225 && state.env.gravity === 9.81;

  if (!results || derived.error) {
    return (
      <div className="workspace">
        <WsHeader title="Safety" lead="Grip against demand at a single corner." />
        <Callout tone="bad" icon={<IconInfo />}>{derived.error ?? "Speed and radius must be positive."}</Callout>
      </div>
    );
  }

  // Forces against speed at this radius
  const vMaxPlot = Math.max(speed * 1.8, 60);
  const vs = linspace(1, vMaxPlot, 160);
  const g = state.env.gravity;
  const forceSeries: Series[] = [
    { id: "demand", label: "Required F_c = m v² / r", colour: theme.demand, dashed: true, points: vs.map((v) => [v, requiredLateralForce(state.vehicle.mass, v, radius) / 1000] as [number, number]) },
    ...state.setups.map((s) => ({
      id: s.name,
      label: `${s.name} grip F_grip`,
      colour: colours[s.name] ?? theme.ink,
      points: vs.map((v) => [v, availableLateralGrip(state.vehicle.friction, state.vehicle.mass, g, downforce(state.env.airDensity, v, s.downforceCoefficient, state.vehicle.referenceArea)) / 1000] as [number, number]),
    })),
  ];
  const forceMarkers: Marker[] = results.flatMap((r, i) =>
    Number.isFinite(r.maxCorneringSpeed) && r.maxCorneringSpeed <= vMaxPlot
      ? [{ x: r.maxCorneringSpeed, y: requiredLateralForce(state.vehicle.mass, r.maxCorneringSpeed, radius) / 1000, colour: colours[state.setups[i]!.name] ?? theme.ink }]
      : [],
  );
  const fMax = Math.max(...forceSeries.flatMap((s) => s.points.map((p) => p[1])));

  // Grip-limited speed against radius
  const rStars = results.map((r) => r.criticalRadius).filter((r) => Number.isFinite(r) && r < 1000);
  const rMax = Math.max(radius * 2.5, ...corners.map((c) => c.radius! * 1.1), ...rStars.map((r) => r * 1.15), 200);
  const rs = linspace(5, rMax, 240);
  const vCap = Math.max(110, speed * 1.6);
  const vSeries: Series[] = state.setups.map((s) => {
    const k = downforceFactor(state.env.airDensity, s.downforceCoefficient, state.vehicle.referenceArea);
    return {
      id: s.name,
      label: s.name,
      colour: colours[s.name] ?? theme.ink,
      points: rs.map((r) => {
        const v = maxCorneringSpeed(state.vehicle.mass, r, state.vehicle.friction, g, k);
        return [r, Number.isFinite(v) && v < vCap * 1.5 ? v : NaN] as [number, number];
      }),
    };
  });
  const vMarkers: Marker[] = [
    ...corners.map((c) => ({ x: c.radius!, y: c.speed, colour: theme.muted })),
    { x: radius, y: speed, colour: theme.ink, shape: "diamond" as const, label: mode === "case" ? "this corner" : corners[ci]!.name },
  ];

  // Tornado
  const ts = state.setups[Math.min(tornadoSetup, state.setups.length - 1)]!;
  const base = results[Math.min(tornadoSetup, results.length - 1)]!.margin;
  const tornado = TORNADO.map((p) => {
    const lo = perturbed(p.key, 0.9, state.vehicle, ts, state.env, speed, radius).margin;
    const hi = perturbed(p.key, 1.1, state.vehicle, ts, state.env, speed, radius).margin;
    return { ...p, lo, hi, span: Math.abs(hi - lo) };
  }).sort((a, b) => b.span - a.span);
  const tsColour = colours[ts.name] ?? theme.ink;
  const tornadoRows: BarRow[] = tornado.map((t) => ({
    id: t.key,
    label: t.label,
    segments: [
      { from: base, to: t.lo, colour: theme.components.grip, label: `−10 %: margin ${pct(t.lo)}` },
      { from: base, to: t.hi, colour: tsColour, label: `+10 %: margin ${pct(t.hi)}` },
    ],
    valueLabel: t.span < 1e-12 ? "no effect" : `${fmt((t.hi - base) * 100, 1)} pp`,
  }));
  const allM = tornado.flatMap((t) => [t.lo, t.hi, base, 0]);
  const tDom: [number, number] = [Math.min(...allM) - 0.03, Math.max(...allM) + 0.03];

  return (
    <div className="workspace">
      <WsHeader
        title="Safety"
        lead="Grip against demand at a single corner. With the paper's inputs, the case-study corner reproduces Table 2 of the manuscript."
        actions={
          <Segmented
            label="Corner to analyse"
            value={mode}
            onChange={setMode}
            options={[
              { value: "case", label: "Case-study corner" },
              { value: "corner", label: `Corner of ${circuit.name}` },
            ]}
          />
        }
      />

      <Card>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
          {mode === "case" ? (
            <>
              <div style={{ width: 260 }}>
                <NumberField label="Speed" symbol="v" unit="m/s" value={custom.speed} min={0.1} onChange={(v) => setCustom({ ...custom, speed: v })} slider={{ min: 5, max: 100, step: 0.5 }} hint={kmh(custom.speed)} />
              </div>
              <div style={{ width: 260 }}>
                <NumberField label="Radius" symbol="r" unit="m" value={custom.radius} min={0.1} onChange={(v) => setCustom({ ...custom, radius: v })} slider={{ min: 10, max: 500, step: 1 }} hint={`Demand v²/r = ${fmt((custom.speed * custom.speed) / custom.radius, 2)} m/s²`} />
              </div>
              <button className="btn" onClick={() => setCustom(CASE)} disabled={custom.speed === CASE.speed && custom.radius === CASE.radius}>
                Table 2 corner (30 m/s, 60 m)
              </button>
            </>
          ) : (
            <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              Corner
              <select className="select" value={ci} onChange={(e) => setCornerIdx(Number(e.target.value))}>
                {corners.map((c, i) => (
                  <option key={i} value={i}>
                    {c.name || `T${i + 1}`} · r = {fmt(c.radius, 0)} m · v = {fmt(c.speed, 1)} m/s
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>
            Lateral demand {fmt((speed * speed) / radius / g, 2)} g at {kmh(speed)} on a {fmt(radius, 0)} m radius
          </div>
        </div>
      </Card>

      <div className="gauge-row">
        {results.map((r, i) => {
          const s = state.setups[i]!;
          const scale = Math.max(r.availableGrip, r.requiredForce) * 1.04;
          return (
            <div className="gauge" key={s.name}>
              <div className="gauge-name" style={{ justifyContent: "space-between" }}>
                <SetupName name={s.name} colour={colours[s.name]} />
                <FeasibleBadge ok={r.feasible} />
              </div>
              <div className="stat-value" style={{ margin: "8px 0 2px", color: r.feasible ? undefined : "var(--bad)" }}>{pct(r.margin)}</div>
              <div className="stat-note">safety margin M</div>
              <div className="meter" aria-hidden>
                <span className="meter-grip" style={{ width: `${(100 * r.availableGrip) / scale}%`, background: colours[s.name] }} />
                <span className="meter-demand" style={{ left: `${(100 * r.requiredForce) / scale}%` }} title="Required lateral force" />
              </div>
              <div className="stat-note" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>demand {fmt(r.requiredForce / 1000, 2)} kN</span>
                <span>grip {fmt(r.availableGrip / 1000, 2)} kN</span>
              </div>
            </div>
          );
        })}
      </div>

      <Card
        title={isTable2 ? "Forces at the case-study corner (reproduces Table 2)" : "Forces at this corner"}
        subtitle="Eqs. 4.1 to 4.5 with the inputs in the sidebar. The lower block gives the limits at which this corner would just stay feasible."
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Quantity</th>
                <th>Symbol</th>
                {state.setups.map((s) => (
                  <th key={s.name} className="num"><SetupName name={s.name} colour={colours[s.name]} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="Aerodynamic drag" sym="F_D" values={results.map((r) => `${fmt(r.drag, 1)} N`)} />
              <Row label="Downforce" sym="F_DF" values={results.map((r) => `${fmt(r.downforce, 1)} N`)} />
              <Row label="Required lateral force" sym="F_c" values={results.map((r) => `${fmt(r.requiredForce, 1)} N`)} />
              <Row label="Available lateral grip" sym="F_grip" values={results.map((r) => `${fmt(r.availableGrip, 1)} N`)} />
              <Row label="Grip reserve" sym="F_grip − F_c" values={results.map((r) => `${fmt(r.reserveForce, 1)} N`)} />
              <Row label="Safety margin" sym="M" values={results.map((r) => pct(r.margin))} strong />
              <Row label="Maximum lateral acceleration" sym="a_lat,max" values={results.map((r) => `${fmt(r.maxLateralAcceleration, 2)} m/s² (${fmt(r.maxLateralAcceleration / g, 2)} g)`)} />
              <Row label="Grip-limited speed" sym="v_max" values={results.map((r) => (Number.isFinite(r.maxCorneringSpeed) ? `${fmt(r.maxCorneringSpeed, 2)} m/s (${kmh(r.maxCorneringSpeed)})` : "no limit (r ≥ r*)"))} />
              <Row label="Critical radius" sym="r*" values={results.map((r) => fmtUnit(r.criticalRadius, "m", 0))} />
              <tr><td colSpan={2 + results.length} style={{ padding: "14px 10px 6px", color: "var(--muted)", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line)" }}>Feasibility limits at this corner</td></tr>
              <Row label="Smallest feasible radius" sym="r_min" values={results.map((r) => `${fmt(r.minRadius, 1)} m`)} />
              <Row label="Lowest friction" sym="μ_min" values={results.map((r) => fmt(r.minFriction, 3))} />
              <Row label="Highest mass" sym="m_max" values={results.map((r) => fmtUnit(r.maxMass, "kg", 0))} />
              <Row label="Lowest downforce coefficient" sym="C_DF,min" values={results.map((r) => fmt(r.minDownforceCoefficient, 3))} />
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2">
        <ChartCard
          title="Grip and demand against speed"
          subtitle={`At r = ${fmt(radius, 0)} m. Each setup holds the corner up to the speed where its grip line meets the demand curve (dot).`}
          theme={theme}
          footer={<Legend items={[{ label: "Required F_c", colour: theme.demand, kind: "dashed" }, ...state.setups.map((s) => ({ label: s.name, colour: colours[s.name] ?? theme.ink }))]} />}
        >
          {(ref) => (
            <XYChart
              svgRef={ref}
              theme={theme}
              height={270}
              xDomain={[0, vMaxPlot]}
              yDomain={[0, fMax * 1.05]}
              xLabel="Speed v (m/s)"
              yLabel="Lateral force (kN)"
              xFormat={(v) => fmt(v, 0)}
              yFormat={(v) => fmt(v, 0)}
              tooltipX={(v) => `${fmt(v, 1)} m/s · ${kmh(v)}`}
              tooltipY={(v) => `${fmt(v, 2)} kN`}
              series={forceSeries}
              markers={forceMarkers}
              refLines={[{ axis: "x", value: speed, colour: theme.muted, dashed: true, label: `v = ${fmt(speed, 1)}` }]}
              ariaLabel="Available grip of each setup and required lateral force against speed"
            />
          )}
        </ChartCard>

        <ChartCard
          title="Grip-limited speed against radius"
          subtitle={`Beyond the critical radius r* (dashed) downforce grows as fast as demand and the model sets no speed limit. Grey dots: corners of ${circuit.name}.`}
          theme={theme}
          footer={<Legend items={[...state.setups.map((s) => ({ label: s.name, colour: colours[s.name] ?? theme.ink })), { label: "Circuit corners", colour: theme.muted, kind: "box" as const }]} />}
        >
          {(ref) => (
            <XYChart
              svgRef={ref}
              theme={theme}
              height={270}
              xDomain={[0, rMax]}
              yDomain={[0, vCap]}
              xLabel="Corner radius r (m)"
              yLabel="v_max (m/s)"
              xFormat={(v) => fmt(v, 0)}
              yFormat={(v) => fmt(v, 0)}
              tooltipX={(v) => `r = ${fmt(v, 0)} m`}
              tooltipY={(v) => (Number.isFinite(v) ? `${fmt(v, 1)} m/s` : "no limit")}
              series={vSeries}
              markers={vMarkers}
              refLines={results.filter((r) => Number.isFinite(r.criticalRadius) && r.criticalRadius < rMax).map((r, i) => ({ axis: "x" as const, value: r.criticalRadius, colour: colours[state.setups[i]!.name] ?? theme.ink, dashed: true }))}
              ariaLabel="Grip-limited cornering speed against corner radius"
            />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="What moves the margin"
        subtitle={`Margin of ${ts.name} when one input changes by −10 % (grey) or +10 % (colour), others fixed. Solid line: current margin; dashed: feasibility limit M = 0. Drag does not enter the margin.`}
        theme={theme}
        extraActions={state.setups.length > 1 ? <Segmented label="Setup" value={String(Math.min(tornadoSetup, state.setups.length - 1))} onChange={(v) => setTornadoSetup(Number(v))} options={state.setups.map((s, i) => ({ value: String(i), label: s.name }))} /> : undefined}
      >
        {(ref) => (
          <HBarChart
            svgRef={ref}
            theme={theme}
            rows={tornadoRows}
            domain={tDom}
            xLabel="Safety margin M"
            xFormat={(v) => `${fmt(v * 100, 0)} %`}
            refLines={[
              { value: base, colour: theme.ink, label: `now ${pct(base)}` },
              ...(tDom[0] < 0 ? [{ value: 0, colour: theme.infeasible, dashed: true, label: "M = 0" }] : []),
            ]}
            labelWidth={120}
            valueWidth={78}
            ariaLabel="One-at-a-time sensitivity of the safety margin"
          />
        )}
      </ChartCard>
    </div>
  );
}

function Row({ label, sym, values, strong }: { label: string; sym: string; values: string[]; strong?: boolean }) {
  return (
    <tr>
      <td style={{ fontWeight: strong ? 650 : undefined }}>{label}</td>
      <td className="mono muted" style={{ fontSize: 12 }}>{sym}</td>
      {values.map((v, i) => (
        <td key={i} className="num" style={{ fontWeight: strong ? 650 : undefined }}>{v}</td>
      ))}
    </tr>
  );
}
