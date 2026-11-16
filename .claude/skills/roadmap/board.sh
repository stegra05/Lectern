#!/usr/bin/env bash
# The Lectern v3 roadmap board from the command line. Fields, options, issue
# types and view filters are looked up by name, so renaming one on the board
# needs no change here.
#
#   board.sh views                      list the board's views
#   board.sh view "Agent queue"         the items a view's filter matches, P0 first
#   board.sh show 112                   one issue's board fields, labels and blockers
#   board.sh set 112 Status "In review" set Status, Area, Priority, Size, Type or Milestone
#   board.sh clear 112 Priority         empty a board field (Status, Area, Priority, Size)
#   board.sh block 130 --by 108         130 waits on 108
#   board.sh new "Title" --type Feature --area App --size M --milestone "v3.0 base" \
#       [--priority P1] --body-file body.md
#
# set and clear only touch issues already on the board; open v3 issues join it
# by themselves, v2 issues never do.

set -euo pipefail
OWNER=stegra05
NUMBER=3
REPO=stegra05/Lectern

die() { echo "board.sh: $*" >&2; exit 1; }
gql() { gh api graphql -f owner="$OWNER" -F number="$NUMBER" "$@"; }

# one tab-separated row per issue; the first column only sorts (P9 = no priority)
ROW='def row($c; $fv):
  ([$fv[] | select(.field) | {(.field.name): .name}] | add // {}) as $f
  | [($f.Priority // "P9"), "#\($c.number)", ($f.Status // "-"), ($c.issueType.name // "-"),
     ($f.Area // "-"), ($f.Priority // "-"), ($f.Size // "-"), ($c.milestone.title // "-"), $c.title]
  | @tsv;'
FIELD_VALUES='fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue {
  name field { ... on ProjectV2FieldCommon { name } } } } }'
ISSUE_FIELDS='number title issueType { name } milestone { title }'

table() { sort -t$'\t' -k1,1 -k2,2V | cut -f2- | column -t -s$'\t'; }

project_id() {
  gql -f query='query($owner: String!, $number: Int!) {
    user(login: $owner) { projectV2(number: $number) { id } } }' --jq .data.user.projectV2.id
}

issue() {
  gql -F n="$1" -f repo="${REPO#*/}" -f query="query(\$owner: String!, \$repo: String!, \$n: Int!) {
    repository(owner: \$owner, name: \$repo) { issue(number: \$n) {
      id $ISSUE_FIELDS
      labels(first: 20) { nodes { name } }
      blockedBy(first: 20) { nodes { number state title } }
      projectItems(first: 20) { nodes { id project { number } $FIELD_VALUES } } } } }" \
    --jq .data.repository.issue 2>/dev/null || die "no issue #$1"
}

# id of the issue's item on the board; with "add", puts the issue on the board first
item_id() {
  local json id
  json=$(issue "$1")
  id=$(jq -r --argjson p "$NUMBER" '.projectItems.nodes[] | select(.project.number == $p) | .id' <<<"$json")
  if [ -z "$id" ]; then
    [ "${2:-}" = add ] || die "#$1 is not on the board (open v3 issues join by themselves, v2 issues never do)"
    id=$(gql -f p="$(project_id)" -f c="$(jq -r .id <<<"$json")" -f query='mutation($p: ID!, $c: ID!) {
      addProjectV2ItemById(input: {projectId: $p, contentId: $c}) { item { id } } }' \
      --jq .data.addProjectV2ItemById.item.id)
  fi
  echo "$id"
}

# "<field id> <option id>" of a single-select field, or just the field id without a value
field_ids() {
  local out
  out=$(gql -f query='query($owner: String!, $number: Int!) { user(login: $owner) { projectV2(number: $number) {
      fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }' |
    jq -r --arg f "$1" --arg v "${2:-}" '.data.user.projectV2.fields.nodes[] | select(.name == $f)
      | if $v == "" then .id else "\(.id) \(.options[] | select(.name == $v) | .id)" end')
  [ -n "$out" ] || die "no board field \"$1\"${2:+ with an option \"$2\"}"
  echo "$out"
}

type_id() {
  local out
  out=$(gql -f query='query($owner: String!) { user(login: $owner) { issueTypes(first: 25) { nodes { id name } } } }' |
    jq -r --arg v "$1" '.data.user.issueTypes.nodes[] | select(.name == $v) | .id')
  [ -n "$out" ] || die "no issue type \"$1\""
  echo "$out"
}

check_milestone() {
  gh api "repos/$REPO/milestones?state=open&per_page=100" |
    jq -e --arg m "$1" 'any(.[]; .title == $m)' >/dev/null || die "no open milestone \"$1\""
}

set_field() {
  local n=$1 field=$2 value=$3 ids fid oid tid node item
  case "$field" in
    Type)
      tid=$(type_id "$value")
      node=$(issue "$n")
      node=$(jq -r .id <<<"$node")
      gql -f i="$node" -f t="$tid" -f query='mutation($i: ID!, $t: ID!) {
        updateIssueIssueType(input: {issueId: $i, issueTypeId: $t}) { issue { number } } }' >/dev/null
      ;;
    Milestone)
      check_milestone "$value"
      gh issue edit "$n" -R "$REPO" --milestone "$value" >/dev/null
      ;;
    *)
      ids=$(field_ids "$field" "$value")
      read -r fid oid <<<"$ids"
      item=$(item_id "$n" "${4:-}")
      gql -f p="$(project_id)" -f i="$item" -f f="$fid" -f o="$oid" -f query='mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
        updateProjectV2ItemFieldValue(input: {projectId: $p, itemId: $i, fieldId: $f, value: {singleSelectOptionId: $o}}) {
          projectV2Item { id } } }' >/dev/null
      ;;
  esac
  echo "#$n $field: $value"
}

