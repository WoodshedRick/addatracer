# Flighted

Free golf shot tracers, right in your browser. Upload your clips, tap the ball, the peak and the landing,
preview the tracer over the video, and download the clip with the tracer burned in, or a transparent overlay
for your editor. No account, no subscription, no AI, and your videos never leave your computer.

![Flighted comet tracer](public/favicon.svg)

## Privacy

There is no login and no server: the site is static files, and everything (decoding, drawing, encoding) runs in your
browser. Videos are never uploaded, so any number of people can use it at once and nobody can see anyone else's
footage.

- Clips you add are kept **in this browser only** (IndexedDB) for **one hour after your last change**, so a refresh
  doesn't lose them. After that they're deleted automatically (on the next visit, or while the page is open).
  *Clear all now* deletes them straight away.
- Marks are kept the same way. Style and club flight times are kept in this browser's local storage.
- If the browser won't store a clip (private browsing, not enough space, Safari clearing site data), the clip still
  works; it just won't survive a refresh.
- No analytics, no third-party scripts, no network requests apart from loading the site itself.

## What it does today (MVP)

- **Upload one or more clips** (MP4 / MOV from a phone or camera; drag and drop works). Use ‹ › or `[` `]` to move between clips.
- **Mark each shot**:
  1. Scrub to the **impact** frame (−1f / +1f, ← →, Shift+← → for 10 frames, ¼ speed) and press *Set impact frame here*.
  2. Tap the **ball**, then scrub forward and tap the **peak**, then the **landing**.
  3. Optional: **Bend 1** (on the way up) and **Bend 2** (on the way down) are extra points the line passes through. **Ricochet** adds a short hop after landing.
  - A magnifier appears while you drag a point. Drag any marker to fine-tune it.
  - Pick the **club** (sets the hang time), the **shape** (auto / straight / fade / draw) and, if needed, a per-shot **flight time**.
  - Default hang times: driver 6.5 s, wood 6.0, iron 5.5, low iron 4.5, wedge 4.6, punch 4.0, chip 2.5. You can change them under *Club flight times* (e.g. driver 5.9, wood 5.7). Marks and settings are saved in the browser.
- **Style** (applies to every clip): comet or line, head and tail colors with a gradient blend point, glow or solid,
  glow strength, white-hot core, comet size and tail length, line thickness and hold time. Presets include *Red comet*
  (the original look) and *Thin white line*.
- **Live preview** on a canvas over the video, drawn with the same code that renders the export.
- **Export**:
  - *MP4 with tracer*: H.264, original resolution and frame rate. Audio is kept; camera PCM audio is converted to AAC.
  - *Overlay: PNG sequence (.zip)*: transparent frames starting on the impact frame, plus a `HOW_TO_USE.txt` with the
    exact start frame. In Premiere: Import → first PNG → tick *Image Sequence*.
  - *Overlay: transparent WebM* (VP9 + alpha): full clip length, so it lines up when placed above the clip.
  - *MP4s for all marked clips*: batch export.

Exports use **WebCodecs**, so use **Chrome or Edge** (desktop) for MP4/WebM. The PNG overlay works in any modern browser.

**Phones:** the layout works at phone width with touch marking (drag a marker from beside it so your finger doesn't
hide it). On iPhone, finished exports wait behind a *Save video* button that opens the share sheet (*Save Video* puts
it in Photos). iOS Safari 26+ supports the WebCodecs features the MP4 export needs; older iOS and the transparent WebM
export are untested and may not work. Long 4K clips can run out of memory on a phone.

**Camera:** the MVP assumes a tripod or still camera. If the camera pans, the tracer won't follow the ball (see roadmap).

## Develop

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the tracer maths
npm run build      # static site in dist/ (host anywhere: GitHub Pages, Netlify, Cloudflare Pages)
```

Dev tips (dev server only, stripped from builds):
- put a test clip in `public/_local/` (git-ignored, never copied into `dist/`) and open
  `http://localhost:5173/?load=/_local/clip.mp4` to load it without the file picker;
- add `?keep=90` to shorten the one-hour clip keeping to 90 seconds.

Every push to `main`/`master` runs the tests, builds and deploys to GitHub Pages (`.github/workflows/pages.yml`).

### Layout

| Path | What |
| --- | --- |
| `src/tracer/path.ts` | Shot path: rise/fall Hermite curves, bend points, auto/straight/fade/draw shapes |
| `src/tracer/flight.ts` | Timing: physics speed profile retimed onto the path (apex at 58 % of hang time), club table, ricochet, comet/line frame geometry |
| `src/tracer/style.ts` | Style model, presets, head→tail gradient (`w = 1 − (1 − u)^p`, `p = ln .5 / ln mid`) |
| `src/tracer/draw.ts` | Canvas 2D drawing of comet and line, shared by preview and export |
| `src/tracer/tracer.test.ts` | Unit tests, including parity with the original Python (`__fixtures__/python_ref.json`) |
| `src/media.ts` | Probe (fps/size), MP4 export, PNG-sequence and WebM-alpha overlays ([mediabunny](https://mediabunny.dev), [fflate](https://github.com/101arrowz/fflate)) |
| `src/keep.ts` | Keeps clips in IndexedDB for an hour after the last change; expiry and clean-up |
| `src/main.ts` | The app UI: clips, marking, style panel, preview, export |

The path and timing maths are ported from the original Python tracer and marking page. The tests check the
TypeScript against values generated by the Python (`src/tracer/__fixtures__/make_python_ref.py`).

## Roadmap

- **Camera-motion tracking** for panning/handheld shots: track background features from the impact frame
  (optical flow, e.g. OpenCV.js or a small WebGL/WASM LK tracker), then move the tracer with the camera.
- **ffmpeg.wasm fallback** for browsers without WebCodecs (Firefox/Safari gaps), and for ProRes 4444 overlays.
- **Stream exports to disk** (File System Access API) so long 4K clips don't have to fit in memory.
- Per-clip styles (e.g. a color per player) and saving/loading style presets.
- Trim export to the shot (e.g. 1 s before impact to 1 s after the tracer).
- Better frame-accurate seeking on variable-frame-rate phone clips (decode frames with WebCodecs instead of `<video>` seeking).
- PWA/offline install; test exports on real iPhones and Android phones.

## License

Not chosen yet.
