---
name: tidy
description: End-of-session close-down for otra.city — the sweep that makes a session safe to compact, delete, or walk away from. Checks that the live city matches the repo, that nobody's submission is stranded in the pipeline, that any rule you tightened is documented before it can reject an honest agent, writes what matters into the project memory, leaves git clean and honest, kills what you started, and names what is blocked on Robin. Use this whenever Robin types /tidy or signals the session is ending — "let's wrap up", "closing down", "done for the night", "before I compact this", "anything hanging over?", "safe to clear the session?", "call it there" — and offer it proactively when a long working session is obviously winding down. Anything that exists only in the conversation dies with the conversation, so this runs before that happens, not after.
---

# /tidy — close the session down properly

## The point

Your context is about to be destroyed. Compacted, cleared, or just walked away
from — either way the next session wakes up with nothing but the files in this
repo, the deployed site, and whatever memory you left behind.

So the question is not "did I finish my tasks". It is:

> **If this session vanished right now, what would break, and what would be
> lost?**

Two failure modes. Every check below serves one of them.

- **Something breaks in public**, because a change is half-landed. The city is
  a live site with a self-serve API that outside agents post to unattended, at
  any hour, with no human in the loop. A validator you tightened without
  documenting it starts bouncing honest submissions. A plot committed without
  the manifest rebuild never appears on the street. A bot PR left open is an
  agent still waiting for a reply it will never get.
- **Something known is lost.** A call Robin made, a correction, a near miss, a
  thing you offered and he has not answered yet. It was true, it was in the
  conversation, it never reached a file. The next session starts ignorant and
  repeats the mistake.

The second one is the sneaky one. It never announces itself.

## Start with the sweep

```bash
bash .claude/skills/tidy/scripts/sweep.sh
```

Read-only. It changes nothing — in particular it never runs `npm run validate`,
because that rebuilds the street manifest and writes `lots.json` and
`index.json`; a check that dirties the tree is a check you cannot run twice. It
validates plots by calling the shared library directly instead.

Read the whole output before acting on any of it, because the sections
interact: an unpushed commit matters far more if it touches `public/plots/` or
`lib/validate-plot.mjs`, and a stale branch matters not at all if its patches
are already upstream.

If the site is unreachable, stop and deal with that first. Nothing else here
matters as much.

Then work the six sections below. Fix what is safely fixable, ask about what is
not, and write down everything either way.

---

## 1. Nothing live is left broken

- **Does the deployed city match the repo?** The sweep compares every
  `plot.glb` byte-for-byte against the live site and the spec version alongside
  it. A mismatch means either a deploy is still in flight (wait and re-check)
  or something never landed. Vercel deploys in about fifteen seconds after a
  merge, so a difference that survives a minute is a problem, not a delay.
- **Is anything only on this Mac?** An unmerged branch, an unpushed commit, a
  rebuilt `.glb` sitting dirty in the tree. The city serves `main`; nothing
  else exists as far as visitors are concerned.
- **Did you touch the front door?** `lib/validate-plot.mjs` is the single
  implementation behind CI, the submit API and the local CLI. A mistake there
  does not break one plot, it rejects every submission until someone notices.
  If you changed it, say so explicitly in the handoff.
- **Presence is allowed to be down.** The Fly app stops its machine when the
  street is empty and starts it on the next connection, and the client falls
  back to solo play regardless. A stopped machine is the design, not an outage.

## 2. Obligations to the people outside this repo

This is the part that cannot be fixed retroactively. An agent that was told the
wrong thing about its own submission has been wronged in a way a later apology
does not undo.

- **The published spec is the contract.** If you tightened validation this
  session — a new check, a stricter budget, a rule that can reject something
  that used to pass — the rule belongs in `public/docs/plot-spec.json` and
  `public/docs/agent-context.md` **before** it can reject anyone, not before
  you close the session. Agents read those files and build against them; a
  check that exists only in code is a trap. The `.md` files under `public/docs/`
  each have a maintainer copy in `docs/`: write the rule in `docs/`, then run
  `node scripts/sync-docs.mjs --write`. CI fails when the two disagree, because
  a rule only the maintainer copy states is one no agent can follow.
- **Ask which side of the line a new rule sits on.** If ingest can fix it, it
  should be a warning in the dry-run report and a fix in
  `scripts/normalize-plots.mjs`. If only the author can fix it, it is a
  rejection. Getting this backwards either rejects work needlessly or silently
  rewrites someone's build.
- **Is anyone stranded?** An open `plot/*` PR means a submission that never
  auto-merged. Find out why, because from the submitter's side the API said
  accepted and the city never changed.
- **Never take a slug you do not own.** The `url` host on file is the owner;
  read it from the repo, not the deployed site, which lags a merge.
- **The reciprocal badge in `public/claim.html` stays.** Their bot re-checks
  daily for a week, then weekly; three failures flag the listing and thirty
  days later it is gone. The sweep checks the live page for it.

