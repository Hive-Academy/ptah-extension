# Batches - TASK_2026_652_7284

Total tasks: 40 | Batches: 15 | Complete: 3/15

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
  `sessionId` required in Task 7.1 breaks no unowned file.
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

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1: `IFileSystemProvider` has no rename/move (`libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:22-140`: read, write, delete, createDirectory, copy only). The v3 archive cannot be an atomic move, and checkpoint writes cannot use temp-rename through the port. The mock `copy` is file-only (`platform-core/src/testing/mocks/file-system-provider.mock.ts:202-216`). | HIGH | Task 10.2: `archiveLegacyRun` copies file by file into a unique archival slug, re-reads the copied manifest, and must validate it as v3 before `delete(original, {recursive})`. Any failure aborts with a typed error and leaves v3 untouched. Data is never deleted before a verified copy. A crash between copy and delete leaves two legacy listings, never a loss. Manifest writes stay single `writeFile`, as today, so there is no regression. Readers fail closed (malformed means null or `unreadable`, never fresh). Follow-up recorded for Mode 3: add `rename` to the port in a later task. |
| R2: The plan's E batch would fail its own gate. `multi-phase-analysis.service.spec.ts:261,394,705` (F-owned) asserts v3 writes. That spec drives the real `AnalysisStorageService` over the in-memory FS (`spec:5,206-207`), and no checkpoint spec exists. | HIGH | Re-split: Batch 10 is a behavior-neutral read path. It adds v4 types and `readManifest`, keeps `loadManifest`, `createSlugDir`, `writeManifest` and the constructor unchanged for existing callers, and only adds methods. The v4 writer switch moves to Batch 12, together with `multi-phase-analysis.service.ts` and its spec. |
| R3: S1 changes `MultiPhaseAnalysisResponse.manifest` to a v3/v4 union in shared. That type is consumed by setup-wizard (`wizard-rpc.service.ts`, `wizard-analysis-state.ts`), ptah-cli (`setup.ts:54,132-137`), agent-generation (`analysis-storage.service.ts:491-525`) and rpc-handlers. | MEDIUM | Task 1.3 keeps the v3 member byte-identical and every common field present on v4. Batch 1 runs a typecheck of the four consumers. |
| R4: Proposal hydration and a live event race. A stale snapshot applied after a newer live event could revert fields. | MEDIUM | Task 7.2 buffers live events for the active session while `getProposal` is in flight, applies the snapshot first, then replays the buffer. Events for another session, or before the active session id is known, are dropped and recovered by hydration. Spec covers both orders. |
| R5: Session identity. A tab id must never be persisted. | HIGH | Task 9.1/9.2: an unresolved caller returns a tool error with no write and no broadcast. The spec covers the correlation-id path after lifecycle assigns `realSessionId`. |
| R6: Cross-process proposal writes. | MEDIUM | Task 4.1: per-session in-process queue plus a bounded `wx` lock file with expiry recovery. Re-read after the lock. A lock timeout rejects with no broadcast. Node `fs/promises` temp-write plus rename is available in rpc-handlers (precedent `handlers/file-edit-rpc.handlers.ts:349`). |
| R7: `HarnessConfigStore` writes under `~/.ptah`, but proposals must use the host workspace provider root, never `resolveSessionWorkspaceRoot`. | MEDIUM | Task 4.1 resolves the root from `PLATFORM_TOKENS.WORKSPACE_PROVIDER` for both write and read. Task 5.2 spec: get-proposal reads the same root the writer used. No caller-selected root. |
| R8: A new `@inject` token without a registration fails the pre-push di-lint. | LOW | Batches 4, 12 and 15 append `npx nx run di-lint:lint` to their check. |
| R9: Removing the New Project broadcast (Batch 5) breaks four Electron e2e event-injection specs and the 629-owned webview routing spec. | LOW | Producer only. The constant, payload, baseline entry and relay stay. e2e is not run (CLAUDE.md). Retargeting stays in the plan's Deferred review items until TASK_2026_629 merges. |
| R10: D1 duplicates the relay logic until D2 makes the relay delegate. | LOW | Task 7.2 deletes the handler's copy and delegates to `HarnessWorkflowRequestService`. Phase 2 review checks there is one implementation. |
| R11: Visual evidence. D1 changes Setup Hub modal timing (no new surface, no prototype). | MEDIUM | Mode 3 requires before/after visual-reviewer screenshots (dark and light) of the Setup Hub New Project intake. The before set is taken from base commit `2464e6922`. |

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

