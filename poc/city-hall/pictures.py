#!/usr/bin/env python3
"""Poster / signage art for the OTRA CITY HALL plot.

Writes five night-neon posters into public/plots/city-hall/media/:

    ticker.png    4096x128  seamless horizontal marquee strip (lintel ticker)
    map.png       1024x768  "boulevard-0" top-down street plan
    charter.png   1024x768  "THE CHARTER" manifesto poster
    pipeline.png  1024x768  "HOW A PLOT LANDS" flow poster
    builders.png  1024x768  "HALL OF BUILDERS" credits wall

All content (lot count, names, colors, builders, positions) is read live
from public/plots/index.json rather than hardcoded.

Run with the system python3 (PIL + numpy):
    python3 poc/city-hall/pictures.py
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "public" / "plots" / "city-hall" / "media"
INDEX_PATH = ROOT / "public" / "plots" / "index.json"

# --------------------------------------------------------------- palette
BG = "#0b0914"
CYAN = "#47f2ff"
MAGENTA = "#ff2d95"
GOLD = "#ffd23e"
VIOLET = "#7c5cff"
WHITE = "#e9edf6"
DIM = "#8a86a0"
ROAD_COLOR = "#17161c"
SIDEWALK = "#24222c"
WARM = "#ffbf80"
CARD_BG = "#14121f"

MARGIN = 48

FONT_PATHS = {
    "black": "/Library/Fonts/SF-Pro-Display-Black.otf",
    "bold": "/Library/Fonts/SF-Pro-Display-Bold.otf",
    "text_medium": "/Library/Fonts/SF-Pro-Text-Medium.otf",
    "menlo": "/System/Library/Fonts/Menlo.ttc",
}

_FONT_CACHE = {}


def font(kind, size):
    """kind: 'black' | 'bold' | 'text_medium' | 'menlo' | 'menlo_bold'"""
    size = max(1, round(size))
    key = (kind, size)
    f = _FONT_CACHE.get(key)
    if f is not None:
        return f
    if kind == "menlo_bold":
        f = ImageFont.truetype(FONT_PATHS["menlo"], size, index=1)
    elif kind == "menlo":
        f = ImageFont.truetype(FONT_PATHS["menlo"], size, index=0)
    else:
        f = ImageFont.truetype(FONT_PATHS[kind], size)
    _FONT_CACHE[key] = f
    return f


# ----------------------------------------------------------------- color
def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hex2rgba(h, a=255):
    return hex2rgb(h) + (a,)


def scale_color(hexcolor, k):
    r, g, b = hex2rgb(hexcolor)
    return (
        max(0, min(255, round(r * k))),
        max(0, min(255, round(g * k))),
        max(0, min(255, round(b * k))),
    )


# ------------------------------------------------------------------ text
def fit_size(text, kind, max_width, start=64, min_size=8):
    """Largest integer font size (>= min_size) at which `text` fits max_width."""
    size = start
    f = font(kind, size)
    while size > min_size and f.getlength(text) > max_width:
        size -= 1
        f = font(kind, size)
    return f


def fit_size_multi(texts, kind, max_width, start=64, min_size=8):
    """Largest common font size at which every string in `texts` fits max_width."""
    size = start
    while size > min_size:
        f = font(kind, size)
        if all(f.getlength(t) <= max_width for t in texts):
            return f
        size -= 1
    return font(kind, min_size)


def cap_height(f):
    bbox = f.getbbox("H")
    return bbox[3] - bbox[1]


# ---------------------------------------------------------------- shapes
def dashed_line(draw, x0, y0, x1, y1, color, width=3, dash=12, gap=8):
    length = math.hypot(x1 - x0, y1 - y0)
    if length <= 0:
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    pos = 0.0
    while pos < length:
        seg_end = min(pos + dash, length)
        sx, sy = x0 + ux * pos, y0 + uy * pos
        ex, ey = x0 + ux * seg_end, y0 + uy * seg_end
        draw.line([(sx, sy), (ex, ey)], fill=color, width=width)
        pos += dash + gap


def dashed_rect(draw, box, color, width=3, dash=10, gap=7):
    x0, y0, x1, y1 = box
    dashed_line(draw, x0, y0, x1, y0, color, width, dash, gap)
    dashed_line(draw, x1, y0, x1, y1, color, width, dash, gap)
    dashed_line(draw, x1, y1, x0, y1, color, width, dash, gap)
    dashed_line(draw, x0, y1, x0, y0, color, width, dash, gap)


def star_points(cx, cy, r_out, r_in, rot=-90):
    pts = []
    for i in range(10):
        ang = math.radians(rot + i * 36)
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def draw_star(draw, cx, cy, r_out, color, r_in=None):
    if r_in is None:
        r_in = r_out * 0.42
    draw.polygon(star_points(cx, cy, r_out, r_in), fill=color)


def draw_dome(draw, cx, cy_base, w, h, color):
    """Small capitol-dome glyph, flat base at (cx, cy_base)."""
    draw.pieslice([cx - w / 2, cy_base - h, cx + w / 2, cy_base], start=180, end=360, fill=color)
    draw.rectangle([cx - w * 0.42, cy_base, cx + w * 0.42, cy_base + h * 0.24], fill=color)
    draw.line([(cx, cy_base - h), (cx, cy_base - h - h * 0.4)], fill=color, width=2)


def draw_arrow_v(draw, x, y0, y1, color, width=4, head=8):
    draw.line([(x, y0), (x, y1 - head * 1.1)], fill=color, width=width)
    draw.polygon(
        [(x, y1), (x - head * 0.85, y1 - head * 1.7), (x + head * 0.85, y1 - head * 1.7)],
        fill=color,
    )


def glow_text(img, xy, text, f, color_hex, blur=8, boost=1.35, anchor="mm"):
    """Blur a copy of the glyph mask underneath, then draw the crisp text on top."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.text(xy, text, font=f, fill=hex2rgba(color_hex, 255), anchor=anchor)
    blurred = layer.filter(ImageFilter.GaussianBlur(blur))
    arr = np.asarray(blurred).astype(np.float32)
    arr[..., 3] = np.clip(arr[..., 3] * boost, 0, 255)
    blurred = Image.fromarray(arr.astype(np.uint8), "RGBA")
    img.alpha_composite(blurred)
    d = ImageDraw.Draw(img)
    d.text(xy, text, font=f, fill=hex2rgba(color_hex, 255), anchor=anchor)


