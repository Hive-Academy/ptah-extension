# Context

## How it was found

The user reported that the chat kept the streaming state after the agent
finished. The Stop button and the rotating quotes stayed on, while the token,
cost and duration badges of the finished turn were already rendered on the same
bubble.

## D1 — the resumed turn's terminal `turn_state` is dropped

### Evidence (`tmp/logs/log.log`, session `50653b50-a03b-45a5-937b-b4944ab2e9f1`)

| Line | Log                                                         | Reads as                                                                               |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 3    | `skill-synthesis ... source: "session-end", turnCount: 329` | The previous query for the session already ended. Its loop exit ran `turnState.clear`. |
| 168  | `chat:continue called: sessionId 50653b50, tabId 479f4765`  | Follow-up message on an existing session.                                              |
| 171  | `[RPC] Session 50653b50 not active, attempting resume...`   | `autoResumeIfInactive` fired — a NEW SDK query.                                        |
| 191  | `Building SDK query options: isResume: true`                | Confirms the resume.                                                                   |
| 199  | `streamExecutionNodesToWebview STARTED`                     | A new broadcast loop, so a new turn-state record.                                      |
| 378  | `Session stats received: ... duration: 311510`              | The `result` message arrived.                                                          |
| 379  | `Waiting for message (50653b50...)`                         | The pump released the turn claim. The turn ended.                                      |

The agent ended the turn and the backend emitted the terminal `turn_state`.
`onResultStats` and `messageTransformer.transform(result)` are in the same
`isResultMessage` branch (`stream-transformer.ts:309-319`, `:427-451`), and
`ResultMessageTransformer` yields exactly one `turn_state`
(`result-message.transformer.ts:25`).

### Chain

1. `ChatStreamBroadcaster` deletes the record on loop exit —
   `this.turnState.clear(turnSessionId)`
   (`chat-stream-broadcaster.service.ts:413`). The counter returns to zero.
2. The resumed query therefore emits `generating` at revision **1**
   (`markGenerating`) and terminal `idle` at revision **2** (`settleTurn`).
3. `runContinueConversation` writes no revision fields. It calls
   `markResuming` then `markStreaming` / `markTabStreaming`
   (`message-sender.service.ts:597`, `:651`).
4. `acceptsTurnState` skips its restarted-counter allowance because that
   allowance requires `lastTurnStateSessionId !== sessionId`
   (`tab-manager.service.ts:1222-1228`), then requires `revision > last`.
   Revisions 1 and 2 lose against the previous query's stored value.
5. `TurnStateApplier` drops the event before any side effect, so nothing
   finalizes, idles or clears the spinner
   (`turn-state-applier.service.ts:81-98`).

### The control case in the same log

| Line | Log                                                                      |
| ---- | ------------------------------------------------------------------------ |
| 474  | `Session 50653b50 aborted by user after 3020 events`                     |
| 475  | `record was replaced before stream exit — leaving the newer query alone` |
| 623  | `Session 50653b50 not active, attempting resume...`                      |
| 741  | `Session stats received: ... duration: 67227`                            |

The abort pushed `forceIdle` on the live record, so it carried revision 3 and
beat the stale baseline. Line 475 means `turnState.clear` was **skipped**, so
the record survived and the next resume continued at 4 and 5. That turn updated
the UI normally.

So the defect is deterministic: it reproduces on the first turn of a resume
whose previous loop exited cleanly, and not on a resume that followed an abort.

### Decision

Fix the backend, not the guard. The frontend compares revisions per session, so
the backend counter must be monotonic per session id. Loosening
`acceptsTurnState` would re-open the replay window review F1 closed
(TASK_2026_360) and would leave the same trap for `chat:resume --activate` and
the rewind path, which also restart a query under an existing session id.

## D2 — `monaco-vim` takes the anonymous-define branch

`VimModeService.loadMonacoVimScript` injects the UMD bundle with a plain
`<script>` tag (`vim-mode.service.ts:136-143`). Monaco's AMD loader already
owns a global `define` with `.amd`, and the bundle's wrapper
(`node_modules/monaco-vim/dist/monaco-vim.umd.js:1-5`) is:

```js
typeof define === 'function' && define.amd
  ? define(['exports', 'monaco-editor/esm/vs/editor/editor.api'], factory)
  : (global.MonacoVim = {}, factory(...))
```

Two consequences:

- `window.MonacoVim` is never assigned, because the global branch never runs.
- The queued anonymous module never resolves either — its dependency id
  `monaco-editor/esm/vs/editor/editor.api` does not exist under the loader's
  `assets/monaco/vs` base URL.

`loadMonacoVimScript` returns `false` but sets `loadFailed` only in its `catch`
(`:144-151`), and `script.onload` fired, so nothing threw. The next
`attachToEditor` re-injects the script, a second anonymous define reaches a
loader that still holds the first, and the loader throws
`Can only have one anonymous define call per script file`
(`loader.js:965`, from `monaco-vim.umd.js:3`).

Vim mode has therefore never worked in this build. The console error is the
visible symptom of a silent load failure with an unbounded retry.
