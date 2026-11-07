# Batches - TASK_2026_878_5513

Total tasks: 49 | Batches: 19 | Complete: 0/19

Worktree (every edit, check and commit): `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions`
(branch `fix/memory-skills-dead-actions`, base `main` 7e0b461c8). Below, `W` means that absolute path.
Plan: `implementation-plan.md` Revision 3 plus the binding "Orchestrator amendments" A-F6 and A-F7
(lines 423-440). Gate 2 passed with those amendments (decisions.md rows 18-19).

## Rules every executor must follow (repeat in every lane prompt)

- Verify only with the batch's `npm run verify -- -p <projects>` command, run from `W`, output
  tailed (`2>&1 | tail -60`). Confirm the header "Running target ... for N projects" with N equal to
  the number of projects requested. Never run workspace-wide checks, `nx run-many` on projects not
  listed, positional `nx test A B`, or any `build`, `serve`, `dev`, `e2e`, `package` or bench target.
- Electron first. There is no VS Code or TUI app in this repo. The renderer is
  `apps/ptah-extension-webview`.
- Never edit: `libs/backend/lane-routing/**`, `libs/backend/lane-outcomes/**`, subagent outcome
  recording, `libs/backend/platform-core/src/file-settings-manager.ts`,
  `libs/backend/vscode-lm-tools/**/outcome-report.tool.ts` (another session owns them).
  `skill-task-grade.store.ts` keeps its read-only `lane_outcome_records` join unchanged.
- No stubs, TODO markers or placeholder logic. No git commands: the team-leader owns git.
  Do not edit `batches.md` or `task.md`. Every file a lane writes is inside `W`.
- No raw provider text, error `cause`, URL, credential or host path may reach any wire result,
  `lastRunStats`, curator event or activity summary. Raw text goes to backend logs only.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1 Electron forwards non-batched push types and keeps order — verified:
  `apps/ptah-electron/src/ipc/ipc-bridge.ts:220-226` sends non-batchable messages after
  `flushStreamQueue()`, so a queued `INDEXING_PROGRESS` cannot overtake `INDEXING_COMPLETE` or the new
  `INDEXING_FAILED`.
- A2 No exhaustive consumer of `CuratorStallReason` — verified by grep: only
  `memory-contracts/src/index.ts:16`, `curator-llm.port.ts:49,101`, `memory-curator/src/index.ts:104`,
  `curator-llm.interface.ts:7` (re-exports and one field type); no `Record<CuratorStallReason,…>`.
  Batch 2 typechecks memory-curator and mcp-bench to confirm.
- A4 Migration 0066 is free — verified on `origin/main` (fetched 2026-11-04: latest is
  `0065_ptah_review`). Peer worktree `decision-model-data-gaps` touches no migration. Re-check in
  Task 9.1 and again before push.
- A5 `ON CONFLICT … DO UPDATE … WHERE <false>` reports `changes === 0` — unverified; Task 15.2's
  store test asserts it.
- A6 Manual handler and lifecycle pass the same root spelling — unverified; Task 12.2 confirms both
  roots come from the workspace provider (`indexing-rpc.handlers.ts:139-171`,
  `boot-thoth-runtime.ts:519-545`) and records the result in its report.
- Every changed wire field is optional — checked per batch by renderer typecheck.
- `skill-synthesis-rpc.service.ts:487-497` passes `result.data` through, so the new harvest result
  fields need no change there — verified.
- `reconcileSubagentEvent` has callers only in `skill-invocation-event.store.ts`,
  `spec-harvester.service.ts` and their specs — verified by grep.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1 Plan names 8 max-version specs; 22 specs in `persistence-sqlite/src/lib/migrations/` assert `toBe(65)` (0028, 0030, 0038-0043, 0045, 0047, 0051-0056, 0059-0061, 0063-0065) | MEDIUM | Task 9.3 bumps all 22; Batch 9 is a recorded exception to the 6-file cap (mechanical one-line edits, one rollback boundary) |
| R2 Census registry (P12) leaves a stale record after an all-abort, pause or cancel (review F6) | HIGH | Task 11.2 implements A-F6 identity-checked removal on final release; Task 11.4 adds the A-F6 cancel + fresh-start and pause tests and the A-F7 background→manual failure test; Phase B review checks both in code |
| R3 Duplicate `lastRun` writes or settle pushes across join orders (review F5) | HIGH | Task 11.4 counts `lastRun` writes and pushes by type in all join-order cases (plan lines 376-387 plus A-F6, A-F7) |
| R4 `MemoryCuratorRunReason` (shared) drifts from `CuratorRunReason` (memory-curator) | MEDIUM | Task 5.2 adds a compile-time two-way assignability check in `memory-rpc.handlers.ts` |
| R5 Raw provider text or secrets reach the wire | HIGH | Sentinel tests in Tasks 3.3, 4.1, 4.2, 5.4; Phase A review greps that no `err.message`/`error.message`/`cause` is assigned to a pushed `error` or `MemoryRunNowResult.error` (plan verification point) |
| R6 Removing `reconcileSubagentEvent` in the store batch would break the harvester's batch loop between commits | MEDIUM | Batch 15 leaves the store's reconcile API alone; Batch 16 adds `reconcileTaskEvents`, deletes `reconcileSubagentEvent` and the batch loop together |
| R7 Cross-workspace grade overwrite on marker re-harvest (review F3) | HIGH | Task 15.2 guarded upsert + scoped `hasGradeForTask`; Task 16.2 two-workspace marker-upgrade test |
| R8 `IndexingStatus` (control) and `IndexingStatusWire` (shared) drift | MEDIUM | Task 12.2 maps every new field in `toStatusWire` and its spec asserts the mapping |
| R9 Peer session lands migration 66 first | LOW | Task 9.1 re-checks `origin/main`; if 66 is taken, use the next free number and bump the max-version assertions to it |
| R10 Benchmark CLI and `cli-engine` break on the control service change | LOW | Batches 11 and 12 verify `@ptah-extension/cli-engine` |
| R11 `chat` workspace vitals now see `indexing` during background runs | LOW | Intended (plan component 5 consumers); Batch 10 verifies `@ptah-extension/chat` against the new wire type |

Edge cases:

- Unsupported provider on pinned, inherited and runner paths never dispatches a query — Tasks 2.2, 2.3
- Ordinary `AuthRequiredError` with Codex id and another message stays `failed` with reason
  `auth-required` and today's retry bound — Tasks 1.2, 2.3, 3.2
