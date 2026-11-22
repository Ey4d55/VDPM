/**
 * CFD result import (OpenFOAM forceCoeffs, Fluent report files, wing sweeps),
 * mirroring `vdpm.cfd_io`. Downforce coefficient = lift_sign * C_L with
 * lift_sign = -1 for the usual upward-positive lift convention.
 */
import { fsum } from "./fsum";
import { parseCsv } from "./circuits";

export interface ForceHistory {
  format: "openfoam" | "fluent";
  indexName: string;
  index: number[];
  columns: Record<string, number[]>;
  metadata: Record<string, string>;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function numericRows(lines: string[], width: number): number[][] {
  const rows: number[][] = [];
  for (const raw of lines) {
    const t = raw.replace(/,/g, " ").trim().split(/\s+/);
    if (t.length < width || !t.slice(0, width).every((x) => NUMBER.test(x))) continue;
    rows.push(t.slice(0, width).map(Number));
  }
  if (rows.length === 0) throw new Error("no numeric data rows found");
  return rows;
}

function toHistory(format: ForceHistory["format"], header: string[], rows: number[][], metadata: Record<string, string>): ForceHistory {
  const columns: Record<string, number[]> = {};
  header.slice(1).forEach((h, j) => (columns[h] = rows.map((r) => r[j + 1]!)));
  return { format, indexName: header[0]!, index: rows.map((r) => r[0]!), columns, metadata };
}

export function readOpenFoam(text: string): ForceHistory {
  let header: string[] | null = null;
  const metadata: Record<string, string> = {};
  const data: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith("#")) {
      const body = s.replace(/^#+/, "").trim();
      const tokens = body.split(/\s+/);
      if (tokens[0] === "Time" || tokens[0] === "Iteration") header = tokens;
      else if (body.includes(":")) {
        const [k, ...rest] = body.split(":");
        metadata[k!.trim()] = rest.join(":").trim();
      }
    } else data.push(s);
  }
  if (!header) throw new Error("no '# Time ...' header line found in OpenFOAM file");
  return toHistory("openfoam", header, numericRows(data, header.length), metadata);
}

export function readFluent(text: string): ForceHistory {
  let header: string[] | null = null;
  let title = "";
  const data: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith('"') || s.startsWith("(")) {
      const names = [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
      if (names.length === 1 && !title) title = names[0]!;
      else if (names.length > 1) header = names;
    } else data.push(s);
  }
  if (!header) throw new Error("no quoted column header found in Fluent report file");
  return toHistory("fluent", header, numericRows(data, header.length), title ? { title } : {});
}

/** Detect the format and parse. */
export function readForceHistory(text: string): ForceHistory {
  const head = text.trimStart();
  return head.startsWith('"') || head.startsWith("(") ? readFluent(text) : readOpenFoam(text);
}

export function guessColumns(h: ForceHistory): { drag: string | null; lift: string | null } {
  const names = Object.keys(h.columns);
  const find = (re: RegExp) => names.find((n) => re.test(n)) ?? null;
  return { drag: find(/^cd$/i) ?? find(/cd|drag/i), lift: find(/^cl$/i) ?? find(/cl|lift|down/i) };
}

export interface Converged {
  dragCoefficient: number;
  downforceCoefficient: number;
  dragStd: number;
  downforceStd: number;
  dragDrift: number;
  downforceDrift: number;
  samples: number;
}

function stats(values: number[]): [number, number, number] {
  const mean = fsum(values) / values.length;
  const std = values.length > 1 ? Math.sqrt(fsum(values.map((v) => (v - mean) ** 2)) / values.length) : 0;
  const half = Math.floor(values.length / 2);
  if (half === 0) return [mean, std, 0];
  const a = fsum(values.slice(0, half)) / half;
  const b = fsum(values.slice(half)) / (values.length - half);
  return [mean, std, mean !== 0 ? Math.abs(b - a) / Math.abs(mean) : Infinity];
}

export function convergedCoefficients(h: ForceHistory, dragCol: string, liftCol: string, window = 0.1, liftSign: 1 | -1 = -1): Converged {
  if (!(window > 0 && window <= 1)) throw new RangeError("window must lie in (0, 1]");
  const cd = h.columns[dragCol];
  const cl = h.columns[liftCol];
  if (!cd || !cl) throw new Error(`column not found; available: ${Object.keys(h.columns).join(", ")}`);
  const n = Math.max(1, Math.round(cd.length * window));
  const [cdm, cds, cdd] = stats(cd.slice(-n));
  const [dfm, dfs, dfd] = stats(cl.slice(-n).map((v) => liftSign * v));
  return { dragCoefficient: cdm, downforceCoefficient: dfm, dragStd: cds, downforceStd: dfs, dragDrift: cdd, downforceDrift: dfd, samples: n };
}

export interface WingSweep {
  angles: number[];
  cd: number[];
  cdf: number[];
}

export function readWingSweep(text: string): WingSweep {
  const rows = parseCsv(text)
    .map((r) => [Number(r.angle_deg), Number(r.C_D), Number(r.C_DF)] as const)
    .sort((a, b) => a[0] - b[0]);
  if (rows.length < 2 || rows.some((r) => r.some((x) => !Number.isFinite(x))))
    throw new Error("sweep CSV needs columns angle_deg,C_D,C_DF and at least two numeric rows");
  for (let i = 1; i < rows.length; i++) if (rows[i]![0] <= rows[i - 1]![0]) throw new Error("sweep angles must be distinct");
  return { angles: rows.map((r) => r[0]), cd: rows.map((r) => r[1]), cdf: rows.map((r) => r[2]) };
}

/** Linear interpolation; throws outside the measured range (no extrapolation). */
export function sweepAt(s: WingSweep, angle: number): { cd: number; cdf: number } {
  const lo = s.angles[0]!;
  const hi = s.angles[s.angles.length - 1]!;
  if (angle < lo || angle > hi) throw new RangeError(`angle ${angle} deg is outside the measured range [${lo}, ${hi}] deg`);
  let i = s.angles.findIndex((a, j) => j < s.angles.length - 1 && angle >= a && angle <= s.angles[j + 1]!);
  if (i < 0) i = s.angles.length - 2;
  const t = (angle - s.angles[i]!) / (s.angles[i + 1]! - s.angles[i]!);
  return { cd: s.cd[i]! + t * (s.cd[i + 1]! - s.cd[i]!), cdf: s.cdf[i]! + t * (s.cdf[i + 1]! - s.cdf[i]!) };
}
