# Code Review: Batch 15 — Legacy Accepted Suggestion Adoption & Retirement Idle Clock

**Reviewer:** Antigravity CLI Lane (Cross-Side Read-Only Review)  
**Task:** TASK_2026_578_3b00  
**Branch:** `feat/task-578-skill-lifecycle`  
**Commit Reviewed:** [`9978b040e`](https://github.com/ptah-extension/source/commit/9978b040e4166bb9e5c8158dc78e86593f44726e) (`fix(skill-synthesis): batch 15 - adopt legacy accepted suggestions held by rejected rows or diverged registry entries`)  
**Key Files Reviewed:**
- [`libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.ts`](../../../libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.ts)
- [`libs/backend/skill-synthesis/src/lib/skill-curator.service.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts)
- [`libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts)
- [`libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts)
- [`libs/backend/skill-synthesis/src/lib/skill-candidate.row-mappers.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.row-mappers.ts)
- [`libs/backend/skill-synthesis/src/lib/skill-curator.service.spec.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.spec.ts)
- [`libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.spec.ts`](../../../libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.spec.ts)
- [`libs/backend/skill-synthesis/src/lib/skill-candidate.store.spec.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.spec.ts)

---

## 1. Checkpoint Verification

### 1. Atomic Rollback of the Revive Path
- **Observation:** The revive path in [`commitResidentPromotion`](../../../libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts#L589-L616) wraps:
  1. Guarded in-place status compare-and-set re-promotion ([`promoteAtomically(candidateId, { fromStatus: 'rejected' })`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts#L501-L523));
  2. Overwriting revived content and clearing legacy judge/replay measurements ([`resetRevivedContent`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts#L564-L605));
  3. Registry row linkage and preservation of diverged status ([`linkRegistryRow`](../../../libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts#L634-L663));
  4. Suggestion linkage ([`linkPromotedCandidate`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L645)) and member merge cascade ([`mergeMembers`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L650)) inside `onCommit`.
- **Atomicity:** All operations execute within a single [`inImmediateTransaction`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts#L710) block. No statements catch and suppress errors. If any step throws (e.g. `RegistrySlugOwnedByPluginError` from plugin collision, `changes !== 1` when the row was concurrently modified, or a member merge failure), SQLite executes `ROLLBACK`. The candidate row retains its prior `rejected` status and reasons, suggestion lineage remains unlinked, and the registry entry remains untouched.
- **Physical Cleanliness:** Materialization removal ([`removeMaterializations`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L635)) runs strictly in [`afterMerge`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L635) after the transaction commits, ensuring disk directories are never deleted if the transaction fails. Verified by integration specs `(b)` and `(f)` in `skill-curator.service.spec.ts`.

### 2. Retirement Idle-Clock & Dormancy Integrity
- **Query Analysis ([`listPromotedLastUse`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts#L614-L636)):**
  ```sql
  SELECT c.*,
         MAX(
           COALESCE(e.max_invoked_at, c.promoted_at, c.created_at),
           COALESCE(c.promoted_at, c.created_at)
         ) AS last_used_at
    FROM skill_candidates c
    LEFT JOIN (
      SELECT skill_slug, MAX(invoked_at) AS max_invoked_at
        FROM skill_invocation_events
       GROUP BY skill_slug
    ) e ON e.skill_slug = c.name
   WHERE c.status = 'promoted'
   ORDER BY last_used_at ASC
  ```
- **Can a skill be prevented from going dormant?** No. `c.created_at` is `INTEGER NOT NULL` (migration `0003_skills.ts:22`), so neither operand of `MAX` is ever `NULL`. `last_used_at` yields a fixed timestamp in the past. In [`SkillRetirementService.run`](../../../libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts#L127), `idleDays = (now - lastUsedAt) / DAY_MS`. Because `now` advances monotonically while `last_used_at` remains constant in the absence of new events, `idleDays` will inevitably cross `dormantAfterDays` and `retireAfterDays`.
- **Impact on Normal Promoted Skills:** Unchanged. For normally promoted skills, invocations occur after promotion (`e.max_invoked_at >= c.promoted_at`), yielding `MAX(invoked_at, promoted_at) === invoked_at`. For unused skills, `MAX(promoted_at, promoted_at) === promoted_at`. Both evaluate identically to the pre-Batch 15 expression `COALESCE(e.max_invoked_at, c.promoted_at, c.created_at)`.
- **Revived Skills Grace Period:** When a slug has legacy invocation events predating re-promotion (`e.max_invoked_at < c.promoted_at`), `MAX` clamps `last_used_at` to `c.promoted_at`. This provides the adopted/revived skill with a full `N`-day grace window, preventing an immediate retirement sweep on first boot.
- **Retired Reason Guard:** [`slugHolderDecision`](../../../libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.ts#L99-L113) blocks candidate rows having `rejectedReason` starting with `retired:`. Deliberately retired skills cannot be revived by reconcile passes.

### 3. `promoteAtomically` Default Behavior
- **Default `fromStatus`:** In [`SkillCandidateStore.promoteAtomically`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts#L454), `options.fromStatus ?? 'candidate'` defaults to `'candidate'`.
- **Guards:** When `fromStatus === 'candidate'`, the transition guard `LEGAL_TRANSITIONS[current.status].includes('promoted')` is enforced, rejecting any candidate not currently in `'candidate'` status.
- **Update Integrity:** Setting `residency = 'resident', rejected_at = NULL, rejected_reason = NULL` is an exact no-op for genuine candidate rows (which already hold resident residency and null rejection fields). Production callers relying on the default signature execute identically to prior revisions.

### 4. Conformance to Project Architecture Rules
- **Clean Transaction Closures (R-f / R-f2):** All callbacks passed to `inImmediateTransaction` in [`commitResidentPromotion`](../../../libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts#L589) and [`promoteAtomically`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts#L478) contain exclusively plain statements without `try`/`catch` blocks.
- **Error Handling & Degradation Audits:**
  - In [`adoptable-slug.ts`](../../../libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.ts#L154,L169), `holdsBody` and `fileExists` log errors via `logger.warn` and assign local flags without returning from within the `catch` block.
  - In [`skill-curator.service.ts:616`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L616), `reconcileOne` catches `adoptMaterializedSkill` failures, logs with `this.logger.warn`, and safely sets the return outcome to `'failed'`.
  - In [`skill-candidate.store.ts:1714`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts#L1714), `readEmbedding` carries the required `// degradation-audit: optional-capability` marker and logs before fallback.

### 5. Spec Coverage & Load-Bearing Verification
- **[`skill-curator.service.spec.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.spec.ts):**
  - `(a)` Verifies shape 1: a rejected candidate row is re-promoted in place, row counts remain constant, suggestion is linked, and member candidates are merged.
  - `(b)` Proves rollback under concurrent race conditions where the rejected row status shifts before commit.
  - `(c)` Verifies shape 2: a diverged registry entry is adopted without requiring exact body matching, preserving user edits and updating candidate ID.
  - `(d)` Proves negative control where a diverged registry row missing `SKILL.md` is rejected.
  - `(e)` Confirms that live candidates, merged suggestions, and `retired:*` rows remain blocked.
  - `(f)` Confirms plugin-owned rows (`originPluginId`) cannot be adopted and roll back cleanly if encountered during re-promotion.
  - `(g)` Validates that diverged adopted skills remain exempt from subsequent retirement sweeps.
  - `(h)` Tests complete reset of stale fields (descriptions, display name, workspace root, judge metrics, embeddings) on revive.
  - `(i)` Verifies that old invocation events (>400 days) do not trigger immediate retirement of freshly revived skills.
- **[`adoptable-slug.spec.ts`](../../../libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.spec.ts):**
  - Confirms `materializedBaseSlug` matches `SkillMdGenerator.promoteToActive` output across various names, symbols, and Unicode strings.
  - Tests `slugHolderDecision` transitions across all status permutations.
- **[`skill-candidate.store.spec.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.spec.ts):**
  - Validates `listPromotedLastUse` fallback semantics and clock reset on revive.
  - Tests `promoteAtomically` compare-and-set guards and `resetRevivedContent` vector insertions.

---

## 2. Findings

*(Note: Prior findings from `code-logic-review.md` and `future-enhancements.md` items 32–37—including diverged adopt content tie-back [32], diverged resident cap counting [33], untested diverged + rejected combination [34], UI title fallback to old created date [35], orphan vec0 rows [36], and silent JSON parse catch in row mappers [37]—are excluded to avoid duplication).*

- **MINOR:** [`libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:1696`](../../../libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts#L1696)  
  *Statement:* `insertEmbedding` constructs the insertion buffer via `Buffer.from(vec.buffer)` without specifying `vec.byteOffset` and `vec.byteLength`.  
  *Scenario:* If a caller passes a `Float32Array` representing a slice/view of an ArrayBuffer (such as from a buffer pool or parsed batch), `Buffer.from(vec.buffer)` serializes the entire underlying ArrayBuffer rather than the vector slice, persisting incorrect byte dimensions into `skill_candidates_vec`.

- **MINOR:** [`libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.ts:151`](../../../libs/backend/skill-synthesis/src/lib/lifecycle/adoptable-slug.ts#L151)  
  *Statement:* `holdsBody` strips frontmatter with `raw.replace(/^---\n[\s\S]*?\n---\n/, '')`, which requires an exact trailing newline directly following the closing `---` delimiter.  
  *Scenario:* If a skill's `SKILL.md` was saved with trailing whitespace after the closing delimiter (e.g. `--- \n`) or lacks an empty trailing newline before the body text, the regular expression fails to match and `holdsBody` returns `false`, causing an otherwise matching on-disk legacy skill to be classified as missing.

- **MINOR:** [`libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts:552`](../../../libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts#L552)  
  *Statement:* In `adoptMaterializedSkill`, `emitRepropagation` is called after `commitResidentPromotion` finishes, causing the method to throw if event emission fails despite the DB transaction having already committed.  
  *Scenario:* If IPC/event emission encounters an unexpected error during startup reconcile, `reconcileOne` catches the throw and records the outcome as `'failed'` (scheduled for retry on the next boot), even though the SQLite candidate row was already promoted and linked. While subsequent boots recover via `link-promoted`, the startup log and diagnostics report a transient failure.

---

## 3. Verdict

### **APPROVED**

Commit `9978b040e` (Batch 15) resolves the real-world legacy adoption blockers discovered during Mode 3 QA. Atomic rollback guarantees across the revival path are preserved, the idle-clock adjustment properly provides grace periods to revived skills without disrupting active or unused promoted skills, and all new specifications assert load-bearing conditions.
