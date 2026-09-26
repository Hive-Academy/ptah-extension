# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 5, round 2, independent store-layer review: **REVISE, 7/10**. Both round-1 defects are fixed. The Unicode length window and RRF bound hold for the examined inputs. One reproduced moderate performance regression remains: an unsuccessful single-token lookup can synchronously materialize and lowercase every symbol in a large workspace.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 1              |
| Failure modes found | 1              |

The move from 6 to 7 is supported by the corrected Unicode recall and enforced CI guard. The remaining measured event-loop stall prevents an 8: this is observable extra work on a normal search miss, although its material impact needs a large workspace. No correctness or data-integrity defect was reproduced in the revised lookup.

Read all four named files in full, the round-1 review, executor report including its revision, Batch 5 requirements, and context Decision 1. Inspected migration 0013, FTS helper, symbol sink/indexer, caller error handling, adjacent native-probe/fusion patterns, project test configuration, and relevant workflows. No task-description.md, implementation-plan.md, or code-style-review.md exists in this task folder. `ptah_search_files` returned no AGENTS.md; ancestor checks also found none. No Ptah file-read or Write tool is available, so native reads and the native file writer were used. No production changes or git operations were performed. No raw session logs or real user databases were read. Independent reproductions used only `:memory:` SQLite databases and in-memory TypeScript transpilation. The requested existing project test command was also executed.

Evidence abbreviations (all paths relative to the worktree):

