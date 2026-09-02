# OTRA CITY HALL — the platform's own plot for the otra.city standard lot
# (10 x 10 x 6 m, front = -Y). Runs inside Blender through the BlenderMCP
# bridge; idempotent (rebuilds the CityHall collection from scratch).
#
# Technique notes:
#   * sparse voxel grids (0.25 m structure, finer details) meshed with only
#     the exposed faces -> big forms (dome, drum, podium) stay cheap
#   * 4 materials, each a full PBR stack: voxel palette (base + emissive
#     textures in ONE material), alpha-blended palette (glass + holograms),
#     art atlas (base + emissive), tiled floor (base + normal + roughness +
#     emissive, REPEAT wrap)
#   * media nodes (pic_1..6, screen_1/2, panel_live, link_1/2) + 8 anims
#   * lights are export-normalized by the client (x0.0055, cap 30 total)
import json
import math
import os
import random
import time

import bpy
from mathutils import Vector

T0 = time.time()
REPO = globals().get("OTRA_REPO", "/Users/robin/Code/personal/otra-city-3d")
SRC = os.path.join(REPO, "poc", "city-hall")
OUT_DIR = os.path.join(SRC, "out")
PLOT_DIR = os.path.join(REPO, "public", "plots", "city-hall")
DO_RENDER = globals().get("OTRA_RENDER", True)
DO_EXPORT = globals().get("OTRA_EXPORT", True)
SHOTS = globals().get("OTRA_SHOTS", None)
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.join(PLOT_DIR, "media"), exist_ok=True)
random.seed(2026)

PMAP = json.load(open(os.path.join(SRC, "palette_map.json")))
AMAP = json.load(open(os.path.join(SRC, "atlas_map.json")))
INDEX = json.load(open(os.path.join(REPO, "public", "plots", "index.json")))
COL_NAME = "CityHall"
scene = bpy.context.scene

# ------------------------------------------------------------------ cleanup
col = bpy.data.collections.get(COL_NAME)
if col:
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(col)
for o in list(bpy.data.objects):  # stray default objects would pollute renders
    if o.name in ("Cube", "Light", "Camera"):
        bpy.data.objects.remove(o, do_unlink=True)
for name in ("ch_palette", "ch_palette_emis", "ch_atlas", "ch_tile_base", "ch_tile_normal",
             "ch_tile_rough", "ch_tile_emis"):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
for mname in ("otra_voxel", "otra_glass", "otra_art", "otra_tile"):
    m = bpy.data.materials.get(mname)
    if m:
        bpy.data.materials.remove(m)
for d in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras):
    for x in list(d):
        if x.users == 0:
            d.remove(x)
col = bpy.data.collections.new(COL_NAME)
scene.collection.children.link(col)

# ---------------------------------------------------------------- materials
def load_img(fname, name, colorspace="sRGB"):
    img = bpy.data.images.load(os.path.join(SRC, fname))
    img.name = name
    img.colorspace_settings.name = colorspace
    return img


img_pal = load_img("palette.png", "ch_palette")
img_pem = load_img("palette_emis.png", "ch_palette_emis")
img_atlas = load_img("atlas.png", "ch_atlas")
img_tb = load_img("tile_base.png", "ch_tile_base")
img_tn = load_img("tile_normal.png", "ch_tile_normal", "Non-Color")
img_tr = load_img("tile_rough.png", "ch_tile_rough", "Non-Color")
img_te = load_img("tile_emis.png", "ch_tile_emis")


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


