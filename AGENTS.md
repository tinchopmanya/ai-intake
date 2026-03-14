# AGENTS.md

## Repository workflow rules

For any task that modifies files, follow this workflow exactly:

1. Before editing any file, create a new branch from the current `main` branch.
2. Branch naming convention:
   - `feat/<short-kebab-description>` for features
   - `fix/<short-kebab-description>` for bug fixes
   - `chore/<short-kebab-description>` for maintenance
3. Make all requested changes on that branch only.
4. Run the relevant validation commands after changes.
5. Stage all modified files with `git add`.
6. Create a commit with a clear conventional commit message.
7. Switch to `main`.
8. Pull the latest changes from `origin/main`.
9. Merge the working branch into `main`.
10. Push `main` to `origin`.
11. If any merge conflict appears, stop and explain the conflict instead of guessing.
12. Never force-push unless explicitly instructed.
13. If tests, lint, or build fail, stop before merging and report the failure clearly.
14. If the task does not require file changes, do not create a branch.
15. Always report:
   - the branch name
   - the files changed
   - the validation commands run
   - the commit message used
   - whether merge and push succeeded

## Engineering constraints

1. Prefer minimal, targeted changes over broad refactors.
2. Do not modify unrelated files.
3. Preserve backward compatibility unless explicitly asked to break it.
4. If a task touches auth, persistence, OCR, or release-critical flows, validate those paths explicitly.
5. Update docs when behavior, setup, or API contracts change.

## Validation policy

Use the smallest relevant validation set for the task, for example:
- backend: tests, import checks, or startup validation
- frontend: lint, build, or route-specific validation
- OCR: capability checks and one realistic sample flow
- auth: login, me, refresh, logout if affected

If a command cannot be run, say so explicitly.

## Safety for main branch

Merging to `main` is allowed only when:
- the requested changes are complete
- validations passed
- there are no unresolved conflicts

If any of those conditions fail, stop before merge and explain the blocker.
