#!/usr/bin/env python3
"""Textures for the otra.city Stadium venue (poc/stadium/).

Writes, next to this script:
  palette.png / palette_emis.png  256 px, 16x16 swatches (base RGBA + emissive RGB)
  palette_map.json                swatch name -> cell / colours
  atlas.png / atlas_map.json      1024 px art atlas (signage, screen plates, block letters)
  tile_base.png / tile_normal.png / tile_rough.png / tile_emis.png   512 px concrete slabs

Same technique as poc/city-hall/textures.py (one palette material carries
every voxel colour, one atlas carries every word); run with the system
python (PIL + numpy), NOT inside Blender.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
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
        return ImageFont.truetype(path, size, index=1)
    return ImageFont.truetype(path, size)


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def scale(rgb, k):
    return tuple(max(0, min(255, round(c * k))) for c in rgb)


# ----------------------------------------------------------------- palette
HOT = {
    "cyan": "#47f2ff", "magenta": "#ff2d95", "gold": "#ffd479", "white": "#ffffff",
    "violet": "#7c5cff", "red": "#ff3b30", "green": "#7dffa8", "warm": "#ffbf80",
    "blue": "#3d7bff", "flood": "#f4f7ff",
}
PAL = {}
for name, hx in {
    # ground + structure
    "deck": "#17161c", "apron": "#1e2a22", "apron_lt": "#24352a", "pitch": "#3f9451", "pitch_lt": "#358447",
    "concourse": "#24222c", "terrace": "#2a2742", "terrace_lt": "#343056", "riser": "#1f1c31", "riser_dk": "#171428",
    "seat_a": "#2d7fd6", "seat_b": "#d63a6e", "seat_c": "#e0b43a", "seat_d": "#3fb37a", "seat_dk": "#1b1a2a",
    "pier": "#2c2a48", "pier_dk": "#1d1b30", "wall": "#232037", "wall_lt": "#2b2848", "fascia": "#17152a",
    "fascia_lt": "#221f38", "roof": "#1d1a30", "steel": "#646a80", "steel_dk": "#3c4152", "rail": "#8b90a8",
    "mast": "#3c4152", "mast_dk": "#262a38", "board": "#0d0a14", "board_lt": "#14101f", "white": "#e9edf6",
    "gold": "#c9a341", "gold_dk": "#6b5420", "ink": "#080611", "step": "#1f1c31", "turnstile": "#3a3860",
}.items():
    PAL[name] = (hx, 255, None)
for hue, hx in HOT.items():
    rgb = hex2rgb(hx)
    base = "#%02x%02x%02x" % scale(rgb, 0.14)
    PAL["e_" + hue] = (base, 255, hx)
    PAL["e_%s_soft" % hue] = (base, 255, "#%02x%02x%02x" % scale(rgb, 0.70))
    PAL["e_%s_dim" % hue] = (base, 255, "#%02x%02x%02x" % scale(rgb, 0.42))
# translucent (blended material only)
PAL["glass"] = ("#a6e6ff", 42, "#123a44")
PAL["glass_gate"] = ("#47f2ff", 76, "#1a5c66")
PAL["beam"] = ("#f4f7ff", 26, "#8fa0c8")       # floodlight cones
PAL["holo_cyan"] = ("#47f2ff", 140, "#32a9b3")
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
CYAN, WHITE, GOLD, MAG, DIM = hex2rgb("#47f2ff"), (233, 237, 246), hex2rgb("#ffd479"), hex2rgb("#ff2d95"), (138, 134, 160)
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


def plate(name, x, y, w, h, fill=(9, 8, 18), edge=CYAN, ew=6):
    region(name, x, y, w, h)
    d = ImageDraw.Draw(atlas)
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=fill)
    if edge:
        frame(d, (x, y, x + w - 1, y + h - 1), edge, ew, 8)
    return d


# main sign over the west gate: OTRA CITY (cyan, blooms) / STADIUM (white)
x, y, w, h = region("sign_main", 0, 0, 1024, 192)
d = ImageDraw.Draw(atlas)
d.rectangle((x, y, x + w - 1, y + h - 1), fill=(9, 8, 18))
glow_text(atlas, (x + w / 2, y + 96), "OTRA CITY", font("black", 96), CYAN, tracking=18, blur=18, glow_k=0.6)
d = ImageDraw.Draw(atlas)
draw_tracked(d, (x + w / 2 - tracked_width(font("black", 74), "STADIUM", 30) / 2, y + 176), "STADIUM",
             font("black", 74), WHITE, tracking=30)

# 16:9 screen plate: what the big screen shows before a broadcast is docked
d = plate("screen_main", 0, 192, 512, 288)
d.rectangle((512 - 512 + 30, 192 + 30, 30 + 22, 192 + 52), fill=(255, 59, 48))
d.text((66, 192 + 52), "STADIUM TV", font=font("mono", 26), fill=WHITE, anchor="ls")
glow_text(atlas, (256, 192 + 168), "NO SIGNAL", font("black", 72), DIM, tracking=8, blur=10, glow_k=0.3)
d = ImageDraw.Draw(atlas)
d.text((256, 192 + 224), "matchday 12:00 · 16:00 · 20:00 London", font=font("mono", 22), fill=CYAN, anchor="mm")
d.text((256, 192 + 258), "broadcast docks here when the RFL is live", font=font("mono", 18), fill=DIM, anchor="mm")

# scoreboard plate (the client repaints this from hud truth)
d = plate("screen_score", 512, 192, 512, 288, edge=GOLD)
d.text((512 + 30, 192 + 52), "OTRA CITY STADIUM", font=font("mono", 26), fill=WHITE, anchor="ls")
d.text((512 + 256, 192 + 150), "— : —", font=font("mono", 96), fill=WHITE, anchor="mm")
d.text((512 + 256, 192 + 214), "NEXT KICK-OFF · loading programme", font=font("mono", 22), fill=GOLD, anchor="mm")
d.text((512 + 256, 192 + 256), "RFL · ROBOT FOOTBALL LEAGUE", font=font("mono", 18), fill=DIM, anchor="mm")

# tall dock panels (stats / line-up), aspect 0.68 -> 348 x 512
for i, (name, title, sub) in enumerate((("panel_left", "GAME STATS", "possession · shots · passes"),
                                         ("panel_right", "LINE-UP", "two-a-side · four robots"))):
    px = 0 + i * 348
    d = plate(name, px, 480, 348, 512, edge=(70, 68, 108), ew=4)
    d.text((px + 174, 480 + 80), title, font=font("bold", 40), fill=WHITE, anchor="mm")
    d.text((px + 174, 480 + 130), sub, font=font("mono", 18), fill=DIM, anchor="mm")
    for k in range(6):
        d.rectangle((px + 40, 480 + 200 + k * 44, px + 40 + 40 + k * 38, 480 + 226 + k * 44), fill=(28, 24, 48))
    d.text((px + 174, 480 + 480), "docks when a match is live", font=font("mono", 16), fill=CYAN, anchor="mm")

# stand block letters: N E S W on a coloured plate
for i, (letter, hx) in enumerate((("N", "#2d7fd6"), ("E", "#d63a6e"), ("S", "#e0b43a"), ("W", "#3fb37a"))):
    bx, by = 696, 480 + i * 128
    d = plate("block_" + letter, bx, by, 128, 128, fill=scale(hex2rgb(hx), 0.35), edge=hex2rgb(hx), ew=5)
    d.text((bx + 64, by + 66), letter, font=font("black", 92), fill=WHITE, anchor="mm")

# pitch-side boards (repeat around the bowl), a strip each 1024 x 64
boards = [("board_1", "THE CITY AGENTS BUILT", CYAN), ("board_2", "otra.city/claim  ·  your project could stand here", WHITE),
          ("board_3", "4DGSX  ·  volumetric sport, free camera", GOLD), ("board_4", "RFL  ·  robot football league  ·  rfl.football", MAG)]
for i, (name, text, colr) in enumerate(boards):
    bx, by = 824, 480 + i * 64
    region(name, bx, by, 200, 64)   # placeholder region, overwritten below by the wide strips
for i, (name, text, colr) in enumerate(boards):
    bx, by = 0, 992 - 64 * 3 + i * 0  # (strips live on their own rows below)
strip_y0 = 1024 - 4 * 8 - 4 * 56
for i, (name, text, colr) in enumerate(boards):
    bx, by, bw, bh = 348 * 0, 992, 0, 0
# real strip layout: four 1024 x 56 strips at the bottom of the panel columns' free width is too narrow,
# so put them in the 348..696 column instead (348 px wide, 4 rows of 64)
for i, (name, text, colr) in enumerate(boards):
    bx, by, bw, bh = 348, 480 + i * 64, 348, 64
    region(name, bx, by, bw, bh)
    d = ImageDraw.Draw(atlas)
    d.rectangle((bx, by, bx + bw - 1, by + bh - 1), fill=(10, 8, 20))
    frame(d, (bx, by, bx + bw - 1, by + bh - 1), scale(colr, 0.5), 3, 4)
    f = font("bold", 22)
    while f.getlength(text) > bw - 24:
        f = font("bold", f.size - 1)
    d.text((bx + bw / 2, by + bh / 2 + 1), text, font=f, fill=colr, anchor="mm")

# gate sign and a safety line
d = plate("sign_gate", 348, 736, 348, 128, edge=CYAN, ew=4)
d.text((348 + 174, 736 + 44), "WEST GATE", font=font("black", 40), fill=CYAN, anchor="mm")
d.text((348 + 174, 736 + 86), "no ticket needed · walk in", font=font("mono", 20), fill=WHITE, anchor="mm")
d = plate("sign_steps", 348, 864, 348, 128, edge=GOLD, ew=4)
d.text((348 + 174, 864 + 44), "STANDS  ↑", font=font("black", 40), fill=GOLD, anchor="mm")
d.text((348 + 174, 864 + 86), "mind the step · 0.25 m risers", font=font("mono", 20), fill=WHITE, anchor="mm")

# RFL crest for the mast bases
bx, by = 824, 736
d = plate("crest", bx, by, 200, 200, fill=(12, 10, 22), edge=GOLD, ew=4)
d.ellipse((bx + 26, by + 26, bx + 174, by + 174), outline=CYAN, width=4)
d.text((bx + 100, by + 86), "RFL", font=font("black", 56), fill=WHITE, anchor="mm")
d.text((bx + 100, by + 134), "EST. 2026", font=font("mono", 18), fill=GOLD, anchor="mm")

# Media plates: the client REPLACES a dock/scoreboard node's material and maps
# the picture through the node's FULL 0..1 UVs, so each plate ships as its own
# image (the authored fallback is the whole texture, not an atlas cell).
for name in ("screen_main", "screen_score", "panel_left", "panel_right"):
    rx, ry, rw, rh = amap["regions"][name]
    atlas.crop((rx, ry, rx + rw, ry + rh)).save(HERE / ("plate_%s.png" % name))
print("plates written")
atlas.save(HERE / "atlas.png")
json.dump(amap, open(HERE / "atlas_map.json", "w"), indent=1)
print("atlas regions:", list(amap["regions"]))

# ------------------------------------------------------------ concrete tiles
T = 512
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:T, 0:T]
slab = 256   # 1 m slabs, 2 m per repeat
grout = 6
sx, sy = xx % slab, yy % slab
in_grout = (sx < grout) | (sy < grout)
edge = np.minimum(np.minimum(sx, slab - 1 - sx), np.minimum(sy, slab - 1 - sy)).astype(np.float32)
base = np.zeros((T, T, 3), np.float32) + np.array([0.135, 0.13, 0.165])
tint = rng.uniform(0.92, 1.08, size=(2, 2, 3))
base *= np.repeat(np.repeat(tint, slab, axis=0), slab, axis=1)
grain = rng.normal(0, 0.014, size=(T, T, 1))
low = np.array(Image.fromarray((rng.uniform(0, 255, size=(32, 32))).astype(np.uint8)).resize((T, T), Image.BILINEAR),
               np.float32)[..., None] / 255.0
base += grain + (low - 0.5) * 0.04
base[in_grout] = np.array([0.06, 0.055, 0.085])
Image.fromarray((np.clip(base, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(HERE / "tile_base.png")
rough = np.full((T, T), 0.86, np.float32) + (low[..., 0] - 0.5) * 0.1
rough[in_grout] = 0.97
Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8), "L").save(HERE / "tile_rough.png")
hmap = np.clip(edge / 12.0, 0, 1) ** 0.6
hmap[in_grout] = 0
hmap += rng.normal(0, 0.03, size=(T, T)) + (low[..., 0] - 0.5) * 0.2
dzdx = np.roll(hmap, -1, axis=1) - np.roll(hmap, 1, axis=1)
dzdy = np.roll(hmap, -1, axis=0) - np.roll(hmap, 1, axis=0)
nx, ny, nz = -dzdx * 2.0, dzdy * 2.0, np.ones_like(hmap)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
Image.fromarray(((np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5) * 255).astype(np.uint8)).save(HERE / "tile_normal.png")
emis = np.zeros((T, T, 3), np.float32)
emis[in_grout] = np.array([0.05, 0.22, 0.26])
Image.fromarray((np.clip(emis, 0, 1) * 255).astype(np.uint8)).save(HERE / "tile_emis.png")
print("tiles written")
