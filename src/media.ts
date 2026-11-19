// Reading clip info (frame rate, size) and exporting with the tracer, all in the browser via WebCodecs (mediabunny).

import {
  ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH,
  WebMOutputFormat, canEncodeAudio, canEncodeVideo,
} from "mediabunny";
import { zipSync } from "fflate";
import { encodePng } from "./png";
import { drawTracer } from "./tracer/draw";
import { tracerDuration, type Flight } from "./tracer/flight";
import type { TracerStyle } from "./tracer/style";

export interface ClipInfo {
  fps: number;
  width: number;
  height: number;
  duration: number;
  /** first video timestamp in the file (s); informational, can be < 0 with edit lists */
  firstTs: number;
}

/** Common frame rates, so 29.97 reads as 30000/1001 rather than 29.94 from a short sample. */
const STD = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120, 239.76, 240];
function snapFps(r: number): number {
  const best = STD.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a));
  if (Math.abs(best - r) / r > 0.015) return r;
  return [23.976, 29.97, 59.94, 119.88, 239.76].includes(best) ? (Math.round(best) * 1000) / 1001 : best;
}

export async function probe(file: File): Promise<ClipInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error("No video track found in this file.");
    const stats = await vt.computePacketStats(120);
    return {
      fps: snapFps(stats.averagePacketRate || 30),
      width: vt.displayWidth,
      height: vt.displayHeight,
      duration: await input.computeDuration(),
      firstTs: await vt.getFirstTimestamp(),
    };
  } finally {
    input.dispose();
  }
}

export interface ExportJob {
  file: File;
  info: ClipInfo;
  flight: Flight;
  /** impact frame index (0 = first frame) */
  impactFrame: number;
  style: TracerStyle;
  /** MP4 only: crop a full-height window starting at video x (vertical 9:16 export), output 1080×1920 */
  crop?: { x: number; w: number };
  /** MP4 only: small "Made with Flighted" credit */
  credit?: boolean;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, "");

export function webCodecsAvailable(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined";
}

export const CREDIT = "Made with Flighted · @garrickwoodsgolf";

/** The credit line, bottom-right (or, for vertical video, left and above where TikTok / Reels put their captions). */
export function drawCredit(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, W: number, H: number) {
  const vertical = H > W, fs = Math.max(12, Math.round(Math.min(W, H) * 0.024));
  ctx.save();
  ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = vertical ? "left" : "right";
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = fs * 0.3;
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.fillText(CREDIT, vertical ? W * 0.06 : W - fs, vertical ? H * 0.7 : H - fs);
  ctx.restore();
}