- `lastManualRun` survives `refresh()` and the 30 s poll; RPC transport error shows fixed text — Task 6.1
- Duplicate manual start → `already-running`; start during a background run joins — Tasks 11.1, 12.2, 13.1
- Fingerprint throw releases the controller (no stuck "running") — Task 11.1
- Corrupt `last_run_json` → `lastRun:null` with a debug log — Task 11.1
- Joiner cancel keeps the census and its record; starter cancel aborts both and removes the record
  (A-F6) — Tasks 11.2, 11.4
- Late progress after settle cannot flip the UI back to indexing — ordering verified (A1); Task 13.1
  clears progress on `INDEXING_FAILED` as `INDEXING_COMPLETE` already does
- Saved Codex curator value is kept, labelled unsupported, blocks readiness and save — Tasks 7.1, 8.1, 8.2
- Overlapping manual and auto harvests cannot double-flip events — Task 16.1 (`reconciled_at IS NULL`
  guard in both SELECT and UPDATE)
- Null-task skill events are never reconciled (documented limit) — Tasks 16.1, 19.1

## Phases and review plan

| Phase | Batches | Phase review (after its last batch commits) |
| --- | --- | --- |
| A Curator | 1-8 | code-logic + style (new public exports: `isCodexNativeRuntimeRefusal`, `CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` from agent-sdk; `curatorRunMessage`, `CuratorRunReason` from memory-curator; `excludedProviders` input on the ui picker) |
| B Indexing | 9-14 | code-logic + style (new public `trackBackgroundRun`, `INDEXING_FAILED`, new wire types). The code-logic review must verify A-F6 and A-F7 in code |
| C Skills | 15-18 | code-logic + style (`SpecHarvesterService.harvest` signature, `SkillSynthesisHarvestSpecsResult` fields) |
| D Docs | 19 | none (docs only) |

Review family: implementation defaults to CLI lanes. The phase code-logic and style reviews then go
to the in-process `code-logic-reviewer` / `code-style-reviewer` subagents (claude family), which
differs from every CLI lane family. If any batch in a phase falls back to an in-process subagent
(claude family), that phase's review goes to a live CLI lane instead. Record implementer and
reviewer families on the phase's last batch header.

## QA and completion notes (Mode 3)

- UI changes add no new surface, so no prototype. Completion requires rendered before/after Electron
  screenshots, dark and light, of: Memory diagnostics accordion (Memory tab), Code index panel
  (workspace indexing), Skills specs panel. Also capture Settings > Background model roles (curator
  picker), which Batch 8 changes. Take "before" from the base commit 7e0b461c8 (main checkout) before
  any UI batch lands, or from a checkout of that commit. visual-reviewer runs in Electron only.
- Parity: no surface is replaced. The one removed capability (offering `openai-codex` for the Memory
  curator, decision 9) is user-approved. Also changed: batch-level reconcile path and time-window
  fallback (decision 11), "Rebuild index" label, curator error text now fixed sentences.
- Write-path trace required for: `indexing_state.last_run_json` (writer `upsertRow`, reader
  `getStatus`), `indexing_state.last_error`, `skill_invocation_events.reconciled_at/succeeded/verdict_source`,
  `skill_task_grades`, `.harvested.json` marker v3.

## Batch 1: Codex refusal predicate — IN_PROGRESS

- Recommended executor: CLI lane, TypeScript backend + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: small, self-contained error-module change in two libraries; low first-batch risk and it
  unblocks the adapter batch.
