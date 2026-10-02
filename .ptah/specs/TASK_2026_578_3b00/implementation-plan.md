# Implementation Plan - TASK_2026_578_3b00 (Revision 1)

**Revision 1** answers the Round 0 review (`implementation-plan-review.md`, verdict REVISE) and the
`## Cross-session coordination` section of `context.md`. Each fix is mapped in the `## Revision log` at the end.

Close the skill lifecycle: umbrella merge, a judge gate that changes state, accept-means-promote, usage-based
retirement, a one-time backlog purge, and lifecycle counts in diagnostics.

**Verdict:** the plan is feasible without widening `skill_candidates.status` (whose `CHECK` cannot be widened in
SQLite). Merged and retired skills become `status='rejected'` rows with a structured `rejected_reason`. Dormant
reuses the existing `residency` column. One additive migration, **`0051_skill_lifecycle`**, adds lineage columns
to `skill_suggestions` and a one-row purge marker table. **Complexity: HIGH.**

All paths below are relative to the worktree root
`D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/` unless written in full.
`SS` = `libs/backend/skill-synthesis/src/lib`.

---

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_578_3b00/task.md` and `context.md`. `context.md` is the requirements
  source: scope items 1-6 and acceptance criteria 1-5. No `task-description.md` exists; the user accepted
  `context.md` in its place.
- Corrections applied: every `file:line` in `context.md` was re-read on branch `feat/task-578-skill-lifecycle`
  (HEAD `c4ab013f3`). All of them hold. The precision notes are in the table below.
- Design handoff used: none. The only UI change is three counters in an existing panel and a refresh call.
- Project rules: the root `CLAUDE.md` and the per-library `CLAUDE.md` files were deleted in commit `7917b193a`
  ("docs: remove all CLAUDE.md and AGENTS.md files"). The rules the caller named still exist in the tree and in
  that commit's parent. The 700-line `max-lines` ceiling is still enforced at `eslint.config.mjs:474-519`, and the
  comment there points to the facade rule. The facade rule, the ~8 constructor-dependency guardrail and the "Zod at
  every external boundary" rule are in `git show 7917b193a^:CLAUDE.md` lines 160-168. The layer lattice is
  `CONVENTIONS.md:121-137` plus the Nx `depConstraints` at `eslint.config.mjs:254-400`. `IOutputChannel` logging
  is met by the library's existing `TOKENS.LOGGER` `Logger`, which writes to an output channel
  (`libs/backend/vscode-core/src/logging/logger.ts:50,72-75`). Every service in `SS` already injects it that
  way.
- Missing decision-critical input: none blocks the plan. Four interpretation calls are resolved below under
  **Architecture decision → Resolutions**. Each is tagged `architect-proposed` so a reviewer can overturn it
  without reopening the rest.

### `context.md` citations re-verified on this branch

| `context.md` citation | Verified location on this branch | Note |
| --- | --- | --- |
| Suggestion pass `skill-curator.service.ts:390-536` | `SS/skill-curator.service.ts:390-536` | exact |
| Clustering `skill-clustering.service.ts:41-73` | `SS/skill-clustering.service.ts:41-73` | It reads `listByStatus('candidate').slice(0, suggestionMaxCandidates)` at `:44-46`. |
| Curator never deletes `:4-6, 245-356, 853` | `SS/skill-curator.service.ts:4-6`, `:245-356`, `:853` | exact. `:245-265` is the skip when 0 promoted. |
| Cap `skill-promotion.service.ts:276-302` | exact | |
| Decay reads `skill_invocations` `skill-candidate.store.ts:421-441` | exact. The read is at `:431` via `listInvocations`. | |
| Tracker `skill-invocation-tracker.ts:74-84` | `SS/skill-invocation-tracker.ts:74-90` (threshold `:77`, `evaluate` `:80`) | The block runs to `:90`. The only non-spec caller is `apps/ptah-cli/tests/e2e/skill-synthesis.e2e.spec.ts`. |
| Trigger `triggers/skill-trigger.service.ts:625` | `:625` is the private `recordInvocation` definition | Callers are `:450` (subagent), `:518` (Skill tool), `:535` (Task) and `:615` (prompt expansion). |
| `acceptSuggestion` `:547-606`, slug `:562-568`, `candidateId: null` `:589` | exact | |
| RPC counters `skills-synthesis-rpc.handlers.ts:513-516, 705-708` | `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:510-516` (stats), `:700-708` (diagnostics) | `const s = getStats()` is at `:510` and `:700`. |
| Judge panel only records `queue/stage-handlers.service.ts:541-563` | `SS/queue/stage-handlers.service.ts:515-553` (stage), `:541-552` (switch), `:556-563` ("replay has no producer") | |
| Judge rubric `skill-judge.service.ts:97-132, 344-350` | keys `:97-103`, rubric `:122-132`, `judgeComposite` `:344-350` | exact |
| `minJudgeScore` 6.0 `skill-synthesis.service.ts:145` | exact | `readSettings` is at `:1266-1372`. |
| `writeAtRoot` / `sanitizeSlug` `skill-md-generator.ts:209-236, 278-285` | exact | |
| `promoteToActive(candidate.name)` / no slug stored `skill-promotion.service.ts:308-321` | exact | |
| `0021_skill_invocation_events.ts:4`, `idx_skill_inv_events_slug` | `libs/backend/persistence-sqlite/src/lib/migrations/0021_skill_invocation_events.ts:4,12` | |
| Runtime slug writes `skill-trigger.service.ts:611-622, 673-683, 693-706` | exact | |
| `listInvocations` `:1479-1487`, activity score `:570-571` | exact | |

---

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `skill_candidates.status` has `CHECK (status IN ('candidate','promoted','rejected'))`. | `persistence-sqlite/src/lib/migrations/0003_skills.ts:18` | A new `merged`/`retired` status would need a table rebuild. Use `rejected` plus a structured `rejected_reason`. Precedent for avoiding the rebuild: `0033_skill_candidate_verdicts.ts:21-25`. |
| `name TEXT NOT NULL UNIQUE` (slug, also the folder name). | `0003_skills.ts:12` | Writing `md.slug` into `name` can collide with any other row, including rejected ones. Slug choice must consult the DB as well as the filesystem. |
| `residency` with `CHECK IN ('resident','dormant')`. Dormant skills are skipped at the junction. | `0026_skill_residency.ts`; `SS/skill-candidate.store.ts:549-557`; consumed at `apps/ptah-electron/src/activation/plugin-activation.ts:605` | Dormant is already a first-class state with a production consumer. Retirement reuses it. |
| Legal transitions: `candidate→{promoted,rejected}`, `promoted→{rejected}`. | `SS/skill-candidate.store.ts:163-167`, enforced by `updateStatus` `:585-635` | Merge (candidate or promoted → rejected) and retire (promoted → rejected) are legal edges. Reuse `updateStatus` and the store-owned conditional `rejectIfStatus` (Revision 1), with no writer of `status` outside `SkillCandidateStore`. |
| `promoteAtomically` updates `status`, `promoted_at` and `body_path` but never `name`. It runs in a private `BEGIN IMMEDIATE`. | `SS/skill-candidate.store.ts:467-542`, `:637-647` | Add an optional `name` to the UPDATE. Expose the transaction helper re-entrantly so accept can commit its rows atomically. |
| `skill_suggestions.status` has `CHECK IN ('pending','accepted','dismissed')`. There is no reason column. | `0025_skill_suggestions.ts:7-21` | A merged suggestion becomes `dismissed` plus a new nullable `merged_into` column. The accept lineage gets a new nullable `promoted_candidate_id`. |
| `skill_registry.candidate_id` exists. `linkCandidate` exists but has no production caller. | `0022_skill_registry.ts:12`; `SS/skill-registry.store.ts:176-187` | The registry link can be written inside the accept transaction through `upsert` (`:61-98`). |
| The registry catalog derives `candidateId = findByName(clone.slug)`, and `cloneStatus = 'synth'` only when it finds one, else `'authored'`. | `SS/skill-registry-catalog.service.ts:57-95` | Today, accepted skills (no candidate) and suffixed auto-promotions (name ≠ slug) are re-catalogued as **authored**, which exempts them from cap demotion. Storing `name = slug` makes the catalog self-heal. The backfill must also accept an `authored` registry row as a match (see Assumption A1). |
| `getStats().invocations` counts `skill_invocations`, which has no production writer. The UI's "Invocations" shows it. | `SS/skill-candidate.store.ts:1522-1548`; RPC `:510-516`, `:700-708` | Acceptance 4 requires counting `skill_invocation_events` by slug. `getStats` changes, and the per-skill `skillSynthesis:invocations` (`:490-500`) moves too. |
| `listActiveOrderedByActivity` has no production caller (grep of `libs/` and `apps/`). | `SS/skill-candidate.store.ts:563-582` | Delete it rather than migrate it (replace, do not accumulate). |
| `agglomerate` restarts its scan after every merge, with O(n²) pairs per restart. | `SS/cosine-similarity.ts:33-71` | Over a 600-1000 point pool this is too slow for the main process. Re-implement it as threshold connected components (union-find, one O(n²·d) sweep), with identical partition semantics (`> threshold`). `SkillClusterDedupService` (`SS/skill-cluster-dedup.service.ts:93`) also benefits. |
| The suggestion pass judges the synthesized cluster skill but drops below-threshold and unscored results without recording them. | `SS/skill-curator.service.ts:474-504` | "Reject automatically" needs a recorded decision. A judged-below umbrella is inserted as `dismissed`, which also stops re-synthesis of the same members. |
| `hasExistingForCluster` matches on fingerprint equality or any member overlap, across all statuses. | `SS/skill-suggestion.store.ts:149-171` | Unusable for umbrellas, because the pool deliberately includes pending suggestions. Pool exclusion replaces it (below). |
| The judge-panel stage maps `scored` straight to `done`, with no status change. The panel persists the verdict via `recordJudgeVerdict` / `recordJudgePanel`. | `SS/queue/stage-handlers.service.ts:541-552`; `SS/gates/judge-panel.service.ts:585-605` | The gate decision belongs in the stage handler's `scored` branch: reject below `settings.minJudgeScore`. |
| The replay-floor key is read straight off the workspace with range fallback, not through `SkillSynthesisSettings`. | `SS/skill-promotion.service.ts:53-57, 502-519` | Precedent for N and M: file-based keys read by the owning service, with no change to the 20-field settings DTO, RPC schema or settings form. |
| File-based keys and defaults are registered here. | `libs/backend/platform-core/src/file-settings-keys.ts:241-244` (keys), `:530-533` (defaults), `:309-310`/`:573,583` (`replayValidation.*`) | New keys are added here. The `suggestionMaxCandidates` default changes at `:533`. |
| The curator schedules with `setInterval(curatorIntervalHours)`. `SkillSynthesisService.start()` calls `curator.start`. | `SS/skill-curator.service.ts:188-213`; `SS/skill-synthesis.service.ts:399-409` | The production entry for every curator-hosted pass. The reachability spec drives this exact interval. |
| The production DI reachability harness uses real SQLite (better-sqlite3 or node:sqlite) and fake lanes. | `SS/skill-synthesis.reachability.integration.spec.ts:57-245`; `SS/skill-synthesis.reachability.test-support.ts:100-131` | This is the template for the new lifecycle reachability spec. The node:sqlite adapter only tracks `inTransaction` for `db.transaction()`, not for `exec('BEGIN')` (`test-support.ts:100-115`), so re-entrancy must be tracked by the store itself. |
| `emitDecoratorMetadata` is false in production bundles. An undecorated constructor parameter resolves to `undefined`. | `SS/cleanup/skill-backlog-cleanup.service.ts:83-101` | Every constructor parameter of the new services needs an explicit `@inject`. |
| The migration runner computes pending migrations as a set difference over `schema_migrations`, so gaps are tolerated. | `persistence-sqlite/src/lib/migration-runner.ts:76-87` | `0051` can land before or after TASK_2026_580's `0050` without breaking either. |
| Twelve specs pin the latest migration version at 49. Ten use `toBe(49)`: `0028:83`, `0030:38`, `0038:91`, `0039:65`, `0040:78`, `0041:62`, `0042:70`, `0043:54`, `0045:33`, `0047:34`. Two list the versions in an array: `0044_memory_lifecycle.spec.ts:67-69`, `0046_memory_merge_subject_index.spec.ts:32-34`. All are under `libs/backend/persistence-sqlite/src/lib/migrations/`. | grep on this branch; `context.md` `## Cross-session coordination` | All 12 move to 51, with 51 added to the two arrays. Each gets a comment line beside TASK_2026_580's. TASK_2026_580 moves the same lines to 50 (collision, see below). |
| The accept UI flow refreshes suggestions only, not stats. | `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts:433-445` | Acceptance 2 ("increases in the UI") needs `loadStats()` after accept. |
| Diagnostics wire DTO. | `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:239-250` | Add `totalMerged`, `totalRetired`, `totalDormant`. |

