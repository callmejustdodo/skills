---
name: repo-conventions
description: "Set up a repository's working rules for coding agents and teammates: an AGENTS.md (with a CLAUDE.md link) holding working agreements, documentation ownership, branch naming, GitHub Flow and pull request rules, and Conventional Commit + Lore trailer messages; a pull request template; GitHub issue forms (bug, idea, task, document mismatch); and a zero-dependency Markdown link checker with a CI job. Reads the repository first, asks only what it cannot see, merges into existing files instead of overwriting them, and changes GitHub settings (merge methods, branch protection) only on a clear yes. Use when the user says 레포 규칙 세팅해줘, AGENTS.md 만들어줘, 에이전트 규칙 정리, PR 템플릿 추가, 이슈 템플릿 만들어줘, 브랜치/커밋 규칙 정해줘, 문서 링크 검사 CI, 'set up repo conventions', 'add an AGENTS.md', or 'add PR and issue templates'."
metadata:
  version: 1.0.0
---

# Repo Conventions

Gives a repository the rules a team and its coding agents work by, so every agent session (Claude Code, Codex, Cursor) starts from the same agreements instead of re-deriving them. The rules come from a four-person team repository where they ran for a whole project; project-specific parts were removed.

| File in the target repository | Template | Written when |
|---|---|---|
| `AGENTS.md` | `templates/AGENTS.md` | Always (merged into an existing one) |
| `CLAUDE.md` | symlink to `AGENTS.md` | No `CLAUDE.md` exists yet |
| `.github/pull_request_template.md` | `templates/pull_request_template.md` | Always, unless one exists |
| `.github/ISSUE_TEMPLATE/bug.yml`, `idea.yml`, `task.yml`, `config.yml` | `templates/ISSUE_TEMPLATE/` | Always; each only if missing |
| `.github/ISSUE_TEMPLATE/mismatch.yml` | `templates/ISSUE_TEMPLATE/mismatch.yml` | The repository has a set of documents (`docs/`, `documentations/`, specifications) |
| `scripts/check-documentation.mjs` | `scripts/check-documentation.mjs` | Always |
| `documentation` CI job | `templates/workflows/documentation.yml` | Always; added to an existing workflow only when that workflow runs on every pull request |
| Optional AGENTS.md sections | [references/optional-sections.md](references/optional-sections.md) | The user picks them |

`<skill_dir>` below is the directory this SKILL.md was loaded from; if that path is a symlink, follow it. Resolve it once and write the literal path into later commands.

## Ground rules

- **Never invent facts.** The project summary, product surfaces, audiences, environments and reference repositories come from the repository or from the user. When neither says, delete the field or line instead of guessing.
- **Never overwrite.** Existing rules, templates and files stay. Add what is missing; when an existing rule conflicts with a template rule, keep the existing one and list the conflict in the report for the user to decide.
- **Ask one thing at a time**, and only what the repository does not show.
- **Commits, pushes, pull requests and GitHub settings need a clear yes.** Writing files in the working tree does not.
- Write AGENTS.md and the templates in English, the language agents and mixed teams read most reliably, unless the user asks for another. Talk to the user in their language.

## 1. Read the repository

Work in the repository the user names, or the current one. Run from its root:

```bash
git status --short --branch
git remote get-url origin
git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null
gh repo view --json nameWithOwner,description,visibility,defaultBranchRef,viewerPermission 2>/dev/null
git log --oneline -20
git branch -r | head -30
git shortlog -sn --all --no-merges | head -10
ls -la; ls -la .github .github/ISSUE_TEMPLATE .github/workflows 2>/dev/null
```

Then read what applies: `README.md`, existing `AGENTS.md` and `CLAUDE.md` (note whether `CLAUDE.md` is a symlink), any pull request template (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/`, `docs/`, root), existing issue forms, every workflow in `.github/workflows/` (which commands run on pull requests, whether actions are pinned to SHAs or tags, the Node.js version), and the manifest with its scripts (`package.json` and its lockfile, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`). Note documentation directories and signs of the optional sections: an `openspec/` directory or another spec tool, a translation mirror such as `ko/`, and documents that name reference repositories.