- `<host-workspace>/.ptah/harness/proposals/<sha256(sessionId)>.json` (+ `.lock`, temp files).
  Writer: Task 9.1 through the Task 4.1 store. Readers: Task 5.2 RPC, then Task 7.2 hydration.
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

## Batch 4: Workspace proposal store - IN_PROGRESS

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: a new service, its spec and DI registration. Tightly coupled.
- Tasks: 3 | Depends on: Batches 1, 2, 3
- Phase: 1 - Proposal backend | Phase review: code-logic, plus style

### Task 4.1: `HarnessProposalStore` service - IMPLEMENTED

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts` (new)
- Plan reference: implementation-plan.md:24, 46 (store, lock, retention)
- Pattern to follow: `harness/config/harness-config-store.service.ts` (node `fs/promises`); temp plus rename at `handlers/file-edit-rpc.handlers.ts:349`
- Quality requirements: implements `IHarnessProposalStore`. Root comes from `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, the same for read and write. Path is `<root>/.ptah/harness/proposals/<sha256(sessionId)>.json`. Per-session serial queue. Bounded `wx` lock file with expiry recovery, then re-read the latest record. Merge with `mergeHarnessConfigUpdates`. Atomic temp-write and rename. Lock failure rejects. Stored identity and root must match on read. Corrupt or mismatched records are logged and return null. Prune records older than 30 days during access. No workspace means a typed error.
- Validation notes: R6, R7.

### Task 4.2: Store spec - IMPLEMENTED

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts` (new)
- Quality requirements: concurrent partial writes, same-session merge, distinct-session isolation, read after restart (new instance), corrupt record rejection, 30-day pruning, two-process lock (a pre-held lock file), lock expiry recovery.

### Task 4.3: DI registration - IMPLEMENTED

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

## Batch 5: New Project handoff result and `harness:get-proposal` RPC - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: contract, registry, baseline, schema and handler must change together, or the
  allowlist and host-source contract specs fail.
- Tasks: 4 | Depends on: Batches 1, 4
- Phase: 1 - Proposal backend (last batch of the phase) | Phase review: code-logic, plus style

### Task 5.1: Return the handoff from `harness:start-new-project`; drop only its broadcast - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-harness.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts`
- Plan reference: implementation-plan.md:48-60 (section 2)
- Pattern to follow: the current flow at `harness-rpc.handlers.ts:813-904`
- Quality requirements: `HarnessStartNewProjectResult` (`rpc-harness.types.ts:512-515`) becomes the success/failure union with `seedPrompt`, `intake`, `plugins {enabledBundled, missingExternal, availableSkillIds}` and `toolchain?`. Reuse existing exported types. Intake Zod runs before side effects. Keep plugin enable and reconcile, `focusChat` and wizard-panel disposal before returning. Remove only the `HARNESS_OPEN_WORKFLOW` broadcast at `:872`. Keep the constant, payload, baseline entry and relay. If `harness:apply` params already carry a session id, delete that session's proposal after a successful apply. Otherwise wire nothing (30-day prune covers it) and say so in the report.
- Validation notes: R9. Plugin write failure stays a failed RPC.

### Task 5.2: Register `harness:get-proposal` - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc.types.ts` (first owner),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts` (first owner),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts`
- Plan reference: implementation-plan.md:46 (`registerGetProposal` beside `registerStartNewProject`, `:351-357`)
- Pattern to follow: `'harness:start-new-project'` at `rpc.types.ts:1794,3979`, `baseline.ts:179`, `HarnessRpcHandlers.METHODS` at `harness-rpc.handlers.ts:171`
- Quality requirements: `HarnessGetProposalParamsSchema = z.object({sessionId: z.string().trim().min(1).max(256)}).strict()`. Add to the METHODS list, then bind. Resolve the store via `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE`. Return `{proposal}`, which is null when absent or corrupt. Do NOT add `wizard:analysis-status` (F18, Batch 13). The baseline may be regenerated with `npx tsx scripts/generate-host-source-registry-baseline.ts`. Only the baseline file may change.

### Task 5.3: Handler spec - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.spec.ts`
- Quality requirements: intake validated before plugin effects. Enabled and missing plugin diagnostics are in the result. Required success fields are present. No `HARNESS_OPEN_WORKFLOW` broadcast. Focus and dispose happen before the response. get-proposal param rejection. get-proposal reads the same root the store wrote.

