# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 25a r4 post-cap review. Recommendation: APPROVE, with one Moderate retention issue. The census generation now survives every asynchronous boundary up to answer assembly. Both previously demonstrated publication races return unknown coverage after invalidation, for root-specific and global invalidation.

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

The score reflects resolved correctness defects with independently passing failure probes, but an unbounded historical-root map and the previously documented census-source deviation keep this below exemplary. No source/spec edits or git operations were performed. The full provider and surrounding contracts were read in the preceding reviews; this review re-read the changed generation lifecycle, both result paths and new regression cases. Source anchors below refer to `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts` (Provider) and its `.spec.ts` (Spec).

## Prior-finding status

| Finding | Status | Evidence and impact |
| --- | --- | --- |
| B25A-R1-S1: mixed request orphaned TS rejection | RESOLVED | Provider:567 still observes both suboperations through Promise.all. Independent default-process probe exits 0 with the expected caught rejection, no unhandled rejection. |
| B25A-R1-M1: repeated pending walks after TTL/LRU | RESOLVED | Provider:916 returns the pending walk without expiring it; completed TTL starts at :940; LRU applies to completed entries at :973. Original two-minute probe starts one walk. |
| R2-B1: invalidated running census delivered as complete | RESOLVED | Provider:936 rejects an older generation at settlement. Original root/global probe returns unknown; a later walk counts the added Python file. |
| R3-B1: invalidate after acceptance / while TS pending | RESOLVED | Provider:679 validates the obtained generation after the final await. Provider:924 preserves cached generation; :916 preserves the pending walk's generation even for a caller joining after invalidation. Both original timings and global variants now return unknown, never clean. |

### Regression sensitivity

Spec:1029–1063 covers root/global invalidation across 0–6 microtask turns, requiring the post-invalidation answer to be non-clean and any complete fresh census to count the Python file. Spec:1066 onward holds TS until after census settlement and invalidation, then requires unknown coverage. These assertions target the r3 failures directly. The original r3 probe actually returned clean at two turns and while TS was held; the same probe now returns unknown. Earlier root/global tests retain their output and single-flight assertions. No source mutation/base checkout was used this round; the author's four-fail-before result is corroborated by the recorded r3 probe, not claimed as a fresh reviewer base run.

## Five logic questions

### 1. How does this fail silently?

No remaining stale-census clean-answer path was established in the requested schedules. Provider:679 checks validity after both awaited operations; answer assembly to return is synchronous. Invalidations before assembly change the generation, and unknown coverage has null counts and reasons. The remaining confirmed issue is historical-root retention (Provider:410, :463), not a false-clean answer.

### 2. What user action produces unexpected behaviour?

A long-lived host traversing many different workspace/worktree roots accumulates one generation record per root-specific invalidation, even for roots with no cached or pending census. The usual edit loop in one root overwrites one record, so growth is by distinct roots, not edits. See R4-M1.

### 3. What input data produces a wrong answer?

The prior empty/TS-only snapshot plus newly added Python file now yields unknown after invalidation or a fresh complete census with unchecked:1. Scoped requests do not use census() at all (Provider:483–671): their complete census is of the explicit requested list. This correction therefore does not leave a scoped route for reusing a pre-invalidation workspace census. Ordinary file edits during parsing are not an atomic filesystem snapshot guarantee; no additional snapshot requirement is inferred here.

### 4. What happens when a dependency fails, times out, or remains pending?

Mixed rejection remains observed at Provider:567. Census failure returns UNKNOWN_CENSUS at Provider:993 onward; the budget at :887–900 returns unknown and clears its timer without duplicating/cancelling the existing walk. Generation travels with both timeout and actual results (:897). A census finishing before a slow TS operation is revalidated when that operation finishes (:674–679), closing the larger publication window.

### 5. What is missing that the requirements never mentioned?

A lifecycle for historical generation records. Their removal must preserve outstanding answer validity: simply deleting a root record during LRU eviction can resurrect generation zero or invalidate the wrong lifetime. A bounded strategy must account for answers already holding census snapshots as well as active walks (R4-M1). Continuous edits legitimately prevent a stable census; the current unknown disclosure is acceptable.

## New findings

### 1. R4-M1 — Moderate: historical root generations have no bounded lifetime

- **File:** `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts:463`; storage at :410; only clearing operation at :458.
- **Trigger:** A long-lived provider receives root-specific invalidation for many distinct roots over its lifetime, without a global invalidate. The production invalidator calls the root-specific form (`libs/backend/vscode-lm-tools/src/lib/diagnostics/diagnostics-cache-invalidator.service.ts:190`).
- **Symptom:** Root paths and generation numbers remain resident after all associated walks/results are gone. The eight-entry completed-cache cap does not bound this map. Even invalidation of a root never queried creates a permanent record.
- **Probe:** 10,000 distinct public invalidate(root) calls under an OS-temp root leave 10,000 generation entries with zero completed and zero pending censuses. A global invalidate clears them. The probe observes the runtime map for measurement but changes state only through the public invalidate method.
- **Impact/severity:** Moderate: slow memory growth in unusually long sessions visiting many distinct worktrees/roots. Repeated edits within a small fixed root set do not grow it, and no immediate resource exhaustion or incorrect answer is established. This is not a Blocking/Serious issue.
- **Recommendation:** Give generation records a bounded lifecycle without removing the publication fence. Options include lifecycle-owned validity tokens with outstanding-reader tracking, or a conservative global generation rollover when a historical-root threshold is reached (clearing completed cache and qualifying outstanding answers). Do not simply evict generation entries while readers can still hold their old values. Add a many-retired-roots test alongside the publication-race tests.

