# Live Electron test p8d: P8 Codex App Server chat after fix round 8h (head 756814876)

Date: 2026-10-27. The user approved this run. It was test and report only, with no source edits.

- Evidence folder: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8d-20261027-214138\`
  - `electron.log` (main-process stdout/stderr), `build.log` (build-dev), `wasm.log`, `build2.log`
    (copy-renderer-dev)
  - `shots\` (screenshots), `settings.json.bak` (settings backup), Playwright scripts `*.js`
    (copied from p8c)
  - test DBs `ptah.db`, `sessions.db`; workspace `ws\` (a fresh copy of the p8b workspace)
  - `mark-a.txt`, `mark-e.txt`, `mark-f.txt`: log line offsets where each scenario starts
- Build: `build-dev` (exit 0), `copy-wasm.js` (exit 0), `copy-renderer-dev` (exit 0). Both nx
  targets ran under `scripts/verify.mjs --exec --task electron-live-test`.
- Single-instance lock: before launch, another session's Ptah Dev app held the lock (PID 26268,
  `.claude-worktrees/kimi-code-oauth`). It was reported to the coordinator and not touched. It
  exited by itself after about 3 minutes. No root `electron.exe` was running at launch.
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP port 9335, fresh DB files, workspace
  `ws\`.
- Main agent set through the UI: Settings > Reassign > OpenAI Codex, model GPT-5.6-Luna, saved to
  "This workspace". The card showed `PROVIDER: OpenAI Codex MODEL: gpt-5.6-luna`
  (`shots\reassign.png`).
- Permission was set before any turn. The chip showed "Full Auto (YOLO)"
  (`shots\perm-menu.png`). The test clicked "Disable Autopilot", and the chip then showed
  `Approval mode: Manual` (`shots\perm-after.png`).

## Result: FAIL at scenario a. The native open fails inside `CodexRuntime.open`, and the cause is swallowed

| Scenario | Result | Evidence |
| --- | --- | --- |
| a. "Reply with the word OK." | FAIL (D7) | `shots\a-after.png`, log below |
| a. notice check (one non-error notice, names only) | PARTIAL: the log line is correct; no UI notice was seen because the start failed | log below |
| a2. second send in the same session (resume) | NOT RUN (no open session to resume) | - |
| b. Approval, Allow | NOT RUN (blocked by D7) | - |
| c. Approval, Deny | NOT RUN (blocked by D7) | - |
| d. Stop during a running turn | NOT RUN (no turn ever starts) | - |
| e. New session, one send | FAIL (same D7 error, deterministic) | `shots\e-after.png`, log below |
| `/compact` | NOT RUN (no session with history) | - |
| f. Normal close | PASS (limited: no Codex scope was ever created) | `electron.log` tail |

### What 8h fixed (confirmed)

- D6 is fixed. No `CodexChatOptionError` occurs (0 in the log). The open now gets past the option
  guard and the profile step.
- The ambient-MCP notice is logged once per start, with names only:
  `User MCP servers are not attached to Codex chat.: {"code":"codex-user-mcp-not-attached","serverNames":["smithery"]}`.
  No URL, token or `Bearer` text appears in or near it (a grep on the notice lines found 0
  matches).
- `chat:start` now logs the real outcome: `RPC: chat:start failed (CODEX_RUNTIME_FAILED)`, not
  `success`. M1 from p8c is fixed. The generic `RpcHandler: Method "chat:start" succeeded` line
  still follows. That is the transport layer, which considers a returned `{success:false}` a
  handled call.

### Scenario a

The App Server process starts. Codex's own MCP client connects to Ptah's CodeExecutionMCP, so
the `initialize` handshake completed and Codex loaded MCP servers. Then `CodexRuntime.open`
throws a generic error.

```
[DEBUG] RPC: chat:start called: {"tabId":"643f47db-...","workspacePath":"...\\ws","sessionName":"Reply with the word OK."}
[INFO] [ptah.main] chat:start - session config: {"mcpServerRunning":true,"mcpPort":51821}
[DEBUG] Smithery overrides resolved: {"namespace":"...","connectionsApiRecords":1,"legacyRecords":0,"serverKeys":["smithery"]}
[WARN] MCP OAuth override skipped — no valid token: {"serverKey":"oauth-mcp.sentry.dev-mcp"}
[WARN] MCP OAuth override skipped — no valid token: {"serverKey":"oauth-mcp.heygen.com-mcp-hyperframes"}
[INFO] Ptah MCP is not attached to Codex chat.: {"code":"ptah-mcp-not-attached"}
[INFO] User MCP servers are not attached to Codex chat.: {"code":"codex-user-mcp-not-attached","serverNames":["smithery"]}
[WARN] PTAH_CODEX_RUNTIME_DEV enables development-only Codex chat routing; production parity gate remains disabled: undefined
[DEBUG] MCP Request: initialize: CodeExecutionMCP {"id":0}
[INFO] MCP initialize request received: CodeExecutionMCP {"clientInfo":{"name":"codex-mcp-client","title":"Codex","version":"0.155.1"}}
[DEBUG] MCP Request: tools/list: CodeExecutionMCP {"id":1}
[ERROR] [CodexChatAdapter] runtime-failed: open. Error: Codex context could not be opened
    at CodexRuntime.open (.../main.mjs:67104:13)            <- libs/backend/codex-runtime/src/lib/codex-runtime.ts:121
    at async CodexChatAdapter.open (.../main.mjs:80992:17)
    at async ChatSessionService.launchSdkSession (.../main.mjs:277237:20)
