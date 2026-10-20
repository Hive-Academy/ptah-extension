# Implementation Plan Review - TASK_2026_662_3eea (Gate 2, cross-side)

Verdict: REVISE

Reviewed: `implementation-plan.md` (197 lines) against `context.md` Session 2026-10-18,
`../TASK_2026_659_cec4/parity-inventory.md` and the code in this worktree (HEAD `271198ced`).
The settled user decisions are not reopened. The architecture is sound: keep both libraries, swap
`SkillCandidateStore` for an event store plus a grade projection, use nullable grades, and gate 0057
behind a verified archive. The batch table cannot be executed as written. Several batches leave the
tree failing to compile. Two `keep` capabilities lose their backing code, and about 25
consumer files outside the named batches are missing. The design does not need rework. The
handoff (batches, file lists, three settings and migration details) does.

Severity key: Blocking = compile break, test break or loss of a `keep` capability if executed as
written; Serious = wrong behaviour or unproven contract; Moderate = gap that will cost a cycle;
Minor = wording or hygiene.

## Findings

### 1. Blocking: directory deletions (batches 17-22) run before the importers are cut (batch 23)

- Evidence: `libs/backend/skill-synthesis/src/lib/di/register.ts:19-24,50-63` imports `cleanup/`,
  `lifecycle/`, `queue/`, `lanes/`, `archaeology/`, `gates/` and `digest/`; `src/index.ts:12-27,82-121,
  237-286,300-423` re-exports from all of them. Backend Jest type-checks (`jest.config.ts:10`
  `diagnostics: { ignoreCodes: [151002] }`), so batch 17's own gate
  (`nx test @ptah-extension/skill-synthesis`) fails on the first missing module.
- Kept files also import doomed modules. Batch 23 would fix register/index, but these files need
  their own fixes: `skill-enhancer.service.ts:29-55` imports `lanes/lane-runner.service`
  (`skillQueryLane`), `lanes/provider-network-backoffs`, `lanes/lane-auth-resolver.port`,
  `lanes/lane.types`, `lanes/lane-resolver.service` (`resolveLaneModel`), `skill-judge.service` and
  `skill-candidate.store`. `skill-registry-catalog.service.ts:13` uses `SkillCandidateStore.findByName`
  (line 61). `outcome-seam/skill-telemetry-seam.adapter.ts:11` imports `SessionVerdictStore` from
  `archaeology/`. `triggers/skill-trigger.service.ts:35` imports `SkillSynthesisService`.
- Fix: put a **relocate-and-cut** phase before any deletion. (a) Move each surviving helper out of a
  doomed directory: `resolveLaneModel`/`skillQueryLane`/`ProviderNetworkBackoffs`/
  `ILaneAuthResolver`/`LaneAuthOverride` into an `enhancement/` folder; `SessionVerdictStore` and
  its types into `outcome-seam/`; `resolveSkillsRoot` (finding 3); and `ForegroundActivityTracker`
  (finding 4). Then (b) cut register.ts and index.ts so they stop importing the doomed modules.
  Only then (c) run the deletion-only batches. Fold batch 23 into (b). Token removal is covered in
  finding 2.

### 2. Blocking: token, RPC and DI contract removals are not atomic with their consumers

- RPC contract: `skills-synthesis-rpc.handlers.ts:6,298` says the `METHODS` tuple is
  "compile-asserted to equal" the registry. Batch 7 removes methods from `rpc.types.ts`, but no batch
  removes the 28 handler registrations, so rpc-handlers stops compiling at batch 7. The generated
  `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:308-336` (from
  `scripts/generate-host-source-registry-baseline.ts`) and
  `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts:69` are not in any batch either.
- Frontend type errors go undetected. `libs/frontend/skill-synthesis-ui/tsconfig.spec.json:9` sets
  `isolatedModules: true`, so batches 8-16 pass their test gates while the frontend no longer
  type-checks against the batch-7 types.
- DI: batch 23 removes tokens, and batches 30-32 update the app specs that resolve them. Between
  those batches, `apps/ptah-electron/src/di/container.smoke.spec.ts`,
  `apps/ptah-cli/src/di/container.smoke.spec.ts` and `expected-resolvable.ts` fail. Seven
  intermediate commits stay red.