### Task 5.4: CLI surface confirmation (F19) - PENDING

- File: none edited. Decision recorded above: the CLI serves `harness:get-proposal`.
- Quality requirements: the cli-engine test passes with no cli-engine edit. If it fails, report it and stop. Do not edit `CLI_EXPECTED_ABSENT_METHODS`.

### Batch 5 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 && npx nx run-many -t test -p @ptah-extension/cli-engine --parallel=1`
- After commit: the Phase 1 review is due (Batches 1-5, combined diff).

## Batch 6: Direct New Project handoff in Setup Hub - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: frontend-developer sub-agent
- Execution mode: sequential
- Rationale: extracting a service, adding its spec and wiring its one caller is cross-file and
  coupled.
- Tasks: 3 | Depends on: Batch 5
- Phase: 2 - Builder adapters and MCP writer | Phase review: code-logic

### Task 6.1: RPC wrapper: typed handoff result and `getProposal` (F21) - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-rpc.service.ts`
- Pattern to follow: the existing `startNewProject` wrapper in the same file
- Quality requirements: `startNewProject` returns the new union. Add `getProposal(sessionId): Promise<HarnessGetProposalResult>`.

### Task 6.2: Extract `HarnessWorkflowRequestService` - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.spec.ts` (new)
- Plan reference: implementation-plan.md:60
- Pattern to follow: `harness-workflow-message.handler.ts:100-141` (request plus navigate)
- Quality requirements: same-mode resume, cross-mode abort and replacement, `AppStateManager.requestHarnessWorkflow`, navigation. Navigation failure rolls back (clears) the request and reports failure to the caller. The spec covers all four paths. Do not edit `libs/frontend/core`.
- Validation notes: R10. The relay copy is removed in Task 7.2.

### Task 6.3: Setup Hub uses the returned handoff - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/components/setup-hub.component.spec.ts`
- Plan reference: implementation-plan.md:60
- Pattern to follow: the intake submit at `setup-hub.component.ts:1440-1458`
- Quality requirements: on success, call the request service with `seedPrompt` and close the modal only after the request and navigation complete. Navigation failure keeps the modal open and clears the pending request. An RPC failure keeps the existing error display. No template or visual change.
- Validation notes: R11 (screenshots at Mode 3).

### Batch 6 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder --parallel=1`

## Batch 7: Session-filtered proposal consumer, hydration and compatibility relay - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: frontend-developer sub-agent
- Execution mode: sequential
- Rationale: the payload contract and its only typed consumer change together.
- Tasks: 3 | Depends on: Batch 6
- Phase: 2 - Builder adapters and MCP writer | Phase review: code-logic

### Task 7.1: `sessionId` on the config-proposed payload - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/messages/payload-map.ts`
- Quality requirements: required `sessionId: string` on `HarnessConfigProposedPayload` only. `HarnessOpenWorkflowPayload` (`:199-200`) and its map entry (`:417`) are unchanged.

### Task 7.2: Filter, hydrate and delegate the relay - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts`;
  reserve ownership, edited only if hydration cannot live in the handler:
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts` and its `.spec.ts`
- Plan reference: implementation-plan.md:46 (last sentences), 50
- Pattern to follow: the current switch at `harness-workflow-message.handler.ts:34-150`
- Quality requirements: apply `HARNESS_CONFIG_PROPOSED` only when `payload.sessionId` equals `HarnessWorkflowService.sessionId()`. When that id becomes non-null or changes, call `getProposal` and apply the snapshot to fresh state. Buffer live events for that session while the call is in flight and replay them after (R4). A `getProposal` failure is logged and keeps live state. The `HARNESS_OPEN_WORKFLOW` case stays, and its body delegates to `HarnessWorkflowRequestService`. Delete the handler's own request/navigation code (R10). Report whether the reserve files were used.

### Task 7.3: Handler spec - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts`
- Quality requirements: the legacy open-workflow event still navigates through the request service. A matching session applies. A non-matching session is ignored. Reload hydrates only the matching session before any new tool call. Live event during hydration arrives after the snapshot. Hydration failure is non-fatal.

### Batch 7 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder @ptah-extension/shared --parallel=1`

## Batch 8: Frontend adopts the shared merge - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: frontend-developer sub-agent
- Execution mode: sequential
- Rationale: one service and its existing spec.
- Tasks: 1 | Depends on: Batches 2, 7
- Phase: 2 - Builder adapters and MCP writer | Phase review: code-logic

