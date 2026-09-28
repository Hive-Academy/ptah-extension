# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 25a revision review r3, Lane H. Read-only review of the last revision, with the full provider review from r1/r2 retained and the changed settlement logic and regression specs re-read on disk. No source/spec edits or git operations were performed.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 |

The original r2 probe is fixed. The check is still too early to guarantee honest answer publication: invalidation after that check can leave a complete census in an unresolved public request, including a request made after invalidation. Independent probes reproduce the remaining false-clean result. This prevents the 7–8 band despite the correctly preserved rejection, single-flight and cache-lifetime fixes.

Source anchors below use `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts` (Provider) and its `.spec.ts` (Spec).

## Prior-finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| B25A-R1-S1: unobserved mixed type-check rejection | RESOLVED | Provider:534 observes both operations with Promise.all. Original crash probe exits 0, catches the expected failure, and reports no unhandled rejection. |
| B25A-R1-M1: repeated pending discovery after TTL/LRU | RESOLVED | Provider:874 prioritizes the pending entry; Provider:892 dates completed cache entries; Provider:907 only evicts settled values. Original two-minute probe starts one walk. |
| R2-B1: invalidating a pending walk returns its old census clean | ORIGINAL TIMING FIXED; publication invariant incomplete | Provider:889 returns UNKNOWN_CENSUS when stale before the settle callback. Original root/global probe now returns unknown and never clean. R3-B1 below covers invalidation after that check. |

The updated Spec:956 asserts both pre- and post-invalidation callers get unknown. Spec:983 adds root/global variants and verifies the subsequent walk counts the new Python file. These assertions would fail on regression to r2 source, whose returned census was complete (as independently recorded in r2). I did not mutate the source to rerun a base version. They do not cover invalidation after the settle callback has already accepted the result.

## Five logic questions

### 1. How does this fail silently?

Provider:889 tests staleness only when the discovery resolves. Provider:894 returns the census, while removal of the shared pending entry occurs in a later promise continuation at Provider:896. Invalidation between those steps can mark an entry stale after the only check. A new caller still joins its promise at Provider:874 and receives complete, clean coverage. See R3-B1.

### 2. What user action produces unexpected behaviour?

An async edit completes, the caller invalidates diagnostics and immediately checks again while a census is finishing. If the edit/invalidation continuation falls between census acceptance and pending cleanup, the new request gets the pre-edit census (Provider:432–442, :874, :889–898). The probe uses public methods and ordinary Promise continuations, without modifying provider internals.

### 3. What input data produces a wrong answer?

An old empty/TS-only discovery followed by a new `.py` file yields `census:'complete', clean:true, unchecked:0` with no reason or notChecked group. Python is not scanned by an unscoped request, so that newly added file should qualify the answer. Provider:674–699 trusts the old census without a final validity check.

### 4. What happens when a dependency fails or takes longer?

Mixed failures remain observed by Promise.all (Provider:534). A census timeout returns unknown after the existing budget and clears its timer (Provider:852–863). A slow TS result widens the publication race: the census can fully settle, then invalidate can run while getUnscoped still waits at Provider:641, and the old complete census is subsequently rendered. No cancellation or extra parallel census is needed to fix that; publication can downgrade an invalidated result to unknown.

### 5. What is missing that the requirements never mentioned?

A validity boundary encompassing the final unscoped response, not just discovery settlement. A root/global generation or equivalent validity token should remain associated with a census until Provider:674 assembles coverage. The specification's 'dropped by invalidate' and language-honesty requirements warrant this without requiring atomic filesystem snapshots or cancellation of existing walks.

## New findings

### 1. R3-B1 — Blocking: invalidation after the stale check can still publish a false-clean census

- **Primary anchor:** `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts:889`.
- **Related anchors:** Provider:874 (returns the shared promise regardless of its now-stale flag), :894–898 (accepted result precedes pending cleanup), :641 (waits for both TS and census), :674–699 (no publication validity check).
- **Concrete failing scenario:** Begin an unscoped call with a held empty census. Release that census. After its acceptance callback but before its finally callback, add `new.py`, call `invalidate(root)`, then call `getDiagnostics(root)` again. The stale flag is set, but the result was already accepted. The new call joins the old pending promise and receives a clean, complete answer with zero unchecked files.
- **Observed probe:** Two ordinary microtask turns after releasing the held walk reproduce the window: `calls:1`, post-invalidation `clean:true`, `census:'complete'`, `unchecked:0`, `reasons:[]`. At one turn, the new stale check works and returns unknown. At three turns, cleanup has run and the new call starts a second walk and correctly returns `unchecked:1`. These neighboring controls distinguish the missing fence from classification or discovery errors.
- **Second timing of the same defect:** Let the census finish while the inner TS request remains pending, then invalidate, then resolve TS. The still-pending public request returns the accepted old census as clean. This is a larger wall-clock window, not solely microtask ordering.
- **Impact:** A diagnostics answer can certify complete accounting of the workspace after an edit while a newly added Python file was not checked or disclosed. The post-invalidation-caller reproduction makes this a silent wrong answer, meeting Blocking severity. No malformed inputs or private-state mutation are required.
- **Current handling:** Invalidating deletes settled cache and marks currently registered pending entries stale; neither action retracts a census already accepted by a waiting response. The settlement check prevents only earlier invalidations.
- **Recommendation:** Carry census validity through response publication, including root and global invalidation, and substitute UNKNOWN_CENSUS if its validity changed before assembling the unscoped answer. A generation captured for the request alone is insufficient for a post-invalidation request joining an older entry; the census/entry must carry its generation or stale token too. Also ensure a post-check stale entry cannot be reused as current. Keep one physical walk per root; no parallel refresh is necessary. Add regressions for both the settle/finally interval and a settled census awaiting a held TS result.

