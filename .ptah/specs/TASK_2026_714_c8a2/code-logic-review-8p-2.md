# Code Logic Review - TASK_2026_714_c8a2 batch 8p-2 (GAP-I, S1)

## Summary

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 3 |

Scope read: the diffs of agent-adapter.types.ts, the GAP-I hunks of chat-session.service.ts, codex-chat-user-questions.ts, and all three spec files (partly; the harness body was elided in my view), plus codex-chat-adapter.ts (resumeSession/open/turn), codex-chat-host-ports.ts (attachments), sdk-permission-handler.ts cleanupPendingPermissions, ask-user-question.service.ts. I ran no tests or builds, as instructed.

## 1. GAP-I

Delivery once, with attachments (OK).
- Inactive Codex session: `autoResumeIfInactive` spreads `files`/`images` into the resume config only on the non-Claude branch (chat-session.service.ts ~1923-1927). The adapter's `open()` takes attachments from `prepareProfile`, whose host port maps `config.files`/`config.images` into `profile.attachments` (codex-chat-host-ports.ts:357, 399-410), and `open()` passes them into `turn()` (codex-chat-adapter.ts:286-289). So the turn runs once with the prompt and attachments. `continueSession` then returns early (~1248) and skips `sendMessageToSession`.
- Claude path: the Claude spread branch is untouched (`model`, `providerProfile`, account keys). Spec (b) asserts no `files`/`images` keys and exactly one `sendMessageToSession`. `promptDelivered` is false for `claude-sdk`, so the flow is unchanged.
- Callers: `chat:resume` activate (prompt `''`, no files) and `ensureSessionActiveForRewind` (prompt `''`) ignore `promptDelivered`, and `files`/`images` are undefined there, so the config is unchanged. `{ justResumed:true, promptDelivered:false }` for those is still `justResumed:true`. OK.

What the early return skips for Codex:
- Subagent injection still RUNS (it is called before the early return) and its result is discarded. Side effects in the injector (`markAsInjected`, `remove` after max attempts, injection-attempt bumps) fire for a prompt that is never sent. Subagent records are Claude-only, so the Codex registry is normally empty. Minor (see M3).
- Stop-intent: it was already gated by `!justResumed`, so nothing is lost.
- Slash router: still runs after the resume, in the same order. Slash prompts bypass the resume altogether. OK.

Findings:

### M1 (Moderate). `prompt.length > 0` is the wrong signal for "the turn was started"
chat-session.service.ts ~1947. The adapter starts a turn on resume for ANY `config.prompt ?? ''` (codex-chat-adapter.ts:245/286, with no empty-text guard in `turn()`).
- Attachment-only follow-up: `prompt === ''` with files/images. Resume already runs a turn carrying the attachments, but `promptDelivered` is false. `continueSession` then calls `sendMessageToSession('', ...)`, a second turn with the same attachments, which hits `busy` or double-delivers. The "exactly once" guarantee is broken for this input.
- `chat:resume` activate (prompt `''`) also starts an empty Codex turn on resume. That is pre-existing, but it is the same root cause.
- Whitespace-only prompts are consistent (length > 0 gives true, and the adapter runs a turn).
- Fix: derive delivery from the caller's intent rather than the prompt text. Add an explicit `deliverPrompt`/`startsTurn` parameter to `autoResumeIfInactive`, true only from `continueSession`, and set `promptDelivered = codex && deliverPrompt`. For `chat:resume` activate, pass an empty-prompt guard in the adapter instead. Alternatively, if empty continue prompts are rejected upstream, say so and add a spec for it.

### M2 (Moderate). `resumeSession`'s open-thread branch drops attachments
codex-chat-adapter.ts:245 uses `{ text: config.prompt ?? '' }` with no attachments. `autoResumeIfInactive` now sets `promptDelivered=true` for that branch too. It is reachable when `hasLiveSessionStream` is false but the adapter's `sessions.has(id)` is true: a blocked thread (awaiting approval or a question, so the router's `acceptsFollowUpWithoutStream` is false) or one that is closing. `turn()` throws busy/unavailable for blocked/closing/busy sessions, so a failure surfaces through `codexFailure` rather than silently. The window is therefore narrow, but any path that wins (a race between the liveness check and the adapter state) loses files/images and then skips the compensating send. Fix: pass `attachments` (mapped from `config.files`/`config.images`, as the host port does) in the open-thread branch, or make `promptDelivered` false there. Add a spec for it.

