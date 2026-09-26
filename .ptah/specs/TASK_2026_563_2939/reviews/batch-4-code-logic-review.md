# Code Logic Review — TASK_2026_563_2939, Batch 4

## Initial review (superseded by Recheck round 1)

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 2              |
| Serious issues      | 0              |
| Moderate issues     | 2              |
| Failure modes found | 4              |

Scope: read all of `libs/backend/memory-curator/src/lib/memory-search.service.ts` and its 1,795-line spec, component 6 and the M5 inventory, Batch 4, relevant acceptance criteria, FTS planning, and caller/store context. Paths below are relative to `D:\projects\ptah-extension-memory-quality-source`; `search` means `libs/backend/memory-curator/src/lib/memory-search.service.ts`, `spec` its adjacent `.spec.ts`, and `store` the adjacent `memory.store.ts`. Store and caller observations are dependency context, not an additional Batch 3 review. No Batch 4 style review existed when checked. No applicable AGENTS.md/CLAUDE.md was found in this worktree; the task-referenced root HANDOFF.md is absent.

The implementation correctly implements the requested searchRich scope and static quarantine predicates, and the BM25 materialization is justified. The score is below 7–8 because cache correctness still admits stale and cross-scope results and the claimed main-equivalence evidence is insufficient. It is above 3–4 because these are localized defects: real SQLite tests exercise the primary behavior successfully, and the search/ranking pipeline is implemented rather than stubbed. The first two findings concern existing cache design retained in the reviewed implementation; they are not asserted to have been introduced by Batch 4.

Verification:

- Authorized scoped Jest invocation: **1 suite, 51 tests passed**, 5.234 s. No suite rerun. This is not evidence of both runtime drivers; no separate Electron run was performed.
- In-memory `node:sqlite` experiment reproduced `MIN(bm25(memory_chunks_fts)) ... GROUP BY mc.memory_id` failing with `unable to use function bm25 in the requested context`; MATERIALIZED returned the expected best-chunk ordering.
- In-memory execution of the transpiled current service, with controlled dependencies and the actual extracted store counter methods, reproduced findings 1, 2 (key equality), and 4. It did not open any persisted database or write any source.
- `ptah_get_diagnostics` was **unavailable**: its provider reported that none of the requested absolute worktree files are inside its workspace root. This is not a clean diagnostic result.
- No git commands were run because the reviewer role forbids git operations. Consequently no exact HEAD diff or historical implementation was read. The reported original aggregate SQL failure was independently reproduced, but its historical presence is taken from the supplied task and implementation comment, not a verified HEAD snapshot.
- No real-corpus relevance run was attempted; that remains the Batch 7 gate.

## Five logic questions

### 1. How does this fail silently?

An all-workspace search can return a cached pre-write page after a named-workspace insertion or deletion (finding 1, search:250,327–330). Its API reports ordinary success. The retained BM25 fallback also converts SQL failure to an empty result with a warning (search:449–453,948–952); this is explicitly accepted failure behavior in implementation-plan.md:631, not counted as a new finding. The materialization removes one concrete cause of that failure.

### 2. What user action produces unexpected behaviour?

Repeat an unscoped query after forgetting a named-workspace memory: its cached content can remain visible until expiry (search:208–211,327–330; store:554–557). Query/workspace pairs containing the cache delimiter can also retrieve one another's results (finding 2, search:251). An internal searchIndex caller alternating omitted and empty workspace sees order-dependent results (finding 4, search:259,811).

### 3. What input data produces a wrong answer?

A legal POSIX workspace path containing `|`, paired with query text containing `|`, makes the rich-cache key ambiguous (finding 2). The index cache collapses an empty-string scope into the omitted-scope key even though SQL treats them differently (finding 4). Ordinary named/null/undefined rich-search inputs are separated correctly by search:177–187 and 248–250; the clamped limit is included at search:323,326.

### 4. What happens when a dependency fails?

Vector exceptions log and produce BM25-only results (search:337–347,625–638). Reranker exceptions preserve RRF order (search:365–380). Missing/wrong-dimensional embedding returns no vector candidates without marking degradation (search:479–480,961–962), a retained limitation. Timeline/getObservations SQL or queue errors propagate (search:678–741,769–779). No new retry, timer, listener, or disposal obligation was introduced. Tests cover reranker failure (spec:311–336), but not every malformed dependency response or timeout.

