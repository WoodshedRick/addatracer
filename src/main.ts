import "./style.css";
import { pathPts, shapeBend, type Pt, type Shape } from "./tracer/path";
import { CLUBS, Flight, hangTime, ricochet, type Club, type ShotMarks } from "./tracer/flight";
import { drawTracer } from "./tracer/draw";
import { DEFAULT_STYLE, PRESETS, colAt, type TracerStyle } from "./tracer/style";
import {
  download, exportAlphaWebm, exportBakedMp4, exportPngSequence, outName, probe, webCodecsAvailable, type ClipInfo,
} from "./media";
import { forget, forgetAll, keepClip, keepTime, purgeExpired, restore, setKeepTime, touch } from "./keep";

// ---------------------------------------------------------------- state
type Key = "S" | "M" | "A" | "N" | "E" | "R";
type Tool = "I" | Key;

interface Clip {
  id: string;
  file: File;
  url: string;
  info: ClipInfo | null;
  impactFrame: number | null;
  pts: Partial<Record<Key, Pt>>;
  ricochet: boolean;
  shape: Shape;
  club: Club;
  hang: number | null;
  /** when the copy kept on this device is deleted (null: not kept) */
  keptUntil: number | null;
  /** why it couldn't be kept */
  keepNote?: string;
}

const COL: Record<Tool, string> = { I: "#ff7a2a", S: "#ffffff", M: "#7dffb0", A: "#ffc93c", N: "#7dffb0", E: "#36d1ff", R: "#c78bff" };
const NAMES: Record<Tool, string> = { I: "Impact", S: "Ball", M: "Bend 1", A: "Peak", N: "Bend 2", E: "Landing", R: "Ricochet" };

const clips: Clip[] = [];
let cur = -1;
let tool: Tool = "I";
let view: "marks" | "tracer" = "marks";
/** marker being dragged; `off` keeps the marker where it was relative to the finger, so a finger never hides it */
let drag: { key: Key; at: Pt; off: Pt } | null = null;
let busy: AbortController | null = null;

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem("flighted." + k);
      return v ? { ...d, ...JSON.parse(v) } : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem("flighted." + k, JSON.stringify(v));
    } catch {
      /* private mode etc. */
    }
  },
};
let style: TracerStyle = store.get("style", { ...DEFAULT_STYLE });
let hangTable: Partial<Record<Club, number>> = store.get("hang", {});

// ---------------------------------------------------------------- dom
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const vid = $<HTMLVideoElement>("vid"), cv = $<HTMLCanvasElement>("cv"), cx = cv.getContext("2d")!;
const stage = $("stage"), stageWrap = $("stageWrap");

function toast(msg: string, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout((toast as any).h);
  (toast as any).h = setTimeout(() => t.classList.remove("on"), ms);
}

const clip = () => clips[cur];
const fps = () => clip()?.info?.fps ?? 30;
const keyOf = (f: File) => `clip:${f.name}|${f.size}|${f.lastModified}`;

function save(c: Clip) {
  store.set(keyOf(c.file), { impactFrame: c.impactFrame, pts: c.pts, ricochet: c.ricochet, shape: c.shape, club: c.club, hang: c.hang, t: Date.now() });
  // each change restarts the clip's hour on this device
  if (c.keptUntil !== null)
    touch(c.id).then((t) => {
      if (t !== null) c.keptUntil = t + keepTime();
      renderList();
    });
}

/** marks are kept for the same hour as the clips */
function purgeOldMarks(all = false) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("flighted.clip:")) continue;
      let t = 0;
      try {
        t = JSON.parse(localStorage.getItem(k)!).t ?? 0;
      } catch {
        /* unreadable: drop it */
      }
      if (all || Date.now() - t >= keepTime()) localStorage.removeItem(k);
    }
  } catch {
    /* storage blocked */
  }
}

function complete(c: Clip): boolean {
  return c.impactFrame !== null && !!c.pts.S && !!c.pts.A && !!c.pts.E && (!c.ricochet || !!c.pts.R);
}

function marksOf(c: Clip): ShotMarks {
  const p = c.pts;
  return { S: p.S!, A: p.A!, E: p.E!, M: p.M, N: p.N, R: p.R, ricochet: c.ricochet, shape: c.shape, club: c.club, hang: c.hang };
}

const flightCache = new WeakMap<Clip, { sig: string; F: Flight }>();
function flightOf(c: Clip): Flight | null {
  if (!complete(c)) return null;
  const mk = marksOf(c), sig = JSON.stringify([mk, hangTable]);
  const hit = flightCache.get(c);
  if (hit && hit.sig === sig) return hit.F;
  const F = Flight.fromMarks(mk, hangTable);
  flightCache.set(c, { sig, F });
  return F;
}