### Task 8.1: Replace the local merge with `mergeHarnessConfigUpdates` - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.spec.ts`
- Plan reference: implementation-plan.md:46
- Quality requirements: `applyConfigUpdates` delegates to the shared function. The old helpers at `:325-410` are deleted. Existing spec cases pass unchanged. Add one case asserting state equals `mergeHarnessConfigUpdates` output for a mixed update.

### Batch 8 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder --parallel=1`

## Batch 9: Session-scoped MCP proposal writer - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the namespace dependency, its builder wiring and the dispatcher path are one call
  chain.
- Tasks: 3 | Depends on: Batches 3, 4, 7
- Phase: 2 - Builder adapters and MCP writer (last batch of the phase) | Phase review: code-logic

### Task 9.1: `proposeConfig` persists, then broadcasts with `sessionId` - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts`
- Plan reference: implementation-plan.md:24, 46
- Pattern to follow: the current `proposeConfig` at `harness-namespace.builder.ts:1066-1090`
- Quality requirements: add `getCallerSdkSessionId` and `saveProposal` to `HarnessNamespaceDependencies`. Validate with Zod first. A missing session id throws a tool error, with no save and no broadcast. Await `saveProposal`, and on failure throw with no broadcast. Then broadcast `{sessionId, configUpdates, isConfigComplete}`. A missing broadcaster is non-fatal. The spec covers absent id, save failure, persist-before-broadcast order and the `sessionId` in the payload (F17).
- Validation notes: R5.

### Task 9.2: `PtahAPIBuilder` wiring - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts`
- Pattern to follow: the per-call container lookup (`:509-516`), `resolveCallerSdkSessionId` (`:1035-1066`), harness wiring (`:860-883`)
- Quality requirements: `getCallerSdkSessionId: () => this.resolveCallerSdkSessionId()`. `saveProposal` resolves `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE` from `this.container` per call, and an absent container or store is a thrown error. Never use `resolveSessionWorkspaceRoot` for proposals. The spec covers the builder correlation id resolving after lifecycle assigns `realSessionId`, and a tab id never persisted.

### Task 9.3: Dispatcher error path - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Pattern to follow: `protocol-dispatcher.ts:2222-2249`
- Quality requirements: an unresolved-session or persistence rejection comes back as an `isError` tool result with a clear message, not a crash. Edit the dispatcher only if the existing throw path does not already produce that. Add a spec case either way.

### Batch 9 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --parallel=1`
- After commit: the Phase 2 review is due (Batches 6-9, combined diff).

## Batch 10: Manifest v4 types and validated read path (behavior-neutral) - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: types, barrels and storage read methods are coupled. Existing write paths are
  untouched (R2).
- Tasks: 3 | Depends on: Batch 1
- Phase: 3 - Manifest v4 and freshness | Phase review: code-logic, plus style (new exports)

### Task 10.1: v3/v4 types, schemas and barrels - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/types/multi-phase.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/types/index.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/index.ts` (first owner)
- Plan reference: implementation-plan.md:62-88
- Pattern to follow: `multi-phase.types.ts:34-102`
- Quality requirements: `MultiPhaseManifestV3` and `MultiPhaseManifestV3Schema` hold today's shape. Add `PhaseResultV4`, `MultiPhaseManifestV4` and a strict `MultiPhaseManifestV4Schema` with the plan's refinements (completed implies session, input and verified hash; failed implies error; 64-hex hashes). Keep the exported name `MultiPhaseManifest` as `V3 | V4` so existing consumers compile (F20). Keep `MultiPhaseManifestSchema` exported. The v4 type must be assignable to the shared v4 response member (Task 1.3).

### Task 10.2: Storage: `readManifest`, compatible `loadManifest`, `archiveLegacyRun`, resumable filter - PENDING

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

### Task 10.3: Storage spec - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts`
- Quality requirements: the exact v3 read-only path. Malformed and unsupported versions return null, with the file bytes unchanged. v4 round-trip. Archive preserves every v3 file and deletes only after a verified copy. Archive failure leaves v3 intact. The resumable filter excludes v3. `loadManifest` returns `runId` for both versions.

### Batch 10 verification

