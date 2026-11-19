// Flight timing, ported from tracer2.py (physics) and comet_marks.py (timed / ricochet / comet tail).
// The drawn path gives the shape; a simple physics flight gives the speed profile (fast launch, slow at
// the top, apex at 58% of hang time), which is "retimed" onto the drawn path.

import { arcTable, atArc, pathPts, type Pt, type Shape } from "./path";

export type Club = "driver" | "wood" | "iron" | "lowiron" | "wedge" | "punch" | "chip";

export interface ClubSpec {
  label: string;
  /** hang time, seconds */
  hang: number;
  /** carry, metres (only shapes the speed profile) */
  carry: number;
  /** apex height, metres (only shapes the speed profile) */
  apex: number;
}

/** Club table. Hang times are the approved defaults; any shot can override its hang time. */
export const CLUBS: Record<Club, ClubSpec> = {
  driver: { label: "Driver", hang: 6.5, carry: 265, apex: 32 },
  wood: { label: "Wood / hybrid", hang: 6.0, carry: 210, apex: 26 },
  iron: { label: "Iron", hang: 5.5, carry: 160, apex: 28 },
  lowiron: { label: "Low iron", hang: 4.5, carry: 150, apex: 18 },
  wedge: { label: "Wedge", hang: 4.6, carry: 90, apex: 22 },
  punch: { label: "Punch", hang: 4.0, carry: 130, apex: 12 },
  chip: { label: "Chip", hang: 2.5, carry: 40, apex: 8 },
};

/** Apex at this fraction of hang time. */
export const APEX_FRACTION = 0.58;

/** One timed sample: screen x, screen y, time since impact (s), downrange distance (m). */
export type Sample = [number, number, number, number];

export interface PhysicsOpts {
  T?: number;
  carry?: number;
  apex?: number;
  ua?: number;
  tau?: number;
  startDir?: number;
  curve?: number;
  f?: number;
  camH?: number;
  steps?: number;
  fps?: number;
}

/**
 * Physics flight projected through a static pinhole camera (tracer2.flight).
 * S = ball on screen, yh = horizon y, vx = target-line vanishing x.
 */
export function physicsFlight(S: Pt, yh: number, vx: number, o: PhysicsOpts = {}): { samples: Sample[]; d0: number } {
  const { T = 6.5, carry = 265, apex = 32, ua = APEX_FRACTION, tau = 5, startDir = 0, curve = 0, f = 1200, camH = 1.4 } = o;
  const fps = o.fps ?? 30000 / 1001;
  const d0 = (f * camH) / (S[1] - yh); // camera distance behind the ball so the ball lands on S
  const Yb = ((S[0] - vx) * d0) / f;
  const steps = o.steps ?? Math.trunc(T * fps * 8);
  const out: Sample[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (T * i) / steps, u = t / T;
    const X = (carry * (1 - Math.exp(-t / tau))) / (1 - Math.exp(-T / tau));
    const Z = u <= ua ? apex * (1 - ((u - ua) / ua) ** 2) : apex * (1 - ((u - ua) / (1 - ua)) ** 2);
    const Y = Yb + startDir * u + curve * u * u;
    const D = X + d0;
    out.push([vx + (f * Y) / D, yh + (f * (camH - Z)) / D, t, X]);
  }
  return { samples: out, d0 };
}

/** Horizon guess used for the speed profile: just below where the ball comes down. */
export function horizonGuess(S: Pt, A: Pt, E: Pt): number {
  return Math.min(S[1] - 40, Math.max(A[1] + 20, E[1] + 5));
}

function progress(seg: Sample[]): number[] {
  const L = arcTable(seg.map((p) => [p[0], p[1]] as Pt));
  const tot = L[L.length - 1];
  return L.map((l) => (tot ? l / tot : 0));
}

export interface TimedOpts {
  shape?: Shape;
  M?: Pt | null;
  N?: Pt | null;
  /** path resolution per half */
  n?: number;
}

