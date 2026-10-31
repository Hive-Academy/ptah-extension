# Live Electron test p8e: P8 Codex App Server chat after the D7 fix (head 88c50b841)

Date: 2026-10-27/28. The user approved this run. It was test and report only, with no source edits.

- Evidence folder: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8e-20261027-235006\`
  - `electron.log` (main-process stdout/stderr), `build.log` (build-dev), `wasm.log`, `build2.log`
    (copy-renderer-dev)
  - `shots\` (screenshots), `settings.json.bak` / `settings.backup.json` (settings backup),
    Playwright scripts `*.js` (copied from p8d, plus a new `s-approve.js`)
  - test DBs `ptah.db`, `sessions.db`; workspace `ws\` (a fresh copy of the p8d workspace)
  - `mark-*.txt`: log line offsets where each scenario starts
- Build: `build-dev` (exit 0), `copy-wasm.js` (exit 0), `copy-renderer-dev` (exit 0). Both nx
  targets ran under `scripts/verify.mjs --exec --task electron-live-test`.
- Single-instance lock: no root `electron.exe` was running before launch (checked twice).
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP port 9335, fresh DB files, workspace
  `ws\`.
- Main agent set through the UI: Settings > Reassign > OpenAI Codex, model GPT-5.6-Luna, saved to
  "This workspace". The card showed `PROVIDER: OpenAI Codex MODEL: gpt-5.6-luna Effort: medium`
  with "Workspace override" (`shots\reassign2.png`). The first card read right after the save
  click still showed the old model (`gpt-6-astra`) and refreshed a moment later. That is cosmetic.
- Permission was set before any turn. The chip showed "Full Auto (YOLO)" (`shots\perm-menu.png`).
  The test clicked "Disable Autopilot", and the chip then showed `Approval mode: Manual`
  (`shots\perm-after.png`).

## Result: FAIL. D7 is fixed (every open now succeeds and Codex answers), but the turn never ends in the UI and approvals cannot be answered

| Scenario | Result | Evidence |
| --- | --- | --- |
| a. "Reply with the word OK." | PARTIAL: open and turn succeed, Codex replies "OK"; the tab stays `streaming` forever (D8) | `shots\a-after.png`, `shots\a-later.png` |
| a. notice check (names only) | PASS: the chat shows "Codex chat: MCP servers not attached: smithery" | `shots\a-after.png` |
| a2. second send in the same session (resume) | FAIL: blocked in place by D8. After a renderer reload, the send started a NEW Codex thread instead of resuming (D10) | `shots\a2-reloaded.png`, `shots\a2-after.png` |
| b. Approval, Allow | FAIL (D11): Codex asked for approval, the renderer dropped the request as invalid, and no Allow/Deny button was shown | `shots\b-prompt.png`, `shots\b-show-in-canvas.png` |
| c. Approval, Deny | NOT RUN (same D11 path; no paid turn spent on a known failure) | - |
| d. Stop during a running turn | PARTIAL: stopped the b turn while it waited for approval. The UI went to `done`, but the backend logged it as a `runtime-failed` stream error, not a clean interrupt, and the "Permission required" notice stayed (D12) | `shots\d-after-stop.png` |
| `/compact` | BLOCKED (D8): `/compact` was queued as `queuedContent` behind the stuck turn and never sent | `shots\compact-queued.png` |
| e. New session, one send | PARTIAL: open + turn succeed, the reply is "OK"; the tab is stuck in `streaming` again (D8) | `shots\e-after2.png` |
| f. Normal close | PASS | `electron.log` tail |

### D7 fix confirmed

- All 5 `chat:start` calls succeeded (`RPC: chat:start success` = 5). `Codex context could not be
  opened` = 0. None of the new D7 cause fields (`errorClass`, `failedMethod`, `rootCause`) appear,
  because no open failed.
- For each start, Codex's own MCP client (`codex-mcp-client` 0.155.1) ran `initialize` and
  `tools/list` against Ptah's CodeExecutionMCP. That is 5 of 5.
- `chat:start` took 6 to 14 s (slow-handler warnings). The first start overlapped a 3.9 s
  event-loop freeze.

### Scenario a

```
[INFO] Ptah MCP is not attached to Codex chat.: {"code":"ptah-mcp-not-attached"}
[INFO] User MCP servers are not attached to Codex chat.: {"code":"codex-user-mcp-not-attached","serverNames":["smithery"]}
[INFO] MCP initialize request received: CodeExecutionMCP {"clientInfo":{"name":"codex-mcp-client","title":"Codex","version":"0.155.1"}}
[INFO] [electron RPC] Session ID resolved: tabId=5c353aad-... -> real=01a17f2c-acb5-7632-...
[DEBUG] RPC: chat:start success
[INFO] [electron RPC] Session stats received: 01a17f2c-...: {"turnCost":null,"tokens":{"input":17762,"output":5,...},"duration":5563}
```

The UI rendered the thinking line, the notice, and "OK". The turn finished in the backend in
5.6 s (stats arrived). After 2+ minutes the tab state was still `status: "streaming"` with
`streamingState` set. The header read "Orchestrating" with the elapsed time still counting, the
rail said `running`, and the Stop button stayed. Clicking Stop sent `chat:abort`, which closed the
Codex process (`Codex process failure: {"reason":"Codex process exited"}`). The tab still stayed
`streaming`. Only a renderer reload cleared it.

### Scenario a2

After the reload, the tab showed only the user message. The assistant "OK" was gone:
`Session history loaded from JSONL: {"sessionId":"01a17f2c-...","eventCount":0}` (D9). The second
send then did:

```
[DEBUG] RPC: session:validate - session file NOT found: {"sessionId":"01a17f2c-..."}
[WARN] [renderer] ... [MessageSender] Session 01a17f2c-... file not found on disk - starting new session instead
[DEBUG] RPC: chat:start called: {"tabId":"5c353aad-...", ...}
[INFO] [electron RPC] Session ID resolved: tabId=5c353aad-... -> real=01a17f31-f876-...
[INFO] [electron RPC] Session stats received: 01a17f31-...: {"tokens":{"input":17762,"output":6,...}}
```

Codex answered "TWO". But it ran on a new thread (`01a17f31`, not `01a17f2c`) with the same
17,762 input tokens as a fresh thread, so the earlier context was not carried. The tab then stuck
in `streaming` again (D8).

### Scenario b

New session, prompt `Run this shell command: echo hi > b.txt`. Codex emitted a
`commandExecution` tool card (`powershell.exe -Command 'echo hi > b.txt'`, cwd `ws\`). It then sent
`item/commandExecution/requestApproval`, and the host broadcast a `permission:request`:

```
[WARN] [renderer] console.warning: [ChatMessageHandler] Invalid PermissionRequest payload — dropped Object{id,sessionId,tabId,toolName,toolUseId,toolInput,description,timestamp,timeoutAt,allowedDecisions}
```

No Allow/Deny control appeared within 120 s. The notification bell showed "1 needs your
response". Its card was titled with the raw session id (`01a17f33-cb79-...`). "Show in canvas"
only focused the session, which still had no decision buttons. `b.txt` was never created.

### Scenario d (on the blocked b turn)

```
[DEBUG] RPC: chat:abort called: {"sessionId":"01a17f33-..."}
[ERROR] [CodexChatAdapter] runtime-failed: turn. CodexChatAdapterError: Codex chat stream: runtime-failed  (operation: 'stream')
[DEBUG] Codex process failure: {"reason":"Codex server request failed","method":"item/commandExecution/requestApproval","stderrTail":""}
[ERROR] [RPC] Error streaming flat events for session 70eee6c0-... after 12 events CodexChatAdapterError: ...
[ERROR] [renderer] console.error: [ChatStore] Chat error: [object Object]
```

The UI settled to `done` (via the broadcaster's error path `forceIdle`), and no error banner was
visible. The abort was not recognised as a user abort: the message "Codex chat stream:
runtime-failed" does not contain "abort", so `chat-stream-broadcaster.service.ts:299-303` treated
it as a real error, logged it at ERROR, sent it to Sentry, and published `CHAT_ERROR`. The
"Permission required" notice stayed in the rail, the bell and a toast after the stop (D12).

### `/compact`

The first `/compact` attempt was a test-harness mistake. Git Bash MSYS path conversion turned
the env var into `C:/Program Files/Git/compact`, and that was sent as a normal prompt. It was one
paid turn, and it is counted below. Codex treated it as a path and ran two read-only PowerShell
listings of `~/.codex/skills`. In Manual mode these ran WITHOUT an approval prompt. The second,
correct `/compact` (with `MSYS_NO_PATHCONV=1`) was not dispatched. The tab was still `streaming`
(D8, Stop did not clear it), so the composer stored it as `queuedContent: "/compact"`, and that
only sends after the turn finalizes. `/compact` on a session with Codex history is therefore not
testable until D8 and D10 are fixed.

### Scenario e

After a renderer reload, New session > Create, one send of `Reply with the word OK.`:
`chat:start success`, then `Session stats received: 01a17f3a-...` (duration 10.2 s). Codex first
said "I'm loading the required Ptah surface-authoring guidance before replying" and ran a
read-only PowerShell search of `~/.codex/skills` for `ptah|surface` (no approval prompt), then
replied "OK". The tab stayed `streaming` (D8).

### MCP observation (item 10)

- Chat notice: the UI shows one in-chat line per start, "Codex chat: MCP servers not attached:
  smithery". The `ptah-mcp-not-attached` notice is logged (5 times) but was not seen in the UI.
- Codex did expose Ptah MCP: on every start, `codex-mcp-client` connected to Ptah's
  CodeExecutionMCP and listed its tools (`initialize` + `tools/list`, 5 of 5). This comes from the
  user's `~/.codex/config.toml` `[mcp_servers.ptah]`. No `tools/call` was made in any turn (0).
  So the "Ptah MCP is not attached" notice is wrong for this user, as noted in p8d.
- The model's behaviour in a and e (searching `~/.codex/skills` for Ptah surface guidance before
  answering "OK") suggests that Ptah's main-agent prompt tells it to use Ptah surface authoring.
  That guidance is meant for the Ptah MCP or skill and is not delivered to native Codex. It costs
  latency and tokens on trivial prompts.

## Log marker counts (whole `electron.log`)

| Pattern | Count |
| --- | --- |
| `[SessionLifecycle] Starting SDK query with options:` (legacy path) | 0 |
| `Starting SDK query` | 0 |
| `CodexChatOptionError` | 0 |
| `Codex context could not be opened` | 0 |
| `errorClass` / `failedMethod` / `rootCause` (D7 cause log) | 0 / 0 / 0 (no open failed) |
| `CodexHomeMismatch` | 0 |
| `chat:start success` | 5 |
| `Session stats received` | 4 (a, a2, misfire, e; b was aborted) |
| `runtime-failed` | 4 lines (1 adapter error + its echo in the broadcaster error, plus stack text; all from d) |
| `[ERROR]` | 3 (all from d: adapter, broadcaster, renderer `Chat error`) |
| `Codex process failure` | 5 (3 x `Codex process exited` on abort/close, 1 x `requestApproval` failed on abort in d, 2 at shutdown; `stderrTail` empty in all) |
| `Invalid PermissionRequest payload` | 1 (b) |
| `session file NOT found` | 2 (a2, misfire) |
| `chat:abort called:` | 3 |
| `codex-user-mcp-not-attached` | 5 (`serverNames:["smithery"]`) |
| `ptah-mcp-not-attached` | 5 |
| `codex-mcp-client` initialize on CodeExecutionMCP | 5 |
| `MCP Request: tools/call` | 0 |
| `codex-thinking-not-applied` | 0 |
| `codex-output-style-not-applied` | 0 |
| `codex-active-resume-options-not-applied` | 0 (resume never reached, see D10) |
| URL / `Bearer` / token text on the notice lines | 0 |

## Defects

### D8 (BLOCKER): a finished Codex turn never ends in the UI; the tab stays `streaming`

- The renderer finalizes a turn only on a backend `turn_state` event (TASK_2026_360):
  `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:686-700` ("Stats are NOT a
  turn boundary ... the backend `turn_state` event finalizes the turn"). `CHAT_COMPLETE` is
  ignored except for `/clear` (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:384-421`).