---

## Architecture decision

### Chosen approach

1. **Lifecycle states without a schema rebuild** (project-rule: SQLite CHECK immutability, `0033:21-25`):
   - merged: `status='rejected'`, `rejected_reason = 'merged-into:<umbrellaSuggestionId>'` (user-requested
     marker text).
   - retired: `status='rejected'`, `rejected_reason = 'retired:unused'`.
   - dormant: `status='promoted'`, `residency='dormant'` (existing).
   - backlog-purged: `status='rejected'`, `rejected_reason = 'backlog-purge: unclustered >30d'`.
   - a merged pending suggestion: `status='dismissed'`, `merged_into = <umbrellaSuggestionId>`.
2. **The umbrella pass replaces `runSuggestionPass` and the report-only LLM overlap review.** It runs in a new
   collaborator, `SkillUmbrellaMergeService`, injected into `SkillCuratorService` (project-rule: facade rule).
   The curator keeps its name, token and public methods.
3. **Retirement** runs in a new collaborator, `SkillRetirementService`, which also owns removal of an active
   SKILL.md for a decided row (retired, or a promoted member merged on accept).
4. **Accept-means-promote** is a new promotion entry on `SkillPromotionService`. It shares the cap and commit
   tail with the automatic path. One SQLite transaction inserts and promotes the row (`name = md.slug`), links
   `skill_registry.candidate_id`, accepts the suggestion and merges the members.
5. **Judge gate** is in the `judge-panel` stage handler: scored below `settings.minJudgeScore` rejects the
   candidate. The umbrella's own judge call decides too: below the threshold the umbrella is recorded `dismissed`.
6. **The backlog purge** is a one-time step inside the umbrella pass, guarded by a marker row. It needs the
   clustering result to know "in no cluster".
7. **Counts** come from one extended `SkillCandidateStore.getStats()` and are shown in the diagnostics panel.

### Resolutions (each tagged)

- **R1: Where "Above threshold: show in Recommended" lands (architect-proposed).** Recommended is the
  suggestions sub-view (`libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:874`).
  A candidate that passes the judge panel stays `candidate` and is eligible for umbrellas. When the umbrella pass
  finds it in no cluster, it is surfaced as a **singleton suggestion**: no LLM call, body from its SKILL.md,
  `judge_score` from its row. At most `SINGLETON_MAX_PER_PASS = 5` are surfaced per pass. Rejected alternative:
  leaving passed candidates in Sessions only. That never puts them in Recommended, which contradicts scope item 2.
- **R2: When members are marked merged (architect-proposed).** Members are marked at different times:
  - Candidate members are marked `merged-into:<sid>` when the umbrella is created. This gives the measurable
    reduction acceptance 1 asks for.
  - Pending-suggestion members are marked `dismissed` with `merged_into` at the same time, so they leave
    Recommended.
  - Promoted members are merged only when the umbrella is **accepted**. A live skill must not disappear because a
    pending suggestion exists.

  If the user dismisses an umbrella, its candidate members stay merged. They were near-duplicates whose content
  is in the umbrella body. This is recorded in the curator report.
- **R3: The `merged-into:` target is always the umbrella suggestion id (architect-proposed).** It never switches
  to the new candidate id, so one prefix never spans two id spaces. The accepted suggestion records
  `promoted_candidate_id`, so the lineage is merged member → suggestion → live skill.
- **R4: N and M are file-based settings, not settings-panel fields (architect-proposed, precedent
  `skill-promotion.service.ts:53-57`).** The keys are `skillSynthesis.retirement.dormantAfterDays` (default 30)
  and `skillSynthesis.retirement.retireAfterDormantDays` (default 30). This avoids churn in the 20-field
  `SkillSynthesisSettings`, its shared DTO (`rpc.types.ts:2766+`), its Zod schema and its form. Promoting them
  to the UI later is additive.
- **R5: Purge versus judge gate (Revision 1: narrowed).** "In no cluster" means all of the following:
  - not in a connected component of size ≥ `suggestionMinClusterSize` this pass;
  - not a member of a **pending or accepted** suggestion. Members of a `dismissed` suggestion, whether the user
    dismissed it or it is a judge-rejected singleton, **are** purge-eligible;
  - not judge-scored ≥ `minJudgeScore`;
  - and the candidate has an embedding.

  Candidates with no embedding cannot be evaluated and are kept.

  Pool exclusion (component 8 step 1) is a separate rule and still covers members of suggestions of every
  status. A dismissed suggestion keeps blocking re-proposal, as `skill-suggestion.store.ts:143-148` documents.
  The two rules now differ on purpose: dismissed members leave the pool, and they stay purge-eligible.
- **R7: A judge-rejected umbrella rejects its candidate members (Revision 1, architect-proposed).** This
  replaces Revision 0's "members are untouched", which left them in limbo (review F2). When the umbrella's judge
  score is below `minJudgeScore`:
  - every member that is still `candidate` is rejected with reason `below-judge-score:umbrella:<sid>`. The prefix
    matches the existing token at `skill-promotion.service.ts:582-584`;
  - promoted members are untouched;
  - pending-suggestion members are untouched, because each was already judged at or above the threshold on its
    own.

  This is the literal "Below the threshold: reject automatically" of scope item 2. It also closes limbo for
  passes after the one-time purge has finished, which the purge on its own cannot do. Residual: members of a
  suggestion the **user** dismisses after the purge has run stay `candidate`. They remain visible and
  rejectable in the Sessions tab, and that is the user's choice. Dismiss behaviour is unchanged.
- **R6: The pool includes every `candidate` row, newest first, up to `suggestionMaxCandidates`.** The default is
  raised from 200 to 1000 (architect-proposed). If the pool is truncated, the purge is **skipped** that pass with
  reason `pool-truncated` and its marker is not written. Rejected alternative: keeping the default at 200. That
  leaves older rows outside the pool forever, so the purge could never finish against the live 578.

### Rejected alternatives

- **New `merged`/`retired` status values.** These need a rebuild of `skill_candidates` (it has a CHECK and vec
  rowid links), which cannot be re-run. The precedents in `0033`/`0036`/`0040` all avoid rebuilds. Rejected.
- **A second clustering pass beside `runSuggestionPass`.** That is two clustering passes and a dual path.
  Rejected: the umbrella pass is a superset (candidates + pending suggestions + promoted).
- **Keeping the LLM overlap/stale review.** It writes a report and changes nothing (`skill-curator.service.ts:853`).
  The umbrella pass now decides overlap and retirement decides staleness. Keeping it costs one LLM call per pass
  and adds no state. Rejected and removed. The report file is kept and now lists the actions applied.
- **A new `SkillLifecycleStore` writing `skill_candidates.status`.** That would be a second status writer that
  bypasses `LEGAL_TRANSITIONS`. Rejected. All status moves go through `SkillCandidateStore` (`updateStatus`, `rejectIfStatus`) and
  `promoteAtomically`.
- **A SQL-only migration backfill for the 2 accepted suggestions.** It needs a ULID id, a SKILL.md existence
  check, the suggestion's description, a member centroid embedding, and branching on registry status (A1).
  Rejected in favour of an idempotent TypeScript reconcile that runs at curator start.
- **Moving N/M into `SkillSynthesisSettings`.** See R4.

### Assumptions (each with the check that resolves it)

- **A1.** The 2 live accepted suggestions' registry rows may have been re-labelled `authored` by the catalog sync
  (`skill-registry-catalog.service.ts:91-95`). Check on a DB copy:
  `SELECT slug, clone_status, candidate_id, user_path FROM skill_registry WHERE kind='skill';` against
  `SELECT id, name FROM skill_suggestions WHERE status='accepted';`. The reconcile matches either status, but
  only when `<activeRoot>/<slug>/SKILL.md` exists and `slug ∈ {s, s-2…s-5}` for `s = sanitize(suggestion.name)`.
- **A2 (Revision 1: resolved, now a verified contract).** The user-layer clone of a removed synth source is
  reaped by the mirror's deleted-upstream sweep.
  - `UserLayerMirrorService.reconcileAll` runs the three-way reconcile and then `reapDeletedUpstream`, and its
    doc says it runs "on every activation"
    (`libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:470-484, 489-519`).
  - The reaper removes a clone whose synth upstream (`synthesizedSkillsRoot/<slug>`) no longer exists, after
    snapshotting it to `.history/`. It keeps the clone, flagged `orphaned: true`, when the clone holds local work
    (diverged or enhanced). See `user-layer-orphan-reaper.ts:1-38`.
  - `ElectronSkillRepropagation.repropagate` triggers `HarnessPropagationService.propagate`, which refreshes the
    user layer first (`apps/ptah-electron/src/activation/skill-repropagation.ts:31-36, 83-110`).

  Contract used by this plan: the source is removed and repropagation is emitted (component 11). The clone is
  reaped no later than the next activation's `reconcileAll`, and possibly sooner if the propagation refresh
  includes the sweep. Retired skills cannot be `diverged`, because those are exempt (component 11). An
  **enhanced** retired clone is kept as `orphaned: true` by design, because it holds local work. This plan
  does not change the adapter or the reaper. The `skill_registry` row is handled by component 11 itself (review
  F3), and is no longer left to the catalog.
- **A3.** Union-find `agglomerate` must reproduce the existing cluster-id labelling that
  `cosine-similarity.spec.ts` and `skill-cluster-dedup.service.spec.ts` assert. Check: read both specs. If they
  assert label values, use "label = lowest member index".
- **A4.** The Skill tool's `command` slug equals the SKILL.md `name:` frontmatter, which equals the materialized
  directory slug (`skill-md-generator.ts:226-231, 250`; `skill-trigger.service.ts:693-706`). This is the join key
  from context.md. Check in the reachability spec: a recorded event for the suffixed slug is counted.

### Effect on existing code

- **Replaced:**
  - `SkillCuratorService.runSuggestionPass`, the LLM overlap review (`:266-356`) and its helpers.
  - `SkillClusteringService.clusterCandidates` (replaced by `partitionPool`).
  - `SkillSynthesizerService.synthesizeFromCluster` and `buildClusterPrompt` (replaced by `synthesizeUmbrella`).
  - the body of `agglomerate`.
  - the decay score's `skill_invocations` read.
  - `getStats().invocations` semantics.
  - the per-skill `skillSynthesis:invocations` source.
- **Deleted:** `SkillCandidateStore.listActiveOrderedByActivity` and `SkillCandidateStore.listInvocations`
  (their last callers move). `CuratorOverlap`/`CuratorFinding`/`parseFindings` are deleted if
  `ptah_lsp_references` shows no consumers. The RPC already omits `overlaps` (`skills-synthesis-rpc.handlers.ts:665-670`).
- **Left alone:**
  - `SkillInvocationTracker`, `skill_invocations`, `countDistinctContexts`. Automatic-threshold wiring is not a
    scope item.
  - the generator system prompt `SkillSynthesizerService.buildSystemPrompt` (`SS/skill-synthesizer.service.ts:228-249`),
    which TASK_2026_473 Track B owns.
  - the archaeology pipeline.
  - the 20-field `SkillSynthesisSettings`, apart from the default value of `suggestionMaxCandidates`.

---

## Component specifications

### 1. Migration `0051_skill_lifecycle`

- **Purpose:** additive schema for lineage and the one-time purge marker.
- **Responsibilities:** static DDL only. No backfill and no access to existing rows.
  ```
  ALTER TABLE skill_suggestions ADD COLUMN merged_into           TEXT;
  ALTER TABLE skill_suggestions ADD COLUMN promoted_candidate_id TEXT;
  ALTER TABLE skill_suggestions ADD COLUMN references_json       TEXT;
  CREATE TABLE IF NOT EXISTS skill_backlog_purge_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cutoff_created_at INTEGER NOT NULL,
    completed_at      INTEGER NOT NULL,
    rejected          INTEGER NOT NULL DEFAULT 0
  );
  ```
  All three new columns are nullable with no DEFAULT and no CHECK, the same choices as `0036`/`0040`.
