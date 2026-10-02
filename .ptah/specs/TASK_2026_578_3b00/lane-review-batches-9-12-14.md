# Cross-Side Review: Batches 9, 12, and 14

**Reviewer:** Antigravity CLI Lane (Cross-Side Review)  
**Task:** TASK_2026_578_3b00  
**Branch:** `feat/task-578-skill-lifecycle`  
**Commits Reviewed:**
1. `678db0b17` — Batch 9: Skill curator lifecycle facade, promotion on accept, and startup reconcile
2. `9a16da40f` — Batch 12: Removal of superseded clustering, synthesis, and suggestion paths
3. `4659e2e33` — Batch 14: Frontend diagnostics counts (merged, retired, dormant) and post-accept refresh

---

## Commit 678db0b17 (Batch 9)

**Commit Message:** `feat(skill-synthesis): batch 9 - rewrite skill curator as lifecycle facade with promotion on accept and startup reconcile`  
**Key Files:**
- [`skill-curator.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-curator.service.ts)
- [`adoptable-slug.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.ts)
- [`curator-report.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/curator-report.ts)
- [`skill-suggestion.store.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts)
- Associated specs: [`skill-curator.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-curator.service.spec.ts), [`adoptable-slug.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.spec.ts), [`skill-suggestion.store.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-suggestion.store.spec.ts), [`cluster-holdout-end-to-end.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/gates/cluster-holdout-end-to-end.spec.ts), [`register.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/di/register.spec.ts)

### Analysis & Checks

1. **Correctness & State Transitions:**
   - **Promotion on Accept:** `acceptSuggestion` verifies that the suggestion is `pending` before invoking `promotion.promoteSuggestion`. In `commitAccept`, `suggestionStore.accept(id, row.id)` transitions the suggestion to `accepted` and records `promoted_candidate_id`. If `accepted?.status !== 'accepted'` or `accepted.promotedCandidateId !== row.id`, an error is thrown, rolling back the promotion transaction.
   - **Member Merge:** `mergeMembers` iterates through `suggestion.memberCandidateIds`, verifies pinned members are skipped, merges candidates via CAS `rejectIfStatus(member.id, 'candidate', reason)`, and merges promoted members (with `registry.remove('skill', member.name)`) only if they are not in the exempt set. Promoted directories are cleaned up post-commit via `afterMerge` -> `retirement.removeMaterializations`.
   - **Startup Reconcile:** `reconcileAcceptedSuggestions` scans `suggestionStore.listAcceptedWithoutPromotedCandidate()`. For each suggestion, `findAdoptableSlug` proves directory ownership (matching base slug or `-2..-5`, `authored`/`synth` registry row, existing `SKILL.md`, and identical body content). Non-promoted candidate rows with conflicting names abort adoption (`blockedByCandidateRow`), preventing duplicate `name` UNIQUE constraint failures.
   - **Rollback Guarantee:** `commitReconcile` calls `suggestionStore.linkPromotedCandidate(suggestion.id, row.id)`, which executes a guarded UPDATE `WHERE id = ? AND status = 'accepted' AND promoted_candidate_id IS NULL`. If `changes !== 1`, it throws and rolls back the promotion transaction.

2. **Project Rules:**
   - **`inImmediateTransaction` Callback Safety:** Callbacks (`commitAccept`, `mergeMembers`, `commitReconcile`) contain strictly plain statement calls (`store.findById`, `store.rejectIfStatus`, `registry.remove`, `suggestionStore.accept`, `suggestionStore.linkPromotedCandidate`). No nested transactions are opened, and no `try/catch` exists inside any transaction callback (satisfying rules R-f and R-f2).
   - **Catch Block Hygiene:** All `catch` blocks in [`skill-curator.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-curator.service.ts) either log warnings via `this.logger.warn` without swallowing errors silently, or carry the required `// degradation-audit:` marker (line 734, `optional-capability`). No `catch` block returns directly without proper logging or audit markup.
   - **Exempt Slugs Builder:** In `readExemptSlugs`, `built` is accumulated into a local variable and assigned to `exempt` only after all reads succeed. Any exception in `listByStatus` results in returning `null` (fail closed), preventing partial exempt sets from exposing user skills to umbrella merging.