- The legacy path emits that event from the `result` message
  (`libs/backend/agent-sdk/src/lib/message-transform/result-message.transformer.ts:28-36`,
  `turnState.settleTurn` + `toTurnStateEvent`).
- The Codex projection ends a turn with `message_complete` only
  (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts:251-265`). No Codex file
  calls `markGenerating`, `settleTurn` or `toTurnStateEvent` (grep: 0 hits under the codex
  folders).
- The broadcaster's safety net does not catch it either. The `finally` block forces idle only
  when `turnState.get(id)?.phase === 'generating'`
  (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:384-387`),
  and Codex never sets that phase. Only the error path (`:343-348`) pushes a `turn_state`, which is
  why d did end idle.
- Effect: every Codex turn leaves the tab `streaming` with Stop shown. A follow-up message is
  queued forever (blocks a2 in place and `/compact`). Stop after a finished turn closes the Codex
  process but does not clear the tab. Only a renderer reload recovers.
- Fix direction: have the Codex adapter (or `streamCodexChatTurn`) drive the shared
  `SessionTurnStateRegistry`: `markGenerating` at `turn/started` / `message_start`, and on
  `turn/completed` emit `toTurnStateEvent(sessionId, settleTurn(sessionId, reason))` after
  `message_complete`, mapping interrupted to `aborted_streaming`. Add a host-level test that a Codex
  turn ends with a `turn_state` `idle`.

