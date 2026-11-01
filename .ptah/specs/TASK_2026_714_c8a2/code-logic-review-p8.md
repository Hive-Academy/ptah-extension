# Code Logic Review P8 (re-review) - TASK_2026_714_c8a2

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 6 |
| Failure modes found | 8 |

Scope read in full: `codex-read-only-command.ts`, `codex-chat-approval-sink.ts`, `codex-chat-turn-stream.ts`,
`codex-chat-user-questions.ts`, `codex-approval-bridge.ts` (handle/interact/response), `codex-app-server-process.ts`
(initialize path and notification buffering), `codex-runtime.ts` (open, onRequest follow-up, askAsyncUserInput, updateNextTurn),
`codex-execution-profile.ts` (fingerprint), adapter `open`/`resumeSession`/`buildSink`/`setSessionPermissionLevel`,
`native-session-controls.ts`, and the 8o-1/8o-2/8o-3 diffs. Static review only. I did not run any tests, so the
last 8o-3/8o-4 test-only fixes were judged from the production code they protect, not from a green run.

Verdict on the focus areas: the D20 read-only auto-accept is sound and fail-closed. The question-card lifecycle has a real
gap on turn end and Stop. Resume refusal is mechanically correct but its fingerprint is fragile and has never been exercised live.

## Five logic questions

1. How does this fail silently?
   - A Codex question card stays on screen after the turn ended or Stop was pressed. The user can still answer it, and the answer is dropped with only a backend warn (finding S1).
   - A question answer whose `turn/steer` is refused or arrives after the turn ended is logged only (`codex-runtime.ts` `deliverDenialFeedback`, `warnDenialFeedback('refused'|'failed')`). The card was answered, nothing reached the model (M1).
2. What user action produces unexpected behaviour?
   - Starting a chat with Autopilot on and resuming it after Autopilot changed (or after the enhanced prompt, output style or UI fence changed) gives "Start a new chat" (S2).
   - Toggling Autopilot on a live native thread: the runtime refuses any permission change (`codex-runtime.ts:889-893`), and `resumeSession` on an open thread only logs differing options (`codex-chat-adapter.ts:233-246`) (M2).
3. What input data produces a wrong answer rather than an error?
   - No wrong-accept found in the read-only classifier. A malformed or unrecognised command always falls back to the card.
   - A secret question (`isSecret`) is shown as a normal card with `options: []` (`codex-chat-user-questions.ts:46`). The secret answer travels the same persisted AskUserQuestion path as any answer (minor).
4. What happens when a dependency fails?
   - The initialize handshake has one 60 s budget, logs `elapsedMs`/`timeoutMs` at warn and closes the process (`codex-app-server-process.ts` fail path). That is correct and the failure is surfaced.
   - `realpath` failure in auto-accept fails closed to the card (`codex-chat-approval-sink.ts:146-151`).
   - Presentation throwing declines the request (`:197-203`). Correct.
5. What is missing that the requirements never mentioned?
   - A webview-visible cancellation for questions (the approval path has `cancelPrompt`, the question path has none).
   - A live check that real Windows Codex 0.165 command strings are classified at all (M3).

## Failure modes

### Stale question card after turn end or Stop
- Trigger: Codex asks through `request_user_input_async` and the turn ends (or the user presses Stop) before the user answers.
- Symptom: the card remains, answerable. The answer is discarded and the card disappears locally, so the user believes the model received it.
- Evidence: `codex-runtime.ts` `askAsyncUserInput` passes `turnController.signal`. `ask-user-question.service.ts:170-221` `onAbort` only clears the backend registry and resolves null, with no webview message. The frontend keeps the card because `timeoutAt` is 0 (`permission-handler.service.ts:142-147`). The only dismissal is `PERMISSION_SESSION_CLEANUP` from `SdkPermissionHandler.cleanupPendingPermissions` (`sdk-permission-handler.ts:1315-1360`), which is called only from Claude `session-control.service.ts` / `session-query-executor.service.ts`. Nothing under `codex-app-server` or `chat/codex-host` calls it. The sink's `endTurn` (`codex-chat-turn-stream.ts` finally block) dismisses approvals only. A late answer reaches `handleQuestionResponse` and logs "unknown request" (`ask-user-question.service.ts:271-277`).
- Current handling: approvals get `cancelPrompt`; questions do not.
- Recommendation: on abort of the question port, send a webview dismissal (reuse `cleanupPendingPermissions(sessionId)` scoped to the thread, or a dedicated cancel message) from the backend translation layer. Do not touch the frontend.

