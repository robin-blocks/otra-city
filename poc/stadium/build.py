# OTRA CITY STADIUM — the first venue (docs/venues/ARCHITECTURE.md). Runs
# inside Blender through the BlenderMCP bridge; idempotent (rebuilds the
# Stadium and StadiumFar collections from scratch).
#
# Frame: venue-local metres, Blender Z-up. The glTF export is Y-up, so
# Blender (x, y, z) -> client (x, z, -y): world NORTH (+z) is Blender -y.
# The pitch centre is the origin; the west gate faces the boulevard (-x).
#
# Technique, as City Hall: axis-aligned boxes on a 0.25 m grid meshed with
# one palette material (base + emissive), an art atlas for every word, a
# tiled PBR concrete for walkable decks, a blended palette for glass, and
# one small image per media plate (docks need FULL 0..1 UVs). Collision is
# a handful of col_* proxies the client hides; visual meshes are never
# raycast. Seats are exported as positions the walkability check must reach.
import json
import math
import os
import time

import bpy
from mathutils import Vector

T0 = time.time()
REPO = globals().get("OTRA_REPO", "/Users/robin/Code/personal/otra-city-3d")
SRC = os.path.join(REPO, "poc", "stadium")
OUT_DIR = os.path.join(SRC, "out")
VENUE_DIR = os.path.join(REPO, "public", "venues", "stadium")
DO_RENDER = globals().get("OTRA_RENDER", False)
DO_EXPORT = globals().get("OTRA_EXPORT", True)
SHOTS = globals().get("OTRA_SHOTS", None) or ["overview", "gate"]
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(VENUE_DIR, exist_ok=True)

PMAP = json.load(open(os.path.join(SRC, "palette_map.json")))
AMAP = json.load(open(os.path.join(SRC, "atlas_map.json")))
scene = bpy.context.scene

# ------------------------------------------------------------------ cleanup
for cname in ("Stadium", "StadiumFar", "RENDER_ONLY"):
    c = bpy.data.collections.get(cname)
    if c:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)
for o in list(bpy.data.objects):
    if o.name in ("Cube", "Light", "Camera"):
        bpy.data.objects.remove(o, do_unlink=True)
for name in list(bpy.data.images.keys()):
    if name.startswith("st_"):
        bpy.data.images.remove(bpy.data.images[name])
for m in list(bpy.data.materials):
    if m.name.startswith("stad_"):
        bpy.data.materials.remove(m)
for d in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras):
    for x in list(d):
        if x.users == 0:
            d.remove(x)
col = bpy.data.collections.new("Stadium")
scene.collection.children.link(col)
far_col = bpy.data.collections.new("StadiumFar")
scene.collection.children.link(far_col)

# ---------------------------------------------------------------- materials
def load_img(fname, name, colorspace="sRGB"):
    img = bpy.data.images.load(os.path.join(SRC, fname))
    img.name = name
    img.colorspace_settings.name = colorspace
    return img


img_pal = load_img("palette.png", "st_palette")
img_pem = load_img("palette_emis.png", "st_palette_emis")
img_atlas = load_img("atlas.png", "st_atlas")
img_tb = load_img("tile_base.png", "st_tile_base")
img_tn = load_img("tile_normal.png", "st_tile_normal", "Non-Color")
img_tr = load_img("tile_rough.png", "st_tile_rough", "Non-Color")
img_te = load_img("tile_emis.png", "st_tile_emis")


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def tex_node(mat, img, interp='Closest', ext='EXTEND'):
    t = mat.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = interp
    t.extension = ext
    return t


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    b = principled(m)
    b.inputs["Metallic"].default_value = 0.0
    return m


