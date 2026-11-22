/** Circuit workspace: layout, lap profile and corner-by-corner feasibility. */
import { useRef, useState } from "react";
import { Callout, Card } from "../components/Card";
import { ChartCard, slug, XYChart, type Band, type Series } from "../components/Charts";
import { Legend, Segmented } from "../components/Controls";
import { IconAlert, IconDownload, IconInfo, IconReset, IconUpload } from "../components/Icons";
import { LapRing, marginColour, MARGIN_BANDS } from "../components/LapRing";
import { circuitFromCsv, circuitLength, circuitToCsv, meanCornerRadius, straightFraction } from "../engine";
import { fmt, pct } from "../format";
import { useApp } from "../state";
import { downloadText, MarginBadge, SetupName, WsHeader } from "./common";

export function CircuitView() {
  const { state, dispatch, derived, theme } = useApp();
  const { circuit, ranking, colours } = derived;
  const [mapSetup, setMapSetup] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const entries = ranking?.entries ?? [];
  const selected = entries[Math.min(mapSetup, entries.length - 1)];
  const ev = selected?.evaluation ?? null;
  const corners = circuit.segments.filter((s) => s.kind === "corner");
  const isCustom = state.circuitSource.kind === "custom";

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const c = circuitFromCsv(await file.text(), file.name.replace(/\.csv$/i, ""), `Imported from ${file.name}`);
      dispatch({ type: "circuit", source: { kind: "custom", circuit: c } });
      setImportError(null);
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  // Lap profile
  const starts: number[] = [];
  let acc = 0;
  for (const seg of circuit.segments) {
    starts.push(acc);
    acc += seg.length;
  }
  const total = acc;
  const refPts: [number, number][] = circuit.segments.flatMap((seg, i) => [
    [starts[i]!, seg.speed * 3.6],
    [starts[i]! + seg.length, seg.speed * 3.6],
  ]);
  const maxRef = Math.max(...circuit.segments.map((x) => x.speed * 3.6));
  const yTop = maxRef * 1.35;
  const series: Series[] = [{ id: "ref", label: "Reference speed", colour: theme.ink, points: refPts, width: 1.8 }];
  entries.forEach((e) => {
    const pts: [number, number][] = [];
    let ci = 0;
    circuit.segments.forEach((seg, i) => {
      if (seg.kind !== "corner") return;
      const vmax = e.evaluation.corners[ci++]!.maxCorneringSpeed * 3.6;
      const v = Number.isFinite(vmax) ? Math.min(vmax, yTop * 1.5) : NaN;
      pts.push([starts[i]!, v], [starts[i]! + seg.length, v], [starts[i]! + seg.length, NaN]);
    });
    series.push({ id: e.name, label: `${e.name} grip limit`, colour: colours[e.name] ?? theme.muted, points: pts, width: 2.4 });
  });
  const bands: Band[] = [];
  let ci = 0;
  circuit.segments.forEach((seg, i) => {
    if (seg.kind !== "corner") return;
    const failed = ev ? !ev.corners[ci]!.feasible : false;
    bands.push({ axis: "x", from: starts[i]!, to: starts[i]! + seg.length, fill: failed ? theme.bandInfeasible : theme.bandCorner });
    ci++;
  });

  const meta = circuit.metadata ?? {};

  return (
    <div className="workspace">
      <WsHeader
        title="Circuit"
        lead="Where on the lap each setup has grip to spare, and where it runs out. Corner speeds follow the corner demand a_ref set in the sidebar."
        actions={
          <>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <button className="btn" onClick={() => fileRef.current?.click()}><IconUpload /> Import circuit CSV</button>
            <button className="btn" onClick={() => downloadText(circuitToCsv(circuit), `${slug(circuit.name)}.csv`, "text/csv")}><IconDownload /> Download CSV</button>
            {isCustom && (
              <button className="btn" onClick={() => dispatch({ type: "circuit", source: { kind: "reference", key: "C" } })}><IconReset /> Back to reference circuits</button>
            )}
          </>
        }
      />

      {importError && (
        <Callout tone="bad" icon={<IconAlert />}>
          <strong>Could not import the circuit.</strong> {importError} The expected columns are <code className="mono">name,kind,length_m,radius_m,speed_mps,grade</code>.
        </Callout>
      )}

      <div className="grid grid-main-side">
        <ChartCard
          title="Lap ring"
          subtitle="Each arc is proportional to its segment's length, from the start at the top, clockwise. Bars show each corner's safety margin; a failing corner points inward."
          theme={theme}
          extraActions={
            entries.length > 1 ? (
              <Segmented label="Setup shown on the map" value={String(mapSetup)} onChange={(v) => setMapSetup(Number(v))} options={entries.map((e, i) => ({ value: String(i), label: e.name }))} />
            ) : undefined
          }
          footer={
            <Legend
              items={[
                { label: "Fails (M < 0)", colour: theme.infeasible },
                { label: `Tight (M < ${fmt(MARGIN_BANDS.tight * 100, 0)} %)`, colour: theme.warning },
                { label: "Comfortable", colour: theme.feasible },
                { label: "Straight", colour: theme.axis },
                { label: "Tightest corner (circled)", colour: theme.ink, kind: "dashed" },
              ]}
            />
          }
        >
          {(ref) => <LapRing svgRef={ref} circuit={circuit} evaluation={ev} theme={theme} highlight={hover} onHover={setHover} height={400} />}
        </ChartCard>

        <Card title="Circuit summary" subtitle={circuit.description ?? (isCustom ? "Imported circuit" : undefined)}>
          <dl className="kv">
            <dt>Lap length</dt><dd>{fmt(circuitLength(circuit), 0)} m</dd>
            <dt>Corners</dt><dd>{corners.length}</dd>
            <dt>Straight fraction s</dt><dd>{pct(straightFraction(circuit))}</dd>
            <dt>Mean corner radius</dt><dd>{fmt(meanCornerRadius(circuit), 0)} m</dd>
            <dt>Corner radii</dt><dd>{fmt(Math.min(...corners.map((c) => c.radius!)), 0)} to {fmt(Math.max(...corners.map((c) => c.radius!)), 0)} m</dd>
            {typeof meta.lapTimeS === "number" && (<><dt>Reference lap time</dt><dd>{fmt(meta.lapTimeS, 1)} s</dd></>)}
            {typeof meta.elevationChangeM === "number" && (<><dt>Elevation change</dt><dd>{fmt(meta.elevationChangeM, 0)} m</dd></>)}
            {typeof meta.lateralAcceleration === "number" && (<><dt>Corner demand a_ref</dt><dd>{fmt(meta.lateralAcceleration, 2)} m/s²</dd></>)}
          </dl>
          <div style={{ marginTop: 14 }}>
            <Callout icon={<IconInfo />}>
              {circuit.provenance || "No provenance recorded."}
              {typeof meta.elevationChangeM === "number" && " Elevation is listed for reference; the model treats every corner as flat."}
            </Callout>
          </div>
        </Card>
      </div>

      <ChartCard
        title="Lap profile"
        subtitle="Reference speed along the lap against each setup's grip-limited cornering speed. Where the reference line sits above a setup's limit, that setup cannot hold the corner."
        theme={theme}
        footer={
          <Legend
            items={[
              ...series.map((x) => ({ label: x.label, colour: x.colour })),
              { label: "Corner", colour: theme.axis, kind: "box" as const },
              ...(ev && !ev.feasible ? [{ label: `Corner failed by ${selected?.name}`, colour: theme.infeasible, kind: "box" as const }] : []),
            ]}
          />
        }
      >
        {(ref) => (
          <XYChart
            svgRef={ref}
            theme={theme}
            height={260}
            xDomain={[0, total]}
            yDomain={[0, yTop]}
            xLabel="Distance along the lap (m)"
            yLabel="Speed (km/h)"
            xFormat={(v) => fmt(v, 0)}
            yFormat={(v) => fmt(v, 0)}
            tooltipX={(v) => `${fmt(v, 0)} m`}
            tooltipY={(v) => `${fmt(v, 0)} km/h`}
            series={series}
            bands={bands}
            ariaLabel="Reference speed and grip-limited cornering speed along the lap"
          />
        )}
      </ChartCard>

      <Card title="Corners" subtitle="Margin M = (F_grip − F_c) / F_c at each corner's reference speed, and the fastest speed each setup can hold there.">
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th>Corner</th>
                <th className="num">Radius</th>
                <th className="num">Length</th>
                <th className="num">Speed</th>
                <th className="num">Demand v²/r</th>
                {entries.map((e) => (
                  <th key={e.name} colSpan={2}>
                    <SetupName name={e.name} colour={colours[e.name]} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corners.map((c, i) => (
                <tr key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ outline: hover === i ? `1px solid var(--line-strong)` : undefined }}>
                  <td style={{ fontWeight: ev?.bindingCorner === i ? 700 : undefined }}>{c.name || `T${i + 1}`}</td>
                  <td className="num">{fmt(c.radius, 0)} m</td>
                  <td className="num">{fmt(c.length, 0)} m</td>
                  <td className="num">{fmt(c.speed * 3.6, 0)} km/h</td>
                  <td className="num">{fmt((c.speed * c.speed) / c.radius! / 9.81, 2)} g</td>
                  {entries.map((e) => {
                    const r = e.evaluation.corners[i]!;
                    return [
                      <td key={`${e.name}-m`}><MarginBadge margin={r.margin} /></td>,
                      <td key={`${e.name}-v`} className="num" style={{ color: marginColour(theme, r.margin) === theme.infeasible ? "var(--bad)" : undefined }} title="Grip-limited cornering speed">
                        {Number.isFinite(r.maxCorneringSpeed) ? `${fmt(r.maxCorneringSpeed * 3.6, 0)} km/h` : "no limit"}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
