#!/usr/bin/env bash
# Grade every submitted plot exactly as ingest would: budget checks + walkability.
# Usage: poc/validate/grade-all.sh            (grades poc/out/agent/*.glb)
#        poc/validate/grade-all.sh a.glb b.glb
set -uo pipefail
cd "$(dirname "$0")/../.."

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  shopt -s nullglob
  files=(poc/out/agent/*.glb)
fi

pass=0; fail=0
for f in "${files[@]}"; do
  name=$(basename "$f" .glb)
  # shops declare the door contract; free-form plots do not
  if node -e '
    const {NodeIO}=require("@gltf-transform/core");const {ALL_EXTENSIONS}=require("@gltf-transform/extensions");
    const d=require("draco3dgltf");
    (async()=>{const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"draco3d.decoder":await d.createDecoderModule()});
    const doc=await io.read(process.argv[1]);
    process.exit(doc.getRoot().listNodes().some(n=>n.getName()==="door_panel_L")?0:1)})()' "$f" 2>/dev/null; then
    kind="shop"; vflag="--require-door"; wflag="--door"
  else
    kind="free-form"; vflag=""; wflag=""
  fi

  echo "════════════════════════════════════════════════════════"
  echo "  $name  ($kind)  $(du -h "$f" | cut -f1)"
  echo "════════════════════════════════════════════════════════"
  node poc/validate/validate-shop.mjs "$f" $vflag
  echo
  node poc/validate/walkability.mjs "$f" $wflag | grep -E '^(PASS|FAIL|WALKABILITY)'
  echo
done