Tell the user in two or three lines what exists and what this will add.

## 2. Ask what the repository does not show

Use AskUserQuestion, one question per call. Where it is not available (Codex, for example), ask the same question in chat with numbered options and wait for the answer.

1. **Workflow** (always). Recommend from the contributor count:
   - `Team, 1 approval` — issue → branch → pull request → one teammate's approval → squash merge.
   - `Team, 2 approvals` — the same with two approvals.
   - `Solo` — one maintainer; small changes may go straight to the default branch.
2. **Optional sections** (multiSelect, with a `None` option): Reference repositories, Review-translation mirror, Spec-driven changes. Mark the ones the repository already shows signs of. Skip the question when the repository shows none of them and the user has said nothing about them.
3. **Facts still missing**, one at a time: a one-sentence project summary when there is no README or description, and the facts each chosen optional section lists in [references/optional-sections.md](references/optional-sections.md).

## 3. Fill the templates and write the files

Copy each template from `<skill_dir>/templates/` and replace every placeholder:

| Placeholder | Value |
|---|---|
| `{{PROJECT_SUMMARY}}` | One or two sentences from the README or repository description: what this repository is. |
| `{{LAYOUT}}` | One bullet per top-level directory whose purpose you could confirm by reading it: `` - `dir/`: purpose. `` Delete the section for a repository with only a few files. |
| `{{CHECKS}}` | The install command and the checks CI runs, in a `sh` code block with a short comment per line, introduced by one sentence. Take them from the workflows first, then the manifest scripts. Include the documentation check. Without CI or scripts, say that the documentation check is the only one so far. |
| `{{DOCS_CHECK}}` | `npm run check:docs` (or the `pnpm`/`yarn`/`bun` form matching the lockfile) after adding that script to `package.json`; `node scripts/check-documentation.mjs` without a `package.json`. |
| `{{DEFAULT_BRANCH}}` | From `gh repo view` or `origin/HEAD`. |
| `{{APPROVALS}}` | `at least one teammate` or `at least two teammates`. |
| `{{PROTECTION}}` | In the chosen workflow block: one bullet describing the branch protection actually configured, read as in [references/github-settings.md](references/github-settings.md#read-the-current-state). Delete the line when there is none or it cannot be read. |
| `{{CHECK_COMMAND}}` | The main check command, for example `npm test`, or `{{DOCS_CHECK}}`'s value. |
| `{{PROJECT_NAME}}` | The product or repository name. |
| `{{OWNER_REPO}}` | `nameWithOwner` from `gh repo view`. Without a GitHub remote, delete `contact_links` from `config.yml`. |
| `{{SURFACE}}`, `{{ENVIRONMENT}}`, `{{AUDIENCE}}` | Follow the `# FILL:` comment above each field in the issue forms, replace the placeholder with one option per line, and delete the comment. Delete the whole field when the repository does not say. |

**Variants.** `AGENTS.md` and the pull request template contain `<!-- variant: team -->` and `<!-- variant: solo -->` blocks. Keep the content of the chosen workflow's blocks, delete the other blocks, and delete every marker line.

**Merging into what exists:**

- **`AGENTS.md` exists:** keep all of it. Add only the sections and rules it lacks, where they fit, without rewording existing text or repeating a rule it already states in other words.
- **`CLAUDE.md`:** when absent, run `ln -s AGENTS.md CLAUDE.md` (Claude Code reads `CLAUDE.md`; Codex and most other agents read `AGENTS.md`). When the team works on Windows, where Git may check symlinks out as plain files, write a `CLAUDE.md` containing the single line `@AGENTS.md` instead. When `CLAUDE.md` is a regular file that does not mention `AGENTS.md`, leave it and offer to add `@AGENTS.md` as its first line; list rules that now appear in both files.
- **Pull request template exists:** leave it; list the template sections it lacks and ask whether to add them. Point the two AGENTS.md links to `.github/pull_request_template.md` at the existing template's real path (for example `.github/PULL_REQUEST_TEMPLATE.md`), with the exact case.
- **Issue forms:** add only missing forms. Leave an existing `config.yml`. If it allows blank issues (`blank_issues_enabled: true`, or no setting), drop "blank issues are disabled" from AGENTS.md and tell the user.
- **Link checker:** copy `<skill_dir>/scripts/check-documentation.mjs` to `scripts/check-documentation.mjs`. If a file with that name exists, compare and ask before replacing it.
- **`package.json`:** add `"check:docs": "node scripts/check-documentation.mjs"` to `scripts` unless a `check:docs` exists.
- **CI:** add the `documentation` job from the template to an existing workflow only when that workflow runs on every pull request: a `pull_request` trigger with no `paths`, `paths-ignore` or `branches` filter, and no `defaults.run.working-directory`. Otherwise create `.github/workflows/documentation.yml`, so documentation-only pull requests still run it. Match the repository's pinning style (SHA or tag) and Node.js version (from `.nvmrc`, `engines` or other workflows; else the template's). The checker needs Node.js 18 or later and no packages.

