# Code Logic Review — TASK_2026_559_8ca9 / Batch 26b closing verification

## Summary

**Recommendation: REVISE — 7/10.** All six r1 Blocking findings are verified fixed. R26B-M2 and R26B-M3 are verified; **R26B-M1 remains partly open** for saturated pages whose returned candidates share the cursor/imported file. The direct bounded scan also introduces an ignore-policy regression. The confirmed, pre-existing re-export graph defect is recorded separately for **32b**, as requested.

| Metric | Value |
| --- | --- |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 carried graph defect; 0 remaining r1 Blocking findings |
| Serious issues | 0 |
| Moderate issues | 2 |
| Open failure modes | 3 |

The score reflects working failure propagation, conservative reference scope, bounded discovery and passing scoped checks. The remaining cap-disclosure and source-selection problems prevent an 8. This is the closing verification under Decision 24, not a request for another routine review round.

Read-only source/spec review; no git commands. Only this deliverable and OS-temp probes/fixtures were written. Production anchors below use **E** = `apps/ptah-electron/src/services/electron-ide-capabilities.ts` and **WI** = `libs/backend/workspace-intelligence/src`.

## R1 finding status

| Finding | Status | Evidence and re-run outcome |
| --- | --- | --- |
| R26B-B1 — uncertain declaration becomes bare empty answer | **VERIFIED** | E:495–510 maps typed fallback outcomes; E:614 returns failed for uncertain parse. The previous failed-parser scenario now rejects with `Lookup could not answer: ... could not be parsed reliably`; clean bounded misses set truncated. The test suite includes unreadable imported targets and C# parse failure. |
| R26B-B2 — global scripts incorrectly narrowed | **VERIFIED** | `WI/ast/language-registry.ts:103` now has referenceScopeComplete false. Real graph with a global declaration and an edge-free consumer returns both through text-scan with its approximation. No shipped language currently passes the scope-complete gate. |
| R26B-B3 — certificate stale across awaits | **VERIFIED** | E:855 awaits the index before E:873's synchronous certification/walk; E:812 and E:918 recheck coverage identity after scoped reads. Re-ran real graph invalidation during index lookup and during file reads: both fall back to text scan and retain the consumer. Scope capability was temporarily enabled only in the probe process to exercise the otherwise dormant gate. |
| R26B-B4 — parent certificate / nested graph traversal | **VERIFIED** | E:884 and E:890/:903 require the file-selected coverage object to be the certified one. Real parent plus nested graph probe returns the declaration and outside consumer by text scan. The adapted discovery stub includes those exact two fixture files. |
| R26B-B5 — silent file omissions | **VERIFIED** | E:1032–1044 reports stat/read/size outcomes; E:1000 makes skips truncated; E:951–970 preserves incomplete discovery. Re-ran unreadable scope member, stat failure and 1 MiB+ file: each sets truncated. The skipped member no longer appears to have been fully searched. |
| R26B-B6 — interpolated code excluded | **VERIFIED** | E:272–275 captures literal fragments instead of the entire TS/JS template/Python string. Real shipped TS grammar probe now retains `${Foo()}`; scoped test run also passes real JS/Python interpolation cases. |
| R26B-M1 — lost top-25 cap | **OPEN (partial fix)** | E:588 tracks raw-page saturation and narrowing rejects it at E:860. The original 25-file definition probe is now truncated. However E:541 and E:555 overwrite incomplete with false for a local/imported-file match, without proving that all same-file candidates fit on the page. See closing finding 1. |
| R26B-M2 — dollar identifier boundary | **VERIFIED** | E:1406 uses the identifier character class instead of word boundaries. Re-run returns both occurrences of `$Foo`; regression specs also reject embedded/prefixed names. |
| R26B-M3 — unbounded discovery/raw-match allocation | **VERIFIED for the reported defects** | E:943 passes 8,001 to the real adapter; E:1053–1060 appends matches directly rather than building an unbounded raw-match list. Real-adapter 8,001+ fixture stops discovery and reports truncation. This is a bound on discovered matches and scanned files, not a wall-clock guarantee or a bound on all nonmatching directory entries visited. |

## Open/new findings

### 1. R26B-C-M1 — A local or imported-file match does not prove a saturated page is complete

