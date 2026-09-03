#!/usr/bin/env bash
# Walk through turning the submission log drain on, verifying each step.
#
#   ./scripts/setup-log-drain.sh
#
# Safe to re-run: every step checks the live endpoint first and skips what is
# already done. It never asks you for a secret — `vercel env add` prompts for
# the value itself, so nothing sensitive passes through this script or its
# output. Background: docs/telemetry.md
set -euo pipefail

ENDPOINT="https://otra.city/api/log-drain"
b=$(printf '\033[1m'); dim=$(printf '\033[2m'); g=$(printf '\033[32m'); y=$(printf '\033[33m')
r=$(printf '\033[31m'); n=$(printf '\033[0m')
say()  { printf '\n%s==> %s%s\n' "$b" "$1" "$n"; }
ok()   { printf '%s  ok%s  %s\n' "$g" "$n" "$1"; }
warn() { printf '%s  !!%s  %s\n' "$y" "$n" "$1"; }
die()  { printf '%s  xx%s  %s\n' "$r" "$n" "$1"; exit 1; }
ask()  { printf '\n%s%s%s\n' "$b" "$1" "$n"; read -r -p "  press return when done (or ctrl-c to stop) " _; }

command -v vercel >/dev/null || die "the vercel CLI is not on PATH — npm i -g vercel"
vercel whoami >/dev/null 2>&1 || die "not logged in — run: vercel login"
cd "$(dirname "$0")/.."
[ -d .vercel ] || die "this directory is not linked to the Vercel project — run: vercel link"

# state of the deployed endpoint: unreachable | bootstrap | configured
probe_state() {
  local body
  body=$(curl -fsS --max-time 15 "$ENDPOINT" 2>/dev/null) || { echo "unreachable"; return; }
  case "$body" in
    *configured*)             echo "configured" ;;
    *awaiting*)               echo "bootstrap" ;;
    *)                        echo "unreachable" ;;
  esac
}
probe_verify() { curl -fsSI --max-time 15 "$ENDPOINT" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="x-vercel-verify:"{print $2}'; }

redeploy() {
  local url
  say "Redeploying production so the new environment variable takes effect"
  url=$(vercel ls --prod 2>/dev/null | grep -m1 '^https://') || die "could not find a production deployment"
  printf '  redeploying %s\n' "$url"
  vercel redeploy "$url" --yes >/dev/null || die "redeploy failed — do it from the dashboard and re-run this script"
  printf '  waiting for it to go live'
  for _ in $(seq 1 60); do printf '.'; sleep 5; [ "$(probe_state)" != "unreachable" ] && { printf '\n'; return; }; done
  printf '\n'; warn "still not answering — give it a moment and re-run this script"
}

say "Checking the deployed endpoint"
state=$(probe_state)
[ "$state" = "unreachable" ] && die "$ENDPOINT is not answering. Is the latest main deployed?"
ok "$ENDPOINT is up ($state)"

# ---------------------------------------------------------------- step 1 of 3
if [ -n "$(probe_verify)" ]; then
  ok "LOG_DRAIN_VERIFY is already set and being served"
else
  say "Step 1 of 3 — the verification value"
  cat <<TXT
  In the Vercel dashboard:

    Observability -> Log Drains -> Add

    URL       $ENDPOINT
    Encoding  NDJSON        <- not JSON. With JSON the platform parses the body
                               before the handler sees it and the signature
                               cannot be checked over bytes we no longer have.
    Sources   Functions     <- that is where the telemetry is printed

  Do NOT press Test or Save yet. Copy the verification value it shows you.
TXT
  ask "Ready to paste the verification value?"
  vercel env add LOG_DRAIN_VERIFY production || die "vercel env add failed"
  redeploy
  [ -n "$(probe_verify)" ] && ok "the endpoint is now serving x-vercel-verify" \
    || warn "x-vercel-verify still not visible — check the value and re-run"
fi

# ---------------------------------------------------------------- step 2 of 3
say "Step 2 of 3 — create the drain"
cat <<TXT
  Back in the dashboard, press Test. It should pass now: until the secret
  exists the endpoint deliberately answers 2xx and stores nothing, because
  Vercel will not create a drain against an endpoint that refuses, and does not
  show you the secret until the drain exists.

  Then Save/Add the drain. Vercel will show you its SECRET — copy it.
TXT
ask "Drain created and secret copied?"

# ---------------------------------------------------------------- step 3 of 3
say "Step 3 of 3 — the secret"
printf '  Paste the drain secret when prompted. Until this is set, deliveries\n'
printf '  are accepted and DISCARDED.\n'
vercel env add LOG_DRAIN_SECRET production || die "vercel env add failed"
redeploy

say "Verifying"
state=$(probe_state)
[ "$state" = "configured" ] && ok "the endpoint reports itself configured" \
  || die "the endpoint still reports '$state' — is LOG_DRAIN_SECRET set for production?"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ENDPOINT" \
  -H 'content-type: application/x-ndjson' -H 'x-otra-drain-key: definitely-not-the-secret' \
  --data '{"message":"SUBMIT {}"}' --max-time 15)
[ "$code" = "403" ] && ok "an unauthenticated delivery is refused (403)" \
  || warn "expected 403 for a bad key, got $code"

cat <<TXT

$b Done. $n
  Records land in the private Blob store otra-city-telemetry and are read with:

    vercel env pull      # once, for BLOB_READ_WRITE_TOKEN
    npm run telemetry

  Nothing will appear until somebody submits a plot. To prove the path end to
  end now, send a dry run that fails — it is logged like any other attempt:

    curl -X POST https://otra.city/api/plots/submit \\
      -H 'content-type: application/json' \\
      -d '{"plot":{"slug":"drain-probe"},"dry":true}'

  Then wait a minute for delivery and run: npm run telemetry
TXT
