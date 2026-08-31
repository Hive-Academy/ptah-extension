# Batch 3 report — RPC validation, checkpoint orchestration, and final outcome broadcasts

Executor: backend-developer (Claude session `ptah-extension-5c`). Date: 2026-08-31.
Status: **IMPLEMENTED, verified green. Not committed** (orchestrator commits).

## 0. Incident: concurrent second writer on the same ownership set

While this batch was in progress a peer Claude session (`ptah-extension-38`,
visible via `ListAgents`) was independently rewriting
`wizard-generation-rpc.handlers.ts` (its version imported `ulid` and a
`wizard-generation-run.controller.ts` it created at 17:57 local; it also
appended a `formatIssue()` to my `wizard-generation-rpc.schema.ts` at 18:00).
Timeline (local, +03:00):

| time                | event                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17:57               | peer creates `wizard-generation-run.controller.ts`                                                                                                      |
| 18:00:11            | I write `wizard-generation-rpc.schema.ts`                                                                                                               |
| 18:00:17 / 18:00:31 | peer appends `formatIssue` to that schema and overwrites the handler with its own version                                                               |
| 18:03               | I create `wizard-generation-checkpoint.service.ts`, `wizard-generation-run.supervisor.ts`; my `Write` of the handler is refused ("modified since read") |
| ~18:07              | I message the peer (SendMessage, `notify_when_idle`) proposing a split and stating I would not touch the handler until it replied                       |
| 18:08:28 / 18:08:31 | peer removes its `formatIssue`, restores the handler to HEAD, and deletes its controller file                                                           |
| 18:14 → 18:20       | I take the trio back: handler, schema (`formatIssue` re-added — mine), handler spec                                                                     |

No file in the batch's ownership list currently contains any of the peer's
content (`grep -l "ulid\|WizardGenerationRunController"` over the handlers
directory returns nothing). No idle notice or reply from the peer has arrived
as of writing. **The orchestrator should make sure only one executor is ever
spawned per batch**; the file-disjoint rule assumes it.

## 1. Files changed

### Modified (all in the Batch 3 ownership list)

| file                                                                                | why                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts`                    | Was an intentional empty stub. Now holds the Zod DTOs for `wizard:deep-analyze` (+`resume`), `wizard:get-resumable-run`, `wizard:list-analyses`, `wizard:load-analysis`, `wizard:install-pack-agents`.                                                                                                                                                                                                       |
| `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`                  | Parses every wizard DTO with Zod (`parse()` → `RpcUserError('INVALID_PARAMS')`); forwards `resume` to `MultiPhaseAnalysisService`; answers with `AnalysisStorageService.toResponse()` (fixes the v3-manifest shape the old inline response no longer satisfied); adds `wizard:get-resumable-run` to `METHODS`, `register()` and as a read-only handler; extracts `readCompletedPhases()` shared by both.     |
| `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.schema.ts`         | Was an empty stub. Now holds the Zod DTOs for all six `enhancedPrompts:*` methods plus `describeEnhancedPromptsParamsIssue()` (schema failure → the handler's historical structured error strings, no raw Zod text).                                                                                                                                                                                         |
| `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`       | Every method parses via Zod; `runWizard`/`regenerate` (the two disk-writing paths) require `isAuthorizedWorkspace`; an inbound `analysisDir` is canonicalized with `AnalysisStorageService.resolveAuthorizedAnalysisDir` and rejected when outside `<workspace>/.ptah/analysis` before the service (and its trace writer) is reached. `AnalysisStorageService` is now a constructor dependency (position 3). |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.ts`        | Was an empty stub. Agent-id safe-token schema, submit/cancel/retry DTOs, `formatIssue()`. `analysisData` reuses the checkpoint's `ProjectAnalysisResultSchema` with `.catch(undefined)` (see §4).                                                                                                                                                                                                            |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`      | Rewritten around two injected collaborators (facade rule: class name, DI token and the three method signatures unchanged). Zod at the boundary, checkpoint written before launch, resume path, one owned run, propagation on `writtenCount > 0`, retry through the same run/checkpoint path. All `generatedCount` uses gone.                                                                                 |
| `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`             | Registration list + `METHODS` assertion; Zod rejection specs; `wizard:get-resumable-run` specs (no workspace, no run, paused analysis + timed-out generation DTO, slug-less checkpoint); resume-flag forwarding; storage mock gains `toResponse`, fixture bumped to v3.                                                                                                                                      |
| `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.spec.ts`               | Replaced the "empty module" assertion with schema specs.                                                                                                                                                                                                                                                                                                                                                     |
| `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts`  | Harness gains the storage mock + ctor arg; `runWizard`/`regenerate` happy paths use the authorized root; new specs for unauthorized workspace, out-of-root `analysisDir`, canonical in-root `analysisDir` pass-through, malformed `analysisData`.                                                                                                                                                            |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts` | Rewritten to drive the real collaborators over an in-memory storage fake: boundary, checkpoint-before-launch, watchdog (fake timers), cancel-as-pause, resume (skip/normalize/carry-over/untrusted/nothing-left), retry.                                                                                                                                                                                     |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.spec.ts`   | Replaced the "empty module" assertion with schema specs (+ the `import.meta` jest.mock guard).                                                                                                                                                                                                                                                                                                               |
| `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`                           | Added the dual-registration proof for `wizard:get-resumable-run`: shared registry, `setup` manifest ownership, existing `wizard:` prefix.                                                                                                                                                                                                                                                                    |

