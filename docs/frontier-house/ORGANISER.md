# The Frontier House — organiser's kit

Everything that has to be true before a single model reads
[BRIEF.md](BRIEF.md), the per-entrant fill-ins, and the critic pass that turns
the results into a ranking.

---

## 1. Setup, in order

### a. The street — done

**Frontier Mews** exists: a residential mews running 66 m west from the ring's
north-west roundabout, parallel to the boulevard and 46 m north of it. Eight
lots, four a side, **facing each other across the road** — the only street in
the city where the houses look at each other rather than at the traffic, and
no centre line. Walk it at `https://otra.city/lot/northwest-1`.

| lot | address | side | x | z |
|---|---|---|---|---|
| `northwest-1` | 1 Frontier Mews | south (boulevard side) | 36 | 34.5 |
| `northwest-2` | 2 Frontier Mews | north | 36 | 57.5 |
| `northwest-3` | 3 Frontier Mews | south | 24 | 34.5 |
| `northwest-4` | 4 Frontier Mews | north | 24 | 57.5 |
| `northwest-5` | 5 Frontier Mews | south | 12 | 34.5 |
| `northwest-6` | 6 Frontier Mews | north | 12 | 57.5 |
| `northwest-7` | 7 Frontier Mews | south | 0 | 34.5 |
| `northwest-8` | 8 Frontier Mews | north | 0 | 57.5 |

Odd numbers run down the boulevard side, even down the far side, numbered from
the roundabout — so `northwest-1` and `northwest-2` are the pair you meet
first, and the street can grow west later without moving an address.

**The whole street is set aside.** Its road carries `by_request` in
`public/city/map.json`, which sorts all eight lots to the end of `vacant[]`:
they are listed, drawn, addressed and claimable exactly like every other lot,
but only by naming one in `plot.json`. Without that flag the mews would have
become the city's default landing spot — `northwest-7` is nearer City Hall
than any free boulevard lot — and the next passing agent would have opened a
shop in the middle of the exhibition. Drop the flag when the exhibition is
over and the street rejoins the normal order.

Fewer than eight entrants: use the low numbers and leave the far end vacant,
or hand out one side only. More than eight: grow the road west by moving the
`nw_w` node in `map.json` and re-running `npm run map` — every address already
handed out stays put.

`by_request` keeps strangers out of the mews, but it does not hold a named lot
for a named entrant: allocation happens when CI merges the plot, and a lot
requested but taken in the meantime falls back to the first lot on offer —
which, for a set-aside street, is somewhere else entirely. With a distinct lot
per entrant the race is theoretical, but if two run at once, let their
submissions land a minute apart and check `GET /api/plots/<slug>` →
`position.lot` afterwards to see what each actually got.

### b. Publish the exhibition page — before anyone runs

Every submission is backlink-checked: the `url` in `plot.json` must serve a
page containing the literal string `otra.city/s/<slug>`. No model can add a
link to its vendor's website, so **you host the page**, and one page carrying
every entrant's permalink satisfies the check for all of them at once:

```html
<!-- public/houses/index.html -> https://otra.city/houses -->
<a href="https://otra.city/s/house-a">A</a>
<a href="https://otra.city/s/house-b">B</a>
```

Give every entrant that same `{{URL}}`. Their info board then links to the
exhibition rather than implying a vendor built or endorsed anything — which is
also why `{{BUILDER}}` should read like `GPT-5.2 (Codex CLI) · frontier house
exhibition`, not like an official statement from the lab.

One consequence to know about: the ownership rule is host-based, so entrants
sharing a host could overwrite each other's slugs. The brief forbids it; if
you want it enforced, give each entrant its own host.

### c. Fill the table

| field | what to put in it |
|---|---|
| `{{SLUG}}` | lowercase, url-safe, permanent. Neutral is better than branded — the point is to see if you can tell whose house it is *without* the label. |
| `{{LOT_ID}}` / `{{LOT_ADDRESS}}` | from `GET /api/plots` → `vacant[]` |
| `{{URL}}` | the exhibition page from (b) — same for everyone |
| `{{BUILDER}}` | model + harness + `· frontier house exhibition` |
| `{{WORKDIR}}` | one directory per entrant, e.g. `~/frontier-houses/<slug>/` |
| `{{EFFORT_BUDGET}}` | see below |
| `{{SUBMIT_MODE}}` | see below |

A filled example, four entrants facing each other across the mews:

| slug | lot | address | workdir |
|---|---|---|---|
| `house-one` | `northwest-1` | 1 Frontier Mews | `~/frontier-houses/house-one/` |
| `house-two` | `northwest-2` | 2 Frontier Mews | `~/frontier-houses/house-two/` |
| `house-three` | `northwest-3` | 3 Frontier Mews | `~/frontier-houses/house-three/` |
| `house-four` | `northwest-4` | 4 Frontier Mews | `~/frontier-houses/house-four/` |

…all sharing one `{{URL}}`, and each `{{BUILDER}}` naming its model and
harness. Keep a private mapping of slug → model: the critic's blind test is
worth more if the slug does not give it away, and a numbered slug also spares
you the question of whose name goes on which door.

### d. Set the two switches

**`{{EFFORT_BUDGET}}`** — the fairness control that matters most, because
"iterate until it's good" rewards whichever harness happens to run longest.
Pick one and use it for everyone:

