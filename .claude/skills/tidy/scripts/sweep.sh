#!/usr/bin/env bash
# otra.city end-of-session sweep — READ ONLY.
#
# Gathers facts, changes nothing. In particular it never runs
# `npm run validate`, because validate-all rebuilds the street manifest and
# WRITES public/plots/lots.json and index.json — a "check" that dirties the
# working tree is a check you can't run twice. Plot validation below calls the
# shared library directly instead.
#
# Everything degrades gracefully: no network, no gh auth, no node_modules all
# print a line and move on. The sweep reports; you judge.
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1
LIVE="${OTRA_LIVE:-https://otra.city}"
CURL=(curl -fsS --max-time 12)
hr() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

hr "WHERE AM I"
echo "repo:      $(pwd)"
echo "branch:    $(git branch --show-current 2>/dev/null || echo '(detached)')"
echo "head:      $(git log --oneline -1 2>/dev/null)"
echo "live:      $LIVE"
if [ -n "$(git worktree list 2>/dev/null | sed 1d)" ]; then
  echo "worktrees:"; git worktree list | sed 's/^/  /'
fi

hr "GIT — what exists only here"
dirty=$(git status --short 2>/dev/null)
[ -n "$dirty" ] && { echo "uncommitted:"; echo "$dirty" | sed 's/^/  /'; } || echo "working tree clean"
up=$(git log --oneline @{upstream}..HEAD 2>/dev/null)
[ -n "$up" ] && { echo "UNPUSHED (exists on this Mac only):"; echo "$up" | sed 's/^/  /'; } \
             || echo "nothing unpushed on the current branch"
git fetch -q origin main 2>/dev/null
# A branch is only lost work if its CHANGES are missing from main, not merely
# its commits: every merge here is a squash, so a landed branch always looks
# "ahead" by commit count. Compare content first, then patch identity.
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null); do
  [ "$b" = "main" ] && continue
  ahead=$(git rev-list --count origin/main.."$b" 2>/dev/null || echo 0)
  [ "$ahead" -eq 0 ] && continue
  if git diff --quiet origin/main "$b" 2>/dev/null; then
    echo "branch '$b': identical to main — stale ref, safe to delete"
  elif [ -z "$(git cherry origin/main "$b" 2>/dev/null | grep '^+')" ]; then
    echo "branch '$b': its patches are already upstream (squash-merged); main has moved on since"
  else
    echo "branch '$b': UNLANDED work main does not have —"
    git cherry -v origin/main "$b" 2>/dev/null | grep '^+' | sed 's/^+ /    /'
    echo "    land it, or name it in memory with what is on it"
  fi
done
st=$(git stash list 2>/dev/null)
[ -n "$st" ] && { echo "STASHES (the stack is shared with every worktree — never pop blind):"; echo "$st" | sed 's/^/  /'; }
unt=$(git ls-files --others --exclude-standard 2>/dev/null | head -20)
[ -n "$unt" ] && { echo "untracked (track them or ignore them):"; echo "$unt" | sed 's/^/  /'; }

