#!/usr/bin/env python3
"""Build the stadium venue inside the bridged Blender, then fold the build's
seat positions into public/venues/stadium/venue.json and rebuild the index.
Usage: python3 poc/stadium/run.py [--render] [--no-export] [--shots a,b]"""
import json, os, subprocess, sys
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
rc = subprocess.call([sys.executable, os.path.join(REPO, "tools", "blender", "bridge.py"), "exec", tmp])
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
