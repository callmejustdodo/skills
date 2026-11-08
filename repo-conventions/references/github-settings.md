# GitHub repository settings

These change the repository on GitHub for everyone, so they are never part of writing the files. Read the current state, show the user the exact change, and apply it only after a clear yes. Changing them needs admin permission (`viewerPermission` is `ADMIN`).

## Read the current state

```bash
gh repo view --json nameWithOwner,visibility,defaultBranchRef,viewerPermission,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge
gh api "repos/<owner>/<repo>/branches/<default-branch>/protection"
```

The protection call answers 404 `Branch not protected` when there is none, and 403 when the plan does not offer protection for this repository (private repositories on GitHub Free). Write what you read into the `{{PROTECTION}}` bullet of AGENTS.md, or delete that line when nothing is configured. Never describe protection that is not there.

## Merge methods

Squash by default, rebase allowed, no merge commits, and delete the head branch after a merge:

```bash
gh repo edit <owner>/<repo> --enable-squash-merge --enable-rebase-merge --enable-merge-commit=false --delete-branch-on-merge
```

## Branch protection (team)

The approvals the user chose (one or two), a new push dismisses earlier approvals, review conversations must be resolved, and the required checks must pass on a branch that is up to date with the default branch. Administrators can still bypass it (`enforce_admins: false`).

Write the payload to a file in your scratch directory. Set `required_approving_review_count` to the number of approvals in `{{APPROVALS}}` (the example shows 1). List in `contexts` only checks that run on every pull request: a required check that never reports (for example a workflow with a `paths` filter) blocks every merge. The context name is the job's `name`, or its key when it has no `name`, such as `documentation`.

```json
{
  "required_status_checks": { "strict": true, "contexts": ["documentation"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "dismiss_stale_reviews": true },
  "required_conversation_resolution": true,
  "restrictions": null
}
```

```bash
gh api -X PUT "repos/<owner>/<repo>/branches/<default-branch>/protection" --input <payload-file>
```

Read the protection back afterwards and write the protection bullet in AGENTS.md to match it. If step 3 deleted the `{{PROTECTION}}` line because nothing was configured then, insert the bullet where that line was: right after the "Merge only with approval" bullet in the team workflow, or after the first bullet in the solo workflow. For example: "Branch protection on `main` requires one approval (a new push dismisses earlier approvals), resolved review conversations, and the `documentation` check on a branch that is up to date with `main`. Administrators can bypass it."

## Branch protection (solo)

Required reviews would block a single maintainer, who cannot approve their own pull request. If the user wants protection at all, require only the checks: use the payload above with `"required_pull_request_reviews": null`. Direct pushes still work for administrators because `enforce_admins` is false.
