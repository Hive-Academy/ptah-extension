# Code Logic Review - TASK_2026_559_8ca9

## Summary

Batch 23a post-cap review r4. The r3 Windows-case and real-junction invalidation repros now pass, including cold-build invalidation. Earlier B1/B2/M1 and overlapping-root repros remain fixed. The explicitly requested arbitrary-spelling query check still fails: dependency queries use exact node keys, returning a clean empty answer for an existing Windows file spelled differently. Root realpath failure also silently disables alias tracking.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 2 |

The correction closes the recorded invalidation defects and preserves graph/report publication. It remains below 7-8 because a realistic relative or absolute query can miss a known edge while coverage is clean. It is above the structural-failure band because the main accounting, caps, fencing and ordinary-path lifecycle work. The query issue is an acknowledged pre-existing Batch 9b follow-up, not a regression introduced by this correction; it is counted here because the r4 request explicitly requires checking these query spellings and the resulting negative answer is misleading.

All paths below are relative to D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h:
- DG: libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts
- GC: libs/backend/workspace-intelligence/src/ast/graph-coverage.ts
- DS: libs/backend/workspace-intelligence/src/ast/dependency-graph.service.spec.ts
- AN: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts
- PD: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts

Scope: complete service source including its new identity helpers; new correction specs and retained earlier file/spec review; unchanged coverage helper contract from prior rounds; executor correction report; namespace query entry and dispatcher path resolution. No source changes or git operations.

## r3 findings status

| Finding / earlier gate | Status | Evidence |
| --- | --- | --- |
| R3-B1 Windows case invalidation | FIXED in original repro | DG:169 folds win32 identity; DG:903 maps identities to stored node keys; rerun parent/child reports both clean=false |
| R3-B1 case invalidation during cold build | FIXED | DG:391 registers before root realpath await; DG:872 records identities; DG:456 applies after publication without yielding. Probe: analyzed=0, unchecked=1, clean=false |
| R3-B1 realpath event for junction roots | FIXED when root identity resolves | DG:395 resolves root; DG:451 caches real identity; DG:1176 re-roots file identity to stored root. Actual junction fixture now returns clean=false after child eviction |
| R2-B1 overlapping caches | STILL FIXED | DG:881 visits all graphs; original probe still qualifies parent/child and surviving parent |
| r1 B1 ordinary/repeated invalidation | STILL FIXED | DG:926 and GC:323; original probe unclean; node lookup checks deleted keys at DG:1165 |
| r1 B2 / M1 | STILL FIXED | # import with {} remains unresolvedInternal=1 and unclean; node:fs-only remains clean; lodash still carries resolver-context-partial |

The claim of a shared identity is true for roots, containment and invalidation lookup. It is not yet true for dependency query node lookup (R4-B1).

## Five logic questions

### 1. How does this fail silently?

DG:771 and DG:802 read edge maps using the caller's slash-normalized spelling instead of the stored key found by the new identity index. A case-variant path returns [] while DG:1036 routes coverage to a complete graph. Root realpath rejection is also discarded at DG:204 with no coverage qualifier; an alias invalidation can then go unmatched (R4-M1).

### 2. What user action produces unexpected behaviour?

On Windows, querying pkg/a.ts instead of Pkg/A.ts, or d:/repo/pkg/a.ts instead of D:/Repo/Pkg/A.ts. AN:60 joins relative paths without correcting their case; PD:2929 passes absolute paths unchanged. Both forward and reverse dependency calls return empty arrays despite an existing edge. Actual namespace probes reproduce this, not merely a private helper call.

### 3. What input data produces a wrong answer?

A graph with D:/Repo/Pkg/A.ts importing ./B and D:/Repo/Pkg/B.ts. Matching-case calls return the expected paths; equivalent case-variant inputs return [] and isCleanAnswer remains true (DG:761/795). Matching-case outputs retain D:/Repo/Pkg/... spelling, so there is no lowercased-display regression (DG:604/605, DG:772/803).

