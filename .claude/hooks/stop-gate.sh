#!/usr/bin/env bash
# Stop gate: typecheck and tests must pass before a session stops, but only
# for a session that changed src itself. Sessions share checkouts, and one
# that only read code must not be held by another's work in progress.
#
#   stop-gate.sh mark         PostToolUse Write|Edit|NotebookEdit
#   stop-gate.sh before-bash  PreToolUse Bash: note the state of src
#   stop-gate.sh after-bash   PostToolUse Bash: mark if the command changed it
#   stop-gate.sh check        Stop
#
# Hook input arrives as JSON on stdin; only session_id is read.

set -u
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

id=$(jq -r '.session_id // empty')
[ -n "$id" ] || exit 0
dir="${TMPDIR:-/tmp}/lectern-stop-gate"
mkdir -p "$dir"
marker="$dir/$id"
paths=(src src-tauri/src)

src_state() {
  {
    git status --porcelain -- "${paths[@]}"
    git diff -- "${paths[@]}"
    git ls-files -z --others --exclude-standard -- "${paths[@]}" | xargs -0 shasum 2>/dev/null
  } | shasum
}

case "${1:-}" in
  mark)
    touch "$marker"
    ;;
  before-bash)
    src_state >"$marker.bash"
    ;;
  after-bash)
    [ -e "$marker.bash" ] || exit 0
    [ "$(src_state)" = "$(cat "$marker.bash")" ] || touch "$marker"
    rm -f "$marker.bash"
    ;;
  check)
    [ -e "$marker" ] || exit 0
    git status --porcelain -- "${paths[@]}" | grep -q . || { rm -f "$marker"; exit 0; }
    out=$(pnpm typecheck 2>&1) || {
      printf 'Stop gate: typecheck failing:\n%s\n' "$out" | tail -30 >&2
      exit 2
    }
    out=$(pnpm vitest run 2>&1) || {
      printf 'Stop gate: tests failing:\n%s\n' "$out" | tail -30 >&2
      exit 2
    }
    # Passed: later stops gate again only on new changes.
    rm -f "$marker"
    ;;
esac
exit 0