- **Verified contracts:**
  - the registry entry shape `{version, name, sql}` (`persistence-sqlite/src/lib/migrations/index.ts`, last
    entry version 49);
  - a static-SQL-only rule (`index.ts:14-18`, header of `0045_skill_backlog_cleanup.ts`);
  - the one-row table precedent (`0045:24-26`).
- **Dependencies:** none (L0 persistence).
- **Integration points:** read by `SkillSuggestionStore` (component 3) and `SkillBacklogPurgeStateStore`
  (component 4).
- **Failure behaviour:** the runner applies it in one `BEGIN IMMEDIATE` (`migration-runner.ts:173-187`). On
  failure, it reverts.
- **Quality requirements:** security: no `${}` (ESLint `no-template-curly-in-migration`).
- **Verification seam:** `0051_skill_lifecycle.spec.ts`. Apply it on a DB migrated to 49 (and on one at 50, to
  prove independence from 0050). Assert the columns and the table exist and that existing suggestion rows read
  NULL. Bump the twelve max-version specs to 51.
- **Files:**
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0051_skill_lifecycle.ts`
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0051_skill_lifecycle.spec.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` (import plus a `{ version: 51, name: '0051_skill_lifecycle', sql }` entry)
  - MODIFY the 12 latest-version specs `.../migrations/00{28,30,38,39,40,41,42,43,44,45,46,47}_*.spec.ts`:
    - the ten `toBe(49)` asserts move to `toBe(51)`;
    - the `0044` and `0046` version arrays gain `50, 51`, matching whatever 580 has by then;
    - each change gets the comment line `// 51 since TASK_2026_578 appended 0051_skill_lifecycle.` directly under
      580's `// 50 since TASK_2026_580 appended 0050_session_organization.`.

### 2. `SkillCandidateStore` changes

- **Purpose:** the single writer of `skill_candidates` status and name. Gains slug-aware promotion, event-based
  reads and lifecycle counts.
- **Responsibilities:**
  1. `promoteAtomically(id, { promotedAt, bodyPath, demotedResidentId?, name? })`. When `name` is given, the
     UPDATE at `:513-527` also sets `name = @name`. A UNIQUE violation throws, and the caller rolls back.
  2. Make `inImmediateTransaction` public and **re-entrant**. A private depth counter means a nested call runs
     `fn()` inline, and only the outermost call issues `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`. It must not rely
     on `db.inTransaction`: the node:sqlite adapter does not track `exec('BEGIN')`
     (`reachability.test-support.ts:100-115`). `promoteAtomically` keeps calling it, unchanged.
  3. `listActiveOrderedByDecayScore` (`:421-441`) reads invocation times from `skill_invocation_events WHERE
     skill_slug = row.name ORDER BY invoked_at DESC LIMIT 1000` (index `idx_skill_inv_events_slug`) instead of
     `listInvocations(row.id)`. The decay formula is unchanged.
  4. NEW `listInvocationEvents(candidateId, limit): SkillInvocationRow[]`. It resolves `name` by id, reads
     `skill_invocation_events` by `skill_slug`, and maps to the existing `SkillInvocationRow` (`types.ts:342`):
     `skillId = candidateId`, `notes = source`. This keeps the wire contract of `skillSynthesis:invocations`.
  5. NEW `listPromotedLastUse(): Array<{ row: SkillCandidateRow; lastUsedAt: number }>`. One query: promoted rows
     `LEFT JOIN (SELECT skill_slug, MAX(invoked_at) … GROUP BY skill_slug)` on `name`.
     `lastUsedAt = COALESCE(max_invoked_at, promoted_at, created_at)`.
  6. `getStats()` (`:1522-1548`) gains `active`, `dormant`, `merged` and `retired`. `invocations` is redefined
     as `COUNT(*) FROM skill_invocation_events WHERE skill_slug IN (SELECT name FROM skill_candidates WHERE
     status='promoted')` (acceptance 4). Use one aggregate statement, with `SUM(CASE …)` over `skill_candidates`.
     `merged` = `rejected_reason LIKE 'merged-into:%'`; `retired` = `rejected_reason = 'retired:unused'`.
  7. DELETE `listActiveOrderedByActivity` (`:563-582`, no production caller) and `listInvocations`
     (`:1479-1488`, its last callers move). Remove `toInvocationRow` only if it is unused afterwards.
     `recordInvocation`/`countDistinctContexts` stay (A-scope: tracker untouched).
  8. Export the reason constants `MERGED_INTO_PREFIX = 'merged-into:'`, `RETIRED_UNUSED_REASON` and
     `BACKLOG_PURGE_REASON` from `types.ts`. The count SQL and the writers then share one spelling.
  9. NEW (Revision 1, review F4) `rejectIfStatus(id, expected: 'candidate' | 'promoted', reason, rejectedAt?):
     boolean`. It runs one conditional statement:
     ```
     UPDATE skill_candidates
        SET status = 'rejected', rejected_at = ?, rejected_reason = ?
      WHERE id = ? AND status = ?
     ```
     and returns `changes === 1`. This is the same compare-and-set shape as `promoteAtomically`'s promotion UPDATE
     (`:513-527`). It is the store's own legal-edge write: both `candidate→rejected` and `promoted→rejected` are in
     `LEGAL_TRANSITIONS`, so it is not a second writer of status. Every lifecycle rejection that can race another
     host on the shared DB uses it instead of the read-then-write `updateStatus`:
     - the judge-panel stage (component 12);
     - retirement (component 11);
     - umbrella member merges and R7 rejections (component 8);
     - accept member merges (component 10);
     - the purge (component 8).

     A `false` result means "another writer decided first". It is logged and skipped, never thrown.
- **Verified contracts:** `LEGAL_TRANSITIONS` `:163-167`; `updateStatus` `:585-635`; `promoteAtomically`
  `:467-542`; `inImmediateTransaction` `:637-647`; `getStats` `:1522-1548`; `findByName` `:353-359`;
  `SkillInvocationRow` `types.ts:342`.
- **Dependencies:** unchanged (`TOKENS.LOGGER`, `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `VEC_STATUS`).
- **Integration points:** promotion (2.1, 2.2), retirement (2.5), RPC handlers and diagnostics (2.4, 2.6).
- **Failure behaviour:** throws on an illegal transition or a UNIQUE violation. Transactions roll back
  everything, including writes made through other stores on the same connection inside `fn`.
- **Quality requirements:**
  - The file is 1699 lines (already over the 700 warn).
  - Net growth is held near zero by the two deletions. Lifecycle orchestration does not belong here
    (project-rule: facade/size).
  - `getStats` stays one statement for candidates plus one for events.
- **Verification seam:** `SS/skill-candidate.store.spec.ts`:
  - `name` is written by `promoteAtomically`;
  - a UNIQUE clash rolls back the demotion too;
  - a nested `inImmediateTransaction` commits once, and a throw in the inner call rolls back the outer;
  - decay and `listInvocationEvents` read events by slug, and a `-2` suffixed slug counts only its own events;
  - `getStats` lifecycle counts.
- **Files:** MODIFY `SS/skill-candidate.store.ts`, `SS/skill-candidate.store.spec.ts`, `SS/types.ts`.

### 3. `SkillSuggestionStore` changes

- **Purpose:** persistence for suggestions, plus lineage and references.
- **Responsibilities:**
  - `RawSuggestionRow` and `toRow` read `merged_into`, `promoted_candidate_id` and `references_json`. The
    `SkillSuggestionRow` (`types.ts`) gains `mergedInto: string | null`, `promotedCandidateId: string | null`
    and `references: SkillReference[]`.
    - `references_json` is parsed structurally. On a parse failure it falls back to `[]` with a warn, mirroring
      `parseStringArray` `:213-223`.
    - Add `SkillReference = { name: string; body: string }` to `types.ts`.
  - `insert(input, status: 'pending' | 'dismissed')` replaces `insertPending`. `dismissed` is written with
    `decided_at = now` and is used for a judge-rejected umbrella. `NewSuggestionInput` gains
    `references?: SkillReference[]`.
  - `accept(id, promotedCandidateId)`: the transition also writes `promoted_candidate_id`.
  - `markMerged(ids, umbrellaId)`: `pending → dismissed` with `merged_into`, guarded `WHERE status='pending'`.
    It returns the count changed.
  - `listMemberCandidateIds(filter?: { statuses?: SkillSuggestionStatus[] }): Set<string>`: the union of
    `member_candidate_ids` across rows, filtered by a parameterized `status IN (?…)` when a filter is given.
    With no filter it covers all statuses and drives pool exclusion. With `['pending','accepted']` it drives the
    purge exemption (R5, Revision 1). The all-statuses form is used for pool
    exclusion.
  - `listAcceptedWithoutPromotedCandidate()`: for the reconcile (component 9).
  - DELETE `hasExistingForCluster` (`:149-171`) once its only caller (the curator suggestion pass) is gone.
    Verify with `ptah_lsp_references`.
- **Verified contracts:** `insertPending` `:52-82`; `transition` `:173-194`; `toRow` `:196-211`;
  `parseStringArray` `:213-223`; no transactions of its own (all plain statements), so it joins the caller's
  transaction.
- **Dependencies:** unchanged.
- **Failure behaviour:** `transition` keeps its "only from pending" no-op rule (`:185-187`). `markMerged` changes
  nothing for non-pending rows.
- **Verification seam:** `SS/skill-suggestion.store.spec.ts` covers merged lineage, a dismissed insert,
  references round-trip, a corrupt `references_json` falling back to `[]`, and the member-id union.
- **Files:** MODIFY `SS/skill-suggestion.store.ts`, `SS/skill-suggestion.store.spec.ts`, `SS/types.ts`.

### 4. `SkillBacklogPurgeStateStore` (new)

- **Purpose:** reads and writes the one-row `skill_backlog_purge_state` marker.
- **Responsibilities:** `read(): {cutoffCreatedAt, completedAt, rejected} | null` and
  `markComplete({cutoffCreatedAt, completedAt, rejected})` (`INSERT … ON CONFLICT(id) DO NOTHING`). The first
  writer wins, so two hosts cannot both claim the run.
- **Verified contracts:** the store pattern and connection access in `SS/skill-md-migration-state.store.ts` and
  `SS/cleanup/skill-backlog-cleanup.store.ts`.
- **Dependencies:** `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `TOKENS.LOGGER`.
- **Failure behaviour:** `read()` returns `null` on a missing table, after a warn, which makes the purge skip
  rather than run blind. It does not throw into the curator.
- **Verification seam:** `SS/lifecycle/skill-backlog-purge-state.store.spec.ts`.
- **Files:**
  - CREATE `SS/lifecycle/skill-backlog-purge-state.store.ts` (+ `.spec.ts`)
  - MODIFY `SS/di/tokens.ts` (`SKILL_BACKLOG_PURGE_STATE_STORE: Symbol.for('PtahSkillBacklogPurgeStateStore')`)
  - MODIFY `SS/di/register.ts`

### 5. `SkillMdGenerator` changes

- **Purpose:** materialize SKILL.md plus `references/` for umbrellas, and choose a slug that is free on disk
  **and** in the DB.
- **Responsibilities:**
  - `SkillMdInput` gains `references?: readonly SkillReference[]`.
  - `promoteToActive(input, candidatesDir?, options?: { isSlugTaken?: (slug) => boolean })`. `writeAtRoot`
    (`:209-237`) treats a slug as occupied when `fs.existsSync(dir) || isSlugTaken(chosen)`, keeping the `-2…-5`
    walk and the throw after the last attempt.
  - It writes each reference to `<dir>/references/<name>.md`. Reference names are re-validated with
    `/^[a-z0-9][a-z0-9-]{0,59}$/` at this filesystem boundary, and the write throws on a violation (defence in
    depth against path traversal from LLM output).
  - `removeActive` (`:205-207`) already removes the whole directory.
- **Verified contracts:** `writeAtRoot` `:209-237`; `sanitizeSlug` `:278-285`; `renderSkillMd` `:239-260`
  (`name: <chosen slug>`).
- **Failure behaviour:** throws on a slug exhaustion or an invalid reference name. Callers already treat a throw
  as `write-failed` (`skill-promotion.service.ts:322-353`) or as `accepted:false` (`skill-curator.service.ts:569-575`).
- **Quality requirements:** security: no path segment from model output reaches `path.join` unvalidated.
- **Verification seam:** `SS/skill-md-generator.spec.ts`:
  - the DB-taken slug is skipped (`foo` taken → `foo-2`);
  - references are written;
  - `../x` and `a/b` reference names throw;
  - `removeActive` removes `references/`.
- **Files:** MODIFY `SS/skill-md-generator.ts`, `SS/skill-md-generator.spec.ts`.

### 6. Clustering: `agglomerate` and `SkillClusteringService.partitionPool`

- **Purpose:** partition the lifecycle pool into clusters and orphans, cheaply.
- **Responsibilities:**
  - `agglomerate(embeddings, threshold)` is re-implemented as union-find over all pairs with
    `cosineSimilarity > threshold`, in one O(n²·d) sweep. The signature and the partition semantics stay the
    same (single linkage at `> threshold`). Labels follow A3.
  - `SkillClusteringService.partitionPool(settings, exclusions)` replaces `clusterCandidates`. It returns
    `{ vecAvailable, truncated, clusters: PoolMember[][], orphans: PoolMember[], unembedded: number }`, where
    `PoolMember = {kind:'candidate', row} | {kind:'promoted', row} | {kind:'suggestion', row, memberIds}`.
  - Pool contents:
    - `candidate` rows, newest first, capped at `suggestionMaxCandidates`, excluding ids in
      `exclusions.suggestionMemberIds`;
    - `pending` suggestions, embedded as the **centroid of their member candidates' embeddings** (skipped when
      no member has one);
    - `promoted` rows that are not pinned and whose `name` is not in `exclusions.exemptSlugs`.
  - Threshold: `settings.dedupClusterThreshold`. A cluster is a component of size ≥
    `settings.suggestionMinClusterSize`.