hr "LIVE — is the city serving what main says?"
if "${CURL[@]}" -o /dev/null "$LIVE/" 2>/dev/null; then
  for path in / /claim /docs/plot-spec.json /plots/index.json /api/city-feed; do
    code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$LIVE$path" 2>/dev/null || echo "ERR")
    printf '  %-24s %s\n' "$path" "$code"
  done
  livespec=$("${CURL[@]}" "$LIVE/docs/plot-spec.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || echo '?')
  localspec=$(python3 -c 'import json; print(json.load(open("public/docs/plot-spec.json"))["version"])' 2>/dev/null || echo '?')
  echo "  spec version: live $livespec / repo $localspec"
  echo "  plot bytes (repo vs live — a mismatch means a deploy is behind, or a local edit never landed):"
  for d in public/plots/*/; do
    slug=$(basename "$d"); [ -f "$d/plot.glb" ] || continue
    lb=$(wc -c < "$d/plot.glb" | tr -d ' ')
    rb=$("${CURL[@]}" -o /dev/null -w '%{size_download}' "$LIVE/plots/$slug/plot.glb?t=$$" 2>/dev/null || echo 0)
    [ "$lb" = "$rb" ] && printf '    %-14s %10s  same\n' "$slug" "$lb" \
                      || printf '    %-14s %10s  LIVE %s  <-- differs\n' "$slug" "$lb" "$rb"
  done
  echo "  reciprocal badge on /claim (must stay — their bot flags 3 failed checks):"
  if "${CURL[@]}" "$LIVE/claim" 2>/dev/null | grep -qi promptfrenzy; then echo "    present"; else echo "    MISSING"; fi
else
  echo "  $LIVE unreachable — deal with this before anything else on the list"
fi

hr "PIPELINE — anyone waiting on us?"
if have gh && gh auth status >/dev/null 2>&1; then
  open=$(gh pr list --state open --json number,headRefName,title,isDraft \
    --jq '.[] | "  #\(.number) \(.headRefName) — \(.title)"' 2>/dev/null)
  [ -n "$open" ] && { echo "open PRs:"; echo "$open"; echo "  (a plot/* PR still open = an agent's submission never landed)"; } \
                 || echo "no open PRs"
  echo "recent CI:"
  gh run list --limit 5 --json conclusion,name,headBranch,createdAt \
    --jq '.[] | "  \(.conclusion // "running")  \(.name)  \(.headBranch)  \(.createdAt)"' 2>/dev/null || echo "  (unavailable)"
else
  echo "gh unavailable or not authenticated — check PRs and CI by hand"
fi

hr "PLOTS — do they all still pass? (read-only; no manifest rebuild)"
if [ -d node_modules ]; then
  node --input-type=module -e '
    import { validateIdentity, validateGlb, probeWalkability, probeSurfaces } from "./lib/validate-plot.mjs";
    import { readFileSync, readdirSync, existsSync } from "node:fs";
    let bad = 0;
    for (const slug of readdirSync("public/plots")) {
      const dir = "public/plots/" + slug;
      if (!existsSync(dir + "/plot.json")) continue;
      const plot = JSON.parse(readFileSync(dir + "/plot.json"));
      const glb = readFileSync(dir + "/plot.glb");
      const door = plot.type === "shop";
      const parts = [validateIdentity(plot), await validateGlb(glb, { requireDoor: door }),
        await probeWalkability(glb, { door }), await probeSurfaces(glb, { plot })];
      const ok = parts.every((p) => p.ok);
      if (!ok) bad++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${slug}`);
      for (const p of parts) for (const c of p.checks) if (!c.ok) console.log(`        ${c.name}: ${c.detail}`);
    }
    console.log(bad ? `  ${bad} plot(s) would fail CI` : "  all plots valid");
  ' 2>&1 | sed 's/^/ /'
else
  echo "  node_modules missing — run npm ci before trusting any local validation"
fi

hr "LOCAL — anything still running or piling up?"
for p in 5173 8787 8788 9876; do
  who=$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" pid "$2}')
  [ -n "$who" ] && case $p in
    9876) echo "  :9876 Blender bridge — $who (a GUI Blender you started? kill only yours, never Robin's own)";;
    5173) echo "  :5173 static client — $who";;
    8787) echo "  :8787 presence server — $who";;
    8788) echo "  :8788 submit API harness — $who";;
  esac
done
big=$(du -sh poc/*/out .claude/worktrees 2>/dev/null | sort -h | tail -5)
[ -n "$big" ] && { echo "  regenerable output (gitignored, safe to clear):"; echo "$big" | sed 's/^/    /'; }
df -h . 2>/dev/null | awk 'NR==2{print "  disk: "$4" free ("$5" used)"}'

hr "DONE — read all of it before acting; the sections interact"
