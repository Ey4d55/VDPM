/**
 * Physics-derived explanations, mirroring `vdpm.explain`. Nothing here is a
 * learned model: every statement follows in closed form from the equations.
 *
 * Margin sensitivities: with R = 1 + M = mu r (g / v^2 + k / m), a = g / v^2 and
 * b = k / m, the analytic dM/dln(x) = R * dlnR/dln(x) (see the Python docs).
 */
import { DEFAULT_ENVIRONMENT, type AeroSetup, type Environment, type Vehicle } from "./models";
import { downforceFactor } from "./physics";
import { best, contributions, cornerLabel, ordered, type Ranking, type RankedSetup } from "./scoring";

export const SENSITIVITY_PARAMETERS = [
  "friction",
  "radius",
  "speed",
  "mass",
  "airDensity",
  "downforceCoefficient",
  "referenceArea",
  "gravity",
  "dragCoefficient",
] as const;
export type SensitivityParameter = (typeof SENSITIVITY_PARAMETERS)[number];

export function marginSensitivities(
  vehicle: Vehicle,
  setup: AeroSetup,
  speed: number,
  radius: number,
  env: Environment = DEFAULT_ENVIRONMENT,
): Record<SensitivityParameter, number> {
  const k = downforceFactor(env.airDensity, setup.downforceCoefficient, vehicle.referenceArea);
  const a = env.gravity / (speed * speed);
  const b = k / vehicle.mass;
  const ratio = vehicle.friction * radius * (a + b);
  const aero = b / (a + b);
  const mech = a / (a + b);
  return {
    friction: ratio * 1.0,
    radius: ratio * 1.0,
    speed: ratio * (-2.0 * mech),
    mass: ratio * -aero,
    airDensity: ratio * aero,
    downforceCoefficient: ratio * aero,
    referenceArea: ratio * aero,
    gravity: ratio * mech,
    dragCoefficient: ratio * 0.0,
  };
}

/** Drag share s* = w_D / (w_D + w_G) at which two eligible setups tie (null if never in [0, 1]). */
export function weightFlipPoint(first: RankedSetup, second: RankedSetup, marginWeight: number): number | null {
  if (!first.eligible || !second.eligible) throw new RangeError("both setups must be eligible");
  const dd = first.dragPenalty! - second.dragPenalty!;
  const dq = first.gripPenalty! - second.gripPenalty!;
  const dz = first.marginPenalty! - second.marginPenalty!;
  const rest = 1.0 - marginWeight;
  const slope = rest * (dd - dq);
  const intercept = rest * dq + marginWeight * dz;
  if (Math.abs(slope) < 1e-15) return null;
  const s = -intercept / slope;
  return s >= 0 && s <= 1 ? s : null;
}

export type FindingKind = "excluded" | "binding-corner" | "not-grip-limited" | "no-eligible" | "recommendation" | "runner-up";

export interface Finding {
  kind: FindingKind;
  setup: string | null;
  text: string;
  data: Record<string, number | string | null>;
}

const kn = (n: number): string => `${(n / 1000).toFixed(2)} kN`;
const limit = (v: number, unit: string, digits: number): string =>
  Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : "no limit";

export function explainRanking(ranking: Ranking): Finding[] {
  const out: Finding[] = [];
  const w = ranking.weights;
  for (const entry of ranking.entries) {
    const ev = entry.evaluation;
    const c = ev.corners[ev.bindingCorner]!;
    const label = `${cornerLabel(ev, ev.bindingCorner)} (r = ${c.radius.toFixed(0)} m, v = ${c.speed.toFixed(1)} m/s)`;
    if (!entry.eligible && ranking.gate === "strict") {
      out.push({
        kind: "excluded",
        setup: entry.name,
        text:
          `${entry.name} is excluded: at ${label} it needs ${kn(c.requiredForce)} of lateral force but has only ` +
          `${kn(c.availableGrip)} of grip (margin ${(c.margin * 100).toFixed(1)}%). ${ev.failedCorners.length} of ` +
          `${ev.corners.length} corners fail.`,
        data: { bindingCorner: ev.bindingCorner, margin: c.margin, failedCorners: ev.failedCorners.length },
      });
    } else {
      out.push({
        kind: "binding-corner",
        setup: entry.name,
        text:
          `${entry.name}: the tightest point is ${label} with margin ${(c.margin * 100).toFixed(1)}%; it stays ` +
          `feasible for friction >= ${c.minFriction.toFixed(3)}, mass <= ${limit(c.maxMass, "kg", 0)}, ` +
          `C_DF >= ${c.minDownforceCoefficient.toFixed(3)}.`,
        data: {
          bindingCorner: ev.bindingCorner,
          margin: c.margin,
          minFriction: c.minFriction,
          maxMass: c.maxMass,
          minDownforceCoefficient: c.minDownforceCoefficient,
        },
      });
    }
    const notLimited = ev.corners.filter((x) => !x.gripLimited).length;
    if (notLimited > 0) {
      out.push({
        kind: "not-grip-limited",
        setup: entry.name,
        text:
          `${entry.name}: ${notLimited} of ${ev.corners.length} corners lie beyond the critical radius r* = ` +
          `${ev.corners[0]!.criticalRadius.toFixed(0)} m, where the simplified model sets no grip-limited speed; ` +
          "those corners cannot fail the gate.",
        data: { count: notLimited, criticalRadius: ev.corners[0]!.criticalRadius },
      });
    }
  }
  const ok = ordered(ranking).filter((e) => e.eligible);
  const top = best(ranking);
  if (!top) {
    out.push({ kind: "no-eligible", setup: null, text: "No setup satisfies every corner, so none is recommended.", data: {} });
    return out;
  }
  const parts = contributions(top, w)!;
  out.push({
    kind: "recommendation",
    setup: top.name,
    text:
      `${top.name} ranks first with VDPM score ${top.score!.toFixed(4)} (drag ${parts.drag.toFixed(4)} + grip ` +
      `${parts.grip.toFixed(4)} + margin ${parts.margin.toFixed(4)}; weights ${w.drag.toFixed(2)} / ` +
      `${w.grip.toFixed(2)} / ${w.margin.toFixed(2)}).`,
    data: { score: top.score, ...parts },
  });
  const nonMargin = w.drag + w.grip;
  const share = nonMargin > 0 ? w.drag / nonMargin : null;
  for (const runner of ok.slice(1)) {
    const s = weightFlipPoint(top, runner, w.margin);
    out.push({
      kind: "runner-up",
      setup: runner.name,
      text:
        s === null
          ? `${runner.name} scores ${runner.score!.toFixed(4)} and stays behind ${top.name} for every split of weight between drag and grip.`
          : `${runner.name} scores ${runner.score!.toFixed(4)}; it would overtake ${top.name} if the drag share of weight, ` +
            `w_D / (w_D + w_G), crossed ${s.toFixed(3)}${share === null ? "." : ` (currently ${share.toFixed(3)}).`}`,
      data: { score: runner.score, flipStraightFraction: s },
    });
  }
  return out;
}
