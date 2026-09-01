"""Startup script for a dedicated otra.city PoC Blender instance.

Launch:  /Applications/Blender.app/Contents/MacOS/Blender --python tools/blender/start_bridge.py

Loads the vendored BlenderMCP addon (tools/blender/addon.py), registers it and
starts the bridge server on localhost:9876 — the same thing the addon's
"Start MCP Server" button does. Progress is appended to poc/out/bridge_boot.log
so the launching shell can verify liveness without the GUI.
"""
import os
import traceback

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ADDON = os.path.join(REPO, "tools", "blender", "addon.py")
PORT = int(os.environ.get("OTRA_BRIDGE_PORT", "9876"))
LOG = os.environ.get("OTRA_BRIDGE_LOG", os.path.join(REPO, "poc", "out", "bridge_boot.log"))
os.makedirs(os.path.dirname(LOG), exist_ok=True)


def log(msg):
    with open(LOG, "a") as f:
        f.write(msg + "\n")
    print("[otra-bridge]", msg)


try:
    ns = {"__name__": "otra_blendermcp", "__file__": ADDON}
    with open(ADDON) as f:
        exec(compile(f.read(), ADDON, "exec"), ns)
    ns["register"]()
    log("addon registered (blender %s)" % bpy.app.version_string)

    def _start_server():
        try:
            scene = bpy.context.scene
            scene.blendermcp_use_polyhaven = True  # per plan: test external asset pulls
            server = ns["BlenderMCPServer"](port=PORT)
            bpy.types.blendermcp_server = server
            server.start()
            scene.blendermcp_server_running = True
            log("bridge listening on localhost:%d" % PORT)
        except Exception:
            log("server start FAILED:\n" + traceback.format_exc())
        return None  # one-shot timer

    # Defer to a timer so the server starts after Blender finishes booting,
    # with a normal main-thread context.
    bpy.app.timers.register(_start_server, first_interval=0.5)
    log("server start scheduled")
except Exception:
    log("addon boot FAILED:\n" + traceback.format_exc())
