"""Generate the practice clip (public/sample/flighted-sample.mp4): a stylised tripod shot of a drive, drawn from scratch,
so the walkthrough has something to mark without using anyone's real footage.

    python scripts/make_sample.py [path/to/ffmpeg]

Needs numpy, Pillow and ffmpeg (libx264). The ball is hit on frame 36 (1.2 s at 30 fps).

The ball follows sample_path.json: the app's own flight model (Flight.fromMarks) for ball (600, 606), peak (790, 150),
landing (862, 371) and the default driver hang time, so with default settings the tracer sits right on the ball.
"""

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
PATH = json.loads((HERE / "sample_path.json").read_text())["pts"]  # per frame after impact: x, y, distance
W, H, FPS, SS = 1280, 720, 30, 2  # SS = supersampling for smooth edges
IMPACT = 36
ROLL = 1.3  # s after landing
N = IMPACT + len(PATH) + int((ROLL + 1.2) * FPS)
HORIZON = 335
BALL0 = tuple(PATH[0][:2])
LAND = tuple(PATH[-1][:2])
FLAG = (884, 366)
OUT = HERE.parent / "public" / "sample" / "flighted-sample.mp4"


def lerp(a, b, u):
    return a + (b - a) * u


def background() -> Image.Image:
    w, h = W * SS, H * SS
    y = np.arange(h)[:, None] / SS
    img = np.zeros((h, w, 3), np.float32)
    # sky
    u = np.clip(y / HORIZON, 0, 1)
    sky = np.stack([lerp(96, 196, u), lerp(150, 220, u), lerp(222, 245, u)], -1)
    # fairway with perspective mowing stripes
    g = np.clip((y - HORIZON) / (H - HORIZON), 0, 1)
    stripe = (np.floor(np.sqrt(g) * 14) % 2) * 9
    grass = np.stack([lerp(118, 58, g) + stripe, lerp(168, 122, g) + stripe, lerp(84, 42, g) + stripe * 0.4], -1)
    img[:] = np.where((y < HORIZON)[..., None], sky, grass)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # distant tree line
    xs = np.arange(0, W + 8, 8)
    top = HORIZON - 26 - 14 * np.sin(xs / 37.0) - 9 * np.sin(xs / 13.0 + 1.3) - 10 * np.sin(xs / 91.0 + 0.4)
    poly = [(0, (HORIZON + 4) * SS)] + [(x * SS, t * SS) for x, t in zip(xs, top)] + [(W * SS, (HORIZON + 4) * SS)]
    d.polygon(poly, fill=(46, 84, 50))
    # a few nearer trees
    for cx, r in [(120, 70), (210, 52), (1130, 78), (1225, 60)]:
        d.ellipse([(cx - r) * SS, (HORIZON - 2.3 * r) * SS, (cx + r) * SS, (HORIZON + 0.2 * r) * SS], fill=(38, 72, 42))
        d.rectangle([(cx - 6) * SS, (HORIZON - 10) * SS, (cx + 6) * SS, (HORIZON + 14) * SS], fill=(70, 52, 38))
    # green + flag at the landing area
    d.ellipse([(FLAG[0] - 60) * SS, (FLAG[1] - 6) * SS, (FLAG[0] + 60) * SS, (FLAG[1] + 9) * SS], fill=(104, 176, 92))
    d.line([FLAG[0] * SS, FLAG[1] * SS, FLAG[0] * SS, (FLAG[1] - 34) * SS], fill=(235, 235, 235), width=2 * SS)
    d.polygon([(FLAG[0] * SS, (FLAG[1] - 34) * SS), ((FLAG[0] + 15) * SS, (FLAG[1] - 29) * SS), (FLAG[0] * SS, (FLAG[1] - 24) * SS)],
              fill=(230, 40, 40))
    # tee box shadow
    d.ellipse([(BALL0[0] - 140) * SS, (BALL0[1] + 60) * SS, (BALL0[0] + 40) * SS, (BALL0[1] + 100) * SS], fill=(52, 104, 36))
    return im


def swing_angle(f: float) -> float:
    """Club angle (radians from 'pointing at the ball'): back, down through impact, follow-through."""
    t = f / FPS
    ti = IMPACT / FPS
    if t < 0.25:
        return 0.0
    if t < 0.95:  # backswing
        u = (t - 0.25) / 0.7
        return -math.radians(230) * (1 - (1 - u) ** 2)
    if t < ti:  # downswing, accelerating
        u = (t - 0.95) / (ti - 0.95)
        return -math.radians(230) * (1 - u ** 2)
    u = min(1, (t - ti) / 0.45)  # follow-through
    return math.radians(200) * (1 - (1 - u) ** 2)


