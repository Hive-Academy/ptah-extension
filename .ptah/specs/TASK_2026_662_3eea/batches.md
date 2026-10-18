# Batches - TASK_2026_662_3eea

Total tasks: 75 (71 + carry-over tasks 44.2, 65.2, 67.2, 53.2) | Batches: 71 (+2 operational steps OP-1, OP-2) | Phases: 6 (A-F) | Complete: 22/71 (Phase A 15/15 CLOSED: logic gate APPROVED after one fix round, 8360e7aca; style fixes verified in the round-2 re-review; visual review APPROVED 8/10. Phase B 7/9: batches 16-22; next 23 -> 24, sequential, SU-gated)

Worktree root (prefix every path below with it): `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\`
Branch: `refactor/skill-synthesis-purge`. Aliases (same as implementation-plan.md:153):
SS=`libs/backend/skill-synthesis/src/lib`, SU=`libs/frontend/skill-synthesis-ui/src/lib`,
RH=`libs/backend/rpc-handlers/src/lib`, PC=`libs/backend/platform-core/src`,
PS=`libs/backend/persistence-sqlite/src/lib`, TH=`libs/backend/thoth-runtime/src/lib`,
CE=`libs/backend/cli-engine/src/lib`, MB=`tools/mcp-bench/src/memory-skills`.
"Plan row N" = the row for batch N in the table at `implementation-plan.md:161-224` (row N is line 160+N).
Batch numbers here are NOT the plan's numbers; each batch names the plan row(s) it carries.

## Batch defaults (apply to every batch unless the batch overrides them)

- Execution mode: sequential (one executor, tasks in order).
- Recommended executor: CLI lane `codex` for backend, tools, scripts and large deletions; CLI lane `Glm`
  (ptah-cli, Ollama Cloud) for frontend and docs. Never grok or opencode (both are near their limits).
- Fallback order: other family same capability (codex <-> Glm) -> same family other provider/model -> subagent.
- Subagent reason: N/A.
- Review family: no per-batch review. One code-logic review per phase on the combined diff, by a family
  different from the implementer. Phases mix codex and Glm work, so the recommended phase reviewer is the
  Claude `code-logic-reviewer` subagent (Subagent reason: it must be a third family, different from both
  implementer families. grok and opencode are excluded by the orchestrator).
- Lane prompt rules to repeat to every lane (root CLAUDE.md): change only the batch's owned files, and
  verify only the batch's one command (`--parallel=1`, `--maxWorkers=2`). Never run build, serve, e2e,
  package or workspace-wide checks. Run one heavy check at a time. Never run git. Do not edit
  `batches.md` or `task.md`. Do not add stubs, TODOs or placeholders.
- Shared-contract rule (round-2 item 12/N6): before removing any exported symbol, run
  `rg -n "<symbol>" libs apps tools` (exclude immutable `PS/migrations/00[0-5]*`). Every project with a
  live hit must either be fixed in the same batch or already be cut by an earlier batch. If a hit lands
  in a project outside the batch's gate, STOP and report it. Do not widen scope silently (D4: "a batch
  that hits a missed consumer stops and is fixed in place").
- Post-cut grep: after each C/D/E batch, repeat the batch's scoped grep (plan G-ledger,
  `implementation-plan.md:155-157`, extended by round-2 greps). Require zero *live obsolete* hits;
  comments and retained Library names are excluded by inspection.
- Flags: **UI** = rendered UI change. The phase needs visual-reviewer before/after screenshots in dark
  and light themes, with the "before" taken from the base commit `271198ced` (capture before Phase A
  lands). **WRITE-PATH** = changes a persisted write (DB rows, `settings.json`, user-layer files,
  archive files). Mode 3 traces it to its runtime reader.
  **EXCEPTION** = exceeds the 6-file cap under the allowed deletion-only or dead-import-removal exception,
  inside ONE project.

## Plan validation

Status: PASSED WITH RISKS. Round-2 findings R1-R6, plus still-open items 1, 2, 13, N5, N7 and partial
12/N6, are folded in as concrete batches. Each was re-verified against the worktree on 2026-10-18 with
the greps below.

### Round-2 findings: verification and where each is fixed

| Finding | Verified evidence (this worktree, 2026-10-18) | Fixed in |
| --- | --- | --- |
| R1 / items 1, 2 | `RH/host-profile/manifest.ts:430` takes `methods: SkillsSynthesisRpcHandlers.METHODS`. `assertManifestInvariants` (`manifest.ts:506-531`) throws in BOTH directions: an unknown method, or a registry name with no owner. It runs at boot (`register-rpc-surface.ts:142`) and in `rpc-allowlist.spec.ts:42`. `rpc-allowlist.spec.ts` names no `skillSynthesis` method, so it needs no edit. | Plan row 39 is split. **Batch 43** reworks the retained handler methods and leaves `METHODS` unchanged. **Batch 59** is one contract batch: obsolete `METHODS` and bodies, `RPC_METHOD_ENTRIES`/`RPC_METHOD_NAMES` (shared `rpc.types.ts`), `host-source-registry.baseline.ts` and the handler schema. It runs after the SU facade trim (58). |
| R2 / item 1 | 15 specs in `PS/migrations/*.spec.ts` assert the "bundled-version ratchet" `toBe(55)`, e.g. `0055_skill_invocation_run_id.spec.ts:78` and `0045_skill_backlog_cleanup.spec.ts:34`. The repo convention bumps every pin when a migration is added. | **Batch 1** bumps 15 pins to 56. **Batch 68** bumps 16 pins (15 + the 0056 spec) to 57. Both are labelled EXCEPTION (mechanical spec-pin bump, one project). |
| R3 / 12, N6 | `SkillLaneIdDto`/`SkillLaneDto`/`SkillLanesDto` are defined in `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:316-375`. Consumers: chat `routing-map.component.ts:7,13,31,249-286`, `connection-usage.ts:4-5,34-37,69,132,161`, `provider-consumer-assignments.component.ts:626-672,786,852`, and **also `providers-settings.component.ts:831-856` (missed by the review)**, plus core `providers-settings.types.ts:10,34,39,90`. The `tribunal-panel` `state.lanes()` hit is unrelated tribunal state. | **Batch 16** (core, additive Enhancement slice), **17** and **18** (chat consumers switch), **25** (core removes lanes and judging), **63** (shared lane DTO removal). `core` and `chat` are added to the gates of **59** and **65**. |
| R4 / 13, N7 | Non-pipeline importers of the doomed suites: `MB/host-only-imports.spec.ts:37-47`, `MB/ground-truth/committed-u4-labels.spec.ts:15-18`, `MB/host/memory-skills-host.entry.ts:46-50,68`, `MB/host/plan.schema.ts:26,270`, `MB/runner/runner-plan.ts:19,158`, `MB/host/suite-placement.ts:32-43`, `suite-placement.spec.ts:3,74`, and the funnel kind in `MB/memory-skills-suite-kinds.ts:212,632` (+ spec). `judge-lane-tap.ts` and `judge-corpus.ts` are imported ONLY by `judge-agreement*`, so they become orphans. `recorded-lane-runner.ts` and `host/doubles-override.ts:105` depend on `LaneRunnerService` and `SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE`, and `suites/memory/merge-update.test-support.ts:41` uses the recorded lane runner, so those stay. | **Batch 45** (namer/trigger family) and **batch 46** (funnel + judge-agreement family, plus the orphaned `judge-lane-tap`/`judge-corpus`), each with its importers. Plan row 43 "repoint" becomes deletion (under D2 it is pipeline-only). |
| R5 / 12, N6 | `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:385` calls `skillsRpc.listCandidates` (spec mocks at `:92-340`), and `:325` calls `getSettings`. Old-key users outside plan row 61: `RH/handlers/settings-rpc.handlers.spec.ts`, `RH/handlers/config-scope-rpc.handlers.spec.ts`, `libs/shared/src/lib/types/rpc/rpc-auth.types.ts`, and chat `settings/advanced/advanced-settings-group.component.spec.ts`. | **Batch 19** cuts the dashboard candidate count together with the pause switch. **Batch 58** gate adds `dashboard`. **Batch 34** moves the RH settings-spec fixtures to retained keys. **Batch 18** handles the chat advanced spec. **Batch 65** owns `rpc-auth.types.ts`, and its gate adds `chat` and `core`. |
| R6 / N2 | `tsconfig.base.json:111` maps `@ptah-extension/skill-synthesis-ui/services` to `libs/frontend/skill-synthesis-ui/src/services.ts`, which exports `SkillSynthesisLiveService` (`:19`). Importers: webview `app.config.ts`, `thoth-message-routing.spec.ts`, and dashboard `thoth-status.service.ts:25` (the dashboard imports only the RPC service). | **Batch 27** (plan row 24) drops the live-service export from `src/services.ts`. It runs after batch 26 cuts the webview importer, and before batch 57 deletes the service. Its gate adds `dashboard`. |
| N5 | Plan row 63 edits `sqlite-connection.service.ts`, but its spec was in row 64, and the 0057 spec was listed in both. | **Batch 67** pairs each archive, connection and db-path source with its own spec. **Batch 68** owns the 0057 spec. **Batch 69** keeps only the runner spec and the embedder comment. |

Assumptions:

- `lanes/lane-runner.service.ts` (`skillQueryLane`, `LaneRunnerService`), `lane-resolver.service.ts`,
  `lane-auth-resolver.port.ts`, `lane.types.ts` and `provider-network-backoffs.ts` are kept as
  "enhancement lane helpers". `skill-enhancer.service.ts:29-55` imports them. `SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE` and its
  registration stay because mcp-bench `doubles-override.ts:105` and `recorded-lane-runner.ts` use them.
  Unverified for removal: batches 61 and 62 must keep them. Retiring `LaneRunnerService` is a later,
  named follow-up, not this task.
- The RH settings-spec fixtures (batch 34) can move to a retained key (`skillSynthesis.enabled` or a
  non-skill key) without losing coverage of scope/validation behavior. Batch 34 checks this.
- `skills.enhancement.{provider,model,timeoutMs}` keys are added in batch 2 (plan row 2). Core/chat
  (batches 16-18) read and write them through `settings:get`/`settings:set` only. This is verified in
  batch 16 against `PC/file-settings-keys.ts` after batch 2.
- `memory-skills-suite-kinds.ts` `funnel` kind: batch 46 removes it only if no producer or consumer
  remains. `MB/suites/audits/snapshot-audits.suite.ts:725` emits `kind: 'funnel'`, so batch 46 checks it
  and batch 47 reconciles it.
- Comments that name dropped tables (`lanes/lane.types.ts:179`, `lane-runner.service.ts:278`,
  `memory-curator/.../observation-queue.store.ts:599`, `auth-providers/.../provider-auth-resolver.spec.ts:911`)
  are not live readers. Only `embedder.interface.ts:6` is updated (batch 69). The others are updated when
  their file is already being edited.
- The Nx test/typecheck targets of `persistence-sqlite`, `platform-core`, `skill-synthesis`,
  `rpc-handlers` and `shared` are inferred, not declared in `project.json`. Each executor confirms the
  target with `npx nx show project <name>` before its first run.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Boot throws "RPC manifest is missing an owner" between the handler cut and the shared registry cut (R1) | HIGH | Batch 43 leaves `METHODS` unchanged. Batch 59 contracts `METHODS`, the registry, the baseline and the schema atomically, gated on every host. |
| The ratchet pins fail the PS gate (R2) | HIGH | Bump the pins in batches 1 and 68 (EXCEPTION). |
| Providers routing map shows a dead lanes section, or chat/core fail to compile (R3) | HIGH | Batches 16, 17, 18, 25 and 63. Chat and core are added to the gates of 59 and 65. |
| mcp-bench fails to compile or crashes at runtime over production DI (R4) | HIGH | Batches 45 and 46 delete each family together with all of its importers. |
| Dashboard keeps calling a removed RPC (R5) | MEDIUM | Batch 19 removes the call. Dashboard is in the gates of 27 and 58. |
| `/services` entry point exports a deleted service (R6) | MEDIUM | Batch 27. |
| Shared-type removal breaks a project outside the gate | MEDIUM | Shared-contract rule (defaults). Batches 59, 63, 64, 65 and 66 grep before they remove anything. |
| Irreversible drop without a verified archive | HIGH | Batch 15 adds a fatal preflight. OP-1 presents the receipt from an archive dry-run, and the user confirms it before batch 68 is committed. Batch 68 has a failure-leaves-v56 spec. |
| `skill_candidates_vec` exists but vec cannot load | MEDIUM | Batches 15, 67 and 68: 0057 does not begin, and the DB stays at version 56 (spec in 68). |
| Prune deletes user-edit snapshots needed for revert | HIGH | Batch 50: dry-run manifest, a hash/provenance check, and apply refuses without the receipt. OP-2 shows the manifest before apply. |
| Promoted-skill removal deletes a user-modified copy | MEDIUM | Batch 70: an origin and hash check keeps modified copies and reports them. |
| Old-judge settings lost when the old keys are removed | MEDIUM | Batch 2 migrates the stored values idempotently. Batch 65 removes the keys only after the readers are cut (batches 9, 16-18 and 25). |
| A heavy multi-project gate (batch 59: 10 projects) exhausts RAM | MEDIUM | `--parallel=1`, one heavy check at a time, and no other lane check runs during it. |

Edge cases:

- Old optimistic `succeeded=1` rows with no reconciliation are reset to NULL, and reconciled rows keep
  their grade. Handled in Task 1.1.
- A corrected review re-harvests: a versioned `.harvested.json` with an artifact digest. Task 6.1.
- Ambiguous or absent task link means ungraded. Tasks 4.1 and 6.1.
- `unverified` session verdict is never a positive grade. Task 14.1.
- A provider timeout leaves the draft unsaved, and the clone and history are untouched. Task 10.1.
- A stale clone revision refuses save. Task 10.1.
- Model list timeout returns `unverifiable` without failing the Library read, the UI timeout is longer
  than the 15 s server budget, and a workspace switch drops stale responses. Task 21.1.
- `successRate=null` renders "No grade". Tasks 7.1, 11.1, 23.1 and 24.1.
- Unrelated cron and `job_runs` history is preserved: only four job IDs are removed. Tasks 37.1 and 68.1.
- Older pending vec catch-up runs before archival and drop. Tasks 15.1 and 69.1.
- A vec table that exists but cannot load stays at 56. An absent vec table defers the empty vec cleanup.
  Task 68.1.
- A configured alternate `skillSynthesis.skillsRoot` still delivers shipped skills. Task 12.1.
- Pause off does not suppress telemetry or harvesting. Tasks 19.1 and 20.1.

## Waves

A wave runs in parallel only when its batches are file-disjoint AND in different Nx projects (including
the gate projects). At most 3 lanes run at once. Lanes may implement concurrently, but the scoped checks
run ONE AT A TIME. Batches not listed in a wave run sequentially in id order.

| Wave | Batches (parallel) | Then sequential |
| --- | --- | --- |
| A-W1 | 1 (PS), 2 (PC), 7 (SU) | - |
| A-W2 | 3 (SS), 11 (SU), 15 (PS) | 4, 5, 8, 6, 9, 10, 12, 13, 14 |
| B-W1 | 16 (core; gate core+chat), 19 (SU+dashboard) - COMPLETE | - |
| B-W2 | 17 (chat), 22 (RH+SS; gate also SU) | - |
| B-W3 | 18 (chat), 20 (SU) | 21, 23, 24 (all SU-gated, in this order) |
| C-W1 | 26 (webview+SU gate), 30 (ptah-cli), 32 (vscode-core) | 25, 27, 28, 29 |
| C-W2 | 33 (RH), 35 (TH), 49 (agent-generation) | 34, 36, 37, 38, 39, 40, 41, 42, 43, 44 |
| C-W3 | 45 (mcp-bench), 50 (scripts), 51 (webview-e2e-harness) | 46, 47, 48 |
| C-W4 | 52 (electron-e2e), 54 (docs) | 53, 55, 56 |
| D | none (shared contract and cross-project gates) | 57, 58, 59, 60, 61 |
| E | none (shared gates overlap) | 62, 63, 64, 65, 66 |
| F | none | 67, OP-1, 68, 69, 70, 71, OP-2 |

## Phase map and reviews

| Phase | Batches | Phase review (after its last batch commits) |
| --- | --- | --- |
| A - add beside old | 1-15 | code-logic, plus style (new public API: event store, grade store, skills-root, enhancement keys, archive preflight) |
| B - switch readers/writers | 16-24 | code-logic, plus visual (Providers, Library, dashboard, pause switch, model editor; added 2026-10-19: dashboard Skills tile telemetry On/Off (O10), Library header pause + telemetry controls (batch 19), Phase A carry-overs Moderate 1 null detail-row pill + Minor 1 neutral verdict dot after batch 24; added after batch 17: Providers consumer assignments Enhancement row (provider, model, timeout + Undo) replacing "Judging & enhancement" and the lane rows, and the Orchestration background-roles summary "Memory curator, enhancement, decision" (3 roles); added after batches 18 and 20: the routing map Background roles node (2 roles: Memory curator, Enhancement; was 6) and the pause switch showing the committed host value while a write is pending, disabled in flight, error alert on failure; added after batch 21: agent model editor slow list (loading held past 10 s, up to the 20 s UI timeout) and unavailable list (loading cleared, unavailable message), and the enhance preview drawer showing the draft with Save enabled only when a draft exists, the save-in-flight state, and the stale-refusal message with the draft kept open) |
| C - cut consumers | 25-56 | code-logic, plus visual (Library tab removal in 27, dashboard in 27) |
| D - delete pipeline source + RPC contract | 57-61 | code-logic, plus visual (Library after SU deletion) |
| E - remove shared contracts | 62-66 | code-logic, plus visual (Advanced settings rows removed in 65) |
| F - data step (needs user confirmation of the archive before drop) | 67-71, OP-1, OP-2 | code-logic, plus visual (prompt suggestions in 71) |

---

# Phase A - add beside old

## Batch 1: Migration 0056 nullable grades + ratchet pins - COMPLETE (657b01413)

- Phase: A | Wave: A-W1 | Executor: CLI lane codex | Depends on: none | Tasks: 1
- Flags: WRITE-PATH (resets ungraded rows to NULL), EXCEPTION (mechanical spec-pin bump, 15 specs, one project)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite --parallel=1`
- Precondition: `PS/migrations/index.ts` ends at 0055, and the 15 specs pin `toBe(55)`. After the batch,
  `rg -n "toBe\(55\)" PS/migrations` has zero hits.

### Task 1.1: Add 0056 and bump the ratchet - COMPLETE

- Files: `PS/migrations/0056_skill_nullable_grades.ts` (new), `PS/migrations/0056_skill_nullable_grades.spec.ts`
  (new), `PS/migrations/index.ts`. Ratchet pins 55 -> 56 in: `0028`, `0030`, `0038`, `0039`, `0040`,
  `0041`, `0042`, `0043`, `0045`, `0047`, `0051`, `0052`, `0053`, `0054` and `0055` `*.spec.ts` under `PS/migrations/`.
- Plan reference: plan row 1; implementation-plan.md:16, 95-100; round-2 R2.
- Pattern to follow: `PS/migrations/0055_skill_invocation_run_id.ts` and its spec (`:77-78` ratchet test).
- Quality requirements: an explicit 20-column rebuild of `skill_invocation_events` with `succeeded` nullable.
  Keep every column and index added by 0027/0030/0037/0055 (six indexes). Reset optimistic ungraded rows
  to NULL, and keep the reconciled grades. Transactional.
- Validation notes: never coalesce a NULL workspace to `''` (0037). The 0056 spec also carries the ratchet
  test at 56.
- Implementation details: register in `MIGRATIONS` after 0055. The spec seeds pre-0056 rows: optimistic,
  reconciled-pass and reconciled-fail.

### Batch 1 verification notes

- Verified on disk: `0056_skill_nullable_grades.ts` (+ spec), `index.ts` registers version 56 last; 17 ratchet
  pins bumped to 56 (the 15 listed plus `0044` and `0046`, found in fix round 1). `toBe(55)` hits: 0.
  The `0055` adjacency assertion now locates 55 by version instead of `slice(-2)`.
- Checks: persistence-sqlite test + typecheck PASS (orchestrator, after fix 1); lint 0 errors (22 pre-existing
  warnings, none in changed files).
- Write-path trace: writer = migration 0056 (static SQL, run inside the migration runner transaction) ->
  table `skill_invocation_events`, column `succeeded INTEGER NULL`; rows with `reconciled_at IS NULL` become
  `succeeded=NULL, is_error=0`, reconciled rows keep 0/1. Runtime readers today:
  `SS/skill-candidate.store.ts:1462-1463` (`SUM(succeeded)`/`succeeded = 0`, NULL is skipped, so
  ungraded rows count as neither success nor failure) and `:1564`, `:1727` (`r.succeeded === 1`, NULL maps to
  `false`). Second write: new table `skill_task_grades` (verdict `'pass'|'fail'`, key
  task/subject_kind/subject_slug/attribution_key `run:<id>|event:<id>`), backfilled only from exact
  `spec:<task_id>` reconciled subagent rows. It has no runtime reader yet; batch 5 adds the grade store
  that becomes its sole reader. ASSUMPTION carried to batches 5/22: until the readers switch, the old
  `=== 1` mapping reports ungraded rows as not-succeeded in the per-event views; acceptable in Phase A
  (add beside old) and removed when rates read `skill_task_grades`.

## Batch 2: Enhancement settings keys + raw settings migration - COMPLETE (05139f1bf)

- Phase: A | Wave: A-W1 | Executor: CLI lane codex | Depends on: none | Tasks: 1
- Flags: WRITE-PATH (`loadSync` rewrites `settings.json` once)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/platform-core --parallel=1`
- Precondition: G11, the old `judgeProvider`/`judgeModel`/`enhanceTimeoutMs` keys, are present. After
  the batch, the `skills.enhancement.*` and `skills.telemetry.enabled` keys are registered and the old
  keys still exist.

### Task 2.1: Add new keys beside old; idempotent copy of stored values - COMPLETE

- Files: `PC/file-settings-keys.ts`, `PC/file-settings-keys.spec.ts`, `PC/file-settings-manager.ts`,
  `PC/file-settings-manager.spec.ts`.
- Plan reference: plan row 2; implementation-plan.md:22, 111-115 (component 3), 131-149 (write-path trace).
- Pattern to follow: the existing key registration at `file-settings-keys.ts:273-419`.
- Quality requirements: copy only the *stored* old value, and only when the new key is absent. Never
  overwrite a new user choice. The migration is idempotent across restarts. Do not log values.
- Validation notes: the defaults keep the current behavior (provider empty, model inherit).
- Implementation details: add `skills.enhancement.{provider,model,timeoutMs}` and `skills.telemetry.enabled`.
  `loadSync` migrates from `skillSynthesis.judgeProvider|judgeModel|enhanceTimeoutMs`.

### Batch 2 verification notes

- Verified on disk: four keys registered in `FILE_BASED_SETTINGS_KEYS` with defaults `''`, `'inherit'`,
  `ENHANCE_TIMEOUT_DEFAULT_MS`, `true`; old `skillSynthesis.judge*`/`enhanceTimeoutMs` keys kept.
- Checks: platform-core test + typecheck PASS (orchestrator); lint 0 errors (8 pre-existing warnings; the
  4 in changed files are on lines from `2b537f44c`).
- Write-path trace: writer = `PtahFileSettingsManager.loadSync()` -> `~/.ptah/settings.json` (nested
  JSON, written via unique temp file + rename; `$schema`/`version` preserved). Copies the stored value
  verbatim, only when the old key is present and the new key absent:
  `skillSynthesis.judgeProvider -> skills.enhancement.provider` (string),
  `skillSynthesis.judgeModel -> skills.enhancement.model` (string),
  `skillSynthesis.enhanceTimeoutMs -> skills.enhancement.timeoutMs` (number, ms),
  `skillSynthesis.triggers.skillInvocationTelemetry.enabled -> skills.telemetry.enabled` (boolean).
  Runtime reader = the same manager's `get()` (keys routed as file-based by `file-settings-keys.ts`),
  reached through `IWorkspaceProvider.getConfiguration`. No production code reads the new keys yet
  (grep: only `file-settings-keys.ts` and `file-settings-manager.ts`); batch 9 (enhancer) and the
  telemetry toggle batches switch readers. Old keys are untouched, so runtime behavior is unchanged.
  Failure to write logs the fs error code only, never values; the in-memory copy still applies.

## Batch 3: Invocation event store + 646 seam adapter - COMPLETE (75eceaaeb)

- Phase: A | Wave: A-W2 | Executor: CLI lane codex | Depends on: 1 | Tasks: 1
- Flags: WRITE-PATH (event rows)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis --parallel=1`
- Precondition: G10, the candidate-backed adapter, is present. 0056 is registered.

### Task 3.1: Add `skill-invocation-event.store.ts` beside the candidate store - COMPLETE

- Files: `SS/skill-invocation-event.store.ts` (new) + spec, `SS/di/register.ts`,
  `SS/outcome-seam/skill-telemetry-seam.adapter.ts` + spec.
- Plan reference: plan row 3; implementation-plan.md:14, 95-100.
- Pattern to follow: the SQL in the current `skill-candidate.store.ts` event methods; the 646 port and its
  DI token stay unchanged.
- Quality requirements: event-only SQL, prepared statements, and `isError` independent of the grade.
  Register the store before any consumer uses it.
- Validation notes: keep the TASK_2026_646 port direction (lane-outcomes depends on the port).
- Implementation details: the adapter reads through the new store and no longer uses `SkillCandidateStore`.

### Batch 3 verification notes

- Verified on disk: `SS/skill-invocation-event.store.ts` holds event-only prepared SQL; `succeeded`
  omitted writes NULL, `is_error` comes only from the explicit `isError`. Registered as a singleton in
  `SS/di/register.ts` before the adapter; the adapter injects it (`Pick<...>` reader shape for an
  out-of-batch trigger spec) and no longer imports `SkillCandidateStore`. 646 port token unchanged.
- Checks: skill-synthesis test + typecheck PASS (orchestrator); lint 0 errors, no warnings in batch files.
- Write-path trace: writer `SkillInvocationEventStore.recordSkillEvent` -> table
  `skill_invocation_events` (0056 shape: nullable `succeeded`, explicit `is_error`) -> runtime readers
  `SkillTelemetrySeamAdapter.findSubagentRuns` / `listSkillsForScopes` (resolved via the
  `LANE_OUTCOME_TOKENS` port) plus the store's dominant-skill and recent-session readers. No production
  caller of the new writer yet: the live writer is still `SkillCandidateStore.recordSkillEvent`
  (via `skill-invocation-recorder.ts:48`) into the same table; batch 4 moves capture to the new writer.

## Batch 4: Nullable three-kind capture - COMPLETE (70fe69067)

- Phase: A | Executor: CLI lane codex | Depends on: 1, 3 | Tasks: 1
- Flags: WRITE-PATH (event rows: `succeeded` NULL, `source='slash-command'`)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis --parallel=1`
- Precondition: the trigger hard-codes success (`triggers/skill-trigger.service.ts:510,675`). The 0056
  migration and the event store exist.

### Task 4.1: Write NULL grades and an explicit error flag - COMPLETE

- Files: `SS/skill-invocation-recorder.ts` + spec, `SS/triggers/skill-trigger.service.ts` + spec,
  `SS/subagent-metrics-extractor.ts` + spec.
- Plan reference: plan row 4; implementation-plan.md:15, 31 (attribution boundary), 95-100.
- Pattern to follow: `UserPromptExpansionPayload.expansionType` (`agent-sdk/helpers/user-prompt-expansion-callback-registry.ts:8-16`).
- Quality requirements: `subagent` maps to Agent, `tool-use` to Skill, and `slash-command` to Command.
  `mcp_prompt` and old `prompt-expansion` rows stay unclassified. Every new row has a NULL grade.
- Validation notes: a test fails if a tool success is recorded as a grade (the old 100% bug).
- Implementation details: write through the event store and leave the enqueue calls in place (they are
  cut in batch 44).

### Batch 4 verification notes

- Verified on disk: `SS/skill-invocation-recorder.ts` injects `SkillInvocationEventStore` (no
  `SkillCandidateStore`), writes `succeeded: null`, forwards explicit `isError`, accepts
  `slash-command`, and prefixes dedup keys with `source`. The trigger maps SubagentStop to `isError:
  false`, Skill/Task PostToolUse to `!payload.success`, `slash_command` expansions to `slash-command`,
  other expansions (MCP prompts) to `prompt-expansion`. Enqueue calls untouched.
- Grade-bug test present: `skill-invocation-recorder.spec.ts:113-128` ("records %s with isError=%s and
  no grade") asserts a successful `tool-use` call stores `succeeded: null`; the trigger spec asserts
  persisted subagent rows have NULL `succeeded`.
- `SS/subagent-metrics-extractor.ts` + spec: no edit needed (no observed success/failure in transcript
  metrics; the PostToolUse callback carries the error signal).
- Decision O1 (decisions.md): ownership widened to `SS/skill-lifecycle.reachability.integration.spec.ts`
  (spec only), updated to the new write path (`isError: false`, NULL grade via the event store); no
  duplicated candidate-store write.
- Checks: skill-synthesis test + typecheck + lint PASS (orchestrator, both batches applied).
- Write-path trace: `SkillTriggerService` (SubagentStop, PostToolUse, UserPromptExpansion callbacks)
  -> `SkillInvocationRecorder.recordSkillEvent` -> `SkillInvocationEventStore.recordSkillEvent` ->
  `skill_invocation_events` (`succeeded` NULL, `is_error` explicit, `source` in tool-use | slash-command
  | prompt-expansion | subagent). Runtime readers: `SkillTelemetrySeamAdapter` (646 port), and in Phase
  A still `SkillCandidateStore`/`SkillScorecardService` usage aggregates; no reader now derives a rate
  from `succeeded` on new rows (batch 5 moves rates to `skill_task_grades`). `source` is the kind
  discriminator (0056 adds no `subject_kind` to events).

## Batch 5: Task-grade store + scorecard as sole rate source - COMPLETE (7df51a3f6)

- Phase: A | Executor: CLI lane codex | Depends on: 1, 3 | Tasks: 1
- Flags: WRITE-PATH (new `skill_task_grades` rows; table created in this batch's store bootstrap or in
  0056, whichever implementation-plan.md:102-109 names. Decide by reading it, and STOP if it needs a new
  migration not in batch 1)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis --parallel=1`
- Precondition: G1, the old rate sites, remain. The new store is additive.

### Task 5.1: Add `skill-task-grade.store.ts`; the scorecard reads only it - COMPLETE

- Files: `SS/skill-task-grade.store.ts` (new) + spec, `SS/di/register.ts`, `SS/skill-scorecard.service.ts` + spec.
- Plan reference: plan row 5; implementation-plan.md:29, 102-109.
- Pattern to follow: `SS/skill-registry.store.ts`.
- Quality requirements: `successRate` is NULL when there is no grade. Agent, skill and command subjects
  are distinguished. Reads are indexed aggregates, with no per-render scan.
- Validation notes: a corrected review replaces the earlier grade without double-counting it.
- Implementation details: a grade projection keyed by task, subject kind and subject id.

### Batch 5 verification notes

- Verified on disk: `SS/skill-task-grade.store.ts` has a prepared UPSERT on the 0056 primary key
  `(task_id, subject_kind, subject_slug, attribution_key)`, per-subject aggregates and `listRecent`
  reading `INDEXED BY idx_skill_task_grades_subject`; `successRate` is NULL when `graded = 0`. Token
  `SKILL_TASK_GRADE_STORE` in `SS/di/tokens.ts`, registered in `SS/di/register.ts`.
  `SS/skill-scorecard.service.ts` injects it and takes every rate and verdict from it; usage and token
  metrics still come from `SkillCandidateStore`.
- No new migration: the table and index come from 0056 (batch 1), so the STOP condition did not apply.
- Correction test present: `skill-task-grade.store.spec.ts:41-49` ("replaces a corrected review without
  adding a denominator") upserts pass then fail for the same key and asserts `graded: 1, passed: 0`.
  Subject isolation and NULL rate covered at :28-39.
- Checks: skill-synthesis test + typecheck + lint PASS (orchestrator, both batches applied).
- Write-path trace: writer `SkillTaskGradeStore.upsert` -> `skill_task_grades` (rows today only from
  the 0056 historical backfill; no runtime caller yet, batch 6 wires the spec harvester). Runtime readers:
  `SkillScorecardService` via `getAggregates` (scorecard and win rates) and `listRecent` (recent and
  detail verdicts), each scoped by `(subject_kind, subject_slug)`.

## Batch 6: Review-derived grades in the spec harvester - COMPLETE (baebe0c30)

- Phase: A | Executor: CLI lane codex | Depends on: 5 | Tasks: 1
- Flags: WRITE-PATH (grade rows; versioned `.harvested.json` marker in task folders)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis --parallel=1`
- Precondition: the old candidate harvester remains. The grade store from batch 5 exists.

### Task 6.1: Parse judge rounds and reviews; re-harvest on digest change - COMPLETE

- Files: `SS/spec-extractor.ts` + spec, `SS/spec-harvester.service.ts` + spec, `SS/spec-findings.port.ts`,
  `SS/skill-task-grade.store.ts`.
- Plan reference: plan row 6; implementation-plan.md:18, 102-109; context.md decision 4.
- Pattern to follow: the current `spec-extractor.ts:42-164` parsing.
- Quality requirements: parse `batches.md`/`tasks.md`, `code-logic-review.md`, `code-style-review.md`,
  `judge-round-*.json` and `*-review.md`. Precedence and corrections follow the plan. Task paths are
  validated under the workspace spec root. Reads are bounded. No raw review text in logs.
- Validation notes: an ambiguous or absent session/task link means ungraded. An invalid artifact means no
  grade, with a bounded diagnostic.
- Implementation details: the marker carries a version and an artifact digest. Findings still feed the
  enhancer port.

### Batch 6 verification notes

- Verified on disk: `spec-extractor.ts` bounded, root-validated reads with explicit verdict parsing and an
  artifact digest; `spec-harvester.service.ts` `MARKER_VERSION = 2` (:83), digest skip (:112),
  `writeGrades` (:148) with precedence batch > lane `final_review` > review, conflicting verdicts give
  no grade with a bounded diagnostic (slug truncated, no review text); `SkillTaskGradeStore` gains
  `findAttributions`, `removeAbsent`, `hasGradeForTask`; port takes an optional subject kind. Legacy
  candidate reconciliation still runs on the first harvest (old path kept for Phase A). Report:
  reports/batch-6-report.md.
- Checks: skill-synthesis test + typecheck + lint PASS (orchestrator).
- Write-path trace 1 (grade rows): `SpecHarvesterService.harvest` -> `writeGrades` ->
  `SkillTaskGradeStore.upsert` keyed by `(task_id, subject_kind, subject_slug, attribution_key)`
  in `skill_task_grades` (0056, batch 1); `removeAbsent` deletes rows for the task/workspace no longer
  supported by corrected evidence. Readers: `SkillScorecardService` via `getAggregates` (rate = wins /
  graded, NULL at zero graded) and `listRecent`; `SpecHarvesterService.getRecentFindings` via
  `hasGradeForTask` feeding `SpecFindingsPort` for the enhancer. Correction replaces, never adds a
  denominator (UPSERT on the same key).
- Write-path trace 2 (`.harvested.json`): `writeMarker` writes `{taskId, harvestedAt, reconciledCount,
  version: 2, artifactDigest}` via a `wx` temp file + `rename` in the task folder. Reader: `readMarker`
  (lstat, 4 KiB cap, realpath containment, shape validation; an unparseable or legacy marker reads as
  version 0) in `harvest`, `listSpecs` and `clearStaleSpecs`. A legacy marker or a changed digest
  triggers re-harvest; same version and digest skips. No settings or env side effects.

## Batch 7: Nullable success-rate formatter guard - COMPLETE (3984309d2)

- Phase: A | Wave: A-W1 | Executor: CLI lane Glm | Depends on: none | Tasks: 1
- Flags: UI ("No grade" text)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: `clone-action-gating.ts:241-244` uses `Number.isFinite` followed by arithmetic, which
  does not narrow a nullable number.

### Task 7.1: Null-narrowing `formatSuccessRate` - COMPLETE

- Files: `SU/components/clones/clone-action-gating.ts` + spec.
- Plan reference: plan row 7.
- Pattern to follow: the existing formatter in the same file.
- Quality requirements: a `typeof x === 'number'` guard (or equivalent) that narrows the type; `null`
  renders "No grade"; existing number callers stay valid.
- Validation notes: this must land before the shared `CloneSummary.successRate` is widened (batch 8).
- Implementation details: a spec case for null, NaN and a number.

### Batch 7 verification notes

- Verified on disk: `formatSuccessRate` returns `null` when `invocationCount <= 0`, `'No grade'` for a
  null or non-finite rate (typeof guard narrows), else a rounded percentage; spec covers null, NaN and a
  number. Checks: skill-synthesis-ui test + typecheck + eslint PASS (orchestrator). No persisted write.
- UI flag: the visual before/after capture is owed at the Phase A review, not per batch.

## Batch 8: Widen `CloneSummary.successRate` to nullable - COMPLETE (31db66e38)

- Phase: A | Executor: CLI lane codex | Depends on: 5, 7 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: the null guard from batch 7 is present. `rg -n "CloneSummary|successRate" libs apps` finds
  consumers only in SS, SU, RH and shared (the `workspace-intelligence` fixture string is unrelated).

### Task 8.1: Widen the shared DTO and update the handler together - COMPLETE

- Files: `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts` + spec, `RH/handlers/skills-synthesis-rpc.handlers.ts` + spec.
- Plan reference: plan row 8.
- Pattern to follow: the existing DTO in the same file.
- Quality requirements: `successRate: number | null`. The handler compiles against the widened field.
- Validation notes: no other DTO changes.
- Implementation details: none beyond the widening.

### Batch 8 verification notes

- Verified on disk: `rpc-skill-clone.types.ts:25` `successRate: number | null`; handler
  `skills-synthesis-rpc.handlers.ts:2305` returns `null` when `stats.total === 0` (measured zero kept);
  spec case at `skills-synthesis-rpc.handlers.spec.ts:993-1002`. No shared spec change (type-only
  widening). No other DTO changed. Report: reports/batch-8-report.md.
- Checks: rpc-handlers test + typecheck + lint PASS; shared + skill-synthesis-ui test + typecheck PASS
  (orchestrator).

## Batch 9: Enhancer reads migrated keys directly - COMPLETE (528d34c29)

- Phase: A | Executor: CLI lane codex | Depends on: 2, 3 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis --parallel=1`
- Precondition: the old `judgeProvider`/`judgeModel` reader (`skill-enhancer.service.ts:797-814`) remains.
  The batch 2 keys exist.

### Task 9.1: Settings via `IWorkspaceProvider`; cut the candidate and judge injects - COMPLETE

- Files: `SS/skill-enhancer.service.ts` + spec, `SS/skill-registry-catalog.service.ts` + spec, `SS/trajectory-extractor.ts` + spec.
- Plan reference: plan row 9; implementation-plan.md:62.
- Pattern to follow: the current default resolution at `skill-enhancer.service.ts:804-814`.
- Quality requirements: read `skills.enhancement.*` and `skillSynthesis.enabled` directly. Keep any old
  call signature until batch 44. Do not log credentials.
- Validation notes: the existing abort/timeout path (`:883-933`) is kept.
- Implementation details: remove the `SkillCandidateStore` and `SkillJudgeService` injections only where
  the replacement is live.

### Batch 9 verification notes

- Verified on disk: `skill-enhancer.service.ts` reads `skills.enhancement.provider`, `.model`
  (default `inherit`) and `.timeoutMs` (typeof-number guard, clamped) through
  `workspaceProvider.getConfiguration`; the abort/timeout path is unchanged. Public call signatures kept;
  only the private `generateCandidate` drops its unused `settings` argument.
- Pause gate: `isEligible` and `generateProposal` read `skillSynthesis.enabled` and stop only on an
  explicit `false` (new skip reason `paused`), matching plan :44 (manual enhancement pause key) and the
  :135 write-path row (enhancer guard; telemetry and harvest bypass the pause). Read-only, no write.
- Catalog and trajectory files unchanged - accepted against plan row 9 (implementation-plan.md:169):
  the row cuts injects only where the replacement is live. `SkillCandidateStore` and `SkillJudgeService`
  stay in the enhancer (eligibility, usage counts, recent sessions, proposal judging still call them),
  `SkillCandidateStore` stays in the catalog (`syncFromClones` links candidate IDs), and
  `TrajectoryExtractor` has neither inject. The cut moves to batch 44.
- Fix round 1 (reports/batch-9-fix-1-report.md) asked to log the auth error message; the orchestrator
  REVERTED it (decisions.md O3). `skill-enhancer.service.ts:853` keeps `catch {` with a comment: auth
  errors can quote credentials. The warn still logs slug and provider; spec asserts no `error` field.
- Checks: skill-synthesis test + typecheck + lint PASS; after the O3 revert
  `skill-enhancer.service.spec.ts` 85/85 PASS and eslint 0 errors on that file (orchestrator).

## Batch 10: Manual draft preview; explicit save - COMPLETE (3c474c1bc)

- Phase: A | Executor: CLI lane codex | Depends on: 9 | Tasks: 1
- Flags: WRITE-PATH (save goes only through `saveCloneBody`: user-layer file + history snapshot)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis --parallel=1`
- Precondition: preview still calls `synthesis.readSettings` (RH handler `:1169`).

### Task 10.1: Generation never writes a clone - COMPLETE

- Files: `RH/handlers/skills-synthesis-rpc.handlers.ts` + spec, `SS/skill-enhancer.service.ts` + spec, `SS/types.ts`.
- Plan reference: plan row 10; implementation-plan.md:21, 61.
- Pattern to follow: the `previewEnhancement` and `saveCloneBody` handlers (`:1100-1237`).
- Quality requirements: the draft carries before/after text, bounded evidence, a diff and the model.
  Recheck the source hash or version before save, and refuse if it is stale. A provider failure returns
  a draft error and touches nothing.
- Validation notes: `enhanceNow` and `applyProposal` are not called by preview. Their method removal is
  in batch 59.
- Implementation details: none beyond the requirements above.

### Batch 10 verification notes

- Scope widened (decisions.md O5, O6): `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`
  (additive optional `draft` on the preview result, optional `expectedSourceHash` on save params),
  `RH/handlers/skills-synthesis-rpc.schema.ts` (optional `sha256:<64 hex>`), and the save API of
  `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` + spec.
  Ran concurrently with batch 12 under one combined check (O4).
- Verified on disk: `generateProposal` builds an in-memory `EnhancementDraft` (before/after,
  evidence capped at 1600/1600/scorecard chars, bounded diff, model, sha256 of the exact body read);
  preview calls neither `enhanceNow` nor `applyProposal` and writes no file (proposal cache is
  in-memory only). Provider failure returns `skipReason: 'provider-unreachable'`, no draft, no write.
  Generation warn logs drop the raw provider error (consistent with O3).
- Write-path trace (save): RPC `saveCloneBody` -> zod schema validates optional hash ->
  handler forwards it only when present -> `UserLayerMirrorService.saveCloneBody` takes
  `withSlugLock(kind, slug)` -> clone-missing check -> (hash present) read current
  `SKILL.md` / `<slug>.md`, compare sha256; mismatch returns `stale-source` with `written: false`,
  `historyTs: null` BEFORE `snapshotDirToHistory`/`snapshotFileToHistory` and before
  `writeTextAtomic` -> handler throws `RpcUserError(INVALID_PARAMS)` "preview again". On match or
  absent hash: snapshot prior body to `.history` then atomic write (unchanged path). Readers:
  `readCloneBody` (`getClone` RPC), `listHistory`, and the enhancer's `readBody` (same utf8 bytes
  the next preview hashes). No settings or DB key written. Absent hash is byte-for-byte the old path.
- Specs: mirror spec asserts stale skill and flat-file saves leave the file and `listHistory`
  unchanged; matching hash saves and snapshots the original; absent hash unchanged. Handler spec
  covers hash pass-through, stale refusal, preview no-write, provider failure unsaved.
- Checks (orchestrator, O4): `nx run-many -t test typecheck -p rpc-handlers skill-synthesis shared
  agent-generation` green for batch 10 files; lint PASS on the same 4 projects.

## Batch 11: Nullable scorecard UI - COMPLETE (6aee6af62)

- Phase: A | Wave: A-W2 | Executor: CLI lane Glm | Depends on: 7 | Tasks: 1
- Flags: UI
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: the old tabs remain. The new UI compiles beside them.

### Task 11.1: Scorecard badge, detail and outcome signals render null grades - COMPLETE

- Files: `SU/components/clones/scorecard-badge.component.ts` + spec, `scorecard-detail.component.ts` + spec, `agent-outcome-signals.ts` + spec.
- Plan reference: plan row 11; implementation-plan.md:61 (no causality claim when ungraded).
- Pattern to follow: the existing components.
- Quality requirements: "No grade" for null. No review markdown is rendered as untrusted HTML.
- Validation notes: none beyond the requirements above.
- Implementation details: none beyond the requirements above.

### Batch 11 verification notes

- Verified on disk: badge, detail rows and outcome signals render "No grade" for null, absent or
  non-finite grades (never 0% or FAILED; no causality claim when ungraded); no `[innerHTML]` use.
  Fix round 1: `clone-card.component.spec.ts:330,545` expectation 'no data yet' -> 'No grade'
  (shared label), committed with the batch.
- Checks: skill-synthesis-ui test + typecheck + lint PASS (orchestrator, after fix). No persisted write.
- UI flag: Phase A visual before/after screenshots (dark + light, "before" from `271198ced`) are owed at
  the Phase A review, not per batch.

## Batch 12: Move `resolveSkillsRoot` to `skills-root.ts` - COMPLETE (29d1305fb)

- Phase: A | Executor: CLI lane codex | Depends on: none (sequential after 10) | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers --parallel=1`
- Precondition: `skill-md-generator.ts` remains (until batch 61). Importers use the package index:
  VS Code/Electron `plugin-activation.ts`, `harness-fs.service.ts:37` and CE `harness-boot.ts:48`.

### Task 12.1: Keep the configured shipped-skill root - COMPLETE

- Files: `SS/skills-root.ts` (new) + spec, `SS/skill-md-generator.ts`, `libs/backend/skill-synthesis/src/index.ts`, `RH/harness/io/harness-fs.service.ts` + spec.
- Plan reference: plan row 12; the shipped-skills row in the preserve table (implementation-plan.md:46).
- Pattern to follow: the current `resolveSkillsRoot` in the generator.
- Quality requirements: `skillSynthesis.skillsRoot` is honored, and an alternate root delivers.
- Validation notes: the generator re-exports or imports from the new file until it is deleted.
- Implementation details: none beyond the requirements above.

### Batch 12 verification notes

- Ran concurrently with batch 10 under one combined check (decisions.md O4).
- Verified on disk: `SS/skills-root.ts` holds `resolveSkillsRoot`, `SKILLS_ROOT_SECTION`,
  `SKILLS_ROOT_KEY` unchanged in behaviour (default `~/.ptah/skills`, trimmed override, fail-soft).
  The index exports them from `skills-root.ts`; `skill-md-generator.ts` imports and re-exports them
  until batch 61 (its roots spec imports from there). Host importers use the package index.
- `harness-fs.service.ts` change is a doc comment only; the new spec checks default and alternate
  roots reach `mirrorAll`. Fix round 1 (reports/batch-12-fix-1-report.md) fixed the spec's TS2352 by
  typing the stub as `jest.Mocked<Pick<UserLayerMirrorService, 'mirrorAll'>>`; spec then 2/2 PASS.
- Checks (orchestrator): combined test + typecheck green after fix-1; lint PASS. No persisted write.

## Batch 13: Keep the foreground-activity tracker live - COMPLETE (e5ea784a1)

- Phase: A | Executor: CLI lane codex | Depends on: 12 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis --parallel=1`
- Precondition: `TH/memory-retention-job.ts:112-124` resolves the tracker.

### Task 13.1: Isolate the tracker and its token from the queue pipeline - COMPLETE

- Files: `SS/queue/foreground-activity.tracker.ts` + spec, `SS/di/register.ts`, `libs/backend/skill-synthesis/src/index.ts`.
- Plan reference: plan row 13; implementation-plan.md:49.
- Pattern to follow: the existing registration.
- Quality requirements: `FOREGROUND_ACTIVITY_TRACKER` stays registered.
- Validation notes: none beyond the requirements above.
- Implementation details: none beyond the requirements above.

### Batch 13 verification notes

- Report: reports/batch-13-report.md. Committed by the orchestrator as e5ea784a1.
- Orchestrator correction: `foreground-activity.tracker.spec.ts:17` types the logger mock as
  `as unknown as Logger` (project spec convention, e.g. `SS/di/register.spec.ts:36`); the lane's
  `as Logger` failed TS2352.
- Checks (orchestrator): skill-synthesis test + typecheck + lint PASS. No persisted write.

## Batch 14: Keep the session-verdict read store - COMPLETE (de2e0e7d2)

- Phase: A | Executor: CLI lane codex | Depends on: 3 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis --parallel=1`
- Precondition: the archaeology writer remains (deleted in batch 61).

### Task 14.1: Make the verdict store independent of the archaeologist - COMPLETE

- Files: `SS/archaeology/session-verdict.store.ts` + spec, `SS/archaeology/session-verdict.types.ts` + spec, `SS/outcome-seam/skill-telemetry-seam.adapter.ts`, `SS/di/register.ts`.
- Plan reference: plan row 14; implementation-plan.md:7, 17.
- Pattern to follow: the existing store.
- Quality requirements: `unverified` is never treated as a positive grade. Joins use exact
  run/session/task plus the workspace.
- Validation notes: none beyond the requirements above.
- Implementation details: none beyond the requirements above.

### Batch 14 verification notes

- Report: reports/batch-14-report.md.
- Verified on disk: `session-verdict.store.ts` imports only tsyringe, zod, vscode-core,
  persistence-sqlite and `./session-verdict.types` (no archaeologist). DI registers the store
  on its own (SQLite + Logger); the seam adapter depends on `Pick<..., 'evidenceClassForSessions'>`.
- New `positiveEvidenceForRun(join)` returns null unless run, session, task and workspace are
  all nonempty and match `lane_outcome_records` exactly, joined to `skill_session_verdicts` on
  session + workspace, non-degraded. `isPositiveEvidenceClass` excludes `unverified`,
  `no-correction` and null. Specs cover each mismatched key, the empty workspace and unverified.
- Read-only: no persisted write. The `sessionEvidence` port is unchanged (consumer cut is later).
- Checks (orchestrator): skill-synthesis test + typecheck + lint PASS.

## Batch 15: Fatal verified-archive preflight (0057 not registered) - COMPLETE (6bd335a2f)

- Phase: A | Wave: A-W2 | Executor: CLI lane codex | Depends on: 1 | Tasks: 1
- Flags: WRITE-PATH (owner-only JSONL archive + receipt file)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite --parallel=1`
- Precondition: G15, older vec catch-up, runs after the regular migrations (`migration-runner.ts`
  `applyAll:136`, `runVecCatchUp:319-349`).

### Task 15.1: Archive and verify before version 57 - COMPLETE

- Files: `PS/skill-pipeline-archive.ts` (new) + spec, `PS/migration-runner.ts` + spec.
- Plan reference: plan row 15; implementation-plan.md:24, 124-129; context D3.
- Pattern to follow: the backup handling in `migration-runner.ts:181-265`, but fatal.
- Quality requirements: export these tables and verify the receipt (row counts and sha256), then
  require the receipt. Tables: `skill_candidates`, `skill_suggestions`, `skill_synthesis_queue`,
  `skill_synthesis_budget`, `skill_invocations`, `skill_synthesis_workspace_cursor`,
  `skill_candidates_vec`, and the `job_runs` rows of the four pipeline job IDs. When vec is loaded, the
  older pending vec catch-up runs first. If vec exists but cannot load, the preflight fails. The archive
  is owner-only. Prepared SQL.
- Validation notes: the archive function is exported so batch 50's dry-run script can call it on a DB copy.
- Implementation details: none beyond the requirements above.

### Batch 15 verification notes

- Verified on disk: `PS/skill-pipeline-archive.ts` exports `archiveSkillPipeline(db, archiveRoot?)` and
  `verifySkillPipelineArchive(receiptPath)`; fixed table list, prepared SQL, `job_runs` limited to the four
  pipeline job IDs; dirs `0700`, files `0600` (`wx`). `migration-runner.ts` calls `ensureArchive()` before
  any version >= 57 (and before deferred vec >= 57): vec loaded -> fatal catch-up through 56 first; vec
  table present but vec unloaded -> throws. Migration registry still ends at 56.
- Checks: persistence-sqlite test + typecheck PASS (orchestrator); lint 0 errors. Minor (recorded, not
  fixed): `migration-runner.ts:378` `preserve-caught-error` warning, the new fatal throw has no `cause`.
- Write-path trace: writer `archiveSkillPipeline` -> `~/.ptah/backups/skill-pipeline/pre-0057-*/`
  (`<table>.jsonl` + `receipt.json`, owner-only) -> runtime readers: `verifySkillPipelineArchive` (called
  inside `archiveSkillPipeline` before return; re-hashes and recounts), then `SqliteMigrationRunner`
  logs `receipt.archivePath` and only then applies >= 57. Later readers: batch 50 dry-run script and
  OP-1 user confirmation. No runtime effect today because 0057 is unregistered.

**Phase A review due after the last Phase A batch commits (batch 14 in wave run order; 15 landed early in A-W2): code-logic + style (new public API) + visual before/after.**

## Phase A review and fix round - COMPLETE (8360e7aca; records in the docs commit that follows it)

- Combined diff reviewed: `271198ced..fd0110afc` (batches 1-15).
- Review family: reviewer Claude (`code-logic-reviewer` / `code-style-reviewer` subagents, a third
  family); implementers codex (lanes A1, A2, B, D) and Glm (lane C). Different-family rule met.
- Round 1: `code-logic-review.md` REVISE 6/10 (L-), `code-style-review.md` REVISE 6/10 (St-).
  Fix plan: `phase-a-fix-round.md`. Decisions O7 (source-hash helper in platform-core), O8, O9
  (normalise roots after task-scoped SQL selection) in `decisions.md`.
- Fixed (one round, lanes A1, A2, B, C; reports `reports/phase-a-fix-{A1,A2,B,C}-report.md`):
  L-S1, L-S2, L-S3, L-M1, L-M2, L-M3, L-M4, L-M5, L-M6, L-M7, L-M8, St-S1, St-S2, St-S3, St-M1.
- Round 2 (re-review scoped to the fixes): `code-logic-review-round-2.md` REVISE 7/10. Bounded
  correction (lane D, `reports/phase-a-fix-D-report.md`): S1 (normalised root mismatch silently
  dropped grades), M3 (write `skills.enhancement.*` before the legacy key), M4 (REJECT / NEEDS
  REVISION), M5 (last parseable verdict).
- Round 3 (correction only): `code-logic-review-round-3.md` APPROVED 8/10. Phase A logic gate passed.
  The style fixes (St-S1, St-S2, St-S3, St-M1) were verified FIXED in the round-2 per-item table; no
  separate style re-review was run.
- Checks before commit (orchestrator): `nx run-many -t test typecheck lint --parallel=1` PASS for
  skill-synthesis, rpc-handlers (after the correction), agent-generation, persistence-sqlite and
  platform-core. `voice-rpc` and `skills-sh-legacy-adoption` specs (rpc-handlers) timed out once under
  load and passed alone; not touched by this round.
- Write-path traces: in `code-logic-review-round-2.md` (Write-path traces table): new and legacy
  enhancement keys, load-time settings migration via `persist()`, `skill_task_grades`,
  `skill_invocation_events`, `.harvested.json` marker, archive dir.
- Commit: 8360e7aca `fix(skill-synthesis,rpc-handlers): phase A review fix round` (25 files). The
  agent-generation `user-layer/source-hash.spec.ts` the lanes deleted was never tracked, so no deletion
  was staged.
- Deferred to named later work (each recorded on the receiving batch):
  - L-M9 archive Windows file modes and archive directory accumulation -> batch 67 (Task 67.2).
  - St-M2 attribution grouping to a pure function; round-2 M1 bounded retry for a persistently failing
    grade write; round-2 M2 stale grade when every attribution is skipped; round-3 N1
    `spec-extractor.ts:109` verdict capture swallows trailing words -> batch 44 (Task 44.2).
  - St-M3 move `SKILL_SETTINGS_MIGRATIONS` to `file-settings-keys.ts` -> batch 65 (Task 65.2).
  - Minor findings (recorded only, not fixed): round-1 L/St Minors; round-2 Mi1-Mi6; round-3 N2 (lost
    workspace pre-filter on the task-id-null branch, cost only), N3 (stale grades under pre-fix root
    form), N4 (lane-record and null-root spec coverage).
- Visual review (batches 7, 11; dark + light, "before" from `271198ced`): `visual-review-phase-a.md`
  APPROVED 8/10 (Blocking 0, Serious 1, Moderate 2, Minor 1). Evidence: `visual/after/` (dark + light
  PNGs, `a11y-raw.txt`, `index-raw.txt`, capture scripts). No prototype applies (text/tone change on
  existing surfaces); before/after screenshots in both themes stand in.
  - Serious 1 (pre-existing, NOT a Phase A blocker): dark-theme daisyUI `badge-success` (2.64:1) and
    `badge-error` (3.87:1; light 4.12:1) pills fail WCAG AA 1.4.3 at 10px/9px text
    (`scorecard-badge.component.ts`, `scorecard-detail.component.ts:118-119`). The classes predate the
    batches; the new "No grade" pill passes (13.89:1 dark, 14.21:1 light). Named follow-up OUTSIDE this
    task's batches: "Scorecard pill contrast - dark-theme badge-success/badge-error token pairing".
  - Moderate 1 (carried to Phase B): the null (`succeeded: null`) detail-row pill
    (`scorecard-detail.component.ts:185-201`) is not reachable live yet. Re-check its tone and contrast
    in both themes in the Phase B visual review after batch 24.
  - Moderate 2 (recorded, not fixed): pill text 10px / 9px, pre-existing sizing.
  - Minor 1 (recorded, not fixed): card verdict dots have no neutral/ungraded style; nothing to render
    until null verdicts reach `recentVerdicts` (re-check alongside Moderate 1 after batch 24).
- **Phase A CLOSED** (logic APPROVED round 3, style fixes verified, visual APPROVED). Records committed
  in the docs commit after batch 19.

### Next action:

Phase B batches 16-22 are COMPLETE (21 = 917be31f2). Run batch 23 now (IN_PROGRESS), then batch 24,
sequentially, one lane each, both gated on `-p @ptah-extension/skill-synthesis-ui` (scoped checks one at
a time).

- Batch 23 - Formatter drops the `invocationCount` gate. Files:
  `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts` + its spec.
  Requirement (plan row 21): the success-rate formatter formats from the graded value alone; remove the
  `invocationCount <= 0` guard (precondition: present at `clone-action-gating.ts:241`); a null graded
  value stays "no grade", never 0 %. Depends on 22 (producer reads `skill_task_grades`; `successRate`
  may be `null`). Flags: UI. Gate:
  `npx nx run-many -t test typecheck lint -p @ptah-extension/skill-synthesis-ui --parallel=1`.
- Batch 24 - Three-kind nullable grade display: `skill-clones-view.component.ts` + spec,
  `clone-card.component.ts` + spec, `clone-detail-drawer.component.ts` + spec (plan row 22; preserve rows
  "Library tabs" and "Scorecard", implementation-plan.md:47-48). Same gate. Note: batch 21 last edited
  `skill-clones-view.component.ts` (O14 save handler at `:813-838`); keep it.

After batch 24 commits: Phase B review = code-logic on `dc10d73b2..HEAD` (parent of the first Phase B
commit 6071e8ccc) plus visual (list in the Phase map row B, including O10 tile, Library pause/telemetry
controls, the model editor slow/unavailable states and the enhance preview drawer from batch 21, and
Phase A Moderate 1 and Minor 1).

---

# Phase B - switch readers and writers

## Batch 16: Core Providers - Enhancement slice beside old (R3) - COMPLETE (6071e8ccc)

- Phase: B | Wave: B-W1 | Executor: CLI lane Glm | Depends on: 2 | Tasks: 1
- Flags: WRITE-PATH (`settings:set skills.enhancement.*`, readBack `settings:get`)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/core @ptah-extension/chat --parallel=1`
- Precondition: core has `judging`/`lanes` slices (`providers-settings.types.ts:10,34,39,90`). The batch 2 keys exist.

