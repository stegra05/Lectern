#!/usr/bin/env bash
# The Lectern v3 roadmap board from the command line. Fields, options, issue
# types and view filters are looked up by name, so renaming one on the board
# needs no change here.
#
#   board.sh views                      list the board's views
#   board.sh view "Agent queue"         the open items a view shows, by priority
#   board.sh show 112                   one issue's board fields and blockers
#   board.sh set 112 Status "In review" set Status, Area, Priority, Size, Type or Milestone
#   board.sh block 130 --by 108         130 waits on 108
#   board.sh new "Title" --type Feature --area App --size M --milestone "v3.0 base" \
#       [--priority P1] --body-file body.md

set -euo pipefail
OWNER=stegra05
NUMBER=3
REPO=stegra05/Lectern

die() { echo "board.sh: $*" >&2; exit 1; }
gql() { gh api graphql "$@"; }

project_id() {
  gql -f query="query{user(login:\"$OWNER\"){projectV2(number:$NUMBER){id}}}" \
    --jq .data.user.projectV2.id
}

# id of the issue's item on the board, adding the issue if it is not on it yet
item_id() {
  local n=$1 out id
  out=$(gql -F n="$n" -f query="query(\$n:Int!){repository(owner:\"$OWNER\",name:\"${REPO#*/}\"){issue(number:\$n){id projectItems(first:20){nodes{id project{number}}}}}}")
  id=$(jq -r ".data.repository.issue.projectItems.nodes[]|select(.project.number==$NUMBER)|.id" <<<"$out")
  if [ -z "$id" ]; then
    local issue
    issue=$(jq -r .data.repository.issue.id <<<"$out")
    [ "$issue" != null ] || die "no issue #$n"
    id=$(gql -f query="mutation{addProjectV2ItemById(input:{projectId:\"$(project_id)\",contentId:\"$issue\"}){item{id}}}" \
      --jq .data.addProjectV2ItemById.item.id)
  fi
  echo "$id"
}

issue_node() {
  gql -F n="$1" -f query="query(\$n:Int!){repository(owner:\"$OWNER\",name:\"${REPO#*/}\"){issue(number:\$n){id}}}" \
    --jq .data.repository.issue.id
}

set_field() {
  local n=$1 field=$2 value=$3
  case "$field" in
    Type)
      local type
      type=$(gql -f query="query{user(login:\"$OWNER\"){issueTypes(first:25){nodes{id name}}}}" \
        --jq ".data.user.issueTypes.nodes[]|select(.name==\"$value\")|.id")
      [ -n "$type" ] || die "no issue type \"$value\""
      gql -f query="mutation{updateIssueIssueType(input:{issueId:\"$(issue_node "$n")\",issueTypeId:\"$type\"}){issue{number}}}" >/dev/null
      ;;
    Milestone)
      gh issue edit "$n" -R "$REPO" --milestone "$value" >/dev/null
      ;;
    *)
      local fields ids
      fields=$(gql -f query="query{user(login:\"$OWNER\"){projectV2(number:$NUMBER){fields(first:50){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}}}}}")
      ids=$(jq -r --arg f "$field" --arg v "$value" \
        '.data.user.projectV2.fields.nodes[]|select(.name==$f)|"\(.id) \(.options[]|select(.name==$v)|.id)"' <<<"$fields")
      [ -n "$ids" ] || die "no field \"$field\" with option \"$value\""
      read -r fid oid <<<"$ids"
      gql -f query="mutation{updateProjectV2ItemFieldValue(input:{projectId:\"$(project_id)\",itemId:\"$(item_id "$n")\",fieldId:\"$fid\",value:{singleSelectOptionId:\"$oid\"}}){projectV2Item{id}}}" >/dev/null
      ;;
  esac
  echo "#$n $field: $value"
}

