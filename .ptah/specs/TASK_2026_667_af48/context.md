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

## Triage 2026-10-30 (premise audit)

Verdict: PARTIAL (lane grok, verified by Claude).

- Delivered by #724 (d9933c000): tab-close / clear / workspace-removal drop of a held /session-handoff.
- Open: `reportStartFailure` in `main:libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:124,182,245` broadcasts CHAT_ERROR only, with no acknowledgement for the caller.
- Optional r2 moderates in the context above (parked-tab coverage, /clear reply race) were not re-checked.
