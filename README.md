# Dodo’s Skills

Reusable AI agent skills for Claude Code and other coding agents. Includes a meeting follow-up email drafter, a voice memo → Notion pipeline, a macOS performance doctor, a product planning interviewer, a Slack-approved card-news publisher for Instagram and Threads, a Korean e-tax-invoice issuer, and an ntfy push notification for when Claude Code finishes.

[![skills.sh](https://skills.sh/b/callmejustdodo/skills)](https://skills.sh/callmejustdodo/skills)

## Install

```bash
npx skills add callmejustdodo/skills
```

Or install a single skill:

```bash
npx skills add callmejustdodo/skills --skill followup-mail
npx skills add callmejustdodo/skills --skill voice-memo-2-meeting-note
npx skills add callmejustdodo/skills --skill mac-lag-doctor
npx skills add callmejustdodo/skills --skill product-planning
npx skills add callmejustdodo/skills --skill card-news-publish
npx skills add callmejustdodo/skills --skill korean-tax-invoice
npx skills add callmejustdodo/skills --skill ntfy-done-hook
```

## Skills

| Skill | What it does |
|-------|--------------|
| [`followup-mail`](./followup-mail) | Drafts a Korean meeting follow-up email and saves it as a Gmail draft (never sends). |
| [`voice-memo-2-meeting-note`](./voice-memo-2-meeting-note) | Transcribes audio (ElevenLabs Scribe v2), summarizes, and creates a Notion page. |
| [`mac-lag-doctor`](./mac-lag-doctor) | Diagnoses macOS lag with evidence — A/B-tests every suspect before blaming it. |
| [`product-planning`](./product-planning) | Interviews you, writes planning documents, gets mockup approval, and produces an AI implementation plan. |
| [`card-news-publish`](./card-news-publish) | Sends a Figma card-news deck to Slack for approval and publishes it as an Instagram + Threads carousel on [발행]. |
| [`korean-tax-invoice`](./korean-tax-invoice) | Issues Korean e-tax invoices (세금계산서) via Bolta, with guards against duplicate and wrong issuance. Vendored from [sdkfile/korean-tax-invoice](https://github.com/sdkfile/korean-tax-invoice). |
| [`ntfy-done-hook`](./ntfy-done-hook) | Pushes an [ntfy](https://ntfy.sh) notification to your phone when Claude Code finishes or needs your answer, with a summary of the last work, the session, and the device. |

## Prerequisites

| Dependency | Required by | Install |
|------------|-------------|---------|
| [`gws`](https://github.com/nicholasgasior/gws) | followup-mail | See gws docs |
| [`ntn`](https://ntn.dev) | voice-memo-2-meeting-note | `curl -fsSL https://ntn.dev \| bash` |
| `ELEVENLABS_API_KEY` | voice-memo-2-meeting-note | [elevenlabs.io](https://elevenlabs.io) |
| `ffprobe` | voice-memo-2-meeting-note | `brew install ffmpeg` |
| `python3` + `elevenlabs` SDK | voice-memo-2-meeting-note | `pip install elevenlabs` |
| [`uv`](https://docs.astral.sh/uv/) | card-news-publish | `brew install uv` |
| Slack app (Socket Mode), Meta Instagram/Threads tokens, Supabase project | card-news-publish | See [`card-news-publish/SKILL.md`](./card-news-publish/SKILL.md); keys go in `card-news-publish/.env` |
| Node.js 18+ + one-time build | korean-tax-invoice | `cd korean-tax-invoice && npm install && npm run build` |
| `BOLTA_API_KEY` | korean-tax-invoice | [Bolta](https://app.bolta.io) → 개발자센터 → API 키 (`test_` = virtual, `live_` = real); goes in `korean-tax-invoice/.env` or your shell |
| `jq`, `curl` + the [ntfy app](https://ntfy.sh) | ntfy-done-hook | Both CLIs ship with macOS 15+; subscribe to your topic in the app |

## Setup

1. **Clone and link:**

```bash
git clone https://github.com/callmejustdodo/skills.git
cd skills
./link.sh
```

2. **Configure `.env`:**

```bash
cp .env.example .env
$EDITOR .env
```

Fill in your personal values — Notion workspace/database IDs, email, etc. See `.env.example` for descriptions of each variable.

3. **Set API keys in your shell** (not in `.env`):

```bash
export ELEVENLABS_API_KEY=sk-...
```

4. **Authenticate external CLIs:**

```bash
ntn login        # Notion
gws auth login   # Google Workspace (Gmail)
```

## Usage

### followup-mail

Trigger by saying things like:
- "팔로업 메일 써줘"
- "미팅 후속 메일 초안"
- "follow-up draft"

The skill gathers meeting details, drafts a Korean business email, and saves it as a Gmail draft. It **never sends** — you review and send from Gmail.

### voice-memo-2-meeting-note

Trigger by saying things like:
- "최근 보이스메모 노션에 올려줘"
- "이 파일 전사해서 노션에 저장"
- "transcribe and save to Notion"

The skill:
1. Picks up audio from Apple Voice Memos or an explicit file path
2. Transcribes via ElevenLabs Scribe v2 (with speaker diarization for meetings)
3. Generates a structured summary (thematic Q&A for meetings, detailed write-up for lectures)
4. Creates a Notion page with the summary + a raw transcript sub-page

### mac-lag-doctor

Trigger by saying things like:
- "맥이 렉 걸려", "요즘 느려", "메모리 너무 많이 먹는 것 같아"
- "why is my mac slow", "what's eating my CPU"

No config, no API keys — everything it uses ships with macOS.

```bash
mac-lag-doctor/scripts/snapshot.sh          # baseline: CPU lane vs memory lane
mac-lag-doctor/scripts/ab-test.sh "Siri AI" # quit → measure → verdict → restore
```

The core discipline: **never blame a process you have not A/B-tested.** The snapshot
splits CPU-bound from memory-bound causes, flags stuck processes (high CPU for the
full uptime) and duplicated helpers/MCP servers, and reads Claude Code's daemon spare
state so claimed sessions aren't killed by mistake.

### product-planning

Trigger by saying things like:
- "제품 기획 도와줘", "PRD 써줘", "MVP 기획하자"
- "help me plan my product", "write a PRD"

Or invoke it directly from your product project: `/product-planning` in Claude Code, `$product-planning` in Codex. Add your idea, or ask it to resume existing documents.

The skill:
1. Interviews you in focused rounds about real usage, priorities, and reasons, and leaves product decisions to you unless you delegate them
2. Writes seven planning documents (one-pager → PRD → user stories → screens/flows → tech spec → frontend → backend) plus `implementation_plan.md` under `documentations/`, one at a time (or together, if you ask), and waits for your confirmation on each
3. After the screens/flows document, builds an HTML mockup at `documentations/mockups/index.html` and waits for separate approval before any technical design
4. Proposes a starting stack (Next.js + Supabase for web, Swift or React Native for apps) and records your choice or explicit delegation

Questions and replies follow your language. The documents are always written in English, quoting your own words with an English gloss; mockup UI copy uses your end users' language. It resumes from existing documents and re-reviews only what a changed decision affects. No external service or API key is required. Optional companion skills are listed in [skill-options.md](./product-planning/references/skill-options.md).

### card-news-publish

Trigger by saying things like:
- "카드뉴스 발행 컨펌 요청해줘", "슬랙으로 컨펌 받아줘"
- "인스타/스레드에 올려줘", "publish this carousel"

The skill:
1. Turns Figma slide exports into Instagram-ready JPEGs plus a one-image preview grid (`scripts/prepare_deck.py`)
2. Runs a rule-based Slack bot that posts a confirm request — preview, Figma link, captions, [발행]/[발행 취소] — when an allowed user posts the deck's trigger, or right away with `scripts/confirm.py`
3. On [발행] (after a confirm dialog), uploads the slides to a Supabase public bucket and publishes an Instagram and a Threads carousel, then updates the Slack message with links

Keys live in a gitignored `card-news-publish/.env` (template: `card-news-publish/.env.example`). Missing platform keys make [발행] skip that platform and say why.

### korean-tax-invoice

Trigger by saying things like:
- "고객사에 9월 이용료 50만원 세금계산서 발행해줘"
- "볼타로 세금계산서 발행하려는데 준비됐는지 봐줘"

Vendored from [sdkfile/korean-tax-invoice](https://github.com/sdkfile/korean-tax-invoice) (MIT, commit `74eaddf`), with one local change: the scripts load `korean-tax-invoice/.env` on their own. Build once after cloning — the scripts import `dist/`:

```bash
cd korean-tax-invoice && npm install && npm run build
cp .env.example .env    # then set BOLTA_API_KEY=test_...
```

The skill runs a preflight, validates the request, shows you exactly what will be issued, and only issues with `--confirm` after you say yes. The key lives in a gitignored `korean-tax-invoice/.env`; a `BOLTA_API_KEY` exported in your shell takes precedence over it.

### ntfy-done-hook

Trigger by saying things like:
- "작업 끝나면 ntfy.sh/my-topic으로 알림 보내줘", "폰으로 완료 알림 받고 싶어"
- "notify me when Claude is done"

Or run the installer yourself:

```bash
ntfy-done-hook/scripts/install.sh <topic>                 # install or change the topic
ntfy-done-hook/scripts/install.sh <topic> --server https://ntfy.example.com
ntfy-done-hook/scripts/install.sh <topic> --no-summary    # also: --no-session, --no-device
ntfy-done-hook/scripts/install.sh --uninstall
```

A finished turn arrives as **작업 완료** with a one-line summary of the work. A turn that ends with a question for you arrives as **답변 필요** (high priority), with the question. A permission prompt arrives as **확인 필요**. Each notification also shows the project, the session name, and the device and environment:

```
Claude Code 답변 필요
❓ 테스트도 돌려볼까요?
📝 로그인 리다이렉트 버그를 고쳤어요.
📁 webapp · 💬 Fix login redirect bug
🖥️ Dodo mini · Desktop 앱 (SSH)
```

The installer copies the hook script to `~/.claude/hooks/ntfy-done-hook.sh` and adds a `Stop` and a `Notification` hook to `~/.claude/settings.json`. It keeps every existing setting and hook, and backs up the settings file first. Re-running it replaces its own hooks instead of adding more. It finishes by sending a real test notification.

Topics on ntfy.sh are public, and summaries and session names come from your conversations. Choose a topic name that is hard to guess, or turn those parts off.

## Config (`.env`)

Personal values — emails, Notion workspace/database/data-source IDs — live in a
gitignored `.env` at the repo root, **not** in the SKILL.md files.

Key variables:

| Variable | Purpose |
|----------|---------|
| `FOLLOWUP_FROM_NAME` | Signature name for follow-up emails |
| `FOLLOWUP_TO` | Default recipient email |
| `FOLLOWUP_SUBJECT_TAG` | Subject prefix, e.g. `[MyCompany]` |
| `NOTION_WS_PRIMARY` | Primary Notion workspace UUID |
| `NOTION_WS_LEGACY` | Secondary/legacy workspace UUID |
| `NOTION_PRIMARY_MEETING_DB` | Meeting Notes database ID |
| `NOTION_PRIMARY_MEETING_DS` | Meeting Notes data_source ID |

See `.env.example` for the full list.

## Manual Linking

If you prefer not to use `npx skills add`, you can symlink directly:

```bash
./link.sh            # symlink all skills into ~/.claude/skills and ~/.agents/skills
./link.sh <name>     # link a single skill
```

## Adding a New Skill

1. Create `<skill-name>/SKILL.md` in this repo (add `references/`, `TEMPLATE.md`, etc. as needed).
2. Put any personal/secret values in `.env` (+ document them in `.env.example`) and reference them as `$VARS` in the skill.
3. Run `./link.sh <skill-name>`.
4. Commit.

## License

MIT

## Website

Browse the collection at [callmejustdodo.com/skills](https://callmejustdodo.com/skills). Changes to `README.md` or a root-level `<skill-name>/SKILL.md` on `main` trigger an automatic website deployment. A new skill does not need a README table entry to appear on the website; its frontmatter description is used when no table summary exists.