- **S**: `libs/backend/memory-curator/src/lib/code-symbol.store.ts`
- **T**: `libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts`
- **P**: `libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts`
- **B**: `libs/backend/memory-contracts/src/index.ts`
- **M**: `libs/backend/persistence-sqlite/src/lib/migrations/0013_code_symbols.ts`
- **N**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`

## Round-1 findings

| Finding                                              | Status    | Reproduction and evidence                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: ASCII-only NOCASE misses Äpfel/äpfel             | **fixed** | S:404 performs identical-case lookup; S:439 and S:455 compare Unicode lowercase strings. Repeated the r1 long `Äpfel` declaration / short `äpfel äpfel äpfel` caller fixture, vectors disabled, real migration schema: both queries return `a.ts` first with score 0.13760683760683762. T:1130 adds the distractor and workspace regression.                                                                |
| M2: required recall guard skips after native failure | **fixed** | Injected `require.resolve('better-sqlite3')` failure while evaluating the current complete spec. With `CI=true`: 35 runnable, 0 skipped, recall runnable; the readiness callback throws with `INJECTED_ABI_MISMATCH: expected Node ABI` preserved. With CI unset or `false`: 13 runnable, 22 skipped, and stderr explicitly names the skipped recall guard and cause. Evidence: T:237, T:245, T:255, T:262. |

## Five logic questions

### 1. How does this fail silently?

No new success-looking correctness failure was reproduced. The r1 native-failure bypass is closed by T:255 and T:262. Exact/freshness SQL exceptions propagate from S:412 and S:238; injecting `INJECTED_SQL_FAILURE` into the exact lookup rejects `searchSymbols`, and the current namespace translates rejection into an explicit error at N:112. Existing BM25 error fallback logs and returns an empty list at S:490; it was not introduced by this revision.

### 2. What user action produces unexpected behaviour?

Searching a single natural-language token that is not a symbol name, such as `transactions`, forces the synchronous fallback before hybrid search (S:343, S:417). In the 100,000-row fixture below this adds about 172 ms on the calling event loop, despite requesting only five results (M3). Queries containing whitespace bypass the added lookup at S:399.

### 3. What input data produces a wrong answer?

No wrong result was reproduced for BMP case variants, astral characters, supplementary-plane case pairs, or dotted-I expansion in either direction. S:440 uses `[...folded].length`, **not** `folded.length`: it counts code points, matching SQLite TEXT `length()` for these names. Identical-case preference remains explicit at S:415. The policy is default JavaScript lowercase equality, not full Unicode case folding; the sharp-s and Turkish distinctions are documented at S:420 and tested at T:1172.

### 4. What happens when a dependency fails?

An exact-query SQL failure rejects rather than fabricating success (S:412; injected rejection verified). Vector rejection retains the existing logged BM25 fallback (S:354); malformed vector length retains the existing empty vector contribution (S:504). Native test dependency failure now fails CI with its cause (T:255). No new timeout or cancellation mechanism was added around embedding; that unchanged behavior was not exhaustively fault-tested in this review.

### 5. What is missing that the requirements never mentioned?

A bound on synchronous work for a failed name lookup. `limit` bounds matches returned, not rows inspected or strings allocated (S:453, S:457). The schema has workspace/file/subject indexes but no folded-name lookup key (M:28). The measured regression is M3. A durable Unicode-key policy must also be pinned if a persisted lookup key is introduced; the present Node/Unicode version was checked, not every future runtime.

## Failure modes

### M3 — Single-token misses synchronously scan and materialize the workspace

- Trigger: no identical-case name and no lowercase-equivalent name; many workspace symbols fall within the query's length window. Example: query `transactions`, 100,000 distinct names `symbol000000` through `symbol099999`, all 12 characters.
- Symptom: unrelated event-loop work is delayed while a five-result search performs a full JS pass over the workspace. Repeated misses repeat the work.
- Evidence: S:343 executes exact lookup before the first await; S:417 enters fallback; S:444 selects all hit columns (including text via S:124); S:446 filters only by length; S:453 iterates rows; S:455 rejects every row; S:457 cannot stop a miss early. M:28 provides no folded-name index.
- Current handling: the iterator bounds retained matches, but not examined rows. The query uses `idx_code_symbols_file (workspace_root=?)` in the measured plan. This avoids a sort but still scans the workspace. The preceding identical-case lookup also scans without a symbol-name index.
- Reproduction: actual current store and migration in better-sqlite3 `:memory:`, vectors disabled, unique file paths and subjects, 512-character synthetic text per row. Each size was inserted transactionally; seven warm calls were measured and their median taken. The comparison executes the r1 NOCASE SQL on the same database; it is a SQL control, not a separately checked-out application build.

| Workspace rows | Revised exact + fallback miss | R1 NOCASE SQL miss | Existing BM25 miss |
| -------------- | ----------------------------: | -----------------: | -----------------: |
| 1,000          |                       1.68 ms |            0.12 ms |            0.11 ms |
| 10,000         |                      16.11 ms |            0.97 ms |            0.12 ms |
| 100,000        |                     171.81 ms |           18.11 ms |            0.09 ms |

Instrumenting the native iterator independently counted **100,000 rows yielded** for the 100k miss. A zero-delay timer scheduled immediately before the actual `searchSymbols('transactions', 5, '/ws')` fired after **171.34 ms**. A different-length miss (`missing`) yielded zero JS rows but still took approximately 38–45 ms for the two SQL scans. These are local synthetic measurements, not production telemetry or a universal latency estimate.

- Judgment: **Moderate**. The result remains correct, and a small workspace is fast. At the explicitly requested large-workspace scale, the new fallback is about 9.5 times slower than the previous exact-name miss and measurably monopolizes the event loop. This is more than an unmeasured index suggestion. There is no claim that every miss yields every row: the length distribution determines how many cross into JS, while SQLite still examines the workspace.
- Recommendation: provide a Unicode-aware lookup path whose misses do not materialize all candidate payloads. For example, maintain and backfill an indexed default-lowercase key alongside an indexed exact name, preserving scope and identical-case preference. If schema changes require another batch, explicitly arrange that work before accepting the latency regression. Selecting only rowid/name and fetching payloads for matched IDs reduces copying but does not itself remove the O(N) lowercase pass. Do not fix this by truncating before finding matches, which would reintroduce recall loss. Add a bounded-work regression that exercises a large miss.

## Blocking issues

None reproduced in this batch.

## Serious issues

None reproduced in this batch.

## Moderate and minor issues

- **Moderate M3:** S:443 and S:453 — measured large-workspace miss regression as detailed above.
- No additional scored findings. Missing astral tests are a coverage improvement, not a demonstrated Unicode defect.

## Data flow

1. **OK:** Indexer preserves function and qualified method names (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:438`, `:470`); sink preserves the name in the insert entry (`libs/backend/memory-curator/src/lib/symbol-sink.adapter.ts:20`, `:46`).
2. **OK:** Store caps topK at 50 and trims query (S:339); blank queries return immediately (S:341).
3. **OK:** Identical-case equality is bound and workspace-scoped, ordered by file path/rowid, with LIMIT (S:404, S:409). A nonempty identical-case list wins without adding folded variants (S:415).
4. **M3:** Only an empty list enters Unicode fallback (S:417). Window preserves the tested matches (S:440), but a miss can walk every workspace row (S:453).
5. **OK:** On a hit, breaking the for-of closes the native iterator (S:457). Instrumentation saw exactly one `return()` call for each early-break case; the connection remained usable and `db.close()` succeeded. No cursor leak reproduced.
6. **OK:** BM25/vector retrieval and weight split remain intact (S:344, S:364). Fusion deduplicates by rowid and sums source contributions (S:546); output truncation follows sorting (S:558).
7. **OK:** Freshness executes one scoped COUNT/MAX query (S:240), returns null for an empty index (S:248), and retains an optional port member (P:38) and type export (B:21).

