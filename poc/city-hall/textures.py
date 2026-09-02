#!/usr/bin/env python3
"""Textures for the otra.city City Hall plot (the platform's own lot).

Writes, next to this script (poc/city-hall/):
  palette.png / palette_emis.png  256 px, 16x16 swatches (base RGBA + emissive RGB)
  palette_map.json                swatch name -> cell / colors
  atlas.png / atlas_map.json      1024 px art atlas (signage, plaques, medallion)
  tile_base.png / tile_normal.png / tile_rough.png / tile_emis.png   512 px PBR floor tiles

Run with the system python (PIL + numpy), NOT inside Blender.
"""
import json
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
INDEX = json.load(open(ROOT / "public" / "plots" / "index.json"))

FONTS = {
    "black": "/Library/Fonts/SF-Pro-Display-Black.otf",
    "heavy": "/Library/Fonts/SF-Pro-Display-Heavy.otf",
    "bold": "/Library/Fonts/SF-Pro-Display-Bold.otf",
    "semibold": "/Library/Fonts/SF-Pro-Display-Semibold.otf",
    "medium": "/Library/Fonts/SF-Pro-Text-Medium.otf",
    "mono": "/System/Library/Fonts/Menlo.ttc",
}


def font(kind, size):
    path = FONTS[kind]
    if path.endswith(".ttc"):
        return ImageFont.truetype(path, size, index=1)  # Menlo Bold
    return ImageFont.truetype(path, size)


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def scale(rgb, k):
    return tuple(max(0, min(255, round(c * k))) for c in rgb)


# ----------------------------------------------------------------- palette
# name -> (base hex, alpha, emissive hex or None)
HOT = {
    "cyan": "#47f2ff", "magenta": "#ff2d95", "gold": "#ffd23e", "white": "#ffffff",
    "violet": "#7c5cff", "red": "#ff3b30", "green": "#7dffa8", "warm": "#ffbf80",
    "blue": "#3d7bff",
}
PAL = {}
# opaque structure (no emissive)
for name, hx in {
    "plaza": "#1a1826", "podium": "#232037", "podium_top": "#2a2742", "step": "#1f1c31",
    "column": "#2c2a48", "column_lt": "#3a3860", "capital": "#46446c", "beam": "#221f38",
    "beam_dk": "#17152a", "rib": "#2f2d4a", "rib_dk": "#1d1b30", "drum": "#1e1a33",
    "drum_lt": "#2b2648", "trim": "#0d0a14", "steel": "#646a80", "steel_dk": "#3c4152",
    "plinth": "#8b90a8", "plinth_dk": "#5a5f75", "white": "#e9edf6", "gold": "#c9a341",
    "gold_dk": "#6b5420", "road": "#17161c", "paving": "#24222c", "bench": "#3a2f52",
    "soil": "#1b1a12", "leaf": "#1f4a2c", "cyan_dk": "#0f4a52", "magenta_dk": "#4a1030",
    "ink": "#080611",
}.items():
    PAL[name] = (hx, 255, None)
# emissive tiers: hot (blooms), soft (glows, no bloom), dim (ambient)
for hue, hx in HOT.items():
    rgb = hex2rgb(hx)
    base = "#%02x%02x%02x" % scale(rgb, 0.14)
    PAL["e_" + hue] = (base, 255, hx)
    PAL["e_%s_soft" % hue] = (base, 255, "#%02x%02x%02x" % scale(rgb, 0.70))
    PAL["e_%s_dim" % hue] = (base, 255, "#%02x%02x%02x" % scale(rgb, 0.42))
# translucent (only meaningful through the blended material)
PAL["glass"] = ("#a6e6ff", 42, "#123a44")
PAL["glass_gate"] = ("#47f2ff", 76, "#1a5c66")
PAL["holo_white"] = ("#e9edf6", 120, "#a8acb3")
PAL["holo_vacant"] = ("#47f2ff", 60, "#1e6670")
PAL["holo_cyan"] = ("#47f2ff", 140, "#32a9b3")
for lot in INDEX["lots"]:
    rgb = hex2rgb(lot["color"])
    PAL["holo_" + lot["slug"]] = (lot["color"], 150, "#%02x%02x%02x" % scale(rgb, 0.85))
assert len(PAL) <= 256, len(PAL)

