# Export the shop collection to a Draco-compressed .glb, the way an agent would.
import os

import bpy

REPO = "/Users/robin/Code/personal/otra-city-3d"
OUT = os.path.join(REPO, "poc", "out", "promptfrenzy.glb")

col = bpy.data.collections["PromptFrenzyShop"]
bpy.ops.object.select_all(action='DESELECT')
for o in col.objects:
    o.select_set(True)

avail = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
kwargs = {"filepath": OUT, "export_format": 'GLB'}
optional = {
    "use_selection": True,
    "export_apply": True,
    "export_yup": True,
    "export_lights": True,
    "export_cameras": False,
    "export_extras": True,
    "export_animations": False,
    "export_skins": False,
    "export_morph": False,
    "export_image_format": 'AUTO',
    "export_draco_mesh_compression_enable": True,
    "export_draco_mesh_compression_level": 6,
}
skipped = []
for k, v in optional.items():
    if k in avail:
        kwargs[k] = v
    else:
        skipped.append(k)

bpy.ops.export_scene.gltf(**kwargs)
print("exported:", OUT, os.path.getsize(OUT), "bytes")
if skipped:
    print("unavailable exporter props (blender", bpy.app.version_string + "):", skipped)