### D10 (HIGH): continuing a Codex session checks for a Claude JSONL file and silently starts a new thread

- `session:validate` looks up a Claude transcript file
  (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1048-1067`, `findSessionFile`).
  A Codex thread has no such file, so it returns `exists: false`. `MessageSender` then logs "file
  not found on disk - starting new session instead" and calls `chat:start`.
- Effect: the conversation context is lost with no user-visible notice (same 17,762 input tokens
  as a fresh thread; new thread id). `codex-active-resume-options-not-applied` and the
  thread/resume path are never reached.
- Fix direction: route `session:validate` (and the continue decision) through the Codex resume
  identity (`readResumeIdentity`, used in `codex-chat-host-ports.ts:179-190`) for Codex-owned
  sessions.

### D11 (BLOCKER for b/c): Codex approval requests are dropped by the renderer

- The host builds the permission id as a JSON array string:
  `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:130-140` (`key()` =
  `JSON.stringify([sessionId, contextId, processGeneration, threadId, turnId, requestId, ...])`),
  then uses it as `id` at `:289-300`.
- The renderer requires `id` to be a UUID:
  `libs/shared/src/lib/types/permission.parsers.ts:51` (`isWireUuid(payload['id'])`, which mirrors
  `PermissionRequestSchema.id: z.string().uuid()` in `permission.schemas.ts:19`). So
  `parsePermissionRequest` returns null and `chat-message-handler.service.ts:734-737` drops the
  request.
- `sessionId` (UUID v7) is fine: `UUID_REGEX` accepts versions 4 and 7 (`branded.types.ts:42-43`).
  The extra `allowedDecisions` key is ignored by the parser.
- `timeoutAt: 0` (`:298`) means the Codex request waits forever, so the turn hangs until the user
  presses Stop.
- Fix direction: use a random UUID per presentation as the wire id and keep the correlation key in
  the `pending` map (id → key). Add a contract test that runs a Codex `PermissionRequest` through
  `parsePermissionRequest`.

### D12 (MEDIUM): Stop while an approval is pending is reported as a runtime failure and leaves the notice

- `chat:abort` closes the context first. The pending `requestApproval` then fails ("Codex server
  request failed") and the turn stream throws `CodexChatAdapterError('runtime-failed', 'stream')`
  (`codex-chat-turn-stream.ts:140`, wrapped at `:141-142`). The broadcaster's user-abort test
  (`chat-stream-broadcaster.service.ts:299-303`) looks for "abort"/"cancel" in the message, so it
  logs ERROR, reports to Sentry and publishes `CHAT_ERROR`.
- The "Permission required" notice (rail, bell, toast) is not released after the abort, and its
  title is the raw session id rather than the tool or command.
- Fix direction: a user stop should go through `turn/interrupt`, or the adapter should surface an
  abort-classified error. On close, `dismiss` or `settle` every pending approval for the session.

### D9 (MEDIUM): reloading a Codex session shows no assistant messages

- `Session history loaded from JSONL: {"eventCount":0}` for the Codex thread
  (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` around line 1282). Only
  the user prompt is restored; Codex replies are not rebuilt from the thread.

