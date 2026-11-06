# Implementation Plan - TASK_2026_878_5513

Revision: 3

Make the three Memory & Skills actions (Run curator now, Code index Re-index, Harvest now) report
running state, results and errors; fix the curator's Codex refusal and skill reconciliation; write
a developer evaluation guide. Source state: HEAD 7e0b461c8, worktree
`/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions`.

## Revision 3 changes

| Review finding | Change in this revision |
| --- | --- |
| F5 (Serious) background run joining is asymmetric | A census registry inside `IndexingControlService` (P12, component 5) replaces the one-way "manual marks background joined" flag. Manual `start()` and `trackBackgroundRun` both join one record per normalized workspace root before they call the indexer, whatever the start order. The record settles once, when its last participant releases: exactly one `lastRun` write and at most one `INDEXING_COMPLETE`/`INDEXING_FAILED` push per census. Progress is deduplicated per record, and the origin stays the first joiner's. B2 tests now cover manual→watcher (success and failure), background→background (success and failure), background→manual (success), a new census after the record closes, and a joiner cancel. Each test counts `lastRun` writes and pushes. The B2 file list is unchanged (no new file); the B2 test list changes. Nothing else in the plan changed. |

## Revision 2 changes

| Review finding / ruling | Change in this revision |
| --- | --- |
| F1 (Serious) classification too broad | `provider-unsupported` now requires the deliberate refusal: `AuthRequiredError` with `providerId === 'openai-codex'` AND the exact refusal message, through one predicate `isCodexNativeRuntimeRefusal` in agent-sdk (P8). The message constant moves into agent-sdk; auth-providers re-exports it. Ordinary `AuthRequiredError` keeps today's behaviour (`failed`, bounded retries) and gets its own reason code `auth-required`. Tests for both kinds on the pinned, inherited and runner paths (component 1, B1 tests). |
| F2 (Serious) raw causes on the wire | No raw cause, provider text or `detail` crosses the wire. A fixed backend message table keyed by reason code (P9) is the only source of `error` text in `MemoryRunNowResult`, `lastRunStats` and curator events. Causes go only to backend logs. The runNow thrown branch and the three existing `kind:'error'` pushes are sanitized. The port's stalled arm no longer gains `detail`. Sentinel-secret tests added (component 2, B1 tests). |
| F3 (Serious) cross-workspace grade overwrite | No migration for grades. Concrete guard (P10): `SkillTaskGradeStore.upsert` updates a conflicting row only when it has the same normalized workspace root or a NULL (legacy) root, and reports a refused write; `hasGradeForTask` becomes workspace-scoped; `reconcileTaskEvents` uses a guarded `UPDATE … AND reconciled_at IS NULL`. Two-workspace marker-upgrade test added (component 8, B3 tests). |
| F4 (Moderate) evidence wording | Evidence rows 1 and 4 now say `AuthRequiredError` is the general missing/expired-auth error and the Codex refusal is one provider-specific instance of it. |
| Ruling: boot/watcher censuses in running state (decision 14) | `IndexingControlService.trackBackgroundRun` wraps every lifecycle full run (boot and watcher). Status reports `running.origin:'background'` with progress; a click during a background census reports `running.joinedBackground:true`; settle pushes complete or failed (P11, components 5-6). |
| Ruling: P5 persistence | Persist the last run summary in a new nullable column `indexing_state.last_run_json`, added by migration `0066_indexing_last_run` in `@ptah-extension/persistence-sqlite` (P5, component 5). |
| Ruling: P3, P4 | Recorded as orchestrator-accepted (decision 15). |
| Batches | Old B1 split into curator backend (B1) and indexing backend (B2, now with persistence-sqlite). New names B1-B7, file lists and verify commands updated. |

## Inputs and constraints

- Requirements used: `context.md`, `decisions.md` (binding 7-15), `research-memory-curator.md`, `research-code-index.md`, `research-skills-harvest.md`, `research-root-causes.md`, `implementation-plan-review.md` (round 1, REVISE), the spawn prompt scope 1-6.
- Corrections applied: research's chat-adapter theory is superseded by `research-root-causes.md` A1-A2 (the throw is `ProviderAuthResolver.resolve`). Added here: the query runner throws the same refusal on the ride-active path (`sdk-query-runner.service.ts:352-360`).
- Design handoff used: none (no design-spec). UI copy below is the spec.
- Out of scope (decisions 7/8/10): `libs/backend/lane-routing`, `libs/backend/lane-outcomes`, subagent outcome recording, census performance, carrier-less folders, native Codex one-shot (TASK_2026_880_76af). `skill-task-grade.store.ts` keeps its read-only join on `lane_outcome_records` unchanged; only `upsert` and `hasGradeForTask` change.
- Hosts: this repo has no VS Code or TUI app (`apps/` = ptah-docs, ptah-electron, ptah-electron-e2e, ptah-extension-webview, landing page). Every changed wire field is optional, so older hosts stay compatible. The benchmark CLI (`cli-engine/src/lib/bootstrap/thoth-runtime.ts:257-264`) only reads `IndexingControlService.getStatus().memoryEnabled`; migration 0066 is additive.

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| `AuthRequiredError` is the general "auth missing or expired" error; the Codex refusal is one provider-specific instance, built by `codexNativeRuntimeRequired()` with `providerId:'openai-codex'` and the fixed message `CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` | `agent-sdk/src/lib/errors/auth-required.error.ts:1-34`; `auth-providers/src/lib/auth/codex-native-runtime-refusal.ts:4-5,18-25` | classify only error + provider id + exact message |
| Other `AuthRequiredError`s can carry `providerId:'openai-codex'` with a different message (not-ready, stored-provider mismatch) | `workspace-provider-profile-resolver.ts:410-425,546-553` | provider id alone is not enough |
| Resolver refuses Codex for every one-shot, including `''` when active is Codex | `provider-auth-resolver.ts:157-167`; also `:559-561`, `curator-proxy-manager.ts:66-67` | pinned path |
| Inherit path rethrows any `AuthRequiredError` with Codex provider id | `workspace-llm-resolver.ts:95-103` | inherited path must use the predicate |
| Query runner throws the refusal with the same literal message on the ride-active path | `agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:352-360` | runner path; use the shared constant |
| Curator matches resolver errors by `name` because those classes live in auth-providers; `AuthRequiredError` lives in agent-sdk itself | `sdk-internal-query.curator-llm.ts:58-90`; `agent-sdk/src/index.ts:168-175` | the predicate can live in agent-sdk without a cycle |
| Curator auth decision: quota stalls, `ProviderAuthError` rides active, everything else rethrown; outer catch wraps into `CuratorLlmQueryError` | `sdk-internal-query.curator-llm.ts:244-278,286-306,597-615` | ordinary auth errors become `failed` today |
| Port stall union and stalled arm | `memory-contracts/src/lib/curator-llm.port.ts:49-51,99-104` | add `'provider-unsupported'`; no `detail` |
| Stall keeps input; failed retries 3x then drops it | `curator-activity-log.ts:20-55`, `memory-trigger.service.ts:981-1010` | unsupported = stalled |
| `recordStall` never touches last-run; `recordError` pushes `memory extraction failed: <raw detail>` | `curator-activity-log.ts:222-247,342-383` | sanitize; reason codes |
| Other raw-message pushes: trigger curate failure, boot-scan failure, `curate()` failure | `memory-trigger.service.ts:1024-1036,1202-1209`; `memory-curator.service.ts:324-330` | sanitize the same way |
| runNow returns `success:true` for `failed`; thrown branch returns raw `err.message`; diagnostics drops `outcome` and forwards event `error` as-is | `memory-rpc.handlers.ts:699-741,584-597` | contract change below |
| Renderer ignores the `runNow` body; `refresh()` clears `_error` every 30 s poll | `memory-diagnostics-state.service.ts:177-213,155-175` | separate `lastManualRun` signal |
| Feed shows any `rate-limited` as "Rate limit reached"; `manual-run` always green | `event-feed.component.ts:172-187,189-200` | outcome-aware tone and text |
| Only curator picker: Settings background roles; registry + extras, no filter | `chat/.../provider-consumer-assignments.component.ts:246-256,596-603`; `ui/.../provider-model-picker.component.ts:429,459-475`; `provider-consumer-rows.ts:221-256,292-334` | `excludedProviders` plus blocking readiness |
| e2e fixture pins Codex | `webview-e2e-harness/.../settings/settings.fixtures.ts:269-277` | change the fixture |
| Controller set before awaits outside `try`; silent dedupe; debug-only error; no failure push | `indexing-control.service.ts:321-408` | stuck-state fix and failure event |
| State never `indexing`; `runSymbols` returns void; progress broadcast in boot code | `indexing-control.service.ts:73-82,106-118`; `boot-thoth-runtime.ts:463-512` | `running`, `lastRun`, stats, one progress owner |
| Boot already resolves `IndexingControlService` | `boot-thoth-runtime.ts:244-256` | boot can route lifecycle runs through it |
| Boot and watcher full runs both go through `WorkspaceIndexLifecycleService.requestFullRun` → `indexer.indexWorkspace` (no `onProgress`); the indexer adapter is built in boot | `workspace-index-lifecycle.ts:134-148,365-394`; `boot-thoth-runtime.ts:519-545` | one wrap point covers both |
| Indexer keeps one census per root; a click joins it and adds its progress listener | `code-symbol-indexer.service.ts:554-584,703-790` | joined runs get progress from the next batch |
| Indexer returns stats | `code-symbol-indexer.service.ts:86-91` | `{filesScanned,symbolsIndexed,errors,durationMs}` |
| `indexing_state` has no run-summary column; written only through `upsertRow` | `persistence-sqlite/.../0012_indexing_state.ts:5-17`; `indexing-control.service.ts:84-94,602-670` | additive column |
| Migration convention: static SQL, one bare `ALTER … ADD COLUMN`, registered in `index.ts`; latest is 65; eight specs hard-assert max version 65 | `0064_lane_outcome_task_kind_source.ts:1-7`; `migrations/index.ts:460-465`; `0042,0045,0047,0054,0055,0056,0063,0065 *.spec.ts` (grep `toBe(65)`) | bump those assertions |
| `indexing:start` refusals carry no reason; fire-and-forget | `indexing-rpc.handlers.ts:139-171,191-217` | add `reason` |
| Renderer ignores `accepted`; progress hidden in `indexed`/`stale` | `workspace-indexing.service.ts:91-155,209-217` | uiState and action-error changes |
| Push types: constants, union, payload map; `indexing:` names pass the host-source guard | `message-constants.ts:268-271`, `message-type.ts:104-105`, `payload-map.ts:456-457`; `host-source-registry.contract.spec.ts:17-18` | `indexing:failed` needs no baseline change |
| Back-office activity handles progress and complete only | `core/.../back-office-activity.service.ts:113-122,229-232,461-496` | add failed |
| Rebuild returns `{false,false}` on error; shared `loading` | `memory-rpc.handlers.ts:356-371`; `memory-state.service.ts:277-286`; `memory-curator-tab.component.ts:137-147,555` | rethrow; own busy signal |
| Harvest: batch-only reconcile, skipped when a marker exists, info log only if harvested>0 | `spec-harvester.service.ts:84,104-158` | task-level reconcile, MARKER_VERSION 3 |
| Batch executor parse misses current format | `spec-extractor.ts:156-170`; research B2 | no longer the reconcile key |
| Verdict regex misses bold values; name filter misses suffixed reviews | `spec-extractor.ts:109,257` (33 real bold-value files) | why grades stay near-empty |
| Grades skip conflicting sibling verdicts | `spec-harvester.service.ts:171-187` | latest wins |
| Grade PK omits workspace root; upsert overwrites `workspace_root` on conflict | `0056_skill_nullable_grades.ts:50-64`; `skill-task-grade.store.ts:112-131` | guard the conflict update |
| Attribution keys are `run:<run_id>` / `event:<ulid>` taken only from rows of the harvested workspace; `removeAbsent` is workspace-scoped | `skill-task-grade.store.ts:134-185`; `skill-invocation-event.store.ts:88` (ulid) | collisions need a shared key, so a guard suffices |
| `hasGradeForTask` ignores workspace and feeds findings selection | `skill-task-grade.store.ts:188-193`; `spec-harvester.service.ts:303-310` | scope by workspace |
| `applyReconciliation` updates by id with no `reconciled_at` guard | `skill-invocation-event.store.ts:244-271` | new method guards its own UPDATE |
| Only caller of `reconcileSubagentEvent` is the harvester | `skill-invocation-event.store.ts:196-244`; grep | replace it |
| Auto-harvest failure logged at debug; debounce 90 s | `skill-trigger.service.ts:23,154-163` | warn |
| Harvest handler returns the service result unchanged | `skills-synthesis-rpc.handlers.ts:1114-1127` | new fields flow through |
| UI discards the harvest result; error never rendered | `skill-synthesis-state.service.ts:32,234-259`; `skill-specs-control.component.ts` | signals and template |
| Developer docs area; `apps/ptah-docs` is the public site | `docs/development/electron-local-production.md`; `apps/ptah-docs/astro.config.mjs:81-85` | guide in `docs/development/` |
| Bench target and README | `tools/mcp-bench/project.json:333-346`, `tools/mcp-bench/README.md` | guide references them |