- Tasks: 4 | Depends on: none
- Phase: A Curator | Phase review: deferred to Batch 8
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/auth-providers` (N=2)

### Task 1.1: Add refusal constant and predicate, export them — IN_PROGRESS

- Files: W/libs/backend/agent-sdk/src/lib/errors/auth-required.error.ts,
  W/libs/backend/agent-sdk/src/lib/errors/index.ts, W/libs/backend/agent-sdk/src/index.ts
- Plan reference: implementation-plan.md:127-145 (component 1), P8
- Pattern to follow: existing `AuthRequiredError` in auth-required.error.ts:1-34; export block src/index.ts:168-175
- Quality requirements: `CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` holds the exact text currently in
  `auth-providers/src/lib/auth/codex-native-runtime-refusal.ts:4-5`.
  `isCodexNativeRuntimeRefusal(error: unknown): error is AuthRequiredError` is true only for an
  `AuthRequiredError` with `providerId === 'openai-codex'` AND the exact message.
- Validation notes: agent-sdk must not import auth-providers (no cycle).
- Implementation details: pure function; `instanceof AuthRequiredError` plus field checks.

### Task 1.2: CREATE predicate spec — IN_PROGRESS

- File: W/libs/backend/agent-sdk/src/lib/errors/auth-required.error.spec.ts
- Depends on: Task 1.1
- Plan reference: implementation-plan.md:367 (B1 tests, first bullet)
- Quality requirements: true for `codexNativeRuntimeRequired()`-shaped errors; false for Codex id +
  other message, other provider id + refusal message, plain `Error` with the message, and a
  `ProviderAuthError`-named error.

### Task 1.3: Query runner uses the shared constant — IN_PROGRESS

- File: W/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts
- Depends on: Task 1.1
- Plan reference: implementation-plan.md:133 (component 1), evidence row at :106
- Implementation details: replace the literal at `:356-359` with the constant; behaviour unchanged.

### Task 1.4: auth-providers re-exports the constant — IN_PROGRESS

- File: W/libs/backend/auth-providers/src/lib/auth/codex-native-runtime-refusal.ts
- Depends on: Task 1.1
- Plan reference: implementation-plan.md:134
- Quality requirements: same exported name; its three importers stay unchanged; existing
  `codex-native-runtime-refusal` and `provider-auth-resolver` specs still pass unchanged.

### Batch 1 verification

- Every listed artifact exists and contains the required work
- The batch's scoped verify command passes (header N=2), output tailed
- No per-batch review; Phase A review covers it
- Edge cases for ordinary `AuthRequiredError` covered by Task 1.2

## Batch 2: Curator adapter classification — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: port union and its only producer change together; spec is the main regression seam.
- Tasks: 3 | Depends on: Batch 1
- Phase: A Curator | Phase review: deferred to Batch 8
- Verify: `npm run verify -- -p @ptah-extension/memory-contracts,@ptah-extension/agent-sdk,@ptah-extension/memory-curator,mcp-bench` (N=4; confirms A2)

### Task 2.1: Add `provider-unsupported` stall reason — PENDING

- File: W/libs/backend/memory-contracts/src/lib/curator-llm.port.ts
- Plan reference: implementation-plan.md:135
- Quality requirements: union member only; the stalled arm gets no new field (no `detail`).

### Task 2.2: Adapter decision arm on pinned, inherited and runner paths — PENDING

- File: W/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts
- Depends on: Task 2.1
- Plan reference: implementation-plan.md:136-142
- Pattern to follow: existing `CuratorAuthDecision` arms (`:102-110`) and `cooling-down` handling in `resolve`
- Quality requirements: predicate checked first in `resolveCuratorAuth` catch (`:257-276`); inherited
  path wraps `resolveForPath` (`:289-291`) and rethrows non-matching errors; runner returns the arm
  at `:484-495` before `resolveCuratorModel` and from the outer catch (`:597-615`) before network
  classification. `extract` maps to `{status:'stalled', reason:'provider-unsupported', providerId}`.
  One warn log `[memory-curator] curator provider not supported for background curation; pass skipped`
  with `{providerId, error: error.message}` (logs only).
- Validation notes: ordinary `AuthRequiredError` still rethrown and wrapped into
  `CuratorLlmQueryError` with the original as `cause`; `ProviderAuthError` still rides active.

### Task 2.3: Adapter spec for all three paths — PENDING

- File: W/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts
- Depends on: Task 2.2
- Plan reference: implementation-plan.md:368-371
- Pattern to follow: existing cases at spec `:453`, `:480`
- Quality requirements: per path — refusal → `stalled/provider-unsupported`, no `detail`,
  `internalQuery` never called on pinned and inherited; ordinary `AuthRequiredError`
  (`openai-codex` not-ready message, and `anthropic`) → `CuratorLlmQueryError` with `cause`;
  `ProviderAuthError` rides active.

### Batch 2 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=4), output tailed; mcp-bench typecheck confirms A2
- No per-batch review; Phase A review covers it

## Batch 3: Curator activity log and message table — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: the message table is the single source of user-facing curator text; later batches import it.
- Tasks: 3 | Depends on: Batch 2
- Phase: A Curator | Phase review: deferred to Batch 8
- Verify: `npm run verify -- -p @ptah-extension/memory-curator,mcp-bench` (N=2; bench `liveness-harness.ts` reads `CuratorRunStats`)

### Task 3.1: `CuratorRunReason`, `curatorRunMessage` table and exports — PENDING

- Files: W/libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts,
  W/libs/backend/memory-curator/src/index.ts
- Plan reference: implementation-plan.md:148-152
- Quality requirements: `CuratorRunReason = CuratorStallReason | CuratorDeferralReason | 'no-output' |
  'curator-error' | 'auth-required'`; `Record<CuratorRunReason, string>` so a new reason fails to
  compile without a sentence; sentences as specified (deferral/cooling/unreachable/no-output end with
  `Observations are kept for the next pass.`).
- Validation notes: `CuratorDeferralReason` is `keyof typeof DEFERRAL_SOURCES` (`:92`); the table
  must cover every key.

### Task 3.2: Reason and sentence on stats, sanitized `recordError` — PENDING

- File: W/libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts
- Depends on: Task 3.1
- Plan reference: implementation-plan.md:153-156
- Quality requirements: `CuratorRunStats` gains `reason?`, `error?` (table sentence only).
  `recordStall`, `recordNoOutput`, `recordDeferral` set both. For `provider-unsupported` only,
  `recordStall` updates last-run, pushes `kind:'curator-error'` with the sentence and
  `stats:{reason, providerId}`, logs warn. `recordError`: `auth-required` when the error or a cause up
  to 3 levels has `name === 'AuthRequiredError'`, else `curator-error`; pushed `error` is the sentence;
  the warn log keeps `detail` plus up to 3 cause messages.

### Task 3.3: CREATE activity log spec with sentinel — PENDING

- File: W/libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.spec.ts
- Depends on: Task 3.2
- Plan reference: implementation-plan.md:372
- Quality requirements: unsupported stall sets last-run and pushes the sentence + `providerId`; other
  stalls leave last-run untouched; auth-required vs curator-error reasons; sentinel
  `upstream 401 key=sk-SENTINEL-7f3a https://internal.example` in a `CuratorLlmQueryError` cause is in
  the warn log call and absent from returned stats, `getLastRun` and every JSON-stringified pushed event.

### Batch 3 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=2), output tailed
- No per-batch review; Phase A review covers it

## Batch 4: Sanitize other curator event producers — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: two services in one library, each with its own spec; closes the remaining raw pushes (R5).
- Tasks: 2 | Depends on: Batch 3
- Phase: A Curator | Phase review: deferred to Batch 8
- Verify: `npm run verify -- -p @ptah-extension/memory-curator` (N=1)

### Task 4.1: `memory-curator.service.ts` failure event uses the sentence — PENDING

- Files: W/libs/backend/memory-curator/src/lib/memory-curator.service.ts,
  W/libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts
- Plan reference: implementation-plan.md:157, :373
- Quality requirements: push at `:325-329` uses `curatorRunMessage('curator-error')`; raw message stays
  in the existing log line; spec: unsupported stall leaves stats `stalled`; failure event carries the
  sentence; sentinel absent. Update existing raw-text assertions to the sentences.

### Task 4.2: `memory-trigger.service.ts` failure events use the sentence — PENDING

- Files: W/libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts,
  W/libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts
- Plan reference: implementation-plan.md:157, :374
- Quality requirements: pushes at `:1026-1031` and `:1204-1208` sanitized; raw text in logs only;
  spec: trigger-curate and boot-scan failure events carry fixed sentences, sentinel absent.

### Batch 4 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=1), output tailed
- No per-batch review; Phase A review covers it

## Batch 5: Diagnostics contract and memory RPC handler — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: the wire contract and its only producer change together; includes the component 7
  backend change because it lives in the same handler file.