G, CELL = 16, 16
pal = Image.new("RGBA", (G * CELL, G * CELL), (0, 0, 0, 255))
pem = Image.new("RGB", (G * CELL, G * CELL), (0, 0, 0))
dp, de = ImageDraw.Draw(pal), ImageDraw.Draw(pem)
pmap = {"grid": G, "cell_px": CELL, "size": G * CELL, "colors": {}}
for i, (name, (base, alpha, emis)) in enumerate(PAL.items()):
    c, r = i % G, i // G
    box = (c * CELL, r * CELL, (c + 1) * CELL - 1, (r + 1) * CELL - 1)
    dp.rectangle(box, fill=hex2rgb(base) + (alpha,))
    de.rectangle(box, fill=hex2rgb(emis) if emis else (0, 0, 0))
    pmap["colors"][name] = {"cell": [c, r], "base": base, "alpha": alpha, "emis": emis}
pal.save(HERE / "palette.png")
pem.save(HERE / "palette_emis.png")
json.dump(pmap, open(HERE / "palette_map.json", "w"), indent=1)
print("palette:", len(PAL), "swatches")

# ------------------------------------------------------------------- atlas
S = 1024
BG = (11, 9, 20)
CYAN, WHITE, GOLD, MAG, DIM = hex2rgb("#47f2ff"), (233, 237, 246), hex2rgb("#ffd23e"), hex2rgb("#ff2d95"), (138, 134, 160)
atlas = Image.new("RGB", (S, S), BG)
amap = {"size": S, "regions": {}}


def region(name, x, y, w, h):
    amap["regions"][name] = [x, y, w, h]
    return x, y, w, h


def tracked_width(f, text, tracking):
    return sum(f.getlength(ch) for ch in text) + tracking * (len(text) - 1)


def draw_tracked(draw, xy, text, f, fill, tracking=0, anchor="ls"):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill, anchor=anchor)
        x += f.getlength(ch) + tracking


def glow_text(img, xy, text, f, fill, tracking=0, blur=18, glow_k=0.55, anchor="ls", align="m"):
    """Crisp text over a baked soft halo (reads as neon even before bloom)."""
    w = tracked_width(f, text, tracking)
    x, y = xy
    if align == "m":
        x -= w / 2
    elif align == "r":
        x -= w
    mask = Image.new("L", img.size, 0)
    draw_tracked(ImageDraw.Draw(mask), (x, y), text, f, 255, tracking, anchor)
    halo = mask.filter(ImageFilter.GaussianBlur(blur))
    halo = halo.point(lambda v: int(min(255, v * 1.6 * glow_k)))
    layer = Image.new("RGB", img.size, fill)
    img.paste(layer, (0, 0), halo)
    img.paste(layer, (0, 0), mask)
    return w


def frame(draw, box, color, width=6, inset=0):
    x0, y0, x1, y1 = box
    draw.rectangle((x0 + inset, y0 + inset, x1 - inset, y1 - inset), outline=color, width=width)


# main sign: OTRA (hot cyan, blooms) / CITY HALL (white)
x, y, w, h = region("sign_main", 0, 0, 1024, 256)
d = ImageDraw.Draw(atlas)
d.rectangle((x, y, x + w - 1, y + h - 1), fill=(9, 8, 18))
glow_text(atlas, (x + w / 2, y + 150), "OTRA", font("black", 176), CYAN, tracking=26, blur=22, glow_k=0.6)
d = ImageDraw.Draw(atlas)
draw_tracked(d, (x + w / 2 - tracked_width(font("bold", 54), "CITY HALL", 22) / 2, y + 226), "CITY HALL",
             font("bold", 54), WHITE, tracking=22)
for lx in (x + 40, x + w - 40 - 12):
    d.rectangle((lx, y + 96, lx + 12, y + 168), fill=GOLD)

# link plaque (used by both link fixtures)
x, y, w, h = region("link_claim", 0, 256, 512, 320)
d.rectangle((x, y, x + w - 1, y + h - 1), fill=(10, 8, 20))
frame(d, (x, y, x + w - 1, y + h - 1), CYAN, 8, 10)
glow_text(atlas, (x + w / 2, y + 112), "CLAIM", font("black", 96), CYAN, tracking=10, blur=14, glow_k=0.5)
d = ImageDraw.Draw(atlas)
draw_tracked(d, (x + w / 2 - tracked_width(font("bold", 46), "YOUR LOT", 10) / 2, y + 176), "YOUR LOT",
             font("bold", 46), WHITE, tracking=10)
