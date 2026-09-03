#!/usr/bin/env python3
"""
assembly_video.py -- generate assembly.mp4 for the OTRA CITY HALL "screen_2"
media slot: a silent, seamlessly-looping 20s pixel-art / voxel isometric
animation of the boulevard-0 lots assembling out of falling/stacking cubes,
then dissolving back into drifting cubes so the loop restarts cleanly.

Pipeline: render 480 PNG frames with PIL/numpy -> encode with ffmpeg (H.264).

Usage:
    python3 assembly_video.py            # full render: frames + encode + verify
    python3 assembly_video.py --check    # print layout bounds only, no images
    python3 assembly_video.py --frames 0,240,479   # render just these frame indices (debug)
"""
import json
import math
import os
import random
import shutil
import subprocess
import sys
import zlib

from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------
# paths
# --------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
INDEX_JSON = os.path.join(REPO, "public", "plots", "index.json")
OUT_MP4 = os.path.join(REPO, "public", "plots", "city-hall", "media", "assembly.mp4")
FRAMES_DIR = "/private/tmp/claude-501/-Users-robin-Code-personal-otra-city-3d--claude-worktrees-otra-city-platform-lot-4b6518/603db066-99ee-4d48-b7a2-357a84616b28/scratchpad/assembly_frames"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
FONT_PATH = "/System/Library/Fonts/Menlo.ttc"

# --------------------------------------------------------------------------
# constants
# --------------------------------------------------------------------------
W, H = 1280, 720
FPS = 24
T_TOTAL = 20.0
N_FRAMES = int(round(FPS * T_TOTAL))  # 480

PALETTE = {
    "bg": "#0b0914",
    "cyan": "#47f2ff",
    "magenta": "#ff2d95",
    "gold": "#ffd23e",
    "violet": "#7c5cff",
    "green": "#7dffa8",
    "white": "#e9edf6",
    "dim": "#8a86a0",
}


def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


BG_RGB = hx(PALETTE["bg"])
CYAN_RGB = hx(PALETTE["cyan"])
GOLD_RGB = hx(PALETTE["gold"])
WHITE_RGB = hx(PALETTE["white"])
RED_RGB = (255, 59, 48)
ROAD_RGB = (17, 15, 26)
ROAD_EDGE_RGB = (28, 25, 43)

# ---- projection -----------------------------------------------------------
# Global placement (which lot goes where along / across the boulevard) is a
# simple, un-sheared mapping so the road reads as a straight strip running
# left-to-right across the frame:
#   screen_x = ORIGIN_X + world_x_m * PXM
#   screen_y = ORIGIN_Y - side * V_OFFSET_PX
# Within a lot, the 10x10m footprint and the voxel cubes stacked on it use a
# proper 2:1 dimetric isometric transform (local_u,local_v in metres,
# gz = stack level):
#   dx = (u - v) * IPXM
#   dy = (u + v) * IPXM * 0.5 - gz * CUBE_H
ORIGIN_X = W // 2
ORIGIN_Y = 380

# lots span x=-30..30m per spec; PXM below is reduced from the spec's
# nominal ~28 px/m so that full span (with footprint bulge) fits inside the
# 1280px frame -- see bounds_check().
PXM = 20.0  # px/m along the boulevard
IPXM = 10.5  # px/m for the local 10x10m footprint outline (2:1 dimetric)
V_OFFSET_M = 11.5  # lot centres are 11.5m from the road centreline
V_OFFSET_PX = V_OFFSET_M * IPXM * 0.5

# voxel cube size (independent of IPXM -- these are stylised/abstract, not
# literally 1 cube per metre)
CSTEP = 21.0  # px between adjacent footprint columns
CUBE_HW = CSTEP / 2.0  # top-face diamond half-width
CUBE_HH = CUBE_HW / 2.0  # top-face diamond half-height (2:1 ratio)
CUBE_H = 19.0  # vertical extrusion per level