### Task 16.1: Add an `enhancement` slice; keep `judging`/`lanes` for now - COMPLETE

- Files: `libs/frontend/core/src/lib/services/providers-settings.types.ts`, `providers-settings-state.service.ts` + spec, `providers-commit.service.ts` + spec.
- Plan reference: plan row 16; implementation-plan.md:62; round-2 R3.
- Pattern to follow: the existing `memory` slice read/write in the same services.
- Quality requirements: write through `settings:set` and read back through `settings:get`. No change to
  the old slices yet.
- Validation notes: chat compiles unchanged (the change is additive).
- Implementation details: none beyond the requirements above.

### Batch 16 verification - COMPLETE (6071e8ccc)

- Executor: CLI lane codex (report `reports/batch-16-report.md`, incl. fix round 1).
- On disk: `providers-settings.types.ts` (enhancement key map/state/patch), `providers-settings-state.service.ts`
  (enhancement section, load + refresh), `providers-commit.service.ts` (per-field `settings:set` +
  `settings:get` strict readBack). Judging/lanes slices untouched. No stubs or TODOs in the diff.
- Gate `nx run-many -t test typecheck lint -p core chat --parallel=1`: chat PASS; core failed one spec
  (judging/lanes captured unloaded before compare). Fix round 1 changed the spec only
  (`providers-settings-state.service.spec.ts:266-270, 303-307`); spec then 99/99 alone, core typecheck
  and lint PASS (orchestrator-verified).