/** Drawn path, timed like the physics flight (comet_marks.timed). */
export function timedSamples(S: Pt, A: Pt, E: Pt, T: number, carry: number, apex: number, hz: number, o: TimedOpts = {}): Sample[] {
  const { rise, fall } = pathPts(S, A, E, { shape: o.shape, M: o.M, N: o.N, n: o.n ?? 3000 });
  const { samples: phys } = physicsFlight(S, hz, S[0] + 0.3 * (E[0] - S[0]), { T, carry, apex });
  let pk = 0;
  for (let i = 1; i < phys.length; i++) if (phys[i][1] < phys[pk][1]) pk = i;
  const pr = progress(phys.slice(0, pk + 1)), pf = progress(phys.slice(pk));
  const Lr = arcTable(rise), Lf = arcTable(fall);
  const out: Sample[] = [];
  for (let i = 0; i <= pk; i++) {
    const [x, y] = atArc(rise, Lr, pr[i]);
    out.push([x, y, phys[i][2], phys[i][3]]);
  }
  for (let i = 1; i < pf.length; i++) {
    const p = phys[pk + i], [x, y] = atArc(fall, Lf, pf[i]);
    out.push([x, y, p[2], p[3]]);
  }
  return out;
}

/** Ricochet hop duration for a kick from E to R. */
export function ricochetDuration(E: Pt, R: Pt): number {
  const dist = Math.hypot(R[0] - E[0], R[1] - E[1]);
  return Math.min(1.2, Math.max(0.45, 0.35 + dist / 900));
}

/** After landing at E the ball kicks off to R: short hop, quick then slowing (comet_marks.ricochet). */
export function ricochet(E: Pt, R: Pt, t0: number, X0: number): { samples: Sample[]; Tr: number } {
  const dist = Math.hypot(R[0] - E[0], R[1] - E[1]);
  const Tr = ricochetDuration(E, R);
  const C: Pt = [(E[0] + R[0]) / 2, (E[1] + R[1]) / 2 - 0.35 * dist];
  const out: Sample[] = [];
  for (let i = 1; i <= 120; i++) {
    const u = 1 - (1 - i / 120) ** 2, q = 1 - u;
    out.push([
      q * q * E[0] + 2 * q * u * C[0] + u * u * R[0],
      q * q * E[1] + 2 * q * u * C[1] + u * u * R[1],
      t0 + (Tr * i) / 120,
      X0,
    ]);
  }
  return { samples: out, Tr };
}

/** Everything the tracer needs about one marked shot. Points are in video pixels at the impact frame. */
export interface ShotMarks {
  S: Pt;
  A: Pt;
  E: Pt;
  M?: Pt | null;
  N?: Pt | null;
  R?: Pt | null;
  ricochet?: boolean;
  shape?: Shape;
  club: Club;
  /** per-shot hang time override (s); null = club default */
  hang?: number | null;
}

export function hangTime(mk: Pick<ShotMarks, "club" | "hang">, table: Partial<Record<Club, number>> = {}): number {
  return +(mk.hang || table[mk.club] || CLUBS[mk.club].hang);
}

/** Pre-computed, time-indexed flight for one shot. */
export class Flight {
  readonly pts: Pt[];
  readonly tt: number[];
  readonly XX: number[];
  readonly arc: number[];
  /** landing time (s after impact) */
  readonly land: number;
  /** end of motion: landing, or end of the ricochet hop */
  readonly end: number;

  constructor(samples: Sample[], land: number) {
    this.pts = samples.map((s) => [s[0], s[1]]);
    this.tt = samples.map((s) => s[2]);
    this.XX = samples.map((s) => s[3]);
    this.arc = arcTable(this.pts);
    this.land = land;
    this.end = this.tt[this.tt.length - 1];
  }

  static fromMarks(mk: ShotMarks, hangTable?: Partial<Record<Club, number>>, n = 600): Flight {
    const T = hangTime(mk, hangTable), c = CLUBS[mk.club];
    const hz = horizonGuess(mk.S, mk.A, mk.E);
    let smp = timedSamples(mk.S, mk.A, mk.E, T, c.carry, c.apex, hz, { shape: mk.shape, M: mk.M, N: mk.N, n });
    if (mk.ricochet && mk.R) {
      const last = smp[smp.length - 1];
      smp = smp.concat(ricochet(mk.E, mk.R, last[2], last[3]).samples);
    }
    return new Flight(smp, T);
  }

