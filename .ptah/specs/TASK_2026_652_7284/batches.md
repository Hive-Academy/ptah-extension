# Batches - TASK_2026_652_7284

Total tasks: 56 plus fix Batches 24-25 | Batches: 25 | Complete: 25/25

Execution order (D7-D9, user 2026-10-13): Batch 16 (Phase 1 fix) → Phase 1 re-review (fixes
only) → Batch 9 (with Task 9.0, moved from 7.1; verified, its commit waits for Batch 17) →
Batch 17 (degradation-audit markers; commits first) → Batch 9 commit → Phase 2B review → Batches 10-13 → Phase 3
review → fix Batches 19-22 → Phase 3 re-review → Batches 14-15 → Phase 4 review → wait for TASK_2026_629 to merge and the user to
confirm → Batches 6, 7, 8 → Phase 2F review → Mode 3. Batch numbers are ids, not run order.

Worktree root (every command runs here):
`D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions`

## Decomposition defaults (recorded, not asked)

- Order follows implementation-plan.md (S, P, A, C, D1, D2, D3, B, E, F, G, H, I), with three
  team-leader splits: S becomes Batch 1 + Batch 2 (S had 7 files once the merge spec is counted);
  E/F become Batch 10 + 11 + 12 (see risk R2); D3 gains its existing spec.
- Binding notes from Gate 2 are applied:
  - F18: Batch 5 (C) registers only `harness:get-proposal`. Batch 13 (G) adds `wizard:analysis-status`
    to `rpc.types.ts` and `host-source-registry.baseline.ts`. `agent-generation/src/index.ts` moved
    out of G (see "Sequential ownership").
  - F19: `npx nx run-many -t test -p @ptah-extension/cli-engine --parallel=1` runs after Batch 5 and
    after Batch 13. Decision: the CLI serves both new RPCs. `HarnessRpcHandlers` and
    `SetupRpcHandlers` are manifest entries with `requires: []`
    (`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:220-225,304-309`). The CLI calls
    `registerHarnessServices` (`libs/backend/cli-engine/src/lib/container.ts:941`) and
    `registerRpcSurface`. So the new names land in `surface.registered`, and
    `rpc-surface.spec.ts` passes with no cli-engine edit. If that test fails, the batch is
    NOT ACCEPTED, and the decision comes back here. No silent exclusion-list edit.
  - F20: Batch 10 (E) keeps `AnalysisStorageService.loadManifest(slugDir)` and the
    `MultiPhaseManifest` name source-compatible for
    `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts:133`
    (`?.runId`) and for the `setup-rpc.handlers.ts` readers (`:332,365-377,456-466,916-1140`).
    E's check includes the rpc-handlers typecheck and the two rpc-handlers specs.
  - F21: Batch 6 (D1) adds `HarnessRpcService.getProposal`. Batch 7 (D2) uses it.
- Sequential ownership (file edited by two batches, strictly in this order, never in parallel):
  - `libs/shared/src/lib/types/rpc.types.ts`: Batch 5 (C), then Batch 13 (G).
  - `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`: Batch 5 (C), then Batch 13 (G).
  - `libs/backend/agent-generation/src/index.ts`: Batch 10 (E) exports the new manifest/storage
    types. Batch 11 (F1) exports `AnalysisFreshnessService`. F18 moves this file into E, but the
    freshness class only exists from F1 on, so F1 owns the second edit. G stays at two libs.
- RPC param Zod schemas follow the local pattern (`handlers/harness-rpc.schema.ts:53`,
  `handlers/setup-rpc.schema.ts:26`). `HarnessGetProposalParamsSchema` goes in C and
  `WizardAnalysisStatusParamsSchema` goes in G. The stored-record schema (`HarnessProposalSchema`)
  stays in shared (Batch 1), because the store (Batch 4) and the RPC (Batch 5) both read it.
- Executor: every batch runs on one implementation CLI lane, as the roster in context.md says. All
  tasks in a batch are coupled (implementation plus its spec), so mode is sequential throughout.
  Lanes never run git.
- Verification is memory-safe. Each batch gets one foreground command line, chained with `&&`,
  output tailed. Consumer checks on projects the batch does not change use typecheck or targeted
  spec files only. They are there because the batch changes a contract those projects compile
  against: Gate 2 approved consumer checks (plan E/I commands, F19). Never run two heavy checks at
  once.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- All three hosts call `registerHarnessServices` before the MCP namespace runs. Verified:
  `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:67`,
  `apps/ptah-electron/src/di/phase-4-handlers.ts:89`, `libs/backend/cli-engine/src/lib/container.ts:941`.
  Registering the store in `harness/di.ts` (Task 4.3) therefore covers every host.
- `PLATFORM_TOKENS.DI_CONTAINER` exists (`libs/backend/platform-core/src/di/tokens.ts:95`).
  `PtahAPIBuilder` already injects it as optional and resolves per call
  (`ptah-api-builder.service.ts:509-516`). Verified. Task 9.2 relies on this.
- `resolveCallerSdkSessionId()` returns only a lifecycle `realSessionId` and never throws
  (`ptah-api-builder.service.ts:1035-1066`). Verified. Task 9.2 relies on this.
- The MCP dispatcher already awaits `ptahAPI.harness.proposeConfig`
  (`protocol-dispatcher.ts:2236-2249`). Verified. Task 9.3 may need no dispatcher logic change,
  only the error path and spec.
- Both handler manifests are `requires: []`, so every host serves both new RPCs. Verified
  (see F19 above). Tasks 5.4 and 13.3 confirm it with the cli-engine test.
- The `HARNESS_CONFIG_PROPOSED` payload has one producer, which is untyped
  (`harness-namespace.builder.ts:1078`). Its typed consumers are
  `harness-workflow-message.handler.ts:145` and a constant-only webview spec. Verified. Making
  `sessionId` required in Task 9.0 (moved from Task 7.1, D8) breaks no unowned file. Re-checked
  2026-10-13: the frontend handler only casts the payload (`:145`); nothing constructs it.
- Rehydration lives in `HarnessWorkflowService` (`harness-workflow.service.ts:148-229`), which
  exposes `sessionId` as a computed signal (`:172`). Task 7.2 keeps hydration in the message
  handler, keyed on that signal. Unverified that this needs no workflow-service edit. Batch 7
  holds a reserve ownership of that file and its spec, and must report whether it used them.
- `wizard:get-resumable-run` keeps its response type. Parity row 23 ("same RPC plus freshness
  status") is met by the sibling `wizard:analysis-status` RPC in the same handler class.
  Unverified with the user. Mode 3 parity checks it.
- Runtime may be inconsistent between commits on this branch, as long as every commit passes
  its gate. Two windows exist: New Project between Batch 5 and Batch 6, and the v3/v4 window
  between Batch 10 and Batch 12. The branch merges as one PR. Mode 3 verifies end-to-end behavior.
- The plan's "atomic directory move" assumption (implementation-plan.md:88) is FALSE. See R1.

| Risk                                                                                                                                                                                                                                                                                                                                                                                                 | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: `IFileSystemProvider` has no rename/move (`libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:22-140`: read, write, delete, createDirectory, copy only). The v3 archive cannot be an atomic move, and checkpoint writes cannot use temp-rename through the port. The mock `copy` is file-only (`platform-core/src/testing/mocks/file-system-provider.mock.ts:202-216`). | HIGH     | Task 10.2: `archiveLegacyRun` copies file by file into a unique archival slug, re-reads the copied manifest, and must validate it as v3 before `delete(original, {recursive})`. Any failure aborts with a typed error and leaves v3 untouched. Data is never deleted before a verified copy. A crash between copy and delete leaves two legacy listings, never a loss. Manifest writes stay single `writeFile`, as today, so there is no regression. Readers fail closed (malformed means null or `unreadable`, never fresh). Follow-up recorded for Mode 3: add `rename` to the port in a later task.                                                    |
| R2: The plan's E batch would fail its own gate. `multi-phase-analysis.service.spec.ts:261,394,705` (F-owned) asserts v3 writes. That spec drives the real `AnalysisStorageService` over the in-memory FS (`spec:5,206-207`), and no checkpoint spec exists.                                                                                                                                          | HIGH     | Re-split: Batch 10 is a behavior-neutral read path. It adds v4 types and `readManifest`, keeps `loadManifest`, `createSlugDir`, `writeManifest` and the constructor unchanged for existing callers, and only adds methods. The v4 writer switch moves to Batch 12, together with `multi-phase-analysis.service.ts` and its spec.                                                                                                                                                                                                                                                                                                                          |
| R3: S1 changes `MultiPhaseAnalysisResponse.manifest` to a v3/v4 union in shared. That type is consumed by setup-wizard (`wizard-rpc.service.ts`, `wizard-analysis-state.ts`), ptah-cli (`setup.ts:54,132-137`), agent-generation (`analysis-storage.service.ts:491-525`) and rpc-handlers.                                                                                                           | MEDIUM   | Task 1.3 keeps the v3 member byte-identical and every common field present on v4. Batch 1 runs a typecheck of the four consumers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R4: Proposal hydration and a live event race. A stale snapshot applied after a newer live event could revert fields.                                                                                                                                                                                                                                                                                 | MEDIUM   | Task 7.2 buffers live events for the active session while `getProposal` is in flight, applies the snapshot first, then replays the buffer. Events for another session, or before the active session id is known, are dropped and recovered by hydration. Spec covers both orders.                                                                                                                                                                                                                                                                                                                                                                         |
| R5: Session identity. A tab id must never be persisted.                                                                                                                                                                                                                                                                                                                                              | HIGH     | Task 9.1/9.2: an unresolved caller returns a tool error with no write and no broadcast. The spec covers the correlation-id path after lifecycle assigns `realSessionId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R6: Cross-process proposal writes.                                                                                                                                                                                                                                                                                                                                                                   | MEDIUM   | Task 4.1: per-session in-process queue plus a bounded `wx` lock file with expiry recovery. Re-read after the lock. A lock timeout rejects with no broadcast. Node `fs/promises` temp-write plus rename is available in rpc-handlers (precedent `handlers/file-edit-rpc.handlers.ts:349`). Phase 1 review: the hand-rolled lock had three defects (release ENOENT, stale double-holder, wait < stale); Task 16.1 replaces it with `serializeByKey` + `withFileLock` from `@ptah-extension/harness-sync`, wait > stale. Residual (pre-existing in harness-sync, recorded as FU-1 below): `breakIfStale` is check-then-remove and `release` removes by path. |
| R7: `HarnessConfigStore` writes under `~/.ptah`, but proposals must use the host workspace provider root, never `resolveSessionWorkspaceRoot`.                                                                                                                                                                                                                                                       | MEDIUM   | Task 4.1 resolves the root from `PLATFORM_TOKENS.WORKSPACE_PROVIDER` for both write and read. Task 5.2 spec: get-proposal reads the same root the writer used. No caller-selected root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R8: A new `@inject` token without a registration fails the pre-push di-lint.                                                                                                                                                                                                                                                                                                                         | LOW      | Batches 4, 12 and 15 append `npx nx run di-lint:lint` to their check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| R9: Removing the New Project broadcast (Batch 5) breaks four Electron e2e event-injection specs and the 629-owned webview routing spec.                                                                                                                                                                                                                                                              | LOW      | Producer only. The constant, payload, baseline entry and relay stay. e2e is not run (CLAUDE.md). Retargeting stays in the plan's Deferred review items until TASK_2026_629 merges.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R10: D1 duplicates the relay logic until D2 makes the relay delegate.                                                                                                                                                                                                                                                                                                                                | LOW      | Task 7.2 deletes the handler's copy and delegates to `HarnessWorkflowRequestService`. Phase 2F review checks there is one implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R11: Visual evidence. D1 changes Setup Hub modal timing (no new surface, no prototype).                                                                                                                                                                                                                                                                                                              | MEDIUM   | Mode 3 requires before/after visual-reviewer screenshots (dark and light) of the Setup Hub New Project intake. The before set is taken from base commit `2464e6922`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Edge cases:

- Proposal: unresolved or tab-only caller identity is rejected with no write and no broadcast
  (Tasks 9.1, 9.2). Broadcaster missing after persist is non-fatal (Task 9.1). Corrupt record is
  logged and returns null (Tasks 4.1, 5.2). Lock timeout is rejected (Task 4.1). Two sessions in
  one workspace are isolated (Task 4.2). A record older than 30 days is pruned (Task 4.1).
- Hydration: reload before any new tool call (Task 7.3). Event for a non-active session
  (Task 7.2). Event before the session id resolves (Task 7.2). Hydrate and live race (R4,
  Task 7.2).
- New Project: intake invalid, rejected before plugin effects (Task 5.1). Plugin
  write/reconcile failure is a failed RPC (Task 5.1). Navigation failure keeps the modal open
  and clears the request (Task 6.3). Same-mode resume and cross-mode abort (Task 6.2).
- Manifest: v2, malformed or unknown version returns null without rewrite (Task 10.2). Paused v3
  resume: archive, then a fresh v4 (Task 12.2). Archive failure aborts with v3 intact (Task 10.2).
  Completed-phase output hash mismatch on resume restarts that phase and its descendants
  (Task 12.2). Stream without init uses the first message id (Task 12.1). Stream with no id
  gives a typed failure and stays unverified (Task 12.1). Synthetic UI phase id is never recorded
  (Task 12.1).
- Freshness: legacy-v3, incomplete, expired (over 7 days), workspace-changed, output-mismatch,
  unreadable fingerprint (stale, never fresh), no workspace (missing) (Tasks 11.1, 13.2).
- Generation: missing or stale analysis still generates from gathered context (Tasks 14.2,
  15.1, 15.2). Unauthorized path is still rejected (Task 14.1). Discovery failure keeps the prior
  prompt with a typed error (Task 15.2). Forced regenerate invalidates the cache (Task 15.2).

## Write-path register (for Mode 3 trace)

- `<host-workspace>/.ptah/harness/proposals/<sha256(trimmed sessionId)>.json` (+ `.lock`, temp
  files). Writer: Task 9.1 through the Task 4.1 store (lock from Task 16.1: harness-sync
  `withFileLock`, lock payload `{pid, at}`). Readers: Task 5.2 RPC, then Task 7.2 hydration.
- `<workspace>/.ptah/analysis/<slug>/manifest.json` v4. Writer: Task 12.2. Readers: Tasks 10.2,
  11.1, 13.2, 14.1, 15.2, `wizard-generation-checkpoint.service.ts:133`.
- `<workspace>/.ptah/analysis/<archival-slug>/` (v3 archive). Writer: Task 10.2, called by
  Task 12.2. Readers: saved-analysis listing (`analysis-storage.service.ts:297-345`).

---

## Batch 1: Shared proposal and status contracts - COMPLETE (commit 58d543298)

- Recommended executor: implementation CLI lane (roster, context.md), one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: three edits to one library's public contract surface, plus one barrel. They are
  coupled through the barrel and a single typecheck.
- Tasks: 3 | Depends on: none
- Phase: 1 - Proposal backend | Phase review: code-logic, plus style (new public API)

### Task 1.1: Proposal and get-proposal types - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-harness-proposal.types.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/index.ts`
- Plan reference: implementation-plan.md:22-46 (section 1, shapes)
- Pattern to follow: `libs/shared/src/lib/types/rpc/rpc-harness.types.ts` (exported at `libs/shared/src/index.ts:66`)
- Quality requirements: `HarnessProposal {version:1; workspaceRoot; sessionId; configUpdates: Partial<HarnessConfig>; isConfigComplete; updatedAt}`, `HarnessGetProposalParams {sessionId}`, `HarnessGetProposalResult {proposal: HarnessProposal | null}`. Export from the root barrel next to line 66. Do not touch `HarnessStartNewProjectResult` (Batch 5 owns it).
- Validation notes: R5 (sessionId is the real SDK id, documented on the field).
- Implementation details: type-only file, importing `HarnessConfig` from `./rpc-harness.types`. Add one `export *` line.

### Task 1.2: Stored proposal record schema - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts`
- Plan reference: implementation-plan.md:46 (boundary Zod paragraph)
- Pattern to follow: `HarnessConfigUpdatesSchema` at `rpc-harness.schemas.ts:369`
- Quality requirements: `HarnessProposalSchema` is strict, with `version: z.literal(1)`, ISO datetime `updatedAt`, `sessionId` trimmed with length 1-256, non-empty `workspaceRoot`, `configUpdates: HarnessConfigUpdatesSchema`, boolean `isConfigComplete`. Its inferred type must be assignable to `HarnessProposal`.
- Validation notes: corrupt-record rejection in Task 4.1 depends on this schema.
- Implementation details: add the schema with a compile-time assignability check. No RPC param schema here (Batch 5).
- Verification note (team-leader, Batch 1 accept): the executor wrapped `configUpdates` as
  `z.custom<Partial<HarnessConfig>>(v => HarnessConfigUpdatesSchema.safeParse(v).success)`
  (`rpc-harness.schemas.ts:468-470`), because the update schema's output (partial nested
  sections) is not assignable to `Partial<HarnessConfig>`. Validation is equivalent, but the
  parsed value is the raw input: the update schema's transforms, preprocessors and defaults
  (`:344,387,406,430,439,448`) are not applied on read. Safe only if Task 4.1/9.1 persist the
  already-normalized update. Phase 1 code-logic review must check this; Task 4.2 should pin a
  round-trip of a normalized record.

