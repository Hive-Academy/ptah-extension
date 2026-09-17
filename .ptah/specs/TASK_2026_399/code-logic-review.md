# Code Logic Review — TASK_2026_399 (with the TASK_2026_397 backend change)

Review of the production diff on `fix/followup-delivery`:

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts`

Read-only review. No code was edited.

## Verdict

**APPROVE WITH NITS** — Both changes are behaviourally correct and the resume fallback is complete; the only nit is that the backend deleted the canned-string fallback unconditionally rather than only for non-empty `task`, which the TASK_2026_397 sketch asked for — but every live caller validates `task` non-empty at a Zod boundary, so the empty-task case is unreachable today.

## State table

`visible = supportsContinuation === true || !!cliSessionId`
`resumesInstead = !!cliSessionId && (continuationExpired === true || supportsContinuation !== true)`

`SC` = `supportsContinuation`, `SID` = `cliSessionId`, `CE` = `continuationExpired`.

| SC | SID | CE | visible | resumesInstead | What the user sees / which send path runs |
|----|-----|----|---------|----------------|-------------------------------------------|
| true | present | false | true | false | Box shows "Send a follow-up". `deliver` → `continueAgent` (in-process continue). Working path. |
| true | present | true | true | true | Box shows "Send a follow-up — resumes the session". `deliver` skips the doomed continue call → `sendByResuming`. Working path. |
| true | absent | false | true | false | Box shows "Send a follow-up". `deliver` → `continueAgent`. Working path while the record is alive. |
| true | absent | true | true | false | Box shows "Send a follow-up". `resumesInstead` is false (no `cliSessionId`), so `deliver` → `continueAgent`, which returns `not_found`/`released` → `sendByResuming` → guard at `agent-continue-input.component.ts:272` fails → "Agent expired and has no session to resume." Honest dead end; the message restores the draft. **Not a lie**: the box opened for a real continue path that then expired. Same as the old gate (old gate also showed it for `SC === true`). No regression. |
| false/undefined | present | false | true | true | Box shows "Send a follow-up — resumes the session". `deliver` → `sendByResuming` directly. Working path (antigravity / opencode / copilot-without-captured-id / pi-without-captured-id). **This is the case the change exists to fix.** |
| false/undefined | present | true | true | true | Same as above. `continuationExpired` is already true; `sendByResuming` runs. Working path. |
| false/undefined | absent | false | false | false | No box. Correct — no continuation, no session. |
| false/undefined | absent | true | false | false | No box. Correct — no continuation, no session. |

**No combination makes the box appear with NO send path that can succeed.** The only dead-end combination (`true, absent, true`) is honest, restores the draft, and is not introduced by the widening — the old gate showed that box too.

## Error code table

`AgentContinueErrorCode` = `'not_found' | 'unsupported' | 'busy' | 'released' | 'unknown'` (`agent-process-manager.service.ts:92-104`).

| code | thrown at | component behaviour (`deliver`) | correct? |
|------|-----------|----------------------------------|----------|
| `busy` | `agent-process-manager.service.ts:1070` | re-queue via `enqueue` (`:223-226`); flush effect retries at the real turn end | yes — the card's status lagged the backend; erroring would drop the typed message |
| `not_found` | `agent-process-manager.service.ts:1029` | `sendByResuming` (`:228-231`) | yes — record aged out / host restarted; conversation is on disk |
| `released` | `agent-process-manager.service.ts:1039` (restored record) and `:1061` (idle release) | `sendByResuming` (`:228-231`) | yes — process gone, conversation on disk |
| `unsupported` | `agent-process-manager.service.ts:1050` | `sendByResuming` (`:228-231`, **new**) | yes — adapter has no in-process continuation; conversation is resumable via `cliSessionId`. `sendByResuming` guards on `cliSessionId` (`:272`): present → resume; absent → "Agent expired and has no session to resume." + draft restored. Honest in both sub-cases. |
| `unknown` | `agent-rpc.handlers.ts:743` (non-`AgentContinueError` catch-all) | generic "Could not send the follow-up. Try again." + `restoreUndelivered` (`:240-243`) | yes — an unexpected internal error is not evidence a resume would work; resuming on `unknown` would spawn a fresh session for a transient failure. Generic error with draft restored is right. |

No code lands in the generic "Could not send the follow-up" branch when a resume would have worked. The three resume-eligible codes (`not_found`, `released`, `unsupported`) are all in the fallback list at `:227-231`.

## Findings

1. **NIT — backend: the canned-string fallback was deleted unconditionally, not "only for empty `task`".**
   - File: `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:684`.
   - The TASK_2026_397 `task.md` acceptance sketch (`:60-63`) asked: "A ptah-cli resume carrying a non-empty task sends that task... A ptah-cli resume carrying an empty task keeps today's behavior." The implementation removed the `isResume ? canned : task` branch entirely and passes `task` straight through. A resume with an empty `task` now hands `createPromptMailbox('')` an empty first user message (`ptah-cli-prompt-mailbox.ts:24`) instead of the canned string.
   - Failure scenario: a caller that bypasses boundary validation and calls `spawnAgent(id, '', { resumeSessionId })` would send an empty user turn to the SDK, where the old code sent a usable "continue" prompt.
   - Why it is a nit and not a blocker: both live callers validate `task` non-empty at a Zod boundary, so the empty-task case is unreachable today. `agent-rpc.handlers.ts:873` is guarded by `AgentResumeCliSessionParamsSchema` (`agent-rpc.schema.ts:68-70`, `z.string().min(1)`). `agent-namespace.builder.ts:152` is guarded by the MCP dispatcher (`agent-tool.dispatcher.ts:48`, `z.string().min(1)`). The frontend `submit()` also short-circuits on `message.length === 0` (`:166-167`). The acceptance sketch was a sketch, not a contract, and "reject empty task at the boundary" is a defensible alternative to "substitute a canned string." Flagging only so the deviation from the stated acceptance is on the record.

None of the findings is a blocker.

## Answers

### Q1 — Is the widened `visible` correct at its edges?

Yes. See the state table. The widening adds only the `(!SC, SID present, *)` rows, and every one of them has a working `sendByResuming` path. The one dead-end combination (`SC true, SID absent, CE true`) shows the box and then fails with an honest "Agent expired and has no session to resume" while restoring the draft — and that combination was already visible under the old `SC === true` gate, so the widening does not introduce it. There is no combination where the box appears and every send path fails silently or with a misleading message. `deliver()` routes `resumesInstead` cards straight to `sendByResuming` (`:211-214`); non-`resumesInstead` cards try `continueAgent` first and fall back to `sendByResuming` on `not_found`/`released`/`unsupported` (`:227-231`). The `cliSessionId` guard at the top of `sendByResuming` (`:272-276`) is the honest backstop for the no-session case.

### Q2 — Is `resumesInstead` right?

Yes. `!== true` (not `=== false`) is intended and is the better choice.

- For an agent that supports continuation but has no `cliSessionId`: `resumesInstead = !!undefined && (...) = false`. It goes through `continueAgent` — correct, the in-process handle is alive. Falls back to `sendByResuming` only if the record is gone, and the guard then says "no session to resume" honestly.
- For an agent where `continuationExpired === true` but `supportsContinuation === true` (and `cliSessionId` present): `resumesInstead = present && (true || false) = true`. It skips the doomed `continueAgent` call and resumes directly — correct, matches the "skips the doomed continue call once the card is known expired" test (`agent-continue-input.component.spec.ts:214-224`).
- `!== true` catches `undefined` (antigravity / opencode, which never declare `supportsContinuation`) and routes them straight to resume without a wasted `continueAgent` round trip that would only return `unsupported`. `=== false` would have left `undefined`-support agents falling through to `continueAgent`, getting `unsupported`, then falling back — it would still work, but via an extra round trip. `!== true` is the right widening and matches the comment at `:129-134`.

### Q3 — Does the backend change break a non-resume caller?

No. Both production callers of `PtahCliRegistry.spawnAgent` were checked:

- `agent-rpc.handlers.ts:873` (`resumePtahCliSession`) passes `params.task`. The Zod schema requires `task` non-empty (`agent-rpc.schema.ts:68-70`), so the canned string was only ever sent in place of a non-empty user value — which was the defect. Nothing downstream relied on the canned string: `createPromptMailbox(task)` (`ptah-cli-registry.ts:684`) just queues `task` as the first `SDKUserMessage` (`ptah-cli-prompt-mailbox.ts:24`); the SDK `query` consumes the generator at `:701`, and the resume id travels independently via the `resume: options.resumeSessionId` option at `:742`. Nothing inspects the prompt's content or assumes a fixed shape. The `continue()` handle (`:818-826`) pushes later turns through `mailbox.push`; it never read the initial prompt either.
- `agent-namespace.builder.ts:152` passes `request.task`. For a non-resume spawn (no `resumeSessionId`), the old code already passed `task` straight through (`isResume === false`), so behaviour is unchanged. For a resume, the old canned string is gone and the user's `task` flows through — which is the fix. The MCP dispatcher validates `task` non-empty (`agent-tool.dispatcher.ts:48`).
- `ptah-api-builder.service.ts:251` is the `PtahCliRegistryLike` interface declaration, not a caller.

No non-resume caller relied on the canned string, and nothing downstream of `createPromptMailbox` assumed a resume prompt had a fixed shape.

### Q4 — The interlock: is the fallback now complete?

Yes. See the error code table. Widening `visible` makes `unsupported` reachable in two ways: (a) the card's `supportsContinuation` disagrees with the live handle (stale card), or (b) a resume-only card whose `resumesInstead` was false for some transient reason. Both now route to `sendByResuming` via `:228-231`. All five `AgentContinueErrorCode` values are handled: `busy` re-queues, `not_found`/`released`/`unsupported` resume, `unknown` surfaces a generic error with the draft restored. No code that a resume would have recovered lands in the generic "Could not send the follow-up" branch.

### Q5 — Anything else?

- Stale comments: the `resumesInstead` docblock was rewritten to match the new condition (`:129-134`); the `deliver` branch comment now documents `unsupported` (`:227-238`). No stale comment found.
- `catch (error: unknown)` at `:244` narrows with `error instanceof Error` before reading `.message` (`:247`). Correct per the repo standard.
- OnPush / signals: `visible`, `resumesInstead`, `subtitle`, `sendDisabled`, `disabled` are all `computed` off `input.required`/signals; `submitting`/`error`/`queued`/`draft` are `signal`. `ChangeDetectionStrategy.OnPush` is set (`:21`). No `BehaviorSubject`, no `[innerHTML]`. Correct.
- No `CLAUDE.md` claim in `cli-agent-runtime/CLAUDE.md`, `chat/CLAUDE.md`, or `chat-streaming/CLAUDE.md` references the canned resume string or the old `visible` gate, so none is contradicted.
- The false "does not support session resume" warning at `agent-process-manager.service.ts:461` is out of scope per the review rules (TASK_2026_398).