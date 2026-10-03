# Batch 1a executor report: harness-sync guard (TASK_2026_609_c495)

Executor: backend-developer (sub-agent). No git commands that write were run.

## Verdict

Tasks 1a.1-1a.3 are done. Typecheck and lint pass. The new spec passes 9/9. The existing removal specs named in batches.md pass unchanged. The harness-sync test target still fails, but only on 17-18 pre-existing tests that fail the same way with HEAD versions of the batch files (evidence below). None of those failures is in a file this batch owns.

## Tasks

### 1a.1: optional `removedLocalEdit` field (DONE)

- `HarnessApplyResult.removedLocalEdit?: string[]` (`harness-target.port.ts`). The doc comment says the paths were hand-edited, snapshotted to `{ws}/.ptah/harness/.history/<slug>/<ts>/<relPath>` and then removed, and that every one also appears in `removed`.
- `HarnessTargetHealth.removedLocalEdit?: string[]` (`harness-sync.types.ts`). It sits beside `removed` and is optional for the same reason as `adopted` (R12). No frontend or fixture edits were needed: `shared` typecheck is clean.
- R12 choice: **emit `[]`** on every health row produced from an apply. `appliedTargetHealth` emits `removedLocalEdit: [...(result.removedLocalEdit ?? [])]`, and the remove-pass row (`harness-reconciler.service.ts`, runRemove) emits `result.removedLocalEdit ?? []`. Planned, undetected and verify rows omit the field, the same way they handle `adopted`. `WorkspaceHarnessTarget.apply` always initialises the field to `[]`. `ClaudeHarnessTarget` and the other producers leave it unset.

### 1a.2: guard in `WorkspaceHarnessTarget.apply` (DONE)

The removal loop now calls the private `retireOwned` method. Its doc comment states the rule and cites TASK_2026_609. Each non-MCP removal is handled in this order:

1. **lstat.** If the path is absent (`lstatSyncOrNull` returns null), it gets a plain `removeManaged` (ENOENT tolerated) and is reported in `removed`. A symlink gets `withWindowsRetry(unlink)` with no snapshot and is never followed.
2. **Hash the copy as the kind the manifest recorded** (`removal.isDirectory` → `hashDir`, otherwise `hashFile`). A `null` result means **not removed**, plus a `writeFailed` entry `cannot read to check for local edits: <relPath> is not a readable file|directory`. Using the recorded kind rather than the current `stat` kind is deliberate: a directory sitting where a file was written is a read error, not "unchanged". That is spec case 4.
3. **Hash equals `plan.baseEntries[relPath].hash`, or no owned record exists:** plain `removeManaged`, no snapshot.
4. **Hash differs:** `snapshotLocalEdit` runs these steps:
   - `mkdir -p {ws}/.ptah/harness/.history/<slug>` (uses `HARNESS_STATE_DIR` from `managed-manifest.ts`).
   - Creates `<ts>` with a non-recursive `mkdir`. On EEXIST it tries `<ts>-1`, `-2` and so on, up to 100.
   - `mkdir -p` the parent of `<relPath>`.
   - `cp` (recursive for directories, under `withWindowsRetry`, same precedent as `quarantine/quarantine.ts:230`).
   - Re-hashes the snapshot and requires it to equal the on-disk hash.
   - Any failure means **not removed**, plus `writeFailed` `could not save local edit before removal: ...`.
   - After a verified snapshot it calls `removeManaged` and reports the path in both `removed` and `removedLocalEdit`. If `removeManaged` fails after that, the result is `writeFailed` `failed to remove: ...` and the snapshot is kept.
   - `<slug>` is the basename up to its first `.` (a skill directory keeps its full name). `<ts>` is the ISO time with `:` and `.` replaced by `-`.
- `planRemovals` selection is unchanged, and MCP removals are unchanged (they stay owned by the facet).
- Retry contract confirmed, not changed: only `result.removed` is pruned from the manifest (`harness-reconciler.service.ts` runRemove `remaining` loop, and `mergeEntries(plan.baseEntries, result.written, result.removed)`). A `writeFailed` removal therefore keeps its entry and is retried. Spec cases 4 and 5 assert the entry is kept, and case 4 asserts the retry succeeds.

### 1a.3: spec (DONE)

The spec is `harness-reconciler.retire-local-edit.spec.ts`. It uses the real `HarnessReconcilerService` with the real `createCodexTarget` and `createCopilotTarget` targets in a temp workspace, with no fs mocks. State is recorded with `agentSyncEnabled: true, skillSyncMode: 'all'`. All 9 cases pass:

