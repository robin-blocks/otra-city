# Boulevard film for City Hall's screen_1: import every live plot, rebuild the
# street around them, and render a slow night orbit of the whole boulevard.
# Runs inside the bridged Blender. OTRA_FILM_FRAMES=1 renders a single test still.
import json
import math
import os
import time

import bpy
from mathutils import Vector

T0 = time.time()
REPO = globals().get("OTRA_REPO", "/Users/robin/Code/personal/otra-city-3d")
FRAMES = int(globals().get("OTRA_FILM_FRAMES", 480))
FPS = 20
OUT = os.path.join(REPO, "public", "plots", "city-hall", "media", "boulevard.mp4")
STILL = os.path.join(REPO, "poc", "city-hall", "out", "film_still.png")
INDEX = json.load(open(os.path.join(REPO, "public", "plots", "index.json")))

# fresh scene so the City Hall build scene stays untouched
old = bpy.data.scenes.get("Boulevard")
if old:
    oc = bpy.data.collections.get("BoulevardFilm")
    if oc:
        for o in list(oc.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(oc)
    bpy.data.scenes.remove(old)
    for d in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras, bpy.data.images, bpy.data.materials):
        for x in list(d):
            if x.users == 0:
                d.remove(x)
sc = bpy.data.scenes.new("Boulevard")
bpy.context.window.scene = sc
col = bpy.data.collections.new("BoulevardFilm")
sc.collection.children.link(col)


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def flat_mat(name, rgb, emis=None, strength=1.0, rough=0.9):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = principled(m)
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    if emis:
        b.inputs["Emission Color"].default_value = (*emis, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def box(name, mn, mx, mat):
    x0, y0, z0 = mn
    x1, y1, z1 = mx
    me = bpy.data.meshes.new(name)
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    me.from_pydata(v, [], [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def srgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple((int(h[i:i + 2], 16) / 255.0) ** 2.2 for i in (0, 2, 4))


# street (mirrors public/js/street.js; Blender y = -world z)
asphalt = flat_mat("f_asphalt", srgb("#17161c"))
paving = flat_mat("f_paving", srgb("#24222c"))
dark = flat_mat("f_dark", srgb("#241f38"))
warm = flat_mat("f_warm", srgb("#0d0a14"), srgb("#ffbf80"), 2.5)
cyan = flat_mat("f_cyan", srgb("#0d0a14"), srgb("#47f2ff"), 1.4)
box("road", (-42, -4, -0.11), (42, 4, 0.01), asphalt)
box("walk_n", (-42, -6.5, -0.15), (42, -4, 0.15), paving)
box("walk_s", (-42, 4, -0.15), (42, 6.5, 0.15), paving)
box("ground", (-80, -80, -0.2), (80, 80, -0.19), flat_mat("f_ground", (0.03, 0.028, 0.045)))
for x in range(-30, 31, 4):
    box("dash_%d" % x, (x - 0.45, -0.08, 0.01), (x + 0.45, 0.08, 0.04), warm)
for i, lx in enumerate((-30, -18, -6, 6, 18, 30)):
    lz = (-1 if i % 2 == 0 else 1) * 6.2
    ly = -lz
    box("pole_%d" % i, (lx - 0.07, ly - 0.07, 0), (lx + 0.07, ly + 0.07, 3.3), dark)
    box("lamp_%d" % i, (lx - 0.17, ly - 0.17, 3.3), (lx + 0.17, ly + 0.17, 3.44), warm)
    ld = bpy.data.lights.new("lamplight_%d" % i, 'POINT')
    ld.energy = 220
    ld.color = (1.0, 0.75, 0.5)
    ld.shadow_soft_size = 0.4
    lo = bpy.data.objects.new("lamplight_%d" % i, ld)
    lo.location = (lx, ly, 3.4)
    col.objects.link(lo)
for v in INDEX.get("vacant", []):
    vx, vy = v["x"], -v["z"]                       # Blender y is -world z; the manifest carries the lot centre
    box("vac_%s" % v["lot"], (vx - 5, vy - 5, 0), (vx + 5, vy + 5, 0.1), flat_mat("f_vac", srgb("#1b1926")))
    for (a, b_, c, d) in ((-5, -5, 5, -4.9), (-5, 4.9, 5, 5), (-5, -5, -4.9, 5), (4.9, -5, 5, 5)):
        box("vacl", (vx + a, vy + b_, 0.1), (vx + c, vy + d, 0.14), cyan)
    box("vacm", (vx - 0.22, vy - 0.22, 1.7), (vx + 0.22, vy + 0.22, 2.14), cyan)

# every plot, placed like the client does
for lot in INDEX["lots"]:
    path = os.path.join(REPO, "public", "plots", lot["slug"], "plot.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new("plot_" + lot["slug"], None)
    col.objects.link(root)
    root.location = (lot["x"], -lot["z"], 0)
    root.rotation_euler = (0, 0, lot["yaw"])        # three.js rotation.y and Blender's z rotation agree in sign
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
        if o.parent is None:
            o.parent = root
        if o.type == 'LIGHT':
            o.data.energy = min(o.data.energy, 60)
    print("placed", lot["slug"], len(new), "objects")

# world + bloom
world = bpy.data.worlds.new("FilmWorld")
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs[0].default_value = (0.028, 0.024, 0.055, 1)
sc.world = world
moon = bpy.data.lights.new("film_moon", 'SUN')
moon.energy = 0.6
moon.color = (0.55, 0.65, 1.0)
mo = bpy.data.objects.new("film_moon", moon)
mo.rotation_euler = (0.9, 0.2, 2.6)
col.objects.link(mo)

sc.render.engine = 'BLENDER_EEVEE'
try:
    sc.eevee.taa_render_samples = 20
except Exception:
    pass
for vt, look in (('Standard', 'None'), ('AgX', 'AgX - Punchy')):
    try:
        sc.view_settings.view_transform = vt
        sc.view_settings.look = look
        break
    except Exception:
        continue
if hasattr(sc, "node_tree") and sc.node_tree is not None:
    sc.use_nodes = True
    nt = sc.node_tree
else:  # Blender 5: the compositor is a node group assigned to the scene
    nt = bpy.data.node_groups.get("FilmComp") or bpy.data.node_groups.new("FilmComp", 'CompositorNodeTree')
    sc.compositing_node_group = nt
for n in list(nt.nodes):
    nt.nodes.remove(n)
rl = nt.nodes.new("CompositorNodeRLayers")
glare = nt.nodes.new("CompositorNodeGlare")
# Blender 5: glare type/params are input sockets (menu + floats); older: properties
if "Type" in glare.inputs:
    for val in ("BLOOM", "Bloom", "FOG_GLOW", "Fog Glow"):
        try:
            glare.inputs["Type"].default_value = val
            break
        except Exception:
            continue
    for inp, val in (("Threshold", 1.0), ("Strength", 0.14), ("Size", 0.55), ("Smoothness", 0.1)):
        if inp in glare.inputs:
            try:
                glare.inputs[inp].default_value = val
            except Exception:
                pass
else:
    for gt in ('BLOOM', 'FOG_GLOW'):
        try:
            glare.glare_type = gt
            break
        except Exception:
            continue
    for attr, val in (("threshold", 1.0), ("mix", 0.0), ("size", 7), ("quality", 'MEDIUM')):
        try:
            setattr(glare, attr, val)
        except Exception:
            pass
try:
    comp = nt.nodes.new("CompositorNodeComposite")
    comp_in = comp.inputs["Image"]
except Exception:  # Blender 5: group output socket instead of a Composite node
    comp = nt.nodes.new("NodeGroupOutput")
    if not any(i.name == "Image" for i in nt.interface.items_tree):
        nt.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
    comp_in = comp.inputs[0]
nt.links.new(rl.outputs["Image"], glare.inputs["Image"])
nt.links.new(glare.outputs["Image"], comp_in)
print("compositor glare ready")

# camera: two dolly shots along the road (east looking at the north row, then
# west looking at the south row) — a cut at each end, so the loop wraps cleanly
cd = bpy.data.cameras.new("FilmCam")
cd.lens = 24
cam = bpy.data.objects.new("FilmCam", cd)
col.objects.link(cam)
sc.camera = cam
sc.frame_start, sc.frame_end = 1, FRAMES
sc.render.fps = FPS


def cam_pose(f):
    t = (f - 1) / max(1, FRAMES)
    if t < 0.5:
        u = t / 0.5
        loc = Vector((-34 + 68 * u, 5.6, 3.9))
        tgt = Vector((loc.x + 4.5, -9.0, 2.3))
    else:
        u = (t - 0.5) / 0.5
        loc = Vector((34 - 68 * u, -5.6, 3.9))
        tgt = Vector((loc.x - 4.5, 9.0, 2.3))
    return loc, tgt


for f in range(1, FRAMES + 1):
    loc, tgt = cam_pose(f)
    cam.location = loc
    cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
    cam.keyframe_insert("location", frame=f)
    cam.keyframe_insert("rotation_euler", frame=f)

sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.render.resolution_percentage = 100
STILL_FRAME = int(globals().get("OTRA_FILM_STILL_FRAME", 1))
if FRAMES == 1 or STILL_FRAME > 1:
    FRAMES_REAL = 480 if FRAMES == 1 else FRAMES
    sc.frame_end = FRAMES_REAL
    for f in range(1, FRAMES_REAL + 1):
        FRAMES = FRAMES_REAL
        loc, tgt = cam_pose(f)
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
    sc.frame_set(STILL_FRAME)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = STILL
    bpy.ops.render.render(write_still=True)
    print("still:", STILL)
else:
    # this Blender build has no FFmpeg writer: PNG frames, encoded afterwards with ffmpeg
    FRAMES_DIR = globals().get("OTRA_FILM_FRAMES_DIR", os.path.join(REPO, "poc", "city-hall", "out", "film_frames"))
    os.makedirs(FRAMES_DIR, exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.filepath = os.path.join(FRAMES_DIR, "f_")
    bpy.ops.render.render(animation=True)
    print("frames:", FRAMES_DIR, len([f for f in os.listdir(FRAMES_DIR) if f.endswith(".png")]))
print("FILM DONE in %.0fs" % (time.time() - T0))
