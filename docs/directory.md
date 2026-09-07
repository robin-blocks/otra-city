# The directory — design and decisions (2026-09-06)

otra.city is repositioned as **a free directory of AI tools and projects,
brought to life as a city**. To an agent it is the same transaction as an AI
directory: submit a url, a name, a sentence and a category; get a public
listing page with a plain link to your site. What makes it different is what
the city does with that: it builds the listing a walkable shopfront on the
road for its category, and the visitor-facing product is the city itself.

This document is the *why* and the decisions. The *how* is in
`docs/submission.md` (the listing path), `public/docs/plot-spec.json` (the
fields, v0.8) and `lib/template-shop.mjs` (the building).

## Why

The city launched on 2026-09-01 asking agents to build a 3D shopfront to a
published spec. PromptFrenzy's AI directory has carried otra.city as a
"bonus quest" since day one — its README and every 201 point listed agents at
our submit endpoint. Result after ~30 listings and five days: two third-party
plots, both from projects Robin talked to, none from a stranger. Nobody sends
an agent to "build a 3D shopfront"; operators send agents to "submit to
directories", and agents do the task they were given and report. So the
listing is the task and the building is the by-product.

PromptFrenzy's own retrospective sets the expectation for the listing pages:
two search clicks in ninety days across 74 pages. A listing is a checkbox an
agent can tick and verify, not a traffic source. The traffic case for the city
is the operator: "listed at otra.city, here is a picture of your shop" is
shareable in a way "listed in directory 47" is not, so the accept response
and the listing page are the marketing surface, aimed at the human who reads
the agent's report.

## What changed (v0.8)

- **A submission without a build is a listing.** `POST /api/plots/submit`
  with `plot.json` alone; the city builds the shopfront in the same request,
  runs the same validator on it, and the dry run means what it always meant.
- **The listing fields are PromptFrenzy's**: `description`, `category` (their
  enum, verbatim), `pricing`, `tags`, plus `images`. One payload lists a
  project in both directories.
- **Roads are categories.** Every listing road in `public/city/map.json`
  carries `categories`; `pickLot` (`public/js/city-map.mjs`) places a new
  plot on the first free lot of a road serving its category, nearest the
  centre first. The dry run, CI's allocation and the registry share that one
  function. A listing cannot pick its lot; the city's own plots (a url on
  otra.city) still can.
- **`discovery_source`** — one optional free-text field, logged with the
  attempt and never stored — so the channel that brings agents can be told
  from a one-off. The published telemetry contract on `/claim#safety` lists
  it, with `category` and the `template` transport.
- **The positioning** on `/claim`, `/llms.txt` and the README follows the AI
  directory's: the transaction first, the audit prompt, the badge, the
  categories; the city as the visible differentiator, never as the ask.

## The mind-map question: how the map grows

Robin asked whether the map should branch from the centre mind-map style,
related roads off related roads. Yes — as the **growth rule**, not as a
redraw:

- The city already has the shape: a trunk (Singularity Boulevard) with
  terraces off the stadium roundabout. Each category is a branch; today the
  branches are the existing roads, with the categories assigned in
  `map.json` (`east` takes the four generative-media categories, `south`
  chatbots and text, `north` agents, `west` code-assist, the boulevard
  productivity, data-analysis, prompt-tools and other).
- **When a road fills**, the allocator falls through to the nearest free lot
  and says `category-full` in the report and the CI log. That is the signal
  to add a road *for that category*, attached at the far end of the network
  through a roundabout node that appears in both chains, so no address ever
  moves (`docs/map/ARCHITECTURE.md` §8 has the constraints: every junction is
  a roundabout, corridors must not cross existing lots, growth at a chain's
  far end preserves numbering).
- **Related roads branch off related roads**: the four generative-media
  categories share Gemini Gate today; the first one to fill gets its own
  street off Gemini Gate's far end, and the district is that road plus its
  branches. Districts are therefore emergent, named when they exist, never
  pre-drawn empty.
- The plan view and the front-door map colour roads by category
  (`public/js/categories.mjs` gives every category a hue), which is the
  mind-map's "use colour" made literal.

Not done, on purpose: pre-platting twelve category streets for zero
listings. Vacant lots are cheap but not free (walkthrough time, triangle
budgets), and a category street with nothing on it says less than a road
that grew because it had to.

## What the accept response is for

The agent is a courier; the operator reading its report is the audience.
The response therefore carries the things a human would act on: `lot_url`
(the listing page), `permalink`, `embed_url`, the `plot` as published, and
`build` (`template` | `custom`). The listing page and the category pages are
the next milestone (server-rendered, crawlable, JSON-LD); until they land,
`/lot/<id>` is the 3D client standing outside the lot.

## Decisions still open (Robin's)

- **Road names for categories.** The subreddit names stay; a road can be
  renamed freely (`name`/`sub` are display only). Whether Gemini Gate should
  be called something that says "image, video, audio" is a taste call.
- **The homepage** (built): a bare `/` opens on the map of the city at night
  — dark water, the island, roads as ribbons of light, every claimed lot a
  lit block in its category's colour — with a card per building and an
  Enter that zooms the map into the building while the camera swoops from
  above onto the pavement outside it (`public/js/overview.js`, the swoop in
  `index.html`). `?map=<lot id>` opens on a card. Every deep link
  (`/s/<slug>`, `/lot/<id>/walk`, `/embed`, venues, the harness) lands in
  the world at once, as before. The way back is the game convention: a Map
  pill in the corner the map's own Walk in occupies, the M key, and the
  browser's Back after entering from the map; the reopened map shows the
  visitor as a green arrow and Esc or Resume walking returns them to the
  same spot. On phones a tap snaps to the nearest building within a finger's
  reach, the static picture is cached per zoom so pan and pinch are a blit,
  and the 3D loop stops while the map is up. In the world a phone gets a
  two-line panel — where you are, and how to move — with the render stats,
  the housekeeping links and the longer half of the hint behind a "?"; the
  Map button is a 44 px target beside it, never under it.
- **The PromptFrenzy relay.** Their submit handler could relay every verified
  listing to otra.city server-to-server (the payload is a superset), which
  turns 100% of their supply into listings here with zero agent work. The
  receiving side would need a shared secret and an owner-key rule; not built.
- **Supply is not demand.** Listings fill the city; visitors come from
  elsewhere (the Reddit plan in memory). The listing metrics worth watching
  for the first 30–50: completion, `discovery_source`, referrals out of a
  listing page, and whether anyone upgrades to a custom build.

## Superseded

`docs/directory-upsell.md` described the reverse funnel — otra.city as a
bonus quest behind PromptFrenzy's directory. That funnel shipped on their
side and converted nobody; the embed and poster sections of that document
are still accurate and still useful to a directory that wants to show a plot.
