# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 5 post-cap independent review, round 3: **APPROVE, 8/10**.

| Metric              | Value                    |
| ------------------- | ------------------------ |
| Overall score       | 8/10                     |
| Assessment          | APPROVED                 |
| Blocking issues     | 0                        |
| Serious issues      | 0                        |
| Moderate issues     | 0                        |
| Failure modes found | 0 new actionable defects |

The bounded correction removes M3's full JavaScript pass for ASCII misses. M1's Unicode fixtures and M2's mandatory CI execution remain fixed. This earns 8 rather than 7 because the reproduced regression mechanism is removed and the requested correctness checks pass. It does not earn 9: misses still scan SQL rows, non-ASCII fallback still performs synchronous O(workspace) work, and the explicitly accepted Kelvin asymmetry remains (S:404, S:407, S:480). These are recorded limitations, not newly invented findings.

Read all four named changed files, r1/r2 reviews, the executor report including both corrections, Batch 5, and context Decision 1. Inspected the migration, FTS helper, sink, indexer name emission, caller error handling, test configuration and adjacent fusion/native-probe patterns. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. No AGENTS.md was found by ptah_search_files or native workspace/ancestor checks. No direct Ptah file reader or Write tool is listed; native reads and the native writer were used. No production source edits or git operations were performed. Independent reproductions used only synthetic :memory: SQLite databases and in-memory TypeScript transpilation; no real user databases or raw session logs were read. Existing requested project tests were run as configured.

Evidence paths, relative to the requested worktree:

- **S**: libs/backend/memory-curator/src/lib/code-symbol.store.ts
- **T**: libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts
- **P**: libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts
- **B**: libs/backend/memory-contracts/src/index.ts
- **M**: libs/backend/persistence-sqlite/src/lib/migrations/0013_code_symbols.ts
- **N**: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts

## Round-1 and round-2 findings

| Review | Finding                                                           | Status | Evidence                                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| r1     | M1: ASCII-only NOCASE loses Äpfel/äpfel exact tier                | fixed  | S:406 routes non-ASCII queries to S:466/S:482 Unicode lowercase comparison. Independent long-declaration/short-caller fixture returned a.ts first for äpfel; T:1309 and T:1360 passed, including sharp-s and dotted-I distinctions. Accepted Kelvin exception is described below.    |
| r1     | M2: native dependency failure skips required recall guard         | fixed  | T:264/T:280 keep every test runnable under CI=true; T:276 includes probe cause. Fault injection registered 39 runnable, zero skipped, recall included; readiness threw with INJECTED_ABI_MISMATCH: expected Node ABI preserved. Actual focused CI run: 39 passed, zero skipped.      |
| r2     | M3: ASCII exact-case miss transfers every same-length row into JS | fixed  | S:407 uses bound NOCASE SQL with LIMIT through S:420. At 100k rows, independent instrumented miss yielded zero JS rows and took 43.69 ms versus r2's 171.81 ms; same-database r1 SQL control took 17.11 ms. This fixes the reported JS-materialization mechanism, not all scan cost. |

## Five logic questions

### 1. How does this fail silently?

No new success-looking failure was reproduced in the correction. Exact lookup and freshness SQL failures reject: injected INJECTED_SQL_FAILURE reached both callers (S:439, S:243); the existing namespace exposes rejection through an error field (N:112). Native CI failure no longer silently bypasses the guard (T:276, T:280). Existing BM25 failure logs and returns an empty candidate list at S:526; this behavior was not introduced here.

### 2. What user action produces unexpected behaviour?

An ASCII query such as kite misses the exact tier for stored Kite, while non-ASCII query Kelvin finds stored kelvin. Both directions were reproduced at S:406/S:466. The former is the user-accepted Kelvin gap, and the latter confirms that the reverse lookup remains correct. Ordinary ASCII misses perform two SQL scans but no JS scan (S:404, S:407); this remains slower than the one-query r1 control.

### 3. What input data produces a wrong answer?

No additional valid-name mismatch was reproduced. Enumerating all code points U+0000 through U+10FFFF on Node v24.15.0 / Unicode 17.0 found exactly one non-ASCII code point whose default lowercase consists entirely of ASCII: U+212A → k. There is no broader code-point exception behind S:124's split on this Node.

The enumeration also found only U+0130 expands in code-point length and no shortening. S:467 counts code points rather than UTF-16 units; S:468 widens the length window for dotted-I expansion. Independent supplementary-plane case and reverse dotted-I/astral fixtures passed. These checks concern default lowercase equality, not full Unicode case folding, locale-sensitive casing, or normalization.

### 4. What happens when a dependency fails?

Injected SQL failures reject as above. The vector rejection path still logs and falls back to BM25 (S:356); malformed/absent vectors still produce no vector contribution (S:539). CI native resolution failure retains its cause and fails readiness, with zero tests skipped (T:257, T:276, T:280). No new timeout/cancellation behavior is added; unchanged embedding timeout behavior was not exhaustively fault-tested.