# 1) opaque voxels: palette base + palette emissive in ONE material
mat_voxel = new_mat("otra_voxel")
b = principled(mat_voxel)
L = mat_voxel.node_tree.links
L.new(tex_node(mat_voxel, img_pal).outputs["Color"], b.inputs["Base Color"])
L.new(tex_node(mat_voxel, img_pem).outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = 1.2
b.inputs["Roughness"].default_value = 0.82

# 2) blended palette: glass + holograms (alpha from the palette's alpha channel)
mat_glass = new_mat("otra_glass")
mat_glass.use_backface_culling = False
b = principled(mat_glass)
L = mat_glass.node_tree.links
t = tex_node(mat_glass, img_pal)
L.new(t.outputs["Color"], b.inputs["Base Color"])
L.new(t.outputs["Alpha"], b.inputs["Alpha"])
L.new(tex_node(mat_glass, img_pem).outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = 1.2
b.inputs["Roughness"].default_value = 0.12
for attr, val in (("blend_method", 'BLEND'), ("surface_render_method", 'BLENDED')):
    try:
        setattr(mat_glass, attr, val)
    except Exception:
        pass

# 3) art atlas: signage/plaques, lit by its own emission
mat_art = new_mat("otra_art")
b = principled(mat_art)
L = mat_art.node_tree.links
t = tex_node(mat_art, img_atlas, 'Linear')
L.new(t.outputs["Color"], b.inputs["Base Color"])
L.new(t.outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = 1.2
b.inputs["Roughness"].default_value = 0.9

# 4) tiled PBR floor: base + normal + roughness + faint emissive seams
mat_tile = new_mat("otra_tile")
b = principled(mat_tile)
N = mat_tile.node_tree.nodes
L = mat_tile.node_tree.links
L.new(tex_node(mat_tile, img_tb, 'Linear', 'REPEAT').outputs["Color"], b.inputs["Base Color"])
L.new(tex_node(mat_tile, img_tr, 'Linear', 'REPEAT').outputs["Color"], b.inputs["Roughness"])
L.new(tex_node(mat_tile, img_te, 'Linear', 'REPEAT').outputs["Color"], b.inputs["Emission Color"])
nm = N.new("ShaderNodeNormalMap")
nm.inputs["Strength"].default_value = 1.0
L.new(tex_node(mat_tile, img_tn, 'Linear', 'REPEAT').outputs["Color"], nm.inputs["Color"])
L.new(nm.outputs["Normal"], b.inputs["Normal"])
b.inputs["Emission Strength"].default_value = 1.0

# ------------------------------------------------------------------ helpers
G = PMAP["grid"]
TILE_M = 2.0  # metres per floor-texture repeat


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
    """Mesh builder: world-space faces -> one object (verts stored relative to origin)."""

    def __init__(self, name, mats, origin=(0, 0, 0)):
        self.name, self.mats, self.origin = name, list(mats), Vector(origin)
        self.verts, self.faces, self.uvs, self.midx = [], [], [], []

    def face(self, pts, uvs, mi=0):
        n = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(n, n + len(pts))))
        self.uvs.append(list(uvs))
        self.midx.append(mi)

    def box(self, mn, mx, sw, mi=0, skip=()):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        uv = cell_uv(sw)
        for fname, idx in BOX_FACES:
            if fname in skip:
                continue
            self.face([v[i] for i in idx], [uv] * 4, mi)

    def rbox(self, cx, cy, z0, z1, w, d, ang, sw, mi=0):
        """Box of width w (tangential) x depth d (radial), rotated by ang about z."""
        ca, sa = math.cos(ang), math.sin(ang)
        # local axes: t (tangential, +w), n (radial, +d)
        pts = []
        for zz in (z0, z1):
            for (a, b_) in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
                pts.append((cx + a * -sa + b_ * ca, cy + a * ca + b_ * sa, zz))
        uv = cell_uv(sw)
        for fname, idx in BOX_FACES:
            self.face([pts[i] for i in idx], [uv] * 4, mi)

    def rquad(self, cx, cy, z0, z1, w, ang, uvs, mi=0, offset=0.0):
        """Vertical quad centred at (cx,cy), tangential to angle ang, facing INWARD
        (toward the point the angle is measured from); offset moves it radially."""
        ca, sa = math.cos(ang), math.sin(ang)
        tx, ty = -sa, ca
        px, py = cx + offset * ca, cy + offset * sa
        p0 = (px - tx * w / 2, py - ty * w / 2)
        p1 = (px + tx * w / 2, py + ty * w / 2)
        self.face([(p1[0], p1[1], z0), (p0[0], p0[1], z0), (p0[0], p0[1], z1), (p1[0], p1[1], z1)], uvs, mi)

    def finish(self, collection=None):
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
        (collection or col).objects.link(ob)
        return ob


class Vox:
    """Sparse voxel grid; emits only exposed faces into mesh builders."""
    DIRS = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))

    def __init__(self, cell):
        self.c = cell
        self.cells = {}

    def fill(self, mn, mx, sw, fn=None, kind='opaque', tile_top=False):
        c = self.c
        i0, i1 = math.floor(mn[0] / c + 1e-6), math.ceil(mx[0] / c - 1e-6)
        j0, j1 = math.floor(mn[1] / c + 1e-6), math.ceil(mx[1] / c - 1e-6)
        k0, k1 = math.floor(mn[2] / c + 1e-6), math.ceil(mx[2] / c - 1e-6)
        for i in range(i0, i1):
            x = (i + 0.5) * c
            for j in range(j0, j1):
                y = (j + 0.5) * c
                for k in range(k0, k1):
                    z = (k + 0.5) * c
                    if not (mn[0] <= x <= mx[0] and mn[1] <= y <= mx[1] and mn[2] <= z <= mx[2]):
                        continue
                    if fn is None or fn(x, y, z):
                        self.cells[(i, j, k)] = (sw, kind, tile_top)

    def emit(self, opaque, blend, floor, special=None, skip_z0=True):
        c = self.c
        special = special or {}
        for (i, j, k), (sw, kind, tt) in self.cells.items():
            x0, y0, z0 = i * c, j * c, k * c
            x1, y1, z1 = x0 + c, y0 + c, z0 + c
            for d in self.DIRS:
                n = self.cells.get((i + d[0], j + d[1], k + d[2]))
                if n is not None and not (kind == 'opaque' and n[1] == 'blend'):
                    continue
                if d == (0, 0, -1) and skip_z0 and z0 <= 1e-6:
                    continue
                if d == (1, 0, 0):
                    pts = [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]
                elif d == (-1, 0, 0):
                    pts = [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)]
                elif d == (0, 1, 0):
                    pts = [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)]
                elif d == (0, -1, 0):
                    pts = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]
                elif d == (0, 0, 1):
                    pts = [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
                else:
                    pts = [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)]
                if d == (0, 0, 1) and tt:
                    floor.face(pts, [(p[0] / TILE_M, p[1] / TILE_M) for p in pts])
                elif kind == 'blend':
                    blend.face(pts, [cell_uv(sw)] * 4)
                else:
                    (special.get(sw) or opaque).face(pts, [cell_uv(sw)] * 4)


