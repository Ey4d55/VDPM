import { readFileSync as readGolden } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";
import {
  circuitFromCsv,
  circuitToCsv,
  convergedCoefficients,
  evaluateCorner,
  fsum,
  readFluent,
  readOpenFoam,
  readWingSweep,
  referenceCircuit,
  runMonteCarlo,
  sweepAt,
  wilson,
  REFERENCE_SUMMARIES,
  DEFAULT_UNCERTAINTY,
} from "./index";
import { runGolden } from "./golden";

const VEH = { mass: 800, referenceArea: 1.5, friction: 1.5 };
const ENV = { airDensity: 1.225, gravity: 9.81 };
const A = { name: "Setup A", dragCoefficient: 0.8, downforceCoefficient: 2.5 };
const B = { name: "Setup B", dragCoefficient: 1.1, downforceCoefficient: 3.5 };

describe("engine", () => {
  it("reproduces Table 2", () => {
    const a = evaluateCorner(VEH, A, 30, 60, ENV);
    const b = evaluateCorner(VEH, B, 30, 60, ENV);
    expect(a.drag).toBeCloseTo(661.5, 1);
    expect(b.downforce).toBeCloseTo(2894.1, 1);
    expect(a.availableGrip).toBeCloseTo(14872.8, 1);
    expect(a.margin * 100).toBeCloseTo(23.94, 2);
    expect(b.margin * 100).toBeCloseTo(34.28, 2);
  });

  it("fsum is correctly rounded", () => {
    expect(fsum([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])).toBe(1);
    expect(fsum([1e100, 1, -1e100])).toBe(1);
    expect(fsum([])).toBe(0);
  });

  it("round-trips circuits through CSV", () => {
    const c = referenceCircuit("B");
    const again = circuitFromCsv(circuitToCsv(c), c.name);
    expect(again.segments.map((s) => s.radius)).toEqual(c.segments.map((s) => s.radius));
    expect(() => circuitFromCsv("name,kind,length_m,radius_m,speed_mps\nT1,corner,100,,30\n")).toThrow(/line 2/);
  });

  it("parses OpenFOAM and Fluent output", () => {
    const of = readOpenFoam("# Aref : 1.5\n# Time Cd Cl\n1 0.9 -2.0\n2 0.8 -2.5\n3 0.8 -2.5\n");
    expect(of.metadata.Aref).toBe("1.5");
    const c = convergedCoefficients(of, "Cd", "Cl", 0.67);
    expect(c.dragCoefficient).toBeCloseTo(0.8);
    expect(c.downforceCoefficient).toBeCloseTo(2.5);
    const fl = readFluent('"rfile"\n"Iteration" "cd-1" "cl-1"\n("Iteration" "cd-1" "cl-1")\n1 1.1 -3.5\n2 1.1 -3.5\n');
    expect(convergedCoefficients(fl, "cd-1", "cl-1", 1).downforceCoefficient).toBeCloseTo(3.5);
  });

  it("interpolates wing sweeps without extrapolating", () => {
    const s = readWingSweep("angle_deg,C_D,C_DF\n0,0.78,1.7\n8,0.9,2.9\n16,1.2,3.5\n");
    expect(sweepAt(s, 4).cd).toBeCloseTo(0.84);
    expect(() => sweepAt(s, 20)).toThrow(/outside/);
  });

  it("Wilson interval matches reference values", () => {
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeCloseTo(0.2366, 4);
    expect(hi).toBeCloseTo(0.7634, 4);
  });

  it("Monte Carlo is seeded and counts every sample", () => {
    const input = {
      summary: REFERENCE_SUMMARIES.B,
      vehicle: VEH,
      env: ENV,
      setups: [A, B],
      lateralAcceleration: 15,
      uncertainty: DEFAULT_UNCERTAINTY,
      samples: 200,
      seed: 7,
    };
    const r1 = runMonteCarlo(input);
    const r2 = runMonteCarlo(input);
    expect(r1).toEqual(r2);
    expect(Object.values(r1.winners).reduce((a, b) => a + b, 0)).toBe(200);
  });
});


describe("in-browser golden runner", () => {
  it("finds no mismatches in the shipped golden cases", () => {
    const data = JSON.parse(readGolden(resolvePath(__dirname, "../../../golden/cases.json"), "utf8"));
    const report = runGolden(data);
    expect(report.mismatches).toEqual([]);
    expect(report.compared).toBeGreaterThan(20000);
    expect(report.maxRelativeError).toBeLessThanOrEqual(report.tolerance);
  });
});
