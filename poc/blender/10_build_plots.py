# Three FREE-FORM plots for the standard otra.city lot (10 x 10 x 6 m, front -Y):
#   SculpturePlot — "beacon" monument on an open plaza (no building at all)
#   GardenPlot    — glowing night garden (landscape plot, tests open frontage)
#   TowerPlot     — dark relay-tower monolith (building, but not a shop)
# Same envelope + budgets as shops; only 2 materials each (voxel + emissive).
# Each is built at origin in its own collection, previewed side by side, then
# exported to its own Draco .glb.
import json
import os
import random

import bmesh
import bpy

REPO = "/Users/robin/Code/personal/otra-city-3d"
ASSETS = os.path.join(REPO, "poc", "assets")
OUT = os.path.join(REPO, "poc", "out")
random.seed(7)

with open(os.path.join(ASSETS, "palette_map.json")) as f:
    PMAP = json.load(f)
G = PMAP["grid"]

# refresh palette pixels (new colors were appended) and reuse the shop materials
img = bpy.data.images.get("palette.png")
if img:
    img.reload()
else:
    img = bpy.data.images.load(os.path.join(ASSETS, "palette.png"))
    img.name = "palette.png"
mat_voxel = bpy.data.materials["otra_voxel"]
mat_emis = bpy.data.materials["otra_emissive"]


def cell_uv(cname):
    c, r = PMAP["colors"][cname]["cell"]
    return ((c + 0.5) / G, 1.0 - (r + 0.5) / G)