- Command:
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1 && npx nx typecheck @ptah-extension/rpc-handlers && npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts --coverage=false --maxWorkers=2 && npx nx run-many -t typecheck -p @ptah-extension/setup-wizard ptah-cli --parallel=1`
- The F-owned `multi-phase-analysis.service.spec.ts` must pass unchanged inside the agent-generation run (R2).

## Batch 11: Analysis freshness service and DI - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: a new service, its spec, its token, registration and export.
- Tasks: 3 | Depends on: Batch 10
- Phase: 3 - Manifest v4 and freshness | Phase review: code-logic, plus style

### Task 11.1: `AnalysisFreshnessService` and `computeWorkspaceFingerprint` - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts` (new)
- Plan reference: implementation-plan.md:90-103
- Pattern to follow: `AnalysisStorageService` DI shape (`analysis-storage.service.ts:54-60`). Do not reuse memory-curator's `deriveWorkspaceFingerprint`: it is an identity hash, not a content hash.
- Quality requirements:
  - `ANALYSIS_MAX_AGE_MS` is 7 days.
  - The fingerprint uses `sha256-v1` over root package manifests and lockfiles (name plus bytes) and sorted top-level names. It excludes `.ptah`, `.git`, dependencies and generated outputs. Read through `IFileSystemProvider`.
  - `getStatus(workspaceRoot | null): Promise<AnalysisStatus>`. Fresh only when: v4, completed, all four outputs verified, present and hash-matched, fingerprint equal, and age within the limit.
  - Reasons match the plan's enum. Any read error gives stale/`unreadable`, never fresh. No root gives missing.
  - Read-only: no disk writes.

### Task 11.2: Token, registration, export - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/di/tokens.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/di/register.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/index.ts` (second owner, after Batch 10)
- Quality requirements: `AGENT_GENERATION_TOKENS.ANALYSIS_FRESHNESS_SERVICE`, registered as a singleton beside `ANALYSIS_STORAGE_SERVICE`. Export the class, `computeWorkspaceFingerprint` and `ANALYSIS_MAX_AGE_MS`.

### Task 11.3: Freshness spec - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-freshness.service.spec.ts` (new)
- Quality requirements: the full reason matrix (ok, no-analysis, legacy-v3, incomplete, expired at the boundary, workspace-changed, output-mismatch, unreadable). Fingerprint is stable under directory order and changes with lockfile bytes. No writes (spy on the FS).

### Batch 11 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1`

## Batch 12: v4 writer and SDK session capture - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the checkpoint has no spec of its own. Writer, caller and the one spec that drives
  them must change together (R2).
- Tasks: 3 | Depends on: Batches 10, 11
- Phase: 3 - Manifest v4 and freshness | Phase review: code-logic, plus style

### Task 12.1: Capture the real SDK session id per phase attempt - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`
- Plan reference: implementation-plan.md:62-64
- Pattern to follow: `createTextCapturingStream` (`:815-846`) and `isSystemInit` (`libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:352`)
- Quality requirements: take the first non-empty `session_id`. Prefer `system/init`, and fail on disagreement. No id at all gives a typed phase failure and stays unverified. Never record `WizardPhaseId.fromPhase` (`:717-768`). Compute the prompt, prior-phase and output SHA-256 and pass them to the checkpoint. Keep timeout and abort behavior (`:630-673`).

### Task 12.2: Checkpoint writes v4; v3 resume archives and starts fresh - PENDING

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

### Task 12.3: Multi-phase spec - PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts`
- Quality requirements:
  - Update the v3 assertions at `:261,394,705` to v4 semantics.
  - Session id handling: an init id versus the synthetic UI id; a stream without init uses the first message id; a stream with no id fails.
  - A paused v3 run is archived, never erased, and a new v4 run starts.
  - Output mismatch invalidates downstream phases.
  - Attempt increments and verified hashes are correct.

### Batch 12 verification

- Command:
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1 && npx nx typecheck @ptah-extension/rpc-handlers && npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts --coverage=false --maxWorkers=2 && npx nx run-many -t typecheck,test -p @ptah-extension/setup-wizard --parallel=1 && npx nx typecheck ptah-cli && npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/analyze.spec.ts --coverage=false --maxWorkers=2 && npx nx run di-lint:lint`
- This covers the parity row "CLI deep analysis" (the plan's batch E CLI verification).

## Batch 13: `wizard:analysis-status` RPC - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the registry entry, baseline, schema and handler land together (F18).
- Tasks: 3 | Depends on: Batches 5, 11, 12
- Phase: 3 - Manifest v4 and freshness (last batch of the phase) | Phase review: code-logic, plus style

### Task 13.1: Register the method (F18) - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc.types.ts` (second owner, after Batch 5),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts` (second owner),
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts`
- Pattern to follow: `'wizard:get-resumable-run'` at `rpc.types.ts:1005-1008,3795`, `baseline.ts:409`, `setup-rpc.schema.ts:26`
- Quality requirements: the registry entry uses the Task 1.3 types. `WizardAnalysisStatusParamsSchema = z.object({})`.

