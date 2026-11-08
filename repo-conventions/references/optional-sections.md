# Optional sections

Add one of these only when the user picks it. Each comes with the facts you must get from the user or the repository first; never fill them with guesses.

## Reference repositories

For a team that agrees to copy the structure of named reference implementations.

**Facts needed:** the reference repositories (owner/name or URL) and, for each, what to follow it for. Ask the user; do not pick repositories yourself. If the repository already lists them in a document, link to that document instead of copying the list.

Add to `## Working agreements` in AGENTS.md:

```markdown
- Lean on the reference repositories. Before designing or implementing a module, read how the [reference repositories](#reference-repositories) structure, style and test the same thing, and follow their architecture and design wherever our own contracts do not say otherwise. Name the repository and revision you followed in the pull request.
```

Then add a section after `## Working agreements`, one bullet per repository:

```markdown
## Reference repositories

- [`<owner>/<name>`](https://github.com/<owner>/<name>): <what to follow it for>.
```

Add to `.github/pull_request_template.md`, before `## Before requesting review`:

```markdown
## Reference repositories followed

<!-- Repository and revision followed for the module, as AGENTS.md asks, or "Not applicable". -->
```

## Review-translation mirror

For a repository whose authoritative documents are in one language, with a mirror in another language for reviewers (for example English sources with a `ko/` mirror).

**Facts needed:** the mirror directory (for example `ko/`), the mirror language, and the source language. Ask the user.

Add a section to AGENTS.md:

```markdown
## <Language> translations

`<dir>/` mirrors the <source language> documents as review translations; the <source language> documents are authoritative. Do not read, search or quote `<dir>/` unless the user asks for a translation or names a file there. The root `.ignore` hides `<dir>/` from ripgrep-based search, and the project settings ask before a file under `<dir>/` is read. When a source document changes, regenerate its mirror from the source instead of editing the translation by hand, keep the first-line banner that names the source, and keep headings, tables, links and Mermaid blocks structurally identical.
```

Create or extend the root `.ignore`:

```text
# Review translations; search tools skip them unless asked. Git is unaffected.
<dir>/
```

Create or merge `.claude/settings.json` (keep any existing keys):

```json
{
  "permissions": {
    "ask": ["Read(<dir>/**)"]
  }
}
```

Each mirrored file starts with a one-line banner naming its source, for example `> Translation of [README.md](../README.md). The English document is authoritative.`

Translated headings get different anchors, so links in the mirror that point at mirrored headings break by design. Leave the mirror out of the link check: add `--exclude <dir>` to the checker command in `package.json`, in `## Checks`, and in the `documentation` CI job (`node scripts/check-documentation.mjs --exclude <dir>`). Links from source documents into the mirror are still checked.

## Spec-driven changes

For a repository that specifies substantial behavior changes before implementing them (for example with OpenSpec), so each change has proposal, requirements and tasks files.

**Facts needed:** the tool and its version (for OpenSpec, `openspec --version`), where current specifications live and where proposed changes live (for OpenSpec, `openspec/specs/` and `openspec/changes/`), and where product documents live. Read these from the repository; ask only what it does not show.

Replace the first paragraph of `## Documentation` in AGENTS.md with:

```markdown
Keep the documents complementary rather than duplicating the same requirements:

- `<product docs dir>/` owns product purpose, audience, release scope, research and explanations. Product documents describe intent and link to capability specifications for detailed behavior.
- `<specs dir>/<capability>/spec.md` owns the current agreed behavioral contract for that capability, including requirements and observable scenarios. Keep it aligned with completed, verified changes.
- `<changes dir>/<change-name>/` owns proposed deltas, their rationale, technical decisions when needed, and implementation tasks. Pending requirements stay there until the change is completed and archived into the main specifications.

Use spec-driven changes for substantial feature or behavior changes. Routine documentation edits, maintenance and small fixes that keep existing behavior do not need a proposal. Start with a bounded change, review its requirements, implement and test it, then archive it to update the main specifications. Do not promote unresolved decisions or draft requirements into settled specifications.

Give each change one tracking issue and link them both ways: the issue names the change, and the proposal names the issue number. Do not open an issue per task item; split off a sub-issue only when part of the change goes to another person or pull request. Pull requests that implement part of a change refer to the issue with `Part of #N`, and the pull request that archives the change closes it with `Closes #N`. Before archiving, update the deltas with what implementation changed. An archived change is a record: change the behavior later with a new change, not by editing the archive.

If product documents and specifications disagree, resolve the discrepancy explicitly before implementing the affected behavior. Specification validation checks structure and consistency; it does not prove the implementation works, so run the relevant tests too.
```

Add the validation command (for OpenSpec, `openspec validate --all --strict`) to `## Checks`, and as a step of the `documentation` CI job. That job installs nothing, so run the tool there at the pinned version without installing it first, for example `npx --yes @fission-ai/openspec@<version> validate --all --strict`, or add the repository's install step before it when the tool is a dev dependency.

Add to the markdown intro of `.github/ISSUE_TEMPLATE/task.yml`:

```text
For a spec-driven change, name the change in Source, put this issue's number in the change's proposal, and keep the requirements in the change.
```

Add to the markdown intro of `.github/ISSUE_TEMPLATE/idea.yml`:

```text
When a substantial behavior change is decided, its requirements move to a spec-driven change. Link the change here and keep the requirements there, not in both places.
```
