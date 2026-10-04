# Code Logic Re-review — TASK_2026_609_c495 Part A fix round

Verdict: CHANGES REQUIRED

Score: 5/10

Scope: only `841263730` (A-FIX-1) and `dc2e2b3fd` (A-FIX-2). All eight touched files were read, including the existing list/Restore readers in the quarantine file. Later model-type changes in `workspace-target.ts` were excluded. The original review remains unchanged.

| Finding | Status | Evidence |
| --- | --- | --- |
| F1 — Blocking: filtered hash deletes unpreserved skill data | PARTIALLY FIXED | `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts:151` detaches the entire tree; `:215`, `:218`, `:225`, `:240` preserve over-depth trees, unreadable directories, ignored names and nested links. However, `:242` accepts a regular file without proving readability; `libs/backend/harness-sync/src/lib/hash/content-hash.ts:316` hashes failed reads as the constant `unreadable`. See residual F1 below. |
| F2 — Blocking: a save between verification and removal is lost | PARTIALLY FIXED | The forward paths now rename before deciding: `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts:151`, `:167`; `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts:564`, `:567`, `:574`. New occupants survive those forward paths. Rename failures map to `writeFailed` at `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:883` and a failed slug at quarantine `:519`. However, the new rollback call at quarantine `:626` reaches an unconditional live-path unlink at `:1044`. New finding 1 below. |
| F3 — Serious: successful moves disappear from the record after retry/overlap | FIXED | Quarantine `:400` opens the journal before moving; `:506` records each verified move; `:448` gates completion on zero failed slugs; `:451` writes the union. `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine-journal.ts:145` commits before replacing in-memory state; `:248` serializes passes for the same root on the owning instance. Quarantine `:681` retains the v1 marker shape. The cumulative marker is exercised through real listing and Restore at `user-layer-seed-quarantine.spec.ts:551`, `:555`, `:561`. |

## New findings

### 1. Blocking — quarantine rollback can delete a replacement at the original path

- File: `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts:626` (new call), `:1037`, `:1044` (existing helper newly reached by rollback).
- Trigger: a save before detach changes the clone, so `:574` requests rollback, or a journal write fails and `:510` requests rollback. On a filesystem where hard links are unsupported, `placeExclusive(staged, original)` falls back to `COPYFILE_EXCL`. That copy fails with an error other than EEXIST. An editor creates/replaces the original path after the copy's failure/cleanup and before the catch's awaited `unlink(dest)` executes.
- Symptom/impact: the editor's new file is unlinked. History contains the earlier detached version, not the new save. The operation reports a failed slug, but the lost save is unrecoverable.
- Current handling: exclusivity establishes ownership only at creation time; it does not establish ownership of whichever object occupies the pathname later. `:1044` removes that pathname without an identity-safe handoff. This directly contradicts the rollback contract in `batches.md:486` and the requested “nothing at the original path is unlinked after detach.”
- Why in scope: the helper's Restore use predates these commits; this review does not charge that existing Restore behavior. A-FIX-2 newly routes quarantine rollback through it with the original clone/sidecar path as `dest`.
- Fix: give rollback a placement operation that never unlinks the original path on failure. If safe exclusive placement cannot complete, retain the detached artifact and report the recovery path. Do not add another check-then-unlink race.
- Regression required: inject unsupported `link`, then a failing fallback copy which leaves a fresh editor replacement before rejecting; assert the replacement and detached bytes both survive. Existing before/after-detach tests at `user-layer-seed-quarantine.spec.ts:573`, `:595`, `:619` do not enter this branch.

## Residual original finding

### F1. Blocking — unreadable regular files still qualify as fully hashable

- File: `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts:224`, `:242`; comparison at `:202`, deletion at `:173`.
- Concrete scenario: a legacy managed skill contains readable `SKILL.md` and a regular `notes.md` whose contents cannot be read, although its containing directory permits listing and deletion. The skill is absent from the desired sources. `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:736` hashes it during legacy adoption and `:744` records that hash. `content-hash.ts:316` substitutes `unreadable` for the unreadable file's digest. Retirement renames the tree, obtains the same sentinel-based digest, and its new coverage walk accepts `notes.md` solely because it is a regular file. It deletes the staged tree and reports ordinary removal. No snapshot of the unique notes remains. POSIX read permission and directory unlink permission can differ; this does not depend on the accepted top-level `lstatOrNull` issue.
- Current handling: unreadable directories are rejected, but regular-file readability is never checked by the preservation inventory. A matching content hash is not proof when either digest contains a failure sentinel.
- Fix: make the retirement-only proof fail closed on any regular-file read failure, e.g. a strict digest/inventory that reports unreadability rather than substituting a value. Preserve source-discovery hashing semantics.
- Regression required: compute/adopt the sentinel-bearing owned hash for a tree with an unreadable regular file, retire it, and assert the complete tree remains in history. A deterministic path-filtered read failure can exercise this on Windows. Also add an unreadable-directory case. Neither exists in the two changed harness suites.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 2 |