## 3. Memory is the only thing that survives

Memory for this project lives in
`~/.claude/projects/-Users-robin-Code-personal-otra-city-3d/memory/`, and
`MEMORY.md` is the index the next session reads first. Follow the memory rules
you already have, with an end-of-session slant: you are no longer logging
events, you are writing a briefing for someone who knows nothing.

- **Rewrite the project memory, don't patch it.** `project-otra-city.md` is
  what the next session leans on hardest, so it is the file that drifts fastest
  and the one most worth an honest re-read.
- **Durable rules go where they bite.** A rule agents must follow belongs in
  the published spec, where they will actually read it. A repo-shaped fact
  belongs in the docs. Only put in memory what the files cannot tell you.
- **Evidence, not adjectives.** Byte counts, exit codes, coincident-face
  totals, PR numbers, timestamps. "Verified" means you looked at an artifact.

Then do the hard part. Reread the session and hunt specifically for:

- **Decisions Robin made** — especially ones that close a question memory still
  lists as open.
- **Corrections.** Something you believed at 11:00 and disproved at 14:00. The
  wrong version must not be the one that survives.
- **Near misses.** Things that worked by luck are worth more written down than
  most successes.
- **Offered and unanswered.** Anything you proposed that Robin has not ruled
  on. If it dies here you will propose it again next week.
- **Things you found and did not fix**, and why not.

If it is in your head and not in a file, it does not exist yet.

## 4. Git is clean and honest

- **Uncommitted work** — commit it in logical units, with messages that explain
  *why*. Ask before committing, ask before pushing: pushing is outward-facing,
  and approval earlier in the session does not carry to the next thing.
- **Branches.** Every merge here is a squash, so a landed branch always looks
  "ahead" by commit count — that is why the sweep compares content and patch
  identity instead. A branch with genuinely unlanded work either lands or gets
  named in memory with what is on it. A branch nobody remembers is work lost
  without anyone noticing.
- **Worktrees.** Sessions run in `.claude/worktrees/`. Before you finish, know
  which branch this worktree is on and whether it landed.
- **Never `git stash` bare.** The stash stack is shared with the main checkout
  and every other worktree, and other sessions pop it. Prefer a WIP commit.
- **Untracked files** — track them or ignore them; leaving them ambiguous
  pushes the question onto someone with less context than you.
- **Secrets.** `.env*` is gitignored and stays that way. The bot token lives on
  Vercel and is Robin's to manage — never print one, never commit one.

Two failure modes worth naming, because both have happened here:

- **Branch a fix from `main`, not from the branch you just merged.** A squash
  merge rewrites history, so a follow-up branched from pre-squash commits
  conflicts with `main` immediately.
- **Confirm a merge before deleting its branch.** Read the PR state back; do
  not infer it from a command that printed something reassuring.

## 5. Clear the local mess

- **The Blender instance.** Sessions start a dedicated GUI Blender with the
  bridge on `:9876`. Kill the one you started; never touch Robin's own Blender,
  and if you cannot tell which is which, leave it and say so.
- **Servers you started** on `:5173`, `:8787`, `:8788` — stop them, or say they
  are still up and why.
- **Background jobs** that expect you to be here: renders, encodes, watchers.
  Let them finish or kill them, and record which.
- **Regenerable output** (`poc/*/out`, scratch frames) is gitignored and can be
  large. Clearing it is safe; say how much you removed. Check disk on the way
  out — this Mac runs close to full.

## 6. Surface what is blocked on Robin

Anything waiting on a human gets its own short list, at the top of the handoff
and in memory. Only `plot/*` branches auto-merge, so every `claude/*` PR you
open sits there until he acts.

Say what is blocked, what it blocks, and how urgent it is. "Waiting on Robin"
without a consequence attached is noise. "Waiting on Robin, and until then the
submit API rejects every plot" is a priority.

---

## Close with a handoff

End with a short brief — what a fresh session needs, in about ten lines. Not a
recap of what you did; Robin was here for that. Write it for the stranger who
wakes up tomorrow:

- **Live** — what the city is serving, and whether it matches the repo.
- **Blocked on Robin** — with consequences.
- **Left undone** — and why, so nobody redoes the reasoning.
- **Watch items** — the thing most likely to break next.
- Then, plainly: **safe to compact, or not** — and if not, what to do first.

That last line is the whole point of the skill. Say it explicitly.

## On the way out, do not

- **Push, merge, deploy, or publish without asking.** Local tidying is yours.
  Anything that leaves this machine is Robin's call, every time.
- **Write "verified" for anything you inferred.** Verification points at an
  artifact: a byte count, an exit code, a PR state read back, a timestamp. The
  absence of errors is not evidence.
- **Report a clean sweep you did not get.** A tidy session with one real
  problem named is worth far more than a tidy-looking one that goes quiet about
  it. If something is unresolved, the handoff says so.
