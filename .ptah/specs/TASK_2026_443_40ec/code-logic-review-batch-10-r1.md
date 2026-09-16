# Code Logic Review — `TASK_2026_443_40ec` (Batch 10, Task 10.1, Revision 1)

## Summary

| Metric              | Value         |
| ------------------- | ------------- |
| Overall score       | 7/10          |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0             |
| Serious issues      | 1 (new)       |
| Moderate issues     | 0             |
| Failure modes found | 1 (new)       |

Every round-1 finding is CLOSED, verified against the code and not the report.
The revision itself introduces no false claim: all four "Legacy registered key;
no current runtime consumer" labels were checked and are true. One new serious
contradiction survives inside the same docs section, created in sharper form by
this revision: `settings.md` now says `memory.searchTopK` / `memory.searchAlpha`
are dead, while `searching.md` in the same section still tells the user to tune
both keys and claims they govern search.

## Round-1 finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 (index.mdx salience-decay claim) | CLOSED | `index.mdx:20` now reads "Salience affects query-time ranking only; it never promotes or demotes a memory"; the tier table's cap column is gone (`index.mdx:14-17`). Sweep `grep -rniE "salience[ -]?(scor\|decay)\|promote\|demot\|prune\|decay\|half-life\|fades"` over `apps/ptah-docs/src/content/docs/memory` returns only the allowed ranking-only denial at `index.mdx:20`. `searching.md` carries no salience/decay claim. Code cross-check: `salience-ranking.ts` ranking-only, `memory-lifecycle.store.ts:22-23` the only tier mover — unchanged, so the new text is true. |
| S2 (dead `tierLimits` rows) | CLOSED | `grep -rn "tierLimits\|decayHalflifeDays"` over `libs`, `apps`, `apps/ptah-docs/src` returns zero matches (excluding `.nx/cache`, `.ptah`). All six registry/default lines deleted (`file-settings-keys.ts` diff removes 3+1 keys from `FILE_BASED_SETTINGS_KEYS` and 3+1 from `FILE_BASED_SETTINGS_DEFAULTS`); `settings.md` rows and the `index.mdx` cap column are gone. |
| M1 (retention/lifecycle tables) | CLOSED | Every default and range matches the config sources exactly: retention enabled `true`/processedDays `7` (1–365)/stuckDays `14` (7–365)/batchSize `500` (50–5000) — `memory-retention-config.ts:29-43`; lifecycle enabled `true`/archiveAfterDays `30` (7–365)/deleteAfterDays `60` (7–730)/maxPerWorkspace `25000` (1000–1000000) — `memory-lifecycle-config.ts:12-23`. Registry parity holds (`file-settings-keys.ts:332-339,591-598`). The 7-day archival grace traces to `RETENTION_CAP_EVICTION_GRACE_MS` (`memory-retention-config.ts:61`). No invented number found. |
| M2 (`CuratorCallOptions` barrel claim) | CLOSED | The re-export sentence now names only `ICuratorLLM`, `ExtractedMemoryDraft`, `ResolvedMemoryDraft` (`memory-curator/CLAUDE.md` Public API), matching `src/index.ts` re-exports. Dropping (not exporting) is correct: every consumer imports the type from `memory-contracts` or the local `curator-llm/curator-llm.interface.ts` re-export (`memory-curator.service.ts:37`, `curator-window-runner.ts:15`, `agent-sdk/.../sdk-internal-query.curator-llm.ts:6`) — none from the `@ptah-extension/memory-curator` barrel. The new Public API symbols the revision added were also verified: `MemoryLifecycleStore`, `MemoryLifecycleService`, `RetentionRunBudget`, `MEMORY_LIFECYCLE_KEYS/DEFAULTS/SETTING_RANGES` each appear in `src/index.ts`; the tokens exist as properties of the exported `MEMORY_TOKENS` (`di/tokens.ts:49-61`) and `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` exists (`memory-contracts/src/lib/tokens.ts:4`, exported at `memory-contracts/src/index.ts:39`). The acceptance criterion ends green. |
| m3 (archival-writer wording) | CLOSED | `memory-curator/CLAUDE.md` now reads "The insert path may store an archival row and stamps its `archived_at`; `MemoryLifecycleStore.archiveBatch` is the only statement that moves an existing row to archival." This matches `memory.store.ts:195,205` (insert binds `tier: insert.tier`, stamps `archived_at` when tier is `archival`) and `ARCHIVE_UPDATE_SQL` (`memory-lifecycle.store.ts:24-26`), the only `SET tier` UPDATE. Accurate. |
| m4 (vec-pause condition) | CLOSED | `canDelete` (`memory-lifecycle.store.ts:141-152`): vec available → allowed; else trigger `memory_chunks_vec_ad` exists → blocked; else allowed. All three doc pages plus the changelog now state both halves: `settings.md` (Lifecycle closing paragraph), `how-it-works.md:52`, `pinning-and-forgetting.md:43`, `changelog.md` ("Memory lifecycle update"). No page repeats the old overbroad sentence. |
| m5 (pinned-restore contradiction) | CLOSED | `pinning-and-forgetting.md` now says pinning exempts from archival, deletion and cap eviction, and that a recorded use restores ANY archival row — pinned or not — to `recall`, where the row stays exempt. True of the code: `recordUse` restores with no pinned guard and nulls `archived_at` in the same statement (`memory.store.ts:544-551`); every lifecycle predicate carries `pinned = 0` (`ARCHIVE_SELECT_SQL`, `DELETE_ARCHIVED_SELECT_SQL`, `EVICT_*_SELECT_SQL`, `OVER_CAP_SQL`, `DELETE_MEMORIES_SQL` — `memory-lifecycle.store.ts:11-45`). The docs-only resolution is sound: after a restore the row is `recall` + pinned, exempt from every removal path, and carries no stale `archived_at`. |

