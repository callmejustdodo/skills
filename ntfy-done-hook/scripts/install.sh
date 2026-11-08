#!/usr/bin/env bash
# Install, replace, or remove Claude Code hooks that send an ntfy push
# notification when Claude finishes a turn or needs you.
#
#   install.sh <topic> [--server URL] [--title TEXT] [--no-session] [--no-device]
#              [--no-summary] [--settings PATH] [--no-test]
#   install.sh --uninstall [--settings PATH]
#
# Copies notify.sh to ~/.claude/hooks/ntfy-done-hook.sh and registers it for
# Stop and Notification (permission prompts). The topic can also come from
# $NTFY_TOPIC. Re-running replaces what this script installed before (commands
# ending with "# ntfy-done-hook"); other hooks and settings are left alone.
set -euo pipefail

TAG=" # ntfy-done-hook"
EVENTS='["Stop","Notification"]'
NOTIFY_MATCHER="permission_prompt|elicitation_dialog"
SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
case "$CONFIG_DIR" in /*) ;; *) CONFIG_DIR="$PWD/$CONFIG_DIR" ;; esac
DEFAULT_SETTINGS="$CONFIG_DIR/settings.json"

TOPIC="${NTFY_TOPIC:-}"
SERVER="https://ntfy.sh"
TITLE="Claude Code 작업 완료"
SETTINGS="$DEFAULT_SETTINGS"
MODE="install"
TEST=1
FLAGS=""

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "error: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --server)     SERVER="${2:?--server needs a URL}"; shift 2 ;;
    --title)      TITLE="${2:?--title needs text}"; shift 2 ;;
    --settings)   SETTINGS="${2:?--settings needs a path}"; shift 2 ;;
    --uninstall)  MODE="uninstall"; shift ;;
    --no-test)    TEST=0; shift ;;
    --no-session|--no-device|--no-summary) FLAGS="$FLAGS $1"; shift ;;
    -h|--help)    usage 0 ;;
    -*)           echo "unknown option: $1" >&2; usage 2 ;;
    *)            TOPIC="$1"; shift ;;
  esac
done

for bin in jq curl; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is required"
done

# Validate every argument before touching the filesystem. These values end up
# inside single quotes in the stored hook command, so quotes are refused.
if [ "$MODE" = "install" ]; then
  [ -n "$TOPIC" ] || die "topic is required (argument or \$NTFY_TOPIC)"
  # ntfy topic names: letters, digits, - and _ (max 64). Anyone who knows the
  # name can read and post to a topic on ntfy.sh, so a long random name is safer.
  [[ "$TOPIC" =~ ^[A-Za-z0-9_-]{1,64}$ ]] || die "topic may only contain letters, digits, - and _ (max 64)"
  [[ "$SERVER" =~ ^https?://[^[:space:]\'\"]+$ ]] || die "server must be an http(s) URL without quotes or spaces"
  [[ "$TITLE" != *"'"* ]] || die "title must not contain a single quote"
  [ -f "$SCRIPT_DIR/notify.sh" ] || die "notify.sh not found next to install.sh"
  SERVER="${SERVER%/}"
fi

# The hook script lives next to the settings file that uses it:
# ~/.claude/hooks/ for user settings, <project>/.claude/hooks/ for a project's.
case "$SETTINGS" in /*) ;; *) SETTINGS="$PWD/$SETTINGS" ;; esac
HOOK_PATH="$(dirname "$SETTINGS")/hooks/ntfy-done-hook.sh"
[[ "$HOOK_PATH" != *"'"* ]] || die "settings path must not contain a single quote"

if [ ! -s "$SETTINGS" ]; then
  [ "$MODE" = "uninstall" ] && { echo "nothing to remove: $SETTINGS does not exist"; exit 0; }
  mkdir -p "$(dirname "$SETTINGS")"
  echo '{}' > "$SETTINGS"
fi

# Refuse to touch a file that isn't valid settings JSON: a broken settings.json
# silently disables every setting in it.
jq -e 'type == "object"' "$SETTINGS" >/dev/null 2>&1 \
  || die "$SETTINGS is not a valid JSON object; fix it first"
jq -e --argjson ev "$EVENTS" '. as $root | (.hooks == null or (.hooks | type) == "object")
    and all($ev[]; . as $e | ($root.hooks[$e]? == null
      or (($root.hooks[$e] | type) == "array" and all($root.hooks[$e][]; type == "object"))))' "$SETTINGS" >/dev/null 2>&1 \
  || die "$SETTINGS has a malformed \"hooks\" value; fix it first"

# Remove only the hooks this script installed. A hook group is dropped only when
# removing ours left it empty, and an event list or "hooks" only when that
# emptied it too.
STRIP='
  def ours: (.command // "") | type == "string" and endswith($tag);
  def strip($e):
    if (.hooks[$e]? | type) == "array" then
      (.hooks[$e] | length) as $before
      | .hooks[$e] |= [ .[]
          | if (.hooks | type) == "array" and any(.hooks[]; ours)
            then (.hooks |= map(select(ours | not))) | select((.hooks | length) > 0)
            else . end ]
      | if $before > 0 and .hooks[$e] == [] then del(.hooks[$e]) else . end
    else . end;
  (.hooks == {}) as $was_empty
  | reduce $ev[] as $e (.; strip($e))
  | if .hooks == {} and ($was_empty | not) then del(.hooks) else . end'

BACKUP="$SETTINGS.bak.$(date +%Y%m%d%H%M%S).$$"
cp "$SETTINGS" "$BACKUP"
TMP="$(mktemp "${TMPDIR:-/tmp}/ntfy-done-hook.XXXXXX")"
FAKE_TRANSCRIPT=""
trap 'rm -f "$TMP" ${FAKE_TRANSCRIPT:+"$FAKE_TRANSCRIPT"}' EXIT

# Overwrite in place (not mv) so a symlinked settings.json stays a symlink and
# the file keeps its permissions.
commit() { cat "$TMP" > "$SETTINGS"; }

if [ "$MODE" = "uninstall" ]; then
  jq --arg tag "$TAG" --argjson ev "$EVENTS" "$STRIP" "$SETTINGS" > "$TMP"
  commit
  echo "removed the ntfy hooks from $SETTINGS (backup: $BACKUP)"
  # Remove the copied script unless a sibling settings file still uses it.
  if [ -f "$HOOK_PATH" ]; then
    DIR="$(dirname "$SETTINGS")"
    if grep -lF "$HOOK_PATH" "$DIR/settings.json" "$DIR/settings.local.json" 2>/dev/null | grep -q .; then
      echo "kept $HOOK_PATH (another settings file in $DIR still uses it)"
    else
      rm -f "$HOOK_PATH" && echo "removed $HOOK_PATH"
    fi
  fi
  exit 0
fi

# Copy the hook script to a fixed place, so the hook keeps working if this
# skill folder is moved, updated, or deleted.
mkdir -p "$(dirname "$HOOK_PATH")"
cp "$SCRIPT_DIR/notify.sh" "$HOOK_PATH"
chmod 755 "$HOOK_PATH"

CMD="bash '$HOOK_PATH' --topic '$TOPIC' --server '$SERVER' --title '$TITLE'$FLAGS$TAG"

jq --arg tag "$TAG" --argjson ev "$EVENTS" --arg cmd "$CMD" --arg nm "$NOTIFY_MATCHER" "$STRIP"'
  | {type: "command", command: $cmd, timeout: 10, async: true} as $h
  | .hooks.Stop = ((.hooks.Stop // []) + [{hooks: [$h]}])
  | .hooks.Notification = ((.hooks.Notification // []) + [{matcher: $nm, hooks: [$h]}])
' "$SETTINGS" > "$TMP"

# Confirm exactly one hook per event landed where Claude Code reads it before
# writing the file.
jq -e --arg tag "$TAG" '
  def n($e): [.hooks[$e][]?.hooks[]? | select(.type == "command" and ((.command // "") | type == "string" and endswith($tag)))] | length;
  n("Stop") == 1 and n("Notification") == 1' "$TMP" >/dev/null \
  || die "hooks did not validate; $SETTINGS left unchanged"
commit
echo "installed ntfy hooks (Stop, Notification) -> $SERVER/$TOPIC in $SETTINGS (backup: $BACKUP)"
echo "hook script: $HOOK_PATH"

if [ "$TEST" = 1 ]; then
  # Run the stored Stop command itself with a fake payload: a unique folder name
  # and a small transcript whose turn ends with a recap. Then look for exactly
  # that message on the topic. The hook hides errors by design, so this is the
  # only way to see a failure.
  STORED="$(jq -r --arg tag "$TAG" '.hooks.Stop[].hooks[]? | select((.command // "") | type == "string" and endswith($tag)) | .command' "$SETTINGS")"
  PROBE="$(printf 'ntfy-done-hook-test-%04x%04x' "$RANDOM" "$RANDOM")"
  FAKE_TRANSCRIPT="$(mktemp "${TMPDIR:-/tmp}/ntfy-done-hook-transcript.XXXXXX")"
  printf '%s\n' \
    '{"type":"custom-title","customTitle":"설치 테스트"}' \
    '{"type":"user","message":{"role":"user","content":"알림 훅 설치해줘"}}' \
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__ccd_turn__wrap_up","input":{"recap":"ntfy 알림 훅을 설치했어요. 이 알림이 보이면 제대로 동작하는 거예요."}}]}}' \
    > "$FAKE_TRANSCRIPT"
  jq -nc --arg cwd "/tmp/$PROBE" --arg tp "$FAKE_TRANSCRIPT" \
    '{hook_event_name:"Stop", session_id:"test0000", cwd:$cwd, transcript_path:$tp}' | bash -c "$STORED"
  sleep 1
  if ! POLLED="$(curl -sS -f -m 8 "$SERVER/$TOPIC/json?poll=1&since=1m" 2>&1)"; then
    echo "installed, but could not read $SERVER/$TOPIC back to confirm (the server may require auth): check your ntfy app for \"$PROBE\"" >&2
    exit 0
  fi
  if [[ "$POLLED" == *"$PROBE"* ]]; then
    echo "test notification sent (\"$PROBE\") - check your ntfy app"
  else
    echo "warning: the test message did not reach $SERVER/$TOPIC; check the topic and network" >&2
    exit 1
  fi
fi
