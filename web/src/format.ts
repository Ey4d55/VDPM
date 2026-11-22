/** Number formatting helpers. A thin space separates value and unit. */
export const UNIT_SPACE = " ";

export function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (v === Infinity) return "∞";
  if (v === -Infinity) return "−∞";
  const s = v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return s.replace("-", "−");
}

export const fmtUnit = (v: number | null | undefined, unit: string, digits = 2): string =>
  v === Infinity ? "no limit" : `${fmt(v, digits)}${UNIT_SPACE}${unit}`;

export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? "–" : `${fmt(v * 100, digits)}${UNIT_SPACE}%`;

export const kN = (n: number, digits = 2): string => fmtUnit(n / 1000, "kN", digits);

export const kmh = (mps: number, digits = 0): string => (mps === Infinity ? "no limit" : fmtUnit(mps * 3.6, "km/h", digits));