### 4. What happens when a dependency fails?

Read/parse failures remain counted (DG:560, DG:573, DG:591); governor abort and final cleanup remain at DG:1127 and DG:467. A failed root realpath becomes undefined (DG:209), deleting/omitting the alias mapping at DG:451, without propagating failure or qualifying coverage. File realpath failure tries its directory once (DG:225-237), then retains lexical identity. This fallback preserves exact-path operation but does not disclose loss of cross-alias invalidation. Root EIO fault injection reproduced that loss; it is rated Moderate as an uncommon identity-lookup failure and observability gap, not reported as an observed host outage.

### 5. What is missing that the requirements never mentioned?

An explicit distinction between identity lookup being unavailable and proof that no alias exists. Both currently become undefined (DG:200). Query resolution also needs to use the same stored-node mapping as invalidation; normalizing only root keys does not normalize edge-map keys (DG:1142 versus DG:771). Display spelling and comparison identity should remain separate.

## Failure modes / new defects

### R4-B1 - Dependency queries still return false clean negatives for Windows case variants

- Severity: Blocking under the silent misleading-success definition.
- File: DG:762/771, DG:796/802; AN:60/496/508; PD:2925.
- Trigger: build A.ts -> B.ts using D:/Repo/Pkg/A.ts and D:/Repo/Pkg/B.ts, then request pkg/a.ts or d:/repo/pkg/a.ts (dependencies), or pkg/b.ts or d:/repo/pkg/b.ts (dependents).
- Symptom: [] instead of the stored edge, with clean coverage. The matching-case controls return D:/Repo/Pkg/B.ts and D:/Repo/Pkg/A.ts respectively.
- Evidence: root routing is now case-aware at DG:1207, but both edge lookups remain exact string Map.get calls. The new nodeKeyFor at DG:1152 is only used by invalidation, so it cannot help queries. Relative arguments are joined to the root; absolute arguments pass through. No upstream stage restores the stored spelling.
- Current handling: the executor explicitly defers case-variant queries to the Batch 9b follow-up. That explains provenance but does not satisfy the r4 check that these calls resolve. This review does not assert the correction newly broke matching-case queries.
- Impact: an agent can conclude that a real file has no dependencies/dependents solely because of drive/directory/file case spelling. This is a normal Windows input variation, not a malformed query.
- Recommendation: after selecting a graph, resolve the query identity to its actual stored node key and use that key for direct, reverse and transitive traversal. Include canonical-root re-rooting where aliases are accepted. Keep returned paths in their stored display form; do not lowercase graph outputs. Exact matches must win, and ambiguous folded matches must not arbitrarily select a distinct file on case-sensitive storage. Align namespace/dispatcher conversion with this service lookup, rather than implementing separate competing identity rules.
- Regression: both tools, matching-case control plus case-variant relative and absolute paths, depth >1 for dependencies, and preserved output spelling. Exercise the real namespace/dispatcher conversion.
- Probe: C:/Users/abdal/AppData/Local/Temp/task559-r4-namespace-probe.cjs loads the actual namespace and service with mocked file/analysis ports. Pkg/A.ts => [D:/Repo/Pkg/B.ts]; pkg/a.ts and d:/repo/pkg/a.ts => []. Reverse query behaves identically. The service probe task559-r4-probe.cjs confirms clean=true for all spellings.

### R4-M1 - Root realpath fallback loses alias invalidation without disclosure

- Severity: Moderate (uncommon failed lookup plus missing observability; demonstrated by fault injection).
- File: DG:200-209, DG:395/396, DG:451, DG:914.
- Trigger: the async root realpath call fails transiently while files remain readable through a junction; later invalidation uses the real target path. With parent and child alias-root graphs cached, neither lexical root matches and the sole-graph fallback is unavailable.
- Symptom: both reports remain clean after explicit invalidation; no approximation/reason indicates identity resolution was unavailable.
- Current handling: the optional-capability marker suppresses audit reporting, but the exception is discarded and does not affect coverage. File-level retry cannot reconstruct a root alias mapping that was never stored.
- Evidence: actual temporary junction fixture with async realpath forced to reject EIO during the two builds, restored before invalidation: parentClean=true, childClean=true, approximations absent. The fixture and code are real; EIO is injected, not an observed filesystem failure.
- Recommendation: track unavailable root identity separately from a successfully resolved identical path. Retry at an appropriate bounded boundary or conservatively qualify/evict affected coverage when alias matching cannot be established; expose a bounded reason for this degraded identity capability. Keep ordinary lexical operation available. Add the injected-failure regression alongside the real-junction success test.