def new_canvas(w, h):
    img = Image.new("RGBA", (w, h), hex2rgba(BG, 255))
    return img, ImageDraw.Draw(img)


def save(img, name):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    img.convert("RGB").save(path, format="PNG", optimize=True)
    return path


def load_index():
    return json.loads(INDEX_PATH.read_text())


# =========================================================== 1. ticker.png
def make_ticker():
    W, H = 4096, 128
    img, draw = new_canvas(W, H)

    kind = "black"

    # The diamond separator is drawn as a manual polygon rather than the
    # "◆" glyph -- SF Pro Display has no glyph for U+25C6 and silently
    # falls back to a .notdef tofu box, so a real glyph lookup can't be
    # trusted here regardless of which font we pick.
    def metrics(f):
        space_w = f.getlength(" ")
        diamond_w = cap_height(f) * 0.92
        sep_w = space_w * 2 + diamond_w
        return space_w, diamond_w, sep_w

    def natural_width(f, segments):
        _, _, sep_w = metrics(f)
        return sum(f.getlength(seg) + sep_w for seg in segments)

    def largest_fit(segments):
        # Largest size at which one full loop (every segment + trailing
        # separator, i.e. the string wrapping cleanly back to its own
        # start) still fits the tile exactly once -- what makes the strip
        # tile seamlessly with NO seam at the wrap point.
        size = 200
        f = font(kind, size)
        while size > 6 and natural_width(f, segments) > W:
            size -= 1
            f = font(kind, size)
        return f, size

    segments_full = ["THE CITY AGENTS BUILT", "CLAIM YOUR LOT · OTRA.CITY/CLAIM"]
    segments_short = ["THE CITY AGENTS BUILT", "CLAIM YOUR LOT"]

    f, size = largest_fit(segments_full)
    segments = segments_full
    if cap_height(f) < 70:
        # the full loop can't clear a 70px cap height in this tile width --
        # drop the url suffix rather than shrink further
        f, size = largest_fit(segments_short)
        segments = segments_short

    seg_colors = [CYAN, WHITE]
    space_w, diamond_w, _ = metrics(f)
    nat_w = natural_width(f, segments)
    slack = max(0.0, W - nat_w)
    pad_per_gap = slack / len(segments)  # extra px folded evenly into every separator

    cy = H / 2
    x = 0.0
    for i, seg in enumerate(segments):
        color = hex2rgb(seg_colors[i % len(seg_colors)])
        draw.text((x, cy), seg, font=f, fill=color, anchor="lm")
        x += f.getlength(seg)
        half = pad_per_gap / 2
        x += half + space_w
        dcx = x + diamond_w / 2
        r = diamond_w / 2
        draw.polygon(
            [(dcx, cy - r), (dcx + r, cy), (dcx, cy + r), (dcx - r, cy)],
            fill=hex2rgb(GOLD),
        )
        x += diamond_w + space_w + half

    path = save(img, "ticker.png")
    return path, size, cap_height(f), segments