### 5. What is missing that the requirements never mentioned?

A concrete synchronous-search latency budget and a durable Unicode-key/version policy. The schema has workspace/file/subject indexes, but no lowercase-key index (M:28). S:480 still scans non-ASCII misses, and S:404/S:407 still scan SQL rows for ASCII misses. The indexed lowercase-key column, migration/backfill and write-path maintenance are explicitly deferred by the user; no new scope is imposed in this review.

## Failure modes

No new actionable defect was reproduced within the bounded correction. Scope and residual uncertainty are explicit above and in verification below.

The accepted Kelvin gap at S:414 is confirmed and is not broader than stated on the enumerated Node runtime. The remaining non-ASCII scan at S:480 and two-query ASCII scan cost at S:404/S:407 are documented follow-up constraints, not claims of constant-time lookup.

## Blocking issues

None reproduced.

## Serious issues

None reproduced.

## Moderate and minor issues

None newly filed. The requested review does not turn accepted limitations or hypothetical concurrency cases into defects.

## Data flow

1. **OK — preserved input:** indexer emits names and qualified method names (libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:438, :470); sink preserves the parsed name (libs/backend/memory-curator/src/lib/symbol-sink.adapter.ts:20, :46).
2. **OK — entry:** query is trimmed, blank input exits, and topK is capped at 50 (S:342). Whitespace queries skip the exact tier (S:403).
3. **OK — preference:** bound identical-case equality runs first; nonempty results win immediately (S:404/S:405). SQL orders by file path and rowid before LIMIT (S:432).
4. **OK within accepted policy — fallback:** ASCII misses use bound NOCASE SQL (S:407); non-ASCII misses use the scoped code-point length window and JS comparison (S:466/S:482).
5. **OK — two-stage fetch:** scan retains only matching rowids, stops at limit, and returns immediately on no matches (S:483/S:486). Full-row fetch binds those IDs and explicitly repeats file-path/rowid ordering (S:492/S:493). It does not rely on IN-list order.
6. **OK — scope and resources:** scan applies workspace scope before collecting globally unique rowids (S:469/S:478). No await occurs between scan and fetch. Independent fixture with 61 matching rows, repeated file-path ties, and another workspace returned exactly the expected first 50 rowids; a limit of 1 returned one. Empty matches prepared no full-row fetch. Iterator instrumentation observed return() on early breaks; subsequent queries and db.close() succeeded. No reproduced leak or cross-workspace row.
7. **OK — variable bound:** public topK cap is 50 (S:342), so full-row fetch binds at most 50 variables (S:487); independent instrumentation confirmed 50. This is below SQLite's normal supported variable limits, and the installed binary executed it successfully. No batching is required on this path.
8. **OK — fusion and output:** existing BM25/vector retrieval and token-based weight split feed rowid-keyed fusion (S:347, S:367, S:585). Scores are summed, sorted and truncated (S:595).
9. **OK — freshness:** one bound COUNT/MAX statement scopes to the root (S:243), empty result gives count zero/newest null (S:251), port remains optional (P:37), and type is exported (B:20).

### RRF rank-1 guarantee

At S:108/S:121/S:585, an admitted exact candidate has score at least 3/(25+50) = 0.04. A non-exact candidate contributes at most (0.6+0.4)/26 = 1/26, with the same bound for the 0.3/0.7 split. Therefore every admitted exact candidate outranks every non-exact candidate.

Independent invocation of the actual fusion method with 50 exact rows and a distractor at rank 1 in both BM25/vector lists returned all 50 exact rows; minimum score was 0.04. T:1010's maximum-topK fixture also passed. As in r1/r2, this guarantee applies to admitted candidates and the returned page; it is not a global ordering claim about omitted database rows.

### Independent performance measurement

Actual source, real migration-0013 relational/FTS schema, better-sqlite3 :memory:, vectors disabled. Transactionally seeded 100,000 distinct symbol000000…symbol099999 names, unique subjects/file paths, 512-character synthetic text. Query transactions, limit 5, root /ws. One warmup then median of seven calls; no benchmark source was written to disk.

| Measurement                                              |   Median |
| -------------------------------------------------------- | -------: |
| Corrected exact-case + ASCII fallback miss               | 43.69 ms |
| r1 NOCASE SQL control on the same DB                     | 17.11 ms |
| Existing BM25 miss on the same DB                        |  0.18 ms |
| JS iterator calls / yielded rows on corrected ASCII path |    0 / 0 |

The corrected path is about 2.55 times the one-query control, versus r2's reported 9.5 times. Its roughly 75% reduction relative to r2's 171.81 ms is indicative only: r2 and r3 are separate local measurements. M3's JavaScript work is removed; original one-query latency is not restored. No constant-time or production-latency claim is made.

## Requirements fulfilment