## Architecture decision

- **Chosen approach.** Keep the current RPC methods, add optional typed fields to the existing shared contracts, add one push message (`indexing:failed`), and keep every outcome classification and every user-facing error sentence in the backend. The renderer displays. The curator models the deliberate Codex refusal as a stall (`provider-unsupported`). Skill reconciliation moves from batch to task level. The indexing control service becomes the single owner of run state for manual, joined and background (boot/watcher) runs.
- **Rationale.** A stall matches the activity log's taxonomy: stalled means the input was never read (`curator-activity-log.ts:44-49`); `failed` would drop observations after 3 retries (`memory-trigger.service.ts:992-1010`). Optional fields keep older payloads decodable (`rpc-indexing.types.ts:57-80`). One message table means no code path can put a provider string on the wire.
- **Rejected alternatives.**
  - Fall back to the active provider on refusal (A5): silently changes provider and cost; decision 9 forbids it.
  - Classify unsupported as `failed`: loses observations.
  - Classify every `AuthRequiredError` as unsupported (rev 1): mislabels ordinary missing/expired auth (review F1).
  - Renderer-side copy per reason code: the copy would split between renderer and backend logs, and event-feed entries would need the same table twice.
  - New RPC methods such as `indexing:getRun`: allowlist and baseline churn, nothing over `getStatus` fields.
  - Overload `indexing:complete` with an error: consumers treat complete as success (`message-constants.ts:270`).
  - Grade every task attribution with the task verdict: inflates pass rates.
  - Grade-identity migration (workspace root in the PK): rebuilds `skill_task_grades`, and keys are already row-unique; the guard closes the overwrite at a fraction of the cost (P10).
  - Probe `indexer.isIndexing` for background runs: shows running but no progress and no settle push; the lifecycle wrap gives both.
- **Assumptions (each with its check).**
  - A1: `WebviewManager.broadcastMessage` in Electron forwards any message type, not only `BATCHABLE_STREAM_TYPES` (`apps/ptah-electron/src/ipc/ipc-bridge.ts:65-73`). Check: the non-batched branch in `ipc-bridge`.
  - A2: no other consumer reads `CuratorStallReason` exhaustively. Grep found `curator-pass-admission.ts:173-182` (equality) and `recorded-curator-llm.ts:309-315` (bench). Check: typecheck of memory-curator and mcp-bench.
  - A3: the Enhancement role also hits the resolver refusal. Not filtered here (decision 9 covers the curator). Follow-up only.
  - A4: no other branch claims migration version 66 before this lands (the peer session owns lane-outcomes, decision 7). Check at implementation and again before push: `ls libs/backend/persistence-sqlite/src/lib/migrations/` on `origin/main`; if 66 is taken, take the next free number and bump the max-version assertions to it.
  - A5: `ON CONFLICT … DO UPDATE … WHERE <false>` reports `changes === 0` in the SQLite driver used by `queue-db.test-support`. Check: the new store test asserts it.
  - A6: the manual handler and the lifecycle pass the same spelling of a workspace root. `normalizeWorkspaceRoot` folds only the drive letter, while `graphPathIdentity` folds the whole path on win32 (`platform-core/src/utils/normalize-workspace-root.ts:33-41`, `dependency-graph.service.ts:199,207-217`). If two spellings differ only in segment case on Windows, they would share one indexer census but get two control records, and that census would produce two `lastRun` writes. Check: confirm that both roots come from the workspace provider (`indexing-rpc.handlers.ts:139-171`, `boot-thoth-runtime.ts:519-545`).
