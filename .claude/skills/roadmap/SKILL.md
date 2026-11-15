---
name: roadmap
description: |
  How Lectern v3 tracks work: issues, the roadmap board (GitHub project stegra05/3), milestones
  and pull requests. Use when picking what to work on next, filing or splitting an issue, moving
  an issue's status, setting type, area, priority, size or blockers, opening a PR for an issue,
  asking what is blocked or what needs Steffen, or changing the board itself.
---

# The roadmap

Every piece of v3 work is one issue on the [roadmap board](https://github.com/users/stegra05/projects/3).
`board.sh` next to this file reads and writes it; run it without arguments for its commands.

```sh
B=.claude/skills/roadmap/board.sh
$B view "Agent queue"          # what an agent may start now, P0 first
$B show 130                    # one issue's fields, labels and blockers
$B set 130 Status "In progress"
```

## What an issue carries

| | Values | Meaning |
|---|---|---|
| Type | Feature, Quality, Verify, Decision, Chore, Bug | what kind of work. **Decision**: a question for Steffen, no work until he answers. **Verify**: check something against reality (real Anki, a bill, real clients) |
| Milestone | v3.0 base, v3.1 feedback loop, v3.2 study plan, ..., Vision | the release it ships in. Vision means not planned |
| Priority | P0, P1, P2 | rank inside the current release only. P0 blocks the release, P1 next, P2 if time allows. Issues in later releases have none |
| Size | S, M, L | under a day, a few days, a stack of PRs |
| Area | Engine, App, Design, Dev | where the work lives. One per issue |
| `costs money` label | | needs money spent: a model run, a licence, a fee |
| Blocked by | other issues | GitHub's native dependency. Blocked issues wait |

Type is GitHub's issue type; Priority, Size, Area and Status are fields on the board.

## Who may start what

Take work from the **Agent queue** view: open, in Backlog or Next, not blocked, not Decision or
Verify, no `costs money`, not Vision. Anything else needs Steffen's yes in his words first: a
Decision is his call, a Verify usually needs his hands or his accounts, and `costs money` spends
his money. **Needs me** is that list.

## Status

| Status | Set by |
|---|---|
| Backlog | automatically, when an issue is opened (every open Lectern issue without `v2` joins the board) |
| Next | Steffen, when he orders it |
| In progress | you, when you start: `$B set <n> Status "In progress"` |
| In review | the PR hook, when `gh pr create` names the issue. After `gh stack submit`, set it yourself |
| Done | automatically, when the PR that closes it merges into v3 |

## Filing an issue

One issue per piece of work that one PR, or one stack, can finish. Write the body as the task
form does: **What and why** (the problem first, where it was measured or decided, a link) and
**Done when** (checkable criteria someone else can judge alone). Then:

```sh
$B new "Merge near-identical facts" --type Quality --area Engine --size M \
  --milestone "v3.0 base" --priority P1 --body-file body.md
$B block <new> --by 190          # if it cannot start before #190 is done
```

Give a priority only when the milestone is the current release. A plain `gh issue create`
works too, but the issue then has no type or fields until you set them, and the **Triage** view
lists it. Search before filing: `gh issue list -R stegra05/Lectern --search "<words>"`.

Moving an issue to another release, or changing what a release holds, is Steffen's decision.

## Pull requests

A PR names its issue in the body with `Closes #N` (or `Fixes`, `Resolves`); one with no issue says
`No issue: <why>`. A hook blocks `gh pr create` without either. GitHub itself only closes issues
for PRs into the default branch, which is `main` (v2), so the `close-named-issues` workflow
closes them for PRs merged into `v3`, and the board then moves them to Done. In a stack, each
layer's PR names the issue it finishes.

## Views

| View | Shows |
|---|---|
| Board | everything but Vision, in Status columns |
| Agent queue | what an agent may start now, grouped by release |
| v3.0 | the current release, by Status, P0 first |
| Needs me | Decisions, Verifies, `costs money`, and PRs waiting for Steffen |
| Blocked | issues waiting on another issue |
| Releases | every open issue by milestone |
| Triage | issues missing a type, area, milestone or status |

Changing the board itself (fields, views, workflows, labels): read `references/board-admin.md`
first. Labels, fields and types are Steffen's system; ask before adding or deleting one.
