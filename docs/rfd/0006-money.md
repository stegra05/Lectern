# RFD 6 · Every run says its price first

|           |                                                       |
| --------- | ----------------------------------------------------- |
| **State** | decided                                               |
| **Date**  | 2026-11-14                                            |
| **Code**  | `packages/engine/src/cost.ts`, `ask.ts`, `adapters/openai.ts` |
| **Detail**| [architecture, section 5](../architecture.md#5-where-money-is-spent-the-estimate-and-the-cap) |

> **In one breath.** An estimate before the first paid call, a cap at three times that,
> OpenAI only, and 50 dollars for evals.

## Decision

- **Estimate first.** `estimate` is a pure function of characters, slides, pictures, the goal
  and the price lists. It calls no model; the app shows it in euros, rounded up to a coarse step.
- **Cap.** `max(3 × estimate, 0.25 dollars)`, or the command's own `--cap`. The cap counts
  calls in flight at their estimate: each call reserves its expected cost before it starts (its
  input by the estimate's measures, its reply at the estimate's figure for that kind of call),
  and the reservation is settled with the real cost when the call ends. A call that would take
  what is spent plus what is reserved above the cap does not start, and the build fails. A run
  can pass the cap only by how far the replies in flight run past their estimate, and a decision
  request with more than 200 questions, whose input the provider is sent once per 200, by that
  repeated input. A hard limit needs an output limit per call, which is open
  ([#303](https://github.com/stegra05/Lectern/issues/303)). The lectures finished by then stay
  saved, so building again pays only for the rest.
- **A stopped run records its cost** in `runs/NNN.json` like any other run, marked `failed`.
- **OpenAI only, for now.** Steffen has credits there. The Anthropic adapter was removed.
  The provider layer stays easy to swap for hosted keys later
  ([#101](https://github.com/stegra05/lectern/issues/101)).
- **Paid runs only through the engine**, each preceded by its estimate, within the 50 dollars
  he set for evals. Any other paid run needs his yes. Keys come from the macOS keychain by
  environment variable, never from a file.
- **Sorting added files is the one paid call outside a build.** A file whose name does not
  keep it out costs one decision request of about 700 tokens, under a hundredth of a cent
  (56 files of the Entrepreneurship folder: 0.38 cents); a course folder of a hundred such
  files costs under a cent. It has no estimate first and its cost is not recorded,
  since showing a price for it would cost the student more attention than it costs money.
- **The prompt cache is set on purpose**: an explicit breakpoint, the same reply form and
  effort, and the first card of each type runs ahead to fill the cache.
- **Calls are paced to the key's tokens a minute.** A key's limit counts cached input too, so
  caching lowers the bill, not the ceiling. The writing model's calls wait until the last
  minute leaves room, at 90 percent of the limit the provider reports with its first answer.
  On the eval key (5,000 requests and 2 million tokens a minute, measured 2026-11-16) a build
  sent without pacing was stopped by rate limits ([#199](https://github.com/stegra05/lectern/issues/199)).
- **The calls everything waits for go on the faster tier**: sorting a lecture's facts and the
  exam families, at twice the price (fast mode, checked for `gpt-6-luna` on 2026-11-16), for
  about 2 cents more a build and 3 minutes less.

## Why

The first full run before the cache fix cost 48.4 cents, 2.6 times its estimate. With the
fix the same decks cost 16.7 cents, and one deck 60 percent less. The full slide-by-slide run
of 2026-11-15 cost 45 cents against an estimate of 69.

Spent from the 50 dollars: about 1.10 by the end of 2026-11-14, plus the runs of 2026-11-15.
Each run records its own cost in `runs/NNN.json` of its course folder, in dollars and in euros
(`costEur`, as the app shows it). A run that fails is recorded too, marked `failed`, so money
spent on it shows.

## Unverified

- Prices are constants from v2, never checked against an OpenAI bill. Cached decision input is
  priced at the full rate as an upper bound.
- Whether `gpt-6-luna` accepts an effort below `low`.
- Whether the Decisions API shares the writing model's tokens a minute. It is not paced; no
  decision request has been limited so far.

## Open

- The default models are not yet chosen by eval: [#130](https://github.com/stegra05/lectern/issues/130).
