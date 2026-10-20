# Populated Electron attention capture

## Run

From `D:/projects/ptah-extension/.claude-worktrees/attention-notifications` in PowerShell, after announcing the shared-machine build and capture:

```powershell
npx nx build ptah-electron --parallel=1
node apps/ptah-electron/scripts/copy-renderer.js
node .ptah/specs/TASK_2026_593_7c2e/visual-check/shoot-populated.cjs
```

The Electron main entry is `dist/apps/ptah-electron/main.mjs`; the copy step puts the renderer in `dist/apps/ptah-electron/renderer` (`apps/ptah-electron/project.json:10-25,274-285,324-329`). The script refuses an absent entry or occupied port 9347.

## Changes after the unusable first run

The script now passes its private temporary Git folder as the first positional Electron argument. This is the real-RPC e2e fixture's workspace opening mechanism (`apps/ptah-electron-e2e/src/support/real-rpc-fixtures.ts:259-268`); `bootstrapElectron` resolves it before the renderer starts (`apps/ptah-electron/src/activation/bootstrap.ts:249-264`). The old post-load `get-startup-config` override had left the Welcome screen visible. A hard gate now waits for the visible New Session button and Orchestra Canvas label and rejects the Welcome screen before captures.

The app uses private `PTAH_DB_PATH`, `APPDATA`, `LOCALAPPDATA`, `HOME`, `USERPROFILE`, and Electron userData paths. `PTAH_E2E=1` matches `apps/ptah-electron-e2e/src/support/electron-launcher.ts:107-115`; home isolation follows `real-rpc-fixtures.ts:34-46`. Only the captured Electron PID can be killed. The script retains the process handle before `app.close()`; each cleanup action has its own error guard. `capture-results-2.json` is written in `finally`, with `ok` and notes for every attempted shot. Existing target PNGs are removed before recapture, so a failed shot cannot be mistaken for a fresh success.

The theme picker is clicked in the UI (`libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:13-40,71-84,127-129`). Each capture checks `<html data-theme>` and `data-theme-mode`, which `ThemeService` applies (`libs/frontend/core/src/lib/services/theme.service.ts:185-195`). Escape and an outside click close the DaisyUI focus dropdown, followed by a hidden-menu check. The old check matched the picker button's `data-theme` even when the document stayed dark. Viewport and panel steps are guarded so a failure does not skip the `panel-clear-all` or `800` attempt.

## Routed messages

All injections use `app.evaluate(({ BrowserWindow }, msg) => BrowserWindow.getAllWindows()[0].webContents.send('to-renderer', msg), msg)`, as in `apps/ptah-electron-e2e/src/support/ui-driver.ts:350-354`. The production renderer does not expose `window.ng`.

| State | Payload | Source |
| --- | --- | --- |
| Chat permission | `permission:request` with `{ id: uuidV4, toolName: 'Bash', toolInput: { command: 'git status' }, description: 'Run git status', timestamp: now, timeoutAt: now + 120000 }`. The extra live shot adds the created tile's `tabId: uuidV4`. `permission:auto-resolved` uses `{ id, toolName: 'Bash' }`. | `libs/shared/src/lib/types/permission.schemas.ts:18-38`; `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:315-326,337-343` |
| Ask user | `ask-user-question:request` with `{ id: uuidV4, toolName: 'AskUserQuestion', questions: [{ question, header, options, multiSelect: false }], timestamp: now, timeoutAt: now + 120000 }`; resolved with `ask-user-question:auto-resolved` `{ id, answers: {} }`. | `libs/shared/src/lib/types/permission.schemas.ts:71-89`; `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:871-883` |
| CLI lane | `agent-monitor:permission-request` with `{ requestId: uuidV4, agentId, kind: 'shell', toolName: 'Bash', toolArgs: '{"command":"git status"}', description, timestamp, timeoutAt }`. | `libs/shared/src/lib/types/agent-permission.types.ts:26-49`; `libs/frontend/chat/src/lib/services/agent-monitor-message-handler.service.ts:37-69` |
| Voice failure | `voice:providerError` with `{ direction: 'tts', providerId: 'cloud', category: 'network', message: 'Voice provider unavailable' }`. | `libs/shared/src/lib/types/messages/voice.ts:28-33`; `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts:37-56` |
| Baseline request notices | `attention:changed` upsert `{ change: 'upsert', notice: { key, generation, kind, title, occurredAt, target: null } }`; resolve `{ change: 'resolve', key, generation }`. | `libs/shared/src/lib/types/messages/schemas.ts:17-41`; `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:76-92,173-202` |

The baseline permission, question, lane and stack screenshots use projections for stable visible notices. Their `target: null` disables Open. Raw permission and question events are also sent and immediately resolved. A raw lane event has no `agent-monitor:spawned` owner, so its baseline shot is a projected lane notice.

The script creates a real canvas tile through New Session → Create (`libs/frontend/chat/src/lib/components/templates/app-shell.component.html:250-312`; `app-shell.component.ts:405-416`; `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:373-383`). It reads `[data-rail-card][data-tab-id]`, validates the UUID v4, then sends one real `permission:request` addressed to that tab. The new tile has no Claude backend session ID yet, so `sessionId` is omitted. The Electron window is blurred before delivery because visible owned tabs suppress snackbars while focused (`libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:97-103`). `snackbar-permission-live` requires visible, enabled Allow, Deny and Open actions; failure is recorded if tile creation, blur or routing fails.

The failure shot is a real voice-provider notification. A fresh tile has no backend failed turn, so the script no longer sends an unrelated synthetic `session:turnFailed`; terminal pulses require a matching session (`libs/frontend/chat/src/lib/services/chat-failed-turn-attention.service.ts:29-48`). `git:status-update` refreshes Git UI (`libs/frontend/chat/src/lib/services/change-set/change-set.store.ts:258-259,379-383`) and no attention warning producer was found, so no Git warning shot is claimed.

For each theme, the script attempts `snackbar-permission`, `snackbar-question`, `snackbar-lane`, `snackbar-failure`, `snackbar-stack`, `bell-badge`, `panel`, `panel-clear-all`, `panel-empty`, `800`, and `snackbar-permission-live`. The `800` shot is 800 × 900; the others are 1440 × 900. Clear all notices hides recent failures but leaves live requests, then the script resolves those requests to capture All clear (`libs/frontend/notification-center/src/lib/notification-center.component.ts:50-60`). Inspect both the screenshots and JSON before accepting the run. No build, Electron launch, or test was run while revising these files.
