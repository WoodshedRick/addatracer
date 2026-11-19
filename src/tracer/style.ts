// Tracer look: colors, gradient blend, glow, sizes, presets.

export type TracerType = "comet" | "line";

export interface TracerStyle {
  type: TracerType;
  /** head / dot color (comet) or the leading-end color (line) */
  head: string;
  /** tail-end color (comet) or the start-of-line color (line) */
  tail: string;
  /** gradient blend point, 5..95: how far back from the head the color is half-way between head and tail */
  mid: number;
  /** soft glow (true) or a solid, flat stroke (false) */
  glow: boolean;
  /** glow strength multiplier, 0..2 */
  glowStrength: number;
  /** white-hot core */
  core: boolean;
  /** comet size multiplier (head + tail width) */
  cometSize: number;
  /** line thickness in px at 1080p */
  lineWidth: number;
  /** comet tail length in seconds */
  tailSec: number;
  /** line: seconds the full line holds after the ball stops */
  hold: number;
}

/** The approved original look: red comet, white-hot core. */
export const DEFAULT_STYLE: TracerStyle = {
  type: "comet",
  head: "#ff3b1a",
  tail: "#ff3b1a",
  mid: 50,
  glow: true,
  glowStrength: 1,
  core: true,
  cometSize: 1,
  lineWidth: 4,
  tailSec: 0.45,
  hold: 1.0,
};

export const PRESETS: { name: string; style: TracerStyle }[] = [
  { name: "Red comet", style: { ...DEFAULT_STYLE } },
  { name: "Thin white line", style: { ...DEFAULT_STYLE, type: "line", head: "#ffffff", tail: "#ffffff", glow: false, core: false, lineWidth: 3 } },
  { name: "Red glow line", style: { ...DEFAULT_STYLE, type: "line", head: "#ff3b1a", tail: "#ff3b1a", glow: true, core: true, lineWidth: 5 } },
  { name: "Gold comet", style: { ...DEFAULT_STYLE, head: "#ffc93c", tail: "#ff7a1a", mid: 40 } },
  { name: "Ice comet", style: { ...DEFAULT_STYLE, head: "#ffffff", tail: "#36d1ff", mid: 30 } },
  { name: "Neon green line", style: { ...DEFAULT_STYLE, type: "line", head: "#7dff6b", tail: "#1ad1a0", mid: 60, glow: true, core: false, lineWidth: 4 } },
];

export function hexRgb(h: string): [number, number, number] {
  h = (h || "#ffffff").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Gradient weight toward the head color at u (0 = tail end, 1 = head): w = 1 - (1 - u)^p, p = ln .5 / ln mid,
 * so the color is exactly half-way at distance `mid` back from the head.
 */
export function blendWeight(u: number, mid: number): number {
  const m = Math.min(0.95, Math.max(0.05, mid / 100));
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), Math.log(0.5) / Math.log(m));
}

/** RGB color at u (0 = tail end, 1 = head). */
export function colAt(s: Pick<TracerStyle, "head" | "tail" | "mid">, u: number): [number, number, number] {
  const H = hexRgb(s.head), T = hexRgb(s.tail || s.head), w = blendWeight(u, s.mid ?? 50);
  return H.map((h, i) => Math.round(T[i] + (h - T[i]) * w)) as [number, number, number];
}