[DEBUG] RPC: chat:start failed (CODEX_RUNTIME_FAILED)
[WARN] [RPC] slow handler: {"method":"chat:start","durationMs":8699}
[ERROR] [renderer] console.error: "[MessageSender] Failed to start chat: Codex chat could not complete the operation."
```

UI (`shots\a-after.png`): one message, "Message delivery failed. Codex chat could not start." The
header shows `error`, the rail shows "1 error", and the Orchestrator chip shows `failed`. No
second banner appeared. The "MCP servers not attached" notice was not visible in the UI. Either
it is shown only after a successful start, or the failure replaced it. This needs a re-check
once the open works. After the failure, no `codex app-server` process was left running.

### Scenario e

A new session was created (`session-10-27-21-48`, tabId `b00e50d4-...`), and its chip showed
`Approval mode: Manual`. One send gave the same single error (`shots\e-after.png`):

```
[INFO] User MCP servers are not attached to Codex chat.: {"code":"codex-user-mcp-not-attached","serverNames":["smithery"]}
[ERROR] [CodexChatAdapter] runtime-failed: open. Error: Codex context could not be opened
[DEBUG] RPC: chat:start failed (CODEX_RUNTIME_FAILED)
[WARN] [RPC] slow handler: {"method":"chat:start","durationMs":3932.5}
```

## Log marker counts (whole `electron.log`)

| Pattern | Count |
| --- | --- |
| `[SessionLifecycle] Starting SDK query with options:` (legacy path) | 0 |
| `Starting SDK query` | 0 |
| `CodexChatOptionError` | 0 |
| `runtime-failed` | 2 (a, e) |
| `Codex context could not be opened` | 2 |
| `CodexHomeMismatch` | 0 |
| `[ERROR]` | 4 (2 adapter + 2 matching renderer `console.error`) |
| `codex-user-mcp-not-attached` | 2 (one per start, `serverNames:["smithery"]`) |
| `ptah-mcp-not-attached` | 2 |
| `codex-thinking-not-applied` | 0 |
| `codex-output-style-not-applied` | 0 |
| `codex-active-resume-options-not-applied` | 0 (resume never reached) |
| URL / `Bearer` / token text on the notice lines | 0 |

## Defects

### D7 (BLOCKER): `CodexRuntime.open` fails after the App Server starts, and the cause is discarded

- Throw site: `libs/backend/codex-runtime/src/lib/codex-runtime.ts:115-122`. Any error from
  `RuntimeContext.open` (lines 255-299) other than `CodexHomeMismatchError` is replaced by
  `new Error('Codex context could not be opened')`, with no `cause` and no log.
- Inside `RuntimeContext.open`, `process.start()` passed: the MCP client connected after
  `initialize`, and there is no `CodexHomeMismatch`. So the failure is one of:
  1. `thread/start` rejected, or its result failing `validateCodexResult`
     (`codex-app-server-process.ts:211-219`).
  2. A server frame during `thread/start` failing validation, which kills the process with
     "Codex invalid protocol frame" (`codex-app-server-process.ts:269-271`, `308-327`). Only
     `model/list` result drift is request-local; any other drift is fatal.
  3. The 30 s request timeout. This is unlikely, because the handler took 8.7 s and 3.9 s.
  4. `store.persist` failing (line 295).
- Environment fact that is probably related: the user's `~/.codex/config.toml` defines
  `[mcp_servers.node_repl]` and `[mcp_servers.ptah]`. The App Server loads them from CODEX_HOME,
  which is why `codex-mcp-client` connects to Ptah's CodeExecutionMCP. So `thread/start` runs
  with ambient MCP startup notifications and MCP tool lists that the unit tests never see. App
  Server stderr is discarded (`codex-app-server-process.ts:170`, `stderr.resume()`), so it gives
  no clue either.
- Fix direction (not applied):
  1. Keep the real error as `cause` and log its class, message and protocol method (no
     payloads) at `codex-runtime.ts:121`. Also log the `fail()` reason in
     `codex-app-server-process.ts` (for example "invalid protocol frame" plus the method name).
     Optionally capture a bounded tail of App Server stderr.
  2. Then re-run, or reproduce offline with the pinned binary against the same CODEX_HOME.
- Related contract gap: Ptah logs "Ptah MCP is not attached to Codex chat"
  (`ptah-mcp-not-attached`), yet Codex attaches Ptah MCP from the user's own config.toml. The
  notice is misleading for users who have configured Ptah MCP in Codex. Decide whether native
  chat should honour or suppress CODEX_HOME `mcp_servers`.

### Still present from p8c

- M2 (minor): the session card says `api error` for a local runtime failure (`shots\a-after.png`,
  `shots\e-after.png`).
- D4 (LOW): saving to "This workspace" also writes the global key
  `provider.openai-codex.mainAgent.modelTier.opus = "gpt-6.1-sol"`. `sdiff.js` again showed 4
  diffs: 3 under `app.electron.workspace.f86cb56f346d65ac.*` and that global key. The backup
  restore undid it.
- Minor wording: the UI says "Codex chat could not start", and the renderer log says "Codex chat
  could not complete the operation" (`CODEX_RUNTIME_FAILED`, `chat-session.service.ts:558-562`).
  The UI is fine; this is noted only to make logs easier to correlate.

## Scenario f: shutdown

The window was closed with `window.close()` from the renderer. `launch.js` exited with code 0,
and no worktree `electron.exe` was left running, so `taskkill` was not needed. The shutdown tail
shows `AgentProcessManager` disposal and `PtahCliRegistry disposeAll()`, with no errors and no
hang. No Codex scope disposal line appears: the failed opens close their context in the catch
block (line 119), and no scope survives. After exit, `tasklist` showed no `codex` process except
the pre-existing system service `codex-windows-sandbox-service.exe` (PID 31876, session
Services).

## Paid turns

0 of 10. No `turn/start` was sent: the open failed at or before `thread/start`. No file was
created in `ws\` (it still contains only `README.md`).

## Settings restore

`~/.ptah/settings.json` was restored from `settings.json.bak` after the app exited.
`cmp` result: identical (exit 0).

## To re-run after the D7 fix

Make sure no other Ptah Dev app is running (single-instance lock). Use the same build and launch
steps. Set Reassign to GPT-5.6-Luna, then Disable Autopilot (the chip shows Manual) before the
first send. The full budget of 10 turns remains. If D7 is only made diagnosable, one free start
attempt will log the real cause.