def squircle(x, y, r, p=4.0):
    return (abs(x) / r) ** p + (abs(y) / r) ** p <= 1.0


def snap(v, c):
    return (math.floor(v / c) + 0.5) * c


# ----------------------------------------------------------------- buckets
S = MB("hall_structure", [mat_voxel])
H = MB("hall_glass", [mat_glass], origin=(0, 0.75, 4.6))   # origin high: sorts behind interior holograms
A = MB("hall_art", [mat_art])
F = MB("hall_floor", [mat_tile])
RINGS = MB("dome_rings", [mat_voxel])                      # pulse anim target
INLAY = MB("floor_inlay", [mat_voxel])                     # pulse anim target

CX, CY = 0.0, 0.75          # rotunda centre
R_COL = 3.85                # column circle
Z_PLAZA, Z_STEP, Z_POD = 0.25, 0.5, 0.75
Z_CAP, Z_BEAM = 3.5, 4.0
R_SPH = 5.22
ZC = 5.99 - R_SPH           # sphere centre height (apex at 5.99)
COL_ANGLES = [k * 45 for k in range(8) if k != 6]   # 270 deg (front centre) left open

V = Vox(0.25)
# plaza slab (tiled top), podium (squircle) + step ring, clipped to the lot
V.fill((-5, -5, 0), (5, 5, Z_PLAZA), "plaza", tile_top=True)
V.fill((-4.99, -4.99, Z_PLAZA), (4.99, 4.99, Z_STEP), "step",
       fn=lambda x, y, z: squircle(x - CX, y - CY, 4.75), tile_top=True)   # 0.55 m tread: wider than the avatar radius
V.fill((-4.99, -4.99, Z_PLAZA), (4.99, 4.99, Z_POD), "podium",
       fn=lambda x, y, z: squircle(x - CX, y - CY, 4.2), tile_top=True)
V.fill((-4.99, -4.99, Z_STEP), (4.99, 4.99, Z_POD), "e_cyan_dim",      # glowing podium rim
       fn=lambda x, y, z: squircle(x - CX, y - CY, 4.2) and not squircle(x - CX, y - CY, 3.95))

# drum wall: back 3/4 ring, angles [-30, 210] deg around the centre
def in_drum(x, y, z, r0=3.6, r1=4.1):
    dx, dy = x - CX, y - CY
    r = math.hypot(dx, dy)
    if not (r0 <= r <= r1):
        return False
    a = math.degrees(math.atan2(dy, dx)) % 360
    return a <= 210 or a >= 330


V.fill((-4.99, -4.99, Z_POD), (4.99, 4.99, Z_CAP), "drum", fn=in_drum)
V.fill((-4.99, -4.99, Z_POD), (4.99, 4.99, Z_POD + 0.25), "drum_lt", fn=in_drum)   # skirting
V.fill((-4.99, -4.99, Z_CAP - 0.25), (4.99, 4.99, Z_CAP), "e_cyan_dim",
       fn=lambda x, y, z: in_drum(x, y, z, 3.85, 4.1))                             # outer glow cornice
V.fill((-4.99, -4.99, Z_CAP - 0.25), (4.99, 4.99, Z_CAP), "e_warm_dim",
       fn=lambda x, y, z: in_drum(x, y, z, 3.6, 3.85))                             # inner warm cove

# columns (voxel, 0.75 shafts with 1.25 base/capital), snapped to the grid
col_centres = []
for ang in COL_ANGLES:
    a = math.radians(ang)
    cx, cy = snap(CX + R_COL * math.cos(a), 0.25), snap(CY + R_COL * math.sin(a), 0.25)
    col_centres.append((ang, cx, cy))
    free = ang in (225, 315)          # the two porch columns; the rest are pilasters in the drum
    e = 0.626 if free else 0.376
    V.fill((cx - e, cy - e, Z_POD), (cx + e, cy + e, Z_POD + 0.25), "plinth_dk")
    V.fill((cx - 0.376, cy - 0.376, Z_POD + 0.25), (cx + 0.376, cy + 0.376, Z_CAP - 0.25), "column")
    V.fill((cx - e, cy - e, Z_CAP - 0.25), (cx + e, cy + e, Z_CAP), "capital")

# ring beam on the capitals (glow band on the outer lower ring)
def in_beam(x, y, z):
    r = math.hypot(x - CX, y - CY)
    return 3.55 <= r <= 4.15


V.fill((-4.99, -4.99, Z_CAP), (4.99, 4.99, Z_BEAM), "beam", fn=in_beam)
V.fill((-4.99, -4.99, Z_CAP + 0.25), (4.99, 4.99, Z_BEAM), "beam_dk", fn=in_beam)
V.fill((-4.99, -4.99, Z_CAP), (4.99, 4.99, Z_CAP + 0.25), "e_cyan_soft",
       fn=lambda x, y, z: 3.9 <= math.hypot(x - CX, y - CY) <= 4.15)

# dome lattice (0.125 m grid): 16 meridian ribs, 3 glowing parallels, studs at the
# crossings, a hot oculus ring and a hub, all on a thin spherical shell
RIB_ANGLES = [k * 22.5 for k in range(16)]
RING_Z = (4.55, 5.05, 5.45)
D2 = Vox(0.125)


