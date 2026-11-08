---
name: ntfy-done-hook
description: "Set up Claude Code hooks that push a phone/desktop notification through ntfy (ntfy.sh or a self-hosted server) when Claude finishes a turn, and flag it when Claude is waiting on the user's answer or a permission prompt. Each notification carries a one-line summary of the last work, the project folder, the session name, and the device and environment (Desktop app, CLI, SSH). Installs into settings.json with a re-runnable script that preserves existing settings and hooks, validates the result, and sends a real test notification. Also changes the topic or options, or removes the hooks. Use when the user says 작업 끝나면 알림 보내줘, ntfy로 알림, 완료 알림 훅, 폰으로 알림 받고 싶어, 답변 필요하면 알려줘, 'notify me when Claude is done', 'ntfy hook', 'push notification when the task finishes', or gives an ntfy.sh/<topic> URL."
metadata:
  version: 2.0.0
  openclaw:
    category: "productivity"
---

# ntfy Done Hook

Sends a push notification through [ntfy](https://ntfy.sh) when Claude Code finishes a
turn or needs the user, so the user can walk away from long tasks. These are hooks in
`settings.json`. The harness runs them, not the model, so they fire even when nobody
remembers to send them.

## What arrives

| When | Title (ntfy priority) | First line |
|---|---|---|
| Turn ended | `Claude Code 작업 완료` (default) | `📝 <summary of the last work>` |
| Turn ended with a question for the user | `Claude Code 답변 필요` (high) | `❓ <the question>`, then `📝 <summary>` |
| Permission prompt or MCP input request mid-turn | `Claude Code 확인 필요` (high) | `🔐 <Claude Code's message>` |

Every message ends with `📁 <project folder> · 💬 <session name>` and
`🖥️ <computer name> · <Desktop 앱 | CLI | VS Code | SDK | 클라우드> (SSH)`, for example:

> **Claude Code 답변 필요**
> ❓ 테스트도 돌려볼까요?
> 📝 로그인 리다이렉트 버그를 고쳤어요.
> 📁 webapp · 💬 Fix login redirect bug
> 🖥️ Dodo mini · Desktop 앱 (SSH)

Where each piece comes from (`scripts/notify.sh`):

- **Summary and question.** The script reads the transcript (`transcript_path` in the
  hook input) and looks only at the last turn, meaning entries after the turn's
  opening prompt. A question from an earlier turn never resurfaces.
  - In the Desktop app each turn ends with a `wrap_up` call. Its `recap` is the
    summary, and its `ask` is the open question.
  - Without `wrap_up` (CLI), the first line of the last reply is the summary, and a
    last line ending in `?` is the question.
  - Markdown is stripped and long text is cut with `…`.
- **Session name.** This is the latest `custom-title` entry in the transcript: the
  title the app shows, which `/rename` also sets. A session without one shows
  `세션 <first 8 chars of the session id>`.
- **Device and environment.** The device is `scutil --get ComputerName` (otherwise
  `hostname -s`). The environment comes from `CLAUDE_CODE_ENTRYPOINT`,
  `CLAUDE_CODE_REMOTE` and `SSH_CONNECTION`.

## Inputs

| Input | Default | Notes |
|---|---|---|
| Topic | — (required) | From the user's words (`ntfy.sh/<topic>` → `<topic>`), or `$NTFY_TOPIC`. Ask if neither is given. |
| Server | `https://ntfy.sh` | A self-hosted server URL, if the user names one. |
| Title | `Claude Code 작업 완료` | Title of the "done" notification. No single quotes. |
| `--no-summary` | summary on | Leaves out the summary and question text. The 답변 필요 title still shows. |
| `--no-session` | session on | Leaves out the session name. |
| `--no-device` | device on | Leaves out the device/environment line. |
| Settings file | `~/.claude/settings.json` | User scope: fires in every project. Use `<project>/.claude/settings.local.json` only if the user wants one project only. |

**Topics on ntfy.sh are public.** Anyone who knows or guesses the topic name can read
it and post to it.

- **Content exposure.** Summaries, questions and session names are taken from the
  conversation, so they put real work content on that topic. Say so once when
  installing.
- **Guessable topics.** If the topic is short or guessable (a name, a word, a device
  name), recommend a longer random one, e.g. `claude-$(openssl rand -hex 4)`. For
  sensitive work, also offer `--no-summary` / `--no-session`.
- **Don't block.** Don't refuse or stall on this: the user may already be subscribed
  to that topic.
- **Nothing else.** Nothing beyond the fields above is ever sent.

## Install

```bash
SKILL_DIR="$(cd -P ~/.claude/skills/ntfy-done-hook && pwd)"
bash "$SKILL_DIR/scripts/install.sh" <topic>
# options: --server URL  --title TEXT  --no-summary  --no-session  --no-device  --settings PATH  --no-test
```

What the script does:

1. **Checks before touching anything.** It validates every argument, and refuses a
   settings file that isn't valid JSON or whose `hooks` has the wrong shape. A broken
   `settings.json` silently disables every setting in it, so fix that first.
2. **Backs up** the settings file with a timestamp, next to it.
3. **Copies the hook script.** `notify.sh` goes into a `hooks/` folder next to the
   settings file: `~/.claude/hooks/ntfy-done-hook.sh` for user settings, or
   `<project>/.claude/hooks/` for a project's. The hooks keep working if this skill
   folder is moved, updated or deleted.
4. **Replaces its own hooks.** It removes any hooks it installed before: commands
   ending with `# ntfy-done-hook`, including the one-line hook from version 1. Then it
   adds one `Stop` hook and one `Notification` hook (matcher
   `permission_prompt|elicitation_dialog`). Other hooks and settings stay as they are,
   so re-running it changes options without duplicating.
5. **Validates, then writes.** It re-checks with `jq` that each hook is where Claude
   Code reads it, and only then writes the file. The write is in place, so a symlinked
   `settings.json` (dotfiles) stays a symlink and keeps its permissions.
6. **Sends a real test.** It runs the stored `Stop` command with a fake payload: a
   folder named `ntfy-done-hook-test-<random>` and a small fake transcript. Then it
   polls the topic for that exact message.
   - If the server can't be read back (e.g. it needs auth), the script says so,
     still exits 0, and asks the user to check the app.
   - Exit 1 means the message didn't arrive, so check the topic and the network.

The hooks run `async` with a 10 s timeout, and `notify.sh` always exits 0. A network
outage or an odd transcript never slows down or breaks a session.

Requirements: `jq` and `curl` (both ship with macOS 15+).

## Change or remove

```bash
bash "$SKILL_DIR/scripts/install.sh" <new-topic> [options]   # replace
bash "$SKILL_DIR/scripts/install.sh" --uninstall              # remove (also deletes the copied script unless a sibling settings file still uses it)
```

Preview a message without sending it:

```bash
echo '{"hook_event_name":"Stop","cwd":"'"$PWD"'"}' | bash ~/.claude/hooks/ntfy-done-hook.sh --topic x --dry-run
```

## After installing, tell the user

- **Where to subscribe.** Name the topic to subscribe to in the ntfy app
  (iOS/Android/web), and the server if it isn't ntfy.sh. The test notification shows
  up there.
- **It fires a lot.** It fires at the end of **every turn**, in every session on the
  machine, including short answers. 답변 필요 and 확인 필요 come at high priority,
  so the user can let only those through in the app's settings.
- **New sessions.** Sessions pick it up automatically if `~/.claude/settings.json`
  already existed when they started. If a session doesn't notify, start a new one.
- **Permission prompts.** The `Notification` hook covers the CLI's own permission
  prompts. Apps that handle permissions themselves (such as the Desktop app) may not
  raise it. There, 답변 필요 from the end of the turn is the signal.
- **Where it lives.** The hooks are under `hooks.Stop` and `hooks.Notification` in the
  settings file, tagged `# ntfy-done-hook`. The user can edit or remove them there, or
  with `--uninstall`.

## Variations (only if asked)

- **Auth on a self-hosted server:** add `-H "Authorization: Bearer $NTFY_TOKEN"` to the
  `curl` line in `~/.claude/hooks/ntfy-done-hook.sh` and export `NTFY_TOKEN` in the
  environment Claude Code starts from. Never write the token into `settings.json`.
  Re-running `install.sh` overwrites the copied script, so re-apply the edit after
  updating.
