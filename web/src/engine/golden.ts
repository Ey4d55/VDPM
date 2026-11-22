/**
 * In-browser run of the golden cases written by the Python reference
 * implementation (`vdpm golden`). The Research workspace calls this so that a
 * reader can verify the cross-implementation agreement on their own machine.
 */
import { circuitLength, meanCornerRadius, referenceCircuit, straightFraction } from "./circuits";
import { marginSensitivities } from "./explain";
import type { AeroSetup } from "./models";
import { evaluateCorner } from "./physics";
import { rankSetups, type CircuitWeights, type Gate, type Normalisation } from "./scoring";

/* eslint-disable @typescript-eslint/no-explicit-any */
type GoldenFile = Record<string, any>;

export const GOLDEN_WEIGHTS: Record<string, CircuitWeights | undefined> = {
  default: undefined,
  "drag-heavy": { drag: 0.7, grip: 0.2, margin: 0.1 },
  "grip-heavy": { drag: 0.1, grip: 0.6, margin: 0.3 },
};

const CORNER: [string, string][] = [
  ["speed", "speed"], ["radius", "radius"], ["drag", "drag"], ["downforce", "downforce"],
  ["required_force", "requiredForce"], ["available_grip", "availableGrip"], ["reserve_force", "reserveForce"],
  ["margin", "margin"], ["feasible", "feasible"], ["max_lateral_acceleration", "maxLateralAcceleration"],
  ["required_lateral_acceleration", "requiredLateralAcceleration"], ["max_cornering_speed", "maxCorneringSpeed"],
  ["critical_radius", "criticalRadius"], ["grip_limited", "gripLimited"], ["min_radius", "minRadius"],
  ["min_friction", "minFriction"], ["min_downforce_coefficient", "minDownforceCoefficient"], ["max_mass", "maxMass"],
];
const SENS: [string, string][] = [
  ["friction", "friction"], ["radius", "radius"], ["speed", "speed"], ["mass", "mass"], ["air_density", "airDensity"],
  ["downforce_coefficient", "downforceCoefficient"], ["reference_area", "referenceArea"], ["gravity", "gravity"],
  ["drag_coefficient", "dragCoefficient"],
];

export interface GoldenReport {
  cornerCases: number;
  circuitCases: number;
  compared: number;
  mismatches: string[];
  maxRelativeError: number;
  tolerance: number;
  generator: string;
  milliseconds: number;
}

const dec = (v: unknown): number | boolean | null =>
  v === "Infinity" ? Infinity : v === "-Infinity" ? -Infinity : (v as number | boolean | null);

export function runGolden(golden: GoldenFile): GoldenReport {
  const t0 = performance.now();
  const tol: number = golden.relative_tolerance;
  let compared = 0;
  let maxErr = 0;
  const mismatches: string[] = [];
  const check = (path: string, actual: unknown, expectedRaw: unknown) => {
    compared++;
    const expected = dec(expectedRaw);
    if (typeof actual !== "number" || typeof expected !== "number") {
      if (actual !== expected) mismatches.push(`${path}: expected ${String(expected)}, got ${String(actual)}`);
      return;
    }
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
      if (actual !== expected) mismatches.push(`${path}: expected ${expected}, got ${actual}`);
      return;
    }
    const scale = Math.max(Math.abs(actual), Math.abs(expected));
    const err = scale < 1e-12 ? Math.abs(actual - expected) : Math.abs(actual - expected) / scale;
    maxErr = Math.max(maxErr, err);
    if (err > tol && Math.abs(actual - expected) > 1e-12) mismatches.push(`${path}: expected ${expected}, got ${actual}`);
  };
  const setupOf = (s: any): AeroSetup => ({ name: s.name, dragCoefficient: s.drag_coefficient, downforceCoefficient: s.downforce_coefficient });

  golden.corner_cases.forEach((c: any, i: number) => {
    const v = { mass: c.input.vehicle.mass, referenceArea: c.input.vehicle.reference_area, friction: c.input.vehicle.friction };
    const env = { airDensity: c.input.environment.air_density, gravity: c.input.environment.gravity };
    const res = evaluateCorner(v, setupOf(c.input.setup), c.input.speed, c.input.radius, env) as unknown as Record<string, unknown>;
    const sens = marginSensitivities(v, setupOf(c.input.setup), c.input.speed, c.input.radius, env) as unknown as Record<string, unknown>;
    for (const [py, ts] of CORNER) check(`corner_cases[${i}].${py}`, res[ts], c.output[py]);
    for (const [py, ts] of SENS) check(`corner_cases[${i}].sensitivities.${py}`, sens[ts], c.sensitivities[py]);
  });

  const setups: AeroSetup[] = golden.setups.map(setupOf);
  golden.circuit_cases.forEach((c: any, i: number) => {
    const circuit = referenceCircuit(c.input.circuit_key, c.input.lateral_acceleration);
    check(`circuit_cases[${i}].length`, circuitLength(circuit), c.circuit.length);
    check(`circuit_cases[${i}].straight_fraction`, straightFraction(circuit), c.circuit.straight_fraction);
    check(`circuit_cases[${i}].mean_corner_radius`, meanCornerRadius(circuit), c.circuit.mean_corner_radius);
    circuit.segments.forEach((s, j) => {
      const g = c.circuit.segments[j];
      check(`circuit_cases[${i}].segments[${j}].length`, s.length, g.length);
      check(`circuit_cases[${i}].segments[${j}].speed`, s.speed, g.speed);
      check(`circuit_cases[${i}].segments[${j}].radius`, s.radius, g.radius);
    });
    const r = rankSetups(
      { mass: 800, referenceArea: 1.5, friction: 1.5 },
      setups,
      circuit,
      GOLDEN_WEIGHTS[c.input.weights],
      { airDensity: 1.225, gravity: 9.81 },
      c.input.normalisation as Normalisation,
      c.input.gate as Gate,
    );
    check(`circuit_cases[${i}].weights.drag`, r.weights.drag, c.weights.drag);
    check(`circuit_cases[${i}].weights.grip`, r.weights.grip, c.weights.grip);
    check(`circuit_cases[${i}].weights.margin`, r.weights.margin, c.weights.margin);
    r.entries.forEach((e, j) => {
      const g = c.entries[j];
      const row: Record<string, unknown> = {
        eligible: e.eligible,
        drag_exposure: e.evaluation.dragExposure,
        grip_capacity: e.evaluation.gripCapacity,
        grip_ratio: e.evaluation.gripRatio,
        binding_corner: e.evaluation.bindingCorner,
        drag_penalty: e.dragPenalty,
        grip_penalty: e.gripPenalty,
        margin_penalty: e.marginPenalty,
        score: e.score,
        rank: e.rank,
      };
      for (const [k, v] of Object.entries(row)) check(`circuit_cases[${i}].entries[${j}].${k}`, v, g[k]);
    });
  });

  return {
    cornerCases: golden.corner_cases.length,
    circuitCases: golden.circuit_cases.length,
    compared,
    mismatches,
    maxRelativeError: maxErr,
    tolerance: tol,
    generator: String(golden.generator ?? "vdpm"),
    milliseconds: performance.now() - t0,
  };
}