# ---- timing -----------------------------------------------------------
STAGGER = 1.5  # seconds between successive lots' assembly start (west->east)
DROP_GAP = 0.15  # seconds between successive cube drop-starts within a lot
DROP_DUR = 0.25  # seconds for one cube's fall + landing
FLASH_DUR = 0.14  # seconds the landing flash lasts
DROP_HEIGHT = 130.0  # px a cube falls from before landing
DISSOLVE_START = 17.0
DISSOLVE_END = T_TOTAL  # last 3s
DISS_CUBE_SPREAD = 1.0  # cubes' dissolve start times spread over this window
DISS_CUBE_DUR = 1.6  # seconds for one cube to drift+fade away

RNG = random.Random(20260901)


# --------------------------------------------------------------------------
# lot data
# --------------------------------------------------------------------------
def load_lots():
    data = json.load(open(INDEX_JSON))
    lots = data["lots"]
    segment = data.get("segment", "boulevard-0")

    # this strip is the BOULEVARD; lots on the district's other roads are left out
    lots = [l for l in lots if l.get("road", "boulevard") == "boulevard"]

    def sort_key(l):
        return (l["x"], 0 if l["z"] > 0 else 1, l["slug"])

    lots_sorted = sorted(lots, key=sort_key)
    return segment, lots_sorted


# --------------------------------------------------------------------------
# projection helpers
# --------------------------------------------------------------------------
def lot_origin(lot):
    sx = ORIGIN_X + lot["x"] * PXM
    sy = ORIGIN_Y - (1 if lot["z"] > 0 else -1) * V_OFFSET_PX
    return sx, sy


def footprint_diamond(lot):
    """4 corners of the 10x10m footprint outline, in screen space."""
    ox, oy = lot_origin(lot)
    pts = []
    for u, v in ((-5, -5), (5, -5), (5, 5), (-5, 5)):
        dx = (u - v) * IPXM
        dy = (u + v) * IPXM * 0.5
        pts.append((ox + dx, oy + dy))
    return pts


def column_base(lot, gx, gy):
    ox, oy = lot_origin(lot)
    dx = (gx - gy) * CSTEP
    dy = (gx + gy) * CSTEP * 0.5
    return ox + dx, oy + dy


def cube_top_center(lot, gx, gy, gz):
    bx, by = column_base(lot, gx, gy)
    return bx, by - (gz + 1) * CUBE_H


# --------------------------------------------------------------------------
# per-lot build plans
# --------------------------------------------------------------------------
SHOP_COL_SETS = [
    [(-1, -0.5), (0, -0.5), (1, -0.5), (-1, 0.5), (0, 0.5), (1, 0.5)],
    [
        (-1.5, -0.5),
        (-0.5, -0.5),
        (0.5, -0.5),
        (1.5, -0.5),
        (-1.5, 0.5),
        (-0.5, 0.5),
        (0.5, 0.5),
        (1.5, 0.5),
    ],
]
TOWER_COL_POOL = [(0, 0), (0.55, 0), (-0.55, 0), (0, 0.55), (0, -0.55), (0.4, 0.4), (-0.4, -0.4)]
SPREAD_GRID = [(gx, gy) for gx in (-1.5, -0.5, 0.5, 1.5) for gy in (-1.5, -0.5, 0.5, 1.5)]


def make_columns(style, n_cubes, rng):
    if style == "shop":
        cols = list(rng.choice(SHOP_COL_SETS))
        rng.shuffle(cols)
        max_h = 2
    elif style == "tower":
        k = rng.choice([1, 1, 2, 3])
        cols = rng.sample(TOWER_COL_POOL, k=k)
        max_h = 8
    else:  # spread
        pool = list(SPREAD_GRID)
        rng.shuffle(pool)
        k = min(len(pool), rng.randint(5, 9))
        cols = pool[:k]
        max_h = 2

    heights = [0] * len(cols)
    placed = 0
    i = 0
    guard = 0
    while placed < n_cubes and guard < 2000:
        idx = i % len(cols)
        if heights[idx] < max_h:
            heights[idx] += 1
            placed += 1
        i += 1
        guard += 1

    cubes = []
    for (gx, gy), h in zip(cols, heights):
        for gz in range(h):
            cubes.append((gx, gy, gz))
    # drop order: build up in layers (all gz=0 first, then gz=1, ...) so the
    # whole footprint rises together rather than one column finishing alone
    cubes.sort(key=lambda c: (c[2], c[0], c[1]))
    return cubes