- **Effect on existing code.** `reconcileSubagentEvent` and the batch reconcile loop are deleted, with the null-task time-window fallback. `parseBatchVerdicts` stays (`writeGrades` uses batch evidence). The boot-code progress broadcast moves into `IndexingControlService`. One additive migration (0066). No new DI tokens, no new RPC methods. `CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` moves from auth-providers to agent-sdk; auth-providers re-exports it under the same name. The duplicate literals in `cli-agent-runtime/.../ptah-cli-registry.ts:1639` and `routing-agent-adapter.ts:102,111,133` (a different error class) are left alone.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| P1 | Deliberate Codex refusal = stall reason `provider-unsupported`; it also updates last-run and pushes `curator-error` | stall / failed / fallback | `curator-activity-log.ts:20-55`; decision 9 | yes |
| P2 | `runNow.success` is false for a thrown error, outcome `failed`, or reason `provider-unsupported`; true for ran and transient stalls; `outcome`, `reason`, `error` present when known | always-true / outcome-only | `memory-rpc.handlers.ts:699-705` intent kept for transient gates | yes |
| P3 | Task verdict: cancelled → failed; done → latest work review by mtime (pass → succeeded, fail → failed); no work review → unreconciled; doc reviews (`plan`, `architecture`, `design-spec`, `task-description`) excluded. **Orchestrator-accepted (decision 15).** | any-reject / latest | real specs carry REVISE then APPROVED | yes |
| P4 | Reconcile all sources with `task_id = spec.taskId` and the same normalized workspace root, `reconciled_at IS NULL`; no null-task time-window fallback. **Orchestrator-accepted (decision 15).** | subagent only | decision 11; task ids repeat across repos | yes |
| P5 | Persist the last indexing run summary in `indexing_state.last_run_json` (nullable TEXT, JSON), migration 0066 | in-memory only / six typed columns / reuse `last_indexed_at`+`last_error` | the row is per workspace and already owned by the control service (`:602-670`); one bare `ALTER` matches 0064; the summary is display-only and never queried in SQL, so one JSON column beats six; existing columns cannot hold counts or outcome. Cost: eight max-version assertions 65 → 66 | yes (column unused if reverted) |
| P6 | Evaluation guide at `docs/development/memory-skills-evaluation.md` | `apps/ptah-docs` / `docs/benchmarks` | developer audience | yes |
| P7 | Unsupported-provider list is a frontend constant next to the row builder, citing the resolver | shared constant | single consumer | yes |
| P8 | Unsupported signal = `isCodexNativeRuntimeRefusal(error)`: `instanceof AuthRequiredError` (same lib) and `providerId === 'openai-codex'` and `message === CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE`. Every other `AuthRequiredError` keeps today's behaviour (`CuratorLlmQueryError` → `failed`, bounded retries) and is labelled reason `auth-required` | provider id only / add a marker field to the class | provider id alone also matches not-ready and mismatch errors (`workspace-provider-profile-resolver.ts:410-425,546-553`); all three curator-reachable refusal sites already use the exact message; a new field would change the class for one consumer | yes |
| P9 | Wire error text comes only from a fixed backend table keyed by reason code; raw causes only in logs | renderer table / raw causes (rev 1) | review F2; event feed and accordion both render `error` | yes |
| P10 | Grade overwrite guard instead of a PK migration: conflicting upsert updates only when roots match or the stored root is NULL; refused writes are logged and not counted as kept | PK migration | keys are row-unique (`run:`/`event:<ulid>`) and attributions are workspace-filtered (`skill-task-grade.store.ts:134-165`); the guard makes a collision a no-op instead of an overwrite | yes |
| P11 | Boot and watcher full runs are tracked by `IndexingControlService.trackBackgroundRun` through a wrapped lifecycle indexer adapter in boot. **Decision 14.** | exclude (rev 1) / `isIndexing` probe | `workspace-index-lifecycle.ts:365-394`; `boot-thoth-runtime.ts:244-256,519-545` | yes |
| P12 | Census registry keyed by the normalized workspace root. Manual and background calls join one record in any order; the record settles once, when its last participant releases (manual non-abort outcome, else background non-abort outcome, else `cancelled` for a manual cancel, else nothing). One `lastRun` write and at most one complete or failed push per census. Origin = first joiner. **Review F5, decision 14.** | one-way joined flag (rev 2) / settle on the first participant to finish / key by fingerprint | indexer joins any second call to the active census and shares its promise and progress listeners (`code-symbol-indexer.service.ts:542-552,565-570,746-755`); a watcher full run can start during a manual run (`workspace-index-lifecycle.ts:365-394`); the fingerprint is shared across worktrees (`workspace-fingerprint.ts:38-47`) | yes |

## Component specifications

### 1. Curator unsupported-provider classification (agent-sdk, auth-providers, memory-contracts)

- **Purpose.** Turn only the deliberate Codex refusal into a named outcome. No query is sent, and no Codex model id reaches any provider. Ordinary auth failures are untouched.
- **Responsibilities.**
  - `agent-sdk/src/lib/errors/auth-required.error.ts`: add `export const CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE = 'Codex chat requires a host with the native Codex runtime.'` and `export function isCodexNativeRuntimeRefusal(error: unknown): error is AuthRequiredError` (P8). Export both from `errors/index.ts` and `src/index.ts` (`:168-175`).
  - `sdk-query-runner.service.ts:356-359`: use the constant instead of the literal.
  - `auth-providers/.../codex-native-runtime-refusal.ts:4-5`: replace the local constant with a re-export from `@ptah-extension/agent-sdk` (same exported name; its three importers stay unchanged).
  - `curator-llm.port.ts:49-51`: add `'provider-unsupported'` to `CuratorStallReason`. The stalled arm gets no new field.
  - `sdk-internal-query.curator-llm.ts`: add `CuratorAuthDecision` arm `{kind:'unsupported-provider', providerId:'openai-codex'}` (type at `:102-110`):
    - pinned: in `resolveCuratorAuth`'s catch (`:257-276`), check the predicate first;
    - inherited: wrap `resolveForPath` in `inheritWorkspaceProvider` (`:289-291`) in a try whose catch returns the arm only for the predicate and rethrows everything else;
    - runner: add a `CuratorQueryOutcome` arm of the same shape; return it from `runQuery` at `:484-495` (before `resolveCuratorModel`, `:498`) and from the outer catch (`:597-615`) when the predicate matches, before network classification.
  - `extract` (`:342+`) maps it to `{status:'stalled', reason:'provider-unsupported', providerId}`. `resolve` treats it like `cooling-down`.
  - Log one warn with the cause: `[memory-curator] curator provider not supported for background curation; pass skipped` `{providerId, error: error.message}` (logs only).
- **Dependencies.** No new cross-lib imports in agent-sdk; auth-providers already imports `AuthRequiredError` from agent-sdk (`codex-native-runtime-refusal.ts:1`).
- **Failure behaviour.** Any other `AuthRequiredError` follows today's path: rethrown, wrapped by the outer catch into `CuratorLlmQueryError` (`:609-613`), `recordError` → `failed` with reason `auth-required` (component 2). `ProviderAuthError` still rides active.
- **Verification seam.** `sdk-internal-query.curator-llm.spec.ts` (pattern `:453`, `:480`); `auth-required.error.spec.ts` (CREATE) for the predicate; existing `codex-native-runtime-refusal`/`provider-auth-resolver` specs keep asserting the same text.
- **Files.** MODIFY `libs/backend/agent-sdk/src/lib/errors/auth-required.error.ts`, `libs/backend/agent-sdk/src/lib/errors/index.ts`, `libs/backend/agent-sdk/src/index.ts`, `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`, `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`, `libs/backend/auth-providers/src/lib/auth/codex-native-runtime-refusal.ts`, `libs/backend/memory-contracts/src/lib/curator-llm.port.ts`. CREATE `libs/backend/agent-sdk/src/lib/errors/auth-required.error.spec.ts`.

### 2. Curator outcome reporting (memory-curator, rpc-handlers, shared)

- **Purpose.** Carry outcome and reason code, with a fixed actionable sentence, from the activity log to `lastRunStats`, the `memory:runNow` result, diagnostics and curator events. Raw causes stay in logs.
- **Message table** (`curator-activity-log.ts`, exported from `memory-curator/src/index.ts`): `CuratorRunReason = CuratorStallReason | CuratorDeferralReason | 'no-output' | 'curator-error' | 'auth-required'` and `curatorRunMessage(reason): string`, a `Record<CuratorRunReason, string>` of fixed sentences, for example:
  - `provider-unsupported`: `The memory curator cannot run on OpenAI Codex. Choose another provider for Memory curator in Settings > Background model roles.`
  - `auth-required`: `The memory curator's provider is not signed in or its sign-in expired. Check it in Settings > Background model roles, then run again.`
  - `curator-error`: `The curator run failed. See the logs for details.`
  - `provider-cooling-down`, `provider-unreachable`, `no-output` and each deferral reason: one sentence each ending `Observations are kept for the next pass.`
- **Activity log** (`curator-activity-log.ts`):
  - `CuratorRunStats` (`:58-71`) gains `reason?: CuratorRunReason` and `error?: string` (always a table sentence).
  - `recordStall`, `recordNoOutput`, `recordDeferral` set both. For `provider-unsupported` only, `recordStall` also updates last-run, pushes `kind:'curator-error'` (`error` = sentence, `stats` = `{reason, providerId}`) instead of `rate-limited`, and logs warn.
  - `recordError` (`:342-383`): `reason` = `auth-required` when `error` or a `cause` (up to 3 levels) has `name === 'AuthRequiredError'`, else `curator-error`. The pushed event's `error` is the table sentence. The warn log keeps `detail` plus the cause chain messages (up to 3).
- **Other raw pushes** (sanitize with `curatorRunMessage('curator-error')`, keep the raw message in the existing log line): `memory-trigger.service.ts:1026-1031,1204-1208`, `memory-curator.service.ts:325-329`.
- **Shared** (`rpc-curator-diagnostics.types.ts`): add `MemoryCuratorRunReason` (string union mirroring `CuratorRunReason`). `MemoryRunNowResult` (`:180-188`) gains `outcome?: 'ran'|'stalled'|'failed'` and `reason?: MemoryCuratorRunReason`; `error?` is documented as a fixed sentence, never provider text. JSDoc on `lastRunStats` (`:166-168`) documents `outcome`, `reason`, `error`.
- **Handler** (`memory-rpc.handlers.ts`):
  - runNow (`:706-730`): `runStats` adds `reason`; result sets `outcome`, `reason`, `error` (from stats) and `success` per P2; `satisfies MemoryRunNowResult`.
  - thrown branch (`:731-740`): log the raw message (unchanged log line), return `error: curatorRunMessage('curator-error')`, `outcome:'failed'`, `reason:'curator-error'`.
  - diagnostics (`:584-591`): forward `outcome`, `reason`, `error` from `lastRunStats`. Event `error` (`:597`) is forwarded as today; every producer now writes table sentences.
