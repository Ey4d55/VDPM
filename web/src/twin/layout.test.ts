import { describe, expect, it } from "vitest";
import { referenceCircuit } from "../engine";
import { animationSpeed, buildLayout, poseAt } from "./layout";

describe("track twin layout", () => {
  for (const key of ["A", "B", "C"] as const) {
    it(`closes the lap of Circuit ${key} and keeps every radius`, () => {
      const c = referenceCircuit(key, 15);
      const l = buildLayout(c);
      expect(l.residual).toBeLessThan(1e-6 * l.lapLength);
      const turn = l.segments.reduce((a, s) => a + s.turn, 0);
      expect(turn).toBeCloseTo(2 * Math.PI, 12);
      l.segments.forEach((s, i) => {
        expect(s.radius).toBe(c.segments[i]!.radius);
        expect(s.length).toBe(c.segments[i]!.length);
        expect(s.drawnLength).toBeGreaterThan(0);
      });
      expect(l.lapLength).toBeCloseTo(c.segments.reduce((a, s) => a + s.length, 0), 9);
    });
  }

  it("moves continuously around the lap and uses segment speeds away from boundaries", () => {
    const c = referenceCircuit("C", 15);
    const l = buildLayout(c);
    const step = l.lapLength / 4000;
    let maxJump = 0;
    let prev = poseAt(l, 0);
    for (let k = 1; k <= 4000; k++) {
      const p = poseAt(l, k * step);
      maxJump = Math.max(maxJump, Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = p;
    }
    expect(maxJump).toBeLessThan(3 * step);
    const seg = l.segments[1]!;
    expect(animationSpeed(l, seg.start + seg.length / 2)).toBe(seg.speed);
  });
});
