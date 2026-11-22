/**
 * Circuit evaluation, the feasibility gate and the VDPM score (Sec. 4.6),
 * mirroring `vdpm.scoring`. See the Python module docstring for the exact
 * definition of every term; the two implementations are checked against the
 * shared golden cases.
 */
import { fsum } from "./fsum";
import { circuitLength, straightFraction } from "./circuits";
import { corners, DEFAULT_ENVIRONMENT, type AeroSetup, type Circuit, type Environment, type Vehicle } from "./models";
import { drag, evaluateCorner, type CornerResult } from "./physics";

export type Normalisation = "ratio" | "minmax";
export type Gate = "strict" | "none";

export const DEFAULT_MARGIN_WEIGHT = 0.2;

export interface CircuitWeights {
  drag: number;
  grip: number;
  margin: number;
}

export function validateWeights(w: CircuitWeights): CircuitWeights {
  for (const [k, v] of Object.entries(w))
    if (!(Number.isFinite(v) && v >= 0)) throw new RangeError(`weight ${k} must be finite and non-negative`);
  const total = w.drag + w.grip + w.margin;
  if (Math.abs(total - 1) > 1e-9) throw new RangeError(`weights must sum to 1, got ${total}`);
  return w;
}

export function weightsFromStraightFraction(s: number, marginWeight = DEFAULT_MARGIN_WEIGHT): CircuitWeights {
  if (!(s >= 0 && s <= 1)) throw new RangeError("straight fraction must lie in [0, 1]");
  if (!(marginWeight >= 0 && marginWeight <= 1)) throw new RangeError("margin weight must lie in [0, 1]");
  const rest = 1.0 - marginWeight;
  return { drag: rest * s, grip: rest * (1.0 - s), margin: marginWeight };
}

export const weightsForCircuit = (c: Circuit, marginWeight = DEFAULT_MARGIN_WEIGHT): CircuitWeights =>
  weightsFromStraightFraction(straightFraction(c), marginWeight);

export interface CircuitEvaluation {
  setup: AeroSetup;
  circuit: string;
  corners: CornerResult[];
  cornerNames: string[];
  dragExposure: number;
  gripCapacity: number;
  gripRatio: number;
  bindingCorner: number;
  feasible: boolean;
  minMargin: number;
  failedCorners: number[];
}

export function evaluateCircuit(
  vehicle: Vehicle,
  setup: AeroSetup,
  circuit: Circuit,
  env: Environment = DEFAULT_ENVIRONMENT,
): CircuitEvaluation {
  const cs = corners(circuit);
  const results = cs.map((seg) => evaluateCorner(vehicle, setup, seg.speed, seg.radius as number, env));
  const total = circuitLength(circuit);
  const dragExposure =
    fsum(circuit.segments.map((seg) => seg.length * drag(env.airDensity, seg.speed, setup.dragCoefficient, vehicle.referenceArea))) /
    total;
  const gripCapacity = fsum(cs.map((seg, i) => seg.length * results[i]!.availableGrip)) / fsum(cs.map((s) => s.length));
  const ratios = results.map((r) => r.availableGrip / r.requiredForce);
  let binding = 0;
  for (let i = 1; i < ratios.length; i++) if (ratios[i]! < ratios[binding]!) binding = i;
  const failed = results.flatMap((r, i) => (r.feasible ? [] : [i]));
  return {
    setup,
    circuit: circuit.name,
    corners: results,
    cornerNames: cs.map((s) => s.name),
    dragExposure,
    gripCapacity,
    gripRatio: ratios[binding]!,
    bindingCorner: binding,
    feasible: failed.length === 0,
    minMargin: ratios[binding]! - 1.0,
    failedCorners: failed,
  };
}

export const cornerLabel = (ev: CircuitEvaluation, i: number): string => ev.cornerNames[i] || `corner ${i + 1}`;

export interface RankedSetup {
  name: string;
  evaluation: CircuitEvaluation;
  eligible: boolean;
  dragPenalty: number | null;
  gripPenalty: number | null;
  marginPenalty: number | null;
  score: number | null;
  rank: number | null;
}