# every item a filter matches, all pages
list() {
  local after="" page
  while :; do
    page=$(gql -f q="$1" ${after:+-f after="$after"} -f query="query(\$owner: String!, \$number: Int!, \$q: String!, \$after: String) {
      user(login: \$owner) { projectV2(number: \$number) { items(first: 100, after: \$after, query: \$q) {
        pageInfo { hasNextPage endCursor }
        nodes { content { ... on Issue { $ISSUE_FIELDS } } $FIELD_VALUES } } } } }")
    jq -r "$ROW"' .data.user.projectV2.items.nodes[] | select(.content.number) | row(.content; .fieldValues.nodes)' <<<"$page"
    [ "$(jq -r .data.user.projectV2.items.pageInfo.hasNextPage <<<"$page")" = true ] || break
    after=$(jq -r .data.user.projectV2.items.pageInfo.endCursor <<<"$page")
  done | table
}

views() {
  gql -f query='query($owner: String!, $number: Int!) { user(login: $owner) { projectV2(number: $number) {
    views(first: 30) { nodes { name filter } } } } }' --jq .data.user.projectV2.views.nodes
}

cmd=${1:-}
shift || true
case "$cmd" in
  views)
    views | jq -r '.[] | "\(.name)\t\(.filter // "")"' | column -t -s$'\t'
    ;;
  view)
    [ $# -eq 1 ] || die 'usage: board.sh view "<view name>"'
    filter=$(views | jq -r --arg v "$1" '.[] | select(.name == $v) | .filter // ""')
    [ -n "$filter" ] || die "no view \"$1\" with a filter (board.sh views lists them)"
    list "$filter"
    ;;
  show)
    [ $# -eq 1 ] || die "usage: board.sh show <issue>"
    json=$(issue "$1")
    row=$(jq -r --argjson p "$NUMBER" "$ROW"' . as $i | $i.projectItems.nodes[] | select(.project.number == $p)
      | row($i; .fieldValues.nodes)' <<<"$json")
    if [ -n "$row" ]; then table <<<"$row"; else echo "#$1 is not on the board: $(jq -r .title <<<"$json")"; fi
    jq -r '"labels: \([.labels.nodes[].name] | join(", "))",
      (.blockedBy.nodes[] | "blocked by #\(.number) (\(.state)) \(.title)")' <<<"$json"
    ;;
  set)
    [ $# -eq 3 ] || die 'usage: board.sh set <issue> <Status|Area|Priority|Size|Type|Milestone> "<value>"'
    set_field "$@"
    ;;
  clear)
    [ $# -eq 2 ] || die "usage: board.sh clear <issue> <Status|Area|Priority|Size>"
    fid=$(field_ids "$2")
    item=$(item_id "$1")
    gql -f p="$(project_id)" -f i="$item" -f f="$fid" -f query='mutation($p: ID!, $i: ID!, $f: ID!) {
      clearProjectV2ItemFieldValue(input: {projectId: $p, itemId: $i, fieldId: $f}) { projectV2Item { id } } }' >/dev/null
    echo "#$1 $2: cleared"
    ;;
  block)
    [ $# -eq 3 ] && [ "$2" = --by ] || die "usage: board.sh block <issue> --by <issue>[,<issue>...]"
    json=$(issue "$1")
    node=$(jq -r .id <<<"$json")
    for b in ${3//,/ }; do
      json=$(issue "$b")
      gql -f i="$node" -f b="$(jq -r .id <<<"$json")" -f query='mutation($i: ID!, $b: ID!) {
        addBlockedBy(input: {issueId: $i, blockingIssueId: $b}) { issue { number } } }' >/dev/null
      echo "#$1 blocked by #$b"
    done
    ;;
  new)
    [ $# -ge 1 ] || die "usage: board.sh new \"<title>\" --type T --area A --size S --milestone M [--priority P] --body-file F"
    title=$1
    shift
    type="" area="" size="" milestone="" priority="" body=""
    while [ $# -gt 0 ]; do
      [ $# -ge 2 ] || die "$1 needs a value"
      case "$1" in
        --type) type=$2 ;;
        --area) area=$2 ;;
        --size) size=$2 ;;
        --milestone) milestone=$2 ;;
        --priority) priority=$2 ;;
        --body-file) body=$2 ;;
        *) die "unknown option $1" ;;
      esac
      shift 2
    done
    [ -n "$type" ] && [ -n "$area" ] && [ -n "$size" ] && [ -n "$milestone" ] && [ -n "$body" ] ||
      die "new needs --type, --area, --size, --milestone and --body-file"
    [ -f "$body" ] || die "no file $body"
    grep -q 'Done when' "$body" || die "the body needs a \"Done when\" section with checkable criteria"
    # check every value before anything is created
    type_id "$type" >/dev/null
    field_ids Area "$area" >/dev/null
    field_ids Size "$size" >/dev/null
    [ -z "$priority" ] || field_ids Priority "$priority" >/dev/null
    check_milestone "$milestone"
    url=$(gh issue create -R "$REPO" --title "$title" --body-file "$body" --milestone "$milestone")
    n=${url##*/}
    echo "$url"
    item_id "$n" add >/dev/null
    set_field "$n" Type "$type"
    set_field "$n" Area "$area"
    set_field "$n" Size "$size"
    [ -z "$priority" ] || set_field "$n" Priority "$priority"
    ;;
  *)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    [ -z "$cmd" ] || exit 1
    ;;
esac