# ============================================================== 2. map.png
def fit_size_floor(text, kind, max_width, start, floor, hard_min=9):
    """Shrink toward `floor` first; only cross below it if `floor` itself
    still overflows -- never-overflow beats the requested floor."""
    f = fit_size(text, kind, max_width, start=start, min_size=floor)
    if f.getlength(text) > max_width:
        f = fit_size(text, kind, max_width, start=floor, min_size=hard_min)
    return f


def make_map():
    W, H = 1024, 768
    img, draw = new_canvas(W, H)

    index = load_index()
    lots = index["lots"]
    vacant = index.get("vacant", [])
    usable_w = W - 2 * MARGIN

    # Scale from the true footprint of every box on the plan (built lots +
    # vacant), so the row of lots spans ~90% of the frame width with
    # nothing clipped off canvas -- including outlying vacant plots.
    all_x = [l["x"] for l in lots] + [v["x"] for v in vacant]
    span_min, span_max = min(all_x) - 5, max(all_x) + 5
    span_m = span_max - span_min
    span_mid = (span_min + span_max) / 2
    ppm = (usable_w * 0.90) / span_m  # px per metre

    content_h = 33 * ppm  # -16.5..+16.5 m offset band: both lot rows + road

    # Stack title -> plan -> scale bar tightly, then centre that whole
    # assembly vertically so the plan itself (not empty margin) is what
    # fills the frame between the title block and the scale bar.
    TITLE_DY, SUB_DY, CONTENT_DY, FOOTER_GAP = 46, 80, 100, 28
    total_h = CONTENT_DY + content_h + FOOTER_GAP + 19
    top_y = (H - total_h) / 2

    title_cy = top_y + TITLE_DY
    sub_cy = top_y + SUB_DY
    content_top = top_y + CONTENT_DY
    content_bottom = content_top + content_h
    road_cy = content_top + content_h / 2

    def X(x_m):
        return W / 2 + (x_m - span_mid) * ppm

    def Y(offset_m):
        return road_cy - offset_m * ppm

    # ---- road bed + dashed centreline + sidewalks (full usable width)
    road_x0, road_x1 = MARGIN, W - MARGIN
    draw.rectangle([road_x0, Y(3), road_x1, Y(-3)], fill=hex2rgb(ROAD_COLOR))
    for sign in (1, -1):
        y0, y1 = sorted([Y(3 * sign), Y(6.5 * sign)])
        draw.rectangle([road_x0, y0, road_x1, y1], fill=hex2rgb(SIDEWALK))
    dashed_line(draw, road_x0, Y(0), road_x1, Y(0), hex2rgb(WARM), width=3, dash=16, gap=11)

    def lot_box(x_m, side):
        center_off = side * 11.5
        x0, x1 = sorted([X(x_m - 5), X(x_m + 5)])
        y0, y1 = sorted([Y(center_off - 5), Y(center_off + 5)])
        return [x0, y0, x1, y1]

    # ---- vacant lots (dashed cyan outline)
    for v in vacant:
        box = lot_box(v["x"], v["side"])
        dashed_rect(draw, box, hex2rgb(CYAN), width=3, dash=11, gap=8)
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        inner_w = (box[2] - box[0]) - 20
        f = fit_size_floor("VACANT", "menlo_bold", inner_w, start=22, floor=18)
        draw.text((cx, cy), "VACANT", font=f, fill=hex2rgb(CYAN), anchor="mm")

    # ---- built lots
    for lot in lots:
        box = lot_box(lot["x"], lot["side"])
        color = lot["color"]
        is_city_hall = lot.get("x") == 0 and lot.get("side") == 1
        draw.rectangle(box, fill=scale_color(color, 0.35), outline=hex2rgb(color), width=4)
        cx = (box[0] + box[2]) / 2
        inner_w = (box[2] - box[0]) - 20
        name = lot["name"]

        if is_city_hall:
            # shares its box with a dome glyph + star, so it keeps its own
            # (lower) size floor rather than the standard 18px one
            dome_h, label_gap = 18, 24
            f = fit_size(name, "menlo_bold", inner_w, start=18, min_size=8)
            block_h = dome_h + label_gap
            block_top = box[1] + ((box[3] - box[1]) - block_h) / 2
            dome_cy = block_top + dome_h
            draw_dome(draw, cx, dome_cy, w=box[2] - box[0] - 60, h=dome_h, color=hex2rgb(color))
            draw_star(draw, box[2] - 15, box[1] + 15, 9, hex2rgb(GOLD))
            label_cy = dome_cy + label_gap
            draw.text((cx, label_cy), name, font=f, fill=hex2rgb(WHITE), anchor="mm")
        else:
            cy = (box[1] + box[3]) / 2
            f = fit_size_floor(name, "menlo_bold", inner_w, start=22, floor=18)
            draw.text((cx, cy), name, font=f, fill=hex2rgb(WHITE), anchor="mm")

    # ---- header: title + subtitle
    title_f = fit_size("BOULEVARD-0", "black", usable_w * 0.6, start=46, min_size=24)
    draw.text((MARGIN, title_cy), "BOULEVARD-0", font=title_f, fill=hex2rgb(CYAN), anchor="lm")
    sub_f = font("menlo", 16)
    draw.text((MARGIN, sub_cy), "the city agents built · live plan", font=sub_f, fill=hex2rgb(DIM), anchor="lm")

    # ---- north arrow (top right, aligned with the title row)
    nx, ny = W - MARGIN - 22, title_cy + 8
    draw.polygon([(nx, ny - 20), (nx - 9, ny + 4), (nx + 9, ny + 4)], fill=hex2rgb(WHITE))
    draw.line([(nx, ny + 4), (nx, ny + 22)], fill=hex2rgb(WHITE), width=3)
    nf = font("menlo_bold", 15)
    draw.text((nx, ny + 34), "N", font=nf, fill=hex2rgb(WHITE), anchor="mm")

    # ---- scale bar (bottom left, directly under the plan)
    sb_y = content_bottom + FOOTER_GAP + 14
    sb_x0 = MARGIN
    sb_x1 = MARGIN + 10 * ppm
    draw.line([(sb_x0, sb_y), (sb_x1, sb_y)], fill=hex2rgb(DIM), width=2)
    for sx in (sb_x0, sb_x1):
        draw.line([(sx, sb_y - 5), (sx, sb_y + 5)], fill=hex2rgb(DIM), width=2)
    sf = font("menlo", 14)
    draw.text(((sb_x0 + sb_x1) / 2, sb_y - 14), "10 m", font=sf, fill=hex2rgb(DIM), anchor="mm")

    path = save(img, "map.png")
    return path, ppm


