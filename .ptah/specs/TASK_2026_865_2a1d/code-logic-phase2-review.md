# Phase 2 Code Logic Review — TASK_2026_865_2a1d

## Summary

| Metric | Value |
| --- | --- |
| Verdict | APPROVED |
| Score | 8/10 |
| Findings | 0 Blocking, 0 Serious, 0 Moderate, 0 Minor |

The native carry-over path is bounded and read-only from the RPC service through the Electron port to Codex history requests. The focused specs support an 8: sound logic with no confirmed defect. A 9 would require evidence of the planned live Electron check of newest-first ordering and available scoped diagnostics; a 5–6 would require a demonstrated behavior gap.

## Numbered findings

No confirmed Phase 2 findings. Reviewed the native path at `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts:244`, `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:102`, `apps/ptah-electron/src/di/codex-runtime-composition.ts:540`, and `libs/backend/codex-runtime/src/lib/codex-session-history.ts:314`.

## Checks 1-5

1. **Byte fixture and cutoff.** `codex-session-history.spec.ts:485-505` creates 1,500 approximately 60 KB turns, asserts total bytes exceed ten times 8 MiB, every page is below 16 MiB, and expects six turn pages, seven requests including `thread/read`, and 150 newest turns (1350–1499). `codex-session-history.ts:328-333,418-438` counts page data bytes and stops before the next request once 8 MiB is reached. The crossing page is retained, giving at most 8 MiB plus one page. The spec does not directly assert received bytes exceed 8 MiB, but its fixed fixture and six 25-turn pages establish the crossing.

2. **Read-only and cleanup.** `codex-session-history.ts:320-321,344-348,364-368` requests only `thread/read`, `thread/turns/list`, and `thread/items/list`. `codex-runtime.ts:243-265` closes the process in `finally`. `codex-runtime.spec.ts:741-793` checks absence of resume, turn, and compact requests and closure after success, rejection, bound failure, abort, and runtime close. Electron's timeout/abort race disposes the scope in `codex-runtime-composition.ts:621-670`; the scope closes its runtime at `:237-249`. The service only reads the old session through the router (`chat-carry-over.service.ts:253-270`).

3. **Turn/page bounds.** The caller supplies 200 turns, 8 turn pages, and 16 item pages (`chat-carry-over.service.ts:52-59,260-264`). The reader enforces item pages at `codex-session-history.ts:362-371`, turns at `:378-383`, and turn pages and bytes at `:418-438`. Its ascending fallback shares the page budget and refuses if it cannot reach the newest turns (`:395-412`). A cap yields a bounded partial newest tail or `pageLimitExceeded` if no complete turn fits; the service maps the latter to `HISTORY_UNREADABLE`.

4. **Eligibility and empty history.** `chat-carry-over.service.ts:369-405` admits native history only for stored `codex-app-server` plus `openai-codex`, refusing another native provider before probe or router call and refusing the unchanged active provider before probe. Electron independently checks runtime, session ID, and provider (`codex-runtime-composition.ts:553-558`). A missing port/method has a fixed error (`session-history-router.ts:149-169`). Empty projected text and read errors return `HISTORY_UNREADABLE` before start (`chat-carry-over.service.ts:253-271`); specs cover these cases at `chat-carry-over.service.spec.ts:400-412,917-938`.

5. **Projection and redaction.** `codex-carry-over-projector.ts:70-110` keeps user text and assistant prose, substitutes image/tool placeholders, and drops reasoning, audio, and unknown items; it never reads tool arguments, outputs, commands, or diffs. Its specs cover those fields at `codex-carry-over-projector.spec.ts:147-190,192-266`. The shared renderer redacts known secrets before sizing/truncation (`chat-carry-over-transcript.ts:53-77,92-101`), and the native route passes through it at `chat-carry-over.service.ts:266`.

## Evidence and limits

- Inspected `git show` for a9cda59db, bac9eb3c6, and 82254e3ac, the changed source/spec files, task context and requirements, plan, batch reports, decisions, and root `CLAUDE.md`. No task `code-style-review.md` exists. No skill-loading tool is listed; the Angular skill does not cover this backend review.
- Batch reports record scoped Jest passes: Batch 9, 189/189; Batch 10, agent-sdk 47/47 and Electron 42/42; Batch 11, rpc-handlers 81/81. I did not rerun tests. Scoped `ptah_get_diagnostics` for five core files returned **unavailable** after 45 seconds; this is not a passing typecheck.
- Five logic questions: **silent success:** read/projection errors and empty output refuse start; **unexpected user action:** a second provider switch is rechecked before start (`chat-carry-over.service.ts:273-281`); **wrong-answer input:** repeated cursors and mismatched items are rejected (`codex-session-history.ts:336-341,87-106`), while live descending order remains assumption A8; **dependency failure:** abort, timeout, malformed pages, missing port, and process errors map to fixed failures; **unstated requirement:** no additional Phase 2 gap was established.
- No live Electron read was run. Fake-process specs do not prove that a deployed Codex app-server honors descending order; the plan calls for this check at `implementation-plan.md:185-190`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Approve Phase 2 without a new finding | Approve / request revision | Bounded reads, refusal paths, cleanup, projection, and redaction have code and focused spec evidence above; no contrary behavior established. | Yes |
| Record descending order as a verification limit | Defect / plan assumption A8 | Reader requests `desc` at `codex-session-history.ts:344-348`; plan explicitly requires a live Electron check. | Yes |
| Retain optional `nativeBound` | Require / retain | User decision row 85; router refuses an absent bound at `session-history-router.ts:110`; production caller supplies it at `chat-carry-over.service.ts:260-264`. | Yes |
