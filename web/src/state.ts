/**
 * Application state: the model inputs a user can change, the derived results,
 * and the reproducibility bundle (scenario JSON) that captures both.
 */
import { createContext, useContext, useMemo } from "react";
import {
  CASE_STUDY_LATERAL_ACCELERATION,
  DEFAULT_MARGIN_WEIGHT,
  explainRanking,
  rankSetups,
  referenceCircuit,
  straightFraction,
  validateCircuit,
  validateEnvironment,
  validateSetup,
  validateVehicle,
  validateWeights,
  weightsFromStraightFraction,
  type AeroSetup,
  type Circuit,
  type CircuitWeights,
  type Environment,
  type Finding,
  type Gate,
  type Normalisation,
  type Ranking,
  type Vehicle,
} from "./engine";
import { setupColour, THEMES, type ChartTheme, type ThemeName } from "./theme";

export const APP_VERSION = "0.1.0";
export type CircuitKey = "A" | "B" | "C";

export type CircuitSource = { kind: "reference"; key: CircuitKey } | { kind: "custom"; circuit: Circuit };

export interface ModelState {
  vehicle: Vehicle;
  env: Environment;
  setups: AeroSetup[];
  circuitSource: CircuitSource;
  /** Corner demand a_ref used to build the reference circuits, m/s^2. */
  lateralAcceleration: number;
  weightsMode: "circuit" | "manual";
  marginWeight: number;
  manualWeights: CircuitWeights;
  normalisation: Normalisation;
  gate: Gate;
}

/** Manuscript values (Table 1) and the default score definition. */
export const PAPER_STATE: ModelState = {
  vehicle: { mass: 800, referenceArea: 1.5, friction: 1.5 },
  env: { airDensity: 1.225, gravity: 9.81 },
  setups: [
    { name: "Setup A", dragCoefficient: 0.8, downforceCoefficient: 2.5, description: "Low drag", source: "Manuscript Table 1" },
    { name: "Setup B", dragCoefficient: 1.1, downforceCoefficient: 3.5, description: "High downforce", source: "Manuscript Table 1" },
  ],
  circuitSource: { kind: "reference", key: "C" },
  lateralAcceleration: CASE_STUDY_LATERAL_ACCELERATION,
  weightsMode: "circuit",
  marginWeight: DEFAULT_MARGIN_WEIGHT,
  manualWeights: { drag: 0.4, grip: 0.4, margin: 0.2 },
  normalisation: "ratio",
  gate: "strict",
};

export type Action =
  | { type: "vehicle"; patch: Partial<Vehicle> }
  | { type: "env"; patch: Partial<Environment> }
  | { type: "setup"; index: number; patch: Partial<AeroSetup> }
  | { type: "addSetup"; setup?: AeroSetup }
  | { type: "removeSetup"; index: number }
  | { type: "circuit"; source: CircuitSource }
  | { type: "lateralAcceleration"; value: number }
  | { type: "weights"; patch: Partial<Pick<ModelState, "weightsMode" | "marginWeight" | "manualWeights">> }
  | { type: "scoring"; patch: Partial<Pick<ModelState, "normalisation" | "gate">> }
  | { type: "replace"; state: ModelState }
  | { type: "reset" };

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

export function reducer(state: ModelState, action: Action): ModelState {
  switch (action.type) {
    case "vehicle":
      return { ...state, vehicle: { ...state.vehicle, ...action.patch } };
    case "env":
      return { ...state, env: { ...state.env, ...action.patch } };
    case "setup": {
      const setups = state.setups.map((s, i) => (i === action.index ? { ...s, ...action.patch } : s));
      return { ...state, setups };
    }
    case "addSetup": {
      if (state.setups.length >= 8) return state;
      const names = state.setups.map((s) => s.name);
      const letter = String.fromCharCode(65 + state.setups.length);
      const base = action.setup ?? { name: `Setup ${letter}`, dragCoefficient: 0.95, downforceCoefficient: 3.0, description: "Custom" };
      return { ...state, setups: [...state.setups, { ...base, name: uniqueName(base.name, names) }] };
    }
    case "removeSetup":
      return state.setups.length <= 1 ? state : { ...state, setups: state.setups.filter((_, i) => i !== action.index) };
    case "circuit":
      return { ...state, circuitSource: action.source };
    case "lateralAcceleration":
      return { ...state, lateralAcceleration: action.value };
    case "weights":
      return { ...state, ...action.patch };
    case "scoring":
      return { ...state, ...action.patch };
    case "replace":
      return action.state;
    case "reset":
      return PAPER_STATE;
  }
}