The ordinary detach, ignored-content preservation and cumulative retry flows are implemented and meaningfully tested. This separates the result from a foundational failure. It remains below the sound 7–8 band because two error-path scenarios can still irreversibly lose user bytes; passing happy-path and injected-rename tests do not cover them.

## Regression evidence

Paths in this table are relative to their named source directories above.

| Scenario | Assertion audit |
| --- | --- |
| Unique ignored content with unchanged skill hash | `artifact-retirement.spec.ts:155` explicitly asserts equal filtered hashes at `:165`, then reads the saved unique bytes at `:172`. Reconciler integration at `harness-reconciler.retire-local-edit.spec.ts:450` asserts health reporting, ownership pruning and preserved notes. Correct assertions. |
| Nested symlink and over-depth content | `artifact-retirement.spec.ts:178` checks link identity and untouched outside bytes; `:194` checks the otherwise invisible deep file's preserved bytes. Correct assertions. |
| Unreadable skill entries | No dedicated file-read or directory-read failure regression in either harness suite. The kind-mismatch test at `harness-reconciler.retire-local-edit.spec.ts:291` is not an unreadable-entry test. |
| Harness save before/after detach | `artifact-retirement.spec.ts:211`, `:225`, `:242` assert the replacement remains live and/or the detached edit is preserved. Correct for completed path-based saves; not a proof that renamed objects are immutable through existing open handles. |
| Harness rename failure and retry | Unit EXDEV/EBUSY at `artifact-retirement.spec.ts:261`; integration EXDEV at `harness-reconciler.retire-local-edit.spec.ts:502` asserts `writeFailed`, retained ownership, original bytes and a successful next pass. Correct assertions. |
| Quarantine save before/after detach | `user-layer-seed-quarantine.spec.ts:573`, `:595`, `:619` check restored changed bytes, occupied-path preservation, history bytes and marker behavior. Correct forward-path assertions; failed fallback rollback is missing. |
| Quarantine rename failure | `user-layer-seed-quarantine.spec.ts:641` checks both clone and sidecar, no timestamp directory, failed slug and absent marker. Retry is covered by `:521`. |
| Success + EBUSY + retry | `user-layer-seed-quarantine.spec.ts:521` checks both marker slugs at `:551`, both listing entries at `:556`, successful Restore for both at `:566`, and original VIDEO bytes at `:568`. This addresses the original inadequate assertion. |
| Journal-write failure + retry | `user-layer-seed-quarantine.spec.ts:662` checks rollback, absent marker and subsequent journal/marker inclusion. Correct for successful rollback. |
| Interrupted pass and concurrent passes | `user-layer-seed-quarantine.spec.ts:691` seeds prior journal state and checks the union; `:714` runs concurrent calls on one instance and checks exactly one active pass and both recorded slugs. This matches the instance-local lock contract in `batches.md:499`; it does not establish cross-process locking. |
| Unreadable journal | Malformed JSON at `user-layer-seed-quarantine.spec.ts:729` asserts no moves, no marker and a warning. Production `user-layer-seed-quarantine-journal.ts:179` also returns unreadable on non-ENOENT read errors; an actual EACCES journal test is absent. |
| Marker shape and completion-write failure | Real list/Restore assertions exercise v1 validation; shape fixture at `user-layer-seed-quarantine.spec.ts:847`. No dedicated marker-write-failure/retry test. Static trace supports recovery: journal write finishes at `user-layer-seed-quarantine-journal.ts:158` before marker write at quarantine `:677`; retry reopens it at `:400`. |

## Five logic questions

### 1. How does this fail silently?

The sentinel-based directory hash can produce ordinary `removed` despite unreadable user content (`artifact-retirement.ts:202`, `:173`; residual F1). Quarantine rollback logs a failure but does not reveal that its cleanup deleted a newer save (`user-layer-seed-quarantine.ts:626`, `:1044`; new finding 1).

### 2. What user action produces unexpected behaviour?

Retiring a legacy skill with read-protected notes can delete those notes (`workspace-target.ts:736`; `artifact-retirement.ts:242`). Saving during failed rollback can lose the new file (`user-layer-seed-quarantine.ts:1044`). Ordinary saves before/after successful detach are covered by the regression cases above.

### 3. What input data produces a wrong answer?

A recorded directory hash containing the `unreadable` sentinel is accepted as byte-equality evidence (`content-hash.ts:316`; `artifact-retirement.ts:202`). A malformed journal instead fails closed (`user-layer-seed-quarantine-journal.ts:179`, `:193`, `:208`).