/** The clip with the tracer burned in, as MP4 (H.264 + original audio). */
export async function exportBakedMp4(job: ExportJob): Promise<Blob> {
  const { file, info, flight, impactFrame, style, crop } = job;
  if (!webCodecsAvailable()) throw new Error("This browser can't encode video (no WebCodecs). Try Chrome, Edge or Safari 26+.");
  const W = info.width, H = info.height;
  // vertical: always 1080×1920, the size Reels / TikTok / Shorts want
  const OW = crop ? 1080 : W, OH = crop ? 1920 : H, k = OH / H;
  if (!(await canEncodeVideo("avc", { width: OW, height: OH }))) throw new Error(`This browser can't encode ${OW}×${OH} H.264.`);
  const canvas = new OffscreenCanvas(OW, OH), ctx = canvas.getContext("2d")!;
  // full frame first (drawWithFit applies any rotation), then crop from it
  const full = crop ? new OffscreenCanvas(W, H) : null, fctx = full?.getContext("2d");
  const vScale = H / 1080, tImpact = impactFrame / info.fps;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  try {
    // camera MOVs often carry PCM audio; that's legal in MP4 but many players/phones won't play it, so use AAC
    const at = await input.getPrimaryAudioTrack();
    const toAac = !!at && at.codec !== "aac" && (await canEncodeAudio("aac"));
    const conv = await Conversion.init({
      input,
      output,
      audio: toAac ? { codec: "aac", bitrate: 192_000 } : undefined,
      video: {
        codec: "avc",
        quality: QUALITY_HIGH,
        forceTranscode: true,
        allowTransformationMetadata: false,
        processedWidth: OW,
        processedHeight: OH,
        process: (sample) => {
          ctx.clearRect(0, 0, OW, OH);
          if (crop && full && fctx) {
            sample.drawWithFit(fctx, { fit: "fill" });
            ctx.drawImage(full, crop.x, 0, crop.w, H, 0, 0, OW, OH);
          } else sample.drawWithFit(ctx, { fit: "fill" });
          // sample timestamps match the <video> element's clock (checked on an edit-listed MOV), so no firstTs shift
          drawTracer(ctx, flight, sample.timestamp - tImpact, style, vScale, k, [crop?.x ?? 0, 0]);
          if (job.credit) drawCredit(ctx, OW, OH);
          return canvas;
        },
      },
      showWarnings: false,
    });
    if (!conv.isValid) throw new Error("Can't convert this file: " + conv.discardedTracks.map((d) => d.reason).join(", "));
    conv.onProgress = (p) => job.onProgress?.(p);
    job.signal?.addEventListener("abort", () => void conv.cancel());
    await conv.execute();
    return new Blob([target.buffer!], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

/** Transparent tracer frames as a zipped PNG sequence, starting on the impact frame. Imports into Premiere/Resolve. */
export async function exportPngSequence(job: ExportJob): Promise<Blob> {
  const { file, info, flight, impactFrame, style } = job;
  const W = info.width, H = info.height, vScale = H / 1080;
  const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext("2d")!;
  const n = Math.ceil(tracerDuration(flight, style.type, { hold: style.hold }) * info.fps) + 1;
  const files: Record<string, Uint8Array> = {};
  const name = baseName(file).replace(/[^\w-]+/g, "_");
  for (let i = 0; i < n; i++) {
    if (job.signal?.aborted) throw new DOMException("Canceled", "AbortError");
    ctx.clearRect(0, 0, W, H);
    drawTracer(ctx, flight, i / info.fps, style, vScale);
    // our own encoder: much faster than convertToBlob for mostly-transparent frames
    files[`${name}_tracer/${name}_tracer_${String(i).padStart(5, "0")}.png`] = encodePng(ctx.getImageData(0, 0, W, H).data, W, H);
    job.onProgress?.((i + 1) / n);
    if (i % 8 === 7) await new Promise((r) => setTimeout(r)); // keep the page responsive
  }
  const tc = timecode(impactFrame, info.fps);
  files[`${name}_tracer/HOW_TO_USE.txt`] = new TextEncoder().encode(
    [
      `Flighted tracer overlay for ${file.name}`,
      ``,
      `${n} transparent PNG frames at ${info.fps.toFixed(3)} fps, ${W}x${H}.`,
      `Frame 00000 is the impact frame: frame ${impactFrame} of the original clip (${tc} from the clip start).`,
      ``,
      `Premiere Pro: File > Import, pick the first PNG, tick "Image Sequence". Right-click the new clip >`,
      `Modify > Interpret Footage > set the frame rate to ${info.fps.toFixed(3)}. Put it on the track above`,
      `your clip, starting ${tc} after the clip's first frame.`,
      `DaVinci Resolve: the PNGs show up as one sequence in the Media Pool.`,
      ``,
    ].join("\r\n"),
  );
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}

/** Transparent WebM (VP9 + alpha), full clip length so it lines up when dropped above the clip at the same start. */
export async function exportAlphaWebm(job: ExportJob): Promise<Blob> {
  const { info, flight, impactFrame, style } = job;
  if (!webCodecsAvailable()) throw new Error("This browser can't encode video (no WebCodecs). Use Chrome or Edge.");
  const W = info.width, H = info.height, vScale = H / 1080;
  if (!(await canEncodeVideo("vp9", { width: W, height: H })))
    throw new Error("This browser can't make VP9 video. Use the PNG overlay, or Chrome / Edge on a computer.");
  const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext("2d")!;
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const src = new CanvasSource(canvas, { codec: "vp9", quality: QUALITY_HIGH, alpha: "keep" });
  output.addVideoTrack(src, { frameRate: info.fps });
  await output.start();
  const n = Math.max(1, Math.round(info.duration * info.fps)), dt = 1 / info.fps;
  for (let i = 0; i < n; i++) {
    if (job.signal?.aborted) {
      await output.cancel();
      throw new DOMException("Canceled", "AbortError");
    }
    ctx.clearRect(0, 0, W, H);
    drawTracer(ctx, flight, (i - impactFrame) / info.fps, style, vScale);
    await src.add(i * dt, dt);
    job.onProgress?.((i + 1) / n);
  }
  await output.finalize();
  return new Blob([target.buffer!], { type: "video/webm" });
}

export function timecode(frame: number, fps: number): string {
  const r = Math.round(fps), s = Math.floor(frame / r), f = frame % r;
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function outName(file: File, suffix: string) {
  return `${baseName(file)}_${suffix}`;
}