class Bucket:
    def __init__(self, name, mat):
        self.name, self.mat = name, mat
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def box(self, mn, mx, cname):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        v = [self.bm.verts.new(p) for p in (
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
        uv = cell_uv(cname)
        for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                    (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            f = self.bm.faces.new([v[i] for i in idx])
            for lo in f.loops:
                lo[self.uv].uv = uv

    def finish(self, col):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        mesh.materials.append(self.mat)
        ob = bpy.data.objects.new(self.name, mesh)
        col.objects.link(ob)
        return ob


def cube_frame(B, c, s, t, cell):
    """12-edge wireframe cube from boxes — the sculpture's floating rings."""
    h, (cx, cy, cz) = s / 2.0, c
    for sx in (-1, 1):
        for sy in (-1, 1):
            B.box((cx + sx * h - t / 2, cy + sy * h - t / 2, cz - h),
                  (cx + sx * h + t / 2, cy + sy * h + t / 2, cz + h), cell)
    for sz in (-1, 1):
        for sy in (-1, 1):
            B.box((cx - h, cy + sy * h - t / 2, cz + sz * h - t / 2),
                  (cx + h, cy + sy * h + t / 2, cz + sz * h + t / 2), cell)
        for sx in (-1, 1):
            B.box((cx + sx * h - t / 2, cy - h, cz + sz * h - t / 2),
                  (cx + sx * h + t / 2, cy + h, cz + sz * h + t / 2), cell)


def fresh_collection(name):
    col = bpy.data.collections.get(name)
    if col:
        for o in list(col.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(col)
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


# ------------------------------------------------------------- SculpturePlot
def build_sculpture(col):
    S = Bucket("sculpture_structure", mat_voxel)
    E = Bucket("sculpture_emissive", mat_emis)
    S.box((-5, -5, 0), (5, 5, 0.25), "stone")                      # plaza
    E.box((-4.5, -0.07, 0.25), (4.5, 0.07, 0.28), "emis_cyan")     # inlay cross
    E.box((-0.07, -4.5, 0.25), (0.07, 4.5, 0.28), "emis_cyan")
    r = 3.0
    for a, b in (((-r, -r), (r, -r + 0.15)), ((-r, r - 0.15), (r, r)),
                 ((-r, -r), (-r + 0.15, r)), ((r - 0.15, -r), (r, r))):
        E.box((a[0], a[1], 0.25), (b[0], b[1], 0.28), "emis_violet")  # inlay ring
    for s, z0, z1 in ((3.0, 0.25, 0.7), (2.25, 0.7, 1.15), (1.5, 1.15, 1.5)):
        S.box((-s / 2, -s / 2, z0), (s / 2, s / 2, z1), "stone")   # tiered plinth
    # core + rings as separate named nodes: the plot manifest declares client
    # animations on them (spinner/bobber) — geometry stays static in the glb
    CORE = Bucket("core_cube", mat_emis)
    CORE.box((-0.375, -0.375, 2.625), (0.375, 0.375, 3.375), "emis_white")
    CORE.finish(col)
    R1 = Bucket("ring_inner", mat_emis)
    cube_frame(R1, (0, 0, 3.0), 1.9, 0.15, "emis_cyan")
    R1.finish(col)
    R2 = Bucket("ring_outer", mat_emis)
    cube_frame(R2, (0, 0, 3.0), 3.0, 0.15, "emis_violet")
    R2.finish(col)
    for x, y, z, c in ((1.9, 0.8, 2.0, "emis_cyan"), (-2.1, -0.6, 3.9, "emis_lily"),
                       (0.7, -1.9, 4.4, "emis_cyan"), (-1.2, 1.8, 1.9, "emis_lily"),
                       (2.2, -1.4, 3.3, "emis_violet")):
        E.box((x - 0.15, y - 0.15, z - 0.15), (x + 0.15, y + 0.15, z + 0.15), c)
    for sx in (-1, 1):
        for sy in (-1, 1):
            S.box((sx * 4.3 - 0.2, sy * 4.3 - 0.2, 0.25), (sx * 4.3 + 0.2, sy * 4.3 + 0.2, 2.3), "trim")
            E.box((sx * 4.3 - 0.22, sy * 4.3 - 0.22, 2.3), (sx * 4.3 + 0.22, sy * 4.3 + 0.22, 2.7), "emis_warm")
    S.finish(col)
    E.finish(col)


# ---------------------------------------------------------------- GardenPlot
def build_garden(col):
    S = Bucket("garden_structure", mat_voxel)
    E = Bucket("garden_emissive", mat_emis)
    S.box((-5, -5, 0), (5, 5, 0.25), "grass_dark")
    for _ in range(16):  # raised grass patches (origin range keeps x+s inside the lot)
        x, y = random.uniform(-4.5, 3.5), random.uniform(-4.5, 3.5)
        s = random.choice((0.5, 0.75, 1.0))
        S.box((x, y, 0.25), (x + s, y + s, 0.25 + random.choice((0.1, 0.2))), "grass")
    for x, y in ((0, -4.5), (-0.6, -3.6), (-1.0, -2.6), (-0.6, -1.6),
                 (0.2, -0.8), (1.0, 0.2), (1.4, 1.0)):  # winding path
        S.box((x - 0.35, y - 0.35, 0.25), (x + 0.35, y + 0.35, 0.31), "plinth")
    # pond with stone rim + lilies
    S.box((0.25, 1.25, 0.25), (3.75, 4.25, 0.5), "stone")
    S.box((0.55, 1.55, 0.25), (3.45, 3.95, 0.55), "water")
    for x, y, c in ((1.2, 2.2, "leaf"), (2.6, 3.2, "leaf"), (2.0, 2.6, "emis_lily"),
                    (1.5, 3.4, "emis_lily"), (2.9, 2.0, "emis_lily")):
        S2 = E if c.startswith("emis") else S
        S2.box((x - 0.15, y - 0.15, 0.55), (x + 0.15, y + 0.15, 0.62), c)
    # voxel trees
    for tx, ty in ((-3.0, -2.5), (-2.8, 3.0), (3.2, -2.6)):
        S.box((tx - 0.25, ty - 0.25, 0.25), (tx + 0.25, ty + 0.25, 2.5), "trunk")
        S.box((tx - 1.1, ty - 1.1, 2.5), (tx + 1.1, ty + 1.1, 4.25), "leaf")
        S.box((tx - 0.7, ty - 0.7, 4.25), (tx + 0.7, ty + 0.7, 5.0), "leaf")
        S.box((tx + 0.6, ty - 1.6, 3.0), (tx + 1.6, ty - 0.6, 4.0), "leaf")
        for i in range(3):
            fx = tx + random.uniform(-1.0, 1.0)
            fy = ty + random.uniform(-1.0, 1.0)
            fz = random.uniform(2.8, 4.6)
            E.box((fx, fy, fz), (fx + 0.18, fy + 0.18, fz + 0.18),
                  "emis_yellow" if i == 0 else "emis_leaf")
    # glowing mushroom clusters
    for mx, my, cap in ((-4.0, 0.5, "emis_magenta"), (3.0, 3.9, "emis_cyan"),
                        (-1.8, 2.1, "emis_yellow"), (2.6, -3.8, "emis_violet")):
        for k in range(2):
            ox, oy = mx + k * 0.5, my + k * 0.35
            h = 0.55 + k * 0.25
            S.box((ox - 0.09, oy - 0.09, 0.25), (ox + 0.09, oy + 0.09, 0.25 + h), "white")
            E.box((ox - 0.3, oy - 0.3, 0.25 + h), (ox + 0.3, oy + 0.3, 0.45 + h), cap)
    # lanterns along the path + fireflies
    for lx, ly in ((-1.3, -3.2), (0.6, -1.2), (2.0, 0.7)):
        S.box((lx - 0.06, ly - 0.06, 0.25), (lx + 0.06, ly + 0.06, 1.85), "trim")
        E.box((lx - 0.16, ly - 0.16, 1.85), (lx + 0.16, ly + 0.16, 2.15), "emis_warm")
    for _ in range(9):
        fx, fy = random.uniform(-4.5, 4.5), random.uniform(-4.5, 4.5)
        fz = random.uniform(1.1, 2.7)
        E.box((fx, fy, fz), (fx + 0.09, fy + 0.09, fz + 0.09), "emis_leaf")
    S.finish(col)
    E.finish(col)


# ----------------------------------------------------------------- TowerPlot
def build_tower(col):
    S = Bucket("tower_structure", mat_voxel)
    E = Bucket("tower_emissive", mat_emis)
    S.box((-5, -5, 0), (5, 5, 0.25), "gravel")
    S.box((-3.5, 0.5, 0.25), (0.5, 4.5, 5.5), "trim")        # monolith
    S.box((0.5, 1.0, 0.25), (4.0, 4.5, 2.75), "wall_dark")   # annex
    S.box((1.75, 0.95, 0.25), (2.75, 1.0, 2.25), "door")     # sealed entry
    S.box((1.75, -5.0, 0.25), (2.75, 0.95, 0.31), "plinth")  # entry path
    E.box((1.75, 0.93, 2.3), (2.75, 1.0, 2.4), "emis_warm")  # entry lintel glow
    # status-light window grid on the monolith face
    for i in range(7):
        for j in range(8):
            lit = (i * 7 + j * 5) % 5
            if lit > 2:
                continue
            wx = -3.2 + i * 0.5
            wz = 0.8 + j * 0.58
            E.box((wx, 0.42, wz), (wx + 0.3, 0.5, wz + 0.38),
                  "emis_cyan" if lit < 2 else "emis_warm")
    for py in (1.5, 2.6):  # side conduits
        S.box((-3.62, py, 0.25), (-3.5, py + 0.14, 5.0), "steel")
    S.box((-1.2, 3.6, 5.5), (-0.4, 4.4, 6 - 1.75), "wall_dark")  # rooftop hvac
    for mx, my, h, tipc in ((-2.8, 2.0, 6.0, "emis_red"), (-1.4, 3.3, 5.75, "emis_cyan"),
                            (-0.2, 1.2, 5.6, "emis_red")):
        S.box((mx - 0.06, my - 0.06, 5.5), (mx + 0.06, my + 0.06, h - 0.14), "steel")
        E.box((mx - 0.08, my - 0.08, h - 0.14), (mx + 0.08, my + 0.08, h), tipc)
    S.finish(col)
    E.finish(col)


BUILDERS = {
    "SculpturePlot": (build_sculpture, "sculpture.glb"),
    "GardenPlot": (build_garden, "garden.glb"),
    "TowerPlot": (build_tower, "tower.glb"),
}
for name, (fn, _) in BUILDERS.items():
    fn(fresh_collection(name))

# stats
for name in BUILDERS:
    col = bpy.data.collections[name]
    tot, mn, mx = 0, [9e9] * 3, [-9e9] * 3
    for o in col.objects:
        o.data.calc_loop_triangles()
        tot += len(o.data.loop_triangles)
        for v in o.data.vertices:
            for i in range(3):
                mn[i] = min(mn[i], v.co[i])
                mx[i] = max(mx[i], v.co[i])
    print(name, "tris:", tot, "bbox:", [round(v, 2) for v in mn], [round(v, 2) for v in mx])

# side-by-side preview render (hide the shop + template so only plots show)
hidden = []
for cname in ("PromptFrenzyShop", "OTRA_TEMPLATE"):
    c = bpy.data.collections.get(cname)
    if c:
        for o in c.objects:
            if not o.hide_render:
                o.hide_render = True
                hidden.append(o)
pv = fresh_collection("PLOT_PREVIEW")
# unlink the source collections so only the offset instances render (relinked below)
for name in BUILDERS:
    bpy.context.scene.collection.children.unlink(bpy.data.collections[name])
for i, name in enumerate(BUILDERS):
    inst = bpy.data.objects.new("inst_" + name, None)
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = bpy.data.collections[name]
    inst.location = ((i - 1) * 13, 0, 0)
    pv.objects.link(inst)
sun = bpy.data.lights.new("preview_sun", 'SUN')
sun.energy = 1.0
sun.color = (0.7, 0.75, 1.0)
so = bpy.data.objects.new("preview_sun", sun)
so.rotation_euler = (0.9, 0.3, 2.2)
pv.objects.link(so)
cam = bpy.data.objects["POC_CAM"]
bpy.context.scene.camera = cam
cam.location = (0, -26, 10)
from mathutils import Vector
d = Vector((0, 0, 1.6)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
scene = bpy.context.scene
scene.render.resolution_x = 1680
scene.render.resolution_y = 640
scene.render.filepath = os.path.join(OUT, "plots_preview.png")
bpy.ops.render.render(write_still=True)
for o in list(pv.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.data.collections.remove(pv)
for name in BUILDERS:
    bpy.context.scene.collection.children.link(bpy.data.collections[name])
for o in hidden:
    o.hide_render = False
print("preview rendered")

# export each plot
avail = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
base = {
    "export_format": 'GLB', "use_selection": True, "export_apply": True,
    "export_yup": True, "export_lights": True, "export_cameras": False,
    "export_extras": True, "export_animations": False, "export_skins": False,
    "export_morph": False, "export_image_format": 'AUTO',
    "export_draco_mesh_compression_enable": True,
    "export_draco_mesh_compression_level": 6,
}
for name, (_, outname) in BUILDERS.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.collections[name].objects:
        o.select_set(True)
    kwargs = {k: v for k, v in base.items() if k in avail or k == "export_format"}
    kwargs["filepath"] = os.path.join(OUT, outname)
    bpy.ops.export_scene.gltf(**kwargs)
    print("exported", outname, os.path.getsize(kwargs["filepath"]), "bytes")

bpy.ops.wm.save_mainfile()
print("DONE")