### Unicode window and both directions

The actual code already avoids the suspected UTF-16 mismatch at S:440. With `L = codePointCount(query.toLowerCase())` and `d = count('i\u0307')` in that lowered query, the window is `[L-d, L]` (S:441, S:450). In the tested runtime, only U+0130 expands under default lowercasing; no scalar shortens. If stored string `s` lowercases to the same string, its length is `L - count_U+0130(s)`. Each such expansion contributes an `i\u0307` occurrence to the common lowercase value, so that count cannot exceed `d`. Existing explicit `i\u0307` pairs merely widen the window. This proves the reverse/stored-name direction too, for this Unicode mapping and well-formed names without embedded NUL.

Independently enumerated every Unicode scalar from U+0001 through U+10FFFF (excluding surrogates) on Node **v24.15.0 / Unicode 17.0**: sole code-point expansion U+0130; no shortening; no one-code-point mapping crossing the BMP/supplementary width boundary. Default contextual final sigma changes the character, not its length.

| Stored name      | Query            | Stored SQLite length | Lowered query code points | Exact-tier matches |
| ---------------- | ---------------- | -------------------: | ------------------------: | -----------------: |
| `𝒳Foo`           | `𝒳foo`           |                    4 |                         4 |                  1 |
| `😀Foo`          | `😀foo`          |                    4 |                         4 |                  1 |
| `𐐀Foo`           | `𐐨foo`           |                    4 |                         4 |                  1 |
| `İ𝒳Foo`          | `i\u0307𝒳foo`    |                    5 |                         6 |                  1 |
| `i\u0307𝒳FOO`    | `İ𝒳foo`          |                    6 |                         6 |                  1 |
| `İİ`             | `i\u0307i\u0307` |                    2 |                         4 |                  1 |
| `i\u0307i\u0307` | `İİ`             |                    4 |                         4 |                  1 |

Escaped U+0307 in the table denotes the actual combining dot used in the reproduction. Emoji is a direct-store robustness case, not a claim that it is a valid bare TypeScript identifier. No filtering-window defect was found for astral or dotted-I names.

### RRF rank-1 guarantee

At S:108, S:111, S:121, S:364 and S:549, a row admitted to the exact list has score at least `3/(25+50) = 0.04`. A row absent from that list has score at most `(0.6+0.4)/26 = 1/26`, or the same bound with the 0.3/0.7 split. Thus every admitted exact candidate beats every non-exact candidate. Both lookup paths supply at most topK unique rowids; their new selection method does not change the proof.

Independently called the actual fusion method with 50 exact rows and a distractor at BM25 and vector rank 1: all 50 output rows were exact, lowest exact score 0.04, distractor excluded. If more than topK names match, omitted matches need not globally outrank all non-exact rows, but the admitted exact rows already fill the returned page. This qualification from r1 still applies; it does not break returned-page priority or rank 1.

### CI path and useful failure cause

`.github/workflows/ci.yml:89` rebuilds better-sqlite3 for Node; line 182 runs `nx affected -t test --coverage`. `.github/workflows/nightly-coverage.yml:71` runs all project tests. The curator test target invokes Jest through `libs/backend/memory-curator/project.json:29`, using its normal spec-discovering config. Neither workflow overrides CI to false or clears it, and the inspected Nx/Jest configuration does not do so.

