import { useEffect, useMemo, useReducer, useRef, useState, type ComponentType, type SVGProps } from "react";
import { Callout } from "./components/Card";
import { NumberField, Segmented } from "./components/Controls";
import {
  BrandMark,
  IconAlert,
  IconCircuit,
  IconDecision,
  IconDownload,
  IconMethod,
  IconMoon,
  IconPlus,
  IconReset,
  IconResearch,
  IconSafety,
  IconSetups,
  IconSun,
  IconUpload,
  IconWhatIf,
  IconX,
} from "./components/Icons";
import { REFERENCE_SUMMARIES, type CircuitWeights } from "./engine";
import { fmt } from "./format";
import {
  APP_VERSION,
  AppContext,
  loadState,
  makeBundle,
  parseBundle,
  reducer,
  saveState,
  themeFor,
  useApp,
  useDerived,
  type CircuitKey,
} from "./state";
import type { ThemeName } from "./theme";
import { CircuitView } from "./workspaces/CircuitView";
import { downloadText } from "./workspaces/common";
import { Decision } from "./workspaces/Decision";
import { Method } from "./workspaces/Method";
import { Research } from "./workspaces/Research";
import { Safety } from "./workspaces/Safety";
import { Setups } from "./workspaces/Setups";
import { WhatIf } from "./workspaces/WhatIf";

const TABS: { id: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; view: ComponentType }[] = [
  { id: "decision", label: "Decision", icon: IconDecision, view: Decision },
  { id: "circuit", label: "Circuit", icon: IconCircuit, view: CircuitView },
  { id: "safety", label: "Safety", icon: IconSafety, view: Safety },
  { id: "setups", label: "Setups", icon: IconSetups, view: Setups },
  { id: "what-if", label: "What-if", icon: IconWhatIf, view: WhatIf },
  { id: "research", label: "Research", icon: IconResearch, view: Research },
  { id: "method", label: "Method", icon: IconMethod, view: Method },
];

const THEME_KEY = "vdpm-racetwin/theme";

function initialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const tabFromHash = (): string => {
  const h = window.location.hash.replace(/^#\/?/, "");
  return TABS.some((t) => t.id === h) ? h : "decision";
};

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme);
  const [tab, setTab] = useState(tabFromHash);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const derived = useDerived(state, themeName);
  const theme = themeFor(themeName);

  useEffect(() => saveState(state), [state]);
  useEffect(() => {
    document.documentElement.dataset.theme = themeName;
    try {
      localStorage.setItem(THEME_KEY, themeName);
    } catch {
      /* ignore */
    }
  }, [themeName]);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const ctx = useMemo(() => ({ state, dispatch, derived, theme }), [state, derived, theme]);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const View = active.view;

  const exportScenario = () => {
    const bundle = makeBundle(state, derived);
    const stamp = bundle.created.slice(0, 19).replace(/[:T]/g, "-");
    downloadText(JSON.stringify(bundle, null, 2) + "\n", `vdpm-scenario-${stamp}.json`, "application/json");
  };
  const importScenario = async (file: File | undefined) => {
    if (!file) return;
    try {
      dispatch({ type: "replace", state: parseBundle(await file.text()) });
      setImportError(null);
    } catch (e) {
      setImportError(`${file.name}: ${(e as Error).message}`);
    }
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <BrandMark />
            <div style={{ minWidth: 0 }}>
              <div className="brand-name">
                VDPM<span>–</span>RaceTwin
              </div>
              <div className="brand-sub">Physics-constrained screening of aerodynamic setups</div>
            </div>
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { void importScenario(e.target.files?.[0]); e.target.value = ""; }} />
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} title="Load a scenario file">
              <IconUpload /> <span className="hide-sm">Open scenario</span>
            </button>
            <button className="btn btn-ghost" onClick={exportScenario} title="Save inputs and results as a scenario file">
              <IconDownload /> <span className="hide-sm">Save scenario</span>
            </button>
            <button className="btn btn-ghost" onClick={() => dispatch({ type: "reset" })} title="Restore the inputs of Table 1">
              <IconReset /> <span className="hide-sm">Paper values</span>
            </button>
            <button
              className="btn btn-icon"
              onClick={() => setThemeName(themeName === "dark" ? "light" : "dark")}
              aria-label={themeName === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={themeName === "dark" ? "Light theme" : "Dark theme"}
            >
              {themeName === "dark" ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </header>

        <div className="body">
          <Sidebar />
          <main className="main">
            <nav className="tabs" role="tablist" aria-label="Workspaces">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  className="tab"
                  aria-selected={t.id === active.id}
                  onClick={() => {
                    window.location.hash = t.id;
                    setTab(t.id);
                  }}
                >
                  <t.icon />
                  {t.label}
                </button>
              ))}
            </nav>
            {importError && (
              <div style={{ padding: "16px 24px 0" }}>
                <Callout tone="bad" icon={<IconAlert />}>
                  <strong>Could not open the scenario.</strong> {importError}
                </Callout>
              </div>
            )}
            {derived.error && active.id !== "method" && active.id !== "decision" && (
              <div style={{ padding: "16px 24px 0" }}>
                <Callout tone="bad" icon={<IconAlert />}>
                  <strong>Check the inputs.</strong> {derived.error}
                </Callout>
              </div>
            )}
            <View key={active.id} />
            <footer className="footer-note">
              VDPM-RaceTwin {APP_VERSION}. Equations from Section 4 of the VDPM manuscript; default inputs from its Table 1. Results are computed in your browser; nothing is uploaded.
            </footer>
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}

