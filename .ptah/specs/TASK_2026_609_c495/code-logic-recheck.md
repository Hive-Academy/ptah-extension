# Code Logic Review — `TASK_2026_609_c495`

## Summary
| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 unresolved original finding |
Scope: Part A fix round 2, current implementations and complete specs for the two named files. Role instructions prohibit git operations and require this filename; exact commit attribution and the requested code-logic-recheck.md were not produced. No source edits or test runs. Scoped compiler diagnostics returned zero errors. Executor evidence: afix3-executor-report.md:31,42 and afix4-executor-report.md:42,46.
Evidence aliases: **R** = `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts`; **RS** = sibling `artifact-retirement.spec.ts`; **Q** = `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts`; **QS** = sibling `user-layer-seed-quarantine.spec.ts`; **H** = `libs/backend/harness-sync/src/lib/hash/content-hash.ts`. Line references below use these paths.
| Finding | Status | Evidence |
| --- | --- | --- |
| F1: unreadable regular files still qualify | NOT FIXED completely | R:211 compares a potentially sentinel-bearing digest; R:243 and R:253 perform a separate read whose bytes are discarded. Persistent unreadability is fixed, but recovery between reads still permits deletion at R:182. RS:233 would fail without the fix (assertion RS:245); its persistent denial at RS:226 misses transient failure. Mutation failure also reported at afix3-executor-report.md:31. |
| #1: quarantine rollback deletes a replacement | FIXED | Q:630 selects keep-dest; Q:1055 gates unlink on remove-partial. QS:619 forces EPERM then EIO after writing a replacement (QS:633,642); without the fix QS:661 encounters a deleted file. It also verifies complete history bytes (QS:670) and warning paths (QS:673). Mutation failure reported at afix4-executor-report.md:42. |

## Five logic questions
### 1. How does this fail silently?
A transient read error yields the same sentinel digest as the recorded digest (H:316); a subsequent successful probe (R:253) authorizes deletion and a normal removed result (R:182,192), despite never comparing the file's bytes.
### 2. What user action produces unexpected behaviour?
Retiring an adopted skill while read access recovers between hashing and inventory can delete its only notes copy (R:211,243,182). Saving during quarantine rollback is now preserved by Q:630,1055; tested at QS:642,661.
### 3. What input data produces a wrong answer?
A recorded hash containing the unreadable sentinel plus an unchanged file inventory and a transient failure reading notes.md produces false unchanged proof (H:316; R:211,253).
### 4. What happens when a dependency fails?
Persistent file read failure preserves the detached tree (R:255,258,176). Rollback copy failure preserves staged bytes, names staged/livePath, and returns false before staged unlink (Q:637,645,647). Restore selects remove-partial at Q:890, retaining cleanup at Q:1055,1059; this matches the prior behavior described at afix4-executor-report.md:12,23, but historical equivalence was not git-verified.
### 5. What is missing that the requirements never mentioned?
The proof must bind successful reads to the digest compared, not merely establish later readability (R:211,253). A partial live rollback file requires recovery from the named history path (Q:643); automatic repair is not provided.

## Failure modes
### Sentinel equality survives recovery between reads — Blocking, unresolved F1
- Trigger: adopt notes.md while its read fails; retire it with another failed hash read; allow the coverage read to succeed (H:316; R:211,253).
- Symptom: ordinary removal and loss of the entire detached tree (R:182,192).
- Evidence/current handling: R:253 discards recovered bytes and returns true; no error provenance from H:316 reaches R:211.
- Recommendation: compute a retirement-only strict digest from successful reads, rejecting any read/inventory failure; compare that digest to ownedHash. Add a path-filtered failure that permits the later probe.

## Blocking issues
- File: R:211,243,253. Scenario: the transient-read sequence above. Impact: sole user notes deleted without a snapshot (R:182). Fix: strict digest proof, with a transient-failure regression.
## Serious issues
None found in the reviewed fix logic.
## Moderate and minor issues
None charged. Accepted rollback trade-off: a partial live file may remain, but complete bytes stay in history and the warning identifies both paths (Q:637,645). A differing clone is kept on the next pass (Q:311,497). This is acceptable for byte preservation; manual recovery remains necessary. The new QS:619 test covers an editor replacement, not an actual partial-copy retry.
## New findings
None. The blocking item is a remaining case of original F1, not a newly introduced defect.
## Data flow
1. Retirement: detach (R:160, OK) → compare permissive hash (R:211, GAP) → independent readability probe (R:253, GAP) → preserve or delete (R:176,182).
2. Rollback: changed detached bytes (Q:574, OK) → exclusive keep-dest placement (Q:630, OK) → warning/retain history on failure (Q:637,645, OK).
## Requirements fulfilment
| Requirement | Status | Gap |
| --- | --- | --- |
| Reject unreadable-file proof | PARTIAL | Transient hash error can be hidden by later successful read (R:211,253). |
| Never unlink rollback replacement | COMPLETE | keep-dest bypasses destination unlink (Q:630,1055). |
| Preserve Restore cleanup behavior | COMPLETE for inspected current flow | remove-partial remains selected (Q:890); historical comparison not performed. |
Implicit requirement not addressed: digest/readability coherence (R:211,253).
## Edge cases
| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Persistent vs transient unreadability | YES / NO | R:258 rejects persistent failures | Transient failure can authorize deletion at R:182. |
| Failed fallback with replacement/partial live file | YES for preservation | Q:645 retains history | Differing bytes stay live (Q:311); manual recovery. |
## Verdict
- Recommendation: REVISE. Confidence: HIGH on the traced paths, limited on commit attribution. Top risk: sentinel-based deletion survives transient read recovery. Robust implementation: strict retirement digest and transient-failure regression. Score 6 rather than 7–8 because one original data-loss path remains; above 3–4 because rollback protection and persistent-unreadability protection are implemented with mutation-sensitive regressions (QS:661; RS:245).