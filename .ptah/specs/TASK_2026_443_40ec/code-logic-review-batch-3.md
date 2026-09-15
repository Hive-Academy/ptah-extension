# Code Logic Review — `TASK_2026_443_40ec` (Batch 3)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 4                                    |

Scope reviewed: all uncommitted Batch 3 files — `apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts`, `libs/backend/memory-contracts/src/lib/memory-usage-recorder.port.ts`, memory-curator `src/index.ts`, `di/register.ts` + `register.spec.ts`, `di/tokens.ts`, `memory-curator.service.ts` + spec, `memory-decay.job.ts` + spec, `memory-search.service.ts` + spec, `memory.store.ts` + spec; deleted `salience-scorer.ts`; new `salience-ranking.ts` + spec. Every listed file was read in full or in its changed regions, plus the task documents (`batches.md`, `implementation-plan.md` AC3/AC5, `batch-3-report.md`).

No TODO/PLACEHOLDER/STUB markers, no empty bodies, no mock data standing in for logic, and no skipped specs were found in the Batch 3 surface. The skipped suites reported by the batch commands are pre-existing and outside the changed code.

## Nine confirmation items

### 1. R-TL1 — recordUse shape (CONFIRMED)

`memory.store.ts:524-557` implements the approved split exactly:

- `memory.store.ts:525-526` — `[...new Set(memoryIds)].slice(0, 200)`: dedupe happens BEFORE the 200-id cap, so 201 distinct ids still record the first 200 rather than 200 rows of whatever the list held. Empty input returns at `:526` before any SQL runs.
- Both statements run inside one `db.transaction` (`memory.store.ts:528`): first `SELECT DISTINCT workspace_root ... WHERE id IN (json_each(@ids)) AND tier = 'archival'` (`:535`), then the `UPDATE ... SET hits = hits + 1, last_used_at = @now, tier = CASE WHEN tier = 'archival' THEN 'recall' ELSE tier END, archived_at = NULL` (`:541-545`). There is no `RETURNING` anywhere in the method.
- The write counter bumps AFTER commit and only for roots the pre-update SELECT captured (`memory.store.ts:550`), so ordinary recall use cannot thrash the search cache — exactly the R-TL1 deviation reason.
- The restored-root count is correct by construction: only roots selected while the rows were still `archival` are bumped. `memory.store.spec.ts` pins both directions (restored root bumps once; plain recall use bumps nothing).
- Never throws: the whole body is wrapped in `catch (error: unknown)` with a single `logger.warn('[memory-curator] failed to record memory use', ...)` (`memory.store.ts:553-556`). The closed-connection spec asserts the no-throw path and one warn. Unknown ids match no rows; the UPDATE is a no-op and no counter bumps.

### 2. recordHit removal and no read-path writes (CONFIRMED)

- `recordHit` does not exist in `memory-search.service.ts`. `memory-search.service.spec.ts:342`-adjacent new test "returns at most topK without a reranker and performs no store write" asserts `recordUse` is never called on the search path, first call and cached call.
- Repo-wide grep of `recordHit|updateSalience|SalienceScorer|scoreMemory|MEMORY_SALIENCE_SCORER` over non-spec `libs/` and `apps/` returns zero matches. The only spec matches are the required negative assertion `register.spec.ts:90` and a pre-existing Batch 9 pointer in `wizard-seed-noop.spec.ts:41`. The `memory-curator/CLAUDE.md` mention is pre-existing documentation drift owned by Task 10.1.
- Writers of `last_used_at` in production code, exhaustive: the insert bind (`memory.store.ts:200`), `appendChunks`' UPDATE (`:603`, an approved merge use that also restores archival), and `recordUse` (`:541`). Nothing else writes it on a read.
- `memory-decay.job.ts` keeps compiling only through `rankSalience` (`:76`, read-only) and `MemoryStore.updateTier` (`:99`, tier only). The job contains no `SET salience` anywhere; grep confirms no `SET salience` in non-spec code. Nothing makes the job write salience again.

### 3. Salience immutable after insert (CONFIRMED)

- No `SET salience` and no `salience =` write exists in non-spec source; the only salience bind is at insert.
- Insert path: `memory-curator.service.ts:662-665` computes `baseSalience(r.salienceHint, input.salienceBoost)` and `:674` passes it as the stored base. `salience-ranking.ts` clamps to `[0,1]` and maps non-finite to 0. `memory-curator.service.spec.ts` pins `expect(insertedMemory.salience).toBe(0.6)`.
- Merge path: `memory-curator.service.ts:651-658` calls only `store.appendChunks(target.id, ...)`; `appendChunks` (`memory.store.ts:603`) restores an archival target and stamps `last_used_at` but never touches salience.