Race (live check inactive but Codex open): see M2. The reverse (live check true) takes the normal `sendMessageToSession` path, which is unchanged.

## 2. S1

- Id match (OK). `createCallback(sessionId, undefined, tabId)` makes `AskUserQuestionService` set `sessionId` and `tabId` on the request (ask-user-question.service.ts:62-72). `cleanupPendingPermissions(sessionId)` sends `PERMISSION_SESSION_CLEANUP { sessionId }`, and the frontend handler (chat-message-handler.service.ts:205) matches the session. It uses the same `sessionId` as the question.
- Once, not skipped, not doubled (OK). `await ask(...)` resolves only after the service's abort handler returns null/deny. The cleanup call is after the await and in one branch, so it happens at most once per request. The pre-aborted case (the service's `signal.aborted` early return) also resolves, so the cleanup still fires (invalid-request spec covers the non-fire case).
- Side effects (Minor, M4). `cleanupPendingPermissions(sessionId)` denies ALL pending requests for that session or tab (`pending.sessionId === sessionId`), calls `askUserQuestion.cleanupBySession`, and the frontend clears every permission/question card for the session. Codex approval cards go through `broadcastMessage(PERMISSION_REQUEST)` (codex-chat-host-ports.ts:458) rather than `pendingRequests`, so only the frontend side is affected. The abort fires at turn end or interrupt, where the sink's `endTurn` already cancels approval cards, and no next-turn card exists yet. A new turn that starts and shows an approval card before the asynchronous cleanup message is processed would have its card wiped while the sink still waits. That is a very small window; I did not find a way to trigger it in normal use. Accept, but note it.
- A card the user answered at the same moment as the abort: `result.behavior === 'allow'` skips the cleanup. OK.
- A throwing cleanup is caught and logged with a fixed message, with no id/payload leakage. OK.

## 3. Spec quality

- chat-continue-codex-resume-once.spec.ts drives the real `ChatSessionService.continueSession` through `Object.create(prototype)` with plain-object collaborators. It exercises real branching: it asserts the resume config, the call order against the slash router, the absence of `files`/`images` keys on Claude, and the exact `sendMessageToSession` payloads. It is meaningful, not self-asserting. It lacks the empty-prompt/attachment-only case (M1) and the open-thread case (M2).
- codex-chat-user-questions.spec.ts uses the real `AskUserQuestionService`/registry, so abort, answer, invalid request, and throwing cleanup are genuinely exercised. The `called with SESSION` assertion pins the id. It does not test the late-abort/next-turn case (acceptable).
- codex-chat-native-contract.spec.ts only widens the port type with a `jest.fn()`. It is neutral.

## Minor

- M3. chat-session.service.ts ~1239-1252: reorder so the subagent injection runs only when a send follows (move the `promptDelivered` return above `injectInterruptedAgentsContext`). It avoids side effects on a discarded prompt. The slash router must stay before it.
- M5. agent-adapter.types.ts: the new `files`/`images` fields are documented as ignored by Claude. It would be safer to add a Claude-resume spec guarding that the Claude adapter never forwards them. Spec (b) covers the service side only.
- M6. The `AutoResumePreflight` additions are unused by the code that builds the config (the code reads `params.files` from the spread type). Harmless; remove the redundancy if the type is meant to be the single source.

## Verdict

APPROVED with two moderate follow-ups. The Claude path and the other callers are unchanged, the Codex path delivers prompt and attachments once for the common case, and S1 calls cleanup once with the correct id. Address M1 (an attachment-only follow-up still double-delivers) before relying on "exactly once" for all inputs.