- **Verified contracts:**
  - `agglomerate` `SS/cosine-similarity.ts:33-71`;
  - `getEmbedding` `SS/skill-candidate.store.ts:1494-1497`;
  - `VecStatusService.available` (`SS/skill-clustering.service.ts:42`);
  - the second caller of `agglomerate`, `SS/skill-cluster-dedup.service.ts:93`.
- **Dependencies:** logger, `VEC_STATUS`, `SkillCandidateStore`, `SKILL_SUGGESTION_STORE`. It reads exempt slugs
  from its caller, so no registry dependency is needed.
- **Failure behaviour:** when vec is unavailable it returns `{vecAvailable:false, clusters:[], orphans:[]}`, and
  the umbrella pass then skips both umbrellas and the purge (R5 guard).
- **Quality requirements:** performance: 1000 points × 384 dims is about 1.9×10⁸ multiply-adds, roughly 0.2-0.4 s,
  run once per 24 h curator pass. Record one measurement in the test report and do not add a timing spec. No
  per-item timers.
- **Verification seam:**
  - `SS/cosine-similarity.spec.ts`: the partition is unchanged against the existing cases, and a chain
    `a~b~c` with `a≁c` is one component.
  - `SS/skill-clustering.service.spec.ts`: pending-suggestion centroids, pinned/exempt promoted rows excluded,
    suggestion members excluded, `truncated` flag set.
- **Files:**
  - MODIFY `SS/cosine-similarity.ts`, `SS/cosine-similarity.spec.ts`, `SS/skill-clustering.service.ts` and
    `SS/skill-clustering.service.spec.ts`
  - MODIFY `libs/backend/skill-synthesis/src/index.ts`. Update the `SkillCandidateCluster` export at `:143-144`
    to the new result type, or drop it if it has no external consumer (verify with `ptah_lsp_references`).

### 7. `SkillSynthesizerService.synthesizeUmbrella`

- **Purpose:** an LLM call that turns a cluster into one broad skill plus `references/` variants (user-requested,
  per `skill-creator`).
- **Responsibilities:**
  - `synthesizeUmbrella(members: UmbrellaMemberInput[], origin)` replaces `synthesizeFromCluster` (`:144-164`)
    and `buildClusterPrompt` (`:212-226`).
  - Members carry `{kind, description, body}`. At most `UMBRELLA_MAX_MEMBERS = 12` are passed (the caller
    picks those closest to the centroid). Each body is clipped by the existing `CLUSTER_MEMBER_MAX_CHARS`.
  - It uses its **own** system prompt constant `UMBRELLA_SYSTEM_PROMPT`. **It does not edit `buildSystemPrompt`**
    (`:228-249`), because that is the TASK_2026_473 Track B surface.
  - Output schema `UMBRELLA_SKILL_JSON_SCHEMA`:
    `{name, description, body, references: [{name, body}] (maxItems 8)}`.
  - Zod `UmbrellaSkillSchema` (project-rule: Zod at the LLM boundary):
    - `references[].name` must match `^[a-z0-9][a-z0-9-]{0,59}$`;
    - `references[].body` is 1..20000 chars;
    - `references` defaults to `[]`.
  - The lane plumbing in `runSynthesis` (`:172-210`) is generalised to take the schema and the Zod parser as
    parameters. The per-session `synthesize` path keeps passing the existing schema and parser.
- **Verified contracts:** `SynthesizedSkillSchema` `:56-60`; `SYNTHESIZED_SKILL_JSON_SCHEMA` `:68-77`;
  `laneRunner.run({laneId:'synthesis', …})` `:179-185`; parse `:276+`.
- **Failure behaviour:** every non-success returns `null`, exactly as `synthesizeFromCluster` does today. The
  umbrella pass skips the cluster and does not count it as a rate-limited attempt.
