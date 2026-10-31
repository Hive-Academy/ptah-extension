# Live Electron test — P8 Codex App Server chat (PR #823, head b35d78386)

Date: 2026-10-26. Approved by the user. Test and report only; no source edits.

- Evidence folder: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8-20261026-183415\`
  - `electron.log` (main-process stdout/stderr), `build.log`, `build2.log`
  - `shots\` (screenshots), `settings.json.bak` (settings backup)
  - test DBs `ptah.db`, `sessions.db`; workspace `ws\`
- Build: `build-dev`, `copy-wasm.js`, `copy-renderer-dev` all exit 0.
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP port 9335, workspace `ws\`.
- Main agent set through the UI (Settings > Reassign > OpenAI Codex, model
  GPT-5.6-Luna, saved to "This workspace"). The card showed
  `PROVIDER: OpenAI Codex MODEL: gpt-5.6-luna` (`shots\reassign.png`).

## Result: BLOCKED. The native App Server path cannot open on an unpackaged build

| Scenario | Result | Evidence |
| --- | --- | --- |
| a. "reply with the word ok" | FAIL (blocked) | `shots\a-send.png`, `shots\a-after.png`, log below |
| b. Tool approval, Allow | NOT RUN (blocked by a) | - |
| c. Tool approval, Deny | NOT RUN (blocked by a) | - |
| d. Cancel running turn | NOT RUN (blocked by a) | - |
| e. New session, one send | NOT RUN (blocked by a) | - |
| f. Normal close | PASS (limited) | `electron.log` tail |

The run stopped after scenario a, as the task instructed ("stop if the app cannot reach the
App Server path; do not fix code").

### Scenario a

The routing does pick the native adapter (`CodexChatAdapter.open`). The legacy SDK path did
not run: the log has 0 lines with `Starting SDK query`. The open still fails before any App
Server process starts. No `codex.exe app-server` process was spawned.

```
[DEBUG] RPC: chat:start called: {"tabId":"4bafc5d7-...","workspacePath":"...\\ws","sessionName":"reply with the word ok"}
[ERROR] [CodexChatAdapter] runtime-failed: open.
[ERROR] RPC: chat:start failed CodexChatAdapterError: Codex chat open: runtime-failed
    at CodexChatAdapter.open (.../dist/apps/ptah-electron/main.mjs:81076:13)
    at async ChatSessionService.launchSdkSession (...main.mjs:277220:20)
  code: 'runtime-failed', operation: 'open'
[DEBUG] RPC: chat:start success
[ERROR] [renderer] console.error: ... "[MessageSender] Failed to start chat: Codex chat open: runtime-failed"
```

UI: "Message delivery failed. Codex chat open: runtime-failed". The session card and the
header still show `done` with a green dot.

## Defects

### D1 (BLOCKER) — the dev route rejects the only Codex binary an unpackaged build can find

- `apps/ptah-electron/src/activation/bootstrap.ts:539-541`: an unpackaged build gets
  `bundledRoot = path.join(app.getAppPath(), 'node_modules')`. Here that is
  `<worktree>\dist\apps\ptah-electron\node_modules`, and that directory does not exist.
- `resolveCodexNativeBinaryPath()` (`libs/backend/agent-sdk/src/lib/detector/codex-native-binary-path.ts:103-142`)
  resolves `@openai/codex-win32-x64` through `require.resolve`. The result is
  `D:\projects\ptah-extension\node_modules\@openai\codex-win32-x64\...\codex.exe`. The
  worktree's `node_modules` is a junction to the main checkout, so this path is outside the
  worktree as well.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:88-98`
  (`createElectronCodexExecutable`) then throws `Codex executable is outside the host bundle`.
  It is called from `createScope` at line 260, which runs inside `CodexChatAdapter.open`.
  So the `PTAH_CODEX_RUNTIME_DEV=1` route can never open a session on an unpackaged build.
- Confidence: high, but inferred. The real Error is not logged (see D2). The checks behind it:
  `dist/apps/ptah-electron/node_modules` is missing; `require.resolve` returns the main
  checkout path above; no codex process started.
- Fix direction (not applied): in dev, base `bundledRoot` on the realpath of the
  resolved repository `node_modules`. Another option is a dev-only allowance in the guard.
  Either way, the "no global-install fallback" property must still hold.

### D2 (HIGH, diagnosability) — `open` swallows the cause

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:266-275`:
  `catch (error)` logs only `'[CodexChatAdapter] runtime-failed: open.'` and rethrows a
  generic `CodexChatAdapterError('runtime-failed','open')`. The original Error is neither
  logged nor attached as the cause. This made D1 impossible to confirm from the log.
  `cleanupOpen` (lines 362-373) has the same pattern: `catch {}` with a message only.
  The degradation audit flags this pattern (empty catch / lost Error).

### D3 (MEDIUM) — `chat:start` reports success after a failed start

- Log: `RPC: chat:start failed CodexChatAdapterError...` is followed by `RPC: chat:start
  success` and `Method "chat:start" succeeded`. The renderer still shows the failure, through
  a separate error path. The session card and header show `done` (green) instead of an error
  state (`shots\a-after.png`).

### D4 (LOW, observation) — saving to workspace scope also wrote a global key

- After Reassign > Save (scope "This workspace"), `sdiff.js` showed 4 changes. Three were
  under `app.electron.workspace.673ac25f41f6cb89.*` (expected). The fourth was the global key
  `provider.openai-codex.mainAgent.modelTier.opus = "gpt-6.1-sol"`, which was absent before.
  It may be the existing tier-defaults behaviour, but it leaks outside the selected scope.
  Restored by the backup.

### Note — the composer showed "Full Auto (YOLO)"

The new session's composer showed the permission level "Full Auto (YOLO)". Scenarios b and c
need an ask-level permission, so the next run must switch the permission level first.

## Scenario f — shutdown

The window was closed via `window.close()` from the renderer. The process exited with code 0
and no electron.exe was left running, so `taskkill` was not needed. The shutdown log shows
ordered service stops (skill-synthesis, cron, memory-curator, gateway bridge,
AgentProcessManager, WAL checkpoint, `PtahCliRegistry disposeAll()`) and no errors. No
Codex scope disposal line appears, because no scope was ever created (D1). This does not
exercise native scope disposal.

## Paid turns

0. No Codex or Claude model request was made: the App Server never started, and the legacy
SDK query did not run.

## Settings restore

`~/.ptah/settings.json` was restored from `settings.json.bak` after the app exited.
`cmp` result: identical (exit 0).

## To re-run after the D1 fix

1. Rebuild with the same three commands.
2. Set the composer permission to an ask level before b/c.
3. Run scenarios a-f. Remaining budget is all 10 turns.