- Tasks: 4 | Depends on: Batch 3, Batch 4
- Phase: A Curator | Phase review: deferred to Batch 8
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/memory-curator-ui,ptah-electron,ptah-extension-webview` (N=5)

### Task 5.1: Shared run-now and diagnostics contract — PENDING

- File: W/libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts
- Plan reference: implementation-plan.md:158
- Quality requirements: `MemoryCuratorRunReason` string union mirroring `CuratorRunReason`;
  `MemoryRunNowResult` gains optional `outcome` and `reason`; `error?` JSDoc says fixed sentence,
  never provider text; JSDoc on `lastRunStats` documents `outcome`, `reason`, `error`. All optional.

### Task 5.2: runNow, thrown branch and diagnostics forward outcome/reason/sentence — PENDING

- File: W/libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts
- Depends on: Task 5.1
- Plan reference: implementation-plan.md:159-162
- Quality requirements: runNow (`:706-730`) sets `outcome`, `reason`, `error`, `success` per P2 with
  `satisfies MemoryRunNowResult`; thrown branch (`:731-740`) logs raw text, returns the
  `curator-error` sentence, `outcome:'failed'`, `reason:'curator-error'`; diagnostics (`:584-591`)
  forward `outcome`, `reason`, `error`.
- Validation notes (R4): add a compile-time two-way assignability check between
  `CuratorRunReason` and `MemoryCuratorRunReason` so drift fails typecheck.

### Task 5.3: `memory:rebuildIndex` throws a user error — PENDING

- File: W/libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts
- Depends on: Task 5.2
- Plan reference: implementation-plan.md:261 (component 7 handler)
- Quality requirements: on error log warn with the detail and throw
  `RpcUserError('Could not rebuild the memory search index. See the logs for details.', 'PERSISTENCE_UNAVAILABLE')`
  (already imported at `:74`).

### Task 5.4: Handler spec with sentinel — PENDING

- File: W/libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.spec.ts
- Depends on: Task 5.3
- Plan reference: implementation-plan.md:375
- Quality requirements: failed → `success:false`, `outcome`, `reason`, sentence; unsupported →
  `success:false`; ran → `success:true`; sentinel thrown by curator absent from
  `JSON.stringify(result)`; diagnostics fed a snapshot from a real activity log after a sentinel
  failure lacks it; rebuildIndex store throw → `RpcUserError`.

### Batch 5 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=5), output tailed
- Grep: no `err.message`, `error.message` or `cause` assigned to a pushed `error` field or a
  `MemoryRunNowResult.error` in `libs/backend/memory-curator` and `memory-rpc.handlers.ts`
- No per-batch review; Phase A review covers it

## Batch 6: Memory diagnostics UI — PENDING

- Recommended executor: CLI lane, Angular signals and templates + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: three files of one library, each with its spec; consumes the Batch 5 contract.
- Tasks: 3 | Depends on: Batch 5
- Phase: A Curator | Phase review: deferred to Batch 8
- Verify: `npm run verify -- -p @ptah-extension/memory-curator-ui,ptah-extension-webview` (N=2)

### Task 6.1: `lastManualRun` state and fixed transport error — PENDING

- Files: W/libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.ts,
  W/libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.spec.ts
- Plan reference: implementation-plan.md:170-186 (component 3), :397
- Quality requirements: `lastManualRun` stored from the RPC body including `success:false`; never
  cleared by `refresh()` or the 30 s poll; transport error → `Could not reach the curator. Try again.`

### Task 6.2: Accordion status line, outcome-aware last run, error block, how-it-works — PENDING

- Files: W/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts,
  W/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.spec.ts
- Depends on: Task 6.1
- Plan reference: implementation-plan.md:183-190, :398
- Quality requirements: `data-testid="manual-run-status"` with the exact copy per outcome; `role="alert"`
  when `success` is false else `role="status"`; `formatSnapshot` (`:356-372`) replaced with the same
  wording; newest `curator-error` newer than last `ran` → `alert-error` block; "Open model settings"
  only for `provider-unsupported` and `auth-required`, reusing navigation at `:343-349`;
  `data-testid="curator-how-it-works"` with the plan text verbatim.

### Task 6.3: Event feed tone and gate text — PENDING

- Files: W/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts,
  W/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.spec.ts
- Plan reference: implementation-plan.md:189, :399
- Quality requirements: `manual-run` with `stats.outcome === 'failed'` → error tone;
  `formatRateLimited` uses reason-based text when `limit` is absent.

### Batch 6 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=2), output tailed
- No per-batch review; Phase A review covers it

## Batch 7: Provider picker exclusion input — PENDING

- Recommended executor: CLI lane, Angular signals + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: one shared UI component; isolated so the chat batch builds on a committed input.
- Tasks: 1 | Depends on: none (ordered after Batch 6 for phase grouping)
- Phase: A Curator | Phase review: deferred to Batch 8
- Verify: `npm run verify -- -p @ptah-extension/ui,@ptah-extension/chat,ptah-extension-webview` (N=3)

### Task 7.1: `excludedProviders` input on the picker — PENDING

- Files: W/libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts,
  W/libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.spec.ts
- Plan reference: implementation-plan.md:187-198 (component 4), :403
- Quality requirements: `excludedProviders = input<readonly string[]>([])`; `providerOptions`
  (`:459-475`) drops excluded ids from registry and extras except the selected `provider()`, labelled
  `<name> (not supported here)`; default keeps today's behaviour for every other caller.

### Batch 7 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=3), output tailed
- No per-batch review; Phase A review covers it

## Batch 8: Curator role excludes Codex in settings — PENDING

- Recommended executor: CLI lane, Angular signals + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: rows, wiring and the e2e fixture that names Codex change together.
- Tasks: 3 | Depends on: Batch 7
- Phase: A Curator (last batch) | Phase review: code-logic + style, combined diff from the parent of Batch 1's commit to HEAD
- Verify: `npm run verify -- -p @ptah-extension/chat,@ptah-extension/webview-e2e-harness,ptah-extension-webview` (N=3)

### Task 8.1: Unsupported-provider list and readiness block — PENDING

- Files: W/libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts,
  W/libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.spec.ts
- Plan reference: implementation-plan.md:191
- Quality requirements: `CURATOR_UNSUPPORTED_PROVIDER_IDS = ['openai-codex'] as const` citing
  `provider-auth-resolver.ts:165-167`; `BackgroundConsumerRow.unsupportedProviders` (curator: list,
  enhancement: `[]`); `providerReadiness` (`:292-334`) returns the blocking message with
  `setupProviderId:null` for a listed id.

### Task 8.2: Assignments pass the list to picker and readiness — PENDING

- Files: W/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts,
  W/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.spec.ts
- Depends on: Task 8.1
- Plan reference: implementation-plan.md:193-195
- Quality requirements: wiring at `:246-256,659-666`; save refused for Codex (`:706`); spec covers
  hidden option, kept-and-labelled selected value, readiness block, refused save.

### Task 8.3: e2e settings fixture no longer assigns Codex to the curator — PENDING

- File: W/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts
- Plan reference: implementation-plan.md:194
- Quality requirements: replace `openai-codex`/`gpt-5.6-luna` at `:269-277` with a supported provider
  from `getAllAnthropicProviders()` or `''`. Do not run e2e targets.

### Batch 8 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=3), output tailed
- Phase A review due after commit (NEEDS REVIEW)

## Batch 9: Migration 0066 `indexing_state.last_run_json` — PENDING

- Recommended executor: CLI lane, TypeScript backend + SQLite + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: additive migration and its max-version assertions are one rollback boundary.
  Exception to the 6-file cap (R1): 22 one-line mechanical spec bumps in the same library; splitting
  would leave persistence-sqlite red between commits.
- Tasks: 3 | Depends on: none
- Phase: B Indexing | Phase review: deferred to Batch 14
- Verify: `npm run verify -- -p @ptah-extension/persistence-sqlite` (N=1)

### Task 9.1: Re-check the number, create and register 0066 — PENDING

- Files: W/libs/backend/persistence-sqlite/src/lib/migrations/0066_indexing_last_run.ts (CREATE),
  W/libs/backend/persistence-sqlite/src/lib/migrations/index.ts
- Plan reference: implementation-plan.md:202 (component 5 migration), A4 at :59
- Pattern to follow: `0064_lane_outcome_task_kind_source.ts` header style; registration at `index.ts:456-464`
- Quality requirements: `ALTER TABLE indexing_state ADD COLUMN last_run_json TEXT;`; register
  `{version: 66, name: '0066_indexing_last_run', sql}`.
- Validation notes (R9): first run `git fetch origin main` and
  `git ls-tree --name-only origin/main libs/backend/persistence-sqlite/src/lib/migrations/` (read-only
  git is allowed for this check). If 66 is taken, use the next free number everywhere in this batch
  and report it.

### Task 9.2: CREATE 0066 spec — PENDING

- File: W/libs/backend/persistence-sqlite/src/lib/migrations/0066_indexing_last_run.spec.ts
- Depends on: Task 9.1
- Plan reference: implementation-plan.md:377
- Quality requirements: column exists and is nullable after all migrations; an existing row keeps its values.

### Task 9.3: Bump every max-version assertion to 66 — PENDING

- Files: the 22 specs under W/libs/backend/persistence-sqlite/src/lib/migrations/ that assert
  `toBe(65)`: 0028, 0030, 0038, 0039, 0040, 0041, 0042, 0043, 0045, 0047, 0051, 0052, 0053, 0054,
  0055, 0056, 0059, 0060, 0061, 0063, 0064, 0065 (`*.spec.ts`)
- Depends on: Task 9.1
- Plan reference: implementation-plan.md:202 (plan says eight; disk has 22, R1)
- Quality requirements: change only the max-version assertion line in each; find them with
  `grep -rln 'toBe(65)' libs/backend/persistence-sqlite/src`; zero `toBe(65)` max-version
  assertions remain.

### Batch 9 verification

- Every listed artifact exists; `grep -rn 'toBe(65)' libs/backend/persistence-sqlite/src` returns nothing
- Scoped verify passes (N=1), output tailed
- No per-batch review; Phase B review covers it

## Batch 10: Indexing wire contracts and failed-activity mapping — PENDING

- Recommended executor: CLI lane, TypeScript + Angular service + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: the new push type and its one renderer activity consumer land together, so the
  contract has a typed consumer in the same commit.
- Tasks: 3 | Depends on: none (ordered after Batch 9)
- Phase: B Indexing | Phase review: deferred to Batch 14
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/core,@ptah-extension/chat,ptah-electron,ptah-extension-webview` (N=5)