| Requirement                                            | Status                          | Gap                                                                 |
| ------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------- |
| Optional freshness member and exported type            | COMPLETE                        | P:37, B:20                                                          |
| One scoped COUNT/MAX, empty {0,null}                   | COMPLETE                        | S:243; independent empty/scoped timestamp fixture and T:1406 passed |
| Identical-case priority then case-insensitive fallback | COMPLETE within accepted policy | S:404/S:406; accepted Kelvin asymmetry only                         |
| Exact-name rank 1, capped returned page                | COMPLETE                        | S:342/S:585; proof and 50-row reproduction                          |
| At least 12 fixtures, recall@1=100%, recall@5≥90%      | COMPLETE                        | T:935 executes 14-target guard; focused CI run passed               |
| Natural-language target remains in top 5               | COMPLETE                        | T:958 passed; S:403 bypasses exact tier for whitespace              |
| CI guard fails with cause, zero skipped                | COMPLETE                        | T:276/T:280; actual CI run and fault injection                      |
| ASCII miss avoids JS materialization                   | COMPLETE                        | S:407; independent 100k measurement and T:1186 passed               |
| Lazy 24h refresh foundation                            | COMPLETE for Batch 5            | context.md:22 orchestration belongs to Batch 6                      |

Implicit requirements not addressed: no additional requirement inferred. Indexed Unicode lookup remains an explicit follow-up.

## Edge cases

| Case                                       | Handled                        | How                             | Concern                                      |
| ------------------------------------------ | ------------------------------ | ------------------------------- | -------------------------------------------- |
| Blank/whitespace input                     | YES                            | S:343/S:403                     | No new exact lookup                          |
| Identical-case collision                   | YES                            | S:405 prefers identical rows    | Existing fixture passed                      |
| Äpfel/äpfel with stronger caller           | YES                            | S:482 Unicode comparison        | Independent rank-1 reproduction passed       |
| ß versus ẞ; SS; dotted/dotless I           | YES under policy               | Default lowercase equality      | T:1360 and independent cases passed          |
| ASCII query versus stored Kelvin sign      | Accepted exception             | SQL NOCASE                      | Only such mapping found on this Node         |
| Kelvin-sign query versus ASCII stored name | YES                            | Unicode scan                    | Kelvin returned kelvin                       |
| Astral and reverse dotted-I                | YES                            | Code-point window               | Independent cases passed                     |
| More than 50 Unicode matches, path ties    | YES                            | Early stop and ordered ID fetch | 61-row fixture passed                        |
| Empty Unicode matches                      | YES                            | S:486 returns before IN query   | Instrumented                                 |
| Other workspace                            | YES                            | Scoped candidate rowids         | Independent exclusion passed                 |
| Native failure in CI                       | YES                            | Failing readiness with cause    | 39 registered, zero skipped in fault harness |
| Large ASCII miss                           | YES for bounded correction     | No JavaScript scan              | Two SQL scans remain                         |
| Large non-ASCII miss                       | Correct but still O(workspace) | S:480                           | Indexed-key follow-up remains                |

## Verification evidence

- Requested root command with CI=true: node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/memory-curator @ptah-extension/memory-contracts --skip-nx-cache. Exit 0: curator test/lint/typecheck and contracts typecheck passed; Nx duration 17.1s. Only tail output retained.
- Requested separate contracts eslint:lint with --skip-nx-cache: exit 0, fresh successful lint.
- Focused count verification: CI=true nx run @ptah-extension/memory-curator:test --testFile=code-symbol.store.spec.ts --skip-nx-cache --output-style=static. Exit 0: one suite, 39 passed, 39 total, zero skipped. This additional run establishes execution counts hidden by the first Nx summary.
- Scoped ptah_get_diagnostics on store, spec and port: TypeScript compiler, zero errors/warnings.
- Independent actual-source harness: exhaustive code-point enumeration; Unicode/distractor recall; both Kelvin directions; sharp-s and Turkish-I distinctions; supplementary/reverse dotted-I names; ordered/scoped 61-match fetch; limits 1/50; empty-fetch avoidance; iterator close; RRF bound; freshness; SQL rejection; 100k ASCII miss/control measurement; CI native-failure registration and cause.
- One first attempt at the ad hoc harness had a JavaScript syntax error before execution; corrected in memory and rerun successfully. No source file was changed.
- Residual uncertainty: one Node/Unicode version and synthetic workload; no live CI job or production latency observation; external-process writes between statements and unchanged embedding timeout/cancellation paths were not stress-tested. Requested project scope passed; no claim of workspace-wide verification.

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH** for the scoped correction and reproduced checks; **MEDIUM** for production latency.
- Top risk: synchronous scans remain for misses, particularly non-ASCII queries (S:480).
- What a robust implementation would add: the already-deferred indexed lowercase-key column, migration/backfill, write-path maintenance and Unicode-version policy; retain scope, identical-case priority and the bounded-work guard.
