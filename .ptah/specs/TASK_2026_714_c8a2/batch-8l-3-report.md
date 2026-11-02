# Batch 8l-3 report — follow-up native turns keep the live thread (8k-5 finding 3)

Written 2026-10-28 by the team-leader (session 20). W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`.

## Result

COMPLETE, commit `e448b5517` (`fix(agent-sdk,rpc-handlers): keep the live Codex thread across turns`).

## Verdict: the defect was REAL (two layers)

1. Adapter teardown. Every native turn streamed under the session id (follow-up `publish`, resume,
   native `/compact`) reached the broadcaster's exit teardown: `getSessionToken(sessionId)`
   returned the live token (`chat-stream-broadcaster.service.ts:155`) and
   `CodexChatAdapter.endSessionIfTokenMatches` closed the App Server context (`:412-416`). Only
   the first turn of a new session (streamed under the tab id, token `null`) escaped it.
   Pin: `codex-chat-native-contract.spec.ts` "Native Codex chat sessions across turns", real
   `ChatStreamBroadcaster` + real `CodexChatAdapter` + real host ports. Before the fix 3 failed /
   3 passed (`isSessionActive(THREAD)` false after the follow-up and after a resumed turn;
   "still closes the thread when the session is ended explicitly" failed with `unavailable`
   because the follow-up had already closed it). After: 6/6.
2. chat:continue liveness. Found while pinning layer 1: `ChatSessionService.hasLiveSessionStream`
   (`chat-session.service.ts` ~:1583) requires an attached broadcaster loop. A Codex turn is its own
   stream, so between turns an idle native thread looked like a dead record:
   `autoResumeIfInactive` called `interruptSession` (closing the context) and cold-resumed on every
   UI follow-up (the risk recorded at batches.md 8h "RISK (recorded, not in this round)").
   Pin: `chat-session.native.spec.ts` "chat:continue after a completed native turn": before the
   fix 1 failed / 2 passed; after, all pass.

## Fix (Codex side; Claude behavior unchanged; broadcaster and frontend untouched)

- `agent-sdk/.../codex-chat-adapter.ts`: `endSessionIfTokenMatches` returns `false` and never
  closes the native thread. The turn stream already owns mid-turn detachment
  (`drainInterruptedTurn`: interrupt, then close if no terminal); `interruptSession`, `endSession`,
  `reset` and `dispose` close explicitly. `getSessionToken` unchanged (native-session-controls
  uses it). With `false` and an unchanged token the broadcaster clears turn state, exactly as it
  already does after the first turn, so the UI contract is identical.
- `agent-sdk/.../session-runtime-router.ts`: `acceptsFollowUpWithoutStream(sessionId)` = native
  identity AND `native.canSendFollowUp` (idle, unblocked, not closing); legacy/unknown -> false
  without asking native controls.
- `rpc-handlers/.../chat-session.service.ts`: optional trailing injection of
  `SDK_TOKENS.SESSION_RUNTIME_ROUTER` (local one-method interface; same pattern as
  chat-slash-command-router.service.ts:191); `hasLiveSessionStream` = registered AND (streaming by
  session id OR by tab id OR router answers exactly `true`). Hosts without native controls resolve
  the router to null and keep today's behavior. A session started in this run resolves as native
  (Electron `codex-runtime-composition.ts:504-513` updates the identity lookup on save).

Specs: follow-up and third turn produce exactly the first turn's event sequence (`turn_state`,
`message_start`, `text_delta`, `message_delta`, `message_complete`, `chat:complete`,
`turn_state`), one runtime open, no `context.close`; cold resume stays open after its turn;
adapter: token match after a completed turn -> `false`, session stays, third turn runs,
`endSession` still closes; mid-turn detach still interrupts and closes through the turn stream;
router unit specs; chat:continue on an idle native thread -> `sendMessageToSession`, no interrupt
or resume; blocked thread -> today's dead-record path; turn in flight -> router not asked.

## Executor

In-process `backend-developer` subagents (Claude), same reason as 8l-1c. A third subagent
condensed the new JSDoc. `git status` after each: only declared files. The subagents ran single
jest specs through `node scripts/verify.mjs --exec` (allowed by their brief) to prove fail/pass.

## Verify

`npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron`:
`NX 15 tasks: 14 succeeded, 1 failed` (twice; second run after the JSDoc trim). The one failure is
agent-sdk:lint with ONLY the known pre-existing errors
`session-query-executor.accounts.spec.ts:174,183` (not fixed, per the task rule). The
`codex-chat-adapter.ts` max-lines warning (704 > 700) is pre-existing: max-lines skips comments
and this batch removed 3 code lines from the file. All test and typecheck targets passed.

## Risks and follow-ups (for the P8 re-review / live test p8f scenario a2)

- The router throws a routing error on a corrupt identity binding; `hasLiveSessionStream` now
  reaches the router when no stream is attached, so such an error would surface there (also for
  a Claude session with a corrupt binding). Not reachable with Electron's lookup today; no
  swallow added (degradation-audit).
- Possible turn-state race: if a new turn starts before the previous broadcaster loop's `finally`
  runs, its `forceIdle`/`clear` could hit the new turn's state. Same as the first-turn path today;
  broadcaster unchanged.
- The broadcaster logs "was already ended before stream exit" after each native turn (log text
  only).
- A busy native session with no attached stream would still take interrupt-and-resume (not
  expected: a busy turn always has its stream attached).