### 5. What is missing that the requirements never mentioned?

Collision-free cache serialization and a generation covering **every** named-workspace write are necessary for the promised cache semantics (findings 1–2). A before/after baseline must distinguish predicate equivalence from historical implementation equivalence (finding 3). Runtime quarantine during an awaited embed/rerank has no snapshot contract: raw hydration is at search:387,576–577, whereas filtering occurred before the await. The implemented quarantine producer is a boot migration, so this is a future concurrency constraint, not an asserted reachable Batch 4 defect.

## Failure modes

### 1. Blocking — all-workspace cache generation misses ordinary named-workspace writes

- Trigger: cache `searchRich(query, 10, undefined)` or `searchIndex({query})`, then insert/delete matching data in `/ws/a`, and repeat within 60 seconds.
- Symptom: missing new results or retained deleted memory content, with a success-shaped response.
- Evidence: search:250 uses `getWriteCounter('')`; search:259–260 does the same for unscoped index calls; search:327–330 and 600–602 return cached objects without revalidation. Store:181–183 increments only the supplied key; insertion at store:306 and forgetting at store:554–557 pass the named workspace.
- Current handling: ordinary named writes leave `''` unchanged. In the reproduction, named counter became 1, global remained 0, and the second call returned the identical cached response. Conversely, `markWorkspacesChanged(['/ws'])` bumped both and invalidated it (store:169–177). Restore correctly uses that method (store:923–924).
- Recommendation: provide a true all-writes generation, or make all successful mutation paths advance the global generation in addition to their named generation. Coordinate the store-side contract correction with its owning batch. Add actual insert/forget and restore cache regressions for named, null and all-workspace reads; do not substitute a manually incremented mock counter.

### 2. Blocking — rich-cache serialization can cross workspace boundaries

- Trigger: equal counters and limit for `(query='q|/ws/a', workspace='/ws/b')` and `(query='q', workspace='/ws/a|/ws/b')`.
- Symptom: whichever query runs second receives the first query's cached full memories without running its scope predicate. `|` is valid in POSIX path components; the product serves multiple runtimes.
- Evidence: search:248–251 concatenates unescaped fields; search:327–330 returns the cached response before SQL; search:177–187 otherwise filters correctly.
- Current handling: both keys are exactly `q|/ws/a|/ws/b|10|0` when counters are zero. Key equality was reproduced with the current compiled method. Sentinel strings also occupy the same namespace as raw workspace strings.
- Recommendation: serialize a tuple, e.g. `JSON.stringify([query, ['named', ws], limit, counter])`, with distinct `['all']` and `['null']` variants. Add a regression using the two pairs above. This corrects encoding without changing ordinary scope semantics.

### 3. Moderate — the equivalence spec is not a main-versus-branch baseline

- Trigger: use spec:1749–1793 to justify measuring current code with nothing quarantined as “main”.
- Symptom: a non-predicate regression can be present in both sides of the test and pass, invalidating the relevance-gate baseline.
- Evidence: spec:1500–1501 only replaces `quarantined_at IS NULL` with `1`; spec:1763–1764 constructs the same new service twice. Both retain the new joins, cache key and materialized BM25 query. Implementation-plan.md:647–649 and 1026 rely on this test to claim historical equivalence.
- Current handling: this is a useful **predicate-neutrality** test on six synthetic memories, with zero-vector ties and no real reranker (spec:1492–1497,1750–1761). It does not prove old/new equivalence. The index-query result deliberately changes after the aggregate fix even with zero quarantined rows.
- Recommendation: keep this test but label its actual guarantee. For Track A, compare a frozen/reviewed baseline searchRich BM25 path against current code on the same fixtures (including ties and AND-to-OR fallback), or run the actual base implementation on the same allowed DB copy. Treat index-search repair as an intentional behavioral change, not equivalence. Do not claim the numerical relevance gate has passed until Batch 7 supplies its evidence.

### 4. Moderate — searchIndex empty scope shares a cache entry with a different SQL scope

