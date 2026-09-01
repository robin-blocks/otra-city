# Render PromptFrenzy's screen content: a 6 s orbit of the bolt mascot,
# H.264 mp4 via Blender's bundled FFmpeg. This is the demo "video asset" an
# agent would submit for a screen slot.
import glob
import math
import os

import bpy
from mathutils import Vector

REPO = "/Users/robin/Code/personal/otra-city-3d"
MEDIA = os.path.join(REPO, "poc", "assets", "media")
os.makedirs(MEDIA, exist_ok=True)
scene = bpy.context.scene

for name in ("VIDEO_PIVOT", "VIDEO_CAM"):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)

# only the shop on camera — every plot collection is built at the origin
hidden = []
for c in bpy.data.collections:
    if c.name in ("PromptFrenzyShop", "RENDER_ONLY"):
        continue
    for o in c.objects:
        if not o.hide_render:
            o.hide_render = True
            hidden.append(o)

pivot = bpy.data.objects.new("VIDEO_PIVOT", None)
pivot.location = (0, 2.6, 1.9)  # bolt centre
scene.collection.objects.link(pivot)

cam_data = bpy.data.cameras.new("VIDEO_CAM")
cam_data.lens = 32
cam = bpy.data.objects.new("VIDEO_CAM", cam_data)
cam.parent = pivot
cam.location = (0, -4.4, 0.7)
d = Vector((0, 4.4, -0.5))
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(cam)

pivot.rotation_euler = (0, 0, 0)
pivot.keyframe_insert("rotation_euler", frame=1)
pivot.rotation_euler = (0, 0, 2 * math.pi)
pivot.keyframe_insert("rotation_euler", frame=145)
ad = pivot.animation_data
try:
    fcurves = ad.action.fcurves  # pre-4.4 actions
except AttributeError:  # 4.4+ slotted/layered actions
    fcurves = ad.action.layers[0].strips[0].channelbag(ad.action_slot).fcurves
for fc in fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = 'LINEAR'

old = {
    "cam": scene.camera, "fs": scene.frame_start, "fe": scene.frame_end,
    "rx": scene.render.resolution_x, "ry": scene.render.resolution_y,
    "fmt": scene.render.image_settings.file_format, "fp": scene.render.filepath,
    "fps": scene.render.fps,
    "media": getattr(scene.render.image_settings, "media_type", None),
}
if hasattr(scene.render.image_settings, "media_type"):
    scene.render.image_settings.media_type = 'VIDEO'  # Blender 5.x gates FFMPEG behind this
scene.camera = cam
scene.frame_start, scene.frame_end = 1, 144
scene.render.fps = 24
scene.render.resolution_x, scene.render.resolution_y = 640, 360
scene.render.image_settings.file_format = 'FFMPEG'
scene.render.ffmpeg.format = 'MPEG4'
scene.render.ffmpeg.codec = 'H264'
scene.render.ffmpeg.constant_rate_factor = 'MEDIUM'
scene.render.ffmpeg.audio_codec = 'NONE'
scene.render.filepath = os.path.join(MEDIA, "pf_demo_")

bpy.ops.render.render(animation=True)

produced = sorted(glob.glob(os.path.join(MEDIA, "pf_demo_*.mp4")))
final = os.path.join(MEDIA, "promptfrenzy_demo.mp4")
if produced:
    if os.path.exists(final):
        os.remove(final)
    os.rename(produced[-1], final)
    print("video:", final, os.path.getsize(final), "bytes")
else:
    print("ERROR: no mp4 produced")

# restore (fall back to the shared preview camera if the saved one is gone)
scene.camera = old["cam"] or bpy.data.objects.get("POC_CAM")
scene.frame_start, scene.frame_end = old["fs"], old["fe"]
scene.render.resolution_x, scene.render.resolution_y = old["rx"], old["ry"]
if old["media"] is not None:
    scene.render.image_settings.media_type = old["media"]
scene.render.image_settings.file_format = old["fmt"]
scene.render.filepath = old["fp"]
scene.render.fps = old["fps"]
for name in ("VIDEO_CAM", "VIDEO_PIVOT"):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
for o in hidden:
    o.hide_render = False
print("RENDER DONE")