// ---------------------------------------------------------------- clips
async function addFiles(files: FileList | File[]) {
  const vids = [...files].filter((f) => f.type.startsWith("video/") || /\.(mov|mp4|m4v|webm|mkv)$/i.test(f.name));
  if (!vids.length) return toast("Those don't look like video files.");
  addClips(vids.map((file) => ({ file })));
}

/** `id` + `savedAt` for clips restored from this device, none for new uploads (which get stored) */
function addClips(items: { file: File; id?: string; savedAt?: number }[]) {
  const vids = items.map((i) => i.file), first = clips.length;
  for (const { file: f, id, savedAt } of items) {
    const saved = store.get<Partial<Clip>>(keyOf(f), {});
    const c: Clip = {
      id: id ?? crypto.randomUUID(), file: f, url: URL.createObjectURL(f), info: null,
      impactFrame: saved.impactFrame ?? null, pts: saved.pts ?? {}, ricochet: saved.ricochet ?? false,
      shape: saved.shape ?? "auto", club: saved.club ?? "driver", hang: saved.hang ?? null,
      keptUntil: savedAt !== undefined ? savedAt + keepTime() : null,
    };
    clips.push(c);
    if (!id)
      keepClip(c.id, f).then((r) => {
        if (!clips.includes(c)) return void forget(c.id); // removed while it was being stored
        if (r.ok) c.keptUntil = r.savedAt + keepTime();
        else {
          c.keepNote = r.reason;
          toast(`${f.name} won't survive a refresh: ${r.reason}.`, 5000);
        }
        renderList();
      });
    probe(f)
      .then((info) => {
        c.info = info;
        if (clip() === c) layout();
        renderList();
      })
      .catch((e) => {
        console.warn(e);
        toast(`Couldn't read ${f.name}: ${e.message ?? e}`);
      });
  }
  renderList();
  if (cur < 0 || clips.length - vids.length === 0) select(first);
}

function removeClip(i: number) {
  const [c] = clips.splice(i, 1);
  URL.revokeObjectURL(c.url);
  void forget(c.id);
  if (!clips.length) {
    cur = -1;
    vid.removeAttribute("src");
    vid.load();
  } else select(Math.min(i <= cur ? Math.max(0, cur - 1) : cur, clips.length - 1), true);
  renderList();
  syncShell();
}

function statusText(c: Clip) {
  if (complete(c)) return ["Marked", true] as const;
  if (c.impactFrame !== null) return ["Impact set", false] as const;
  return ["To mark", false] as const;
}

function keptText(c: Clip): string {
  if (c.keptUntil === null) return c.keepNote ? `Not kept after a refresh: ${c.keepNote}` : "Saving on this device…";
  const min = Math.max(1, Math.ceil((c.keptUntil - Date.now()) / 60000));
  return `Kept on this device for ${min} more min`;
}

function renderList() {
  const ol = $("clipList");
  ol.replaceChildren(
    ...clips.map((c, i) => {
      const li = document.createElement("li"), [st, done] = statusText(c);
      li.className = i === cur ? "cur" : "";
      li.innerHTML = `<span class="nm"></span><span class="st${done ? " done" : ""}">${st}</span><button class="x" title="Remove">✕</button><span class="kp"></span>`;
      li.querySelector(".nm")!.textContent = c.file.name;
      const kp = li.querySelector(".kp")!;
      kp.textContent = keptText(c);
      kp.classList.toggle("no", c.keptUntil === null && !!c.keepNote);
      li.onclick = (e) => {
        if ((e.target as HTMLElement).classList.contains("x")) removeClip(i);
        else select(i);
      };
      return li;
    }),
  );
  $("clearAll").hidden = !clips.length;
  ($("prevClip") as HTMLButtonElement).disabled = cur <= 0;
  ($("nextClip") as HTMLButtonElement).disabled = cur >= clips.length - 1;
}

function select(i: number, force = false) {
  if (i < 0 || i >= clips.length || (i === cur && !force)) return;
  cur = i;
  const c = clip();
  vid.src = c.url;
  vid.playbackRate = 1;
  $("slow").setAttribute("aria-pressed", "false");
  tool = nextTool(c);
  view = complete(c) ? "tracer" : "marks";
  vid.addEventListener(
    "loadedmetadata",
    () => {
      layout();
      // seek even without an impact frame: iOS Safari shows a black frame until the first seek
      seekFrame(c.impactFrame ?? 0);
    },
    { once: true },
  );
  renderList();
  syncShell();
  syncShot();
}

function syncShell() {
  const has = clips.length > 0;
  $("empty").hidden = has;
  $("work").hidden = !has;
  $("side").hidden = !has;
}