### 4. Ranking expression identical in all three ranked reads (CONFIRMED)

All three call sites use the single source `salienceRankOrderBy(...)` from `salience-ranking.ts`:

- `memory.store.ts:354` — `list`, named form `'@rankNow'`, bound in the named params object alongside `__limit`/`__offset`. One statement, one binding style.
- `memory.store.ts:394` — `listAll`, positional `'?'`, bound `.all(...params, Date.now(), clampedLimit, clampedOffset)`: the rank time lands after the filter params and before LIMIT/OFFSET, matching the clause order in the SQL. No mixed named/positional binds in one statement.
- `memory-search.service.ts:815-820` — `listIndexRowsByFilter`, positional `'?'`, bound `.all(...params, Date.now(), limit)`: rank time before LIMIT, correct.

The expression matches the plan formula (`implementation-plan.md:146-185`, AC5): `m.salience * (604800000.0 / (604800000.0 + MAX(0, <now> - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned`, tie-broken by `m.id DESC`. The `'?'` and `'@rankNow'` literals differ only in the placeholder token (`salience-ranking.spec.ts:96-100` pins this by string substitution). `salience-ranking.spec.ts:32-62` proves SQL/TS parity to 1e-9 on real SQLite across ages 0/7/30/90 days × hits 0/3/50 × pinned 0/1, and `:64-94` pins deterministic ordering (pinned first, recent-low before old-high, tie-b before tie-a).

### 5. Search always slices to topK (CONFIRMED, plan-approved)

- `memory-search.service.ts:342` — `fused = fused.slice(0, limit)` runs after the rerank block, so a no-reranker host (4 candidate sets fused) still returns exactly topK.
- Cache-hit path (`memory-search.service.ts:284-289`) returns the cached response, which was sliced before caching — the cached value is already topK, so cache hits cannot return an untrimmed list.
- Plan approval: `implementation-plan.md:383-385` names this exact fix for the AC3 over-count.
- Callers passing a limit: `memory-prompt-injector.ts:110` (`this.memoryReader.search(query, MAX_HITS, workspaceRoot)`) and `:232` (`reader.search(query, maxResults, workspaceRoot)`); `memory-namespace.builder.ts:224-226` (`searchRich(..., params.topK ?? 10, ...)`). Every production caller passes a finite limit.

### 6. DI aliasing (CONFIRMED, with one moderate gap in the spec)

- `di/register.ts:107-108` — `container.register(MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER, { useToken: MEMORY_TOKENS.MEMORY_STORE })`. `MEMORY_STORE` is registered as a singleton (`register.ts:71` with the singleton pattern beside it), and tsyringe `useToken` resolves the SAME container entry, so the recorder is the same `MemoryStore` instance the search service reads its write-counter from. The `MEMORY_LISTER` alias at `:104-105` is the established precedent in this file.
- `register.spec.ts:85-87` asserts `isRegistered` for both the constant and the literal `Symbol.for('PtahMemoryUsageRecorder')`; `:90` asserts the old `PtahMemorySalienceScorer` literal is gone.
- Optional consumers survive hosts without memory: `memory-prompt-injector.ts:95-98` injects `MEMORY_USAGE_RECORDER` with `{ isOptional: true }` and calls it through `this.usage?.recordUse(...)` (`:138`), itself wrapped in a try/catch (`:137-146`). The token is registered by `registerMemoryCuratorServices` in every host that registers the curator at all.
- Gap: see Moderate M1 — the spec proves registration, not instance identity.

### 7. XB1 — named/positional binds (CONFIRMED)

- Production: the archival-root SELECT binds `{ ids }` (`memory.store.ts:535`), the UPDATE binds `{ ids, now }` (`:541-546`); `list`'s named statement binds `rankNow`, `__limit`, `__offset` together; `listAll` and `listIndexRowsByFilter` bind all positionals in clause order. No statement mixes named and positional parameters.
- Specs: `salience-ranking.spec.ts` binds `(now, id)` for the parity SELECT, `(now)` for ordering, and all five positionals for the seed INSERT; `memory.store.spec.ts` seeds bind all 25 positional INSERT values; `memory-search.service.spec.ts` pins `.all('/ws', expect.any(Number), 7)` for the positional rank-time bind.
- `batch-3-report.md:104-111` records the same four suites green under the Electron-ABI better-sqlite3 binding (`binding=better-sqlite3 sqlite=3.53.1`, `Tests: 82 passed, 82 total`), which is the binding that throws on a missing named parameter. The claim is consistent with the statements read.