### Observations (not defects of this round)

- In Manual mode, read-only shell commands ran without an approval prompt (Codex sandbox policy).
  Only the write (`echo hi > b.txt`) asked for approval. Confirm that this is the intended mapping
  of "Manual".
- The `ptah-mcp-not-attached` notice is incorrect for users whose `~/.codex/config.toml` defines
  `[mcp_servers.ptah]` (5 of 5 starts attached it), as noted in p8d.
- The main-agent prompt makes Codex look for Ptah surface-authoring guidance on trivial prompts
  (a, e, and the misfire turn).

### Still present from p8c/p8d

- D4 (LOW) was not re-measured. The `sdiff.js` call was run with the `.bak` file name, which Node
  cannot `require`, so it failed. The restore had already overwritten the live file. The restore
  itself is verified below.
- M2 was not re-checked (no start failure this run).

## Scenario f: shutdown

Before the close, two worktree `codex.exe` App Server processes were alive (threads `01a17f31`
and `01a17f3a`). The window was closed with `window.close()` from the renderer. The shutdown tail
shows `AgentProcessManager` disposal, two `Codex process failure: {"reason":"Codex process
exited"}` lines (the contexts closing), the SQLite WAL checkpoint and `PtahCliRegistry
disposeAll()`, with no errors and no hang. `launch.js` exited with code 0. Afterwards no worktree
`electron.exe` and no worktree `codex.exe` was running, so `taskkill` was not needed. Only the
pre-existing system service `codex-windows-sandbox-service.exe` and processes outside this
worktree remained (not touched).

## Paid turns

5 of 10 (`turn/start` sent): a, a2, b (stopped while waiting for approval), the `/compact`
misfire (harness path-conversion error), and e. c was skipped deliberately (same D11 path). The
second `/compact` was never dispatched (D8). `ws\` contains no new files (`b.txt` was never
written).

## Settings restore

`~/.ptah/settings.json` was restored from `settings.json.bak` after the app exited.
`cmp` result: identical (exit 0).

## To re-run after fixing D8, D10 and D11

Use the same build and launch steps. For `/compact` from Git Bash, set `MSYS_NO_PATHCONV=1`. The
remaining budget is 5 turns, enough for a2 in place, b, c, d on a streaming turn, and `/compact`
on a session with history.