## Blocking issues

None established after the bounded correction.

## Serious issues

None established after the bounded correction.

## Moderate and minor issues

R4-M1 above. No additional counted issue.

## Data flow and generation assessment

1. Root-specific invalidate increments the shared monotonic counter, deletes that root's completed cache and records its generation — Provider:452–463.
2. Global invalidate records the next counter value and clears the per-root map — :455–458. generationOf uses max(root, global) at :467, so the clear cannot restore an old generation.
3. New walks capture the root generation at :928; pending joins retain the walk's generation at :916; cached reads retain the stored generation at :924. Unrelated root invalidation leaves this root's generation unchanged.
4. Settlement checks generation before caching at :936. An overtaken walk remains the sole walk until finally cleanup; no invalidate burst starts parallel walks.
5. The budget returns census plus its original generation at :897. A held TS result cannot bypass the final check.
6. getUnscoped checks again at :679 after Promise.all. No await follows before response assembly/return, so ordinary event-loop invalidation cannot interleave inside that assembly.
7. An answer already assembled before a subsequent invalidation is a prior snapshot; this code does not promise to mutate previously returned objects. That is distinct from the fixed pre-publication races.

## Requirements fulfilment

| Requirement | Status | Evidence / limit |
| --- | --- | --- |
| Both R3-B1 timings, root + global | COMPLETE | Independent original and global probes pass; final fence :679. |
| Pending/settled generations retained | COMPLETE | :916, :924, :928–942. |
| Global/root ordering | COMPLETE | Monotonic sequence and max at :452–470; global clears only after advancing its generation. |
| S1/M1/R2 guarantees | COMPLETE in reviewed scope | Earlier probes rerun; same single-flight and Promise.all structures. |
| Scoped census route | NOT APPLICABLE | Scoped path builds coverage from explicit request classification, not cached discovery. |
| Bounded generation memory | PARTIAL | R4-M1; completed cache is bounded, historical-root map is not. |
| Census source from graph when available | Prior documented deviation retained | Provider header :32–39 explains independent bounded discovery because graph summaries lose extension detail. No new deviation in this correction. |

## Edge cases

| Case | Handled | Evidence |
| --- | --- | --- |
| Invalidate during walk | YES | Unknown at settlement and publication; original r2 probe. |
| Invalidate between acceptance and cleanup | YES | Original two-turn probe now unknown; old generation follows joining caller. |
| Invalidate while TS remains pending | YES | Final fence runs after TS; held-TS probe. |
| Root then global / global then root | YES by code | Every covering invalidation advances generation; max rule preserves newest value. |
| TTL expiry while invalidated walk pending | YES | Pending lookup before TTL; no duplicate walk. |
| Continuous invalidations | YES, qualified | May remain unknown until a walk/answer avoids invalidation; census? and null counts honestly disclose it. |
| Many abandoned roots | PARTIAL | Generation history grows until global invalidate. |

## Verification

Personally run against current disk source:

```powershell
node "$env:TEMP/task559-25a-r3-settlement-probe.cjs"
node "$env:TEMP/task559-25a-r4-global-probe.cjs"
node "$env:TEMP/task559-25a-r2-invalidation-probe.cjs"
node "$env:TEMP/task559-25a-provider-crash-probe.cjs"
node "$env:TEMP/task559-25a-r4-retention-probe.cjs"
```

- Root and global publication probes: at one/two microtasks, post-invalidation answers unknown and non-clean; at later tested turns a fresh walk yields unchecked:1 and non-clean. Held-TS cases unknown and non-clean.
- Earlier invalidation probe: both variants unknown, then next call counts Python, two sequential walks.
- Crash/TTL probe: exit 0, expected inner error caught, no unhandled rejection, one walk across two simulated minutes.
- Retention probe: 10,000 root records, zero completed/pending entries; global invalidate reduces records to zero. This accelerates distinct-root churn; it does not allege 10,000 roots is ordinary usage.
- Probes load actual provider source with controlled dependencies and real mkdtemp roots; no repository source or specs were modified.
- `ptah_get_diagnostics` scoped to the provider: TypeScript compiler, zero errors/warnings.

Scoped command: `node_modules/.bin/nx run-many '-t=test,lint,typecheck' -p @ptah-extension/workspace-intelligence --skip-nx-cache`, with NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. Header confirms only workspace-intelligence. All three targets passed in 1m15s. Log: `%TEMP%/task559-25a-r4-checks.log`. Run once, one completion check.

No fresh base mutation, cross-platform runtime checks, or adapter-suite reruns were performed in this narrow correction review. Earlier adapter acceptance evidence remains in r1. Batch 25b forwarding and the census-source deviation remain documented handoff items, not newly claimed completed work.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the corrected races; MEDIUM for broader lifetime behavior outside the exercised root set.
- Score: 7/10
- Top risk: historical-root generation records accumulate in long-lived multi-worktree sessions.
- What a robust implementation would add: bounded historical generation retention with outstanding-reader safety, preserving all publication-race and single-flight regressions.