def make_dome_columns():
    """Stacked shrinking discs of cubes: solid filled diamonds (L1 discs) at
    successive levels, so it reads as a stepped dome rather than a sparse
    ring of pillars. The topmost single cube doubles as the beacon housing."""
    cubes = []
    levels = [
        (0, 2),  # gz=0: wide base disc, |gx|+|gy|<=2
        (1, 1),  # gz=1: medium disc, |gx|+|gy|<=1
        (2, 0),  # gz=2: single cap cube = beacon housing
    ]
    for gz, r in levels:
        for gx in range(-r, r + 1):
            for gy in range(-r, r + 1):
                if abs(gx) + abs(gy) <= r:
                    cubes.append((float(gx), float(gy), gz))
    return cubes


def is_city_hall(lot):
    return lot.get("slug") == "city-hall"


def build_plan(lot, index):
    rng = random.Random(zlib.crc32(lot["slug"].encode()))
    if is_city_hall(lot):
        columns = make_dome_columns()
        style = "dome"
    else:
        n_cubes = rng.randint(6, 14)
        ltype = lot.get("type", "freeform")
        if ltype == "shop":
            style = "shop"
        else:
            style = rng.choice(["tower", "spread"])
        columns = make_columns(style, n_cubes, rng)

    base_rgb = hx(lot["color"])
    top_c = shade(base_rgb, 1.28)
    left_c = shade(base_rgb, 0.9)
    right_c = shade(base_rgb, 0.62)

    cubes = []
    start_t = index * STAGGER
    for k, (gx, gy, gz) in enumerate(columns):
        cx, cy = cube_top_center(lot, gx, gy, gz)
        fall_t = start_t + k * DROP_GAP
        land_t = fall_t + DROP_DUR
        diss_start = DISSOLVE_START + rng.uniform(0, DISS_CUBE_SPREAD)
        diss_end = diss_start + DISS_CUBE_DUR
        drift_ang = rng.uniform(0, 2 * math.pi)
        drift_mag = rng.uniform(14, 34)
        cubes.append(
            dict(
                gx=gx,
                gy=gy,
                gz=gz,
                cx=cx,
                cy=cy,
                fall_t=fall_t,
                land_t=land_t,
                diss_start=diss_start,
                diss_end=diss_end,
                drift_dx=math.cos(drift_ang) * drift_mag,
                drift_dy=math.sin(drift_ang) * drift_mag - 10,
                colors={"top": top_c, "left": left_c, "right": right_c},
                phase=rng.uniform(0, 6.28),
            )
        )
    finish_t = max((c["land_t"] for c in cubes), default=start_t)
    return dict(
        lot=lot,
        style=style,
        base_rgb=base_rgb,
        cubes=cubes,
        start_t=start_t,
        finish_t=finish_t,
        footprint=footprint_diamond(lot),
    )


def shade(rgb, factor):
    return tuple(max(0, min(255, int(round(c * factor)))) for c in rgb)


# --------------------------------------------------------------------------
# bounds check (fast, no rendering) -- verifies the layout fits the frame
# --------------------------------------------------------------------------
def bounds_check(plans):
    xs, ys = [], []
    for p in plans:
        for pt in p["footprint"]:
            xs.append(pt[0])
            ys.append(pt[1])
        for c in p["cubes"]:
            xs += [c["cx"] - CUBE_HW, c["cx"] + CUBE_HW]
            ys += [c["cy"] - CUBE_HH - 6, c["cy"] + CUBE_HH + CUBE_H + 6]
    print(f"x range: {min(xs):.1f} .. {max(xs):.1f}  (frame 0..{W})")
    print(f"y range: {min(ys):.1f} .. {max(ys):.1f}  (frame 0..{H})")
    ok = min(xs) > 0 and max(xs) < W and min(ys) > 40 and max(ys) < H - 30
    print("FITS" if ok else "!! DOES NOT FIT, adjust constants !!")
    for p in plans:
        n = len(p["cubes"])
        print(f"  {p['lot']['slug']:14s} x={p['lot']['x']:>4} z={p['lot']['z']:>6} "
              f"style={p['style']:7s} n_cubes={n:2d} start={p['start_t']:.2f} finish={p['finish_t']:.2f}")
    return ok