### Task 1.3: Analysis status types and v3/v4 manifest response union - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-setup.types.ts`
- Plan reference: implementation-plan.md:62-103 (sections 3-4: `PhaseResultV4`, `MultiPhaseManifestV4`, `WorkspaceFingerprint`, `AnalysisStatus`)
- Pattern to follow: `MultiPhaseAnalysisResponse` at `rpc-setup.types.ts:48-75`
- Quality requirements: add `WorkspaceFingerprint`, `AnalysisStatus`, `WizardAnalysisStatusParams = Record<string, never>` and `WizardAnalysisStatusResponse = AnalysisStatus`. Change `MultiPhaseAnalysisResponse.manifest` to a union discriminated on `version`. The v3 member must be byte-identical to today's inline shape. The v4 member adds `workspaceFingerprint` and per-phase `attempt`, `sessionId`, `input`, `verification`. Both keep `status`, `file`, `durationMs`, `error?`.
- Validation notes: R3. The consumer typecheck must pass with no consumer edit.
- Implementation details: type-only edits. Do not add the method to `rpc.types.ts` (Batch 13 owns that).

### Batch 1 verification

- Every listed artifact exists and contains the required work.
- Command (foreground, tail the output):
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=1 && npx nx run-many -t typecheck -p @ptah-extension/agent-generation @ptah-extension/rpc-handlers @ptah-extension/setup-wizard ptah-cli --parallel=1`
  Confirm that each header names the requested project count (1, then 4).
- No per-batch review. The Phase 1 review covers this batch.

## Batch 2: Shared field-aware merge utility - COMPLETE (commit 0e9813f89)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: one pure function, its spec and a barrel line.
- Tasks: 2 | Depends on: Batch 1
- Phase: 1 - Proposal backend | Phase review: code-logic, plus style

### Task 2.1: `mergeHarnessConfigUpdates` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/utils/merge-harness-config-updates.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/utils/index.ts`
- Plan reference: implementation-plan.md:46 (merge paragraph)
- Pattern to follow: the field-aware merge in `libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts:325-410`
- Quality requirements: a pure function `(base: Partial<HarnessConfig>, update: Partial<HarnessConfig>) => Partial<HarnessConfig>`. Persona, prompt and claudeMd merge as nested objects. Agents and MCP tool maps merge by key. Skill refs merge by `skillId`, preserving selected origins. No mutation of inputs.
- Validation notes: Task 8.1 must be able to replace the frontend logic with no behavior change.
- Implementation details: export from `utils/index.ts`, which is re-exported at `libs/shared/src/index.ts:59`.

### Task 2.2: Merge spec - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/utils/merge-harness-config-updates.spec.ts` (new)
- Depends on: Task 2.1
- Quality requirements: cases ported from the frontend behavior: nested persona, agents by key, skill by id with origin kept, MCP map by key, an empty update, input immutability.

### Batch 2 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=1`

## Batch 3: Platform proposal store port - COMPLETE (commit b82a94f7c)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: a three-file port addition in one library.
- Tasks: 1 | Depends on: Batch 1
- Phase: 1 - Proposal backend | Phase review: code-logic, plus style

