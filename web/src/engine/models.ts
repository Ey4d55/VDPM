/**
 * Data models of the VDPM framework, mirroring `vdpm.models` (Python).
 * All quantities are SI: kg, m, s, N.
 */

export const STANDARD_GRAVITY = 9.81;

export interface Vehicle {
  /** Mass m, kg. */
  mass: number;
  /** Aerodynamic reference area A, m^2 (the area C_D and C_DF refer to). */
  referenceArea: number;
  /** Effective tyre-road friction coefficient mu. */
  friction: number;
}

export interface Environment {
  /** Air density rho, kg/m^3. */
  airDensity: number;
  /** Gravitational acceleration g, m/s^2. */
  gravity: number;
}

export interface AeroSetup {
  name: string;
  /** Drag coefficient C_D. */
  dragCoefficient: number;
  /** Downforce coefficient C_DF (positive for downforce; C_DF = -C_L). */
  downforceCoefficient: number;
  description?: string;
  source?: string;
}

export type SegmentKind = "straight" | "corner";

export interface Segment {
  kind: SegmentKind;
  /** Length along the racing line, m. */
  length: number;
  /** Reference operating speed, m/s. */
  speed: number;
  /** Corner radius, m (null for straights). */
  radius: number | null;
  name: string;
  grade?: number;
}

export interface Circuit {
  name: string;
  segments: Segment[];
  description?: string;
  provenance?: string;
  metadata?: Record<string, number | string>;
}

export const DEFAULT_ENVIRONMENT: Environment = { airDensity: 1.225, gravity: STANDARD_GRAVITY };

function positive(name: string, v: number): void {
  if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`${name} must be a finite positive number, got ${v}`);
}

function nonNegative(name: string, v: number): void {
  if (!(Number.isFinite(v) && v >= 0)) throw new RangeError(`${name} must be a finite non-negative number, got ${v}`);
}

export function validateVehicle(v: Vehicle): Vehicle {
  positive("mass", v.mass);
  positive("referenceArea", v.referenceArea);
  positive("friction", v.friction);
  return v;
}

export function validateEnvironment(e: Environment): Environment {
  positive("airDensity", e.airDensity);
  positive("gravity", e.gravity);
  return e;
}

export function validateSetup(s: AeroSetup): AeroSetup {
  if (!s.name) throw new RangeError("setup name must not be empty");
  positive("dragCoefficient", s.dragCoefficient);
  nonNegative("downforceCoefficient", s.downforceCoefficient);
  return s;
}

export function validateSegment(s: Segment): Segment {
  positive("length", s.length);
  positive("speed", s.speed);
  if (s.kind === "corner") {
    if (s.radius === null) throw new RangeError("a corner segment requires a radius");
    positive("radius", s.radius);
  } else if (s.radius !== null) {
    throw new RangeError("a straight segment must not have a radius");
  }
  return s;
}

export function validateCircuit(c: Circuit): Circuit {
  if (c.segments.length === 0) throw new RangeError("a circuit needs at least one segment");
  c.segments.forEach(validateSegment);
  if (!c.segments.some((s) => s.kind === "corner")) throw new RangeError("a circuit needs at least one corner");
  return c;
}

export const efficiency = (s: AeroSetup): number => s.downforceCoefficient / s.dragCoefficient;

export const corners = (c: Circuit): Segment[] => c.segments.filter((s) => s.kind === "corner");
export const straights = (c: Circuit): Segment[] => c.segments.filter((s) => s.kind === "straight");