- Batch 6 changes `invocationStats` success to nullable in the handler before batch 7 changes the
  shared DTO (`libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`). The handler then returns
  `null` where the type requires `number`, which is a compile error in batch 6.
- Fix (corrected order; at most 6 files and 2 projects per batch unless marked):
  1. Additive and compile-safe: 0056; the event store, recorder, adapter and **its DI
     registration**; the grade store with registration; extractor and harvester; scorecard **plus the
     nullable DTO in `rpc-skill-clone.types.ts`** (in the same batch as the handler change).
  2. New settings keys added **alongside** the old ones, plus the migration owner (finding 6). The
     enhancer reads the new keys. The Providers row and pause/telemetry toggles move to
     `settings:get`/`settings:set` (finding 5).
  3. Cut every caller of methods being removed (finding 7 lists them), frontend and CLI first,
     with `npx nx typecheck <project>` added to each frontend gate.
  4. **One merged contract batch** (allowed to exceed the cap because `METHODS` is compile-asserted):
     handlers.ts, schema.ts, schema.spec, `rpc.types.ts`, the regenerated baseline, host-profile.ts,
     `rpc-allowlist.spec.ts`. Delete `skills-synthesis-rpc.{queue,digest}.spec.ts` and
     `.activity-feed.integration.spec.ts` in the same batch. Gate: `nx run-many -t test -p
     @ptah-extension/rpc-handlers @ptah-extension/shared --parallel=1`.
  5. The relocate-and-cut phase from finding 1, including host/runtime consumers (finding 4). Keep
     doomed tokens declared in `tokens.ts` but no longer registered. Update each app's
     `expected-resolvable.ts` and smoke spec in the **same** batch as the register.ts change (VS
     Code, Electron and CLI as three sequential batches, each gated by its own app test).
  6. Deletion-only batches, now safe. The last one trims `tokens.ts`.
  7. Thoth cron, 0057 and archive, snapshots, promoted skills.

### 3. Blocking: shipped-skill delivery (`keep`) depends on files and a key the plan deletes

- Evidence: `resolveSkillsRoot`, `SKILLS_ROOT_KEY = 'skillSynthesis.skillsRoot'` live in
  `skill-md-generator.ts:62-91`, which batch 22 deletes ("and generator"), and `skillsRoot` is in the
  48 keys removed by batch 10 (plan line 74). Consumers on the keep path:
  `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:48`,
  `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:17`,
  `apps/ptah-electron/src/activation/plugin-activation.ts:34`,
  `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.ts:34-37`.
- Inventory: "Shipped skill delivery to Claude (`~/.ptah/skills`) | keep" and "Harness sync | keep".
  The settings row approves removing `skillSynthesis.*` keys, but not the root that keep capability
  reads. A user who set `skillsRoot` would have skills delivered to a different directory with no
  notice.
- Fix: move `resolveSkillsRoot` (and `SKILLS_ROOT_*` constants) to a kept file, e.g.
  `skills-root.ts`, before batch 22. Either retain `skillSynthesis.skillsRoot` as a second kept key,
  or migrate it to `skills.root` with the same one-time copy rule. Add the move to Preserve contract
  with `harness-fs.service` and plugin-activation specs as proof. Update the Decisions table:
  "Retain one old key" becomes two kept keys or one migrated key.

### 4. Blocking: runtime and host consumers of deleted services are absent from the batches

The skill-synthesis lib has 34 consumer files outside the lib (`grep "@ptah-extension/skill-synthesis'"`).
The batches cover about five of them. The following break at compile time or stop working:

- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:22-26` and `types.ts:6-9`
  (`SkillSynthesisService`); only `start-thoth-cron.ts` is in batch 24.
- `libs/backend/thoth-runtime/src/lib/memory-retention-job.ts:12-15,112-124` resolves
  `SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER` (`queue/foreground-activity.tracker`). Memory
  is "out of scope, do not touch" (inventory lines 77-83). Deleting `queue/` removes the token. The
  `isRegistered` fallback then returns `Infinity` (always idle), which silently changes when memory
  retention runs. Fix: move `ForegroundActivityTracker` out of `queue/` and keep its registration,
  or move it into thoth-runtime. Add a memory-retention-job regression test.
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:20-25` (`SkillDrainService`,
  `SkillSynthesisService`), `thoth/register-thoth-libraries.ts:25-28`,
  `thoth/cli-skill-repropagation.ts`. Batch 32 names `cli-engine/src/lib/container.ts`, but the
  skill wiring lives in these files.
