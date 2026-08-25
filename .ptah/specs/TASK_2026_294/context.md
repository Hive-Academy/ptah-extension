# TASK_2026_294 — context

## What the user saw

Using Codex as the auth provider, the user sent a follow-up while the agent was
mid tool-loop (repeated `ptah_agent_status` polling on a spawned CLI agent):

> lets wait until the agent do some work you can do the antigravity videos or
> anything else until it finishes

The bubble rendered in the webview at 18:11 local. The agent never acted on it,
and when asked, reported having received only `[Request interrupted by user]`.

## Evidence from disk

Session transcript:
`~/.claude/projects/D--projects-angular-3d-showcase/40607e55-f36a-4c32-81b1-81269e3e2d2f.jsonl`

```
[57] 15:11:40.686Z  queue-operation  enqueue  "lets wait until the agent do some work…"
[58] 15:11:40.622Z  assistant        tool_use mcp__ptah__ptah_agent_read      ← turn in flight
[60] 15:11:40.787Z  queue-operation  remove   "lets wait until the agent do some work…"
[61] 15:11:40.686Z  attachment       queued_command {prompt: "lets wait until…"}
...
[87] 15:12:28.549Z  user             "[Request interrupted by user]"          ← 48s later, user hit Stop
[91] 15:12:58.673Z  assistant        "No response requested."
```

Four later messages in the SAME session were sent while the session was idle.
Each shows `enqueue` → **`dequeue`** → a real `user` message, and each was
answered (lines 89/92, 97/100, 106/109, 125/128).

The interrupt at 15:12:28 is 48 seconds after the drop — it is the user pressing
Stop after being ignored, not the cause. The agent's own "message-delivery race
during interrupt teardown" theory is wrong on the mechanism.

### Scale

Scan of `~/.claude/projects/**/*.jsonl`:

- `queue-operation` totals since 2026-08-10: enqueue 1283, dequeue 780, **remove 502**
- Of 180 `remove` entries carrying content, **180 were never delivered** as a
  user message (checked by scanning the following 40 lines for the same text).
- 58 of those are human-authored prompts since 2026-08-01, e.g.
  `"we need to make a new branch and make a pr with our changes"` (922dbed2,
  2026-08-17), `"commit all of our changes please"` (171554ff, 2026-08-02),
  `"we can wait for a while its a big task so give them their times"`
  (2ef0cbbc, 2026-08-13). The rest are `<task-notification>` payloads, which are
  designed to ride the attachment path.

## Why it happened

Timing proves the path. Ptah's own frontend queue performs **no RPC** — a queued
message reaches the backend only at turn-end. The SDK saw this one at
`15:11:40.686`, the instant Enter was pressed. So
`MessageDispatchService.sendOrQueueMessage`
(`libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:74`)
took the `send()` branch: its `isStreaming` predicate reads UI state only
(`tab.status` + `_streamingTabIds`), both of which `markTabIdle()` clears at a
Stop-hook turn-end while the SDK keeps generating.

From there the backend has no guard at all:

- `chat-session.service.ts:588` — `sendMessageToSession(...)` is called
  unconditionally once `hasLiveSessionStream` is true.
- `session-stream-pump.service.ts:186` — `messageQueue.push(...)` + `resolveNext()`
  wakes the iterator, which yields into the live query immediately.

## Decision

Fix at the authoritative layer, not the frontend predicate. That predicate has
already been band-aided twice (see the `continueExistingSessionForQueueFlush`
comment at `message-sender.service.ts:477`) and any UI-derived streaming flag can
desync again. **Ptah must own the queue; the SDK queue is where messages die.**

`SessionStreamPump` becomes the single chokepoint — both the fresh-session
iterable prompt and the resume-mode `streamInput` path drain the same stream
(`session-query-executor.service.ts:214`, `:296`).

## Deliberately out of scope

- The frontend `isStreaming` desync itself. It is now harmless for _delivery_,
  but it still lets `send()` → `wireAbortDispatch` → `createAbortController`
  abort a live controller and fire a stray `chat:abort`. Separate latent bug;
  not triggered in this incident (no controller was tracked).
- `chat:continue`'s double-send on the auto-resume path (`chat-session.service.ts:531`
  passes `prompt` to `resumeSession`, then `:588` sends it again).

## Stuck-flag backstops

`turnInFlight` is cleared by: the turn's `result` message (normal path),
`interruptCurrentTurn`, and session teardown (`endSession` removes the record).
A turn that emits neither is already bounded by `NoActivityWatchdog`
(`NO_ACTIVITY_TIMEOUT_MS` = 180s, TASK_2026_190), which aborts the controller and
ends the pump loop.
