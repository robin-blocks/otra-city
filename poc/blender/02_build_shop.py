# PromptFrenzy shop — built for the otra.city standard lot (10 x 10 x 6 m, front = -Y).
# Runs inside Blender via the BlenderMCP bridge. Idempotent: re-running rebuilds.
#
# Technique notes (these ARE the point of the PoC):
#   * Everything is axis-aligned boxes on a 0.25 m grid -> voxel look, tiny tri count.
#   * One 256px palette texture colors all voxels via per-face UVs -> 1 material.
#   * Same palette drives a second, emissive material for neon.
#   * One 1024px art atlas holds sign/poster/live-panel/link art -> 1 material.
#   * Buckets merge into 4 meshes + 2 door panels -> ~6 draw calls in three.js.
import json
import os
import time

import bmesh
import bpy

T0 = time.time()
REPO = "/Users/robin/Code/personal/otra-city-3d"
ASSETS = os.path.join(REPO, "poc", "assets")

with open(os.path.join(ASSETS, "palette_map.json")) as f:
    PMAP = json.load(f)
with open(os.path.join(ASSETS, "atlas_map.json")) as f:
    AMAP = json.load(f)

# ------------------------------------------------------------------ cleanup
col = bpy.data.collections.get("PromptFrenzyShop")
if col:
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(col)
for name in ("palette.png", "atlas.png"):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
for mname in ("otra_voxel", "otra_emissive", "otra_art", "otra_glass"):
    m = bpy.data.materials.get(mname)
    if m:
        bpy.data.materials.remove(m)
for d in (bpy.data.meshes, bpy.data.lights):
    for x in list(d):
        if x.users == 0:
            d.remove(x)

col = bpy.data.collections.new("PromptFrenzyShop")
bpy.context.scene.collection.children.link(col)

# ---------------------------------------------------------------- materials
img_pal = bpy.data.images.load(os.path.join(ASSETS, "palette.png"))
img_pal.name = "palette.png"
img_atlas = bpy.data.images.load(os.path.join(ASSETS, "atlas.png"))
img_atlas.name = "atlas.png"


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def tex_node(mat, img):
    t = mat.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = 'Closest'
    return t


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    return m


mat_voxel = new_mat("otra_voxel")
b = principled(mat_voxel)
t = tex_node(mat_voxel, img_pal)
mat_voxel.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
b.inputs["Roughness"].default_value = 0.85

