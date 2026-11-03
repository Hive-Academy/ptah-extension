# Visual Review - TASK_2026_865_2a1d

## Before (TASK_2026_865 pre-step)

Baseline captures of the existing `AuthRequiredBannerComponent` (`libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts`), rendered by `chat-view.component.html:147-156` when `AuthStateService.flagAuthRequired()` has set the banner. This branch has no renderer changes, so the worktree UI equals the base.

### Method

- Host: the REAL Electron app (Playwright `_electron.launch`, Electron renderer from `apps/ptah-extension-webview`), not a VS Code host and not headless Chromium.
- Build served: `/home/amun/ptah-extension/dist/apps/ptah-electron` (main checkout `main.mjs` and renderer, built 2026-11-03 about 13:43-13:45, before this task). The worktree has no `dist/` or `node_modules`, so the main checkout's build and the main checkout's e2e harness (`apps/ptah-electron-e2e/src/support/fixtures.ts`, `UiDriver`) were reused. The banner component is unchanged on this branch, so this build is a valid base for the banner.
- Isolation: the harness launcher uses a temp `--user-data-dir` and a temp `PTAH_DB_PATH`. `~/.ptah/state` and the real provider/auth settings were not touched.
- Mocked state (via `UiDriver.mockRpc`, an IPC `rpc` listener in the Electron main process):
  - `chat:start` returns `{ success: false, errorCode: 'AUTH_REQUIRED', error: 'Your OpenAI Codex sign-in has expired. Re-authenticate in a terminal to continue.', providerId: 'openai-codex' }`
  - The harness's default mocks cover workspace/auth status (`apiKey`).
  - Flow: `ui.goto('chat')`, type "hello" into `ptah-chat-input textarea`, press Enter. `MessageSender.handleAuthRequired` then calls `flagAuthRequired`, and the banner appears.
- Themes: `anubis` (dark) and `anubis-light` (light), set through `rpcBridge.setState({'theme-v2'})` plus `localStorage['ptah-theme-v2']`, then reload. `data-theme` was asserted to match.
- Command, run under the machine lock:
  `cd /home/amun/ptah-extension && NODE_PATH=/home/amun/ptah-extension/node_modules node scripts/verify.mjs --exec --task screenshots-before -- npx playwright test --config=/tmp/shots-before/playwright.config.ts`
  Result: 2 passed.
- Spec source (copy, saved as .txt so it is not picked up as a test): `screenshots/before/_capture.spec.ts.txt`. The original and its config are in `/tmp/shots-before/`.
- No repo source files were edited.

### Screenshots (`.ptah/specs/TASK_2026_865_2a1d/screenshots/before/`)

| File | Shows |
| --- | --- |
| `chat-view-auth-banner-dark.png` | Full Electron window, anubis dark theme. Chat tile with the failed turn, the banner above the composer. |
| `banner-closeup-dark.png` | Banner element only (752x59 px), dark. |
| `chat-view-auth-banner-light.png` | Full Electron window, anubis-light theme. |
| `banner-closeup-light.png` | Banner element only (752x59 px), light. |

What the banner looks like today (verified by viewing the light full-window and dark close-up images):
- A single compact bordered card with a warning-tinted border, positioned directly above the chat composer.
- Header row: key icon, "Authentication required", then a primary button "Re-authenticate in terminal" (provider `openai-codex`; otherwise "Open Settings") and an X dismiss button.
- Below the header: the message text in muted small text.
- There is no carry-over or switch-provider affordance yet, which is what the task adds.
- Also visible: the transcript shows "Message delivery failed. <message>" as an assistant turn.

### Limits

- The Electron main process is real, but the backend is mocked. Only `chat:start` and the harness defaults were mocked, so there is no real provider, token or session.
- The window size is the Electron default (about 1200x775). No viewport sweep was done, since this is a baseline pair.
- The themes captured are `anubis` and `anubis-light`, the two eager themes. The default `ptah-glass` was not captured.
- The dark full-window PNG was captured, but only the dark close-up and the light full-window were visually inspected here.
- The build is the main checkout's `dist` at build time, not a rebuild from this worktree. The "after" run must rebuild from the worktree (or a branch with renderer changes) and use the same spec for a like-for-like comparison.
