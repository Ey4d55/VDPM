/**
 * In-browser uncertainty analysis. Mirrors the method of
 * `vdpm.research.montecarlo` (uniform multiplicative perturbations, per-setup
 * CFD uncertainty, Wilson intervals). It uses its own seeded generator, so
 * individual samples differ from the Python suite; the published numbers come
 * from the Python suite, and this view lets readers explore them live.
 */
import { BASELINES, baselineTop } from "./baselines";
import { syntheticCircuit, type CircuitSummary } from "./circuits";
import type { AeroSetup, Environment, Vehicle } from "./models";
import { best, rankSetups, type CircuitWeights } from "./scoring";

/** Mulberry32: small, fast, seedable PRNG (period 2^32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wilson(successes: number, n: number, z = 1.959963984540054): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [successes === 0 ? 0 : Math.max(0, centre - half), successes === n ? 1 : Math.min(1, centre + half)];
}

export interface Uncertainty {
  friction: number;
  mass: number;
  airDensity: number;
  referenceArea: number;
  dragCoefficient: number;
  downforceCoefficient: number;
  lateralAcceleration: number;
}

export const DEFAULT_UNCERTAINTY: Uncertainty = {
  friction: 0.1,
  mass: 0.02,
  airDensity: 0.05,
  referenceArea: 0.02,
  dragCoefficient: 0.05,
  downforceCoefficient: 0.05,
  lateralAcceleration: 0.1,
};

export interface MonteCarloInput {
  summary: CircuitSummary;
  vehicle: Vehicle;
  env: Environment;
  setups: AeroSetup[];
  lateralAcceleration: number;
  weights?: CircuitWeights;
  uncertainty: Uncertainty;
  samples: number;
  seed: number;
}

export interface MonteCarloOutput {
  samples: number;
  winners: Record<string, number>;
  feasible: Record<string, number>;
  avoidableInfeasible: Record<string, number>;
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloOutput {
  const rnd = mulberry32(input.seed);
  const u = input.uncertainty;
  const f = (h: number) => 1 + (2 * rnd() - 1) * h;
  const names = input.setups.map((s) => s.name);
  const winners: Record<string, number> = Object.fromEntries([...names, "none eligible"].map((n) => [n, 0]));
  const feasible: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  const methods = ["ungated", ...Object.keys(BASELINES)];
  const avoidable: Record<string, number> = Object.fromEntries(methods.map((m) => [m, 0]));
  for (let i = 0; i < input.samples; i++) {
    const vehicle: Vehicle = {
      mass: input.vehicle.mass * f(u.mass),
      referenceArea: input.vehicle.referenceArea * f(u.referenceArea),
      friction: input.vehicle.friction * f(u.friction),
    };
    const env: Environment = { ...input.env, airDensity: input.env.airDensity * f(u.airDensity) };
    const circuit = syntheticCircuit(input.summary, input.lateralAcceleration * f(u.lateralAcceleration));
    const setups = input.setups.map((s) => ({
      ...s,
      dragCoefficient: s.dragCoefficient * f(u.dragCoefficient),
      downforceCoefficient: s.downforceCoefficient * f(u.downforceCoefficient),
    }));
    const ranking = rankSetups(vehicle, setups, circuit, input.weights, env, "ratio", "strict");
    const top = best(ranking);
    winners[top ? top.name : "none eligible"]! += 1;
    for (const e of ranking.entries) if (e.evaluation.feasible) feasible[e.name]! += 1;
    if (top) {
      const ungated = rankSetups(vehicle, setups, circuit, input.weights, env, "ratio", "none");
      const ungatedTop = best(ungated)!;
      if (!ungatedTop.evaluation.feasible) avoidable.ungated! += 1;
      const evals = ranking.entries.map((e) => e.evaluation);
      for (const m of Object.keys(BASELINES)) if (!baselineTop(m, evals).feasible) avoidable[m]! += 1;
    }
  }
  return { samples: input.samples, winners, feasible, avoidableInfeasible: avoidable };
}