### Task 10.1: Indexing status, run, last-run and refusal wire types — PENDING

- File: W/libs/shared/src/lib/types/rpc/rpc-indexing.types.ts
- Plan reference: implementation-plan.md:203-207
- Quality requirements: `IndexingStatusWire` gains optional `running?: IndexingRunWire | null` and
  `lastRun?: IndexingLastRunWire | null` with the exact fields; no error text in `lastRun`;
  `IndexingStartResult`/`IndexingResumeResult` gain optional `reason`; `IndexingFailedEvent`
  `{workspaceRoot, workspaceFingerprint, failedAt, elapsedMs, origin}` with no error text.

### Task 10.2: `INDEXING_FAILED` message type — PENDING

- Files: W/libs/shared/src/lib/types/messages/message-constants.ts,
  W/libs/shared/src/lib/types/messages/message-type.ts,
  W/libs/shared/src/lib/types/messages/payload-map.ts
- Depends on: Task 10.1
- Plan reference: implementation-plan.md:208
- Quality requirements: `INDEXING_FAILED: 'indexing:failed'` at `message-constants.ts:268-271`,
  `message-type.ts:104-105`, `payload-map.ts:456-457` → `IndexingFailedEvent`. Not batchable (A1).

### Task 10.3: Back-office activity maps `INDEXING_FAILED` — PENDING

- Files: W/libs/frontend/core/src/lib/services/back-office-activity.service.ts,
  W/libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts
- Depends on: Task 10.2
- Plan reference: implementation-plan.md:256 (component 6 back-office)
- Quality requirements: `mapIndexingFailed` → `{source:'indexing', kind:'failed', summary:'Workspace index failed'}`;
  fixed text, no host path (spec pattern at `:68`).

### Batch 10 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=5), output tailed
- No per-batch review; Phase B review covers it

## Batch 11: Indexing control service and census registry — PENDING

- Recommended executor: CLI lane, TypeScript backend concurrency + Jest, highest available reasoning effort
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review must verify A-F6, A-F7 in code)
- Rationale: one service and its spec carry the riskiest logic (R2, R3); isolating it keeps the
  executor focused on the settle rules and their tests.
- Tasks: 4 | Depends on: Batch 9, Batch 10
- Phase: B Indexing | Phase review: deferred to Batch 14
- Verify: `npm run verify -- -p @ptah-extension/memory-curator,@ptah-extension/thoth-runtime,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine` (N=4)

### Task 11.1: No stuck controller, refusals, `lastRun` persistence and status — PENDING

