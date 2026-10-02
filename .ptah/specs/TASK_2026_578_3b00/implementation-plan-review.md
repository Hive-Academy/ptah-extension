# Implementation Plan Review — `TASK_2026_578_3b00`

## Review state

| Field | Value |
| --- | --- |
| Author | software-architect (in-process subagent) |
| Reviewer | Glm ptah-cli lane, code-logic-reviewer role |
| Sides | in-process (architect) vs CLI lane (reviewer) |
| Reviewed revision | **Revision 1** (`implementation-plan.md`, has `## Revision log`) |
| Round | **1** |
| Verdict | **APPROVED** (1 minor residual, below) |

## Round-1 finding status

Each round-0 finding, re-checked against Revision 1.

| Round-0 finding | Status | Evidence |
| --- | --- | --- |
| F1 (major): component 15 targets the accordion TASK_2026_586 removes; 586-shared files absent from the collision table | **fixed** | Component 15 retargeted to `skill-pipeline-status.component.ts` and rebases on 586 (`implementation-plan.md:889-930`). The tab form-default edit is dropped (`:845-847`). Minimal-edit rules pin the allowed regions in `skills-synthesis-rpc.handlers.ts` (`:873-878`) and the shared DTO. The collision table now lists the accordion, `skill-pipeline-status.component.ts`, `skill-diagnostics-state.service.ts`, `skill-synthesis-tab.component.ts`, `skill-synthesis.service.ts` and `rpc-curator-diagnostics.types.ts` (`:1128-1134`). The plan correctly labels 586's by-status input type as an Assumption until the rebase — verified on this branch: the current inputs (`skill-pipeline-status.component.ts:277-293`) carry no by-status input yet. |
| F2 (major): R5 excluded judge-rejected umbrellas' members from the pool and from the purge — permanent limbo | **fixed** | R5 bullet 2 is narrowed to "not a member of a **pending or accepted** suggestion"; dismissed members are purge-eligible (`:148-155`). New R7 rejects the candidate members of a below-threshold umbrella, closing limbo after the purge too (`:158-170`). `listMemberCandidateIds` gains the status filter (`:372-377`). The component 8 spec adds a dismissed-member purge case and a pending-member keep case (`:597-598`). The purge reads the filtered set and counts suggestions created in steps 3-4 (`:549-551`). The R5 residual (user-dismissed after the purge) is stated as the user's choice (`:168-170`). |
| F3 (major): retirement left a dangling `skill_registry` row; A2 unverified | **fixed** | A2 is now a verified contract; I re-verified its three claims against source (see "Round-1 verified claims"). Component 11 deletes the `synth` registry row inside the same `inImmediateTransaction` as the status change, with a `clone_status='synth'` guard (`:743-758`). New `SkillRegistryStore.remove(kind, slug, onlyCloneStatus='synth')` (`:767-769`), joined by the accept transaction for merged promoted members (`:684-686`). The orphaned-enhanced-clone re-insert path is reasoned through (`:755-758`). |
| F4 (minor): below-threshold judge gate was read-then-write across hosts | **fixed** | New `SkillCandidateStore.rejectIfStatus(id, expected, reason)` — a conditional `UPDATE … WHERE id = ? AND status = ?` returning `changes === 1` (`:318-335`), the same compare-and-set shape as `promoteAtomically` (`:513-527`, verified round 0). It is the designated write for the judge gate (`:818-823`), retirement (`:744`), umbrella merges and R7 (`:521-531`), accept merges (`:683-684`) and the purge (`:541`). Failure behaviour of component 12 now names the closed race explicitly (`:828-831`). |
| F5 (minor): acceptance 1 needs many passes; expected count not stated | **fixed** | `UmbrellaPassResult` gains `clustersRemaining` and `rateLimited` (`:556-557`). The acceptance-1 procedure states the 6/h budget, the rerun trigger, `clustersRemaining = 0` as the stop, the `ceil(initialClusterCount / 3) + 2` ceiling, and "do not stop early" (`:1252-1264`). |
| F6 (minor): slug walk and DB check consistency | n/a (verified, no change requested) | Round 0 verified `writeAtRoot` plus `isSlugTaken` and the UNIQUE backstop. Revision 1 records "No change" (`:1283`). |

All three majors are fixed. The verdict moves from REVISE to **APPROVED**.

## New mechanisms checked for new defects

