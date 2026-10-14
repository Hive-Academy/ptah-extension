# Context
Source: HANDOFF.md follow-up 4, the open items listed in the PR 724 body
(branch feat/session-handoff-skill).
1. A failed start sends `chat:error` with no ack, so the caller cannot tell that the start failed.
2. Closing a tab keeps a held `/session-handoff` command and a pending banner promise
   (leak and stale UI state).
Depends on PR 724 being merged first.

## Update 2026-10-14 (session 4)
- Item 2 (tab close keeps a held /session-handoff and a pending banner promise) is FIXED in PR #724
  (92e32f0b7, 551a84699; codex pr724-review-r2.md APPROVED 8/10). Also covered: /clear and
  workspace removal.
- Remaining here: item 1 (failed-start `chat:error` has no ack). Review Moderates to consider:
  parked-tab test coverage; `/clear` RPC reply could overtake the clear broadcast
  (pr724-review-r2.md).