- **Verification seam:** `SS/skill-synthesizer.service.spec.ts` covers:
  - references parse;
  - an invalid reference name rejected (`null`);
  - `buildSystemPrompt` output byte-identical to before (a snapshot of the string, guarding Track B's surface).
- **Files:** MODIFY `SS/skill-synthesizer.service.ts`, `SS/skill-synthesizer.service.spec.ts`; MODIFY the
  barrel `index.ts:138-139` (`ClusterMemberInput` → `UmbrellaMemberInput`, if it is externally referenced).

### 8. `SkillUmbrellaMergeService` (new). Scope items 1, 2 (umbrella half) and 5

- **Purpose:** consolidate the pool. Synthesize umbrellas for clusters, surface judge-passed singletons, and run
  the one-time backlog purge.
- **Responsibilities:**
  1. Build the exclusions. `suggestionMemberIds` comes from `SkillSuggestionStore.listMemberCandidateIds()`.
     `exemptSlugs` comes from `registry.listAll()`, filtered to `kind='skill' AND clone_status IN
     ('authored','diverged')`. The caller passes these in (see Dependencies).
  2. `partitionPool`, then order clusters by size, descending.
  3. For each cluster, at most `SUGGESTION_MAX_CLUSTERS_PER_PASS = 3`, each gated by the `skill.analyze` rate
     limit (6/h), which is the existing constants and bucket at `skill-curator.service.ts:98-101, 449-458`:
     - Apply the authored-dominance guard, as now (`:434-448`).
     - Run `planClusterDraft` over the candidate and promoted members (the B3.6 hold-out is kept). Suggestion
       members are always drafted.
     - Call `synthesizeUmbrella`, then `judge.judge(...)`, as now (`:474-485`).
     - `unscored`/`disabled`: skip, and the next pass retries (unchanged policy, `:491-497`).
     - `scored < minJudgeScore` (Revision 1, R7): **commit transaction**:
       - insert a `dismissed` umbrella row (judge-rejected) carrying its score and `memberCandidateIds`;
       - `rejectIfStatus(id, 'candidate', 'below-judge-score:umbrella:'+sid)` for every candidate member;
       - leave promoted members and pending-suggestion members untouched.

       No member is left in limbo. The rejected candidates are decided, and the untouched members are already
       live skills or pending suggestions.
     - `scored ≥ minJudgeScore`: **commit transaction** (via `SkillCandidateStore.inImmediateTransaction`):
       - Re-read every member. Abort this umbrella if any candidate member is no longer `candidate` or any
         suggestion member is no longer `pending`. This covers a second host on the shared DB.
       - `suggestionStore.insert({…, references, memberCandidateIds = union(candidate ids, promoted ids, suggestion members' ids), memberSessionIds = draft.draftedSessionIds, clusterSize, technologyFingerprint, judgeScore}, 'pending')`.
       - `suggestionStore.markMerged(suggestionMemberIds, sid)`.
       - `candidateStore.rejectIfStatus(id, 'candidate', 'merged-into:'+sid)` for every member candidate, including
         the members of merged suggestions.
       - Promoted members are not touched (R2).
  4. **Singletons (R1).** For each orphan candidate with `judgeStatus='scored' && judgeScore ≥ minJudgeScore`, at
     most `SINGLETON_MAX_PER_PASS = 5`, insert a `pending` suggestion with no LLM call: body from its SKILL.md,
     `clusterSize = 1`, `memberCandidateIds = [id]`, `judgeScore` from the row.
  5. **One-time purge (scope 5).** It runs only if all of these hold: `purgeState.read() === null`,
     `vecAvailable`, and `!truncated`. Then, in one transaction:
     - re-check the marker;
     - `cutoff = now - 30 d` (user-requested constant `BACKLOG_PURGE_MIN_AGE_DAYS = 30`);
     - reject, via `rejectIfStatus(id, 'candidate', BACKLOG_PURGE_REASON)`, every **candidate** that meets all of
       these (R5 as narrowed in Revision 1):
       - `createdAt < cutoff`;
       - in no cluster this pass;
       - not a member of a **pending or accepted** suggestion, counting the ones created in steps 3-4;
       - has an embedding;
       - is not judge-passed.

       The purge reads a second set, `SkillSuggestionStore.listMemberCandidateIds({ statuses: ['pending','accepted'] })`,
       and members of dismissed suggestions are therefore eligible. Because those members were excluded from the
       pool, "in no cluster" holds for them by construction;
     - write the marker with the count.

     Otherwise it returns `purgeSkippedReason` (`'already-complete' | 'no-vec' | 'pool-truncated'`).
  6. Return `UmbrellaPassResult = { umbrellasCreated, umbrellasRejected, judgeRejectedMembers, singletonsSurfaced, candidatesMerged, suggestionsMerged, purged, purgeSkippedReason, clustersRemaining, rateLimited, mergedIds, purgedIds }`.
     `clustersRemaining` is the number of eligible clusters left unprocessed this pass, and `rateLimited` is true
     when the `skill.analyze` bucket stopped the loop (Revision 1, review F5)
     to the curator for its event stats and report.
- **Verified contracts:**
  - `planClusterDraft` (`SS/gates/cluster-holdout.ts:139`);
  - `CuratorRateLimitService.tryAcquire` (usage `skill-curator.service.ts:449-452`);
  - `judge.judge` signature (usage `:474-485`);
  - `getDominantSkillSlugForSessions` (`SS/skill-candidate.store.ts:1446-1463`);
  - `technologyFingerprint` and `readCandidateBody`, which move verbatim from `skill-curator.service.ts:669-699`.
- **Dependencies (8, all `@inject` explicit):**
  - `TOKENS.LOGGER`
  - `SkillCandidateStore`
  - `SKILL_SUGGESTION_STORE`
  - `SKILL_CLUSTERING_SERVICE`
  - `SKILL_SYNTHESIZER_SERVICE`
  - `SKILL_JUDGE_SERVICE`
  - `SDK_TOKENS.SDK_CURATOR_RATE_LIMIT`
  - `SKILL_BACKLOG_PURGE_STATE_STORE`

  The exempt slugs are passed in by the curator, which already holds the registry. This keeps the count at 8
  (project-rule guardrail). The service lives in `SS` and imports only `SS` and existing deps (agent-sdk type
  `CuratorRateLimitService` is already imported by the curator, `:55-58`), so the boundary lattice is unchanged.
- **Integration points:** called only by `SkillCuratorService.runPass` (component 10). Writes go through
  components 2, 3 and 4.
- **Failure behaviour:**
  - Each cluster is wrapped in a try/catch. A throw logs a warn and moves on, mirroring `:529-533`.
  - A commit-transaction failure rolls back that umbrella only.
  - A purge failure rolls back the purge with no marker written, so it retries next pass.
  - The service never throws into the curator.
- **Quality requirements:**
  - Performance: at most 3 LLM syntheses plus 3 judge calls per pass (unchanged budget). The singleton and
    purge steps are SQL only.
  - Security: model output reaches the filesystem only through component 5's validation, and only at accept.
- **Verification seam:** `SS/lifecycle/skill-umbrella-merge.service.spec.ts`, against a real migrated DB
  (`TestDatabase` harness as in `skill-candidate.store.spec.ts:23-60`) with a plain `skill_candidates_vec(rowid
  INTEGER PRIMARY KEY, embedding BLOB)` table. Cases:
  - cluster → pending umbrella plus members `merged-into:<sid>`;
  - pending suggestion merged → `dismissed`/`merged_into`;
  - promoted member untouched;
  - below threshold → `dismissed` umbrella, candidate members rejected `below-judge-score:umbrella:<sid>`,
    promoted and pending-suggestion members untouched (R7);
  - a member of a dismissed suggestion older than 30 days is purged, and a member of a pending suggestion is
    kept (R5, Revision 1);
  - `rejectIfStatus` returning `false` (row already decided by another writer) is skipped and not counted;
  - unscored → nothing written;
  - concurrent-merge abort;
  - singleton surfaced;
  - purge: old orphan rejected, young orphan kept, judge-passed kept, unembedded kept, marker written, second run
    no-op, `no-vec` and `pool-truncated` skip.
- **Files:** CREATE `SS/lifecycle/skill-umbrella-merge.service.ts` (+ `.spec.ts`); MODIFY `SS/di/tokens.ts`
  (`SKILL_UMBRELLA_MERGE_SERVICE`) and `SS/di/register.ts`.

### 9. `SkillPromotionService` changes. Scope item 3

- **Purpose:** one promotion contract for three entry points: automatic or manual (`runGatePipeline`), an
  accepted suggestion, and the reconcile of already-accepted suggestions.
- **Responsibilities:**
  1. **Automatic/manual path fix:**
     - `promoteToActive(..., { isSlugTaken: s => s !== candidate.name && store.findByName(s) !== null })`;
     - `promoteAtomically(id, {…, name: materialized.slug})`;
     - `emitRepropagation([demotedSlug, materialized.slug])`. Today it emits `candidate.name` (`:375`), which is
       wrong when the slug was suffixed.
  2. Extract the cap selection at `:272-302` into a private `selectWeakestResident(settings, nowFn)`. The
     automatic path and the new entries share it.
  3. NEW `promoteSuggestion(input: { suggestion, embedding: Float32Array | null }, settings, origin, onCommit: (row) => MergeOutcome)`:
     - selects the weakest resident;
     - materializes SKILL.md plus references with `isSlugTaken = s => store.findByName(s) !== null`;
     - then, inside `store.inImmediateTransaction`:
       - `registerCandidate({name: md.slug, description, bodyPath: md.filePath, sourceSessionIds: suggestion.memberSessionIds, trajectoryHash: 'suggestion:'+id, embedding, createdAt: now, workspaceRoot: null})`;
       - `promoteAtomically(row.id, {promotedAt, bodyPath, name: md.slug, demotedResidentId})`;
       - `registry.upsert({slug: md.slug, kind:'skill', userPath: md.filePath, cloneStatus:'synth', candidateId: row.id, …})`;
       - `onCommit(row)`.
     - On any throw it rolls back and runs `mdGenerator.removeActive(md)`, returning `{promoted:false, reason:'write-failed'}`.
     - On success it calls `emitRepropagation([demotedSlug, md.slug], origin)`.
     - It applies **no dedup or judge gates**: the user decided, and the suggestion was already judged. It
       **does** apply the cap, so "counters, the cap and retirement see it".
  4. NEW `adoptMaterializedSkill(input: { slug, filePath, description, sourceSessionIds, embedding, trajectoryKey }, settings, onCommit)`.
     This is the same transactional tail without materialization. It is used by the reconcile (component 10), and
     it skips the slug if `findByName(slug)` already belongs to a promoted row: it only links.
- **Verified contracts:**
  - `runGatePipeline` `:209-386`;
  - `emitRepropagation` `:402-423`;
  - `registerCandidate` `SS/skill-candidate.store.ts:188-230` (`trajectory_hash` UNIQUE; reuse on an equal hash);
  - `registry.upsert` `SS/skill-registry.store.ts:61-98`;
  - `SkillRegistryEntry` `:12-25`.
- **Dependencies:** unchanged (7; no new injection).
- **Integration points:** `SkillCuratorService.acceptSuggestion` and the reconcile; the RPC `skillSynthesis:promote`
  through `SkillSynthesisService.promote` (unchanged signature).
- **Failure behaviour:**
  - Filesystem write first. Then the DB in one transaction. On a DB failure the filesystem is removed (the same
    compensation as `:322-338`).
  - Repropagation failure never throws (`:402-423`).
- **Quality requirements:** the file grows from 784 lines to about 900. That is a deliberate look rather than an
  alarm (project-rule). The three entries share one tail, which avoids a fragment file.
- **Verification seam:** `SS/skill-promotion.service.spec.ts` and `SS/skill-promotion.repropagation.spec.ts`:
  - automatic promotion with a pre-existing `<activeRoot>/<name>/` stores `name = '<name>-2'`;
  - repropagates `-2`;
  - `promoteSuggestion` creates a promoted, resident row with registry `candidate_id` set;
  - cap demotion applies;
  - a UNIQUE or `onCommit` throw leaves no row and no directory.
- **Files:** MODIFY `SS/skill-promotion.service.ts`, `SS/skill-promotion.service.spec.ts`,
  `SS/skill-promotion.repropagation.spec.ts`.

### 10. `SkillCuratorService` rework (facade). Scope items 1, 3 and 4 orchestration

- **Purpose:** it remains the scheduler and facade for every curator-hosted lifecycle pass.
- **Responsibilities:**
  - `runPass` order:
    1. `retirement.run(origin)`;
    2. `umbrella.run(settings, origin, exemptSlugs)`;
    3. `runEnhancementPass` (unchanged, `:701-789`);
    4. `writeReport` rewritten to list the actions applied (merged ids, dormant and retired slugs, purged count,
       pinned skipped);
    5. the `curator-pass` event with stats
       `{suggestionsCreated, umbrellasCreated, umbrellasRejected, judgeRejectedMembers, singletonsSurfaced, merged, dormant, retired, purged, purgeSkippedReason, clustersRemaining, rateLimited, skippedPinned}`.

    The "0 promoted → skip" early return (`:245-265`) and the LLM overlap review (`:266-356`) are removed.
  - `CuratorReport` keeps `{reportPath, changesQueued, skippedPinned, suggestionsCreated}`.
    - `changesQueued` = merged + dormant + retired + purged.
    - `suggestionsCreated` = umbrellas + singletons.
    - `overlaps` is dropped, since the RPC already omits it (`skills-synthesis-rpc.handlers.ts:665-670`).
  - `acceptSuggestion(id, settings, origin)` keeps its public signature (RPC `:1546-1567`):
    - load the pending suggestion;
    - compute the member embedding centroid;
    - call `promotion.promoteSuggestion(..., onCommit)`. The `onCommit` callback runs:
      - `suggestionStore.accept(id, row.id)`;
      - for every `memberCandidateIds` row with status `candidate` or `promoted` and `!pinned`:
        `store.rejectIfStatus(id, row.status, 'merged-into:'+suggestion.id)` (the conditional write, review F4);
      - `registry.remove('skill', slug)` for each merged promoted member, inside the same transaction
        (Revision 1, review F3; see component 11);
      - collect the promoted ones whose conditional write returned `true`.
    - After the commit, call `retirement.removeMaterializations(mergedPromoted, origin)`.
    - Return `{accepted, filePath}`.
  - NEW private `reconcileAcceptedSuggestions()`, called at the top of `start()`, **before** the
    `curatorEnabled` early return (`:195-198`). It is data repair, not curation.
    - For each `listAcceptedWithoutPromotedCandidate()` row, find the registry row `kind='skill'` whose slug
      matches A1's rule.
    - Run `promotion.adoptMaterializedSkill(...)` with an `onCommit` that does `suggestionStore.accept`-lineage
      (`promoted_candidate_id`) plus the same member merge.
    - When a slug is ambiguous or missing, log a warn and leave the row for the next start.
    - Idempotent: it selects only rows with `promoted_candidate_id IS NULL`.
  - Removed deps: `laneRunner`, `clustering`, `synthesizer`, `judge`, `mdGenerator`, `repropagation`, `workspace`.
  - Added: `SKILL_UMBRELLA_MERGE_SERVICE`, `SKILL_RETIREMENT_SERVICE`, `SKILL_PROMOTION_SERVICE`.
  - The total is 9: logger, store, rateLimiter (enhancement), registry, enhancer, suggestionStore, umbrella,
    retirement, promotion. This is down from 13. 9 sits one over the ~8 guidance. It is accepted because the
    split removed 4 and every remaining dependency is used by a public method.
- **Verified contracts:**
  - `start` `:188-213`;
  - `runManual` `:229-237`;
  - `runPass` `:239-382`;
  - `acceptSuggestion` `:547-606`;
  - `onEvent` stats type `:135-139`;
  - `SkillSynthesisService.start` calls `curator.start` at `SS/skill-synthesis.service.ts:399-409`;
  - the frontend live service reads only `stats.suggestionsCreated`
    (`libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-live.service.ts:113`).
- **Failure behaviour:**
  - Each sub-pass is wrapped in a try/catch and logs `[skill-curator]` warns. One failing pass does not stop
    the others.
  - Accept returns `{accepted:false}` on any promotion failure. The suggestion stays pending, so the user can
    retry.
  - The reconcile never throws out of `start()`.
- **Quality requirements:** the file shrinks from 877 lines to about 550.
- **Verification seam:** `SS/skill-curator.service.spec.ts` is rewritten for the new collaborators:
  - pass order;
  - accept delegates and merges members, and promoted members' directories are removed through retirement;
  - a pinned member is skipped;
  - reconcile links an `authored` or `synth` registry row with a suffixed slug;
  - reconcile is a no-op on a second start.
- **Files:** REWRITE `SS/skill-curator.service.ts`, `SS/skill-curator.service.spec.ts`; MODIFY
  `libs/backend/skill-synthesis/src/index.ts:160` only if the curator type exports change.

### 11. `SkillRetirementService` (new). Scope item 4

- **Purpose:** usage-based dormancy and retirement, and the only remover of an active SKILL.md for a decided row.
- **Responsibilities:**
  - `run(origin, now = Date.now())`:
    - Read N and M via the workspace port: `ptah` section, keys `skillSynthesis.retirement.dormantAfterDays` and
      `skillSynthesis.retirement.retireAfterDormantDays`. Validate each with Zod
      `z.number().int().min(1).max(3650)`; on a safeParse failure, use the default 30 (project-rule: Zod at
      the file-settings boundary; precedent `skill-promotion.service.ts:502-519`).
    - Exempt rows that are `row.pinned`, or whose `row.name` is in registry `kind='skill'` with `clone_status IN
      ('authored','diverged')` (user-requested: pinned and user-authored; `diverged` architect-proposed as
      user-edited content).
    - For each `listPromotedLastUse()` row: `idleDays = (now - lastUsedAt)/86_400_000`.
      - `idleDays ≥ N + M`: **retire**.
        - Remove `path.dirname(row.bodyPath)`, but only if it resolves inside `mdGenerator.activeRoot()` and
          its basename equals `row.name`. Otherwise skip the filesystem step and warn.
        - Then, in one `store.inImmediateTransaction` (Revision 1, review F3/F4):
          - `store.rejectIfStatus(id, 'promoted', RETIRED_UNUSED_REASON)`;
          - if that returns `true`, `registry.remove('skill', row.name)`. The delete is guarded
            `WHERE kind = ? AND slug = ? AND clone_status = 'synth'`, so an authored or diverged row is never
            touched. Those slugs are exempt anyway, and the guard is defence in depth.
        - The filesystem goes first so a crash self-heals: `rmSync` with force is idempotent, and the DB move is
          retried next pass.
        - **Registry fate (review F3), verified.** The catalog sync only upserts rows for clones that exist
          (`skill-registry-catalog.service.ts:51-86`), and `SkillRegistryStore` has no delete today
          (`skill-registry.store.ts:61-187`). Without an explicit delete, the `synth` row would keep a `user_path`
          to a removed directory and a `candidate_id` pointing at a rejected row. Deleting it in the same
          transaction as the status change means no catalog consumer ever reads a retired skill. If the
          user-layer clone outlives the source as `orphaned: true` (an enhanced clone, see A2), the next catalog
          sync re-inserts a row for that clone. `findByName` then resolves to the retired row, so the row is
          labelled `synth` again. That is accurate, because the clone is a stale synth copy the user chose to
          keep, and the reaper's orphan flag is what surfaces it.
        - User-layer clone fate is covered by A2 (verified): it is reaped at the latest at the next activation.
      - `N ≤ idleDays < N + M` and `residency='resident'`: `store.setResidency(id,'dormant')`.
      - There is no automatic re-residency (one-way, as specified).
    - Repropagate every changed slug once, after the loop (pattern `skill-promotion.service.ts:369-375`).
    - Return `{dormant, retired, skippedPinned, skippedExempt, dormantSlugs, retiredSlugs}`.
  - `removeMaterializations(rows, origin)`: the same safe directory removal plus repropagation, used by accept
    for merged promoted members. Their registry rows were already deleted inside the accept transaction
    (component 10).
  - NEW `SkillRegistryStore.remove(kind, slug, onlyCloneStatus: CloneStatus = 'synth'): boolean` (Revision 1)
    runs one parameterized `DELETE … WHERE kind = ? AND slug = ? AND clone_status = ?` and returns
    `changes === 1`. It is a plain statement, so it joins the caller's transaction (component 2 item 2).
- **Verified contracts:**
  - `skill_registry` PK `(kind, slug)` `persistence-sqlite/src/lib/migrations/0022_skill_registry.ts:2-17`;
    `upsert` `SS/skill-registry.store.ts:61-98`; catalog upsert-only `SS/skill-registry-catalog.service.ts:51-86`;
  - mirror reap `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:470-519`,
    `user-layer-orphan-reaper.ts:1-38`;
  - `setResidency` `SS/skill-candidate.store.ts:448-460`;
  - `updateStatus` `:585-635`;
  - `activeRoot()` `SS/skill-md-generator.ts:129-131`;
  - `SkillRepropagationPort` `SS/skill-repropagation.port.ts`;
  - `registry.listAll` `SS/skill-registry.store.ts:108-114`.
- **Dependencies (6, explicit `@inject`):**
  - `TOKENS.LOGGER`
  - `SkillCandidateStore`
  - `SKILL_REGISTRY_STORE` (optional)
  - `SkillMdGenerator`
  - `SKILL_REPROPAGATION_TOKEN` (optional)
  - `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (optional)
- **Integration points:** `SkillCuratorService.runPass` and `acceptSuggestion`.
- **Failure behaviour:**
  - A failure on one row is logged and skipped, and the loop continues.
  - Missing settings use the defaults.
  - A missing registry means pinned-only exemption, after a warn. This is the same fail-soft shape as
    `authoredSlugs()` (`skill-promotion.service.ts:621-632`).
- **Quality requirements:**
  - Security: the path containment check above.
  - Performance: one aggregate query plus a write per changed row.
- **Verification seam (acceptance 3):** `SS/lifecycle/skill-retirement.service.spec.ts`, against a real migrated
  DB with a temporary active root. With N=30 and M=30:
  - a skill unused for 29 days stays resident;
  - at 30 days it is dormant;
  - at 60 days it is retired: its directory is removed, `rejected_reason='retired:unused'`, and its `synth`
    registry row is deleted (review F3);
  - a retirement whose `rejectIfStatus` loses a race keeps the registry row (the transaction writes nothing);
  - a pinned skill at 100 days is untouched;
  - an `authored`-slug skill is untouched;
  - an event at day 50 resets the clock;
  - a `bodyPath` outside the root is not deleted;
  - invalid settings use the defaults.
- **Files:** CREATE `SS/lifecycle/skill-retirement.service.ts` (+ `.spec.ts`); MODIFY `SS/di/tokens.ts`
  (`SKILL_RETIREMENT_SERVICE`), `SS/di/register.ts`, and `SS/skill-registry.store.ts` plus
  `SS/skill-registry.store.spec.ts` (`remove`; the guarded delete leaves authored and diverged rows untouched).

### 12. Judge-panel stage gate. Scope item 2 (candidate half)

- **Purpose:** the panel's verdict changes state.
- **Responsibilities:**
  - In `runJudgePanelStage`'s `case 'scored'` (`SS/queue/stage-handlers.service.ts:541-546`): when
    `result.verdict.score !== null && result.verdict.score < settings.minJudgeScore`, call
    `this.store.rejectIfStatus(candidate.id, 'candidate', 'below-judge-score')` (Revision 1, review F4). This
    is the same reason token as `skill-promotion.service.ts:582-584`, so one threshold drives both. If it returns
    `true`, return `done` with reason `${result.reason}:rejected`. If it returns `false`, return `done` with reason
    `${result.reason}:not-candidate`.
  - At or above the threshold: no status change. The candidate becomes umbrella or singleton material (R1).
  - The threshold source is `workers.readSettings().minJudgeScore` only. When TASK_2026_473 Track B lands, it
    replaces the rubric inside `SkillJudgeService` and the default at `skill-synthesis.service.ts:145`, and
    nothing here changes.
- **Verified contracts:** `gateTarget` (skips already-rejected candidates) `:477-485`; the store in the stage
  handlers (`this.store.findById` `:483`); `settings` read at `:529`.
- **Failure behaviour (Revision 1):** the race in which another host promotes the candidate between this
  stage's claim and its write is closed by the compare-and-set `WHERE id = ? AND status = 'candidate'`. No
  read-then-write remains, and a promoted row can never be rejected by this gate. The `false` result is the
  `…:not-candidate` outcome above.
- **Verification seam:** `SS/skill-synthesis.stage-handlers.spec.ts`: below → rejected, at threshold → unchanged,
  promoted meanwhile → unchanged.
- **Files:** MODIFY `SS/queue/stage-handlers.service.ts`, `SS/skill-synthesis.stage-handlers.spec.ts`.

### 13. Settings registration and the pool default

- **Purpose:** declare N and M, and lift the pool ceiling.
- **Responsibilities:**
  - Add `skillSynthesis.retirement.dormantAfterDays` and `skillSynthesis.retirement.retireAfterDormantDays` to
    `FILE_BASED_SETTINGS_KEYS` (near `:241-244`) and to `FILE_BASED_SETTINGS_DEFAULTS` (near `:530-533`), with
    value 30 each.
  - Change the `skillSynthesis.suggestionMaxCandidates` default from 200 to 1000 at
    `platform-core/src/file-settings-keys.ts:533` and `SS/skill-synthesis.service.ts:153`.
  - **Revision 1:** the cosmetic form initial value at `skill-synthesis-tab.component.ts:799` is **not** changed.
    TASK_2026_586 edits that file. The form is overwritten by the loaded settings, so the literal `200` there
    has no effect, and leaving it removes one 586 collision.
  - The `skill-synthesis.service.ts` edit is the single literal at `SETTINGS_DEFAULTS` `:153`. It does not touch
    `recentEvents`, which 586 edits.
  - Update the docs table at `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md:42`, and add rows for
    the two new keys.
  - The Zod range for the RPC setting (`skills-synthesis-rpc.schema.ts:91`, 1..5000) is unchanged.
- **Failure behaviour:** not applicable (static registration).
- **Verification seam:** `platform-core` `file-settings-keys.spec.ts` (any key/default parity assertion), and
  the `rpc-handlers` schema spec stays green.
- **Files:** MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`, `SS/skill-synthesis.service.ts`,
  `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`.

### 14. Diagnostics and RPC wiring. Scope item 6 and acceptance 2 and 4

- **Purpose:** show the lifecycle counts and slug-joined invocations.
- **Responsibilities:**
  - `SS/diagnostics.types.ts:39-44` `SkillCandidateStatusCounts` gains `active`, `dormant`, `merged` and
    `retired`. `SS/diagnostics.service.ts:47-62` `readStats` maps them, with zero fallbacks.
  - `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:239-250` `SkillDiagnosticsResult` gains
    `readonly totalMerged: number; readonly totalRetired: number; readonly totalDormant: number;`.
  - RPC handler `skills-synthesis-rpc.handlers.ts`:
    - `skillSynthesis:stats` (`:510-516`): `activeSkills = s.active`, and `totalInvocations = s.invocations`
      (now slug-joined events).
    - `skillSynthesis:diagnostics` (`:700-708`): the same, plus the three new fields.
    - `skillSynthesis:invocations` (`:490-500`): `store.listInvocationEvents(skillId, limit)`.
    - There are no new RPC methods, so no `ALLOWED_METHOD_PREFIXES` change.
  - **Minimal-edit rule for the 586-shared files (Revision 1):**
    - In `skills-synthesis-rpc.handlers.ts`, edit only the three method bodies named above (`:486-522` and
      `:695-731`). 586 edits the `recentEvents` mapping inside the diagnostics method (`:714-720`), so do not
      touch those lines. Add the three new fields after `activeSkills` in the returned object.
    - In `rpc-curator-diagnostics.types.ts`, append three fields to `SkillDiagnosticsResult` and change nothing
      else.
- **Verified contracts:** the handler lines above; `SkillSynthesisStatsResult` (`libs/shared/src/lib/types/rpc.types.ts:2766-2772`), unchanged shape.
- **Failure behaviour:** unchanged `this.report(...)` and rethrow.
- **Verification seam:** `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts`:
  - mapping of the new fields;
  - `activeSkills` is resident-only;
  - `invocations` maps to events.
- **Files:** MODIFY `SS/diagnostics.types.ts`, `SS/diagnostics.service.ts`, `SS/diagnostics.service.spec.ts`,
  `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` and its `.spec.ts`.

### 15. Frontend: diagnostics counters and the post-accept refresh

- **Purpose:** the UI shows Merged, Retired and Dormant, and Promoted/Active rise immediately after accept.
- **Revision 1 retarget (review F1):** TASK_2026_586 removes
  `components/diagnostics/skill-diagnostics-accordion.component.ts` and moves its "Candidates by status" rows
  into `components/skill-pipeline-status.component.ts`, which exists on this branch: class at `:276`, inputs at
  `:277-293`, input-driven and OnPush. This component therefore **rebases on 586** and edits 586's version of
  that file. It does not touch the accordion.
- **Responsibilities:**
  - `skill-diagnostics-state.service.ts` (shared with 586; minimal edit):
    - `SkillByStatusCounts` (`:28-34` on this branch) gains `totalMerged`, `totalRetired` and `totalDormant`;
    - the default (`:49-55`) gains zeros;
    - `applySnapshot` (`:186-196`) gains three `?? 0` lines.
    - Nothing else in the file changes.
  - `skill-pipeline-status.component.ts`: three more stat cells (Merged, Retired, Dormant) beside the by-status
    rows that 586 moves there. They read the by-status input 586 introduces, which is fed from
    `SkillDiagnosticsStateService.byStatus` and has the type `SkillByStatusCounts`. The cells use the same markup
    pattern, OnPush and signal inputs (project-rule: Angular conventions).
    - If 586's input is not typed `SkillByStatusCounts`, extend whatever by-status input type it uses with the
      same three fields.
    - **No edit to `skill-synthesis-tab.component.ts` is needed**, because the tab already binds the whole
      by-status object. If 586 binds individual fields instead, add the three bindings there. That is the only
      permitted tab edit, and it must be listed in the batch notes.
  - `skill-synthesis-state.service.ts` `accept` (`:433-445`): `await this.loadStats()` after
    `refreshSuggestions()`. 586 does not edit this file.
- **Verified contracts:**
  - `loadStats` `skill-synthesis-state.service.ts:331`;
  - `SkillDiagnosticsResult` (component 14);
  - `SkillPipelineStatusComponent` `components/skill-pipeline-status.component.ts:276-293` on this branch.
  - The post-586 by-status input is an **Assumption** until 586 merges. Check it by reading 586's version of the
    file after rebasing.
- **Failure behaviour:** the existing `error` signal path.
- **Quality requirements:** accessibility: each new cell follows the existing label and value pairs, inside the
  section that carries an `aria-label`.
- **Verification seam:**
  - `skill-pipeline-status.component.spec.ts` (586's version) renders the three counts;
  - `skill-synthesis-state.service.spec.ts` checks that accept calls stats;
  - the existing `skill-diagnostics-state.service.spec.ts` maps the new fields.
- **Files:** MODIFY
  - `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts` (+ spec)
  - `.../components/skill-pipeline-status.component.ts` (+ spec), on top of 586
  - `.../services/skill-synthesis-state.service.ts` (+ spec)

### 16. Lifecycle reachability spec. Acceptance 5

- **Purpose:** each new pass fails a spec if production stops calling it.
- **Responsibilities:** CREATE `SS/skill-lifecycle.reachability.integration.spec.ts`, modelled on
  `SS/skill-synthesis.reachability.integration.spec.ts:57-245`. It runs with production DI
  (`registerSkillSynthesisServices`), real SQLite, a fake lane, and the settings below.
  - **Settings:**
    - `curatorEnabled: true`, `curatorIntervalHours: 1`;
    - `retirement.*: 30/30`;
    - `VEC_STATUS {available:true}`, with a plain `skill_candidates_vec(rowid INTEGER PRIMARY KEY, embedding
      BLOB)` created after `openAndMigrate`.
  - **Seed** (before `synthesis.start()`):
    - 3 candidates with an identical embedding;
    - 1 orphan candidate created 40 days ago with an orthogonal embedding;
    - promoted skills idle for 45 days, 100 days, and 100 days pinned;
    - one promoted skill with a recent `skill_invocation_events` row;
    - one accepted suggestion, plus a `synth` registry row with `candidate_id NULL`, plus its SKILL.md under the
      temporary active root.
  - **Proofs, each through a production entry:**
    1. `synthesis.start()` → curator `start` → reconcile: the accepted suggestion now has `promoted_candidate_id`,
       and the registry `candidate_id` equals a promoted row whose `name` equals the slug. **Fails if the
       reconcile is not called from `start`.**
    2. Advance only `setInterval` by 1 h (`jest.useFakeTimers({ doNotFake: ['setTimeout','setImmediate','nextTick','queueMicrotask','Date'] })`)
       → `runPass`. Bounded-poll for:
       - a pending umbrella with 3 members `merged-into:<sid>`;
       - the 40-day orphan rejected with `BACKLOG_PURGE_REASON`, and the purge marker written;
       - the 45-day skill dormant;
       - the 100-day skill retired, with its directory gone and its `synth` registry row deleted;
       - the pinned skill untouched;
       - the recently used skill still resident.

       **Fails if `curator.start` does not schedule `runPass`, or if `runPass` omits the umbrella, purge or
       retirement call.**
    3. Accept via `SKILL_CURATOR_SERVICE.acceptSuggestion` with an active-root directory pre-created at the
       umbrella's slug:
       - the new promoted row has `name = '<slug>-2'`;
       - `getStats().promoted` and `.active` rise by 1;
       - an inserted `skill_invocation_events` row for `'<slug>-2'` is counted and one for `'<slug>'` is not
         (acceptance 4, collision suffix).
    4. Drain the `weekly` tier with a `judge-panel` row for a fresh candidate while the fake judge returns 3s:
       the candidate becomes `rejected` with `below-judge-score`. **Fails if the stage handler records without
       deciding.**
  - The RPC layer (`skillSynthesis:acceptSuggestion` → `curator.acceptSuggestion`) is pinned by the existing
    rpc-handlers spec. Component 14 adds the stats assertions.
- **Verification seam:** this spec is the seam.
- **Files:** CREATE `SS/skill-lifecycle.reachability.integration.spec.ts`; MODIFY
  `SS/skill-synthesis.reachability.test-support.ts` only to add a `seedVecTable(db)` helper if it is reused.

---

## Integration architecture

### Data flow

1. **Runtime (unchanged):** a Skill tool use or prompt expansion goes to
   `SkillTriggerService.recordInvocation` (`skill-trigger.service.ts:615-683`), which writes
   `skill_invocation_events(skill_slug)`.
2. **Queue:** prefilter → `judge-panel` row (`stage-handlers.service.ts:415-427`) → weekly drain →
   `runJudgePanelStage` → panel verdict persisted → **below the threshold, `rejectIfStatus(candidate → rejected)`**.
3. **Boot:** `SkillSynthesisService.start()` → `curator.start()`:
   1. `reconcileAcceptedSuggestions()` → `promotion.adoptMaterializedSkill` (transaction: candidate row with
      `name=slug`, registry `candidate_id`, suggestion lineage, member merge);
   2. then, if `curatorEnabled`, `setInterval(runPass)`.
4. **`runPass`:**
   1. `retirement.run` → `listPromotedLastUse` (events by slug) → dormant (`setResidency`) or retired
      (filesystem rm, then one transaction: `rejectIfStatus` plus `registry.remove`) → repropagate.
   2. `umbrella.run` → `partitionPool` (candidates + pending-suggestion centroids + non-exempt promoted) → per
      cluster: synthesize → judge.
      - Below the threshold: a `dismissed` umbrella.
      - At or above: transaction (insert the pending umbrella, merge suggestions, merge candidates).
   3. Singletons → pending suggestions.
   4. One-time purge (transaction plus marker).
   5. Enhancement (unchanged).
   6. Report file plus `curator-pass` event.
5. **Accept (RPC):** `skillSynthesis:acceptSuggestion` → `curator.acceptSuggestion` →
   `promotion.promoteSuggestion`:
   1. cap selection;
   2. filesystem materialize (DB-aware slug, references);
   3. transaction: register, promote with `name=md.slug`, registry upsert with `candidate_id`, suggestion
      accepted with `promoted_candidate_id`, members `merged-into:<sid>`;
   4. repropagate;
   5. `retirement.removeMaterializations(merged promoted members)`.
6. **Read:** `skillSynthesis:stats`/`diagnostics` → `getStats()` (lifecycle counts plus slug-joined events) →
   shared DTO → `SkillDiagnosticsStateService` / stats strip. Accept triggers `loadStats()`.

### State and persistence

- `skill_candidates` remains the lifecycle source of truth. Status writes go only through `updateStatus`, `rejectIfStatus` and
  `promoteAtomically`.
- `skill_suggestions` gains lineage.
- `skill_backlog_purge_state` holds one row, written once.
- Filesystem: `<activeRoot>/<slug>/SKILL.md` and `references/` are created only by promotion and removed only by
  promotion rollback or by `SkillRetirementService`.
- The DB is shared by every host on the machine (`~/.ptah/state/ptah.sqlite`). Every multi-row decision
  re-validates inside `BEGIN IMMEDIATE`.

### External boundaries

- LLM output (umbrella JSON): Zod in the synthesizer, plus a filename regex at the filesystem write.
- File-based settings (N, M): Zod `safeParse` with defaults.
- RPC: no new params. Outbound DTO only.
- Filesystem deletes: containment inside `activeRoot` and a basename check.

### Failure and rollback

- **Accept:** filesystem first, DB transaction second. A DB failure removes the materialized directory, and the
  suggestion stays pending.
- **Umbrella:** LLM failure skips the cluster. A transaction failure rolls back that umbrella. A concurrent host
  aborts through re-validation.
- **Retirement:** filesystem remove first (idempotent), DB second. A partial failure self-heals next pass.
- **Purge:** all-or-nothing transaction with the marker. A skip writes no marker.
- **Reconcile:** per row. An ambiguous slug is a warn plus a retry at the next start.
- **Curator:** each sub-pass is isolated in a try/catch. `runPass` never rejects into `setInterval`. The
  existing `.catch` is at `skill-curator.service.ts:207-211`.

### Observability

- `[skill-curator]` and `[skill-lifecycle]` log lines through `TOKENS.LOGGER` (output channel).
- The `curator-pass` event stats feed the Activity feed (`skill-synthesis-live.service.ts:113`).
- The rewritten `~/.ptah/curator-reports/<ts>.md` lists every merged, retired, dormant and purged id. This is
  the audit trail for destructive actions.
- The diagnostics counters cover merged, retired and dormant.

---

## Architecture-level quality requirements

- **Functional:**
  - Acceptance 1: one pass on a DB copy reduces the set by `merged + purged`, as reported in the curator-pass
    stats and diagnostics.
  - Acceptance 2: Promoted and Active rise by 1 per accept, with the UI refreshed.
  - Acceptance 3: the retirement spec.
  - Acceptance 4: event counting by `skill_candidates.name`, including a `-2` slug.
  - Acceptance 5: the reachability spec.
- **Performance:**
  - At most 3 umbrella syntheses plus 3 judge calls per 24 h pass (unchanged LLM budget). The LLM overlap
    review is removed, which saves 1 call per pass.
  - The pool partition is O(n²·d) once per pass.
  - No new timers, intervals or watchers.
- **Security:**
  - Filesystem writes and deletes are confined to `activeRoot`.
  - LLM-supplied reference names are validated twice.
  - All SQL is parameterized. The `IN (…)` lists are built from `?` placeholders only, as in
    `skill-candidate.store.ts:1350`.
  - Migration SQL is static.
- **Maintainability:**
  - No new status values.
  - No second writer of `skill_candidates.status`.
  - The curator shrinks.
  - New services pass the nameability test (`SkillUmbrellaMergeService`, `SkillRetirementService`,
    `SkillBacklogPurgeStateStore`).
  - No new library and no new cross-library edge.
  - Track B's prompt surface is untouched, and that is pinned by a snapshot.
- **Testability:** every behaviour above has a real-SQLite spec. The reachability spec drives only production
  entry points.

### Rule tags

| Rule | Source | Tag |
| --- | --- | --- |
| Members marked `merged-into:<id>`, leave Recommended | context.md scope 1 | user-requested |
| SKILL.md + `references/` per skill-creator | context.md scope 1 | user-requested |
| Gate = current rubric, `minJudgeScore` 6.0, replaced by Track B | context.md scope 2 | user-requested |
| `name = md.slug`, registry `candidateId`, store slug in `promoteAtomically`, backfill | context.md scope 3 | user-requested |
| Join on `skill_invocation_events.skill_slug`; N/M settings; pinned and user-authored exempt | context.md scope 4 | user-requested |
| 30-day one-time purge | context.md scope 5 | user-requested |
| Merged, retired and dormant counts in diagnostics | context.md scope 6 | user-requested |
| Migration number ≥ 0051 | caller | user-requested |
| 700-line ceiling, facade rule, ~8-dependency guardrail | `eslint.config.mjs:474-519`; `git show 7917b193a^:CLAUDE.md:168` | project-rule |
| Layer lattice / Nx boundaries | `CONVENTIONS.md:121-137`; `eslint.config.mjs:254-400` | project-rule |
| Output-channel logging (`TOKENS.LOGGER`) | `vscode-core/src/logging/logger.ts:72-75` | project-rule |
| Zod at external boundaries (LLM output, file settings) | `git show 7917b193a^:CLAUDE.md:162` | project-rule |
| Explicit `@inject` on every constructor parameter | `SS/cleanup/skill-backlog-cleanup.service.ts:83-101` | project-rule |
| Static migration SQL | `migrations/index.ts:14-18` | project-rule |
| `rejected` + structured reason instead of new statuses | `0003_skills.ts:18`, `0033:21-25` | architect-proposed |
| R1 singleton surfacing; R2 merge timing; R3 suggestion-id target; R4 file-based N/M (defaults 30/30); R5 purge exemptions; R6 pool default 1000; R7 judge-rejected umbrella rejects its candidate members (Revision 1); `rejectIfStatus` compare-and-set and `SkillRegistryStore.remove` on retirement (Revision 1) | this plan | architect-proposed |
| Remove the LLM overlap review; union-find `agglomerate`; delete `listActiveOrderedByActivity`/`listInvocations` | this plan | architect-proposed |
| Exempt `diverged` registry slugs from retirement | this plan | architect-proposed |

---

## Cross-session collisions

**Merge order (from `context.md` `## Cross-session coordination`).**
- Migration `0051_skill_lifecycle` is agreed, and TASK_2026_580 keeps `0050_session_organization`.
- Either merge order works at runtime, because the runner reads applied versions as a set
  (`migration-runner.ts:76-87`).
- Whoever merges second rebases the `index.ts` order and the 12 version asserts to the higher number.
- **Tell the coordinator before the migration commit.**
- This task **rebases on TASK_2026_586** before its frontend batch and before the edits to the 586-shared backend
  files.

| File | Other session | This plan's edit (kept minimal) | Handling |
| --- | --- | --- | --- |
| `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` | TASK_2026_580 (adds `0050_session_organization`) | **Must touch:** one import and one `{version: 51, name: '0051_skill_lifecycle', sql}` entry | Append-only. Keep both entries in ascending order on rebase. |
| 12 latest-version specs `migrations/00{28,30,38,39,40,41,42,43,44,45,46,47}_*.spec.ts` (10 × `toBe(49)`; `0044:67-69` and `0046:32-34` are arrays) | TASK_2026_580 bumps to 50 with `// 50 since TASK_2026_580 appended 0050_session_organization.` | Bump to 51, add 51 to the two arrays, and add a `// 51 since TASK_2026_578 appended 0051_skill_lifecycle.` line beside 580's | The second to merge rebases to the higher number. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-diagnostics-accordion.component.ts` | TASK_2026_586 **removes** it | **Not edited** (Revision 1) | The counters go to `skill-pipeline-status.component.ts` instead. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts` | TASK_2026_586 moves the accordion's rows here | Three stat cells (Merged, Retired, Dormant) and, if needed, three fields on its by-status input type | Edit 586's version after rebasing. |
| `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts` | TASK_2026_586 | Three fields on `SkillByStatusCounts`, three default zeros, three `?? 0` lines in `applySnapshot` | Edit after rebasing on 586. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts` | TASK_2026_586 | **No edit by default** (the form-default change was dropped). There are three bindings only if 586 binds by-status fields individually. | Listed so a reviewer can confirm that no edit, or only the conditional one, landed. |
| `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` | TASK_2026_586 (`recentEvents`) | One literal: `SETTINGS_DEFAULTS.suggestionMaxCandidates` 200 → 1000 (`:153`) | Disjoint from `recentEvents`. |
| `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` | TASK_2026_586 (diagnostics `recentEvents` mapping, `:714-720`) | The bodies of `skillSynthesis:invocations` and `skillSynthesis:stats`, plus the count fields of `skillSynthesis:diagnostics` (`:486-522`, `:695-713`) | Do not touch `:714-720`. Rebase on 586 first. |
| `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` | TASK_2026_586 | Append `totalMerged`, `totalRetired` and `totalDormant` to `SkillDiagnosticsResult` | Append-only. Rebase on 586 first. |

No file in `libs/backend/agent-sdk`, `libs/backend/cli-agent-runtime`, the rpc-handlers session/chat handlers,
`libs/frontend/chat-state`, `libs/frontend/chat` or the sessions sidebar is edited. The agent-sdk import (the
`CuratorRateLimitService` type) already exists and is unchanged. `libs/backend/platform-core/src/file-settings-keys.ts`
is commonly edited but is not claimed by another session. Its edit is append-only plus one default literal.

---

## Files to Create/Modify

### CREATE

- `libs/backend/persistence-sqlite/src/lib/migrations/0051_skill_lifecycle.ts`
- `libs/backend/persistence-sqlite/src/lib/migrations/0051_skill_lifecycle.spec.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-umbrella-merge.service.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-umbrella-merge.service.spec.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.spec.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-backlog-purge-state.store.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-backlog-purge-state.store.spec.ts`
- `libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts`

### MODIFY (backend)

- `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
- The 12 latest-version specs in `libs/backend/persistence-sqlite/src/lib/migrations/`:
  `0028_gateway_conversation_workspace_root.spec.ts`, `0030_skill_event_metrics.spec.ts`,
  `0038_gateway_message_turn_state.spec.ts`, `0039_reap_orphaned_queue_rows.spec.ts`,
  `0040_skill_candidate_workspace_root.spec.ts`, `0041_skill_md_migration_state.spec.ts`,
  `0042_db_integrity_check_state.spec.ts`, `0043_memory_retention.spec.ts`, `0044_memory_lifecycle.spec.ts`,
  `0045_skill_backlog_cleanup.spec.ts`, `0046_memory_merge_subject_index.spec.ts`,
  `0047_memory_retention_health.spec.ts`
- `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` (+ `.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts` (+ `.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/skill-registry.store.ts` (+ `.spec.ts`), with `remove`, Revision 1
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts` (+ `.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/cosine-similarity.ts` (+ `.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/skill-clustering.service.ts` (+ `.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts` (+ `.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts` (+ `.spec.ts`, `skill-promotion.repropagation.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts` (+ `skill-synthesis.stage-handlers.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (one default literal, shared with 586)
- `libs/backend/skill-synthesis/src/lib/diagnostics.service.ts` (+ `.spec.ts`)
- `libs/backend/skill-synthesis/src/lib/diagnostics.types.ts`
- `libs/backend/skill-synthesis/src/lib/types.ts`
- `libs/backend/skill-synthesis/src/lib/di/tokens.ts`
- `libs/backend/skill-synthesis/src/lib/di/register.ts`
- `libs/backend/skill-synthesis/src/index.ts` (only for exports that changed or were removed)
- `libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.test-support.ts` (optional helper)
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (+ `.spec.ts`)
- `libs/backend/platform-core/src/file-settings-keys.ts` (+ its spec, if it asserts parity)
- `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`
- `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`

### MODIFY (frontend, after rebasing on TASK_2026_586)

- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts` (+ spec), shared with 586
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts` (+ spec), 586's version
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts` (+ spec)
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`, **conditional only**
  (component 15), shared with 586

### REWRITE

- `libs/backend/skill-synthesis/src/lib/skill-curator.service.ts`
- `libs/backend/skill-synthesis/src/lib/skill-curator.service.spec.ts`

---

## Team-leader handoff

- **Recommended executors:**
  - backend-developer for components 1-14 and 16. These cover SQLite, tsyringe DI, stage handlers and the RPC
    mapping.
  - frontend-developer for component 15 (Angular signals, OnPush).
  - senior-tester for the acceptance 1 measurement on a DB copy plus the blind-review hand-off. The live counts
    in context.md are the baseline.
- **Complexity: HIGH.** Five interacting state machines (candidate status, residency, suggestion status,
  registry linkage, purge marker), one migration, transactional multi-store commits, destructive filesystem
  actions, and a shared DB across hosts. Expect about 2,000 changed lines including specs.
- **Dependencies and ordering (component level only):**
  - 1 → (2, 3, 4) → (5, 6, 7) → (8, 9, 11, 12) → 10 → 16.
  - 14 needs 2.
  - 15 needs 14's shared DTO **and** a rebase on TASK_2026_586.
  - 13 is independent.
- **Proposed batch split hint (file-disjoint, backend versus frontend):**
  - **B-persist:** component 1. Files are only in `persistence-sqlite`. Notify the coordinator before the
    commit.
  - **B-stores:** components 2, 3, 4 and 5, plus `skill-registry.store.ts` `remove`, `types.ts`,
    `di/tokens.ts` and `di/register.ts` (store registration).
  - **B-services:** components 6, 7, 8, 9, 11 and 12, plus the service registrations in `di/register.ts` and
    `di/tokens.ts`. Sequence it after B-stores, because those two DI files are shared.
  - **B-curator:** component 10 and its spec. Sequence it after B-services.
  - **B-wire:** components 13 and 14 (platform-core, shared, rpc-handlers, docs, `skill-synthesis.service.ts`
    default, diagnostics). These are file-disjoint from B-services. Rebase on 586 before touching the rpc
    handler, the shared DTO and `skill-synthesis.service.ts`.
  - **B-frontend:** component 15 (frontend only). It runs after the 586 rebase and after B-wire's shared DTO
    edit.
  - **B-reach:** component 16, last.
- **Parallel-safe work:**
  - B-persist with B-wire's platform-core/docs part.
  - B-frontend with B-services and B-curator, once the 586 rebase and the shared DTO exist.
- **Verification points:**
  - Re-run `ptah_lsp_references` before removing `listInvocations`, `listActiveOrderedByActivity`,
    `hasExistingForCluster`, `synthesizeFromCluster`, `clusterCandidates`, `CuratorOverlap` and
    `SkillCandidateCluster`.
  - Resolve A1, A3 and A4 and record the outcome in the batch notes. A2 is now verified.
  - The `0051` spec must pass both with and without `0050` present. All 12 version asserts must agree with
    `Math.max(MIGRATIONS.version)`.
  - After rebasing on 586, confirm that `skill-diagnostics-accordion.component.ts` no longer exists and that
    the three counters render in `skill-pipeline-status.component.ts`.
  - Run commands:
    ```
    npx nx run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/persistence-sqlite @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/skill-synthesis-ui
    ```
    Read the "Running target test for N projects" header and confirm N = 5. Also run `typecheck` and `lint` for
    the same set. `max-lines` warnings are allowed but must not grow on `skill-candidate.store.ts`.
  - **Acceptance 1 procedure (Revision 1, review F5):**
    - **Per-pass budget.** Each pass makes at most `SUGGESTION_MAX_CLUSTERS_PER_PASS = 3` umbrella syntheses.
      All passes share the `skill.analyze` bucket of 6 per hour (`skill-curator.service.ts:98-101, 449-458`).
    - **Throughput.** That bucket limits throughput to 6 umbrellas per hour. The first pass also runs the
      one-time purge, which needs no LLM calls and is expected to be the largest single reduction.
    - **When to rerun.** Rerun `skillSynthesis:runCurator` on the DB copy while the `curator-pass` stats show
      `clustersRemaining > 0`. When `rateLimited` is `true`, wait for the bucket to reset (≤ 1 h) before the
      next run.
    - **When to stop.** Stop when a pass reports `clustersRemaining = 0`. As a hard ceiling, stop after
      `ceil(initialClusterCount / 3) + 2` passes, where `initialClusterCount` is the first pass's
      `umbrellasCreated + umbrellasRejected + clustersRemaining`.
    - **Expected duration.** At 6 per hour, about `initialClusterCount / 6` hours.
    - **Do not stop early.** A rate-limited pass is not the end of the run.
    - **What to record.** The `getStats()` counts and the pending-suggestion count before the first pass and
      after the last, plus the per-pass stats.
    - **Blind review.** Hand the created umbrellas to a blind reviewer scoring the 5 rubric criteria. The
      criterion passes if at least 50% score ≥ 6.0.

---

## Revision log

### Revision 1 (answers `implementation-plan-review.md` round 0 and `context.md` `## Cross-session coordination`)

| Finding | Severity | Fix | Where |
| --- | --- | --- | --- |
| F1: component 15 targets the accordion that TASK_2026_586 removes; 586-shared files missing from the collision table | major | The counters are retargeted to `skill-pipeline-status.component.ts` (586's version) and the frontend batch rebases on 586. The tab form-default edit is dropped. Minimal-edit rules are added for the rpc handler (do not touch `:714-720`) and the shared DTO (append only). The collision table lists the accordion, `skill-pipeline-status.component.ts`, `skill-diagnostics-state.service.ts`, `skill-synthesis-tab.component.ts`, `skill-synthesis.service.ts`, `skills-synthesis-rpc.handlers.ts` and `rpc-curator-diagnostics.types.ts`, each with its exact edit. | Components 13, 14 and 15; Cross-session collisions; Files; Handoff |
| F2: R5 versus component 8 step 3 left judge-rejected-umbrella members in limbo | major | R5 is narrowed to "not a member of a pending or accepted suggestion", so dismissed members are purge-eligible. New R7: a judge-rejected umbrella rejects its candidate members (`below-judge-score:umbrella:<sid>`), which closes limbo for passes after the purge too. `listMemberCandidateIds` gains a status filter. The residual case (user-dismissed after the purge) is stated. | Resolutions R5 and R7; components 3 and 8; component 8 spec cases |
| F3: retirement left a dangling `skill_registry` row; A2 deferred to a follow-up | major | A2 is resolved into a verified contract: the mirror's `reconcileAll` reaps clones whose upstream is gone, on every activation (`user-layer-mirror.service.ts:470-519`, `user-layer-orphan-reaper.ts:1-38`). New `SkillRegistryStore.remove(kind, slug, 'synth')` runs inside the retirement transaction and inside the accept transaction for merged promoted members. The catalog is upsert-only (`skill-registry-catalog.service.ts:51-86`), so a deleted row stays deleted unless an orphaned enhanced clone survives, which is labelled accurately. | A2; components 10 and 11; reachability proof 2; Files |
| F4: judge gate was read-then-write across hosts | minor | New `SkillCandidateStore.rejectIfStatus(id, expected, reason)`: a compare-and-set UPDATE with `changes === 1`, the same shape as `promoteAtomically`. It is used by the judge stage, retirement, umbrella merges, R7, the purge and accept merges. | Component 2 item 9; components 8, 10, 11 and 12 |
| F5: acceptance 1 needs many passes | minor | `UmbrellaPassResult` and the `curator-pass` stats gain `clustersRemaining` and `rateLimited`. The acceptance-1 procedure states the per-pass budget, the 6/h throughput, the stop condition and a pass-count ceiling. | Component 8 step 6; component 10; Handoff |
| F6: slug walk and DB check | minor (no change requested) | No change. The reviewer verified it. | — |
| Coordination: 12 version specs, not 3 | — | All 12 are listed (`0028`, `0030`, `0038`-`0047`; `0044` and `0046` are arrays), each bumped to 51 with a comment line beside 580's. | Codebase evidence; component 1; Cross-session collisions; Files |
| Coordination: merge order and rebase on 586 | — | The merge-order note is added, including notifying the coordinator before the migration commit. 578 rebases on 586 before B-wire's shared files and before B-frontend. | Cross-session collisions; Handoff |
