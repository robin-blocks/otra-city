# Submission telemetry — keeping it

`api/submit.mjs` prints one structured line per submission attempt, accepted or
rejected. A log line lives only as long as the platform's log retention, so the
dataset that makes this city interesting — what an agent gets done end to end
with no human in the loop — was evaporating a day at a time.

A Vercel **log drain** posts those lines to `POST /api/log-drain`, which keeps
the ones worth keeping in a private Vercel Blob store. `npm run telemetry`
reads them back.

## Why a drain rather than writing from the endpoint

The endpoint could persist its own lines, and that would be simpler. It would
also miss the half that matters most for a denominator: **a request body over
4.5 MB is rejected by the platform before the function runs**, so an agent that
tried to send too large a bundle never reaches a single line of our code.
Timeouts and crashes are the same. Those attempts are real, they are the ones
most likely to mean "an agent tried and gave up", and they are invisible from
inside the handler. The drain sees the request, not the handler, so it sees
them.

## What is kept

Two kinds of record, one JSON object per line:

| `kind` | what it is |
|---|---|
| `attempt` | our own telemetry line, re-parsed into structured fields, plus the request id / status / region the platform adds |
| `platform` | a failed request to the submit route carrying no telemetry line — the attempt the code never saw |

Everything else the project logs — every static asset, every `/api/plots` read,
the drain's own output — is dropped unread. Nothing about the drain can loop:
its own log lines are on `/api/log-drain`, which the filter does not match.

**No IP address, and never the bundle.** The field list is published at
[`/claim#safety`](https://otra.city/claim#safety); adding a field here means
adding it there in the same commit, or the published contract becomes a lie.

## Setting it up

`scripts/setup-log-drain.sh` walks the whole thing and verifies each step. What
it is doing, and why the order is what it is:

**Vercel will not create a drain until the endpoint answers its test POST with
a 2xx — and it does not show you the drain's secret until the drain exists.**
Demanding the secret before accepting anything is therefore a deadlock with no
way out, and that is exactly what the first version shipped: the dashboard's
Test button reported `Your endpoint sent a 503 status instead of 2xx` and there
was no order of operations that got past it.

So the endpoint has a **bootstrap window**. Until `LOG_DRAIN_SECRET` is set it
answers 200 and stores **nothing** — it is not an open write path in either
state, an unauthenticated caller cannot put a byte in the store — and it logs
loudly that it is discarding what it was sent. The window shuts by itself the
moment the secret exists.

The one thing that window costs: between creating the drain and setting the
secret, deliveries are accepted and dropped. That gap is minutes, and it is
visible — the response body says `discarded N record(s)`, the function log says
the same, and `npm run telemetry` shows nothing arriving.

1. **Blob store** — done once, already provisioned as `otra-city-telemetry`
   (private). It set `BLOB_READ_WRITE_TOKEN` on the project. To recreate:

   ```
   vercel blob create-store otra-city-telemetry --access private --yes
   ```

2. **Start adding the drain**: Vercel → the team → Observability → Log Drains →
   Add. Sources **Functions** (where the telemetry is printed; Static and Edge
   only add noise the filter throws away), Encoding **NDJSON**, endpoint
   `https://otra.city/api/log-drain`. Copy the **verification value** it shows.

3. **Set `LOG_DRAIN_VERIFY` to that value and redeploy.** Vercel checks for it
   as an `x-vercel-verify` header on the endpoint's responses.

4. **Test, then create the drain.** The Test button now passes. Vercel then
   shows the drain's **secret**.

5. **Set `LOG_DRAIN_SECRET` to it and redeploy.** From that moment every
   delivery must carry a valid `x-vercel-signature` (HMAC-SHA1 over the raw
   body) or the header `x-otra-drain-key`, and anything else gets a 403.

**Choose NDJSON.** With JSON delivery the platform parses the body before the
handler sees it, and a signature over bytes we no longer have cannot be
checked. The endpoint says exactly that instead of returning a bare 403, and
the escape hatch is the `x-otra-drain-key` header set to the same value as
`LOG_DRAIN_SECRET`.

## Reading it

```
vercel env pull          # once, for BLOB_READ_WRITE_TOKEN
npm run telemetry        # the summary
npm run telemetry -- --raw
npm run telemetry -- --since 2026-09-01
```

The summary answers the questions the whole exercise is for: how many attempts,
how many were rejected **and on what**, who is submitting, and whether they
arrive with an `Origin` (a browser) or without one (a server-side call). That
last distinction is the one that decides what any change in the submission rate
actually means.

## What this costs and what it does not do

One object per delivered batch that contains something worth keeping — roughly
one a day at current volume, a few hundred bytes each. Batches with nothing in
them write nothing. Objects are never rewritten, so two batches arriving at
once cannot lose one another's records and nothing has to be re-read as the
dataset grows.

Delivery is at-least-once: a failed write answers 500 so the drain retries, on
the view that the odd duplicate beats losing an attempt. Duplicates are
detectable — every record carries the platform's request id.

There is **no dashboard, no alerting and no retention policy**. `npm run
telemetry` is the whole reader. Do not write any of those into this document
before they exist; the last time this repo described a mechanism it had not
built, agents were reading it as fact for a month.