- **Severity: Moderate. Disposition: fix-now.** Continuation of R26B-M1, not a new unrelated finding.
- **Evidence:** `apps/ptah-electron/src/services/electron-ide-capabilities.ts:541` and `:555` return `incomplete:false` even when `saturated:true`; the definition report consumes incomplete at `:492`.
- **Concrete scenario:** one TypeScript file contains more than 25 same-named methods across classes (the shipped method query indexes these: `WI/ast/tree-sitter.config.ts:71`). A symbol search returns 25 distinct locations in that file. Because the cursor is also in that file, all 25 are called a confident local pick; additional candidates in the same file remain hidden. An imported file with multiple same-named declarations has the analogous problem.
- **Probe:** `saturated-same-file` returns 25 locations with mechanism symbol-index, support true, no approximations and **no truncated field**. This uses a controlled full index page; it does not claim that an actual index was populated by the harness.
- **Impact:** the fixed report again loses the cap on a valid saturated-page shape. File equality is not unique symbol binding and cannot establish that no same-file candidate was cut off.
- **Recommendation:** retain saturation unless a separate exhaustive/unique-binding check establishes completeness. Conservatively propagating saturation through local/imported picks is sufficient. Replace the current test's assumption that a local pick is automatically complete with saturated same-file and imported-file cases.

### 2. R26B-C-M2 — Dropping ignore rules lets generated files consume the entire useful result budget

- **Severity: Moderate. Disposition: fix-now.** New side effect of replacing the indexer stream.
- **Evidence:** **E:943–947** passes only DEFAULT_WORKSPACE_EXCLUDES. The old stream reads workspace ignore rules at `WI/file-indexing/workspace-indexer.service.ts:418` and applies them at `:439`.
- **Concrete scenario:** `.gitignore` contains `aaa-generated/`; that directory contains generated TypeScript API/client code mentioning Foo hundreds of times; `zsrc/use.ts` contains the hand-written reference. The new scan reads the ignored generated tree first and reaches 500 matches before zsrc.
- **Real Electron adapter probe:** generated `client.ts` with 501 occurrences yielded **500 generated locations**, `sourceFound:false`, `truncated:true`. This is an observed relevance/behavior regression, not an undisclosed-clean answer; the truncation warning is correct, which is why severity is Moderate.
- **The named common output directories remain safe:** dist/, out/, .next/ and coverage/ are explicitly excluded by `WI/file-indexing/workspace-default-excludes.ts:18` onward. Fixture files in all four were absent from results. The risk is project-specific ignored paths such as generated clients, plus other outputs not in that list; it is not accurate to claim the four named directories now flood results.
- **Recommendation:** preserve ignore-aware source selection in the bounded walk, or prioritize nonignored files with an explicitly bounded/disclosed secondary search. Do not restore the unlimited indexer stream, nor filter only after 8,001 ignored files have already exhausted discovery. If broad scanning is an intentional product policy, make that decision explicit and provide a way to avoid losing all source hits to generated output; text-scan alone does not tell the agent its ignore rules were bypassed.

### 3. R26B-C-B1 — Re-export dependencies remain missing while graph coverage can be clean

- **Severity: Blocking (silent misleading graph answer). Disposition: carry-to-32b.** Confirmed pre-existing graph defect, not a remaining Electron reference-scope defect.
- **Evidence:** `WI/ast/tree-sitter.config.ts:123` matches import_statement but not export_statement sources; `WI/ast/ast-analysis.service.ts:120` extracts imports from that query; `WI/ast/dependency-graph.service.ts:642` stores those imports and `:714` links only node.imports.
- **Concrete scenario:** leaf.ts exports X; barrel.ts contains `export { X } from './leaf'`. Querying dependents of leaf should include barrel. The re-export is absent from imports, so no reverse edge is created, and unresolved-import counters never see the missing construct.
- **Probe:** the actual shipped TS grammar executing the production import query produced **0 import captures** for the re-export. A real graph build supplied with those empty imports returned **dependents:[] / clean:true**. The latter uses a controlled AST collaborator; the on-disk AST extraction path above independently confirms why the actual analyzer supplies no import edge.
- **Impact:** ptah_get_dependents can falsely imply complete absence. Disabling referenceScopeComplete protects the Electron narrowing decision, but does not qualify the graph tool's own clean coverage.
- **32b acceptance:** model named/star re-export source edges and their resolution/failures, with leaf → barrel → importer fixtures; until modeled, disclose incompleteness for encountered unmodeled re-export sources. Keep global scripts/require/dynamic-import completeness separate rather than re-enabling the broad TS/JS reference claim after only this edge is fixed.

## Fix-round side effects and performance

