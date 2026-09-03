#!/usr/bin/env python3
"""Build the stadium venue in Blender, then fold the build's seat positions
into public/venues/stadium/venue.json and rebuild the index.

Two lanes, picked automatically. If the BlenderMCP addon is listening (a
Blender window is open, see docs/blender), the build runs inside that session
through tools/blender/bridge.py, so what an MCP-connected agent sees is what
this produces. If it is not, the same script runs in a HEADLESS Blender
(`--background`), which needs no window and is how a terminal session — or CI
— can rebuild the venue. `--bridge` or `--headless` forces a lane.

Usage: python3 poc/stadium/run.py [--render] [--no-export] [--shots a,b]
                                  [--bridge | --headless]"""
import json, os, socket, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
args = sys.argv[1:]
shots = None
if "--shots" in args:
    shots = args[args.index("--shots") + 1].split(",")
pre = 'OTRA_REPO = %r\nOTRA_RENDER = %r\nOTRA_EXPORT = %r\nOTRA_SHOTS = %r\n' % (
    REPO, "--render" in args, "--no-export" not in args, shots)
code = pre + open(os.path.join(HERE, "build.py")).read()
tmp = os.path.join(HERE, "out", "_run.py")
os.makedirs(os.path.dirname(tmp), exist_ok=True)
open(tmp, "w").write(code)


def bridge_listening():
    port = int(os.environ.get("OTRA_BRIDGE_PORT", "9876"))
    try:
        with socket.create_connection(("localhost", port), timeout=1.5):
            return True
    except OSError:
        return False


def blender_binary():
    env = os.environ.get("BLENDER")
    if env and os.path.exists(env):
        return env
    for cand in ("/Applications/Blender.app/Contents/MacOS/Blender",
                 "/usr/local/bin/blender", "/usr/bin/blender"):
        if os.path.exists(cand):
            return cand
    from shutil import which
    return which("blender")


use_bridge = "--bridge" in args or (bridge_listening() and "--headless" not in args)
if use_bridge:
    print("build: through the BlenderMCP bridge")
    rc = subprocess.call([sys.executable, os.path.join(REPO, "tools", "blender", "bridge.py"), "exec", tmp])
else:
    exe = blender_binary()
    if not exe:
        sys.exit("no Blender found: open one with the MCP addon, or set BLENDER=/path/to/Blender")
    print("build: headless Blender (%s)" % exe)
    # --factory-startup is deliberately NOT passed: the glTF exporter is an
    # add-on, and a factory session is not guaranteed to have it enabled.
    rc = subprocess.call([exe, "--background", "--python", tmp, "--python-exit-code", "1"])
if rc != 0:
    sys.exit(rc)
info_path = os.path.join(HERE, "out", "build.json")
if os.path.exists(info_path) and "--no-export" not in args:
    info = json.load(open(info_path))
    vpath = os.path.join(REPO, "public", "venues", "stadium", "venue.json")
    v = json.load(open(vpath))
    v["seats"] = info["seats"]
    json.dump(v, open(vpath, "w"), indent=2)
    open(vpath, "a").write("\n")
    print("venue.json: %d seats" % len(info["seats"]))
    sys.exit(subprocess.call(["node", os.path.join(REPO, "scripts", "build-venues.mjs")]))
