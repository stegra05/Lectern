---
name: exam-bench
description: |
  How to measure a Lectern deck or a change of the engine on the exam benchmark: score a build
  on the marks of past papers it never saw, run the Haiku judges, and get the gate's one verdict
  on a change. Use when asked whether a change made the cards better, to score or compare
  builds, to "run the benchmark", "run the judges" or "gate this change", when an engine change
  claims better coverage, or when working toward a score goal on your own.
---

# The exam benchmark

A deck is scored on the share of exam marks it holds, on papers its build never saw.
[RFD 14](../../../docs/rfd/0014-the-quality-bar.md) says what is measured, why, and every
figure so far; `docs/architecture.md` section 14 lists the commands. This skill is the
procedure. Read RFD 14 once before your first run.

## Rules that keep the number honest

1. **Tune on dev, read test once.** Work on the engine looks at `rubric-dev.json` only. Score
   `rubric-test.json` once, when a change is ready to be accepted, and do not open that file or
   the four newest papers while you tune.
2. **A change is judged by `gate`, never by two figures side by side.** Builds of the same code
   differ by several points. Three builds a side show a change from about 6 points, five from
   about 4, two only from 11, and one against one shows nothing. `unclear` is a result, not a
   failure to report. Old-side builds can be kept and added to; they do not have to be rebuilt
   for every change.
3. **A failed guard is Steffen's to decide.** Do not loosen a limit and do not work around it.
   Say what the change buys and what it costs, and ask.
4. **A build costs money.** Estimate first and get Steffen's yes for every paid run (AGENTS.md).
   Judging costs none, only tokens.
5. **Nothing from the rubrics or the held-out papers goes into the engine**: not into prompts,
   presets, examples or tests. A score that rose that way is worthless.
6. **The data stays out of git.** The repository is public and the papers are not ours. All of
   it lives in `eval-results/`, which only the main checkout has.
7. **Judges are Haiku subagents**, one per batch, at most ten at once. Adjudication and
   anything that needs judgement stays with you.

## Where things are

`eval-results/` is git-ignored and exists only in the main checkout. From a worktree, reach it
by absolute path: `$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/eval-results`.

| Path under `eval-results/` | What |
| --- | --- |
| `bench/entrepreneurship/rubric-dev.json` | the dev set: papers of 2022 to 2024 |
| `bench/entrepreneurship/rubric-test.json` | the test set: the four newest papers |
| `bench/entrepreneurship/verdicts.json` | every verdict kept so far, shared by both rubrics |
| `bench/runs/<name>/` | one judged build |
| `v3-courses/<name>/` | course folders the builds run in |

A build that is scored on either set may have only the 14 papers before 2022 in its `exams/`
folder. A build that read a dev paper cannot be scored on the dev set.

## Scoring one build

Run from `packages/engine`. `$R` is a new folder under `bench/runs/`, `$RUBRIC` one of the two
rubric files.

```sh
node eval/refdeck.ts run <course folder> $R      # cards.json, cards.txt, slides.txt, meta.json
node eval/bench.ts batches $RUBRIC $R            # pairs/NN.json: what no judge has decided yet
# one Haiku judge per pairs/NN.json, see below
python3 ../../.claude/skills/exam-bench/check-verdicts.py $R
node eval/bench.ts report $RUBRIC $R             # the score, and standings.json
```

`report` refuses while a pair is undecided or a verdict names a card the run lacks. That is the
check doing its work: fix the verdict file, do not delete it.

## The judges

Start one subagent per batch file with `model: haiku` and this prompt, the paths filled in:

```text
Read <repo>/packages/engine/eval/JUDGE-PAIRS.md completely and follow it exactly.

Run folder: <absolute path of $R>
Your batch: pairs/NN.json in that folder (one entry per line; read all of it).
Write your result to verdicts/NN.json in that folder. Do not read any other file under verdicts/.
Put all your cards.txt searches into one or two Bash calls (several grep commands in one call).
Copy every card id exactly as the batch gives it.

Reply with one line: the number of verdicts and how many are "same".
```

- A whole deck is about six batches and 850,000 Haiku tokens. Say the count before you start
  more than a handful.
- A judge's one-line reply is its own count, not a result. The result is what `report` prints.
- `check-verdicts.py` corrects an id that is one slip away from the only unjudged card of its
  point, and names everything else. For those, look at the pair and write the verdict yourself.
- To measure the judges, give one batch to a second judge that writes into another folder and
  compare. Expect about 93 percent of pairs and nearly every point to agree.

## The verdict on a change

Build and judge at least two, better three, builds of each side, then:

```sh
node eval/bench.ts gate $RUBRIC --old $OLD1 --old $OLD2 --old $OLD3 --new $NEW1 --new $NEW2 --new $NEW3
```

It prints each side's mean, the difference against what builds of the same code make
believable, every guard, and a last line:

| `Verdict:` | Means | Do |
| --- | --- | --- |
| `better` | above the bar, every guard holds | confirm once on the test rubric, then report |
| `unclear` | within what builds differ by | more builds a side, or a larger change; do not claim a gain |
| `worse` | below by more than the bar | drop the change |
| `guard` | a limit is broken, whatever the score | stop and put the trade to Steffen |

The guards: the deck at most 5 percent bigger, answers at most 10 percent longer, at most 10
percent more calls and tokens written. Calls and tokens stand in for time, which the clock
measures too noisily.

Report a result with both sides' figures, the bar, the guards, how many builds, which rubric,
and what was not checked. A figure from one build is a reading, not a finding.

## When a number looks wrong

- **A run scores differently than before.** It should not: a run counts its own shortlist and
  its own judges' finds, and a pair keeps its first verdict. Check that `cards.json` and the
  rubric are the files that were judged.
- **A score seems low for what the deck holds.** A card outside the eight-card shortlist is
  missed unless its judge found it by searching: about 2 points of a deck, the same for every
  run.
- **Judges disagree on a point.** The point probably bundles several facts. A point is one
  fact; fix the rubric (`eval/RUBRIC.md`), which changes its key and asks for new verdicts.
- **A new course.** It needs its own rubrics, written by `eval/RUBRIC.md` from papers held back
  from the build, and a person who knows the course to check them.