1. **Always-full text scanning:** conservative and honest today. Registry false at `language-registry.ts:103` makes the gate reject TS/JS; other shipped languages cannot pass either. The report names text-scan, and E:969 combines file-count, discovery-failure and per-file/match truncation. The 8,001 sentinel bounds the selected set to 8,000 scanned files.
2. **Measured real-adapter behavior:** with over 8,001 empty generated source files ahead of the source file, the end-to-end lookup took **about 3.23 s**, returned 0 locations and `truncated:true`. Fixture creation was outside the timer. A smaller 501-hit generated-file case took about **16 ms** and hit the 500 cap honestly. These synthetic Windows timings do not predict slow disks, deep nonmatching trees, or 8,000 parse-heavy files; no universal latency bound is claimed.
3. **Ignore semantics:** standard output directories remain excluded; custom ignored generated trees can exhaust both caps (finding 2). The original correctness rationale that extra files can only add matches misses the displacement of useful matches once caps apply.
4. **Constructor/DI change:** no broken consumer found. Repository search found only the production construction at `apps/ptah-electron/src/di/phase-3-storage.ts:186` and the spec construction at `electron-ide-capabilities.spec.ts:259`; both use the new argument order matching **E:359**. No shared indexer registration was removed. Production no longer resolving an unused indexer is valid.
5. **Future narrowing safety:** the corrected identity and post-read checks are exercised with a probe-only registry override, so their verification is not merely a consequence of today's blanket fallback. The override is in temporary process memory, never in source.

## Five logic questions

1. **Silent failure:** all r1 Blocking report paths now reject or disclose incompleteness. The remaining independent false-clean graph answer is the re-export carry (finding 3).
2. **Unexpected user action:** a query in a repository with ignored generated clients can return only generated hits (finding 2); a local query on a saturated same-file page loses the cap warning (finding 1).
3. **Wrong-answer data:** more than 25 same-named local declarations and a re-export source are the concrete unhandled shapes. Dollar names and template interpolation now pass the old probes.
4. **Dependency failure:** E:500 maps failed declaration analysis to an error; E:1000 qualifies per-file failure; E:951 preserves partial discovery or returns a truncated empty scan. The existing namespace/dispatcher error route remains unchanged. The diagnostics verification tool itself timed out and was not treated as clean.
5. **Missing requirement:** search policy needs an explicit distinction between recognized files and user-selected nonignored source files. A candidate's file identity also needs to be distinguished from proof of complete symbol resolution.

## Requirements / edge cases

| Requirement or case | Result |
| --- | --- |
| R1 Blocking corrections | All six verified with probe/source/spec evidence above. |
| Caps and skipped files disclosed | Reference discovery/read caps verified; definition-page exception remains open. |
| No source mutation | Maintained; temporary harness adapted to the removed constructor argument and new fs.stat/findFiles contract. |
| Unreadable/oversize files | Truncated in re-run. |
| Global/nested/concurrently invalidated graph | Text-scan fallback in re-run, including forced future scope capability. |
| TS/C# real-grammar probes | Pass; TS interpolation retained, C# declaration found. JS/Python real-grammar specs pass in scoped suite. |
| Standard build directories | dist/out/.next/coverage excluded by actual adapter probe. |
| Custom gitignored generated directory | Included, consumes match/file caps; finding 2. |
| Re-export graph edge | Missing; carry-to-32b. |

## Checks run

- `node "$env:TEMP/task559-26b-closing-probe.cjs"` — adapted r1 probes plus closing probes. Output: `%TEMP%/task559-26b-closing-probe.jsonl`. Real temporary fixture roots created with mkdtemp. The old failed-parser probe now catches the expected rejection for recording; its subsequently printed JSON is a harness record, not an actual successful tool response.
- Requested `nx run-many -t=test,lint,typecheck -p ptah-electron @ptah-extension/workspace-intelligence --skip-nx-cache`, NX_ISOLATE_PLUGINS=false / NX_DAEMON=false — **all passed**, two projects plus six prerequisite tasks, about 1m24s. Log `%TEMP%/task559-26b-closing-checks.log`. One completion check; no suite rerun. No stress-bundle failure occurred.
- `ptah-electron:validate-deps` — passed.
- `degradation-audit:lint` — passed, **TOTAL 300**.
- Scoped `ptah_get_diagnostics` for capability and production wiring — **unavailable after 45s**, check still running; no retry. Independent Nx typechecks passed.
- Regression specs and author's failure-on-base evidence were examined. No source swap or git operation was performed to repeat base runs. The new local-pick exception is intentionally pinned by a test, which does not make its completeness inference valid.

## Verdict

- Recommendation: **REVISE**
- Score: **7/10**
- Confidence: **HIGH** on reproduced behavior; timing evidence is specific to the synthetic fixture.
- Top remaining lane risk: capped results can lose useful source hits or their cap disclosure through assumptions about ignore policy and same-file candidates.
- Follow-up: correct the open M1 exception and decide/fix ignore-aware bounded source selection; record the independent re-export defect in **32b**. The original six Blocking review findings are closed.
