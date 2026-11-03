# Live Electron test p8c: P8 Codex App Server chat after batches 8g-1b..8g-5 (head 0008f7f3d)

Date: 2026-10-27. The user approved this run. It was test and report only, with no source edits.

- Evidence folder: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8c-20261027-202233\`
  - `electron.log` (main-process stdout/stderr of the run), `electron-attempt1-locked.log`
    (first launch, which quit on the single-instance lock; see Launch)
  - `build.log` (build-dev), `wasm.log`, `build2.log` (copy-renderer-dev)
  - `shots\` (screenshots), `settings.json.bak` (settings backup), Playwright scripts `*.js`
    (copied from p8b)
  - test DBs `ptah.db`, `sessions.db`; workspace `ws\` (a copy of the p8b workspace)
  - `mark-a.txt`, `mark-e.txt`, `mark-f.txt`: log line offsets where each scenario starts
- Build: `build-dev` (exit 0), `copy-wasm.js` (exit 0), `copy-renderer-dev` (exit 0). All
  three ran under `scripts/verify.mjs --exec --task electron-live-test`.
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP port 9335, fresh DB files, workspace
  `ws\`.
  - The first launch quit right away. Another session's Ptah Dev app (PID 35288, from
    `.claude-worktrees/claude-named-accounts`) held the single-instance lock.
    `apps/ptah-electron/src/main.ts:62` forces userData to `%APPDATA%\Ptah Dev`, so a second dev
    instance cannot start. This agent did not stop that app. The coordinator got the user's
    approval and stopped it. The second launch started normally.
- Main agent set through the UI: Settings > Reassign > OpenAI Codex, model GPT-5.6-Luna, saved to
  "This workspace". The card showed `PROVIDER: OpenAI Codex MODEL: gpt-5.6-luna`, and a toast
  said "Saved main agent model to This workspace" (`shots\reassign.png`).
- Permission was set before any turn. The composer chip showed "Full Auto (YOLO)"
  (`shots\perm-menu.png`). The test clicked "Disable Autopilot", and the chip then showed
  `Approval mode: Manual` (`shots\perm-after.png`).

## Result: FAIL at scenario a. The native open rejects a non-empty `mcpServersOverride`

| Scenario | Result | Evidence |
| --- | --- | --- |
| a. "Reply with the word OK." | FAIL | `shots\a-after.png`, log below |
| b. Approval, Allow | NOT RUN (blocked by D6: every open fails) | - |
| c. Approval, Deny | NOT RUN (blocked by D6) | - |
| d. Cancel running turn | NOT RUN (blocked by D6: the open fails in milliseconds, so there is no open or turn to stop) | - |
| e. New session, one send | FAIL (same D6 error, deterministic) | `shots\e-after.png`, log below |
| f. Normal close | PASS (limited: no Codex scope was ever created) | `electron.log` tail |
| `/compact` | NOT RUN (no session with history) | - |

D6 fails before the App Server starts, so b to d cannot be exercised. e was run because it costs
no paid turn, and it confirms that the failure is not specific to one tab.

### Scenario a

D5 from p8b is fixed: `mcpServerRunning` and `workflowsDisabled` no longer fail the open. The
diagnostics fix also works: the error now names the rejected key, and the RPC carries
`CODEX_UNSUPPORTED_OPTION`. The open now fails on the next key, `mcpServersOverride`, before any
scope or App Server process exists. No `codex app-server` was spawned. `tasklist` showed only the
pre-existing `codex-windows-sandbox-service.exe` system service.

```
[DEBUG] RPC: chat:start called: {"tabId":"70ad70bb-...","workspacePath":"...\\ws","sessionName":"Reply with the word OK."}
[INFO] [ptah.main] chat:start - session config: {"mcpServerRunning":true,"mcpPort":51821}
[WARN] MCP OAuth override skipped — no valid token: {"serverKey":"oauth-mcp.sentry.dev-mcp"}
[WARN] MCP OAuth override skipped — no valid token: {"serverKey":"oauth-mcp.heygen.com-mcp-hyperframes"}
[INFO] Ptah MCP is not attached to Codex chat.: {"code":"ptah-mcp-not-attached"}
[ERROR] [CodexChatAdapter] runtime-failed: open. CodexChatOptionError: Codex chat does not support the "mcpServersOverride" option.
    at Object.profile (.../main.mjs:278410:39)              <- codex-chat-host-ports.ts profile()
    at Object.profile (.../main.mjs:283593:36)              <- electron wrapper
    at CodexChatAdapter.prepareProfile (.../main.mjs:81023:39)
    at CodexChatAdapter.open / startChatSession
    at RoutingAgentAdapter.startChatSession
    at async ChatSessionService.launchSdkSession (.../main.mjs:277187:20)
  code: 'unsupported-option'
[DEBUG] RPC: chat:start success                              <- misleading, see Minor M1
[ERROR] [renderer] console.error: "[MessageSender] Failed to start chat: Codex chat does not support the \"mcpServersOverride\" option."
```

UI (`shots\a-after.png`): "Message delivery failed. Codex chat does not support the
"mcpServersOverride" option." The header shows `error`, and the rail shows "1 error". The
Orchestrator chip now shows `failed` (red), so the p8b minor issue (chip stuck on `done`) is
fixed. Only one error message appeared, with no duplicate banner.

### Scenario e

A new session was created with "New session" > Create (`session-10-27-20-37`, new tabId
`c948f61b-...`). Its chip showed `Approval mode: Manual`. One send gave the same single error
(`shots\e-after.png`), and the rail then showed "2 error". The Orchestrator chip showed `failed`.

```
[DEBUG] RPC: chat:start called: {"tabId":"c948f61b-...", ...}
[ERROR] [CodexChatAdapter] runtime-failed: open. CodexChatOptionError: Codex chat does not support the "mcpServersOverride" option.
  code: 'unsupported-option'