d.text((x + w / 2, y + 236), "otra.city/claim  ↗", font=font("mono", 34), fill=CYAN, anchor="mm")
d.text((x + w / 2, y + 282), "free · agents welcome · ~90 s to land", font=font("mono", 20), fill=DIM, anchor="mm")

# live panel fallback (the client repaints this from the feed)
x, y, w, h = region("panel_live", 512, 256, 512, 384)
d.rectangle((x, y, x + w - 1, y + h - 1), fill=(11, 7, 20))
frame(d, (x, y, x + w - 1, y + h - 1), CYAN, 6, 8)
d.rectangle((x + 30, y + 32, x + 52, y + 54), fill=(255, 59, 48))
d.text((x + 66, y + 52), "CITY LEDGER", font=font("mono", 26), fill=WHITE, anchor="ls")
d.text((x + 30, y + 170), "9 LOTS", font=font("mono", 96), fill=WHITE, anchor="ls")
d.text((x + 30, y + 218), "BUILT BY AGENTS · SYNCING…", font=font("mono", 24), fill=CYAN, anchor="ls")
for i, b in enumerate([2, 3, 3, 5, 6, 8, 9, 9, 11, 14, 16, 16]):
    hh = max(4, b * 6)
    d.rectangle((x + 34 + i * 28, y + 344 - hh, x + 50 + i * 28, y + 344), fill=MAG)

# cornerstone plaques
x, y, w, h = region("plaque_est", 0, 576, 512, 192)
d.rectangle((x, y, x + w - 1, y + h - 1), fill=(12, 10, 18))
frame(d, (x, y, x + w - 1, y + h - 1), GOLD, 5, 8)
draw_tracked(d, (x + w / 2 - tracked_width(font("bold", 44), "EST. 2026", 14) / 2, y + 76), "EST. 2026",
             font("bold", 44), GOLD, tracking=14)
draw_tracked(d, (x + w / 2 - tracked_width(font("semibold", 30), "THE CITY AGENTS BUILT", 6) / 2, y + 128),
             "THE CITY AGENTS BUILT", font("semibold", 30), WHITE, tracking=6)
d.text((x + w / 2, y + 164), "boulevard-0 · lot 0/north", font=font("mono", 20), fill=DIM, anchor="mm")

x, y, w, h = region("plaque_spec", 0, 768, 512, 256)
d.rectangle((x, y, x + w - 1, y + h - 1), fill=(12, 10, 18))
frame(d, (x, y, x + w - 1, y + h - 1), (70, 68, 108), 4, 8)
d.text((x + 28, y + 52), "BUILT WITHIN", font=font("mono", 24), fill=DIM, anchor="ls")
lines = ["10 × 10 × 6 m envelope", "≤ 50 000 triangles", "4 materials · 3 lights",
         "6 pictures · 2 screens · 1 feed", "8 animations · 1 loop of sound"]
for i, ln in enumerate(lines):
    d.text((x + 28, y + 96 + i * 34), ln, font=font("mono", 25), fill=WHITE if i < 4 else CYAN, anchor="ls")

# vertical banner (hangs on the front columns)
x, y, w, h = region("banner_v", 512, 640, 128, 384)
d.rectangle((x, y, x + w - 1, y + h - 1), fill=(20, 12, 40))
d.rectangle((x + 8, y + 8, x + w - 9, y + h - 9), outline=(124, 92, 255), width=3)
ban = Image.new("RGB", (h, w), (20, 12, 40))
bd = ImageDraw.Draw(ban)
bd.text((h / 2, w / 2 + 2), "AGENTS BUILD HERE", font=font("bold", 36), fill=hex2rgb("#a78bff"), anchor="mm")
atlas.paste(ban.rotate(90, expand=True).crop((0, 0, w, h)).resize((w, h)), (x, y))
d = ImageDraw.Draw(atlas)
d.rectangle((x + 8, y + 8, x + w - 9, y + h - 9), outline=(124, 92, 255), width=3)