- **Consumers of changed types.** `MemoryRunNowResult`/`MemoryDiagnosticsResult`: `memory-diagnostics-rpc.service.ts:54-66` (+ spec), handler (+ spec). `CuratorRunStats`: `memory-curator.service.ts`, `memory-trigger.service.ts`, `diagnostics.service.ts:44-53`; bench `liveness-harness.ts:209,283` (additive).
- **Failure behaviour.** Unsupported: observations kept; manual run returns `success:false` with the sentence; background passes repeat cheaply, bounded by `maxCuratesPerHour`. Ordinary auth: unchanged retry bound, now with an actionable sentence.
- **Security.** No provider message, cause, URL or credential text enters `MemoryRunNowResult`, `lastRunStats` or any `MemoryCuratorEvent.error` (sentinel tests, B1).
- **Verification seam.** CREATE `curator-activity-log.spec.ts`; extend `memory-curator.service.spec.ts`, `memory-trigger.service.spec.ts`, `memory-rpc.handlers.spec.ts`. Existing assertions on raw event text are updated to the sentences.
- **Files.** MODIFY `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts`, `libs/backend/memory-curator/src/lib/memory-curator.service.ts`, `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`, `libs/backend/memory-curator/src/index.ts`, `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`, `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`. CREATE `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.spec.ts`.

### 3. Memory diagnostics UI (memory-curator-ui)

- **Purpose.** Show the result of the click and make curator errors prominent.
- **Responsibilities.**
  - `memory-diagnostics-state.service.ts`: `lastManualRun` signal `{at, outcome, extracted, merged, created, skipped, reason, error, success}`. `runNow` (`:177-213`) stores it from the RPC body, including `success:false`. `refresh()` and the 30 s poll never clear it. An RPC transport error sets `_error` with a fixed `Could not reach the curator. Try again.` (not the transport message).
  - Accordion status line under "Run curator now" (`data-testid="manual-run-status"`), `role="alert"` when `success` is false, else `role="status"`:
    - ran, `created+merged>0`: `Learned N new, merged M (extracted X) · <time>`;
    - ran, 0: `Ran · nothing new to learn · <time>`;
    - stalled: `Did not run · <error>`; failed: `Failed · <error>`; `<error>` is the backend sentence, else `See the logs for details.`
  - Replace `formatSnapshot` (`:356-372`) with the same wording from `stats.outcome`, `stats.reason`, `stats.error`.
  - Newest `curator-error` event (newer than the last `ran`) renders as an `alert-error` block. When its `stats.reason` or the last run's `reason` is `provider-unsupported` or `auth-required`, show "Open model settings" reusing the existing navigation (`:343-349`).
  - `event-feed.component.ts`: `toneFor` gives `manual-run` with `stats.outcome === 'failed'` an error tone; `formatRateLimited` renders reason-based text instead of "Rate limit reached" when `limit` is absent.
  - "How this works" (`data-testid="curator-how-it-works"`): *The curator reads a chat session's transcript and the observations hooks captured, asks the Memory curator model to extract durable facts, and merges them with similar memories. It runs on the triggers below, at most the hourly limit; Run curator now curates the active session once. If the provider is rate-limited, unreachable or unsupported, the pass is skipped and its observations are kept for the next pass.*
- **Accessibility.** `role="status"` / `role="alert"`; the button stays keyboard reachable.
- **Verification seam.** `memory-diagnostics-state.service.spec.ts`, `memory-diagnostics-accordion.component.spec.ts`, `event-feed.component.spec.ts`.
- **Files.** MODIFY `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.ts`, `.../components/diagnostics/memory-diagnostics-accordion.component.ts`, `.../components/diagnostics/event-feed.component.ts`.

### 4. Curator provider picker exclusion (chat settings, ui, e2e fixture)

- **Purpose.** Stop offering `openai-codex` for the Memory curator role (decision 9, the only parity removal).
- **Responsibilities.**
  - `provider-consumer-rows.ts`: `CURATOR_UNSUPPORTED_PROVIDER_IDS = ['openai-codex'] as const`, citing `provider-auth-resolver.ts:165-167`. `BackgroundConsumerRow` gains `unsupportedProviders: readonly string[]` (curator: the list; enhancement: `[]`). `providerReadiness` (`:292-334`) takes the list and returns a blocking `{message:'Memory curation cannot run on <name>. Choose another provider.', setupProviderId:null}` for a listed id.
  - `provider-model-picker.component.ts`: input `excludedProviders = input<readonly string[]>([])`. `providerOptions` (`:459-475`) drops excluded ids from registry and extras, except the selected `provider()`, labelled `<name> (not supported here)`.
  - `provider-consumer-assignments.component.ts:246-256,659-666` passes the row's list to the picker and to `providerReadiness`.
  - `settings.fixtures.ts:269-277`: replace `openai-codex`/`gpt-5.6-luna` with a supported provider from `getAllAnthropicProviders()` (`provider-registry.ts:753`) or `''`.
- **Failure behaviour.** A saved unsupported value shows a blocking alert and save is refused (`:706`). Component 1 still guards the backend.
- **Verification seam.** `provider-model-picker.component.spec.ts`, `provider-consumer-rows.spec.ts`, `provider-consumer-assignments.component.spec.ts`.
- **Files.** MODIFY `libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts`, `.../provider-consumer-assignments.component.ts`, `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts`, `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts`.

### 5. Indexing control, persistence and RPC (persistence-sqlite, memory-curator, thoth-runtime, rpc-handlers, shared)

- **Purpose.** No stuck controller; one owner of run state for manual, joined and background runs; distinct refusals; a failure event; a persisted last-run summary.
- **Migration (P5).** CREATE `0066_indexing_last_run.ts`: header comment in the 0064 style, `export const sql = \`ALTER TABLE indexing_state ADD COLUMN last_run_json TEXT;\``. Register `{version: 66, name: '0066_indexing_last_run', sql}` in `migrations/index.ts`. CREATE `0066_indexing_last_run.spec.ts` (column exists and is nullable after all migrations; an existing row keeps its values). Bump `toBe(65)` → `toBe(66)` in the eight max-version specs (0042, 0045, 0047, 0054, 0055, 0056, 0063, 0065). See A4.
- **Shared** (`rpc-indexing.types.ts`):
  - `IndexingStatusWire` (`:45-87`) gains `running?: IndexingRunWire | null` = `{origin:'manual'|'background', startedAt, force, joinedBackground?, processed?, total?}` and `lastRun?: IndexingLastRunWire | null` = `{origin:'manual'|'background', outcome:'succeeded'|'failed'|'cancelled', startedAt, finishedAt, durationMs, filesScanned?, symbolsIndexed?, errors?}`. No error text in `lastRun`; the existing `errorMessage` field is unchanged.
  - `IndexingStartResult` (`:125-129`), `IndexingResumeResult` (`:143-146`) gain `reason?: 'no-workspace'|'indexer-not-ready'|'already-running'|'setup-failed'`.
  - `IndexingFailedEvent {workspaceRoot, workspaceFingerprint, failedAt, elapsedMs, origin}` (no error text).
  - `INDEXING_FAILED: 'indexing:failed'` in `message-constants.ts:268-271`, `message-type.ts:104-105`, `payload-map.ts:456-457`.