# --------------------------------------------------------------------------
# static background (rendered once, reused every frame)
# --------------------------------------------------------------------------
def make_static_bg(plans):
    import numpy as np

    # vignette + faint gradient via numpy (vectorised, done once)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx0, cy0 = W * 0.5, H * 0.42
    dist = np.sqrt(((xx - cx0) / (W * 0.75)) ** 2 + ((yy - cy0) / (H * 0.75)) ** 2)
    vig = np.clip(1.0 - dist * 0.55, 0.55, 1.0)
    base = np.array(BG_RGB, dtype=np.float32).reshape(1, 1, 3)
    # tiny upward warm-to-cool tint so the sky isn't perfectly flat
    tint = np.clip((H * 0.55 - yy) / H, 0, 1)[:, :, None] * np.array([6, 4, 14], dtype=np.float32)
    arr = base * vig[:, :, None] + tint * 0.4
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGB")

    # faint starfield
    star_rng = random.Random(7)
    px = img.load()
    for _ in range(260):
        sx = star_rng.randint(0, W - 1)
        sy = star_rng.randint(0, int(H * 0.65))
        b = star_rng.randint(30, 90)
        px[sx, sy] = tuple(min(255, c + b) for c in px[sx, sy])

    draw = ImageDraw.Draw(img, "RGBA")

    # road strip: spans the full projected x-extent of the lots, at ORIGIN_Y
    all_x = [footprint_diamond(p["lot"])[i][0] for p in plans for i in range(4)]
    rx0, rx1 = min(all_x) - 40, max(all_x) + 40
    road_half = 15
    draw.rectangle([rx0, ORIGIN_Y - road_half, rx1, ORIGIN_Y + road_half], fill=ROAD_RGB)
    draw.line([(rx0, ORIGIN_Y - road_half), (rx1, ORIGIN_Y - road_half)], fill=ROAD_EDGE_RGB, width=1)
    draw.line([(rx0, ORIGIN_Y + road_half), (rx1, ORIGIN_Y + road_half)], fill=ROAD_EDGE_RGB, width=1)
    # dashed centreline
    dash_w, gap_w = 16, 12
    x = rx0
    while x < rx1:
        draw.line([(x, ORIGIN_Y), (min(x + dash_w, rx1), ORIGIN_Y)], fill=(60, 56, 78), width=2)
        x += dash_w + gap_w

    # faint plot-outline diamonds in each lot's own colour (holo marker style)
    for p in plans:
        col = p["base_rgb"] + (46,)
        draw.polygon(p["footprint"], outline=col, width=2)
        fill_col = p["base_rgb"] + (16,)
        draw.polygon(p["footprint"], fill=fill_col)

    return img


# --------------------------------------------------------------------------
# cube drawing
# --------------------------------------------------------------------------
def cube_faces(cx, cy_top, hw, hh, ch):
    top = [(cx, cy_top - hh), (cx + hw, cy_top), (cx, cy_top + hh), (cx - hw, cy_top)]
    left = [(cx - hw, cy_top), (cx, cy_top + hh), (cx, cy_top + hh + ch), (cx - hw, cy_top + ch)]
    right = [(cx, cy_top + hh), (cx + hw, cy_top), (cx + hw, cy_top + ch), (cx, cy_top + hh + ch)]
    return top, left, right


def draw_cube_opaque(draw, cx, cy_top, colors, hw=CUBE_HW, hh=CUBE_HH, ch=CUBE_H):
    top, left, right = cube_faces(cx, cy_top, hw, hh, ch)
    draw.polygon(right, fill=colors["right"])
    draw.polygon(left, fill=colors["left"])
    draw.polygon(top, fill=colors["top"])


