/** Research workspace: verification, uncertainty and the evidence behind the paper's claims. */
import { useMemo, useState } from "react";
import summary from "../../../results/summary.json";
import { Badge, Callout, Card } from "../components/Card";
import { ChartCard, HBarChart, linspace, XYChart, type Band, type BarRow, type Series } from "../components/Charts";
import { Legend, NumberField, Segmented } from "../components/Controls";
import { IconAlert, IconCheck, IconInfo } from "../components/Icons";
import {
  baselineTop,
  best,
  DEFAULT_UNCERTAINTY,
  evaluateCorner,
  rankSetups,
  referenceCircuit,
  REFERENCE_SUMMARIES,
  runGolden,
  runMonteCarlo,
  wilson,
  type Circuit,
  type GoldenReport,
  type MonteCarloOutput,
} from "../engine";
import { fmt, pct } from "../format";
import { useApp } from "../state";
import { WsHeader } from "./common";

/** Table 2 of the manuscript as printed. */
const TABLE_2 = [
  { setup: "Setup A", cd: 0.8, cdf: 2.5, drag: 661.5, downforce: 2067.2, demand: 12000.0, grip: 14872.8, reserve: 23.9 },
  { setup: "Setup B", cd: 1.1, cdf: 3.5, drag: 909.6, downforce: 2894.1, demand: 12000.0, grip: 16113.1, reserve: 34.3 },
];
const PAPER_VEHICLE = { mass: 800, referenceArea: 1.5, friction: 1.5 };
const PAPER_ENV = { airDensity: 1.225, gravity: 9.81 };

const METHODS: { key: string; label: string }[] = [
  { key: "ungated", label: "VDPM without gate" },
  { key: "drag-only", label: "Drag only" },
  { key: "downforce-only", label: "Downforce only" },
  { key: "efficiency-only", label: "Efficiency only" },
];

interface Timing {
  task: string;
  medianUs: number;
}

function measure(fn: () => void): number {
  const per: number[] = [];
  for (let rep = 0; rep < 9; rep++) {
    let n = 0;
    const t0 = performance.now();
    let t = t0;
    while (t - t0 < 60) {
      fn();
      n++;
      t = performance.now();
    }
    per.push(((t - t0) * 1000) / n);
  }
  per.sort((a, b) => a - b);
  return per[4]!;
}

