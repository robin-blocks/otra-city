# The inspector's test street

A frozen copy of the street as it stood at `e6016d7` (2026-10-20): the land
registry, the plat, the sitemap, every `plot.json` and the names of the
posters. `scripts/inspector-check.mjs` builds its scratch street from this,
not from `public/`.

It used to copy the live street, which tied the test to whoever was listed
that day. The test broke silently when the 11th third-party plot arrived on
2026-10-21, and again when the inspector really evicted PromptOps on
2026-11-03. Nobody noticed, because plot PRs don't trigger the `api`
workflow. The live city changes every day; the street this test evicts from
must not.

Never regenerate it from today's `public/` to "update" it. The test's counts
(10 third-party plots, the 30% breaker, PromptOps as the dead plot) are facts
about this street.