### 4. What happens when a dependency fails?

History creation/rename errors preserve originals and retain retry state (`artifact-retirement.ts:142`, `:152`; `workspace-target.ts:883`). Quarantine rename/journal errors attempt exclusive rollback and report failed slugs (`user-layer-seed-quarantine.ts:510`, `:568`, `:519`), but failed fallback-copy cleanup is unsafe as above. Unreadable journals stop before moves (`:400`, `:405`).

### 5. What is missing that the requirements never mentioned?

The preservation proof must distinguish a real file digest from a failed-read sentinel (`content-hash.ts:316`). A helper named “exclusive placement” does not necessarily satisfy “never unlink the live path”; its failure cleanup must also satisfy that contract (`user-layer-seed-quarantine.ts:1044`).

## Data flow

1. **OK:** target removal delegates with the recorded hash (`workspace-target.ts:877`).
2. **OK for successful path handoff:** rename into unique history precedes the decision (`artifact-retirement.ts:139`, `:151`).
3. **GAP:** the strict-looking inventory checks file type but not successful content reads (`artifact-retirement.ts:242`).
4. **OK:** failed retirement is retained as `writeFailed`; kept edits populate both removal lists (`workspace-target.ts:883`, `:887`).
5. **OK:** quarantine pass lock includes marker check, journal load, moves and completion (`user-layer-seed-quarantine.ts:382`, `:398`, `:451`).
6. **GAP on rollback:** detach/check is safe for path replacements, but put-back invokes live-path cleanup (`user-layer-seed-quarantine.ts:567`, `:574`, `:626`, `:1044`).
7. **OK within the accepted lock/crash scope:** move journal precedes completion; cumulative v1 marker feeds existing readers (`user-layer-seed-quarantine.ts:506`, `:681`, `:723`, `:789`).

## Requirements fulfilment and edge cases

| Requirement / case | Status | Gap |
| --- | --- | --- |
| Ignored names, nested links, excessive depth | COMPLETE | Dedicated preservation assertions exist. |
| Unreadable entries | PARTIAL | Directories fail closed; sentinel-hashed regular files can be deleted. |
| Completed save before/after forward detach | COMPLETE | Bytes preserved in history or at the new live path. |
| Never unlink original after detach, including rollback | PARTIAL | New finding 1. |
| Rename failure: preserve, report, retry | COMPLETE | Tests cover both harness and quarantine paths. |
| Cumulative marker, clean-pass gate, instance-local concurrency | COMPLETE | Retry/list/Restore and concurrent-pass tests exercise the contract. |
| Malformed/unreadable journal: nothing moves | COMPLETE | Code handles read/shape failure; regression directly covers malformed JSON. |
| Marker-write failure regression | MISSING | Static recovery path is sound; dedicated injected failure test absent. |

Implicit requirements not addressed are the two preservation conditions identified above. Minor coverage suggestions are the missing unreadable-entry, actual journal-read-error and marker-write-error regressions; they are not additional counted failure modes.

## Verification and limits

- Ran exactly one scoped test command: `npx nx test @ptah-extension/agent-generation --maxWorkers=2 --testPathPatterns=seed-quarantine`, output tailed with PowerShell `Select-Object -Last 25`: **1 suite passed; 64 passed, 1 skipped**. The skip is the existing POSIX-only source-directory permission case (`user-layer-seed-quarantine.spec.ts:821`). Nx reported success; deprecation/module-loading and Nx Cloud account messages were also emitted.
- Scoped `ptah_get_diagnostics` reported clean TypeScript coverage, zero errors/warnings for the requested owning projects. This is worktree diagnostics, not an isolated build of each historical commit.
- Harness tests were inspected, not rerun: executor evidence reports 20 artifact-retirement and 12 retire-local-edit cases passing (`afix1-executor-report.md:45`, `:62`). This is not a claim that the whole harness project is green.
- Both remaining defects are supported by static control/data-flow traces; this review did not execute new reproductions or modify tests/source.
- Accepted exclusions were not raised as defects: rename-to-journal crash window, Part B overwrite snapshot race, pre-existing top-level lstat EACCES treatment, and file length. No style review was present. No repository instruction file applied to these source directories; supplied project guidance was used. Direct read tools were unavailable, so native read-only file reads supplemented the listed Ptah tools.

## Verdict

- Recommendation: REVISE / CHANGES REQUIRED.
- Confidence: HIGH on the traced branches; the two reported failure interleavings remain unexecuted.
- Top risk: failure handling can still destroy bytes that the preservation protocol promises to retain.
- A robust implementation would reject unreadable-file sentinels as preservation proof and ensure quarantine rollback never unlinks a live pathname, with regressions for both.
