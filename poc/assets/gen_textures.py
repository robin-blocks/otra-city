#!/usr/bin/env python3
"""Generate the PromptFrenzy shop textures (pure stdlib, no PIL).

Outputs (next to this script):
  atlas.png        1024x1024 art atlas: sign, poster, live panel, link poster, logo
  palette.png      256x256 palette (16x16 grid of 16px cells) for voxel face colors
  atlas_map.json   pixel rects for each atlas region (top-left origin)
  palette_map.json name -> {hex, cell [col,row]} for the builder

Pixel-font look is intentional: matches otra.city's voxel aesthetic and keeps
files tiny.
"""
import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- PNG writer

def write_png(path, w, h, rgba):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(
        b"\x00" + bytes(rgba[y * w * 4 : (y + 1) * w * 4]) for y in range(h)
    )
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


class Canvas:
    def __init__(self, w, h, bg):
        self.w, self.h = w, h
        self.px = bytearray(w * h * 4)
        self.rect(0, 0, w, h, bg)

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 4
            self.px[i : i + 4] = bytes(c)

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, c)

    def frame(self, x, y, w, h, t, c):
        self.rect(x, y, w, t, c)
        self.rect(x, y + h - t, w, t, c)
        self.rect(x, y, t, h, c)
        self.rect(x + w - t, y, t, h, c)


def hexc(s, a=255):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


# ------------------------------------------------------------- 5x7 pixel font

