/**
 * Cross-implementation verification: the browser engine must reproduce every
 * value of the golden cases written by the Python reference implementation
 * (`vdpm golden`) within the recorded relative tolerance.
 *
 * With VDPM_EXPORT=1 the test also writes this engine's outputs in the same
 * format to golden/browser-engine-output.json, which `vdpm research
 * --browser-output` compares value by value for the research report.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateCorner,
  marginSensitivities,
  meanCornerRadius,
  circuitLength,
  rankSetups,
  referenceCircuit,
  straightFraction,
  type AeroSetup,
  type CircuitWeights,
  type Gate,
  type Normalisation,
} from "./index";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const ROOT = resolve(__dirname, "../../..");
const golden = JSON.parse(readFileSync(resolve(ROOT, "golden/cases.json"), "utf8")) as Record<string, any>;
const TOL: number = golden.relative_tolerance;

const enc = (v: number | null): Json => (v === null ? null : Number.isFinite(v) ? v : v > 0 ? "Infinity" : "-Infinity");
const dec = (v: Json): number => (v === "Infinity" ? Infinity : v === "-Infinity" ? -Infinity : (v as number));

function close(actual: number, expected: number): boolean {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return actual === expected;
  const scale = Math.max(Math.abs(actual), Math.abs(expected));
  return scale < 1e-12 ? Math.abs(actual - expected) <= 1e-12 : Math.abs(actual - expected) / scale <= TOL;
}

const setupOf = (s: any): AeroSetup => ({
  name: s.name,
  dragCoefficient: s.drag_coefficient,
  downforceCoefficient: s.downforce_coefficient,
});
const setups: AeroSetup[] = golden.setups.map(setupOf);
const WEIGHTS: Record<string, CircuitWeights | undefined> = {
  default: undefined,
  "drag-heavy": { drag: 0.7, grip: 0.2, margin: 0.1 },
  "grip-heavy": { drag: 0.1, grip: 0.6, margin: 0.3 },
};

const cornerOut: Json[] = [];
const circuitOut: Json[] = [];
let compared = 0;
let maxErr = 0;

function check(path: string, actual: number | boolean | null, expectedJson: Json) {
  compared++;
  if (typeof actual === "boolean" || actual === null || expectedJson === null || typeof expectedJson === "boolean") {
    expect(actual, path).toBe(expectedJson);
    return;
  }
  const expected = dec(expectedJson);
  if (Number.isFinite(expected) && Number.isFinite(actual)) {
    const scale = Math.max(Math.abs(actual), Math.abs(expected), 1e-300);
    maxErr = Math.max(maxErr, scale > 1e-12 ? Math.abs(actual - expected) / scale : Math.abs(actual - expected));
  }
  if (!close(actual, expected)) throw new Error(`${path}: expected ${expected}, got ${actual}`);
}

const CORNER_FIELDS: [string, string][] = [
  ["speed", "speed"], ["radius", "radius"], ["drag", "drag"], ["downforce", "downforce"],
  ["required_force", "requiredForce"], ["available_grip", "availableGrip"], ["reserve_force", "reserveForce"],
  ["margin", "margin"], ["feasible", "feasible"], ["max_lateral_acceleration", "maxLateralAcceleration"],
  ["required_lateral_acceleration", "requiredLateralAcceleration"], ["max_cornering_speed", "maxCorneringSpeed"],
  ["critical_radius", "criticalRadius"], ["grip_limited", "gripLimited"], ["min_radius", "minRadius"],
  ["min_friction", "minFriction"], ["min_downforce_coefficient", "minDownforceCoefficient"], ["max_mass", "maxMass"],
];
const SENS_FIELDS: [string, string][] = [
  ["friction", "friction"], ["radius", "radius"], ["speed", "speed"], ["mass", "mass"], ["air_density", "airDensity"],
  ["downforce_coefficient", "downforceCoefficient"], ["reference_area", "referenceArea"], ["gravity", "gravity"],
  ["drag_coefficient", "dragCoefficient"],
];

describe("golden cases (Python reference vs browser engine)", () => {
  it(`reproduces all ${golden.corner_cases.length} corner cases`, () => {
    golden.corner_cases.forEach((c: any, i: number) => {
      const v = { mass: c.input.vehicle.mass, referenceArea: c.input.vehicle.reference_area, friction: c.input.vehicle.friction };
      const env = { airDensity: c.input.environment.air_density, gravity: c.input.environment.gravity };
      const res = evaluateCorner(v, setupOf(c.input.setup), c.input.speed, c.input.radius, env);
      const sens = marginSensitivities(v, setupOf(c.input.setup), c.input.speed, c.input.radius, env);
      const output: Record<string, Json> = {};
      for (const [py, ts] of CORNER_FIELDS) {
        const val = (res as any)[ts];
        check(`corner_cases[${i}].output.${py}`, val, c.output[py]);
        output[py] = typeof val === "boolean" ? val : enc(val);
      }
      const sOut: Record<string, Json> = {};
      for (const [py, ts] of SENS_FIELDS) {
        check(`corner_cases[${i}].sensitivities.${py}`, (sens as any)[ts], c.sensitivities[py]);
        sOut[py] = enc((sens as any)[ts]);
      }
      cornerOut.push({ input: c.input, output, sensitivities: sOut });
    });
  });

  it(`reproduces all ${golden.circuit_cases.length} circuit rankings`, () => {
    golden.circuit_cases.forEach((c: any, i: number) => {
      const circuit = referenceCircuit(c.input.circuit_key, c.input.lateral_acceleration);
      check(`circuit_cases[${i}].circuit.length`, circuitLength(circuit), c.circuit.length);
      check(`circuit_cases[${i}].circuit.straight_fraction`, straightFraction(circuit), c.circuit.straight_fraction);
      check(`circuit_cases[${i}].circuit.mean_corner_radius`, meanCornerRadius(circuit), c.circuit.mean_corner_radius);
      circuit.segments.forEach((s, j) => {
        const g = c.circuit.segments[j];
        expect(s.kind).toBe(g.kind);
        check(`circuit_cases[${i}].segments[${j}].length`, s.length, g.length);
        check(`circuit_cases[${i}].segments[${j}].speed`, s.speed, g.speed);
        check(`circuit_cases[${i}].segments[${j}].radius`, s.radius, g.radius);
      });
      const vehicle = { mass: 800, referenceArea: 1.5, friction: 1.5 };
      const env = { airDensity: 1.225, gravity: 9.81 };
      const r = rankSetups(vehicle, setups, circuit, WEIGHTS[c.input.weights], env, c.input.normalisation as Normalisation, c.input.gate as Gate);
      check(`circuit_cases[${i}].weights.drag`, r.weights.drag, c.weights.drag);
      check(`circuit_cases[${i}].weights.grip`, r.weights.grip, c.weights.grip);
      check(`circuit_cases[${i}].weights.margin`, r.weights.margin, c.weights.margin);
      const entries = r.entries.map((e, j) => {
        const g = c.entries[j];
        expect(e.name).toBe(g.setup);
        const row: Record<string, number | boolean | null> = {
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
        return { setup: e.name, ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "number" ? enc(v) : v])) };
      });
      circuitOut.push({
        input: c.input,
        circuit: {
          length: circuitLength(circuit),
          straight_fraction: straightFraction(circuit),
          mean_corner_radius: meanCornerRadius(circuit),
          segments: circuit.segments.map((s) => ({ kind: s.kind, length: s.length, speed: s.speed, radius: s.radius, name: s.name })),
        },
        weights: { ...r.weights },
        entries,
      });
    });
  });

  it("reports agreement and optionally exports outputs", () => {
    expect(compared).toBeGreaterThan(10000);
    expect(maxErr).toBeLessThanOrEqual(TOL);
    console.log(`golden: ${compared} values compared, max relative error ${maxErr.toExponential(2)}`);
    if (process.env.VDPM_EXPORT === "1") {
      const out = {
        format: golden.format,
        generator: "vdpm-racetwin browser engine (TypeScript)",
        relative_tolerance: TOL,
        setups: golden.setups,
        corner_cases: cornerOut,
        circuit_cases: circuitOut,
      };
      writeFileSync(resolve(ROOT, "golden/browser-engine-output.json"), JSON.stringify(out) + "\n");
    }
  });
});
