# Code Logic Review — `TASK_2026_463_f13d` Batch 2 (C1 + C3)

Scope: `.github/workflows/ci.yml`, `electron-e2e.yml`, `vscode-e2e.yml`, `publish-cli.yml`
(comment only), `publish-extension.yml` (comment only), `publish-electron.yml` (dry-run mode).
Verified against `origin/main` at `97239e814` via `git diff`, independent `node`/`yaml` parsing
of the live files, and `git diff --check`.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 2        |

## Five logic questions

### 1. How does this fail silently?

A misspelled `release_mode` string (e.g. a typo introduced in a future edit to
`publish-electron.yml:97-116`) does not fail loudly — it fails *closed*: every gate compares
against the literal `'publish'`, so anything else (`'dry-run'`, empty, `'Publish'`) skips signing
and the whole `release` job (`publish-electron.yml:489,509,539,546,576,587,648,675`). This is the
correct fail-safe direction per D3's rationale, but it does mean a real release could silently
stop shipping installers with only a step-summary line and no loud error, unless someone notices
the missing artifacts. That is an accepted trade-off (implementation-plan.md D3 rationale), not a
defect.

### 2. What user action produces unexpected behaviour?

Dispatching `publish-electron.yml` manually with the `dry-run` box left at its GitHub Actions UI
default reads the input's declared default (`false`) — resolves to `publish` and runs a full
release. A user who *believes* leaving a checkbox unchecked is inherently the "safe" no-op will be
surprised. This is intrinsic to the plan's chosen default (`default: false` matches the existing
behaviour, per D3) and is documented in the input description
(`publish-electron.yml:62 'Build, package and verify... no signing, tag, bump PR or release'` is
attached to `dry-run`, not to unchecked-by-default being safe) — worth a one-line callout in the
input description that unchecked = full release, but not a logic defect.

### 3. What input data produces a wrong answer?

None found for the guarded surfaces. `github.event.inputs.dry-run` is only ever compared to the
literal `'true'`; any other value (including `undefined`, `null`, `'True'`, `'1'`) resolves to
`publish`, which is the safe direction. Verified independently by parsing the YAML and walking
every `if:` string (see Verification below) — no `!=` /negative-only gate remains on the paid
steps; every one of the seven signing/copy-back steps carries the positive
`needs.prepare.outputs.release_mode == 'publish'` term, closing the exact defect flagged in
implementation-plan.md's "Critical" evidence row (an empty `sign-check-*` output no longer runs
the retry, because the retry now requires `release_mode == 'publish'` in addition).

### 4. What happens when a dependency fails?

If `prepare`'s `Resolve release mode` step itself fails to run (e.g. the runner errors before
producing `$GITHUB_OUTPUT`), the job output `release_mode` is empty, and `build`/`release` never
equal `'publish'` — every paid/outward step and the whole `release` job are skipped. A real
release attempt would then complete with three green build legs but no tag, PR, signature or
release, which is loud only in its absence (see Q1). No step retries `prepare` itself; that is
acceptable because `prepare` failing is already a hard stop for `build`'s `needs: prepare`.

### 5. What is missing that the requirements never mentioned?

The plan never asks for a check that `publish-cli.yml` / `publish-extension.yml` changed *only* the
one comment line the orchestrator flagged for confirmation. Confirmed directly: `git diff` for
both files is exactly one added comment line above their respective `BRANCH=` assignments, nothing
else moved. This satisfies the orchestrator's explicit ask even though it isn't itself an
acceptance criterion in batches.md.

## Failure modes

### Empty/garbled `release_mode` on a real release

- Trigger: `prepare`'s mode step fails silently or a future edit breaks the id/output wiring.
- Symptom: three green build legs, no signed installers, no tag, no PR, no GitHub Release — with
  no explicit failure surfaced beyond the missing artifacts.
- Evidence: `publish-electron.yml:91,675` (both gates key off the same job output).
- Current handling: fails closed (skips outward effects), matches D3's stated rationale.
- Recommendation: none required; this is a deliberate, documented trade-off. Optional: an
  explicit `else` branch inside `release`'s own `if:` chain that posts a step-summary warning when
  `release_mode` is neither `publish` nor `dry-run`, so an unexpected third value is visible
  instead of merely "nothing happened."

### Concurrency group typo divergence

- Trigger: a future edit to the mode-resolution logic that computes `release_mode` differently
  from the concurrency group's independent inline expression
  (`concurrency.group: publish-electron-${{ github.event.inputs.dry-run == 'true' && 'dry-run' || 'publish' }}`,
  `publish-electron.yml:66`) diverges from `prepare`'s `Resolve release mode` step
  (`:93-106`), which is a *second, separately maintained* implementation of the same predicate.
- Symptom: a dry run and a real release could share or split concurrency groups inconsistently
  with what `prepare` actually resolved (e.g. a push event, which has no `github.event.inputs`,
  is handled correctly today by both independently, but a future input added to `workflow_dispatch`
  that also needs to influence the group would only need updating in one of the two places by
  someone unaware of the duplication).
- Evidence: the same `dry-run == 'true'` boolean logic appears twice — `publish-electron.yml:66`
  (concurrency) and `:97-101` (mode step) — with no shared source of truth.
