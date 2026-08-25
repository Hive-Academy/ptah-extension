# Context — TASK_2026_240

## Origin

Split out of **TASK_2026_237** (its requirements §8 Finding 1, restated in the
batch breakdown's B7). That task repaired the _instance_; this one repairs the
_class_. Keeping them separate was deliberate — this touches CI and release
plumbing, not the Tribunal panel.

## The failure that motivated it

`content-manifest.json` had `generatedAt: 2026-08-09T17:41:18.306Z` and did not
list `ptah-core/skills/tribunal/references/crucible.md`, even though the file had
been committed days earlier. Three facts compound:

1. **`ContentDownloadService` downloads only what the manifest enumerates.** It
   fetches `content-manifest.json` from a URL hardcoded to the `main` branch
   (`libs/backend/platform-core/src/content-download.service.ts:79-80`), then
   pulls each listed file into `~/.ptah/plugins/`. A file absent from the
   manifest is a file no user ever receives.
2. **`pruneStaleFiles` deletes local files the manifest omits** (`:200-201`,
   `:265-275`). So a stale manifest is not merely a withheld update — a user who
   obtained the file by any other route has it **removed** on next activation.
   This is the part that makes the defect actively destructive rather than inert.
3. **Regeneration is manual and unenforced.** `scripts/generate-content-manifest.js`
   is correct — it walks `apps/ptah-extension-vscode/assets/plugins`, hashes, and
   writes the manifest (`:51-99`) — and its own header says "Run before each
   release". But it is referenced by **no npm script** in the root `package.json`
   and by **none of the 16 workflows** in `.github/workflows/`, including
   `publish-extension.yml`.

Fact 3 makes facts 1 and 2 inevitable, not unlucky. The stale manifest was the
predictable outcome, and it will recur on the next skill or template edit.

## What to build

The goal is that **a commit which changes plugin or template content and does not
regenerate the manifest cannot reach `main` silently.**

Two shapes worth weighing — decide, do not default:

- **A CI check that fails on drift.** Run the generator in a clean checkout and
  fail if the result differs from the committed `content-manifest.json`. Honest
  and hard to bypass; costs a red build that a contributor must fix by hand.
- **Regenerate-and-commit in the release workflow.** Removes the human step
  entirely; means a bot commit lands in release history, and drift on feature
  branches stays invisible until release.

A pre-commit or pre-push hook is a third option but weaker on its own — hooks are
skippable and this repo already runs a slow pre-commit chain.

Whichever is chosen, the check must compare the **`contentHash`**, not just
`generatedAt` — the generator bumps the timestamp on every run, so a timestamp
diff proves nothing about content. TASK_2026_237 confirmed a real change by
watching `sha256:45fc296e…` become `sha256:8bee40f9…`.

## Verification

- Delete an entry from `content-manifest.json`, push, and confirm CI fails.
- Add a file under `apps/ptah-extension-vscode/assets/plugins/` without
  regenerating, and confirm CI fails.
- Regenerate, and confirm CI passes.
- Confirm the check does **not** fire on a commit that touches no plugin or
  template content, or it becomes noise everyone learns to ignore.

## Scope note

The generator itself is not in question. It is correct and was used successfully
in TASK_2026_237. This task adds enforcement around it and changes no download,
plugin or skill behaviour.

## Suggested executor

`devops-engineer`.
