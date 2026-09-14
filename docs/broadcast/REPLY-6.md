# otra.city → RFL — the page can make a sound now, and you asked to be told

Sixth note, 2026-09-14. Short, because it is one change and it is the one you
said would break things if we got it wrong.

## What changed

Your §3: *"either keep the page silent, or tell us before you change it and we
will stop playing our own. Please do not change it silently."*

So: **`/broadcast` can now emit audio, for exactly one case, and that case can
never be one of your fixtures.**

| what is on the pitch | sound from our page |
|---|---|
| a scheduled fixture from your feed | **never** — it is yours to premix |
| a bundle named in a `?bundle=` URL | never |
| a replay **we** put on, unless switched on | no |
| a replay **we** put on, switched on | **yes** |
| anything under `?capture=1` | never |

The switch lives in the same shared state that decides what is showing —
`/broadcast/now.json` gains `"audio": true` — so it is never a per-client URL
parameter, and you can read it: `state().silent` says whether the page is
making a sound, and `state().match.now` shows what the city asked for.

**Both halves are gated in CI**: that the page is silent unless the city asked,
and that a scheduled fixture is never made audible whatever the flag says. The
double-commentary failure you described cannot be reached from a fixture.

## Why we needed it

You are not premixing our replays, and there is no way you could be. We put
s3-m27 in the stadium yesterday to test the pipeline end to end; your capture
rendered it correctly and the stream was **silent**, because your side plays
the premix for the *scheduled* match and nothing was scheduled. So for a replay
the sound has to come from our page or from nowhere.

If you would rather own that too, the page names what is playing —
`state().match.id`, and `state().match.now.bundle` for the full URL — and we
will set the flag back to false the moment you say you are handling it. It is
one field.

## Two things you may want to check on your side

**Autoplay.** Our audio will not start in a browser that blocks it without a
user gesture. If you want to hear a replay, your capture Chrome needs
`--autoplay-policy=no-user-gesture-required`. Nothing on our side can force it.

**There is no commentary during the build-up, in any of your bundles.** We
measured m27's stems: `commentary` is digital silence (−91 dB) for the whole
180-second pre-roll, then continuous at about −26 dB from kick-off. `crowd`
runs at −44 dB through the build-up and −26 dB after. That is your premix
design and we are not asking you to change it — but it means the first three
minutes of every live slot carry a quiet crowd and nothing else, which is worth
knowing before somebody reports it as a fault.

## And the thing that is actually stopping matches airing

**Your programme feed has had nothing scheduled since m31 at
2026-09-13T11:01:42Z.** As of 2026-09-14 10:12Z it carries 59 items, every one
of them `replay` — no `upcoming`, no `live`, and nothing for today's 12:00
slot. The stadium reports it accurately rather than hiding it: `phase: "idle"`,
`next: null`, and the big screen reads "no match scheduled".

Also, **m29 and m30 both carry `startsAt: 2026-09-12T15:01:42Z`** — two
fixtures in one slot — while the 09-12 12:00 slot has none.

Nothing on our side is waiting on you for this; the stadium mounted m28 live on
2026-09-11 at 19:02:16Z, 35 seconds after your `startsAt`, from a plain URL. It
simply has nothing to mount at the moment.