- **Control service** (`indexing-control.service.ts`):
  - `IndexingRunDeps.runSymbols` (`:76-79`) returns `Promise<IndexingRunStats | void>` (structural `{filesScanned, symbolsIndexed, errors, durationMs}`) and takes `options.onProgress(p: {filesScanned, totalFiles})`. One private `toProgressEvent` builds `IndexingProgressEvent`; one `progressHandler` broadcasts.
  - `start()` (`:321-408`): everything after the controller is set goes inside `try/finally`; `finally` clears `activeAbortController`/`activeWorkspaceFp` only when `this.activeAbortController?.signal === signal`. The same `finally` releases the run's census participation (P12) with its outcome. The manual run joins (or opens) its census record immediately before `runSymbolsIndexWithProgress` (`:358-365`), with no `await` between joining and `deps.runSymbols` (`:538-556`). A run that skips the symbols pipeline opens a closed record of its own, which nobody can join. `pause()` aborts with reason `'pause'` and `cancel()` with reason `'cancel'` (`:420-429,462-478`). Neither writes `lastRun`.
  - **Census registry (P12, Revision 3).** This is a private map inside the service. It needs no new file and no export, because it has one user.
    - *Key.* `normalizeWorkspaceRoot(workspaceRoot)`, already imported (`indexing-control.service.ts:7-10`). It is the nearest host-neutral match for the indexer's per-root census key `graphPathIdentity` (`code-symbol-indexer.service.ts:565-570`, `dependency-graph.service.ts:207-217`). The key is not the fingerprint: that comes from the git remote (`workspace-fingerprint.ts:38-47`), so two worktrees of one repository share a fingerprint but run separate censuses. A record holds `{fp, origin, startedAt, force, open, participants, lastProgress, outcomes}`. See A6.
    - *Join.* Manual `start()` and `trackBackgroundRun` both call one `joinCensus(rootKey, fp, origin, force)`. If an open record exists for the key, the caller joins it as a participant. Otherwise the caller creates the record, and the caller's origin, `startedAt` and `force` become the record's. Joining never changes `origin`. Manual→background, background→manual and background→background all join. Manual→manual is still refused before joining (`already-running`). Both callers join synchronously right before their indexer call. The indexer registers its census synchronously (`code-symbol-indexer.service.ts:565-570,703-722`), and boot's `runSymbols` calls it with no earlier `await` (`boot-thoth-runtime.ts:464-470`). So the first joiner here is also the indexer's census starter. The settle rule below does not depend on that.
    - *Close.* The first non-abort settlement of any participant's symbols phase closes the record. The record leaves the open map but stays live until its last participant releases. An abort settlement does not close it, because a joiner's abort rejects only that joiner while the census continues (`code-symbol-indexer.service.ts:542-552,746-760`). A later full run for the same root opens a new record. The indexer behaves the same way: it removes the census before that census settles (`:577-580,730-737`), so the later call starts a new census.
    - *Release.* Each participant releases exactly once with `succeeded(stats)`, `failed(error)` or `aborted(reason)`. A background participant releases when its `run` promise settles. The manual participant releases in `start()`'s `finally`, after its memory phase.
    - *Settle.* When the last participant releases, the record settles exactly once and takes its outcome from the first rule that applies:
      1. If the manual participant ended without an abort, use its outcome. It covers the memory phase the user asked for.
      2. Otherwise use the first background outcome that is not an abort. All background participants of one census share the census promise (`:746-755`), so their outcomes agree.
      3. Otherwise, if `cancel()` aborted the manual participant (reason `'cancel'`), use `cancelled` and push nothing.
      4. Otherwise record nothing. This covers a background-only abort and a pause, as Revision 2 specifies for aborts.

      The settle writes `lastRun` once, taking `origin` and `startedAt` from the record. After rule 1 or 2 it also pushes exactly one `INDEXING_COMPLETE` or `INDEXING_FAILED`, with `origin` taken from the record. On failure it logs one warn with the raw message. No other path writes `lastRun` or pushes complete or failed, so the `INDEXING_COMPLETE` broadcast in `start()` (`:384-395`) moves into the settle.
    - *Progress.* Every participant's `onProgress` goes to one handler per record. It broadcasts only when `{filesScanned, totalFiles}` differs from the record's `lastProgress`, then stores the new value. The indexer gives every listener of a census the same batch values (`:746-755`). Each batch is therefore broadcast once, however many participants there are and whichever one started the census. `running.processed` and `running.total` read `lastProgress`.
    - *Running view.* `running.origin` and `force` come from the record. `running.joinedBackground` is true when the record's origin is `background` and a manual participant is live. A root can have two live records, for example a closed manual record in its memory phase and a newer open background record. Status then shows the record with the live manual participant.
    - *Per-call row writes stay with their caller.* The manual path still writes `git_head_sha`, `last_indexed_at` and `last_error`. A census has at most one manual participant, because a second manual start is refused. Background participants write none of these columns.
  - Duplicate manual start logs info `[indexing-control] start ignored — already running`. `isRunning()` = manual run active.
  - `trackBackgroundRun<T>(workspaceRoot, run: (onProgress) => Promise<T>): Promise<T>` (P11): awaits the root's fingerprint, which never throws (`workspace-fingerprint.ts:34-70`). Then, with no further `await`, it joins the census record for the root as origin `background` (P12) and calls `run` with the record's progress handler. It returns the same resolution or rejection unchanged and releases its participation when `run` settles. It never writes `lastRun` or pushes complete or failed itself; the record's single settle does that, whichever participant started the census. It never writes `last_indexed_at` or `last_error` (their meaning is unchanged).
  - Manual run end: release the participation with `succeeded(stats)` or `failed(error)`. On error, persist `last_error` when `fp` is known (as today). On success, log info `[indexing-control] complete` with the stats. The census settle (P12) writes `lastRun`, logs the warn `[indexing-control] indexing failed` and broadcasts `INDEXING_FAILED`, each once.
  - `lastRun` is written to `last_run_json` through `upsertRow` (extend its field pick, `:604-616`) and read in `getStatus` with a hand-written guard (memory-curator has no zod); invalid JSON → `null` plus a debug log.
  - `getStatus` (`:154-235`): `state:'indexing'` plus `running` (the P12 running view) when a census record is live for the root; `lastRun` from the row.
  - No new export from `memory-curator/src/index.ts` (B1 owns that file); boot types callbacks through `IndexingRunDeps` and the method signature.
- **Boot runtime** (`boot-thoth-runtime.ts`):
  - `runSymbols` (`:463-512`) returns `indexWorkspace`'s stats and calls `options.onProgress` instead of resolving `WebviewManager`.
  - The lifecycle indexer (`:533`): when `indexingControl` (`:244-256`) is non-null, wrap `workspaceSymbolIndexFrom(symbolIndexer)` so `indexWorkspace(root, opts)` = `indexingControl.trackBackgroundRun(root, (onProgress) => adapter.indexWorkspace(root, {...opts, onProgress}))`; `reindexFile`/`deleteFileSymbols` pass through.