## New findings

### N1 (serious) — `searching.md` still documents `memory.searchTopK` / `memory.searchAlpha` as live tunables, contradicting the new `settings.md` labels

- File: `apps/ptah-docs/src/content/docs/memory/searching.md:17,25`
- Scenario: a user reads `searching.md:25` — "`memory.searchTopK` (default `10`) caps the number of memories returned per query. Lower it if context budget is tight; raise it if the agent is missing relevant facts." They raise the key. Nothing reads it. A source-wide grep for `searchTopK`/`searchAlpha` (all quoting forms) over `libs` and `apps` `.ts`/`.html` returns only the registry entries (`file-settings-keys.ts:214-215,500-501`). The search service hardcodes its behaviour: `topK = 10` and `filter.topK ?? 20` defaults (`memory-search.service.ts:241,554`) and RRF weights from a method parameter, not configuration (`memory-search.service.ts:309-310`, `RRF_K_DEFAULT = 25` at `:159-160`). The user gets no effect and no feedback.
- Impact: the same failure class as round-1 S2, and the revision made it worse in one way — `settings.md:21-22` now labels both keys "Legacy registered key; no current runtime consumer" one page away from `searching.md`'s live-tunable instructions, so the Memory docs section contradicts itself. `searching.md:25` also states default `10` where the registry says `20` (`file-settings-keys.ts:500`). This violates the round-1 S1 acceptance ("no surviving contradiction anywhere in `apps/ptah-docs/src/content/docs/memory`") — the revision's acceptance greps covered decay/tierLimits wording but never swept the legacy keys' live-behaviour claims.
- Fix: in `searching.md`, drop or correct the `memory.searchAlpha` blend paragraph (`:17-21`) and the `memory.searchTopK` tuning advice (`:25-27`) to match the `settings.md` labels (search uses fixed defaults today), or record the page as a follow-up with the same status as the Batch 9 moderates.

## Five logic questions (revision delta)

### 1. How does this fail silently?

N1: a user tunes `memory.searchTopK` per `searching.md:25`, the key routes to the file store, and nothing consumes it — no error, no log, no change in results.

### 2. What user action produces unexpected behaviour?

Setting any of the four legacy keys after reading `searching.md` instead of `settings.md`.

### 3. What input data produces a wrong answer?

Stale `memory.tierLimits.*` / `memory.decayHalflifeDays` values in an existing user's `settings.json`: inert after the removal — `FILE_BASED_SETTINGS_KEYS` is a routing set, not a whitelist, so the removal is safe (verified round 1, unchanged).

### 4. What happens when a dependency fails?

The vec-pause condition is now documented exactly as coded (m4 CLOSED). Nothing new.

### 5. What is missing that the requirements never mentioned?

The revision's acceptance grep list did not include a sweep for the four legacy keys' live-behaviour claims, which is how N1 survived two rounds.

## Verification of the team-leader's additional questions