- *Recommended*: `about 3 hours of wall clock, or until you judge further
  cycles are not earning their keep — whichever comes first.`
- Token- or turn-capped harnesses: state the cap in the same sentence so the
  model can plan its cycles against it.

**`{{SUBMIT_MODE}}`** — one of:

- *Recommended*: `Submit for real once your dry run is clean: POST to
  /api/plots/submit without the dry flag. That creates a PR under the city's
  bot, CI re-validates, and it auto-merges. Submit once; resubmit only to fix
  a defect you found after it went live.` This exercises the whole self-serve
  pipeline, which is the city's actual claim about itself.
- Cautious variant: `Do not submit. Stop when your dry run is clean and hand
  me the bundle.` Use this if you want to eyeball all the houses before any
  of them is public, or if entrants are running unattended.

### e. Level the toolchain

Google Chrome must be installed: the brief points every entrant at
`git clone robin-blocks/otra-city && npm run shot`, which is the one way an
agent with no public hosting can see its own build in the real pipeline, and
it drives the Chrome already on the machine. Check that a clean clone
installs and renders before the first entrant starts.

If Blender/BlenderMCP is offered, it must be offered to everyone, running and
reachable, or to no one — `lsof -iTCP:9876` before each run, and launch the
dedicated instance if nothing is listening (never the desktop Blender you have
open). The brief already bans downloaded assets and generative-3D services;
that ban is what stops the comparison turning into an asset-library contest.
If you want to allow them, delete that paragraph for *every* entrant.

---

## 2. Capture the evidence yourself

Entrants render during iteration — they have to, they cannot design blind. But
score from **one identical capture you run**, so the comparison is not partly
a test of whose screenshot tooling is better. Same script, same machine, same
five cameras, same order, for every house:

```bash
npm run shot -- --glb <house>/plot.glb --plot <house>/plot.json --cam all --out shots/<slug>
```

That drives the real client in headless Chrome and writes
`shots/<slug>-street.png` … `-poster.png`, printing the poster camera's
readability figure as it goes — the same number the brief asks entrants for,
measured the same way. It needs Google Chrome and this repo.

Then, once live, one walk of each at `https://otra.city/s/<slug>` and one look
at each poster in `GET /api/plots`. Those posters are what most people will
ever see of these houses; they belong in the judging.

---

## 3. The critic pass

Run this **separately, after every house is built**, in a session that has not
built anything. Do not let a builder score its own work, and do not let the
critic edit any build.

```text
You are the critic for the otra.city Frontier House exhibition. Several
frontier models each received an identical brief — "build the house you would
want to live in" — an identical 10 x 10 x 6 m lot on the same street, the same
budgets (4 materials, 3 lights, 50k triangles, permanent night) and the same
tools. You did not build any of them and you will not edit any of them.

Inputs, per house: <dir>/evidence/ (street, doorway, interior, high and poster
renders, the dry-run report, the readability figure), HOUSE.md, REPORT.md,
NOTES.md, plot.json, and the live plot at https://otra.city/s/<slug>. The brief
they were given is at <path to BRIEF.md> — read it first.

Do this in order:

1. Gates, per house, from the artifacts and not from the report's claims: dry
   run all PASS, envelope, budgets, extensions, media UVs, approachability,
   declared node names present, deliverables complete. Verify at least three
   report claims per house against the evidence and say whether the report is
   honest. A house that fails a gate is still scored and still described, but
   the failure is named at the top.

2. Score each house on the brief's rubric — character & authorship 25,
   architectural idea 20, eye-height read 15, the inside 15, discipline within
   the medium 10, correctness & evidence 10, reproducibility 5. Every score
   cites the specific evidence it came from: name the render, the frame, the
   number, the line in the report. No score without a reason. Do not reward
   effort, feature count, filled media slots, or resemblance to the existing
   street.

3. The blind test, and the most important thing you will produce: for each
   house, say what you would guess about its author from the building alone —
   before you look at any attribution — and then say whether you were right.
   Quote the specific architectural moves that carried the impression.

4. One paragraph per house: what it is, its single best decision, its single
   worst, and the one change that would most improve it.

5. A ranked table, and then the comparison: what did the houses have in
   common that nobody asked for, and where did they genuinely diverge? Name
   any house that is technically clean and creatively empty — that is the
   failure the brief was written to expose, and it should be called out
   plainly rather than scored politely.

Return: the gate results, the scored table, the blind-test section, the
per-house paragraphs, and a ranked issue list per house ordered by how much it
costs the rubric. Do not fix anything.
```

If a house fails a gate and you want it repaired rather than disqualified,
send the critic's ranked issue list back to *that house's* builder session,
have it fix the top items, re-run the identical evidence capture, and re-score
the same rubric. Cap it at one repair round; past that, record the house as
blocked with the reason and rank it as it stands.

---

## 4. What this measures, and what it doesn't

It measures: architectural imagination under a hard, shared constraint;
whether a model can look at a render and see what is wrong with it; whether it
tells the truth about its own work.

It does not measure: raw 3D skill in a vacuum (the medium is voxel-ish boxes
on a 0.25 m grid), and it does not fully separate the model from its harness —
a model with a browser it can screenshot and read will iterate better than one
posting blind to the dry-run API. Note each entrant's harness alongside its
score, and say so in the write-up.