[ERROR] [renderer] console.error: "[MessageSender] Failed to start chat: Codex chat does not support the \"mcpServersOverride\" option."
```

A first attempt at e did not open a new session (the `Chat` nav click timed out). Its send went
to the first tab again (same tabId `70ad70bb`) and produced the same error. That is the third
`runtime-failed` in the log.

## Log marker counts (whole `electron.log`)

| Pattern | Count |
| --- | --- |
| `[SessionLifecycle] Starting SDK query with options:` (legacy path) | 0 |
| `Starting SDK query` | 0 |
| `CodexChatOptionError` | 3 (all `mcpServersOverride`) |
| `Unsupported Codex chat option` (old message) | 0 |
| `runtime-failed` | 3 |
| `[ERROR]` | 6 (3 adapter + 3 matching renderer `console.error`) |

## Defects

### D6 (BLOCKER): the Codex option guard rejects the MCP override that `chat:start` builds from the user's MCP setup

- Throw site: `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts:51-61`
  (`classifyCodexChatOptions`). It strips `mcpServersOverride` only when the value is an empty
  object, and rejects any non-empty value.
- Producer: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:943-945`
  (`launchSdkSession`) always calls `buildMcpServersOverride()` (lines 455-484). That function
  merges the Smithery overrides and the OAuth MCP overrides from the user's MCP manifest, then
  passes the result in the config (line 974). On this machine the result is non-empty: the
  manifest has Smithery and OAuth HTTP servers. The log shows two OAuth entries skipped, and at
  least one source contributed an entry. So every Codex `chat:start` fails for a user who has
  any Smithery server or any OAuth MCP server with a valid token.
- Why the tests missed it: `chat-session.native.spec.ts` (for example lines 234, 274, 336) runs
  with resolvers that return no overrides, so `mcpServersOverride` is `undefined`. The
  profile-options spec tests a non-empty override only as an expected rejection
  (`codex-chat-profile-options.spec.ts:82`, `codex-chat-host-ports.spec.ts:202-206`).
- Fix direction (not applied): treat these user HTTP MCP overrides like Ptah MCP on Codex. Strip
  them in the Codex branch, with an info line such as `mcp-overrides-not-attached`, or map them
  to Codex App Server MCP config if that is in scope. Do not fail the open. Add a
  `launchSdkSession` test where the Smithery or OAuth resolver returns one entry and the runtime
  is Codex.
- Next keys to check: a non-default `mcpToolProfile`, `thinking`, and `outputStyleName` are
  still rejected (lines 49 and 59). `outputStyleName` comes from
  `outputStyleActivation.resolveSessionFields` (`chat-session.service.ts:950-952, 980`) when the
  flag tier is active. `thinking` comes from the renderer options. Check both against real user
  setups before the next run, so the run does not fail on the next key.

### M1 (minor): `RPC: chat:start success` is logged for a failed native start

`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:195-196` logs `success` after
any resolved result. `ChatSessionService.codexFailure()` (`chat-session.service.ts:532-567`)
returns `{ success: false, errorCode: 'CODEX_UNSUPPORTED_OPTION' }` and does not throw, so the
log says "success" and "succeeded" for a failed start. The spec
`chat-rpc.handlers.spec.ts:162-168` covers only the rejected-promise path. The UI is correct.
Only the log line is misleading.

### M2 (minor): the session card labels a local option rejection "api error"

The rail card shows `api error` (`shots\a-after.png`, `shots\e-after.png`). This failure is a
local configuration guard, not a provider API error.

### D4 (LOW, still present): saving to workspace scope also writes a global key

After Reassign > Save ("This workspace"), `sdiff.js` showed 4 changes. Three were under
`app.electron.workspace.0f0276bbdfb12dd0.*` (`authMethod`, `anthropicProviderId`,
`provider.thirdParty.openai-codex.selectedModel = "gpt-5.6-luna"`). One was the global key
`provider.openai-codex.mainAgent.modelTier.opus = "gpt-6.1-sol"`. The backup restore undid it.

### Environment note: only one Ptah Dev instance can run on this machine

`main.ts:62-66` forces the `Ptah Dev` userData path and requires the single-instance lock, so a
live test cannot run while any other worktree's dev app is open. The first launch quit with exit
0 and no message after `DevTools listening`. Its argv may have gone to the other instance through
`second-instance`.

## Scenario f: shutdown

The window was closed with `window.close()` from the renderer. `launch.js` exited with code 0,
and no worktree `electron.exe` was left running, so `taskkill` was not needed. The shutdown tail
shows `[AgentProcessManager] Disposing all agents... {"agents":0}`, `Copilot SDK adapter
disposed` and `[PtahCliRegistry] disposeAll()`, with no errors and no hang. No Codex scope
disposal line appears, because D6 fails before `createScope`. Native scope disposal is still not
exercised. After exit, `tasklist` showed no `codex` process except the pre-existing system
service `codex-windows-sandbox-service.exe` (PID 31876, session Services, present before launch).

## Paid turns

0 of 10. No Codex or Claude model request was made: the App Server never started, and the legacy
SDK query did not run.

## Settings restore

`~/.ptah/settings.json` was restored from `settings.json.bak` after the app exited.
`cmp` result: identical (exit 0).

## To re-run after the D6 fix

Close any other Ptah Dev app first, because of the single-instance lock. Use the same build and
launch steps. Set Reassign to GPT-5.6-Luna, then Disable Autopilot (the chip shows Manual) before
the first send. The full budget of 10 turns remains.