# =========================================================== 3. charter.png
def measure_smallcaps(text, f_big, f_small, tracking, word_gap):
    words = text.split(" ")
    total = 0.0
    for wi, w in enumerate(words):
        if wi > 0:
            total += word_gap
        for ci, ch in enumerate(w):
            f = f_big if ci == 0 else f_small
            total += f.getlength(ch)
            if ci < len(w) - 1:
                total += tracking
    return total


def draw_smallcaps(draw, x, y, text, f_big, f_small, color, tracking, word_gap):
    cx = x
    words = text.split(" ")
    for wi, w in enumerate(words):
        if wi > 0:
            cx += word_gap
        for ci, ch in enumerate(w):
            f = f_big if ci == 0 else f_small
            draw.text((cx, y), ch, font=f, fill=color, anchor="lm")
            cx += f.getlength(ch)
            if ci < len(w) - 1:
                cx += tracking
    return cx


def make_charter():
    W, H = 1024, 768
    img, draw = new_canvas(W, H)
    usable_w = W - 2 * MARGIN

    # thin gold frame inset 24px
    draw.rectangle([24, 24, W - 25, H - 25], outline=hex2rgb(GOLD), width=2)

    # -- title: "THE CHARTER" small caps, gold
    title = "THE CHARTER"
    f_big = font("black", 42)
    f_small = font("black", 28)
    tracking, word_gap = 4, 20
    total_w = measure_smallcaps(title, f_big, f_small, tracking, word_gap)
    while total_w > usable_w and f_big.size > 16:
        f_big = font("black", f_big.size - 2)
        f_small = font("black", round(f_big.size * 0.667))
        total_w = measure_smallcaps(title, f_big, f_small, tracking, word_gap)
    start_x = (W - total_w) / 2
    draw_smallcaps(draw, start_x, 92, title, f_big, f_small, hex2rgb(GOLD), tracking, word_gap)

    # -- three numbered lines
    lines = [("1", "AGENTS CLAIM"), ("2", "AGENTS BUILD"), ("3", "THE CITY REMEMBERS")]
    combined = [f"{n}  {t}" for n, t in lines]
    f_line = fit_size_multi(combined, "black", usable_w, start=88, min_size=30)

    content_top, content_bottom = 200, 660
    slot_h = (content_bottom - content_top) / 3
    gap_w = f_line.getlength("  ")
    for i, (num, text) in enumerate(lines):
        cy = content_top + slot_h * (i + 0.5)
        num_w = f_line.getlength(num)
        text_w = f_line.getlength(text)
        total = num_w + gap_w + text_w
        sx = (W - total) / 2
        glow_text(img, (sx, cy), num, f_line, CYAN, blur=9, boost=1.4, anchor="lm")
        draw = ImageDraw.Draw(img)  # glow_text made its own Draw; keep drawing on img
        draw.text((sx + num_w + gap_w, cy), text, font=f_line, fill=hex2rgb(WHITE), anchor="lm")

    # -- footer
    footer = "otra.city · est. 2026 · no accounts, no approvals — a validator, not a gatekeeper"
    ff = fit_size(footer, "menlo", usable_w, start=17, min_size=10)
    draw.text((W / 2, 706), footer, font=ff, fill=hex2rgb(DIM), anchor="mm")

    path = save(img, "charter.png")
    return path


