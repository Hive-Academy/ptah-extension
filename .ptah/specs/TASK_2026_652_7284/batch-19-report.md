# Batch 19 report

## Requirements

- **A — archive safety:** `analysis-storage.service.ts:361-430` sets `deleteStarted` immediately before source deletion. Cleanup removes an archive only before deletion begins and only while the source still parses as legacy v3. A failed delete or restore keeps the verified archive and reports its path through `LegacyRunArchiveError.archiveDir` and the message. The constructor still sets `this.name` (`:71-79`). A partial archive retained after a pre-delete cleanup failure is labeled partial in the message.
- **B — fallback run directory:** `analysis-storage.service.ts:48-50,116-134,179-194` exports the suffix and variant, resolves both variants without I/O, and creates only the chosen directory. The doc comment records why `--v4` cannot collide with a normal slug. `ensureSlugDir` is unchanged.
- **C — archive selection:** `analysis-storage.service.ts:49,52-54,379-382,461-471,484-497` exports the archive marker and name predicate, uses the marker for archived folders, and excludes those folders from latest and resumable selection. `list` and `loadMultiPhase` remain able to show and load them (`:626-680`).
- **D — v3 resume:** The existing v3 skip remains in `findLatestResumableRun` (`analysis-storage.service.ts:496`).
- **E — documentation:** The `readManifest` contract is documented at `analysis-storage.service.ts:331-334`; the file header, `ResumableRun.manifest`, and `listValidRuns` comments now mention v3 and v4 (`:5,60,703`).

## Spec cases

- **a:** `analysis-storage.service.spec.ts:486` simulates partial source deletion followed by failed restoration, then checks the error path and every archive file against its original bytes.
- **b:** `analysis-storage.service.spec.ts:464` checks that a clean delete rejection leaves the v3 source and verified archive available, with the path in the error.
- **c:** `analysis-storage.service.spec.ts:443` retains the pre-delete copy failure regression and checks that the partial archive is removed while v3 stays intact.
- **d:** `analysis-storage.service.spec.ts:202` checks both directory variants, a paused v4 fallback in list/latest/resume, and unchanged v3 manifest and phase bytes.
- **e:** `analysis-storage.service.spec.ts:737` checks that a newer archive is ignored by latest/resume but remains in list and can be loaded.
- **f:** `analysis-storage.service.spec.ts:685` adds an unfinished generation checkpoint to the paused v3 case and verifies that it is still not resumable.

## Files modified

- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-19-report.md`

## Verification

The commands below were run from `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions`, one at a time. PowerShell's `Select-Object -Last` provided the requested tail filtering. The final commands followed the last source edit.

- `npx prettier --write libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts` — exit 0; both files unchanged on final formatting pass.
- `npx prettier --check libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts` — exit 0; `All matched files use Prettier code style!` (2 files pass, 0 fail).
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1 2>&1 | Select-Object -Last 25; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }` — exit 0; `Successfully ran targets typecheck, lint for project @ptah-extension/agent-generation` (2 targets pass, 0 fail).
- `npx nx run-many -t test -p @ptah-extension/agent-generation --parallel=1 --maxWorkers=2 2>&1 | Select-Object -Last 40; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }` — exit 0; `Successfully ran target test for project @ptah-extension/agent-generation` (1 target pass, 0 fail). Nx hid Jest's individual suite/test counts in this output.
- Scoped `ptah_get_diagnostics` on the two changed TypeScript files — 0 errors, 0 warnings; clean coverage.

Nx Cloud also reported a disabled organization (401) after the successful local target results; it did not change the exit status.

## Decisions

- A failed cleanup before source deletion can retain only a partial archive. Its error names that path while calling it partial; after source deletion begins, the error calls the retained copy verified.
- The archive selection spec uses a v4 manifest inside an archive-named folder, which exercises both selectors independently of the existing v3 resume skip.