3. **Specs Verification:**
   - [`skill-curator.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-curator.service.spec.ts) contains real-database assertions covering mid-callback throws rolling back adopts, plugin error handling, `linkedOnly` adoption of pre-promoted rows, manual pass waiting on in-flight reconcile, and post-commit directory removal.
   - [`adoptable-slug.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.spec.ts) explicitly pins `materializedBaseSlug` against `SkillMdGenerator.promoteToActive` across 12 diverse test cases.
   - [`cluster-holdout-end-to-end.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/gates/cluster-holdout-end-to-end.spec.ts) successfully retargets to `SkillUmbrellaMergeService` with zero references to deleted legacy methods.

### Findings

- **MINOR:** [`skill-curator.service.ts:506-515`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L506-L515)  
  *Statement:* `startReconciliation` catches rejections and converts them to `{ ...EMPTY_RECONCILE, failed: 1 }` without exposing the failure state beyond an internal log message.  
  *Scenario:* If an unhandled SQLite database locked error occurs during the startup reconcile, the promise resolves to a failure counter that is not surfaced in external telemetry or diagnostics RPC queries, relying entirely on server log inspection.

### Overall Verdict
**APPROVED**

---

## Commit 9a16da40f (Batch 12)

**Commit Message:** `refactor(skill-synthesis,rpc-handlers): batch 12 - remove superseded clustering, synthesis and suggestion paths`  
**Key Files:**
- [`skill-clustering.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-clustering.service.ts) (+ spec)
- [`skill-synthesizer.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts) (+ spec)
- [`skill-suggestion.store.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts) (+ spec)
- [`skill-candidate.store.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts)
- [`skill-gap-curator.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/digest/skill-gap-curator.service.ts) (+ spec)
- [`src/index.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/index.ts)
- [`skills-synthesis-rpc.handlers.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts)
- [`tools/degradation-audit/baseline.json`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/tools/degradation-audit/baseline.json)

### Analysis & Checks

1. **Dead Code & Stale References:**
   - Repository-wide grep across all `libs/` and `apps/` confirms zero remaining occurrences of deleted symbols:
     - `clusterCandidates` — 0 matches
     - `SkillCandidateCluster` — 0 matches
     - `ClusterMemberInput` — 0 matches
     - `synthesizeFromCluster` — 0 matches
     - `buildClusterPrompt` — 0 matches
     - `insertPending` — 0 matches
     - `hasExistingForCluster` — 0 matches
     - `listInvocations` — 0 production or spec callers
     - `listActiveOrderedByActivity` — 0 matches
     - `RawInvocationRow` — 0 matches
   - The method `linkPromotedCandidate` added in Batch 9 is intact and tested.

2. **Barrel Exports Integrity:**
   - [`src/index.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/index.ts) correctly replaces `ClusterMemberInput` with `UmbrellaMemberInput`, replaces `SkillCandidateCluster` with `PoolExclusions`, `PoolMember`, and `PoolPartition`, and exports `CuratorPassStats` alongside `CuratorReport`.
   - Core contracts (`rpc.types.ts`) were untouched in accordance with the no-touch policy.

3. **Store Sizing & Line Budget (Rule R-h):**
   - [`skill-candidate.store.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts) removed `listInvocations` and `toInvocationRow`, bringing the ESLint `max-lines` line metric down to 1272 lines, strictly satisfying the R-h requirement of $\le 1272$ lines without requiring an auxiliary file extraction.

4. **Audit Baseline Ratchet:**
   - `tools/degradation-audit/baseline.json` properly ratcheted down `libs/backend/skill-synthesis` from 6 to 5 following the removal of old sentinel catch blocks.

### Findings

