# TASK_2026_367 — batch report FIX-F1

Review finding: **F1 (HIGH)** from `code-review-antigravity-wave1.md`. The
stale-abort marker added by `ec431d4cc` was scoped to a session, not to a turn.
A follow-up message continues the SAME session (`chat:continue`), so a
legitimate Stop on the next live turn matched the stale marker, skipped the
`chat:abort` RPC and left the backend turn running.

## Turn identity chosen

`ConversationService.currentTurnKey(sessionId, tab)` builds:

```
`${sessionId}::${streamingState.currentMessageId ?? '-'}::${lastUserMessageId ?? '-'}`
```

Both components come from state the code already owns. Neither one alone is
sufficient:

- **`streamingState.currentMessageId`** is `null` until the first assistant
  message event arrives. A fast Stop on two consecutive turns would produce the
  same key and reproduce F1 in a narrower form.
- **The id of the last `role: 'user'` message** changes on every turn, because
  both send paths append the optimistic user bubble before the RPC
  (`message-sender.service.ts` — `appendUserMessageAndResetStreaming` for a new
  conversation, `setMessages` for `chat:continue`). It is `null` only for a tab
  whose messages are not loaded. `reconcileUserMessageNativeUuid` explicitly
  leaves `id` unchanged, so it is stable inside a turn.

When both components are absent, the key is `null` and the method never
deduplicates, so the abort always reaches the backend. That is the safe
direction: an extra RPC is harmless, a skipped RPC is the defect.

**No hook was needed in `message-sender.service.ts`.** The key changes by itself
when a new turn starts, so that file is unmodified.

The constructor `effect` that cleared the old marker on a session change was
removed. The session id is part of the key, so a different session already
yields a different key. The existing spec that pins "changing
`currentSessionId()` between presses issues a second RPC" still passes.

## Failure paths clear the marker

The marker is still set immediately before the RPC (plan §5 ordering). It is now
set back to `null` in both failure branches:

- the `catch` around `claudeRpcService.call('chat:abort', ...)`;
- the `result.success === false` branch.

A retry after a transport failure or a negative result therefore reaches the
backend. The `_isStopping` re-entry guard is unchanged.

## Files modified

- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts`

No other file was touched.

## Spec assertions added (4 new tests, existing tests kept)

| Test                                                                         | Assertion                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `issues a second chat:abort RPC when a NEW turn starts on the same session`  | abort on `sess-1` / `msg-1` / `user-1` → 1 RPC; new turn `sess-1` / `msg-2` / `user-2` → abort → 2 RPCs, last call `{ sessionId: 'sess-1' }`. This is the F1 regression. |
| `retries the RPC after the previous chat:abort call threw`                   | first call rejects → 1 RPC and `markTabIdle('tab-1')`; second abort → 2 RPCs.                                                                                            |
| `retries the RPC after the previous chat:abort call returned success:false`  | first call resolves `{ success: false }` → 1 RPC and `markTabIdle('tab-1')`; second abort → 2 RPCs.                                                                      |
| `skips the RPC and idles the tab locally on a second abort of the SAME turn` | success then repeat Stop on the same turn → exactly 1 RPC, `markTabIdle('tab-1')`, `finalizeCurrentMessage('tab-1', true)`. Original plan behaviour, still pinned.       |

A `makeUserMessage(id)` helper was added next to `makeTab`.

### Mutation evidence (the specs are not tautological)

- `currentTurnKey` temporarily reduced to `return String(sessionId)` (the
  defect): **1 suite failed, 1 test failed** — the new-turn regression.
- Both `_lastAbortedTurnKey.set(null)` failure clears temporarily deleted:
  **1 suite failed, 2 tests failed** — both retry tests.

Both mutations were reverted before the final runs.

## Verification

- `npx nx run-many -t test -p @ptah-extension/chat --skip-nx-cache`
  → `Running target test for project @ptah-extension/chat` (1 project),
  **59 suites passed, 895 passed, 2 skipped, 897 total**.
- `npx nx run-many -t lint -p @ptah-extension/chat --skip-nx-cache`
  → **0 errors, 17 warnings**, all pre-existing (`max-lines` and
  `no-empty-function` in other files). No warning names the two modified files.
- `npx nx typecheck @ptah-extension/chat` → success.
- `npx prettier --check` on both modified files → clean.

## Left undone

- Nothing in F1's scope. The `--testPathPattern` filter is ignored by this
  project's Nx jest target, so every run is the full 59-suite chat suite; the
  per-test evidence above comes from the mutation runs instead.
- F2–F5 belong to other agents and other libraries.
- Plan item C5a-later (batch B12, `alreadyEnded` on the wire) stays blocked on
  TASK_2026_362 and is unaffected by this fix.

DONE: FIX-F1 — abort dedupe is now turn-scoped and cleared on RPC failure; 4 new mutation-proven specs, 895 chat tests pass, lint 0 errors