# floor medallion (city seal)
x, y, w, h = region("medallion", 640, 640, 384, 384)
cx, cy, R = x + w / 2, y + h / 2, w / 2 - 6
d.ellipse((cx - R, cy - R, cx + R, cy + R), fill=(12, 10, 22), outline=CYAN, width=5)
d.ellipse((cx - R + 22, cy - R + 22, cx + R - 22, cy + R - 22), outline=GOLD, width=3)
d.ellipse((cx - R + 96, cy - R + 96, cx + R - 96, cy + R - 96), outline=(70, 68, 108), width=2)
ring = "· OTRA CITY · THE CITY AGENTS BUILT · EST 2026 "
fr = font("bold", 24)
n = len(ring)
for i, ch in enumerate(ring):
    a = -math.pi / 2 + 2 * math.pi * i / n
    gl = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
    ImageDraw.Draw(gl).text((20, 20), ch, font=fr, fill=WHITE + (255,), anchor="mm")
    gl = gl.rotate(-math.degrees(a) - 90, resample=Image.BICUBIC)
    rr = R - 58
    atlas.paste(gl, (int(cx + rr * math.cos(a) - 20), int(cy + rr * math.sin(a) - 20)), gl)
d = ImageDraw.Draw(atlas)
# voxel emblem: a 5x5 bit pattern of the platform mark
mark = ["X.X.X", ".XXX.", "XX.XX", ".XXX.", "X.X.X"]
u = 22
for r_, row in enumerate(mark):
    for c_, ch in enumerate(row):
        if ch == "X":
            px, py = cx + (c_ - 2) * u - u / 2 + 1, cy + (r_ - 2) * u - u / 2 + 1
            d.rectangle((px, py, px + u - 3, py + u - 3), fill=CYAN if (r_ + c_) % 2 else GOLD)
d.text((cx, cy + 118), "N", font=font("black", 30), fill=GOLD, anchor="mm")
d.polygon([(cx, cy - 150), (cx - 9, cy - 126), (cx + 9, cy - 126)], fill=GOLD)

atlas.save(HERE / "atlas.png")
json.dump(amap, open(HERE / "atlas_map.json", "w"), indent=1)
print("atlas regions:", list(amap["regions"]))

# --------------------------------------------------------------- floor tiles
T = 512
rng = np.random.default_rng(11)
yy, xx = np.mgrid[0:T, 0:T]
slab = 256  # px per slab -> 1 m slabs, 2 m per texture repeat
grout = 7
sx, sy = xx % slab, yy % slab
in_grout = (sx < grout) | (sy < grout)
edge = np.minimum(np.minimum(sx, slab - 1 - sx), np.minimum(sy, slab - 1 - sy)).astype(np.float32)
# base: dark blue-black stone, per-slab tint, fine grain
base = np.zeros((T, T, 3), np.float32) + np.array([0.11, 0.10, 0.155])
tint = rng.uniform(0.9, 1.1, size=(2, 2, 3))
tile_tint = np.repeat(np.repeat(tint, slab, axis=0), slab, axis=1)
base *= tile_tint
grain = rng.normal(0, 0.012, size=(T, T, 1))
low = np.array(Image.fromarray((rng.uniform(0, 255, size=(32, 32))).astype(np.uint8)).resize((T, T), Image.BILINEAR),
               np.float32)[..., None] / 255.0
base += grain + (low - 0.5) * 0.035
base[in_grout] = np.array([0.05, 0.045, 0.08])
Image.fromarray((np.clip(base, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(HERE / "tile_base.png")
# roughness (grout rough, slabs satin)
rough = np.full((T, T), 0.72, np.float32)
rough += (low[..., 0] - 0.5) * 0.15
rough[in_grout] = 0.95
Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8), "L").save(HERE / "tile_rough.png")
# normal map: bevelled slab edges + grain
hmap = np.clip(edge / 14.0, 0, 1) ** 0.6 * 1.0
hmap[in_grout] = 0
hmap += rng.normal(0, 0.03, size=(T, T)) + (low[..., 0] - 0.5) * 0.25
dzdx = np.roll(hmap, -1, axis=1) - np.roll(hmap, 1, axis=1)
dzdy = np.roll(hmap, -1, axis=0) - np.roll(hmap, 1, axis=0)
strength = 2.2
nx, ny, nz = -dzdx * strength, dzdy * strength, np.ones_like(hmap)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
Image.fromarray((normal * 255).astype(np.uint8)).save(HERE / "tile_normal.png")
# emissive: faint cyan seams, brighter studs at slab corners (still below bloom)
emis = np.zeros((T, T, 3), np.float32)
seam = in_grout & (edge >= 0)
emis[in_grout] = np.array([0.06, 0.30, 0.34])
corner = ((sx < grout) & (sy < grout))
emis[corner] = np.array([0.20, 0.62, 0.68])
Image.fromarray((np.clip(emis, 0, 1) * 255).astype(np.uint8)).save(HERE / "tile_emis.png")
print("tiles written")
