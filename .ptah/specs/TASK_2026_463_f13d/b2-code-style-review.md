# Code Style Review — `TASK_2026_463_f13d` Batch 2

## Summary

| Metric          | Value                                 |
| ---------------- | ------------------------------------ |
| Overall score   | 8/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                      |
| Serious issues  | 0                                      |
| Minor issues    | 2                                      |
| Files reviewed  | 5 (`ci.yml`, `electron-e2e.yml`, `vscode-e2e.yml`, `publish-cli.yml`, `publish-extension.yml`) + `publish-electron.yml` |

Note: `publish-electron.yml` (Task 2.2 / C3) is the single largest file in this batch and is
scored on its own in File-by-file, but folded into this one batch verdict per the review request.

## Five style questions

### 1. What breaks in six months?

A fourth bot-bump workflow added later (e.g. `publish-license-server.yml`) needs its own
`startsWith(github.head_ref, 'chore/bump-<x>-v')` term added to all three guarded jobs
(`ci.yml:48-51`, `electron-e2e.yml:44-47`, `vscode-e2e.yml:56-59`) by hand — there is no single
source of truth for "the list of bot prefixes" the way `GOVERNED_BACKGROUND_LANES` is for lanes in
Batch 1. The `BRANCH=` cross-reference comments (`publish-cli.yml:401`, `publish-extension.yml:226`,
`publish-electron.yml:698`) are the only tripwire, and they only fire if a human remembers to read
them before renaming a branch prefix.

### 2. What would a new team member misread?

The retry-step `if:` conditions in `publish-electron.yml` (`:539`, `:546`) still read
`steps.sign-check-1.outputs.complete != 'true'` — a negative test — even though the plan's own
rationale (`implementation-plan.md:126-129`) says a negative test "fails open" and is exactly the
bug being fixed elsewhere in the same file. A reader who only skims the retry conditions could
conclude the fix is inconsistent; only reading the full `&&` chain shows `release_mode == 'publish'`
is prepended as a fail-closed gate ahead of the pre-existing negative term, which is correct but
requires reading past the first ~60 characters of a long expression.

### 3. What does this cost to maintain?

