---
name: asks
description: Plain-language status for Robin — where the session got to, and every task that is waiting on him, each one summarised simply with step-by-step instructions he can follow without reading the code. Use whenever Robin types /asks or asks any version of "what's on me?", "what do I need to do?", "what am I blocking?", "where are we?", "what's left for me?", "anything waiting on me?", "catch me up". Unlike /tidy, this changes nothing and closes nothing down — it is a briefing, and it can be run at any point in a session, including the middle.
---

# /asks — what's waiting on Robin, in plain words

## The point

Robin has been away, or deep in something else, or has just come back to a
session that has been running for hours. He needs two things and nothing else:

1. **Where are we?** One short paragraph. Not a changelog.
2. **What is waiting on me, and exactly how do I do each one?**

The failure this prevents is not "a task was forgotten". It is **a task that
only Robin can do, sitting unnoticed while everyone assumes it is done.** A
decision nobody chased. A deploy that never happened, so the fix is written but
not live. A draft addressed to somebody outside the project that was never
sent, so they are still waiting for a reply.

Those are invisible from the inside. The code looks finished. The PR is merged.
Nothing is red. And the thing still is not done.

## Run the state script first

```bash
bash .claude/skills/asks/scripts/state.sh
```

Read-only — it changes nothing, writes nothing, and never runs a build. It
gathers the mechanical half: branch and working tree, open PRs and their
checks, `[ROBIN]` markers in `docs/`, unsent drafts, whether the live site
answers, and which local servers are running.

It gathers facts. It does not know what matters. That part is yours.

## Then check that what looks done actually landed

Do this before writing anything, because it is the check most likely to change
the report, and the one nothing else catches.

For each thing this session believes it finished, confirm it is really on
`main` and really live — do not trust a merged PR:

```bash
git fetch origin -q && git log --oneline origin/main -8
```

Then look **inside** main for the actual change, not just the commit title. A
squash merge captures the branch as it was at the moment the button was
pressed; a commit pushed a minute later is silently left behind, and the PR
still says "merged".

```bash
git log origin/main --oneline --grep="<a distinctive word from the commit>"
```

If it does not appear, check the file itself:

```bash
git show origin/main:<path/to/file> | grep -c "<a symbol the change added>"
```

A zero there means the work is orphaned on a branch. That is a task for Robin,
and a high-priority one, because from the outside it looks complete.

## Where the tasks on Robin come from

Five places. Sweep all five; most sessions have tasks in two or three.

- **The conversation.** Things he was asked to decide and has not answered.
  Offers made that he never took up. Corrections he half-gave. Read the whole
  session, not the last few messages.
- **`[ROBIN]` markers in `docs/`.** This repo marks maintainer decisions in
  place. The script lists them. Read the surrounding paragraph for each — the
  marker alone is not enough context to act on.
- **Things only he has access to.** Deploys, DNS, accounts, credentials, paid
  services, anything on a machine or dashboard that is his. If a fix is written
  but needs a deploy he has to run, the task is the deploy, not the fix.
- **Things only he can say.** Replies to people outside the project, business
  terms, credit and naming, whether to take a piece of work on at all. Taste
  calls: does this look right.
- **Work left orphaned**, per the section above.

### What is not a task on Robin

Leave these out. Padding the list is how the real items get skimmed past.

- Anything the assistant can do itself and simply has not yet. Say it is in
  progress under "where we are", or just do it.
- Anything already done. A merged PR is not a task.
- Suggestions and nice-to-haves he has not asked for. If it is worth raising,
  raise it as one line at the end under "worth knowing", not as a task.
- Anything waiting on a third party. That is their task; note it as blocked.

## Write it in plain language

This is the part that makes the skill worth having, so hold the line on it.
Robin knows this codebase, but he is reading this cold, possibly on a phone,
possibly to decide whether he has ten minutes to spare.

- **Say what a thing is before you name it.** Not "the `observe` flag" but
  "the setting that stops the broadcast camera appearing to visitors as a
  person standing on the pitch (`observe`)".
- **No unexplained jargon.** Not "squash merge dropped the commit" but "the
  merge only picked up the changes as they were a minute earlier, so the last
  fix got left behind".
- **Numbers only when they change what he does.** "20× inside budget" earns
  its place; "p95 4.3 ms" does not.
- **Say why it matters, in one line, in terms of consequence.** What actually
  goes wrong if he never does it. Not "this is important".
- **Say how long it will take.** Rough is fine: seconds, a few minutes, needs
  a sitting-down. He is triaging.
- **Never use section numbers from a document as though they mean something.**
  Not "§5.2 is unresolved" but "whether to freeze the stadium for a month at a
  time".

## The shape of the report

Two parts. Keep the first short — the second is the point.

### Part 1 — Where we are

One paragraph, four or five sentences at most. What got done, what is on main
and live, what is still moving. No lists. If the session is mid-flight and
something is running, say so and say what happens when it finishes.

### Part 2 — What's on you

Ordered by consequence, worst first — not by how long they take.

For each task:

- **A short title** that names the actual thing, readable on its own.
- **One or two lines of context.** What this is and why it is waiting on him
  specifically. Include what breaks or stays broken if it never happens.
- **Numbered steps.** Each step is one action, small enough to do without
  thinking about it. Where a step is a command, put it in its own fenced
  `bash` block, one command per block — the app puts a Run button on those, so
  a block with two commands in it costs him a copy-paste.
- **What to expect.** How he knows it worked, and what to do if it did not.
- **Roughly how long.**

Where a task is a decision rather than an action, do not fake steps. Give him:
what the choice is, the options in plain terms, what each one costs him later,
which one you would pick and why, and where to record the answer once he has
made it.

End with **"Worth knowing"** — at most three one-line notes about things that
are true but not tasks. Then stop.

## Rules

- **Never invent a task.** If the list is empty, say "nothing is waiting on
  you" and stop. An honest empty list is the most useful possible output.
- **Never turn one task into three** by splitting a single action into
  sub-tasks. He counts items to decide whether to start.
- **Do not re-explain work he has already been told about.** Link to the file
  or the PR and move on.
- **Check before you claim.** If you say a thing is live, you have loaded it.
  If you say a fix landed, you have looked inside `main` for it. Everything in
  this report is checkable, so check it.
- **Say plainly when you are unsure** which of two things he meant, rather than
  picking one and presenting it as settled.