- **Handlers** (`indexing-rpc.handlers.ts`): `toStatusWire` (`:47-66`) maps `running`, `lastRun`. Start (`:139-171`) and resume (`:191-217`): `no-workspace`; `indexer-not-ready` when `runDeps` is null; `{accepted:false, state:'indexing', reason:'already-running'}` when `isRunning()`; `setup-failed` from the catch. A start during a background run is accepted (it joins).
- **Consumers.** `IndexingStatusWire`: `workspace-indexing.service.ts`; `chat/.../workspace-vitals.store.ts:120-129,328` (now sees `indexing` during manual and background runs, so a scan step appears; intended). `IndexingStartResult`: renderer service; e2e `hunk-apply-real-rpc.spec.ts:301-313` (unaffected). `IndexingRunDeps`: boot (+ spec `:469-528`), `indexing-rpc.handlers.spec.ts:191-291`. Back-office activity now also shows background runs via `INDEXING_PROGRESS` (intended visibility).
- **Failure behaviour.** Refusals are explicit. A runtime failure is logged at warn and pushed once per census; manual failures also persist `last_error`. When a manual starter is cancelled, a joined lifecycle run gets an `AbortError` and schedules its existing follow-up full run (`workspace-index-lifecycle.ts:381-394`). That run is a new census with its own record. A failed `last_run_json` write is logged at debug like other `upsertRow` failures (`:666-669`) and never fails the run.
- **Verification seam.** `indexing-control.service.spec.ts` (extend its fake DB for `last_run_json`, `:52`), `indexing-rpc.handlers.spec.ts`, `boot-thoth-runtime.spec.ts`, `0066_indexing_last_run.spec.ts`.
- **Files.** CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0066_indexing_last_run.ts`, `.../0066_indexing_last_run.spec.ts`. MODIFY `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`, the eight max-version specs, `libs/shared/src/lib/types/rpc/rpc-indexing.types.ts`, `libs/shared/src/lib/types/messages/message-constants.ts`, `.../message-type.ts`, `.../payload-map.ts`, `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts`, `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts`, `libs/backend/rpc-handlers/src/lib/handlers/indexing-rpc.handlers.ts`.

### 6. Indexing UI (workspace-indexing, memory-curator-ui tab and banner, core activity)

- **Service** (`workspace-indexing.service.ts`):
  - `_starting` and `_actionMessage` (`{tone:'error'|'info', text}`).
  - `start`/`resume`/`pause`/`cancel` never reject; they set `_actionMessage` on `!isSuccess()` and on `accepted:false`: `already-running` (info) `A full index is already running.`; `indexer-not-ready` `The code indexer is not ready yet. Open a workspace folder and try again.`; `no-workspace` `Open a workspace folder to index it.`; `setup-failed` `Could not start indexing. See the logs.` A start whose status comes back with `running.joinedBackground` sets info `Joined the scan already in progress. Progress appears after its next batch.`
  - `uiState` (`:91-155`): `indexing` when `status.running` is set or `progress` < 100 in any state; `processed/total` from `running` until a push arrives; indeterminate when neither is known.
  - `handledMessageTypes` (`:157-160`) adds `INDEXING_FAILED`: clear progress, `loadStatus`.
  - Expose `lastRun`, `runningOrigin`, and `isBusy` (starting, or a manual run).
- **Component** (`workspace-indexing.component.html`/`.ts`):
  - Re-index and Index-now (`:60,202,243,285`) are `[disabled]` with a spinner while `isBusy()`. During a background-only run they stay enabled (a click joins), and the header reads `Background scan in progress (startup or file changes)` with progress when known.
  - Last-run line (`data-testid="last-run-summary"`) in indexed, stale and error blocks: `Last <manual run|background scan> <time>: 3806 files, 41371 symbols, 16 errors, 2h 25m`, or `failed. See the logs for details.`
  - `_actionMessage` in `role="alert"` (error) or `role="status"` (info).
  - "How this works" (`data-testid="indexing-how-it-works"`): *Ptah parses the source files in this workspace into symbols and stores them in a local database, then keeps them current as files change. Re-index runs a full scan; on a large repository this can take a long time, and progress shows here while you can pause or cancel. If a startup or file-change scan is already running, Re-index joins it. Code search tools and memory search read this index.*
- **Memory tab** (`memory-curator-tab.component.ts:473-489`): drop `.catch(() => undefined)`; pass `indexingService.actionMessage()` to the banner (new input, `role="alert"`).
- **Back-office activity** (`back-office-activity.service.ts:113-122,229-232`): `INDEXING_FAILED` → `mapIndexingFailed` → `{source:'indexing', kind:'failed', summary:'Workspace index failed'}`. Fixed text, no host path (spec `:68`).
- **Verification seam.** `workspace-indexing.service.spec.ts`, `workspace-indexing.component.spec.ts`, `memory-curator-tab.component.spec.ts`, `back-office-activity.service.spec.ts`.
- **Files.** MODIFY `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts`, `.../workspace-indexing.component.ts`, `.../workspace-indexing.component.html`, `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts`, `.../memory-indexing-banner.component.ts`, `libs/frontend/core/src/lib/services/back-office-activity.service.ts`.

### 7. Memory search index rebuild (rpc-handlers, memory-curator-ui)

- **Handler** `memory:rebuildIndex` (`memory-rpc.handlers.ts:356-371`): on error log warn with the detail and throw `RpcUserError('Could not rebuild the memory search index. See the logs for details.', 'PERSISTENCE_UNAVAILABLE')` (`vscode-core/src/messaging/rpc-types.ts:87-95`, already imported at `:74`).
- **State** (`memory-state.service.ts:277-286`): `_rebuilding` and `_rebuildResult` (`{at, rebuiltFts, rebuiltVec}`); stop using `_loading`.
- **Tab** (`memory-curator-tab.component.ts:137-147`): label and `aria-label` `Rebuild memory search index`, busy bound to `rebuilding()`. Result: `Memory search index rebuilt (full-text: yes, vectors: yes|unavailable)`. Error through `error()`.
- **Verification seam.** `memory-rpc.handlers.spec.ts`, `memory-state.service.spec.ts`, `memory-curator-tab.component.spec.ts`.
- **Files.** MODIFY `memory-rpc.handlers.ts` (with component 2, same batch), `libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.ts`, `memory-curator-tab.component.ts` (with component 6, same batch).

### 8. Skills harvest and reconciliation backend (skill-synthesis, shared)

- **Extractor** (`spec-extractor.ts`):
  - `HarvestedSpec` (`:38-51`) gains `taskStatus: string`; `SpecReviewVerdict` (`:53-61`) gains `modifiedAt: number` (`lstat`).
  - File filter (`:257`) also matches suffixed reviews (`code-logic-review-phase-a.md`, `visual-review-home.md`, `test-report-*.md`).
  - Verdict regex (`:109`) accepts bold around value or label: `Verdict: **APPROVED**`, `**Verdict:** REVISE`, `**Verdict: REVISE**`, `Verdict: **NEEDS_REVISION**`, plus current forms.
  - Pure export `taskVerdict(spec): 'succeeded'|'failed'|null` (P3).
- **Event store** (`skill-invocation-event.store.ts`): replace `reconcileSubagentEvent` (`:196-244`) with `reconcileTaskEvents({taskId, workspaceRoot, succeeded, verdictSource, reconciledAt}): number`: select ids with `task_id = ?` and `reconciled_at IS NULL`; keep those whose `normalizeWorkspaceRoot(workspace_root)` equals the normalized root (NULL roots excluded); in one transaction run `UPDATE … SET succeeded = ?, reconciled_at = ?, verdict_source = ? WHERE id = ? AND reconciled_at IS NULL` and return the summed `changes`. `applyReconciliation` (`:244-271`) is left for its other callers. Parameterized SQL only.
- **Grade store** (`skill-task-grade.store.ts`, P10):
  - `upsert` (`:112-131`) returns `boolean`: append `WHERE skill_task_grades.workspace_root IS NULL OR skill_task_grades.workspace_root = excluded.workspace_root` to the `DO UPDATE`; return `changes > 0`. A legacy NULL-root row (0056 backfill) is adopted; a row owned by another workspace is never overwritten.
  - `hasGradeForTask(taskId, slug, kind?, workspaceRoot?)` (`:188-193`): when a root is given, add `AND workspace_root = ?` (normalized).
  - The `lane_outcome_records` join in `findAttributions` is unchanged.
- **Harvester** (`spec-harvester.service.ts`):
  - `MARKER_VERSION = 3` (`:84`).
  - Replace the batch loop (`:118-133`) with `reconcileTaskEvents` whenever `taskVerdict` is non-null, for every spec regardless of marker; it is idempotent.
  - `writeGrades` (`:171-201`): conflicting matching reviews resolve to the latest `modifiedAt` (debug log) instead of skipping. A `false` from `upsert` logs warn `[spec-harvester] grade key owned by another workspace` `{taskId, slug}` and is not added to `keep`; `removeAbsent` stays workspace-scoped (`:172-185`), so the other workspace's row is untouched.
  - `getRecentFindings` (`:303-310`) passes the specs root's workspace (`join(root,'..','..')`, as `writeGrades` does at `:162`) to `hasGradeForTask`.
  - `HarvestResult` (`:64-68`) gains `pending` and `skippedFolders` (from `readSpecs` `:356-373`, which returns the count).
  - `harvest(root?, options?: {trigger?: 'manual'|'auto'})` logs `[spec-harvester] harvest complete` at info on every run with all counts and `trigger`.
- **Trigger** (`skill-trigger.service.ts:154-163`): `{trigger:'auto'}`; failure log debug → warn.
- **Handler** (`skills-synthesis-rpc.handlers.ts:1121`): `{trigger:'manual'}`.
- **Shared** (`rpc.types.ts:2793-2797`): `SkillSynthesisHarvestSpecsResult` gains `pending?: number; skippedFolders?: number`. Consumer: `skill-synthesis-rpc.service.ts:487-497`.
- **Failure behaviour.** A store throw propagates to the handler's `report` and rethrow (`:1123-1126`) and the UI shows a fixed message (component 9). Grade failures keep the 3-attempt guard (`:134-145`).
- **Verification seam.** `spec-extractor.spec.ts`, `skill-invocation-event.store.spec.ts`, `skill-task-grade.store.spec.ts`, `spec-harvester.service.spec.ts` (real-DB describe, pattern `:519`), `spec-harvester.concurrent-attribution.spec.ts` (rewrite for task level), `skill-trigger.service.spec.ts`.
- **Files.** MODIFY `libs/backend/skill-synthesis/src/lib/spec-extractor.ts`, `.../skill-invocation-event.store.ts`, `.../skill-task-grade.store.ts`, `.../spec-harvester.service.ts`, `.../triggers/skill-trigger.service.ts`, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`, `libs/shared/src/lib/types/rpc.types.ts`.

### 9. Skills harvest UI (skill-synthesis-ui)

- **State** (`skill-synthesis-state.service.ts:234-259`): `lastHarvest` (`{at, scanned, harvested, reconciled, pending?, skippedFolders?}`) and `harvestError` signals; neither cleared by `refreshSpecs`. `harvestSpecs` sets `lastHarvest` before refreshing and sets `harvestError` to `Harvest failed. See the logs for details.` on a throw (no raw message).
- **Component** (`skill-specs-control.component.ts`):
  - `Harvesting…` with a spinner while busy.
  - Status line (`data-testid="skills-harvest-result"`, `role="status"`): `Last run <time>: <scanned> tasks scanned, <harvested> harvested, <reconciled> skill runs reconciled`, or `Nothing new to harvest` when harvested is 0, plus `<skippedFolders> folders skipped (no task.md)`.
  - `harvestError` in `role="alert"`; pending count from `specs()` with status `complete-unharvested`.
  - "How this works": *When a task in .ptah/specs is marked done or cancelled, harvest records the skill and agent runs of that task as succeeded (done, with an approving final review) or failed (cancelled, or a rejecting final review), and adds review grades to skill success rates. It runs automatically about 90 seconds after a chat turn ends; Harvest now runs it immediately. Tasks still in progress, and folders without a task.md, are not harvested.*
- **Verification seam.** `skill-specs-control.component.spec.ts`, `skill-synthesis-state.service.spec.ts`.
- **Files.** MODIFY `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts`, `.../components/skill-specs-control.component.ts`.

### 10. Developer evaluation guide (docs)

- **Purpose.** Explain how to evaluate and test the three flows without reading source.
- **Content, one section per flow:**
  - Triggers.
  - Data in `~/.ptah/state/ptah.sqlite`: `memories`, `memory_chunks`, `observation_queue`, `indexing_state` (incl. `last_run_json`), `code_symbols`, `skill_invocation_events`, `skill_task_grades`, `session_task_links`.
  - Read-only queries via `python3 -c "import sqlite3; sqlite3.connect('file:…?mode=ro', uri=True)"`: unreconciled events per task, grades per slug and workspace, newest memory `created_at`, the `indexing_state` row.
  - Log greps in `~/.config/Ptah/logs/Ptah Electron-<date>.log`: `[memory-curator] curator provider not supported`, `curator LLM run failed` (full cause here, never in the UI), `curation pass stalled`, `[indexing-control] start|complete|indexing failed|start ignored`, `[spec-harvester] harvest complete`, `grade key owned by another workspace`, `skipped N TASK_* folder(s)`.
  - Reason codes and their UI sentences (component 2 table).
  - Settings keys `memory.curatorProvider`, `memory.curatorModel`.
  - Per-project tests with `npm run verify -- -t test -p <project>`.
  - The `tools/mcp-bench` memory-skills benchmark: what it measures (offline extraction, dedup, update, retention, read-side, scope-write suites; skills rubric agreement); how to run (Nx `mcp-bench:bench-memory-skills` is build-type, only on request; unit specs via `npm run verify -- -t test -p mcp-bench`); what it cannot catch (live provider route, RPC wiring and UI feedback, harvest reconciliation, census duration).
  - Known limits: agent-tool reindex runs (`ptah.code.reindex`) are not shown as running unless a click joins them; Pause/Cancel on a joined run detaches the click, and the background scan continues and stays visible; null-task skill events are never reconciled.
- **Files.** CREATE `docs/development/memory-skills-evaluation.md`.