def dome_cell(x, y, z):
    dx, dy, dz = x - CX, y - CY, z - ZC
    dist = math.sqrt(dx * dx + dy * dy + dz * dz)
    if not (R_SPH - 0.25 <= dist <= R_SPH) or z < Z_BEAM or z + 0.0625 > 5.76:
        return None
    rxy = math.hypot(dx, dy)
    a = math.degrees(math.atan2(dy, dx)) % 360
    if rxy <= 0.5:
        return "rib_dk"                       # hub
    if rxy <= 0.95:
        return "e_cyan"                       # oculus (hot)
    dz_ring = min(abs(z - rz) for rz in RING_Z)
    darc = min(abs((a - ra + 180) % 360 - 180) for ra in RIB_ANGLES) * math.pi / 180 * rxy
    if darc <= 0.14 and dz_ring <= 0.07:
        return "e_gold"                       # stud at the crossing (hot, blooms)
    if darc <= 0.13:
        return "e_cyan_dim"                   # meridian rib (faint line)
    if dz_ring <= 0.07:
        return "e_cyan_soft"                  # parallel ring (glows, no bloom)
    return None


for k in range(int(Z_BEAM / 0.125), int(5.76 / 0.125) + 1):
    z = (k + 0.5) * 0.125
    for i in range(-40, 40):
        x = (i + 0.5) * 0.125
        for j in range(-40, 40):
            y = (j + 0.5) * 0.125
            sw = dome_cell(x, y, z)
            if sw:
                D2.cells[(i, j, k)] = (sw, 'opaque', False)

# central plinth (squircle), glowing top rim
V.fill((-2.5, -1.5, Z_POD), (2.5, 3.0, 1.75), "plinth_dk",
       fn=lambda x, y, z: squircle(x - CX, y - CY, 1.9))
V.fill((-2.5, -1.5, 1.5), (2.5, 3.0, 1.75), "e_cyan_dim",
       fn=lambda x, y, z: squircle(x - CX, y - CY, 1.9) and not squircle(x - CX, y - CY, 1.55))
V.fill((-2.5, -1.5, 1.5), (2.5, 3.0, 1.75), "steel_dk",
       fn=lambda x, y, z: squircle(x - CX, y - CY, 1.55))

# back-corner voxel trees
for sx in (-1, 1):
    tx, ty = sx * 4.0, 4.0
    V.fill((tx - 0.126, ty - 0.126, Z_PLAZA), (tx + 0.126, ty + 0.126, 2.5), "gold_dk")
    V.fill((tx - 0.751, ty - 0.751, 2.5), (tx + 0.751, ty + 0.751, 3.5), "leaf")
    V.fill((tx - 0.501, ty - 0.501, 3.5), (tx + 0.501, ty + 0.501, 4.0), "leaf")
    V.fill((tx - 0.251, ty - 0.251, 4.0), (tx + 0.251, ty + 0.251, 4.25), "leaf")

V.emit(S, H, F, special={"e_cyan": RINGS, "e_cyan_soft": RINGS})
D2.emit(S, H, F, special={"e_cyan": RINGS, "e_cyan_soft": RINGS, "e_gold": RINGS})

# column edge light-lines (thin boxes proud of the shaft corners / inner face)
for ang, cx, cy in col_centres:
    free = ang in (225, 315)
    if free:
        for sx in (-1, 1):
            for sy in (-1, 1):
                ex, ey = cx + sx * 0.375, cy + sy * 0.375
                S.box((min(ex, ex - sx * 0.05), min(ey, ey - sy * 0.05), Z_POD + 0.3),
                      (max(ex, ex + sx * 0.02), max(ey, ey + sy * 0.02), Z_CAP - 0.3), "e_cyan_soft")
    else:
        a = math.radians(ang)
        nx, ny = -math.cos(a), -math.sin(a)      # toward the centre
        if abs(nx) >= abs(ny):
            fx = cx + (0.375 if nx > 0 else -0.375)
            S.box((fx - 0.03, cy - 0.04, Z_POD + 0.3), (fx + 0.03, cy + 0.04, Z_CAP - 0.3), "e_cyan_soft")
        else:
            fy = cy + (0.375 if ny > 0 else -0.375)
            S.box((cx - 0.04, fy - 0.03, Z_POD + 0.3), (cx + 0.04, fy + 0.03, Z_CAP - 0.3), "e_cyan_soft")

# banners on the two free front columns (art atlas, vertical)
for ang, cx, cy in col_centres:
    if ang in (225, 315):
        A.face([(cx - 0.2, cy - 0.381, 1.4), (cx + 0.2, cy - 0.381, 1.4),
                (cx + 0.2, cy - 0.381, 2.6), (cx - 0.2, cy - 0.381, 2.6)], region_uvs("banner_v"))

# floor inlay: two glowing rings + 8 spokes, 0.125 cells, 20 mm proud (pulse target)
inlay_cells = set()
for rr in (2.45, 3.15):
    n = int(2 * math.pi * rr / 0.06)
    for i in range(n):
        a = 2 * math.pi * i / n
        inlay_cells.add((snap(CX + rr * math.cos(a), 0.125), snap(CY + rr * math.sin(a), 0.125)))
for ang in range(0, 360, 45):
    a = math.radians(ang + 22.5)
    t = 2.05
    while t <= 3.35:
        inlay_cells.add((snap(CX + t * math.cos(a), 0.125), snap(CY + t * math.sin(a), 0.125)))
        t += 0.05