- File: W/libs/backend/memory-curator/src/lib/control/indexing-control.service.ts
- Plan reference: implementation-plan.md:209-233 (component 5 control service)
- Quality requirements: `IndexingRunDeps.runSymbols` returns `Promise<IndexingRunStats | void>` and
  takes `options.onProgress`; `start()` body after the controller is set inside `try/finally`,
  clearing `activeAbortController`/`activeWorkspaceFp` only when the signal matches; `pause()` aborts
  with `'pause'`, `cancel()` with `'cancel'`; duplicate manual start logs
  `[indexing-control] start ignored — already running`; `last_run_json` written through `upsertRow`
  (extend field pick `:604-616`) and read in `getStatus` with a hand-written guard (invalid → `null` +
  debug log); write failure logged at debug, never fails the run; `getStatus` reports `indexing` +
  `running` while a record is live and `lastRun` from the row.
- Validation notes: no new export from `memory-curator/src/index.ts`; per-call row writes
  (`git_head_sha`, `last_indexed_at`, `last_error`) stay with the manual caller.

### Task 11.2: Census registry with identity-checked removal (P12 + A-F6) — PENDING

- File: W/libs/backend/memory-curator/src/lib/control/indexing-control.service.ts
- Depends on: Task 11.1
- Plan reference: implementation-plan.md:211-225 (P12), :423-436 (A-F6, binding)
- Quality requirements: private map keyed by `normalizeWorkspaceRoot(root)`; one `joinCensus`
  called synchronously right before the indexer call by both manual `start()` and
  `trackBackgroundRun`; first joiner fixes `origin`, `startedAt`, `force`; manual→manual refused
  before joining; close on first non-abort symbols settlement; each participant releases exactly once;
  settle rules 1-4 exactly as written, one `lastRun` write and at most one complete/failed push per
  census; progress deduplicated per record by `{filesScanned, totalFiles}`; running view per plan.
  A-F6: when the last participant releases, remove the record from the open map whatever the outcome
  (non-abort, all-abort, pause, cancel), only if the map entry for that key is still this record
  object.
- Validation notes: the `INDEXING_COMPLETE` broadcast in `start()` (`:384-395`) moves into the settle;
  no other path writes `lastRun` or pushes complete/failed.

### Task 11.3: `trackBackgroundRun` — PENDING

- File: W/libs/backend/memory-curator/src/lib/control/indexing-control.service.ts
- Depends on: Task 11.2
- Plan reference: implementation-plan.md:227 (P11)
- Quality requirements: awaits the fingerprint, then with no further `await` joins as `background`
  and calls `run` with the record's progress handler; returns the same resolution or rejection
  unchanged; releases on settle; never writes `last_indexed_at` or `last_error` itself.

### Task 11.4: Control service spec including F5, A-F6 and A-F7 cases — PENDING

- File: W/libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts
- Depends on: Task 11.3
- Plan reference: implementation-plan.md:377-387, :430-440 (A-F6, A-F7)
- Pattern to follow: existing fake DB at spec `:52` (extend for `last_run_json`)
- Quality requirements: fake indexer with real join semantics (first call creates a deferred census;
  later calls for the root share its promise and add `onProgress`; a joiner's abort rejects only that
  joiner). Every join-order case counts `lastRun` writes (`upsertRow` calls carrying `last_run_json`)
  and `broadcastMessage` calls by type. Cases: fingerprint throw; duplicate start; manual failure;
  status during and after a run (survives a new service instance); `trackBackgroundRun` alone
  (success, failure, abort, pass-through rejection); corrupt `last_run_json`; manual→watcher success
  and failure; background→background success and failure; background→manual success;
  **background→manual failure (A-F7)**: one failed `lastRun`, one `INDEXING_FAILED`, origin
  `background`; record closes then a new census; joiner cancel; **A-F6**: manual start, watcher joins,
  `cancel()` → record removed, a fresh manual start opens a new record with origin `manual`, one
  `lastRun` write and one settle push; pause variant → no `lastRun` write and record removed.

### Batch 11 verification

- Every listed artifact exists and contains the required work; the A-F6 and A-F7 tests are present by name
- Scoped verify passes (N=4), output tailed
- No per-batch review; Phase B review covers it and checks A-F6/A-F7 in code

## Batch 12: Boot runtime wrap and indexing RPC handler — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: both are thin adapters over the Batch 11 service; two libraries, four files.
- Tasks: 2 | Depends on: Batch 11
- Phase: B Indexing | Phase review: deferred to Batch 14
- Verify: `npm run verify -- -p @ptah-extension/thoth-runtime,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron` (N=4)

### Task 12.1: Boot `runSymbols` returns stats; lifecycle routes through `trackBackgroundRun` — PENDING

- Files: W/libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts,
  W/libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts
- Plan reference: implementation-plan.md:233-235, :388
- Quality requirements: `runSymbols` (`:463-512`) returns `indexWorkspace`'s stats and calls
  `options.onProgress` instead of resolving `WebviewManager`; when `indexingControl` (`:244-256`) is
  non-null the lifecycle indexer (`:533`) wraps `indexWorkspace` with `trackBackgroundRun`;
  `reindexFile`/`deleteFileSymbols` pass through; no `await` between join and indexer call.

### Task 12.2: Handler refusal reasons and status mapping — PENDING

- Files: W/libs/backend/rpc-handlers/src/lib/handlers/indexing-rpc.handlers.ts,
  W/libs/backend/rpc-handlers/src/lib/handlers/indexing-rpc.handlers.spec.ts
- Plan reference: implementation-plan.md:236, :387
- Quality requirements: `toStatusWire` (`:47-66`) maps `running` and `lastRun` (R8); start
  (`:139-171`) and resume (`:191-217`) return `no-workspace`, `indexer-not-ready`,
  `{accepted:false, state:'indexing', reason:'already-running'}`, `setup-failed`; a start during a
  background run is accepted.
- Validation notes (A6): confirm and report that the manual root and the lifecycle root both come
  from the workspace provider (`indexing-rpc.handlers.ts:139-171`, `boot-thoth-runtime.ts:519-545`).

### Batch 12 verification

- Every listed artifact exists and contains the required work; A6 finding reported
- Scoped verify passes (N=4), output tailed
- No per-batch review; Phase B review covers it

## Batch 13: Workspace indexing UI — PENDING

- Recommended executor: CLI lane, Angular signals and templates + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: one library, service then component that reads it.
- Tasks: 2 | Depends on: Batch 10, Batch 12
- Phase: B Indexing | Phase review: deferred to Batch 14
- Verify: `npm run verify -- -p @ptah-extension/workspace-indexing,ptah-extension-webview` (N=2)

### Task 13.1: Service action messages, running state, failed push — PENDING