- `apps/ptah-electron/src/activation/plugin-activation.ts:595-615` (`readDormantSkillSlugs` uses
  `SkillCandidateStore.listDormantPromotedSlugs`), `activation/wire-runtime.ts`, `main.ts`,
  `services/tray/tray.service.ts:12,89` (`trayKeepalive`, a removed key), `activation/boot-coordinator.ts:174`.
- Fix: add explicit batches for thoth-runtime (boot, types, memory-retention-job, cron), cli-engine
  bootstrap and thoth registration, and Electron activation and tray, placed in phase 5 of finding 2.
  Name the replacement for `disabledSkillIds` dormant folding: it becomes empty once both promoted
  skills are gone. Say so, and test that no other dormant slug is re-propagated.

### 5. Blocking: the pause switch (`keep`) and the Providers enhancement row lose their only read/write RPCs

- Pause: `skills-pause-switch.component.ts:17,127` reads `state.skillsEnabled`, which
  `skill-synthesis-state.service.ts:415,441` backs with `rpc.updateSettings({enabled})` and
  `rpc.getSettings()`. The plan removes `getSettings` and `updateSettings` (line 70) but names no
  replacement call, and `skill-synthesis-state.service.ts` is in no batch. The dashboard
  `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:325,385` also calls `getSettings`
  and `listCandidates`, and is in no batch.
- Providers: `libs/frontend/core/src/lib/services/providers-commit.service.ts:133-187` writes the
  judge fields via `skillSynthesis:updateSettings`/`setLanes`, and reads them back via `getSettings`/
  `getLanes`. `providers-settings-state.service.ts:124,666-672` loads them the same way. Batch 12 edits
  only `provider-consumer-rows.ts`. Plan line 98 says the new row "writes these keys through the
  existing settings manager". That path exists (`settings:get`/`settings:set`,
  `settings-rpc.handlers.ts:124-128`) but no batch wires it, and the readBack contract is not
  specified.
- Fix: state that the pause, telemetry and enhancement settings use `settings:get`/`settings:set`
  keyed on the registered file-settings keys. Add `skill-synthesis-state.service.ts`,
  `thoth-status.service.ts`, `providers-commit.service.ts` and `providers-settings-state.service.ts`
  (with specs) to batches in phase 3, before the contract batch. Add a write-then-readBack test for
  each key.

### 6. Blocking (item 3 of the brief): the "Enhance now" settings migration has no owner and reads the wrong store

- Write-path trace: the old values are written today only by
  `providers-commit.service.ts:157-187` → `skillSynthesis:updateSettings` → file settings
  (`file-settings-keys.ts:293-295,605-607`). They are read by `skill-enhancer.service.ts:792-814`
  (`enhanceTimeoutMs` via `workspaceProvider.getConfiguration`, `judgeProvider`/`judgeModel` via the
  `settings` object built in `skill-synthesis.service.ts:1619-1625`, which batch 22 deletes).
- Routing: `ElectronWorkspaceProvider` sends only keys in `FILE_BASED_SETTINGS_KEYS` to
  `~/.ptah/settings.json` (`electron-workspace-provider.ts:14-17,34-35`). Batch 10 removes the old
  keys from that set. After batch 10, a "one-time migration" that reads the old values through the
  workspace provider reads the per-app config instead and finds nothing. User choices are then
  silently dropped.
- No batch owns the migration code, and the plan does not say when it runs (boot, settings-manager
  load or first enhancer call). The same applies to the `skills.telemetry.enabled` copy from the
  raw `skillSynthesis.triggers.skillInvocationTelemetry.enabled` key.
- The enhancer's `settings` argument comes from `SkillSynthesisService.getSettings`. Batch 11 must
  replace that source with direct reads of the new keys, or the enhancer still depends on a deleted
  service.