- Trigger: internal callers alternate `searchIndex({})` and `searchIndex({workspaceRoot: ''})` on the same singleton.
- Symptom: the empty scope returns all-workspace results when the omitted scope warmed the cache, or the omitted scope receives an empty/narrow result when calls are reversed.
- Evidence: search:259–272 makes the keys identical. `buildFilterClause` at search:811–813 emits `m.workspace_root IS ''` for the latter, but no workspace predicate for the former. The two by-memory helpers at search:919,972 treat `''` as unscoped before final filtering.
- Current handling: reproduced with the actual index-cache path and controlled row provider. RPC rejects `''` (`libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.schema.ts:22`), limiting this to internal service use; hence Moderate rather than an externally reachable scope leak. This inconsistency is retained, not claimed new.
- Recommendation: define empty-scope semantics once for searchIndex and use the same normalized scope in helpers, final filters and key, or reject empty scope at the service boundary. Keep the rich-search tri-state contract separate unless deliberately extending the index API.

## Blocking issues

Findings **1** and **2**, with scenarios, impact and fixes above. Both can silently mislead callers; finding 2 returns full memory content from the wrong requested scope. These are retained defects within the explicitly requested cache audit, not an assertion that the quarantine predicates themselves leak rows.

## Serious issues

None established.

## Moderate and minor issues

- **3 — Moderate:** baseline proof gap (spec:1500,1763–1787).
- **4 — Moderate:** internal index empty-scope/cache inconsistency (search:259,811).
- Coverage note, not a fifth finding: the restore-cache test uses raw SQL plus `markWorkspacesChanged`, not the actual `restoreQuarantined` API (spec:1620–1630). The production restore path was checked directly at store:923–924 and correctly invalidates relevant generations.

## Data flow

1. **OK:** `search()` delegates to `searchRich` and projects hits (search:275–295). Omitted scope remains all-workspace. `null` is newly exact for rich search; `''` remains all-workspace there (search:177–187).
2. **GAPS 1–2:** limit clamps before key construction; key distinguishes ordinary null/all/named scopes and page sizes, but lacks collision-free encoding and a complete global generation (search:243–251,323–330).
3. **OK:** BM25 always joins parent memory and filters quarantine/scope before `LIMIT` (search:429–445). FTS AND-first/OR-fill uses the existing helper (fts-query.util.ts:161–182).
4. **OK with accepted limitation:** vector KNN caps first, then resolves active, scoped chunks (search:482–512). Quarantined/out-of-scope chunks may consume all KNN slots. This is explicitly accepted at implementation-plan.md:612–623; there is no pre-KNN quarantine filter or refill claim.
5. **OK for static corpus:** weighted RRF, optional rerank and final projection remain separate from the by-memory BM25 fix (search:349–405). A changed topK now receives its own correctly sized cache page; literal “unchanged apart from quarantine” therefore excludes the intended cache correction.
6. **OK:** index BM25 materializes matched, active chunks, aggregates their minimum score, sorts ascending and limits memories (search:921–934). Vector-by-memory filters quarantine on resolution and deduplicates by memory (search:972–995). These helpers accept optional string scope, not the rich-search null contract. Null is not exposed by MemSearchIndexFilter (search:40) or its RPC schema. Failure to add null here is not an M3 defect.
7. **OK / GAP 4:** index RRF uses ordered BM25/vector lists; final fetch applies metadata and quarantine filters (search:640–658,802–854). Pure listing applies quarantine before LIMIT (search:861–871).
8. **OK:** quarantined/missing timeline anchor returns empty; neighbors exclude quarantine before both limits (search:678–719). getObservations excludes quarantined ids before mapping or selecting sessions for queue peeks (search:733–779). Queue rows for sessions also containing active memories remain session-level observations, not quarantined memory rows.

### BM25 repair and downstream behavior

The reported old SQL expression genuinely fails in SQLite. In the in-memory reproduction, memory A had chunk scores `-1.375e-6` and approximately `-0.785714e-6`, while B had `-1e-6`. MATERIALIZED plus MIN returned A then B, proving **best chunk**, not average/worst chunk. SQLite's more negative BM25 value ranks better; `ORDER BY rank ASC` is correct (search:930–934). The current spec also asserts strong before weak, without warnings (spec:1635–1657), although it does not execute the old failing query.

Ranking remains AND-primary then OR-fill across expressions (fts-query.util.ts:167–180), and RRF consumes ordinal ranks rather than BM25 magnitudes (search:1007–1017). Thus “best chunk” is within each FTS expression, not a global re-sort of the AND and OR pages.