export function Research() {
  const { state, derived, theme } = useApp();
  const { colours, circuit } = derived;

  // ------------------------------------------------------------- Table 2
  const table2 = TABLE_2.flatMap((row) => {
    const r = evaluateCorner(PAPER_VEHICLE, { name: row.setup, dragCoefficient: row.cd, downforceCoefficient: row.cdf }, 30, 60, PAPER_ENV);
    return [
      { setup: row.setup, q: "Drag F_D (N)", pub: row.drag, calc: r.drag, res: 0.1 },
      { setup: row.setup, q: "Downforce F_DF (N)", pub: row.downforce, calc: r.downforce, res: 0.1 },
      { setup: row.setup, q: "Required F_c (N)", pub: row.demand, calc: r.requiredForce, res: 0.1 },
      { setup: row.setup, q: "Grip F_grip (N)", pub: row.grip, calc: r.availableGrip, res: 0.1 },
      { setup: row.setup, q: "Reserve M (%)", pub: row.reserve, calc: r.margin * 100, res: 0.1 },
    ];
  });
  const allWithin = table2.every((r) => Math.abs(r.calc - r.pub) <= r.res / 2 + 1e-9);

  // ------------------------------------------------------------- golden
  const [golden, setGolden] = useState<GoldenReport | null>(null);
  const [goldenBusy, setGoldenBusy] = useState(false);
  const [goldenError, setGoldenError] = useState<string | null>(null);
  const runGoldenCases = async () => {
    setGoldenBusy(true);
    setGoldenError(null);
    try {
      const data = (await import("../../../golden/cases.json")).default as Record<string, unknown>;
      await new Promise((r) => setTimeout(r, 30));
      setGolden(runGolden(data));
    } catch (e) {
      setGoldenError((e as Error).message);
    } finally {
      setGoldenBusy(false);
    }
  };

  // ------------------------------------------------------------- timing
  const [timings, setTimings] = useState<Timing[] | null>(null);
  const [timingBusy, setTimingBusy] = useState(false);
  const runTimings = () => {
    setTimingBusy(true);
    setTimeout(() => {
      const c = referenceCircuit("C");
      const A = { name: "Setup A", dragCoefficient: 0.8, downforceCoefficient: 2.5 };
      const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `S${i}`, dragCoefficient: 0.8 + (0.4 * i) / n, downforceCoefficient: 2.5 + (1.2 * i) / n }));
      const s2 = many(2);
      const s10 = many(10);
      const s50 = many(50);
      setTimings([
        { task: "one setup, one corner (evaluate_corner)", medianUs: measure(() => evaluateCorner(PAPER_VEHICLE, A, 30, 60, PAPER_ENV)) },
        { task: "rank 2 setups on Circuit C (18 corners)", medianUs: measure(() => rankSetups(PAPER_VEHICLE, s2, c, undefined, PAPER_ENV)) },
        { task: "rank 10 setups on Circuit C (18 corners)", medianUs: measure(() => rankSetups(PAPER_VEHICLE, s10, c, undefined, PAPER_ENV)) },
        { task: "rank 50 setups on Circuit C (18 corners)", medianUs: measure(() => rankSetups(PAPER_VEHICLE, s50, c, undefined, PAPER_ENV)) },
      ]);
      setTimingBusy(false);
    }, 30);
  };
  const pyTiming = Object.fromEntries(summary.timing.results.map((r) => [r.task, r.median_us]));

  // ------------------------------------------------------------- Monte Carlo
  const key = state.circuitSource.kind === "reference" ? state.circuitSource.key : null;
  const [samples, setSamples] = useState<"1000" | "5000">("1000");
  const [seed, setSeed] = useState(20261122);
  const [mc, setMc] = useState<{ out: MonteCarloOutput; key: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const runMc = () => {
    if (!key || derived.error) return;
    const total = Number(samples);
    const chunk = 250;
    const acc: MonteCarloOutput = { samples: 0, winners: {}, feasible: {}, avoidableInfeasible: {} };
    const add = (into: Record<string, number>, from: Record<string, number>) => {
      for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
    };
    let done = 0;
    setProgress(0);
    const step = () => {
      const out = runMonteCarlo({
        summary: REFERENCE_SUMMARIES[key],
        vehicle: state.vehicle,
        env: state.env,
        setups: state.setups,
        lateralAcceleration: state.lateralAcceleration,
        weights: state.weightsMode === "manual" ? derived.weights : undefined,
        uncertainty: DEFAULT_UNCERTAINTY,
        samples: chunk,
        // Each chunk uses its own deterministic stream derived from the seed.
        seed: (seed + Math.imul(done / chunk, 0x9e3779b1)) >>> 0,
      });
      acc.samples += out.samples;
      add(acc.winners, out.winners);
      add(acc.feasible, out.feasible);
      add(acc.avoidableInfeasible, out.avoidableInfeasible);
      done += chunk;
      setProgress(done / total);
      if (done < total) setTimeout(step, 0);
      else {
        setMc({ out: acc, key: `${key}-${total}-${seed}` });
        setProgress(null);
      }
    };
    setTimeout(step, 20);
  };

  const mcRows: BarRow[] = mc
    ? [...state.setups.map((s) => s.name), "none eligible"].filter((n) => n in mc.out.winners).map((n) => {
        const k = mc.out.winners[n]!;
        const [lo, hi] = wilson(k, mc.out.samples);
        return { id: n, label: n, swatch: colours[n] ?? theme.faint, segments: [{ from: 0, to: k / mc.out.samples, colour: colours[n] ?? theme.faint }], whisker: [lo, hi] as [number, number], valueLabel: pct(k / mc.out.samples) };
      })
    : [];
  const avoidRows: BarRow[] = mc
    ? METHODS.map((m) => {
        const k = mc.out.avoidableInfeasible[m.key] ?? 0;
        const [lo, hi] = wilson(k, mc.out.samples);
        return { id: m.key, label: m.label, segments: [{ from: 0, to: k / mc.out.samples, colour: theme.infeasible }], whisker: [lo, hi] as [number, number], valueLabel: pct(k / mc.out.samples) };
      })
    : [];
  const avoidMax = Math.max(0.05, ...avoidRows.map((r) => r.whisker![1])) * 1.1;

  // ------------------------------------------------------------- demand sweep
  const sweep = useMemo(() => {
    if (derived.error) return null;
    const as = linspace(10, 30, 161);
    const scale = (a: number): Circuit =>
      key
        ? referenceCircuit(key, a)
        : { ...circuit, segments: circuit.segments.map((s) => (s.kind === "corner" ? { ...s, speed: s.speed * Math.sqrt(a / state.lateralAcceleration) } : s)) };
    return as.map((a) => {
      const c = scale(a);
      const r = rankSetups(state.vehicle, state.setups, c, state.weightsMode === "manual" ? derived.weights : undefined, state.env, state.normalisation, "strict");
      const top = best(r);
      const dragPick = baselineTop("drag-only", r.entries.map((e) => e.evaluation));
      return { a, margins: Object.fromEntries(r.entries.map((e) => [e.name, e.evaluation.minMargin])), none: !top, dragFails: !!top && !dragPick.feasible };
    });
  }, [derived.error, derived.weights, key, circuit, state]);

  const sweepSeries: Series[] = sweep ? state.setups.map((s) => ({ id: s.name, label: s.name, colour: colours[s.name] ?? theme.ink, points: sweep.map((p) => [p.a, p.margins[s.name]!] as [number, number]) })) : [];
  const sweepBands: Band[] = [];
  if (sweep) {
    const dA = sweep[1]!.a - sweep[0]!.a;
    for (const p of sweep) {
      if (p.none) sweepBands.push({ axis: "x", from: p.a - dA / 2, to: p.a + dA / 2, fill: theme.bandNeutral });
      else if (p.dragFails) sweepBands.push({ axis: "x", from: p.a - dA / 2, to: p.a + dA / 2, fill: theme.bandInfeasible });
    }
  }
  const sweepY = sweepSeries.flatMap((s) => s.points.map((p) => p[1]));

  return (
    <div className="workspace">
      <WsHeader
        title="Research"
        lead="The checks behind the paper's numbers, runnable here. The published tables and figures come from the Python research suite (vdpm research); this page reruns the same model in your browser."
      />

      <div className="grid grid-2">
        <Card
          title="Table 2, recomputed"
          subtitle="The manuscript's printed values against Eqs. 4.1 to 4.5 evaluated with the Table 1 inputs (fixed, independent of the sidebar)."
          actions={allWithin ? <Badge tone="good">all 10 within printed resolution</Badge> : <Badge tone="bad">mismatch</Badge>}
        >
          <div className="table-wrap">
            <table className="data compact">
              <thead>
                <tr>
                  <th>Setup</th>
                  <th>Quantity</th>
                  <th className="num">Printed</th>
                  <th className="num">Recomputed</th>
                  <th className="num">Difference</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {table2.map((r, i) => {
                  const ok = Math.abs(r.calc - r.pub) <= r.res / 2 + 1e-9;
                  return (
                    <tr key={i}>
                      <td className="nowrap">{i % 5 === 0 ? r.setup : ""}</td>
                      <td>{r.q}</td>
                      <td className="num">{fmt(r.pub, 1)}</td>
                      <td className="num">{fmt(r.calc, 4)}</td>
                      <td className="num">{(r.calc - r.pub >= 0 ? "+" : "") + fmt(r.calc - r.pub, 4)}</td>
                      <td style={{ color: ok ? "var(--good)" : "var(--bad)" }}>{ok ? <IconCheck width={15} height={15} aria-label="within resolution" /> : <IconAlert width={15} height={15} aria-label="outside resolution" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
          <Card
            title="Python and browser engines agree"
            subtitle="The browser engine is an independent TypeScript implementation. It must reproduce every value of the golden cases written by the Python reference."
            actions={<button className="btn btn-primary btn-sm" onClick={runGoldenCases} disabled={goldenBusy}>{goldenBusy ? "Running…" : golden ? "Run again" : "Run golden cases"}</button>}
          >
            {goldenError && <Callout tone="bad" icon={<IconAlert />}>{goldenError}</Callout>}
            {golden ? (
              <dl className="kv">
                <dt>Cases</dt><dd>{golden.cornerCases} corners · {golden.circuitCases} rankings</dd>
                <dt>Values compared</dt><dd>{golden.compared.toLocaleString("en-US")}</dd>
                <dt>Mismatches</dt><dd style={{ color: golden.mismatches.length ? "var(--bad)" : "var(--good)" }}>{golden.mismatches.length}</dd>
                <dt>Largest relative difference</dt><dd>{golden.maxRelativeError === 0 ? "0 (bit-identical)" : golden.maxRelativeError.toExponential(2)}</dd>
                <dt>Tolerance</dt><dd>{golden.tolerance.toExponential(0)}</dd>
                <dt>Time in this browser</dt><dd>{fmt(golden.milliseconds, 0)} ms</dd>
              </dl>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {summary.verification.golden_corner_cases} corner cases and {summary.verification.golden_circuit_cases} circuit rankings over setups, speeds, radii, vehicles,
                environments, weights, normalisations and gates. Loading them fetches about 1 MB.
              </p>
            )}
            {golden && golden.mismatches.length > 0 && (
              <pre className="mono" style={{ fontSize: 11.5, maxHeight: 140, overflow: "auto" }}>{golden.mismatches.slice(0, 20).join("\n")}</pre>
            )}
          </Card>

          <Card
            title="Processing time"
            subtitle="Median time per call. The Python column is the published measurement; the browser column is measured on this device."
            actions={<button className="btn btn-sm" onClick={runTimings} disabled={timingBusy}>{timingBusy ? "Measuring…" : "Measure here"}</button>}
          >
            <table className="data compact">
              <thead>
                <tr>
                  <th>Task</th>
                  <th className="num">Python</th>
                  <th className="num">This browser</th>
                </tr>
              </thead>
              <tbody>
                {summary.timing.results.map((r, i) => (
                  <tr key={r.task}>
                    <td>{r.task}</td>
                    <td className="num">{fmtUs(pyTiming[r.task]!)}</td>
                    <td className="num">{timings ? fmtUs(timings[i]!.medianUs) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
              Python {summary.timing.environment.python} ({summary.timing.environment.implementation}), {summary.timing.environment.system}.
            </div>
          </Card>
        </div>
      </div>

      <Card
        title="Uncertainty: Monte Carlo"
        subtitle={
          <>
            Each sample perturbs the sidebar inputs by independent uniform factors: μ ±10 %, m ±2 %, ρ ±5 %, A ±2 %, C_D and C_DF ±5 % per setup, a_ref ±10 %. These ranges are illustrative assumptions.
          </>
        }
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Segmented label="Samples" value={samples} onChange={setSamples} options={[{ value: "1000", label: "1,000" }, { value: "5000", label: "5,000" }]} />
            <button className="btn btn-primary btn-sm" onClick={runMc} disabled={!key || progress !== null || !!derived.error}>
              {progress !== null ? `Running ${fmt(progress * 100, 0)} %` : "Run"}
            </button>
          </div>
        }
      >
        {!key ? (
          <Callout icon={<IconInfo />}>Monte Carlo runs on the reference circuits A, B and C, whose layouts are rebuilt for every sampled corner demand. Select one in the sidebar.</Callout>
        ) : (
          <>
            <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 6 }}>
              <div style={{ width: 220 }}>
                <NumberField label="Seed" value={seed} onChange={(v) => setSeed(Math.round(v))} min={0} step={1} digits={0} inputWidth={120} />
              </div>
              {progress !== null && <div className="progress" style={{ flex: 1, minWidth: 160, marginBottom: 8 }}><span style={{ width: `${progress * 100}%` }} /></div>}
            </div>
            {mc ? (
              <div className="grid grid-2">
                <ChartCard title="Which setup is recommended" subtitle={`Share of ${mc.out.samples.toLocaleString("en-US")} samples, with 95 % Wilson intervals.`} theme={theme} className="inset">
                  {(ref) => <HBarChart svgRef={ref} theme={theme} rows={mcRows} domain={[0, 1]} xFormat={(v) => `${fmt(v * 100, 0)} %`} xLabel="Share of samples" ariaLabel="Share of samples in which each setup is recommended" />}
                </ChartCard>
                <ChartCard title="Avoidable infeasible choices" subtitle="Share of samples in which a method picks a setup that fails a corner although a feasible setup existed. Gated VDPM: 0 by construction." theme={theme} className="inset">
                  {(ref) => <HBarChart svgRef={ref} theme={theme} rows={avoidRows} domain={[0, avoidMax]} xFormat={(v) => `${fmt(v * 100, 0)} %`} xLabel="Share of samples" labelWidth={140} ariaLabel="Share of samples with an avoidable infeasible recommendation per method" />}
                </ChartCard>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>Press Run to sample the current scenario on {REFERENCE_SUMMARIES[key].name}.</p>
            )}
          </>
        )}
      </Card>

      <ChartCard
        title="Corner-demand sweep"
        subtitle={`Minimum margin over all corners of ${circuit.name} as the corner demand a_ref = v²/r rises from 10 to 30 m/s², the range of the published sweep. Red: the drag-only rule picks a setup that fails a corner while VDPM still finds a feasible one. Grey: no setup is feasible and VDPM makes no recommendation.`}
        theme={theme}
        footer={
          <Legend
            items={[
              ...sweepSeries.map((s) => ({ label: s.label, colour: s.colour })),
              { label: "Drag-only fails, VDPM feasible", colour: theme.infeasible, kind: "box" as const },
              { label: "No setup feasible", colour: theme.faint, kind: "box" as const },
              { label: "Current a_ref", colour: theme.muted, kind: "dashed" as const },
            ]}
          />
        }
      >
        {(ref) =>
          sweep ? (
            <XYChart
              svgRef={ref}
              theme={theme}
              height={290}
              xDomain={[10, 30]}
              yDomain={[Math.min(-0.1, ...sweepY), Math.max(0.2, ...sweepY)]}
              xLabel="Corner demand a_ref (m/s²)"
              yLabel="Minimum margin"
              xFormat={(v) => fmt(v, 0)}
              yFormat={(v) => `${fmt(v * 100, 0)} %`}
              tooltipX={(v) => `a_ref = ${fmt(v, 2)} m/s²`}
              tooltipY={(v) => pct(v)}
              series={sweepSeries}
              bands={sweepBands}
              refLines={[
                { axis: "y", value: 0, colour: theme.infeasible, dashed: true, label: "M = 0", labelPosition: "start" },
                { axis: "x", value: state.lateralAcceleration, colour: theme.muted, dashed: true, label: "now" },
              ]}
              ariaLabel="Minimum margin of each setup against corner demand"
            />
          ) : (
            <span className="muted">Fix the inputs first.</span>
          )
        }
      </ChartCard>

      <Card title="Published results" subtitle={`From the Python research suite, vdpm ${summary.vdpm_version}, seed ${summary.seed}, paper inputs. Rerun with: vdpm research --out results`}>
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th>Circuit</th>
                <th>Recommended at reference inputs</th>
                <th className="num">Same choice under uncertainty (95 % CI)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.monte_carlo.circuits).map(([name, c]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{c.baseline_best}</td>
                  <td className="num">{pct(c.baseline_best_kept)} ({pct(c.baseline_best_kept_ci95[0])} to {pct(c.baseline_best_kept_ci95[1])})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
          Deterministic demand sweep over {summary.demand_sweep.points} scenarios (3 circuits, a_ref 10 to 30 m/s²): the drag-only rule picks an avoidable infeasible setup in{" "}
          {pct(summary.demand_sweep.share_top_choice_infeasible_avoidable["drag-only"])} of them; gated VDPM in none. No setup is feasible in {pct(summary.demand_sweep.share_no_setup_eligible)}.
        </p>
      </Card>
    </div>
  );
}

function fmtUs(us: number): string {
  return us >= 1000 ? `${fmt(us / 1000, 2)} ms` : `${fmt(us, us < 10 ? 2 : 1)} µs`;
}