FONT = {  # 7 rows of 5-bit ints, MSB = leftmost pixel
    "A": [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    "B": [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
    "C": [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
    "D": [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E],
    "E": [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
    "F": [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
    "G": [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0E],
    "H": [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    "I": [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
    "J": [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
    "K": [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
    "L": [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
    "M": [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
    "N": [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
    "O": [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
    "P": [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
    "Q": [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
    "R": [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
    "S": [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
    "T": [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    "U": [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
    "V": [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
    "W": [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
    "X": [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
    "Y": [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
    "Z": [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
    "0": [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
    "1": [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
    "2": [0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F],
    "3": [0x0E, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0E],
    "4": [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
    "5": [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
    "6": [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
    "7": [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
    "8": [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
    "9": [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
    " ": [0, 0, 0, 0, 0, 0, 0],
    ".": [0, 0, 0, 0, 0, 0x0C, 0x0C],
    ",": [0, 0, 0, 0, 0, 0x0C, 0x08],
    ":": [0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0],
    "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
    "-": [0, 0, 0, 0x1F, 0, 0, 0],
    "+": [0, 0x04, 0x04, 0x1F, 0x04, 0x04, 0],
    "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
    "%": [0x19, 0x1A, 0x02, 0x04, 0x08, 0x0B, 0x13],
    ">": [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
    "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
}


def text_w(s, scale):
    return (len(s) * 6 - 1) * scale


def draw_text(cv, x, y, s, scale, color, shadow=None):
    if shadow:
        draw_text(cv, x + scale, y + scale, s, scale, shadow)
    cx = x
    for ch in s.upper():
        rows = FONT.get(ch, FONT[" "])
        for ry, bits in enumerate(rows):
            for rx in range(5):
                if bits & (1 << (4 - rx)):
                    cv.rect(cx + rx * scale, y + ry * scale, scale, scale, color)
        cx += 6 * scale


BOLT = [
    ".......XXXX.",
    "......XXXX..",
    ".....XXXX...",
    "....XXXX....",
    "...XXXXXXXX.",
    "......XXXX..",
    ".....XXXX...",
    "....XXXX....",
    "...XXXX.....",
    "..XXXX......",
    ".XXXX.......",
    ".XXX........",
]


def draw_bolt(cv, x, y, scale, color, outline=None):
    if outline:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx or dy:
                    draw_bolt(cv, x + dx * scale, y + dy * scale, scale, outline)
    for ry, row in enumerate(BOLT):
        for rx, c in enumerate(row):
            if c == "X":
                cv.rect(x + rx * scale, y + ry * scale, scale, scale, color)


# ------------------------------------------------------------------- palette

PALETTE = {
    # structure / props
    "wall":        "#2a1e4a",
    "wall_dark":   "#1d1536",
    "floor":       "#16141c",
    "floor_walk":  "#211b2e",
    "runway":      "#3c2158",
    "trim":        "#0d0a14",
    "steel":       "#646a80",
    "shelf":       "#2f2a44",
    "counter":     "#342547",
    "counter_top": "#423057",
    "plinth":      "#8b90a8",
    "white":       "#e9edf6",
    "cyan":        "#2fe0f8",
    "magenta":     "#ff2d95",
    "yellow":      "#ffd23e",
    "violet":      "#7c5cff",
    "box_dark":    "#241f38",
    "door":        "#12101a",
    # emissive cells (referenced by the emissive material)
    "emis_white":   "#fff3e0",
    "emis_magenta": "#ff4fae",
    "emis_cyan":    "#47f2ff",
    "emis_warm":    "#ffd9a0",
    "emis_yellow":  "#ffdf4d",
    # free-form plot additions (append-only: existing cell indices must not move)
    "grass_dark":  "#17301f",
    "grass":       "#234a2c",
    "leaf":        "#2f6b3a",
    "trunk":       "#3a2b22",
    "water":       "#0f2f4a",
    "stone":       "#5c5a66",
    "gravel":      "#24222c",
    "emis_leaf":   "#7dffa8",
    "emis_lily":   "#6ff7d8",
    "emis_violet": "#a78bff",
    "emis_red":    "#ff5d5d",
}


def build_palette():
    cell = 16
    cv = Canvas(256, 256, hexc("#000000"))
    pmap = {}
    for i, (name, hx) in enumerate(PALETTE.items()):
        col, row = i % 16, i // 16
        cv.rect(col * cell, row * cell, cell, cell, hexc(hx))
        pmap[name] = {"hex": hx, "cell": [col, row]}
    write_png(os.path.join(HERE, "palette.png"), 256, 256, cv.px)
    with open(os.path.join(HERE, "palette_map.json"), "w") as f:
        json.dump({"grid": 16, "cell_px": cell, "colors": pmap}, f, indent=2)


# --------------------------------------------------------------------- atlas

REGIONS = {
    "sign":   [0, 0, 1024, 160],
    "poster": [0, 160, 512, 736],
    "live":   [512, 160, 512, 384],
    "link":   [512, 544, 512, 384],
    "logo":   [0, 896, 128, 128],
}

MAGENTA = hexc("#ff2d95")
CYAN = hexc("#2fe0f8")
WHITE = hexc("#e9edf6")
DARK = hexc("#0a0612")
SHADOW = hexc("#05030a")


def centered(cv, rx, rw, y, s, scale, color, shadow=SHADOW):
    draw_text(cv, rx + (rw - text_w(s, scale)) // 2, y, s, scale, color, shadow)


def build_atlas():
    cv = Canvas(1024, 1024, hexc("#120b20"))

    # --- sign (6.4:1)
    x, y, w, h = REGIONS["sign"]
    cv.rect(x, y, w, h, DARK)
    cv.frame(x, y, w, h, 4, hexc("#31234f"))
    tw = text_w("PROMPT", 11) + 11 + text_w("FRENZY", 11)
    bx = x + (w - (tw + 124)) // 2
    draw_bolt(cv, bx, y + 24, 9, hexc("#ffd23e"), SHADOW)
    tx = bx + 120
    draw_text(cv, tx, y + 42, "PROMPT", 11, MAGENTA, SHADOW)
    draw_text(cv, tx + text_w("PROMPT", 11) + 11, y + 42, "FRENZY", 11, CYAN, SHADOW)

    # --- poster (512x736)
    x, y, w, h = REGIONS["poster"]
    cv.rect(x, y, w, h, hexc("#1c0f33"))
    cv.frame(x, y, w, h, 6, MAGENTA)
    draw_bolt(cv, x + (w - 12 * 9) // 2, y + 36, 9, hexc("#ffd23e"), SHADOW)
    centered(cv, x, w, y + 168, "PROMPTFRENZY", 5, CYAN)
    centered(cv, x, w, y + 226, "A/B TEST", 8, WHITE)
    centered(cv, x, w, y + 296, "YOUR PROMPTS", 6, WHITE)
    # bar chart: prompt A vs prompt B
    base = y + 560
    cv.rect(x + 120, base - 80, 70, 80, hexc("#4a465e"))
    cv.rect(x + 320, base - 170, 70, 170, CYAN)
    cv.rect(x + 90, base, w - 180, 6, hexc("#4a465e"))
    draw_text(cv, x + 145, base + 18, "A", 5, hexc("#8a86a0"))
    draw_text(cv, x + 345, base + 18, "B", 5, CYAN)
    draw_text(cv, x + 296, base - 208, "+41%", 5, MAGENTA, SHADOW)
    centered(cv, x, w, y + 656, "SHIP THE WINNER.", 5, WHITE)

    # --- live panel (4:3)
    x, y, w, h = REGIONS["live"]
    cv.rect(x, y, w, h, hexc("#0b0714"))
    cv.frame(x, y, w, h, 4, CYAN)
    cv.rect(x + 28, y + 30, 22, 22, hexc("#ff3b30"))
    draw_text(cv, x + 64, y + 26, "LIVE", 4, WHITE, SHADOW)
    centered(cv, x, w, y + 96, "1,238", 12, WHITE)
    centered(cv, x, w, y + 216, "PROMPTS BATTLING NOW", 4, CYAN)
    # sparkline
    heights = [3, 5, 4, 7, 6, 9, 8, 12, 10, 14, 13, 16, 15, 18, 17, 20]
    for i, hh in enumerate(heights):
        cv.rect(x + 40 + i * 28, y + 340 - hh * 4, 16, hh * 4, MAGENTA)

    # --- link poster (4:3) — the clickable fixture
    x, y, w, h = REGIONS["link"]
    cv.rect(x, y, w, h, hexc("#140a20"))
    cv.frame(x, y, w, h, 10, MAGENTA)
    centered(cv, x, w, y + 52, "TRY IT AT", 4, WHITE)
    centered(cv, x, w, y + 130, "PROMPTFRENZY", 5, CYAN)
    centered(cv, x, w, y + 186, ".DEV", 5, CYAN)
    centered(cv, x, w, y + 268, "STEP INSIDE >>", 4, hexc("#ffd23e"))

    # --- logo tile
    x, y, w, h = REGIONS["logo"]
    cv.rect(x, y, w, h, hexc("#0d0a14"))
    cv.frame(x, y, w, h, 4, MAGENTA)
    draw_bolt(cv, x + 16, y + 10, 8, hexc("#ffd23e"), SHADOW)

    write_png(os.path.join(HERE, "atlas.png"), 1024, 1024, cv.px)
    with open(os.path.join(HERE, "atlas_map.json"), "w") as f:
        json.dump({"size": 1024, "regions": REGIONS}, f, indent=2)


if __name__ == "__main__":
    build_palette()
    build_atlas()
    print("wrote atlas.png, palette.png + maps to", HERE)
