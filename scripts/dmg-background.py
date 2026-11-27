#!/usr/bin/env python3
"""Draws the disk image window's background: a pale garden ground, a few
branches growing in from the corners and a curved stem from the app to the
Applications folder. Writes build/darwin/dmg-background.tiff (1x and 2x in
one file, via macOS tiffutil), which is committed; rerun after changing it.

Finder draws the icon labels itself, black in light mode, so the ground
stays light. Positions must match scripts/dmg-settings.py.

    python3 scripts/dmg-background.py   # needs Pillow
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 640, 400          # window content size, points
APP, APPS = (170, 170), (470, 170)  # icon centres, see dmg-settings.py
GROUND = (241, 245, 239)
BRANCH = (46, 163, 90)
STEM = (46, 163, 90)
TEXT = (96, 112, 100)
FONT = "/System/Library/Fonts/SFNS.ttf"


def branch(d, s, x, y, ang, length, width, depth, rnd, buds):
    if depth == 0 or length < 6:
        buds.append((x, y))
        return
    seg = 6
    steps = max(2, int(length / seg))
    bend = rnd.uniform(-0.02, 0.02)
    for i in range(steps):
        ang += bend + rnd.uniform(-0.05, 0.05)
        nx, ny = x + math.cos(ang) * seg, y + math.sin(ang) * seg
        w = max(1.0, width * (1 - i / steps * 0.45))
        alpha = int(70 + 60 * (width / 6))
        d.line([(x * s, y * s), (nx * s, ny * s)], fill=BRANCH + (alpha,), width=max(1, int(w * s)))
        x, y = nx, ny
        if i > 1 and rnd.random() < 0.13 and depth > 1:
            side = rnd.choice((-1, 1))
            branch(d, s, x, y, ang + side * rnd.uniform(0.5, 0.9), length * rnd.uniform(0.35, 0.55),
                   width * 0.6, depth - 1, rnd, buds)
    branch(d, s, x, y, ang + rnd.uniform(-0.3, 0.3), length * 0.7, width * 0.72, depth - 1, rnd, buds)


def render(s):
    img = Image.new("RGBA", (W * s, H * s), GROUND + (255,))
    art = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    rnd = random.Random(7)
    buds = []
    # Two plants growing in from the corners, away from the icons.
    branch(d, s, -20, H + 10, -1.0, 95, 5, 5, rnd, buds)
    branch(d, s, 40, H + 12, -1.3, 55, 3.5, 4, rnd, buds)
    branch(d, s, W + 10, -10, 2.45, 85, 4.5, 5, rnd, buds)
    branch(d, s, W + 12, 40, 2.9, 45, 3, 4, rnd, buds)
    for bx, by in buds:
        if 0 < bx < W and 0 < by < H:
            r = rnd.uniform(1.8, 3.0) * s
            d.ellipse([bx * s - r, by * s - r, bx * s + r, by * s + r], fill=(70, 216, 122, 150))
    img.alpha_composite(art)

    # The stem: a gentle arc from the app to Applications, ending in a leaf.
    d = ImageDraw.Draw(img)
    x0, x1, y = APP[0] + 74, APPS[0] - 78, APP[1] - 4
    pts = []
    for i in range(41):
        t = i / 40
        pts.append(((x0 + (x1 - x0) * t) * s, (y - math.sin(math.pi * t) * 18) * s))
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=STEM + (210,), width=int(2.2 * s))
    # Arrowhead: an open chevron along the stem's end direction.
    ex, ey = pts[-1]
    px, py = pts[-5]
    ang = math.atan2(ey - py, ex - px)
    L = 9 * s
    for side in (-1, 1):
        a2 = ang + math.pi + side * 0.55
        d.line([(ex, ey), (ex + math.cos(a2) * L, ey + math.sin(a2) * L)], fill=STEM + (210,), width=int(2.2 * s))
    r = 1.1 * s
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=STEM + (210,))

    f = ImageFont.truetype(FONT, 14 * s)
    msg = "Drag Tiny Systems to Applications"
    tw = d.textlength(msg, font=f)
    d.text(((W * s - tw) / 2, 292 * s), msg, font=f, fill=TEXT + (255,))
    return img.convert("RGB")


if __name__ == "__main__":
    import subprocess
    import tempfile

    out = os.path.join(os.path.dirname(__file__), "..", "build", "darwin", "dmg-background.tiff")
    with tempfile.TemporaryDirectory() as tmp:
        one, two = os.path.join(tmp, "bg.png"), os.path.join(tmp, "bg@2x.png")
        render(1).save(one)
        render(2).save(two)
        subprocess.run(["tiffutil", "-cathidpicheck", one, two, "-out", out], check=True, capture_output=True)
    print("wrote build/darwin/dmg-background.tiff")
