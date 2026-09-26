# Code Logic Review � TASK_2026_559_8ca9

## Summary

Batch 23a review r3, after revision round 2. The r2 overlapping-root repro now passes. One blocking path-identity gap remains: equivalent Windows case spellings and junction/real paths can bypass invalidation of both published and running graphs, leaving stale coverage clean.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 (path-identity mismatch, with case and junction variants) |

The direct fixes and synchronous publication are sound for identical path spelling, placing this above the significant structural-failure band. It remains below 7�8 because the requested Windows containment case fails a concrete probe and can produce a misleading complete negative answer. Blocking follows the review contract's silent misleading-success definition. This report does not claim that a production editor event currently invokes invalidateFile; it assesses the public service contract.

Paths below are relative to D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h:
- DG: libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts
- GC: libs/backend/workspace-intelligence/src/ast/graph-coverage.ts
- DS: libs/backend/workspace-intelligence/src/ast/dependency-graph.service.spec.ts
- PD: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts

Review scope: the four Batch 23a files read during this continuing review, the revised invalidateFile implementation and new specs, revision-round-2 report, original requirements and r1/r2 findings, plus targeted comparison with the dispatcher's path normalization. Source remained read-only. No git operations were performed.

## r2 findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| R2-B1: only longest-prefix cached graph invalidated | FIXED for the original repro | DG:756 now scans every cached graph and qualifies/removes matching nodes at DG:761. The unchanged r2 probe returns parentClean=false and childClean=false; after child eviction, parent analyzed=1, unchecked=1, context=partial and clean=false. DS:1027 covers both evict(child) and retainOnly([parent]). |
| New nested file absent from both graphs | COVERED for matching identity | Root containment independently qualifies both graphs (DG:758; DS:1048). |
| Unrelated sibling root remains clean | COVERED | Root-boundary check at DG:1006; regression at DS:1060. |

Earlier fixes remain intact in rerun probes: ordinary single-root invalidation is unclean; #b with undefined or {} paths has unresolvedInternal=1 and is unclean; node:fs-only imports remain clean. GC:250 still emits resolver-context-partial for bare-package uncertainty; the lodash + {} probe includes this code. The orchestrator-accepted interim qualification until 32b is not reopened.

## Five logic questions

### 1. How does this fail silently?

DG:744 changes only separators. DG:1005/1006 then compares case-sensitive lexical strings, while DG:759 checks the original node key exactly. Equivalent physical paths can therefore match no cached or running graph. Nothing records that an invalidation was missed, and the next answer remains clean. See R3-B1.

### 2. What user action produces unexpected behaviour?

A caller invalidates D:\Repo\pkg\a.ts after graphs were built under d:/repo and d:/repo/pkg, or invalidates a real path after opening/building through a junction. With multiple cached roots, the fallback lookup can also miss both (DG:769; DG:1010). With a cold build, there is no published graph to fall back to, and the invalidation is lost before publication (DG:745, DG:333).

### 3. What input data produces a wrong answer?

Two spellings identifying the same Windows file. The case probe leaves both reports clean; the junction fixture proves both spellings have the same realpath, changes a.ts to import ./b, invalidates through the real path, evicts the alias child root, then receives dependents=[] and clean=true from the alias parent. DG:1003 compares pathname prefixes, not file identity.

### 4. What happens when a dependency fails?

Read/analysis failures still count by reason (DG:434, DG:449, DG:468). Governor abort propagates (DG:976); build finally clears running/in-flight records (DG:344). Probes for invalidation during a build followed by evict, retainOnly or clear still publish neither graph nor coverage, and tracking clears after settlement. A permanently stuck read/parse retains its pending state until settlement (DG:436, DG:451); this unchanged limit is not counted as another finding.

### 5. What is missing that the requirements never mentioned?

A consistent file/root identity contract spanning graph keys, node keys, running-build tracking and invalidation. Matching the Batch 9b graphRootKey helper alone does not provide it: PD:2583 also only replaces separators and removes trailing slashes. A separate host-owned-root check already has a canonicalFolderKey with realpath and win32 folding (PD:3105), but that function is not used by this graph service. This is evidence of a relevant existing pattern, not a recommendation to deep-import a consumer-layer helper.

## Failure modes / new defects

### R3-B1 � Lexical containment misses equivalent Windows and linked paths