8. **Legacy labels.** Verified against the code, not the report: `memory.curatorEnabled`, `memory.embeddingModel`, `memory.searchTopK`, `memory.searchAlpha` have zero consumers outside `file-settings-keys.ts` (grep over `libs`+`apps`, all `.ts`/`.html`, all quoting forms; the only `curatorEnabled` hits are the distinct `skillSynthesis.curatorEnabled` key). The labels are accurate — no false claim. The finding is the surviving contradiction in `searching.md` (N1), not the labels.
9. **Scope integrity.** The production diff is the dead-key deletion in `file-settings-keys.ts` only; no other executable code changed. `memory.store.spec.ts` is +43/-0 — purely additive, no assertion weakened anywhere. Every number in the revised docs traces to `memory-retention-config.ts`, `memory-lifecycle-config.ts`, or `file-settings-keys.ts`. The changelog is additive and the Hermes history block is untouched. The new spec case is genuine: `archiveBatch` is called with `cutoff = Date.now() + DAY_MS` while the restored row's `last_used_at` is `Date.now()`, so `last_used_at < cutoff` holds and `pinned = 0` in `ARCHIVE_SELECT_SQL`/`ARCHIVE_UPDATE_SQL` is the ONLY predicate keeping the row out — remove it and the test fails. It also asserts the restored state (`tier='recall'`, `archived_at=null`, `pinned=1`) against the real statement, and the schema additions (`corpus_memories`, `idx_memories_tier_last_used`) make the lifecycle SQL run for real. Helpers used (`seed` with `pinned` option, `makeVecStatus`, `log`, `getById`) all exist in scope.

## Data flow — revision claim-to-code verification (all OK unless noted)

1. Retention defaults/ranges → `memory-retention-config.ts:29-43` ✓
2. Lifecycle defaults/ranges → `memory-lifecycle-config.ts:12-23` ✓
3. Registry parity → `file-settings-keys.ts:332-339,591-598` ✓
4. Tier table wording → writer-set tiers, verified round 1 ✓
5. m3 wording → `memory.store.ts:195,205`; `ARCHIVE_UPDATE_SQL` ✓
6. m4 wording → `memory-lifecycle.store.ts:141-152` ✓
7. m5 wording + spec → `memory.store.ts:544-551`; lifecycle predicates `memory-lifecycle.store.ts:11-45` ✓
8. Public API list → barrel + `di/tokens.ts:49-61` + `memory-contracts` tokens ✓
9. `searching.md` live-tunable claims → **false** (N1)

## Requirements fulfilment (revision)

| Requirement | Status | Gap |
| --- | --- | --- |
| S1 fixed | COMPLETE | — |
| S2 fixed | COMPLETE | — |
| M1 fixed | COMPLETE | — |
| M2 fixed | COMPLETE | — |
| m3/m4/m5 fixed | COMPLETE | — |
| No new false claim (item 8) | COMPLETE | Labels verified true |
| No contradiction left in memory docs | PARTIAL | `searching.md:17,25` vs `settings.md:21-22` (N1) |
| Scope integrity (item 9) | COMPLETE | Spec additive; numbers traced |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| User tunes `memory.searchTopK` from `searching.md` | NO | Nothing reads the key | N1 |
| Stale `tierLimits` value in user settings | YES | Routing-set semantics; value inert | None |
| Pinned archival row used, then lifecycle runs | YES | Pinned predicates; new spec pins it | None |
| Fresh DB, vec never loaded | YES | Docs now state the trigger-existence half | None |

## Verdict

- Recommendation: REVISE (one targeted docs fix: `searching.md:17-27`)
- Confidence: HIGH
- Top risk: the Memory docs section again contradicts itself — one page labels two keys dead, the next page instructs the user to tune them.
- What a robust implementation would add: a `searching.md` paragraph matching the `settings.md` labels (fixed search defaults today), and a future acceptance grep that sweeps every documented `memory.*` key for live-behaviour claims, not only the wording of the keys a batch deletes.

## Not verified by execution

The machine hold was observed by the executor; this review also ran no test, build, typecheck, or lint command (the machine was reported free, but static evidence was sufficient for a docs-plus-deletion diff plus one additive spec). The new spec case is verified by reading the SQL it exercises, not by running it; the memory-curator test run remains the team-leader's post-hold verification step.

Scope examined: the full uncommitted diff (8 files, read whole), the current text of all five `apps/ptah-docs/src/content/docs/memory` pages, `changelog.md`, `file-settings-keys.ts`, `memory-curator/CLAUDE.md`, `memory.store.spec.ts` (helpers and schema included), `memory-retention-config.ts`, `memory-lifecycle-config.ts`, `memory-lifecycle.store.ts` (SQL + `canDelete`), `memory.store.ts` (insert and `recordUse`), `di/tokens.ts`, `memory-contracts` tokens and barrel, `batch-10-docs-report.md` `## Revision 1`, and the fix list in `batches.md`.