1. **Below-threshold umbrella rejects its candidate members (R7 + component 8 step 3).**
   The writes land in one transaction: insert the `dismissed` umbrella row, then
   `rejectIfStatus(..., 'below-judge-score:umbrella:<sid>')` per candidate member (`:519-525`). The
   token prefix matches the existing `below-judge-score` spelling (`skill-promotion.service.ts:582-584`,
   verified round 0) and does not collide with the `getStats` count patterns (`merged-into:%`,
   `retired:unused`, `backlog-purge:…`). Promoted and pending-suggestion members are untouched; their
   states are already decided (live skill, or a judged suggestion the user can act on). No new limbo
   class. Coherent.
2. **Retirement deletes the `skill_registry` row in the same transaction.**
   Filesystem removal goes first (idempotent, self-healing), then one transaction does
   `rejectIfStatus(id, 'promoted', …)` plus the guarded `registry.remove` (`:743-758`). A lost race
   writes nothing and keeps the registry row — covered by a spec case (`:802-803`). `remove` is a plain
   statement on the shared connection, so it joins the caller's transaction like the other stores
   (`:767-769`). The upsert-only catalog (`:750-753`) keeps the delete stable unless an orphaned
   enhanced clone survives, which the plan reasons through. Coherent.
3. **Compare-and-set judge gate.**
   One conditional UPDATE, `false` logged and skipped, no second status writer (`rejectIfStatus` lives
   in `SkillCandidateStore`, the only writer). Both traversed edges (`candidate→rejected`,
   `promoted→rejected`) are in `LEGAL_TRANSITIONS` (`:163-167`, verified round 0). Coherent.
4. **Version-spec bump list.** Verified: exactly 12 specs are named (0028, 0030, 0038-0047), both in
   component 1's Files list (`:283-287`), the collision table (`:1127`) and Files to Modify
   (`:1160-1166`). The "ten `toBe(49)` / two arrays" split matches `context.md`'s coordinator section
   and my grep of the migrations directory (10 `toBe(49)` hits; no `toBe(50)` yet, so 580 has not
   landed). All 12 spec files exist.

## New findings

### F7 — Component 1's verification seam still says "Bump the three max-version specs to 51" — **minor**

- Evidence: `implementation-plan.md:278`. The Files list (`:283-287`), the collision table (`:1127`)
  and Files to Modify (`:1160-1166`) all say 12. Revision 0 said three, Revision 1 corrected three
  places and missed this one (the count correction is recorded at `:1284` with "All 12 are listed").
- A batch executor reading only component 1's seam would migrate 3 specs and skip 9.
- **Fix:** change "the three" to "the 12" at `:278`. One-word edit; no re-review needed.

No other new defect found. No blocking or serious issue remains.

## Round-1 verified claims (new spot checks)

| Claim | Result |
| --- | --- |
| `UserLayerOrphanReaper`: upstream gone + no local work → reaped; `diverged` or content-changed → kept `orphaned: true`; unknown upstream never reaps | Confirmed, `user-layer-orphan-reaper.ts:1-38` (doc block) |
| `UserLayerMirrorService.reconcileAll` runs the reconcile + `reapDeletedUpstream` and is intended on every activation | Confirmed, `user-layer-mirror.service.ts:464-486` |
| Ten `toBe(49)` version asserts with the plan's exact line numbers | Confirmed by grep: `0028:83`, `0030:38`, `0038:91`, `0039:65`, `0040:78`, `0041:62`, `0042:70`, `0043:54`, `0045:33`, `0047:34`; no `toBe(50)` present yet |
| `SkillRegistryStore` has no `remove` today (the plan must add it) | Confirmed: grep finds only `upsert` (`:61`) and `listAll` (`:108`) |
| The 12 version spec files exist | Confirmed by glob of `migrations/*.spec.ts` |
| `SkillPipelineStatusComponent` class and inputs on this branch | Confirmed, `skill-pipeline-status.component.ts:276-293` |
| `context.md` `## Cross-session coordination` agrees with the plan's collision table and merge-order note | Confirmed, `context.md:76-81` |

# Round 0 (history)

## Review state

| Field | Value |
| --- | --- |
| Author | software-architect (in-process subagent) |
| Reviewer | Glm ptah-cli lane, code-logic-reviewer role |
| Sides | in-process (architect) vs CLI lane (reviewer) |
| Reviewed revision | Revision 0 (`implementation-plan.md`, unversioned draft, HEAD `c4ab013f3`) |
| Round | 0 |
| Verdict | **REVISE** |

## Requirement trace

`context.md` is the requirements source (user-accepted in place of `task-description.md`).