### Question answer delivered nowhere
- Trigger: the user answers while the turn is finishing, or `turn/steer` is rejected.
- Symptom: card closes as answered; the model never sees the answer.
- Evidence: `codex-runtime.ts` `askAsyncUserInput` `.then` branches and `deliverDenialFeedback` log `codex-user-input-undelivered` with no event emitted. Only edit follow-ups raise `codexFollowUpRejected` (`onRequest`, setImmediate block).
- Recommendation: emit the same single `codexFollowUpRejected` error (or a visible notice) when a user answer is refused.

### Resume refused by a volatile fingerprint
- Trigger: any difference in the identity inputs between thread creation and resume.
- Symptom: "Codex cannot resume this chat... Start a new chat" under the generic `CODEX_RUNTIME_FAILED` code.
- Evidence: the fingerprint hashes `permissionLevel`, `sandboxPolicy`, `approvalPolicy`, `systemPrompt`, `developerPrompt`, `outputStyle`, `instructionSources` (`codex-execution-profile.ts` identity, about 280-307). The host feeds `config.permissionLevel ?? 'ask'`, `config.systemPrompt`, `config.enhancedPromptsContent`, `config.outputStyleBody`, and `PTAH_UI_HINT_CODEX` only when the per-request `ptahUiFence` is true (`codex-chat-host-ports.ts:380-427`). The refusal is `codex-runtime.ts:106-110`.
- Current handling: refusal is intentional (D14a), but D14a was written for the pre-8m-1 threads, not for ordinary drift.
- Recommendation: include only inputs that the thread actually froze (approval policy, sandbox), compare those, and let prompt and level drift fall under the "options not applied to open thread" rule. At minimum give the refusal its own error code so the UI can explain it.

### Initialize and notification buffering
- Trigger: more than 64 notifications between the initialize response and `ready`.
- Symptom: process fails with "pre-ready notification buffer limit reached".
- Evidence: `codex-app-server-process.ts` (`MAX_BUFFERED_NOTIFICATIONS`, buffer branch). In practice the window is one tick, so this is theoretical.

## Blocking issues

None.

## Serious issues