// ---------------------------------------------------------------- layout
function vidSize(): [number, number] {
  const i = clip()?.info;
  return [vid.videoWidth || i?.width || 1920, vid.videoHeight || i?.height || 1080];
}

function layout() {
  if (!clip()) return;
  const [W, H] = vidSize();
  const ar = `${W} / ${H}`;
  if (stageWrap.style.aspectRatio !== ar) stageWrap.style.aspectRatio = ar; // ResizeObserver re-runs layout
  const r = stageWrap.getBoundingClientRect();
  const maxW = r.width, maxH = r.height;
  const s = Math.min(maxW / W, maxH / H);
  stage.style.width = `${Math.round(W * s)}px`;
  stage.style.height = `${Math.round(H * s)}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * s * dpr);
  cv.height = Math.round(H * s * dpr);
  draw();
}
new ResizeObserver(layout).observe(stageWrap);

/** canvas px per video px */
const kView = () => cv.width / vidSize()[0];

// ---------------------------------------------------------------- frames + time
const frameIdx = () => Math.max(0, Math.floor(vid.currentTime * fps() + 0.02));
function seekFrame(j: number) {
  vid.pause();
  const n = Math.max(1, Math.floor((vid.duration || 0) * fps()));
  j = Math.max(0, Math.min(n - 1, j));
  vid.currentTime = (j + 0.5) / fps();
}
let mediaTime: number | null = null; // exact presented frame time while playing

function tNow(c: Clip): number | null {
  if (c.impactFrame === null) return null;
  const tm = !vid.paused && mediaTime !== null ? mediaTime : frameIdx() / fps();
  return tm - c.impactFrame / fps();
}

// ---------------------------------------------------------------- drawing
function strokePath(p: Pt[]) {
  cx.beginPath();
  cx.moveTo(p[0][0], p[0][1]);
  for (const q of p) cx.lineTo(q[0], q[1]);
  cx.stroke();
}
function ring(x: number, y: number, r: number) {
  cx.beginPath();
  cx.arc(x, y, r, 0, Math.PI * 2);
  cx.stroke();
}

function draw() {
  const c = clip();
  cx.clearRect(0, 0, cv.width, cv.height);
  if (!c) return;
  const k = kView(), dpr = cv.width / stage.clientWidth || 1, toC = (p: Pt): Pt => [p[0] * k, p[1] * k];
  const t = tNow(c);
  if (view === "tracer" && complete(c) && t !== null) {
    drawTracer(cx, flightOf(c)!, t, style, vidSize()[1] / 1080, k);
  } else if (c.impactFrame !== null) {
    const p = c.pts;
    if (p.S && p.A && p.E) {
      const { rise, fall } = pathPts(p.S, p.A, p.E, { shape: c.shape, M: p.M, N: p.N });
      const pts = rise.concat(fall.slice(1)).map(toC);
      cx.lineCap = cx.lineJoin = "round";
      cx.strokeStyle = `rgba(${colAt(style, 1)},.5)`;
      cx.lineWidth = 7 * dpr;
      strokePath(pts);
      cx.strokeStyle = "rgba(255,255,255,.9)";
      cx.lineWidth = 2 * dpr;
      strokePath(pts);
      if (c.ricochet && p.R) {
        const rp = ricochet(p.E, p.R, 0, 0).samples.filter((_, i) => i % 6 === 5).map((s) => toC([s[0], s[1]]));
        cx.setLineDash([6 * dpr, 5 * dpr]);
        cx.strokeStyle = COL.R;
        strokePath([toC(p.E), ...rp]);
        cx.setLineDash([]);
      }
    }
    for (const key of ["S", "M", "A", "N", "E", "R"] as Key[]) {
      const q = p[key];
      if (!q || (key === "R" && !c.ricochet)) continue;
      const [x, y] = toC(q);
      cx.lineWidth = 3.5 * dpr;
      cx.strokeStyle = "#000";
      ring(x, y, 13 * dpr);
      cx.lineWidth = 2.5 * dpr;
      cx.strokeStyle = COL[key];
      ring(x, y, 13 * dpr);
      cx.fillStyle = COL[key];
      cx.beginPath();
      cx.arc(x, y, 2.5 * dpr, 0, Math.PI * 2);
      cx.fill();
    }
  }
  if (drag) loupe(drag.at, drag.key, k, dpr);
  // timecode
  const j = frameIdx(), rel = c.impactFrame === null ? null : j - c.impactFrame;
  const tc = $("tc");
  tc.textContent = rel === null ? `frame ${j}` : rel === 0 ? "IMPACT" : `${rel > 0 ? "+" : ""}${(rel / fps()).toFixed(2)} s`;
  tc.style.color = rel === 0 ? COL.I : "";
  if (!vid.seeking && vid.duration) ($("scrub") as HTMLInputElement).value = String(Math.round((vid.currentTime / vid.duration) * 1000));
}

/** magnifier in the corner away from the finger */
function loupe(p: Pt, key: Key, k: number, dpr: number) {
  const R = Math.min(90 * dpr, cv.height * 0.3), Z = 4, r = R / Z, [px, py] = [p[0] * k, p[1] * k];
  const m = Math.min(12 * dpr, R * 0.15), lx = px < cv.width / 2 ? cv.width - R - m : R + m, ly = R + m;
  cx.save();
  cx.beginPath();
  cx.arc(lx, ly, R, 0, Math.PI * 2);
  cx.clip();
  cx.fillStyle = "#000";
  cx.fillRect(lx - R, ly - R, 2 * R, 2 * R);
  try {
    cx.drawImage(vid, (px - r) / k, (py - r) / k, (2 * r) / k, (2 * r) / k, lx - R, ly - R, 2 * R, 2 * R);
  } catch {
    /* not ready */
  }
  cx.restore();
  cx.lineWidth = 3 * dpr;
  cx.strokeStyle = COL[key];
  ring(lx, ly, R);
  cx.lineWidth = 1.5 * dpr;
  cx.beginPath();
  cx.moveTo(lx - 12 * dpr, ly);
  cx.lineTo(lx + 12 * dpr, ly);
  cx.moveTo(lx, ly - 12 * dpr);
  cx.lineTo(lx, ly + 12 * dpr);
  cx.stroke();
}

function tick(_now?: number, meta?: VideoFrameCallbackMetadata) {
  if (meta) mediaTime = meta.mediaTime;
  draw();
  if (!vid.paused) {
    if ("requestVideoFrameCallback" in vid) vid.requestVideoFrameCallback(tick);
    else requestAnimationFrame(() => tick());
  }
}
vid.addEventListener("play", () => {
  $("play").textContent = "❚❚ Pause";
  mediaTime = null;
  tick();
});
vid.addEventListener("pause", () => {
  $("play").textContent = "▶ Play";
  mediaTime = null;
  draw();
});
vid.addEventListener("seeked", draw);
vid.addEventListener("loadeddata", draw);

// ---------------------------------------------------------------- marking
function nextTool(c: Clip): Tool {
  if (c.impactFrame === null) return "I";
  if (!c.pts.S) return "S";
  if (!c.pts.A) return "A";
  if (!c.pts.E) return "E";
  if (c.ricochet && !c.pts.R) return "R";
  return tool === "I" ? "S" : tool;
}

const STEPS: { k: Tool; opt?: boolean }[] = [
  { k: "I" }, { k: "S" }, { k: "M", opt: true }, { k: "A" }, { k: "N", opt: true }, { k: "E" }, { k: "R", opt: true },
];
const INSTR: Record<Tool, string> = {
  I: "Scrub to the frame where the club hits the ball (use <b>−1f / +1f</b> or ← →), then press <b>Set impact frame here</b>.",
  S: "Tap the <b>ball</b> on the impact frame. Drag to fine-tune; the magnifier helps.",
  M: "Optional <b>bend 1</b>: scrub forward and tap a point the ball passes through on the way up.",
  A: "Scrub forward to the ball's <b>highest point</b> and tap it.",
  N: "Optional <b>bend 2</b>: tap a point the ball passes through on the way down.",
  E: "Scrub to where the ball <b>lands</b> and tap it.",
  R: "Tap where the ball ends up after it <b>kicks</b>.",
};

function syncSteps() {
  const c = clip();
  if (!c) return;
  const ol = $("steps");
  ol.replaceChildren(
    ...STEPS.filter((s) => s.k !== "R" || c.ricochet).map((s) => {
      const li = document.createElement("li");
      const done = s.k === "I" ? c.impactFrame !== null : !!c.pts[s.k as Key];
      li.textContent = NAMES[s.k] + (s.opt && s.k !== "R" ? " (optional)" : "");
      li.className = [s.opt ? "opt" : "", done ? "done" : "", tool === s.k ? "cur" : ""].join(" ");
      li.style.setProperty("--k", COL[s.k]);
      li.onclick = () => setTool(s.k);
      return li;
    }),
  );
  const instr = $("instr");
  instr.innerHTML = complete(c) && (view === "tracer" || tool === "E" || tool === "R" || tool === "S")
    ? "All marked. Press <b>▶ Preview shot</b>, tweak the style, then export. Drag a marker in <b>Marks</b> view to adjust it."
    : INSTR[tool];
  instr.style.setProperty("--k", COL[tool]);
  ($("setImpact") as HTMLButtonElement).textContent = c.impactFrame === null ? "Set impact frame here" : "Move impact to this frame";
  ($("goImpact") as HTMLButtonElement).disabled = c.impactFrame === null;
  ($("preview") as HTMLButtonElement).disabled = !complete(c);
  $("viewMarks").setAttribute("aria-pressed", String(view === "marks"));
  $("viewTracer").setAttribute("aria-pressed", String(view === "tracer"));
  for (const b of $("tools").querySelectorAll<HTMLButtonElement>("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.k === tool));
    b.disabled = c.impactFrame === null || (b.dataset.k === "R" && !c.ricochet);
    b.style.setProperty("--k", COL[b.dataset.k as Tool]);
  }
  const ok = complete(c);
  for (const id of ["exMp4", "exPng", "exWebm"]) ($(id) as HTMLButtonElement).disabled = !ok || !!busy;
  ($("exAll") as HTMLButtonElement).disabled = !clips.some(complete) || !!busy;
}

function setTool(t: Tool) {
  const c = clip();
  if (!c || (t !== "I" && c.impactFrame === null)) return;
  if (t === "R" && !c.ricochet) return;
  tool = t;
  setView("marks");
}

function setView(v: "marks" | "tracer") {
  view = v;
  syncSteps();
  draw();
}

function changed() {
  const c = clip();
  save(c);
  renderList();
  syncSteps();
  syncShapeWarn();
  draw();
}

function evVideoPt(e: PointerEvent): Pt {
  const r = cv.getBoundingClientRect(), [W, H] = vidSize();
  return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
}

/** existing marker under the pointer (so it can be dragged) */
function hitMarker(c: Clip, p: Pt, touch = false): Key | null {
  const r = cv.getBoundingClientRect(), [W] = vidSize(), tol = ((touch ? 30 : 18) / r.width) * W;
  let best: Key | null = null, bd = tol;
  for (const key of ["S", "M", "A", "N", "E", "R"] as Key[]) {
    const q = c.pts[key];
    if (!q || (key === "R" && !c.ricochet)) continue;
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = key;
    }
  }
  return best;
}

cv.addEventListener("pointerdown", (e) => {
  const c = clip();
  if (!c) return;
  if (c.impactFrame === null) {
    vid.paused ? vid.play() : vid.pause();
    return;
  }
  const p = evVideoPt(e);
  const hit = view === "marks" ? hitMarker(c, p, e.pointerType !== "mouse") : null;
  const key: Key = hit ?? (tool === "I" ? "S" : tool);
  if (view === "tracer") setView("marks");
  vid.pause();
  cv.setPointerCapture(e.pointerId);
  tool = key;
  // grabbing an existing marker moves it by the drag distance; a fresh tap puts it under the pointer
  const q = hit ? c.pts[hit]! : p, off: Pt = [q[0] - p[0], q[1] - p[1]];
  c.pts[key] = [Math.round(q[0]), Math.round(q[1])];
  drag = { key, at: q, off };
  syncSteps();
  draw();
});
cv.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const [W, H] = vidSize(), e0 = evVideoPt(e), c = clip();
  const p: Pt = [Math.max(0, Math.min(W, e0[0] + drag.off[0])), Math.max(0, Math.min(H, e0[1] + drag.off[1]))];
  c.pts[drag.key] = [Math.round(p[0]), Math.round(p[1])];
  drag.at = p;
  draw();
});
function endDrag() {
  if (!drag) return;
  const c = clip(), k = drag.key;
  drag = null;
  // walk through the required steps: ball -> peak -> landing -> (ricochet)
  if (k === "S" && !c.pts.A) tool = "A";
  else if ((k === "A" || k === "M") && !c.pts.E) tool = c.pts.A ? "E" : "A";
  else if (k === "E" && c.ricochet && !c.pts.R) tool = "R";
  if (complete(c) && (k === "E" || k === "R")) toast("Shot marked: press ▶ Preview shot");
  changed();
}
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);

// ---------------------------------------------------------------- controls
$("play").onclick = () => (vid.paused ? vid.play().catch(() => {}) : vid.pause());
$("fBack").onclick = () => seekFrame(frameIdx() - 1);
$("fFwd").onclick = () => seekFrame(frameIdx() + 1);
$("slow").onclick = () => {
  const on = vid.playbackRate === 1;
  vid.playbackRate = on ? 0.25 : 1;
  $("slow").setAttribute("aria-pressed", String(on));
};
$("scrub").oninput = (e) => {
  if (!vid.duration) return;
  vid.pause();
  vid.currentTime = (+(e.target as HTMLInputElement).value / 1000) * vid.duration;
};
$("prevClip").onclick = () => select(cur - 1);
$("nextClip").onclick = () => select(cur + 1);
$("setImpact").onclick = () => {
  const c = clip();
  if (!c) return;
  c.impactFrame = frameIdx();
  seekFrame(c.impactFrame);
  tool = nextTool(c);
  view = "marks";
  changed();
};
$("goImpact").onclick = () => {
  const c = clip();
  if (c?.impactFrame != null) seekFrame(c.impactFrame);
};
$("viewMarks").onclick = () => setView("marks");
$("viewTracer").onclick = () => setView("tracer");
$("preview").onclick = () => {
  const c = clip();
  if (!c || !complete(c)) return;
  setView("tracer");
  vid.currentTime = Math.max(0, (c.impactFrame! - 0.6 * fps() + 0.5) / fps());
  vid.addEventListener("seeked", () => vid.play().catch(() => {}), { once: true });
};

document.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || !clip()) return;
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft") seekFrame(frameIdx() - step);
  else if (e.key === "ArrowRight") seekFrame(frameIdx() + step);
  else if (e.key === " ") vid.paused ? vid.play().catch(() => {}) : vid.pause();
  else if (e.key === "[") select(cur - 1);
  else if (e.key === "]") select(cur + 1);
  else return;
  e.preventDefault();
});

// files: picker + drag and drop anywhere
$<HTMLInputElement>("fileIn").onchange = (e) => {
  const inp = e.target as HTMLInputElement;
  if (inp.files?.length) addFiles(inp.files);
  inp.value = "";
};
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) document.body.classList.toggle("dragging", ++dragDepth > 0);
});
window.addEventListener("dragleave", () => document.body.classList.toggle("dragging", --dragDepth > 0));
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------- shot panel
const clubSel = $<HTMLSelectElement>("club");
function fillClubs() {
  clubSel.replaceChildren(
    ...(Object.keys(CLUBS) as Club[]).map((k) => new Option(`${CLUBS[k].label} · ${hangTime({ club: k }, hangTable).toFixed(1)} s`, k)),
  );
}
fillClubs();
clubSel.onchange = () => {
  clip().club = clubSel.value as Club;
  syncShot();
  changed();
};
for (const b of $("shape").querySelectorAll<HTMLButtonElement>("button"))
  b.onclick = () => {
    clip().shape = b.dataset.v as Shape;
    syncShot();
    changed();
  };
$<HTMLInputElement>("hang").oninput = (e) => {
  const v = parseFloat((e.target as HTMLInputElement).value);
  clip().hang = v > 0.3 ? v : null;
  changed();
};
$("hangReset").onclick = () => {
  clip().hang = null;
  syncShot();
  changed();
};
$<HTMLInputElement>("rico").onchange = (e) => {
  const c = clip();
  c.ricochet = (e.target as HTMLInputElement).checked;
  if (c.ricochet && complete({ ...c, ricochet: false }) && !c.pts.R) tool = "R";
  if (!c.ricochet && tool === "R") tool = "E";
  changed();
};
for (const b of $("tools").querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => setTool(b.dataset.k as Tool);
$("clearBend").onclick = () => {
  const c = clip();
  delete c.pts.M;
  delete c.pts.N;
  if (tool === "M" || tool === "N") tool = nextTool(c);
  changed();
};
$("clearMarks").onclick = () => {
  const c = clip();
  c.pts = {};
  tool = c.impactFrame === null ? "I" : "S";
  view = "marks";
  changed();
};

function syncShot() {
  const c = clip();
  if (!c) return;
  clubSel.value = c.club;
  for (const b of $("shape").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.v === c.shape));
  const h = $<HTMLInputElement>("hang");
  h.value = hangTime(c, hangTable).toFixed(1);
  h.style.color = c.hang ? "var(--accent)" : "";
  ($("hangReset") as HTMLButtonElement).disabled = !c.hang;
  $<HTMLInputElement>("rico").checked = c.ricochet;
  syncSteps();
  syncShapeWarn();
}

function syncShapeWarn() {
  const c = clip(), w = $("shapeWarn"), p = c?.pts;
  if (!c || !p?.S || !p.A || !p.E || (c.shape !== "fade" && c.shape !== "draw")) return void (w.hidden = true);
  const { ok } = shapeBend(p.S, p.A, p.E, c.shape);
  w.hidden = ok;
  w.textContent = `Your taps look more like a ${c.shape === "fade" ? "draw" : "fade"}, so the ${c.shape} curve is forced.`;
}

// hang-time table (e.g. driver 5.9, wood 5.7)
function buildHangTable() {
  const box = $("hangTable");
  box.replaceChildren();
  for (const k of Object.keys(CLUBS) as Club[]) {
    const lab = document.createElement("span");
    lab.textContent = CLUBS[k].label;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.1";
    inp.min = "0.5";
    inp.value = hangTime({ club: k }, hangTable).toFixed(1);
    inp.oninput = () => {
      const v = parseFloat(inp.value);
      if (v > 0.3) hangTable[k] = v;
      else delete hangTable[k];
      store.set("hang", hangTable);
      fillClubs();
      syncShot();
      draw();
    };
    box.append(lab, inp);
  }
}
buildHangTable();
$("hangTableReset").onclick = () => {
  hangTable = {};
  store.set("hang", hangTable);
  buildHangTable();
  fillClubs();
  syncShot();
  draw();
};

// ---------------------------------------------------------------- style panel
function setStyle(patch: Partial<TracerStyle>) {
  style = { ...style, ...patch };
  store.set("style", style);
  syncStyle();
  if (clip() && complete(clip()) && view !== "tracer") setView("tracer");
  else draw();
}

function renderPresets() {
  $("presets").replaceChildren(
    ...PRESETS.map((p) => {
      const b = document.createElement("button");
      b.className = "btn";
      b.innerHTML = `<span class="sw" style="background:linear-gradient(90deg,${p.style.tail},${p.style.head})"></span>`;
      b.append(p.name);
      b.onclick = () => setStyle({ ...p.style });
      return b;
    }),
  );
}
renderPresets();

const rng = (id: string, key: keyof TracerStyle, fmt: (v: number) => string) => {
  const el = $<HTMLInputElement>(id);
  el.oninput = () => setStyle({ [key]: +el.value } as Partial<TracerStyle>);
  return () => {
    el.value = String(style[key]);
    const out = el.parentElement!.querySelector("output");
    if (out) out.textContent = fmt(+el.value);
  };
};
const syncers = [
  rng("stMid", "mid", (v) => `${v}%`),
  rng("stGlowS", "glowStrength", (v) => `${v.toFixed(2)}×`),
  rng("stSize", "cometSize", (v) => `${v.toFixed(2)}×`),
  rng("stTailSec", "tailSec", (v) => `${v.toFixed(2)} s`),
  rng("stWidth", "lineWidth", (v) => `${v} px`),
  rng("stHold", "hold", (v) => `${v.toFixed(1)} s`),
];
for (const b of $("stType").querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => setStyle({ type: b.dataset.v as TracerStyle["type"] });
for (const b of $("stGlow").querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => setStyle({ glow: b.dataset.v === "glow" });
$<HTMLInputElement>("stHead").oninput = (e) => setStyle({ head: (e.target as HTMLInputElement).value });
$<HTMLInputElement>("stTail").oninput = (e) => setStyle({ tail: (e.target as HTMLInputElement).value });
$<HTMLInputElement>("stCore").onchange = (e) => setStyle({ core: (e.target as HTMLInputElement).checked });
$("stSwap").onclick = () => setStyle({ head: style.tail, tail: style.head });

function syncStyle() {
  for (const b of $("stType").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.v === style.type));
  for (const b of $("stGlow").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String((b.dataset.v === "glow") === style.glow));
  $<HTMLInputElement>("stHead").value = style.head;
  $<HTMLInputElement>("stTail").value = style.tail;
  $<HTMLInputElement>("stCore").checked = style.core;
  syncers.forEach((f) => f());
  const comet = style.type === "comet";
  $("rowSize").hidden = !comet;
  $("rowTail").hidden = !comet;
  $("rowWidth").hidden = comet;
  $("rowHold").hidden = comet;
  $("rowGlow").hidden = !style.glow;
}
syncStyle();

// ---------------------------------------------------------------- export
if (!webCodecsAvailable()) {
  const w = $("exWarn");
  w.hidden = false;
  w.textContent = "This browser can't encode video, so only the PNG overlay will work. Use Chrome or Edge (or Safari 17+ on iPhone) for MP4.";
}

// On phones a plain download goes to the Files app; the share sheet offers "Save Video" (camera roll). Sharing needs a
// fresh tap, and an export takes a while, so finished files wait behind a button.
const touchDevice = matchMedia("(pointer: coarse)").matches;
const shareable = (f: File) => touchDevice && !!navigator.canShare?.({ files: [f] });
function offerSave(files: File[]) {
  const box = $("exSave");
  box.replaceChildren(
    ...files.flatMap((f) => {
      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = f.name;
      const share = document.createElement("button");
      share.className = "btn primary block";
      share.textContent = f.type.startsWith("video/") ? "Save video (Photos / share)" : "Save / share";
      share.onclick = () =>
        navigator.share({ files: [f] }).catch((e) => {
          if (e?.name !== "AbortError") download(f, f.name);
        });
      const dl = document.createElement("button");
      dl.className = "btn block";
      dl.textContent = "Download to Files";
      dl.onclick = () => download(f, f.name);
      return [nm, share, dl];
    }),
  );
  box.hidden = !files.length;
}

async function runExport(kind: "mp4" | "png" | "webm", list: Clip[]) {
  if (busy) return;
  offerSave([]);
  const ready: File[] = [];
  const deliver = (blob: Blob, name: string) => {
    const f = new File([blob], name, { type: blob.type });
    if (shareable(f)) ready.push(f);
    else download(blob, name);
  };
  busy = new AbortController();
  const prog = $("exProg"), bar = prog.querySelector("i") as HTMLElement, msg = $("exMsg");
  prog.hidden = false;
  syncSteps();
  try {
    for (const [n, c] of list.entries()) {
      const info = c.info ?? (c.info = await probe(c.file));
      const label = list.length > 1 ? `${n + 1}/${list.length} ` : "";
      const onProgress = (p: number) => {
        bar.style.width = `${(p * 100).toFixed(1)}%`;
        msg.textContent = `${label}${Math.round(p * 100)}%`;
      };
      onProgress(0);
      const job = { file: c.file, info, flight: flightOf(c)!, impactFrame: c.impactFrame!, style, onProgress, signal: busy.signal };
      const t0 = performance.now();
      if (kind === "mp4") deliver(await exportBakedMp4(job), outName(c.file, "tracer.mp4"));
      else if (kind === "png") deliver(await exportPngSequence(job), outName(c.file, "tracer_png.zip"));
      else deliver(await exportAlphaWebm(job), outName(c.file, "tracer_alpha.webm"));
      console.info(`[flighted] ${kind} export of ${c.file.name} took ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    }
    offerSave(ready);
    toast(ready.length ? "Export done: tap Save below" : list.length > 1 ? `Exported ${list.length} clips` : "Export done: check your downloads");
  } catch (e: any) {
    if (e?.name === "AbortError" || e?.name === "ConversionCanceledError") toast("Export canceled");
    else {
      console.error(e);
      toast(`Export failed: ${e?.message ?? e}`, 6000);
    }
  } finally {
    busy = null;
    prog.hidden = true;
    syncSteps();
  }
}
$("exMp4").onclick = () => runExport("mp4", [clip()]);
$("exPng").onclick = () => runExport("png", [clip()]);
$("exWebm").onclick = () => runExport("webm", [clip()]);
$("exAll").onclick = () => runExport("mp4", clips.filter(complete));
$("exCancel").onclick = () => busy?.abort();