- Files: W/libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts,
  W/libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.spec.ts
- Plan reference: implementation-plan.md:243-249, :400
- Quality requirements: `_starting`, `_actionMessage`; `start`/`resume`/`pause`/`cancel` never reject;
  exact refusal and joined texts; `uiState` `indexing` when `running` set or progress < 100;
  `handledMessageTypes` adds `INDEXING_FAILED` (clear progress, `loadStatus`); expose `lastRun`,
  `runningOrigin`, `isBusy`, `actionMessage`.

### Task 13.2: Component busy state, background header, last-run line, how-it-works — PENDING

- Files: W/libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.ts,
  W/libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html,
  W/libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.spec.ts
- Depends on: Task 13.1
- Plan reference: implementation-plan.md:250-254, :401
- Quality requirements: buttons (`:60,202,243,285`) disabled with spinner while `isBusy()`, enabled
  during a background-only run; header `Background scan in progress (startup or file changes)`;
  `data-testid="last-run-summary"` copy per origin; `role="alert"`/`role="status"` action message;
  `data-testid="indexing-how-it-works"` text verbatim.

### Batch 13 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=2), output tailed
- No per-batch review; Phase B review covers it

## Batch 14: Memory tab rebuild state and indexing banner — PENDING

- Recommended executor: CLI lane, Angular signals and templates + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: the tab, its banner and its state service share one library and one spec surface.
- Tasks: 2 | Depends on: Batch 5, Batch 13
- Phase: B Indexing (last batch) | Phase review: code-logic + style, combined diff from the parent of Batch 9's commit to HEAD; code-logic must verify A-F6 and A-F7
- Verify: `npm run verify -- -p @ptah-extension/memory-curator-ui,ptah-extension-webview` (N=2)

### Task 14.1: Rebuild state separate from loading — PENDING

- Files: W/libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.ts,
  W/libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.spec.ts
- Plan reference: implementation-plan.md:262 (component 7 state)
- Quality requirements: `_rebuilding`, `_rebuildResult` `{at, rebuiltFts, rebuiltVec}`; stop using
  `_loading` for rebuild; error surfaces through `error()`.

### Task 14.2: Tab label, result, no swallowed index errors, banner action message — PENDING

- Files: W/libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts,
  W/libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.spec.ts,
  W/libs/frontend/memory-curator-ui/src/lib/components/memory-indexing-banner.component.ts
- Depends on: Task 14.1
- Plan reference: implementation-plan.md:255, :263
- Quality requirements: label and `aria-label` `Rebuild memory search index` (`:137-147`), busy bound
  to `rebuilding()`; result `Memory search index rebuilt (full-text: yes, vectors: yes|unavailable)`;
  drop `.catch(() => undefined)` at `:473-489`; banner gets an `actionMessage` input rendered with
  `role="alert"`.

### Batch 14 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=2), output tailed
- Phase B review due after commit (NEEDS REVIEW)

## Batch 15: Spec extractor verdicts and guarded grade store — PENDING

- Recommended executor: CLI lane, TypeScript backend + SQLite + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: pure parsing and one store guard; both are additive for the harvester (R6).
- Tasks: 2 | Depends on: none
- Phase: C Skills | Phase review: deferred to Batch 18
- Verify: `npm run verify -- -p @ptah-extension/skill-synthesis` (N=1)

### Task 15.1: Extractor task status, review mtime, suffixed reviews, bold verdicts, `taskVerdict` — PENDING

- Files: W/libs/backend/skill-synthesis/src/lib/spec-extractor.ts,
  W/libs/backend/skill-synthesis/src/lib/spec-extractor.spec.ts
- Plan reference: implementation-plan.md:269-273, :390
- Quality requirements: `HarvestedSpec.taskStatus`; `SpecReviewVerdict.modifiedAt` (`lstat`); file
  filter (`:257`) matches suffixed reviews; verdict regex (`:109`) accepts bold forms; pure
  `taskVerdict` per P3 (latest work review by mtime; document reviews excluded).

### Task 15.2: Guarded `upsert` and workspace-scoped `hasGradeForTask` — PENDING

- Files: W/libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts,
  W/libs/backend/skill-synthesis/src/lib/skill-task-grade.store.spec.ts
- Plan reference: implementation-plan.md:276-279 (P10), :392
- Quality requirements: `upsert` returns `boolean`, `DO UPDATE … WHERE workspace_root IS NULL OR
  workspace_root = excluded.workspace_root`, `changes > 0`; `hasGradeForTask(..., workspaceRoot?)`
  adds `AND workspace_root = ?` (normalized); `findAttributions`' `lane_outcome_records` join unchanged.
- Validation notes (A5): the spec asserts the refused write returns `false` and leaves workspace A's
  row byte-identical; a NULL-root row is adopted.

### Batch 15 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=1), output tailed
- No per-batch review; Phase C review covers it

## Batch 16: Task-level reconciliation and harvester — PENDING

- Recommended executor: CLI lane, TypeScript backend + SQLite + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: the new reconcile API and its only caller replace the batch loop in one commit (R6).
- Tasks: 2 | Depends on: Batch 15
- Phase: C Skills | Phase review: deferred to Batch 18
- Verify: `npm run verify -- -p @ptah-extension/skill-synthesis` (N=1)

### Task 16.1: `reconcileTaskEvents` replaces `reconcileSubagentEvent` — PENDING

- Files: W/libs/backend/skill-synthesis/src/lib/skill-invocation-event.store.ts,
  W/libs/backend/skill-synthesis/src/lib/skill-invocation-event.store.spec.ts
- Plan reference: implementation-plan.md:274-275 (P4), :391
- Quality requirements: select `task_id = ? AND reconciled_at IS NULL`; keep rows whose normalized
  root equals the normalized root (NULL roots excluded); one transaction of guarded
  `UPDATE … WHERE id = ? AND reconciled_at IS NULL`; return summed `changes`; parameterized SQL only;
  `applyReconciliation` kept; `reconcileSubagentEvent` and the null-task time-window fallback deleted.

### Task 16.2: Harvester marker v3, task-level reconcile, latest grade, counts, logs — PENDING

- Files: W/libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts,
  W/libs/backend/skill-synthesis/src/lib/spec-harvester.service.spec.ts,
  W/libs/backend/skill-synthesis/src/lib/spec-harvester.concurrent-attribution.spec.ts
