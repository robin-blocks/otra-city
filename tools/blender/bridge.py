#!/usr/bin/env python3
"""Minimal client for the BlenderMCP addon socket (localhost:9876).

Speaks the same JSON protocol the blender-mcp MCP server uses, so anything
tested here behaves identically for MCP-connected agents.

Usage:
  bridge.py ping                 # get_scene_info smoke test
  bridge.py exec FILE.py         # run a python file inside Blender, print stdout
  bridge.py cmd TYPE [JSON]      # raw command, e.g. cmd get_polyhaven_status
"""
import json
import os
import socket
import sys

HOST = "localhost"
PORT = int(os.environ.get("OTRA_BRIDGE_PORT", "9876"))


def send(cmd_type, params=None, timeout=600.0):
    with socket.create_connection((HOST, PORT), timeout=15) as s:
        s.settimeout(timeout)
        s.sendall(json.dumps({"type": cmd_type, "params": params or {}}).encode("utf-8"))
        buf = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            try:
                return json.loads(buf.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
    raise RuntimeError(
        f"connection closed with incomplete response ({len(buf)} bytes): {buf[:400]!r}"
    )


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    mode = argv[0]
    if mode == "ping":
        resp = send("get_scene_info")
    elif mode == "exec":
        with open(argv[1]) as f:
            resp = send("execute_code", {"code": f.read()})
    elif mode == "cmd":
        resp = send(argv[0 + 1], json.loads(argv[2]) if len(argv) > 2 else {})
    else:
        print(__doc__)
        return 2

    ok = isinstance(resp, dict) and resp.get("status") == "success"
    result = resp.get("result") if isinstance(resp, dict) else None
    if ok and isinstance(result, dict) and "result" in result and mode == "exec":
        # execute_code: print captured stdout plainly
        print(result.get("result", ""))
    else:
        print(json.dumps(resp, indent=2, default=str)[:10000])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
