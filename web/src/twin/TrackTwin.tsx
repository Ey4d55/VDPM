/**
 * Track twin: a 3D view of the circuit with the car driving the selected
 * setup. The ring under the car is the grip available at that speed,
 * mu (m g + F_DF); the arrow is the lateral force the corner demands, m v^2 / r.
 * A corner is feasible when the arrow stays inside the ring, which is exactly
 * the feasibility test of Eq. 4.5. The columns at each corner show the same
 * comparison for the whole lap at once.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../components/Controls";
import { rich } from "../components/Sym";
import { best, cornerLabel } from "../engine";
import { fmt, kmh, kN } from "../format";
import { useApp } from "../state";
import { buildLayout } from "./layout";
import { TwinScene, type CameraMode, type TwinHud } from "./scene";

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const marginText = (m: number): string => `${m >= 0 ? "+" : "−"}${fmt(Math.abs(m) * 100, 1)} %`;

export default function TrackTwin({ variant }: { variant: "rail" | "inline" }) {
  const { state, derived, theme } = useApp();
  const ranking = derived.ranking;
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TwinScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [mode, setMode] = useState<CameraMode>("orbit");
  const [hud, setHud] = useState<TwinHud | null>(null);
  const recommended = ranking ? best(ranking)?.name : undefined;
  const [chosen, setChosen] = useState<string | null>(null);
  const names = state.setups.map((s) => s.name);
  const driving = chosen && names.includes(chosen) ? chosen : (recommended ?? names[0]!);
  const drivingIndex = Math.max(0, names.indexOf(driving));

  const layout = useMemo(() => buildLayout(derived.circuit), [derived.circuit]);

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const sc = new TwinScene(hostRef.current);
      sc.onHud = setHud;
      sceneRef.current = sc;
    } catch (e) {
      setFailed((e as Error).message || "WebGL is not available in this browser.");
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || !ranking) return;
    const setups = state.setups.map((s) => {
      const entry = ranking.entries.find((e) => e.name === s.name)!;
      return {
        name: s.name,
        colour: derived.colours[s.name] ?? "#4d8dff",
        dragCoefficient: s.dragCoefficient,
        downforceCoefficient: s.downforceCoefficient,
        evaluation: entry.evaluation,
      };
    });
    sc.setData({ layout, setups, driving: drivingIndex, vehicle: state.vehicle, env: state.env, theme });
  }, [layout, ranking, state.setups, state.vehicle, state.env, derived.colours, drivingIndex, theme]);

  useEffect(() => sceneRef.current?.setPlaying(playing), [playing]);
  useEffect(() => sceneRef.current?.setCamera(mode), [mode]);

  const entry = ranking?.entries.find((e) => e.name === driving);
  const ev = entry?.evaluation;
  const gate = ev
    ? ev.feasible
      ? { ok: true, text: `Passes all ${ev.corners.length} corners` }
      : { ok: false, text: `Fails ${ev.failedCorners.map((i) => cornerLabel(ev, i)).join(", ")}` }
    : null;
  const used = hud && hud.kind === "corner" && hud.available > 0 ? hud.required / hud.available : null;
  const tone = (m: number | null): string =>
    m === null ? theme.faint : m < 0 ? theme.infeasible : m < 0.1 ? theme.warning : theme.feasible;

  return (
    <section className={`card twin twin--${variant}`} aria-label="Track twin">
      <header className="twin-head">
        <div className="twin-titles">
          <h3 className="card-title">Track twin</h3>
          <p className="card-sub">
            {derived.circuit.name} · {driving}
            {entry?.rank ? ` · rank ${entry.rank}` : entry && !entry.eligible ? " · excluded by the gate" : ""}
          </p>
        </div>
        <div className="twin-actions">
          {names.length > 1 && (
            <Segmented
              label="Setup driving the lap"
              value={driving}
              onChange={setChosen}
              options={names.map((n) => ({
                value: n,
                title: `Drive ${n}`,
                label: (
                  <span className="twin-setup-opt">
                    <span className="swatch" style={{ background: derived.colours[n] }} />
                    {n.replace(/^Setup /, "")}
                  </span>
                ),
              }))}
            />
          )}
          <Segmented
            label="Camera"
            value={mode}
            onChange={setMode}
            options={[
              { value: "orbit", label: "Orbit", title: "Orbit the circuit (drag to rotate, scroll to zoom)" },
              { value: "chase", label: "Chase", title: "Follow the car" },
              { value: "top", label: "Plan", title: "Plan view from above" },
            ]}
          />
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause the car" : "Play the car"}
            title={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <rect x="3.5" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
                <rect x="9.5" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M4.5 3.2v9.6c0 .5.5.8.9.5l7.4-4.8a.6.6 0 0 0 0-1L5.4 2.7c-.4-.3-.9 0-.9.5z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="twin-stage" ref={hostRef}>
        {failed && <div className="twin-fallback">The 3D view needs WebGL, which this browser did not provide. {failed}</div>}
        {!ranking && !failed && <div className="twin-fallback">Check the inputs to see the track twin.</div>}

        {hud && ranking && (
          <div className="twin-hud" aria-live="off">
            <div className="twin-hud-seg">
              <b>{hud.segment}</b>
              <span>{hud.kind === "corner" ? `r = ${fmt(hud.radius, 0)} m` : "straight"}</span>
            </div>
            <div className="twin-hud-speed">{kmh(hud.speed)}</div>
          </div>
        )}

        {gate && (
          <div className={`twin-gate ${gate.ok ? "ok" : "bad"}`}>
            <span className="dot" />
            {gate.text}
          </div>
        )}

        {ranking && !failed && (
          <div className="twin-legend">
            <span>
              <i className="lg-glass" style={{ borderColor: derived.colours[driving], background: `${derived.colours[driving]}44` }} />
              Grip available
            </span>
            <span>
              <i className="lg-core" />
              Grip demanded
            </span>
            <span>
              <i className="lg-ring" style={{ borderColor: derived.colours[driving] }} />
              Grip at the car
            </span>
            {names.length > 1 && (
              <span>
                <i className="lg-thin" style={{ borderColor: derived.colours[names[drivingIndex === 0 ? 1 : 0]!] }} />
                Other setups
              </span>
            )}
          </div>
        )}
      </div>
      {hud && ranking && (
        <div className="twin-telemetry" aria-live="off">
          <div className="twin-tm-used">
            <div className="twin-hud-row">
              <span>Grip used at {hud.segment}</span>
              <b style={{ color: tone(hud.margin) }}>{used === null ? "no lateral demand" : `${fmt(used * 100, 0)} %`}</b>
            </div>
            <div className="twin-bar" aria-hidden="true">
              <div className="twin-bar-fill" style={{ width: `${Math.min(100, ((used ?? 0) * 100) / 1.5)}%`, background: tone(hud.margin) }} />
              <div className="twin-bar-limit" style={{ left: `${100 / 1.5}%` }} />
              <span className="twin-bar-tick" style={{ left: `${100 / 1.5}%` }}>limit</span>
            </div>
          </div>
          <dl className="twin-tm-list">
            <div>
              <dt>{rich("Demand F_c")}</dt>
              <dd>{hud.kind === "corner" ? kN(hud.required, 1) : "–"}</dd>
            </div>
            <div>
              <dt>{rich("Grip F_grip")}</dt>
              <dd>{kN(hud.available, 1)}</dd>
            </div>
            <div>
              <dt>Margin M</dt>
              <dd style={{ color: hud.margin === null ? undefined : tone(hud.margin) }}>{hud.margin === null ? "–" : marginText(hud.margin)}</dd>
            </div>
            <div>
              <dt>{rich("Downforce F_DF")}</dt>
              <dd>{kN(hud.downforce, 1)}</dd>
            </div>
            <div>
              <dt>{rich("Drag F_D")}</dt>
              <dd>{kN(hud.drag, 2)}</dd>
            </div>
          </dl>
        </div>
      )}

      {ranking && ev && (
        <div
          className="twin-strip"
          role="slider"
          tabIndex={0}
          aria-label="Position on the lap"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((hud?.lapFraction ?? 0) * 100)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            sceneRef.current?.seek((e.clientX - r.left) / r.width);
          }}
          onKeyDown={(e) => {
            const f = hud?.lapFraction ?? 0;
            if (e.key === "ArrowRight") sceneRef.current?.seek(f + 0.02);
            if (e.key === "ArrowLeft") sceneRef.current?.seek(f - 0.02 + 1);
          }}
        >
          {layout.segments.map((s) => {
            const m = s.cornerIndex !== null ? ev.corners[s.cornerIndex]!.margin : null;
            return (
              <span
                key={s.index}
                className={`twin-strip-seg ${s.kind}`}
                style={{
                  flexGrow: s.length,
                  background: m === null ? undefined : m < 0 ? theme.infeasible : m < 0.1 ? theme.warning : theme.feasible,
                }}
                title={m === null ? `${s.name || "Straight"} · ${fmt(s.length, 0)} m` : `${s.name} · r = ${fmt(s.radius, 0)} m · margin ${marginText(m)}`}
              />
            );
          })}
          <span className="twin-strip-marker" style={{ left: `calc(18px + ${hud?.lapFraction ?? 0} * (100% - 36px))` }} />
        </div>
      )}

      <footer className="twin-foot">
        {rich(
          "The ring under the car is the grip available at that speed, μ(mg + F_DF), and grows with downforce. The arrow is the lateral force the corner demands, mv²/r. A corner is feasible when the arrow stays inside the ring. The columns show the same at every corner; labels give the safety margin M.",
        )}{" "}
        <span className="twin-note">
          Schematic layout: corner order, lengths and radii from the circuit data, with turning angles scaled to close the lap. Forces are the
          model's values at each segment's reference speed.
        </span>
      </footer>
    </section>
  );
}
