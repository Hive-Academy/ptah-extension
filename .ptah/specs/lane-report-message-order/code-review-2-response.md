# Response to re-review 1 (code-review-2.md)

## Earlier findings

Both FIXED (confirmed by the reviewer with file:line evidence).

## New finding 1 — admission/echo race: accepted as a known limit, no code change

Reasoning, checked in code:

- A prompt typed while the tab is generating does not go through `MessageSenderService.send`.
  `MessageDispatchService.sendOrQueueMessage` (`libs/frontend/chat/.../message-dispatch.service.ts:208-237`)
  routes it to the queue path when `isTabBusyGenerating` is true, and `isTabStreaming` is set by
  the backend `turn_state` `generating` event (`tab-manager.service.ts:1884-1891`).
- So the race needs this exact order: the backend admits peer P on an idle session, then the
  person sends Q before the `generating` event or the P echo reaches the webview, and Q reaches
  the backend after P was admitted. The window is one backend → renderer IPC hop.
- The effect is live-only. The JSONL order is authoritative, and a reload, a resync or a hidden-tab
  reveal rebuilds the transcript from it in the correct order `[P, P-reply, Q, Q-reply]`.
- A correct fix needs an authoritative admission signal from the backend (for example a
  `held`/`admitted-after` result on `chat:continue`, or a correlated "prompt consumed" event).
  That is an RPC contract change across `agent-sdk`, `shared`, `rpc-handlers` and the webview, and
  out of scope for this bugfix. A client-side timestamp heuristic is not authoritative (the echo
  timestamp is taken at conversion, not at admission) and would trade this race for wrong
  ordering in other cases.
- Recorded in the PR as a known limit, with the follow-up described above.
