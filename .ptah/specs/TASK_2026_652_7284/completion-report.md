# Completion Report - TASK_2026_652_7284 (Mode 3)

Date: 2026-10-15. Branch `task-647-setup-hub-chat-sessions`, HEAD `f778edd66`.
`origin/main` (PR #730, TASK_2026_629) was merged in at `88b88efc8`, and the merge-base with
`origin/main` is `c57a9a1e7`. The original task base is `2464e6922`.

State: **TASK COMPLETE** (orchestrator, 2026-10-15). Fix-now items ran as Batch 25 `3d2de3565`
(D15): FU-16, P4-F2 and P4-N1 are closed. The R11 screenshots were skipped by user decision D14.
There are no blocking findings.

## 1. Batch and commit verification

All 24 batches are COMPLETE in `batches.md`, and every batch SHA resolves as an ancestor of HEAD.

| Batch | Name | Commit |
| --- | --- | --- |
| 1 | Shared proposal and status contracts | 58d543298 |
| 2 | Shared field-aware merge utility | 0e9813f89 |
| 3 | Platform proposal store port | b82a94f7c |
| 4 | Workspace proposal store | 7e6d98bd2 |
| 5 | New Project handoff result and `harness:get-proposal` | 48fbb5673 |
| 16 | Phase 1 review fixes (+ formatting 8afe14ce5) | 678f0d632 |
| 17 | Degradation-audit markers on the proposal store | 94eb0149d |
| 9 | Session-scoped MCP proposal writer | 9f98ea07c |
| 18 | Phase 2B review test fixes | ae20af1ca |
| 10 | Manifest v4 types and read path | 27bf6b468 |
| 11 | Analysis freshness service | 93fe34db7 |
| 12 | v4 writer and SDK session capture | 54f4932c0 |
| 13 | `wizard:analysis-status` RPC | 29519e705 |
| 19 | Phase 3 fix: archive safety, fallback dir | 6fa3cf939 |
| 20 | Phase 3 fix: fingerprint module | 6b6effdeb |
| 21 | Phase 3 fix: checkpoint fallback | 35f663e2f |
| 22 | Phase 3 fix: docs and baseline order | 9483de5c1 |
| 14 | Freshness gate at `wizard:submit-selection` | 90e577f99 |
| 15 | Prompt and content generation fall back | d6938d874 |
| 23 | Phase 4 fix: submit slot reservation | 4d5432f76 |
| 6 | Direct New Project handoff in Setup Hub | f576fd028 |
| 7 | Session-filtered consumer and hydration | 0365fdda0 |
| 8 | Frontend adopts the shared merge | 0a9785d87 |
| 24 | Phase 2F fix: persisted session ids | 2775fbe6b |

Phase reviews: 1, 2B, 3, 4 and 2F are all ACCEPTED (see "Phases" in `batches.md`). Implementer
family codex. Code-logic reviewers were from other families: antigravity until its quota ran out,
then opencode (D11). Style reviews were in-process (claude family).

Mode 3 corrected `batches.md` in three places. Tasks 6.1, 6.2, 6.3, 7.2, 7.3 and 8.1 still read
PENDING inside COMPLETE batches, and are now COMPLETE. The Batch 24 header now carries
`2775fbe6b`. The header count is now 24/24.

### Post-merge verification (this Mode 3 run, HEAD `f778edd66`)

Before this run, the `origin/main` merge had brought 57 files into the five backend projects, and
only harness-builder had been checked after it (Batches 6-8 and 24). Mode 3 therefore re-ran the
checks one project at a time, following the memory-safe rules:

| Project | typecheck | test |
| --- | --- | --- |
| @ptah-extension/shared | PASS | PASS: 114 suites, 3599 tests |
| @ptah-extension/platform-core | PASS | PASS: 47 suites, 1093 passed, 4 todo |
| @ptah-extension/vscode-lm-tools | PASS | PASS: 91 suites, 3027 tests |
| @ptah-extension/rpc-handlers | PASS | PASS: 155 suites, 4469 passed, 7 skipped |
| @ptah-extension/agent-generation | PASS | PASS: 37 suites, 1280 passed, 1 skipped |
| @ptah-extension/harness-builder | PASS (Batch 24, post-merge) | PASS: 7 suites, 153 tests (Batch 24) |

Lint was not re-run after the merge; every batch passed lint at its commit. The pre-push hook
runs di-lint and `validate-deps`.

## 2. Parity verification (parity-inventory.md, row by row)

The task changes an existing surface (the New Project flow, proposal delivery and the analysis
manifest), so `parity-inventory.md` is required, and it exists. It was compared with the old code
at `2464e6922` (harness handler, Setup Hub, builder state, start-new-project RPC, storage,
checkpoint, enhanced prompts, content generation, CLI commands). No old capability was found that
the inventory misses. `git diff c57a9a1e7 HEAD -- apps/` is empty: the CLI commands are
unchanged.

Status legend:
- KEPT: the capability is present on HEAD, behaving as the Gate 2-approved plan describes.
- CHANGED-WITH-APPROVAL: an inventory `move`, or a behavior change that the Gate 2 plan approved
  by the user on 2026-10-13 explicitly specifies.
- MISSING: none.

| # | Capability | Status | HEAD implementation | Test |
| --- | --- | --- | --- | --- |
| 1 | Validate partial harness config, reject malformed fields | KEPT | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:1084-1094`; schema `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:374`; tool `.../mcp-core/protocol-dispatcher.ts:2225-2262` | `harness-namespace.builder.spec.ts:418`; `protocol-dispatcher.spec.ts:567,587` |
| 2 | Broadcast accepted updates + completion flag | KEPT | `harness-namespace.builder.ts:1098-1114` (session, then `await saveProposal`, then broadcast with `sessionId`); wiring `ptah-api-builder.service.ts:875-895`; payload `libs/shared/src/lib/types/messages/payload-map.ts:219-220` | `harness-namespace.builder.spec.ts:481` (order save then broadcast), `:472` (no broadcast on save failure) |
| 3 | Apply updates to Configure preview | KEPT | `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:152-173` (session-filtered), hydration `:88-150` | `harness-workflow-message.handler.spec.ts:158,171,181,197,227,274` |
| 4 | Restore proposal after reload (was a gap) | KEPT (new) | store `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts:60-105`, DI `harness/di.ts:61`; RPC `handlers/harness-rpc.handlers.ts:911-924`; frontend `harness-rpc.service.ts:301`, `harness-workflow.service.ts:192,238,582`, `harness-workflow-message.handler.ts:113` | `harness-proposal-store.service.spec.ts:47-209`; `harness-rpc.handlers.spec.ts:1126,1133,1144`; `harness-workflow.service.spec.ts:187,645,653`; `harness-workflow-message.handler.spec.ts:312,327,353` |
| 5 | Validate intake before plugin effects | KEPT | `harness-rpc.handlers.ts:822-824` | `harness-rpc.handlers.spec.ts:1107` |
| 6 | Enable bundled plugins, reconcile harness | KEPT | `harness-rpc.handlers.ts:829-849` | `harness-rpc.handlers.spec.ts:664,716,755,843` |
| 7 | Detect missing plugins/skills/toolchain; compose seed | KEPT (delivery is now the RPC result) | `harness-rpc.handlers.ts:721-813,850-856,883-893`; type `rpc-harness.types.ts:516-528` | `harness-rpc.handlers.spec.ts:664,772,858,892,915,1006,1030,1054,1082` |
| 8 | Focus chat, dispose wizard webview | KEPT | `harness-rpc.handlers.ts:858-882` (before the response); `setup-hub.component.ts:1449-1460` | `harness-rpc.handlers.spec.ts:664,742`; `setup-hub.component.spec.ts:320` |
| 9 | Broadcast New Project request (`HARNESS_OPEN_WORKFLOW`) | CHANGED-WITH-APPROVAL (inventory `move`) | no backend producer; compat kept: `message-constants.ts:204`, `payload-map.ts:201`, relay `harness-workflow-message.handler.ts:40-86` | `harness-rpc.handlers.spec.ts:709`; `harness-workflow-message.handler.spec.ts:83-144`; `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts:236` |
| 10 | Same-mode resume, cross-mode abort, route to builder | KEPT (relocated) | `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:22-63`, used by `setup-hub.component.ts:1449` and relay `harness-workflow-message.handler.ts:64` | `harness-workflow-request.service.spec.ts:54-100` |
| 11 | Close intake modal on New Project success | KEPT (closes once navigation lands, as planned) | `setup-hub.component.ts:1445-1460` | `setup-hub.component.spec.ts:295,320,343,354,367` |
| 12 | Write manifest before SDK work; resume a compatible run | KEPT (v4 writer, v3 reader) | `libs/backend/agent-generation/src/lib/services/wizard/analysis-run-checkpoint.ts:52-179`; `analysis-storage.service.ts:334-358` | `multi-phase-analysis.service.spec.ts:266,610,1085` |
| 13 | Skip completed phase, rerun active phase on resume | KEPT (a skip also needs hashes that verify, as planned) | `multi-phase-analysis.service.ts:268-282`; checkpoint `:120-121,192-223`; RPC `setup-rpc.handlers.ts:353` | `multi-phase-analysis.service.spec.ts:610,1040`; `setup-rpc.handlers.spec.ts:1642` |
| 14 | Persist phase status and duration (+ v4 fields) | KEPT | `analysis-run-checkpoint.ts:234-304` | `multi-phase-analysis.service.spec.ts:266,328,413,478` |
| 15 | Reject malformed or old manifest without rewriting it | KEPT | `analysis-storage.service.ts:328-358` | `analysis-storage.service.spec.ts:313,331,361,382`; `multi-phase-analysis.service.spec.ts:883` |
| 16 | Resume a paused v3 analysis | CHANGED-WITH-APPROVAL (inventory `move`: archive, then a distinct v4 run) | `analysis-run-checkpoint.ts:79-138`; `analysis-storage.service.ts:361-456` (`archiveLegacyRun`), `:122-133` (`--v4` fallback) | `multi-phase-analysis.service.spec.ts:899,929,977`; `analysis-storage.service.spec.ts:202,420,443,464,486` |
| 17 | List latest/resumable runs, expose phase contents | KEPT (+ freshness through the sibling RPC) | `analysis-storage.service.ts:626` (`list` keeps archives), `:461-477`, `:484-517`; `setup-rpc.handlers.ts:411-456`, `:459-473` (`wizard:analysis-status`) | `analysis-storage.service.spec.ts:685,737,864`; `setup-rpc.handlers.spec.ts:353-409,581,598` |
| 18 | Generate agents from supplied analysis | KEPT (fresh only, as planned) | `orchestrator.service.ts:307-371`; gate `wizard-generation-rpc.handlers.ts:302-308,335-339` | `orchestrator.service.spec.ts:352`; `wizard-generation-rpc.handlers.spec.ts:775,830` |
| 19 | Analyze the workspace without precomputed analysis | KEPT (also used for stale analysis) | `orchestrator.service.ts:372-399,566` | `orchestrator.service.spec.ts:379,555`; `wizard-generation-rpc.handlers.spec.ts:798` |
| 20 | Phase text for content, else context summary | KEPT (stale `analysisDir` omitted) | `content-generation.service.ts:587-627` | `content-generation.service.spec.ts:1669,1689` |
| 21 | Authorize analysis path + checkpoint before launch | KEPT | `wizard-generation-rpc.handlers.ts:250` (reservation), `:260` (authorize), `:286` (freshness), `:312` (checkpoint), `:350` (options), `:1000-1016` | `wizard-generation-rpc.handlers.spec.ts:747,798,880,1007` |
| 22 | Enrich the prompt with completed phase files | KEPT (fresh validated manifest only) | `enhanced-prompts.service.ts:967-1078` | `enhanced-prompts.service.spec.ts:1144,1217,1261` |
| 23 | Gather workspace details for prompt generation | KEPT (also for missing/stale analysis) | `enhanced-prompts.service.ts:418-470` | `enhanced-prompts.service.spec.ts:652,1499` |
| 24 | Regenerate and invalidate cache when forced | KEPT (no longer refuses without analysis; it self-discovers) | `enhanced-prompts.service.ts:644-674`; RPC `enhanced-prompts-rpc.handlers.ts:455-500` | `enhanced-prompts.service.spec.ts:1420,1499`; `enhanced-prompts-rpc.handlers.spec.ts:624` |
| 25 | CLI deep analysis + phase progress | KEPT (no diff; it reads fields present on v3 and v4) | `apps/ptah-cli/src/cli/commands/analyze.ts:57-73,95-120,150-170` | `analyze.spec.ts:163,192` |
| 26 | CLI prompt regeneration | KEPT (no diff) | `apps/ptah-cli/src/cli/commands/prompts.ts:162-175` | `prompts.spec.ts:221,247` |
| 27 | CLI setup generation | KEPT (no diff) | `apps/ptah-cli/src/cli/commands/setup.ts:132-149,232-235` | `setup.spec.ts:241,348` |
| 28 | CLI wizard selection submission | KEPT (no diff) | `apps/ptah-cli/src/cli/commands/wizard.ts:125,209-210,445-452` | `wizard.spec.ts:214,243` |

Result: 0 MISSING, and no user-visible capability was removed without approval (keep-and-fix
rule met). Two rows are approved moves (9, 16). The other behavior changes (freshness gating, the
hash-verified skip, the modal closing after navigation, regenerate without prior analysis) are the
user-approved Gate 2 design.

Item for the PR description (not blocking): the plan assumption "row 17, same RPC plus freshness
status, is met by the sibling `wizard:analysis-status` RPC" is recorded in `batches.md` as
unverified with the user. `wizard:get-resumable-run` keeps its response type. The PR should say
so, so the user can confirm.

## 3. Write-path trace

### W1. Harness proposals: `<host-workspace>/.ptah/harness/proposals/<sha256(trimmed sessionId)>.json`

- Writer chain:
  1. MCP `ptah_harness_propose_config` (`protocol-dispatcher.ts:2225`).
  2. `harness.proposeConfig` (`harness-namespace.builder.ts:1084-1114`): zod check, caller session
     via `ptah-api-builder.service.ts:1056-1081` (lifecycle `realSessionId`; with no session it
     throws `HarnessProposalNoSessionError`, so nothing is written and nothing is broadcast).
  3. `saveProposal` resolves `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE` (`ptah-api-builder.service.ts:875-886`).
  4. `HarnessProposalStore.save` (`harness-proposal-store.service.ts:60-97`).
- Key and root:
  - The root comes from `PLATFORM_TOKENS.WORKSPACE_PROVIDER.getWorkspaceRoot()` (`:56-57,107-111`).
    The caller cannot choose it. With no root, the store throws `HARNESS_PROPOSAL_NO_WORKSPACE`.
  - The directory is built at `:113-115`.
  - The file name is the sha256 of the id that `HarnessSessionIdSchema` trimmed (`:65,117-120`).
  - R5 and R7 are met.
- Format: JSON `{version:1, workspaceRoot, sessionId, configUpdates, isConfigComplete, updatedAt}`,
  checked by `HarnessProposalSchema` (`rpc-harness.schemas.ts:465-478`). Each save merges the new
  updates into the stored ones with `mergeHarnessConfigUpdates` (`:80-83`).
- Atomicity: the store writes a temp file `${file}.<hex>.tmp` (opened with `wx`), then `rename`s
  it into place (`:154-165`). The temp file is removed on failure.
- Locks:
  - In-process: `serializeByKey(file)` (`:69`).
  - Cross-process: `withFileLock(${file}.lock)`, stale 10 s, wait 12 s (`:72-95`;
    `libs/backend/harness-sync/src/lib/lock/file-lock.ts:135-151,181-224`).
- Readers:
  - `harness:get-proposal` (`harness-rpc.handlers.ts:911-923`; params `harness-rpc.schema.ts:195-197`).
  - The frontend `HarnessRpcService.getProposal` (`harness-rpc.service.ts:301-311`, 30 s RPC timeout).
  - `HarnessWorkflowMessageHandler.hydrate` (`harness-workflow-message.handler.ts:113-150`). It
    applies a proposal only when the session id matches (`:120`). Live events are buffered during
    hydration (`:166`) and replayed afterwards (`:136-149`), which handles R4.
- Malformed data:
  - Bad JSON, a schema failure, or an id/root mismatch: a warning is logged and the read returns
    null (`:122-152`).
  - A frontend RPC error is logged, and hydration moves on to the next session (`:124-131`).
- Retention: records older than 30 days are pruned (`:167-217`). A record whose `.lock` file
  exists is skipped.
- Verdict: **intended**. This is a new write; nothing read this file before the branch. Minor
  observations MO-2, MO-3 and MO-6 are listed in section 5.

### W2. Frontend persisted workflow: `localStorage['ptah.harness.workflow.v1']`

- Write: `harness-workflow.service.ts:229-243` through `writeStorage` (`:522-534`), which catches
  and warns on failure. Batch 24 adds `sessionIds`.
- Read:
  - `readStorage` (`:547-558`) returns null on bad JSON or a failed type guard.
  - The guard `isPersistedWorkflow` (`:70-95`) treats `sessionIds` as optional, so **a record in
    the old shape (only `sessionId`) still loads**. Its restored ids become `[]` (`:582-586`).
  - The restored ids are merged with the registry sessions (`:192-200`).
- Verdict: **intended, upgrade-compatible**. The key is unchanged.

### W3. Analysis manifest v4: `<workspace>/.ptah/analysis/<slug>/manifest.json`

- Writer:
  - `AnalysisRunCheckpoint.open` (`analysis-run-checkpoint.ts:52-179`). Every transition goes
    through `persist()` (`:306-314`), which parses with `MultiPhaseManifestV4Schema`
    (`multi-phase.types.ts:163-178`; a completed phase needs verified output) and calls
    `storage.writeManifest` (`analysis-storage.service.ts:310-319`).
  - The run directory comes from `getRunDir`: the primary slug, or `<slug>--v4` as the fallback
    (`:122-133`).
- Atomicity: a single `IFileSystemProvider.writeFile`, the same as before the branch (R1).
- Readers:
  - `readManifest` (`:334-358`) dispatches on v3 or v4. v2, unknown versions, bad JSON and schema
    failures all return null, and the file is never rewritten. `loadManifest` is at `:328-330`.
  - `findLatestMultiPhaseAnalysis` (`:461-477`) skips archives.
  - `findLatestResumableRun` (`:484-517`) skips archives and v3.
  - `list` (`:626-647`).
  - Freshness: `analysis-freshness.service.ts:49-144`. A thrown error reports `stale/unreadable`,
    never fresh.
  - `setup-rpc.handlers.ts:430,463-471`.
  - `wizard-generation-rpc.handlers.ts:273-349`.
  - `enhanced-prompts.service.ts:976-1078`.
  - `content-generation.service.ts:586-627`.
  - `wizard-generation-checkpoint.service.ts:130-135`: `?.runId` is informational, and null means
    no linkage (F20).
- Is v3 ever rewritten as v4 in place? **No.**
  - `writeManifest` has a single caller (`analysis-run-checkpoint.ts:310`).
  - A v3 primary run is either archived first, or the v4 run goes to `<slug>--v4` (`:79-94`).
- Verdict: **intended**.

### W4. v3 archive: `<workspace>/.ptah/analysis/<slug>-v3-archive-<ULID>/`

- Writer: `archiveLegacyRun` (`analysis-storage.service.ts:361-432`). Steps:
  1. Checks the run is directly under the analysis root (`:367`).
  2. Requires a valid v3 manifest (`:372-377`).
  3. Creates the archive with `createDirectoryExclusive` (`:387`).
  4. Copies and verifies byte equality per file (`copyDirectoryVerified`, `:434-456`).
  5. Re-reads the copy and requires an identical v3 manifest (`:391-397`).
  6. Deletes the source (`:400`).
- Failure handling:
  - If the delete fails, the source is restored from the archive and the error is rethrown
    (`:401-407`).
  - Any other failure removes the archive only if the source is still a valid v3 run
    (`:410-421`), then throws `LegacyRunArchiveError`.
  - The caller then falls back to `<slug>--v4` (`analysis-run-checkpoint.ts:82-99,136-144`).
  - Data is never deleted before a verified copy exists (R1 mitigation).
- Readers:
  - `list` keeps archives: it is the only way a user reaches an archived v3 analysis
    (keep-and-fix).
  - `findLatest` (`:468`), `findLatestResumableRun` (`:495`) and freshness
    (`analysis-freshness.service.ts:105-109`) exclude archives through `isLegacyArchiveDirName`
    (`analysis-storage.service.ts:52-54`).
- Verdict: **intended**. See FU-13, FU-14 and MO-4.

### W5. Other writes

The non-spec diff adds no `globalState`, `workspaceState` or webview `setState` writes. Phase-file
and generation-checkpoint writes existed before the branch, and their format is unchanged.

## 4. R1 follow-up: add `rename` to the file-system port

- **Status: OPEN, a separate task.** `IFileSystemProvider`
  (`libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:17-140`) still
  exposes `readFile` `:22`, `writeFile` `:34`, `delete` `:64`, `createDirectory` `:73`,
  `createDirectoryExclusive` and `copy` `:98`. It has no `rename` or `move`.
- Effect today:
  - The v3 archive is copy, verify, then delete (`analysis-storage.service.ts:361-456`), not an
    atomic move.
  - Manifest writes are a single `writeFile` (`analysis-storage.service.ts:315`, `:534`), as they
    were before the branch.
  - A crash between copy and delete leaves two legacy listings and never loses data. A torn
    `manifest.json` from a crash mid-write reads as null (fails closed), not fresh.
  - The proposal store does not use the port. It uses `fs/promises` temp+rename directly, so it is
    already atomic.
- Proposed task scope:
  - Add `rename(from, to, {overwrite})` to the port, with the Electron adapter (`fs.rename`), the
    VS Code adapter (`workspace.fs.rename`), the CLI adapter and the mock in
    `platform-core/src/testing/mocks/file-system-provider.mock.ts`.
  - Then switch `writeManifest` to temp+rename, and `archiveLegacyRun` to rename with a
    copy-verify fallback for cross-device moves.
  - Projects affected: platform-core, its three host adapters, agent-generation. This is outside
    this run, because it adds a port method every host must implement.

## 5. Follow-ups and recorded Minor items (consolidated)

Severity is taken from the review that raised each item. "Fix-now" means tiny, low-risk, and in a
project this branch already changed.

| ID | Item | Status | Severity | HEAD file:line | Recommendation |
| --- | --- | --- | --- | --- | --- |
| FU-1 | harness-sync lock: `breakIfStale` check-then-remove; `release` removes by path | open | Serious residual (pre-existing) | `libs/backend/harness-sync/src/lib/lock/file-lock.ts:181-210,212-224` | Defer: own task; affects every `withFileLock` caller; harness-sync is not changed by this branch |
| FU-2 | `IHarnessProposalStore` header + token JSDoc | open | Moderate (docs) | `libs/backend/platform-core/src/interfaces/harness-proposal-store.interface.ts:3-12`; `platform-core/src/di/tokens.ts:78-79` | Defer (docs; bundle with the R1 port task) |
| FU-3 | Prune on every get/save; nested `try` | open | Moderate (cost) | `harness-proposal-store.service.ts:71,103,186-215` | Defer |
| FU-4 | Merge output arrays alias input; `as` casts; `name: ''` cannot clear | open | Minor/Moderate | `libs/shared/src/lib/utils/merge-harness-config-updates.ts:16,18,25,34,39,55,62,66,77` | Defer (the `name` semantics need a product decision) |
| FU-5 | `z.custom` bridge on `configUpdates` | open | Moderate | `rpc-harness.schemas.ts:472-474` | Defer |
| FU-6 | Schema reuse (`HarnessSessionIdSchema`), `di.ts` header, union JSDoc, class JSDoc placement | open | Minor | `harness-rpc.schema.ts:195-197`; `harness/di.ts:1-20`; `rpc-harness.types.ts:516`; `harness-proposal-store.service.ts:46-53` | Defer (docs; low value alone) |
| FU-7 | Store spec hard-codes the stale value and lock payload; bare `require` spy | open | Minor | `harness-proposal-store.service.spec.ts:133,149,196` | Defer |
| FU-8 | 12 s lock wait vs call timeouts | open | Minor | `harness-proposal-store.service.ts:24-26,69-72`; `protocol-dispatcher.ts:3951-3953`; `libs/frontend/core/src/lib/services/claude-rpc.service.ts:135` | Defer. Mode 3 finding: the `execute_code` path defaults to 15 s, and the in-process queue wait comes before the 12 s lock wait with no bound, so a queued save can exceed it |
| FU-9 | No re-fingerprint at `finish()` | open | Minor | `analysis-run-checkpoint.ts:297-304` | Defer |
| FU-10 | SDK `session_id` compared only against `system/init` | open | Minor | `multi-phase-analysis.service.ts:936-947` | Defer |
| FU-11 | Newer rejected run hidden behind an older valid run | open | Minor | `analysis-storage.service.ts:461-477,727-733`; `analysis-freshness.service.ts:126,143` | Defer |
| FU-12 | Three v4 definitions + casts | open | Minor | `rpc-setup.types.ts:91-102`; `multi-phase.types.ts:74-81,163-178`; `analysis-storage.service.ts:356-357` | Defer (do with v5) |
| FU-13 | New `-v3-archive-<ulid>` per attempt; no reuse/prune | open | Minor | `analysis-storage.service.ts:379-382` | Defer |
| FU-14 | Leftover `<slug>--v4` run stays as history | open (design) | Minor | `analysis-run-checkpoint.ts:92,95-99,136-144`; `analysis-storage.service.ts:48,122-133` | Defer (needs a design decision) |
| FU-15 | Degraded fingerprint on resume overwrites the stored digest | open | Moderate | `analysis-run-checkpoint.ts:62-75,123` | Defer (no wrong data; outputs recomputed) |
| FU-16 | Freshness `warn` nests the `Error`, logged as `{}` | open | Moderate (diagnostic) | `libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts:81-87` | **Fix-now** (one line: pass `error.message`) |
| FU-17 | `abortAndDispose` abort-failure branch unreachable | open | Moderate (pre-existing) | `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:29-37`; `harness-workflow.service.ts:445-465,511-516` | Defer (design choice: force-dispose with a warning vs. retry; a naive fix blocks "Start over") |
| P4-F2 | Degradation catches log no cause | open | Minor | `content-generation.service.ts:620-625`; `enhanced-prompts/enhanced-prompts.service.ts:1074-1078` | **Fix-now** (`catch (error)` + `{ cause: error instanceof Error ? error.name : typeof error }`, matching `wizard-generation-rpc.handlers.ts:287-293`) |
| P4-F3 | Identity-style `resolveAuthorizedAnalysisDir` mocks | open | Minor | `enhanced-prompts.service.spec.ts:142-144` (used by `:1144-1148`); `content-generation.service.spec.ts:150-152` | Defer (test-only gap) |
| P4-N1 | Terminal `.catch` absorbs a `checkpoints.finalize` failure with no log | open | Minor | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:403-411` | **Fix-now** (content-free `logger.warn` as at `wizard-generation-run.supervisor.ts:264-271`; keep the degradation-audit marker) |
| P3-N2 | No spec pins the outer-catch best-effort pause | open | Minor | `multi-phase-analysis.service.ts:443-452` | Defer |
| P3-S-N2 | Hard-coded `'.ptah/analysis'` fallback | open | Minor | `analysis-freshness.service.ts:88` | Defer |
| P3-S-N3 | `RunDirVariant` spelled inline | open | Minor | `analysis-run-checkpoint.ts:78` | Defer |
| P3-S-N4 | Hash helpers live in `analysis-fingerprint.ts` | open | Minor (optional) | `analysis-fingerprint.ts` | Defer |
| P3-S-N5 | Duplicated `'Phase finished without an SDK session id'` | open | Minor | `multi-phase-analysis.service.ts` (two copies) | Defer |
| P3-B21a | Unreachable `variant === 'primary' && !primaryResumable && fallbackResumable` branch | open | Minor | `analysis-run-checkpoint.ts` (open) | Defer |
| P3-B21b | Resumable test evaluated twice | open | Minor | `analysis-run-checkpoint.ts` (open) | Defer |
| P3-B21c | `ensureSlugDir` has no production caller | open | Minor | `analysis-storage.service.ts:207` | Defer |
| P2F-a | Same-mode resume drops a fresh intake | open (pre-existing) | Minor | `harness-workflow-request.service.ts:25-27` | Defer (the Setup Hub asks for a discard confirmation first) |
| P2F-b | Hung `getProposal` delays live proposals | open | Minor | `harness-workflow-message.handler.ts:113-118,134-149,166` | Defer (bounded by the 30 s RPC timeout; events buffered, not lost) |
| P2F-c | "Start over" wipes builder state | closed (rejected, pre-existing) | Minor | n/a | None |
| MO-1 | Hydration applies saved proposals in any mode; live events only in `configure-harness` | open (new, Mode 3) | Minor | `harness-workflow-message.handler.ts:113-150` vs `:155` | Defer (add the same mode gate to hydration) |
| MO-2 | A root spelling mismatch between hosts (e.g. drive-letter case) makes `read` return null, so the next `save` restarts from `{}` | open (new) | Minor | `harness-proposal-store.service.ts:122-152` | Defer (normalise the root before comparing) |
| MO-3 | Leftover `.tmp` files are never pruned (the prune regex matches only `<hex64>.json`) | open (new) | Minor | `harness-proposal-store.service.ts:154-165,184` | Defer (fold into FU-3) |
| MO-4 | If the archive restore throws, it masks the original delete error | open (new) | Minor | `analysis-storage.service.ts:401-407` | Defer |
| MO-5 | Electron e2e New Project specs still describe a backend broadcast in their comments (they still pass; they inject the event) | open (deferred plan item) | Minor | `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:5-6,79-97` | Defer to the plan's "Deferred review items" (transport removal and e2e retargeting) |
| MO-6 | Prune check-then-unlink can race a concurrent save of a record older than 30 days | open (new) | Minor | `harness-proposal-store.service.ts:199-211` | Defer (fold into FU-3) |

### Fix-now recommendation (optional fix Batch 25)

- Scope: FU-16, P4-F2 and P4-N1. They are all logging-only, and they touch three files in two
  projects the branch already changed:
  - `libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts`
  - `libs/backend/agent-generation/src/lib/services/content-generation.service.ts`
  - `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`
  - `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`
- Changes: log the cause name or message only (no content), and keep the existing
  `degradation-audit` markers so the ratchet stays at its baseline.
- Checks, one at a time:
  1. `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`, then
     its test with `--maxWorkers=2`.
  2. The same for `@ptah-extension/rpc-handlers`.
  3. The degradation-audit check.
- No phase review is due: the change is logging-only. If the orchestrator prefers not to reopen
  the branch, defer all three. They are Minor or diagnostic only and do not block.

## 6. Mandatory completion checks

| Check | Result |
| --- | --- |
| Parity (section 2) | PASS: 28/28 rows present, 0 MISSING, no unapproved removal |
| Rendered visual evidence (R11) | **PENDING**: before/after Setup Hub New Project intake screenshots in dark and light. The "before" set comes from base `2464e6922`. No new surface, so no prototype. The orchestrator handles these with the user |
| Write-path trace (section 3) | PASS: every new or changed persisted write traced to its readers; all intended; the old localStorage shape is still readable |
| Every SHA resolves, every batch COMPLETE | PASS (section 1) |
| Every due phase review accepted | PASS: 1, 2B, 3, 4, 2F |

### Validation risk resolutions

| Risk | Resolution |
| --- | --- |
| R1 no `rename` on the port | Copy, verify, then delete the archive; a single `writeFile` for the manifest (no regression); readers fail closed. Port `rename` is the follow-up in section 4 |
| R2 E batch would fail its gate | Re-split into Batches 10 (read path) and 12 (writer) |
| R3 shared manifest union | v3 member unchanged; consumers typechecked in Batch 1; CLI has no diff |
| R4 hydrate/live race | Buffer and replay (`harness-workflow-message.handler.ts:136-149,166`), with Batch 24's guard |
| R5 tab id never persisted | An unresolved caller throws with no write and no broadcast (`harness-namespace.builder.ts:1098-1114`) |
| R6 cross-process writes | harness-sync `serializeByKey` + `withFileLock`, temp+rename; residual FU-1 |
| R7 proposal root | The workspace provider root for write and read (`harness-proposal-store.service.ts:56-57,107-111`) |
| R8 di-lint | Run in Batches 4, 12 and 15; the pre-push hook runs it again |
| R9 e2e/webview event specs | Producer only; compat transport kept; retargeting deferred (MO-5) |
| R10 duplicated relay logic | One implementation, in `HarnessWorkflowRequestService`, which the relay delegates to (`harness-workflow-message.handler.ts:64`) |
| R11 visual evidence | SKIPPED by user decision D14; manual checks listed in the PR |

## 7. PR-ready summary

**Title:** `feat(harness-builder,rpc-handlers,agent-generation): session-scoped proposals, analysis v4`
(check the scopes against `.commitlintrc.json`.)

### What changed

- **Shared contracts (`libs/shared`):**
  - Proposal and `harness:get-proposal` types, plus the `HarnessProposalSchema` record schema.
  - `HarnessSessionIdSchema`.
  - The New Project result type, which returns the seed, intake, plugins and toolchain.
  - `sessionId` on `HARNESS_CONFIG_PROPOSED`.
  - The field-aware `mergeHarnessConfigUpdates` utility.
  - Manifest v3/v4 and `AnalysisStatus` types, plus the `wizard:analysis-status` RPC registration.
- **Platform port (`platform-core`):** `IHarnessProposalStore` and `HARNESS_PROPOSAL_STORE`.
- **Proposal store and RPCs (`rpc-handlers`):**
  - A workspace proposal store under `.ptah/harness/proposals/`: one record per session, atomic
    temp+rename, the harness-sync file lock, and 30-day retention.
  - The `harness:get-proposal` RPC.
  - `harness:start-new-project` returns the seed instead of broadcasting `HARNESS_OPEN_WORKFLOW`.
  - The `wizard:analysis-status` RPC.
  - `wizard:submit-selection` decides analysis freshness before launch, reserves its run slot
    against a race, and observes the launch promise.
- **MCP writer (`vscode-lm-tools`):** `ptah_harness_propose_config` resolves the calling SDK
  session, persists the merged proposal, then broadcasts it with `sessionId`. With no session it
  writes nothing and broadcasts nothing.
- **Analysis (`agent-generation`):**
  - Manifest v4: per phase attempt, SDK `sessionId`, input fingerprint and output verification.
  - v3 stays readable and is never rewritten. Resuming a v3 run archives it with a verified copy,
    or falls back to `<slug>--v4`.
  - A workspace fingerprint and `AnalysisFreshnessService`, which reports fresh, stale or missing
    with a reason.
  - Agent, content and system-prompt generation gather their own workspace context when analysis
    is missing or stale.
- **Builder (`harness-builder`):**
  - The Setup Hub navigates from the returned seed and closes the intake modal once navigation
    lands.
  - The shared `HarnessWorkflowRequestService` serves both the Setup Hub and the legacy relay.
  - Proposals are filtered to the workflow's sessions and hydrated after a reload, for every
    session id persisted in the workflow.
  - Adopts the shared merge.

### Test evidence (HEAD `f778edd66`, after the `origin/main` merge)

- shared: 3599 tests pass.
- platform-core: 1093 pass, 4 todo.
- vscode-lm-tools: 3027 pass.
- rpc-handlers: 4469 pass, 7 skipped.
- agent-generation: 1280 pass, 1 skipped.
- harness-builder: 153 pass (Batch 24).
- Typecheck passes on all six.
- cli-engine `rpc-surface.spec.ts` passed after Batches 5 and 13 (both RPCs are served by every
  host).
- The CLI specs for analyze, prompts, setup and wizard passed in Batches 12 and 15. The CLI is
  unchanged.

### Known limitations

- The R11 Setup Hub screenshots were not taken (D14). Manual check: open Setup Hub, start New
  Project, confirm the builder opens with the seed prompt, in dark and light themes.
- `HARNESS_OPEN_WORKFLOW` transport is kept for compatibility. Removing it, and retargeting the
  Electron e2e specs, is a deferred item.
- A paused v3 analysis is not resumable: it is archived (still listed) and a fresh v4 run starts.
- Manifest writes are not atomic (as before); see the R1 follow-up.
- Freshness status comes from the new `wizard:analysis-status`; `wizard:get-resumable-run` is
  unchanged. Confirm this with the user.
- Lock residual FU-1 (pre-existing in harness-sync).

### Follow-ups

FU-1 to FU-17, Phase 4 F2, F3 and N1, the Phase 3 and 2F minors, and MO-1 to MO-6 (section 5).
The R1 port `rename` task is in section 4.