def golfer(d: ImageDraw.ImageDraw, f: float):
    s = SS
    body = (34, 36, 40)
    # legs, torso, head (seen from behind / down the line)
    d.polygon([(470 * s, 700 * s), (494 * s, 700 * s), (512 * s, 575 * s), (500 * s, 560 * s)], fill=body)
    d.polygon([(536 * s, 700 * s), (560 * s, 700 * s), (532 * s, 560 * s), (514 * s, 570 * s)], fill=(28, 30, 34))
    d.polygon([(492 * s, 572 * s), (536 * s, 572 * s), (556 * s, 470 * s), (512 * s, 462 * s)], fill=(58, 62, 72))
    d.ellipse([(526 - 21) * s, (440 - 23) * s, (526 + 21) * s, (440 + 23) * s], fill=(70, 52, 40))
    d.chord([(526 - 23) * s, (440 - 27) * s, (526 + 23) * s, (440 + 17) * s], 180, 360, fill=(235, 235, 235))  # cap
    # arms + club: one rigid line from the shoulders to the clubhead
    px, py = 534, 478
    a0 = math.atan2(BALL0[1] - py, BALL0[0] - px)
    L = math.hypot(BALL0[0] - px, BALL0[1] - py) + 4
    a = a0 + swing_angle(f)
    hx, hy = px + math.cos(a) * L * 0.42, py + math.sin(a) * L * 0.42
    cx, cy = px + math.cos(a) * L, py + math.sin(a) * L
    d.line([px * s, py * s, hx * s, hy * s], fill=(58, 62, 72), width=17 * s)
    d.line([hx * s, hy * s, cx * s, cy * s], fill=(170, 172, 178), width=3 * s)
    d.ellipse([(cx - 9) * s, (cy - 6) * s, (cx + 9) * s, (cy + 6) * s], fill=(20, 20, 22))


def ball_at(f: int):
    """Screen position and radius of the ball on frame f."""
    i = f - IMPACT
    if i <= 0:
        return BALL0[0], BALL0[1], 7.0
    if i < len(PATH):
        x, y, dist = PATH[i]
        return x, y, max(2.6, 7 * math.exp(-dist / 45))  # smaller as it goes away
    u = min(1, (i - len(PATH) + 1) / FPS / ROLL)
    e = 1 - (1 - u) ** 2
    hop = 7 * math.sin(math.pi * min(1, u * 2.2)) * (1 - min(1, u * 2.2))
    return lerp(LAND[0], LAND[0] + 22, e), lerp(LAND[1], LAND[1] + 2, e) - hop, 2.4


def main():
    ffmpeg = sys.argv[1] if len(sys.argv) > 1 else "ffmpeg"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bg = background()
    proc = subprocess.Popen(
        [ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         "-metadata", "title=Flighted sample clip (generated)", str(OUT)],
        stdin=subprocess.PIPE,
    )
    for f in range(N):
        im = bg.copy()
        d = ImageDraw.Draw(im)
        bx, by, br = ball_at(f)
        # tee + ball (the ball sits on the tee until impact)
        d.rectangle([(BALL0[0] - 2) * SS, (BALL0[1] + 5) * SS, (BALL0[0] + 2) * SS, (BALL0[1] + 16) * SS], fill=(240, 240, 240))
        golfer(d, f)
        glow = Image.new("L", im.size, 0)
        ImageDraw.Draw(glow).ellipse([(bx - br * 2) * SS, (by - br * 2) * SS, (bx + br * 2) * SS, (by + br * 2) * SS], fill=110)
        im.paste((255, 255, 255), mask=glow.filter(ImageFilter.GaussianBlur(br * SS)))
        d.ellipse([(bx - br) * SS, (by - br) * SS, (bx + br) * SS, (by + br) * SS], fill=(252, 252, 250))
        frame = im.resize((W, H), Image.LANCZOS)
        ImageDraw.Draw(frame).text((W - 150, H - 26), "Flighted sample clip", fill=(255, 255, 255))
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    if proc.wait():
        raise SystemExit("ffmpeg failed")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB), impact on frame {IMPACT}")


if __name__ == "__main__":
    main()
