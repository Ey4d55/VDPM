/**
 * Correctly rounded floating-point sum (Shewchuk's algorithm), the same
 * algorithm as Python's `math.fsum`. Using it keeps the browser engine
 * numerically aligned with the Python reference implementation.
 */
export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  for (let x of values) {
    let i = 0;
    for (let j = 0; j < partials.length; j++) {
      let y = partials[j]!;
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  // Sum partials from the top, with round-half-even correction (as CPython).
  let n = partials.length;
  if (n === 0) return 0;
  let hi = partials[--n]!;
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = partials[--n]!;
    hi = x + y;
    const yr = hi - x;
    lo = y - yr;
    if (lo !== 0) break;
  }
  if (n > 0 && ((lo < 0 && partials[n - 1]! < 0) || (lo > 0 && partials[n - 1]! > 0))) {
    const y = lo * 2;
    const x = hi + y;
    const yr = x - hi;
    if (y === yr) hi = x;
  }
  return hi;
}
