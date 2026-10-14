Verdict: REVISE

# Option E revision 2 design review

Score: 4/10. The normal write-before-stop route is coherent (`implementation-plan-e.md:224-229`), but the blocking schedules below still violate the no-loss or correct-audience contract. This is below 5–6 because they arise at ordinary stop and discovery boundaries; above 1–2 because the ref, host status rewrite, and 60-second defects are removed. Evidence paths in this report are relative to the stated worktree, except task-folder documents. This is a plan review; no code, tests, or builds were changed or run.

## Earlier findings 1–12

| # | Status | Evidence and impact |
| --- | --- | --- |
| 1 | PARTIAL | Record precedes a handoff stop (`implementation-plan-e.md:95-111,224-229`), but uncertain stop failure withdraws it and the safety exception still stops without one (`:59-70,103-111`); see B1–B2. |
| 2 | RESOLVED | One record replaces the ref index (`:46-53,85-93,137-144`); a failed second write cannot strand the first behind a missing ref. |
| 3 | RESOLVED | No 60-second grace or pending-age deletion (`:145-155,245`); fresh pending records remain eligible. First-prompt timeout is a separate issue below. |
| 4 | PARTIAL | Old first-20-ref limit is gone, but oldest 2,000 retention and fixed oldest-first output can starve later records (`:140-150`); see B3. |
| 5 | RESOLVED | Nonce-bearing key plus `wx` prevents a colliding sanitized id from overwriting another record (`:85-88,247`). |
| 6 | RESOLVED | Host writes the record once; only the agent changes status (`:48-51,85-93,248`), removing the stale host rewrite. |
| 7 | PARTIAL | Guards cover host and stub directories (`:123-134`), but the admitted check/open race still permits ancestor replacement; see S4. |
| 8 | PARTIAL | Pending is retained, and resolved cleanup waits seven days (`:145-149,250`), but no reader coordination is specified; see M1. |
| 9 | RESOLVED | No `delivered` state; send/queue outcomes leave `pending` until agent action (`:164-173,229-230`). |
| 10 | PARTIAL | Strict status parser and no refs (`:89-93,252`) fix the old parser/index issue; malformed owner metadata now creates an audience error; see S2. |
| 11 | PARTIAL | SDK `agent_id` is the documented subagent gate (`sdk.d.ts:181-186`; plan `:196-204`), but owner aliasing and process-local liveness still expose records to the wrong session; see S1–S3. |
| 12 | PARTIAL | Fault tests are substantially expanded (`:256-279`); the decisive schedules listed under Test gaps remain absent. |

## Blocking

B1. **Deviation 1 can delete the only record after a real stop.** The dispatcher awaits SDK `stopTask` and converts *every* rejection to `TASK_NOT_FOUND` (`subagent-message-dispatcher.ts:298-327`); that error does not prove the task was not stopped. The plan withdraws on a failed call/retry exhaustion or release during a failed stop (`implementation-plan-e.md:59-64,108-111,185-187`). Schedule: SDK stops the task, its acknowledgement rejects or times out, three calls reject, writer unlinks the record; the stopped task has no durable handoff. Release during the first ambiguous rejection has the same result. **Required:** withdraw only before `stopTask` was invoked or after a positively verified non-stop; once invoked, retain/publish a pending record on ambiguous failure, give-up, and release. Test SDK side effect followed by rejection.

B2. **Deviation 4 preserves a known no-record stop.** After three record failures, `recordGaveUp` suppresses only handoff; a later safety threshold can stop the subagent without a record (`implementation-plan-e.md:25,69-70,100-109`). The in-memory notice can be lost at turn end and release (`code-logic-review-r4.md:9,19-22`). This follows D2's stated exception (`decisions.md:31-33`) but conflicts with the task's absolute no-loss requirement. **Required:** resolve that contract explicitly before implementation: either obtain a durable fallback before any automatic stop, or have the owner expressly accept that safety stops can lose a handoff and document the limited guarantee. A log line does not preserve work.

B3. **A pending record can be never pointed to after restart.** Initial `readdir` retains only the 2,000 oldest names, with no rescan/rotation; a later pending file is excluded forever after restart (`implementation-plan-e.md:140-150,230-233`). Even within the index, ten older pending records repeated on every prompt keep the eleventh path out of the output (`:145-154`). The `N more` line gives only a directory, not those record paths, while the convention activates on a named record or stub (`:151-154,209-215`). **Required:** provide bounded fair enumeration/rotation or a durable pending index that eventually names every pending path, including records beyond 2,000 and records behind ten unresolved ones.

## Serious

S1. **Session-id sanitization can hide a record from its owner and show it to another live session.** The record header requires `owner-session` to be `[A-Za-z0-9_-]`, while the plan explicitly tests distinct ids `a.b` and `a_b` (`implementation-plan-e.md:77,85-87,258-260`); the monitor accepts string SDK session ids without that restriction (`session-query-executor.service.ts:329-336`). The plan does not say how a valid `a.b` owner is represented: sanitizing it to `a_b` makes `visible` give its path to the wrong live session, while rejecting it prevents a durable handoff stop (`implementation-plan-e.md:100-105,189-191`). **Required:** specify a lossless owner encoding and comparison, and test both sessions' pointer output.