| Requirement (`context.md`) | Plan section | Status |
| --- | --- | --- |
| Scope 1: umbrella merge, clusters → SKILL.md + `references/`, members `merged-into:<id>`, leave Recommended | Architecture decision 2; components 6, 7, 8, 10; R2, R3 | met |
| Scope 2: judge gate decides; current rubric + `minJudgeScore` 6.0; below → reject, above → Recommended | Architecture decision 5; components 8 (step 3), 12; R1 | met |
| Scope 3: accept = promote; `name = md.slug`; `skill_registry.candidate_id`; slug stored in `promoteAtomically`; backfill of 2 accepted suggestions | Components 5, 9, 10 (`reconcileAcceptedSuggestions`); A1 | met |
| Scope 4: usage-based retirement, join on `skill_invocation_events.skill_slug` = `skill_candidates.name`; N/M settings; pinned and user-authored exempt | Components 2.5, 11; R4 | met |
| Scope 5: one-time backlog purge, >30 days, in no cluster | Component 8 (step 5); R5, R6 | met, with a contradiction (F2) |
| Scope 6: merged, retired, dormant counts in Skills diagnostics | Components 14, 15 | met, retarget required (F1) |
| AC 1: one pass reduces the set on a DB copy; blind review ≥ 50% ≥ 6.0 | Team-leader handoff, "Verification points"; component 8 stats | met |
| AC 2: accept raises Promoted and Active in the UI | Component 15 (`loadStats()` after accept); component 14 (`activeSkills = s.active`) | met |
| AC 3: spec proves dormant at N, retired at N+M, pinned exempt | Component 11 verification seam | met |
| AC 4: invocations count `skill_invocation_events` by `skill_candidates.name`; collision-suffix spec | Components 2.4, 2.6, 14; component 16 proof 3 | met |
| AC 5: reachability proof per new pass | Component 16 (proofs 1-4) | met |

All six scope items and all five acceptance criteria trace to plan sections. The round-0 gaps are in F1-F3 below; all are fixed in Revision 1.

## Findings (round 0)

### F1 — Component 15 (and parts of 13/14) collide with TASK_2026_586 — **major**

- Evidence: `implementation-plan.md` Revision 0, component 15 files; the accordion file existed on this branch at
  `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-diagnostics-accordion.component.ts`.
- TASK_2026_586 REMOVES `skill-diagnostics-accordion.component.ts` and moves its rows into
  `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts`. It also edits `skill-diagnostics-state.service.ts`, `skill-synthesis-tab.component.ts`, `skills-synthesis-rpc.handlers.ts`, `skill-synthesis.service.ts` (recentEvents) and
  `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`.
- Plan components 13, 14 and 15 edited five of those six files. The Revision-0 collision table listed none of them. Component 15 as written targeted a file that would not exist after 586 merges.
- **Fix applied in Revision 1:** see the round-1 status table above.

### F2 — R5 contradicted itself: judge-rejected umbrellas' members were neither merged, purged nor pool-eligible — **major**

- Revision-0 R5 required "not judge-scored ≥ minJudgeScore" and "not a member of any suggestion (any status)", while component 8 step 3 recorded below-threshold umbrellas as suggestions with untouched members. A member of a judge-rejected umbrella was excluded from the pool AND from the purge and stayed `status='candidate'` forever.
- **Fix applied in Revision 1:** see the round-1 status table above.

### F3 — Retirement left a dangling `skill_registry` row and user-layer clone, resting on an unresolved assumption — **major**

- Revision-0 A2 deferred the clone-reap behaviour to a "check by reading its implementation" follow-up, and neither retirement nor accept touched the `skill_registry` row.
- **Fix applied in Revision 1:** see the round-1 status table above.

### F4 — Below-threshold judge gate remained read-then-write across the shared DB — **minor**

- Revision 0 planned a re-read immediately before the write; another host could still promote between the reads on the shared `~/.ptah/state/ptah.sqlite`. Fixed with `rejectIfStatus` in Revision 1.

### F5 — Acceptance 1 needed many passes; the plan did not say so — **minor**

- Fixed in Revision 1 with `clustersRemaining`/`rateLimited` and the pass-count ceiling.

### F6 — `writeAtRoot` slug walk and the DB check are consistent — **minor (verified, no change)**

- Verified `skill-md-generator.ts:209-236` walks `-2`…`-5` by filesystem existence, and the plan adds the DB predicate (`promoteToActive(..., { isSlugTaken })`). `promoteSuggestion`'s UNIQUE backstop plus `removeActive` compensation is correct.

## Verified claims (round 0 spot checks)