### S1. Codex question card is never dismissed in the webview on turn end or Stop
- File: `libs/backend/codex-runtime/src/lib/codex-runtime.ts` (`askAsyncUserInput`), `libs/backend/agent-sdk/src/lib/permission/ask-user-question.service.ts:170-221`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts` (finally block).
- Scenario: model asks "which framework?", ends or is stopped; the card stays; the user picks an option.
- Impact: silent answer loss, and a UI that differs from Claude's flow. The 8o-3 review treated "card cancelled on terminal" as the design, but only the backend registry is cancelled.
- Fix: send a dismissal to `ptah.main` when the question signal aborts (scoped to the request id or session). Add a spec that asserts the webview message on turn end and Stop.

### S2. Thread resume fingerprint is fragile and was never exercised live
- File: `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts` (identity/fingerprint), `codex-runtime.ts:106-110`, `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:380-427`.
- Scenario: a chat is started in Auto-edit, the app restarts, the user reopens it with Autopilot off (or the enhanced prompt is regenerated, or the fence flag differs). The result is a permanent refusal.
- Impact: native chats lose resumability on ordinary changes. p8h row D14a is "NOT RUN", and listing/resume after restart was blocked by GAP-B, which 8o-1 fixed but nobody has resumed since. 8o-5 also changed `PTAH_UI_HINT_CODEX`, which invalidates every thread created before it (acceptable only because the runtime is dev-gated).
- Fix: see "Resume refused by a volatile fingerprint". Cover with a live resume in p8i.

## Moderate and minor issues

- M1. Refused or late question-answer steer is log-only (`codex-runtime.ts` `deliverDenialFeedback`).
- M2. Live permission-level change is refused by the runtime (`codex-runtime.ts:889-893`), so `config:autopilot-toggle` with a live native session throws (`config-rpc.handlers.ts:352`). On an open thread `resumeSession` logs `codex-active-resume-options-not-applied` and ignores the level (`codex-chat-adapter.ts:233-246`). The sink reads `getSession().settings.permissionLevel`, which is the level the thread was opened with, so enforcement and the approval policy stay consistent with each other but can differ from the chip. The direction auto-edit to Manual leaves the thread in Auto-edit. Verify the chip path in p8i.
- M3. The classifier accepts only a bare `powershell|pwsh -NoProfile [-NoLogo] -Command|-c "<body>"` on win32 (`codex-read-only-command.ts:17-24`) or an unwrapped body. A quoted full path to `powershell.exe`, or a call without `-NoProfile`, is rejected, so GAP-A may stay open on real Windows traffic. This is fail-closed and safe. All specs use synthetic strings, so confirm the real `details.command` shape live.
- M4. `seen` entries are not removed on the auto-accept path or the early-decline paths (`codex-chat-approval-sink.ts:106`, `:119`, `:125`). It grows by one string per auto-accepted read until dispose. Delete the key when `request()` returns on those paths.
- M5. The sink's edit follow-up is posted through `Promise.resolve().then(post)` (`codex-chat-approval-sink.ts`, `respond`), while the bridge-owned follow-up is deliberately deferred to `setImmediate` so the decline response is written first (`codex-runtime.ts` `onRequest`). Two mechanisms, and the sink's one has no ordering guarantee against the decline frame. Move the sink path to the same deferral or return `followUpMessage` through the bridge.
- M6. Pre-ready buffer overflow kills the process (see failure modes). Minor.
- Minor: auto-accept reads any in-folder file, including `.env` or `.git/config`, with no sensitive-name guard. This matches the D20 text and Claude Manual's behaviour, so it is a documentation note.
- Minor: `isSecret` questions go through the shared persisted card path.
- Minor: the account usage reader can now wait up to 60 s (8o-2) with no progress indication.

## Data flow

1. Codex `item/commandExecution/requestApproval` -> process `dispatchApproval` -> bridge `handle` (turn/thread correlation, dedupe): OK.
2. `codexPermissionPolicy` -> `present` -> `CodexChatApprovalSink.request`: OK.
3. Sink gate (`ask` + command + no network/env/amendments) -> `classifyReadOnlyCommand` (forbidden chars, tokenizer, allowlist, lexical containment) -> `realpath` of cwd and every path against the realpath of the thread cwd -> plain `'accept'` with the command names logged: OK. Fails closed on any error, abort or dispose. Never `acceptForSession`.
4. Otherwise `presentRequest` -> card -> `respond` (strict zod, session and context check, key match): OK. `seen` leak on the accept path (M4).
5. Bridge builds the response, records a rule only for a live `acceptForSession` with a target: OK.
6. Question path: translator `userInputAsync` -> runtime `askAsyncUserInput` -> `createCodexChatUserQuestions` -> AskUserQuestion service -> answer -> steer. Gap: abort does not reach the webview (S1), refused steer is log-only (M1).
7. Initialize: spawn -> 60 s `initialize` -> home check -> `initialized` -> replay of buffered notifications -> start log: OK. Timeout logs elapsed and budget at warn.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| D20 deny-by-default read-only allowlist, Manual chat only, one request at a time, no session grant | COMPLETE | M3 effectiveness unproven on real strings |
| Security review 8o-4 F1/F2 (thread cwd, symlinks), F3-F5 (globs, device names, non-ASCII) | COMPLETE | Verified in code. I did not run the specs |
| Question card lifecycle (turn end / Stop cancels) | PARTIAL | Backend cancels, webview card persists (S1) |
| Rejected follow-up raises one error | PARTIAL | Edit follow-up yes, question answer no (M1) |
| Session list/title (8o-1) | COMPLETE | Stored path repair is sound. Not re-verified live |
| D14a resume refusal | COMPLETE | Fragile fingerprint (S2) |
| Initialize 60 s for chat and usage | COMPLETE | Verified in process and usage service |
| No Codex special case in the frontend | COMPLETE | No frontend change needed for the reviewed items. S1 must be fixed in the backend |
| MCP never stripped | NOT CHECKED here | `codex-mcp-config.ts` was out of the files I read in depth |

Implicit requirements not addressed: webview cancel for questions; a distinct error code for a refused resume.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Symlink or junction inside cwd to outside | YES | realpath containment | TOCTOU between check and run, accepted |
| Command cwd outside the thread cwd | YES | lexical and real check | none |
| Abort/dispose during realpath | YES | signal and `disposed` checks return decline | none |
| Duplicate request id | YES | `seen` | leak on accept path (M4) |
| Non-ASCII, `$`, `;`, redirection, globs, device names | YES | rejected before tokenizing | none |
| Stop with pending approval | YES | `endTurn` -> cancelPrompt + dismiss | none |
| Stop with pending question | NO | backend only | S1 |
| Initialize slower than 15 s | YES | 60 s budget | each new chat pays about 15 s startup |
| Resume after Autopilot/prompt change | NO | refused | S2 |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (static review; no test run, no live run)
- Top risk: a Codex question card that outlives its turn and swallows the user's answer.
- What a robust implementation would add: a webview cancel for questions on abort, a visible error for an undelivered answer, a narrower resume identity with its own error code, a live resume test after restart, `seen` cleanup on the accept path, and a live capture of the real Windows `details.command` shape to prove the allowlist fires.
