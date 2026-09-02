#!/usr/bin/env python3
"""Run build.py inside the bridged Blender with repo-relative settings.
Usage: python3 poc/city-hall/run.py [--no-render] [--no-export] [--shots street,eye]"""
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
args = sys.argv[1:]
shots = None
if "--shots" in args:
    shots = args[args.index("--shots") + 1].split(",")
pre = 'OTRA_REPO = %r\nOTRA_RENDER = %r\nOTRA_EXPORT = %r\nOTRA_SHOTS = %r\n' % (
    REPO, "--no-render" not in args, "--no-export" not in args, shots)
code = pre + open(os.path.join(HERE, "build.py")).read()
tmp = os.path.join(HERE, "out", "_run.py")
os.makedirs(os.path.dirname(tmp), exist_ok=True)
open(tmp, "w").write(code)
sys.exit(subprocess.call([sys.executable, os.path.join(REPO, "tools", "blender", "bridge.py"), "exec", tmp]))