for (x, y) in inlay_cells:
    if squircle(x - CX, y - CY, 4.15) and not squircle(x - CX, y - CY, 1.95):
        INLAY.box((x - 0.0625, y - 0.0625, Z_POD), (x + 0.0625, y + 0.0625, Z_POD + 0.02), "e_cyan_dim", skip=("bottom",))

# entrance medallion (city seal) on the podium floor
A.face([(-0.95, -3.3, Z_POD + 0.005), (0.95, -3.3, Z_POD + 0.005),
        (0.95, -1.4, Z_POD + 0.005), (-0.95, -1.4, Z_POD + 0.005)], region_uvs("medallion"))

# ---------------------------------------------------------- portal + signage
GY = -4.62   # the client's gate trigger line
for sx in (-1, 1):
    S.box((sx * 1.35 - 0.075, GY - 0.08, Z_PLAZA), (sx * 1.35 + 0.075, GY + 0.08, 3.0), "steel_dk")
    S.box((sx * 1.35 - 0.11, GY - 0.11, 3.0), (sx * 1.35 + 0.11, GY + 0.11, 3.1), "e_cyan")
S.box((-1.5, GY - 0.08, 2.5), (1.5, GY + 0.22, 2.8), "trim")            # lintel
S.box((-1.5, GY - 0.081, 2.5), (1.5, GY - 0.06, 2.53), "e_gold_soft")   # lintel light line
# marquee (pic_1): 16:1 quad on the lintel front, full UVs, ticker anim scrolls it
TICK = MB("pic_1", [mat_art])
# 4096x128 tile (32:1) on a 2.88 x 0.24 m band: show 0.375 of the tile at a time, the ticker scrolls the rest
TICK.face([(-1.44, GY - 0.085, 2.53), (1.44, GY - 0.085, 2.53), (1.44, GY - 0.085, 2.77), (-1.44, GY - 0.085, 2.77)],
          [(0, 0), (0.375, 0), (0.375, 1), (0, 1)])
TICK.finish()
# main sign in the signage zone, both faces, on brackets from the lintel
S.box((-2.1, -4.85, 2.85), (2.1, -4.75, 3.75), "trim")
for sx in (-1, 1):
    S.box((sx * 1.4 - 0.05, -4.75, 2.62), (sx * 1.4 + 0.05, GY - 0.08, 2.85), "steel_dk")
S.box((-2.1, -4.86, 2.85), (2.1, -4.74, 2.9), "e_cyan_soft")
S.box((-2.1, -4.86, 3.7), (2.1, -4.74, 3.75), "e_cyan_soft")
A.face([(-2.0, -4.855, 2.9), (2.0, -4.855, 2.9), (2.0, -4.855, 3.7), (-2.0, -4.855, 3.7)], region_uvs("sign_main"))
A.face([(2.0, -4.745, 2.9), (-2.0, -4.745, 2.9), (-2.0, -4.745, 3.7), (2.0, -4.745, 3.7)], region_uvs("sign_main"))
# cornerstone plaques on the front pylons' inner faces + spec plaque by the door
for sx in (-1, 1):
    px = sx * 4.4
    S.box((px - 0.25, -4.65, Z_PLAZA), (px + 0.25, -4.15, 2.75), "column")
    S.box((px - 0.18, -4.58, 2.75), (px + 0.18, -4.22, 3.1), "e_cyan")
    S.box((px - 0.45, -4.7, 1.35), (px + 0.45, -4.65, 1.9), "trim")
    LK = MB("link_%d" % (1 if sx > 0 else 2), [mat_art])
    LK.face([(px - 0.43, -4.705, 1.3625), (px + 0.43, -4.705, 1.3625),
             (px + 0.43, -4.705, 1.9), (px - 0.43, -4.705, 1.9)], region_uvs("link_claim"))
    LK.finish()
    # plaques on the pylon's inner face (facing the entrance path)
    ix = px - sx * 0.251
    reg = "plaque_est" if sx > 0 else "plaque_spec"
    h = 0.42 if sx > 0 else 0.5
    w = h * (AMAP["regions"][reg][2] / AMAP["regions"][reg][3])
    if sx > 0:
        A.face([(ix, -4.15 - 0.0, 2.0), (ix, -4.15 - w, 2.0), (ix, -4.15 - w, 2.0 + h), (ix, -4.15, 2.0 + h)][::-1]
               if False else [(ix, -4.4 + w / 2, 2.0), (ix, -4.4 - w / 2, 2.0), (ix, -4.4 - w / 2, 2.0 + h), (ix, -4.4 + w / 2, 2.0 + h)],
               region_uvs(reg))
    else:
        A.face([(ix, -4.4 - w / 2, 2.0), (ix, -4.4 + w / 2, 2.0), (ix, -4.4 + w / 2, 2.0 + h), (ix, -4.4 - w / 2, 2.0 + h)],
               region_uvs(reg))