// --------------------------------------------------------------------------- //
// Sidebar: every model input
// --------------------------------------------------------------------------- //

/** Change one weight and rescale the other two so that all three still sum to 1. */
function rebalance(w: CircuitWeights, key: keyof CircuitWeights, value: number): CircuitWeights {
  const v = Math.min(1, Math.max(0, value));
  const others = (["drag", "grip", "margin"] as const).filter((k) => k !== key);
  const rest = others.reduce((a, k) => a + w[k], 0);
  const out = { ...w, [key]: v };
  for (const k of others) out[k] = rest > 0 ? (w[k] / rest) * (1 - v) : (1 - v) / 2;
  // Remove rounding residue so validation sees an exact sum.
  out[others[1]!] = 1 - v - out[others[0]!];
  return out;
}

function Sidebar() {
  const { state, dispatch, derived } = useApp();
  const src = state.circuitSource;
  const custom = src.kind === "custom";

  return (
    <aside className="sidebar" aria-label="Model inputs">
      <section className="side-section">
        <div className="side-head">
          <h2 className="side-title">Circuit</h2>
          {custom && <span className="badge badge-neutral">Imported</span>}
        </div>
        <Segmented<CircuitKey | "custom">
          full
          label="Reference circuit"
          value={custom ? "custom" : src.key}
          onChange={(v) => v !== "custom" && dispatch({ type: "circuit", source: { kind: "reference", key: v } })}
          options={(["A", "B", "C"] as const).map((k) => ({
            value: k,
            label: (
              <span className="seg-2l">
                <b>{k}</b>
                <small>{REFERENCE_SUMMARIES[k].character}</small>
              </span>
            ),
            title: `${REFERENCE_SUMMARIES[k].name}: ${fmt(REFERENCE_SUMMARIES[k].lengthM, 0)} m, ${REFERENCE_SUMMARIES[k].turns} turns, ${fmt(REFERENCE_SUMMARIES[k].straightFraction * 100, 0)} % straights`,
          }))}
        />
        {custom && <p className="field-hint" style={{ margin: "8px 0 0" }}>{src.circuit.name}. Pick A, B or C to return to a reference circuit.</p>}
        <div style={{ marginTop: 14 }}>
          {custom ? (
            <p className="field-hint" style={{ margin: 0 }}>Corner speeds come from the imported file, so the corner demand setting does not apply.</p>
          ) : (
            <NumberField
              label="Corner demand"
              symbol="a_ref"
              unit="m/s²"
              value={state.lateralAcceleration}
              onChange={(v) => dispatch({ type: "lateralAcceleration", value: v })}
              min={0.1}
              slider={{ min: 5, max: 35, step: 0.25 }}
              hint={`Corner speed v = √(a_ref · r). Case study: 30²/60 = 15 m/s² (${fmt(state.lateralAcceleration / 9.81, 2)} g now).`}
            />
          )}
        </div>
      </section>

      <section className="side-section">
        <div className="side-head"><h2 className="side-title">Vehicle</h2></div>
        <NumberField label="Mass" symbol="m" unit="kg" value={state.vehicle.mass} min={1} onChange={(v) => dispatch({ type: "vehicle", patch: { mass: v } })} slider={{ min: 600, max: 1100, step: 1 }} />
        <NumberField label="Reference area" symbol="A" unit="m²" value={state.vehicle.referenceArea} min={0.01} onChange={(v) => dispatch({ type: "vehicle", patch: { referenceArea: v } })} slider={{ min: 0.8, max: 2.5, step: 0.01 }} />
        <NumberField label="Tyre friction" symbol="μ" unit="" value={state.vehicle.friction} min={0.01} onChange={(v) => dispatch({ type: "vehicle", patch: { friction: v } })} slider={{ min: 0.8, max: 2.2, step: 0.01 }} />
      </section>

      <section className="side-section">
        <div className="side-head"><h2 className="side-title">Environment</h2></div>
        <NumberField label="Air density" symbol="ρ" unit="kg/m³" value={state.env.airDensity} min={0.01} onChange={(v) => dispatch({ type: "env", patch: { airDensity: v } })} slider={{ min: 0.9, max: 1.35, step: 0.005 }} />
        <NumberField label="Gravity" symbol="g" unit="m/s²" value={state.env.gravity} min={0.01} onChange={(v) => dispatch({ type: "env", patch: { gravity: v } })} />
      </section>

      <section className="side-section">
        <div className="side-head">
          <h2 className="side-title">Setups</h2>
          <button className="btn btn-sm" onClick={() => dispatch({ type: "addSetup" })} disabled={state.setups.length >= 8} title="Add a setup">
            <IconPlus /> Add
          </button>
        </div>
        {state.setups.map((s, i) => (
          <div className="setup-card" key={i}>
            <div className="setup-card-head">
              <span className="swatch" style={{ background: derived.colours[s.name] }} />
              <input value={s.name} onChange={(e) => dispatch({ type: "setup", index: i, patch: { name: e.target.value } })} aria-label={`Name of setup ${i + 1}`} />
              <button className="btn btn-ghost btn-icon" onClick={() => dispatch({ type: "removeSetup", index: i })} disabled={state.setups.length <= 1} aria-label={`Remove ${s.name}`} title="Remove">
                <IconX />
              </button>
            </div>
            <NumberField label="Drag" symbol="C_D" unit="" value={s.dragCoefficient} min={0.001} onChange={(v) => dispatch({ type: "setup", index: i, patch: { dragCoefficient: v } })} slider={{ min: 0.3, max: 2, step: 0.01 }} />
            <NumberField label="Downforce" symbol="C_DF" unit="" value={s.downforceCoefficient} min={0} onChange={(v) => dispatch({ type: "setup", index: i, patch: { downforceCoefficient: v } })} slider={{ min: 0, max: 6, step: 0.01 }} />
          </div>
        ))}
      </section>

      <section className="side-section">
        <div className="side-head"><h2 className="side-title">Score</h2></div>
        <div style={{ display: "grid", gap: 12 }}>
          <Segmented
            full
            label="Weights"
            value={state.weightsMode}
            onChange={(v) => dispatch({ type: "weights", patch: { weightsMode: v } })}
            options={[
              { value: "circuit", label: "From circuit", title: "w_D and w_G follow the straight fraction" },
              { value: "manual", label: "Manual" },
            ]}
          />
          {state.weightsMode === "circuit" ? (
            <NumberField
              label="Margin weight"
              symbol="w_M"
              unit=""
              value={state.marginWeight}
              min={0}
              max={1}
              onChange={(v) => dispatch({ type: "weights", patch: { marginWeight: v } })}
              slider={{ min: 0, max: 0.6, step: 0.01 }}
              hint={`Now w_D = ${fmt(derived.weights.drag, 3)}, w_G = ${fmt(derived.weights.grip, 3)}.`}
            />
          ) : (
            <div>
              {(["drag", "grip", "margin"] as const).map((k) => (
                <NumberField
                  key={k}
                  label={{ drag: "Drag weight", grip: "Grip weight", margin: "Margin weight" }[k]}
                  symbol={{ drag: "w_D", grip: "w_G", margin: "w_M" }[k]}
                  unit=""
                  value={+state.manualWeights[k].toFixed(4)}
                  min={0}
                  max={1}
                  onChange={(v) => dispatch({ type: "weights", patch: { manualWeights: rebalance(state.manualWeights, k, v) } })}
                  slider={{ min: 0, max: 1, step: 0.01 }}
                />
              ))}
              <p className="field-hint" style={{ margin: 0 }}>The other two weights rescale so that all three sum to 1.</p>
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Normalisation</span>
            <Segmented label="Normalisation" value={state.normalisation} onChange={(v) => dispatch({ type: "scoring", patch: { normalisation: v } })} options={[{ value: "ratio", label: "Ratio" }, { value: "minmax", label: "Min–max" }]} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Feasibility gate</span>
            <Segmented label="Feasibility gate" value={state.gate} onChange={(v) => dispatch({ type: "scoring", patch: { gate: v } })} options={[{ value: "strict", label: "Strict" }, { value: "none", label: "Off" }]} />
          </div>
        </div>
      </section>
    </aside>
  );
}