mat_emis = new_mat("otra_emissive")
b = principled(mat_emis)
t = tex_node(mat_emis, img_pal)
b.inputs["Base Color"].default_value = (0, 0, 0, 1)
mat_emis.node_tree.links.new(t.outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = 3.0
b.inputs["Roughness"].default_value = 0.6

mat_art = new_mat("otra_art")
b = principled(mat_art)
t = tex_node(mat_art, img_atlas)
mat_art.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
mat_art.node_tree.links.new(t.outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = 0.5
b.inputs["Roughness"].default_value = 0.9

mat_glass = new_mat("otra_glass")
mat_glass.use_backface_culling = False
b = principled(mat_glass)
b.inputs["Base Color"].default_value = (0.7, 0.95, 1.0, 1)
b.inputs["Roughness"].default_value = 0.08
b.inputs["Alpha"].default_value = 0.15
for attr, val in (("blend_method", 'BLEND'), ("surface_render_method", 'BLENDED')):
    try:
        setattr(mat_glass, attr, val)
    except Exception:
        pass

# ------------------------------------------------------------------ buckets
G = PMAP["grid"]


def cell_uv(cname):
    c, r = PMAP["colors"][cname]["cell"]
    return ((c + 0.5) / G, 1.0 - (r + 0.5) / G)


def region_uvs(rname):
    S = AMAP["size"]
    x, y, w, h = AMAP["regions"][rname]
    u0, u1 = x / S, (x + w) / S
    vt, vb = 1.0 - y / S, 1.0 - (y + h) / S
    return [(u0, vb), (u1, vb), (u1, vt), (u0, vt)]  # BL BR TR TL


class Bucket:
    def __init__(self, name, mats):
        self.name, self.mats = name, mats
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.n_boxes = 0

    def box(self, mn, mx, cname, mat_index=0):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        v = [self.bm.verts.new(p) for p in (
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
        uv = cell_uv(cname)
        for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                    (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            f = self.bm.faces.new([v[i] for i in idx])
            f.material_index = mat_index
            for lo in f.loops:
                lo[self.uv].uv = uv
        self.n_boxes += 1

    def quad(self, verts, uvs, mat_index=0):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in verts])
        f.material_index = mat_index
        for lo, uv in zip(f.loops, uvs):
            lo[self.uv].uv = uv

    def quad_front(self, x0, x1, z0, z1, y, rname=None, mat_index=0):
        """Axis-aligned quad facing -Y (street/back-wall art)."""
        verts = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
        uvs = region_uvs(rname) if rname else [cell_uv("white")] * 4
        self.quad(verts, uvs, mat_index)

    def quad_up(self, x0, x1, y0, y1, z, rname=None, mat_index=0):
        """Axis-aligned quad facing +Z (floor art)."""
        verts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
        uvs = region_uvs(rname) if rname else [cell_uv("white")] * 4
        self.quad(verts, uvs, mat_index)

    def quad_east(self, y0, y1, z0, z1, x, cname="trim", mat_index=0):
        """Axis-aligned quad facing +X (art on the -X wall)."""
        verts = [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)]
        self.quad(verts, [cell_uv(cname)] * 4, mat_index)

    def finish(self):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        ob = bpy.data.objects.new(self.name, mesh)
        col.objects.link(ob)
        return ob


S = Bucket("shop_structure", [mat_voxel])   # opaque voxels
E = Bucket("shop_emissive", [mat_emis])     # neon voxels
A = Bucket("shop_art", [mat_art])           # atlas-textured quads
W = Bucket("shop_glass", [mat_glass])       # window glazing

# ---------------------------------------------------------------- structure
# floor + runway
S.box((-5, -5, 0), (5, 5, 0.25), "floor")
S.box((-1.25, -4.75, 0.25), (1.25, 2.0, 0.28), "runway")

# side + back walls (front face of lot is -Y)
S.box((-5, -4.75, 0.25), (-4.75, 4.75, 5.25), "wall_dark")
S.box((4.75, -4.75, 0.25), (5, 4.75, 5.25), "wall_dark")
S.box((-5, 4.75, 0.25), (5, 5, 5.25), "wall")

# front wall, y in [-4.75, -4.5], with door + two window openings
S.box((-4.75, -4.75, 0.25), (-4.5, -4.5, 5.5), "wall")     # pier L
S.box((-4.5, -4.75, 0.25), (-1.75, -4.5, 1.0), "wall")     # sill L
S.box((-4.5, -4.75, 3.5), (-1.75, -4.5, 5.5), "wall")      # header L
S.box((-1.75, -4.75, 0.25), (-1.5, -4.5, 5.5), "wall")     # pier mid-L
S.box((-1.5, -4.75, 3.5), (1.5, -4.5, 5.5), "wall")        # header door
S.box((1.5, -4.75, 0.25), (1.75, -4.5, 5.5), "wall")       # pier mid-R
S.box((1.75, -4.75, 0.25), (4.5, -4.5, 1.0), "wall")       # sill R
S.box((1.75, -4.75, 3.5), (4.5, -4.5, 5.5), "wall")        # header R
S.box((4.5, -4.75, 0.25), (4.75, -4.5, 5.5), "wall")       # pier R
S.box((-4.75, -4.75, 5.5), (4.75, -4.5, 6.0), "wall_dark")  # parapet
S.box((-5, -4.5, 5.25), (5, 5, 5.5), "wall_dark")           # roof

# door trim (clear opening x [-1.25, 1.25], z to 3.25)
S.box((-1.5, -4.8, 0.25), (-1.25, -4.45, 3.25), "trim")
S.box((1.25, -4.8, 0.25), (1.5, -4.45, 3.25), "trim")
S.box((-1.5, -4.8, 3.25), (1.5, -4.45, 3.5), "trim")

# window trim + glazing (inner rect keeps glass clear of trim)
for xa, xb in ((-4.5, -1.75), (1.75, 4.5)):
    S.box((xa, -4.8, 1.0), (xb, -4.45, 1.08), "trim")
    S.box((xa, -4.8, 3.42), (xb, -4.45, 3.5), "trim")
    S.box((xa, -4.8, 1.08), (xa + 0.08, -4.45, 3.42), "trim")
    S.box((xb - 0.08, -4.8, 1.08), (xb, -4.45, 3.42), "trim")
    W.quad_front(xa + 0.08, xb - 0.08, 1.08, 3.42, -4.62)

# sign: backer box + atlas quad + neon underline (in the y [-5,-4.75] reserve)
S.box((-2.65, -4.93, 3.85), (2.65, -4.75, 4.85), "trim")
A.quad_front(-2.4, 2.4, 3.975, 4.725, -4.931, "sign")
E.box((-2.4, -4.93, 3.79), (2.4, -4.87, 3.84), "emis_magenta")

# awnings (neon strips over openings)
E.box((-4.5, -4.85, 3.55), (-1.75, -4.75, 3.65), "emis_cyan")
E.box((1.75, -4.85, 3.55), (4.5, -4.75, 3.65), "emis_cyan")
E.box((-1.5, -4.85, 3.55), (1.5, -4.75, 3.65), "emis_magenta")

# logo mat on the runway
A.quad_up(-0.5, 0.5, -4.3, -3.3, 0.281, "logo")

# window display platforms + product minis
for sgn in (-1, 1):
    xa, xb = (-4.5, -1.9) if sgn < 0 else (1.9, 4.5)
    S.box((xa, -4.45, 0.25), (xb, -3.7, 0.95), "counter")
    S.box((xa, -4.5, 0.95), (xb, -3.65, 1.05), "counter_top")
    cells = ["cyan", "magenta", "yellow", "violet"]
    for i in range(4):
        cx = xa + 0.35 + i * ((xb - xa - 0.9) / 3.0)
        h = 0.42 if i % 2 == 0 else 0.55
        S.box((cx, -4.25, 1.05), (cx + 0.35, -3.95, 1.05 + h), cells[i])

# back wall: poster (framed) + live panel (framed, glowing)
S.box((-3.5, 4.6, 1.1), (-1.3, 4.75, 4.0), "trim")
A.quad_front(-3.27, -1.53, 1.35, 3.85, 4.599, "poster")
S.box((1.3, 4.6, 2.2), (3.7, 4.75, 4.2), "trim")
E.box((1.5, 4.54, 2.28), (3.5, 4.6, 2.36), "emis_cyan")

# cove neon along the back wall top
E.box((-4.5, 4.69, 4.85), (4.5, 4.75, 4.95), "emis_magenta")

# mascot plinth + hovering voxel bolt
S.box((-0.9, 2.0, 0.25), (0.9, 3.2, 0.5), "trim")
S.box((-0.75, 2.15, 0.5), (0.75, 3.05, 0.75), "plinth")
E.box((-0.78, 2.12, 0.5), (0.78, 2.15, 0.56), "emis_magenta")
E.box((-0.78, 3.05, 0.5), (0.78, 3.08, 0.56), "emis_magenta")
E.box((-0.78, 2.15, 0.5), (-0.75, 3.05, 0.56), "emis_magenta")
E.box((0.75, 2.15, 0.5), (0.78, 3.05, 0.56), "emis_magenta")

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
BC = 0.15  # mascot voxel size — props may use a finer grid than structure
for r, row in enumerate(BOLT):
    z1 = 2.85 - r * BC
    for c, ch in enumerate(row):
        if ch == "X":
            x0 = (c - 6) * BC
            E.box((x0, 2.45, z1 - BC), (x0 + BC, 2.75, z1), "emis_yellow")

# shelving, left wall: 2 backlit units with product cartridges
for y0, y1 in ((-3.75, -1.0), (0.25, 3.0)):
    S.box((-4.75, y0, 0.25), (-3.95, y0 + 0.12, 3.6), "steel")
    S.box((-4.75, y1 - 0.12, 0.25), (-3.95, y1, 3.6), "steel")
    E.box((-4.75, y0 + 0.12, 0.9), (-4.72, y1 - 0.12, 2.8), "emis_cyan")
    cells = ["cyan", "magenta", "yellow", "violet", "white"]
    for si, zs in enumerate((0.9, 1.8, 2.7)):
        S.box((-4.72, y0 + 0.12, zs), (-3.95, y1 - 0.12, zs + 0.1), "shelf")
        for i in range(6):
            yy = y0 + 0.25 + i * 0.4
            h = 0.42 if (i + si) % 2 == 0 else 0.55
            cell = cells[(i * 7 + si * 3) % 5]
            S.box((-4.55, yy, zs + 0.1), (-4.2, yy + 0.28, zs + 0.1 + h), cell)

# counter, right side, with laptop
S.box((2.7, 0.6, 0.25), (4.6, 1.5, 1.2), "counter")
S.box((2.6, 0.5, 1.2), (4.7, 1.6, 1.32), "counter_top")
E.box((2.7, 0.56, 0.72), (4.6, 0.6, 0.8), "emis_cyan")
S.box((3.3, 0.9, 1.32), (3.9, 1.3, 1.36), "trim")
S.box((3.3, 1.28, 1.36), (3.9, 1.32, 1.78), "trim")
E.box((3.34, 1.275, 1.4), (3.86, 1.28, 1.74), "emis_cyan")

# link kiosk (the clickable fixture) near the door
S.box((2.75, -2.48, 0.25), (2.95, -2.37, 0.9), "steel")
S.box((3.95, -2.48, 0.25), (4.15, -2.37, 0.9), "steel")
S.box((2.6, -2.5, 0.9), (4.3, -2.35, 2.25), "trim")
A.quad_front(2.65, 4.25, 1.0, 2.2, -2.501, "link")
E.box((2.6, -2.5, 2.25), (4.3, -2.35, 2.31), "emis_yellow")

# ceiling light bars
for cx in (-3.0, 0.0, 3.0):
    E.box((cx - 0.25, -2.5, 5.15), (cx + 0.25, 3.5, 5.25), "emis_warm")

# wall-mounted TV above the left shelving — 16:9 surface for the media system.
# The screen face is its OWN object named "screen_1" (named-node contract):
# the client swaps its material for a video texture.
S.box((-4.75, -3.44, 3.72), (-4.60, -1.32, 4.98), "trim")

structure = S.finish()
emissive = E.finish()
art = A.finish()
glass = W.finish()

# Media surfaces (screen_1, panel_live) carry FULL 0..1 UVs — the client swaps
# in video/feed textures, which only map correctly on a full-range UV quad.
FULL_UVS = [(0, 0), (1, 0), (1, 1), (0, 1)]

SCR = Bucket("screen_1", [mat_voxel])
SCR.quad([(-4.595, -3.36, 3.80), (-4.595, -1.40, 3.80),
          (-4.595, -1.40, 4.90), (-4.595, -3.36, 4.90)], FULL_UVS)
SCR.finish()

# live panel as its own node: the city re-renders it from the project's data
# feed on a cooldown (city polls server-side; client just swaps the texture)
PANEL = Bucket("panel_live", [mat_art])
PANEL.quad([(1.5, 4.599, 2.45), (3.5, 4.599, 2.45),
            (3.5, 4.599, 3.95), (1.5, 4.599, 3.95)], FULL_UVS)
PANEL.finish()
structure["otra_project"] = "PromptFrenzy"
structure["otra_url"] = "https://promptfrenzy.dev"
structure["otra_lot"] = "10x10x6"

# sliding door panels — separate named nodes so the client can animate them.
# Built CLOSED (panels meet at x=0); the client slides them +-1.2 to open.
for suffix, xa, xb in (("L", -1.25, 0.0), ("R", 0.0, 1.25)):
    D = Bucket("door_panel_" + suffix, [mat_voxel, mat_glass])
    D.box((xa, -4.68, 0.3), (xa + 0.05, -4.57, 3.2), "door")
    D.box((xb - 0.05, -4.68, 0.3), (xb, -4.57, 3.2), "door")
    D.box((xa + 0.05, -4.68, 0.3), (xb - 0.05, -4.57, 0.45), "door")
    D.box((xa + 0.05, -4.68, 3.1), (xb - 0.05, -4.57, 3.2), "door")
    D.quad_front(xa + 0.05, xb - 0.05, 0.45, 3.1, -4.625, None, 1)
    D.finish()

# -------------------------------------------------------------------- lights
def point_light(name, loc, color, watts, radius=0.35):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.color = color
    ld.energy = watts
    ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    col.objects.link(ob)
    return ob


point_light("light_key", (0, 0.2, 4.7), (1.0, 0.82, 0.65), 350)
point_light("light_accent", (0, 1.9, 2.0), (1.0, 0.25, 0.62), 100)
point_light("light_shelf", (-3.8, 0.6, 4.4), (0.35, 0.9, 1.0), 60)

# --------------------------------------------------------------------- stats
tot = 0
mn = [9e9] * 3
mx = [-9e9] * 3
for o in col.objects:
    if o.type != 'MESH':
        continue
    o.data.calc_loop_triangles()
    tot += len(o.data.loop_triangles)
    for vco in o.data.vertices:
        for i in range(3):
            mn[i] = min(mn[i], vco.co[i])
            mx[i] = max(mx[i], vco.co[i])
print("BUILD OK in %.1fs" % (time.time() - T0))
print("objects:", sorted(o.name for o in col.objects))
print("triangles:", tot)
print("bbox min:", [round(v, 3) for v in mn], "max:", [round(v, 3) for v in mx])
print("materials:", [m.name for m in bpy.data.materials if m.name.startswith("otra_")])
