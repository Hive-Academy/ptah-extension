# Code Logic Review — TASK_2026_714_c8a2, Batch 8p-4

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 2 |

Scope read: the diffs of codex-chat-adapter.ts (+spec), session-runtime-router.ts, agent-sdk index.ts, chat-session.service.ts, and the two rpc-handlers specs. I also read codex-runtime.ts:40-60 and codex-resume-profile-error.ts. No tests or builds were run (per brief).

## Five logic questions

1. Silent failure: none new. The refusal text and code now come from one exported constant (CODEX_RESUME_PROFILE_CHANGED_MESSAGE) and one guard, so the string can no longer drift between producer and mapper.
2. Unexpected user action: a chat:continue with empty prompt and no attachments on a non-live Codex thread now resumes with an empty turn and reports promptDelivered=true (chat-session.service.ts:1946-1949). Before, it fell through to sendMessageToSession, which also sent an empty turn. Behaviour is equivalent. See M1.
3. Wrong-answer input: attachment-only follow-up, the old `prompt.length > 0` bug (M1 of the 8p-2 review), is fixed. `prompt: ''` plus files/images gives exactly one turn, and `promptDelivered` no longer depends on the prompt string.
4. Dependency failure: CodexRuntime.open throws CodexResumeProfileChangedError directly (codex-runtime.ts:54-57, no wrapping). It lands in the adapter's open() catch (codex-chat-adapter.ts:~298), where `this.failure(error, 'open')` (:793) tests it with the instanceof guard. It then builds CodexChatAdapterError('resume-profile-changed', 'open', { cause: error }). The service's codexFailure (chat-session.service.ts:626-629) then matches on `adapterError.code`, or on `isCodexResumeProfileChangedError(cause)`. The `cause` is preserved, and the user text is the exported constant with errorCode CODEX_RUNTIME_FAILED. The safe() wrapper cannot double-wrap, because a CodexChatAdapterError passes through failure() unchanged.
5. Missing: see M2 (guard identity relies on a single module instance).

## Check results

1. Resume-profile mapping: PASS. No `error.name`, `'code' in error` or string matching remains. A grep for ResumeProfileChanged and resume-profile-changed shows only the typed guard, the literal code union (adapter:52), and the code comparison on a typed adapter error (service:628). The adapter spec "maps the typed resume profile error" asserts both `code` and `cause`. The native spec asserts that the exact constant text comes through when the typed error is the cause.
2. StreamlessFollowUpAdmission: PASS. The router declares `implements SessionRuntimeControls, StreamlessFollowUpAdmission` and has acceptsFollowUpWithoutStream at router:90. The interface is exported from agent-sdk index.ts:168 and imported as a type in the service. The service's only use is the optional `?.` call at :1724, so DI injection is unchanged. The structural type is identical to the old local interface.
3. promptDelivered: PASS. The new `options.deliversFollowUp` defaults to false. Only chat:continue passes true (:1213). The chat:resume activate call (:1422), the rewind-style call (:1681) and any other caller keep false, so they behave as before. Claude resume is gated on `execution.runtime === 'codex-app-server'`. The new spec "resumes an attachment-only Codex follow-up as exactly one turn" asserts resumeSession is called once and sendMessageToSession is never called.
4. Open-thread branch attachments: PASS. The mapping at adapter:247-250 is character-for-character the same as sendMessageToSession (:564-573): files become `{type:'file', path}`, and images become `{type:'image', ...image}`. The order is the same (files, then images). checkOptions at :235 still runs first. The spec asserts the exact attachments on startTurn.
5. Spec quality: adequate. The assertions are specific (toMatchObject on code and cause, toBe on the text, exact attachment arrays), and the adapter spec disposes the adapter. The gaps are in M2 and M3.

## Failure modes

### Duplicate module instance defeats the guard

- Trigger: a bundle or test setup that loads two copies of @ptah-extension/codex-runtime (for example Electron webpack externals versus a bundled copy).
- Symptom: `instanceof` fails, the failure becomes 'runtime-failed' and the user sees the generic "could not complete" text instead of the profile-changed message.
- Evidence: codex-resume-profile-error.ts:14-18 uses only `instanceof`. The previous code had a name+code duck check, which was tolerant of this.
- Current handling: none. All production paths share one workspace package, so it is not observed today.
- Recommendation: acceptable per D23. Optionally keep instanceof and add a `Symbol.for` brand if the host bundling ever splits the package.

### Empty-turn resume on activate

- Trigger: chat:resume with activate=true on a Codex thread.
- Symptom: the native resume runs with prompt '' and starts a turn, per the comment at :1946. This behaviour was not changed by this batch (deliversFollowUp is false, so the follow-up flag is not claimed).
- Evidence: chat-session.service.ts:1422 and :1946.
- Recommendation: out of scope. Confirm in the 8p live test that an activate does not produce a visible empty turn.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- M1 (moderate): the `options` parameter is a positional argument after the defaulted `mcpRegisteredForSubagents = true`. The chat:continue call must therefore pass the mcp flag explicitly, which it does (:1211-1213). A future caller can silently get `deliversFollowUp: false` and double-send on a Codex thread. Consider doc-commenting the parameter or making `deliversFollowUp` required for the Codex case (chat-session.service.ts:1754).
- M2 (moderate): codexFailure checks both `adapterError.code === 'resume-profile-changed'` and the cause (:628-629). The second branch is redundant when the adapter always sets the code. It is harmless, and the new native spec exercises it with a 'runtime-failed' wrapper. If it is kept as defence, add a comment saying why.
- M3 (minor): there is no spec that chat:continue with a non-Codex (Claude) resume leaves promptDelivered false. The existing "(b) keeps the Claude resume" test covers send-once, which is sufficient.
- agent-sdk index.ts:168: the export line is long, which is a formatting matter for the style review.

## Data flow

1. chat:continue → autoResumeIfInactive(..., {deliversFollowUp:true}) → OK.
2. Codex config gets files/images from params → sdkAdapter.resumeSession → (open thread) turn with attachments, or (cold) open() with the profile's attachments → OK.
3. Profile mismatch → CodexResumeProfileChangedError → failure() → CodexChatAdapterError(cause) → codexFailure → RpcUserError text + CODEX_RUNTIME_FAILED → OK.
4. promptDelivered = deliversFollowUp && runtime is codex-app-server → continue returns before the second send → OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Typed guard, no string matching (code-style S1) | COMPLETE | none |
| 8p-2 M1: attachment-only follow-up is exactly one turn | COMPLETE | none |
| 8p-2 M2: open-thread resume forwards attachments | COMPLETE | none |
| Shared export for StreamlessFollowUpAdmission (style M3) | COMPLETE | none |

Implicit requirements not addressed: duplicate-package-instance tolerance (see Failure modes).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Attachment-only follow-up on a cold thread | YES | resume turn with prompt '' plus attachments | none |
| Attachment-only follow-up on an open thread | YES | adapter.turn with mapped attachments | none |
| Claude resume | YES | runtime gate | none |
| Activate / rewind | YES | flag false | pre-existing empty turn on activate |
| Profile mismatch | YES | typed guard | instanceof only |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH (static trace only; no tests run)
- Top risk: a positional `deliversFollowUp` option that a future caller can omit (M1).
- What a robust implementation would add: a required or named flag for the follow-up delivery, plus a comment on why the redundant cause check stays.
