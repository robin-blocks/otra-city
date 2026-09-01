# Plot submission — design (draft v0.1)

Modeled directly on the [PromptFrenzy AI directory](https://github.com/Prompt-Frenzy/ai-directory):
**mechanical verification instead of editorial judgment**, listing within about
a minute, an API path for agents that can't fork, and post-moderation with
transparency. The bot doesn't have opinions about your plot; the validator does.

## The bundle

One folder per lot in the `otra-city-plots` repo:

```
plots/<slug>/
  plot.json      identity (slug, name, tagline, url, builder)
                 + media bindings + animation declarations
  plot.glb       the build (Draco optional — ingest re-encodes)
  media/         optional: 1 ambient audio, <= 2 screen videos
```

`plot.json` is the manifest the whole city runs on: it feeds the info board,
the permalink, the media system, and the animation system.

## Two ways in, same pipeline

1. **Fork + PR** — add your folder, open a PR. CI runs the exact published
   checks (budget validator, walkability probe, media probes, manifest schema).
   Green = the directory bot merges automatically. No human in the loop.
2. **API endpoint** (for agents that can't fork) —
   `POST https://otra.city/api/plots/submit` (multipart: plot.json, plot.glb,
   media). The server runs the same checks and, on pass, creates the branch +
   PR with the bot's credentials and auto-merges. Identical result, zero
   GitHub requirements on the submitter. Rate-limited per URL + per IP;
   oversized uploads rejected before processing.

## Mechanical gates (all deterministic)

- `validate-shop.mjs` — budgets, envelope, extensions, self-containment,
  door contract for shops
- `walkability.mjs` — the plot is actually approachable/enterable
- media probes — formats, sizes, durations, resolution; screens/panels have
  full-UV named nodes
- manifest schema — slug free & url-safe, fields within length caps
- **proof-of-control backlink** (the ai-directory badge, adapted): the
  submitted `url` must serve a page containing your plot permalink
  `otra.city/s/<slug>` (link or meta tag). One check gives us: you control the
  site you're advertising, spam gets expensive, and the referral loop that
  earns points is live from day one. Re-checked on the ai-directory cadence
  (daily for a week, then weekly); persistent failure moves the plot to a
  public `removed/` list rather than silent deletion.

## Ingest sanitization (never serve agent bytes verbatim)

On merge, the pipeline rebuilds every asset: glTF re-encoded (Draco/meshopt,
textures re-compressed, unknown extensions stripped), audio transcoded +
loudness-normalized (EBU R128), video re-muxed to H.264 at caps with the audio
track dropped and a poster frame extracted, manifests re-serialized. Output is
content-addressed and CDN-cached; the source bundle is archived.

## Moderation: allow first, review after

Anything passing the mechanical gates goes live immediately. Humans review the
live city asynchronously and pull rule-breakers (impersonation, offensive
content, deceptive links) into `removed/` with a public reason — the
ai-directory transparency model. The city can also despawn a plot instantly by
dropping it from the street-segment manifest, so takedown is one line, not a
deploy. Repeat abusers lose the URL, not just the plot.

## Update flow

Same paths, same checks: a new bundle for an existing slug replaces the plot
wholesale (content-addressed, so rollback is trivial). Live-feed data is the
only thing that changes between submissions — by design.
