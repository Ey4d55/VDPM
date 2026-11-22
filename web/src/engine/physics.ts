/**
 * Governing equations (manuscript Section 4), mirroring `vdpm.physics`.
 *
 * Each function transcribes one relation, with the same operation order as the
 * Python reference so that both engines agree to ~1e-15 relative error.
 * `Infinity` means "not limited by grip in the simplified model".
 */
import { DEFAULT_ENVIRONMENT, type AeroSetup, type Environment, type Vehicle } from "./models";

/** q = rho v^2 / 2, Pa. */
export const dynamicPressure = (rho: number, v: number): number => 0.5 * rho * v * v;

/** Eq. 4.1: F_D = rho v^2 C_D A / 2, N. */
export const drag = (rho: number, v: number, cd: number, area: number): number => dynamicPressure(rho, v) * cd * area;

/** Eq. 4.2: F_DF = rho v^2 C_DF A / 2, N. */
export const downforce = (rho: number, v: number, cdf: number, area: number): number =>
  dynamicPressure(rho, v) * cdf * area;

/** k = rho C_DF A / 2 so that F_DF = k v^2, kg/m. */
export const downforceFactor = (rho: number, cdf: number, area: number): number => 0.5 * rho * cdf * area;

/** Eq. 4.3: F_c = m v^2 / r, N. */
export const requiredLateralForce = (m: number, v: number, r: number): number => (m * v * v) / r;

/** Eq. 4.4: F_lat,max = mu (m g + F_DF), N. */
export const availableLateralGrip = (mu: number, m: number, g: number, fdf: number): number => mu * (m * g + fdf);

/** Eq. 4.5: M = (F_lat,max - F_c) / F_c. */
export function safetyMargin(available: number, required: number): number {
  if (required <= 0) throw new RangeError("required lateral force must be positive");
  return (available - required) / required;
}

/** a_lat,max = mu (g + F_DF / m), m/s^2. */
export const maxLateralAcceleration = (mu: number, g: number, fdf: number, m: number): number => mu * (g + fdf / m);

/** Critical radius r* = m / (mu k), m. */
export const criticalRadius = (m: number, mu: number, k: number): number => (mu * k <= 0 ? Infinity : m / (mu * k));

/** Grip-limited cornering speed, m/s (Infinity when r >= r*). */
export function maxCorneringSpeed(m: number, r: number, mu: number, g: number, k: number): number {
  const denom = m / r - mu * k;
  if (denom <= 0) return Infinity;
  return Math.sqrt((mu * m * g) / denom);
}

/** Smallest feasible radius at speed v, m. */
export const minCornerRadius = (m: number, v: number, mu: number, g: number, fdf: number): number =>
  (m * v * v) / availableLateralGrip(mu, m, g, fdf);

/** mu_min = F_c / (m g + F_DF). */
export const minFriction = (m: number, g: number, fdf: number, required: number): number => required / (m * g + fdf);

/** Smallest C_DF that keeps the corner feasible (clipped at 0). */
export function minDownforceCoefficient(
  m: number,
  v: number,
  r: number,
  mu: number,
  g: number,
  rho: number,
  area: number,
): number {
  const required = requiredLateralForce(m, v, r);
  const needed = required / mu - m * g;
  return Math.max(0, needed / (dynamicPressure(rho, v) * area));
}

/** Largest mass that keeps the corner feasible, kg (Infinity if mechanical grip suffices). */
export function maxMass(v: number, r: number, mu: number, g: number, fdf: number): number {
  const excess = (v * v) / r - mu * g;
  if (excess <= 0) return Infinity;
  return (mu * fdf) / excess;
}

export interface CornerResult {
  setup: string;
  speed: number;
  radius: number;
  drag: number;
  downforce: number;
  requiredForce: number;
  availableGrip: number;
  reserveForce: number;
  margin: number;
  feasible: boolean;
  maxLateralAcceleration: number;
  requiredLateralAcceleration: number;
  maxCorneringSpeed: number;
  criticalRadius: number;
  gripLimited: boolean;
  minRadius: number;
  minFriction: number;
  minDownforceCoefficient: number;
  maxMass: number;
}

/** Evaluate one setup at one cornering state (Sec. 4.1 to 4.5). */
export function evaluateCorner(
  vehicle: Vehicle,
  setup: AeroSetup,
  speed: number,
  radius: number,
  env: Environment = DEFAULT_ENVIRONMENT,
): CornerResult {
  if (!(Number.isFinite(speed) && speed > 0)) throw new RangeError(`speed must be finite and positive, got ${speed}`);
  if (!(Number.isFinite(radius) && radius > 0))
    throw new RangeError(`radius must be finite and positive, got ${radius}`);
  const m = vehicle.mass;
  const mu = vehicle.friction;
  const g = env.gravity;
  const area = vehicle.referenceArea;
  const rho = env.airDensity;
  const fd = drag(rho, speed, setup.dragCoefficient, area);
  const fdf = downforce(rho, speed, setup.downforceCoefficient, area);
  const fc = requiredLateralForce(m, speed, radius);
  const grip = availableLateralGrip(mu, m, g, fdf);
  const k = downforceFactor(rho, setup.downforceCoefficient, area);
  const rStar = criticalRadius(m, mu, k);
  const margin = safetyMargin(grip, fc);
  return {
    setup: setup.name,
    speed,
    radius,
    drag: fd,
    downforce: fdf,
    requiredForce: fc,
    availableGrip: grip,
    reserveForce: grip - fc,
    margin,
    feasible: margin >= 0,
    maxLateralAcceleration: maxLateralAcceleration(mu, g, fdf, m),
    requiredLateralAcceleration: (speed * speed) / radius,
    maxCorneringSpeed: maxCorneringSpeed(m, radius, mu, g, k),
    criticalRadius: rStar,
    gripLimited: radius < rStar,
    minRadius: minCornerRadius(m, speed, mu, g, fdf),
    minFriction: minFriction(m, g, fdf, fc),
    minDownforceCoefficient: minDownforceCoefficient(m, speed, radius, mu, g, rho, area),
    maxMass: maxMass(speed, radius, mu, g, fdf),
  };
}