- WRITE-PATH: `skills.enhancement.{provider,model,timeoutMs}` -> `settings:set` -> `settings:get`
  readBack -> `refreshEnhancement()`; trace in the batch report for Mode 3.
- Commit: 6071e8ccc `feat(core): batch 16 - providers enhancement slice beside old` (5 files).

## Batch 17: Chat Providers rows, assignments and connection usage switch (R3) - COMPLETE (f2e072e0a)

- Phase: B | Wave: B-W2 | Executor: CLI lane Glm (planned; codex ran it) | Depends on: 16 | Tasks: 1
- Flags: UI (Providers > consumer rows), WRITE-PATH (Enhancement provider/model/timeout save)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/chat --parallel=1`
- Precondition: the batch 16 slice exists. `rg -n "SkillLane|judgeProvider|enhanceTimeoutMs|lanes\(\)|refreshLanes" libs/frontend/chat/src/lib/settings/providers` lists the current users.

### Task 17.1: Replace "Judging & enhancement" with an Enhancement row; drop the lane rows - COMPLETE

- Files: `libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts` + spec, `provider-consumer-assignments.component.ts` + spec, `connection-usage.ts` + spec.
- Plan reference: plan row 16; implementation-plan.md:22, 62; round-2 R3.
- Pattern to follow: the memory curator consumer row.
- Quality requirements: no import of `SkillLane*Dto` and no read of `judgeProvider`, `lanes()` or
  `skillSynthesis.enhanceTimeoutMs`. The timeout uses `skills.enhancement.timeoutMs` with the existing
  Undo path.
- Validation notes: after the batch, the grep above has zero live hits in these six files.
- Implementation details: none beyond the requirements above.

### Batch 17 verification - COMPLETE (f2e072e0a)

- Executor: CLI lane codex (Glm skipped after its two stops in batch 19); report
  `reports/batch-17-report.md`, incl. fix rounds 1-3.
- Scope widened per O13/O13a (type-change consumers; batch 18 runs after 17, batch 16 core is
  committed, so no concurrent owner). 15 files total:
  - planned: `chat/.../providers/provider-consumer-rows.ts`, `provider-consumer-assignments.component.ts`,
    `connection-usage.ts`, each + spec;
  - widened: `chat/.../providers/connection-drawer/overview-tab.component.ts` + spec;
    `chat/.../providers/providers-settings.component.ts` + spec (only the `connectionUsage` call; the
    lanes section stays for batch 18); `chat/.../settings/settings.component.ts` + spec (focus-target
    set and predicate); `chat/.../settings/ptah-ai/orchestration-settings.component.ts` + spec
    (background-roles summary now "Memory curator, enhancement, decision", 3 roles);
    `libs/frontend/core/src/lib/services/app-state.service.ts` (`enhancement` added to
    `PendingSettingsTab.section`).
- Legacy `PendingSettingsTab` ids kept (O13a: removed only where nothing uses them):
  `archaeologist`, `synthesis`, `judge`, `replay` (live in `routing-map.component.ts:14-17` and
  `providers-commit.service.ts:151-154`) and `judging-enhancement` (e2e fixtures
  `webview-e2e-harness/.../thoth/skills-lane-pickers.e2e.spec.ts:114`,
  `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:121`). The chat focus-target set already
  excludes all five. Removal is Task 53.2 (decision T12).
- On disk: the batch-17 grep has 0 hits in its six files; no TODO/PLACEHOLDER/STUB in the diff.
- Gate `nx run-many -t test typecheck lint -p core chat --parallel=1` PASS after fix round 3
  (orchestrator-verified; not re-run here, RAM rule).
- WRITE-PATH: Enhancement provider/model/timeout -> batch 16 enhancement patch -> core
  `settings:set skills.enhancement.*` -> `settings:get` readBack -> `enhancement()`; empty model
  normalised to `inherit` (same as `providers-commit.service.ts:134-148`). Trace in the batch report.
- UI: Enhancement row and the background-roles summary are on the Phase B visual list (Phase map row B).
- Commit: f2e072e0a `refactor(core,chat): batch 17 - providers enhancement row` (15 files).

## Batch 18: Chat routing map and Providers page drop lanes; advanced spec fixture (R3, R5) - COMPLETE (03efa52df)

- Phase: B | Executor: CLI lane Glm | Depends on: 17 | Tasks: 1
- Flags: UI (Providers routing map)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/chat --parallel=1`
- Precondition: batch 17 is done. `providers-settings.component.ts:831-856` and
  `routing-map.component.ts:7-286` still read the lanes.