## Blocking issues

R4-B1. It is a realistic broken-query/false-clean case, with successful controls and namespace-level reproduction.

## Serious issues

None independently established.

## Moderate and minor issues

R4-M1. No other numbered defects are asserted from untested platforms or speculative performance problems.

## macOS limitation decision

DG:154-161 deliberately avoids unconditional folding on darwin. Preserving potentially distinct case-sensitive files is the right constraint; blindly lowercasing macOS paths would not be a safe correction. A documented exact-spelling restriction is acceptable as an interim API limitation only when consumers actually preserve that identity or an unresolved identity is qualified. A comment alone cannot justify a clean negative for arbitrary spelling.

I do not add a separate macOS Blocking/Serious finding without a native macOS reproduction. This review ran on Windows. The new realpath path may reconcile some case variants on volumes where it returns consistent canonical spelling, so the report's blanket statement that all darwin case variants fail is not independently established here. Per-volume/adapter identity support and qualification on unavailable identity remain follow-up work; the concrete query mismatch is already R4-B1.

## Data flow, atomicity and cost

1. **OK:** generation/running tracking is installed before the root's asynchronous realpath (DG:378-395), so invalidation during that await is retained. All running builds receive the identity array and match it once canonical root context is available (DG:872/456).
2. **OK:** parsed nodes and exported paths keep their original spelling (DG:604); root keys fold only for comparisons/cache access. Successful exact-spelling query results in the probe preserve display case.
3. **OK:** final generation check at DG:422 precedes graph/report publication, realRoots update and pending invalidation application at DG:435/451/456. No await splits that mutation. An evicted or superseded build publishes neither graph nor coverage.
4. **OK for matched identities:** invalidation computes identities before mutation, then updates all matched reports/nodes synchronously (DG:870/881/933). WeakMap indexes retain stored keys, and deleted nodes are rechecked (DG:1165).
5. **OK:** evict/retainOnly/clear remove realRoots with graph/coverage and invalidate generations (DG:1056/1076/1097). These operations normalize lexical case but do not unify every independently opened realpath/alias root into one cache; aliases may remain separate graphs, as designed.
6. **GAP:** queries skip the identity-to-node mapping (R4-B1); root identity failure has no disclosure (R4-M1).
7. **Cost:** one async root realpath per build; one synchronous file realpath per invalidation, with a second directory lookup on failure (DG:203/224/231). These are call-count bounds, not elapsed-time bounds: slow local/mounted storage can block synchronous invalidation. No latency benchmark was run. Ordinary UNC strings are skipped by DG:191; no broad guarantee for every device-path spelling is asserted.
8. **Scan cost:** the first invalidation lazily indexes nodes in every graph it checks, even when a root does not contain the file, because nodeKeyFor also checks explicit out-of-root nodes (DG:911/1157). Initial work is O(sum of cached nodes), with <=5,000 nodes per graph; later matching is O(R+B) plus removed incident edges. Cached root/build counts have no hard numeric limit. WeakMap indexing does not retain discarded graphs on its own.
9. **Pending-event cost:** DG:385 stores arrays in a Set and DG:873 adds a newly created array on each call, so repeated identical invalidations are not value-deduplicated. Retention/replay grows with event count for the duration of active builds, including unrelated roots; finally clears it at DG:469. This is a cost limitation to address with stable-key deduplication/bounded dirty state, not a measured Blocking/Serious failure in this review.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| r3 case and junction invalidation probes | COMPLETE for successful identity reads | Actual probes now unclean; DG:169/395/903 |
| Cold-build invalidation/generation fence | COMPLETE | DG:391/456; rerun cold and eviction probes |
| Case-variant relative/absolute queries | MISSING | R4-B1 |
| Sensible returned display paths | COMPLETE | DG:604/772/803; namespace controls preserve original case |
| Realpath fallback | PARTIAL | Lexical functionality retained, degradation undisclosed: R4-M1 |
| macOS arbitrary spelling | UNVERIFIED / LIMITED | Exact lexical policy at DG:161; native macOS not tested |
| Previous B1/B2/M1/R2-B1 | COMPLETE in original repros | All prior temporary probes rerun successfully |
| Batch 9/9b status, empty result, caps | INTACT by trace and scoped service checks | DG:479/484/520/1119; PD:2476/2512/2653/2666; GC:37/40 |
| Complete manifest context/discovery bounds | DEFERRED as agreed | 32b/23b; bare-package reason retained |

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Case/slash/trailing-root invalidation | YES | r3 probe passes |
| Junction root, real-path invalidation | YES when identity resolves | Real fixture passes |
| Invalidation before root realpath settles | YES | Registered before await and replayed at publish |
| Evict/retainOnly/clear during build | YES for tested spellings | r2 lifecycle probes pass |
| Repeat invalidation | YES semantically | Removed node not decremented twice; pending arrays still accumulate |
| Case-variant queries | NO | R4-B1 |
| Root realpath error then alias invalidation | NO disclosure | R4-M1, fault-injected EIO |
| Deleted file with existing parent | FALLBACK IMPLEMENTED | DG:229 uses parent realpath plus basename; not separately integration-tested here |
| Unknown or ambiguous case-sensitive identities | LIMITED | Win32 folds; node identity index picks one key per folded identity (DG:1160); no per-directory case-sensitivity probe |
| Very large file / stuck read | PARTIAL, unchanged | Count caps do not bound bytes or read completion |