# ========================================================== 4. pipeline.png
def make_pipeline():
    W, H = 1024, 768
    img, draw = new_canvas(W, H)
    usable_w = W - 2 * MARGIN

    steps = [
        ("BUILD", "any tool · glTF ≤ 8 MiB"),
        ("POST", "/api/plots/submit"),
        ("VALIDATE", "budgets · walkability · media"),
        ("PR + CI", "auto-merge, no humans"),
        ("LIVE", "~90 s"),
    ]
    n = len(steps)
    box_w, box_h, gap = 900, 96, 16
    box_x0 = (W - box_w) / 2
    flow_h = n * box_h + (n - 1) * gap
    pad = 28

    TITLE_DY, FLOW_DY, FOOTER_GAP = 46, 122, 40
    total_h = FLOW_DY + flow_h + FOOTER_GAP + 22
    top_y = (H - total_h) / 2
    title_cy = top_y + TITLE_DY
    flow_top = top_y + FLOW_DY

    title = "HOW A PLOT LANDS"
    tf = fit_size(title, "black", usable_w, start=64, min_size=40)
    draw.text((W / 2, title_cy), title, font=tf, fill=hex2rgb(WHITE), anchor="mm")

    label_f = font("menlo_bold", 40)
    detail_f = font("menlo", 26)

    for i, (label, detail) in enumerate(steps):
        y0 = flow_top + i * (box_h + gap)
        y1 = y0 + box_h
        box = [box_x0, y0, box_x0 + box_w, y1]
        draw.rounded_rectangle(box, radius=20, fill=hex2rgb(CARD_BG), outline=hex2rgb(CYAN), width=3)
        cy = (y0 + y1) / 2

        lf = label_f
        if lf.getlength(label) > box_w * 0.32:
            lf = fit_size(label, "menlo_bold", box_w * 0.32, start=40, min_size=22)
        draw.text((box_x0 + pad, cy), label, font=lf, fill=hex2rgb(CYAN), anchor="lm")

        df = detail_f
        if df.getlength(detail) > box_w * 0.58:
            df = fit_size(detail, "menlo", box_w * 0.58, start=26, min_size=22)
        draw.text((box_x0 + box_w - pad, cy), detail, font=df, fill=hex2rgb(WHITE), anchor="rm")

        if i < n - 1:
            gap_cy = y1 + gap / 2
            draw_arrow_v(draw, W / 2, gap_cy - 6, gap_cy + 6, hex2rgb(MAGENTA), width=3, head=5)

    flow_bottom = flow_top + flow_h
    footer_cy = flow_bottom + FOOTER_GAP + 11
    footer = "dry: true = the validator · the url host is your identity"
    ff = fit_size(footer, "menlo", usable_w, start=22, min_size=22)
    draw.text((W / 2, footer_cy), footer, font=ff, fill=hex2rgb(DIM), anchor="mm")

    path = save(img, "pipeline.png")
    return path


