# Code Logic Review — TASK_2026_619 Batch 13d

## Verdict: APPROVED — 7/10

The change does what the user decided. An expected-file hit under unknown coverage now counts as found. A miss, a parse failure and every other error class stay non-pass. All negative and absence cases still refuse to pass on unknown coverage, and the suffix is attached to the probe that decided `ok`. Symbols-exact and memory scoring are untouched. The one real weakness is a pre-existing file-level match in edit-then-query, which this change makes reachable under unknown coverage. It is MODERATE, not blocking.

## Findings

1. MODERATE — edit-then-query passes on any hit in the edited file, not on the edited symbol.
   - Evidence: `lifecycle-probe.ts:75-76` uses `parseSymbolHits(..., [], true)` and `ranked.includes(file)`. `lifecycle-scenarios.ts:260-268` appends `benchEdited_<tag>` to `probeFile`, which already holds the probe symbol, then queries `edited` against `probeFile`. The hit's `symbolName` is never checked.
   - Failure scenario: the search is BM25 plus vector, so a unique-name query can still return nearest neighbours. If the stale index returns the old probe symbol from `probeFile`, then `at5.found` and `at60.found` are true although the edit was never indexed. Before 13d this was reachable only on clean coverage. Under unknown coverage it is now reachable on a census-time answer too, which weakens the "positive hit is verifiable" premise for this case. Add-then-query and cold-start are not affected: the added file holds only the new symbol, and cold-start checks the symbol that was already there.
   - Minimal fix: have `searchSymbol` accept an optional symbol name and require a hit with that `symbolName` in that file, or write the edit into a fresh file. Otherwise record it as a known limitation.

2. MINOR — misleading detail text when the hit was found only under unknown coverage and rejected.
   - Evidence: `lifecycle-probe.ts:198-203` prints `missing (cap or skip)` when `cleanFound` is false because `underUnknownCoverage` is true. `lifecycle-scenarios.ts:361-374` prints `not found and not reported as too large` in the same situation.
   - Impact: the result is a correct non-pass, but the reason reads as an absence when the file was in fact seen.
   - Minimal fix: branch the wording on `underUnknownCoverage` ("hit seen under unknown coverage, not counted as settled").

3. MINOR — in the index-age scenario, `refresh.ok` waits only for `reindexInFlight:false`.
   - Evidence: `lifecycle-probe.ts:187-192`.
   - Impact: if the census is still unknown when the refresh finishes, the scenario fails by design (`cleanFound` is false). The cause is only in the `missing` wording, see finding 2.
   - Fix: none beyond the wording in finding 2.

## Failure-mode checks

1. **Can a case PASS without the expected file in the ranked hits?** No.
   - `found` is `answer.ranked.includes(file)` (`lifecycle-probe.ts:76`). `ranked` comes from `normalizePath` with `workspaceRoot` (`tool-results.ts:54-56, 90`; `retrieval-metrics.ts:64-90`).
   - Separators are unified to `/`, the drive letter is normalized, and the root prefix is stripped. A hit outside the root stays absolute and cannot equal the relative `file`.
   - Case is preserved in the relative output. The `win32` lowercase fold is only used for the within-root test. A casing mismatch between the indexer and the scenario file name would give a false negative, never a false positive. That behaviour is the same as before 13d.
   - `probeFile` is built from `options.probe.location` with the `:line` suffix removed (`lifecycle-scenarios.ts:238`) and is a `/` path. The scenario files are written with `/` names.
2. **Negative cases on unknown coverage.**
   - Delete-then-query: `!probe.errored && !probe.found` (`lifecycle-scenarios.ts:325`). Unknown coverage sets `errored: true` (`lifecycle-probe.ts:79`), so it never counts as gone.
   - Symbol scope zero-hit: `!result.errored && result.hits === 0` (`lifecycle-scenarios.ts:610-624`). Unknown coverage sets `errored: true`, so it fails.
   - 1.5 MiB cap: `bigIndexed = found && !underUnknownCoverage` (`lifecycle-scenarios.ts:363`). `honest` is a text regex over `bigProbe.text` and the reindex reply, the same as before.
   - Index-age settle: the settle poll uses only the `reindexInFlight:false` regex (`lifecycle-probe.ts:161-166`). The final `cleanFound` excludes unknown coverage (`:198-200`).
3. **Polling helpers.** `pollUntil` returns `last: probe` for the probe that satisfied `want` (`lifecycle-probe.ts:131-132`). The suffixes at `lifecycle-scenarios.ts:255` (cold), `:307` (add) and `:359` (long) are gated on `ok && last.underUnknownCoverage`, so they cannot be wrong. On timeout `ok` is false and no suffix is added. The at5 and at60 suffixes read the single probe directly (`:273, :286`).
4. **Truncated or budget-cut bodies.** `parseJsonResult` strips the trailer and runs `JSON.parse` (`tool-results.ts:24-32`). A cut object is invalid JSON, so a `ToolResultParseError` becomes `errored:true, found:false, hits:0` (`lifecycle-probe.ts:85-94`). A partial body cannot produce a wrong hit list. A trailer appended to complete JSON parses to the full list.
5. **Tests.** `lifecycle-probe.spec.ts` covers unknown+hit, unknown+miss, clean hit, building and tool-error (hits not read), and unknown with an unparseable body. The text shapes are real (`hits`, `filePath`, `symbolName`, the `reasons`/`census` coverage block). `lifecycle-scenarios.spec.ts` adds 62 lines for the suffix and negative cases. Not covered: a stale same-file non-matching symbol (finding 1). The mixed case where the file is present under a different casing is also not covered.
6. **Symbols-exact and memory suites.** `classifyToolResult` and `parseSymbolHits` are unchanged. The diff touches only the three lifecycle files plus the new spec. `tool-suites.ts:189` calls `parseSymbolHits` directly and never goes through `searchSymbol`.

## Decisions

- Keep `errored: true` on a positive unknown-coverage hit. It stops the absence cases from passing, and `underUnknownCoverage` carries the extra information. Do not reuse `errored` to mean "failed".
- Keep unknown coverage non-verifying for the settle, large-file and index-age cases. They assert a property of the index state, which a single positive hit does not establish.
- Treat finding 1 as pre-existing scoring looseness rather than a regression of 13d. Fix it in a follow-up batch only if edit-then-query must be airtight.