- Depends on: Task 16.1
- Plan reference: implementation-plan.md:280-288, :393-394
- Quality requirements: `MARKER_VERSION = 3`; batch loop (`:118-133`) replaced by
  `reconcileTaskEvents` for every spec with a non-null `taskVerdict`; `writeGrades` resolves conflicts
  to the latest `modifiedAt` and logs warn `[spec-harvester] grade key owned by another workspace` on
  `false`, not adding to `keep`; `getRecentFindings` passes the workspace to `hasGradeForTask`;
  `HarvestResult` gains `pending`, `skippedFolders`; `harvest(root?, options?: {trigger?})` logs
  `[spec-harvester] harvest complete` at info with all counts. Specs: two-workspace marker-upgrade
  test (R7) and the concurrent-attribution rewrite for task level.

### Batch 16 verification

- Every listed artifact exists; `grep -rn reconcileSubagentEvent libs` returns nothing
- Scoped verify passes (N=1), output tailed
- No per-batch review; Phase C review covers it

## Batch 17: Harvest trigger origin — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: both callers of `harvest` pass their origin; two libraries, three files.
- Tasks: 2 | Depends on: Batch 16
- Phase: C Skills | Phase review: deferred to Batch 18
- Verify: `npm run verify -- -p @ptah-extension/skill-synthesis,@ptah-extension/rpc-handlers` (N=2)

### Task 17.1: Auto trigger passes `{trigger:'auto'}`; failure logs warn — PENDING

- Files: W/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts,
  W/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.spec.ts
- Plan reference: implementation-plan.md:289, :395
- Quality requirements: `:154-163` passes `{trigger:'auto'}`; failure log debug → warn; update the
  existing `toHaveBeenCalledWith('/ws')` assertion (spec `:107`).

### Task 17.2: Manual handler passes `{trigger:'manual'}` — PENDING

- File: W/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts
- Plan reference: implementation-plan.md:290
- Quality requirements: `harvester.harvest(undefined, {trigger:'manual'})` (or the root it already
  resolves) at `:1121`; report-and-rethrow (`:1123-1126`) unchanged.

### Batch 17 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=2), output tailed
- No per-batch review; Phase C review covers it

## Batch 18: Harvest result contract and skills UI — PENDING

- Recommended executor: CLI lane, Angular signals and templates + Jest
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: the additive wire fields land with their only renderer consumer.
- Tasks: 3 | Depends on: Batch 16
- Phase: C Skills (last batch) | Phase review: code-logic + style, combined diff from the parent of Batch 15's commit to HEAD
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/skill-synthesis-ui,ptah-electron,ptah-extension-webview` (N=4)

### Task 18.1: `SkillSynthesisHarvestSpecsResult` gains optional counts — PENDING

- File: W/libs/shared/src/lib/types/rpc.types.ts
- Plan reference: implementation-plan.md:291
- Quality requirements: `pending?: number; skippedFolders?: number` at `:2793-2797`; nothing else in
  this file changes.

### Task 18.2: `lastHarvest` and `harvestError` state — PENDING

- Files: W/libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts,
  W/libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.spec.ts
- Depends on: Task 18.1
- Plan reference: implementation-plan.md:295, :404
- Quality requirements: neither signal cleared by `refreshSpecs`; `lastHarvest` set before refresh;
  error text `Harvest failed. See the logs for details.` (no raw message).

### Task 18.3: Specs control busy label, result line, alert, how-it-works — PENDING

- Files: W/libs/frontend/skill-synthesis-ui/src/lib/components/skill-specs-control.component.ts,
  W/libs/frontend/skill-synthesis-ui/src/lib/components/skill-specs-control.component.spec.ts
- Depends on: Task 18.2
- Plan reference: implementation-plan.md:296-301, :404
- Quality requirements: `Harvesting…` with spinner; `data-testid="skills-harvest-result"`
  `role="status"` copy including `Nothing new to harvest` and skipped folders; error in `role="alert"`;
  pending count from `specs()` status `complete-unharvested`; how-it-works text verbatim.

### Batch 18 verification

- Every listed artifact exists and contains the required work
- Scoped verify passes (N=4), output tailed
- Phase C review due after commit (NEEDS REVIEW)

## Batch 19: Developer evaluation guide — PENDING

- Recommended executor: CLI lane, code-traced technical documentation
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (technical-content-writer)
- Subagent reason: N/A
- Review family: N/A (docs only)
- Rationale: written last so every log line, reason sentence and column it cites exists on disk.
- Tasks: 1 | Depends on: Batches 1-18
- Phase: D Docs | Phase review: none — docs only
- Verify: `npx prettier --check docs/development/memory-skills-evaluation.md` (run from `W`)

### Task 19.1: CREATE `docs/development/memory-skills-evaluation.md` — PENDING

- File: W/docs/development/memory-skills-evaluation.md
- Plan reference: implementation-plan.md:304-318 (component 10)
- Quality requirements: one section per flow with triggers, tables, read-only `sqlite3` queries
  (`mode=ro`), log greps, reason codes with their exact sentences copied from `curatorRunMessage`,
  settings keys, per-project `npm run verify -- -t test -p <project>`, the mcp-bench memory-skills
  benchmark (build-type target only on request), and the known limits. Every quoted log line and
  sentence must match the code verbatim.

### Batch 19 verification

- The file exists and its quoted strings match the code (spot-check by grep)
- Prettier check passes
- No phase review

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Re-split plan B1-B7 into 19 batches | keep 7 large batches; split to the 6-file / 2-library cap | Plan B1 touches 13 production files in 6 libraries; B4 touches 10 files in 3 libraries | yes |
| Phases by flow (Curator, Indexing, Skills, Docs) instead of backend-then-UI | layer phases; flow phases | Each phase review sees one end-to-end flow; plan ordering (B1/B2 before B4, B3 before B6) is preserved | yes |
| Batch 9 exceeds the 6-file cap | split spec bumps into another batch; keep with the migration | 22 one-line edits in one library; a split leaves persistence-sqlite failing between commits | yes |
| Keep `reconcileSubagentEvent` until Batch 16 | delete in Batch 15; delete with its caller | Only the store, harvester and their specs reference it (grep) | yes |
| Back-office `INDEXING_FAILED` mapping moves into the contract batch | Batch 10; a UI batch | Keeps Batches 10, 13 and 14 within the cap and gives the new push type a typed consumer in its own commit | yes |
| Phase reviews by in-process claude-family reviewers when implementers are CLI lanes | CLI lane reviewer; in-process reviewer | Cross-family rule; the plan's Gate 2 reviewer family need not review implementation | yes |
