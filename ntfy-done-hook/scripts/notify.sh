#!/usr/bin/env bash
# ntfy-done-hook: the command Claude Code runs on Stop and Notification events.
# Reads the hook's JSON on stdin and posts one ntfy message. install.sh copies
# this file to ~/.claude/hooks/ and registers it; you don't run it by hand.
#
#   notify.sh --topic T [--server URL] [--title TEXT] [--no-session]
#             [--no-device] [--no-summary] [--dry-run]
#
# Stop: "작업 완료", or "답변 필요" when the turn ended with a question for you.
# Notification (permission prompt, MCP input request): "확인 필요".
# --dry-run prints the JSON instead of sending it. Never fails the session:
# every error is swallowed and the exit code is always 0.
set -u

TOPIC="" SERVER="https://ntfy.sh" TITLE="Claude Code 작업 완료"
SESSION=1 DEVICE=1 SUMMARY=1 DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --topic|--server|--title) [ $# -ge 2 ] || break ;;
  esac
  case "$1" in
    --topic) TOPIC="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --no-session) SESSION=0; shift ;;
    --no-device) DEVICE=0; shift ;;
    --no-summary) SUMMARY=0; shift ;;
    --dry-run) DRY=1; shift ;;
    *) shift ;;
  esac
done
[ -n "$TOPIC" ] || exit 0

HOOK_IN="$(cat)"
field() { printf '%s' "$HOOK_IN" | jq -r "$1 // empty" 2>/dev/null; }
TP="$(field .transcript_path)"
[ -f "$TP" ] || TP=""

# Session name: the latest title the app gave the session (also set by /rename).
SESSION_NAME=""
if [ "$SESSION" = 1 ] && [ -n "$TP" ]; then
  SESSION_NAME="$(grep -F custom-title "$TP" 2>/dev/null \
    | jq -r 'select(.type? == "custom-title") | .customTitle // empty' 2>/dev/null | tail -n 1)"
fi

# Device and how Claude Code is being run here.
DEV="" WHERE=""
if [ "$DEVICE" = 1 ]; then
  DEV="$(scutil --get ComputerName 2>/dev/null || hostname -s 2>/dev/null || uname -n)"
  case "${CLAUDE_CODE_ENTRYPOINT:-}" in
    claude-desktop) WHERE="Desktop 앱" ;;
    cli) WHERE="CLI" ;;
    claude-vscode) WHERE="VS Code" ;;
    sdk-*) WHERE="SDK" ;;
    "") WHERE="" ;;
    *) WHERE="$CLAUDE_CODE_ENTRYPOINT" ;;
  esac
  [ "${CLAUDE_CODE_REMOTE:-}" = true ] && WHERE="클라우드"
  [ -n "${SSH_CONNECTION:-}" ] && WHERE="${WHERE:-Claude Code} (SSH)"
fi

# What happened in the last turn. Only entries after the turn's opening prompt
# count, so a question from an earlier turn never resurfaces. The Desktop app
# ends each turn with a wrap_up call: its recap is the summary and its ask is
# the open question. Without one, the last reply's first line is the summary
# and a last line ending in "?" is the question.
TURN='{}'
if [ "$SUMMARY" = 1 ] && [ -n "$TP" ]; then
  TURN="$(tail -n 400 "$TP" 2>/dev/null | jq -Rnc '
    [inputs | fromjson? | select(type == "object")] as $all
    | ([$all | to_entries[]
        | select(.value.type == "user" and .value.isMeta != true
            and ((.value.message.content | type) == "string"
                 or any(.value.message.content[]?; .type? == "text")))
        | .key] | last // -1) as $start
    | $all[($start + 1):] as $turn
    | ([$turn[] | select(.type == "assistant") | .message.content[]?
        | select(.type? == "tool_use" and ((.name // "") | endswith("wrap_up"))) | .input] | last) as $w
    | ([$turn[] | select(.type == "assistant") | .message.content[]?
        | select(.type? == "text") | .text] | last // "") as $text
    | {recap: ($w.recap // ""), ask: ($w.ask // ""), wrapped: ($w != null), text: $text}' 2>/dev/null)"
  [ -n "$TURN" ] || TURN='{}'
fi

BODY="$(printf '%s' "$HOOK_IN" | jq -c \
  --arg topic "$TOPIC" --arg title "$TITLE" --arg session "$SESSION_NAME" \
  --arg dev "$DEV" --arg where "$WHERE" --argjson turn "$TURN" '
  def clean: gsub("\\[(?<t>[^\\]]*)\\]\\([^)]*\\)"; "\(.t)") | gsub("\\*\\*|`"; "")
    | gsub("^\\s*(#+|[-*>]|\\d+\\.)\\s+"; "") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ");
  def lines: gsub("```[\\s\\S]*?(```|$)"; "\n") | split("\n") | map(clean) | map(select(length > 0));
  def cut($n): if length > $n then .[0:$n] + "…" else . end;

  ((.cwd // "") | split("/") | map(select(. != "")) | last // "/") as $project
  | (.hook_event_name // "Stop") as $event
  | (if (.last_assistant_message // "") != "" then .last_assistant_message else ($turn.text // "") end) as $text
  | (if $turn.wrapped == true then ($turn.ask // "")
     else (($text | lines | last // "") | if endswith("?") or endswith("？") then . else "" end) end) as $ask
  | (if $turn.wrapped == true then ($turn.recap // "") else ($text | lines | first // "") end) as $summary
  | ([ "📁 " + $project ]
     + (if $session != "" then ["💬 " + $session] else [] end) | join(" · ")) as $where_line
  | (if $dev != "" then "🖥️ " + $dev + (if $where != "" then " · " + $where else "" end) else "" end) as $device_line
  | if $event == "Notification" then
      {title: "Claude Code 확인 필요", priority: 4, tags: ["warning"],
       first: ("🔐 " + ((.message // "Claude가 확인을 기다리고 있어요") | cut(200)))}
    elif $ask != "" then
      {title: "Claude Code 답변 필요", priority: 4, tags: ["question"],
       first: ("❓ " + ($ask | cut(200)) + (if $summary != "" then "\n📝 " + ($summary | cut(160)) else "" end))}
    else
      {title: $title, priority: 3, tags: ["white_check_mark"],
       first: (if $summary != "" then "📝 " + ($summary | cut(220)) else "" end)}
    end
  | {topic: $topic, title, priority, tags,
     message: ([.first, $where_line, $device_line] | map(select(. != "")) | join("\n"))}
' 2>/dev/null)" || exit 0
[ -n "$BODY" ] || exit 0

if [ "$DRY" = 1 ]; then
  printf '%s\n' "$BODY"
else
  printf '%s' "$BODY" | curl -sS -m 8 -X POST -H 'Content-Type: application/json' -d @- "$SERVER" >/dev/null 2>&1
fi
exit 0
