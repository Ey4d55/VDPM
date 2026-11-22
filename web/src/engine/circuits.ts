/**
 * Circuits: summary statistics, synthetic reference layouts and the segment
 * CSV format, mirroring `vdpm.circuits`. See the Python module for the full
 * description of how the synthetic layouts are built from Fig. 5b.
 */
import { fsum } from "./fsum";
import { corners, straights, validateCircuit, type Circuit, type Segment } from "./models";

/** Lateral demand of the manuscript case study, 30^2 / 60 m/s^2. */
export const CASE_STUDY_LATERAL_ACCELERATION = (30.0 ** 2) / 60.0;

export interface CircuitSummary {
  key: "A" | "B" | "C";
  name: string;
  character: string;
  lengthM: number;
  turns: number;
  straightFraction: number;
  meanCornerRadiusM: number;
  elevationChangeM: number;
  lapTimeS: number;
}

/** Fig. 5b of the manuscript. */
export const REFERENCE_SUMMARIES: Record<"A" | "B" | "C", CircuitSummary> = {
  A: { key: "A", name: "Circuit A", character: "high-speed", lengthM: 5790, turns: 11, straightFraction: 0.72, meanCornerRadiusM: 320, elevationChangeM: 12, lapTimeS: 82.4 },
  B: { key: "B", name: "Circuit B", character: "balanced", lengthM: 4360, turns: 14, straightFraction: 0.48, meanCornerRadiusM: 210, elevationChangeM: 26, lapTimeS: 74.8 },
  C: { key: "C", name: "Circuit C", character: "technical", lengthM: 3610, turns: 18, straightFraction: 0.28, meanCornerRadiusM: 120, elevationChangeM: 38, lapTimeS: 69.5 },
};

export const circuitLength = (c: Circuit): number => fsum(c.segments.map((s) => s.length));
export const straightFraction = (c: Circuit): number => fsum(straights(c).map((s) => s.length)) / circuitLength(c);
export function meanCornerRadius(c: Circuit): number {
  const radii = corners(c).map((s) => s.radius as number);
  return fsum(radii) / radii.length;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function interleave(n: number, stride = 5): number[] {
  const s = gcd(stride, n) === 1 ? stride : 1;
  return Array.from({ length: n }, (_, i) => (i * s) % n);
}

/** Deterministic segment layout reproducing a summary exactly (see Python docs). */
export function syntheticCircuit(summary: CircuitSummary, lateralAcceleration = CASE_STUDY_LATERAL_ACCELERATION): Circuit {
  const n = summary.turns;
  if (n < 2) throw new RangeError("a synthetic circuit needs at least two turns");
  if (!(summary.straightFraction > 0 && summary.straightFraction < 1))
    throw new RangeError("straight fraction must lie strictly between 0 and 1");
  if (!(lateralAcceleration > 0)) throw new RangeError("lateral acceleration must be positive");

  const sorted = Array.from({ length: n }, (_, i) => summary.meanCornerRadiusM * (0.5 + i / (n - 1)));
  const radii = interleave(n).map((j) => sorted[j]!);
  const cornerTotal = (1.0 - summary.straightFraction) * summary.lengthM;
  const radiusSum = fsum(radii);
  const cornerLengths = radii.map((r) => (cornerTotal * r) / radiusSum);

  const straightTotal = summary.straightFraction * summary.lengthM;
  const weights = Array.from({ length: n }, (_, i) => 1.0 + 0.6 * Math.cos((2.0 * Math.PI * i) / n));
  const weightSum = fsum(weights);
  const straightLengths = weights.map((w) => (straightTotal * w) / weightSum);
  const straightSpeed = summary.lengthM / summary.lapTimeS;

  const segments: Segment[] = [];
  for (let i = 0; i < n; i++) {
    segments.push({
      kind: "corner",
      length: cornerLengths[i]!,
      speed: Math.sqrt(lateralAcceleration * radii[i]!),
      radius: radii[i]!,
      name: `T${i + 1}`,
    });
    segments.push({ kind: "straight", length: straightLengths[i]!, speed: straightSpeed, radius: null, name: `S${i + 1}` });
  }
  return {
    name: summary.name,
    segments,
    description: `${summary.character[0]!.toUpperCase()}${summary.character.slice(1)} reference circuit`,
    provenance:
      "Synthetic layout matching the summary statistics of Fig. 5b (length, turns, straight ratio, mean corner " +
      "radius). Segment radii, lengths and speeds are modelling assumptions, not measured track data. " +
      `Corner speeds use a_ref = ${lateralAcceleration.toFixed(2)} m/s².`,
    metadata: {
      key: summary.key,
      character: summary.character,
      turns: summary.turns,
      elevationChangeM: summary.elevationChangeM,
      lapTimeS: summary.lapTimeS,
      lateralAcceleration,
    },
  };
}

export const referenceCircuit = (key: "A" | "B" | "C", lateralAcceleration = CASE_STUDY_LATERAL_ACCELERATION): Circuit =>
  syntheticCircuit(REFERENCE_SUMMARIES[key], lateralAcceleration);

// --------------------------------------------------------------------------- //
// CSV: name,kind,length_m,radius_m,speed_mps,grade
// --------------------------------------------------------------------------- //

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse CSV text with a header row into objects keyed by column name. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("CSV is empty");
  const header = splitCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function num(value: string | undefined, column: string, line: number): number {
  const v = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(v))
    throw new Error(`line ${line}: column '${column}' is not a finite number: '${value ?? ""}'`);
  return v;
}

export function circuitFromCsv(text: string, name = "Imported circuit", provenance = ""): Circuit {
  const rows = parseCsv(text);
  const header = Object.keys(rows[0] ?? {});
  for (const col of ["kind", "length_m", "speed_mps"])
    if (!header.includes(col)) throw new Error(`CSV header must include kind, length_m, speed_mps; got ${header.join(", ")}`);
  const segments: Segment[] = rows.map((row, idx) => {
    const line = idx + 2;
    const kind = (row.kind ?? "").toLowerCase();
    if (kind !== "corner" && kind !== "straight") throw new Error(`line ${line}: kind must be 'corner' or 'straight'`);
    const radiusText = row.radius_m ?? "";
    const seg: Segment = {
      kind,
      length: num(row.length_m, "length_m", line),
      speed: num(row.speed_mps, "speed_mps", line),
      radius: radiusText.trim() === "" ? null : num(radiusText, "radius_m", line),
      name: row.name ?? "",
      grade: row.grade?.trim() ? num(row.grade, "grade", line) : 0,
    };
    return seg;
  });
  segments.forEach((s, i) => {
    try {
      validateSegmentWithLine(s);
    } catch (e) {
      throw new Error(`line ${i + 2}: ${(e as Error).message}`);
    }
  });
  return validateCircuit({ name, segments, provenance });
}

function validateSegmentWithLine(s: Segment): void {
  if (!(s.length > 0)) throw new Error("length must be positive");
  if (!(s.speed > 0)) throw new Error("speed must be positive");
  if (s.kind === "corner" && (s.radius === null || !(s.radius > 0))) throw new Error("a corner requires a positive radius");
  if (s.kind === "straight" && s.radius !== null) throw new Error("a straight must not have a radius");
}

export function circuitToCsv(c: Circuit): string {
  const rows = ["name,kind,length_m,radius_m,speed_mps,grade"];
  for (const s of c.segments)
    rows.push([s.name, s.kind, s.length, s.radius ?? "", s.speed, s.grade ?? 0].join(","));
  return rows.join("\n") + "\n";
}