## Blocking issues

R3-B1 above; one failure mode across two schedules.

## Serious issues

None newly established.

## Moderate and minor issues

None newly established. Continuous invalidation producing unknown coverage is an acceptable disclosed limitation, not a new defect.

## Data flow

1. Mixed scoped requests run both operations through Promise.all — OK, Provider:534.
2. Unscoped requests await TS plus the census — Provider:641; this joins two independent lifetimes.
3. Pending census is reused without TTL expiry, completed census uses settlement TTL — OK, Provider:871–880, :892.
4. Invalidation marks pending entries and clears settled cache — OK for future discovery selection, Provider:432–442.
5. Settlement checks stale and returns unknown if already invalidated — fixes the original probe, Provider:889.
6. Accepted result crosses promise continuations and may wait for TS — no validity fence, Provider:894–900 and :641.
7. Coverage is built from that accepted result — R3-B1, Provider:674–699.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Original R2-B1 root/global probe | COMPLETE | Both now unknown, clean false; next call re-walks and counts Python. |
| No false-clean after settlement/invalidation | PARTIAL | R3-B1 reproduces both late-settlement schedules. |
| S1 rejection handling | COMPLETE | Original Node crash probe passes; Provider:534 unchanged. |
| M1 single-flight/TTL/LRU | COMPLETE in reviewed paths | One pending walk; stale result is not cached; TTL from settlement. |
| Continuous invalidation | HONEST LIMITATION | Unknown counts and census? reason; no unsupported clean claim when stale is observed at :889. |
| Earlier R5 root fixes and non-revised 25a behavior | Prior evidence retained | Narrow revision only changes the provider settlement logic/specs; no new adapter run claimed. |

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Invalidate before settle callback | YES | UNKNOWN_CENSUS returned, not cached. |
| Invalidate between acceptance and finally | NO | Post-invalidation caller joins accepted stale result. |
| Invalidate after census settles while TS pending | NO | No final response validity fence. |
| TTL expires while stale walk pending | YES | Pending lookup wins; no second walk; stale guard returns unknown if set before acceptance. |
| Repeated invalidation during every walk | YES, qualified | May remain unknown indefinitely while edits continue; reasons disclose uncertainty. Once a walk completes without invalidation, normal caching resumes. |
| Mixed TS rejection | YES | Promise.all observation remains intact. |

## Verification

Commands personally run against current disk source:

```powershell
node "$env:TEMP/task559-25a-r2-invalidation-probe.cjs"
node "$env:TEMP/task559-25a-provider-crash-probe.cjs"
node "$env:TEMP/task559-25a-r3-settlement-probe.cjs"
```

- Original r2 probe: root/global joined answers both `clean:false`, `census:'unknown'`, null unchecked/failed counts, reasons `census?`, `unchecked?`, `failed?`; next answer counts one unchecked Python file. Two sequential walks.
- Original crash/TTL probe: exit 0, expected inner error caught, no unhandled rejection, one walk across two simulated minutes.
- New settlement probe: public API, actual provider transpiled from source, mkdtemp fixture, held discovery and inner TS promises. One microtask: unknown; two: post-invalidate answer falsely clean with one walk; three to five: new walk counts Python. Separately, a settled census waiting on TS remains falsely clean after invalidate.
- Scoped `ptah_get_diagnostics`: TypeScript compiler, zero errors and warnings.
- No source mutation/base checkout was used; regression sensitivity is based on read assertions plus prior and current probe results. The new probe is an OS-temp file, not a repository spec change.

Scoped command: `node_modules/.bin/nx run-many '-t=test,lint,typecheck' -p @ptah-extension/workspace-intelligence --skip-nx-cache`, with NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. Header confirms only workspace-intelligence. All three targets passed in 1m18s. Log: `%TEMP%/task559-25a-r3-checks.log`. Run once; one completion check. No workspace-wide checks or cross-platform runtime probes.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Score: 6/10
- Top risk: a census accepted before invalidation can still certify a clean diagnostics answer after invalidation.
- What a robust implementation would add: census validity tracking through final response assembly, tests for the acceptance/cleanup window and the held-TS window, while preserving one pending walk per root and the existing unknown-census fallback.

