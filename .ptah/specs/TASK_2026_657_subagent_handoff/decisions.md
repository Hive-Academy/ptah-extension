
## 2026-10-14 — R3 NEEDS_REVISION after the revise cap (user decision)
- R3 (code-logic-review-r3.md): finding 2 PARTIAL; new Blocking (retry cap deletes the record
  silently), new Serious (opportunity during the drop-triggered backoff is missed).
- User chose "One bounded fix": one subagent correction, then one independent codex review.
  If that review still finds defects, report them to the user and stop. Do not reset the cap.

## 2026-10-14 — R4 after the bounded fix: stop and report
- R4 (code-logic-review-r4.md, 74347fc75): R3 Serious FIXED; R3 Blocking PARTIAL (terminal
  notice can be cleared at turn end, then release deletes the record); new Serious
  (inFlight cleared before the `missed` flag is consumed -> double push / double notice).
- Per the user's decision, no more fix rounds: report to the user, do not push.

## 2026-10-14 (session 4) — user asked for options + a setting
- Options and the setting design are in r4-options.md. Recommendation: A (PR with known gaps),
  then a `compaction.subagentAutoStop` boolean setting task, then the owner-loop fix task.
- Branch stays local until the user picks an option (push/PR is an outward action).

## 2026-10-14 (session 4) — user decision: Option E on this branch
- File-backed handoff (r4-options.md "Option E") on fix/subagent-handoff-notice: write the handoff
  file before delivery, task-folder location with a path check, convention + host prompt pointer,
  remove the pending-record retry/cap/undelivered-notice code. Setting D stays a separate task.
- Flow: architect plan -> codex plan review (Gate 2, lane-review) -> one Claude implementer ->
  orchestrator checks -> codex code-logic review -> one fix round max -> PR.

## 2026-10-14 (session 4) — plan-review-e REVISE (4 Blocking, 5 Serious): simplify, do not patch
Orchestrator decisions (evidence: plan-review-e.md findings 1-12):
- D1 One authoritative record, host dir only: `.ptah/subagent-handoffs/<key>.handoff.md`, key =
  session short id + sanitized tool-use id + random nonce, exclusive create (`wx`), written once,
  host never rewrites it. Removes the ref index and the host/agent write race (F2, F5, F6, F10).
- D2 Durable before the stop: no record written (no workspace, write error, timeout) -> the
  handoff stop is NOT performed; retried on a later subagent message, bounded; one log line.
  Safety (cost) stop keeps its current in-memory route, labeled "no durable record". (F1)
- D3 No "delivered" state. Only the agent changes status: pending -> consumed (or dismissed).
  Push/queue success changes nothing on disk; the pointer continues until consumed. (F3, F9)
- D4 Pointer on EVERY main-thread prompt (no 60 s rule) for pending records owned by this session
  or whose owner session is no longer live; oldest first, max 10 paths + "N more" line; in-memory
  index from one bounded dir scan at first use, updated on write, entry dropped when its head
  reads consumed/dismissed/missing. Paths only, never content. (F3, F4, F11)
- D5 Cleanup deletes only consumed/dismissed records older than 7 days; pending is never
  deleted. (F8)
- D6 Task folder: best-effort, immutable stub `subagent-handoff-<agent-type>-<id8>.md` that only
  names the record path; validated at creation (realpath inside <workspace>/.ptah/specs, no
  symlink components), `wx`. Its failure does not affect durability. Host dir realpath checked
  inside the workspace and not a symlink before writing. (F7)

## 2026-10-14 (session 4) — plan-review-e-r2 REVISE (3 B, 5 S, 2 M): revision 3 decisions
Revise round 1 of 2 used (round 0 = plan-review-e.md). Revision 3 gets one final recheck.
- B2 (USER decision): the safety/cost stop still stops without a durable record; the handoff then
  goes only through the in-memory send. Documented limit: loss needs a disk failure AND a send
  failure. The handoff (context) stop still needs a durable record (D2 unchanged).
- B1: once `stopTask` was invoked, never delete the record (ambiguous rejection, give-up,
  release). Withdraw only when the stop was never invoked. The record text tells the reader: if
  the subagent is still running or finished normally, set `status: dismissed`.
