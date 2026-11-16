#!/usr/bin/env bash
# Keeps pull requests and issues tied to the roadmap board.
#
#   roadmap.sh before-bash  PreToolUse Bash: `gh pr create` must name its issue
#                           ("Closes #N") or carry "No issue: <why>" in its body
#   roadmap.sh after-bash   PostToolUse Bash: after `gh pr create` or `gh stack
#                           submit`, the issues the PRs close move to In review,
#                           and stack PRs that name no issue are reported; an
#                           issue created outside board.sh gets a reminder
#
# Hook input arrives as JSON on stdin. Only issues already on the board move:
# board.sh never adds one, so a v2 issue named in a PR stays off the v3 board.

set -u
input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
board="${CLAUDE_PROJECT_DIR:-.}/.claude/skills/roadmap/board.sh"

runs() { grep -qE "(^|[;&|(] *)$1" <<<"$cmd"; }

# the PR body: the command line itself, plus a --body-file / -F if it can be read
pr_body() {
  local file
  file=$(grep -oE -- '(--body-file|-F)[= ]+[^ ;&|]+' <<<"$cmd" | head -1 | sed -E 's/^(--body-file|-F)[= ]+//; s/^["'\'']//; s/["'\'']$//')
  printf '%s\n' "$cmd"
  [ -n "$file" ] && [ -f "$file" ] && cat "$file"
}

closed_issues() {
  grep -oiE '\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #[0-9]+' | grep -oE '[0-9]+' | sort -u
}

no_issue() { grep -q 'No issue: '; }

# moves each issue to In review; prints the ones that moved
review() {
  local n
  for n in "$@"; do
    "$board" set "$n" Status "In review" >/dev/null 2>&1 && printf '#%s ' "$n"
  done
}

context() {
  jq -n --arg c "$1" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
}

case "${1:-}" in
  before-bash)
    runs 'gh pr create' || exit 0
    body=$(pr_body)
    [ -n "$(closed_issues <<<"$body")" ] && exit 0
    no_issue <<<"$body" && exit 0
    echo 'Roadmap: a PR names its issue with "Closes #N" in its body, so the issue moves to In review now and to Done when the PR merges into v3. If no issue fits, write "No issue: <why>" in the body instead.' >&2
    exit 2
    ;;
  after-bash)
    if runs 'gh pr create'; then
      jq -r '.tool_response.stdout // empty' <<<"$input" | grep -qE 'github\.com/.+/pull/[0-9]+' || exit 0
      # shellcheck disable=SC2046
      moved=$(review $(pr_body | closed_issues))
      [ -z "$moved" ] || context "Roadmap: moved ${moved% } to In review on the board."
    elif runs 'gh stack submit'; then
      [ -z "$cwd" ] || cd "$cwd" || exit 0
      prs=$(gh stack view --json 2>/dev/null | jq -r '.branches[] | select(.pr.state == "OPEN") | .pr.number') || exit 0
      [ -n "$prs" ] || exit 0
      bodies=$(gh pr list --state open --limit 200 --json number,body)
      issues="" missing=""
      for pr in $prs; do
        body=$(jq -r --argjson n "$pr" '.[] | select(.number == $n) | .body' <<<"$bodies")
        found=$(closed_issues <<<"$body")
        if [ -n "$found" ]; then issues+=" $found"
        elif ! no_issue <<<"$body"; then missing+="#$pr "
        fi
      done
      # shellcheck disable=SC2086
      moved=$(review $(tr ' ' '\n' <<<"$issues" | sort -u))
      msg=""
      [ -z "$moved" ] || msg="Roadmap: moved ${moved% } to In review on the board. "
      [ -z "$missing" ] || msg+="Stack PRs ${missing% } name no issue. Add \"Closes #N\" (or \"No issue: <why>\") with \`gh pr edit <pr> --body-file <file>\`, then \`.claude/skills/roadmap/board.sh set <issue> Status \"In review\"\`. With --auto, a single-commit layer takes its PR body from the commit body, so put \"Closes #N\" there."
      [ -z "$msg" ] || context "$msg"
    elif runs 'gh issue create'; then
      jq -r '.tool_response.stdout // empty' <<<"$input" | grep -qE 'github\.com/.+/issues/[0-9]+' || exit 0
      context 'Roadmap: this issue was made outside board.sh, so it has no type, Area or Size yet. Set them with `.claude/skills/roadmap/board.sh set <n> Type|Area|Size|Priority "<value>"`, or the Triage view keeps listing it.'
    fi
    ;;
esac
exit 0