- Severity: Blocking.
- File: DG:744, DG:746, DG:758, DG:759, DG:986, DG:1003.
- Trigger A: cache parent d:/repo/ and child d:/repo/pkg/ with lower-case node paths; invalidate D:\Repo\pkg\a.ts. Both cached reports remain clean. During a cold build under d:/repo, the same invalidation is not recorded and the completed build reports analyzed=1, unchecked=0, context=complete, clean=true.
- Trigger B: cache parent and child roots through a local junction, modify the same file through the junction target's real path, invalidate that real path, then evict the child. The remaining parent returns an obsolete empty dependency result with clean coverage.
- Symptom: an explicit invalidation does not revoke completeness. The single-graph fallback can mask some published cases by qualifying an unrelated sole graph, but cannot rescue the multiple-root or cold-build cases.
- Evidence: normalizeRoot at DG:986 strips trailing separators but preserves case and aliases. isUnderRoot at DG:1003 uses exact equality/prefix; node lookup at DG:759 is also exact. Both the running-build loop (DG:745) and published loop (DG:756) rely on those comparisons. A missed running invalidation never reaches the pre-return application loop at DG:333.
- Current handling: only slash variants and root trailing separators are normalized. No canonical identity/alias lookup, platform case comparison or realpath mapping is consulted.
- Impact: the new clean-answer contract can certify stale data after a legitimate invalidation. The lexical helper predates this round; the revised all-root invalidation still relies on it and does not satisfy the explicit r3 containment requirement.
- Recommendation: establish a shared, platform-aware identity strategy for roots AND node paths, and map incoming invalidations to the actual stored node keys. Preserve exact identity first; use safe unique case-folded matching where appropriate, and retain canonical realpath/junction aliases for host-owned roots/files. Do not globally lowercase all runtimes or merge ambiguous case-sensitive files. Populate/cache identity information outside the synchronous mutation section, preserving generation fencing and the invariant that every affected graph/report is qualified atomically. Do not perform per-invalidation filesystem work across every root merely to repair matching. Ensure eviction/retainOnly use the same identity model.
- Required regressions: parent/child Windows case mismatch; same mismatch during cold build; trailing slash/backslash control; a real junction/symlink alias with invalidation through the target; sibling boundary isolation; alias/child eviction followed by a still-qualified parent. When a file has been removed and realpath is unavailable, retain enough prior identity information to invalidate its cached node safely.
- Probe: C:/Users/abdal/AppData/Local/Temp/task559-r3-probe.cjs. Outputs: same-case-slashes => both clean=false; windows-case => both clean=true; cold build case variant => clean=true; realpath event for junction root => sameRealFile=true, dependents=[], clean=true. The junction is an actual Windows filesystem fixture at C:/Users/abdal/AppData/Local/Temp/task559-r3-identity-7jOm7I; the probe asserts realpath equality before exercising the service.

## Blocking issues

R3-B1 above. Case and junction aliases are grouped as one identity defect rather than counted twice.

## Serious issues

None independently established.

## Moderate and minor issues

None requiring another finding. Scanning every cached root is necessary to fix the demonstrated overlap case; the scan itself is not a defect.

## Data flow, atomicity and cost

