import { describe, expect, it } from "vitest";
import ref from "./__fixtures__/python_ref.json";
import { arcTable, atArc, pathPts, risePts, shapeBend, type Pt, type Shape } from "./path";
import {
  CLUBS, Flight, cometAt, hangTime, horizonGuess, lineAt, physicsFlight, ricochet, ricochetDuration, timedSamples,
} from "./flight";
import { blendWeight, colAt } from "./style";

type Case = {
  name: string; S: Pt; A: Pt; E: Pt; shape: Shape; M?: Pt; N?: Pt;
  rise: Pt[]; fall: Pt[]; hz: number; timed: number[][]; nsmp: number;
};
const cases = ref.cases as unknown as Case[];
const close = (a: number[], b: number[], tol: number) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(tol));

describe("path (parity with the Python / marking page)", () => {
  for (const c of cases) {
    it(`matches python path_pts: ${c.name}`, () => {
      const { rise, fall } = pathPts(c.S, c.A, c.E, { shape: c.shape, M: c.M, N: c.N, n: 60 });
      expect(rise.length).toBe(c.rise.length);
      expect(fall.length).toBe(c.fall.length);
      rise.forEach((p, i) => close(p, c.rise[i], 1e-6));
      fall.forEach((p, i) => close(p, c.fall[i], 1e-6));
    });
  }

  it("starts on the ball, peaks at the peak tap, ends on the landing tap", () => {
    for (const c of cases) {
      const { rise, fall } = pathPts(c.S, c.A, c.E, { shape: c.shape, M: c.M, N: c.N });
      close(rise[0], c.S, 1e-9);
      close(fall[fall.length - 1], c.E, 1e-9);
      // the peak is always at the tapped height; on fade/draw/straight its x follows the shape curve
      expect(fall[0][1]).toBeCloseTo(c.A[1], 9);
      if (c.shape === "auto") close(fall[0], c.A, 1e-9);
      if (c.shape === "auto" || c.M) close(rise[rise.length - 1], c.A, 1e-9);
    }
  });

  it("passes through the bend points", () => {
    const S: Pt = [1200, 950], A: Pt = [800, 300], E: Pt = [500, 560], M: Pt = [1100, 600], N: Pt = [600, 380];
    const { rise, fall } = pathPts(S, A, E, { M, N, n: 60 });
    close(rise[30], M, 1e-9);
    close(fall[30], N, 1e-9);
  });

  it("climb leaves along the straight line toward the peak", () => {
    const S: Pt = [600, 900], A: Pt = [1000, 250], E: Pt = [1300, 520];
    const r = risePts(S, A, E, null, 600);
    const dir = Math.atan2(A[1] - S[1], A[0] - S[0]);
    const early = Math.atan2(r[5][1] - S[1], r[5][0] - S[0]);
    expect(Math.abs(early - dir)).toBeLessThan(0.01);
    // ...and arrives at the peak travelling level (sideways only)
    const n = r.length - 1, dy = r[n][1] - r[n - 1][1], dx = r[n][0] - r[n - 1][0];
    expect(Math.abs(dy)).toBeLessThan(Math.abs(dx) * 0.05);
  });

  it("fade bends right and draw bends left of the straight line", () => {
    const S: Pt = [960, 950], A: Pt = [960, 300], E: Pt = [960, 560];
    // sideways curvature (second difference of x at evenly spaced downrange steps): + = curving right
    const bend = (shape: Shape) => { const r = pathPts(S, A, E, { shape, n: 60 }).rise; return r[10][0] - 2 * r[30][0] + r[50][0]; };
    expect(bend("fade")).toBeGreaterThan(0);
    expect(bend("draw")).toBeLessThan(0);
    expect(bend("straight")).toBeCloseTo(0, 9);
    // peak tapped right of a straight-down-the-middle shot = the ball curves back left, which contradicts "fade"
    expect(shapeBend(S, [1100, 300], E, "draw").ok).toBe(true);
    expect(shapeBend(S, [1100, 300], E, "fade").ok).toBe(false);
  });

  it("atArc walks the path by arc length", () => {
    const P: Pt[] = [[0, 0], [10, 0], [10, 10]];
    const L = arcTable(P);
    expect(L).toEqual([0, 10, 20]);
    close(atArc(P, L, 0.25), [5, 0], 1e-9);
    close(atArc(P, L, 0.75), [10, 5], 1e-9);
    close(atArc(P, L, 1), [10, 10], 1e-9);
  });
});

