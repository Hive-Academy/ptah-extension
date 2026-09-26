# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 24b, r1, Lane H. Source was read-only. No git operations were run.

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 3 |
| Moderate issues | 0 |
| Failure modes found | 5 |

The normal full-run state machine and unsupported-language exits work, but the coverage contract is not reliable at the reduction, deletion, concurrent-write, discovery, and parse-quality boundaries. The score is below 5–6 because these are reproduced incorrect results on ordinary operational paths, not merely missing tests; it is above 1–2 because the main indexing and namespace mechanisms remain usable and the corrections are bounded.

Evidence paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`:

- **Indexer**: `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`
- **Namespace**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`
- **Discovery**: `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts`
- **Store**: `libs/backend/memory-curator/src/lib/code-symbol.store.ts`
- **Reducer**: `libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.ts`
- **Budget**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
- **Contract**: `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts`

Read the five changed source/spec files in full, plus the supplied executor reports, context, Batch 24b and language decomposition notes, relevant language-plan sections, and the downstream/upstream paths cited here. No applicable repository AGENTS.md/CLAUDE.md, task-description.md, or task-specific code-style-review.md was found. The supplied project guidance applies. No source-reading Ptah tool was listed; native reads were used. Diagnostics were requested through Ptah.

## Five logic questions

### 1. How does this fail silently?

The JSON reducer drops the only explicit unknown qualifier of an otherwise complete/current code-index answer (Reducer:118,145; finding 1). Purging indexed rows leaves their successful coverage records intact (Store:617; Indexer:370; finding 2). A skipped stat failure and an error-recovered parse both escape the failed count (Discovery:447; Indexer:801,909; findings 4–5).

### 2. What user action produces unexpected behaviour?

After explicitly indexing `/ws/build/manual.ts`, using `memory:purgeJunk` removes it while subsequent searches retain its analyzed count (Namespace:474; Store:597; finding 2). Searching while a single-file save/reindex awaits insertion can return no symbol with `state:'current'` (Indexer:824,891; finding 3). Neither requires an unsupported language.

### 3. What input data produces a wrong answer?

A large result whose coverage has `unrecognised:null` and otherwise zero qualifier counts loses that unknown in the reduced answer (finding 1). A syntactically broken supported file whose parser returns `parseStatus:'recovered'` is counted as analyzed, even when extraction yields no functions/classes (Indexer:812,909; finding 5).

### 4. What happens when a dependency fails?

Read failures and Result.err parse failures become failed buckets; sink clear/insert errors also count as failures, without a reason key (Indexer:782,801,833,892). Discovery exceptions settle incomplete (Indexer:584,343). However, Discovery absorbs EPERM/EBUSY before the indexer sees the file (finding 4). Slow embedding leaves a deletion/insertion window without an updating state for per-file work (Store:156; finding 3). Namespace coverage-read errors become unknown with a warning (Namespace:278); search failures retain an error and coverage (Namespace:391). These safeguards do not repair the five defects.

### 5. What is missing that the requirements never mentioned?

A reducer rule preserving semantic nulls, and a mutation/invalidation protocol shared with the purge writer, are missing (findings 1–2). The concurrent-write requirement also needs to cover pending per-file/superseded writes, not just final accounting (finding 3). Discovery must expose skipped unreadable entries, and the indexer must consume Batch 24a parse quality (findings 4–5).

## Failure modes — numbered defects

### 1. Blocking — JSON reduction removes unknown coverage without a surviving qualifier