1. **OK for recognized identity:** DG:269 registers running generation/invalidation state before parsing. DG:745 records invalidations for each matching running root.
2. **OK:** selection remains eligible-only and deterministic at GC:159; background parse yields and fences remain at DG:397. File-count semantics and the 5,000 cap remain unchanged.
3. **OK:** DG:504 yields during linking and stops at the 250,000 distinct-edge bound at DG:568. DG:583 preserves internal/proven-external/context-dependent accounting.
4. **OK:** DG:301 guards publication. DG:314 publishes the graph/report and DG:333 applies recorded invalidations without an await. No normal event-loop reader can interleave in that section.
5. **OK for matched cached graphs:** DG:756 scans a snapshot of cached entries. Each invalidateInGraph synchronously replaces the report (DG:784) and removes edges/node (DG:790, DG:813). The whole loop has no await, so a normal reader cannot observe half the matched root set updated. **Gap:** R3-B1 causes an affected root to be excluded before this correct mutation begins.
6. **OK:** eviction/retainOnly/clear still drop graph and coverage together and revoke generations (DG:903, DG:922, DG:942). Rerun in-flight eviction probes pass for matching spelling. Alias identity must also be consistent at these entry points when R3-B1 is fixed.
7. **Cost:** matching work is O(R+B) root comparisons for R cached roots and B active builds, plus the sum of removed incident edges across affected graphs; the entry snapshot allocates O(R) references (DG:745, DG:756, DG:790). It does not scan every node of every graph. Graph count has no hard numeric cap in this service (DG:181); lifecycle eviction supplies the practical bound. Repeated invalidation of an already removed node does not move buckets again (GC:327). No additional timer/listener or permanent per-invalidation entry is introduced; in-flight path sets clear when the build settles (DG:346). A stalled build can still retain accumulated paths, an existing residual from r1's tracking design rather than a newly demonstrated session leak.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Original R2-B1 overlapping cached roots | COMPLETE for identical identity spelling | DG:756; original r2 probe now passes |
| Windows case-equivalent root containment | MISSING | R3-B1; DG:1003 |
| Junction/symlink identity | MISSING | R3-B1; real junction repro |
| Backslashes and trailing root separators | COMPLETE | DG:744/986; passing control probe |
| Invalidation during build, generation fence | PARTIAL | Fence is intact; identity mismatch can prevent recording |
| Atomic graph/coverage mutation for matched roots | COMPLETE | DG:314/333/784/813 |
| Prior resolver fixes and reason code | COMPLETE | GC:298/250; old probes rerun |
| Fair cap, edge cap, accounting/merge | COMPLETE in 23a service scope | GC:159/431; DG:568 |
| Batch 9/9b background/status/empty-result semantics | INTACT by trace and scoped service tests | DG:356/361/397/964; PD:2476/2512/2653/2666 |
| Discovery bounds and complete resolver context | DEFERRED as agreed | 23b/32b; no new requirement imposed here |

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Matching parent/child invalidation and child eviction | YES | R2 probe: parent remains unclean |
| New nested file, same spelling | YES | DS:1048 qualifies both roots without moving analyzed |
| Sibling root, same spelling | YES | DS:1060; separator boundary at DG:1006 |
| Windows case variant | NO | Cached and cold-build probes, R3-B1 |
| Real path vs junction alias | NO | Real fixture and service probe, R3-B1 |
| Repeat invalidation | YES | GC:327; old B1 tests retained |
| Supersession/eviction mid-build | YES for matching keys | DG:301/344; rerun lifecycle probes |
| Bare package / # import / node: builtin | YES under accepted interim rule | Reason-coded partial / unresolved internal / proven external |
| Huge sources or permanently pending parse | PARTIAL, unchanged | Caps bound file/edge counts, not source bytes or service timeout |

## Verification

- Scoped ptah_get_diagnostics: typescript-compiler, 0 errors, 0 warnings for the two production files. Native reads used because no ptah file-read API is listed.
- Original r2 temporary probe rerun: nested-root repro fixed; in-flight invalidation combined with evict/retainOnly/clear passed; bare-package reason code retained.
- Original r1 temporary probe rerun: all three direct findings remain fixed.
- New identity probe reproduced R3-B1 with actual local service/helper code transpiled using installed TypeScript, mocked file/analysis/logger ports, and an actual Windows junction fixture for identity verification. The case test uses equivalent Windows spellings; the control tests separator/trailing-root normalization. These are service tests, not editor or real-parser integration tests.
- Scoped Nx run-many test/lint/typecheck for @ptah-extension/workspace-intelligence with --skip-nx-cache: PASS, exit 0, all three targets, duration 1m 21s. Nx suppressed successful-task detail, so no independent exact spec count is asserted.
- degradation-audit:lint --skip-nx-cache: PASS, exit 0, TOTAL 300.
- ptah-electron:validate-deps --skip-nx-cache: PASS, exit 0.
- All checks ran once using installed nx/dist/bin/nx.js, NX_ISOLATE_PLUGINS=false and NX_DAEMON=false; one completion check collected the results. Logs: C:/Users/abdal/AppData/Local/Temp/task559-review-workspace.log, task559-review-audit.log and task559-review-deps.log.
- Author's 93/93 and old-service 3-failed/56-passed counts remain author-reported; no source revert was performed. No git/HEAD comparison or separate dispatcher integration suite was run. Prior instructions/task documents were retained from the continuing review; the author reports only DG and DS changed in revision round 2. No source was edited; temporary scripts/fixtures are under OS temp.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the path-identity repros and original-probe closure; MEDIUM for unexecuted editor integration.
- Top risk: equivalent Windows or linked paths bypass invalidation, so stale dependency results remain certified clean.
- What a robust implementation would add: consistent cached root/node identity and alias handling, synchronous all-affected-graph invalidation using that identity, and the targeted case/junction regressions above. Preserve the accepted resolver-context qualifier until 32b can prove completeness.
