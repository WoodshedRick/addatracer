// Shot path geometry, ported from the original marking page / comet_marks.py.
// All points are [x, y] in video pixels (y grows downwards). The JS here matches the Python
// path maths point-for-point (see path.test.ts, which checks against python_ref.json).

export type Pt = [number, number];
export type Shape = "auto" | "straight" | "fade" | "draw";

const vsub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const vlen = (v: Pt) => Math.hypot(v[0], v[1]);
const vsc = (v: Pt, k: number): Pt => [v[0] * k, v[1] * k];
const vunit = (v: Pt): Pt => {
  const l = vlen(v);
  return l > 1e-9 ? [v[0] / l, v[1] / l] : [0, 0];
};

export function cubic(P: Pt[], t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
    u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1],
  ];
}

/** Cubic Hermite from P0 to P1 with tangents T0, T1; n + 1 points. */
export function herm(P0: Pt, P1: Pt, T0: Pt, T1: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, t2 = t * t, t3 = t2 * t;
    const a = 2 * t3 - 3 * t2 + 1, b = t3 - 2 * t2 + t, c = -2 * t3 + 3 * t2, d = t3 - t2;
    out.push([a * P0[0] + b * T0[0] + c * P1[0] + d * T1[0], a * P0[1] + b * T0[1] + c * P1[1] + d * T1[1]]);
  }
  return out;
}

/** Sideways direction the ball travels at the peak (one direction for both halves, so no hook at the top). */
export function apexDir(S: Pt, A: Pt, E: Pt): 1 | -1 {
  const dx = E[0] - S[0];
  if (Math.abs(dx) > 0.04 * vlen(vsub(E, S))) return dx > 0 ? 1 : -1;
  return A[0] >= S[0] ? 1 : -1;
}

/** Ball -> peak: leaves along the straight line toward the peak (or bend point M), rounds off only near the top. */
export function risePts(S: Pt, A: Pt, E: Pt, M: Pt | null | undefined, n: number): Pt[] {
  const ch = vsub(A, S), L = vlen(ch);
  const Ta: Pt = [apexDir(S, A, E) * (0.5 * Math.abs(ch[0]) + 0.12 * L), 0];
  if (!M) return herm(S, A, ch, Ta, n);
  const tm = vunit(ch), m1 = vlen(vsub(M, S)), m2 = vlen(vsub(A, M)), k = Math.floor(n / 2);
  return herm(S, M, vsub(M, S), vsc(tm, m1), k).concat(
    herm(M, A, vsc(tm, m2), vsc(Ta, m2 / Math.max(L, 1e-9)), n - k).slice(1),
  );
}

/** Peak -> landing through bend point N: leaves the peak level, then heads down through N into the landing. */
export function fallBendPts(S: Pt, A: Pt, E: Pt, N: Pt, n: number): Pt[] {
  const d = apexDir(S, A, E), a1 = vlen(vsub(N, A)), a2 = vlen(vsub(E, N)), te = vunit(vsub(E, A));
  const k = Math.floor(n / 2);
  return herm(A, N, [d * 0.8 * a1, 0], vsc(te, a1), k).concat(herm(N, E, vsc(te, a2), vsub(E, N), n - k).slice(1));
}

/** Downrange fraction where the ball peaks (shape-controlled paths). */
export const SA = 0.57;

/** Sideways bend for straight / fade / draw. `ok` = the taps agree with the chosen shape. */
export function shapeBend(S: Pt, A: Pt, E: Pt, shape: Shape): { a: number; b: number; ok: boolean } {
  const dx = E[0] - S[0];
  if (shape === "straight") return { a: dx, b: 0, ok: true };
  let b = (A[0] - S[0] - SA * dx) / (SA * SA - SA);
  const want = shape === "fade" ? 1 : -1, kmin = 0.18 * Math.abs(dx) + 40, ok = b * want >= kmin;
  if (!ok) b = want * kmin; // marks disagree with the chosen shape: keep the shape
  return { a: dx - b, b, ok };
}

export interface PathOpts {
  shape?: Shape;
  /** optional bend point between ball and peak */
  M?: Pt | null;
  /** optional bend point between peak and landing */
  N?: Pt | null;
  /** points per half (rise / fall); the marking page used 60, the renderer 3000 */
  n?: number;
}

/** Rise (S -> A) and fall (A -> E) point lists, n + 1 points each. */
export function pathPts(S: Pt, A: Pt, E: Pt, opts: PathOpts = {}): { rise: Pt[]; fall: Pt[] } {
  const { shape = "auto", M = null, N = null, n = 60 } = opts;
  let rise: Pt[] = [], fall: Pt[] = [];
  if (shape === "straight" || shape === "fade" || shape === "draw") {
    const { a, b } = shapeBend(S, A, E, shape);
    const X = (s: number) => S[0] + a * s + b * s * s;
    const cy = (P: number[], t: number) =>
      (1 - t) ** 3 * P[0] + 3 * (1 - t) ** 2 * t * P[1] + 3 * (1 - t) * t * t * P[2] + t ** 3 * P[3];
    const ry = [S[1], S[1] - 0.7 * (S[1] - A[1]), A[1], A[1]];
    const fy = [A[1], A[1], E[1] - 0.55 * (E[1] - A[1]), E[1]];
    for (let i = 0; i <= n; i++) rise.push([X((SA * i) / n), cy(ry, i / n)]);
    for (let i = 0; i <= n; i++) fall.push([X(SA + ((1 - SA) * i) / n), cy(fy, i / n)]);
  } else {
    const d = Math.sign(E[0] - A[0]) || Math.sign(A[0] - S[0]) || 1;
    const h2 = 0.4 * Math.abs(E[0] - A[0]) + 10;
    const fc: Pt[] = [A, [A[0] + d * h2, A[1]], [E[0] - 0.1 * (E[0] - A[0]), E[1] - 0.55 * (E[1] - A[1])], E];
    for (let i = 0; i <= n; i++) fall.push(cubic(fc, i / n));
  }
  if (shape === "auto" || M) rise = risePts(S, A, E, M, n);
  if (N) fall = fallBendPts(S, A, E, N, n);
  return { rise, fall };
}

/** Cumulative arc length table. */
export function arcTable(P: Pt[]): number[] {
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  return L;
}

/** Point at fraction f (0..1) of the path's arc length, linearly interpolated. */
export function atArc(P: Pt[], L: number[], f: number): Pt {
  const total = L[L.length - 1];
  if (total <= 0) return [P[0][0], P[0][1]];
  const target = Math.min(1, Math.max(0, f)) * total;
  let lo = 1, hi = L.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (L[m] < target) lo = m + 1;
    else hi = m;
  }
  const q = (target - L[lo - 1]) / Math.max(1e-9, L[lo] - L[lo - 1]);
  const p0 = P[lo - 1], p1 = P[lo];
  return [p0[0] + (p1[0] - p0[0]) * q, p0[1] + (p1[1] - p0[1]) * q];
}
