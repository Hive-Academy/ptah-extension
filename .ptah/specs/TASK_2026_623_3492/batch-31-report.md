# Batch 31 report: DOC2 content manifest and measurement

Executor: backend-developer. This run resumes after an interrupted executor. Nothing is committed.

## Tasks

- **31.1 `content-manifest.json`:** the previous executor had already regenerated it (2-line diff, new content hash).
  `npm run manifest:check` passes, so it was not regenerated again.
- **31.2 `measurement.md`:** created with the hint text, characters and tokens; R8.4 fence vs JSON for all 22 corpus
  cases; R8.5 fence vs markdown; NFR 5.10 coding `tools/list` parity; the A8 Apps delta; and an "Eager closure"
  placeholder for Batch 33. It does not repeat the "~106 tokens" claim (#140). `surface-catalog-reference.spec.ts` is
  unchanged because A8 does not require a change.
- **31.3 spec relabel:** title-only edit of two cases in `ptah-ui-hint.spec.ts`:
  - `uses only parseable ptah-ui examples` became `future-fence guard: every ptah-ui fence the hint may contain parses
    (it contains none today)`.
  - `names an opener and sources that the fence grammar accepts` became `component syntax coverage: the named display
    [id] opener segments as a display fence and each listed source parses as a stat value`.

  No assertion, fixture, import or `PTAH_UI_HINT` change. `git diff --stat` shows 2 insertions and 2 deletions.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\content-manifest.json` (by the previous
  executor's `manifest:generate`; verified here)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.ptah\specs\TASK_2026_623_3492\measurement.md`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts`

## Measurements (details and commands in measurement.md)

- **Hint at HEAD:** 371 chars, 373 UTF-8 bytes, 87 tokens (gpt-tokenizer 4.0.0 `encode`). Without ` $limits`: 363
  chars, 85 tokens. The merge-base hint was 320 chars, 74 tokens. These match the 371 / 87 / 85 that #136 recorded.
- **R8.4:** the fence is smaller than the JSON in all 22 corpus cases (for example, mixed-nested-release 114 vs 486).
- **R8.5:** fence 25 tokens vs markdown 127 tokens.
- **NFR 5.10:** the coding `tools/list` is byte-identical at HEAD and at merge base `70f995a56`:
  - VS Code: 61 tools, 64815 chars.
  - Electron: 58 tools, 62510 chars.
- **A8:** the Apps `tools/list` delta is 0 chars:
  - VS Code: 64 tools, 138323 chars.
  - Electron: 61 tools, 136018 chars.

  `ptah_surface_update` text is built from the `/3` constants, and `/4` lives in separate `SURFACE_CATALOG_4_*` lists.

How it was measured: the HEAD and merge-base trees were exported with `git archive` to `D:/tmp/b31/{head,base}`, each
with a junction to the shared `node_modules`. The same throwaway Jest spec ran in each tree and called
`handleMCPRequest('tools/list')` for each host and profile. The two full JSON dumps were byte-identical. The temp
directory and junctions are removed, and `node_modules` was confirmed intact afterwards.

## Verification

1. `npm run manifest:check 2>&1 | tail -n 20` printed `content-manifest.json is up to date (sha256:a40c077c13fd7ca0a385d100d40385233962d85bb7f893ae9bc718eae80f1f8e, 229 files).`
2. `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts --moduleNameMapper='{...#135 mapper...}' --coverage=false --maxWorkers=2 | tail -n 40` printed `Test Suites: 1 passed, 1 total` and `Tests: 4 passed, 4 total`.
3. `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts --moduleNameMapper='{...}' --coverage=false --maxWorkers=2 | tail -n 20` printed `Test Suites: 1 passed, 1 total` and `Tests: 7 passed, 7 total`.
4. The measurement run of `ptah-ui-compactness.spec.ts` and `ptah-ui-agents-compactness.spec.ts` (libs/shared, same
   mapper) had 2 suites pass and 40 of 40 tests pass.

## Deviations and notes

- **Scratch files removed.** The interrupted executor had left two untracked files in the repository:
  `libs/backend/vscode-lm-tools/src/zz-batch31-tools-list.measure.spec.ts` and the directory
  `libs/shared/src/zz-b31-base-contracts/`. Both are deleted. The base-contracts copy did not match the merge-base
  `mcp-apps-contracts` file set, so it was not used for any number.
- **Prettier not applied to the spec.** Running Prettier on the spec reflowed one untouched `matchAll(...)` line. That
  reflow was reverted to keep the edit title-only, so the two new long titles are not Prettier-wrapped. The original
  `matchAll` line was already over Prettier's width before this batch.
- **Out of scope.** The in-body comment of the component-syntax case still reads "The hint carries no full example to
  stay in budget". That is the budget rationale #140 replaced. It was left as is because 31.3 is title-only. A
  follow-up comment edit is suggested.