### 8. R-TL4 — Electron seed schema (CONFIRMED)

`wizard-seed.integration.spec.ts:109` adds `archived_at INTEGER` to the hand-written memories DDL. Migration 0044 declares `ALTER TABLE memories ADD COLUMN archived_at INTEGER;` — same name, same type, nullable. The seed schema matches.

### 9. Hexagonal boundaries (CONFIRMED)

`salience-ranking.ts` is a pure module inside memory-curator with no imports beyond TypeScript globals. `memory-curator.service.ts:29` and `memory-search.service.ts:34` / `memory.store.ts:37` import it locally. `memory-usage-recorder.port.ts` lives in `memory-contracts`, an existing allowed dependency of memory-curator (per that lib's own dependency list). The deleted scorer leaves no dangling import: `src/index.ts` re-exports the ranking module's names instead. No new dependency crosses the hexagonal line.

## Five logic questions

### 1. How does this fail silently?

Three accepted-by-design silent paths, one real one:

- `recordUse` swallows every failure to one `logger.warn` (`memory.store.ts:553-556`). If the database is closed or busy, use is not recorded and the memory can decay as if unused. This is the port's documented contract (`memory-usage-recorder.port.ts`: "never throws") — recording must never break a prompt injection or a tool result. The caller adds its own belt-and-braces catch (`memory-prompt-injector.ts:137-146`). Accepted.
- The interim decay job swallows per-memory diagnostic failures and continues (`memory-decay.job.ts`, pinned by its spec). Job is unregistered from any runner; no production path executes it. Accepted for the interim.
- M1 (below): a future second `MEMORY_STORE` registration would silently desync the recorder from the search cache with no failing test — that is the real silent-failure candidate, and it is latent, not live.

### 2. What user action produces unexpected behaviour?

- A user recalling a memory (search hit, `memory:get`, injected prompt) records a use. The stored `hits`/`last_used_at` change but the ranked list served from the 60-second search cache does not reflect it until the cache entry expires (see m3 — an explicit R-TL1 trade).
- Two rapid recalls of the same memory in one turn count once only if the caller batches the ids; `recordUse` dedupes within one call (`memory.store.ts:525`) but two separate `recordUse` calls each increment `hits`. The port documents dedupe per call, and each call is a distinct user-visible recall, so this is correct per contract.

### 3. What input data produces a wrong answer?

- More than 200 ids in one call: ids past the cap are ignored by documented contract; the spec pins 201 → 200 rows hit. Correct per contract, but callers must not treat `recordUse` as recording everything they pass. Current callers pass search-hit id lists bounded by topK, far under 200.
- Non-finite `salienceHint` / `salienceBoost` map to base 0 (`salience-ranking.ts` `baseSalience`), pinned in the spec. A garbage hint produces the lowest rank, not an error — defensible.
- Duplicate ids: counted once. Empty list: no SQL runs. Unknown ids: UPDATE matches nothing, no counter bump. All pinned in `memory.store.spec.ts`.

### 4. What happens when a dependency fails?

- SQLite closed/busy inside `recordUse`: caught, one warn, caller proceeds (`memory.store.ts:553-556`; `memory-prompt-injector.ts:137-146` adds a second guard). Verified by the closed-connection spec.
- The transaction wraps SELECT + UPDATE atomically (`:528`), so a mid-operation failure cannot leave a half-updated set: either every selected id got its use recorded, or none did. The counter bumps happen only after a successful commit, so a failed transaction never invalidates caches for a write that did not land.
- Embedder unavailable (VS Code / CLI hosts): pre-existing BM25 fallback, unchanged by this batch. The ranked reads do not depend on the embedder.

### 5. What is missing that the requirements never mentioned?

- `updateTier` (`memory.store.ts:560-566`) can set `tier = 'archival'` without stamping `archived_at`, producing an archival row the plan's lifecycle invariant says should carry a stamp. See m1.
- No spec pins "core and pinned rows never change tier on use" for `recordUse` (the plan acceptance listed the tier-unchanged case). The UPDATE's CASE only rewrites `archival` → `recall`, so core/pinned rows pass through with only `hits`/`last_used_at` updated — verified by reading the SQL, but untested. See m2.
- The decay-job interim spec deliberately thinned (~466 → ~100 lines). The job is deleted in Batch 9, so the residual risk window is one batch. See m4.

## Failure modes

### Recorder/search cache desync via a second store registration

- Trigger: a future change registers `MEMORY_STORE` a second time (e.g. a test double or a per-workspace instance) while `MEMORY_USAGE_RECORDER` keeps its `useToken` alias, or re-registers the recorder directly.
- Symptom: `recordUse` bumps the write counter on a different `MemoryStore` instance than the one `MemorySearchService` reads; ranked lists go stale with no error anywhere.
- Evidence: `di/register.ts:107-108`; `register.spec.ts:85-87` asserts `isRegistered` only — no `resolve(...) === resolve(...)` identity assertion.
- Current handling: correct in production — tsyringe `useToken` resolves the same singleton entry (`register.ts:71`), and the `MEMORY_LISTER` alias beside it has worked this way already.
- Recommendation: add one identity assertion to `register.spec.ts` (`container.resolve(MEMORY_USAGE_RECORDER) === container.resolve(MEMORY_STORE)`).

### `updateTier` creates archival rows without `archived_at`

- Trigger: the interim `MemoryDecayJob` demotes a recall row to archival via `store.updateTier(m.id, nextTier)` (`memory-decay.job.ts:99`); `updateTier` (`memory.store.ts:560-566`) sets tier and `updated_at` only.
- Symptom: an archival row with `archived_at = NULL`, violating the lifecycle column's meaning and any future query that filters on the stamp.
- Evidence: `memory.store.ts:560-566`.
- Current handling: unreachable in production — the job has no runner (`diagnostics.service.ts:48` reads `lastDecayInfo()` only), and the job plus `updateTier` are deleted in Batch 9. `recordUse`'s `archived_at = NULL` on restore is correct.
- Recommendation: none needed for this batch; if the interim ever runs before Batch 9 lands, stamp `archived_at` when `updateTier` sets `'archival'`.

### Use-recording failure is invisible to the user

- Trigger: database closed or busy at the moment a use fires.
- Symptom: one warn line; the memory's `hits`/`last_used_at` stay stale and the memory can decay as if unused.
- Evidence: `memory.store.ts:553-556`; `memory-prompt-injector.ts:137-146`.
- Current handling: this is the port's documented contract — recording is an optional side effect and must never break the host operation. Accepted by design; the warn is the observability.
- Recommendation: none.

### Ranked list can be stale up to the cache TTL after a plain recall use

- Trigger: `recordUse` bumps `hits`/`last_used_at` on a non-archival row; no write-counter bump fires, so the search cache serves the old ranking until its TTL.
- Symptom: a memory just used may not rank higher in the very next search within the TTL window.
- Evidence: `memory.store.ts:541-550` (bump only for restored roots); plan R-TL1.
- Current handling: explicit, plan-approved trade — bumping on every prompt injection would thrash the cache keyed on the write counter.
- Recommendation: none (plan decision).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

**M1 (moderate) — register.spec does not pin alias identity.** `register.spec.ts:85-87` asserts `isRegistered` for the usage-recorder token but never asserts the resolved instance IS the `MEMORY_STORE` singleton. A future re-registration of either token silently desyncs the recorder's write-counter bumps from the search service's store, re-enabling stale ranked caches with no failing test. One-line fix: `expect(child.resolve(A)).toBe(child.resolve(B))` for both the constant and the `Symbol.for` literal.

**m1 (minor) — `updateTier` archival without `archived_at`.** `memory.store.ts:560-566` sets `tier = 'archival'` with no stamp. Unreachable in production (no job runner) and deleted in Batch 9, but a live hazard if the interim job ever runs before Batch 9.

**m2 (minor) — no core/pinned tier-unchanged spec case.** The plan's acceptance for `recordUse` listed the tier-unchanged case for core/pinned rows. The UPDATE's CASE clause guarantees it by reading (`memory.store.ts:541-545`), but no spec pins it.

**m3 (minor, plan-accepted) — plain recall use does not bump the write counter.** `memory.store.ts:550` bumps only restored roots, so a just-used memory's higher rank appears only after the search cache TTL expires. Explicit R-TL1 trade against cache thrash; recorded here for the audit trail.

**m4 (minor) — decay-job interim coverage thinned.** `memory-decay.job.spec.ts` shrank from ~466 to ~100 lines with three tests. Deliberate: the job is deleted in Batch 9 and nothing runs it. Acceptable for a one-batch bridge.

## Data flow

Use-recording path, entry to exit:

1. A caller (prompt injector `memory-prompt-injector.ts:138`, MCP search, `memory:get`, curator merge via `appendChunks`) decides a memory was used. OK.
2. `recordUse(memoryIds)` — dedupe, cap at 200, empty no-op (`memory.store.ts:525-527`). OK.
3. Transaction opens; SELECT captures archival roots pre-update (`:528-535`). OK.
4. UPDATE increments `hits`, stamps `last_used_at`, promotes `archival` → `recall`, clears `archived_at` (`:541-545`). Salience untouched — ranking-only invariant holds. OK.
5. Commit; write counter bumps per restored root only (`:550`). Search cache invalidates for exactly the workspaces that changed shape, not for plain use. OK.
6. Failure at any SQL step: rollback, one warn, caller proceeds (`:553-556`). OK.

Read path:

1. `list`/`listAll`/`listIndexRowsByFilter` bind a fresh `Date.now()` and the shared ranking clause. OK.
2. `memory-search.service.ts` fuses candidate sets, reranks when available, slices to `limit` at `:342` before any caller sees the list — including when the reranker is absent. OK.
3. Cache-hit return path serves the already-sliced cached response (`:284-289`). OK.
4. Curator insert: `baseSalience(hint, boost)` clamped, stored once (`memory-curator.service.ts:662-674`). Merge: append only, restore archival target, salience untouched (`:651-658`, `memory.store.ts:603`). OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Task 3.1 — ranking-only salience, scorer removed | COMPLETE | — |
| Task 3.2 — explicit use recording (recordUse) | COMPLETE | Core/pinned tier-unchanged case untested (m2) |
| Task 3.2 — search stops writing usage, slices to topK | COMPLETE | — |
| Task 3.2 — DI alias to singleton store | COMPLETE | Spec lacks identity assertion (M1) |
| Task 3.3 — Electron seed DDL `archived_at` | COMPLETE | — |
| R-TL1 — no RETURNING, one transaction, restored-only bumps | COMPLETE | — |
| R-TL4 — seed schema matches migration 0044 | COMPLETE | — |
| XB1 — all named/positional params bound, both SQLite bindings | COMPLETE | — |
| AC5 — stored salience written once at insert | COMPLETE | — |
| AC3 — "used" restores archival → recall | COMPLETE | — |

Implicit requirements not addressed: none found. The interim decay-job bridge (`memory-decay.job.ts:76,99`) is a declared plan deviation in `batch-3-report.md`, keeps the batch's verification commands green, and writes no salience.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Empty id list | YES | Early return before SQL (`memory.store.ts:526`) | None; pinned in spec |
| Duplicate ids in one call | YES | `Set` dedupe before cap (`:525`) | None; pinned |
| More than 200 ids | YES | `slice(0, 200)` after dedupe (`:525-526`) | Documented port contract; pinned |
| Unknown ids | YES | UPDATE matches nothing; no counter bump | Pinned |
| Closed connection | YES | Catch, one warn, no throw (`:553-556`) | Use silently unrecorded — accepted contract |
| Busy database | YES | Same catch path | Same acceptance |
| Archival row used | YES | Promoted to recall, `archived_at` cleared, counter bumped | Pinned both directions |
| Core/pinned row used | YES | CASE clause leaves tier untouched | Not pinned by a spec (m2) |
| Merge into archival target | YES | `appendChunks` restores and stamps (`memory.store.ts:603`) | Pinned |
| No reranker host | YES | `fused.slice(0, limit)` (`memory-search.service.ts:342`) | Pinned |
| Search cache hit | YES | Cached response pre-sliced (`:284-289`) | Pinned (recordUse never called) |
| Non-finite salience inputs | YES | `baseSalience` maps to 0 | Pinned in `salience-ranking.spec.ts` |
| `updateTier` to archival | PARTIAL | Tier set, `archived_at` not stamped (`memory.store.ts:560-566`) | Unreachable; deleted in Batch 9 (m1) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the recorder-to-store DI alias is verified only by registration, not instance identity, so a future re-registration would silently stale the search cache with no failing test (M1).
- What a robust implementation would add: the identity assertion in `register.spec.ts`; a core/pinned tier-unchanged case in `memory.store.spec.ts`; `archived_at` stamping in `updateTier` if the interim decay job is ever run before Batch 9 deletes it.

Score rationale: 8/10. The batch implements every acceptance criterion it owns with correct transaction shape, correct counter discipline, an exact SQL/TS parity proof on real SQLite, and both-binding verification. It sits below 9 because the one assertion that would make the DI aliasing contract regression-proof (instance identity) is missing, and because two plan-listed edge cases rest on reading the SQL rather than on specs. Nothing found rises to serious: every gap is either latent (M1), unreachable (m1), or plan-accepted (m3).