### Created (NOT in the ownership list — required by the facade rule)

The handler was already 898 lines before this batch and the batch adds Zod,
resume and checkpoint work. The hard rule says to extract a named collaborator
rather than grow it. Two collaborators, both `@injectable()`, resolved by
class token (`@inject(GenerationCheckpointService)` — same idiom as
`@inject(SkillsShSourceRootService)` in `skills-sh-rpc.handlers.ts`), so no
manifest / `expected-resolvable.ts` change is needed:

| file                                                                                 | concern                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts` | `GenerationCheckpointService` — run-level checkpoint decisions over `AnalysisStorageService` (resolved lazily from the container like every other agent-generation service in these handlers): `createFresh`, `locateResumable`, `isTrusted`, `prepareResume`, `recordOutcome`, `finalize`, plus the pure `toResumableGenerationRun` DTO mapper shared with `SetupRpcHandlers`. |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.ts`     | `GenerationRunSupervisor` — the single active run: owned `AbortController`, unref'd watchdog, await-until-settled, `onSettled` hook (checkpoint finalize + propagation), exactly one `broadcastCompletion`, and the pure `buildCompletePayload`.                                                                                                                                |

Both are covered through `wizard-generation-rpc.handlers.spec.ts` (they run
un-mocked there); they have no dedicated spec files.

### Not touched (verified)

- `libs/shared/**`, `libs/backend/agent-generation/**` — read only. `git diff --stat` on them shows only the user's pre-existing unrelated edits.
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` — unchanged; `'wizard:'` is at line 60 of `ALLOWED_METHOD_PREFIXES`.
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` — not in my list and did not need editing: the `setup` entry already reads `SetupRpcHandlers.METHODS`, so adding the method to the tuple is the manifest change. Pinned by `rpc-allowlist.spec.ts:112`.

## 2. Acceptance criteria → evidence

Paths below are relative to `libs/backend/rpc-handlers/src/lib/`.