Apply the chosen optional sections from [references/optional-sections.md](references/optional-sections.md).

## 4. Verify

Run from the target repository's root, listing in place of `<written files>` and `<written yaml>` the exact files this skill created or edited (workflows may end in `.yaml`):

```bash
grep -nE '\{\{[A-Z_]+\}\}|<!-- /?variant|# FILL' <written files>
<the {{DOCS_CHECK}} command, with any --exclude it was given>
ruby -ryaml -e 'ARGV.each { |f| YAML.load_file(f) }' <written yaml> \
  || python3 -c 'import sys, yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]' <written yaml>
```

- The `grep` prints nothing. (It matches only this skill's placeholders, not `${{ }}` expressions in workflows.)
- The link checker passes. Fix broken links in files you wrote. When it reports broken links in files you did not write, do not fix them silently: list them and ask whether to fix them in this change, because the new `documentation` check fails until they are fixed.
- The YAML parses. If neither Ruby nor PyYAML is available, say that the YAML was not validated.
- Read the finished `AGENTS.md` once from top to bottom for contradictions, such as a solo rule next to "do not commit directly", or a check named in `## Checks` that CI does not run.

## 5. Commit and open a pull request (on yes)

Show the list of written files, then ask whether to commit. The conventions just written apply to this commit too:

- **Team:** never commit on the default branch. Create `docs/agent-conventions` (or the user's name for it) from the current state with `git switch -c`, stage only the files this skill wrote, and commit:

  ```text
  docs(repo): add agent conventions and GitHub templates

  <one or two sentences on why the repository needs them>

  Tested: <checker output, YAML validation>
  Not-tested: issue forms and the pull request template take effect only on the default branch
  ```

- **Solo:** ask whether to commit straight to the default branch or use the branch above.

Push and open a pull request only on a further yes. Fill in each section of the new pull request template yourself, since `gh pr create --body` does not.

## 6. GitHub settings (optional, on yes)

Offer once to align the repository settings with the rules: squash and rebase merges only, head branches deleted after merge, and branch protection for the team workflow. Follow [references/github-settings.md](references/github-settings.md): read the current state, show the exact change, apply it only after a clear yes, read it back, and write the matching protection bullet into AGENTS.md (the reference says where it goes when step 3 deleted the line).

## 7. Report

In the user's language, briefly:

- Files written, marking which were new and which were merged.
- Conflicts kept for the user to decide, and rules now duplicated between `CLAUDE.md` and `AGENTS.md`.
- Check results: the checker's output line and whether the YAML was validated.
- What was not done: nothing committed or pushed, GitHub settings unchanged, issue forms not visible until they reach the default branch, as applies.
