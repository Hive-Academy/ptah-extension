# Live Electron test p8b: P8 Codex App Server chat after fix round 8f (head c16226865)

Date: 2026-10-26. The user approved this run. It was test and report only, with no source edits.

- Evidence folder: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8b-20261026-203740\`
  - `electron.log` (main-process stdout/stderr), `build.log`, `build2.log`
  - `shots\` (screenshots), `settings.json.bak` (settings backup), Playwright scripts `*.js`
  - test DBs `ptah.db`, `sessions.db`; workspace `ws\` (a copy of the p8 workspace)
- Build: `build-dev` (exit 0), `copy-wasm.js` (exit 0), `copy-renderer-dev` (exit 0).
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP port 9335, fresh DB files, workspace `ws\`.
- Main agent set through the UI: Settings > Reassign > OpenAI Codex, model GPT-5.6-Luna, saved to
  "This workspace". The card showed `PROVIDER: OpenAI Codex MODEL: gpt-5.6-luna`
  (`shots\reassign.png`).
- Permission was set before any turn. The composer chip showed "Full Auto (YOLO)". The test
  clicked "Disable Autopilot", and the chip then showed `Approval mode: Manual`
  (`shots\perm-menu.png`, `shots\perm-after.png`).

## Result: FAIL at scenario a. The native open is rejected by the host profile option guard

| Scenario | Result | Evidence |
| --- | --- | --- |
| a. "Reply with the word OK." | FAIL | `shots\a-after.png`, log below |
| b. Approval, Allow | NOT RUN (stopped after a) | - |
| c. Approval, Deny | NOT RUN (stopped after a) | - |
| d. Cancel running turn | NOT RUN (stopped after a) | - |
| e. New session, one send | NOT RUN (stopped after a) | - |
| f. Normal close | PASS (limited) | `electron.log` tail |

The task said to stop on a failed scenario, so the run stopped after a.

### Scenario a

D1 is fixed: the open no longer fails on the executable guard. D2 is fixed: the cause is now
logged and attached as `[cause]`. The open now fails earlier, in the profile step, before
any scope or App Server process exists. No `codex app-server` was spawned.

```
[DEBUG] RPC: chat:start called: {"tabId":"5ad0977d-...","workspacePath":"...\\ws","sessionName":"Reply with the word OK."}
[INFO] [ptah.main] chat:start - session config: {"mcpServerRunning":true,"mcpPort":51821}
[ERROR] [CodexChatAdapter] runtime-failed: open. Error: Unsupported Codex chat option
    at Object.profile (.../main.mjs:278265:17)            <- codex-chat-host-ports.ts profile()
    at Object.profile (.../main.mjs:283334:36)            <- electron wrapper (verifyBinary)
    at CodexChatAdapter.prepareProfile (.../main.mjs:81003:39)
    at CodexChatAdapter.open (.../main.mjs:80962:35)
    at CodexChatAdapter.startChatSession (.../main.mjs:80934:17)
    at RoutingAgentAdapter.startChatSession (.../main.mjs:79918:83)
    at async ChatSessionService.launchSdkSession (.../main.mjs:277036:20)
[ERROR] RPC: chat:start failed CodexChatAdapterError: Codex chat open: runtime-failed ... code: 'runtime-failed', [cause]: Error: Unsupported Codex chat option
[WARN] RpcHandler: Method "chat:start" returned user error (SESSION_ENDED): Codex chat could not start.
[ERROR] [renderer] console.error: "[MessageSender] Failed to start chat: Codex chat could not start."
```

UI: "Message delivery failed. Codex chat could not start." The session card and the header now
show `error` (red), and the rail shows "1 error". So D3 is fixed. A minor leftover: the
"Orchestrator" agent chip under the title still shows `done` with a green check
(`shots\a-after.png`).

Legacy marker `[SessionLifecycle] Starting SDK query with options:`: 0 occurrences in the
whole log. `Starting SDK query` also has 0 occurrences.

## Defects

### D5 (BLOCKER): the Codex profile guard rejects keys that `chat:start` always sends

- Throw site: `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:164-167`.
  `profile()` throws `Unsupported Codex chat option` for any defined config key that is not in
  the `supported` allow-list (lines 96-113).
- Caller: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:915-942`
  (`launchSdkSession`) always builds the config with:
  - `mcpServerRunning`: `true` in this run (the log shows `"mcpServerRunning":true`).
  - `workflowsDisabled`: always a boolean (`resolveWorkflowsDisabled()` at line 1849 returns
    `false` by default).

  Neither key is in `supported`. It then spreads `...config` into `startChatSession` (line 951).
  As a result, every Electron `chat:start` on the Codex runtime fails. Other keys that can be
  defined and are also not allow-listed: `mcpServersOverride`, `thinking`,
  `includePartialMessages`, `outputStyleName`, `mcpToolProfile`, `ptahUiFence`.
- Diagnosability: the error does not name the rejected key. Include the key name in the message
  (it is not secret).
- Fix direction (not applied): decide per key whether the Codex path ignores or maps it. For
  example, `mcpServerRunning` and `workflowsDisabled` are host flags. Strip them in the Codex
  branch of `launchSdkSession`, or allow-list them in the guard. Add a test that drives
  `profile()` with the real config shape built by `launchSdkSession`. The unit tests clearly use
  a narrower config than production does.

### D4 (LOW, still present): saving to workspace scope also writes a global key

After Reassign > Save ("This workspace"), `sdiff.js` showed the same 4 changes as in p8. Three
were under `app.electron.workspace.07005389a8e8b5da.*`, and one was the global key
`provider.openai-codex.mainAgent.modelTier.opus = "gpt-6.1-sol"`. The backup restore undid it.

### Minor: the Orchestrator chip shows `done` after a failed start

The session and header state are correct (`error`). Only the agent chip still shows `done`.

## Scenario f: shutdown

The window was closed with `window.close()` from the renderer. `launch.js` exited with code 0,
and no worktree `electron.exe` was left running, so `taskkill` was not needed. The shutdown tail
shows `AgentProcessManager` disposal and `PtahCliRegistry disposeAll()`, with no errors and no
hang. No Codex scope disposal line appears, because no scope was ever created (D5 fails before
`createScope`). So native scope disposal is still not exercised.

## Paid turns

0 of 10. No Codex or Claude model request was made: the App Server never started, and the legacy
SDK query did not run.

## Settings restore

`~/.ptah/settings.json` was restored from `settings.json.bak` after the app exited.
`cmp` result: identical (exit 0).

## To re-run after the D5 fix

Use the same build and launch steps. Set Reassign to GPT-5.6-Luna, then Disable Autopilot
(the chip shows Manual) before the first send. The full budget of 10 turns remains.