export interface Derived {
  circuit: Circuit;
  weights: CircuitWeights;
  ranking: Ranking | null;
  findings: Finding[];
  error: string | null;
  colours: Record<string, string>;
}

export function useDerived(state: ModelState, theme: ThemeName): Derived {
  return useMemo(() => {
    const colours = Object.fromEntries(state.setups.map((s, i) => [s.name, setupColour(theme, i)]));
    const circuit =
      state.circuitSource.kind === "reference"
        ? referenceCircuit(state.circuitSource.key, state.lateralAcceleration > 0 ? state.lateralAcceleration : 1e-9)
        : state.circuitSource.circuit;
    let weights: CircuitWeights = state.manualWeights;
    try {
      validateVehicle(state.vehicle);
      validateEnvironment(state.env);
      state.setups.forEach(validateSetup);
      if (new Set(state.setups.map((s) => s.name)).size !== state.setups.length) throw new Error("Setup names must be unique.");
      if (!(state.lateralAcceleration > 0)) throw new Error("Corner demand must be positive.");
      validateCircuit(circuit);
      weights =
        state.weightsMode === "circuit"
          ? weightsFromStraightFraction(straightFraction(circuit), state.marginWeight)
          : validateWeights(state.manualWeights);
      const ranking = rankSetups(state.vehicle, state.setups, circuit, weights, state.env, state.normalisation, state.gate);
      return { circuit, weights, ranking, findings: explainRanking(ranking), error: null, colours };
    } catch (e) {
      return { circuit, weights, ranking: null, findings: [], error: (e as Error).message, colours };
    }
  }, [state, theme]);
}

// --------------------------------------------------------------------------- //
// Context
// --------------------------------------------------------------------------- //

export interface AppContextValue {
  state: ModelState;
  dispatch: (a: Action) => void;
  derived: Derived;
  theme: ChartTheme;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing");
  return ctx;
}

export const themeFor = (name: ThemeName): ChartTheme => THEMES[name];

// --------------------------------------------------------------------------- //
// Persistence and the reproducibility bundle
// --------------------------------------------------------------------------- //

const STORAGE_KEY = "vdpm-racetwin/state/v1";

export function loadState(): ModelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return PAPER_STATE;
    const parsed = JSON.parse(raw) as ModelState;
    return parsed && parsed.vehicle && parsed.setups ? { ...PAPER_STATE, ...parsed } : PAPER_STATE;
  } catch {
    return PAPER_STATE;
  }
}

export function saveState(state: ModelState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the app works without it */
  }
}

export interface ScenarioBundle {
  format: "vdpm-scenario/1";
  app: string;
  created: string;
  inputs: ModelState;
  results: {
    circuit: string;
    weights: CircuitWeights;
    entries: { setup: string; eligible: boolean; score: number | null; rank: number | null; minMargin: number }[];
  } | null;
}

export function makeBundle(state: ModelState, derived: Derived): ScenarioBundle {
  return {
    format: "vdpm-scenario/1",
    app: `VDPM-RaceTwin ${APP_VERSION}`,
    created: new Date().toISOString(),
    inputs: state,
    results: derived.ranking
      ? {
          circuit: derived.ranking.circuit,
          weights: derived.ranking.weights,
          entries: derived.ranking.entries.map((e) => ({
            setup: e.name,
            eligible: e.eligible,
            score: e.score,
            rank: e.rank,
            minMargin: e.evaluation.minMargin,
          })),
        }
      : null,
  };
}

export function parseBundle(text: string): ModelState {
  const data = JSON.parse(text) as Partial<ScenarioBundle>;
  if (data.format !== "vdpm-scenario/1" || !data.inputs) throw new Error("Not a VDPM scenario file (format vdpm-scenario/1).");
  return { ...PAPER_STATE, ...data.inputs };
}
