# Batch 10d.L4 revision 2 report

## Changes

- `codex-chat-adapter.ts`: require-idle sends now throw `SessionAdmissionRefusedError` from the same agent-sdk error module used by Claude. The check covers peer and non-peer sends, and a later turn-start race is translated before admission.
- `codex-chat-peer-queue.ts`: require-idle reservations carry the session ID so closure, queue capacity, and turn-start races return typed refusals. Pending require-idle entries rejected during close report `session-ended`. A cancelled reservation no longer invokes its deferred `run` callback.
- Both scoped specs now assert `instanceof SessionAdmissionRefusedError` and its `reason` for busy and ended cases, including queued, reserved, full, closing, closed, and start-race paths.
- Fixed the review's cheap style minor in `codex-chat-peer-queue.ts`: braces around the closed-session guard and a wrapped logger call.

## Decisions

| Native Codex state at require-idle admission | Refusal reason |
| --- | --- |
| Missing, closing, aborted, or blocked and closing session | `session-ended` |
| Running turn, temporarily blocked turn, queued or reserved peer, or full peer queue | `busy` |
| Turn-start race after a reservation: `busy` from `turn` | `busy` |
| Turn-start race after a reservation: `unavailable` from `turn` | `session-ended` if closing or aborted; otherwise `busy` |

Peer messages without `require-idle` retain the existing FIFO queue behavior and coded queue-full/closed errors. The adapter checks liveness before busy, matching Claude's `assertAdmissible` priority.

## Evidence

- Read the r1 review, common rules, Claude's `session-stream-pump.service.ts` admission checks, and `session-admission-refused.error.ts` before editing.
- Inspected the scoped diff and the final adapter/queue paths. All five written files use LF only (zero CR bytes).
- Tests, typecheck, lint, build, Nx, npm, verify, and `ptah_get_diagnostics` were not run, as required by the task rules. The coordinator must run the scoped checks.

## Remaining

- The existing non-peer send behavior while a peer is pending still returns busy instead of holding it behind the peer. Changing that ordering is beyond this admission-error revision.
- The second busy window inside `codex-chat-turn-stream.ts` is outside Scope.
- The review's optional Stop-then-refused-interrupt end-to-end spec and close logging severity change were not added; neither is required for the typed admission contract.