### Task 18.1: Remove the lanes section; Enhancement uses the new provider key - COMPLETE

- Files: `libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts` + spec,
  `providers-settings.component.ts` + spec, `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts`.
- Plan reference: round-2 R3, R5.
- Pattern to follow: the `backgroundRolesPreview` memory entry.
- Quality requirements: the routing map shows no dead lanes section and calls no lane RPC. The advanced
  spec (`:343-355`) moves to a key that survives batch 65.
- Validation notes: after the batch, `rg -n "SkillLane|refreshLanes|state\.lanes\(\)|judgeProvider" libs/frontend/chat` has zero live hits.
  Added after batch 17 (T12): the lane `PendingSettingsTab` section ids at `routing-map.component.ts:14-17`
  (`archaeologist`, `synthesis`, `judge`, `replay`) go with the lanes section; do NOT edit the core union
  (`app-state.service.ts`) here, Task 53.2 owns it.
- Implementation details: none beyond the requirements above.

### Batch 18 verification - COMPLETE (03efa52df)

- Executor: CLI lane codex (planned Glm; Glm-planned batches go to codex per the wave note). Report
  `reports/batch-18-report.md`.
- On disk: `routing-map.component.ts` drops `LANES`, the `SkillLaneIdDto` import and the lane/judging
  reads; `backgroundRolesPreview(curatorProvider, enhancementProvider, nameOf)` lists Memory curator and
  Enhancement (`state.enhancement().data.provider`); Retry re-reads only failed memory/enhancement.
  `providers-settings.component.ts:851-856` error state uses `enhancement()` in place of
  `lanes()`/`judging()`. Advanced spec fixture uses `compaction.toolOutputBudgetTokens` (survives 65).
  Core union in `app-state.service.ts` untouched (Task 53.2 owns it). No stubs/TODOs.