## Verification

- Scoped ptah_get_diagnostics: typescript-compiler, 0 errors / 0 warnings. Native reads were used because no ptah file-read API is listed.
- Reran original r1, r2 and r3 probe scripts against corrected source: the reported direct failures are fixed, and B1 lifecycle checks still pass.
- New r4 service and actual-namespace probes reproduce R4-B1; successful controls verify graph contents and output spelling. They transpile actual local TypeScript with the installed compiler and mock file/analysis/logger ports. Unused namespace imports are stubbed; queried namespace methods execute real source. This is not a complete JSON-RPC/UI integration run.
- New real-junction root-failure probe reproduces R4-M1 with async realpath EIO injection restored immediately after graph builds. No host failure is claimed.
- Independent scoped checks all exited 0 with NX_ISOLATE_PLUGINS=false, NX_DAEMON=false and --skip-nx-cache: workspace-intelligence test/lint/typecheck; degradation-audit:lint (TOTAL 300 unsuppressed sites, successful target); ptah-electron:validate-deps. Logs retained under OS temp as task559-review-workspace.log, task559-review-audit.log and task559-review-deps.log. Successful Nx task output hides individual spec counts, so no independent 98-spec count is claimed.
- The author's 98/98 and 4 fails-before counts remain reported evidence; no source was reverted. No HEAD/git comparison was performed under the role's no-git rule. Native macOS and slow-storage timing were not available/tested. No reviewed source was edited; temporary probes/fixtures reside under OS temp.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for original-finding closure and reproduced query failures; MEDIUM for the injected realpath failure path; native macOS remains unverified.
- Top risk: an ordinary Windows query spelling produces an empty dependency answer even though the graph contains the edge and coverage is clean.
- What a robust implementation would add: query-to-stored-node identity resolution without changing display paths; disclosed/recoverable identity lookup degradation; targeted namespace case regressions and root-realpath failure coverage. The post-cap verdict is evidence only; no further correction cycle is initiated by this reviewer.