| Claim | Result |
| --- | --- |
| `LEGAL_TRANSITIONS` covers merge and retire edges | Confirmed, `skill-candidate.store.ts:163-167` |
| `skill_candidates.status` CHECK | Confirmed, `migrations/0003_skills.ts:19` |
| `promoteAtomically` never writes `name`; private `BEGIN IMMEDIATE` | Confirmed, `:467-542`, `:637-647` |
| `setResidency` exists; dormant is first-class | Confirmed, `:448-460`, `:549-557` |
| `getStats` counts `skill_invocations` (no production writer) | Confirmed, `:1522-1548` |
| `listInvocations` / `listActiveOrderedByActivity` unused in production | Confirmed by grep: store definition + one promotion spec only |
| `updateStatus` writes `rejected_reason` | Confirmed, `:613-615` |
| `acceptSuggestion` uses `suggestion.name`, never stores the materialized slug, `candidate_id: null` | Confirmed, `skill-curator.service.ts:562-568`, `:589` |
| Rate limit bucket and authored-dominance guard | Confirmed, `:449-458`, `:434-448` |
| `hasExistingForCluster` matches any member overlap across all statuses | Confirmed, `skill-suggestion.store.ts:149-171` |
| `skill_suggestions` CHECK has no reason column | Confirmed, `migrations/0025_skill_suggestions.ts:17` |
| Judge stage maps `scored` straight to `done` | Confirmed, `queue/stage-handlers.service.ts:541-552` |
| `'below-judge-score'` reason token | Confirmed, `skill-promotion.service.ts:582-584` |
| File settings keys and the 200 default | Confirmed, `platform-core/src/file-settings-keys.ts:243-244`, `:533`, `minJudgeScore` 6.0 at `:525` |
| `writeAtRoot` slug walk; `renderSkillMd` writes `name: <chosen slug>` | Confirmed, `skill-md-generator.ts:209-236`, `:249-251` |
| Migration registry append-only and runner tolerance | Confirmed, `migrations/index.ts:14-18`, `migration-runner.ts:74-87` |
| Catalog self-heal after `name = md.slug` | Confirmed, `skill-registry-catalog.service.ts:59-64`, `:91-96` |
| Runtime slug writes to `skill_invocation_events` | Confirmed, `triggers/skill-trigger.service.ts:625-691`, `recordSkillEvent` `:673-683` |
| `idx_skill_inv_events_slug` | Confirmed, `migrations/0021_skill_invocation_events.ts:12` |
| RPC stats / diagnostics / invocations method lines | Confirmed, `skills-synthesis-rpc.handlers.ts:486-522`, `:695-731` |
| Frontend accept flow refreshes suggestions only | Confirmed, `skill-synthesis-state.service.ts:434-445` |
| `agglomerate` restarts per merge, O(n²) pairs per restart | Confirmed, `cosine-similarity.ts:33-71` |

## Lane-introduced constraints

Rules the planner added that `context.md` does not request. Each is tagged `architect-proposed` in the plan; a reviewer may overturn any of them without reopening the rest. All stand as accepted in Revision 1.

1. **R1** — singleton suggestions for judge-passed unclustered candidates, capped at 5 per pass.
2. **R3** — `merged-into:` always targets the umbrella suggestion id, never the candidate id.
3. **R4** — N and M as file-based keys with defaults 30/30, not settings-panel fields.
4. **R6** — pool default 200 → 1000; skipped purge on truncation, no marker written. The O(n²·d) cost is bounded by the union-find re-implementation, once per 24 h pass.
5. Removal of the LLM overlap/stale review and its report-only path — replaces a no-op write with state-changing passes.
6. Union-find `agglomerate` re-implementation with unchanged partition semantics (A3).
7. Deletion of `listActiveOrderedByActivity` (verified unused) and `listInvocations` (movable callers).
8. `diverged` registry slugs exempt from retirement, as user-edited content.
9. `UMBRELLA_MAX_MEMBERS = 12`, `SINGLETON_MAX_PER_PASS = 5`, `SUGGESTION_MAX_CLUSTERS_PER_PASS = 3` pass-budget constants.
10. Candidate members merged before umbrella accept; a dismissed umbrella leaves its candidate members merged, recorded in the curator report.

None of these contradict `context.md`. R4 (file-based N/M) reduces user reachability of the two settings the user asked for; if panel visibility of N/M matters, promote them later — the plan notes this is additive. Revision 1 adds R7 (judge-rejected umbrella rejects its candidate members) as a new architect-proposed rule; it resolves F2 and stays within the requested "Below the threshold: reject automatically".

## Parity deltas