- Current handling: both evaluate the same inputs today, so no divergence currently exists.
- Recommendation: low priority; note in a comment that the concurrency group expression must track
  the `Resolve release mode` step's own definition of dry-run.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### Duplicated dry-run predicate (concurrency group vs. mode step)

- File: `publish-electron.yml:66` and `:97-101`.
- The concurrency group re-derives "is this a dry run" independently of the `release_mode` output
  it is meant to track. They agree today; a future input change only updates one by default. See
  Failure modes above.

## Data flow

1. `workflow_dispatch`/`push` event fires → `prepare` job starts. **OK.**
2. `Resolve release mode` step reads `EVENT_NAME`/`DRY_RUN` via `env:` (no raw `${{ }}`
   interpolation into `run:`), writes `release_mode` to `$GITHUB_OUTPUT` and
   `$GITHUB_STEP_SUMMARY`, exits 1 if `push` resolved to anything but `publish`. **OK** — verified
   independently that `github.event.inputs` is undefined on `push`, so `DRY_RUN` is empty,
   `RELEASE_MODE=publish`, and the self-check passes.
3. `prepare` exposes `release_mode` as a job output; `build` (`needs: prepare`) and `release`
   (`needs: [prepare, build]`) both read `needs.prepare.outputs.release_mode`. **OK** —
   independently parsed and confirmed both jobs declare the dependency.
4. `build`'s seven paid/outward steps each gain
   `&& needs.prepare.outputs.release_mode == 'publish'`, verified by direct YAML-object inspection
   (all seven present, no eighth or missing one). **OK.**
5. `Upload artifacts` step's `retention-days` becomes a ternary on the same output, confirmed
   present at `with.retention-days`. **OK.**
6. `release` job gate: `if: needs.prepare.outputs.release_mode == 'publish'` plus a first-step
   runtime lock `Refuse unless publishing` reading `env.RELEASE_MODE` from the same output. **OK**
   — defense in depth, both independently gate the same value.
7. Anchors `&batch_sign_with` / `*batch_sign_with` still resolve after the edits (parsed and their
   `with.command` read back as `batch_sign` on both aliasing sites). **OK.**
8. CI-guard jobs (`ci.yml`, `electron-e2e.yml`, `vscode-e2e.yml`): the old single
   `startsWith(head_ref, 'chore/bump-')` term is replaced by three exact-prefix terms; independently
   evaluated against `chore/bump-cli-v1.2.3` / `chore/bump-electron-v0.9.1` /
   `chore/bump-extension-v2.0.0` (skip) and `chore/bump-better-sqlite3-13` / `''` (run). **OK.**

## Requirements fulfilment

| Requirement                                                             | Status   | Gap  |
| ------------------------------------------------------------------------ | -------- | ---- |
| Narrow CI guard to the three bot prefixes, human bumps still run CI       | COMPLETE | none |
| Guard comments name prefixes, PR #512, and the accepted residual          | COMPLETE | none |
| Cross-reference comment above `BRANCH=` in the two comment-only files     | COMPLETE | none |
| `dry-run` boolean input, default false, alongside `bump`                  | COMPLETE | none |
| Concurrency group separates dry-run from publish                         | COMPLETE | none |
| `prepare` resolves and exposes `release_mode`; push self-checks           | COMPLETE | none |
| Exactly the 7 named steps gated; nothing else in `build` gated except upload retention | COMPLETE | none |
| `release` job gated + second runtime lock                                | COMPLETE | none |
| Header doc gains a "Dry run" paragraph                                   | COMPLETE | none |
| Anchors still resolve                                                    | COMPLETE | none |

Implicit requirements not addressed: none found beyond the moderate note on the duplicated
dry-run predicate.

## Edge cases

| Case                                            | Handled | How                                                          | Concern |
| ------------------------------------------------ | ------- | ------------------------------------------------------------- | ------- |
| `workflow_dispatch` of `electron-e2e`/`vscode-e2e` with empty `head_ref` | YES | `startsWith('', prefix)` is false for all three terms, guard doesn't skip | none |
| Human `chore/bump-electron-vite` branch          | NO (accepted) | still matches `chore/bump-electron-v` prefix, skips CI  | documented residual, not a regression |
| Push to `release/electron`                       | YES     | no `inputs`, `DRY_RUN` empty, `RELEASE_MODE=publish`, self-check passes | none |
| Sync Release Branch dispatch (no `dry-run` input passed) | YES | unset boolean input reads as GitHub's declared default (`'false'`), resolves to `publish` | relies on GH's documented default-fill behaviour for unset dispatch inputs (assumption A3-1), unverifiable without a live dispatch |
| Skipped `sign-check-1` leaving its output empty  | YES     | retry steps now require `release_mode == 'publish'` independently of the check's output | none — this was the critical defect the plan called out, confirmed fixed |
| Dry-run Windows leg (`copy-back` skipped)         | YES     | NSIS repack and post-repack verifies run ungated against the unsigned `win-unpacked` | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the only latent concern is the unverifiable-until-first-dispatch
  assumption that `github.event.inputs.dry-run` stringifies to `'true'`/`'false'` for a checked
  boolean dispatch input (A3-1) — mitigated by an identical, already-shipped precedent in
  `publish-cli.yml:387,394` and by the push-path self-check.
- What a robust implementation would add: a single named boolean expression (or a second job
  output) for "is dry run" that both the concurrency group and the `prepare` mode step reference,
  so the predicate has one definition instead of two independently-typed copies.