Low. The three CI guard edits are a mechanical widen-to-three-terms change with no new
abstraction. The `publish-electron.yml` change adds one job output (`release_mode`) and repeats one
literal comparison (`needs.prepare.outputs.release_mode == 'publish'`) nine times (7 build steps +
`jobs.release.if` + the `Refuse unless publishing` step's env-based re-check). GitHub Actions
`if:` has no shared-constant mechanism, so this repetition is the idiomatic ceiling for the
platform, not a code smell — the pre-existing `publish-cli.yml:387` precedent repeats
`github.event.inputs.dry-run != 'true'` the same way.

### 4. Where is this inconsistent with the rest of the repository?

`publish-cli.yml`'s existing dry-run (`:49-53`, `:387`, `:394`) uses a *negative*, per-step
`github.event.inputs.dry-run != 'true'` test with no job output. `publish-electron.yml` uses a
*positive* job-output token (`release_mode`) plus a second runtime lock in the `release` job. This
is a real style divergence between two sibling publish workflows, but it is the one piece of this
batch backed by written architectural reasoning (`implementation-plan.md:120-137`, "Rejected
alternatives" for D3): the CLI workflow does not sign anything or spend money, so a fail-open
negative test costs nothing there; `publish-electron.yml` bills a paid signing service and ships a
public release, so the plan deliberately trades a few more characters per line for fail-closed
semantics. This is a justified inconsistency, not an overlooked one — it should be read as evidence
the pattern should also be back-ported to `publish-cli.yml`/`publish-extension.yml` in a later task,
not as a defect in this one.

### 5. What would you have done differently?

I would have hoisted the repeated `needs.prepare.outputs.release_mode == 'publish'` literal into
the job output's own name (e.g. exposing `release_mode` as `'publish'`/`'skip'` so every downstream
`if:` reads `== 'publish'` — which it already does) — that is what was done, so no change there.
The one thing I would add is a single-line comment beside `release_mode: ${{ steps.mode.outputs.release_mode }}`
(`publish-electron.yml:91`) stating the invariant "every paid or outward-facing step must gate on
this value, positively" — so the next engineer adding a build step has the rule at the point they'd
need it, rather than only in `implementation-plan.md`, which will not ship with the workflow file.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `.github/workflows/publish-electron.yml:91` — the new `release_mode` job output has no inline
  comment stating the "every paid/outward step must positively gate on this" invariant that
  `implementation-plan.md:126-129` documents. The header paragraph at `:15-18` states the user-facing
  behavior of dry-run but not this maintenance rule. Low cost today (verified by the structural
  assertion script), but the assertion script is not committed, so the invariant has no enforcement
  once this task's temp harness is deleted.
- `.github/workflows/ci.yml:41-46` vs `.github/workflows/electron-e2e.yml:40-45` /
  `.github/workflows/vscode-e2e.yml:52-57` — the three rewritten guard comments carry the same
  content but are not verbatim identical (ci.yml: "Skip closed/merged PRs and bot bumps from..."
  vs. the e2e files: "Bot bumps from... use..."; ci.yml ends on "its check remains for push/non-PR
  events" while the e2e files end on "workflow_dispatch head_ref is empty and runs" — correctly
  omitted from ci.yml, which has no `workflow_dispatch` trigger, ref `ci.yml:3-13`). The variation is
  justified by the trigger difference, not sloppiness, but the near-duplicate prose itself (three
  copies of "the three bot prefixes and their source workflows") is a candidate for a single
  `.github/workflows/README` note the guard comments could point to, since GitHub Actions `if:`
  gives no way to `include` a shared comment block.

## File-by-file

### `.github/workflows/ci.yml`

Score 9/10 — 0 blocking, 0 serious, 0 minor beyond the shared item above. The three-term guard
(`:49-51`) is an exact, minimal widening of the prior single `startsWith`; the comment names the
prefixes, PR #512, and the accepted residual as the plan required (`implementation-plan.md:167-170`).

### `.github/workflows/electron-e2e.yml`

Score 9/10 — matches `ci.yml`'s shape; correctly adds the `workflow_dispatch` empty-`head_ref`
note that `ci.yml` cannot carry (no such trigger). No issues.

### `.github/workflows/vscode-e2e.yml`

Score 9/10 — identical shape to `electron-e2e.yml`. No issues.

### `.github/workflows/publish-cli.yml`

Score 9/10 — single comment-only line above `BRANCH=` (`:401`) exactly as scoped
(`implementation-plan.md:171-174`). No other line touched.

### `.github/workflows/publish-extension.yml`

Score 9/10 — same shape as `publish-cli.yml`, above `BRANCH=` at `:226`. No other line touched.

### `.github/workflows/publish-electron.yml`

Score 8/10 — 0 blocking, 0 serious, 2 minor (the missing invariant comment above, and the
negative-then-positive retry condition ordering that costs a reader an extra read-through, see
Q2). The mode-resolution step (`:93-116`) correctly uses `env:` rather than interpolating
`${{ }}` into `run:`, matching the plan's stated rationale
(`implementation-plan.md:330-335`) and the repository's own no-shell-interpolation-of-inputs rule
(`implementation-plan.md:523-526`). All 7 signing/check/retry/copy-back steps
(`:489,509,539,546,576,587,648`) carry the positive term; the allowlist assertion in the codex
report (`b2-codex-report.md:95`) confirms no 8th step was missed. The `release` job carries both
the job-level `if:` (`:673`) and step-level `Refuse unless publishing` re-check (`:678-686`) exactly
as the plan specifies as defense-in-depth (`implementation-plan.md:362-365`). Anchors
`&batch_sign_with`/`*batch_sign_with` are untouched by the diff and still resolve (confirmed by the
codex report's anchor-resolution assertions, `b2-codex-report.md:96-97`, and independently by
reading `:486-575` — the retry steps' `with: *batch_sign_with` lines are unmodified).

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `dry-run` input name matches `publish-cli.yml:49` precedent | PASS | `publish-electron.yml:62-66` |
| No `${{ }}` interpolation of untrusted input inside `run:` (shell-injection rule) | PASS | `publish-electron.yml:93-107` uses `env:` |
| `--publish never` / build-vs-release job separation preserved | PASS | `:310,342,590` unchanged (outside diff) |
| Positive fail-closed gating on a paid/outward step, matching the plan's stated rationale over the `publish-cli.yml` negative-test precedent | PASS (divergence is documented) | `implementation-plan.md:120-137`; `publish-electron.yml:489,509,539,546,576,587,648,673` |
| Guard comment names bot prefixes + source files + residual (per Task 2.1 AC2) | PASS | `ci.yml:41-46`, `electron-e2e.yml:40-45`, `vscode-e2e.yml:52-57` |
| Comment-only edit scope kept to a single line above `BRANCH=` in the two non-owning publish files | PASS | `publish-cli.yml:401`, `publish-extension.yml:226` — `git diff --stat` shows 1 line changed in each |
| Prettier / YAML formatting | PASS | codex report `b2-codex-report.md:107-118`; confirmed no unformatted diff on visual read |

## Maintenance debt

- Introduced: one job output (`release_mode`) and 9 repeated literal comparisons in
  `publish-electron.yml`; three widened `if:` guard expressions with duplicated prose comments
  across `ci.yml`/`electron-e2e.yml`/`vscode-e2e.yml`.
- Retired: the single-term `chore/bump-` guard that caused the PR #512 regression; the old
  "global 2" style comment inconsistency this batch does not touch (that is Batch 1's C2).
- Net: small increase in per-file line count, no new shared abstraction, but each file remains
  independently readable — appropriate for a domain (GitHub Actions YAML) with no `import`/module
  system to de-duplicate through.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the `release_mode` invariant ("every paid/outward step must positively gate on
  this") lives only in `implementation-plan.md`, not in the workflow file itself, so a future editor
  adding a build step has no signal at the point of the mistake.
- What a 10/10 version would do differently: add the one-line maintenance comment beside the
  `release_mode` job output naming the invariant explicitly, and land the (currently uncommitted)
  structural assertion script as a permanent CI lint step (e.g. `.github/scripts/`) rather than a
  one-off temp harness deleted at the end of the task, so a future regression on any of the 7 gated
  steps is caught mechanically rather than by review alone.
