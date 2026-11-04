Author: Claude project-manager subagent
Reviewer: codex lane
Artifact revision: 0
Round: 2
Verdict: REVISE

## Findings

1. **Serious — D1; AC 1.4–1.5.** The fixed user decision keeps the AUTH_REQUIRED resume refusal *and its contract* unchanged (context.md:16–18, 33–37), but D1 requires an additive field on that refusal (task-description.md:106–110, 246). An optional response property still changes the response shape and may break strict assertions in the parallel task, a risk the document acknowledges at line 269. **Change requested:** leave the existing refusal response untouched. Obtain eligibility through a separate read-only host query or at the explicit carry-over action, and make AC 1.4 describe that structured source. If the intended contract includes additive fields, return that contract change to the user or parallel-task owner for an explicit decision.

2. **Serious — AC 1.6, 4.1, 4.5, 5.4; D6/D8.** The banner is one global signal with only provider/message (auth-state.service.ts:186–189, 1217–1222), while the view renders it independently of tab identity (chat-view.component.html:147–154). The criteria cover dismissal and a closed tab, but not switching tabs, replacing the refusal, or an in-flight result arriving after the tab has been rebound. A click or late completion can relink another tab or clear a newer refusal. **Change requested:** bind the carry-over offer to the refused session, workspace and tab plus a refusal generation; require a click-time and completion-time identity check; specify the outcome when the tab changes or a newer banner replaces the old one, with race tests.

3. **Serious — NFR Security; risk at task-description.md:226–230, 271.** The document explicitly accepts forwarding credentials typed in ordinary user/assistant prose or a compaction summary to a different provider with “no extra filter.” AC 3.5/3.7 protect tool data and attachments only. This is a cross-provider privacy policy, not a reversible implementation detail the PM can settle. **Change requested:** make the transfer disclosure and secret-handling rule explicit in the acceptance criteria, including ordinary text and summaries; seek the user’s decision before adopting an unfiltered-transfer policy. Test that known secret-bearing text is handled according to that rule and never appears in UI errors or logs.

4. **Moderate — AC 3.4; D4.** The named budget bounds the *rendered output* but not the read. The cited reader’s `readSessionHistory` options are `checkCompactionBoundary` and `includeBlockOwners` (session-history-reader.service.ts:350–356); its `TranscriptWindowOptions.tailBytes` applies elsewhere (lines 908–972). Large histories can still require a full synchronous parse before trimming. **Change requested:** state whether the carry-over read must itself be bounded; if so, specify a read window or streaming strategy and a large-history acceptance case. Avoid citing `tailBytes` as an option of `readSessionHistory`.

5. **Moderate — AC 4.3, 5.1–5.3.** The notice says “Continued with … in a new chat” when carry-over *starts* (task-description.md:177–180), but failures before session creation must create no chat (lines 194–200). The result can leave a false success notice beside a failure banner. **Change requested:** show that notice only after the new session id exists and the tab is bound, or define its removal/replacement on every pre-session failure.

## Decisions

- **D2–D4, D6–D10:** Defensible implementation choices, subject to findings 2 and 4. In particular D9 is supported in both directions by the history router (session-history-router.ts:48–58) and both refusal entries use `runtimeProfile.prepare` (chat-session.service.ts:2408–2409; chat-slash-command-router.service.ts:333–334, 459–469). D8 permits repeated *explicit* clicks and does not override in-flight deduplication. All are reversible.
- **D5:** Keep summary-only first turn and do not auto-send the refused prompt. Context.md:25–28 says the user continues *after* the summary, and the sender rolls back an unsent prompt boundary (message-sender.service.ts:848–865, 905–923). This is defensible and reversible; test the refused ordinary send and `/compact` separately.
- **D1:** Not accepted as written; see finding 1. Structured eligibility is sound, but the existing refusal contract is user-reserved.
- **Anchor audit:** Verified at least nine cited anchors: resolver mismatch at workspace-provider-profile-resolver.ts:277–283 and :542–553; continue preparation and error shape at chat-session.service.ts:2408–2409 and :2488–2495; slash preparation/refusal at chat-slash-command-router.service.ts:333–334 and :459–469; history dispatch at session-history-router.ts:48–58; result fields at rpc-chat.types.ts:209–223; renderer handling at message-sender.service.ts:143–157; banner state at auth-state.service.ts:186–189, :1217–1222. The document’s short references to the slash router and chat view omit their actual `session/` and `components/templates/` directories, respectively; use full paths in the next revision.
- **Scope and verification:** Reviewed the requirements, context, fixed decisions, and spot-checked cited source. No build or test was run for this document review. Findings 1–3 distinguish REVISE from a moderate-only approval; the behavior of future implementation remains unverified.

## Round 2

Artifact revision: 1
Verdict: REVISE

1. **F1 — Fixed.** AC 1.4–1.5 now use existing structured data or a separate read-only query, prohibit added refusal fields, and require a full-shape spec (task-description.md:115–123); D1 is superseded (line 342).
2. **F2 — Fixed.** Requirement 7 binds the offer to session, tab, workspace and generation, specifies click and completion races, and requires deferred-response specs (task-description.md:255–287).
3. **F3 — Fixed under the orchestrator's row 10 resolution.** Requirement 8 specifies text-only transfer, best-effort known-pattern redaction including summaries, disclosure, and success/failure checks for provider text, logs and UI payloads (task-description.md:289–316). This implements the user's requested cross-provider summary without treating the requested transfer as an open decision.
4. **F4 — Fixed as to the original finding.** AC 3.4 now bounds the read, AC 3.10 adds both history kinds, and D4 corrects the `tailBytes` citation (task-description.md:170–174, 184–188, 345). The new AC creates the separate serious conflict below.
5. **F5 — Fixed.** The success notice waits for a session id and tab binding; pre-session failures show none, while a post-session turn failure retains it (task-description.md:202–208, 223–234).

### New findings

1. **Serious — AC 3.1–3.2, 3.8, 3.10.** AC 3.10 requires reading no more than a fixed bound from a history source over ten times larger (task-description.md:184–188), yet AC 3.1 requires *every* text turn when rendered text fits the budget (lines 164–165), AC 3.2 requires an exact count of omitted turns (lines 166–167), and AC 3.8 requires the latest compaction summary (lines 181–182). A tail-only read cannot know how many turns precede its window, whether omitted text would have fit, or whether a compaction summary exists before the window. The existing `readSessionHistory` exposes no tail bound (session-history-reader.service.ts:350–356), so these guarantees cannot be inferred from existing metadata. **Change requested:** choose a consistent bounded strategy and revise the ACs together: permit a streaming full-file scan with bounded memory/work per chunk and exact counts/summary, or keep a strict byte-read cap but define the lost-history behavior, an honest “earlier content omitted” marker without an exact count, and the rule when the latest summary is outside the window. Add fixtures for a summary and text turns just before the read window.

Round 2 reviewed only the five prior findings and new Requirements 7–8/AC 3.10. No builds, tests, source edits or git commands were run.
