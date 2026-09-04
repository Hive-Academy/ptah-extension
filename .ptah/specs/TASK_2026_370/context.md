# Context

## How it surfaced

While tracing the empty-bubble defect (TASK_2026_366), `tmp/logs/log.log`
showed three chat sessions streaming at the same time — tabs `24e79215`,
`bc53b638` and `9e1c59cc` — with their events interleaved. In that window the
transformer logged this six times, always for `root`:

```
[WARN] [SdkMessageTransformer] content_block_start but no active message for context: root
```

Lines 1282-1284, 1363, 1682-1683. Each is a content block the transformer
dropped (`stream-event.transformer.ts:284-291` returns `[]`).

It was first read as the cause of the empty bubbles. It was not — the bubbles
came from signature-only thinking blocks, now handled. But the warnings are
real, and so is the mechanism behind them.

## The mechanism

`libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts:55`

```ts
private readonly currentMessageIdByContext: Map<string, string> = new Map();
```

The key is `context = parent_tool_use_id || ''`. **There is no session in the
key.** Every root assistant turn of every session writes the same `''` slot.

`libs/backend/agent-sdk/src/lib/di/register.ts:158-162` registers the class
`Lifecycle.Singleton`. `helpers/stream-transformer.ts:221` injects that
singleton, and `stream-transformer.ts:441` calls `transform()` on it for every
interactive session's stream.

With two sessions in flight:

1. Session A `message_start` — root slot holds A. The webview opens a bubble.
2. Session B `message_start` — root slot now holds B.
3. Session A `content_block_start` and deltas resolve the slot to **B**, so
   A's text is stamped with B's message id and lands in the wrong tab.
4. Session A `message_stop` clears the slot.
5. Session B `content_block_start` finds an empty slot — the warning above —
   and the block is dropped.

`onMessageDelta` (`stream-event.transformer.ts:209`) reads the same slot, so
token usage is attributed to the wrong message as well.

## A second consequence of the same shape

`message-transform/system-message.transformer.ts:50` calls
`state.clearStreamingState()` on a compact boundary. On the shared singleton
that clears the maps for **every** live session, not the one that compacted.

## The fix already exists

`sdk-message-transformer.ts:104` — `createIsolated()` returns a fresh instance
with its own maps. Two callers use it today:

- `rpc-handlers/.../harness-stream-broadcaster.service.ts:90`
- `cli-agent-runtime/.../ptah-cli-stream-loop.service.ts:82`

The interactive chat path does not. `StreamTransformer.createTransformStream()`
is called once per session stream and is the natural place to take an
isolated instance instead of the injected singleton.

## Scope notes

- Isolating per stream also isolates `taskStartedEmitted`,
  `backgroundTaskToolUseIds`, `activeSkillToolUseIds` and
  `workflowRunByToolUseId`. All are per-session by nature, so that is correct.
- `usageTracker` and `turnState` are shared collaborators passed through and
  keyed by session already; they are unaffected.
- A session **resume** creates a new stream and therefore a fresh instance,
  which matches what `clearStreamingState` does at a compact boundary today.

## Reproduction

Open two chat tabs, send a prompt in each within a second of the other, and
watch for the `content_block_start but no active message for context: root`
warning. A unit test can drive it deterministically by interleaving two
sessions' `stream_event` messages through one `SdkMessageTransformer`.