S2. **Malformed frontmatter makes a private record visible to every session.** A truncated or partially edited header is `malformed` and still listed (`implementation-plan-e.md:89-93,145-154`); an unreadable owner becomes `undefined`, which `visible` accepts for every session (`:189-191`). Schedule: agent edit truncates the first 2 KB, then another live session submits a prompt and receives the path. **Required:** keep ownership in immutable, independently readable metadata (or a reversible filename); quarantine records whose owner cannot be established instead of broadcasting them, while retaining a recovery route for their real owner.

S3. **Two hosts in one workspace can hand off a live session to the wrong owner.** The plan explicitly accepts process-local liveness (`implementation-plan-e.md:234-235`); the predicate declares any owner absent from this process's `sessions` no longer live (`:189-191`). Schedule: process A runs session A; process B opens the same workspace and prompts. B points to A's pending record while A is still working, risking duplicate or conflicting continuation. **Required:** use cross-process liveness/ownership, or restrict foreign records to an explicit takeover path that cannot infer death from a local map.

S4. **The directory guard has a path-escape window.** The plan checks `.ptah` and the handoff directory before `open`, then acknowledges a swap between guard and write (`implementation-plan-e.md:123-134`). A junction or directory replacement at that point redirects the full handoff text outside the workspace; `wx` protects only the final filename. **Required:** close the ancestor-swap race with a directory-handle-safe primitive, or state and enforce a trusted-workspace-actor boundary rather than claiming containment against concurrent path replacement. Test a swap at the write seam.

S5. **Concurrent rekeyed stops can leave a second pending record.** Rekey keeps one in-flight state when old/new sessions contain the same tool id, while both stop calls can already be running (`subagent-budget-monitor.ts:520-558,968-970`). The plan writes per stop but publishes only on stop success and withdraws only on give-up (`implementation-plan-e.md:97-111,183-187`). If both records are written before rekey, one stop can set the merged state's `stopFired`; the other's record has no withdrawal path and a restart scans both (`:140-144,230-233`), causing a duplicate/false handoff. **Required:** reconcile all prepared records during state merge, retain exactly one authoritative path for a given stopped task, and test two in-flight stops across rekey.

## Moderate

M1. **Resolved-file cleanup still lacks reader coordination.** The pointer unlinks a consumed/dismissed record after seven days based on mtime (`implementation-plan-e.md:145-149`), while the rule permits an agent to continue from and edit that file (`:209-215`). A reader that reopened an old consumed record can race unlink. **Required:** specify a read lease or a safe retention rule that excludes active readers; test read/edit overlapping cleanup.

M2. **First-use work is not bounded as claimed.** A single full-directory `readdir`, sort, and 2,000-name selection precedes the pointer (`implementation-plan-e.md:140-150`); the hook abandons a slow pointer after one second (`:200-204`). With a large directory, the only next prompt can return without any path, while the scan still runs. **Required:** bound scan work by count/time or persist incremental progress; make timeout degradation still direct the parent to a discoverable record, and test an over-one-second initial scan.

## Four deviations

1. Withdraw unused record: **unsafe** after any ambiguous stop invocation (B1); safe only before invocation or with positive non-stop proof (`implementation-plan-e.md:59-64`).
2. Publish on stop success: **conditionally safe** because restart rescans disk (`:65-66,230-233`), provided index load merges concurrent `publish` calls and records written before process exit are intentionally treated as interrupted. Both conditions need an explicit test.
3. UTC time prefix: **safe for approximate oldest-first order** (`:67-68,85-88`); same-millisecond names have arbitrary nonce order, with no correctness impact if fairness is fixed (B3).
4. Safety in-memory route: **unsafe for the no-loss claim** under write plus delivery failure (B2), although it follows `decisions.md:31-33`.

## Test gaps and five logic questions

Test gaps: add stop-side-effect-then-rejection and release, >2,000 records across restart, >10 unresolved oldest, malformed owner during an edit, both `a.b`/`a_b` pointer audiences, two host processes, concurrent rekeyed stops, index load racing `publish`, timed-out first scan, ancestor swap, and cleanup/read overlap (`implementation-plan-e.md:256-279`).

1. **Silent success:** a rejected `stopTask` can trigger withdrawal although the SDK already stopped the task (B1).
2. **User action:** a prompt after restart can repeatedly see the same first ten records while the relevant eleventh is never named (B3).
3. **Wrong answer from data:** sanitized or malformed owner metadata names the record to the wrong live session (S1–S2).
4. **Dependency failure:** storage failures followed by a safety stop, or a slow first scan, remove the durable/next-prompt guarantee (B2, M2).
5. **Missing contract:** cross-process owner liveness and an authoritative result for ambiguous SDK stop rejection remain undefined (S3, B1).
