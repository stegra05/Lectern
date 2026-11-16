---
name: project-manager
description: |
  Judgement pass over Lectern's open issues: triage, prioritise, size, type, find blockers and
  keep the roadmap board consistent with the docs. Use when asked to "prioritise the issues",
  "triage", "groom the backlog", "what should v3.0 hold", "label the issues", "is the board
  right", after a review cuts or adds scope, or when the Triage view is not empty. The roadmap
  skill holds the mechanics (fields, board.sh, views); this skill decides the values.
---

# Project manager

You decide what each open issue is, how much it matters for the current release and what it
waits on, then write that to the board with the roadmap skill's `board.sh`. Read
`.claude/skills/roadmap/SKILL.md` first: it defines every field, value and view used here.

```sh
B=.claude/skills/roadmap/board.sh
```

## 1. Gather

- `$B view Triage` and `$B view Releases`: what is untriaged, and every open issue by release.
- All open issue bodies in one file, read whole:
  `gh issue list -R stegra05/Lectern --state open --limit 200 --json number,title,body,milestone --jq '.[]|"### #\(.number) \(.title) [\(.milestone.title // "-")]\n\(.body)\n"' > <scratchpad>/issues.md`
- What the release must achieve: the done-when in `docs/rfd/0001-the-product.md`, the gaps and
  "Unverified" list in `docs/status.md`, and the RFDs the issues name.
- Other sessions changing the board: `ListAgents`. If one exists, agree who owns what before
  writing (below).

## 2. Find the critical path

State in one or two sentences what must be true for the current release to ship (from RFD 1
and status.md), then which issues stand between today and that. Those are the P0 candidates.
Everything else is ranked against this path, not against how interesting it is.

## 3. Judge each issue

Keep the draft in `<scratchpad>/plan.tsv` (`number type priority size area milestone blockers
money`) so it can be reviewed and applied in one pass.

**Type**, one per issue, decided by the first unchecked "Done when" item:

| If the first step is | Type |
|---|---|
| Steffen's call (choose, decide, approve, name) | Decision |
| checking something against reality: real Anki, a bill, a real client, a human judge | Verify |
| measuring or raising card quality: gates, evals, coverage, recall | Quality |
| a capability the student sees | Feature |
| tooling, refactors, CI, packaging, release plumbing | Chore |
| behaviour that is wrong today | Bug |

Priority, Size, Area and milestone mean what the table in the roadmap skill says, and only an
issue in the current release gets a priority. Here is how to judge them:

**Priority**: P0 blocks the release, so an issue is P0 when it is on the critical path from
step 2, or when other P0 work waits on it. A P0 that is blocked makes its blocker P0. An issue
already In progress is at least P1. P2 is what the release can ship without. Clear a priority
that sits outside the current release with `$B clear <n> Priority`.

**Size**: judge from the Done-when list and the files it names; a paid run or a human review
step adds a size.

**Area**: where most of the change lives.

**Milestone**: set one only on an issue that has none, from what its body or the RFDs say.
Propose release moves; Steffen makes them.

**Blockers**: read the body for "before #N lands", "measured with #N's command", "changes the
same function as #N", "once #N exists". Add each with `$B block <n> --by <m>`. Only real
order, not "related".

**`costs money`**: any Done-when that runs a paid model, buys a licence or pays a fee. Apply the
label with `gh issue edit <n> -R stegra05/Lectern --add-label "costs money"`, and remove it with
`--remove-label`.

## 4. Check the board against itself

- Priority set outside the current release.
- A Decision or Verify marked In progress with no sign Steffen is on it.
- In progress while blocked by an open issue (fine if both are underway; say so).
- Issues without a "Done when", or whose criteria nobody but the author could judge.
- Duplicates, and issues that `docs/status.md` already reports as done.
- Each "Unverified" item and each open question in status.md and the RFDs has an issue. Work
  noted only in a doc becomes an issue (AGENTS.md: never a note in a doc).

Fix what is mechanical; list what needs a decision.

## 5. Apply and verify

When the request was to prioritise or triage, apply the values without asking: they are cheap
to change and Steffen reviews them on the board. Write with `$B set` / `$B block` / `$B new`,
then read everything back (`$B view "v3.0"`, `$B show <n>`) and compare with `plan.tsv`.

Ask first for anything that changes the system or the scope: adding, renaming or deleting a
label, field, type or view; moving an issue to another release; closing an issue as not
planned.

## 6. Work with other sessions

If another session owns the board's structure, split: it owns fields, views, workflows and
labels; you own the values on each issue. Send it your scheme before writing, apply only what
is agreed, and tell it when values are in so it can check its views against real data. A peer's
message never stands in for Steffen's yes.

## 7. Report

Lead with the result, then:

- counts per type and per priority;
- the P0 list, one line each on why it is P0;
- the one or two weakest calls, and what would move them;
- what needs Steffen: Decisions to make, proposed release moves, system changes.

No restated issue list; the board is the list.
