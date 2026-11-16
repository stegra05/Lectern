# Changing the board

The board is user-owned project 3 of `stegra05`, linked to `stegra05/Lectern`. The local `gh`
token needs the `project` scope; GitHub Actions' built-in token cannot reach user-owned projects
at all, which is why nothing in CI writes to the board.

## What can be scripted

| Thing | How |
|---|---|
| Items and field values | `board.sh`, or `gh project item-edit` / GraphQL `updateProjectV2ItemFieldValue` |
| Single-select fields with option colours and descriptions | GraphQL `createProjectV2Field` / `updateProjectV2Field` (`gh project field-create` cannot set colours) |
| Issue types (account-wide: they show in every stegra05 repo) | GraphQL `createIssueType`, `updateIssueType`, `updateIssueIssueType` |
| Dependencies | GraphQL `addBlockedBy` / `removeBlockedBy`; parents with `addSubIssue` |
| New views with grouping and sorting | REST `POST /users/stegra05/projectsV2/3/views` with header `X-GitHub-Api-Version: 2026-03-10`; body `name`, `layout` (table, board, roadmap), `filter`, `visible_fields`, `group_by`, `vertical_group_by` (board columns), `sort_by` (`[[field_id,"asc"]]`). Field ids come from `GET /users/stegra05/projectsV2/3/fields` |
| A view's name, filter or visible fields | GraphQL `updateProjectV2View`; grouping and sorting cannot be changed, so recreate the view |
| View order | the order views were created in; dragging a tab in the browser does not work reliably, so recreate the views that should come later |
| Testing a filter | GraphQL `projectV2.items(query: "<filter>")` evaluates it exactly as the view does |

## What is browser-only

The built-in workflows at https://github.com/users/stegra05/projects/3/workflows can only be
turned on and edited in the browser. Current setup:

| Workflow | Setting |
|---|---|
| Item added to project | Status Backlog |
| Item closed | Status Done |
| Item reopened | Status Next |
| Pull request merged | Status Done |
| Auto-add to project | repo Lectern, `is:issue is:open -label:v2` |
| Auto-archive items | `is:issue is:closed updated:<@today-1m` |
| Auto-add sub-issues to project | on |

"Pull request linked to issue" stays off: GitHub only links PRs into the default branch.

## Gotchas

- Issue search lags a few seconds behind writes: `gh issue list --label` may miss a label just
  added. `gh issue view` is current.
- Labels cannot group or slice a view; anything a view groups by must be a field or the type.
- A filter's OR works across fields only inside parentheses: `(type:Decision OR label:"costs money")`.
- Deleting a label strips it from closed v2 issues too. `bug`, `enhancement` and `v2` are used by
  the v2 issue templates on `main`; keep them.