def draw_cube_alpha(img, cx, cy_top, colors, alpha, hw=CUBE_HW, hh=CUBE_HH, ch=CUBE_H, pad=4):
    alpha = max(0.0, min(1.0, alpha))
    if alpha <= 0.003:
        return
    x0, y0 = int(cx - hw - pad), int(cy_top - hh - pad)
    x1, y1 = int(cx + hw + pad), int(cy_top + hh + ch + pad)
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return
    tile = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    lcx, lcy = cx - x0, cy_top - y0
    top, left, right = cube_faces(lcx, lcy, hw, hh, ch)
    td.polygon(right, fill=colors["right"] + (255,))
    td.polygon(left, fill=colors["left"] + (255,))
    td.polygon(top, fill=colors["top"] + (255,))
    if alpha < 0.999:
        a = tile.split()[3].point(lambda v: int(v * alpha))
        tile.putalpha(a)
    img.paste(tile, (x0, y0), tile)


def draw_flash(img, cx, cy_top, color, alpha, radius):
    alpha = max(0.0, min(1.0, alpha))
    if alpha <= 0.003:
        return
    pad = int(radius) + 2
    x0, y0 = int(cx - radius - pad), int(cy_top - radius - pad)
    x1, y1 = int(cx + radius + pad), int(cy_top + radius + pad)
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return
    tile = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    lcx, lcy = cx - x0, cy_top - y0
    td.ellipse([lcx - radius, lcy - radius, lcx + radius, lcy + radius], fill=color + (int(255 * alpha),))
    img.paste(tile, (x0, y0), tile)


# --------------------------------------------------------------------------
# per-cube animation state
# --------------------------------------------------------------------------
def ease_in(p):
    return p * p


def cube_state(cube, t):
    """Return None if invisible, else (screen_cx, screen_cy_top, alpha, drawn_as_flash_extra)."""
    if t < cube["fall_t"]:
        return None
    if t < cube["land_t"]:
        p = (t - cube["fall_t"]) / DROP_DUR
        fallen = ease_in(p)
        y_off = -(1.0 - fallen) * DROP_HEIGHT
        alpha = min(1.0, p * 4.0)
        return (cube["cx"], cube["cy"] + y_off, alpha, None)
    # landed
    flash = None
    ft = t - cube["land_t"]
    if 0 <= ft < FLASH_DUR:
        flash = 1.0 - (ft / FLASH_DUR)
    if t < cube["diss_start"]:
        return (cube["cx"], cube["cy"], 1.0, flash)
    if t < cube["diss_end"]:
        q = (t - cube["diss_start"]) / DISS_CUBE_DUR
        dx = cube["drift_dx"] * q
        dy = cube["drift_dy"] * q
        alpha = 1.0 - q
        return (cube["cx"] + dx, cube["cy"] + dy, alpha, None)
    return None


# --------------------------------------------------------------------------
# city hall extras: blinking beacon + gold star
# --------------------------------------------------------------------------
def city_hall_extras(img, plan, t):
    cubes = plan["cubes"]
    beacon = max(cubes, key=lambda c: c["gz"])
    st = cube_state(beacon, t)
    if st is None:
        return
    bx, by, alpha, _flash = st
    if t < beacon["land_t"]:
        return
    apex_x, apex_y = bx, by - CUBE_HH - 3

    # dissolve fades these too
    fade = alpha

    # gold star just above the apex, gentle twinkle
    twinkle = 0.84 + 0.16 * math.sin(t * 3.4 + beacon["phase"])
    star_alpha = fade * twinkle
    draw_star(img, apex_x, apex_y - 15, 9, GOLD_RGB, star_alpha)

    # blinking red beacon pixel, cadence matches plot.json's beacon_tip anim (on 1.2s / off 1s)
    cycle = 2.2
    phase = t % cycle
    on = phase < 1.2
    if on and fade > 0.01:
        r = 3.5
        col = RED_RGB + (int(255 * fade),)
        pad = 3
        x0, y0 = int(apex_x - r - pad), int(apex_y - r - pad)
        tile = Image.new("RGBA", (int(2 * (r + pad)), int(2 * (r + pad))), (0, 0, 0, 0))
        td = ImageDraw.Draw(tile)
        td.ellipse([pad, pad, pad + 2 * r, pad + 2 * r], fill=col)
        img.paste(tile, (x0, y0), tile)


