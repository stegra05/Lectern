#!/usr/bin/env bash
# Keeps pull requests and issues tied to the roadmap board.
#
#   roadmap.sh before-bash  PreToolUse Bash: `gh pr create` must name its issue
#                           ("Closes #N") or say "No issue" in its body
#   roadmap.sh after-bash   PostToolUse Bash: a created PR moves the issues it
#                           closes to In review; an issue created outside
#                           board.sh gets a reminder to set its type and fields
#
# Hook input arrives as JSON on stdin.

set -u
input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
board="${CLAUDE_PROJECT_DIR:-.}/.claude/skills/roadmap/board.sh"

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

context() {
  jq -n --arg c "$1" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
}

case "${1:-}" in
  before-bash)
    grep -qE '(^|[;&|(] *)gh pr create' <<<"$cmd" || exit 0
    body=$(pr_body)
    [ -n "$(closed_issues <<<"$body")" ] && exit 0
    grep -qi 'no issue' <<<"$body" && exit 0
    echo 'Roadmap: a PR names its issue with "Closes #N" in its body, so the issue moves to In review now and to Done when the PR merges into v3. If no issue fits, write "No issue: <why>" in the body instead.' >&2
    exit 2
    ;;
  after-bash)
    if grep -qE '(^|[;&|(] *)gh pr create' <<<"$cmd"; then
      jq -r '.tool_response.stdout // empty' <<<"$input" | grep -qE 'github\.com/.+/pull/[0-9]+' || exit 0
      moved=()
      for n in $(pr_body | closed_issues); do
        "$board" set "$n" Status "In review" >/dev/null 2>&1 && moved+=("#$n")
      done
      [ ${#moved[@]} -eq 0 ] || context "Roadmap: moved ${moved[*]} to In review on the board."
    elif grep -qE '(^|[;&|(] *)gh issue create' <<<"$cmd"; then
      jq -r '.tool_response.stdout // empty' <<<"$input" | grep -qE 'github\.com/.+/issues/[0-9]+' || exit 0
      context 'Roadmap: this issue was made outside board.sh, so it has no type, Area or Size yet. Set them with `.claude/skills/roadmap/board.sh set <n> Type|Area|Size|Priority "<value>"`, or the Triage view keeps listing it.'
    fi
    ;;
esac
exit 0
