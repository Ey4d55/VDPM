/** Decision workspace: the recommendation, the ranking and why. */
import { useMemo } from "react";
import { Badge, Callout, Card } from "../components/Card";
import { ChartCard, HBarChart, linspace, XYChart, type BarRow, type Marker, type Series } from "../components/Charts";
import { Legend } from "../components/Controls";
import { IconAlert, IconCheck, IconInfo, IconTrophy, IconX } from "../components/Icons";
import {
  baselineTop,
  best,
  contributions,
  cornerLabel,
  ordered,
  rankSetups,
  straightFraction,
  weightFlipPoint,
  type Finding,
} from "../engine";
import { fmt, kN, pct } from "../format";
import { richNode } from "../components/Sym";
import { useApp } from "../state";
import { TrackTwin, useRail } from "../twin";
import { FeasibleBadge, SetupName, WsHeader } from "./common";

const METHOD_TEXT: Record<string, { label: string; criterion: string }> = {
  vdpm: { label: "VDPM", criterion: "Gate, then weighted score" },
  ungated: { label: "VDPM without gate", criterion: "Weighted score only" },
  "drag-only": { label: "Drag only", criterion: "Lowest lap drag exposure" },
  "downforce-only": { label: "Downforce only", criterion: "Highest C_DF" },
  "efficiency-only": { label: "Efficiency only", criterion: "Highest C_DF / C_D" },
};

function FindingIcon({ f }: { f: Finding }) {
  const style = (bg: string, fg: string) => ({ background: bg, color: fg });
  switch (f.kind) {
    case "recommendation":
      return <span className="finding-icon" style={style("var(--good-bg)", "var(--good)")}><IconTrophy /></span>;
    case "excluded":
    case "no-eligible":
      return <span className="finding-icon" style={style("var(--bad-bg)", "var(--bad)")}><IconX /></span>;
    case "not-grip-limited":
      return <span className="finding-icon" style={style("var(--panel-2)", "var(--muted)")}><IconInfo /></span>;
    case "runner-up":
      return <span className="finding-icon" style={style("var(--panel-2)", "var(--ink-2)")}><IconInfo /></span>;
    default:
      return <span className="finding-icon" style={style("var(--warn-bg)", "var(--warn)")}><IconAlert /></span>;
  }
}