# board fields of the items matching a filter, P0 first
list() {
  gql -f q="$1" -f query="query(\$q:String!){user(login:\"$OWNER\"){projectV2(number:$NUMBER){items(first:100,query:\$q){nodes{
      content{... on Issue{number title issueType{name} milestone{title}}}
      fieldValues(first:20){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}}}}}}}}" \
    --jq '.data.user.projectV2.items.nodes[]
      | ([.fieldValues.nodes[]|select(.field)|{(.field.name):.name}]|add) as $f
      | [(($f.Priority // "P9")), (.content.number|tostring|("#"+.)), ($f.Status // "-"), (.content.issueType.name // "-"),
         ($f.Area // "-"), ($f.Priority // "-"), ($f.Size // "-"), (.content.milestone.title // "-"), .content.title]
      | @tsv' |
    sort -t$'\t' -k1,1 -k2,2V | cut -f2- | column -t -s$'\t'
}

cmd=${1:-}
shift || true
case "$cmd" in
  views)
    gql -f query="query{user(login:\"$OWNER\"){projectV2(number:$NUMBER){views(first:30){nodes{name filter}}}}}" \
      --jq '.data.user.projectV2.views.nodes[]|"\(.name)\t\(.filter // "")"' | column -t -s$'\t'
    ;;
  view)
    [ $# -eq 1 ] || die 'usage: board.sh view "<view name>"'
    filter=$(gql -f query="query{user(login:\"$OWNER\"){projectV2(number:$NUMBER){views(first:30){nodes{name filter}}}}}" \
      --jq ".data.user.projectV2.views.nodes[]|select(.name==\"$1\")|.filter // \"\"")
    [ -n "$filter" ] || die "no view \"$1\" with a filter (board.sh views lists them)"
    list "$filter"
    ;;
  show)
    [ $# -eq 1 ] || die "usage: board.sh show <issue>"
    list "is:issue repo:$REPO" | awk -v n="#$1" '$1==n'
    gql -F n="$1" -f query="query(\$n:Int!){repository(owner:\"$OWNER\",name:\"${REPO#*/}\"){issue(number:\$n){
        blockedBy(first:20){nodes{number state title}} labels(first:20){nodes{name}}}}}" \
      --jq '.data.repository.issue | "labels: \([.labels.nodes[].name]|join(", "))",
            (.blockedBy.nodes[] | "blocked by #\(.number) (\(.state)) \(.title)")'
    ;;
  set)
    [ $# -eq 3 ] || die 'usage: board.sh set <issue> <Status|Area|Priority|Size|Type|Milestone> "<value>"'
    set_field "$@"
    ;;
  block)
    [ $# -ge 3 ] && [ "$2" = --by ] || die "usage: board.sh block <issue> --by <issue>[,<issue>...]"
    issue=$(issue_node "$1")
    for b in ${3//,/ }; do
      gql -f query="mutation{addBlockedBy(input:{issueId:\"$issue\",blockingIssueId:\"$(issue_node "$b")\"}){issue{number}}}" >/dev/null
      echo "#$1 blocked by #$b"
    done
    ;;
  new)
    [ $# -ge 1 ] || die "usage: board.sh new \"<title>\" --type T --area A --size S --milestone M [--priority P] --body-file F"
    title=$1
    shift
    type= area= size= milestone= priority= body=
    while [ $# -gt 0 ]; do
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
    [ -n "$type" ] && [ -n "$area" ] && [ -n "$size" ] && [ -n "$milestone" ] && [ -f "$body" ] ||
      die "new needs --type, --area, --size, --milestone and an existing --body-file"
    grep -q 'Done when' "$body" || die "the body needs a \"Done when\" section with checkable criteria"
    url=$(gh issue create -R "$REPO" --title "$title" --body-file "$body" --milestone "$milestone")
    n=${url##*/}
    echo "$url"
    set_field "$n" Type "$type"
    set_field "$n" Area "$area"
    set_field "$n" Size "$size"
    set_field "$n" Status Backlog
    [ -z "$priority" ] || set_field "$n" Priority "$priority"
    ;;
  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    [ -z "$cmd" ] || exit 1
    ;;
esac