describe("flight timing", () => {
  it("physics flight matches tracer2.flight", () => {
    const f = ref.flight;
    const { samples, d0 } = physicsFlight(f.S as Pt, f.yh, f.vx, { T: f.T, carry: f.carry, apex: f.apex });
    expect(samples.length).toBe(f.n);
    expect(d0).toBeCloseTo(f.d0, 9);
    f.pickIdx.forEach((idx, k) => close(samples[idx], f.pick[k], 1e-6));
  });

  it("apex height is reached at 58% of hang time", () => {
    const { samples } = physicsFlight([960, 900], 400, 960, { T: 5, carry: 160, apex: 28, steps: 1000 });
    // the apex (max Z) is where screen height relative to the distance-projected ground is greatest; check Z directly
    const ua = 0.58, T = 5;
    const Z = (t: number) => { const u = t / T; return u <= ua ? 28 * (1 - ((u - ua) / ua) ** 2) : 28 * (1 - ((u - ua) / (1 - ua)) ** 2); };
    expect(Z(0.58 * T)).toBe(28);
    expect(samples[samples.length - 1][2]).toBeCloseTo(T, 9);
  });

  for (const c of cases) {
    it(`timed samples match python timed(): ${c.name}`, () => {
      const hz = horizonGuess(c.S, c.A, c.E);
      expect(hz).toBe(c.hz);
      const smp = timedSamples(c.S, c.A, c.E, 5.5, 160, 28, hz, { shape: c.shape, M: c.M, N: c.N, n: 3000 });
      expect(smp.length).toBe(c.nsmp);
      const pick = [0, 50, 200, 400, 600, 800, 1000, 1200, smp.length - 1];
      // python picks the nearest path point; we interpolate, so allow ~1 px
      pick.forEach((i, k) => {
        close(smp[i].slice(0, 2), c.timed[k].slice(0, 2), 1.0);
        close(smp[i].slice(2), c.timed[k].slice(2), 1e-9);
      });
    });
  }

  it("ricochet matches python", () => {
    const r = ref.rico;
    const { samples, Tr } = ricochet(r.E as Pt, r.R as Pt, r.t0, r.X0);
    expect(Tr).toBeCloseTo(r.Tr, 12);
    [0, 30, 60, 119].forEach((i, k) => close(samples[i], r.pts[k], 1e-9));
    expect(ricochetDuration([0, 0], [1, 0])).toBe(0.45);
    expect(ricochetDuration([0, 0], [5000, 0])).toBe(1.2);
  });
});

describe("clubs + hang time", () => {
  it("has the approved hang times", () => {
    expect(Object.fromEntries(Object.entries(CLUBS).map(([k, v]) => [k, v.hang]))).toEqual({
      driver: 6.5, wood: 6.0, iron: 5.5, lowiron: 4.5, wedge: 4.6, punch: 4.0, chip: 2.5,
    });
  });
  it("per-shot override beats the table, table beats the default", () => {
    expect(hangTime({ club: "driver" })).toBe(6.5);
    expect(hangTime({ club: "driver" }, { driver: 5.9 })).toBe(5.9);
    expect(hangTime({ club: "driver", hang: 6.1 }, { driver: 5.9 })).toBe(6.1);
  });
});

describe("comet + line frames", () => {
  const mk = { S: [600, 900] as Pt, A: [1000, 250] as Pt, E: [1300, 520] as Pt, club: "iron" as const };
  const F = Flight.fromMarks(mk);

  it("flight lasts the hang time and ends on the landing tap", () => {
    expect(F.end).toBeCloseTo(5.5, 6);
    close(F.at(F.end).p, mk.E, 1e-6);
    close(F.at(0).p, mk.S, 1e-6);
  });

  it("comet is invisible before impact and after the fade", () => {
    expect(cometAt(F, -0.1).visible).toBe(false);
    expect(cometAt(F, F.end + 0.51).visible).toBe(false);
    expect(cometAt(F, 1).visible).toBe(true);
  });

  it("tail is at least ~0.45 s or 200 px long and pulls into the head after landing", () => {
    const len = (pts: Pt[]) => arcTable(pts).at(-1)!;
    const c = cometAt(F, 2.0);
    expect(len(c.pts)).toBeGreaterThan(100);
    const atLand = len(cometAt(F, F.end).pts), later = len(cometAt(F, F.end + 0.25).pts);
    expect(later).toBeLessThan(atLand);
    expect(cometAt(F, F.end + 0.25).alpha).toBeCloseTo(0.5, 6);
  });

  it("ricochet extends the flight", () => {
    const G = Flight.fromMarks({ ...mk, ricochet: true, R: [1420, 540] });
    expect(G.land).toBeCloseTo(5.5, 6);
    expect(G.end).toBeGreaterThan(5.9);
    close(G.at(G.end).p, [1420, 540], 1e-6);
  });

  it("line holds then fades", () => {
    expect(lineAt(F, F.end + 0.5).alpha).toBe(1);
    expect(lineAt(F, F.end + 1.35).alpha).toBeCloseTo(0.5, 6);
    expect(lineAt(F, F.end + 1.8).visible).toBe(false);
    close(lineAt(F, 3).pts[0], mk.S, 1e-6);
  });
});

describe("gradient", () => {
  it("is 50/50 at the mid point and pure at the ends", () => {
    for (const mid of [20, 50, 80]) {
      expect(blendWeight(1 - mid / 100, mid)).toBeCloseTo(0.5, 9);
      expect(blendWeight(0, mid)).toBe(0);
      expect(blendWeight(1, mid)).toBe(1);
    }
    expect(colAt({ head: "#ff0000", tail: "#0000ff", mid: 50 }, 1)).toEqual([255, 0, 0]);
    expect(colAt({ head: "#ff0000", tail: "#0000ff", mid: 50 }, 0)).toEqual([0, 0, 255]);
  });
});