| criterion                                                                                                                                                                                            | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| `SetupRpcHandlers` validates resume/query DTOs with Zod                                                                                                                                              | `handlers/setup-rpc.schema.ts:18-38`; `handlers/setup-rpc.handlers.ts:179` (`parse` → `INVALID_PARAMS`), `:279`, `:413`, `:758`, `:794`, `:860`. Spec: `setup-rpc.handlers.spec.ts:363` (`Zod parameter validation`).                                                                                                                                                                                                                                                                                         |
| … registers `wizard:get-resumable-run`                                                                                                                                                               | `handlers/setup-rpc.handlers.ts:92` (`METHODS`), `:408-452` (handler). Spec: `setup-rpc.handlers.spec.ts:354`, `rpc-allowlist.spec.ts:112`.                                                                                                                                                                                                                                                                                                                                                                   |
| … owns analysis resume/cancel                                                                                                                                                                        | resume flag forwarded at `setup-rpc.handlers.ts:350`; `wizard:cancel-analysis` unchanged (service's `cancelAnalysis` is now a pause per Batch 2). Spec: `setup-rpc.handlers.spec.ts:1560` (`[resume-flag]`).                                                                                                                                                                                                                                                                                                  |
| … returns a read-only latest resumable analysis plus optional generation DTO                                                                                                                         | `setup-rpc.handlers.ts:427-447` (`findLatestResumableRun` → `toResponse` over completed phases only → `toResumableGenerationRun`); DTO mapper `wizard-generation-checkpoint.service.ts:73`. Spec: `setup-rpc.handlers.spec.ts:402` block (asserts only the completed phase is read and nothing is written).                                                                                                                                                                                                   |
| Generation handler validates submit/resume/cancel inputs with Zod                                                                                                                                    | `handlers/wizard-generation-rpc.schema.ts:24-56`; `wizard-generation-rpc.handlers.ts:855` (`parse`), used by all three methods. Spec: `wizard-generation-rpc.handlers.spec.ts:649`, cancel/retry `INVALID_PARAMS` specs; `wizard-generation-rpc.schema.spec.ts`.                                                                                                                                                                                                                                              |
| … creates/updates the generation manifest before and after each terminal outcome                                                                                                                     | before: `wizard-generation-rpc.handlers.ts:220` → `checkpoint.service.ts:123` (`createFresh` writes, throws on failure → no launch); after each outcome: `handlers.ts:648` → `checkpoint.service.ts:287` (`recordOutcome`, throws when the manifest is unreadable so the orchestrator stops); terminal lifecycle: `checkpoint.service.ts:320` (`finalize`). Spec: `handlers.spec.ts:747`, `:859`, `:933`.                                                                                                     |
| … canonicalizes authorized analysis directories                                                                                                                                                      | `handlers.ts:657-670` (`authorizeAnalysisDir` → `RpcUserError('UNAUTHORIZED_WORKSPACE')`), storage's `resolveAuthorizedAnalysisDir` via `checkpoint.service.ts`. Spec: `handlers.spec.ts:677`.                                                                                                                                                                                                                                                                                                                |
| … resumes only pending/running/failed agent work, skipping written/unchanged                                                                                                                         | `checkpoint.service.ts:69` (`RESUMABLE_STATUSES`), `:238-275` (`prepareResume`: stale `running` → `pending`, written/unchanged carried over). Spec: `handlers.spec.ts:1129`, `:1244`.                                                                                                                                                                                                                                                                                                                         |
| One handler-owned controller replaces the detached watchdog race; watchdog or cancel aborts work, waits for the settled summary, emits exactly one completion payload derived from explicit outcomes | `wizard-generation-run.supervisor.ts:200-279` (`run`: one `AbortController`, watchdog at `:208-212` aborts with `generation_timeout`, orchestrator awaited at `:226` with the signal, single broadcast at `:273`, active flag cleared at `:277` only after that); `:187` (`abort`); payload from outcomes at `:127-166`. Cancel: `handlers.ts:387`. Spec: `handlers.spec.ts:1004` (fake-timer watchdog: signal aborted with `generation_timeout`, one broadcast, `success:false`, `writtenCount:1`), `:1047`. |
| Propagation runs after settlement whenever `writtenCount > 0`, including partial timeout/pause and targeted retry; failure stays warning-only                                                        | `handlers.ts:358` (`afterSettled`, runs inside the supervisor's `onSettled` before the broadcast), retry via the same `afterSettled` at `:498-515`; `propagateGeneratedAgents` unchanged try/catch warn. Spec: `:1004` (timed-out run propagates once), `:1047` (paused run propagates once), `:859`, retry specs (`does not propagate a retry that wrote nothing`, `:1477`).                                                                                                                                 |
| Concurrent submit/resume cannot replace an active controller or mutate the active run's manifest; active state clears only after settlement                                                          | `handlers.ts:188`, `:462` (`runs.isActive` guards before any write); supervisor `run()` throws if already active; `:277` clears in `finally` after broadcast. Spec: `:1047` asserts a submit is still rejected after cancel until the orchestrator settles, and that `writeGenerationManifest` was called once.                                                                                                                                                                                               |
| Enhanced-prompt RPC validation rejects an analysis directory outside the authorized workspace `.ptah/analysis` root before the trace writer is reached                                               | `handlers/enhanced-prompts-rpc.handlers.ts:225` (workspace must be authorized), `:235` + `:757-779` (`authorizeAnalysisDir`). Spec: `enhanced-prompts-rpc.handlers.spec.ts:469`, `:486`, `:508`.                                                                                                                                                                                                                                                                                                              |
| Specs prove Zod rejection, shared registry/handler ownership, existing `wizard:` prefix acceptance, terminal-file skipping, timeout propagation once, cancel-as-pause, unauthorized-path rejection   | Zod: `setup-rpc.handlers.spec.ts:363`, `wizard-generation-rpc.handlers.spec.ts:649`, both schema specs. Registry/ownership/prefix: `rpc-allowlist.spec.ts:112-133`. Terminal-file skipping: `handlers.spec.ts:1129`, `:1244`. Timeout propagation once: `:1004`. Cancel-as-pause: `:1047`. Unauthorized path: `:677`, `:1222`, `enhanced-prompts-rpc.handlers.spec.ts:486`.                                                                                                                                   |
| Batch verification: setup-handler static manifest exposes the method; no handler imports a platform adapter or agent-generation internal service                                                     | `setup-rpc.handlers.ts:92`; all agent-generation imports are from the package root (`AGENT_GENERATION_TOKENS`, `AnalysisStorageService`, `ProjectAnalysisResultSchema`, types); no `platform-vscode                                                                                                                                                                                                                                                                                                           | electron | cli` import anywhere in the touched files. |

## 3. Verification output

Command: `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/shared`
(output piped through `grep` for the summary lines; the 18 lint warnings are
all pre-existing `max-lines` / `no-unused-vars` warnings in files this batch
did not create — `wizard-generation-rpc.handlers.ts` is NOT among them, i.e.
it is under the 700-line effective ceiling):

```
 NX   Running targets typecheck, lint for 2 projects:
✖ 18 problems (0 errors, 18 warnings)
 NX   Successfully ran targets typecheck, lint for 2 projects
```

Command: `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/shared`
(same filtering; both projects ran — "Running target test for 2 projects"):

```
 NX   Running target test for 2 projects:
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
Test Suites: 49 passed, 49 total
Tests:       1216 passed, 1216 total
Snapshots:   0 total
Time:        25.492 s
Test Suites: 91 passed, 91 total
Tests:       31 skipped, 2612 passed, 2643 total
Snapshots:   0 total
Time:        32.428 s, estimated 57 s
 NX   Successfully ran target test for 2 projects
```

(First block = `@ptah-extension/shared`, second = `@ptah-extension/rpc-handlers`.)

The "worker process has failed to exit gracefully" line: I ran my four
handler/allowlist specs alone with `--detectOpenHandles`
(`npx jest --config libs/backend/rpc-handlers/jest.config.ts --detectOpenHandles <4 files>`):

```
Test Suites: 4 passed, 4 total
Tests:       114 passed, 114 total
```

with no open-handle report, so the leak is not in this batch's specs (the
`TASK_2026_320` `hasRef()` assertion also still passes). The worktree also
carries the user's uncommitted edits to `session-rpc.handlers*.ts` and
`chat-stream-broadcaster*.ts`; I did not investigate those.

## 4. Deviations, judgment calls, and things the orchestrator should know

1. **`analysisData` on `wizard:submit-selection` is validated with `.catch(undefined)`, not rejected.** `apps/ptah-cli/src/cli/commands/setup.ts:228` sends the whole `MultiPhaseAnalysisResponse` in that field (a Batch 6 clean-up item: `analysisData: analysisResult`). A strict schema would have made `ptah setup` fail with `INVALID_PARAMS` until Batch 6 lands. With `.catch`, a non-`ProjectAnalysisResult` is dropped (warn logged at `handlers.ts` "ignored analysisData…"), the orchestrator analyzes the workspace itself, and `analysisDir` still drives generation — which is more correct than the previous behaviour of feeding that object into the pipeline typed as a `ProjectAnalysisResult`. The value that IS accepted is validated by the very schema the checkpoint re-validates on resume (`ProjectAnalysisResultSchema` from the agent-generation barrel), so nothing persisted can fail to reload. `enhancedPrompts:runWizard` keeps strict rejection (`Invalid analysis data`) because no caller sends the wrong shape there.
2. **Carried-over agents are reported as `unchanged` in a resumed run's payload** while their checkpoint records keep the status the earlier run recorded. This invocation wrote nothing for them and their file is already current; the UI's "already current" label (Batch 4) is the truthful reading. Counts in the payload include them; `writtenCount` (the propagation trigger) counts only this invocation's writes.
3. **`wizard:cancel` response**: when a run was aborted, `progressSaved` is `true` regardless of `saveProgress` (the checkpoint is always kept). With no run and no session the response is unchanged (`{ cancelled: false }`).
4. **`enhancedPrompts:runWizard` / `regenerate` now require an authorized workspace** (`isAuthorizedWorkspace`), not only an authorized `analysisDir` — the criterion says "authorized workspace `.ptah/analysis` root", and both methods write the enhanced-prompt trace under that workspace. `getStatus`/`setEnabled`/`getPromptContent`/`download` are unchanged in that respect (pre-existing gap, flagged, out of this batch's scope).
5. **`setup-rpc.handlers.ts` is 1355 lines (lint-effective 1141) and was 1272 before this batch.** The pre-existing overage is the ~370-line memory-seeding content-builder block; splitting it is a separate refactor I did not take on. `enhanced-prompts-rpc.handlers.ts` is 794 physical lines (lint-effective under 700; no warning).
6. **`GenerationCheckpointService` resolves `AnalysisStorageService` lazily from the container** (the handlers' existing posture for every agent-generation service) rather than injecting it, so a host that lacks agent-generation still constructs the handler. `EnhancedPromptsRpcHandlers` injects it directly because it already injects `EnhancedPromptsService` from the same registration function.
7. Dropped the unused `CliDetectionService` value import from the generation handler (it was imported and never referenced).

## 5. Criteria not met

None that I know of. Everything in §2 has code and a passing spec behind it.
Two limits worth stating plainly: the new collaborators have no spec files of
their own (covered only through the handler spec), and no spec exercises the
Electron/VS Code composition roots resolving `WizardGenerationRpcHandlers`
with its two new class-token dependencies — that resolution path is the same
one `SkillsShRpcHandlers` already relies on, but it was not executed here.
