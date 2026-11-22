/** Baseline rankings (Sec. 7), mirroring `vdpm.baselines`. */
import { efficiency } from "./models";
import { competitionRanks, type CircuitEvaluation } from "./scoring";

export const BASELINES: Record<string, (e: CircuitEvaluation) => number> = {
  "drag-only": (e) => e.dragExposure,
  "downforce-only": (e) => -e.setup.downforceCoefficient,
  "efficiency-only": (e) => -efficiency(e.setup),
};

export function baselineRanks(method: string, evals: CircuitEvaluation[]): Record<string, number> {
  const key = BASELINES[method];
  if (!key) throw new RangeError(`unknown baseline ${method}`);
  const ranks = competitionRanks(evals.map(key));
  return Object.fromEntries(evals.map((e, i) => [e.setup.name, ranks[i]!]));
}

/** Top choice of a baseline (ties broken by name, as in the Python reference). */
export function baselineTop(method: string, evals: CircuitEvaluation[]): CircuitEvaluation {
  const key = BASELINES[method]!;
  return [...evals].sort((a, b) => key(a) - key(b) || (a.setup.name < b.setup.name ? -1 : 1))[0]!;
}