### Task 13.2: Handler and spec - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:103
- Pattern to follow: `registerGetResumableRun` (`setup-rpc.handlers.ts:405-449`), `METHODS` (`:86`)
- Quality requirements: add the method to `METHODS`, then bind. Resolve via `AGENT_GENERATION_TOKENS.ANALYSIS_FRESHNESS_SERVICE`. No workspace returns missing. Read-only. `get-resumable-run` keeps its response type, and its spec reflects that v3 is not resumable. The spec covers params validation, no disk mutation, and no workspace.

### Task 13.3: CLI surface confirmation (F19) - PENDING

- File: none edited. Same rule as Task 5.4.

### Batch 13 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 && npx nx run-many -t test -p @ptah-extension/cli-engine --parallel=1`
- After commit: the Phase 3 review is due (Batches 10-13, combined diff).

## Batch 14: Agent generation falls back to gathered context - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: the RPC gate and the orchestrator fallback are one decision path.
- Tasks: 2 | Depends on: Batch 11
- Phase: 4 - Self-gathering generation | Phase review: code-logic

### Task 14.1: Freshness gate at `wizard:submit-selection` - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:107
- Pattern to follow: path authorization at `wizard-generation-rpc.handlers.ts:215-295`
- Quality requirements: authorize first, as today. Pass `preComputedAnalysis` and `analysisDir` only when the status is fresh. Otherwise omit both, report the stale status, and do not reject. Preserve selected ids, overrides, checkpoint, resume and retry. An unauthorized path is still rejected.

### Task 14.2: Orchestrator stale fallback - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/orchestrator.service.spec.ts`
- Pattern to follow: the self-analysis branch at `orchestrator.service.ts:372-399`, `566-638`
- Quality requirements: missing or stale analysis still generates from `analyzeWorkspace`. Gathered context reaches the content prompt (prompt-input test). Fresh analysis keeps the richer path.

### Batch 14 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers @ptah-extension/agent-generation --parallel=1`

## Batch 15: Prompt and content generation fall back to gathered context - PENDING

- Recommended executor: implementation CLI lane, one lane
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: two services in one library share the freshness decision.
- Tasks: 3 | Depends on: Batches 11, 14
- Phase: 4 - Self-gathering generation (last batch of the phase) | Phase review: code-logic

### Task 15.1: Content generation omits stale `analysisDir` - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/content-generation.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/content-generation.service.spec.ts`
- Pattern to follow: the resolver at `content-generation.service.ts:571-587`
- Quality requirements: use phase text only for a fresh manifest. Otherwise use the formatted context summary. Prompt-input test.

### Task 15.2: Enhanced prompts: no hard failure, validated enrichment - PENDING

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

### Task 15.3: CLI consumer confirmation - PENDING

- File: none edited.
- Quality requirements: the ptah-cli prompts, setup and wizard command specs pass. This covers parity rows 32-34 (the plan's batch I CLI verification).

### Batch 15 verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1 && npx nx typecheck ptah-cli && npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/prompts.spec.ts apps/ptah-cli/src/cli/commands/setup.spec.ts apps/ptah-cli/src/cli/commands/wizard.spec.ts --coverage=false --maxWorkers=2 && npx nx run di-lint:lint`
- After commit: the Phase 4 review is due (Batches 14-15, combined diff).

---

## Phases

| Phase | Batches | Review | Reviewer (roster) |
| --- | --- | --- | --- |
| 1 - Proposal backend | 1-5 | code-logic, plus style (new platform port, new RPC, shared contracts) | code-logic on a review CLI lane of a different family from the implementer; style per orchestrator |
| 2 - Builder adapters and MCP writer | 6-9 | code-logic | same |
| 3 - Manifest v4 and freshness | 10-13 | code-logic, plus style (new RPC, exported service) | same |
| 4 - Self-gathering generation | 14-15 | code-logic | same |

Mode 3 completion also needs:
- parity-inventory.md, checked row by row;
- before/after Setup Hub screenshots in dark and light (R11);
- the write-path trace (register above);
- the follow-up note for R1 (port `rename`).
