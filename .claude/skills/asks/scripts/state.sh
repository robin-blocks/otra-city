#!/usr/bin/env bash
# Read-only. Gathers the mechanical half of /asks so the model spends its
# effort explaining rather than hunting. Changes nothing, writes nothing,
# and never runs a build — a status command that dirties the tree is one you
# cannot run twice.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 0

hdr() { printf '\n=== %s ===\n' "$1"; }

hdr "WHERE THE CODE IS"
echo "branch:  $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo "clean:   $([ -z "$(git status --porcelain)" ] && echo yes || echo 'NO — uncommitted changes below')"
git status --short 2>/dev/null | head -20
up=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)
if [ -n "$up" ]; then
  echo "unpushed to $up: $(git rev-list --count "$up"..HEAD 2>/dev/null)"
else
  echo "unpushed: branch has no upstream (never pushed)"
fi

hdr "RECENT WORK ON THIS BRANCH"
git log --oneline -6 2>/dev/null

hdr "OPEN PULL REQUESTS"
if command -v gh >/dev/null 2>&1; then
  gh pr list --state open --json number,title,mergeable,mergeStateStatus,isDraft \
    --jq '.[] | "#\(.number)  \(.title)\n        mergeable=\(.mergeable) state=\(.mergeStateStatus) draft=\(.isDraft)"' 2>/dev/null \
    || echo "(gh could not list PRs — not authenticated, or no remote)"
else
  echo "(gh not installed)"
fi

hdr "CHECKS ON OPEN PRs"
if command -v gh >/dev/null 2>&1; then
  for n in $(gh pr list --state open --json number --jq '.[].number' 2>/dev/null); do
    echo "#$n:"
    gh pr checks "$n" --json name,bucket --jq '.[] | "        \(.name): \(.bucket)"' 2>/dev/null \
      || echo "        (no checks reported)"
  done
fi

hdr "DECISIONS MARKED FOR ROBIN IN THE REPO"
# Docs in this repo mark a decision the maintainer has to make with [ROBIN].
grep -rn --include='*.md' -E '\[ROBIN' docs/ 2>/dev/null | head -30 || true
echo "(count: $(grep -rn --include='*.md' -E '\[ROBIN' docs/ 2>/dev/null | wc -l | tr -d ' '))"

hdr "UNSENT DRAFTS AND CORRESPONDENCE"
grep -rln --include='*.md' -iE 'draft for robin|not sent|before sending|ready to paste' docs/ 2>/dev/null | head -15 || true

hdr "IS THE LIVE SITE UP"
if command -v curl >/dev/null 2>&1; then
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://otra.city/ 2>/dev/null || echo "unreachable")
  echo "https://otra.city/  -> $code"
else
  echo "(curl not available)"
fi

hdr "LOCAL SERVERS THIS MACHINE IS RUNNING"
# Things a session may have started, or that Robin needs running for dev.
for p in 5173 8787 3000; do
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $p: LISTENING"
  else
    echo "port $p: not listening"
  fi
done

hdr "END"