## Integration architecture

- **Data flow.**
  - Curator: click → `memory:runNow` → `curate({userInitiated})` → adapter decision (predicate) → stall or run → activity log (reason + table sentence; raw cause to log) → handler result → `lastManualRun`. Background passes reach `lastRunStats` → `memory:diagnostics` poll.
  - Indexing: click → `indexing:start` (refusal reason, or fire-and-forget) → control service (`running`, progress, complete or failed push, `lastRun` persisted). Boot/watcher: lifecycle → wrapped adapter → `trackBackgroundRun` → same progress, push and `lastRun` path.
  - Harvest: click → `skillSynthesis:harvestSpecs` → extract, task verdict, guarded reconcile, guarded grades, marker v3 → result → `lastHarvest`.
- **State.** In memory: curator last run, last manual run, active manual/background run records. Persisted: `indexing_state.last_error` and `last_run_json`, events and grades in SQLite, `.harvested.json` v3.
- **External boundaries.** RPC params stay Zod-validated (`memory-rpc.handlers.ts:648-670`). New SQL is parameterized; migration SQL is static. UI error text is a backend table sentence or a fixed renderer string. Activity summaries carry no host paths.
- **Failure and rollback.**
  - Every new wire field is optional; a renderer that sees none falls back to today's display.
  - The marker bump re-harvests all specs once. Event reconciliation is idempotent twice over: rows are selected with `reconciled_at IS NULL` and the UPDATE repeats the guard, so overlapping manual and auto harvests cannot double-flip. Grades cannot cross workspaces (P10). Rolling back the version leaves reconciled rows and grades valid.
  - Migration 0066 is additive; reverting code leaves an unused nullable column.
- **Observability.** Log lines in component 10: info on each harvest and indexing start/finish; warn for unsupported providers, curator failures (with full cause), indexing failures, refused grade writes.

## Architecture-level quality requirements

- **Functional.**
  - A click on any of the three buttons shows a busy state within 1 s and a result or error at completion.
  - A pinned or inherited Codex curator never dispatches a query and shows the unsupported sentence; an expired sign-in for another provider shows the `auth-required` sentence and keeps today's retry bound.
  - Re-index on an indexed workspace shows progress; a click during a boot/watcher scan shows it running and joined, with progress after the next batch.
  - A second click shows "already running".
  - Harvest reconciles events of done or cancelled tasks per P3/P4 and never changes another workspace's grades.
- **Performance.** No new timers or polls. Background runs add one progress push per batch (as manual runs do). Marker bump: one full spec re-read on the next harvest.
- **Security.** No new IPC surface. Parameterized SQL. No provider text, cause, credential or host path in any wire result or event.
- **Maintainability.** Respect eslint scope/type tags (no new projects). No new `vscode-core` imports in host-neutral libs. agent-sdk gains no import of auth-providers.
- **Testability.** One regression test per root cause, plus negative tests for F1-F3 (handoff).

## Team-leader handoff

- **Recommended executors.** B1, B2, B3: backend-developer (service, contract, migration changes). B4, B5, B6: frontend-developer (Angular signals and templates). B7: technical-content-writer (code-traced docs).
- **Complexity.** HIGH: 3 flows, 9 backend and 6 frontend projects, shared contracts, one migration, a data re-harvest.
- **Ordering.** B1 and B2 before B4 (contracts). B3 before B6. B5 is independent. B7 last. B1, B2, B3 are mutually file-disjoint (shared: `rpc-curator-diagnostics.types.ts` / `rpc-indexing.types.ts` + `messages/*` / `rpc.types.ts`; rpc-handlers: `memory-rpc.handlers.ts` / `indexing-rpc.handlers.ts` / `skills-synthesis-rpc.handlers.ts`; memory-curator: activity log, curator and trigger services, `index.ts` / control service only). B4, B5, B6 are mutually disjoint.
- **Batches and scoped verify commands.** Confirm each header says "Running target … for N projects" with the requested N. No build, serve, e2e or bench targets.
  - **B1, curator backend (components 1, 2, 7-backend).**
    `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/auth-providers,@ptah-extension/memory-contracts,@ptah-extension/memory-curator,@ptah-extension/rpc-handlers,@ptah-extension/shared,mcp-bench,ptah-electron`
  - **B2, indexing backend (component 5).**
    `npm run verify -- -p @ptah-extension/persistence-sqlite,@ptah-extension/shared,@ptah-extension/memory-curator,@ptah-extension/thoth-runtime,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron`
  - **B3, skills backend (component 8).**
    `npm run verify -- -p @ptah-extension/skill-synthesis,@ptah-extension/rpc-handlers,@ptah-extension/shared`
  - **B4, memory and indexing UI (components 3, 6, 7-frontend).**
    `npm run verify -- -p @ptah-extension/memory-curator-ui,@ptah-extension/workspace-indexing,@ptah-extension/core,@ptah-extension/chat,ptah-extension-webview` (`chat` consumes `IndexingStatusWire`).
  - **B5, provider picker (component 4).**
    `npm run verify -- -p @ptah-extension/chat,@ptah-extension/ui,@ptah-extension/webview-e2e-harness`
  - **B6, skills UI (component 9).**
    `npm run verify -- -p @ptah-extension/skill-synthesis-ui,ptah-extension-webview`
  - **B7, docs (component 10).** `npx prettier --check docs/development/memory-skills-evaluation.md`.