  private index(t: number): number {
    // first k with tt[k] >= t (numpy searchsorted, side="left")
    let lo = 0, hi = this.tt.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.tt[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  /** Ball position and downrange distance at time t (clamped to the flight). */
  at(t: number): { p: Pt; X: number } {
    t = Math.min(Math.max(t, 0), this.end);
    const k = this.index(t);
    if (k === 0) return { p: [this.pts[0][0], this.pts[0][1]], X: this.XX[0] };
    const q = (t - this.tt[k - 1]) / Math.max(1e-9, this.tt[k] - this.tt[k - 1]);
    const a = this.pts[k - 1], b = this.pts[k];
    return { p: [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q], X: this.XX[k - 1] + (this.XX[k] - this.XX[k - 1]) * q };
  }

  /** Arc length travelled by time t. */
  arcAt(t: number): number {
    const k = this.index(Math.min(Math.max(t, 0), this.end));
    return this.arc[Math.min(k, this.arc.length - 1)];
  }

  /** Time at which the ball has travelled arc length s. */
  timeAtArc(s: number): number {
    let lo = 0, hi = this.arc.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.arc[m] < s) lo = m + 1;
      else hi = m;
    }
    return this.tt[Math.min(lo, this.tt.length - 1)];
  }
}

export interface CometOpts {
  /** tail length in seconds */
  tail?: number;
  /** minimum tail length in px (shrinks as the ball flies away) */
  minLen?: number;
  /** fade-out after the ball stops, seconds */
  fadeOut?: number;
  /** px scale of the video relative to 1080p (affects minLen) */
  scale?: number;
  /** tail resolution: points per second of tail */
  density?: number;
}

export interface CometFrame {
  /** tail end -> head */
  pts: Pt[];
  /** downrange distance at the head (m): used for head size */
  headX: number;
  /** 0..1 overall opacity */
  alpha: number;
  /** false once the comet has fully faded */
  visible: boolean;
}

/**
 * Comet geometry at time t after impact (comet_marks.comet_frames): tail of ~0.45 s but at least ~200 px,
 * pulled into the head after the ball stops and faded out over 0.5 s.
 */
export function cometAt(F: Flight, t: number, o: CometOpts = {}): CometFrame {
  const { tail = 0.45, minLen = 200, fadeOut = 0.5, scale = 1, density = 400 } = o;
  const T = F.end;
  if (t < 0 || t > T + fadeOut) return { pts: [], headX: 0, alpha: 0, visible: false };
  const th = Math.min(t, T);
  let t0 = Math.max(0, t - tail);
  if (t > T) t0 = Math.max(t0, T - tail * Math.max(0, 1 - (t - T) / (fadeOut * 0.6)));
  const head = F.at(th);
  let ml = minLen * scale * (0.6 + 0.4 * Math.exp(-head.X / 60));
  if (t > T) ml *= Math.max(0, 1 - (t - T) / (fadeOut * 0.6));
  t0 = Math.min(t0, F.timeAtArc(F.arcAt(th) - ml));
  const n = Math.max(2, Math.trunc((th - t0) * density) + 2);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push(F.at(t0 + ((th - t0) * i) / (n - 1)).p);
  const alpha = t <= T ? 1 : Math.max(0, 1 - (t - T) / fadeOut);
  return { pts, headX: head.X, alpha, visible: alpha > 0 };
}

/** Head radius in px at 1080p for a given downrange distance (comet_marks: 3.4 + 5.6 e^(-X/40)). */
export function headRadius(X: number): number {
  return 3.4 + 5.6 * Math.exp(-X / 40);
}

export interface LineOpts {
  /** seconds the full line holds after the ball stops */
  hold?: number;
  /** fade-out duration, seconds */
  fadeOut?: number;
  density?: number;
}

/** Classic line tracer: the whole path from the ball to the head, held, then faded (tracer2.render timing). */
export function lineAt(F: Flight, t: number, o: LineOpts = {}): CometFrame {
  const { hold = 1.0, fadeOut = 0.7, density = 240 } = o;
  const T = F.end;
  if (t < 0 || t > T + hold + fadeOut) return { pts: [], headX: 0, alpha: 0, visible: false };
  const th = Math.min(t, T);
  const n = Math.max(2, Math.trunc(th * density) + 2);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push(F.at((th * i) / (n - 1)).p);
  const alpha = t <= T + hold ? 1 : Math.max(0, 1 - (t - T - hold) / fadeOut);
  return { pts, headX: F.at(th).X, alpha, visible: alpha > 0 };
}

/** How long (s after impact) a tracer stays on screen. */
export function tracerDuration(F: Flight, type: "comet" | "line", line: LineOpts = {}, comet: CometOpts = {}): number {
  return type === "comet" ? F.end + (comet.fadeOut ?? 0.5) : F.end + (line.hold ?? 1.0) + (line.fadeOut ?? 0.7);
}