| Removed | Replacement | Contract kept |
| --- | --- | --- |
| `runSuggestionPass`, LLM overlap review | `SkillUmbrellaMergeService.run` | `CuratorReport` keeps `suggestionsCreated`; `overlaps` already omitted by the RPC |
| `clusterCandidates` | `partitionPool` (new result shape) | `SkillCandidateCluster` export updated or dropped after `ptah_lsp_references` |
| `synthesizeFromCluster`, `buildClusterPrompt` | `synthesizeUmbrella` | `buildSystemPrompt` pinned by a snapshot for Track B |
| `getStats().invocations` over `skill_invocations` | count of `skill_invocation_events` joined on `skill_candidates.name` | `SkillSynthesisStatsResult` shape unchanged; values change by design (acceptance 4) |
| `listInvocations` as `skillSynthesis:invocations` source | `listInvocationEvents` mapping to the same `SkillInvocationRow` | wire shape unchanged (`skillSynthesis:invocations` CLI path verified) |
| `listActiveOrderedByActivity` | deleted, no callers (grep-verified) | — |

The `totalRejected` value includes merged, retired, purged and below-judge-score rows. No production query acts on that number (the panel gate skips already-rejected candidates; pool exclusion uses member ids), so this is observability only. The new counters distinguish the classes by `rejected_reason` prefix tokens: `merged-into:`, `retired:unused`, `backlog-purge: unclustered >30d`, `below-judge-score` — distinct spellings, no collision with existing reasons.

## Feasibility evidence

- **No schema rebuild needed.** `rejected` + `rejected_reason` is a legal edge in `LEGAL_TRANSITIONS` (`skill-candidate.store.ts:163-167`); the CHECK forbids widening (`migrations/0003_skills.ts:19`).
- **Dormant reuse is already production-wired.** `residency` CHECK and the junction consumer exist (`0026_skill_residency.ts`, `listDormantPromotedSlugs`, `skill-candidate.store.ts:549-557`).
- **The join key is real.** `skill_invocation_events.skill_slug` has the index (`0021:12`); the trigger writes it from the Skill tool command and prompt expansion (`skill-trigger.service.ts:625-706`); `renderSkillMd` writes `name: <chosen slug>` so the frontmatter slug equals `skill_candidates.name` by construction.
- **Migration `0051` is safe in either merge order.** The runner sorts pending migrations as a set difference over `schema_migrations` (`migration-runner.ts:74-87`), so gaps and order are tolerated, and the append-only index edit is a standard two-line change. One caveat: the forward-only guard (`:79-85`) means a build that lacks the other session's version refuses a DB migrated beyond its bundled max ("Refusing to downgrade"). Both versions land on main, so the window is bounded. The `0051` spec applies on a DB at 49 and at 50, and all 12 max-version specs settle at 51.
- **Re-entrancy need is real.** `promoteSuggestion` runs `promoteAtomically` (which opens `BEGIN IMMEDIATE`) inside an outer `inImmediateTransaction`; the depth-counter plan plus the node:sqlite caveat (`reachability.test-support.ts:100-115`) addresses it correctly.
- **Pool default 200 → 1000.** Cost is bounded by the union-find sweep, once per 24 h; the truncation skip in R6 stops the purge from silently missing rows.

## Requirement trace (round 0, unchanged by Revision 1)

All six scope items and all five acceptance criteria still trace, with F1/F2/F3 now resolved:

| Requirement (`context.md`) | Plan section (Revision 1) | Status |
| --- | --- | --- |
| Scope 1 | R2, R3; components 6, 7, 8, 10 | met |
| Scope 2 | Component 8 step 3 (R7), component 12, R1 | met |
| Scope 3 | Components 5, 9, 10 (`reconcileAcceptedSuggestions`); A1 | met |
| Scope 4 | Components 2.5, 11; R4 | met |
| Scope 5 | Component 8 step 5; R5, R6 | met (contradiction resolved) |
| Scope 6 | Components 14, 15 (retargeted) | met |
| AC 1 | Handoff acceptance-1 procedure; component 8 stats | met |
| AC 2 | Components 14, 15 | met |
| AC 3 | Component 11 verification seam | met |
| AC 4 | Components 2, 14, 16 proof 3 | met |
| AC 5 | Component 16 | met |

## Verdict

- Recommendation: **APPROVE** (Revision 1, with F7 as a one-word fix that needs no re-review).
- Confidence: HIGH — all three majors re-checked against plan text and source; the three new mechanisms were traced for new defects and none introduced one.
- Top risk: none of the round-0 majors remain; the residual risk is implementation-size (HIGH complexity, ~2,000 changed lines) and the unmerged 586 dependency, both of which the plan surfaces explicitly.
- What a robust implementation would add: the F7 one-word edit; after the 586 rebase, confirm 586's by-status input type before the component 15 batch (the plan already lists this as its assumption check).