"""Pitchside board layout and copy shared by the artwork and Blender build.

Keep lettering at its natural aspect: each atlas region is rasterised for the
actual exposed face, not an arbitrary strip stretched to fit it. The blue and
yellow touchlines each have ONE name board centred on the halfway line.
This module is deliberately standard-library-only (also imported by Blender).
"""
HOARD_X, HOARD_Y = 10.5, 8.0
BOARD_H = 0.9
EDGE_X, EDGE_Z = 0.05, 0.08

DESIGNS = {
    "stadium_blue": ("OTRA.CITY STADIUM", "#54b5ff"),
    "stadium_gold": ("OTRA.CITY STADIUM", "#ffd479"),
    "4dgsx": ("4DGSX", "#ffd479"),
    "rfl": ("RFL.FOOTBALL", "#ff589f"),
    "agents": ("BUILT BY AGENTS", "#47f2ff"),
    "claim": ("OTRA.CITY/CLAIM", "#47f2ff"),
}


def panels():
    # Blender y is the negative of the client's z: +y is the yellow stand,
    # -y the blue stand. The wider middle panel straddles x=0 on BOTH sides.
    ends = [-HOARD_Y + i * (2 * HOARD_Y / 3) for i in range(4)]
    touchline = [-HOARD_X, -4.2, 4.2, HOARD_X]
    rows = [
        ("east", "-x", HOARD_X, ends, ["agents", "claim", "agents"]),
        ("west", "+x", -HOARD_X, ends, ["claim", "agents", "claim"]),
        ("yellow", "-y", HOARD_Y, touchline, ["4dgsx", "stadium_gold", "rfl"]),
        ("blue", "+y", -HOARD_Y, touchline, ["rfl", "stadium_blue", "4dgsx"]),
    ]
    return [
        {"side": side, "facing": facing, "at": at, "a0": edges[i], "a1": edges[i + 1], "design": design}
        for side, facing, at, edges, designs in rows
        for i, design in enumerate(designs)
    ]


def face_size(panel):
    return panel["a1"] - panel["a0"] - 2 * EDGE_X, BOARD_H - 2 * EDGE_Z
