# Lane PR763 G1 — unbound resume and legacy cancel

## Finding 1 — unbound resume must not take a tab-bound checkpoint

Valid. `prepareResumedRun` (`wizard-generation-rpc.handlers.ts:786-824`, guard was at 803-812) trusted a checkpoint and then applied tab-id / workspace checks only when `metadata.tabBinding` was set. An unbound `resume: true` call passes `metadata` as `undefined` (`prepareSubmittedRun`, analysis dir `tabBinding ? null : analysisDir`). With no analysis directory, `GenerationCheckpointService.locateResumable` (`wizard-generation-checkpoint.service.ts:207-229`) returns `findLatestResumableRun`, which can be a tab-bound manifest. `prepareResume` (`wizard-generation-checkpoint.service.ts:360-367`) copies that `tabBinding` through when metadata has none.

Fix: `wizard-generation-rpc.handlers.ts:804`. When the request has no `tabBinding` and the manifest has one, return `null` (same refusal as the other guards; checkpoint is not rewritten). Tab-id and workspace-path checks for a request that includes a binding are unchanged (`:805-818`).

Spec: `wizard-generation-rpc.handlers.spec.ts:2339` — unbound resume of a bound latest checkpoint returns the existing "no resumable generation run" error, does not call the orchestrator, and leaves the manifest untouched; the same test then resumes an unbound checkpoint with no analysis directory.

## Finding 2 — legacy cancel must not abort a tab-bound run

Valid. `wizard:cancel` with no `parsed.tabBinding` called `GenerationRunSupervisor.abort` (`wizard-generation-rpc.handlers.ts`, previously the line after `saveProgress`). `abort` (`wizard-generation-run.supervisor.ts:223-228`) aborts `activeController` with no binding check. The active binding is `binding` (`wizard-generation-run.supervisor.ts:202-204`). Bound cancel already uses `abortBound` and was left as-is.

Fix: `wizard-generation-rpc.handlers.ts:1291-1293`. Legacy path sets `abortedRun` to `false` when `this.runs.binding` is set and does not call `abort`. With no wizard session the existing branch returns `{ cancelled: false }` (`:1304-1306` area), so the skipped generation is not reported as cancelled. An unbound active run (`binding === null`) still goes through `abort(GENERATION_CANCEL_REASON)`. Supervisor source was not changed.

Spec: `wizard-generation-rpc.handlers.spec.ts:788` — legacy `wizard:cancel` `{}` against a running tab-bound run returns `{ cancelled: false }`, leaves the abort signal clear, and keeps `runs.binding` / `isActive`; the same test then aborts an unbound run (`cancelled: true`, `progressSaved: true`, reason `user_cancelled`).

The previous "keeps a cancelled bound run cancelled when completion arrives late" case called legacy cancel. It now cancels through the bound `tabBinding` + `runId` path so that contract stays on the API that is allowed to stop the run.

## Jest

`npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts --coverage=false --maxWorkers=1`

Result: 1 suite passed, 100 tests passed, exit 0, about 14s. PowerShell has no `tail`; output was limited with `Select-Object -Last 25`.

## Decisions

- Reject every manifest that has `tabBinding` on the unbound resume path, including when `analysisDir` is set. Both locate paths share `prepareResumedRun`. Options were (a) only when `analysisDir` is null, (b) this gate. Evidence: `prepareResume` keeps a manifest binding whenever metadata has none. Reversible: delete the one guard.
- Legacy cancel still cancels an active setup-wizard session while a tab-bound generation is running. Only the generation abort is skipped. Options were (a) return immediately whenever `binding` is set, which would stop session cancel, (b) skip abort only. Evidence: the handler's session branch is independent of the run, and "no user-visible capability removed" covers cancelling the legacy session. When no session exists, the response stays `{ cancelled: false }`. Reversible: change the ternary.
- Did not add a `rejection` code on the skipped legacy cancel. The unbound response shape already uses `{ cancelled: false }` when nothing was stopped.

## Not done

- `ptah_agent_report` was not available: MCP search listed only the `tasks` server. No ptah tool schema was returned.
- Supervisor file not edited. No Nx, build, or git.