- Validation grep `rg -n "SkillLane|refreshLanes|state\.lanes\(\)|judgeProvider" libs/frontend/chat`
  (non-spec) = 0 hits (orchestrator-verified).
- Gate `nx run-many -t test typecheck lint -p @ptah-extension/chat --parallel=1` PASS
  (orchestrator-verified).
- UI: the Background roles node now shows 2 roles (was 6: curator, 4 lanes, judging); on the Phase B
  visual list (Phase map row B).
- Lane decision (accepted, reversible): 2 roles in the node, matching the prior node's set minus the
  deleted lanes, with judging replaced by Enhancement (batch 17).
- **Proposed removal (NOT approved, kept; awaits user approval):** the `routing-background-more`
  template branch (`routing-map.component.ts:156`, spec `:199` asserts it is absent) can no longer
  render with 2 roles and `.slice(0, 2)`. Kept as-is; remove only with recorded user approval (or let
  Phase C/E reductions pick it up once approved).
- Commit: 03efa52df `refactor(chat): batch 18 - routing map drops skill lanes` (5 files).

## Batch 19: Library pause/telemetry round trip + dashboard candidate cut (R5) - COMPLETE (f2f58fdea)

- Phase: B | Wave: B-W1 | Executor: CLI lane Glm | Depends on: 2 | Tasks: 1
- Flags: UI (Library header, dashboard Thoth status), WRITE-PATH (`skillSynthesis.enabled`, `skills.telemetry.enabled`)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui @ptah-extension/dashboard --parallel=1`
- Precondition: the state service calls the old `getSettings`/`updateSettings`.
  `thoth-status.service.ts:325` calls `getSettings` and `:385` calls `listCandidates`.

### Task 19.1: Switch the state service and dashboard to `settings:get`/`set`; remove the candidate count - COMPLETE

- Files: `SU/services/skill-synthesis-state.service.ts` + spec, `SU/components/skill-synthesis-tab.component.ts` + spec, `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts` + spec.
- Plan reference: plan row 17; preserve table "Pause switch" (implementation-plan.md:44); round-2 R5.
- Pattern to follow: the core `settings:get`/`settings:set` usage in the Providers state service.
- Quality requirements: write then read back. Pause off never suppresses telemetry or harvesting. The
  dashboard no longer calls `listCandidates` or `getSettings` (spec mocks at `:92-340` are updated).
- Validation notes: after the batch, `rg -n "listCandidates|getSettings" libs/frontend/dashboard` has zero hits.
- Implementation details: none beyond the requirements above.

### Batch 19 verification - COMPLETE (f2f58fdea)

- Executor: CLI lane Glm started (stopped twice mid-read with partial edits), CLI lane codex took over
  per agent-lanes section 5 and finished (report `reports/batch-19-report.md`, incl. fix round 1).
- Scope widened per O11 (same project, spec only): `libs/frontend/dashboard/src/lib/services/thoth-status-pillars.spec.ts`
  (`pendingCandidates` -> `telemetryEnabled`). 7 files total.
- On disk: state service `settingsGet`/`settingsSet` helpers (`skill-synthesis-state.service.ts:388-411`),
  pause and telemetry write then read back, rollback on failure; tab wires the telemetry toggle;
  dashboard reads `skillSynthesis.enabled` and `skills.telemetry.enabled` via `settings:get`.
  `rg -n "listCandidates|getSettings" libs/frontend/dashboard` = 0 hits. No stubs/TODOs (only test doubles).
- O10: the dashboard Skills tile shows telemetry On/Off in place of the removed candidate count; owed in
  the Phase B visual review.
- Gate `nx run-many -t test typecheck lint -p skill-synthesis-ui dashboard --parallel=1` PASS after fix
  round 1 (orchestrator-verified).
- WRITE-PATH: `skillSynthesis.enabled` and `skills.telemetry.enabled`, one key per write, `settings:set` ->
  `settings:get` readBack; pause off does not write or gate telemetry (spec-asserted).
- Lane decision (accepted): the old synthesis settings form calls (`getSettings`/`updateSettings` in the
  SU state service and tab) are kept. Plan line 119 ("Delete all non-Library polling and synthesis
  settings UI") assigns that reduction to the Library host reduction = **batch 27** (plan row 24: cut
  removed-RPC calls in `skill-synthesis-tab.component.ts` + `skill-synthesis-state.service.ts`); the
  facade methods themselves go in **batch 58** (facade trim, R5 gate). Batch 27's post-cut check must
  show no `getSettings`/`updateSettings` call left in SU state or tab.
- Commit: f2f58fdea `refactor(skill-synthesis-ui,dashboard): batch 19 - settings round trip` (7 files).

## Batch 20: Pause switch uses the migrated state - COMPLETE (221127d6a)

- Phase: B | Executor: CLI lane Glm | Depends on: 19 | Tasks: 1
- Flags: UI, WRITE-PATH (`skillSynthesis.enabled`)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: the batch 19 readBack exists.

### Task 20.1: Keep the switch working through the new state API - COMPLETE

- Files: `SU/components/skills-pause-switch.component.ts` + spec.
- Plan reference: plan row 18.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

### Batch 20 verification - COMPLETE (221127d6a)

- Executor: CLI lane codex. Report `reports/batch-20-report.md`.
- On disk: checkbox, status and paused badge bind `skillsEnabledCommitted`
  (`skill-synthesis-state.service.ts:375`); `paused = computed(() => enabled() === false)`; `onToggle`
  restores the DOM checkbox to the committed value and returns while disabled, else calls
  `setSkillsEnabled`. The service's optimistic `skillsEnabled` stays for other consumers. Spec adds
  one-call, in-flight disabled, read-back, failure rollback + error, telemetry isolation and
  no-legacy-RPC cases. No stubs/TODOs/skips.
- Gate `nx run-many -t test typecheck lint -p @ptah-extension/skill-synthesis-ui --parallel=1` PASS
  (orchestrator-verified).
- WRITE-PATH: switch -> `setSkillsEnabled` -> `settings:set skillSynthesis.enabled` ->
  `settings:get` readBack -> `skillsEnabledCommitted`; never writes `skills.telemetry.enabled`. Same key
  and reader as batch 19's trace; runtime reader unchanged.
- Lane note: scoped diagnostics showed 16 errors in sibling SU files outside batch 20; the SU gate
  passed, so these are diagnostics-tool noise, not gate failures. No action.
- UI: pause switch is on the Phase B visual list (Phase map row B).
- Commit: 221127d6a `refactor(skill-synthesis-ui): batch 20 - pause switch reads committed` (2 files).

## Batch 21: Model timeout fix + manual draft drawer - COMPLETE (917be31f2)

- Phase: B | Executor: CLI lane Glm | Depends on: 10, 20 | Tasks: 1
- Flags: UI (agent model editor, enhance preview drawer), WRITE-PATH (`setAgentModel`, explicit `saveCloneBody`)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: the UI allows 10 s for the read and 8 s for save against a 15 s server budget
  (`skill-synthesis-rpc.service.ts:88-107,710-737`).

### Task 21.1: UI timeout greater than 15 s plus margin; draft, then explicit save - COMPLETE

- Files: `SU/services/skill-synthesis-rpc.service.ts` + spec, `SU/components/clones/agent-models.store.ts`, `agent-model-editor.component.ts` + spec, `enhance-preview-drawer.component.ts`.
- Plan reference: plan row 19; implementation-plan.md:20, 61, 63.
- Pattern to follow: `agent-models.store.ts:144-172` (workspace ticket and stale guard).
- Quality requirements: test a delayed list, an unavailable list, save, and a workspace switch. Keep the
  old facade methods (trimmed in batch 58).
- Validation notes: none beyond the requirements above.
- Implementation details: none beyond the requirements above.

### Batch 21 verification - COMPLETE (917be31f2)

- Executor: CLI lane (report `reports/batch-21-report.md`, incl. fix round 1).
- Scope widened per O14 (same project and gate): `SU/components/clones/skill-clones-view.component.ts`
  + spec; new `enhance-preview-drawer.component.spec.ts` (fix round 1 moved the drawer cases out of
  the RPC service spec). 7 files committed.
- `agent-models.store.ts` and `agent-model-editor.component.ts` are unchanged (`git diff` empty): the
  lane found the existing workspace ticket + revision guard (`agent-models.store.ts:144-174`) and the
  editor's unavailable/refusal states already meet the requirements, and added regressions in
  `agent-model-editor.component.spec.ts` (unavailable list clears loading; stale workspace reply
  ignored).
- On disk: `SKILL_RPC_TIMEOUTS.AGENT_MODELS_MS: 20_000` (`skill-synthesis-rpc.service.ts:113`), used
  by `getAgentModels` and `setAgentModel` (`:718`, `:733`); 15 s server budget + 5 s margin. Drawer
  emits `save` with `{ body: draft.after, expectedSourceHash: draft.sourceHash }` only on explicit Save
  (`enhance-preview-drawer.component.ts:189,228`); parent checks the hash matches the open preview,
  calls `rpc.saveCloneBody(kind, slug, body, expectedSourceHash)` (`skill-clones-view.component.ts:813-825`),
  refreshes and closes on success, keeps the draft and shows the stale message on refusal. No drawer
  path calls `applyProposal`; the facade stays for batch 58. No TODO/stub/skip markers.
- Fix round 1: restored the unrelated `listCandidates({ status: 'pending' })` test call
  (`skill-synthesis-rpc.service.spec.ts:47`); the lane reported a TS2322 diagnostic on it, but the
  orchestrator-verified gate (typecheck included) passes, so it is recorded only. `listCandidates`
  itself is removed later with the RPC contraction (batch 59 / facade trim batch 58).
- Gate `nx run-many -t test typecheck lint -p @ptah-extension/skill-synthesis-ui --parallel=1` PASS
  after fix round 1 (orchestrator-verified).
- WRITE-PATH: (1) model editor -> `setAgentModel` (timeout only changed; key, payload and reader
  unchanged). (2) drawer Save -> parent -> `saveCloneBody` with `expectedSourceHash` -> backend hash
  guard (batch 10) -> clone body file; preview itself writes nothing. Stale refusal writes nothing.
- UI: agent model editor (slow/unavailable list) and enhance preview drawer (draft, Save, stale
  message) added to the Phase B visual list (Phase map row B).
- Batch 24 also edits `skill-clones-view.component.ts` + spec; it runs after 23, sequential, so no
  concurrent owner.
- Commit: 917be31f2 `refactor(skill-synthesis-ui): batch 21 - model timeout and draft save` (7 files).

## Batch 22: Rate reads switch to `skill_task_grades` - COMPLETE (e632e109d)

- Phase: B | Wave: B-W2 | Executor: CLI lane codex | Depends on: 5, 8 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: G1 finds `this.store` at handler `:1756` and `:2304-2305`.

### Task 22.1: `invocationStats` and `toCloneSummary` read grades - COMPLETE

- Files: `RH/handlers/skills-synthesis-rpc.handlers.ts` + spec, `SS/skill-scorecard.service.ts` + spec.
- Plan reference: plan row 20.
- Pattern to follow: none beyond the plan row.
- Quality requirements: NULL `successRate` when there are no grades. `total`/`succeeded`/`failed` count
  graded tasks, and `distinctContexts` stays telemetry.
- Validation notes: after the batch, these two methods have no candidate-store read.
- Implementation details: none beyond the requirements above.

### Batch 22 verification - COMPLETE (e632e109d)

- Executor: CLI lane codex; report `reports/batch-22-report.md`, incl. fix round 1.
- Scope widened per O12 (same project SS): `SS/skill-invocation-event.store.ts` + spec. 6 files total:
  `RH/handlers/skills-synthesis-rpc.handlers.ts` + spec, `SS/skill-scorecard.service.ts` + spec,
  `SS/skill-invocation-event.store.ts` + spec.
- On disk: read path `skill_task_grades` -> `SkillTaskGradeStore.getAggregates` ->
  `SkillScorecardService.getInvocationStats` -> RPC graded `total`/`succeeded`/`failed` and nullable
  `successRate`; telemetry `skill_invocation_events` -> `SkillInvocationEventStore.getUsageStats`
  (Zod `SkillUsageStatsRowSchema`) -> `distinctContexts` / clone `invocationCount`. Neither method reads
  the candidate store. No TODO/PLACEHOLDER/STUB in the diff. No DI edit needed (event store already a
  singleton at `SS/di/register.ts:79`).
- O12: with the optional scorecard absent, both methods degrade (zero graded counts, `successRate: null`)
  instead of throwing, so one missing service no longer fails the whole Library list.
- Gate `nx run-many -t test typecheck lint -p rpc-handlers skill-synthesis skill-synthesis-ui
  --parallel=1` PASS after fix round 1 (orchestrator-verified; not re-run here, RAM rule).
- Commit: e632e109d `refactor(skill-synthesis,rpc-handlers): batch 22 - rates read grades` (6 files).

## Batch 23: Formatter drops the `invocationCount` gate - IN_PROGRESS

- Phase: B | Executor: CLI lane Glm | Depends on: 22 | Tasks: 1
- Flags: UI
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: the `invocationCount <= 0` guard at `clone-action-gating.ts:241`.

### Task 23.1: Format from the graded value alone - IN_PROGRESS

- Files: `SU/components/clones/clone-action-gating.ts` + spec.
- Plan reference: plan row 21.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 24: Three-kind nullable grade display - PENDING

- Phase: B | Executor: CLI lane Glm | Depends on: 23 | Tasks: 1
- Flags: UI (Library Skills/Agents/Commands cards and drawer)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: the batch 22 producer and batch 23 formatter are done.

### Task 24.1: Cards, view and drawer show an honest use/grade per kind - PENDING

- Files: `SU/components/clones/skill-clones-view.component.ts` + spec, `clone-card.component.ts` + spec, `clone-detail-drawer.component.ts` + spec.
- Plan reference: plan row 22; preserve rows "Library tabs" and "Scorecard" (implementation-plan.md:47-48).
- Pattern to follow: none beyond the plan row and the preserve rows.
- Quality requirements: none beyond the plan row and the preserve rows.
- Validation notes: none beyond the plan row and the preserve rows.
- Implementation details: none beyond the plan row and the preserve rows.

**Phase B review due after batch 24: code-logic + visual.**

---

# Phase C - cut consumers

## Batch 25: Core Providers removes lanes/judging slices (R3) - PENDING

- Phase: C | Executor: CLI lane Glm | Depends on: 16, 17, 18 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/core @ptah-extension/chat --parallel=1`
- Precondition: chat no longer reads `lanes`/`judging` (the grep after batch 18 is zero).

### Task 25.1: Delete the lanes/judging slices, the `SkillLane*Dto` imports and the old judge/timeout keys from core - PENDING

- Files: `libs/frontend/core/src/lib/services/providers-settings.types.ts`, `providers-settings-state.service.ts` + spec, `providers-commit.service.ts` + spec.
- Plan reference: round-2 R3.
- Pattern to follow: none beyond the finding.
- Quality requirements: none beyond the finding.
- Validation notes: no `skillSynthesis:getLanes`/`setLanes` call remains. After the batch,
  `rg -n "SkillLane|judgeProvider|judgeModel|enhanceTimeoutMs|Lanes" libs/frontend/core` has zero live hits.
  Added after batch 17 (T12): the lane section ids at `providers-commit.service.ts:151-154` go with the
  lanes slice; the `PendingSettingsTab` union itself stays for Task 53.2 (e2e fixtures still use
  `judging-enhancement` until batches 51/52).