`mem:searchIndex` now gains functioning lexical candidates instead of the caught-empty BM25 branch; with vectors enabled, these candidates change fused ranking, and with vectors disabled, lexical matches now appear. The RPC calls this service directly (`libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.handlers.ts:76`). Corpus build likewise uses index-search ids (`libs/backend/memory-curator/src/lib/knowledge-agents/knowledge-agent.service.ts:212–221`) and persists them at :81–84; rebuild replaces members at :184–193. Query-based corpora can therefore gain lexical members and displace prior vector-ranked members at the cap. This is a real, justified repair, not neutral quarantine filtering. Empty-query corpus listing bypasses this BM25 helper (search:610–618).

The Track A path is searchRich BM25-only (implementation-plan.md:1026); it never calls bm25SearchByMemory (search:333 versus 614). Consequently this aggregate repair is not itself a Track A ranking change. Historical parity still requires the evidence requested in finding 3.

## Requirements fulfilment

| Requirement                                                                   | Status   | Gap                                                                            |
| ----------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| M3 criterion 3: exact rich null/named scope                                   | COMPLETE | Helpers and tests cover null versus all; search:177,425,490; spec:1562         |
| Cache limit and ordinary tri-state separation                                 | COMPLETE | search:248–251,323; spec:937–979,1581–1609                                     |
| Cache correctness after writes                                                | PARTIAL  | Finding 1; restore path itself is correct                                      |
| No cross-scope cache leakage                                                  | PARTIAL  | Finding 2; internal index edge in finding 4                                    |
| M5 criterion 5: static search/index/timeline/observation quarantine exclusion | COMPLETE | SQL coverage above; spec:1660–1746; accepted KNN starvation                    |
| Batch 4 no-quarantine predicate neutrality                                    | COMPLETE | Spec tests this narrow property                                                |
| Historical equivalence used by §4 criterion 1                                 | PARTIAL  | Finding 3; no main snapshot or real-corpus gate run                            |
| Both SQLite runtime drivers and clean diagnostics                             | PARTIAL  | One passing Jest run; diagnostics unavailable; Electron evidence not collected |

Implicit requirements not addressed: unambiguous key serialization, complete all-workspace mutation generation, and a defined index empty-string scope.

## Edge cases

| Case                                         | Handled | How                                               | Concern                                                               |
| -------------------------------------------- | ------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Rich null / undefined / empty / named        | YES     | shared scope predicate and ordinary distinct tags | delimiter collision is separate                                       |
| topK 5 then 10; 60 then 50                   | YES     | clamped key component                             | spec:948–957,1594–1609                                                |
| Restore null or named                        | YES     | named + global generation invalidation            | actual restore API not exercised in new cache test                    |
| Named insert/forget after global cache hit   | NO      | only named generation changes                     | finding 1                                                             |
| Quarantined BM25 hits exceed page            | YES     | filter before LIMIT                               | spec:1660–1697                                                        |
| Quarantined nearest vectors exceed KNN page  | NO      | filtered after KNN                                | accepted limitation, measure in Batch 7                               |
| Missing/quarantined timeline anchor          | YES     | empty rows, index zero                            | search:681–684                                                        |
| Empty observation ids / quarantined-only ids | YES     | early return / no selected sessions               | search:728–741,766                                                    |
| Multi-chunk BM25 memory                      | YES     | materialized MIN, ascending                       | distinct chunk strength reproduced                                    |
| Same timestamp timeline neighbors            | NO      | strict less/greater excludes ties                 | retained behavior at search:692,704; outside this change's acceptance |
| Empty index workspace vs omitted             | NO      | key and SQL disagree                              | finding 4; RPC rejects empty                                          |

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** in the reproduced cache/SQL behavior; **MEDIUM** in historical non-regression because no base diff or baseline run was available under the reviewer constraints.
- Top risk: a cache hit bypasses otherwise-correct filtering and can return stale or wrong-scope memory content.
- What a robust implementation would add: structured scope keys; a complete all-writes generation; regression cases for real mutations and delimiter pairs; normalized index scope; a genuine baseline comparison for Track A; recorded Electron and scoped diagnostic/typecheck evidence before acceptance.

## Recheck (round 1)

This section is the current assessment and supersedes the initial score/verdict and open-issue counts above. Initial findings are retained as the audit trail; their line numbers describe the original revision. All line numbers below describe the revised files read during this recheck. No source or persisted database was modified.

### Current summary

