# RFD 6 · Every run says its price first

|           |                                                       |
| --------- | ----------------------------------------------------- |
| **State** | decided                                               |
| **Date**  | 2026-11-14                                            |
| **Code**  | `packages/engine/src/cost.ts`, `ask.ts`, `adapters/openai.ts` |
| **Detail**| [architecture, section 5](../architecture.md#5-where-money-is-spent-the-estimate-and-the-cap) |

> **In one breath.** An estimate before the first paid call, a hard cap at three times that,
> OpenAI only, and 50 dollars for evals.

## Decision

- **Estimate first.** `estimate` is a pure function of characters, slides, pictures, the goal
  and the price lists. It calls no model; the app shows it in euros, rounded up to a coarse step.
- **Cap.** `max(3 × estimate, 0.25 dollars)`, or the command's own `--cap`. After every paid
  call the meter is checked, and the build fails once the real cost is above the cap. The call
  that passes it and the calls in flight, at most four, are paid. The lectures finished by then
  stay saved, so building again pays only for the rest.
- **A stopped run records its cost** in `runs/NNN.json` like any other run, marked `failed`.
- **OpenAI only, for now.** Steffen has credits there. The Anthropic adapter was removed.
  The provider layer stays easy to swap for hosted keys later
  ([#101](https://github.com/stegra05/lectern/issues/101)).
- **Paid runs only through the engine**, each preceded by its estimate, within the 50 dollars
  he set for evals. Any other paid run needs his yes. Keys come from the macOS keychain by
  environment variable, never from a file.
- **The prompt cache is set on purpose**: an explicit breakpoint, the same reply form and
  effort, and the first card of each type runs ahead to fill the cache.

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
- Rate limits beyond four parallel calls on one account.

## Open

- The default models are not yet chosen by eval: [#130](https://github.com/stegra05/lectern/issues/130).