- Implementation details: none beyond the finding.

## Batch 26: Webview cuts the live push provider - PENDING

- Phase: C | Wave: C-W1 | Executor: CLI lane Glm | Depends on: 24 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p ptah-extension-webview @ptah-extension/skill-synthesis-ui --parallel=1`
- Precondition: G4 `thoth-message-routing.spec.ts:174`. `app.config.ts:82` imports the live service from `/services`.

### Task 26.1: Remove the MESSAGE_HANDLERS provider and its routing assertion - PENDING

- Files: `apps/ptah-extension-webview/src/app/app.config.ts`, `apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts`.
- Plan reference: plan row 23.
- Pattern to follow: none beyond the plan row.
- Quality requirements: the shared push constant stays until batch 64.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 27: Library becomes the sole view; `/services` entry fix (R6) - PENDING

- Phase: C | Executor: CLI lane Glm | Depends on: 19, 26 | Tasks: 1
- Flags: UI (Recommended/Sessions/Activity tabs removed), EXCEPTION (dead-import removal inside skill-synthesis-ui)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui @ptah-extension/thoth-shell @ptah-extension/dashboard --parallel=1`
- Precondition: G2 state `:463-581` and the parent still import orphan features. `src/services.ts:19`
  exports `SkillSynthesisLiveService`. The webview importer is cut (batch 26).

### Task 27.1: Cut the orphan tab imports and removed-RPC calls; drop the live export - PENDING

- Files: `SU/components/skill-synthesis-tab.component.ts` + spec, `SU/services/skill-synthesis-state.service.ts` + spec,
  `libs/frontend/skill-synthesis-ui/src/index.ts`, `libs/frontend/skill-synthesis-ui/src/services.ts`.
- Plan reference: plan row 24; round-2 R6.
- Pattern to follow: none beyond the plan row and the finding.
- Quality requirements: keep the Library, pause and the state methods they use. Keep the facade for
  the orphan files until batch 57.
- Validation notes: after the batch, `rg -n "SkillSynthesisLiveService" libs apps --glob '!SU/services/skill-synthesis-live.service*'`
  finds only the orphan SU files that batch 57 deletes.
  Carried from batch 19 (lane decision, plan line 119): this batch also removes the old synthesis
  settings form calls; after it, `rg -n "getSettings|updateSettings" SU/services/skill-synthesis-state.service.ts SU/components/skill-synthesis-tab.component.ts`
  has zero live hits (the pause/telemetry `settings:get`/`settings:set` helpers stay).
- Implementation details: none beyond the plan row and the finding.

## Batch 28: Thoth shell fixture - PENDING

- Phase: C | Executor: CLI lane Glm | Depends on: 27 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/thoth-shell --parallel=1`
- Precondition: the `refreshSuggestions` stub at `thoth-shell.component.spec.ts:94`.

### Task 28.1: Update the Library fixture - PENDING

- Files: `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts`.
- Plan reference: plan row 25.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 29: Core back-office activity drops the skill push branch - PENDING

- Phase: C | Executor: CLI lane Glm | Depends on: 25 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/core --parallel=1`
- Precondition: G13 `back-office-activity.service.ts:111,177`.

### Task 29.1: Remove the branch and its fixtures - PENDING

- Files: `libs/frontend/core/src/lib/services/back-office-activity.service.ts` + spec.
- Plan reference: plan row 26.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 30: CLI candidate commands - PENDING

- Phase: C | Wave: C-W1 | Executor: CLI lane codex | Depends on: none in C | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p ptah-cli --parallel=1`
- Precondition: G14 the CLI candidate commands and router exist.

### Task 30.1: Remove the commands, their specs and the e2e spec (never run e2e) - PENDING

- Files: `apps/ptah-cli/src/cli/commands/skill-synthesis.ts`, `skill-synthesis.spec.ts`, `skill-synthesis-extended.spec.ts` (delete), `apps/ptah-cli/src/cli/router.ts`, `apps/ptah-cli/tests/e2e/skill-synthesis.e2e.spec.ts` (delete).
- Plan reference: plan row 27.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 31: Electron IPC and CE host-profile exposure - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 30 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p ptah-electron @ptah-extension/cli-engine --parallel=1`
- Precondition: G14 the IPC host exposure lists obsolete methods.

### Task 31.1: Remove the dead method exposure - PENDING

- Files: `apps/ptah-electron/src/ipc/ipc-bridge.ts`, `apps/ptah-electron/src/ipc/rpc-host-profile.ts`, `CE/rpc/cli-host-profile.ts` + spec.
- Plan reference: plan row 28.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 32: vscode-core RPC comments - PENDING

- Phase: C | Wave: C-W1 | Executor: CLI lane codex | Depends on: none in C | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/vscode-core --parallel=1`
- Precondition: G6.

### Task 32.1: Remove the obsolete method comments and dispatch only; keep the namespace - PENDING

- Files: `libs/backend/vscode-core/src/messaging/rpc-handler.ts`.
- Plan reference: plan row 29.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 33: RH obsolete specs + lane-key parity block - PENDING

- Phase: C | Wave: C-W2 | Executor: CLI lane codex | Depends on: 22 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/rpc-handlers --parallel=1`
- Precondition: G7 `handlers.spec.ts:2192-2219`.

### Task 33.1: Delete the queue, digest and activity-feed specs; remove the parity block - PENDING

- Files: `RH/handlers/skills-synthesis-rpc.handlers.spec.ts`, `skills-synthesis-rpc.schema.spec.ts`, `skills-synthesis-rpc.queue.spec.ts` (delete), `skills-synthesis-rpc.digest.spec.ts` (delete), `skills-synthesis-rpc.activity-feed.integration.spec.ts` (delete), `RH/host-profile/host-profile.ts`.
- Plan reference: plan row 30.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: the handler methods still exist (until batch 59). Only these specs go.
- Implementation details: none beyond the plan row.

## Batch 34: RH settings-spec fixtures move to retained keys (R5) - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 33 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/rpc-handlers --parallel=1`
- Precondition: `settings-rpc.handlers.spec.ts:393,446` uses `skillSynthesis.replayValidation.minConfidence`
  and `judgePanel.disagreementThreshold`. `config-scope-rpc.handlers.spec.ts:243` uses `skillSynthesis.judgeModel`.

### Task 34.1: Keep the scope/validation coverage on keys that survive batch 65 - PENDING

- Files: `RH/handlers/settings-rpc.handlers.spec.ts`, `RH/handlers/config-scope-rpc.handlers.spec.ts`.
- Plan reference: round-2 R5.
- Pattern to follow: none beyond the finding.
- Quality requirements: the same behavior is asserted (bounds validation, scope override).
- Validation notes: choose a retained key with the same validator shape. If none exists, report it
  instead of deleting the assertion.
- Implementation details: none beyond the finding.

## Batch 35: Thoth runtime boot and cron cut - PENDING

- Phase: C | Wave: C-W2 | Executor: CLI lane codex | Depends on: 6, 13 | Tasks: 1
- Flags: EXCEPTION (7 files, consumer-only, one project)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/thoth-runtime --parallel=1`
- Precondition: G3. The tracker and harvester are present.

### Task 35.1: Remove the synthesis boot/scheduling callers; keep trigger, harvester and memory tracker - PENDING

- Files: `TH/boot-thoth-runtime.ts` + spec, `TH/types.ts`, `TH/memory-retention-job.ts` + spec, `TH/start-thoth-cron.ts` + spec.
- Plan reference: plan row 31.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: `memory-retention-job.spec.ts` covers the active and idle intervals.
- Implementation details: none beyond the plan row.

## Batch 36: CLI engine boot cut - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 31, 35 | Tasks: 1
- Flags: EXCEPTION (8 files, consumer-only, one project)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/cli-engine @ptah-extension/thoth-runtime --parallel=1`
- Precondition: G3. CE imports `SKILL_DRAIN_JOBS` and cleanup.

### Task 36.1: Remove the drain/cleanup/synthesis imports; keep repropagation and the root - PENDING

- Files: `CE/bootstrap/thoth-runtime.ts` + spec, `CE/bootstrap/thoth-runtime-edge.spec.ts`, `CE/thoth/register-thoth-libraries.ts` + spec, `CE/thoth/cli-skill-repropagation.ts` + spec, `CE/bootstrap/harness-boot.ts`.
- Plan reference: plan row 32.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 37: Thoth runtime pipeline job definitions - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 36 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine --parallel=1`
- Precondition: the CE caller (batch 36) and the TH cron (batch 35) are cut. `rg SKILL_DRAIN_JOBS|skill-drain-jobs apps` finds no importer.

### Task 37.1: Delete the four pipeline jobs and their exports; keep the memory jobs - PENDING

- Files: `TH/skill-drain-jobs.ts` (delete), `TH/skill-backlog-cleanup-job.ts` + spec (delete), `libs/backend/thoth-runtime/src/index.ts`.
- Plan reference: plan row 33.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 38: Electron activation cut - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 31, 36 | Tasks: 1
- Flags: EXCEPTION (10 files, consumer-only, one project)
- Verification: `npx nx run-many -t test typecheck -p ptah-electron --parallel=1`
- Precondition: G14. Electron still folds candidates (`plugin-activation.ts` reads `skill_candidates`).

### Task 38.1: Remove the pipeline imports and keepalive; keep the shipped root and repropagation - PENDING

- Files: `apps/ptah-electron/src/activation/plugin-activation.ts` + spec, `wire-runtime.ts` + spec, `boot-coordinator.ts`, `boot-order.spec.ts`, `apps/ptah-electron/src/main.ts`, `apps/ptah-electron/src/services/tray/tray.service.ts`, `skill-repropagation.ts` + spec (paths per plan row 34).
- Plan reference: plan row 34.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 39: Electron IPC window-availability spec - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 38 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p ptah-electron --parallel=1`
- Precondition: G13.

### Task 39.1: Remove the skill push fixture - PENDING

- Files: `apps/ptah-electron/src/ipc/ipc-bridge.window-availability.spec.ts`.
- Plan reference: plan row 35.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 40: VS Code DI + manifest-relative surface specs - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 32 | Tasks: 1
- Flags: EXCEPTION (consumer-only, one project)
- Verification: `npx nx run-many -t test typecheck -p ptah-extension-vscode --parallel=1`
- Precondition: G6 `VSCODE_EXPECTED_ABSENT_METHODS:120-128`. `rpc-surface.spec.ts:211-212` asserts
  `registered + excluded === RPC_METHOD_NAMES.length`.

### Task 40.1: Remove the pipeline DI expectations; make the absent list intersect the live METHODS - PENDING

- Files: `apps/ptah-extension-vscode/src/activation/plugin-activation.ts` + spec, `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`.
- Plan reference: plan row 36; round-2 R1 (the spec part only).
- Pattern to follow: none beyond the plan row.
- Quality requirements: passes both before and after the batch 59 contraction.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 41: Electron DI + manifest-relative surface specs - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 39 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p ptah-electron --parallel=1`
- Precondition: G6/G8.

### Task 41.1: Same as Task 40.1, for Electron; keep the Library registration - PENDING

- Files: `apps/ptah-electron/src/di/phase-2-libraries.ts`, `expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`.
- Plan reference: plan row 37.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 42: CLI engine / CLI DI + manifest-relative surface specs - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 30, 37 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/cli-engine ptah-cli --parallel=1`
- Precondition: G6/G8. The router was already edited in batch 30.

### Task 42.1: Same as Task 40.1, for the CLI - PENDING

- Files: `CE/container.ts`, `CE/surface-composition.spec.ts`, `CE/rpc/rpc-surface.spec.ts`, `apps/ptah-cli/src/di/container.smoke.spec.ts`, `apps/ptah-cli/src/cli/router.ts`.
- Plan reference: plan row 38.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 43: RH handler retained-method rework, `METHODS` unchanged (R1 split) - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 10, 22, 34 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/rpc-handlers --parallel=1`
- Precondition: G1 the retained `this.synthesis.readSettings` (`:1169` if still present) and the
  `SKILL_SYNTHESIS_EVENT` push (`:800`). `METHODS` still lists every registry name.

### Task 43.1: Retained methods use only the grade/settings/registry ports; remove the push - PENDING

- Files: `RH/handlers/skills-synthesis-rpc.handlers.ts` + spec.
- Plan reference: plan row 39 (retained-method part only); round-2 R1.
- Pattern to follow: none beyond the plan row and the finding.
- Quality requirements: do NOT shrink `METHODS`, remove obsolete method bodies or change the constructor
  injections that obsolete methods use. That is batch 59. The host boot invariant
  (`assertManifestInvariants`) stays green.
- Validation notes: no retained method reads the candidate store, the synthesis service or the queue store.
- Implementation details: none beyond the plan row and the finding.

## Batch 44: Skill-synthesis trigger, catalog and enhancer cut - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 4, 9, 10, 35 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis --parallel=1`
- Precondition: G10.

### Task 44.1: Remove the candidate/enqueue/auto-apply calls; keep telemetry, harvest and manual generation - PENDING

- Files: `SS/triggers/skill-trigger.service.ts` + spec, `SS/skill-registry-catalog.service.ts` + spec, `SS/skill-enhancer.service.ts` + spec.
- Plan reference: plan row 40; implementation-plan.md:15.
- Pattern to follow: none beyond the plan row.
- Quality requirements: no boot scan, idle hook or analysis enqueue remains.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

### Task 44.2: Phase A review carry-overs (harvest and grade store) - PENDING

- Files: `SS/spec-extractor.ts` + spec, `SS/spec-harvester.service.ts` + spec,
  `SS/skill-task-grade.store.ts` + spec.
- Source: Phase A review deferrals (St-M2, `code-logic-review-round-2.md` M1 and M2,
  `code-logic-review-round-3.md` N1).
- Quality requirements: (1) N1: `spec-extractor.ts:109` captures every word after the verdict, so
  `Recommendation: APPROVE with minor changes` parses to null; capture the first token plus an optional
  `revision` word (or try shorter prefixes) and add a spec for that line. (2) St-M2: move attribution
  grouping out of `SkillTaskGradeStore` into a pure function. (3) M1: bound the retry of a persistently
  failing grade write (retry count or once-per-session warn). (4) M2: when every attribution is skipped,
  prune the stale grade per key or record the accepted behaviour in a comment and spec.
- Validation notes: file cap - 44.1 already owns 6 files, so run 44.2 as its own lane after 44.1 with the
  same verification command.

## Batch 45: mcp-bench namer/trigger family deletion (R4) - PENDING

- Phase: C | Wave: C-W3 | Executor: CLI lane codex | Depends on: none in C | Tasks: 1
- Flags: EXCEPTION (deletion + dead-import removal, mcp-bench only)
- Verification: `npx nx run-many -t test typecheck -p mcp-bench --parallel=1`
- Precondition: G5. The importers are verified: `host-only-imports.spec.ts:40-41`,
  `ground-truth/committed-u4-labels.spec.ts:15-18,37` and `host/memory-skills-host.entry.ts:50,68`.

### Task 45.1: Delete the trigger-eval and namer suites with every importer - PENDING

- Files: delete `MB/suites/skills/trigger-human-eval.ts`, `namer-and-trigger.suite.ts`, `namer-and-trigger.suite.spec.ts` and `namer-collisions.ts`. Edit `MB/host/memory-skills-host.entry.ts` and `MB/host-only-imports.spec.ts`. Edit or delete `MB/ground-truth/committed-u4-labels.spec.ts`; `MB/ground-truth/label-schemas.ts:481` is comment-only.
- Plan reference: plan row 41; D2; round-2 R4.
- Pattern to follow: none beyond the plan row and the finding.
- Quality requirements: if `committed-u4-labels.spec.ts` tests only trigger labels, delete it. Otherwise
  move `triggerLabelSchema`/`TRIGGER_EVAL_PANEL` into `ground-truth/label-schemas.ts`. Report which.
- Validation notes: after the batch, `rg -n "trigger-human-eval|namer-and-trigger|namer-collisions|TRIGGER_EVAL_PANEL|NAMER_AND_TRIGGER" tools/mcp-bench` has zero live hits.
- Implementation details: none beyond the plan row and the finding.

## Batch 46: mcp-bench funnel and judge-agreement family deletion (R4) - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 45 | Tasks: 1
- Flags: EXCEPTION (deletion + dead-import removal, mcp-bench only)
- Verification: `npx nx run-many -t test typecheck -p mcp-bench --parallel=1`
- Precondition: the funnel family drives production DI (`funnel-lifecycle.spec.ts:62`,
  `funnel-host-graph.ts:394-454`). The judge suite measures `SkillJudgeService`. `judge-lane-tap.ts` and
  `judge-corpus.ts` are imported only by `judge-agreement*`.

