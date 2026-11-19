# Flighted

Free golf shot tracers, right in your browser. Add a clip, tap the ball, the peak and where it lands, and download
it with the tracer burned in, in the original shape or vertical 9:16 for Reels, TikTok and Shorts. No account, no
subscription, no AI, and your videos never leave your device.

Made by **Garrick Woods Golf** ([YouTube](https://www.youtube.com/@garrickwoodsgolf),
[Instagram](https://www.instagram.com/garrickwoodsgolf/)).

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
- No analytics, no third-party scripts, no network requests apart from loading the site itself (and the sample clip,
  from the same site, if you ask for it). The site is hosted on GitHub Pages, which keeps its own server logs under
  GitHub's privacy statement.

## What it does

- **First visit:** a short walkthrough (bring it back with *How it works*) and a **sample clip** to practise on. The
  sample is drawn from scratch by `scripts/make_sample.py`; its ball follows the app's own flight model, so the default
  tracer sits right on it.
- **Upload one or more clips** (MP4 / MOV from a phone or camera; camera roll on phones; drag and drop works). Use ‹ › or `[` `]` to move between clips.
- **Mark each shot**:
  1. Play or scrub to the **impact** frame (−1f / +1f, ← →, Shift+← → for 10 frames, ¼ speed), pause and tap the
     **ball**: that sets the impact frame too. (*Move impact to this frame* fixes it later.)
  2. Scrub forward and tap the **peak**, then the **landing**.
  3. Optional: **Bend 1** (on the way up) and **Bend 2** (on the way down) are extra points the line passes through. **Ricochet** adds a short hop after landing.
  - A magnifier appears while you drag a point. Drag any marker to fine-tune it.
  - Pick the **club** (sets the hang time), the **shape** (auto / straight / fade / draw) and, if needed, a per-shot **flight time**.
  - Default hang times: driver 6.5 s, wood 6.0, iron 5.5, low iron 4.5, wedge 4.6, punch 4.0, chip 2.5. You can change them under *Club flight times* (e.g. driver 5.9, wood 5.7). Marks and settings are saved in the browser.
  - Shape, flight time, ricochet and bend points live under *More shot options*; most shots don't need them.
- **Style** (applies to every clip): the defaults (red comet with a white-hot core) look right without touching
  anything. Presets are one tap; everything else is under *Customize*: comet or line, head and tail colors with a
  gradient blend point, glow or solid, glow strength, white-hot core, comet size and tail length, line thickness and
  hold time.
- **Live preview** on a canvas over the video, drawn with the same code that renders the export.
- **Download**:
  - *Download video*: MP4 (H.264), original frame rate and audio (camera PCM audio is converted to AAC).
    - **Original** shape at the original resolution, or
    - **Vertical 9:16** at 1080×1920: a full-height window around the shot (the preview shades what's cut off).
    - A small *Made with Flighted · @garrickwoodsgolf* credit is on by default; untick it to leave it off.
  - *Download all marked clips*: batch export.
  - *Overlays for editing apps* (no credit, original shape):
    - *PNG sequence (.zip)*: transparent frames starting on the impact frame, plus a `HOW_TO_USE.txt` with the exact
      start frame. In Premiere: Import → first PNG → tick *Image Sequence*.
    - *Transparent WebM* (VP9 + alpha): full clip length, so it lines up when placed above the clip.

Exports use **WebCodecs**: Chrome or Edge on a computer are tested. The PNG overlay works in any modern browser.

**Phones:** the layout works at phone width with touch marking (drag a marker from beside it so your finger doesn't
hide it). On phones, a finished video waits behind a *Save video* button that opens the share sheet (*Save Video* puts
it in Photos), with *Download to Files* as a fallback. Safari without canvas filters gets a fallback glow that looks
the same. **Not yet tested on a real iPhone:** iOS Safari 26+ supports the WebCodecs features the MP4 export needs;
older iOS may not export; the transparent WebM most likely won't work on iPhone; long 4K clips can run out of memory.

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
- add `?keep=90` to shorten the one-hour clip keeping to 90 seconds;
- add `?nofilter` to draw the glow the way Safari does without canvas filters.

Rebuild the sample clip with `python scripts/make_sample.py path/to/ffmpeg` (numpy, Pillow, ffmpeg with libx264).

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

## Future: optional accounts

Not built, just the plan if it's ever needed.

- **Today:** all footage stays on the device. There's no login, and clips are kept in the browser (IndexedDB) for an
  hour after the last change.
- **Across devices:** if friends want their work on more than one device, add an *optional* login that syncs only the
  small data: tracer marks, styles and projects (a few KB per clip). Candidates: Supabase Auth + Postgres, or
  Cloudflare D1 + Workers.
- **Footage stays local.** Raw clips are never uploaded. If sharing becomes a feature, store only *exported* clips, and
  only when the user opts in (e.g. Cloudflare R2, which has no egress fees).
- **Before storing any footage:** a privacy policy, a way for users to delete their data, and per-user access rules.

## License

Flighted is **source-available, not open source**. It's licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE)
(Required Notice: Copyright (c) 2026 Garrick Woods Golf).

- **Using the website** to put tracers on your own golf videos is free for everyone, including videos on monetized
  channels. That's what it's for.
- **The code:** you may read, copy, change and share it for noncommercial purposes.
- **Not allowed without permission:** selling the code or a product or service built on it, or using it in a
  commercial product. For commercial use, contact Garrick Woods Golf (via
  [Instagram](https://www.instagram.com/garrickwoodsgolf/)).