- **Trigger:** A search response exceeds the token/character budget; coverage is complete/current with zero known failures/unsupported files but `unrecognised:null`.
- **Symptom:** The agent sees complete/current coverage with all remaining qualifier counts zero. There is no `clean:false`, qualified status, or explanation that unrecognised source was not counted.
- **Evidence:** Reducer:118 treats null as empty; Reducer:145 recursively drops it without considering its key. Budget:255 invokes this reducer for symbol searches. Indexer:395 supplies complete/current coverage with null buckets; Namespace:385 serializes it without a separate clean flag. Contract:210 explicitly requires `unrecognised === 0` before an answer is clean.
- **Reproduction:** Real budget/reducer code, 300 synthetic hits: 93,334 characters / 19,602 input tokens became 1,722 returned tokens, `json-compact`, truncated. The first JSON line retained `census:"complete",state:"current",analyzed:2,unchecked:0,failed:0,unsupported:0,omittedByCap:0`; `unrecognised`, `nonSource`, and `excluded` disappeared. Coverage still preceded the hits.
- **Current handling:** The full raw spool retains the fields, but the inline answer does not. A generic reduction trailer does not explain unknown language coverage. `isCleanAnswer` still returns false if called on the reduced object because missing is not zero; the model is not running that helper. This is a lost human/agent-facing qualifier, not a bypass of the helper. Of these nulls, `unrecognised` is decisive; `nonSource` does not qualify and `excluded:null` is permitted by the contract.
- **Impact:** An agent can treat the reduced answer as evidence of absence despite incomplete language coverage. The issue applies to coverage-bearing JSON outputs that actually take this reducer path, not every tool indiscriminately: Budget:86 marks diagnostics and some paged tools preformatted.
- **Recommendation:** Preserve null-valued fields recursively beneath a `coverage` key (prefer preserving the coverage subtree's keys entirely). Add pure structural handling in the util reducer, without importing platform-core/workspace-intelligence; `tool-output-reducers/project.json:6` declares `type:util`. Put this cross-cutting fix in a small explicit reducer batch and require its integration before 24b passes. It is not a description-only 24c task. An explicit producer-computed clean boolean is another solution, but requires every producer and serializer to adopt it and loses more detail.
- **Regression needed:** Use complete/current coverage with `unsupported:0` and `unrecognised:null`, and assert the null or an explicit qualified status survives the real budget layer. The existing namespace budget test at `code-namespace.builder.spec.ts:791,823` omits null assertions and uses `unsupported:3`, hiding the clean-looking case. Ordinary reindex acknowledgments are bounded stats/start responses without coverage; the search result is the demonstrated path.

### 2. Blocking — purgeJunk deletes indexed data without invalidating live coverage

- **Trigger:** Complete a full run, explicitly reindex `/ws/build/manual.ts`, then call the authorized `memory:purgeJunk` RPC for `/ws`; retain a recently indexed non-junk file.
- **Symptom:** Purge deletes the manual file's symbols. Search can return no match while coverage still counts that file as analyzed, remains complete/current, and freshness is recent from the retained file.
- **Evidence:** `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:490` calls Store.purgeJunk directly. Store:597–630 deletes rows without notifying the indexer. Indexer:370 merges only recorded writes; Indexer:479 has no invalidation path. Store:240 derives freshness from surviving rows, and Namespace:233 does not start a refresh when they are recent/nonempty.
- **Reproduction:** Actual indexer plus actual Store.purgeJunk method against a controlled statement adapter: seed full run + one explicit build-file reindex produced analyzed:2; purge returned deleted:1 and left one file's rows; coverage remained analyzed:2, failed:0, unchecked:0, complete/current.
- **Current handling:** The RPC reports its deletion count to its caller, but later symbol searches receive no purge qualifier. Default full-run discovery excludes build/out/tmp paths (`workspace-default-excludes.ts:20` onward), so merely asserting that an ordinary full run indexes build output would be incorrect. The explicit single-file reindex path does allow it (Indexer:734 only checks filename skip patterns). Raw coverage is still non-clean under isCleanAnswer because unrecognised is null; it nevertheless makes an incorrect live analyzed/current claim, and finding 1 removes the remaining unknown qualifier.
- **Impact:** Persistent, silently misleading search coverage after deletion of previously indexed rows; recovery depends on further indexing. A comment disclaiming a SQLite snapshot does not disclose this known destructive writer.
- **Recommendation:** Invalidate affected root coverage through a shared mutation notification/port or an indexer-owned purge orchestration path. Invalidate before mutation and on partial failure; a run overlapping the purge must not overwrite the invalidation with current. Do not introduce a reverse library import. Add a purge-then-search integration regression, including purge during a run. This is necessary 24b integration work, even if the owner assigns a small separate batch for the additional files.

### 3. Serious — in-flight per-file and superseded writes are reported as current

- **Trigger:** After a successful full run, start a per-file reindex and hold its insertion after deletion; search before it finishes. A superseded older full run can also keep writing after the newer run settles.
- **Symptom:** A temporarily absent symbol is accompanied by complete/current coverage, analyzed:1, failed:0, unchecked:0.
- **Evidence:** Indexer:365 tests only `record.active`; Indexer:528 records only after `_indexFile` resolves. Deletion precedes the awaited insertion at Indexer:824,891. The real store awaits embedding before insertion at Store:156, so the window is not limited to artificial mocks. Indexer:446 replaces the active run, and Indexer:461 ignores the older run's settlement while its writes remain permitted.
- **Reproduction:** Held the sink promise after the real indexer deleted its one file: zero rows, but coverage was complete/current and analyzed:1. Releasing it restored the row. The existing supersession test (`code-symbol-indexer.service.spec.ts:853`) asserts current while the older run is still held; it does not check a later deletion window.
- **Current handling:** The per-file lock correctly serializes competing writers and releases in finally (Indexer:502); it does not qualify reads during a pending write. A no-snapshot guarantee permits changes between observations; it does not make a known active mutation current.
- **Recommendation:** Track pending mutations per root, including per-file and superseded runs, and expose updating/unknown while any are active. Retain incomplete on failures. Capture/revalidate coverage around the awaited search as needed (Namespace:360 reads it before Namespace:366 awaits the reader). Add a search-during-held-insert regression, not only final-count assertions.

### 4. Serious — unreadable discovered files vanish before census accounting

- **Trigger:** `stat` of an eligible discovered file returns EPERM/EBUSY, a documented Windows sharing violation.
- **Symptom:** The run reports complete/current with failed:0 and unchecked:0 even though a known source file was never examined.
- **Evidence:** Discovery:90 includes these errors; Discovery:235 returns null; Discovery:447 skips the entry and only later logs skippedEntries. Indexer:571 receives yielded entries only, then sets census complete at Indexer:600 and selected from that reduced list at Indexer:602.
- **Reproduction:** Real Discovery.indexWorkspaceStream/statOrNull and real indexer, with discovery listing good.ts and locked.ts and a stat adapter throwing EPERM for locked.ts: analyzed:1, failed:0, unchecked:0, census complete, state current.
- **Current handling:** Logging the skip does not reach the tool coverage. `excluded:null` describes ignored/default-excluded paths, not a failed eligible file; it cannot replace `failed.read`.
- **Recommendation:** Expose discovery failure accounting to the consumer, or discover paths and perform the accountable stat in the indexer. Count locked files as failed/read; if exact accounting is unavailable, mark census/state unknown/incomplete. Preserve the general indexer's existing per-entry fault tolerance. Test the actual generator boundary, not only a generator double yielding readable files.

### 5. Serious — recovered/unknown parse quality is upgraded to analyzed

- **Trigger:** A supported-language file parses with ERROR/missing nodes, or analysis returns unknown parse quality, while its Result is Ok.
- **Symptom:** The indexer may replace old symbols with partial/empty extraction and reports analyzed:1, failed:0 and errors:0.
- **Evidence:** `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts:83,646,679` labels recovered parses but returns Result.ok. `ast-analysis.service.ts:128` preserves parseStatus. Indexer:801 checks only Result.isErr; after checking a defined value at Indexer:812 it ignores parseStatus and returns ANALYZED at Indexer:909. The adjacent consumer `ast-namespace.builder.ts:223` counts recovered as failed/parse and unknown as unchecked.
- **Reproduction:** Supplied each legitimate analysis shape to the real indexer: `parseStatus:'recovered',errorNodeCount:1` and `parseStatus:'unknown'`, both with empty extraction. Both runs returned filesScanned:1, symbolsIndexed:0, errors:0 and analyzed:1/failed:0/current.
- **Current handling:** Only Result.err and undefined insights count as parse failure. Batch 24b's successful AST doubles generally omit parseStatus, so the missing case is normalized into success by the tests too.
- **Recommendation:** Use the existing parse-quality contract: only ok qualifies as analyzed; recovered counts failed/parse and unknown stays unchecked/qualified. If partial symbols are retained, still report their failed/unknown coverage honestly. Add recovered and unknown cases with the Batch 24a contract, preferably one real malformed-source fixture.

## Blocking issues

Findings **1** (Reducer:145; lost unknown qualifier) and **2** (Store:617; untracked destructive writer). Their triggers, impact, and bounded fixes are above.

## Serious issues

Findings **3** (Indexer:365; live mutation state), **4** (Discovery:447; missing failed-file accounting), and **5** (Indexer:812; ignored parse quality).

## Moderate and minor issues

No additional severity-counted findings. Existing skip-pattern single-file stats and the missing single-file size cap are recorded by the author; they were not inflated into new 24b defects here. Extra vendor filters beyond the existing discovery exclusions need a policy decision before excluding legitimate CLI source directories.

## Data flow

1. MCP dispatch → namespace: **OK** unsupported results use the success shape; direct search serializes the namespace response (`protocol-dispatcher.ts:2114,2144`).
2. Extension classification → unsupported exit: **OK** `.kt` stops search before freshness/reader access and reindex before write/count (Namespace:352,468,577).
3. Freshness → background start: **OK** latch and synchronous invocation precede return, with observed rejection handling (Namespace:256). Lazy runs stay governed; explicit runs are userInitiated.
4. Discovery → selected files: **GAP 4**; skip filter precedes eligible cap (Indexer:577), and oversize files count failed/too-large without reading (Indexer:615).
5. Parse → replacement rows: **GAP 5**. Per-file serialization is present, but pending-state reporting has **GAP 3** (Indexer:502).
6. Completed writes → live coverage: bounded map and last-write sequence accounting work (Indexer:370,487); external purge bypasses them (**GAP 2**).
7. Search → serialization → reducer/spool: coverage order is correct (Namespace:385), but semantic null preservation fails (**GAP 1**).

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Registry-derived codeIndex languages, including Python | COMPLETE | Registry export at language-registry.ts:289; Indexer:92,572; Namespace:561 |
| Unsupported .kt search/reindex explicit, no work/count | COMPLETE | Namespace:352,468; corresponding specs pass |
| Updating before full-run work; incomplete on abort/throw | COMPLETE | Indexer:333,343; existing abort/governor cases pass |
| New session unknown; per-file does not promote incomplete | COMPLETE | Indexer:363,481; existing cases pass |
| All relevant writes represented by live state | PARTIAL | Findings 2–3 |
| Same-file serialization and bounded 2,000 per-file record | COMPLETE | Indexer:502,487; overlap/2,001st-update tests pass |
| Eligible-only cap; skip before cap; 1 MiB accounting | COMPLETE | Indexer:577,615; existing cases pass |
| Failed-file accounting, including parsing | PARTIAL | Findings 4–5 |
| Coverage before hits and end-to-end token budget | PARTIAL | Ordering/budget pass; finding 1 loses semantics |
| Sole-writer assumption verified and safe | MISSING | Purge is a second writer; verification exposed but did not resolve it |
| Batch 5 exact-name recall / Batch 6 lazy reindex preserved | PARTIAL | Exact-name candidate path remains Store:346,398; lazy/governor tests pass. No native SQLite recall rerun; destructive/parse gaps can remove the candidates themselves |

Implicit requirements not addressed: semantic-null preservation; invalidation shared across writers; pending mutation disclosure; skipped-stat and recovered-parse accounting.

## Edge cases

| Case | Handled | How / concern |
| --- | --- | --- |
| Empty workspace | YES | Zero selected files settle current; unrecognised remains unknown (Indexer:600,678) |
| No census in host session | YES | Unknown, no state (Indexer:363) |
| Discovery throws / abort between batches | YES | Incomplete in finally (Indexer:343,584,646) |
| Parse returns Err / sink insert rejects | YES | Failed bucket (Indexer:801,892) |
| Recovered or unknown parse returns Ok | NO | Finding 5 |
| Stat sharing violation | NO | Finding 4 |
| 2,001st distinct per-file update | YES | Truncated disclosure, bounded map (Indexer:487) |
| Simultaneous same-file writers | YES | Read/delete/insert serialized (Indexer:502) |
| Search during per-file insertion | NO | Finding 3 |
| Purge after explicit reindex | NO | Finding 2 |
| Oversized reduced search | NO | Token bound holds; qualifier loss, finding 1 |

## Verification

- Ran once: `NX_ISOLATE_PLUGINS=false nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`. Nx reported all six tasks successful (2m 9s).
- Ran once: host typecheck scoped to `ptah-cli ptah-electron ptah-extension-vscode`, no cache. Nx reported all three successful (37.3s).
- Ran once: `degradation-audit:lint`, no cache: successful, TOTAL 300.
- Ran once: `ptah-electron:validate-deps`, no cache: successful, including its dependency target.
- The PowerShell stderr/tail wrappers returned exit 1 despite Nx's explicit successful summaries. These are reported as successful Nx task results, not clean shell exit codes; no failed suite was rerun.
- Scoped `ptah_get_diagnostics` returned **Unavailable**: compiler still running after 45s. Not counted as a diagnostics pass; the independent scoped Nx typechecks above succeeded.
- Temporary probe: `C:/Users/abdal/AppData/Local/Temp/ptah-24b-review.cjs`. It transpiles the reviewed production methods and uses controlled DI/registry, filesystem, AST, sink, and SQL-statement doubles. It reproduced all five findings; it does not claim native SQLite or WASM integration. The real budget/reducer/tokenizer ran end to end, with a mkdtemp spool root removed in finally. The first probe attempt used an incorrect shared surface path and failed before budgeting; correcting the probe path produced the recorded budget result.
- No source, tests, task state, or git state was edited. Only this deliverable was overwritten inside the worktree. Temporary probes are outside it. Native exact-name recall and real malformed-source WASM parsing remain unverified here; static production paths and mocked boundary cases support findings 2 and 5.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the inline reduced answer can present a complete/current index after removing the very field that says its language coverage is unknown.
- What a robust implementation would add: coverage-preserving reduction, purge invalidation, pending-write state, discovery-failure accounting, parse-quality accounting, and regressions at those five boundaries.