| Metric                             | Value                             |
| ---------------------------------- | --------------------------------- |
| Overall score                      | 7/10                              |
| Assessment                         | NEEDS_REVISION                    |
| Open blocking issues               | 0                                 |
| Open serious issues                | 0                                 |
| Open moderate issues               | 1                                 |
| Open failure modes                 | 1 (measurement-baseline validity) |
| Prior findings resolved            | 1, 2, 4                           |
| New behavioral defects established | 0                                 |

The revised runtime logic is sound within the reviewed scope. The remaining revision is the baseline evidence/measurement contract in finding 3, not a request to change the now-correct cache implementation. A score of 7 rather than 5 reflects the closure of both reproduced blocking cache defects and the index-scope inconsistency. It remains below 8–9 because the task's main-versus-branch relevance baseline is still unsupported by the test that the plan cites, and dual-driver/current diagnostic evidence was not collected in this recheck.

### Per-finding disposition

| Finding                                                           | Status                        | Revised evidence and conclusion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Unscoped cache survives named writes — Blocking                | **RESOLVED**                  | `store:174–191`: `bumpWriteCounter` delegates to `markWorkspacesChanged`; named writes increment both the named generation and `''`. `search:259,274` reads that global generation for unscoped keys. Real-store insert and forget regressions warm both caches and then assert changed ids (`spec:1890–1911`). The restore regression calls the actual API and verifies unscoped rich/index plus named rich results (`spec:1914–1932`); the actual restore invalidates after a successful transaction (`store:935–942`). Store inspected as dependency context only. |
| 2. Delimiter key collision crosses scopes — Blocking              | **RESOLVED**                  | `search:190–197` makes structural `['all']`, `['null']`, `['named', ws]` tags; `search:254–265` serializes the rich key as one JSON tuple. The exact two prior collision pairs now both reach SQL with their respective workspace arguments and return distinct cached objects (`spec:949–959`). `search:273–289` also structurally encodes the index key. Arbitrary delimiter, quote, backslash or sentinel-looking string values cannot shift tuple fields.                                                                                                         |
| 3. Predicate neutrality presented as historical parity — Moderate | **PARTIALLY RESOLVED / OPEN** | `spec:1772–1776` explicitly states that this compares the current implementation with/without its predicate and does not compare an earlier service. This fixes the spec's claim. However, `implementation-plan.md:647–649` still says this proves historical equivalence, and `implementation-plan.md:1026` still defines the relevance baseline as current code on migration 48 because that spec establishes main equivalence. The executable comparison is still two instances of current code (`spec:1790–1791,1811–1814`); no historical oracle was added.      |
| 4. Index empty-scope/cache mismatch — Moderate                    | **RESOLVED**                  | `search:618–621` removes empty workspace before key construction and all branching. The normalized filter feeds key generation (`:623`), both candidate helpers (`:628–653`), pure listing (`:634`) and final fetch (`:665`). `spec:1823–1852` checks fresh instances for query and pure-filter paths with vectors on/off, preventing a cache hit from disguising SQL differences. `spec:1854–1865` separately verifies intentional same-scope cache reuse.                                                                                                           |

**Remaining fix for finding 3:** revise the measurement handoff so it no longer substitutes predicate neutrality for a main baseline. Use a frozen/reviewed baseline implementation or run the actual base version on the same permitted snapshot for Track A, then record both results under the task's relevance rubric. Alternatively supply a specific baseline-equivalence proof for the actual BM25 searchRich path, including ties and AND/OR fallback. The numerical evaluation belongs to Batch 7; this recheck does not demand that Batch 4 perform the entire evaluation, but the unchanged plan must not instruct Batch 7 to use an unproven substitute. No actual relevance regression is alleged.

### Revision-specific reasoning