def draw_star(img, cx, cy, r, color, alpha):
    alpha = max(0.0, min(1.0, alpha))
    if alpha <= 0.01:
        return
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rad = r if i % 2 == 0 else r * 0.42
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    pad = 3
    x0, y0 = int(min(xs) - pad), int(min(ys) - pad)
    x1, y1 = int(max(xs) + pad), int(max(ys) + pad)
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return
    tile = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    local = [(px - x0, py - y0) for px, py in pts]
    td.polygon(local, fill=color + (int(255 * alpha),))
    img.paste(tile, (x0, y0), tile)


# --------------------------------------------------------------------------
# text overlays
# --------------------------------------------------------------------------
def make_captions(segment, n_lots):
    return [
        f"{segment.upper()} · ASSEMBLING…",
        f"{n_lots} LOTS · THE CITY AGENTS BUILT",
        "CLAIM YOURS · OTRA.CITY/CLAIM",
    ]


def draw_text_alpha(img, xy, text, font, fill_rgb, alpha, anchor="la", plate=True, plate_pad=8):
    alpha = max(0.0, min(1.0, alpha))
    if alpha <= 0.01:
        return
    dummy = ImageDraw.Draw(img)
    bbox = dummy.textbbox((0, 0), text, font=font, anchor="la")
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = plate_pad
    tile_w, tile_h = int(tw + pad * 2 + 4), int(th + pad * 2 + 4)
    tile = Image.new("RGBA", (tile_w, tile_h), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    if plate:
        td.rounded_rectangle([0, 0, tile_w - 1, tile_h - 1], radius=6, fill=(6, 5, 12, int(150 * alpha)))
    td.text((pad - bbox[0] + 2, pad - bbox[1] + 2), text, font=font, fill=fill_rgb + (int(255 * alpha),))

    x, y = xy
    if "r" in anchor[0:1] or anchor == "ra":
        x = x - tile_w
    if anchor[1:2] == "b" or anchor == "rb":
        y = y - tile_h
    img.paste(tile, (int(x), int(y)), tile)


def draw_caption(img, t, font, captions):
    slot = T_TOTAL / len(captions)
    phase = t % T_TOTAL
    idx = int(phase / slot) % len(captions)
    local_t = phase % slot
    fade_t = 0.5
    fade_in = min(1.0, local_t / fade_t)
    fade_out = min(1.0, (slot - local_t) / fade_t)
    alpha = min(fade_in, fade_out)
    draw_text_alpha(img, (28, H - 30), captions[idx], font, WHITE_RGB, alpha, anchor="lb")


def draw_live_tag(img, t, font):
    label = "CITY HALL / SCREEN 2"
    dummy = ImageDraw.Draw(img)
    bbox = dummy.textbbox((0, 0), label, font=font, anchor="la")
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = 8
    dot_r_base = 3.6
    pulse = 0.7 + 0.3 * math.sin(t * 4.2)
    dot_r = dot_r_base * (0.85 + 0.3 * pulse)
    gap = 10
    tile_w = int(pad * 2 + dot_r * 2 + gap + tw + 4)
    tile_h = int(pad * 2 + th + 4)
    tile = Image.new("RGBA", (tile_w, tile_h), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    td.rounded_rectangle([0, 0, tile_w - 1, tile_h - 1], radius=6, fill=(6, 5, 12, 150))
    dot_cx = pad + dot_r
    dot_cy = tile_h / 2
    glow_a = int(80 * pulse)
    td.ellipse(
        [dot_cx - dot_r - 3, dot_cy - dot_r - 3, dot_cx + dot_r + 3, dot_cy + dot_r + 3],
        fill=CYAN_RGB + (glow_a,),
    )
    td.ellipse([dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r], fill=CYAN_RGB + (255,))
    td.text((pad + dot_r * 2 + gap - bbox[0], pad - bbox[1]), label, font=font, fill=WHITE_RGB + (235,))
    x = W - 20 - tile_w
    y = 18
    img.paste(tile, (x, y), tile)


# --------------------------------------------------------------------------
# frame rendering
# --------------------------------------------------------------------------
def render_frame(t, static_bg, plans, cap_font, tag_font, captions):
    img = static_bg.copy()
    draw = ImageDraw.Draw(img)

    instructions = []  # (sort_y, kind, args)
    for plan in plans:
        for cube in plan["cubes"]:
            st = cube_state(cube, t)
            if st is None:
                continue
            cx, cy, alpha, flash = st
            sort_y = cube["cy"] + cube["gz"] * 0.001
            instructions.append((sort_y, cx, cy, alpha, plan_colors_for(cube), flash))

    instructions.sort(key=lambda x: x[0])
    for _sort_y, cx, cy, alpha, colors, flash in instructions:
        if alpha >= 0.999:
            draw_cube_opaque(draw, cx, cy, colors)
        else:
            draw_cube_alpha(img, cx, cy, colors, alpha)
        if flash:
            draw_flash(img, cx, cy - CUBE_HH, WHITE_RGB, flash ** 1.4, CUBE_HW * 1.05)

    for plan in plans:
        if plan["style"] == "dome":
            city_hall_extras(img, plan, t)

    draw_caption(img, t, cap_font, captions)
    draw_live_tag(img, t, tag_font)
    return img


def plan_colors_for(cube):
    return cube["colors"]


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main():
    args = sys.argv[1:]
    segment, lots = load_lots()
    plans = [build_plan(l, i) for i, l in enumerate(lots)]

    if "--check" in args:
        bounds_check(plans)
        return

    if "--frames" in args:
        idxs = [int(x) for x in args[args.index("--frames") + 1].split(",")]
        os.makedirs(FRAMES_DIR, exist_ok=True)
        static_bg = make_static_bg(plans)
        cap_font = ImageFont.truetype(FONT_PATH, 22, index=1)
        tag_font = ImageFont.truetype(FONT_PATH, 15, index=1)
        captions = make_captions(segment, len(lots))
        for i in idxs:
            t = i / FPS
            img = render_frame(t, static_bg, plans, cap_font, tag_font, captions)
            path = os.path.join(FRAMES_DIR, f"dbg_{i:04d}.png")
            img.save(path)
            print("wrote", path)
        return

    bounds_check(plans)

    if os.path.isdir(FRAMES_DIR):
        shutil.rmtree(FRAMES_DIR)
    os.makedirs(FRAMES_DIR, exist_ok=True)

    static_bg = make_static_bg(plans)
    cap_font = ImageFont.truetype(FONT_PATH, 22, index=1)
    tag_font = ImageFont.truetype(FONT_PATH, 15, index=1)
    captions = make_captions(segment, len(lots))

    for i in range(N_FRAMES):
        t = i / FPS
        img = render_frame(t, static_bg, plans, cap_font, tag_font, captions)
        img.save(os.path.join(FRAMES_DIR, f"frame_{i:04d}.png"))
        if i % 48 == 0:
            print(f"rendered {i}/{N_FRAMES}")
    print(f"rendered {N_FRAMES}/{N_FRAMES}")

    os.makedirs(os.path.dirname(OUT_MP4), exist_ok=True)
    cmd = [
        FFMPEG,
        "-y",
        "-framerate",
        str(FPS),
        "-i",
        os.path.join(FRAMES_DIR, "frame_%04d.png"),
        "-frames:v",
        str(N_FRAMES),
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "high",
        "-crf",
        "23",
        "-movflags",
        "+faststart",
        OUT_MP4,
    ]
    print("running:", " ".join(cmd))
    subprocess.run(cmd, check=True)

    size = os.path.getsize(OUT_MP4)
    print(f"wrote {OUT_MP4} ({size/1e6:.2f} MB)")

    probe = subprocess.run(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_name,width,height,pix_fmt,codec_type",
            "-of",
            "default=noprint_wrappers=1",
            OUT_MP4,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    print(probe.stdout)


if __name__ == "__main__":
    main()