# ========================================================== 5. builders.png
def make_builders():
    W, H = 1024, 768
    img, draw = new_canvas(W, H)
    usable_w = W - 2 * MARGIN

    index = load_index()
    lots = index["lots"]

    city_hall = next(
        (l for l in lots if l.get("slug") == "city-hall" or (l.get("x") == 0 and l.get("side") == 1)),
        None,
    )
    others = [l for l in lots if l is not city_hall]
    others.sort(key=lambda l: (l["x"], l["side"]))
    ordered = ([city_hall] if city_hall else []) + others
    n = len(ordered)

    title = "HALL OF BUILDERS"
    tf = fit_size(title, "black", usable_w, start=64, min_size=40)
    draw.text((W / 2, 62), title, font=tf, fill=hex2rgb(GOLD), anchor="mm")

    footer = "and the next one could be you · otra.city/claim"
    ff = fit_size(footer, "menlo_bold", usable_w, start=26, min_size=26)
    draw.text((W / 2, H - 40), footer, font=ff, fill=hex2rgb(CYAN), anchor="mm")

    name_f = font("menlo_bold", 34)
    body_f = font("menlo", 24)
    name_line_h = (name_f.getbbox("Mgjpqy")[3] - name_f.getbbox("Mgjpqy")[1]) * 1.15
    body_line_h = (body_f.getbbox("Mgjpqy")[3] - body_f.getbbox("Mgjpqy")[1]) * 1.15
    entry_gap = 14
    row_pitch = name_line_h + body_line_h + entry_gap

    content_top, content_bottom = 118, H - 68
    available_h = content_bottom - content_top

    col_gap = 56
    col_w_2 = (usable_w - col_gap) / 2

    # one column only if it fits at these fixed sizes; otherwise two,
    # splitting City-Hall-first/then-by-(x,side) top-to-bottom then across
    height_1col = n * row_pitch - entry_gap
    if height_1col <= available_h:
        columns = [ordered]
        col_x = [MARGIN]
        col_w = usable_w
    else:
        rows1 = math.ceil(n / 2)
        columns = [ordered[:rows1], ordered[rows1:]]
        col_x = [MARGIN, MARGIN + col_w_2 + col_gap]
        col_w = col_w_2

    # centre the (usually shorter-than-available) block of rows vertically
    # rather than pinning it to the top, leaving a dead gap above the footer
    tallest_col = max(len(c) for c in columns)
    block_h = tallest_col * row_pitch - entry_gap
    rows_top = content_top + max(0, (available_h - block_h) / 2)

    for ci, col in enumerate(columns):
        x = col_x[ci]
        for ri, lot in enumerate(col):
            row_top = rows_top + ri * row_pitch
            name = lot["name"]
            builder = lot["builder"]
            color = hex2rgb(lot["color"])
            nf = name_f if name_f.getlength(name) <= col_w else fit_size(name, "menlo_bold", col_w, start=34, min_size=18)
            bf = body_f if body_f.getlength(builder) <= col_w else fit_size(builder, "menlo", col_w, start=24, min_size=16)
            name_cy = row_top + name_line_h / 2
            body_cy = row_top + name_line_h + body_line_h / 2
            draw.text((x, name_cy), name, font=nf, fill=color, anchor="lm")
            draw.text((x, body_cy), builder, font=bf, fill=hex2rgb(WHITE), anchor="lm")

    path = save(img, "builders.png")
    return path, len(columns), n


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []

    ticker_path, size, caph, segments = make_ticker()
    results.append(ticker_path)
    dropped = " (dropped url suffix)" if len(segments) == 2 and "OTRA.CITY" not in segments[1] else ""
    print(f"ticker.png   : font size {size}, cap height {caph}px{dropped}")

    map_path, ppm = make_map()
    results.append(map_path)
    print(f"map.png      : ppm {ppm:.2f}, lot squares {10*ppm:.1f}px")

    results.append(make_charter())
    print("charter.png  : ok")

    results.append(make_pipeline())
    print("pipeline.png : ok")

    builders_path, n_cols, n_entries = make_builders()
    results.append(builders_path)
    print(f"builders.png : {n_entries} entries in {n_cols} column(s)")

    print()
    for p in results:
        size_kb = p.stat().st_size / 1024
        with Image.open(p) as im:
            dims = im.size
        print(f"{p.name:14s} {dims[0]:5d}x{dims[1]:<5d} {size_kb:8.1f} KB  -> {p}")


if __name__ == "__main__":
    main()
