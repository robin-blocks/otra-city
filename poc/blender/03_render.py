# Visual-sanity renders: exterior street view + interior view. EEVEE, night mood.
import os

import bpy
from mathutils import Vector

REPO = "/Users/robin/Code/personal/otra-city-3d"
OUT = os.path.join(REPO, "poc", "out")
scene = bpy.context.scene

# render-only props (ground, moon) — kept out of the export collection
rcol = bpy.data.collections.get("RENDER_ONLY")
if rcol:
    for o in list(rcol.objects):
        bpy.data.objects.remove(o, do_unlink=True)
else:
    rcol = bpy.data.collections.new("RENDER_ONLY")
    scene.collection.children.link(rcol)

import bmesh

gm = bpy.data.meshes.new("ground")
bm = bmesh.new()
v = [bm.verts.new(p) for p in ((-60, -60, -0.01), (60, -60, -0.01),
                               (60, 60, -0.01), (-60, 60, -0.01))]
bm.faces.new(v)
bm.to_mesh(gm)
bm.free()
gmat = bpy.data.materials.get("otra_ground") or bpy.data.materials.new("otra_ground")
gmat.use_nodes = True
pb = next(n for n in gmat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
pb.inputs["Base Color"].default_value = (0.055, 0.05, 0.07, 1)
pb.inputs["Roughness"].default_value = 0.9
gm.materials.append(gmat)
go = bpy.data.objects.new("ground", gm)
rcol.objects.link(go)

moon = bpy.data.lights.new("moon", 'SUN')
moon.energy = 0.5
moon.color = (0.55, 0.65, 1.0)
mo = bpy.data.objects.new("moon", moon)
mo.rotation_euler = (0.9, 0.2, 2.6)
rcol.objects.link(mo)

# street lamps — provided by the city, not the shop (render-only, not exported)
for i, x in enumerate((-3.5, 3.5)):
    sl = bpy.data.lights.new("street_%d" % i, 'POINT')
    sl.energy = 120
    sl.color = (1.0, 0.75, 0.5)
    sl.shadow_soft_size = 0.4
    so = bpy.data.objects.new("street_%d" % i, sl)
    so.location = (x, -8.0, 3.4)
    rcol.objects.link(so)

# world: near-black night sky
world = scene.world or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bgn = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bgn.inputs[0].default_value = (0.012, 0.010, 0.030, 1)
bgn.inputs[1].default_value = 1.0

# camera
cam = bpy.data.objects.get("POC_CAM")
if not cam:
    cd = bpy.data.cameras.new("POC_CAM")
    cam = bpy.data.objects.new("POC_CAM", cd)
    rcol.objects.link(cam)
cam.data.lens = 24
scene.camera = cam


def look_from(loc, target):
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


# engine
eng = {i.identifier for i in
       scene.render.bl_rna.properties['engine'].enum_items}
for cand in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    if cand in eng:
        scene.render.engine = cand
        break
try:
    scene.eevee.taa_render_samples = 64
except Exception:
    pass
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'
except Exception:
    pass

scene.render.resolution_x = 1440
scene.render.resolution_y = 810
scene.render.image_settings.file_format = 'PNG'

shots = {
    "render_exterior.png": ((7.0, -12.5, 2.1), (0.0, -2.0, 2.6)),
    "render_interior.png": ((0.15, -4.05, 1.7), (0.0, 4.5, 2.1)),
}
for fname, (loc, tgt) in shots.items():
    look_from(loc, tgt)
    scene.render.filepath = os.path.join(OUT, fname)
    bpy.ops.render.render(write_still=True)
    print("rendered", fname)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(REPO, "poc", "blender", "promptfrenzy.blend"))
print("saved promptfrenzy.blend")