### Task 3.1: `IHarnessProposalStore` and `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/platform-core/src/interfaces/harness-proposal-store.interface.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/platform-core/src/di/tokens.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/platform-core/src/index.ts`
- Plan reference: implementation-plan.md:24 (note: the plan's `platform-core/` means `libs/backend/platform-core/`)
- Pattern to follow: `interfaces/session-organization-recorder.interface.ts` and the `Symbol.for('Platform...')` tokens in `di/tokens.ts`
- Quality requirements: `save(sessionId, update: Partial<HarnessConfig>, complete: boolean): Promise<HarnessProposal>` and `get(sessionId): Promise<HarnessProposal | null>`. Add `delete(sessionId): Promise<void>` only if Task 5.1 wires it (see Task 5.1). Type-only export.
- Implementation details: shared types are imported from `@ptah-extension/shared`. Token is `Symbol.for('PlatformHarnessProposalStore')`.

### Batch 3 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core --parallel=1`

## Batch 4: Workspace proposal store - COMPLETE (commit 7e6d98bd2)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: a new service, its spec and DI registration. Tightly coupled.
- Tasks: 3 | Depends on: Batches 1, 2, 3
- Phase: 1 - Proposal backend | Phase review: code-logic, plus style

### Task 4.1: `HarnessProposalStore` service - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts` (new)
- Plan reference: implementation-plan.md:24, 46 (store, lock, retention)
- Pattern to follow: `harness/config/harness-config-store.service.ts` (node `fs/promises`); temp plus rename at `handlers/file-edit-rpc.handlers.ts:349`
- Quality requirements: implements `IHarnessProposalStore`. Root comes from `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, the same for read and write. Path is `<root>/.ptah/harness/proposals/<sha256(sessionId)>.json`. Per-session serial queue. Bounded `wx` lock file with expiry recovery, then re-read the latest record. Merge with `mergeHarnessConfigUpdates`. Atomic temp-write and rename. Lock failure rejects. Stored identity and root must match on read. Corrupt or mismatched records are logged and return null. Prune records older than 30 days during access. No workspace means a typed error.
- Validation notes: R6, R7.

### Task 4.2: Store spec - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts` (new)
- Quality requirements: concurrent partial writes, same-session merge, distinct-session isolation, read after restart (new instance), corrupt record rejection, 30-day pruning, two-process lock (a pre-held lock file), lock expiry recovery.

### Task 4.3: DI registration - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/di.ts`
- Quality requirements: `container.registerSingleton(PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE, HarnessProposalStore)` inside `registerHarnessServices`, beside `CONFIG_STORE` (`di.ts:57`).

### Batch 4 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers --parallel=1 && npx nx run di-lint:lint`
- Result (team-leader re-run, `--skip-nx-cache`, node_modules junction in place): Nx
  "Successfully ran targets typecheck, test, lint for project @ptah-extension/rpc-handlers"
  (one project); `di-lint OK: 1823 @inject sites all resolve to a registered token (792
tokens)`; exit 0. The executor's 77 failing suites were Jest module-mapping errors from the
  missing worktree node_modules, not from this batch; they pass with the junction.
- Notes for the Phase 1 code-logic review (not blocking this batch):
  - `prune()` rethrows a non-ENOENT inner error (e.g. a `JSON.parse` SyntaxError on one corrupt
    record) to the outer catch, which logs and stops pruning the remaining files.
  - Lock release `fs.unlink` in `finally` can throw ENOENT if another process recovered the lock
    as stale (5 s), turning a successful write into a rejected save.
  - Stale recovery unlinks by path, so two processes recovering the same stale lock can race.

## Batch 5: New Project handoff result and `harness:get-proposal` RPC - COMPLETE (commit 48fbb5673)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: contract, registry, baseline, schema and handler must change together, or the
  allowlist and host-source contract specs fail.
- Tasks: 4 | Depends on: Batches 1, 4
- Phase: 1 - Proposal backend | Phase review: code-logic, plus style
- Phase 1 review (combined diff `58d543298^..48fbb5673`): code-logic APPROVED WITH FIXES 5.5/10
  (`code-logic-review.md`, antigravity lane); style APPROVED WITH FIXES 7/10
  (`code-style-review.md`, claude sub-agent). Treated as a revision verdict: fix Batch 16 added
  to Phase 1. Batch 16 is now the last batch of Phase 1.

### Task 5.1: Return the handoff from `harness:start-new-project`; drop only its broadcast - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-harness.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts`
- Plan reference: implementation-plan.md:48-60 (section 2)
- Pattern to follow: the current flow at `harness-rpc.handlers.ts:813-904`
- Quality requirements: `HarnessStartNewProjectResult` (`rpc-harness.types.ts:512-515`) becomes the success/failure union with `seedPrompt`, `intake`, `plugins {enabledBundled, missingExternal, availableSkillIds}` and `toolchain?`. Reuse existing exported types. Intake Zod runs before side effects. Keep plugin enable and reconcile, `focusChat` and wizard-panel disposal before returning. Remove only the `HARNESS_OPEN_WORKFLOW` broadcast at `:872`. Keep the constant, payload, baseline entry and relay. If `harness:apply` params already carry a session id, delete that session's proposal after a successful apply. Otherwise wire nothing (30-day prune covers it) and say so in the report.
- Validation notes: R9. Plugin write failure stays a failed RPC.

### Task 5.2: Register `harness:get-proposal` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc.types.ts` (first owner),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts` (first owner),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts`
- Plan reference: implementation-plan.md:46 (`registerGetProposal` beside `registerStartNewProject`, `:351-357`)
- Pattern to follow: `'harness:start-new-project'` at `rpc.types.ts:1794,3979`, `baseline.ts:179`, `HarnessRpcHandlers.METHODS` at `harness-rpc.handlers.ts:171`
- Quality requirements: `HarnessGetProposalParamsSchema = z.object({sessionId: z.string().trim().min(1).max(256)}).strict()`. Add to the METHODS list, then bind. Resolve the store via `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE`. Return `{proposal}`, which is null when absent or corrupt. Do NOT add `wizard:analysis-status` (F18, Batch 13). The baseline may be regenerated with `npx tsx scripts/generate-host-source-registry-baseline.ts`. Only the baseline file may change.

### Task 5.3: Handler spec - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.spec.ts`
- Quality requirements: intake validated before plugin effects. Enabled and missing plugin diagnostics are in the result. Required success fields are present. No `HARNESS_OPEN_WORKFLOW` broadcast. Focus and dispose happen before the response. get-proposal param rejection. get-proposal reads the same root the store wrote.

### Task 5.4: CLI surface confirmation (F19) - COMPLETE

- File: none edited. Decision recorded above: the CLI serves `harness:get-proposal`.
- Quality requirements: the cli-engine test passes with no cli-engine edit. If it fails, report it and stop. Do not edit `CLI_EXPECTED_ABSENT_METHODS`.

### Batch 5 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 && npx nx run-many -t test -p @ptah-extension/cli-engine --parallel=1`
- After commit: the Phase 1 review is due (Batches 1-5, combined diff).
- Result (team-leader re-run, `--skip-nx-cache`): "Running targets typecheck, test, lint for
  2 projects" -> "Successfully ran targets typecheck, test, lint for 2 projects"; cli-engine
  "Successfully ran target test"; both exit 0. Executor report: `batch-5-report.md`.
- Recorded outcomes: `harness:apply` params carry no session id, so no proposal cleanup was
  wired (30-day prune covers stale records). R9 Electron e2e event-injection specs and the
  629-owned webview routing spec were not retargeted (deferred per plan).
- Commit note: the subject of 48fbb5673 is 73 characters, one over the repo's 72-character
  rule (commitlint enforces 100, so the hook passed). Not amended, per the no-amend rule.
- Interim state (must not ship): the producer broadcast is gone, but the webview still waits
  for it. `harness-workflow-message.handler.ts` (frontend relay) and
  `setup-hub.component.ts:1440` ignore the success payload. Until Batch 6 lands, Setup Hub
  New Project returns success and focuses chat, but no workflow or seed prompt opens. Do not
  merge or release this branch between Batch 5 and Batch 6.

## Run status (2026-10-13, Phase 1 accepted)

- Phase 1 (Batches 1-5 plus fix Batch 16) is COMPLETE and ACCEPTED. The re-review of commit
  678f0d632 returned code-logic APPROVED WITH FIXES 8/10 (3 Minor) and style APPROVED 8/10
  (4 Minor). Under the one-fix-round rule the Minors are recorded, not fixed (see "Phase 1
  re-review disposition"). One exception: the prettier drift is fixed in 8afe14ce5.
- Batch 17 COMPLETE (94eb0149d). Batch 9 (Phase 2B) COMPLETE (9f98ea07c). Phase 2B review
  APPROVED 8.5/10 (`code-logic-review-phase-2b.md`; see "Phase 2B review disposition").
  Test-only fix Batch 18 COMPLETE (ae20af1ca). Batch 10 COMPLETE (27bf6b468). Batch 11 COMPLETE (93fe34db7). Batch 12 COMPLETE (54f4932c0). Batch 13 COMPLETE (29519e705). Phase 3 review: logic APPROVED WITH FIXES 6/10, style
  APPROVED WITH FIXES 6.5/10 (see "Phase 3 review disposition"). Fix round: Batches 19-22, then
  one re-review. Batch 14 waits for that re-review to be accepted.
- FRONTEND HOLD (user, 2026-10-13, binding; context.md "Frontend hold", decisions D7-D9):
  Batches 6, 7 (Tasks 7.2, 7.3) and 8 do not start until TASK_2026_629 merges and the user
  confirms it. Never touch `libs/frontend/{canvas,chat,chat-ui,chat-streaming,chat-state,
chat-types}` or `apps/ptah-extension-webview` in any batch. The orchestrator asks the user
  before it starts Batch 6.
- New Project stays broken on this branch until Batch 6 lands (Batch 5 interim state above).
  No merge, release or PR before Phase 2F is accepted.

## Phase 1 review disposition (one fix round)

Rule: Blocking and Serious are fixed. Moderate is fixed only if it can break a lane config or
lose data; otherwise it gets a named follow-up. Minor is recorded. `L` = code-logic finding
number, `S` = style finding number.

| Finding                                                      | Severity            | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 release ENOENT turns a good save into a failure           | Serious             | Fixed, Task 16.1. harness-sync `heldHandle.release` uses `rmSync(..., {force: true})` in a try/catch, so it never throws (`file-lock.ts:212-223`). Spec: Task 16.2                                                                                                                                                                                                                                                                                                                                                                                                   |
| L2 two holders after stale recovery                          | Serious             | Fixed for this diff, Task 16.1: the store's own recovery code is deleted. Residual, verified in `file-lock.ts:181-210`: `breakIfStale` reads the payload and then calls `rmSync` (check-then-remove), and `release` removes by path, so two processes breaking the same crash-left lock at the same instant can still both proceed. This code predates this task and every `withFileLock` caller shares it. It needs a lock older than 10 s left by a crashed process. Worst case is one lost partial merge, never a torn file (atomic rename). Not fixed here: FU-1 |
| L3 one corrupt record stops prune                            | Moderate            | Fixed, Task 16.1 (same file, small): log and continue per file; drop invalid records older than retention                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| L4 sessionId not trimmed or validated before hashing         | Moderate, data loss | Fixed, Tasks 16.1 and 16.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| L5 wait (1 s) < stale (5 s)                                  | Moderate            | Fixed, Task 16.1: stale 10 s, wait 12 s (harness-sync defaults 30 s / 5 s would keep the defect)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| L6 prune on every get and save                               | Moderate            | Recorded, FU-3 (cost, no data loss)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| L7 explicit `undefined` overwrites saved fields in the merge | Moderate, data loss | Fixed, Tasks 16.3 and 16.4 (in the shared merge, so Batch 8 inherits it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L8 apply-time delete not wired                               | Moderate            | As planned: Task 5.1 recorded that `harness:apply` params carry no session id; the 30-day prune covers it. No fix                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| L9 `seedPrompt` consumed only from Batch 6                   | Minor               | As planned: Batch 6 (held, D7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| L10 merge output aliases input arrays                        | Minor               | Recorded, FU-4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Check 8 (no multi-process or concurrent-stale test)          | Moderate            | Partly closed: Task 16.1 moves locking to harness-sync, which owns its lock tests. A real two-process test is part of FU-1                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S1 hand-rolled lock and queue                                | Serious             | Fixed, Task 16.1 (`serializeByKey` + `withFileLock`; `HarnessProposalLockError` removed in favour of `FileLockTimeoutError`)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S2 typed errors outside the port contract                    | Moderate            | Partly, Task 16.1: the store class JSDoc lists every rejection and its type or code. The port and barrel docs in platform-core are FU-2 (a third lib; docs only)                                                                                                                                                                                                                                                                                                                                                                                                     |
| S3 thin port and token docs                                  | Moderate            | Recorded, FU-2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S4 `z.custom` on `configUpdates`                             | Moderate            | Recorded. The existing round-trip spec (`store.spec:148-162`) pins a normalised record. FU-5 for aligning the schema output type                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S5 `as` casts in the merge                                   | Moderate            | Recorded, FU-4 (Batch 8 deletes the frontend copy; held)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S6 sessionId constraint duplicated                           | Minor               | Partly, Task 16.3: `HarnessSessionIdSchema` exported from shared and used by the stored-record schema and the store. Switching `HarnessGetProposalParamsSchema` (`harness-rpc.schema.ts:195-197`) to it is FU-6                                                                                                                                                                                                                                                                                                                                                      |
| S7 DI header comment                                         | Minor               | Recorded, FU-6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S8 stale doc comments                                        | Minor               | Recorded; the frontend comment goes with Batch 6, the shared union JSDoc is FU-6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S9 static queue on a singleton                               | Minor               | Fixed as a side effect of S1 (`serializeByKey` owns the map)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Named follow-ups, all outside this run's batches; Mode 3 lists them in the handoff:

- FU-1 harness-sync `file-lock.ts`: owner-token release (remove only if the payload is still
  ours, ignore ENOENT) and rename-based stale break (rename to a unique name, re-check `at`,
  then delete), plus a two-process test. Affects every `withFileLock` caller, so it gets its
  own task, not a fix batch here.
- FU-2 platform-core: `IHarnessProposalStore` header (adapter, registration site, merge
  semantics, meaning of `complete`, rejection cases and codes) and the
  `HARNESS_PROPOSAL_STORE` token JSDoc to match `SESSION_ORGANIZATION_RECORDER`.
- FU-3 throttle the proposal prune (for example once per hour per directory).
- FU-4 merge utility: copy output arrays (L10); type `merged` as `Partial<HarnessConfig>` with
  one commented cast per section (S5); decide whether `name: ''` may clear.
- FU-5 align `HarnessConfigUpdatesSchema` output with `Partial<HarnessConfig>` so the
  `z.custom` bridge can go.
- FU-6 small docs and reuse: `HarnessGetProposalParamsSchema` uses `HarnessSessionIdSchema` and
  `satisfies z.ZodType<HarnessGetProposalParams>`; `harness/di.ts` header and DAG note for the
  platform-token binding; JSDoc on the `HarnessStartNewProjectResult` union.

## Phase 1 re-review disposition (fixes only, commit 678f0d632)

Reviews: `code-logic-rereview.md` (APPROVED WITH FIXES, 8/10; L1-L5 and L7 Closed) and
`code-style-rereview.md` (APPROVED, 8/10; S1, S2 as scoped, finding 6 and finding 9 Closed).
This was the one re-review. Its Minors are recorded, not fixed, except the formatting item.
`RL` = logic re-review finding, `RS` = style re-review finding.

| Finding                                                                                      | Severity | Disposition                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RL1 spec does not pin wait > stale                                                           | Minor    | Recorded, FU-7                                                                                                                                                                                                                                                                                             |
| RL2 callers now see `ZodError` / `FileLockTimeoutError`, not `HarnessProposalLockError`      | Minor    | Routed to Task 9.3. The only `save` caller is the MCP `proposeConfig` path (Batch 9), and Task 9.3 maps every store rejection to a clear `isError` result. `harness:get-proposal` validates its params before `get`. The orchestrator confirmed no `HarnessProposalLockError` reference remains in `libs/` |
| RL3 in-process queue held during the 12 s cross-process wait                                 | Minor    | Recorded, FU-8                                                                                                                                                                                                                                                                                             |
| RS1 class JSDoc sits between `@injectable()` and the class                                   | Minor    | Recorded, added to FU-6                                                                                                                                                                                                                                                                                    |
| RS2 Phase 1 files not prettier-clean                                                         | Minor    | Fixed in 8afe14ce5 (9 files, formatting only; shared and rpc-handlers typecheck, test and lint pass). Cause and prevention: "Git hooks inactive in this worktree" below                                                                                                                                    |
| RS3 `prune` is three nested `try` blocks                                                     | Minor    | Recorded, added to FU-3 (extract `pruneRecord`)                                                                                                                                                                                                                                                            |
| RS4 specs hard-code harness-sync's lock payload and the 10 s stale value; bare `require` spy | Minor    | Recorded, added to FU-7                                                                                                                                                                                                                                                                                    |

Named follow-ups added by the re-review (outside this run's batches; Mode 3 lists them):

- FU-3 (extended): extract `pruneRecord(file, cutoff)` from the per-file loop (RS3).
- FU-6 (extended): move the store's class JSDoc above `@injectable()` (RS1).
- FU-7 store spec hygiene: pin wait > stale with exported constants or a 9 s-old lock recovered
  in one call (RL1); name the stale value as a constant, and add one comment line on why
  `require('fs/promises')` is spied (RS4).
- FU-8 measure the 12 s worst-case in-process wait against the RPC/MCP call timeout; shorten
  `PROPOSAL_LOCK_WAIT_MS` or fail fast if it can exceed it (RL3).

## Git hooks in this worktree (found inactive 2026-10-13; restored by D10)

- Current state (2026-10-13, D10): the orchestrator ran `npx husky` in this worktree, so
  `.husky/_` exists again and `core.hooksPath=.husky/_` resolves. pre-commit (lint-staged),
  commit-msg (commitlint) and pre-push (di-lint, Electron `validate-deps`) run from the Batch 9
  commit on. A failing hook is never bypassed: fix the cause or stop and report.
- Decision (team-leader, recorded): keep the `npx prettier --check` step in every remaining
  batch's verification as a cheap guard. lint-staged formats staged files at commit time, which
  would change files after the scoped checks ran; the check makes the lane hand over files that
  are already formatted, so the committed bytes are the verified bytes. The manual
  `npx commitlint --edit` step is dropped (the commit-msg hook runs it). Explicit di-lint runs
  stay where a batch's verification names them; pre-push also runs it.
- History (kept for the record; it explains commits before the Batch 9 commit):

- `core.hooksPath` is the relative path `.husky/_`, which git resolves per working tree. The main
  checkout has `.husky/_` (generated by husky from `npm install`'s `prepare` script). This
  worktree has no `.husky/_`, because `npm install` never ran here (`node_modules` is a
  junction). So git finds no hooks: pre-commit (lint-staged `nx format:write` plus affected
  lint), commit-msg (commitlint) and pre-push (di-lint, Electron `validate-deps`) were all
  skipped for every commit on this branch. Commit 8afe14ce5 also ran with no hook output.
- Mitigation for the rest of this run (hooks are not changed): every remaining batch's
  verification now includes `npx prettier --check` on its changed files. The team-leader
  re-checks that before each commit and runs `npx commitlint --edit <msg file>` on each
  message. Because pre-push would not run either, the di-lint and `validate-deps` gates must be
  run explicitly before any push.
- Recommendation for the orchestrator or user: run `npx husky` once in this worktree to
  regenerate `.husky/_`. This restores the hooks without changing them. Until that happens, the
  manual checks above stand in for the hooks.

## Batch 16: Phase 1 review fixes (proposal store lock reuse, sessionId, merge) - COMPLETE (commit 678f0d632; formatting 8afe14ce5; Phase 1 ACCEPTED: code-logic-rereview.md, code-style-rereview.md)

- Recommended executor: implementation CLI lane (codex, roster in context.md), one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the store rewrite, its spec and the shared schema and merge it depends on are one
  coupled change. 5 files in 2 libs, one verification command.
- Tasks: 4 | Depends on: Batches 1-5
- Phase: 1 - Proposal backend (fix batch; last batch of the phase) | Phase review: the one
  re-review, scoped to this batch's commit: code-logic, plus style (public error surface)
- Lane limits: at most 40 tool calls. No git commands. Do not edit `batches.md`, `task.md` or
  any file not listed in this batch. Never touch `libs/frontend/**` or
  `apps/ptah-extension-webview/**`.
- Worktree root, every command runs here:
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions`. Never `cd` to
  `D:/projects/ptah-extension`. `node_modules` is a junction to the main repo; keep it.

### Task 16.1: Store reuses the harness-sync lock; validated sessionId; prune survives bad files - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts`
- Depends on: Task 16.3 (`HarnessSessionIdSchema`)
- Review reference: `code-logic-review.md` findings 1-5; `code-style-review.md` findings 1, 2, 9
- Pattern to follow: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/harness-sync/src/lib/lock/file-lock.ts`
  (`serializeByKey` `:135`, `acquireFileLock` `:234`, `withFileLock` `:298`, all exported from
  `@ptah-extension/harness-sync`, barrel `src/index.ts:114-122`). `rpc-handlers` already
  imports that barrel (`handlers/harness-rpc.handlers.ts:38`).
- Quality requirements:
  - Delete the static `queues` map, `acquireLock`, `HarnessProposalLockError` and the
    `LOCK_STALE_MS`, `LOCK_WAIT_MS`, `LOCK_RETRY_MS` constants. Replace them with
    `serializeByKey(file, ...)` around the work, and inside it
    `withFileLock(`${file}.lock`, task, { staleAfterMs: PROPOSAL_LOCK_STALE_MS, maxWaitMs: PROPOSAL_LOCK_WAIT_MS })`.
  - `PROPOSAL_LOCK_STALE_MS = 10_000` and `PROPOSAL_LOCK_WAIT_MS = 12_000`, each with a
    one-line comment: wait is longer than stale, so a lock left by a crashed process is
    broken inside one call (L5); stale is far above the critical section (one read, merge,
    temp write, rename). Do not use the harness-sync defaults (30 s stale, 5 s wait): they
    keep the L5 defect.
  - A lock timeout now rejects with harness-sync `FileLockTimeoutError`, with nothing written.
  - `save` and `get` first parse the id with `HarnessSessionIdSchema` (Task 16.3), before
    `requireRoot()` and before any file system effect (no `mkdir`, no prune, no lock). Use the
    trimmed id everywhere: the file-name hash, the stored `sessionId`, and the read-time
    identity comparison. An empty, whitespace-only or over-256-character id rejects (ZodError
    from the parse).
  - Order inside `save`: validate id, resolve root, then `serializeByKey(file, async () => { mkdir; prune; return withFileLock(lock, async () => { re-read; merge; HarnessProposalSchema.parse; atomic write; return }) })`.
    Keep the existing `read` (corrupt or mismatched record warns and returns null) and the
    existing `write` (`wx` temp file plus rename, temp removed on failure). Keep the merge call
    `mergeHarnessConfigUpdates(current?.configUpdates ?? {}, mergeHarnessConfigUpdates({}, update))`.
  - `prune` (L3): only the outer `readdir` failure is caught at the outer level (ENOENT silent,
    others warn). Each file is handled in its own try/catch that logs a warning with the file
    name and continues. It never rethrows, so one bad file never stops the loop. Keep the skip
    when `${file}.lock` exists. Valid records older than 30 days by `updatedAt` are deleted, as
    today. Records that fail JSON parse or schema validation are deleted when the file's
    `mtimeMs` (from `fs.stat`) is older than 30 days, and kept (warned) otherwise.
  - Class JSDoc (S2): root comes from the workspace provider; merge, not replace; and the
    rejections: `HarnessProposalWorkspaceError` (`code` `HARNESS_PROPOSAL_NO_WORKSPACE`), a
    ZodError for an invalid session id, `FileLockTimeoutError` from `@ptah-extension/harness-sync`,
    and file system errors. Keep `HarnessProposalWorkspaceError` exported where it is.
  - Constructor and `@inject` list unchanged (no DI change). Net result should be shorter than
    today's 223 lines. No TODO, stub or placeholder.
- Validation notes: L2 residual is FU-1 (not in this batch). Do not edit `file-lock.ts`. The
  lock directory comes from `acquireFileLock` (`mkdirSync` of the lock's parent), so the
  `no-lock-directory` path runs unlocked by design (the write then fails on the same
  directory); do not add handling for it.

### Task 16.2: Store spec for the fixes - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts`
- Depends on: Task 16.1
- Quality requirements:
  - Keep every existing case passing. Replace the `HarnessProposalLockError` import with
    `FileLockTimeoutError` from `@ptah-extension/harness-sync`.
  - Lock files now hold the harness-sync payload `{"pid": <n>, "at": <epoch ms>}`, and
    staleness is read from `at`, not from mtime. A lock file whose content is not that JSON is
    treated as stale and broken at once (`file-lock.ts:181-210`). So:
    - held-lock case: write `{pid: 999999, at: Date.now() + 60_000}` so it is never stale
      within the wait; assert `FileLockTimeoutError` and that no record file exists.
    - expired-lock case: write `{pid: 999999, at: Date.now() - 11_000}`; assert the save
      succeeds and the lock file is gone afterwards.
  - No test may wait 12 s of real time. Control time with `jest.spyOn(Date, 'now')` (the
    harness-sync deadline and staleness read `Date.now()`) or Jest modern fake timers, and
    restore them in `afterEach`. Each case finishes in well under 2 s.
  - New cases:
    - L1: the lock file is removed while the save holds it (for example a spy on the
      `fs/promises` `rename` that deletes `${file}.lock` and then calls through); the save
      resolves and a new store instance reads the record.
    - L4: `save(' a ', ...)` stores `sessionId: 'a'` in the file named by `sha256('a')`;
      `get('a')` and `get(' a ')` both return it. `save('')`, `save('   ')` and a
      257-character id reject, and the `.ptah/harness/proposals` directory was not created.
    - L3: an unparseable `<64 hex>.json` whose mtime is older than 30 days (`fs.utimes`) is
      deleted, an expired valid record in the same directory is still deleted in the same
      pass, and an unparseable recent file is kept.
    - L7 at the store level: save `persona` with a label, then save
      `{persona: {label: undefined}}` (cast as needed); a new store instance still reads the
      first label.

### Task 16.3: Shared `HarnessSessionIdSchema`; merge ignores explicit `undefined` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/utils/merge-harness-config-updates.ts`
- Review reference: `code-logic-review.md` findings 4 and 7; `code-style-review.md` finding 6
- Quality requirements:
  - In `rpc-harness.schemas.ts`, export
    `HarnessSessionIdSchema = z.string().trim().min(1).max(256)` with a JSDoc (the real SDK
    session id; trimmed; the proposal store hashes the trimmed value). Use it for
    `HarnessProposalSchema.sessionId` (`:466`). It reaches `@ptah-extension/shared/schemas`
    through the existing `export *` (`libs/shared/src/schemas.ts:28`); add no barrel line.
  - In the merge, add one small module-private helper that copies an object without its
    `undefined`-valued keys. Apply it to the update side of the `persona`, `prompt` and
    `claudeMd` spreads and of the `agents.enabledAgents` and `mcp.enabledTools` spreads, so an
    explicit `undefined` never replaces a base value. Change nothing else: array replacement,
    the `name` truthiness check and the `selectedSkillRefs` logic stay as they are (FU-4).
    Add no new `as` cast. Do not add `null` handling; if you find that
    `HarnessConfigUpdatesSchema` accepts `null` for any section field, say so in the report.
- Validation notes: the frontend keeps its own merge copy until Batch 8 (held); do not touch it.

### Task 16.4: Merge spec - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/utils/merge-harness-config-updates.spec.ts`
- Depends on: Task 16.3
- Quality requirements: the four existing cases pass unchanged. Add: an explicit `undefined`
  in `persona`, `prompt` and `claudeMd` keys keeps the base values; `undefined` values in
  `agents.enabledAgents` and `mcp.enabledTools` keep the base entries; neither input is
  mutated.

### Batch 16 verification

- Command (foreground, long timeout, output tailed; one heavy check at a time):
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -40`
  Confirm the header says "Running targets typecheck, test, lint for 2 projects".
- No DI change is expected. If the store's constructor or any `@inject` changes, also run
  `npx nx run di-lint:lint`.
- Memory-safe rules (CLAUDE.md): only these projects; `--parallel=1`; for a single spec use
  `npx jest -c libs/backend/rpc-handlers/jest.config.ts <spec> --coverage=false --maxWorkers=2`;
  never `build`, `serve`, `e2e` or `package`; never a workspace-wide run.
- Lane report: every file path changed, the evidence per task, how L1-L5, L7 and S1 are closed,
  and the answer on `null` from Task 16.3.
- After commit: the Phase 1 re-review is due, scoped to the Batch 16 commit. Done: accepted
  (code-logic-rereview.md, code-style-rereview.md). Formatting follow-up 8afe14ce5.

## Batch 6: Direct New Project handoff in Setup Hub - COMPLETE (commit f576fd028)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: frontend-developer sub-agent
- Execution mode: sequential
- Rationale: extracting a service, adding its spec and wiring its one caller is cross-file and
  coupled.
- Tasks: 3 | Depends on: Batches 5, 16
- Phase: 2F - Builder adapters (frontend) | Phase review: code-logic, after Batch 8
- HELD (D7, user 2026-10-13): does not start until TASK_2026_629 merges and the user confirms.
  The orchestrator asks the user first.

### Task 6.1: RPC wrapper: typed handoff result and `getProposal` (F21) - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-rpc.service.ts`
- Pattern to follow: the existing `startNewProject` wrapper in the same file
- Quality requirements: `startNewProject` returns the new union. Add `getProposal(sessionId): Promise<HarnessGetProposalResult>`.

### Task 6.2: Extract `HarnessWorkflowRequestService` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.spec.ts` (new)
- Plan reference: implementation-plan.md:60
- Pattern to follow: `harness-workflow-message.handler.ts:100-141` (request plus navigate)
- Quality requirements: same-mode resume, cross-mode abort and replacement, `AppStateManager.requestHarnessWorkflow`, navigation. Navigation failure rolls back (clears) the request and reports failure to the caller. The spec covers all four paths. Do not edit `libs/frontend/core`.
- Validation notes: R10. The relay copy is removed in Task 7.2.

### Task 6.3: Setup Hub uses the returned handoff - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/components/setup-hub.component.spec.ts`
- Plan reference: implementation-plan.md:60
- Pattern to follow: the intake submit at `setup-hub.component.ts:1440-1458`
- Quality requirements: on success, call the request service with `seedPrompt` and close the modal only after the request and navigation complete. Navigation failure keeps the modal open and clears the pending request. An RPC failure keeps the existing error display. No template or visual change.
- Validation notes: R11 (screenshots at Mode 3).

### Batch 6 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder --parallel=1`

## Batch 7: Session-filtered proposal consumer, hydration and compatibility relay - COMPLETE (commit 0365fdda0, after one orchestrator fix round F1-F4: batch-7-report.md)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: frontend-developer sub-agent
- Execution mode: sequential
- Rationale: the session filter, hydration and relay delegation live in one handler and its
  spec. The payload contract they read lands earlier, in Batch 9 (Task 9.0).
- Tasks: 2 | Depends on: Batches 6, 9 (Task 9.0 adds the `sessionId` this batch filters on)
- Phase: 2F - Builder adapters (frontend) | Phase review: code-logic, after Batch 8
- HELD (D7, user 2026-10-13): does not start until TASK_2026_629 merges and the user confirms.

Task 7.1 (`sessionId` on `HarnessConfigProposedPayload`) moved to Batch 9 as Task 9.0 (D8).

### Task 7.2: Filter, hydrate and delegate the relay - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts`;
  reserve ownership, edited only if hydration cannot live in the handler:
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts` and its `.spec.ts`
- Plan reference: implementation-plan.md:46 (last sentences), 50
- Pattern to follow: the current switch at `harness-workflow-message.handler.ts:34-150`
- Quality requirements: apply `HARNESS_CONFIG_PROPOSED` only when `payload.sessionId` equals `HarnessWorkflowService.sessionId()`. When that id becomes non-null or changes, call `getProposal` and apply the snapshot to fresh state. Buffer live events for that session while the call is in flight and replay them after (R4). A `getProposal` failure is logged and keeps live state. The `HARNESS_OPEN_WORKFLOW` case stays, and its body delegates to `HarnessWorkflowRequestService`. Delete the handler's own request/navigation code (R10). Report whether the reserve files were used.

### Task 7.3: Handler spec - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts`
- Quality requirements: the legacy open-workflow event still navigates through the request service. A matching session applies. A non-matching session is ignored. Reload hydrates only the matching session before any new tool call. Live event during hydration arrives after the snapshot. Hydration failure is non-fatal.

### Batch 7 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder --parallel=1`
  (shared is no longer changed here; it moved to Batch 9 with Task 9.0)

## Batch 8: Frontend adopts the shared merge - COMPLETE (commit 0a9785d87)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: frontend-developer sub-agent
- Execution mode: sequential
- Rationale: one service and its existing spec.
- Tasks: 1 | Depends on: Batches 2, 7, 16 (Task 16.3 changes the shared merge it adopts)
- Phase: 2F - Builder adapters (frontend), last batch of the phase | Phase review: code-logic
- HELD (D7, user 2026-10-13): does not start until TASK_2026_629 merges and the user confirms.

### Task 8.1: Replace the local merge with `mergeHarnessConfigUpdates` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.spec.ts`
- Plan reference: implementation-plan.md:46
- Quality requirements: `applyConfigUpdates` delegates to the shared function. The old helpers at `:325-410` are deleted. Existing spec cases pass unchanged. Add one case asserting state equals `mergeHarnessConfigUpdates` output for a mixed update.

### Batch 8 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder --parallel=1`
- After commit: the Phase 2F review is due (Batches 6-8, combined diff of their commits).

## Batch 9: Session-scoped MCP proposal writer - COMPLETE (commit 9f98ea07c; Phase 2B ACCEPTED: code-logic-review-phase-2b.md)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the payload contract (Task 9.0), the namespace dependency, its builder wiring and
  the dispatcher path are one call chain.
- Tasks: 4 | Depends on: Batches 3, 4, 16 (no longer Batch 7, D8)
- Phase: 2B - MCP writer (backend; the only batch of the phase) | Phase review: code-logic
- Size note: 7 files in 2 libs (shared, vscode-lm-tools), one over the 6-file cap. Accepted
  because the user moved Task 9.0 in (D8) and it is a one-field type change.
- Starts only after the Phase 1 re-review accepts Batch 16. Accepted 2026-10-13; started.
- Verification 1 (team-leader, 2026-10-13, report `batch-9-report.md`): NOT ACCEPTED, not
  committed. Scoped checks pass (prettier check on the 7 files exit 0; run-many typecheck, test,
  lint "for 2 projects" exit 0; harness-builder typecheck exit 0; no constructor, `@inject` or
  token change, so di-lint not required). Tasks 9.0-9.2 verified on disk. Task 9.3 regresses
  invalid-input reporting: `harnessProposalErrorMessage` (`protocol-dispatcher.ts:2728-2756`)
  maps every error that is not a ZodError, lock timeout, coded error or no-session message to
  "Harness proposal could not be saved. Retry if the session and storage are available."
  That includes the namespace's own `Invalid configUpdates: <path>: <message>` throw
  (`harness-namespace.builder.ts:1085`), which reached the agent verbatim before this batch and
  which the dispatcher comment at `protocol-dispatcher.ts:2237-2238` still promises. An agent
  that sends a bad field now loses the offending path and is told to retry unchanged input.
  Fix required in the same files: the invalid-input error reaches the agent with its field
  path and says to correct `configUpdates` (not retry as is); match namespace-thrown errors by
  error `name` (or a named error), not by message regex; add a dispatcher spec case for the
  invalid-input path. This is a pre-commit rejection, not the phase fix round.
- Verification 2 (team-leader, 2026-10-13, report `batch-9-report.md` "Verification 1 fix"):
  code ACCEPTED, commit BLOCKED by the pre-commit hook. The namespace throws named
  `HarnessConfigUpdatesError` and `HarnessProposalNoSessionError`
  (`harness-namespace.builder.ts:39-45,1093,1100`); the dispatcher matches by `error.name`
  (`protocol-dispatcher.ts:2728-2737`), keeps the field path and appends "Correct configUpdates
  and try again."; no message regex remains. New spec `reports an invalid configUpdates field
path with correction guidance` (`protocol-dispatcher.spec.ts:639`). Checks re-run by the
  team-leader: prettier check on the 7 files exit 0; run-many typecheck, test, lint "for 2
  projects" exit 0; harness-builder typecheck exit 0. Tasks 9.0-9.3 IMPLEMENTED.
  `git commit` failed in pre-commit (lint-staged `nx affected --target=lint`):
  `degradation-audit:lint` reports `libs/backend/rpc-handlers: 4 FAIL (baseline 1)`. The three
  new sites are Phase 1 code committed before D10 restored the hooks, not Batch 9 code:
  `harness-proposal-store.service.ts:145` (catch-return-sentinel), `:157`
  (promise-catch-sentinel), `:166` (catch-return-sentinel). Batch 9's own directories pass
  (`vscode-lm-tools: 2 ok (baseline 2)`, `libs/shared/src: 3 ok (baseline 3)`). The audit scans
  the whole repo, so every commit fails until Batch 17 lands. Batch 9 commits right after
  Batch 17, with no further executor work.

### Task 9.0: `sessionId` on the config-proposed payload (moved from Task 7.1, D8) - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/messages/payload-map.ts`
- Quality requirements: required `sessionId: string` on `HarnessConfigProposedPayload` (`:217`)
  only, with a JSDoc (the real SDK session id the proposal was saved under). `HarnessOpenWorkflowPayload` (`:199-200`) and its map entry (`:417`) are unchanged.
- Validation notes: the only typed consumer, `libs/frontend/harness-builder/.../harness-workflow-message.handler.ts:145`,
  only casts the payload, so it still compiles. Do not edit any frontend file (D7); the
  harness-builder typecheck below is read-only confirmation.

### Task 9.1: `proposeConfig` persists, then broadcasts with `sessionId` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts`
- Plan reference: implementation-plan.md:24, 46
- Pattern to follow: the current `proposeConfig` at `harness-namespace.builder.ts:1066-1090`
- Quality requirements: add `getCallerSdkSessionId` and `saveProposal` to `HarnessNamespaceDependencies`. Validate with Zod first. A missing session id throws a tool error, with no save and no broadcast. Await `saveProposal`, and on failure throw with no broadcast. Then broadcast `{sessionId, configUpdates, isConfigComplete}`. A missing broadcaster is non-fatal. The spec covers absent id, save failure, persist-before-broadcast order and the `sessionId` in the payload (F17).
- Validation notes: R5. Type the broadcast payload as `HarnessConfigProposedPayload` (Task 9.0)
  and broadcast the `sessionId` of the record `saveProposal` returned (the store trims it,
  Task 16.1). A store rejection (`FileLockTimeoutError`, invalid id, no workspace) is a save
  failure: no broadcast.

### Task 9.2: `PtahAPIBuilder` wiring - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts`
- Pattern to follow: the per-call container lookup (`:509-516`), `resolveCallerSdkSessionId` (`:1035-1066`), harness wiring (`:860-883`)
- Quality requirements: `getCallerSdkSessionId: () => this.resolveCallerSdkSessionId()`. `saveProposal` resolves `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE` from `this.container` per call, and an absent container or store is a thrown error. Never use `resolveSessionWorkspaceRoot` for proposals. The spec covers the builder correlation id resolving after lifecycle assigns `realSessionId`, and a tab id never persisted.

### Task 9.3: Dispatcher error path - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Pattern to follow: `protocol-dispatcher.ts:2222-2249`
- Quality requirements: an unresolved-session or persistence rejection comes back as an `isError` tool result with a clear message, not a crash. Edit the dispatcher only if the existing throw path does not already produce that. Add a spec case either way.
- Validation notes (Phase 1 re-review RL2): the store now rejects with `ZodError` (invalid or
  blank session id), `FileLockTimeoutError` from `@ptah-extension/harness-sync` (lock held past
  12 s), `HarnessProposalWorkspaceError` (code `HARNESS_PROPOSAL_NO_WORKSPACE`) and file system
  errors. `HarnessProposalLockError` no longer exists. Each must reach the agent as an `isError`
  result whose text says what failed and whether a retry can help. A lock timeout is retryable.
  Never surface a raw Zod issue dump. Spec: at least the lock-timeout and the no-session cases.

### Batch 9 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-lm-tools --parallel=1 && npx nx typecheck @ptah-extension/harness-builder`
  Confirm the first header says "for 2 projects". The harness-builder typecheck is a
  read-only consumer check of Task 9.0; it edits nothing.
- If any constructor, `@inject` or DI token use changes (for example in
  `ptah-api-builder.service.ts`), also run `npx nx run di-lint:lint`. The pre-push hook that
  would run it was inactive until D10; it runs again on push.
- After commit: the Phase 2B review is due (Batch 9 only, its commit).

## Batch 17: Degradation-audit markers on the Phase 1 proposal store - COMPLETE (commit 94eb0149d)

- Recommended executor: backend-developer sub-agent (one file, three comment markers)
- Fallback executor: implementation CLI lane, one lane
- Execution mode: sequential
- Rationale: one file, no behavior change; it unblocks the pre-commit hook for every later
  commit. Committed before Batch 9, as its own `fix(rpc-handlers)` commit.
- Tasks: 1 | Depends on: Batch 16 (committed)
- Phase: 1 - Proposal backend (post-acceptance hook fix) | Phase review: none - comment markers
  only, no executable change. Must not change any statement, return value or log call.
- Lane limits: no git commands. Do not edit `batches.md`, `task.md` or any other file. Never
  touch `libs/frontend/**` or `apps/ptah-extension-webview/**`. Worktree root, every command runs
  here: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions`; never
  `cd` to `D:/projects/ptah-extension`; keep the `node_modules` junction.

### Task 17.1: Annotate the three flagged sites in the proposal store - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts`
- Evidence: pre-commit `degradation-audit:lint` output, 2026-10-13: `:145` catch-return-sentinel
  (corrupt record JSON, logs a warning, returns null), `:157` promise-catch-sentinel
  (`fs.unlink(temp).catch(() => undefined)` best-effort temp cleanup before the original error
  is rethrown), `:166` catch-return-sentinel (`prune` readdir failure, warns unless ENOENT, then
  returns).
- Pattern to follow: the marker grammar in
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/tools/degradation-audit/check-degradation.ts:28-56,100-107`
  (`// degradation-audit: <optional-capability|reported> - <reason>`, in the comment run directly
  above the construct, as the first comment lines inside the catch body, or, for `.catch(...)`,
  directly above the statement). Example usage:
  `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:205,230`.
- Quality requirements: each marker carries a true, specific reason (`reported` where the site
  logs a warning; `optional-capability` for the best-effort temp unlink, whose original error is
  rethrown). Code is otherwise unchanged. No `bare-suppression` or `orphaned-suppression`. Do not
  run `--update-baseline`; the baseline stays at 1 for `libs/backend/rpc-handlers`.

### Batch 17 verification

- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`
  exits 0, with `libs/backend/rpc-handlers: 1 ok (baseline 1)` in its totals (filter the output
  with `grep`).
- `npx prettier --check` on the changed file, then
  `npx nx run-many -t lint,test -p @ptah-extension/rpc-handlers --parallel=1` (tailed).
- Then the team-leader commits Batch 17, then Batch 9 (already verified), then requests the
  Phase 2B review on the Batch 9 commit.

## Phase 2B review disposition (2026-10-14)

Review: `code-logic-review-phase-2b.md` (antigravity family; implementer codex), APPROVED
8.5/10, no Critical, Blocking or Serious finding. Phase 2B is ACCEPTED. Per the fix-round rule,
only the test gaps go into one small test-only fix batch (Batch 18), because they are cheap and
pin the name contract that the dispatcher depends on.

| Finding                                                       | Severity       | Disposition                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Dispatcher specs never use the real error classes' `name`   | Moderate, test | Fixed in Batch 18 (Task 18.1): the builder spec asserts the real `.name` values `HarnessConfigUpdatesError` and `HarnessProposalNoSessionError`, so a rename breaks a test on the producer side as well as the dispatcher side                                                             |
| 2 `ZodError` branch may miss a zod 4 `$ZodError` name         | Minor          | Verified, no change. The orchestrator checked this repo's zod 4: `z.string().parse(1)` throws an error whose `name` and constructor name are both `ZodError`, so `error.name === 'ZodError'` (`protocol-dispatcher.ts:2739`) matches. Batch 18 adds a dispatcher spec case for this branch |
| 3 "proposal store unavailable" falls into the generic message | Minor          | No change. The generic text ("Retry if the session and storage are available") is accurate for that state and leaks nothing; the specific text stays in the host log                                                                                                                       |
| 4 Dispatcher spec covers 3 of 7 branches                      | Minor, test    | Fixed in Batch 18 (Task 18.2): cases for `HARNESS_PROPOSAL_NO_WORKSPACE`, an fs `code` (for example `EACCES`), and a real `ZodError`                                                                                                                                                       |
| 5 `getLaneLimits` reflow; webview ignores `sessionId`         | Minor          | No change. The reflow is formatting only. Filtering by `sessionId` in the webview is Task 7.2, held with the frontend (D7)                                                                                                                                                                 |
| 6 `broadcast?.` on a required dep                             | Minor          | No change. Harmless; the proposal is already persisted before the broadcast, so a missing webview manager loses no data                                                                                                                                                                    |

## Batch 18: Phase 2B review test fixes (error-name contract and dispatcher branches) - COMPLETE (commit ae20af1ca)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: senior-tester sub-agent
- Execution mode: sequential
- Rationale: two spec files in one lib; test-only, no production change.
- Tasks: 2 | Depends on: Batch 9
- Phase: 2B fix (test-only) | Phase review: none (tests only)

### Task 18.1: Builder spec asserts the real error names - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts`
- Pattern to follow: the existing `rejects.toThrow(/Invalid configUpdates/)` (`:424`) and
  `rejects.toThrow(/no SDK session/)` (`:463`) cases.
- Quality requirements: in those two cases (or beside them), also assert the rejection's
  `name` is exactly `'HarnessConfigUpdatesError'` and `'HarnessProposalNoSessionError'`
  (for example `rejects.toMatchObject({ name: '...' })`). No production file changes; the
  classes stay non-exported.

### Task 18.2: Dispatcher spec covers the remaining branches - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Pattern to follow: the existing `ptah_harness_propose_config` error cases (`:615-650`).
- Quality requirements: three cases through `harnessProposalErrorMessage`
  (`protocol-dispatcher.ts:2728-2758`): an error with `code: 'HARNESS_PROPOSAL_NO_WORKSPACE'`
  gives the "no workspace is available" text; an error with an fs `code` such as `'EACCES'`
  gives the file-system text naming the code and not echoing the error message or a path; a
  real `ZodError` (from `z.string().parse(1)` or similar, not a hand-set name) gives the
  "invalid SDK session id" text and no Zod issue dump.

### Batch 18 verification

- `npx prettier --check` on the two specs.
- `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts <the two specs> --coverage=false --maxWorkers=2`
- Test-only: no phase review. After commit, Batch 10 starts.
- Verified (team-leader, 2026-10-14, report `batch-18-report.md`): only the two specs changed;
  prettier check clean; jest on the two specs "2 passed, 405 passed". Committed ae20af1ca.

## Batch 10: Manifest v4 types and validated read path (behavior-neutral) - COMPLETE (commit 27bf6b468)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: types, barrels and storage read methods are coupled. Existing write paths are
  untouched (R2).
- Tasks: 3 | Depends on: Batch 1
- Phase: 3 - Manifest v4 and freshness | Phase review: code-logic, plus style (new exports)

### Task 10.1: v3/v4 types, schemas and barrels - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/types/multi-phase.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/types/index.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/index.ts` (first owner)
- Plan reference: implementation-plan.md:62-88
- Pattern to follow: `multi-phase.types.ts:34-102`
- Quality requirements: `MultiPhaseManifestV3` and `MultiPhaseManifestV3Schema` hold today's shape. Add `PhaseResultV4`, `MultiPhaseManifestV4` and a strict `MultiPhaseManifestV4Schema` with the plan's refinements (completed implies session, input and verified hash; failed implies error; 64-hex hashes). Keep the exported name `MultiPhaseManifest` as `V3 | V4` so existing consumers compile (F20). Keep `MultiPhaseManifestSchema` exported. The v4 type must be assignable to the shared v4 response member (Task 1.3).

### Task 10.2: Storage: `readManifest`, compatible `loadManifest`, `archiveLegacyRun`, resumable filter - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`
- Plan reference: implementation-plan.md:88, 109-111 (data migration)
- Pattern to follow: `loadManifest` at `:275-294`, `findLatestResumableRun` at `:297-345`
- Quality requirements:
  - Add `readManifest(slugDir)`, returning `{kind:'current'}`, `{kind:'legacy-v3'}` or null. Malformed, v2 or unknown versions return null and are never rewritten.
  - `loadManifest(slugDir)` keeps its signature. It returns v3 or v4 (`MultiPhaseManifest`) so `wizard-generation-checkpoint.service.ts:133` and the checkpoint keep working.
  - Add `archiveLegacyRun(workspacePath, slugDir)` per R1: copy file by file to a unique archival slug, validate the copy as v3, then delete the original. Any failure gives a typed error with v3 intact. It returns the archival dir.
  - `findLatestResumableRun` excludes legacy-v3.
  - Saved-analysis listing still shows v3, including archived dirs.
  - `createSlugDir`, `writeManifest` and the constructor are unchanged. Nothing calls `archiveLegacyRun` yet (Task 12.2 does).
- Validation notes: R1, R2, F20.

### Task 10.3: Storage spec - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts`
- Quality requirements: the exact v3 read-only path. Malformed and unsupported versions return null, with the file bytes unchanged. v4 round-trip. Archive preserves every v3 file and deletes only after a verified copy. Archive failure leaves v3 intact. The resumable filter excludes v3. `loadManifest` returns `runId` for both versions.

### Batch 10 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command:
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1 && npx nx typecheck @ptah-extension/rpc-handlers && npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts --coverage=false --maxWorkers=2 && npx nx run-many -t typecheck -p @ptah-extension/setup-wizard ptah-cli --parallel=1`
- The F-owned `multi-phase-analysis.service.spec.ts` must pass unchanged inside the agent-generation run (R2).
- Verified (team-leader, 2026-10-14, report `batch-10-report.md`): 5 source/spec files in
  agent-generation; `multi-phase-analysis.service.spec.ts` untouched. Prettier check clean;
  agent-generation typecheck, test, lint OK; rpc-handlers typecheck OK; the two RPC specs
  "2 passed, 100 passed"; setup-wizard and ptah-cli typecheck "for 2 projects" OK.
  `archiveLegacyRun` copies with byte checks, revalidates v3, deletes the source last and
  restores it from the archive if deletion fails (R1). Interim state until Batch 12: writers
  still write v3 and `findLatestResumableRun` now skips v3, so a paused run made before
  Batch 12 is not offered for resume; Batch 12 (v4 writer, v3 archive on resume) closes it.
  No merge or release happens before then.

## Batch 11: Analysis freshness service and DI - COMPLETE (commit 93fe34db7)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: a new service, its spec, its token, registration and export.
- Tasks: 3 | Depends on: Batch 10
- Phase: 3 - Manifest v4 and freshness | Phase review: code-logic, plus style

### Task 11.1: `AnalysisFreshnessService` and `computeWorkspaceFingerprint` - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts` (new)
- Plan reference: implementation-plan.md:90-103
- Pattern to follow: `AnalysisStorageService` DI shape (`analysis-storage.service.ts:54-60`). Do not reuse memory-curator's `deriveWorkspaceFingerprint`: it is an identity hash, not a content hash.
- Quality requirements:
  - `ANALYSIS_MAX_AGE_MS` is 7 days.
  - The fingerprint uses `sha256-v1` over root package manifests and lockfiles (name plus bytes) and sorted top-level names. It excludes `.ptah`, `.git`, dependencies and generated outputs. Read through `IFileSystemProvider`.
  - `getStatus(workspaceRoot | null): Promise<AnalysisStatus>`. Fresh only when: v4, completed, all four outputs verified, present and hash-matched, fingerprint equal, and age within the limit.
  - Reasons match the plan's enum. Any read error gives stale/`unreadable`, never fresh. No root gives missing.
  - Read-only: no disk writes.

### Task 11.2: Token, registration, export - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/di/tokens.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/di/register.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/index.ts` (second owner, after Batch 10)
- Quality requirements: `AGENT_GENERATION_TOKENS.ANALYSIS_FRESHNESS_SERVICE`, registered as a singleton beside `ANALYSIS_STORAGE_SERVICE`. Export the class, `computeWorkspaceFingerprint` and `ANALYSIS_MAX_AGE_MS`.

### Task 11.3: Freshness spec - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-freshness.service.spec.ts` (new)
- Quality requirements: the full reason matrix (ok, no-analysis, legacy-v3, incomplete, expired at the boundary, workspace-changed, output-mismatch, unreadable). Fingerprint is stable under directory order and changes with lockfile bytes. No writes (spy on the FS).

### Batch 11 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command (split per orchestrator 2026-10-14, because `--maxWorkers` breaks a combined run):
  `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/agent-generation --parallel=1 --maxWorkers=2`,
  then `npx nx run di-lint:lint` (new token and registration).
- Verification 1 (team-leader, 2026-10-14, report `batch-11-report.md`): NOT ACCEPTED, not
  committed. Tasks 11.2 (token, singleton, exports) verified on disk. Task 11.1 defect:
  `getStatus` (`analysis-freshness.service.ts:163-172`) returns stale/`unreadable` for the
  whole workspace as soon as ANY slug dir has a `manifest.json` that `readManifest` rejects.
  Version-2 and malformed manifests are kept on disk forever by design
  (`analysis-storage.service.ts:11-12`), so a user with one old v2 run never gets `fresh`,
  even after a new verified v4 run completes; the freshness gate (Batches 13-15) would be
  permanently stale. Fix: skip schema-rejected dirs when choosing the latest run (as the
  saved-analysis listing does); return stale/`unreadable` only when real I/O fails or when no
  valid run exists and at least one was rejected. Spec: a rejected v2 or malformed dir beside a
  newer fresh v4 gives `ok`; a rejected dir alone gives `unreadable`. Lane resumed for the fix.
- Verification 2 (team-leader, 2026-10-14, report `batch-11-fix-report.md`): ACCEPTED.
  Rejected or undated manifests are skipped when choosing the latest run; `unreadable` only on
  a non-ENOENT I/O error or when no valid run exists and one was rejected. New specs: rejected
  v2 and malformed beside a newer fresh v4, a rejected v2 newer than a fresh v4, rejected
  alone. Prettier check clean; agent-generation typecheck+lint OK; test (`--maxWorkers=2`) OK;
  di-lint OK (1825 sites, 793 tokens). Minor for the phase review: the selection loop reads
  `manifest.json` twice before `readManifest` (`analysis-freshness.service.ts:165-176`).

## Batch 12: v4 writer and SDK session capture - COMPLETE (commit 54f4932c0)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the checkpoint has no spec of its own. Writer, caller and the one spec that drives
  them must change together (R2).
- Tasks: 3 | Depends on: Batches 10, 11
- Phase: 3 - Manifest v4 and freshness | Phase review: code-logic, plus style

### Task 12.1: Capture the real SDK session id per phase attempt - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`
- Plan reference: implementation-plan.md:62-64
- Pattern to follow: `createTextCapturingStream` (`:815-846`) and `isSystemInit` (`libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:352`)
- Quality requirements: take the first non-empty `session_id`. Prefer `system/init`, and fail on disagreement. No id at all gives a typed phase failure and stays unverified. Never record `WizardPhaseId.fromPhase` (`:717-768`). Compute the prompt, prior-phase and output SHA-256 and pass them to the checkpoint. Keep timeout and abort behavior (`:630-673`).

### Task 12.2: Checkpoint writes v4; v3 resume archives and starts fresh - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/analysis-run-checkpoint.ts`
- Plan reference: implementation-plan.md:88, 109-111
- Pattern to follow: `open` (`:48-124`), transitions (`:140-217`)
- Quality requirements:
  - A fresh run writes v4 with `computeWorkspaceFingerprint`.
  - Increment `attempt` before every `running` transition, and clear the old session and verification at that point.
  - A completed phase records session, input and the verified output hash.
  - `open(resume)` uses `readManifest`. Legacy-v3 calls `archiveLegacyRun`, then starts fresh v4. An archive error aborts before any SDK work.
  - On v4 resume, compare recorded inputs and output bytes before skipping. A mismatch restarts that phase and its descendants.
  - Persist on every transition.

### Task 12.3: Multi-phase spec - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts`
- Quality requirements:
  - Update the v3 assertions at `:261,394,705` to v4 semantics.
  - Session id handling: an init id versus the synthetic UI id; a stream without init uses the first message id; a stream with no id fails.
  - A paused v3 run is archived, never erased, and a new v4 run starts.
  - Output mismatch invalidates downstream phases.
  - Attempt increments and verified hashes are correct.

### Batch 12 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command:
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1 && npx nx typecheck @ptah-extension/rpc-handlers && npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts --coverage=false --maxWorkers=2 && npx nx run-many -t typecheck,test -p @ptah-extension/setup-wizard --parallel=1 && npx nx typecheck ptah-cli && npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/analyze.spec.ts --coverage=false --maxWorkers=2 && npx nx run di-lint:lint`
- This covers the parity row "CLI deep analysis" (the plan's batch E CLI verification).
- Split form (orchestrator 2026-10-14; never pass `--maxWorkers` with typecheck or lint), one at
  a time: `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`;
  `npx nx run-many -t test -p @ptah-extension/agent-generation --parallel=1 --maxWorkers=2`;
  `npx nx typecheck @ptah-extension/rpc-handlers`; the rpc-handlers jest line above;
  `npx nx typecheck @ptah-extension/setup-wizard`;
  `npx nx test @ptah-extension/setup-wizard --maxWorkers=2` (read-only, no frontend edit);
  `npx nx typecheck ptah-cli`; the ptah-cli jest line above; `npx nx run di-lint:lint`.
- Verified (team-leader, 2026-10-14, report `batch-12-report.md`): only the three listed
  agent-generation files changed; prettier check clean; agent-generation typecheck, lint and
  test pass; rpc-handlers typecheck and setup-rpc spec (43 passed); setup-wizard typecheck;
  ptah-cli typecheck and analyze spec (6 passed); di-lint OK (1826 sites, 793 tokens).
  setup-wizard test taken from the lane (337 passed; read-only lib, unchanged).
  For the Phase 3 review: `markCompleted(..., outcome.sessionId!)` at
  `multi-phase-analysis.service.ts:545` relies on "no error implies an id"; the checkpoint
  now archives a v3 slug on every open, not only on resume (`analysis-run-checkpoint.ts:58`);
  the batch deleted most method doc comments in `analysis-run-checkpoint.ts`.

## Batch 13: `wizard:analysis-status` RPC - COMPLETE (commit 29519e705)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the registry entry, baseline, schema and handler land together (F18).
- Tasks: 3 | Depends on: Batches 5, 11, 12
- Phase: 3 - Manifest v4 and freshness (last batch of the phase) | Phase review: code-logic, plus style

### Task 13.1: Register the method (F18) - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc.types.ts` (second owner, after Batch 5),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts` (second owner),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts`
- Pattern to follow: `'wizard:get-resumable-run'` at `rpc.types.ts:1005-1008,3795`, `baseline.ts:409`, `setup-rpc.schema.ts:26`
- Quality requirements: the registry entry uses the Task 1.3 types. `WizardAnalysisStatusParamsSchema = z.object({})`.

### Task 13.2: Handler and spec - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:103
- Pattern to follow: `registerGetResumableRun` (`setup-rpc.handlers.ts:405-449`), `METHODS` (`:86`)
- Quality requirements: add the method to `METHODS`, then bind. Resolve via `AGENT_GENERATION_TOKENS.ANALYSIS_FRESHNESS_SERVICE`. No workspace returns missing. Read-only. `get-resumable-run` keeps its response type, and its spec reflects that v3 is not resumable. The spec covers params validation, no disk mutation, and no workspace.

### Task 13.3: CLI surface confirmation (F19) - COMPLETE

- File: none edited. Same rule as Task 5.4.

### Batch 13 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 && npx nx run-many -t test -p @ptah-extension/cli-engine --parallel=1`
- After commit: the Phase 3 review is due (Batches 10-13, combined diff).
- Verified (team-leader, 2026-10-14, report `batch-13-report.md`): only the five listed
  shared and rpc-handlers files changed; no frontend file and no cli-engine file touched;
  prettier check clean; shared and rpc-handlers typecheck, lint and test pass ("2 projects");
  cli-engine test passes with no edit (F19); di-lint OK (1826 sites, 793 tokens).
  Minor for the style review: `'wizard:analysis-status'` sits out of alphabetical order in
  `host-source-registry.baseline.ts:411`.

## Phase 3 review disposition (2026-10-14, one fix round)

Reviews of `27bf6b468^..29519e705`: `code-logic-review-phase-3.md` (antigravity family,
implementer codex), APPROVED WITH FIXES 6/10; `code-style-review-phase-3.md` (claude family),
APPROVED WITH FIXES 6.5/10. Dispositions are the orchestrator's (binding), with the team-leader
evidence noted. `L` = logic finding, `S`/`M` = style serious/minor finding. The fix round is
Batches 19-22 (file-disjoint, run one at a time). Then one re-review, logic and style, scoped to
the fix commits. Batch 14 does not start until the orchestrator accepts that re-review.

| Finding                                                    | Severity | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 archive can delete the only complete copy               | Serious  | Fix, Task 19.1. Once `fs.delete(source)` has started, the verified archive is never deleted; the error names the archive path. Spec: a delete that removes a phase file then rejects, plus a restore copy that rejects; the archive survives with every original byte                                                                                                                                                                                                     |
| L2 a v3 archive failure blocks a fresh analysis            | Serious  | Fix, Tasks 19.1 (storage) and 21.1 (checkpoint). A fresh run always starts and a v3 run is never erased. On archive failure: log a warning, leave the v3 folder untouched, write the v4 run to the distinct folder `<slug>--v4` (slugify never emits `--`, so it cannot collide with any slug). Resume looks at the primary folder, then `<slug>--v4`. list, findLatest, getResumableRun, freshness and the CLI (`analysisDir` from the run) all find it; each has a spec |
| L3 hash or markCompleted throw leaves the run `running`    | Moderate | Fix, Task 21.2. The success path catches it and calls `markFailed` with the error text. If the checkpoint write itself fails, `analyzeWorkspace`'s outer catch pauses the open checkpoint (best effort, logged)                                                                                                                                                                                                                                                           |
| L4 v3 resume restarts silently                             | Moderate | The restart is approved design (implementation-plan.md: v3 is not resumable). The deviation is already closed on disk: `findLatestResumableRun` skips v3 (`analysis-storage.service.ts:445`), pinned by spec `:563` and by the Batch 13 handler spec. Task 19.1 adds a case for a paused v3 with an unfinished generation checkpoint and for archive folders. No frontend change                                                                                          |
| L5 fingerprint failure aborts the analysis                 | Minor    | Fix (cheap), Task 21.1: a fingerprint read failure gives a degraded fingerprint (a random never-matching digest) plus a warning, so the run starts and freshness reports `workspace-changed` (stale, never falsely fresh). Re-fingerprinting at `finish()` is FU-9                                                                                                                                                                                                        |
| L6 archives treated as normal runs                         | Minor    | Fix, Tasks 19.1 and 20.2: `-v3-archive-` folders are excluded from findLatest, getResumableRun and freshness. Deviation, recorded: `list` (the saved-analysis browser) keeps them, because it is the only way a user reaches an archived v3 analysis (Task 10.2 requirement, keep-and-fix rule). Reusing or pruning identical archives is FU-13                                                                                                                           |
| L7 session id compared only against system/init            | Minor    | Follow-up FU-10. The first id plus the init check covers the SDK's real streams; a mid-stream id change has never been observed                                                                                                                                                                                                                                                                                                                                           |
| L8 newer rejected run hidden behind an older valid run     | Minor    | Follow-up FU-11. Reachable only across slugs or leftover dirs; after L6 archives no longer take part                                                                                                                                                                                                                                                                                                                                                                      |
| L9 `analysisDir` absolute in `wizard:analysis-status`      | Minor    | Fix, Task 20.2: `AnalysisStatus.analysisDir` is workspace-relative with `/` separators. No consumer needs an absolute path (no frontend consumer yet; the CLI does not call this method; verified by grep). Batches 14-15 resolve it with `storage.resolveAuthorizedAnalysisDir`. Shared doc: Task 22.1                                                                                                                                                                   |
| S1 130-line `getStatus`, inline type                       | Serious  | Fix, Task 20.2: `findLatestRun` and `qualify` private methods; `ManifestReadResult` imported                                                                                                                                                                                                                                                                                                                                                                              |
| S2 freshness has no logger                                 | Serious  | Fix, Task 20.2: `TOKENS.LOGGER`; warn in the outer catch, debug on a rejected manifest                                                                                                                                                                                                                                                                                                                                                                                    |
| S3 SHA-256 open-coded four times                           | Serious  | Fix, Tasks 20.1 (helpers), 20.2 and 21.x (call sites): `sha256Hex` and `hashFileOrNull` in `analysis-fingerprint.ts`                                                                                                                                                                                                                                                                                                                                                      |
| S4 checkpoint lost its "why" comments                      | Serious  | Fix, Task 21.1                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S5 `outcome.sessionId!`                                    | Serious  | Fix, Task 21.2 (with L3): guard on null and `markFailed`, no `!`                                                                                                                                                                                                                                                                                                                                                                                                          |
| S6 misleading `MultiPhaseManifestSchema` alias             | Serious  | Fix, Task 21.3: delete the alias and its barrel line                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S7 fingerprint in a DI service file; `PHASE_IDS` hand copy | Serious  | Fix, Tasks 20.1 and 20.2: `services/analysis-fingerprint.ts` (no decorator); phase ids derived from `PHASE_CONFIGS`                                                                                                                                                                                                                                                                                                                                                       |
| M1 baseline out of order                                   | Minor    | Fix, Task 22.1                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M2 phase error classes style, unused export                | Minor    | Fix, Task 21.2: constructor `this.name`, drop `export`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M3 barrel exports with no consumer                         | Minor    | Fix, Tasks 20.3 and 21.3. Checked against batches.md: Batch 14 needs only `AnalysisFreshnessService` (rpc-handlers); Batch 15 is inside agent-generation (relative imports); Batches 6-8 are frontend and cannot import a backend lib. Each removal is grep-checked first                                                                                                                                                                                                 |
| M4 stale v3 wording, missing docs, register log            | Minor    | Fix, Tasks 19.1 (`readManifest` doc), 20.3 (register log), 22.1 (shared and schema wording)                                                                                                                                                                                                                                                                                                                                                                               |
| M5 cast ladder, three v4 definitions                       | Minor    | Follow-up FU-12; it follows the existing `as MultiPhaseManifest` precedent                                                                                                                                                                                                                                                                                                                                                                                                |

Named follow-ups added by Phase 3 (outside this run's batches; Mode 3 lists them):

- FU-9 re-fingerprint the workspace at `finish()` so edits made during a long run, or root files
  the agents create, do not report `workspace-changed` right after completion (L5 rest).
- FU-10 compare every SDK message `session_id` with the captured one, or document that
  `system/init` is authoritative (L7).
- FU-11 report stale/`unreadable` when a rejected run dir is newer than the chosen run (L8).
- FU-12 derive the backend v4 type from `z.infer` and assert it against the shared type with
  `satisfies` when a v5 arrives (M5).
- FU-13 reuse an existing byte-identical archive instead of adding a new `-v3-archive-<ulid>`
  folder on each attempt, and decide on pruning (L6 rest).
- FU-14 a `<slug>--v4` run left behind after a later archive succeeds stays as history (older
  `analyzedAt`, never selected over the newer run); decide whether to fold it back.
- FU-15 (re-review logic N1, Moderate) on resume with a degraded fingerprint, keep the persisted
  `workspaceFingerprint` instead of overwriting it with the random digest
  (`analysis-run-checkpoint.ts:123` with `:61-75`, `:200-222`), or state in the warning that the
  run restarts. No wrong data today: the warning is logged and outputs are recomputed. The
  orchestrator called it FU-13; renumbered because FU-13 was already taken (see "Phase 3
  re-review disposition").
- FU-16 (re-review style N1, Moderate) the freshness `warn` at
  `analysis-freshness.service.ts:81-87` nests the `Error` in the context object, which the logger
  serialises as `{}`; pass `error.message` (or the `Error` itself) as the sibling services do.
  Diagnostic only. The orchestrator called it FU-14; renumbered for the same reason.

## Batch 19: Phase 3 fix - archive safety, v3 fallback folder, run selection (storage) - COMPLETE (commit 6fa3cf939)

- Recommended executor: implementation CLI lane (codex), one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: one service and its spec; Batches 20 and 21 depend on its API.
- Tasks: 1 | Depends on: Batch 13
- Phase: 3 fix round (Batches 19-22) | Phase review: the one re-review, logic and style, scoped
  to the Batch 19-22 commits

### Task 19.1: Archive keeps its verified copy; fallback folder API; archive exclusion - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts`
- Findings: L1, L2 (storage half), L4 (pin), L6 (storage half), M4 (`readManifest` doc)
- Quality requirements:
  - L1: in `archiveLegacyRun` (`:329-383`) set a `deleteStarted` flag immediately before
    `fs.delete(source)`. The outer catch may delete the archive only when `!deleteStarted` (and
    the source still reads as v3, as today). Once the delete started, keep the archive whatever
    happens (restore failing included). `LegacyRunArchiveError` gains
    `readonly archiveDir: string | null` (constructor pattern kept) and its message names the
    kept archive path when there is one.
  - L2 storage API: exported `LEGACY_FALLBACK_SUFFIX = '--v4'`; a `RunDirVariant` of
    `'primary' | 'legacy-fallback'`; `getRunDir(workspacePath, projectDescription, variant)`
    returns `{ slugDir, slug }` without touching disk (fallback slug = slugified name +
    `--v4`); `createSlugDir(workspacePath, projectDescription, variant = 'primary')` creates or
    replaces that folder (existing callers unchanged). `ensureSlugDir` unchanged.
  - L6: exported `LEGACY_ARCHIVE_MARKER = '-v3-archive-'` and `isLegacyArchiveDirName(name)`
    used by `archiveLegacyRun` to build the name. `findLatestMultiPhaseAnalysis` and
    `findLatestResumableRun` skip archive folders. `list` and `loadMultiPhase` keep them
    (recorded deviation, see disposition).
  - L4: `findLatestResumableRun` keeps skipping v3 (`:445`).
  - M4: doc comment on `readManifest`; fix the header and `ResumableRun` / `listValidRuns`
    comments that still say "version-3" only.
- Spec cases: (a) a delete that removes one phase file and then rejects, plus a restore copy that
  rejects: `LegacyRunArchiveError` with `archiveDir` set, the archive folder exists with every
  original file byte-identical; (b) a clean delete rejection with a successful restore keeps both
  the source and the archive; (c) a copy failure before delete still removes the partial archive
  and leaves v3 intact (existing); (d) `getRunDir`/`createSlugDir` with `'legacy-fallback'` give
  `<slug>--v4`, and a v4 run there is returned by `list`, `findLatestMultiPhaseAnalysis` and
  `findLatestResumableRun` while the v3 folder is untouched; (e) an archive folder holding a
  newer v3 manifest is ignored by `findLatestMultiPhaseAnalysis` and `findLatestResumableRun`
  but shown by `list`; (f) a paused v3 with an unfinished generation checkpoint is not resumable.

### Batch 19 verification

- `npx prettier --check` on the two files.
- One at a time: `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`;
  `npx nx run-many -t test -p @ptah-extension/agent-generation --parallel=1 --maxWorkers=2`.
- Verified (team-leader, 2026-10-14, report `batch-19-report.md`): only the two storage files
  changed. `deleteStarted` is set before the source delete and gates archive cleanup; the
  error carries `archiveDir`; `getRunDir`/`createSlugDir` variant; archive folders skipped in
  latest and resumable selection, still listed. Prettier check clean; agent-generation
  typecheck+lint pass; agent-generation test (`--maxWorkers=2`, no cache) passes. Minor for the
  re-review: `isLegacyArchiveDirName` matches the marker anywhere in the name (`includes`), so a
  project slugified to contain `-v3-archive-` would be skipped; a ULID-anchored match is tighter.

## Batch 20: Phase 3 fix - fingerprint module, freshness refactor, barrel - COMPLETE (commit 6b6effdeb)

- Recommended executor: implementation CLI lane (codex), one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: moving the fingerprint changes its importers (freshness, checkpoint import line,
  barrel) in one step; the freshness refactor sits on the new module.
- Tasks: 3 | Depends on: Batch 19
- Phase: 3 fix round | Phase review: the one re-review
- Size note: 6 files, one lib.

### Task 20.1: `analysis-fingerprint.ts` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/analysis-run-checkpoint.ts` (import line only; Batch 21 owns the rest)
- Findings: S3 (helpers), S7
- Quality requirements: move `computeWorkspaceFingerprint`, `ROOT_METADATA_FILES`,
  `EXCLUDED_TOP_LEVEL_NAMES` and `hashPart` out of the freshness service into a plain module (no
  decorator, no DI imports). Add `sha256Hex(bytes: Uint8Array): string` and
  `hashFileOrNull(fs, path): Promise<string | null>` (null on a missing or unreadable file). No
  re-export shim from the old location.

### Task 20.2: Freshness service: split, logger, derived phase ids, relative dir, archive skip - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-freshness.service.spec.ts`
- Findings: S1, S2, S3, S7, L6 (freshness half), L9
- Quality requirements: `findLatestRun(analysisRoot)` and `qualify(...)` private methods, typed
  with `ManifestReadResult`; `@inject(TOKENS.LOGGER)` with warn in the outer catch and debug on a
  rejected manifest (copy the call shape of `analysis-storage.service.ts`); phase ids from
  `PHASE_CONFIGS`; the output hash via `sha256Hex`; skip `isLegacyArchiveDirName` folders;
  `analysisDir` is workspace-relative with `/` separators (the outer-catch value becomes
  `.ptah/analysis`). Behaviour is otherwise unchanged: every existing reason case still passes.
- Spec additions: an archive folder with a newer manifest is ignored; a `<slug>--v4` run beside an
  older v3 folder is the one qualified; `analysisDir` is relative in fresh, stale and unreadable
  results; the logger warns on an I/O failure.

### Task 20.3: Barrel and register log - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/index.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/di/register.ts`
- Findings: M3 (package barrel), M4 (register log)
- Quality requirements: remove `computeWorkspaceFingerprint`, `ANALYSIS_MAX_AGE_MS`,
  `LegacyRunArchiveError` and `ManifestReadResult` from the package barrel after a grep over
  `libs` and `apps` shows no importer outside agent-generation. Keep `AnalysisFreshnessService`
  and `ResumableRun`. Add `'ANALYSIS_FRESHNESS_SERVICE'` to the start-up log list.

### Batch 20 verification

- `npx prettier --check` on the six files.
- One at a time: agent-generation typecheck+lint, then agent-generation test (`--maxWorkers=2`),
  then `npx nx typecheck @ptah-extension/rpc-handlers`, then `npx nx run di-lint:lint`
  (constructor `@inject` added).
- Verified (team-leader, 2026-10-14, report `batch-20-report.md`): `analysis-fingerprint.ts` is
  a plain module (no DI) with the moved fingerprint, `sha256Hex` and `hashFileOrNull`; no shim
  at the old path; checkpoint and multi-phase spec import the new module (spec import line is
  an allowlisted seventh file). Freshness has `findLatestRun`/`qualify`, the injected logger
  (warn in the outer catch, debug on a rejected manifest), `PHASE_CONFIGS` phase ids, archive
  skip and relative `/` paths; the four barrel exports are gone; register log lists
  `ANALYSIS_FRESHNESS_SERVICE`. First commit attempt failed the degradation audit; fix round
  added an `optional-capability` marker in `hashFileOrNull`'s catch. Checks, one at a time:
  prettier clean (7 files); agent-generation typecheck+lint pass; agent-generation test
  (`--maxWorkers=2`, no cache) 37 suites, 1271 passed, 1 skipped; rpc-handlers typecheck
  pass; di-lint OK (1827 `@inject` sites).

## Batch 21: Phase 3 fix - checkpoint fallback, phase recording, types - COMPLETE (commit 35f663e2f)

- Recommended executor: implementation CLI lane (codex), one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the checkpoint has no spec of its own; it is driven by the multi-phase spec.
- Tasks: 3 | Depends on: Batches 19, 20
- Phase: 3 fix round | Phase review: the one re-review

### Task 21.1: Checkpoint open: archive failure falls back; degraded fingerprint; docs - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/analysis-run-checkpoint.ts` (second owner, after Task 20.1)
- Findings: L2 (checkpoint half), L5, S3, S4
- Quality requirements: `open` takes a `Logger`. Primary folder holds v3: try
  `archiveLegacyRun`; on any error log a warning (with `archiveDir` when set) and use the
  `'legacy-fallback'` folder for the rest of `open`; the v3 folder is never touched. Resume: the
  primary folder's current run, else the fallback folder's, under today's rules (not completed,
  same model). Fresh: `createSlugDir` with the chosen variant. Fingerprint failure: warn and use
  a degraded fingerprint (`sha256-v1`, digest `sha256Hex` of a random value) so the run starts and
  can never qualify as fresh. `isCompleted` uses `hashFileOrNull`. Restore one-line docs on every
  public method plus the model-pinning rationale at `open`.

### Task 21.2: Phase recording never leaves a phase `running` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts`
- Findings: L3, S5, S3, M2, plus the multi-phase specs for L2 and L5
- Quality requirements: in `recordPhaseOutcome` (`:489-611`) both `markCompleted` sites: a null
  `sessionId` calls `markFailed(..., 'Phase finished without an SDK session id')`; a throw from
  hashing or `markCompleted` is caught and calls `markFailed` with the error text. No `!`. The
  outer catch of `analyzeWorkspace` pauses an open checkpoint (best effort, in its own try/catch,
  logged). Prompt and prior-phase hashes use the shared helpers. Error classes use constructor
  `this.name` and are not exported. Pass the logger to `open`.
- Spec cases: archive failure → warning, v3 folder bytes unchanged, new v4 run in `<slug>--v4`,
  `analysisDir`/slugDir is that folder; resume of a paused fallback run; fingerprint failure
  still runs; hash read failure after a phase → phase `failed` with the error text, lifecycle not
  `running`; a null session id → `failed`.

### Task 21.3: Drop the alias and unused type exports - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/types/multi-phase.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/types/index.ts`
- Findings: S6, M3 (types barrel)
- Quality requirements: delete `MultiPhaseManifestSchema` and its barrel line. Remove
  `MultiPhaseManifestV3Schema`, `MultiPhaseManifestV4Schema`, `PhaseResultV4` and
  `MultiPhaseManifestV3` from the types barrel only where a grep shows no importer through
  `../types`, `./lib/types` or the package name.

### Batch 21 verification

- `npx prettier --check` on the five files.
- One at a time: agent-generation typecheck+lint; agent-generation test (`--maxWorkers=2`);
  `npx nx typecheck @ptah-extension/rpc-handlers`; `npx nx typecheck ptah-cli`;
  `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/analyze.spec.ts --coverage=false --maxWorkers=2`
  (CLI deep-analysis consumer of `analysisDir`).
- Verified (team-leader, 2026-10-14, report `batch-21-report.md`): `open` takes the logger,
  warns and switches to `legacy-fallback` on an archive error (v3 bytes untouched, `archiveDir`
  logged), resumes primary then fallback under the model/lifecycle rules, and creates with the
  chosen variant; fingerprint failure warns and uses a random `sha256Hex` digest; `isCompleted`
  uses `hashFileOrNull`; one-line docs on every public method and the model-pinning note at
  `open`. `completeOrFailPhase` covers both completion sites (null session id and hash or
  `markCompleted` errors become `markFailed`, no `!`); the outer catch pauses a running
  checkpoint best-effort; error classes are module-private with constructor `this.name`. Alias
  and four unused barrel exports removed. Checks, one at a time: prettier clean (5 files);
  agent-generation typecheck+lint pass; agent-generation test (`--maxWorkers=2`, no cache) 37
  suites, 1274 passed, 1 skipped; rpc-handlers typecheck pass; ptah-cli typecheck pass; CLI
  `analyze.spec.ts` 6 passed. First commit attempt failed the degradation audit
  (`orphaned-suppression` at `multi-phase-analysis.service.ts:445`: the pause catch logs, so no
  marker is needed); the marker was removed and `degradation-audit:lint` re-run clean
  (agent-generation 1, baseline 1).
- Minor, recorded not fixed (fix-round rule): the post-resume
  `variant === 'primary' && !primaryResumable && fallbackResumable` branch in
  `analysis-run-checkpoint.ts` is unreachable, and the resumable test is evaluated twice;
  `AnalysisStorageService.ensureSlugDir` now has no production caller (spec only). Candidates
  for the Phase 3 re-review or a later cleanup task.

## Batch 22: Phase 3 fix - shared docs and baseline order - COMPLETE (commit 9483de5c1)

- Recommended executor: implementation CLI lane (codex), one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: wording and ordering only, in two libs.
- Tasks: 1 | Depends on: Batch 20 (relative `analysisDir`)
- Phase: 3 fix round (last batch) | Phase review: the one re-review

### Task 22.1: Wording, docs, baseline order - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-setup.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts`
- Findings: M1, M4, L9 (doc)
- Quality requirements: `'wizard:analysis-status'` moves above `'wizard:cancel'`; "version-3"
  resume and phase-status wording becomes version-4 where it describes v4 (`rpc-setup.types.ts:34,38`,
  `setup-rpc.schema.ts:20`); doc comments on `AnalysisStatus` (with `analysisDir`
  workspace-relative, `/` separators) and on `WizardAnalysisStatusParamsSchema`.

### Batch 22 verification

- `npx prettier --check` on the three files.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1`,
  then `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2`
  (header must say 2 projects).
- After commit: the Phase 3 re-review (logic and style) of the Batch 19-22 commits is due.
- Verified (team-leader, 2026-10-14, report `batch-22-report.md`): only the three listed files
  changed. `'wizard:analysis-status'` now sits between `'webSearch:test'` and `'wizard:cancel'`
  (same set of names, code-unit order); resume and phase-status wording says version-4
  (`rpc-setup.types.ts:34,38`, `setup-rpc.schema.ts:20`); one-line docs on `AnalysisStatus`,
  `AnalysisStatus.analysisDir` (workspace-relative, `/` separators, null when absent) and
  `WizardAnalysisStatusParamsSchema`. `'legacy-v3'` reason kept (a real v3 manifest). Comments
  and array order only: no type shape or runtime change. Checks, one at a time: prettier clean
  (3 files); shared and rpc-handlers typecheck+lint pass ("2 projects"); shared and rpc-handlers
  test pass, uncached ("Running target test for 2 projects").

## Phase 3 re-review disposition (2026-10-14) - Phase 3 ACCEPTED

Scope: `a0cd167b0..9483de5c1` (Batch 19 `6fa3cf939`, Batch 20 `6b6effdeb`, Batch 21
`35f663e2f`, Batch 22 `9483de5c1`). The one fix round is spent, so no further fix batch.
Dispositions are the orchestrator's (binding).

- Logic: `code-logic-rereview-phase-3.md`, APPROVED 8/10. Review family opencode (lane
  bbee5547); implementer family codex. Fallback reason: the antigravity lane is at its quota
  limit (429 `RESOURCE_EXHAUSTED`, reset in about 109h), recorded in context.md and D11.
- Style: `code-style-rereview-phase-3.md`, APPROVED WITH FIXES 8/10. Review family claude
  (in-process code-style-reviewer sub-agent).
- Every first-review fix disposition is confirmed FIXED by both reviews: L1-L6, L9, S1-S7 and
  M1-M4. L7, L8 and M5 stay follow-ups FU-10, FU-11 and FU-12.

| Finding                                                          | Severity | Disposition                                                                                                                                          |
| ---------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logic N1 degraded fingerprint on resume overwrites stored digest | Moderate | Follow-up FU-15 (`analysis-run-checkpoint.ts:123`, `:61-75`, `:200-222`). No wrong data, warned, rare, no lane-config impact; outputs are recomputed |
| Style N1 freshness `warn` serialises the nested `Error` as `{}`  | Moderate | Follow-up FU-16 (`analysis-freshness.service.ts:81-87`). Diagnostic only, no data or lane-config impact                                              |
| Logic N2 no spec pins the outer-catch best-effort pause          | Minor    | Recorded, not fixed (`multi-phase-analysis.service.ts:443-452`)                                                                                      |
| Style N2 hard-coded `'.ptah/analysis'` fallback                  | Minor    | Recorded, not fixed (`analysis-freshness.service.ts:88`); derive it from `analysisRoot`                                                              |
| Style N3 `RunDirVariant` spelled out inline                      | Minor    | Recorded, not fixed (`analysis-run-checkpoint.ts:78`); import the exported type                                                                      |
| Style N4 hash helpers live in `analysis-fingerprint.ts`          | Minor    | Recorded, not fixed (`sha256Hex`, `hashFileOrNull`); a rename to `analysis-hash.ts` is optional                                                      |
| Style N5 duplicated `'Phase finished without an SDK session id'` | Minor    | Recorded, not fixed (`multi-phase-analysis.service.ts`, two copies); hoist to a module constant                                                      |

Follow-up id note: the orchestrator named the two Moderate follow-ups FU-13 and FU-14, but those
ids already belong to the Phase 3 follow-ups for archive reuse and the leftover `<slug>--v4` run
(section "Phase 3 review disposition"). They are recorded as FU-15 and FU-16 so no existing
reference changes meaning.

Recorded Minor items carried forward (a later cleanup task, not this run): the five above, plus
the three from Batch 21 — the unreachable post-resume
`variant === 'primary' && !primaryResumable && fallbackResumable` branch in
`analysis-run-checkpoint.ts`, the resumable test evaluated twice, and
`AnalysisStorageService.ensureSlugDir` with no production caller (spec only).

Batch 14 may now start (its Task 14.1 gate "after the Phase 3 re-review is accepted" is met).

## Batch 14: Agent generation falls back to gathered context - COMPLETE (commit 90e577f99)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the RPC gate and the orchestrator fallback are one decision path.
- Tasks: 2 | Depends on: Batch 11
- Phase: 4 - Self-gathering generation | Phase review: code-logic

### Task 14.1: Freshness gate at `wizard:submit-selection` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:107
- Pattern to follow: path authorization at `wizard-generation-rpc.handlers.ts:215-295`
- Quality requirements: authorize first, as today. Pass `preComputedAnalysis` and `analysisDir` only when the status is fresh. Otherwise omit both, report the stale status, and do not reject. Preserve selected ids, overrides, checkpoint, resume and retry. An unauthorized path is still rejected.
- Validation notes (Phase 3 fix round): `AnalysisStatus.analysisDir` is workspace-relative with
  `/` separators (Task 20.2). Resolve it with `storage.resolveAuthorizedAnalysisDir` before
  comparing it with the caller's dir. Starts only after the Phase 3 re-review is accepted.

### Task 14.2: Orchestrator stale fallback - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/orchestrator.service.spec.ts`
- Pattern to follow: the self-analysis branch at `orchestrator.service.ts:372-399`, `566-638`
- Quality requirements: missing or stale analysis still generates from `analyzeWorkspace`. Gathered context reaches the content prompt (prompt-input test). Fresh analysis keeps the richer path.

### Batch 14 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers @ptah-extension/agent-generation --parallel=1`

## Batch 15: Prompt and content generation fall back to gathered context - COMPLETE (commit d6938d874)

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: two services in one library share the freshness decision.
- Tasks: 3 | Depends on: Batches 11, 14
- Phase: 4 - Self-gathering generation (last batch of the phase) | Phase review: code-logic

### Task 15.1: Content generation omits stale `analysisDir` - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/content-generation.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/content-generation.service.spec.ts`
- Pattern to follow: the resolver at `content-generation.service.ts:571-587`
- Quality requirements: use phase text only for a fresh manifest. Otherwise use the formatted context summary. Prompt-input test.

### Task 15.2: Enhanced prompts: no hard failure, validated enrichment - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts`
- Plan reference: implementation-plan.md:107, risk at 144
- Pattern to follow: `runWizard` discovery (`:397-489`), `regenerate` (`:639-675`), enrichment (`:985-1080`)
- Quality requirements:
  - Remove the hard failure at `:658-664`.
  - Replace the raw `JSON.parse` at `:1001-1015` with the validated freshness decision.
  - Phase enrichment only when fresh, for both explicit and latest dirs. Otherwise use workspace discovery with no analysis dir.
  - Discovery failure returns the existing typed error, keeps the prior prompt, and is never marked successful.
  - Forced regenerate still invalidates the cache.
  - Path authorization in `enhanced-prompts-rpc.handlers.ts:231-246` is untouched.
  - No secret-bearing error logs.
- Validation notes (Phase 3 fix round): the freshness `analysisDir` is workspace-relative; resolve
  it with `resolveAuthorizedAnalysisDir` before comparing with an explicit dir.

### Task 15.3: CLI consumer confirmation - COMPLETE

- File: none edited.
- Quality requirements: the ptah-cli prompts, setup and wizard command specs pass. This covers parity rows 32-34 (the plan's batch I CLI verification).

### Batch 15 verification

- Formatting (cheap guard, kept after hooks were restored by D10; see "Git hooks in this
  worktree"): `npx prettier --check <every file the batch changed>` must pass. The lane runs
  `npx prettier --write` on exactly those files; the team-leader re-checks before commit.
- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1 && npx nx typecheck ptah-cli && npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/prompts.spec.ts apps/ptah-cli/src/cli/commands/setup.spec.ts apps/ptah-cli/src/cli/commands/wizard.spec.ts --coverage=false --maxWorkers=2 && npx nx run di-lint:lint`
- After commit: the Phase 4 review is due (Batches 14-15, combined diff). After it accepts, the
  run waits for TASK_2026_629 to merge and the user to confirm before Batch 6 (D7).

## Batch 23: Phase 4 fix - reserve the submit run slot, observe the launch - COMPLETE (commit 4d5432f76)

- Recommended executor: implementation CLI lane (codex), one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: one handler file and its spec; the reservation and the launch handling are one path.
- Tasks: 1 | Depends on: Batches 14, 15
- Phase: 4 - Self-gathering generation (fix round) | Phase review: code-logic re-review scoped
  to the Batch 23 commit (run by the orchestrator)

### Task 23.1: Close the submit-selection TOCTOU and never discard the launch rejection - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`
- Review reference: `code-logic-review-phase-4.md` Finding 1 (Moderate, orchestrator ruled FIX:
  orphan `running` checkpoint = data integrity; unhandled rejection; false `success: true`), and
  Finding 2 folded only for the catch in this file (`:280-285`).
- Quality requirements:
  - A private, synchronous submit reservation is taken right after the `runs.isActive` guard,
    before the first `await`; the guard refuses while either is held; `wizard:retry-item`
    honours it too. Released on every return and throw path (`finally`).
  - Immediately before launch (no `await` between), a still-active supervisor finalizes the
    just-prepared checkpoint `failed` and returns `success: false` with the in-progress error.
  - The `runs.run(...)` promise is never discarded: a rejection is logged, the checkpoint is
    finalized `failed`, and it is captured; no unhandled rejection.
  - The freshness-lookup catch logs a content-free cause (`error.name` or `typeof`), no paths.
  - Selected ids, overrides, checkpoint, resume and retry behaviour unchanged. No new public API.
- Spec: two concurrent submits started before the first one's freshness lookup resolves yield
  exactly one `success: true`, one in-progress refusal, one checkpoint write and one
  orchestrator call; a launch rejection finalizes the checkpoint `failed`.

### Batch 23 verification

- `npx prettier --check` on the two files.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers --parallel=1`, then
  `npx nx test @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2` as a separate step.
- Results (team-leader, 2026-10-14): prettier check clean; typecheck and lint passed for
  `@ptah-extension/rpc-handlers`; tests passed (151 suites, 4378 passed, 7 skipped). Executors
  were codex lanes `6ed444f4` and `64b93ac7`; report `batch-23-report.md`.
- Pre-commit note: the first commit attempt failed `degradation-audit:lint` (rpc-handlers 2 against
  a baseline of 1) because the secondary `.catch(() => {})` had no marker. The second lane added a
  `// degradation-audit: reported - ...` marker (`wizard-generation-rpc.handlers.ts:408-410`).
  After that the audit showed `libs/backend/rpc-handlers: 1 ok (baseline 1)` and the hook passed.

## Phase 4 review disposition (2026-10-14, one fix round)

Scope: `dbf815fd9..d6938d874` (Batch 14 `90e577f99`, Batch 15 `d6938d874`). Review:
`code-logic-review-phase-4.md`, 8/10, APPROVED WITH FIXES (0 Blocking, 0 Serious, 1 Moderate,
2 Minor). Review family opencode (D11); implementer family codex. No style review was due
because there is no new public API. Dispositions follow the orchestrator's ruling.

| Finding                                                                                                                   | Severity | Disposition                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 TOCTOU in `wizard:submit-selection`: orphan `running` checkpoint, discarded `runs.run` rejection, false `success: true` | Moderate | FIXED in Batch 23 (`4d5432f76`). Verified real first: the guard was `wizard-generation-rpc.handlers.ts:237` (pre-fix), the slot was taken at `:356`, and `GenerationRunSupervisor.run` is `async` and throws while a controller is set (`wizard-generation-run.supervisor.ts:200-205`), so the throw became a rejected promise that `void` discarded. Orchestrator ruled it data integrity |
| 2 Degradation catches log no cause                                                                                        | Minor    | Partly folded into Batch 23: the RPC freshness catch now logs `{ cause: name or typeof }` (`wizard-generation-rpc.handlers.ts:287-293`). Recorded, not fixed: `content-generation.service.ts:621-624` and `enhanced-prompts.service.ts:1074-1077`. Those are in agent-generation, which the batch did not touch                                                                            |
| 3 Specs' `resolveAuthorizedAnalysisDir` mocks are identity-style                                                          | Minor    | Recorded, not fixed (`enhanced-prompts.service.spec.ts:142-145`, `:1144-1148`; `content-generation.service.spec.ts:149-153`). Verification gap only; production comparisons are consistent                                                                                                                                                                                                 |

Batch 23 fix, by file:line (`wizard-generation-rpc.handlers.ts` after the fix):

- `:181` private `submitReserved`. `:240` the guard refuses while the supervisor is active or a
  submit is reserved. `:250` the reservation is taken synchronously, before the first `await`.
  `:433` a `finally` releases it on every return and throw path. `:804` `wizard:retry-item`
  honours the reservation.
- `:356-363` the pre-launch check runs with no `await` in between. If the supervisor is active,
  the prepared checkpoint is finalized `failed` and the call returns the in-progress error.
  `lastGenerationOptions` and `lastCheckpoint` are now set only when the launch goes ahead.
- `:391-411` the `runs.run` promise is observed: a fixed log message, a Sentry capture, and a
  `failed` checkpoint finalize. The trailing marked catch absorbs only a secondary failure.
- Specs (`wizard-generation-rpc.handlers.spec.ts`): `:880` overlapping submits give one
  success, one refusal, one checkpoint write and one orchestrator call. `:917` the reservation
  is released after an early return. `:937` a rejected launch finalizes `failed`, logs and
  captures. `:963` retry is refused while a submit prepares.

Observation for the re-review (not a new finding): when `runs.run` rejects after launch, the
caller has already received `{ success: true }` and no completion payload is broadcast. That
path is now effectively unreachable. With the reservation and the pre-launch check, the
supervisor's only rejecting branch ("already active") cannot fire, and the supervisor is
documented never to reject once launched. The checkpoint no longer stays `running`.

No new follow-up number: Finding 1 was fixed and Findings 2-3 are Minor (recorded). FU-17
remains the next free id. The one fix round is spent. The orchestrator runs one re-review
scoped to `4d5432f76`.

## Phase 4 re-review disposition (2026-10-14) - Phase 4 ACCEPTED

Scope: `d6938d874..4d5432f76` (Batch 23). Review: `code-logic-rereview-phase-4.md`, 8/10,
APPROVED (0 Blocking, 0 Serious, 0 Moderate, 1 new Minor). Review family opencode (D11).

| Finding                                                            | Status       | Disposition                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 TOCTOU in `wizard:submit-selection`                              | FIXED        | Reservation taken before the first `await` (`:250`), released in `finally` (`:432-434`), honoured by retry (`:804`); launch promise observed (`:391-411`). All seven checks PASS                                                                                                                               |
| 2 Degradation catches log no cause                                 | PARTLY FIXED | RPC catch fixed (`:290-293`); the two agent-generation catches stay recorded Minor                                                                                                                                                                                                                             |
| 3 Identity-style resolver mocks                                    | NOT FIXED    | Recorded Minor, outside the diff                                                                                                                                                                                                                                                                               |
| N1 Terminal `.catch` also absorbs a `checkpoints.finalize` failure | NEW Minor    | Recorded, not fixed (fix round spent). On a double fault (unreachable run rejection plus a checkpoint write failure) the manifest stays `running` with no log; `resume: true` recovers. Suggested: a content-free warn in the terminal catch (`:407-411`), as in `wizard-generation-run.supervisor.ts:265-271` |

The four Batch 23 specs (`:880`, `:917`, `:937`, `:963`) run over the real checkpoint service
and supervisor and fail on the pre-fix code. No follow-up number assigned; FU-17 stays free.

## Phase 2F review disposition (2026-10-15, one fix round)

Scope: `f576fd028~1..0a9785d87` (Batches 6-8). Review: `code-logic-review-phase-2f.md`, 6/10,
APPROVED WITH FIXES (0 Serious, 3 Moderate, 4 Minor). Review family opencode (D11; antigravity
showed no confirmed room). The orchestrator checked each finding against the code.

| Finding | Severity | Disposition |
| --- | --- | --- |
| M1 abort-failure branch in `HarnessWorkflowRequestService` is unreachable: `abort()` reports a failed `chat:abort` through `failTurn` and resolves, so `abortAndDispose` still disposes | Moderate | Follow-up **FU-17**. Pre-existing: the deleted handler's `replaceActiveWorkflow` had the same dead branch. Making `abortAndDispose` reject would block "Start over" and the Setup Hub discard flow whenever `chat:abort` keeps failing (for example a dead session), which removes a capability (keep-and-fix rule). Needs a design choice: force-dispose with a warning vs. retry |
| M2 reload hydrates only the head session: `PersistedWorkflow` stores only `sessionId()` | Moderate | Fix Batch 24 (persist `sessionIds`, restore earlier ids) |
| M3 event for a session not yet appended is dropped without a log | Moderate | Fix Batch 24 (log; hydration of the appended session restores it from the store) |
| Buffered replay loop outside try/catch | Minor | Fix Batch 24 |
| Same-mode resume drops a fresh intake | Minor | Recorded. Pre-existing behavior; the Setup Hub asks for a discard confirmation before it starts New Project over an active workflow |
| "Start over" now wipes builder state | Minor | Rejected. Pre-existing: `harness-builder-view.component.ts:761-762` called `state.reset()` before Batch 6 |
| Hung `getProposal` delays live proposals | Minor | Recorded. Bounded by the RPC timeout; events are buffered, not lost |

## Batch 24: Phase 2F fix - persisted session ids, unknown-session log, replay guard - COMPLETE (commit 2775fbe6b; batch-24-report.md; 153 tests)

- Executor: codex lane (frontend-developer role). Files: `harness-workflow.service.ts` and spec,
  `harness-workflow-message.handler.ts` and spec (all `libs/frontend/harness-builder`).
- Verification: `npx prettier --check` on the changed files;
  `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-builder --parallel=1`, then
  `npx nx test @ptah-extension/harness-builder --parallel=1 --maxWorkers=2`.

## Batch 25: Mode 3 fix - log the cause in degraded paths - COMPLETE (commit 3d2de3565)

- Executor: codex lane (backend-developer role). FU-16 (`analysis-freshness.service.ts`), Phase 4
  Finding 2 (`content-generation.service.ts`, `enhanced-prompts.service.ts`), Phase 4 N1
  (`wizard-generation-rpc.handlers.ts`), plus their specs. Logging only; degradation-audit markers
  kept, audit check passed (batch-25-report.md).
- Verification: prettier; typecheck+lint for agent-generation and rpc-handlers; changed specs
  158 + 66 passed.

---

## Phases

Run order: 1 (with fix 16) → 2B → 3 → 4 → (wait for TASK_2026_629 and user) → 2F → Mode 3.
Done: 1, 2B, 3, 4 (Phase 4 accepted 2026-10-14 after fix Batch 23 `4d5432f76` and the
re-review). 629 merged (D13); 2F done (Batches 6-8, fix 24 `2775fbe6b`).

Mode 3 (2026-10-15, team-leader): COMPLETE (orchestrator closed it after fix Batch 25
`3d2de3565`; R11 screenshots skipped by user decision D14). The completion checks are done and recorded in
`completion-report.md`. Every SHA resolves on HEAD `f778edd66`. Parity has 28 rows: 0 MISSING,
5 planned moves or changes, and none without approval. The write-path trace is done. On HEAD
after the `origin/main` merge, typecheck and test pass for shared, platform-core, agent-generation,
rpc-handlers and vscode-lm-tools. Six task states in Batches 6-8 were corrected to COMPLETE (their
batch commits and the Phase 2F acceptance were already recorded). The fix-now items ran
as Batch 25 (D15). The R11 screenshots were skipped (D14); the PR lists the manual checks.

| Phase                            | Batches                                | Review                                                                                                                                                                                                                 | State                                                                                      | Reviewer (roster)                                                                                  |
| -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1 - Proposal backend             | 1-5, fix 16                            | code-logic, plus style (new platform port, new RPC, shared contracts). First review: both APPROVED WITH FIXES (`code-logic-review.md`, `code-style-review.md`). One re-review due after Batch 16, scoped to its commit | ACCEPTED (code-logic-rereview.md, code-style-rereview.md)                                  | code-logic on a review CLI lane of a different family from the implementer; style per orchestrator |
| 2B - MCP writer (backend)        | 9 (includes Task 9.0, D8), test fix 18 | code-logic                                                                                                                                                                                                             | ACCEPTED (code-logic-review-phase-2b.md); Batch 18 test-only fix                           | same                                                                                               |
| 3 - Manifest v4 and freshness    | 10-13, fix 19-22                       | code-logic, plus style (new RPC, exported service). First review: both APPROVED WITH FIXES (`code-logic-review-phase-3.md`, `code-style-review-phase-3.md`). One re-review after Batch 22, scoped to the fix commits   | ACCEPTED (code-logic-rereview-phase-3.md, code-style-rereview-phase-3.md); fix round spent | same                                                                                               |
| 4 - Self-gathering generation    | 14-15, fix 23                          | code-logic. First review APPROVED WITH FIXES (`code-logic-review-phase-4.md`); one re-review after Batch 23                                                                                                            | ACCEPTED (code-logic-rereview-phase-4.md); fix round spent                                 | same                                                                                               |
| 2F - Builder adapters (frontend) | 6-8, fix 24 | code-logic, after Batch 8 (`code-logic-review-phase-2f.md`, 6/10 APPROVED WITH FIXES) | ACCEPTED after fix Batch 24 (no re-review: Moderate-only findings, all fixed or recorded; FU-17) | opencode (D11) |

Mode 3 completion also needs:

- parity-inventory.md, checked row by row;
- before/after Setup Hub screenshots in dark and light (R11);
- the write-path trace (register above);
- the follow-up note for R1 (port `rename`);
- the Phase 1 follow-ups FU-1 to FU-6 (section "Phase 1 review disposition"), carried into the
  QA handoff;
- the Phase 3 follow-ups FU-9 to FU-16 (section "Phase 3 review disposition"; FU-15 and FU-16
  come from the re-review) and the eight recorded Minor items (section "Phase 3 re-review
  disposition");
- every phase review accepted, including Phase 2F, which runs only after TASK_2026_629.