mat_voxel = new_mat("stad_voxel")
b = principled(mat_voxel)
L = mat_voxel.node_tree.links
L.new(tex_node(mat_voxel, img_pal).outputs["Color"], b.inputs["Base Color"])
L.new(tex_node(mat_voxel, img_pem).outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = 1.2
# matte: under four bright floods a glossier surface reads as grey sheen at
# the grazing angles a pitch is seen from, and the turf loses its colour
b.inputs["Roughness"].default_value = 0.97

mat_glass = new_mat("stad_glass")
mat_glass.use_backface_culling = False
b = principled(mat_glass)
L = mat_glass.node_tree.links
t = tex_node(mat_glass, img_pal)
L.new(t.outputs["Color"], b.inputs["Base Color"])
L.new(t.outputs["Alpha"], b.inputs["Alpha"])
L.new(tex_node(mat_glass, img_pem).outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = 1.2
b.inputs["Roughness"].default_value = 0.15
for attr, val in (("blend_method", 'BLEND'), ("surface_render_method", 'BLENDED')):
    try:
        setattr(mat_glass, attr, val)
    except Exception:
        pass

mat_art = new_mat("stad_art")
b = principled(mat_art)
L = mat_art.node_tree.links
t = tex_node(mat_art, img_atlas, 'Linear')
L.new(t.outputs["Color"], b.inputs["Base Color"])
L.new(t.outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = 1.2
b.inputs["Roughness"].default_value = 0.9

mat_tile = new_mat("stad_tile")
b = principled(mat_tile)
N = mat_tile.node_tree.nodes
L = mat_tile.node_tree.links
L.new(tex_node(mat_tile, img_tb, 'Linear', 'REPEAT').outputs["Color"], b.inputs["Base Color"])
L.new(tex_node(mat_tile, img_tr, 'Linear', 'REPEAT').outputs["Color"], b.inputs["Roughness"])
L.new(tex_node(mat_tile, img_te, 'Linear', 'REPEAT').outputs["Color"], b.inputs["Emission Color"])
nm = N.new("ShaderNodeNormalMap")
nm.inputs["Strength"].default_value = 0.8
L.new(tex_node(mat_tile, img_tn, 'Linear', 'REPEAT').outputs["Color"], nm.inputs["Color"])
L.new(nm.outputs["Normal"], b.inputs["Normal"])
b.inputs["Emission Strength"].default_value = 0.8

# one material per media plate: the whole image IS the authored fallback
mat_plate = {}
for pname in ("screen_main", "screen_score", "panel_left", "panel_right"):
    m = new_mat("stad_plate_" + pname)
    bb = principled(m)
    tt = tex_node(m, load_img("plate_%s.png" % pname, "st_plate_" + pname), 'Linear')
    m.node_tree.links.new(tt.outputs["Color"], bb.inputs["Base Color"])
    m.node_tree.links.new(tt.outputs["Color"], bb.inputs["Emission Color"])
    bb.inputs["Emission Strength"].default_value = 1.0
    bb.inputs["Roughness"].default_value = 0.9
    mat_plate[pname] = m

# far impostor: a dark massing material and a glow material, nothing else
mat_far_dark = new_mat("stad_far_dark")
principled(mat_far_dark).inputs["Base Color"].default_value = (0.055, 0.05, 0.08, 1)
principled(mat_far_dark).inputs["Roughness"].default_value = 0.95
mat_far_glow = new_mat("stad_far_glow")
bb = principled(mat_far_glow)
bb.inputs["Base Color"].default_value = (0.4, 0.42, 0.5, 1)
bb.inputs["Emission Color"].default_value = (0.96, 0.97, 1.0, 1)
bb.inputs["Emission Strength"].default_value = 3.0

# ------------------------------------------------------------------ helpers
G = PMAP["grid"]
TILE_M = 2.0


def cell_uv(sw):
    c, r = PMAP["colors"][sw]["cell"]
    return ((c + 0.5) / G, 1.0 - (r + 0.5) / G)


def region_uvs(rname, mirror=False):
    S = AMAP["size"]
    x, y, w, h = AMAP["regions"][rname]
    u0, u1 = x / S, (x + w) / S
    if mirror:
        u0, u1 = u1, u0
    vt, vb = 1.0 - y / S, 1.0 - (y + h) / S
    return [(u0, vb), (u1, vb), (u1, vt), (u0, vt)]  # BL BR TR TL


FULL_UVS = [(0, 0), (1, 0), (1, 1), (0, 1)]
BOX_FACES = (("bottom", (0, 3, 2, 1)), ("top", (4, 5, 6, 7)), ("front", (0, 1, 5, 4)),
             ("right", (1, 2, 6, 5)), ("back", (2, 3, 7, 6)), ("left", (3, 0, 4, 7)))


class MB:
    """Mesh builder: world-space faces -> one object (verts relative to origin)."""

    def __init__(self, name, mats, origin=(0, 0, 0), collection=None):
        self.name, self.mats, self.origin = name, list(mats), Vector(origin)
        self.collection = collection or col
        self.verts, self.faces, self.uvs, self.midx = [], [], [], []

    def face(self, pts, uvs, mi=0):
        n = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(n, n + len(pts))))
        self.uvs.append(list(uvs))
        self.midx.append(mi)

    def box(self, mn, mx, sw, mi=0, skip=(), tile_top=False):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        uv = cell_uv(sw)
        for fname, idx in BOX_FACES:
            if fname in skip:
                continue
            pts = [v[i] for i in idx]
            if fname == "top" and tile_top:
                self.face(pts, [(p[0] / TILE_M, p[1] / TILE_M) for p in pts], 1)
            else:
                self.face(pts, [uv] * 4, mi)

    # vertical quad facing an axis direction, with proper BL BR TR TL uv order
    def quad(self, facing, at, a0, a1, z0, z1, uvs, mi=0):
        if facing == '+x':
            pts = [(at, a0, z0), (at, a1, z0), (at, a1, z1), (at, a0, z1)]
        elif facing == '-x':
            pts = [(at, a1, z0), (at, a0, z0), (at, a0, z1), (at, a1, z1)]
        elif facing == '+y':
            pts = [(a1, at, z0), (a0, at, z0), (a0, at, z1), (a1, at, z1)]
        else:  # '-y'
            pts = [(a0, at, z0), (a1, at, z0), (a1, at, z1), (a0, at, z1)]
        self.face(pts, uvs, mi)

    def finish(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([tuple(Vector(p) - self.origin) for p in self.verts], [], self.faces)
        uv = mesh.uv_layers.new(name="UVMap")
        flat = []
        for f in self.uvs:
            for (u, v) in f:
                flat.extend((u, v))
        uv.data.foreach_set("uv", flat)
        mesh.polygons.foreach_set("material_index", self.midx)
        for m in self.mats:
            mesh.materials.append(m)
        mesh.update()
        ob = bpy.data.objects.new(self.name, mesh)
        ob.location = self.origin
        self.collection.objects.link(ob)
        return ob


def empty(name, loc, parent=None, rot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    ob.location = loc
    ob.rotation_euler = rot
    ob.empty_display_size = 0.5
    if parent:
        ob.parent = parent
    col.objects.link(ob)
    return ob


# ------------------------------------------------------------------- layout
PITCH_X, PITCH_Y = 10.0, 7.5        # the 4DGSX stage tile, half extents
PLAY_X, PLAY_Y = 7.0, 4.5           # marked playing area
HOARD_X, HOARD_Y = 10.5, 8.0        # our hoardings, just outside the tile
GANG = 1.5                           # pitch-side gangway
FRONT_X, FRONT_Y = HOARD_X + GANG, HOARD_Y + GANG   # stand fronts: 12, 9.5
ROWS, ROW_D, ROW_H, TREAD = 6, 1.0, 0.5, 0.75
SEAT_W, AISLE_EVERY, AISLE_W = 0.6, 8, 1.2
BASE_H = 1.0
TOP_H = BASE_H + ROWS * ROW_H        # 4.0
REAR_GANG = 1.5
FOOT_X, FOOT_Y = 26.0, 23.0
DECK_H = 0.25                        # concourse height, like a plot floor
WALL_H = 4.0
STAND_DEPTH = ROWS * ROW_D + REAR_GANG + 0.5   # rows + rear gangway + back wall = 8.0
SEATS = []                           # exported for the walkability check
SEAT_COL = {"W": "seat_d", "E": "seat_b", "N": "seat_a", "S": "seat_c"}

# How far a sign, an advert or a trim strip stands off the surface it is
# mounted on. Not a taste decision — a depth-buffer one, and it has to clear
# TWO limits at once:
#
#   * Draco. The exporter quantizes positions over each mesh's own bounding
#     box, and the bowl is 52 m across; every offset in this file is rounded
#     to that grid on the way out. At the 14 bits this used to ship that grid
#     was 3.2 mm, so the 2 mm the hoardings, the block letters, the gate signs
#     and the crests were authored at rounded to ZERO about half the time —
#     an exactly coplanar pair the GPU has no way to order, which is what the
#     pitch-side boards were doing when they fizzed. The export below is 16
#     bits, a 0.8 mm grid, so this survives with room to spare.
#   * The depth buffer. A stadium is looked at from across itself: at 40 m,
#     with the city's 0.1 m near plane, one depth step is about a millimetre.
#     2 mm was two steps even when it did survive the encoder. 10 mm is ten,
#     and is still invisible on a 300 mm hoarding.
PROUD = 0.01

opaque = MB("stadium_bowl", [mat_voxel, mat_tile])
art = MB("stadium_signs", [mat_art])
glass = MB("stadium_glass", [mat_glass])

# ---- pitch deck, markings, hoardings ----------------------------------------
# The stage ground sits at exactly y=0 and the city ground plane at y=-0.01,
# so the turf plate tops out 5 mm under the stage and above the city floor —
# 2 cm lower and the grey city ground shows instead of the turf.
for i in range(-5, 5):
    x0 = i * 2.0
    opaque.box((x0, -PITCH_Y, -0.05), (x0 + 2.0, PITCH_Y, -0.005), "pitch" if i % 2 else "pitch_lt")
for (mn, mx) in (((-PLAY_X, -PLAY_Y), (PLAY_X, -PLAY_Y + 0.08)), ((-PLAY_X, PLAY_Y - 0.08), (PLAY_X, PLAY_Y)),
                 ((-PLAY_X, -PLAY_Y), (-PLAY_X + 0.08, PLAY_Y)), ((PLAY_X - 0.08, -PLAY_Y), (PLAY_X, PLAY_Y)),
                 ((-0.04, -PLAY_Y), (0.04, PLAY_Y))):
    opaque.box((mn[0], mn[1], -0.03), (mx[0], mx[1], -0.002), "e_white_soft")
for k in range(24):   # centre circle
    a0, a1 = 2 * math.pi * k / 24, 2 * math.pi * (k + 1) / 24
    r = 1.8
    x0, y0 = r * math.cos(a0), r * math.sin(a0)
    x1, y1 = r * math.cos(a1), r * math.sin(a1)
    opaque.box((min(x0, x1) - 0.04, min(y0, y1) - 0.04, -0.03), (max(x0, x1) + 0.04, max(y0, y1) + 0.04, -0.002), "e_white_soft")
# apron between the tile and the hoardings, and the gangway ring
opaque.box((-HOARD_X, -HOARD_Y, -0.05), (HOARD_X, HOARD_Y, 0.0), "apron", skip=("top",))
opaque.box((-HOARD_X, -HOARD_Y, -0.02), (-PITCH_X, HOARD_Y, 0.0), "apron")
opaque.box((PITCH_X, -HOARD_Y, -0.02), (HOARD_X, HOARD_Y, 0.0), "apron")
opaque.box((-PITCH_X, -HOARD_Y, -0.02), (PITCH_X, -PITCH_Y, 0.0), "apron")
opaque.box((-PITCH_X, PITCH_Y, -0.02), (PITCH_X, HOARD_Y, 0.0), "apron")
INNER_X, INNER_Y = FRONT_X + STAND_DEPTH, FRONT_Y + STAND_DEPTH   # 20, 17.5: the stands' outer line
opaque.box((-INNER_X, -INNER_Y, -0.05), (INNER_X, INNER_Y, 0.0), "deck", skip=("top",))
# corner squares between the stands, at gangway level
for (mn, mx) in (((-INNER_X, -INNER_Y), (-FRONT_X, -FRONT_Y)), ((FRONT_X, -INNER_Y), (INNER_X, -FRONT_Y)),
                 ((-INNER_X, FRONT_Y), (-FRONT_X, INNER_Y)), ((FRONT_X, FRONT_Y), (INNER_X, INNER_Y))):
    opaque.box((mn[0], mn[1], -0.02), (mx[0], mx[1], 0.0), "deck")
for (mn, mx) in (((-FRONT_X, -FRONT_Y), (-HOARD_X, FRONT_Y)), ((HOARD_X, -FRONT_Y), (FRONT_X, FRONT_Y)),
                 ((-HOARD_X, -FRONT_Y), (HOARD_X, -HOARD_Y)), ((-HOARD_X, HOARD_Y), (HOARD_X, FRONT_Y))):
    opaque.box((mn[0], mn[1], -0.02), (mx[0], mx[1], 0.0), "deck")
# hoardings: 0.9 m boards facing the pitch, advert strips from the atlas
BOARD_H = 0.9
boards = ["board_1", "board_2", "board_3", "board_4"]
def hoarding(facing, at, a0, a1, name_i):
    n = int((a1 - a0) / 5.0)
    step = (a1 - a0) / n
    for k in range(n):
        s0 = a0 + k * step
        if facing in ('+x', '-x'):
            mn, mx = ((at - 0.15, s0, 0.0), (at + 0.15, s0 + step, BOARD_H)) if True else None
        else:
            mn, mx = ((s0, at - 0.15, 0.0), (s0 + step, at + 0.15, BOARD_H))
        opaque.box(mn, mx, "board")
        inner = at - (0.15 + PROUD) if facing == '-x' or facing == '-y' else at + (0.15 + PROUD)
        art.quad(facing, inner, s0 + 0.05, s0 + step - 0.05, 0.08, BOARD_H - 0.08,
                 region_uvs(boards[(name_i + k) % 4]))
hoarding('-x', HOARD_X, -HOARD_Y, HOARD_Y, 0)      # east boards face the pitch (-x)
hoarding('+x', -HOARD_X, -HOARD_Y, HOARD_Y, 1)
hoarding('-y', HOARD_Y, -HOARD_X, HOARD_X, 2)
hoarding('+y', -HOARD_Y, -HOARD_X, HOARD_X, 3)

# ---- concourse deck (tile-topped), with the pitch/gangway rectangle cut out --
for (mn, mx) in (((-FOOT_X, -FOOT_Y), (-INNER_X, FOOT_Y)), ((INNER_X, -FOOT_Y), (FOOT_X, FOOT_Y)),
                 ((-INNER_X, -FOOT_Y), (INNER_X, -INNER_Y)), ((-INNER_X, INNER_Y), (INNER_X, FOOT_Y))):
    opaque.box((mn[0], mn[1], 0.0), (mx[0], mx[1], DECK_H), "concourse", tile_top=True, skip=("bottom",))


# ---- stands -----------------------------------------------------------------
def stand(side):
    """One terrace block. side in W/E/N/S (world compass; N is Blender -y)."""
    axis = 'x' if side in ('W', 'E') else 'y'
    sign = -1 if side in ('W', 'N') else 1          # which way the rows recede
    front = FRONT_X if axis == 'x' else FRONT_Y
    # 1.5 m short of the ring at each end: the corner squares then open onto
    # the pitch-side gangway with a real passage instead of a single point
    length = 2 * (FRONT_Y if axis == 'x' else FRONT_X) - 3.0   # 16 or 21 m along the stand
    half = length / 2
    facing = {'W': '+x', 'E': '-x', 'N': '+y', 'S': '-y'}[side]
    col_name = "col_stand_" + side.lower()
    cmesh = MB(col_name, [mat_voxel])
    seat_sw = SEAT_COL[side]

    def B(d0, d1, a0, a1, z0, z1, sw, mesh=opaque, tile=False, skip=()):
        """box spanning depth d0..d1 (outward from the front line) and along a0..a1."""
        lo, hi = front + min(d0, d1), front + max(d0, d1)
        if axis == 'x':
            mn = (sign * hi if sign < 0 else sign * lo, a0, z0)
            mx = (sign * lo if sign < 0 else sign * hi, a1, z1)
        else:
            mn = (a0, sign * hi if sign < 0 else sign * lo, z0)
            mx = (a1, sign * lo if sign < 0 else sign * hi, z1)
        mesh.box(mn, mx, sw, tile_top=tile, skip=skip)

    # Where the aisles fall, walked exactly as the seat loop walks them.
    def aisle_spans():
        spans = []
        a = -half + 0.2
        n = 0
        while a + SEAT_W <= half - 0.2:
            n += 1
            if n % (AISLE_EVERY + 1) == 0:
                spans.append((a, a + AISLE_W))
                a += AISLE_W
                continue
            a += SEAT_W
        return spans
    AISLES = aisle_spans()

    # front wall from the gangway up to the first row, and the terrace body
    B(0, 0.5, -half, half, 0.0, BASE_H, "wall")
    for r in range(ROWS):
        z = BASE_H + r * ROW_H
        # The bottom row starts BEHIND the front wall, not on top of it. Run it
        # from depth 0 and its front face lands in the wall's front plane and
        # its top in the wall's top plane, same side out — two pairs of exactly
        # coplanar faces, the full 16 m length of all four stands, and no way
        # for the GPU to order them. That was the fizz along the stand fronts
        # and the base kerb, and it is the whole of what a visitor could see
        # of this defect: everything else the bowl doubles up is buried inside
        # another box. Every other row meets its neighbours edge to edge.
        d0 = r * ROW_D
        B(0.5 if r == 0 else d0, d0 + TREAD, -half, half, z - 0.5 if r == 0 else z - ROW_H, z, "terrace")
        B(d0 + TREAD, d0 + ROW_D, -half, half, z - ROW_H, z + 0.25, "riser")          # the half step
        # The half step is 0.25 m DEEP, and an avatar has a 0.28 m radius: it
        # could never stand on one, so the next row's face always blocked it
        # and the terrace could be walked down but never up. In the aisles —
        # the way up a real stand — the half step is carried forward to 0.5 m,
        # which makes each row two ordinary 0.25 m steps.
        for (aa0, aa1) in AISLES:
            B(d0 + TREAD - 0.25, d0 + TREAD, aa0, aa1, z, z + 0.25, "riser")
            B(d0 + TREAD - 0.25, d0 + TREAD, aa0, aa1, z, z + 0.25, "ink", mesh=cmesh)
        # seats along the tread, with aisles
        a = -half + 0.2
        n = 0
        while a + SEAT_W <= half - 0.2:
            n += 1
            if n % (AISLE_EVERY + 1) == 0:
                a += AISLE_W                      # an aisle: no seat, the step stays open
                continue
            B(d0 + TREAD - 0.12, d0 + TREAD, a + 0.08, a + SEAT_W - 0.08, z, z + 0.45, seat_sw)   # seat back
            B(d0 + 0.42, d0 + TREAD - 0.12, a + 0.08, a + SEAT_W - 0.08, z, z + 0.12, "seat_dk")   # squab
            # the seat cell centre, in client (glTF) coordinates
            d_c = d0 + 0.3
            if axis == 'x':
                px, py = sign * (front + d_c), a + SEAT_W / 2
            else:
                px, py = a + SEAT_W / 2, sign * (front + d_c)
            SEATS.append([round(px, 2), round(z, 2), round(-py, 2)])
            a += SEAT_W
    # rear gangway at the top, parapet behind it, block letter on the back wall
    B(ROWS * ROW_D, ROWS * ROW_D + REAR_GANG, -half, half, TOP_H - 0.5, TOP_H, "terrace")
    # back wall in two parts, leaving the doorway from the rear stair open
    n_steps_ = int(round((TOP_H - DECK_H) / 0.25))
    door0 = -(n_steps_ * 0.5) / 2 + n_steps_ * 0.5
    B(ROWS * ROW_D + REAR_GANG, STAND_DEPTH, -half, door0, 0.0, TOP_H + 1.1, "wall")
    B(ROWS * ROW_D + REAR_GANG, STAND_DEPTH, door0 + 1.5, half, 0.0, TOP_H + 1.1, "wall")
    B(ROWS * ROW_D + REAR_GANG, STAND_DEPTH, door0, door0 + 1.5, 0.0, TOP_H, "wall")          # floor under the doorway
    B(ROWS * ROW_D + REAR_GANG, STAND_DEPTH, door0, door0 + 1.5, TOP_H + 2.3, TOP_H + 1.1 + 2.3, "wall")   # (lintel above head height)
    # the parapet's light strip stops at the doorway: drawn across it, it was
    # a bar at chest height in the one opening people walk through — and
    # decoration, so they walked through that too
    B(ROWS * ROW_D + REAR_GANG - 0.1, ROWS * ROW_D + REAR_GANG, -half, door0, TOP_H + 1.05, TOP_H + 1.15, "e_cyan_dim")
    B(ROWS * ROW_D + REAR_GANG - 0.1, ROWS * ROW_D + REAR_GANG, door0 + 1.5, half, TOP_H + 1.05, TOP_H + 1.15, "e_cyan_dim")
    # underside/back of the terrace, so the stand reads as a solid raised block
    B(0.5, ROWS * ROW_D, -half, half, 0.0, BASE_H - 0.5, "wall_lt")
    # side walls close the ends
    for end in (-half, half):
        if axis == 'x':
            mn = (min(sign * front, sign * (front + STAND_DEPTH)), end - 0.25 if end < 0 else end, 0.0)
            mx = (max(sign * front, sign * (front + STAND_DEPTH)), end if end < 0 else end + 0.25, TOP_H + 1.1)
        else:
            mn = (end - 0.25 if end < 0 else end, min(sign * front, sign * (front + STAND_DEPTH)), 0.0)
            mx = (end if end < 0 else end + 0.25, max(sign * front, sign * (front + STAND_DEPTH)), TOP_H + 1.1)
        opaque.box(mn, mx, "wall")
    # block letter facing the concourse on the back wall
    letter_at = sign * (front + STAND_DEPTH) + sign * PROUD
    back_facing = {'W': '-x', 'E': '+x', 'N': '-y', 'S': '+y'}[side]
    art.quad(back_facing, letter_at, -1.5, 1.5, 1.2, 4.2, region_uvs("block_" + side))
    # rear stair along the back wall: from the concourse up to the rear gangway
    n_steps = int(round((TOP_H - DECK_H) / 0.25))     # 15
    run = 0.5
    s_len = n_steps * run                               # 7.5 m
    a_start = -s_len / 2
    for k in range(n_steps):
        z = DECK_H + (k + 1) * 0.25
        a0 = a_start + k * run
        B(STAND_DEPTH, STAND_DEPTH + 1.5, a0, a0 + run, DECK_H, z, "step")
        B(STAND_DEPTH, STAND_DEPTH + 1.5, a0, a0 + run, DECK_H, z, "step", mesh=cmesh)
    # landing and the opening in the back wall onto the rear gangway
    B(STAND_DEPTH, STAND_DEPTH + 1.5, a_start + s_len, a_start + s_len + 1.5, DECK_H, TOP_H, "step")
    B(STAND_DEPTH, STAND_DEPTH + 1.5, a_start + s_len, a_start + s_len + 1.5, DECK_H, TOP_H, "step", mesh=cmesh)
    B(STAND_DEPTH - 0.06, STAND_DEPTH, a_start + s_len - 0.12, a_start + s_len, TOP_H, TOP_H + 2.3, "e_cyan_dim")   # doorway jamb lights
    B(STAND_DEPTH - 0.06, STAND_DEPTH, a_start + s_len + 1.5, a_start + s_len + 1.62, TOP_H, TOP_H + 2.3, "e_cyan_dim")
    # A balustrade, not a wall: 1.05 m above each tread, stepping with the
    # stair. As a solid slab it hid the stair and the block letter behind it
    # from anyone walking in through the gate.
    for k in range(n_steps):
        z = DECK_H + (k + 1) * 0.25
        a0 = a_start + k * run
        B(STAND_DEPTH + 1.5, STAND_DEPTH + 1.7, a0, a0 + run, z, z + 1.05, "rail")
        B(STAND_DEPTH + 1.5, STAND_DEPTH + 1.7, a0, a0 + run, z + 1.05, z + 1.11, "e_cyan_dim")
    B(STAND_DEPTH + 1.5, STAND_DEPTH + 1.7, a_start + s_len, a_start + s_len + 1.5, TOP_H, TOP_H + 1.05, "rail")
    B(STAND_DEPTH + 1.5, STAND_DEPTH + 1.7, a_start + s_len, a_start + s_len + 1.5, TOP_H + 1.05, TOP_H + 1.11, "e_cyan_dim")
    # ---- collision proxy: treads, half steps, seat-back walls with aisle gaps, walls
    B(0, 0.5, -half, half, 0.0, BASE_H, "ink", mesh=cmesh)
    for r in range(ROWS):
        z = BASE_H + r * ROW_H
        d0 = r * ROW_D
        B(d0, d0 + TREAD, -half, half, z - 0.5, z, "ink", mesh=cmesh)
        B(d0 + TREAD, d0 + ROW_D, -half, half, z - 0.5, z + 0.25, "ink", mesh=cmesh)
        a = -half + 0.2
        n = 0
        seg_start = a
        while a + SEAT_W <= half - 0.2:
            n += 1
            if n % (AISLE_EVERY + 1) == 0:
                if a > seg_start:
                    B(d0 + TREAD - 0.12, d0 + TREAD, seg_start, a, z, z + 0.45, "ink", mesh=cmesh)
                a += AISLE_W
                seg_start = a
                continue
            a += SEAT_W
        if a > seg_start:
            B(d0 + TREAD - 0.12, d0 + TREAD, seg_start, a, z, z + 0.45, "ink", mesh=cmesh)
    B(ROWS * ROW_D, ROWS * ROW_D + REAR_GANG, -half, half, TOP_H - 0.5, TOP_H, "ink", mesh=cmesh)
    B(ROWS * ROW_D + REAR_GANG, STAND_DEPTH, -half, a_start + s_len, 0.0, TOP_H + 1.1, "ink", mesh=cmesh)
    B(ROWS * ROW_D + REAR_GANG, STAND_DEPTH, a_start + s_len + 1.5, half, 0.0, TOP_H + 1.1, "ink", mesh=cmesh)
    B(ROWS * ROW_D + REAR_GANG, STAND_DEPTH, a_start + s_len, a_start + s_len + 1.5, 0.0, TOP_H, "ink", mesh=cmesh)   # doorway floor
    B(STAND_DEPTH + 1.5, STAND_DEPTH + 1.7, a_start, a_start + s_len + 1.5, DECK_H, TOP_H + 1.0, "ink", mesh=cmesh)
    for end in (-half, half):
        if axis == 'x':
            mn = (min(sign * front, sign * (front + STAND_DEPTH)), end - 0.25 if end < 0 else end, 0.0)
            mx = (max(sign * front, sign * (front + STAND_DEPTH)), end if end < 0 else end + 0.25, TOP_H + 1.1)
        else:
            mn = (end - 0.25 if end < 0 else end, min(sign * front, sign * (front + STAND_DEPTH)), 0.0)
            mx = (end if end < 0 else end + 0.25, max(sign * front, sign * (front + STAND_DEPTH)), TOP_H + 1.1)
        cmesh.box(mn, mx, "ink")
    cmesh.finish()


for s in ("W", "E", "N", "S"):
    stand(s)

# ---- gates + outer wall ----------------------------------------------------------
GATE_W, GATE_H = 4.0, 3.2
wall_col = MB("col_walls", [mat_voxel])
for m in (opaque, wall_col):
    sw = "wall" if m is opaque else "ink"
    # west and east walls with the gate openings
    for x0, x1 in ((-FOOT_X, -FOOT_X + 0.5), (FOOT_X - 0.5, FOOT_X)):
        m.box((x0, -FOOT_Y, 0.0), (x1, -GATE_W / 2, WALL_H), sw)
        m.box((x0, GATE_W / 2, 0.0), (x1, FOOT_Y, WALL_H), sw)
        m.box((x0, -GATE_W / 2, GATE_H), (x1, GATE_W / 2, WALL_H), sw)     # lintel
    m.box((-FOOT_X, -FOOT_Y, 0.0), (FOOT_X, -FOOT_Y + 0.5, WALL_H), sw)
    m.box((-FOOT_X, FOOT_Y - 0.5, 0.0), (FOOT_X, FOOT_Y, WALL_H), sw)
wall_col.finish()
# The wall is 4 m of unlit dark box seen from 60 m away, which read as a black
# slab from the roundabout. Pilasters on the lot pitch and a dim band give it
# a rhythm and a silhouette at night.
for wx in [v * 6.0 for v in range(-4, 5)]:
    for y0, face in ((-FOOT_Y, -0.02), (FOOT_Y - 0.5, 0.52)):
        opaque.box((wx - 0.35, y0 + face, 0.0), (wx + 0.35, y0 + face + 0.02, WALL_H - 0.6), "wall_lt")
        opaque.box((wx - 0.12, y0 + face - 0.01, 0.6), (wx + 0.12, y0 + face + 0.03, WALL_H - 1.0), "e_cyan_dim")
for wy in [v * 6.0 for v in range(-3, 4)]:
    # A pilaster on the wall's rhythm at wy = 0 stands in the middle of the
    # GATE, where there is no wall to pilaster: it read as a column in the
    # doorway that stayed put when the doors slid apart, and being decoration
    # it had no collision, so visitors walked through it.
    if abs(wy) < GATE_W / 2 + 0.4:
        continue
    for x0, face in ((-FOOT_X, -0.02), (FOOT_X - 0.5, 0.52)):
        opaque.box((x0 + face, wy - 0.35, 0.0), (x0 + face + 0.02, wy + 0.35, WALL_H - 0.6), "wall_lt")
        opaque.box((x0 + face - 0.01, wy - 0.12, 0.6), (x0 + face + 0.03, wy + 0.12, WALL_H - 1.0), "e_cyan_dim")

# wall trims and corner pylons
for x0, x1 in ((-FOOT_X, -FOOT_X + 0.5), (FOOT_X - 0.5, FOOT_X)):
    opaque.box((x0 + 0.2, -FOOT_Y, WALL_H), (x0 + 0.3, FOOT_Y, WALL_H + 0.1), "e_cyan_dim")
for y0 in (-FOOT_Y, FOOT_Y - 0.5):
    opaque.box((-FOOT_X, y0 + 0.2, WALL_H), (FOOT_X, y0 + 0.3, WALL_H + 0.1), "e_cyan_dim")
for sx in (-1, 1):
    for sy in (-1, 1):
        cx, cy = sx * (FOOT_X - 0.5), sy * (FOOT_Y - 0.5)
        opaque.box((cx - 0.5, cy - 0.5, 0.0), (cx + 0.5, cy + 0.5, WALL_H + 1.5), "pier")
        opaque.box((cx - 0.3, cy - 0.3, WALL_H + 1.5), (cx + 0.3, cy + 0.3, WALL_H + 1.7), "e_cyan_soft")

# gate signs above each gate, and the main sign over the west gate
for x_face, facing, sign_r in ((-FOOT_X - PROUD, '-x', "sign_gate_w"), (FOOT_X + PROUD, '+x', "sign_gate_e")):
    art.quad(facing, x_face, -2.0, 2.0, GATE_H + 0.1, GATE_H + 0.1 + 1.25, region_uvs(sign_r))
opaque.box((-FOOT_X + 0.1, -6.2, WALL_H), (-FOOT_X + 0.4, -5.9, WALL_H + 3.2), "steel")
opaque.box((-FOOT_X + 0.1, 5.9, WALL_H), (-FOOT_X + 0.4, 6.2, WALL_H + 3.2), "steel")
opaque.box((-FOOT_X + 0.05, -6.1, WALL_H + 0.5), (-FOOT_X + 0.45, 6.1, WALL_H + 2.75), "board")
art.quad('-x', -FOOT_X + 0.05 - PROUD, -6.0, 6.0, WALL_H + 0.6, WALL_H + 0.6 + 2.25, region_uvs("sign_main"))
# The stair sign belongs at the stair, on the wall a visitor walks toward:
# each side stand's back wall, clear of the balustrade, facing its gate.
for (wall_x, facing, sgn) in ((-(FRONT_X + STAND_DEPTH) - 0.01, '-x', -1), ((FRONT_X + STAND_DEPTH) + 0.01, '+x', 1)):
    a0, a1 = sorted((sgn * 6.0, sgn * 8.5))
    art.quad(facing, wall_x, a0, a1, DECK_H + 1.5, DECK_H + 1.5 + 0.78, region_uvs("sign_steps"))

# gate panels: sliding glass on a pivot rotated so the panel's local X runs
# along the wall (the door system slides panels in local X)
for gid, gx in (("w", -FOOT_X + 0.25), ("e", FOOT_X - 0.25)):
    pivot = empty("gate_%s_root" % gid, (gx, 0.0, 0.0), rot=(0, 0, math.pi / 2))
    for pname, sgn in (("L", -1), ("R", 1)):
        pm = MB("gate_%s_%s" % (gid, pname), [mat_glass, mat_voxel], origin=(0, 0, 0))
        # local frame: X along the wall (Blender Y after the pivot's 90°), so
        # build the panel along local +X/-X with a thin frame
        a0, a1 = (0.02, GATE_W / 2) if sgn > 0 else (-GATE_W / 2, -0.02)
        pm.box((a0, -0.06, 0.05), (a1, 0.06, GATE_H - 0.05), "glass_gate")
        pm.box((a0, -0.08, 0.0), (a1, 0.08, 0.12), "steel", mi=1)
        pm.box((a0, -0.08, GATE_H - 0.12), (a1, 0.08, GATE_H), "steel", mi=1)
        ob = pm.finish()
        ob.parent = pivot
        ob.matrix_parent_inverse.identity()

# ---- floodlight masts + spots + far impostor ------------------------------------
far = MB("far_mass", [mat_far_dark], collection=far_col)
far_glow = MB("far_glow", [mat_far_glow], collection=far_col)
mast_col = MB("col_masts", [mat_voxel])
MAST_H = 17.0
for sx in (-1, 1):
    for sy in (-1, 1):
        mx, my = sx * 22.0, sy * 19.0
        opaque.box((mx - 0.6, my - 0.6, DECK_H), (mx + 0.6, my + 0.6, 1.2), "mast_dk")
        for (ox, oy) in ((-0.35, -0.35), (0.35, -0.35), (0.35, 0.35), (-0.35, 0.35)):
            opaque.box((mx + ox - 0.1, my + oy - 0.1, 1.2), (mx + ox + 0.1, my + oy + 0.1, MAST_H), "mast")
        for z in range(3, int(MAST_H), 3):
            opaque.box((mx - 0.45, my - 0.45, z), (mx + 0.45, my + 0.45, z + 0.12), "steel_dk")
        # head: a bank of lamps on a bracket leaning toward the pitch
        hx, hy = mx - sx * 0.9, my - sy * 0.9
        opaque.box((hx - 1.6, hy - 0.35, MAST_H - 0.2), (hx + 1.6, hy + 0.35, MAST_H + 0.15), "steel")
        for i in range(-2, 3):
            for j in range(2):
                opaque.box((hx + i * 0.6 - 0.22, hy - 0.3, MAST_H + 0.2 + j * 0.55), (hx + i * 0.6 + 0.22, hy + 0.3, MAST_H + 0.65 + j * 0.55), "e_flood")
        opaque.box((mx - 0.12, my - 0.12, MAST_H + 1.4), (mx + 0.12, my + 0.12, MAST_H + 1.7), "e_red")
        mast_col.box((mx - 0.6, my - 0.6, DECK_H), (mx + 0.6, my + 0.6, 3.0), "ink")
        # far impostor: post + glowing head
        far.box((mx - 0.5, my - 0.5, 0.0), (mx + 0.5, my + 0.5, MAST_H), "ink")
        far_glow.box((hx - 1.6, hy - 0.35, MAST_H + 0.1), (hx + 1.6, hy + 0.35, MAST_H + 1.3), "ink")
        # the spot itself
        ld = bpy.data.lights.new("flood_%s%s" % ("e" if sx > 0 else "w", "s" if sy > 0 else "n"), 'SPOT')
        ld.color = (0.93, 0.95, 1.0)
        # the client scales glTF candela by 0.0055 and caps the venue total; a
        # floodlight 25 m from the turf needs thousands of candela to light
        # the city's very dark albedos, so these watts are large on purpose
        ld.energy = 5500.0
        ld.spot_size = math.radians(92)
        ld.spot_blend = 0.55
        ld.use_custom_distance = True
        ld.cutoff_distance = 80.0
        lob = bpy.data.objects.new(ld.name, ld)
        lob.location = (hx, hy, MAST_H + 0.4)
        lob.rotation_euler = (Vector((0, 0, 0)) - Vector(lob.location)).to_track_quat('-Z', 'Y').to_euler()
        col.objects.link(lob)
mast_col.finish()
# far impostor massing: the four stands and the outer walls as dark blocks
for side in ("W", "E", "N", "S"):
    axis = 'x' if side in ('W', 'E') else 'y'
    sign = -1 if side in ('W', 'N') else 1
    front = FRONT_X if axis == 'x' else FRONT_Y
    half = (FRONT_Y if axis == 'x' else FRONT_X) - 1.5
    lo, hi = front, front + STAND_DEPTH
    if axis == 'x':
        far.box((min(sign * lo, sign * hi), -half, 0.0), (max(sign * lo, sign * hi), half, TOP_H + 1.1), "ink")
    else:
        far.box((-half, min(sign * lo, sign * hi), 0.0), (half, max(sign * lo, sign * hi), TOP_H + 1.1), "ink")
# The impostor is what the boulevard sees: four glowing heads alone read as
# dots, so the wall carries its lit top edge too — a stadium's shape.
for (mn, mx) in (((-FOOT_X, -FOOT_Y), (FOOT_X, -FOOT_Y + 0.5)), ((-FOOT_X, FOOT_Y - 0.5), (FOOT_X, FOOT_Y)),
                 ((-FOOT_X, -FOOT_Y), (-FOOT_X + 0.5, FOOT_Y)), ((FOOT_X - 0.5, -FOOT_Y), (FOOT_X, FOOT_Y))):
    far_glow.box((mn[0], mn[1], WALL_H - 0.12), (mx[0], mx[1], WALL_H), "ink")
far.box((-FOOT_X, -FOOT_Y, 0.0), (FOOT_X, -FOOT_Y + 0.5, WALL_H), "ink")
far.box((-FOOT_X, FOOT_Y - 0.5, 0.0), (FOOT_X, FOOT_Y, WALL_H), "ink")
far.box((-FOOT_X, -FOOT_Y, 0.0), (-FOOT_X + 0.5, FOOT_Y, WALL_H), "ink")
far.box((FOOT_X - 0.5, -FOOT_Y, 0.0), (FOOT_X, FOOT_Y, WALL_H), "ink")
far.finish()
far_glow.finish()

# ---- screens, panels, tannoy, pitch origin ----------------------------------------
# the big screen and the two dock panels rise above the NORTH stand (Blender -y);
# the scoreboard faces it from the SOUTH stand. All face the pitch.
SCR_W, SCR_H = 9.6, 5.4
PAN_W, PAN_H = 3.4, 5.0
north_back = -(FRONT_Y + STAND_DEPTH)          # -17.5
south_back = FRONT_Y + STAND_DEPTH
def screen_frame(y_back, facing_sign, cx, w, h, z0):
    # a steel frame on legs behind the plate, legs down to the rear gangway
    yb = y_back + facing_sign * 0.6
    for lx in (cx - w / 2 + 0.3, cx + w / 2 - 0.3):
        opaque.box((lx - 0.15, yb - 0.15, TOP_H - 0.5), (lx + 0.15, yb + 0.15, z0 + h + 0.3), "steel")
    opaque.box((cx - w / 2 - 0.2, yb - 0.25, z0 - 0.2), (cx + w / 2 + 0.2, yb + 0.25, z0 + h + 0.2), "board")
    opaque.box((cx - w / 2 - 0.25, yb - 0.3, z0 + h + 0.2), (cx + w / 2 + 0.25, yb + 0.3, z0 + h + 0.32), "e_cyan_dim")
    return yb + facing_sign * (0.25 + PROUD)

z_scr = TOP_H + 1.6
y_face = screen_frame(north_back, 1, 0.0, SCR_W, SCR_H, z_scr)
pl = MB("screen_main", [mat_plate["screen_main"]])
pl.quad('+y', y_face, -SCR_W / 2, SCR_W / 2, z_scr, z_scr + SCR_H, FULL_UVS)
pl.finish()
for pname, cx in (("panel_left", -SCR_W / 2 - 0.6 - PAN_W / 2), ("panel_right", SCR_W / 2 + 0.6 + PAN_W / 2)):
    yf = screen_frame(north_back, 1, cx, PAN_W, PAN_H, z_scr + 0.2)
    pm = MB(pname, [mat_plate[pname]])
    pm.quad('+y', yf, cx - PAN_W / 2, cx + PAN_W / 2, z_scr + 0.2, z_scr + 0.2 + PAN_H, FULL_UVS)
    pm.finish()
y_face_s = screen_frame(south_back, -1, 0.0, SCR_W, SCR_H, z_scr)
sc = MB("screen_score", [mat_plate["screen_score"]])
sc.quad('-y', y_face_s, -SCR_W / 2, SCR_W / 2, z_scr, z_scr + SCR_H, FULL_UVS)
sc.finish()
# tannoy horns on the screen frames (where commentary is placed)
for (x, y) in ((-3.0, south_back - 0.6), (3.0, south_back - 0.6)):
    opaque.box((x - 0.3, y - 0.3, z_scr + SCR_H + 0.4), (x + 0.3, y + 0.3, z_scr + SCR_H + 0.9), "steel_dk")
empty("pitch_origin", (0.0, 0.0, 0.0))
empty("attribution_anchor", (0.0, -9.0, 1.2))

# RFL crests on the mast bases facing the pitch
for sx in (-1, 1):
    for sy in (-1, 1):
        mx, my = sx * 22.0, sy * 19.0
        facing = '-x' if sx > 0 else '+x'
        at = mx - sx * (0.6 + PROUD)
        art.quad(facing, at, my - 0.5, my + 0.5, DECK_H + 0.1, DECK_H + 1.1, region_uvs("crest"))

# ---- concourse lighting: two warm points at the gates ----------------------------------
for gx in (-FOOT_X + 3.0, FOOT_X - 3.0):
    ld = bpy.data.lights.new("gate_light_%s" % ("w" if gx < 0 else "e"), 'POINT')
    ld.color = (1.0, 0.85, 0.7)
    ld.energy = 60.0
    ld.shadow_soft_size = 0.5
    lob = bpy.data.objects.new(ld.name, ld)
    lob.location = (gx, 0.0, 4.0)
    col.objects.link(lob)
# gate lamp fixtures (visual)
for gx in (-FOOT_X + 0.5, FOOT_X - 0.5):
    for gy in (-2.6, 2.6):
        opaque.box((gx - 0.2, gy - 0.2, GATE_H + 0.2), (gx + 0.2, gy + 0.2, GATE_H + 0.5), "e_warm_soft")

# concourse floor + bowl proxy (the deck is walkable; the pitch is not reachable)
deck_col = MB("col_deck", [mat_voxel])
for (mn, mx) in (((-FOOT_X, -FOOT_Y), (-INNER_X, FOOT_Y)), ((INNER_X, -FOOT_Y), (FOOT_X, FOOT_Y)),
                 ((-INNER_X, -FOOT_Y), (INNER_X, -INNER_Y)), ((-INNER_X, INNER_Y), (INNER_X, FOOT_Y))):
    deck_col.box((mn[0], mn[1], 0.0), (mx[0], mx[1], DECK_H), "ink")
deck_col.box((-INNER_X, -INNER_Y, -0.05), (INNER_X, INNER_Y, 0.0), "ink")       # gangway, corners, pitch deck
deck_col.box((-HOARD_X - 0.15, -HOARD_Y - 0.15, 0.0), (HOARD_X + 0.15, HOARD_Y + 0.15, BOARD_H), "ink")   # hoardings as a wall
deck_col.finish()

opaque.finish()
art.finish()
glass_ob = glass.finish() if glass.verts else None

# --------------------------------------------------------------------- stats
bpy.context.view_layer.update()
tot, mn, mx = 0, [9e9] * 3, [-9e9] * 3
n_mesh = 0
for o in col.objects:
    if o.type != 'MESH':
        continue
    n_mesh += 1
    o.data.calc_loop_triangles()
    tot += len(o.data.loop_triangles)
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
print("BUILD OK in %.1fs" % (time.time() - T0))
print("objects:", n_mesh, "meshes;", sorted(o.name for o in col.objects))
print("triangles:", tot, "seats:", len(SEATS))
print("bbox min:", [round(v, 3) for v in mn], "max:", [round(v, 3) for v in mx])
json.dump({"seats": SEATS, "triangles": tot, "bbox": [mn, mx], "meshes": n_mesh},
          open(os.path.join(OUT_DIR, "build.json"), "w"))

# ------------------------------------------------------------------- render
if DO_RENDER:
    rcol = bpy.data.collections.new("RENDER_ONLY")
    scene.collection.children.link(rcol)
    gm = bpy.data.meshes.new("ground")
    gm.from_pydata([(-120, -120, -0.02), (120, -120, -0.02), (120, 120, -0.02), (-120, 120, -0.02)], [], [(0, 1, 2, 3)])
    gmat = bpy.data.materials.new("stad_ground")
    gmat.use_nodes = True
    principled(gmat).inputs["Base Color"].default_value = (0.07, 0.065, 0.09, 1)
    gm.materials.append(gmat)
    gob = bpy.data.objects.new("ground", gm)
    rcol.objects.link(gob)
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, "SCENE_OT_render") and 'BLENDER_EEVEE_NEXT' in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1440, 810
    scene.render.image_settings.file_format = 'PNG'
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.02, 0.015, 0.04, 1)
        bg.inputs[1].default_value = 0.4
    cam_d = bpy.data.cameras.new("stad_cam")
    cam = bpy.data.objects.new("stad_cam", cam_d)
    rcol.objects.link(cam)
    scene.camera = cam
    views = {"overview": ((-62, -48, 26), (0, 0, 2)), "gate": ((-40, -6, 3), (-20, 0, 4)),
             "stand": ((-8, 20, 5), (0, -6, 2)), "pitchside": ((-11, 9, 1.6), (4, -2, 1))}
    for shot in SHOTS:
        loc, tgt = views.get(shot, views["overview"])
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT_DIR, "render_%s.png" % shot)
        bpy.ops.render.render(write_still=True)
        print("rendered", shot)

# ------------------------------------------------------------------- export
def export(collection, path, lights):
    bpy.ops.object.select_all(action='DESELECT')
    for o in collection.objects:
        o.select_set(True)
    avail = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {"filepath": path, "export_format": 'GLB'}
    optional = {
        "use_selection": True, "export_apply": True, "export_yup": True, "export_lights": lights,
        "export_cameras": False, "export_extras": False, "export_animations": False,
        "export_skins": False, "export_morph": False, "export_image_format": 'AUTO',
        "export_draco_mesh_compression_enable": True, "export_draco_mesh_compression_level": 6,
        "export_draco_position_quantization": 16, "export_draco_texcoord_quantization": 12,
        "export_unused_images": False, "export_unused_textures": False,
    }
    for k, v in optional.items():
        if k in avail:
            kwargs[k] = v
    bpy.ops.export_scene.gltf(**kwargs)
    print("exported:", path, os.path.getsize(path), "bytes")


if DO_EXPORT:
    export(col, os.path.join(VENUE_DIR, "venue.glb"), True)
    export(far_col, os.path.join(VENUE_DIR, "far.glb"), False)
print("DONE in %.1fs" % (time.time() - T0))