# gate panels: glass in slim steel frames, authored CLOSED, identity transforms
for suffix, xa, xb in (("L", -1.25, 0.0), ("R", 0.0, 1.25)):
    D = MB("door_panel_" + suffix, [mat_voxel, mat_glass])
    y0, y1 = GY - 0.03, GY + 0.03
    D.box((xa, y0, 0.3), (xa + 0.05, y1, 2.45), "steel")
    D.box((xb - 0.05, y0, 0.3), (xb, y1, 2.45), "steel")
    D.box((xa + 0.05, y0, 0.3), (xb - 0.05, y1, 0.4), "steel")
    D.box((xa + 0.05, y0, 2.35), (xb - 0.05, y1, 2.45), "steel")
    D.box((xa + 0.05, y0 - 0.005, 1.2), (xb - 0.05, y1 + 0.005, 1.23), "e_cyan_soft")
    D.face([(xa + 0.05, GY, 0.4), (xb - 0.05, GY, 0.4), (xb - 0.05, GY, 2.35), (xa + 0.05, GY, 2.35)], [cell_uv("glass_gate")] * 4, 1)
    D.finish()

# ------------------------------------------------------- gallery + screens
def bay(ang_deg, w, h, zc, name, mats, uvs):
    a = math.radians(ang_deg)
    r_back = 3.62
    cx, cy = CX + r_back * math.cos(a), CY + r_back * math.sin(a)
    S.rbox(cx, cy, zc - h / 2 - 0.08, zc + h / 2 + 0.08, w + 0.16, 0.12, a, "trim")
    S.rbox(cx, cy, zc + h / 2 + 0.08, zc + h / 2 + 0.12, w + 0.16, 0.14, a, "e_cyan_soft")
    ob = MB(name, mats)
    ob.rquad(cx, cy, zc - h / 2, zc + h / 2, w, a, uvs, offset=-0.065)
    ob.finish()


for i, ang in enumerate((22.5, 67.5, 112.5, 157.5)):
    bay(ang, 1.5, 1.125, 1.95, "pic_%d" % (i + 2), [mat_art], FULL_UVS)
bay(337.5, 1.6, 0.9, 2.0, "screen_1", [mat_art], FULL_UVS)
bay(202.5, 1.6, 0.9, 2.0, "screen_2", [mat_art], FULL_UVS)
# hall of builders on the plinth's back face
S.box((-0.68, CY + 1.9 - 0.02, 0.78), (0.68, CY + 1.9 + 0.03, 1.72), "trim")
P6 = MB("pic_6", [mat_art])
yb = CY + 1.9 + 0.035
P6.face([(0.6, yb, 0.8), (-0.6, yb, 0.8), (-0.6, yb, 1.7), (0.6, yb, 1.7)], FULL_UVS)
P6.finish()
# live city ledger on the plinth's front face
yf = CY - 1.9
S.box((-0.62, yf - 0.03, 0.8), (0.62, yf + 0.02, 1.72), "trim")
PL = MB("panel_live", [mat_art])
PL.face([(-0.5333, yf - 0.035, 0.85), (0.5333, yf - 0.035, 0.85), (0.5333, yf - 0.035, 1.65), (-0.5333, yf - 0.035, 1.65)],
        region_uvs("panel_live"))
PL.finish()

# ------------------------------------------------- the holographic city model
MS = 1.0 / 25.0   # 1:25
M = MB("city_model", [mat_voxel, mat_glass], origin=(CX, CY, 2.35))
ox, oy = CX, CY


def mbox(mn, mx, sw, mi=0):
    M.box((ox + mn[0], oy + mn[1], 2.35 + mn[2]), (ox + mx[0], oy + mx[1], 2.35 + mx[2]), sw, mi)


mbox((-1.72, -0.72, -0.06), (1.72, 0.72, 0.0), "holo_cyan", 1)             # hologram slab
mbox((-1.68, -0.16, 0.0), (1.68, 0.16, 0.012), "road")                      # road
for sy in (-1, 1):
    mbox((-1.68, sy * 0.16, 0.0), (1.68, sy * 0.26, 0.016), "paving")        # sidewalks