- Fix: add one `platform-core` migration unit (for example in `PtahFileSettingsManager` load, which
  already owns `settings.json` per `file-settings-manager.ts:56,161`). It reads the raw JSON, copies
  `skillSynthesis.judgeProvider|judgeModel|enhanceTimeoutMs` and the telemetry raw key into the new
  keys only when the new key is absent, and is idempotent. Place it in the same batch that adds the
  new keys. Remove the old keys from routing only in a later batch, after the enhancer reads the new
  keys. Tests cover: explicit value copied, `inherit`/empty preserved, existing new value not
  overwritten, `false` telemetry preserved, and a second run as a no-op.

### 7. Serious: callers of removed RPCs outside the plan

These break at compile time (type-checked projects) or at runtime (unknown method), and none is in a
batch:
`apps/ptah-cli/src/cli/commands/skill-synthesis.ts:4-265` and `apps/ptah-cli/src/cli/router.ts:3255-3340`
(user-facing `ptah` CLI subcommands for listCandidates, getCandidate, promote, reject, invocations
and stats; remove the commands and their specs, plus `apps/ptah-cli/tests/e2e/skill-synthesis.e2e.spec.ts`);
`apps/ptah-electron/src/ipc/ipc-bridge.ts`, `apps/ptah-electron/src/rpc-host-profile.ts`;
`libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts`; `libs/shared/src/lib/types/messages/
message-constants.ts` and `payload-map.ts` (skill push events consumed by
`SkillSynthesisLiveService`, which `apps/ptah-extension-webview/src/app/app.config.ts:82,298-301`
registers as a `MESSAGE_HANDLERS` provider); `libs/shared/src/lib/constants/skill-drain.constants.ts`
(drain job ids are still needed by the 0057 archive/drop, so move them to persistence-sqlite or
inline them in 0057); `libs/backend/vscode-core/src/messaging/rpc-handler.ts:82` (comment lists
deleted methods). Fix: list each one in a phase-3 batch.

### 8. Serious: 0056/recorder interaction makes every new ungraded event an error

- `skill-invocation-recorder.ts:60` writes `isError: !input.succeeded`. With `succeeded: null`, this
  writes `is_error = 1` on every new event, and the 646 seam reports it as `isError: true`
  (`skill-telemetry-seam.adapter.ts:58`). The plan's backfill sets `is_error=0` on old rows, while
  new rows get 1.
- Fix: make `is_error` independent of the grade: `0` unless an explicit tool error is observed. Add a
  regression case: a new ungraded subagent row gives `succeeded NULL, is_error 0`, and the adapter
  reports `isError false`.

### 9. Serious (item 4): the success signal is implementable for agents but not proven for skills and commands, and it has two sources of truth

- Agents: implementable. Subagent rows carry `task_id` (`skill-trigger.service.ts:729-756`,
  `subagent-metrics-extractor.ts:112`) and `run_id` (0055). `lane_outcome_records` has `run_id`,
  `task_id`, `verdict` and `final_review` (`0054:40-67`). Today's exact/window reconciliation is
  `skill-candidate.store.ts:1376-1421`.
- Skills: `onUserPromptExpansion` (`skill-trigger.service.ts:682-693`) and Skill-tool events record
  no `task_id`. The plan's join "task id + session id + workspace" therefore needs a session→task
  mapping, and the plan names none. Candidates exist: the session-organization recorder
  (`libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts`) and
  `agent-sdk/src/lib/session-metadata-store.ts`. Retained `skill_session_verdicts` is archaeology
  output and carries no task link. Mark this as an Assumption, name the mapping source with
  file:line, and specify what happens without a link: the event stays a use with no grade.
- Two sources of truth: the grade lives both in `skill_invocation_events.succeeded/reconciled_at`
  (kept; "harvester reconciles only explicit grades", plan line 123) and in `skill_task_grades`
  (line 91, canonical and corrected by UPSERT). Existing reconciliation never re-grades a row
  (`reconciled_at IS NULL` guard, store line 1372). After a corrected review, the two disagree, and
  a scorecard that sums both double-counts. Fix: make `skill_task_grades` the only rate source.
  0056 backfills the existing reconciled rows (about 81) into it with `verdict_source` provenance.
  Events keep use facts only, or are written only as a projection. State the precedence between a
  batch verdict, a lane `final_review` and a task-level `code-*-review.md` verdict for the same run.
