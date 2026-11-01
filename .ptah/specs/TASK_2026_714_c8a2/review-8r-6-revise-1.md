# Review 8r-6 revise 1

Verdict: APPROVE

Score: 9/10

Review family: Kimi (implementer: codex; prior reviewer: grok)

## Defects

None.

## Prior defects

1. **Running resume reply: fixed.** `chat-session.service.ts:1254-1260` returns
   `{ success: true, sessionId }` while the resumed turn streams. It returns
   `settled: true` after stream teardown. The renderer retires the pending prompt when
   `enqueued` is absent (`message-sender.service.ts:877-882`). The updated assertion at
   `chat-continue-codex-resume-once.spec.ts:462-488` checks the plain success payload.

2. **Refused `turn/start`: fixed.** The chat stream publishes one failure notice and one
   failed turn state. It then calls `admission.ended()` at
   `codex-chat-turn-stream.ts:393-398`. `publishUntilAdmitted` waits for publisher teardown
   before it resolves this path (`codex-chat-admission.ts:31-36,46-53`). The service then
   observes no attached stream and returns `settled: true`
   (`chat-session.service.ts:1301-1309`). The renderer keeps the user bubble, marks the tab
   idle, and adds no delivery-failure bubble (`message-sender.service.ts:867-875`). The
   broadcaster suppresses the second `chat:error` for `webviewReported`
   (`chat-stream-broadcaster.service.ts:372-383`).

## Timing and regression checks

- **G9 remains fixed.** `accepted()` resolves immediately after the `turn/start` receipt
  (`codex-chat-turn-stream.ts:154-160`). Only the pre-admission `ended` path waits for the
  publisher. An admitted running turn never takes that path.
- **Post-admission kill:** the RPC has already returned `enqueued: true`, or it returns
  `settled: true` if teardown wins the reply race. The existing notice and terminal state
  remain the only user-visible failure outcome. No re-arm occurs after a settled reply.
- **Fast completion:** the post-send streaming checks retain the `settled: true` result.
- **Live follow-up:** the broadcaster attaches its streaming id before the first iterator
  pull (`chat-stream-broadcaster.service.ts:153,206-207`). Admission occurs during that
  pull. The live reply therefore remains `enqueued: true`.
- **Claude:** no Claude code changed. The native follow-up and settled checks retain their
  Codex routing conditions (`chat-session.service.ts:1290-1309`).
- **Pre-admission errors:** option validation still throws before publication
  (`codex-chat-adapter.ts:552-563`). Busy, unavailable, and closing-session checks still
  throw before stream execution (`codex-chat-adapter.ts:529-537`). Account refusal handling
  is unchanged. Non-chat and interrupted pre-admission failures still reject at
  `codex-chat-turn-stream.ts:395-398`.
- **Promise cleanup:** the background publisher has fulfillment and rejection handlers
  (`codex-chat-admission.ts:44-68`). Late failures use the injected logger. `publish` calls
  `iterator.return()` in `finally` on every path with an iterator
  (`codex-chat-adapter.ts:484-502`). Abort and session-close paths reject before admission
  or use the observed background publisher after admission. No unhandled rejection or
  leaked admission promise is evident.
- **Other callers:** approval replacement still awaits the full `publish`
  (`codex-chat-adapter.ts:465-471`). Open, resume, slash, and gateway stream consumption
  did not change. CLI and peer send callers use acceptance semantics and do not consume a
  turn result. Codex option validation still rejects unsupported lane-report origins.

## Spec review

- The live real-adapter race fails on the old whole-turn await because the sentinel wins
  before release (`chat-continue-codex-resume-once.spec.ts:312-327`).
- The refused-turn spec fails on the prior revision because that revision returns
  `CODEX_RUNTIME_FAILED` instead of the expected settled result
  (`chat-continue-codex-resume-once.spec.ts:329-350`).
- The running-resume spec fails on the prior `enqueued: true` payload
  (`chat-continue-codex-resume-once.spec.ts:462-488`).
- New deferred resolvers have explicit function types. `reflect-metadata` remains the
  first import. The changed specs contain no explicit `any`, `as unknown as`, `ts-ignore`,
  readonly mock assignment, or private bracket access.
- New races release their gates and await their sentinel ticks in `finally`. No new pending
  timer remains at test end.
- Minor coverage note: the fast-settled service specs still use a mocked send. The real
  adapter specs cover live admission and refusal. Static inspection confirms the fast
  settled branch, but no real-adapter fast-completion race spec was added.

## Verification limit

This was a read-only review. No tests, lint, typecheck, builds, Nx commands, or diagnostics
were run. The verdict uses source traces and diff inspection only.