for lx in (-30, -18, -6, 6, 18, 30):
    ly = (-1 if (lx // 12) % 2 == 0 else 1) * 6.2 * MS
    mbox((lx * MS - 0.008, ly - 0.008, 0.016), (lx * MS + 0.008, ly + 0.008, 0.15), "trim")
    mbox((lx * MS - 0.016, ly - 0.016, 0.15), (lx * MS + 0.016, ly + 0.016, 0.18), "e_warm")
for lot in INDEX["lots"]:
    if lot["slug"] == "city-hall":
        continue  # drawn below as the tiny dome
    lx, ly = lot["x"] * MS, lot["side"] * 11.5 * MS
    sw = "holo_" + lot["slug"]
    mbox((lx - 0.2, ly - 0.2, 0.0), (lx + 0.2, ly + 0.2, 0.02), sw, 1)
    hsh = sum(ord(ch) for ch in lot["slug"])
    if lot["type"] == "shop":
        mbox((lx - 0.18, ly - 0.18, 0.02), (lx + 0.18, ly + 0.18, 0.24), sw, 1)
        mbox((lx - 0.2, ly - 0.2, 0.24), (lx + 0.2, ly + 0.2, 0.26), "e_%s_soft" % ("magenta", "gold", "violet")[hsh % 3])
    else:
        k = hsh % 3
        if k == 0:      # tower
            mbox((lx - 0.08, ly - 0.08, 0.02), (lx + 0.08, ly + 0.08, 0.34), sw, 1)
            mbox((lx - 0.1, ly - 0.1, 0.34), (lx + 0.1, ly + 0.1, 0.36), "e_cyan_soft")
        elif k == 1:    # garden
            for gx, gy in ((-0.1, -0.1), (0.1, 0.05), (-0.05, 0.12), (0.12, -0.12)):
                mbox((lx + gx - 0.04, ly + gy - 0.04, 0.02), (lx + gx + 0.04, ly + gy + 0.04, 0.1), sw, 1)
        else:           # monument
            mbox((lx - 0.14, ly - 0.14, 0.02), (lx + 0.14, ly + 0.14, 0.1), sw, 1)
            mbox((lx - 0.05, ly - 0.05, 0.1), (lx + 0.05, ly + 0.05, 0.3), sw, 1)
for v in INDEX.get("vacant", []):
    lx, ly = v["x"] * MS, v["side"] * 11.5 * MS
    if v["x"] == 0 and v["side"] == 1:
        continue  # that's us
    t = 0.015
    for (a0, b0, a1, b1) in ((-0.2, -0.2, 0.2, -0.2 + t), (-0.2, 0.2 - t, 0.2, 0.2),
                             (-0.2, -0.2, -0.2 + t, 0.2), (0.2 - t, -0.2, 0.2, 0.2)):
        mbox((lx + a0, ly + b0, 0.0), (lx + a1, ly + b1, 0.03), "holo_vacant", 1)
# City Hall itself: tiny tiered dome + beacon at lot (0, +1)
hx, hy = 0.0, 11.5 * MS
mbox((hx - 0.2, hy - 0.2, 0.0), (hx + 0.2, hy + 0.2, 0.02), "holo_cyan", 1)
for rr, z0, z1 in ((0.18, 0.02, 0.12), (0.14, 0.12, 0.2), (0.09, 0.2, 0.26), (0.04, 0.26, 0.3)):
    mbox((hx - rr, hy - rr, z0), (hx + rr, hy + rr, z1), "holo_cyan", 1)
mbox((hx - 0.012, hy - 0.012, 0.3), (hx + 0.012, hy + 0.012, 0.33), "e_red")
M.finish()

# halo: ring of hologram cubes orbiting the model (spinner)
HALO = MB("halo", [mat_voxel, mat_glass], origin=(CX, CY, 3.3))
for i in range(16):
    a = 2 * math.pi * i / 16
    r = 2.55
    z = 3.3 + (0.12 if i % 2 else -0.12)
    x, y = CX + r * math.cos(a), CY + r * math.sin(a)
    sw, mi = ("holo_white", 1) if i % 4 else ("e_cyan", 0)
    HALO.box((x - 0.06, y - 0.06, z - 0.06), (x + 0.06, y + 0.06, z + 0.06), sw, mi)
HALO.finish()
# orbs: slow-bobbing gold lights above the walkway
ORBS = MB("orbs", [mat_voxel])
for i in range(7):
    a = math.radians(20 + i * 50)
    r = 2.3 + (i % 3) * 0.3
    z = 2.75 + (i % 2) * 0.25
    x, y = CX + r * math.cos(a), CY + r * math.sin(a)
    ORBS.box((x - 0.06, y - 0.06, z - 0.06), (x + 0.06, y + 0.06, z + 0.06), "e_gold_soft")
ORBS.finish()

# apex beacon (blinker) at the very top of the envelope
BEACON = MB("beacon_tip", [mat_voxel])
BEACON.box((-0.125, CY - 0.125, 5.75), (0.125, CY + 0.125, 5.99), "e_red")
BEACON.finish()

# glass dome panels on the shell between the lattice (double-sided blend)
RG = R_SPH - 0.2
z_lo, z_hi = Z_BEAM + 0.02, ZC + math.sqrt(RG * RG - 1.05 * 1.05)
NZ, NA = 7, 36
for si in range(NA):
    a0, a1 = 2 * math.pi * si / NA, 2 * math.pi * (si + 1) / NA
    for zi in range(NZ):
        z0 = z_lo + (z_hi - z_lo) * zi / NZ
        z1 = z_lo + (z_hi - z_lo) * (zi + 1) / NZ
        r0 = math.sqrt(max(0.0, RG * RG - (z0 - ZC) ** 2))
        r1 = math.sqrt(max(0.0, RG * RG - (z1 - ZC) ** 2))
        p = lambda a, r, z: (CX + r * math.cos(a), CY + r * math.sin(a), z)
        H.face([p(a0, r0, z0), p(a1, r0, z0), p(a1, r1, z1), p(a0, r1, z1)], [cell_uv("glass")] * 4)

structure = S.finish()
glass = H.finish()
art = A.finish()
floor = F.finish()
rings = RINGS.finish()
inlay = INLAY.finish()

# -------------------------------------------------------------------- lights
def point_light(name, loc, color, watts, radius=0.5):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.color = color
    ld.energy = watts
    ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    col.objects.link(ob)
    return ob


point_light("light_core", (CX, CY, 4.4), (0.75, 0.95, 1.0), 420)
point_light("light_gallery", (CX, CY + 2.2, 3.0), (1.0, 0.85, 0.7), 260)
point_light("light_porch", (0, -4.1, 2.4), (0.6, 0.95, 1.0), 200)

# --------------------------------------------------------------------- stats
bpy.context.view_layer.update()
tot, mn, mx = 0, [9e9] * 3, [-9e9] * 3
for o in col.objects:
    if o.type != 'MESH':
        continue
    o.data.calc_loop_triangles()
    tot += len(o.data.loop_triangles)
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
print("BUILD OK in %.1fs" % (time.time() - T0))
print("objects:", sorted(o.name for o in col.objects))
print("triangles:", tot)
print("bbox min:", [round(v, 3) for v in mn], "max:", [round(v, 3) for v in mx])

# ------------------------------------------------------------------- render
if DO_RENDER:
    rcol = bpy.data.collections.get("RENDER_ONLY")
    if rcol:
        for o in list(rcol.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        rcol = bpy.data.collections.new("RENDER_ONLY")
        scene.collection.children.link(rcol)
    gm = bpy.data.meshes.new("ground")
    gm.from_pydata([(-60, -60, -0.01), (60, -60, -0.01), (60, 60, -0.01), (-60, 60, -0.01)], [], [(0, 1, 2, 3)])
    gmat = bpy.data.materials.get("otra_ground") or bpy.data.materials.new("otra_ground")
    gmat.use_nodes = True
    pb = principled(gmat)
    pb.inputs["Base Color"].default_value = (0.055, 0.05, 0.07, 1)
    pb.inputs["Roughness"].default_value = 0.9
    gm.materials.append(gmat)
    rcol.objects.link(bpy.data.objects.new("ground", gm))
    moon = bpy.data.lights.new("moon", 'SUN')
    moon.energy = 0.35
    moon.color = (0.55, 0.65, 1.0)
    mo = bpy.data.objects.new("moon", moon)
    mo.rotation_euler = (0.9, 0.2, 2.6)
    rcol.objects.link(mo)
    for i, x in enumerate((-6.0, 6.0)):   # city street lamps (not exported)
        sl = bpy.data.lights.new("street_%d" % i, 'POINT')
        sl.energy = 120
        sl.color = (1.0, 0.75, 0.5)
        sl.shadow_soft_size = 0.4
        so = bpy.data.objects.new("street_%d" % i, sl)
        so.location = (x, -5.3, 3.4)
        rcol.objects.link(so)
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bgn = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bgn.inputs[0].default_value = (0.012, 0.010, 0.030, 1)
    bgn.inputs[1].default_value = 1.0
    cd = bpy.data.cameras.new("CH_CAM")
    cam = bpy.data.objects.new("CH_CAM", cd)
    rcol.objects.link(cam)
    cam.data.lens = 24
    scene.camera = cam
    eng = {i.identifier for i in scene.render.bl_rna.properties['engine'].enum_items}
    for cand in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        if cand in eng:
            scene.render.engine = cand
            break
    try:
        scene.eevee.taa_render_samples = 48
    except Exception:
        pass
    for vt, look in (('Standard', 'None'), ('AgX', 'AgX - Punchy')):
        try:
            scene.view_settings.view_transform = vt
            scene.view_settings.look = look
            break
        except Exception:
            continue
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 810
    scene.render.image_settings.file_format = 'PNG'
    shots = {
        "street": ((8.0, -14.5, 2.7), (0.0, 0.5, 2.5)),
        "eye": ((0.8, -11.0, 1.15), (0.0, 0.75, 2.4)),
        "interior": ((0.0, -4.1, 2.3), (0.0, 2.0, 2.0)),
        "high": ((9.5, -9.5, 8.0), (0.0, 0.75, 2.2)),
        "spawn": ((20.0, -11.5, 2.4), (1.0, 0.5, 2.6)),
    }
    for fname, (loc, tgt) in shots.items():
        if SHOTS and fname not in SHOTS:
            continue
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT_DIR, "render_%s.png" % fname)
        bpy.ops.render.render(write_still=True)
        print("rendered", fname)

    if globals().get("OTRA_PORTRAIT", True):
        scene.render.resolution_x, scene.render.resolution_y = 1024, 768
        cam.data.lens = 28
        cam.location = (7.6, -13.2, 3.0)
        cam.rotation_euler = (Vector((0.0, 0.4, 2.6)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(PLOT_DIR, "media", "hall.png")
        bpy.ops.render.render(write_still=True)
        print("rendered portrait")
        scene.render.resolution_x, scene.render.resolution_y = 1440, 810

# ------------------------------------------------------------------- export
if DO_EXPORT:
    bpy.ops.object.select_all(action='DESELECT')
    for o in col.objects:
        o.select_set(True)
    avail = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {"filepath": os.path.join(PLOT_DIR, "plot.glb"), "export_format": 'GLB'}
    optional = {
        "use_selection": True, "export_apply": True, "export_yup": True, "export_lights": True,
        "export_cameras": False, "export_extras": False, "export_animations": False,
        "export_skins": False, "export_morph": False, "export_image_format": 'AUTO',
        "export_draco_mesh_compression_enable": True, "export_draco_mesh_compression_level": 6,
        "export_draco_position_quantization": 14, "export_draco_texcoord_quantization": 12,
        "export_unused_images": False, "export_unused_textures": False,
    }
    for k, v in optional.items():
        if k in avail:
            kwargs[k] = v
    bpy.ops.export_scene.gltf(**kwargs)
    print("exported:", kwargs["filepath"], os.path.getsize(kwargs["filepath"]), "bytes")
print("DONE in %.1fs" % (time.time() - T0))