export interface Ranking {
  circuit: string;
  weights: CircuitWeights;
  normalisation: Normalisation;
  gate: Gate;
  entries: RankedSetup[];
}

export function penalties(values: number[], lowerIsBetter: boolean, mode: Normalisation): number[] {
  if (mode === "ratio") {
    if (values.some((v) => v <= 0)) throw new RangeError("ratio normalisation requires strictly positive values");
    if (lowerIsBetter) {
      const best = Math.min(...values);
      return values.map((v) => 1.0 - best / v);
    }
    const best = Math.max(...values);
    return values.map((v) => 1.0 - v / best);
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  if (span <= 0) return values.map(() => 0);
  return lowerIsBetter ? values.map((v) => (v - lo) / span) : values.map((v) => (hi - v) / span);
}

/** Standard competition ranking ("1224"); scores within tol tie. */
export function competitionRanks(scores: number[], tol = 1e-12): number[] {
  const order = scores.map((_, i) => i).sort((a, b) => scores[a]! - scores[b]! || a - b);
  const ranks = new Array<number>(scores.length).fill(0);
  order.forEach((idx, pos) => {
    const prev = order[pos - 1];
    ranks[idx] = pos > 0 && prev !== undefined && Math.abs(scores[idx]! - scores[prev]!) <= tol ? ranks[prev]! : pos + 1;
  });
  return ranks;
}

export function rankSetups(
  vehicle: Vehicle,
  setups: AeroSetup[],
  circuit: Circuit,
  weights?: CircuitWeights,
  env: Environment = DEFAULT_ENVIRONMENT,
  normalisation: Normalisation = "ratio",
  gate: Gate = "strict",
): Ranking {
  if (setups.length === 0) throw new RangeError("at least one setup is required");
  if (new Set(setups.map((s) => s.name)).size !== setups.length) throw new RangeError("setup names must be unique");
  const w = validateWeights(weights ?? weightsForCircuit(circuit));
  const evals = setups.map((s) => evaluateCircuit(vehicle, s, circuit, env));
  const eligible = evals.map((e) => (gate === "strict" ? e.feasible : true));
  const poolIds = eligible.flatMap((ok, i) => (ok ? [i] : []));
  const entries: RankedSetup[] = evals.map((e) => ({
    name: e.setup.name,
    evaluation: e,
    eligible: false,
    dragPenalty: null,
    gripPenalty: null,
    marginPenalty: null,
    score: null,
    rank: null,
  }));
  if (poolIds.length > 0) {
    const pool = poolIds.map((i) => evals[i]!);
    const d = penalties(pool.map((e) => e.dragExposure), true, normalisation);
    const q = penalties(pool.map((e) => e.gripCapacity), false, normalisation);
    const z = penalties(pool.map((e) => e.gripRatio), false, normalisation);
    const scores = pool.map((_, j) => w.drag * d[j]! + w.grip * q[j]! + w.margin * z[j]!);
    const ranks = competitionRanks(scores);
    poolIds.forEach((idx, j) => {
      entries[idx] = {
        ...entries[idx]!,
        eligible: true,
        dragPenalty: d[j]!,
        gripPenalty: q[j]!,
        marginPenalty: z[j]!,
        score: scores[j]!,
        rank: ranks[j]!,
      };
    });
  }
  return { circuit: circuit.name, weights: w, normalisation, gate, entries };
}

/** Eligible setups best first, then ineligible ones in input order. */
export function ordered(r: Ranking): RankedSetup[] {
  const ok = r.entries.filter((e) => e.eligible).sort((a, b) => a.rank! - b.rank! || (a.name < b.name ? -1 : 1));
  return [...ok, ...r.entries.filter((e) => !e.eligible)];
}

export function best(r: Ranking): RankedSetup | null {
  const o = ordered(r);
  return o[0]?.eligible ? o[0] : null;
}

export function contributions(e: RankedSetup, w: CircuitWeights): { drag: number; grip: number; margin: number } | null {
  if (e.score === null) return null;
  return { drag: w.drag * e.dragPenalty!, grip: w.grip * e.gripPenalty!, margin: w.margin * e.marginPenalty! };
}