- Plan reviews: the `*-review.md` glob also matches plan reviews such as this file. State which
  subject such a verdict grades (the plan author's run), or exclude it, so a REVISE on a plan is
  not counted against the executor agents.

### 10. Serious: whole subtrees are classified nowhere

- `libs/backend/skill-synthesis/src/lib/archaeology/` (the plan deletes
  `session-archaeologist.service.ts` but no batch covers this folder), `lifecycle/` (retirement,
  umbrella-merge and backlog purge state, which use `SKILL_REPROPAGATION_TOKEN`),
  `eligibility/`, `diagnostics.service.ts`, `candidate-body.ts`, `skill-md-migration*.ts`,
  `trajectory-extractor.ts` (used by the enhancer, `skill-enhancer.service.ts:51`),
  `cosine-similarity.ts`, `event-wire.ts`, the reachability and prefilter specs.
- `SkillBudgetStore` is in `queue/skill-budget.store.ts` (register.ts:51), not top-level as the
  removal map says.
- Frontend: the top-level `components/skill-{candidates-table,digest-panel,invocations-panel,
  pipeline-status,settings-panel,stats-strip}.component.ts`, `services/skill-diagnostics-{rpc,state}`,
  `skill-synthesis-live.service.ts`, `skill-synthesis-state.service.ts` and the 13 public exports in
  `libs/frontend/skill-synthesis-ui/src/index.ts:1-39`. Batches 15-16 delete only `diagnostics/` and
  `suggestions/`.
- Fix: add a keep/delete row for each, with deletion batches, and update `src/index.ts` (both libs)
  before the deletions. Line 173's "classify before deletion" note does not replace named batches.

### 11. Moderate (item 5): migration details to pin down

- Numbering: 0056/0057 are free (last is `0055`, `migrations/index.ts:400-402`, and no branch or
  worktree has a `0056_*`/`0057_*`).
- 0056 rebuild: no table references `skill_invocation_events` and it has no triggers, so a
  `CREATE new / INSERT SELECT / DROP / RENAME` inside the runner's `BEGIN IMMEDIATE` is safe. The
  plan must list the explicit column list (0021, 0027, 0030, 0037 and 0055 columns) and the index
  names to recreate (`idx_skill_inv_events_slug` at `0021:12`, the task index used by
  `store:1363`, and `idx_skill_inv_events_run` at `0055`). The spec should compare
  `PRAGMA table_info`/`index_list` before and after and keep row counts and ids unchanged.
- 0057 drop order: `skill_invocations.skill_id REFERENCES skill_candidates ON DELETE CASCADE`
  (`0003:35`), and `foreign_keys = ON` (`sqlite-connection.service.ts:97`). Drop `skill_invocations`
  first. `job_runs` cascades from `scheduled_jobs` (`0004:20`), which is correct as the plan states.
- Archive preflight: the runner has only a nonfatal pre-run backup
  (`migration-runner.ts:88-105`) and a synchronous `applyOne` (`:190-265`). The plan should specify a
  new optional `preflight(version)` hook on `Migration`, awaited in `applyAll` before
  `applyOne(57)`, whose failure stops the loop without recording 57. Test that a failing preflight
  leaves `user_version = 56` and keeps all tables.
- Line 173 ("execute the per-profile archive, then apply 0057" as an operational step) contradicts
  component 5 (automatic migration preflight on every install). Keep only the automatic path.
- Empty installs: write a receipt, not an empty archive directory per profile, or say why the
  empty directory is wanted.

### 12. Moderate: verification commands

- Frontend batches need `npx nx typecheck <project>` in addition to `test`, because of
  `isolatedModules` (finding 2).
- Batch 12 changes `chat` and `skill-synthesis-ui` but gates only `chat`. Use
  `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/skill-synthesis-ui --parallel=1`.
- Batch 28: `npx jest scripts/prune-skill-history.spec.ts` with no `-c` loads the root
  `jest.config.ts`, which is `getJestProjectsAsync()` (every project). That breaks the root
  CLAUDE.md memory rule. Use `-c scripts/jest.config.ts --maxWorkers=2`.
- Batch 30: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` does not reference
  skill-synthesis (grep). Drop it from the batch and keep only `rpc-surface.spec.ts`.
- Batches 2, 4 and 5 add new injectables but register.ts is edited only in batch 23. Register each
  new store in the batch that creates it.

### 13. Moderate (item 6): surfaces not covered

- Webview e2e harness: `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/{skills-lane-pickers,
  thoth-feed-visual,activity-ticker}.e2e.spec.ts` and `scenarios/settings/{settings.fixtures.ts,
  settings-orchestration.e2e.spec.ts,settings-reachability.table.ts}` reference deleted lanes, tabs and
  settings. Electron e2e: `apps/ptah-electron-e2e/src/specs/thoth/{skills,skill-telemetry,
  message-handlers-eager}.spec.ts`, `dashboard/dashboard.spec.ts`, `support/{fixtures,
  skill-telemetry-db,tray-home}.ts`. Also `apps/ptah-tui/src/lib/thoth-lifecycle.spec.ts`. Edit them in
  the matching batches; do not run e2e targets.
- Docs: `apps/ptah-docs/src/content/docs/skill-synthesis/{index,how-it-works,background-learning,
  reviewing-candidates,settings,the-skills-tab,skill-md-anatomy}` plus `astro.config.mjs` sidebar,
  `mcp-and-skills/skills.md`, `reference/file-locations.md`, `docs/index.mdx`. Add a docs batch
  (technical-content-writer) that rewrites the section as "Library and skill success". Landing
  copy: `apps/ptah-landing-page/src/index.html:57` only mentions skill packs, so no change is needed.
- Tooling: `tools/mcp-bench/src/memory-skills/**` reads `skill_candidates`/`skill_invocation_events`,
  and `labelling/select-rubric-sample.ts` names a promoted slug. Retire or repoint those suites.
- `libs/backend/cron-scheduler/src/lib/run.store.spec.ts` uses skill job ids as fixtures. Check that
  it does not import the deleted constants.

### 14. Minor

- Plan line 66 cites a "fix-or-retire instruction" for the agent model picker. That phrase is not in
  `context.md`. Keeping the picker keeps more than the inventory requires, so it is allowed. Cite
  the code evidence (`agent-models.store.ts`, `orchestrator.service.ts:1092` saves via
  `setAgentModel`) instead of an instruction.
- The two-project cap: batch 29 deletes repo `.claude/skills/*` (no Nx project) and edits chat-ui.
  This is fine, but list `tools/mcp-bench/.../select-rubric-sample.ts` there too.
- Keep `SKILL_REPROPAGATION_TOKEN` and `USER_LAYER_MIRROR_SERVICE_TOKEN` (used by the enhancer,
  harness-fs and the CLI/Electron repropagation adapters) in the preserve list for `tokens.ts`.

## Parity check (item 1)

| Inventory `keep` / `move` | Plan coverage | Status |
| --- | --- | --- |
| Subagent events (move) | Event store, recorder, adapter (batches 2-3) | Covered; see finding 8 |
| Prompt-expansion / Skill-tool events (keep + fix) | Batch 3 | Covered; skill task join unproven (finding 9) |
| Spec harvester reconciliation (move) | Batches 4-5 | Covered; single source needed (finding 9) |
| Pause switches (keep) | Says kept | **Backing RPC removed** (finding 5) |
| User-layer clones, history/revert, quarantine (keep) | Preserve contract rows, batches 8, 27 | Covered |
| Agent scorecard badge (move) | Batch 9 | Covered |
| Shipped skill delivery (keep) | Preserve row | **Broken by batch 10 and 22** (finding 3) |
| Harness sync (keep) | Preserve row | **Broken via `resolveSkillsRoot`** (finding 3) |
| Library tab Skills/Agents/Commands (keep) | Batches 8, 14 | Covered |
| Memory items (do not touch) | Says preserved | **`memory-retention-job` foreground gate broken** (finding 4) |

The plan removes nothing that the inventory marks `keep`. It retains `skill_session_verdicts`
(inventory says remove-proposed) and the agent model picker, which keeps more than the inventory
requires and is allowed. The breaks above are unplanned side effects, not deliberate removals, so
none is an unapproved removal. The three keep rows marked in bold must still be fixed before
approval.
