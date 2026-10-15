# Batch 12 report — v4 writer and SDK session capture

## Task 12.1 — SDK identity and input hashes

`MultiPhaseAnalysisService` captures the first nonempty SDK `session_id` for each attempt. A later `system/init` ID must agree with that first ID; disagreement raises `PhaseSessionIdentityError`, clears the disputed ID, and fails the phase. A stream with no ID raises `PhaseSessionMissingError` and leaves output unverified. A stream without init uses its first message ID. The synthetic `WizardPhaseId` remains confined to UI events. The service hashes the actual system/user prompt pair, prior phase file bytes, and final output bytes, then supplies them to the checkpoint. The existing timeout and abort controller logic remains in place.

## Task 12.2 — durable v4 checkpoint and migration

`AnalysisRunCheckpoint.open` computes the existing `sha256-v1` workspace fingerprint through `computeWorkspaceFingerprint` and writes schema-valid v4 manifests. Every running transition increments `attempt`, clears the prior session and verification, and records the new input. Completed phases record SDK session ID, input, output SHA256, and verification timestamp. Every lifecycle transition validates with `MultiPhaseManifestV4Schema.parse` before writing.

On resume, a v4 phase is skipped only when its recorded workspace, prompt, prior phase and model inputs match and its output file bytes match the recorded hash. A mismatch resets that phase and all descendants to pending before rerun. A v3 run is archived with `AnalysisStorageService.archiveLegacyRun` before a fresh v4 run is created. Archive failure returns an error before SDK execution, leaving the v3 run intact.

This closes **R1** by using Batch 10's copy, byte verification, v3 validation and delete-last archive path without assuming filesystem rename. It closes **R2** by switching the writer and its live integration spec together. It closes Batch 10's interim resume gap: new paused runs are v4 and resumable; an explicitly resumed legacy v3 run is preserved in the archive and restarted as v4.

## Task 12.3 — integration coverage

`multi-phase-analysis.service.spec.ts` now asserts v4 manifests, SDK init identity versus the synthetic UI ID, first-message identity without init, missing/conflicting ID failures, verified hashes and attempts, v3 archive preservation and archive failure, and downstream invalidation after output tampering. Existing pause/resume, stale file, retry, max-turn, and model-change cases continue to pass.

## Files created or modified

- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\services\wizard\analysis-run-checkpoint.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.spec.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\.ptah\specs\TASK_2026_652_7284\batch-12-report.md` (created)

## Verification

Prettier was run on exactly the three changed source/spec files:

- `npx prettier --write <three files>`: all three processed, exit 0; final pass reported each unchanged.
- `npx prettier --check <three files>`: `All matched files use Prettier code style!`, exit 0.

Required split commands, in order, with the observed tails:

1. `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`: both targets passed; `Successfully ran targets typecheck, lint`, exit 0.
2. `npx nx run-many -t test -p @ptah-extension/agent-generation --parallel=1 --maxWorkers=2`: test target passed; `Successfully ran target test`, exit 0.
3. `npx nx typecheck @ptah-extension/rpc-handlers`: `Successfully ran target typecheck`, exit 0.
4. `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts --coverage=false --maxWorkers=2`: 1 suite, 43 tests passed, exit 0.
5. `npx nx typecheck @ptah-extension/setup-wizard`: `Successfully ran target typecheck`, exit 0.
6. `npx nx test @ptah-extension/setup-wizard --maxWorkers=2`: 13 suites, 337 tests passed, exit 0.
7. `npx nx typecheck ptah-cli`: `Successfully ran target typecheck`, exit 0.
8. `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/analyze.spec.ts --coverage=false --maxWorkers=2`: 1 suite, 6 tests passed, exit 0.
9. `npx nx run di-lint:lint`: `di-lint OK: 1826 @inject sites ... (793 tokens)`; target passed, exit 0.

After the final small test assertion and error bookkeeping edit, scoped `ptah_get_diagnostics` reported 0 errors and 0 warnings. The focused final `npx jest -c libs/backend/agent-generation/jest.config.ts libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts --coverage=false --maxWorkers=2` run passed 1 suite and 32 tests, exit 0. The Nx commands reported an Nx Cloud account 401 after successful local targets; no local check failed. No git command was run.