- **Tests per batch (✱ = root-cause or review-finding regression).**
  - **B1.**
    - `auth-required.error.spec.ts` ✱: predicate true for `codexNativeRuntimeRequired()`-shaped errors; false for `AuthRequiredError` with Codex id and another message, with another provider id and the refusal message, for a plain `Error` with the message, and for `ProviderAuthError`-named errors.
    - `sdk-internal-query.curator-llm.spec.ts` ✱, for each of pinned (`resolver.resolve` throws), inherited (`workspaceLlm.resolveForPath` throws) and runner (`internalQuery` throws):
      - refusal → `stalled/provider-unsupported`, no `detail`, `internalQuery` never called on pinned and inherited;
      - ordinary `AuthRequiredError` (`providerId:'openai-codex'` with a not-ready message, and `providerId:'anthropic'`) → `CuratorLlmQueryError` with the original as `cause`, as today.
      - `ProviderAuthError` still rides active.
    - `curator-activity-log.spec.ts` ✱: unsupported stall sets last-run, pushes `curator-error` with the table sentence and `providerId`; other stalls do not touch last-run; `recordError` with an `AuthRequiredError` cause → `reason:'auth-required'`, otherwise `curator-error`. **Sentinel:** `recordError` with a `CuratorLlmQueryError` whose cause message is `upstream 401 key=sk-SENTINEL-7f3a https://internal.example` → the sentinel appears in the warn log call and in none of: returned stats, `getLastRun`, every pushed event (JSON-stringified).
    - `memory-curator.service.spec.ts`: unsupported stall leaves stats `stalled`; the `curate()` failure event carries the fixed sentence (sentinel absent).
    - `memory-trigger.service.spec.ts`: trigger-curate and boot-scan failure events carry fixed sentences (sentinel absent).
    - `memory-rpc.handlers.spec.ts` ✱: runNow failed → `success:false`, `outcome`, `reason`, sentence; unsupported → `success:false`; ran → `success:true`; **sentinel:** curator throws an error containing the sentinel → `JSON.stringify(result)` lacks it, `error` equals the `curator-error` sentence; diagnostics carries `outcome`/`reason`/`error` and, fed a snapshot built by a real activity log after a sentinel failure, `JSON.stringify(diagnostics)` lacks it; rebuildIndex store throw → `RpcUserError`.
  - **B2.**
    - `0066_indexing_last_run.spec.ts`: column present and nullable; existing rows preserved. The eight max-version specs expect 66.
    - `indexing-control.service.spec.ts` ✱: a fingerprint throw releases the controller; duplicate start → `isRunning` true, logged; manual failure broadcasts `indexing:failed`, persists `last_error`, records `lastRun.failed`; `getStatus` reports `indexing` + `running` during a manual run and persisted `lastRun` after (survives a new service instance on the same DB); `trackBackgroundRun` alone → `running.origin:'background'`, progress broadcast, `INDEXING_COMPLETE` and `lastRun` on success, `INDEXING_FAILED` on failure, nothing on abort, rejection passed through unchanged; corrupt `last_run_json` → `lastRun:null`.
    - `indexing-control.service.spec.ts` ✱ census join (review F5). Use a fake indexer with the real join semantics. The first call creates a deferred census. A later call for the same root returns that promise and adds its `onProgress`, and a joiner's own abort rejects only that joiner. Each case counts `lastRun` writes (`upsertRow` calls that carry `last_run_json`) and `broadcastMessage` calls by type, and asserts exactly one `lastRun` write and exactly one complete or failed push:
      - manual first, watcher second, success: during the run `running.origin:'manual'` with no `joinedBackground`. One `INDEXING_PROGRESS` per batch. On settle, one `lastRun` (`origin:'manual'`, `succeeded`, stats), one `INDEXING_COMPLETE`, no `INDEXING_FAILED`. The `trackBackgroundRun` promise resolves with the same stats.
      - manual first, watcher second, failure: one `lastRun` (`origin:'manual'`, `failed`), one `INDEXING_FAILED`, no `INDEXING_COMPLETE`, one warn log, `last_error` persisted once. `trackBackgroundRun` rejects with the same error.
      - background then background (two `trackBackgroundRun` calls for one root), success: `running.origin:'background'`, one progress broadcast per batch, one `lastRun` (`origin:'background'`), one `INDEXING_COMPLETE`.
      - background then background, failure: one `lastRun` (`failed`), one `INDEXING_FAILED`, both promises reject with the error.
      - background first, manual second (existing order), success: `running.origin:'background'`, `joinedBackground:true`, one progress broadcast per batch, one `lastRun` (`origin:'background'`), one `INDEXING_COMPLETE`.
      - record closes: the manual census settles, and while the manual memory phase is still pending a watcher run starts for the same root. That run opens a new record. Totals are two `lastRun` writes and two complete pushes, one per census.
      - joiner cancel: background first, manual joins, then `cancel()`. The census continues, `running.joinedBackground` returns to false, and the run settles with one `lastRun` (`origin:'background'`, `succeeded`) and one `INDEXING_COMPLETE`. Manual first with a watcher joined, then `cancel()`: the census aborts, both participants abort, and the settle writes one `lastRun` (`cancelled`) and pushes nothing.
    - `indexing-rpc.handlers.spec.ts` ✱: `indexer-not-ready`, `no-workspace`, `already-running`, `setup-failed`; start accepted during a background run; `toStatusWire` maps the new fields.
    - `boot-thoth-runtime.spec.ts` (`:469-528`): `runSymbols` resolves the stats and calls `onProgress`; the lifecycle adapter routes `indexWorkspace` through `trackBackgroundRun` and passes `reindexFile` through.
  - **B3.**
    - `spec-extractor.spec.ts` ✱: bold verdict forms; suffixed review files; `taskVerdict` for cancelled, done + latest pass, done + latest fail (REVISE then APPROVED → succeeded), done without work review (null), doc reviews ignored.
    - `skill-invocation-event.store.spec.ts` ✱: `reconcileTaskEvents` updates all sources for the task and workspace, ignores other workspaces, NULL roots and reconciled rows, returns 0 on a second call.
    - `skill-task-grade.store.spec.ts` ✱: `upsert` of a key owned by workspace A from workspace B returns `false` and leaves A's row byte-identical; a NULL-root legacy row is adopted (returns `true`); `hasGradeForTask` with a root ignores other workspaces.
    - `spec-harvester.service.spec.ts` ✱ (real DB): a v2 marker is re-harvested; events reconciled for a done task with an approving review; info log when harvested is 0; `pending`/`skippedFolders` counted; `writeGrades` conflict resolves to the latest. **Two-workspace marker upgrade:** two spec roots each holding `TASK_2026_001` (done, approved) with a v2 marker, events and attributions in each workspace → harvest A, then B, then both again: each workspace has exactly its own grades (count per root equals its attributions, no row moved, no duplicates), each workspace's events reconciled once by its own harvest, the second round reconciles 0 and leaves grades unchanged.
    - `spec-harvester.concurrent-attribution.spec.ts`: rewritten for task level.
    - `skill-trigger.service.spec.ts`: auto-harvest failure logs warn.
  - **B4.**
    - `memory-diagnostics-state.service.spec.ts` ✱: `lastManualRun` set for failed, `success:false`, ran-zero; survives `refresh()`; a transport error shows the fixed text.
    - Accordion spec: status copy per outcome; `role="alert"` on failure; outcome-aware last run; `curator-error` block; settings button for `provider-unsupported` and `auth-required` only; how-it-works text.
    - `event-feed.component.spec.ts`: failed manual-run error tone; reason-based gate text.
    - `workspace-indexing.service.spec.ts` ✱: `running` (manual or background) or progress in `indexed` → `indexing`; refusal reasons → `actionMessage`; joined start → info message; RPC failure → error; `indexing:failed` clears progress.
    - `workspace-indexing.component.spec.ts`: buttons disabled while a manual run is busy, enabled during a background-only run; background header; last-run summary per origin; alert rendering.
    - `memory-curator-tab.component.spec.ts`, `memory-state.service.spec.ts`, `back-office-activity.service.spec.ts` as in components 6-7.
  - **B5.** Picker hides an excluded id but keeps and labels it when selected; curator row lists Codex unsupported and readiness blocks it ✱; save refused for Codex.
  - **B6.** `skill-synthesis-state.service.spec.ts` ✱: result stored; error not wiped by `refreshSpecs` and carries the fixed text. `skill-specs-control.component.spec.ts`: busy label, result line, "Nothing new to harvest", alert, how-it-works.
- **Parity note.** The only removed capability is offering `openai-codex` in the Memory curator picker (decision 9, user-approved). Also changed without losing a capability: the batch-level reconcile path and its time-window fallback (decision 11), "Rebuild index" renamed, curator event and runNow error text replaced by fixed sentences (full text stays in logs).
- **Files affected.**
  - CREATE: `libs/backend/agent-sdk/src/lib/errors/auth-required.error.spec.ts`; `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.spec.ts`; `libs/backend/persistence-sqlite/src/lib/migrations/0066_indexing_last_run.ts`; `libs/backend/persistence-sqlite/src/lib/migrations/0066_indexing_last_run.spec.ts`; `docs/development/memory-skills-evaluation.md`.
  - MODIFY, by batch:
    - B1: `agent-sdk/src/lib/errors/auth-required.error.ts`, `agent-sdk/src/lib/errors/index.ts`, `agent-sdk/src/index.ts`, `agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`, `agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`, `auth-providers/src/lib/auth/codex-native-runtime-refusal.ts`, `memory-contracts/src/lib/curator-llm.port.ts`, `memory-curator/src/lib/curator-llm/curator-activity-log.ts`, `memory-curator/src/lib/memory-curator.service.ts`, `memory-curator/src/lib/triggers/memory-trigger.service.ts`, `memory-curator/src/index.ts`, `rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`, `shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`.
    - B2: `persistence-sqlite/src/lib/migrations/index.ts`, `0042_*.spec.ts`, `0045_*.spec.ts`, `0047_*.spec.ts`, `0054_*.spec.ts`, `0055_*.spec.ts`, `0056_*.spec.ts`, `0063_*.spec.ts`, `0065_*.spec.ts` (max version), `shared/src/lib/types/rpc/rpc-indexing.types.ts`, `shared/src/lib/types/messages/{message-constants,message-type,payload-map}.ts`, `memory-curator/src/lib/control/indexing-control.service.ts`, `thoth-runtime/src/lib/boot-thoth-runtime.ts`, `rpc-handlers/src/lib/handlers/indexing-rpc.handlers.ts`.
    - B3: `skill-synthesis/src/lib/{spec-extractor,skill-invocation-event.store,skill-task-grade.store,spec-harvester.service}.ts`, `skill-synthesis/src/lib/triggers/skill-trigger.service.ts`, `rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`, `shared/src/lib/types/rpc.types.ts`.
    - B4: `memory-diagnostics-state.service.ts`, `memory-diagnostics-accordion.component.ts`, `event-feed.component.ts`, `memory-state.service.ts`, `memory-curator-tab.component.ts`, `memory-indexing-banner.component.ts`, `workspace-indexing.service.ts`, `workspace-indexing.component.{ts,html}`, `back-office-activity.service.ts`.
    - B5: `provider-consumer-rows.ts`, `provider-consumer-assignments.component.ts`, `provider-model-picker.component.ts`, `settings.fixtures.ts`.
    - B6: `skill-synthesis-state.service.ts`, `skill-specs-control.component.ts`.
  - MODIFY spec files: those named under Tests per batch, in the batch that owns their production file.
- **Verification points.**
  - Confirm A1, A2, A4 (migration number on `origin/main`), A5.
  - Re-grep for exhaustive switches on `CuratorStallReason`, `MemoryCuratorEventKind` and the new reason union after B1.
  - Grep that no `err.message`, `error.message` or `cause` value is assigned to a `pushEvent`/`push` `error` field or a `MemoryRunNowResult.error` in memory-curator and `memory-rpc.handlers.ts` after B1.
  - Confirm `IndexingStatus` (control) and `IndexingStatusWire` (shared) stay in sync through `toStatusWire`.
  - Manual Electron check after delivery (by the user): Codex curator → unsupported sentence; Re-index shows progress; app start shows a background scan running; Harvest shows counts; the guide's DB query shows `reconciled_at` set for a done task.

## Orchestrator amendments (Gate 2, user-approved 2026-11-04)

Gate 2 used both revise rounds. The user chose "amend and proceed". These amendments are binding and
take precedence over the sections above. The independent code-logic review checks them in code.

- **A-F6 (review finding 6, Serious): registry removal on final release.** When the last participant
  of a census record releases, the record MUST be removed from the open map, whatever the outcome:
  non-abort settle, all-abort, pause or cancel. The removal is identity-checked: remove only if the
  map entry for the normalized root is still this record object, so a newer record is never
  deleted. The settle rule itself is unchanged (one `lastRun` write and at most one push per census;
  pause writes no `lastRun`).
  B2 test: manual start, watcher joins, cancel (both abort). Assert the record is removed. Then a
  fresh manual start opens a NEW record with origin `manual`, and gives one `lastRun` write and one
  settle push. Add a pause variant that asserts no `lastRun` write and that the record is removed.
- **A-F7 (review finding 7, Moderate): missing failure order.** Add the B2 test background-first,
  manual-second, census fails. Assert one failed `lastRun` write, one `INDEXING_FAILED` push, origin
  `background`.