### Task 46.1: Delete the funnel and judge-agreement suites with their helpers and importers; keep the lane doubles - PENDING

- Files: delete these in `MB/suites/skills/`: `funnel.suite.ts` + spec, `funnel-backlog.ts`,
  `funnel-di.test-support.ts`, `funnel-fixture.ts`, `funnel-host-graph.ts`, `funnel-host-port.ts`,
  `funnel-lifecycle.ts` + spec, `funnel-port.ts`, `funnel-report.ts`, `funnel-stages.ts`,
  `judge-agreement.suite.ts` + spec, `judge-agreement-ports.ts`, `judge-corpus.ts`, `judge-lane-tap.ts`.
  Edit: `MB/host/memory-skills-host.entry.ts`, `MB/runner/runner-plan.ts` (+ `runner-plan.spec.ts` if it
  references funnel), `MB/host/plan.schema.ts`, `MB/host/suite-placement.ts` + spec, and
  `MB/host-only-imports.spec.ts`. Edit `MB/memory-skills-suite-kinds.ts` + spec only if the `funnel`
  kind has no remaining producer (see batch 47).
- Plan reference: plan rows 42-43 (funnel and judge parts become deletion under D2); round-2 R4.
- Pattern to follow: none beyond the plan rows and the finding.
- Quality requirements: keep `MB/doubles/recorded-lane-runner.ts` + spec, `MB/host/doubles-override.ts` +
  spec, `suites/memory/merge-update.test-support.ts` and the rubric-agreement family. They depend on
  `LaneRunnerService`/`LANE_RUNNER_SERVICE`, which stay (see Assumptions).
- Validation notes: after the batch, `rg -n "funnel|judge-agreement|judge-corpus|judge-lane-tap|registerSkillSynthesisServices|SkillJudgeService|SkillMdGenerator" tools/mcp-bench/src` has no live hit, except the comment-only `rubric-ground-truth.ts:8` (update the comment) and the snapshot-audits funnel kind owned by batch 47.
- Implementation details: none beyond the plan rows and the finding.

## Batch 47: mcp-bench snapshot audits and candidate diff use archive fixtures - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 15, 46 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p mcp-bench --parallel=1`
- Precondition: G12 has live candidate SQL in `snapshot-audits.suite.ts`(+spec) and `data/candidate-row-diff.ts`(+spec). The archive format is from batch 15.

### Task 47.1: Repoint the surviving historical comparisons - PENDING

- Files: `MB/suites/audits/snapshot-audits.suite.ts` + spec, `MB/data/candidate-row-diff.ts` + spec, plus `MB/memory-skills-suite-kinds.ts` + spec IF the `funnel` kind (`:212,632`; audit `:725`) is retired here.
- Plan reference: plan row 42.
- Pattern to follow: none beyond the plan row.
- Quality requirements: no live SQL against the tables that 0057 drops.
- Validation notes: if the `funnel` audit has no purpose without the funnel suites, remove it and the
  kind. State the decision.
- Implementation details: none beyond the plan row.

## Batch 48: mcp-bench rubric sampler - PENDING

- Phase: C | Executor: CLI lane codex | Depends on: 47 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p mcp-bench --parallel=1`
- Precondition: G12 the sampler queries candidates and holds the approved promoted slug.

### Task 48.1: Fix the path, remove the promoted slug, repoint to the archive fixture - PENDING

- Files: `MB/labelling/select-rubric-sample.ts` (+ `select-rubric-sample.spec.ts` if affected).
- Plan reference: plan row 44.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 49: Stop the bulk-seed snapshots - PENDING

- Phase: C | Wave: C-W2 | Executor: CLI lane codex | Depends on: none in C | Tasks: 1
- Flags: WRITE-PATH (`~/.ptah/user/**/.history/` snapshot writes stop on the seed/fast-forward path)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/agent-generation --parallel=1`
- Precondition: the mirror snapshots unchanged clones on fast-forward (`user-layer-mirror.service.ts:1459-1468,1520-1529`).

### Task 49.1: Snapshot only edits, rebase, restore and revert - PENDING

- Files: `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` + spec, `user-layer-fs-ops.ts`, `user-layer-enhance.spec.ts`.
- Plan reference: plan row 45 (snapshot part ONLY; the promoted-slug retirement is batch 70); implementation-plan.md:23.
- Pattern to follow: none beyond the plan row.
- Quality requirements: a regression test for seed snapshot growth. The user-edit and revert paths are unchanged.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 50: Snapshot prune + archive dry-run scripts - PENDING

- Phase: C | Wave: C-W3 | Executor: CLI lane codex | Depends on: 15, 49 | Tasks: 1
- Flags: WRITE-PATH (prune deletes history files only in apply mode; the archive dry-run writes an archive to a temp path from a DB copy)
- Verification: `npx jest -c scripts/jest.config.ts scripts/prune-skill-history.spec.ts scripts/export-skill-pipeline-archive.spec.ts --coverage=false --maxWorkers=2`
- Precondition: the provenance guard (batch 49) and the archive function (batch 15) exist.

### Task 50.1: Prune with a dry-run manifest; archive dry-run for OP-1 - PENDING

- Files: `scripts/prune-skill-history.ts` + spec, `scripts/export-skill-pipeline-archive.ts` (new) + spec.
- Plan reference: plan row 46; implementation-plan.md:124-129; context.md 2026-10-18 decision 3.
- Pattern to follow: `scripts/drain-observation-queue.ts` (script + spec shape).
- Quality requirements: prune dry-run emits a path/hash manifest. Apply refuses a missing receipt or an
  unknown or changed hash, and keeps user edits. The export script copies the DB first and never opens
  the live DB for writing. It prints a receipt: table list, row counts, sha256 and archive path. Archive
  files are owner-only.
- Validation notes: the archive dry-run is the evidence the user confirms at OP-1.
- Implementation details: none beyond the requirements above.

## Batch 51: Webview e2e harness fixtures (typecheck only) - PENDING

- Phase: C | Wave: C-W3 | Executor: CLI lane Glm | Depends on: 25 | Tasks: 1
- Flags: EXCEPTION (fixture-only removal, one project)
- Verification: `npx nx run-many -t typecheck -p @ptah-extension/webview-e2e-harness --parallel=1`
- Precondition: G9. The lane pickers and `skillSynthesis:listCandidates` strings are present.

### Task 51.1: Remove the deleted-tab and lane fixtures; never run e2e - PENDING

- Files: `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/{skills-lane-pickers,thoth-feed-visual,activity-ticker}.e2e.spec.ts`, `scenarios/settings/{settings.fixtures.ts,settings-orchestration.e2e.spec.ts,settings-reachability.table.ts}`.
- Plan reference: plan row 48.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 52: Electron e2e fixtures (typecheck only) - PENDING

- Phase: C | Wave: C-W4 | Executor: CLI lane Glm | Depends on: 38 | Tasks: 1
- Verification: `npx nx run-many -t typecheck -p ptah-electron-e2e --parallel=1`
- Precondition: G9.

### Task 52.1: Remove the pipeline fixtures; never run e2e - PENDING

- Files: `apps/ptah-electron-e2e/src/specs/thoth/{skills,skill-telemetry,message-handlers-eager}.spec.ts`, `dashboard/dashboard.spec.ts`, `support/{fixtures,skill-telemetry-db}.ts`.
- Plan reference: plan row 49.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 53: Tray home + TUI lifecycle fixtures - PENDING

- Phase: C | Executor: CLI lane Glm | Depends on: 52 (Task 53.2 also 18, 25, 51) | Tasks: 2
- Verification: `npx nx run-many -t typecheck -p ptah-electron-e2e ptah-tui @ptah-extension/core --parallel=1` (core added for Task 53.2)
- Precondition: G9.

### Task 53.1: Remove the pipeline paths - PENDING

- Files: `apps/ptah-electron-e2e/src/specs/support/tray-home.ts`, `apps/ptah-tui/src/lib/thoth-lifecycle.spec.ts`.
- Plan reference: plan row 50.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

### Task 53.2: Remove the legacy `PendingSettingsTab` section ids (carry-over from batch 17, T12) - PENDING

- Depends on: batches 18, 25, 51, 52 (their last users go there).
- File: `libs/frontend/core/src/lib/services/app-state.service.ts` (`PendingSettingsTab.section`, `:127-143`).
- Plan reference: decisions O13a; batch 17 verification.
- Quality requirements: remove `judging-enhancement`, `archaeologist`, `synthesis`, `judge`, `replay`
  from the union; keep `enhancement`.
- Validation notes: before the edit, `rg -n "judging-enhancement|'archaeologist'|'synthesis'|'judge'" libs/frontend apps/ptah-electron-e2e`
  has no hit that types against `PendingSettingsTab` (unrelated `'replay'` uses in `libs/web/members`
  and `libs/api/community` are a different union). Gate for this batch adds core typecheck:
  `npx nx run-many -t typecheck -p ptah-electron-e2e ptah-tui @ptah-extension/core --parallel=1`.
- Implementation details: union member deletion only.

## Batch 54: Docs - Library and success rewrite - PENDING

- Phase: C | Wave: C-W4 | Executor: CLI lane Glm | Depends on: 24 | Tasks: 1
- Verification: `npx prettier --check apps/ptah-docs/src/content/docs/skill-synthesis apps/ptah-docs/astro.config.mjs`
- Precondition: G9.

### Task 54.1: Rewrite the docs to the kept behavior only - PENDING

- Files: `apps/ptah-docs/src/content/docs/skill-synthesis/{index,how-it-works,background-learning,reviewing-candidates}.md*`.
- Plan reference: plan row 51.
- Pattern to follow: none beyond the plan row.
- Quality requirements: every claim traces to kept code. Success is graded from task reviews, and ungraded shows "No grade".
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 55: Docs - settings, Skills tab, anatomy, navigation - PENDING

- Phase: C | Executor: CLI lane Glm | Depends on: 54 | Tasks: 1
- Verification: `npx prettier --check apps/ptah-docs/src/content/docs/skill-synthesis apps/ptah-docs/astro.config.mjs`
- Precondition: G9.

### Task 55.1: Navigation and settings rewrite - PENDING

- Files: `apps/ptah-docs/src/content/docs/skill-synthesis/{settings,the-skills-tab,skill-md-anatomy}.md*`, `apps/ptah-docs/astro.config.mjs`.
- Plan reference: plan row 52.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 56: Docs - skills, file locations, index - PENDING

- Phase: C | Executor: CLI lane Glm | Depends on: 55 | Tasks: 1
- Verification: `npx prettier --check apps/ptah-docs/src/content/docs/mcp-and-skills/skills.md apps/ptah-docs/src/content/docs/reference/file-locations.md apps/ptah-docs/src/content/docs/index.mdx`
- Precondition: G9.

### Task 56.1: Archive and location rewrite - PENDING

- Files: `apps/ptah-docs/src/content/docs/mcp-and-skills/skills.md`, `reference/file-locations.md`, `index.mdx`.
- Plan reference: plan row 53.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

**Phase C review due after batch 56: code-logic + visual.**

---

# Phase D - delete pipeline source and contract the RPC surface

Order change versus the plan (R1): the frontend deletion and the facade trim come first, then the atomic
RPC contract batch, then the SS register cut and the SS deletion. The handler must stop injecting the
pipeline tokens (batch 59) before SS registrations are removed (batch 60).

## Batch 57: SU obsolete subtree deletion - PENDING

- Phase: D | Executor: CLI lane Glm | Depends on: 27, 28, 51 | Tasks: 1
- Flags: UI (Library is the only view), EXCEPTION (deletion-only, SU/lib)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui @ptah-extension/thoth-shell ptah-extension-webview @ptah-extension/dashboard --parallel=1`
- Precondition: before deleting, `rg` over apps/libs/tools finds no importer of the selected files outside the selected set (R6 fixed in batch 27).

### Task 57.1: Delete the diagnostics, suggestions and pipeline components, the live/diagnostics services and their specs - PENDING

- Files: the manifest per plan row 56. It includes `SU/services/skill-synthesis-live.service.ts` + spec,
  `skill-diagnostics-rpc.service*`, `components/skill-settings-panel.component*`,
  `components/skill-pipeline-status.component*`, and the Recommended/Sessions/Activity components.
  The executor lists the exact manifest in the report.
- Plan reference: plan row 56.
- Pattern to follow: none beyond the plan row.
- Quality requirements: keep the Library components, state, RPC facade, scorecards and pause switch.
- Validation notes: no other file is edited.
- Implementation details: none beyond the plan row.

## Batch 58: SU facade trim (R5 gate) - PENDING

- Phase: D | Executor: CLI lane Glm | Depends on: 19, 57 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui @ptah-extension/dashboard --parallel=1`
- Precondition: the dashboard no longer calls `listCandidates`/`getSettings` (batch 19). The orphan callers are deleted (batch 57).

### Task 58.1: Remove the obsolete facade methods; shared RPC types still exist - PENDING

- Files: `SU/services/skill-synthesis-rpc.service.ts` + spec.
- Plan reference: plan row 57; round-2 R5.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: `rg -n "skillSynthesis:(listCandidates|getCandidate|promote|reject|invocations|stats|getSettings|updateSettings|pin|unpin|runCurator|diagnostics|analyzeNow|setTriggers|getTriggers|setLanes|getLanes|listSuggestions|acceptSuggestion|dismissSuggestion|getSuggestion|updateSuggestion|rejectBulk|promoteBulk|rejectByPattern|queue|digest|enhanceNow|applyProposal)'" libs/frontend apps` finds zero live hits.
- Implementation details: none beyond the plan row.

## Batch 59: Atomic RPC contract contraction (R1) - PENDING

- Phase: D | Executor: CLI lane codex | Depends on: 33, 40, 41, 42, 43, 58 | Tasks: 1
- Flags: heavy gate (10 projects); no other check may run concurrently
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui @ptah-extension/dashboard @ptah-extension/core @ptah-extension/chat ptah-extension-vscode ptah-electron @ptah-extension/cli-engine ptah-cli --parallel=1`
- Precondition: the host surface specs are manifest-relative (40-42). Retained methods are reworked (43).
  The frontend facade is trimmed (58). `rg` for the removal-set names in `libs/frontend apps` is zero.

### Task 59.1: Remove the obsolete methods from the handler, the registry, the baseline and the schema in one commit - PENDING

- Files: `RH/handlers/skills-synthesis-rpc.handlers.ts` + spec, `RH/handlers/skills-synthesis-rpc.schema.ts` + spec, `libs/shared/src/lib/types/rpc.types.ts`, `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`.
- Plan reference: plan rows 39 (obsolete part) and 59; RPC removal set (implementation-plan.md:59); round-2 R1.
- Pattern to follow: none beyond the plan rows and the finding.
- Quality requirements: remove the obsolete `METHODS`, bodies, imports and constructor injections
  (`SKILL_CANDIDATE_STORE`, `SKILL_SYNTHESIS_SERVICE`, `SKILL_QUEUE_STORE`, `SKILL_BUDGET_STORE`), the
  `RPC_METHOD_ENTRIES`/method-map entries, the baseline names and the schema entries, all together.
  Keep the `skillSynthesis:` prefix and the clone, history, quarantine, agent-model, task-spec,
  scorecard and preview methods. `applyProposal` goes only if explicit save is the sole apply path
  (batch 10).
- Validation notes: `rpc-allowlist.spec.ts:42` (`assertManifestInvariants(RPC_METHOD_NAMES)`) passes in
  the RH tests. Each host `rpc-surface.spec.ts` passes. `host-source-registry.contract.spec.ts` (shared)
  passes.
- Implementation details: 6 files across 2 projects. This is the minimum atomic set: splitting it
  re-creates the R1 boot throw.

## Batch 60: SS register/index prelude - PENDING

- Phase: D | Executor: CLI lane codex | Depends on: 44, 46, 59 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime ptah-extension-vscode ptah-electron ptah-cli mcp-bench --parallel=1`
- Precondition: G1/G3/G5/G8 the external importers are cut in C and D (59).

### Task 60.1: Remove the pipeline registrations and public exports; do NOT trim `di/tokens.ts` - PENDING

- Files: `SS/di/register.ts` + spec, `libs/backend/skill-synthesis/src/index.ts`, `SS/skill-scorecard.service.ts` + spec.
- Plan reference: plan row 54.
- Pattern to follow: none beyond the plan row.
- Quality requirements: keep the registrations for the event and grade stores, verdict store, enhancer,
  catalog, registry, scorecard, harvester, trigger, foreground tracker, SKILL.md migration,
  repropagation and lane runner (Assumptions).
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 61: SS pipeline subtree deletion - PENDING

