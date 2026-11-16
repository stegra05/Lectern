# Working on Lectern v3

## Setup

Node 22 or newer and pnpm 11. `pnpm install` also points git at `.githooks/`, whose pre-commit
hook checks staged package files with Prettier and ESLint.

| Command                                                       | Does                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm check`                                                  | lint, format check, typecheck and unit tests, all packages   |
| `pnpm test:e2e`                                               | builds the app and drives it with Playwright, offline        |
| `pnpm format`                                                 | Prettier over `packages/`                                    |
| `LECTERN_FAKE=1 pnpm --filter @lectern/app start`             | the app on offline models and an Anki in memory              |
| `pnpm --filter @lectern/engine cli <command> <course folder>` | the engine from a command line (`estimate`, `build`, `send`) |

`cli build` spends money on the OpenAI account of `OPENAI_API_KEY`. Every test runs on the
offline models; live tests run only with `LECTERN_LIVE=1`.

## Pull requests

Every change reaches `v3` through a pull request, and CI must pass: lint, format, typecheck and
unit tests, plus the app's end-to-end test.

A pull request does one thing and stays under 1,000 changed lines, so it can be read in one
sitting. Whole-file deletions and renames do not count against that. Work larger than that is
a stack of pull requests, each on top of the one before, with GitHub's
[stacked pull requests](https://github.com/github/gh-stack):

```sh
gh extension install github/gh-stack     # once
gh stack init --base v3 engine-ranking   # first layer
# commit
gh stack add engine-ranking-tests        # next layer on top
# commit
gh stack submit                          # push every layer and open its PR
gh stack rebase                          # after v3 or a lower layer moved
```

Review and merge from the bottom of the stack up.

Commit messages: `type(scope): what changed`, with types `feat`, `fix`, `docs`, `build`, `ci`,
`chore`, `test`, `refactor` and scopes `engine`, `app`, `design`. A pull request that changes
what is true in `docs/status.md` updates it, and one that changes a decision updates its RFD
(`docs/README.md` says how to write one).

## Writing

Plain words in docs and interface copy, no em-dashes. Write what a thing does, not how clever
it is.