syncShell();

// ---------------------------------------------------------------- kept clips (this device only, one hour)
// dev only: ?keep=60 shortens the hour to 60 s for testing
if (import.meta.env.DEV && new URLSearchParams(location.search).has("keep"))
  setKeepTime(+new URLSearchParams(location.search).get("keep")! * 1000);

function dropClips(ids: string[], why: string) {
  let n = 0;
  for (const id of ids) {
    const i = clips.findIndex((c) => c.id === id);
    if (i >= 0) {
      removeClip(i);
      n++;
    }
  }
  if (n) toast(why.replace("{n}", n === 1 ? "1 clip" : `${n} clips`), 5000);
}

async function expireTick() {
  dropClips(await purgeExpired(), "Removed {n}: an hour passed without changes.");
  purgeOldMarks();
  renderList(); // refresh the minutes left
}
setInterval(expireTick, 20_000);

$("clearAll").onclick = async () => {
  if (!confirm("Remove every clip from this page and delete the copies kept on this device?")) return;
  await forgetAll();
  purgeOldMarks(true);
  while (clips.length) removeClip(clips.length - 1);
  toast("All clips cleared from this device");
};

const restored = restore().then((items) => {
  purgeOldMarks();
  if (items.length) {
    addClips(items.map(({ meta, file }) => ({ file, id: meta.id, savedAt: meta.savedAt })));
    toast(`Restored ${items.length === 1 ? "1 clip" : `${items.length} clips`} from the last hour`);
  }
});

// dev only: ?load=/_local/clip.mp4&load=... loads clips from the dev server (public/_local is git-ignored)
if (import.meta.env.DEV) {
  const urls = new URLSearchParams(location.search).getAll("load");
  if (urls.length)
    restored
      .then(() =>
        Promise.all(
          urls.map(async (u) => {
            const b = await (await fetch(u)).blob();
            return new File([b], u.split("/").pop()!, { type: b.type || "video/mp4", lastModified: 0 });
          }),
        ),
      )
      .then((fs) => fs.filter((f) => !clips.some((c) => keyOf(c.file) === keyOf(f))))
      .then((fs) => void (fs.length && addFiles(fs)));
}

// handy for debugging in the console
(window as any).flighted = { clips, get style() { return style; }, addFiles };