- **MINOR:** [`skill-synthesizer.service.ts:89`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts#L89)  
  *Statement:* The constant `CLUSTER_MEMBER_MAX_CHARS` retains the deprecated `CLUSTER_` prefix even though its only surviving caller is the umbrella synthesis prompt.  
  *Scenario:* A maintainer searching for cluster-synthesis logic may assume that cluster prompting logic still exists when encountering `CLUSTER_MEMBER_MAX_CHARS`.

### Overall Verdict
**APPROVED**

---

## Commit 4659e2e33 (Batch 14)

**Commit Message:** `feat(skill-synthesis-ui): batch 14 - show merged, retired and dormant counts and refresh them after accept`  
**Key Files:**
- [`skill-pipeline-status.component.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts) (+ spec)
- [`skill-suggestions-view.component.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/suggestions/skill-suggestions-view.component.ts) (+ spec)
- [`skill-diagnostics-state.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts) (+ spec)
- [`skill-synthesis-state.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts) (+ spec)

### Analysis & Checks

1. **Angular Standards Compliance:**
   - Standalone: [`SkillPipelineStatusComponent`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts#L122-L126) and [`SkillSuggestionsViewComponent`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/suggestions/skill-suggestions-view.component.ts) are declared `standalone: true`.
   - OnPush: Both components enforce `ChangeDetectionStrategy.OnPush`.
   - State & Reactivity: Uses Angular `signal`, `computed`, `input`, and `output` APIs exclusively.
   - XSS / DOM Safety: Zero occurrences of `[innerHTML]` bindings; all template interpolations use standard Angular text interpolation (`{{ }}`).

2. **Diagnostics State & UI Display:**
   - `SkillByStatusCounts` and [`SkillDiagnosticsStateService`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts#L80-L115) incorporate `totalMerged`, `totalRetired`, and `totalDormant` with `?? 0` defensive coalescing in `applySnapshot`.
   - [`SkillPipelineStatusComponent`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts#L229-L247) renders the Merged, Retired, and Dormant counts within the `Candidates by status` summary group with consistent styling (`tabular-nums font-semibold` and `text-base-content-muted`).

3. **Accept Flow & Counter Refresh:**
   - [`SkillSynthesisStateService.accept`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts#L443-L460) sequentially calls `rpc.acceptSuggestion(id)`, `refreshSuggestions()`, and `loadStats()`, returning `Promise<boolean>`. If `loadStats()` fails after a successful accept, the failure is recorded in `error` while still returning `true` to acknowledge the completed promotion.
   - The catch block in `accept` carries `// degradation-audit: reported`, properly reporting the error to the UI via `this.error.set(this.toMessage(err))`.
   - [`SkillSuggestionsViewComponent`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/suggestions/skill-suggestions-view.component.ts#L456-L467) triggers `refreshPipelineCounts()` (`void this.diagnostics.refresh()`) upon a successful accept, ensuring the pipeline status card immediately updates without waiting for the 30-second poll. On failure, an error toast is displayed and the modal stays open for retry.

4. **Specs Verification:**
   - [`skill-pipeline-status.component.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts#L609-L627) asserts rendered text for Merged, Retired, and Dormant counts.
   - [`skill-suggestions-view.component.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/suggestions/skill-suggestions-view.component.spec.ts#L148-L225) validates the invocation ordering of `diagnostics.refresh` after `state.accept`, verifies modal retention on failure, and confirms error toast display.
   - [`skill-synthesis-state.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.spec.ts#L162-L215) validates the accept sequence, error handling when accept fails, and error surfacing when the subsequent stats read rejects.

### Findings

- **MINOR:** [`skill-suggestions-view.component.ts:567`](file:///D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/suggestions/skill-suggestions-view.component.ts#L567)  
  *Statement:* `showToast` schedules a 3-second auto-clear via `setTimeout` without capturing the handle or clearing it on component destroy.  
  *Scenario:* If a user accepts a suggestion and rapidly navigates to another view or destroys the component within 3000ms, the timer callback executes against a detached signal. Although Angular signals handle this safely without throwing, an unmanaged timeout handle remains active until expiration.

### Overall Verdict
**APPROVED**

---

## Summary Verdict Table

| Commit | Batch | Description | Findings | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| `678db0b17` | Batch 9 | Skill curator lifecycle facade, promotion on accept, startup reconcile | 1 Minor | **APPROVED** |
| `9a16da40f` | Batch 12 | Deletion of superseded clustering, synthesis, and suggestion paths | 1 Minor | **APPROVED** |
| `4659e2e33` | Batch 14 | Merged, retired, dormant UI status counts & post-accept diagnostics refresh | 1 Minor | **APPROVED** |
