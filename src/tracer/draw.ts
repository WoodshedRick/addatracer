// Canvas 2D drawing of the comet / line tracer. Used for both the live preview and the export,
// so what you see is what you get. Coordinates are video pixels; `scale` = video height / 1080.

import { cometAt, headRadius, lineAt, type Flight } from "./flight";
import type { Pt } from "./path";
import { colAt, type TracerStyle } from "./style";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const scratch = new Map<string, OffscreenCanvas>();
function offscreen(w: number, h: number): OffscreenCanvas {
  const k = `${w}x${h}`;
  let c = scratch.get(k);
  if (!c) {
    c = new OffscreenCanvas(w, h);
    scratch.set(k, c);
  }
  return c;
}

const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

/** Draw the tracer for time t (seconds after impact). Returns false when nothing is on screen. */
export function drawTracer(ctx: Ctx, F: Flight, t: number, style: TracerStyle, scale = 1): boolean {
  if (style.type === "line") return drawLine(ctx, F, t, style, scale);
  return drawComet(ctx, F, t, style, scale);
}

function drawComet(ctx: Ctx, F: Flight, t: number, s: TracerStyle, scale: number): boolean {
  const c = cometAt(F, t, { tail: s.tailSec, scale });
  if (!c.visible || c.pts.length < 2) return false;
  const rh = headRadius(c.headX) * s.cometSize * scale;
  const pts = c.pts, n = pts.length, head = pts[n - 1], hc = colAt(s, 1);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = c.alpha;
  if (s.glow && s.glowStrength > 0) {
    const off = offscreen(W, H), o = off.getContext("2d")!;
    // halo (wide, soft) then glow (tighter): draw sharp strokes once, blur when compositing
    for (const [blur, wm, a] of [[rh * 2.6, 2.4, 0.5], [rh * 0.8, 1.7, 0.9]] as const) {
      o.clearRect(0, 0, W, H);
      o.lineCap = "round";
      const ga = Math.min(1, a * s.glowStrength);
      for (let j = 1; j < n; j++) {
        const u = j / (n - 1), v = Math.pow(u, 1.6);
        o.strokeStyle = rgba(colAt(s, u), v * ga);
        o.lineWidth = Math.max(1, 2 * rh * 0.85 * u) * wm + 2 * scale;
        o.beginPath();
        o.moveTo(pts[j - 1][0], pts[j - 1][1]);
        o.lineTo(pts[j][0], pts[j][1]);
        o.stroke();
      }
      o.fillStyle = rgba(hc, ga);
      o.beginPath();
      o.arc(head[0], head[1], rh * (wm === 2.4 ? 2.6 : 1.9), 0, Math.PI * 2);
      o.fill();
      ctx.filter = `blur(${Math.max(0.5, blur * Math.min(1.6, s.glowStrength)).toFixed(1)}px)`;
      ctx.drawImage(off, 0, 0);
      ctx.filter = "none";
    }
  }
  // core: tapering tail, white-hot or colored
  ctx.lineCap = s.glow ? "butt" : "round";
  for (let j = 1; j < n; j++) {
    const u = j / (n - 1), v = s.glow ? Math.pow(u, 1.6) : Math.pow(u, 0.8);
    const col = s.core ? [255, 255, 255] : colAt(s, u);
    ctx.strokeStyle = rgba(col, v);
    ctx.lineWidth = Math.max(1, 2 * rh * 0.85 * u * (s.glow ? 1 : 1.25));
    ctx.beginPath();
    ctx.moveTo(pts[j - 1][0], pts[j - 1][1]);
    ctx.lineTo(pts[j][0], pts[j][1]);
    ctx.stroke();
  }
  if (!s.glow && s.core) {
    // solid look with a white core: colored outline so the color still reads
    ctx.globalCompositeOperation = "destination-over";
    for (let j = 1; j < n; j++) {
      const u = j / (n - 1);
      ctx.strokeStyle = rgba(colAt(s, u), Math.pow(u, 0.8));
      ctx.lineWidth = Math.max(1, 2 * rh * 0.85 * u * 1.25) + 3 * scale;
      ctx.beginPath();
      ctx.moveTo(pts[j - 1][0], pts[j - 1][1]);
      ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(hc, 1);
    ctx.beginPath();
    ctx.arc(head[0], head[1], rh * 1.25 + 1.5 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.fillStyle = s.core ? "#ffffff" : rgba(hc, 1);
  ctx.beginPath();
  ctx.arc(head[0], head[1], rh, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return true;
}

function strokeGradientPath(ctx: Ctx, pts: Pt[], s: TracerStyle, width: number, alpha: number, white: boolean) {
  const n = pts.length;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  if (white || s.head === s.tail) {
    ctx.strokeStyle = white ? rgba([255, 255, 255], alpha) : rgba(colAt(s, 1), alpha);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let j = 1; j < n; j++) ctx.lineTo(pts[j][0], pts[j][1]);
    ctx.stroke();
    return;
  }
  // gradient along the path: short segments, overlapping by one point so joins stay smooth
  const seg = Math.max(2, Math.ceil(n / 80));
  for (let j = 0; j < n - 1; j += seg) {
    const e = Math.min(n - 1, j + seg), u = (j + e) / 2 / (n - 1);
    ctx.strokeStyle = rgba(colAt(s, u), alpha);
    ctx.beginPath();
    ctx.moveTo(pts[j][0], pts[j][1]);
    for (let k = j + 1; k <= e; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.stroke();
  }
}

function drawLine(ctx: Ctx, F: Flight, t: number, s: TracerStyle, scale: number): boolean {
  const c = lineAt(F, t, { hold: s.hold });
  if (!c.visible || c.pts.length < 2) return false;
  const w = Math.max(1, s.lineWidth * scale);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = c.alpha;
  if (s.glow && s.glowStrength > 0) {
    const off = offscreen(W, H), o = off.getContext("2d")!;
    o.clearRect(0, 0, W, H);
    strokeGradientPath(o, c.pts, s, w * 3.2, Math.min(1, 0.85 * s.glowStrength), false);
    ctx.filter = `blur(${(w * 1.6 * Math.min(1.6, s.glowStrength)).toFixed(1)}px)`;
    ctx.drawImage(off, 0, 0);
    ctx.filter = "none";
  }
  strokeGradientPath(ctx, c.pts, s, w, 1, s.core && s.glow);
  ctx.restore();
  return true;
}
