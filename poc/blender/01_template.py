# otra.city shop template scene — runs inside Blender via the bridge.
# Wipes this (dedicated) instance's default scene, builds the standard-footprint
# template with machine-readable budgets, saves otra-shop-template.blend.
import os

import bmesh
import bpy

REPO = "/Users/robin/Code/personal/otra-city-3d"

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
             bpy.data.lights, bpy.data.cameras):
    for x in list(coll):
        if x.users == 0:
            coll.remove(x)

scene = bpy.context.scene
scene.name = "otra_shop"
scene.unit_settings.system = 'METRIC'

# drop every stray collection so the template ships clean
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)
tcol = bpy.data.collections.new("OTRA_TEMPLATE")
scene.collection.children.link(tcol)

CORNERS = lambda mn, mx: [
    (mn[0], mn[1], mn[2]), (mx[0], mn[1], mn[2]), (mx[0], mx[1], mn[2]), (mn[0], mx[1], mn[2]),
    (mn[0], mn[1], mx[2]), (mx[0], mn[1], mx[2]), (mx[0], mx[1], mx[2]), (mn[0], mx[1], mx[2]),
]
EDGES = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4),
         (0, 4), (1, 5), (2, 6), (3, 7)]


def wire_box(name, mn, mx):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in CORNERS(mn, mx)]
    for a, b in EDGES:
        bm.edges.new((vs[a], vs[b]))
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    ob.display_type = 'WIRE'
    ob.hide_render = True
    tcol.objects.link(ob)
    return ob


fp = wire_box("FOOTPRINT_10x10x6", (-5, -5, 0), (5, 5, 6))
fp["units"] = "meters"
fp["front_face"] = "-Y"
fp["max_triangles"] = 50000
fp["max_materials"] = 4
fp["max_texture_px"] = 1024
fp["max_glb_bytes"] = 8 * 1024 * 1024
fp["spec"] = "poc/plot-spec.json"
# two door markers: the structural rough opening you leave in the wall, and
# the clear aperture your trim may narrow it to (the spec's 2.5 x 3.0)
ro = wire_box("DOOR_ROUGH_OPENING_3x3", (-1.5, -5.0, 0.25), (1.5, -4.4, 3.25))
ro["note"] = "leave this hole in your front wall; jambs/trim may fill it down to the clear opening"
co = wire_box("DOOR_CLEAR_OPENING_2.5x3", (-1.25, -5.0, 0.25), (1.25, -4.4, 3.25))
co["note"] = "must stay unobstructed; door panels (1.25 m each, meeting at x=0) live in the wall depth here"

# avatar-scale mannequin just inside the door: LLM builders size against this
av = wire_box("AVATAR_SCALE_REF", (-0.25, -4.2, 0.25), (0.25, -3.7, 1.67))
av["height_m"] = 1.42
av["eye_height_m"] = 1.15
av["min_passage_width_m"] = 0.9
av["min_headroom_m"] = 2.0
av["max_step_height_m"] = 0.35

path = os.path.join(REPO, "poc", "blender", "otra-shop-template.blend")
bpy.ops.wm.save_as_mainfile(filepath=path, copy=True)
print("template saved:", path)
print("objects:", sorted(o.name for o in bpy.data.objects))