GitHub supplies `CI=true` by default; an explicit YAML assignment is not necessary. This is documented in [GitHub's variables reference](https://docs.github.com/en/actions/reference/workflows-and-actions/variables). Consequently the new T:245 gate is active in these jobs when the test target executes. The CI fault-injection callback reports: `native modules failed to load in CI, so the exact-name recall guard cannot run: INJECTED_ABI_MISMATCH: expected Node ABI` (T:258). This is useful causal information, not a generic failed assertion. The nightly workflow lacks the explicit native rebuild found in PR CI; a bad native installation now fails, as required, rather than quietly skipping. No live GitHub job was run during this review; normal Nx cache behavior still applies.

## Requirements fulfilment

| Requirement                                                  | Status                          | Gap                                                                 |
| ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------- |
| Optional freshness method and exported type                  | COMPLETE                        | P:18, P:38, B:21                                                    |
| One workspace-scoped COUNT/MAX, empty `{0,null}`             | COMPLETE                        | S:240; T:1201; requested suite passed                               |
| Identical-case preference then Unicode lowercase fallback    | COMPLETE                        | S:404, S:415, S:439; original and extended reproductions passed     |
| Exact-name rank 1 and capped output                          | COMPLETE                        | S:339, S:549; proof and 50-row fusion reproduction                  |
| >=12 fixtures, recall@1 100%, recall@5 >=90%                 | COMPLETE                        | T:917 asserts 14 targets; required suite passed                     |
| Natural-language retrieval retained                          | COMPLETE                        | Whitespace path S:399; T:940 target-in-top-5 check                  |
| Recall guard fails rather than skips in CI on native failure | COMPLETE                        | T:255, T:262; injected failure reproduced                           |
| Lazy refresh after 24h under context Decision 1              | COMPLETE for Batch 5 foundation | Actual orchestration is Batch 6; it is not claimed implemented here |

Implicit requirement not addressed: acceptable synchronous miss cost at large workspace size (M3). No latency budget was specified; severity is based on the measured regression and event-loop delay, not an invented SLA.

## Edge cases

| Case                                   | Handled                   | How                                          | Concern                                                     |
| -------------------------------------- | ------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Blank/whitespace query                 | YES                       | S:340, S:399                                 | No new lookup work                                          |
| Empty/unknown workspace freshness      | YES                       | Scoped aggregate, T:1207, T:1236             | No new gap                                                  |
| Identical-case collision               | YES                       | S:415 wins before fallback                   | Covered T:1023                                              |
| Äpfel/äpfel plus stronger caller       | YES                       | Unicode comparison                           | R1 reproduction corrected                                   |
| Astral names / supplementary case pair | YES                       | Code-point count at S:440                    | Independent fixtures passed                                 |
| Dotted-I expansion, either stored form | YES                       | Window allows both lengths                   | Independent reverse fixtures passed                         |
| Full case folding / locale-specific I  | YES, as documented policy | Default lowercase equality only              | Not a promise of normalization or locale-sensitive matching |
| More than 50 same-name rows            | YES                       | Capped candidates fill page                  | Global all-database ranking claim needs qualification       |
| SQL punctuation / other workspace      | YES                       | Bound equality and scope                     | T:1063, T:1093                                              |
| Native module missing in CI            | YES                       | Readiness throws cause                       | Fault injection passed                                      |
| Early iterator break                   | YES                       | IteratorClose invokes return                 | Verified connection usable and closable                     |
| Large unsuccessful single-token lookup | NO                        | Two scans; all same-length rows can enter JS | M3                                                          |

## Verification evidence

- From the requested worktree root, ran once: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/memory-curator @ptah-extension/memory-contracts --skip-nx-cache`. **Exit 0**, four successful targets: curator test/lint/typecheck and contracts typecheck. Nx reported 15.6 seconds. This review does not infer per-spec pass/skip counts from the summarized Nx output; the native fault harness supplies its own counts above.
- Ran the requested `node_modules/.bin/nx run @ptah-extension/memory-contracts:eslint:lint`. **Exit 0**; successful cached target. Nx Cloud separately reported the organization-plan 401. No claim is made that this second command performed a fresh lint execution.
- Scoped `ptah_get_diagnostics` on store and port: TypeScript compiler, **0 errors / 0 warnings**.
- Independent actual-source reproductions: r1 Unicode ranking, supplementary names, reverse dotted-I cases, exhaustive scalar mapping check, native registration failure with CI unset/true/false, SQL rejection, iterator early-close, 50-row RRF worst case, and 1k/10k/100k miss benchmark with event-loop timer. No reproduction source was written into the repository.
- Residual uncertainty: synthetic data and one local Node runtime, not real deployment latency; no live CI execution; no new exhaustive embedding timeout/cancellation test; existing consumer projects were not rerun beyond the requested scope.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for both r1 fixes, Unicode window, cursor disposal, RRF bound, and the measured scan regression; **MEDIUM** for the exact latency on production workloads.
- Top risk: a routine single-token miss performs a full synchronous JS pass over a large workspace before normal hybrid retrieval can proceed (S:343, S:453).
- What a robust implementation would add: an indexed Unicode-equivalent name path with correct backfill/updates, a large-miss bounded-work guard, and astral/reverse dotted-I regression fixtures preserving the already-correct window behavior.