export function Decision() {
  const { state, derived, theme } = useApp();
  const { ranking, circuit, weights, colours, findings } = derived;
  const rail = useRail();

  const baselines = useMemo(() => {
    if (!ranking) return [];
    const evals = ranking.entries.map((e) => e.evaluation);
    const top = best(ranking);
    const ungated = best(rankSetups(state.vehicle, state.setups, circuit, ranking.weights, state.env, state.normalisation, "none"));
    const rows: { key: string; pick: string | null; feasible: boolean | null }[] = [
      { key: "vdpm", pick: top?.name ?? null, feasible: top ? top.evaluation.feasible : null },
      { key: "ungated", pick: ungated?.name ?? null, feasible: ungated ? ungated.evaluation.feasible : null },
    ];
    for (const m of ["drag-only", "downforce-only", "efficiency-only"]) {
      const e = baselineTop(m, evals);
      rows.push({ key: m, pick: e.setup.name, feasible: e.feasible });
    }
    return rows;
  }, [ranking, state, circuit]);

  if (!ranking) {
    return (
      <div className="workspace">
        <WsHeader title="Decision" lead="The recommended setup for the selected circuit." />
        <Callout tone="bad" icon={<IconAlert />}>
          <strong>The inputs are not valid.</strong> {derived.error}
        </Callout>
      </div>
    );
  }

  const top = best(ranking);
  const list = ordered(ranking);
  const eligible = list.filter((e) => e.eligible);
  const s = straightFraction(circuit);
  const share = weights.drag + weights.grip > 0 ? weights.drag / (weights.drag + weights.grip) : 0;
  const topCorner = top ? top.evaluation.corners[top.evaluation.bindingCorner]! : null;

  // Score composition
  const maxScore = Math.max(0.0001, ...eligible.map((e) => e.score!));
  const rows: BarRow[] = list.map((e) => {
    const c = contributions(e, weights);
    if (!c) return { id: e.name, label: e.name, swatch: colours[e.name], segments: [], valueLabel: "excluded", muted: true };
    const segs = [
      { from: 0, to: c.drag, colour: theme.components.drag, label: `Drag ${fmt(c.drag, 4)}` },
      { from: c.drag, to: c.drag + c.grip, colour: theme.components.grip, label: `Grip ${fmt(c.grip, 4)}` },
      { from: c.drag + c.grip, to: c.drag + c.grip + c.margin, colour: theme.components.margin, label: `Margin ${fmt(c.margin, 4)}` },
    ];
    return { id: e.name, label: e.name, swatch: colours[e.name], segments: segs, valueLabel: fmt(e.score, 4) };
  });

  // Score against the drag share of weight
  const rest = 1 - weights.margin;
  const xs = linspace(0, 1, 101);
  const series: Series[] = eligible.map((e) => ({
    id: e.name,
    label: e.name,
    colour: colours[e.name] ?? theme.ink,
    points: xs.map((x) => [x, rest * (x * e.dragPenalty! + (1 - x) * e.gripPenalty!) + weights.margin * e.marginPenalty!] as [number, number]),
  }));
  const markers: Marker[] = [];
  if (top) {
    for (const r of eligible.slice(1)) {
      const flip = weightFlipPoint(top, r, weights.margin);
      if (flip !== null)
        markers.push({ x: flip, y: rest * (flip * top.dragPenalty! + (1 - flip) * top.gripPenalty!) + weights.margin * top.marginPenalty!, colour: theme.ink, shape: "diamond", label: `s* = ${fmt(flip, 3)}` });
    }
  }
  const allY = series.flatMap((x) => x.points.map((p) => p[1]));
  const yMax = Math.max(0.02, ...allY) * 1.12;

  const weightsNote =
    state.weightsMode === "circuit"
      ? `From the straight fraction s = ${fmt(s, 2)}: w_D = ${fmt(1 - weights.margin, 2)}·s, w_G = ${fmt(1 - weights.margin, 2)}·(1 − s).`
      : "Set manually in the sidebar.";

  return (
    <div className="workspace">
      <WsHeader
        title="Decision"
        lead={
          <>
            Which aerodynamic setup suits <strong>{circuit.name}</strong>? Setups that fail any corner are excluded first; the rest are
            ranked by a circuit-weighted score of drag, grip and safety margin. Lower scores are better.
          </>
        }
      />

      {richNode(
      <section className="card hero" aria-label="Recommendation">
        <div className="hero-main">
          <div className="hero-kicker">{top ? "Recommended setup" : "No recommendation"}</div>
          {top ? (
            <>
              <div className="hero-setup">
                <span className="swatch" style={{ background: colours[top.name] }} />
                <h2>{top.name}</h2>
              </div>
              <p className="hero-desc">
                {top.evaluation.setup.description ? `${top.evaluation.setup.description}. ` : ""}
                Passes all {top.evaluation.corners.length} corners of {circuit.name}
                {eligible.length > 1 ? ` and ranks first of ${eligible.length} eligible setups.` : ", the only eligible setup."}
              </p>
              <div className="hero-score">
                <div className="metric">
                  <span className="stat-label">VDPM score</span>
                  <span className="stat-value">{fmt(top.score, 4)}</span>
                </div>
                <div className="metric">
                  <span className="stat-label">C_D / C_DF</span>
                  <span className="stat-value">
                    {fmt(top.evaluation.setup.dragCoefficient, 2)} / {fmt(top.evaluation.setup.downforceCoefficient, 2)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="hero-setup">
                <span className="swatch" style={{ background: theme.infeasible }} />
                <h2>None eligible</h2>
              </div>
              <p className="hero-desc">Every setup fails at least one corner at these inputs, so VDPM makes no recommendation.</p>
            </>
          )}
        </div>
        <div className="hero-stats">
          <div className="stat">
            <span className="stat-label">Circuit</span>
            <span className="stat-value" style={{ fontFamily: "var(--font-ui)", fontSize: 18 }}>{circuit.name}</span>
            <span className="stat-note">
              {circuit.segments.filter((x) => x.kind === "corner").length} corners · {fmt(s * 100, 0)} % straights
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Weights w_D · w_G · w_M</span>
            <span className="stat-value" style={{ whiteSpace: "nowrap" }}>
              {fmt(weights.drag, 2)} · {fmt(weights.grip, 2)} · {fmt(weights.margin, 2)}
            </span>
            <span className="stat-note">{state.weightsMode === "circuit" ? "From the straight fraction" : "Manual"}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Binding corner</span>
            <span className="stat-value">{top && topCorner ? cornerLabel(top.evaluation, top.evaluation.bindingCorner) : "–"}</span>
            <span className="stat-note">{topCorner ? `r = ${fmt(topCorner.radius, 0)} m · v = ${fmt(topCorner.speed, 1)} m/s` : "No eligible setup"}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Minimum safety margin</span>
            <span className="stat-value" style={{ color: topCorner ? (topCorner.margin < 0.1 ? "var(--warn)" : "var(--good)") : undefined }}>
              {topCorner ? pct(topCorner.margin) : "–"}
            </span>
            <span className="stat-note">{topCorner ? `${kN(topCorner.reserveForce)} of grip in reserve` : "–"}</span>
          </div>
        </div>
      </section>
      )}

      {!rail && <TrackTwin variant="inline" />}

      <Card title="Ranking" subtitle={`Ratio-to-best penalties${ranking.normalisation === "minmax" ? " (min–max normalised)" : ""}; ${ranking.gate === "strict" ? "strict feasibility gate" : "gate switched off"}.`}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Setup</th>
                <th>Gate</th>
                <th className="num" title="Length-weighted lap drag">Drag D</th>
                <th className="num" title="Length-weighted corner grip">Grip G</th>
                <th className="num" title="Minimum grip / demand ratio over corners">Min margin</th>
                <th className="num">d</th>
                <th className="num">q</th>
                <th className="num">z</th>
                <th className="num">Score</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.name}>
                  <td className="num">{e.rank ?? "–"}</td>
                  <td><SetupName name={e.name} colour={colours[e.name]} bold={e === top} /></td>
                  <td>
                    {e.evaluation.feasible ? (
                      <Badge tone="good">passes</Badge>
                    ) : (
                      <Badge tone="bad">fails {e.evaluation.failedCorners.length}</Badge>
                    )}
                  </td>
                  <td className="num">{fmt(e.evaluation.dragExposure, 1)} N</td>
                  <td className="num">{kN(e.evaluation.gripCapacity)}</td>
                  <td className="num">{pct(e.evaluation.minMargin)}</td>
                  <td className="num">{e.dragPenalty === null ? "–" : fmt(e.dragPenalty, 3)}</td>
                  <td className="num">{e.gripPenalty === null ? "–" : fmt(e.gripPenalty, 3)}</td>
                  <td className="num">{e.marginPenalty === null ? "–" : fmt(e.marginPenalty, 3)}</td>
                  <td className="num" style={{ fontWeight: e === top ? 700 : undefined }}>{e.score === null ? "excluded" : fmt(e.score, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>


      <div className="grid grid-2">
        <ChartCard
          title="Score composition"
          subtitle="Each bar is w_D·d + w_G·q + w_M·z. Shorter is better."
          theme={theme}
          footer={<Legend items={[{ label: "Drag", colour: theme.components.drag, kind: "box" }, { label: "Grip", colour: theme.components.grip, kind: "box" }, { label: "Margin", colour: theme.components.margin, kind: "box" }]} />}
        >
          {(ref) => <HBarChart svgRef={ref} theme={theme} rows={rows} rowHeight={Math.max(34, 150 / rows.length)} domain={[0, maxScore * 1.08]} xLabel="VDPM score (lower is better)" xFormat={(v) => fmt(v, 2)} ariaLabel="Stacked score composition per setup" />}
        </ChartCard>

        <ChartCard
          title="Weight trade-off"
          subtitle={<>Score as the weight shifts between drag and grip, with w_M = {fmt(weights.margin, 2)} fixed. {weightsNote}</>}
          theme={theme}
          footer={
            eligible.length < 2 ? (
              "At least two eligible setups are needed for a trade-off."
            ) : (
              <Legend items={[...series.map((x) => ({ label: x.label, colour: x.colour })), { label: "Current weighting", colour: theme.muted, kind: "dashed" as const }]} />
            )
          }
        >
          {(ref) => (
            <XYChart
              svgRef={ref}
              theme={theme}
              height={250}
              xDomain={[0, 1]}
              yDomain={[0, yMax]}
              xLabel="Drag share of weight, w_D / (w_D + w_G)"
              yLabel="VDPM score"
              xFormat={(v) => fmt(v, 1)}
              yFormat={(v) => fmt(v, 2)}
              tooltipX={(v) => `share ${fmt(v, 2)}`}
              tooltipY={(v) => fmt(v, 4)}
              series={series}
              refLines={[{ axis: "x", value: share, colour: theme.muted, dashed: true, label: "now" }]}
              markers={markers}
              ariaLabel="VDPM score of each eligible setup against the drag share of weight"
            />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-2">
        <Card title="Why" subtitle="Every statement follows in closed form from the model equations.">
          <ul className="findings">
            {findings
              .filter((f) => f.kind !== "not-grip-limited")
              .map((f, i) => (
                <li className="finding" key={i}>
                  <FindingIcon f={f} />
                  <span>{f.text.replace(/>=/g, "≥").replace(/<=/g, "≤")}</span>
                </li>
              ))}
          </ul>
        </Card>
        <Card title="Against simpler rules" subtitle="What single-criterion rankings would choose here, and whether that choice survives every corner.">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Recommends</th>
                  <th>Every corner</th>
                  <th>Same as VDPM</th>
                </tr>
              </thead>
              <tbody>
                {baselines.map((b) => (
                  <tr key={b.key}>
                    <td>
                      <div style={{ fontWeight: b.key === "vdpm" ? 650 : 520 }}>{METHOD_TEXT[b.key]!.label}</div>
                      <div className="faint" style={{ fontSize: 12 }}>{METHOD_TEXT[b.key]!.criterion}</div>
                    </td>
                    <td>{b.pick ? <SetupName name={b.pick} colour={colours[b.pick]} /> : <span className="muted">none</span>}</td>
                    <td>{b.feasible === null ? <span className="muted">–</span> : <FeasibleBadge ok={b.feasible} yes="yes" no="no" />}</td>
                    <td>
                      {b.key === "vdpm" ? (
                        <span className="muted">–</span>
                      ) : b.pick === (top?.name ?? null) ? (
                        <span style={{ color: "var(--good)", display: "inline-flex" }} aria-label="yes"><IconCheck width={16} height={16} /></span>
                      ) : (
                        <span className="muted">differs</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