- Phase: D | Executor: CLI lane codex | Depends on: 60 | Tasks: 1
- Flags: EXCEPTION (deletion-only, SS/lib)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime mcp-bench --parallel=1`
- Precondition: before deleting, `rg` over apps/libs/tools finds no external importer of the selected files.

### Task 61.1: Delete the approved pipeline-only files and their specs - PENDING

- Files: the manifest per plan row 55 and the subtree classification (implementation-plan.md:81-91):
  prefilter, archaeology writer (not `session-verdict.store`/`.types`), synthesis, judge, judge panel,
  replay, trigger eval, curator, queue (not `foreground-activity.tracker`), gates, digest, cleanup,
  lifecycle, eligibility, the candidate and suggestion stores, promotion, `SkillInvocationTracker`,
  `skill-md-generator.ts` and `diagnostics.service`. The executor lists the exact manifest.
- Plan reference: plan row 55.
- Pattern to follow: none beyond the plan row.
- Quality requirements: keep `lanes/lane-runner.service.ts`, `lane-resolver.service.ts`,
  `lane-auth-resolver.port.ts`, `lane.types.ts`, `lane-json.ts` (if the enhancer uses it) and
  `provider-network-backoffs.ts`. Keep `skill-lane-config.ts` only if a kept file imports it. Also keep
  the foreground tracker, verdict read store, event and grade stores, SKILL.md migration and state,
  trajectory extractor, outcome seam, spec harvester and extractor, and model-resolver.
- Validation notes: tokens stay through this batch.
- Implementation details: none beyond the plan row.

**Phase D review due after batch 61: code-logic + visual.**

---

# Phase E - remove shared contracts

## Batch 62: SS token trim - PENDING

- Phase: E | Executor: CLI lane codex | Depends on: 61 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime ptah-extension-vscode ptah-electron ptah-cli mcp-bench --parallel=1`
- Precondition: G10 the doomed users were deleted in batch 61.

### Task 62.1: Remove the doomed tokens; keep `FOREGROUND_ACTIVITY_TRACKER`, `LANE_RUNNER_SERVICE`, repropagation, `USER_LAYER_MIRROR_SERVICE_TOKEN` and the SKILL.md migration tokens - PENDING

- Files: `SS/di/tokens.ts`, `SS/di/register.ts` + spec, `libs/backend/skill-synthesis/src/index.ts`.
- Plan reference: plan row 58.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: after the batch, the removed token names have zero hits outside the immutable migrations.
- Implementation details: none beyond the plan row.

## Batch 63: Shared skill-pipeline DTO cleanup (R3) - PENDING

- Phase: E | Executor: CLI lane codex | Depends on: 25, 59 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/shared @ptah-extension/core @ptah-extension/chat @ptah-extension/skill-synthesis-ui @ptah-extension/rpc-handlers --parallel=1`
- Precondition: `rg -n "SkillLane(Id|Tier|s)?Dto" libs apps tools` finds only `rpc-curator-diagnostics.types.ts`.

### Task 63.1: Remove `SkillLane*Dto` and other pipeline-only DTOs with zero importers - PENDING

- Files: `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` (+ its spec if it exists), `libs/shared/src/index.ts` (only if it re-exports removed names).
- Plan reference: round-2 R3; removal map.
- Pattern to follow: none beyond the finding.
- Quality requirements: keep the memory-curator diagnostics DTOs in the same file.
- Validation notes: the shared-contract rule applies.
- Implementation details: none beyond the finding.

## Batch 64: Remove `SKILL_SYNTHESIS_EVENT` - PENDING

- Phase: E | Executor: CLI lane codex | Depends on: 26, 29, 39, 43, 57, 61 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/shared ptah-extension-webview @ptah-extension/core ptah-electron @ptah-extension/skill-synthesis-ui @ptah-extension/rpc-handlers --parallel=1`
- Precondition: G4/G13 all push consumers are gone. `rpc-curator-diagnostics.types.ts:52` is a comment.

### Task 64.1: Remove the push constant and payload - PENDING

- Files: `libs/shared/src/lib/types/messages/message-constants.ts`, `libs/shared/src/lib/types/messages/payload-map.ts`.
- Plan reference: plan row 60.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 65: Remove 79 old settings keys (R5) - PENDING

- Phase: E | Executor: CLI lane codex | Depends on: 2, 9, 18, 25, 33, 34 | Tasks: 1
- Flags: UI (Advanced settings rows removed), WRITE-PATH (old stored values become unread; trace that no reader remains)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/chat @ptah-extension/core --parallel=1`
- Precondition: G11 the new reader and migration are active. G7 is removed (batch 33). The RH settings
  specs moved (batch 34). The chat advanced spec moved (batch 18). Core is cut (batch 25).

### Task 65.1: Remove 32 lane keys + 47 explicit keys; keep `skillSynthesis.enabled` and `skillSynthesis.skillsRoot` - PENDING

- Files: `PC/file-settings-keys.ts` + spec, `libs/shared/src/lib/types/advanced-settings.types.ts` + spec, `libs/shared/src/lib/types/rpc/rpc-auth.types.ts` (per-key scope metadata `:482-522`).
- Plan reference: plan row 61; settings inventory (implementation-plan.md:61-79); round-2 R5.
- Pattern to follow: none beyond the plan row and the finding.
- Quality requirements: exactly 79 removed, counted in the report.
- Validation notes: `rg -n "skillSynthesis\.(?!enabled|skillsRoot)" libs apps --pcre2` has live hits only
  in immutable migrations, docs, and the memory-curator comments (`memory-retention-config.ts:103`,
  `memory-trigger-config.ts:88`).
- Implementation details: none beyond the plan row and the finding.

### Task 65.2: Phase A review carry-over St-M3 - PENDING

- Files: `PC/file-settings-keys.ts`, `PC/file-settings-manager.ts` + spec.
- Source: `code-style-review.md` St-M3 (deferred at the Phase A fix round).
- Quality requirements: `SKILL_SETTINGS_MIGRATIONS` moves to `file-settings-keys.ts`, beside the keys
  it maps; the manager imports it. Behaviour unchanged. Do it in the same edit as 65.1 so the
  migration map and the removed keys stay consistent.

## Batch 66: Remove the drain constants - PENDING

- Phase: E | Executor: CLI lane codex | Depends on: 37, 59 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/shared @ptah-extension/thoth-runtime @ptah-extension/cli-engine --parallel=1`
- Precondition: G3 the drain users are gone. The `SkillDrainTier` use was removed in batch 59.

### Task 66.1: Delete `skill-drain.constants.ts` + spec; update the shared index - PENDING

- Files: `libs/shared/src/lib/constants/skill-drain.constants.ts` + spec (delete), `libs/shared/src/index.ts`.
- Plan reference: plan row 62.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

**Phase E review due after batch 66: code-logic + visual.**

---

# Phase F - data step (needs user confirmation of the archive before drop)

This stage is irreversible for the user's data. Approval was given on 2026-10-18 (context.md decision 3,
D3), but the user must see and confirm the archive before the drop. Do not commit batch 68 (registering
0057) until OP-1 is confirmed.

## Batch 67: Archive path, receipt and connection wiring (0057 not registered) - PENDING

- Phase: F | Executor: CLI lane codex | Depends on: 15, 47, 48, 61 | Tasks: 1
- Flags: WRITE-PATH (archive file location, receipt)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite --parallel=1`
- Precondition: G12 no live SQL readers of the doomed tables outside the doomed SS files (deleted in 61)
  and the immutable migrations.

### Task 67.1: Wire the archive into the connection service and db path - PENDING

- Files: `PS/skill-pipeline-archive.ts` + spec, `PS/sqlite-connection.service.ts` + spec, `PS/db-path.ts` + spec.
- Plan reference: plan row 63 (non-registration part); round-2 N5.
- Pattern to follow: none beyond the plan row.
- Quality requirements: the archive sits next to the DB, owner-only. The receipt carries the table list,
  row counts and sha256.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

### Task 67.2: Phase A review carry-over L-M9 - PENDING

- Files: `PS/skill-pipeline-archive.ts` + spec (same files as 67.1).
- Source: `code-logic-review.md` L-M9 (deferred at the Phase A fix round).
- Quality requirements: `0700`/`0600` modes are not enforced on Windows - restrict access there (ACL or a
  documented user-profile location) and say which; bound the accumulation of `pre-0057-*` archive
  directories across repeated preflights (reuse a verified archive or prune older unverified ones).

## OP-1: Archive dry-run and user confirmation (orchestrator, no lane, no code)

- Copy the user's Ptah DB to a temp path. Run the batch 50 export script against the copy, never against
  the live DB. Present the receipt to the user: the exact table list (`skill_candidates`,
  `skill_suggestions`, `skill_synthesis_queue`, `skill_synthesis_budget`, `skill_invocations`,
  `skill_synthesis_workspace_cursor`, `skill_candidates_vec`, and `job_runs` rows for the four pipeline
  job IDs), row counts, sha256 and the archive path.
- **Needs user confirmation of the archive before drop.** Batch 68 is not committed until the user confirms.

## Batch 68: Register 0057 drop + ratchet pins (R2, N5) - PENDING

- Phase: F | Executor: CLI lane codex | Depends on: 67, OP-1 confirmed | Tasks: 1
- Flags: WRITE-PATH (drops tables at next boot after the fatal verified archive), EXCEPTION (mechanical spec-pin bump, 16 specs, one project)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite mcp-bench --parallel=1`
- Precondition: OP-1 is confirmed. `rg -n "toBe\(56\)" PS/migrations` lists the 16 pins.

### Task 68.1: 0057 last; fatal archive first; FK-safe drop - PENDING

- Files: `PS/migrations/0057_drop_skill_pipeline.ts` (new) + spec, `PS/migrations/index.ts`, ratchet pins 56 -> 57 in the 15 specs from batch 1 plus `0056_skill_nullable_grades.spec.ts`.
- Plan reference: plan row 63; implementation-plan.md:124-129; round-2 R2, N5.
- Pattern to follow: none beyond the plan row.
- Quality requirements: drop the six relational tables, `skill_candidates_vec` via 0057 `vecSql`, and
  only the four pipeline job IDs' `job_runs`/cron rows. The spec covers these cases:
  - a failure leaves version 56 and every table intact;
  - vec exists but cannot load, so the migration does not begin;
  - an absent vec table defers the empty cleanup;
  - unrelated cron history is preserved.
- Validation notes: after the batch, the dropped tables have zero live SQL readers.
- Implementation details: none beyond the plan row.

## Batch 69: Runner vec-order spec + embedder comment - PENDING

- Phase: F | Executor: CLI lane codex | Depends on: 68 | Tasks: 1
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite --parallel=1`
- Precondition: G15 `embedder.interface.ts:6`.

### Task 69.1: Older pending vec catch-up, then archive, then drop; comment names only the memory curator - PENDING

- Files: `PS/migration-runner.spec.ts`, `PS/embedder/embedder.interface.ts`.
- Plan reference: plan row 64.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 70: User-layer promoted-skill retirement - PENDING

- Phase: F | Executor: CLI lane codex | Depends on: 49 | Tasks: 1
- Flags: WRITE-PATH (one-time removal of two managed slugs from `~/.ptah/user/skills`)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/agent-generation --parallel=1`
- Precondition: the batch 49 provenance guard exists.

### Task 70.1: Origin- and hash-checked retirement of `execute-phase-gated-task` and `extract-and-relocate-angular-component-feature` - PENDING

- Files: `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` + spec, `user-layer-fs-ops.ts`.
- Plan reference: plan row 45 (retirement part); context.md 2026-10-18 decision 2.
- Pattern to follow: none beyond the plan row.
- Quality requirements: a user-modified copy is preserved and reported. The removal is idempotent.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## Batch 71: Repo promoted skills + prompt suggestion - PENDING

- Phase: F | Executor: CLI lane Glm | Depends on: 48, 70 | Tasks: 1
- Flags: UI (setup-plugins prompt suggestions)
- Verification: `npx nx run-many -t test typecheck -p @ptah-extension/chat-ui --parallel=1`
- Precondition: G9 `prompt-suggestions.component.ts` and `select-rubric-sample.ts` (cut in batch 48) are the only code consumers.

### Task 71.1: Delete the two `.claude/skills/<slug>/` directories; remove the suggestion - PENDING

- Files: `.claude/skills/execute-phase-gated-task/` (delete), `.claude/skills/extract-and-relocate-angular-component-feature/` (delete), `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts` (+ spec if affected).
- Plan reference: plan row 47.
- Pattern to follow: none beyond the plan row.
- Quality requirements: none beyond the plan row.
- Validation notes: none beyond the plan row.
- Implementation details: none beyond the plan row.

## OP-2: Snapshot prune (orchestrator, no lane)

- After 0057 has run on the user's machine and the archive receipt is verified, run
  `scripts/prune-skill-history.ts` in dry-run mode. Show the user the manifest (files and the user-edit
  snapshots that are kept), then run the apply mode with the receipt. This is irreversible for the
  bulk-seed snapshots. User-edit snapshots are kept.

**Phase F review due after batch 71: code-logic + visual.**

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| T1 | R1 fix: split plan row 39. Retained-method rework (43) leaves `METHODS` unchanged. One atomic contract batch (59) after the facade trim. | (a) atomic contract batch; (b) temporary `RpcUserError` stubs in `METHODS` from 39 to 59 | `manifest.ts:506-531` checks both directions. Stubs are a temporary shim, which the replace-in-place rule forbids. (a) needs no throwaway code. | Yes (git) |
| T2 | Phase D order: SU deletion (57) and facade trim (58) before the RPC contract (59), then the SS register cut and deletion (60, 61). | plan order 54-57 then 59 | Shared registry removal breaks the typed facade calls. The handler must stop injecting the pipeline tokens before SS registrations go. | Yes |
| T3 | R2: bump the ratchet pins (repo convention) rather than introduce a shared constant. | bump; shared constant | Each spec's test is named "keeps the bundled-version ratchet current" (`0055...spec.ts:77`). | Yes |
| T4 | R4: the funnel and judge-agreement families, plus the orphaned `judge-lane-tap`/`judge-corpus`, are deleted, not repointed. The lane doubles stay. | repoint; delete | D2 (pipeline-only suites go). `doubles-override.ts:105` and `merge-update.test-support.ts:41` still use the lane runner. | Yes (git) |
| T5 | Keep `LaneRunnerService` + `LANE_RUNNER_SERVICE`. Retiring them is a named follow-up. | delete now (also edits retained mcp-bench doubles); keep | The enhancer imports `lanes/lane-runner.service` (`skill-enhancer.service.ts:29`). The bench doubles depend on the token. | Yes |
| T6 | Data step is Phase F with OP-1 (archive dry-run + user confirmation before committing 0057) and OP-2 (prune dry-run, then apply). Promoted-skill removal (70, 71) also moves to F. | keep in C/E per plan | Orchestrator rule for this decomposition; context.md "show the exact table list to the user and get approval before the drop". | Data: No (after OP-1) |
| T7 | Add `scripts/export-skill-pipeline-archive.ts` (batch 50) to produce the OP-1 receipt from a DB copy. | run the app boot (archive and drop in one step, no confirmation window) | User decision 3: "export to an archive file first and verify it, then drop". | Yes |
| T8 | Phase reviewer: Claude `code-logic-reviewer` subagent. | Glm/codex reviewing each other's batches by phase | Every phase mixes codex and Glm implementers. A third family is the only reviewer different from both. grok and opencode are excluded. | Yes |
| T9 | Batches 1, 2 and 7 are marked IN_PROGRESS together (wave A-W1). | Batch 1 only | They are file-disjoint and in different Nx projects. Their checks still run one at a time. | Yes |
| T10 | Split the old "then 17, 18, 20-24" into waves B-W2 (17 chat + 22 RH/SS) and B-W3 (18 chat + 20 SU); 17 and 22 marked IN_PROGRESS together. | 17 + 20 first; fully sequential | Wave rule (different Nx projects incl. gate projects): 20 and 22 both gate SU, so they cannot pair; 22 starts the longest chain (22 -> 23 -> 24). | Yes |
| T11 | Phase A visual Serious 1 (dark `badge-success`/`badge-error` contrast) is a named follow-up outside this task; Moderate 1 and Minor 1 re-checked in the Phase B visual review after batch 24. | add a Phase A UI fix batch | Reviewer marked Serious 1 pre-existing (classes predate batches 7/11) and APPROVED 8/10; the null row is not reachable until batches 22-24. | Yes |
| T12 | Legacy `PendingSettingsTab` ids kept by batch 17 are removed in a new Task 53.2 (core union), after their users go: routing map (18), providers commit service (25), e2e fixtures (51, 52). | remove in 18; remove in 25; leave as a follow-up | O13a kept them because `routing-map.component.ts:14-17`, `providers-commit.service.ts:151-154`, `skills-lane-pickers.e2e.spec.ts:114` and `ptah-electron-e2e/.../skills.spec.ts:121` still use them; 53 is the first batch after 51 and 52 (via 52) and is Phase C, so the Phase C review covers it. | Yes |