1. Unchanged agent copy, source deleted: removed, in `removed`, `removedLocalEdit` is `[]`, no `.ptah/harness/.history`, manifest entry dropped.
2. Hand-edited copy (`HAND EDITED`), source deleted: the file is gone and exactly one `<ts>` directory exists, matching `^\d{4}-..T..-..-..-...Z(-\d+)?$`. `.history/agent-two/<ts>/.codex/agents/agent-two.toml` holds exactly `HAND EDITED`. The path is in `removed` and `removedLocalEdit`, and the manifest entry is dropped. The untouched Copilot copy goes the plain way. **This pins A5 case 2.**
3. Disabled-agent retirement (`['agent-two']`) gives the same outcome as case 2. agent-one's Codex and Copilot copies stay, and agent-one has no snapshot.
4. Read error: the owned file is replaced by a directory of the same name. It is not removed, the `writeFailed` reason matches `cannot read to check for local edits`, the manifest entry is kept and there is no history. After the original bytes are restored, the next pass retires it plainly.
5. History write fails: a regular file sits at `.ptah/harness/.history`. The hand-edited Codex copy is kept with its bytes intact, the reason matches `could not save local edit before removal`, and the manifest entry is kept. The unchanged Copilot copy in the same pass is still removed and its entry pruned.
6. Rival skill directory. The unchanged `kept-as-is` is removed plainly with no snapshot, which is the A8 check. The hand-edited `tuned` (extra `NOTES.md`) is snapshotted whole (`NOTES.md` plus the transformed `SKILL.md`, byte-equal to the written copy) and then removed.
7. Remove pass (E22) over a hand-edited `agent-one.toml`: snapshot created, and the Codex health row has `removedLocalEdit: ['.codex/agents/agent-one.toml']`. The unchanged agent-two is removed too, and the Codex manifest ends empty.
8. The same slug hand-edited in Codex and Copilot in one pass: both edits are preserved (`CODEX EDIT`, `COPILOT EDIT`) under their own `<ts>/<relPath>`, and each target reports its own path.
9. R13: the next pass after case 2 has `foreign`, `removed`, `removedLocalEdit` and `writeFailed` all `[]` on every row, and still exactly one snapshot.

The existing specs named in batches.md stay green unchanged: `agent-consent.spec.ts:226` ("[286] a disabled agent is reaped…") passes, and `idempotency-removal.spec.ts`, `remove.spec.ts` and `foreign-edits.spec.ts` pass. A targeted run of those four files plus the new spec gave `Tests: 16 passed, 16 total`. The other two agent-consent tests fail before and after this change (see Verification).

## A8 outcome: HOLDS

The write branch records the real on-disk hash. `writeArtifact` returns `(await hashDir(absolute)) ?? write.hash` for skills (`workspace-target.ts`, `writeArtifact`), and that is the value `applyWrite` puts in `result.written`. Empirical check: spec case 6 writes `.agents/skills/kept-as-is` (and `.github/skills/kept-as-is`) through the write branch on pass 1, then retires them on pass 2. Neither appears in `removedLocalEdit`, no `.history/kept-as-is` exists, and the Copilot row's `removedLocalEdit` is `[]`. The case passes.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync,@ptah-extension/shared` (no `--maxWorkers`, re-run with `--skip-nx-cache`): **all 4 tasks succeeded**.
  - Lint has one warning, not an error: `workspace-target.ts` max-lines 814 > 700. It is pre-existing: HEAD's version already reports `703 > 700` (checked with `git show HEAD:… | eslint --stdin`). The helper stays in this file as the batch requires ("file budget"). Splitting the file is for the architect to decide.
- `npx prettier --check` on the six files: clean. Running `prettier --write` also reflowed two unrelated union types in `harness-sync.types.ts`; I reverted those hunks by hand so the shared diff only adds the field.
- `npx nx run-many -t test -p @ptah-extension/harness-sync --maxWorkers=2`: **FAILS overall, `Tests: 18 failed, 439 passed, 457 total`** (6 suites failed, 45 passed). Repeated direct jest runs give 17-18.
  - The failing tests are all pre-existing:
    - `agent-consent` (2 tests other than :226)
    - `skill-consent` (7)
    - `gitignore` (5; `.gitignore` never written)
    - `cancellation` (2)
    - `write-failure` E21 (1)
    - `capability-policy` C3 (flaky, fails on some runs only)
  - Evidence that they pre-exist: I temporarily restored the five modified files to their `git show HEAD:` versions and moved the new spec aside (Batch 1's files were not touched; `git status` was confirmed before and after the restore). The same six suites then gave `Test Suites: 5 failed, 1 passed; Tests: 17 failed, 26 passed`, with the same failure messages (for example, the agent-consent state was never recorded, `.gitignore` ENOENT, and C3 `baseEntries` was not emptied).
  - The new spec is not in any failure list.
  - Root cause of the pre-existing failures: not investigated (outside this batch). It looks environmental or shared-state, since workspace state and `.gitignore` are not persisted in temp workspaces. The team-leader should check them on `main` before treating the test target as a gate.
- `git status --short`: the only harness-sync and shared changes are the six batch files. Batch 1's four agent-generation files are untouched.

## Plan deviations

- Step 2 hashes by the kind the manifest recorded (`removal.isDirectory`), not by the current `stat.isDirectory()`. With the stat kind, case 4's directory would hash fine and read as a local edit instead of a read error. This follows the batch's case-4 intent.
- The snapshot copy uses `fs/promises.cp` rather than `copy-engine.copyDirectory`. `copyDirectory` skips ignored names (`.history`, `_candidates`, `.ptah-origin.json`), so a user file under those names inside a skill directory would be deleted without being saved. `cp` copies everything. The verify step still compares `hashDir` to `hashDir`, which ignores the same names on both sides.

## Out-of-scope observations

- The 17-18 pre-existing harness-sync test failures above.
- Pre-existing: `workspace-target.ts` was already over the 700-line lint ceiling.
- The installed prettier formats `harness-sync.types.ts`'s multi-line unions differently from what is committed at HEAD. This is a prettier-version or formatting drift in the shared lib and was left untouched.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\workspace-target.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\harness-target.port.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\health\harness-health.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\lib\types\harness-sync.types.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.retire-local-edit.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\.ptah\specs\TASK_2026_609_c495\batch-1a-executor-report.md` (this report)