- B3 + M2: index load = `readdir` names only (no cap on names, no head reads at load). Per prompt:
  read heads of at most 10 records within the time bound, rotating a per-process cursor across
  the pending list so every pending path is named eventually; the "N more" line names the folder.
  On timeout: one line naming the folder.
- S1 + S2: ownership lives in the immutable file name, not the frontmatter: owner = first 16 hex
  of sha256(owner session id), compared by hashing the live session ids (incl. rekey aliases).
  Frontmatter only carries status; malformed status = pending, never deleted.
- S3: no cross-process liveness. A record whose owner is not live in THIS process is pointed to
  with explicit takeover text: "from another or an ended session; continue it only if that
  session is not running, else leave it". No inference of death.
- S4: trust boundary stated: the workspace filesystem is trusted local state (same as the existing
  `.ptah/subagent-handoffs` writes in subagent-handoff-files.ts). Keep the realpath + no-symlink
  check at creation and `wx`; no handle-safe primitive. Documented in the plan.
- S5: one record per (live session alias set, tool-use id): an in-process map in the writer; a
  second stop for the same tool id after a rekey merge reuses the existing record path and does
  not write a second one. Test two in-flight stops across rekey.
- M1: accepted risk, documented: cleanup touches only consumed/dismissed records older than 7 days.

## 2026-10-14 (session 4) — r3 REVISE at the cap; USER: one more plan review
- plan-review-e-r3.md: B1/S1/S2/S3/S5/M2 resolved; 2 Blocking discovery gaps (no rescan for other
  hosts' records; one unreadable record starves the rest).
- User chose "One more plan review" (extra round, user-authorized). Orchestrator added to the plan:
  60 s names-only rescan (single flight) and per-entry read-error skip with cursor advance + folder
  line; tests for both. Then one scoped codex recheck (plan-review-e-r4.md).

## 2026-10-14 (session 4) — r4: r3 blockers RESOLVED; one new Blocking applied verbatim
- plan-review-e-r4.md: new Blocking (a failed head read is hidden when other records are listed).
- Peer-settled (decision ladder step 2): applied the reviewer's required change exactly: list the
  failing record's path with "(could not be read; open it directly)"; test the mixed schedule.
  No further plan round; the codex code review verifies it in code. Plan gate closed.

## 2026-10-14 (session 4) — Guarantee 4 wording
- Index does not wrap within one prompt: worst case ceil(C/10)+1 prompts to name every pending
  record. Eventual naming is the requirement; keep the code, restate the guarantee as ceil(C/10)+1.

## 2026-10-14 (session 4) — code-logic-review-e NEEDS_REVISION 4/10: one fix round
- Fix: B1 (drop the "still running -> dismissed" clause; dismiss only when not continuing or the
  subagent finished normally), B2 (temp name the index ignores + exclusive atomic publish + temp
  cleanup), S3 (each head read raced against the remaining deadline; timeout line on expiry;
  abandoned visit does not move the cursor), M5 (log error type only; one-line privacy fix in a
  touched file).
- Not fixed (no data loss, later task / PR known gap): M4 concurrent prompts can repeat a window.
- Then one short codex re-review scoped to the fixes.

## 2026-10-14 (session 4) — code-logic-review-e-r2 NEEDS_REVISION 5/10: bounded post-cap correction
- B1, S3 RESOLVED. Remaining: hook log could carry prompt text via error name/code; failed temp
  unlink leaves an orphan. Orchestrator bounded correction (agent-lanes §6), commit 18e69cd67:
  index deletes `.<record>.tmp` older than 7 d on load (max 10); hook logs a built-in error name
  or "Error" and only an ENOENT-shaped code. Tests added; agent-sdk typecheck/lint/test pass.
  Independent codex check of this commit follows.
- code-logic-review-e-r3.md (on 18e69cd67) NEEDS_REVISION 4/10: code-shaped prompt as `code`,
  throwing getters, fixed-first temp selection. Orchestrator correction: log only the built-in
  error class via instanceof (no field reads); rotate temp cleanup across loads. Tests added.