- **Serialization cost:** rich-key construction is linear in query/workspace text and allocates one small tuple plus a scope array (`search:254–265`). Index-key serialization processes the same filter fields already projected and sorted, now inside a tuple (`search:273–289`). Neither adds a database query, corpus scan, asynchronous task, retained listener or session-growing cache. Both LRUs remain capped at 100 entries (`search:217–225`). No material new cost defect is supported by the code; no performance benchmark was claimed.
- **NULL and empty counter semantics:** executed the current counter methods in isolation, without a DB. A single `bumpWriteCounter(null)`, `undefined`, or `''` increments the global generation exactly once and no named generation; a single `/ws/a` write increments each relevant generation once. `markWorkspacesChanged([])` increments none; `['/ws/a','/ws/b']` advances each named key once and global once; `['/ws/a',null]` advances global once. This follows `store:178–182,186–191`, with no recursive call cycle.
- **Repeated roots:** `[null,null]` and `[null,'']` advance `''` twice, because the iterable itself is not deduplicated (`store:177–180`). Thus the comment's “exactly once per call” is stronger than the implementation for duplicate null roots (`store:169–172`). This does not recreate the old bug: counters are opaque monotonic generations, not mutation counts, and no asynchronous boundary occurs between increments. It causes no extra query or stale result. This is Batch 3 context and a comment precision observation, not a new Batch 4 logic finding.
- **Conservative invalidation:** NULL-only rich queries intentionally share the global generation but retain a distinct scope tag (`search:194,259,262`). A named write may unnecessarily evict a NULL-only cached result; it cannot serve wrong-scope data. Other named scopes retain their own generation (`store:178,182`).
- **Mutation during await:** cache key capture still precedes embed/rerank and the result is stored under that captured generation (`search:343,355,382,423`). If a committed write advances it while a request is in flight, later requests use the new generation, so the old completion cannot poison the new cache entry. The in-flight result is not a transactional snapshot; that retained limitation was not changed by this revision.
- **Index normalization:** creates a fresh filter rather than mutating the caller (`search:618–621`). Nonempty named roots remain exact; whitespace roots are not silently trimmed. Runtime null also becomes omitted, but null is outside the declared index contract (`search:40`); exact NULL scope remains specifically the searchRich contract (`search:326,181–182`).
- **Ranking and quarantine:** no new behavior was found in the reviewed query/ranking paths. BM25 still filters before its limit (`search:454–457,950–957`); materialization still selects minimum chunk score and sorts ascending (`search:944–957`). Vector quarantine filtering still follows KNN under the accepted limitation (`search:499–516,987–1002`). Timeline and observations still filter their SQL reads (`search:704,710,762`). The prior explanation of the intentional index/corpus ranking repair remains applicable.

### Five logic questions — current answers

1. **Silent failure:** the two reproduced cache failures are closed (`search:260,275`; `store:182`). Finding 3 can still silently mislabel an evaluation baseline (`implementation-plan.md:1026`). Existing warning-plus-empty BM25 handling is retained (`search:466–470,971–975`).
2. **Unexpected user action:** named insert/forget/restore now invalidates warmed unscoped caches (`spec:1890–1932`); index empty scope is consistently all-workspace (`search:618–628`). No new action-triggered runtime defect was established.
3. **Wrong input-dependent answer:** delimiter-containing query/path pairs no longer alias (`spec:953–959`). Rich null/all/named scopes remain distinct (`search:190–197`). Unsupported runtime values are not evidence of a new typed-contract defect.
4. **Dependency failure:** vector and reranker fallbacks remain at `search:354–364,382–397,649–660`. This revision adds no dependency or timeout path.
5. **Missing requirement:** historical baseline validity still needs an explicit handoff correction and later measurement; predicate neutrality alone does not provide it (`spec:1772–1775`; `implementation-plan.md:647–649,1026`).

### Recheck verification and limits

- Ran the authorized `memory-search` Jest command once after the revision: **1 suite passed, 57 tests passed, 0 failed**, 3.736 s. This validates the new real-store regression assertions as well as the retained ranking/quarantine cases.
- Re-read the current production service, changed spec sections, store generation/mutation seams, plan baseline claims and the existing Batch 4 style review. No naming, formatting or file-size findings are duplicated here.
- Counter edge cases above were run from the actual extracted current methods with in-memory state only. The source and persisted databases remained read-only.
- The previous Ptah diagnostics result was unavailable because its provider is attached to another workspace; no repeat call was made to the unchanged provider. The existing style review records a prior typecheck, not a fresh typecheck of this revision. No separate Electron run, main-baseline execution or real-corpus measurement was performed.

### Current verdict

- Recommendation: **REVISE** — close the remaining measurement-baseline finding; runtime cache fixes are accepted.
- Assessment: **NEEDS_REVISION, 7/10; 0 blocking, 0 serious, 1 moderate, 1 open failure mode.**
- Confidence: **HIGH** for the reproduced fixes and counter semantics; historical relevance parity remains unverified.
- Top remaining risk: Batch 7 follows the unchanged plan and reports a current-code predicate comparison as a main-versus-branch relevance gate.
