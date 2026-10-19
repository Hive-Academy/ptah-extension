# Visual BEFORE captures - TASK_2026_705 (base 15fe6031a, no code changes)

PNGs live in `screenshots/before/` in this task folder. Capture scripts are in `capture/` (`electron.mjs`, `webview.mjs`). The Electron user-data dir was private (`.electron-userdata/`) and has been deleted; Electron was closed fully.

## How each host was rendered

- Electron: real app from this worktree (`nx build-dev ptah-electron` + `copy-renderer-dev`), launched through Playwright `_electron` with the worktree as the workspace and a private user-data dir. Window content area 1424x835. Theme set via persisted state plus `localStorage['ptah-theme']` (`anubis` = dark, `anubis-light` = light); `data-theme` was verified for every shot.
- VS Code webview: it cannot be rendered inside VS Code here, so the real `ptah-extension-webview` bundle (`nx build ptah-extension-webview -c development`) was served from a local static server in headless Chromium, using the same approach as `libs/frontend/webview-e2e-harness` (stubbed `acquireVsCodeApi`, `ptahConfig` with `isVSCode: true` and no `isElectron`, so `ptah-app-shell` mounts, as in `vscode-shell/vscode-host.ts`). No extension-host replies, so no real data (empty analytics, the logo image is broken, and there are no fonts from the network). Sessions were created through the real "New session" UI. The single layout was reached by clicking the real "Toggle canvas grid / single chat" (Canvas) button, which wrote `ptah-layout-mode=single`.

## Key finding for R9

In Electron at base, the 'single' layout is NOT reachable: with `localStorage['ptah-layout-mode']='single'` stored, the app still renders the canvas grid and no `ptah-tab-bar` is mounted (boot pin to grid, risk R7). The `electron-single-stored-*` shots prove this (identical to the grid shots). The tab bar and the Canvas toggle exist only in the VS Code webview host.

## PNG list

| File | Host | Layout | Theme | Viewport | Shows |
| --- | --- | --- | --- | --- | --- |
| electron-grid-dark.png | Electron | canvas grid (default) | dark (anubis) | 1424x835 | Global navbar, workspace sidebar, Rail with session cards, focus header, chat, session inspector docked right, no shell header and no tab bar |
| electron-grid-light.png | Electron | canvas grid | light (anubis-light) | 1424x835 | Same as above, light theme |
| electron-single-stored-dark.png | Electron | `'single'` stored in localStorage, still renders grid | dark | 1424x835 | Evidence that Electron ignores stored 'single': canvas grid, no `ptah-tab-bar` |
| electron-single-stored-light.png | Electron | `'single'` stored, still renders grid | light | 1424x835 | Same, light theme |
| vscode-wide-grid-dark-empty.png | VS Code webview | grid, no sessions | dark | 1280x800 | Header row (Dashboard, Thoth, Tribunal, Tasks, Marketplace, Canvas toggle, "Orchestra Canvas" label, New, Theme, Settings), empty board with "No sessions" |
| vscode-wide-grid-light-empty.png | VS Code webview | grid, no sessions | light | 1280x800 | Same, light |
| vscode-wide-grid-dark.png | VS Code webview | grid, 3 sessions | dark | 1280x800 | Canvas toggle active (highlighted), "Orchestra Canvas" label in the tab-bar slot, Rail, focus header, inspector |
| vscode-wide-grid-light.png | VS Code webview | grid, 3 sessions | light | 1280x800 | Same, light |
| vscode-wide-single-dark.png | VS Code webview | single (after clicking Canvas toggle) | dark | 1280x800 | `ptah-tab-bar` with scroll chevrons and session tabs in the header, Canvas toggle inactive, single chat with session header, inspector, input |
| vscode-wide-single-light.png | VS Code webview | single | light | 1280x800 | Same, light; active tab has the accent underline |
| vscode-narrow-grid-dark-empty.png | VS Code webview | grid, no sessions | dark | 420x800 | Narrow header (icon-only buttons), empty board |
| vscode-narrow-grid-light-empty.png | VS Code webview | grid, no sessions | light | 420x800 | Same, light |
| vscode-narrow-grid-dark.png | VS Code webview | grid, 3 sessions | dark | 420x800 | Narrow canvas grid with sessions |
| vscode-narrow-grid-light.png | VS Code webview | grid, 3 sessions | light | 420x800 | Same, light |
| vscode-narrow-single-dark.png | VS Code webview | single | dark | 420x800 | Icon-only header with a squeezed tab bar (chevron plus a sliver of a tab), session header, chat |
| vscode-narrow-single-light.png | VS Code webview | single | light | 420x800 | Same, light |

## Caveats

- Webview shots are a browser emulation of the webview, not VS Code itself: no host messages, broken logo image, no network fonts. The shell components, tab bar, toggle and canvas are the real ones. 420px is an audit width for the narrow VS Code side panel, not a documented support contract.
- Session names are timestamp-based (`session-10-19-18-4x`); the Electron profile accumulated extra sessions across capture runs.
- A Thoth onboarding toast was dismissed before the webview shots. In the Electron shots the status line reads "Syncing skills and agents" or "No new sessions to import" depending on run timing.
- `git status` shows ` M .gitignore` in the worktree; it was not made by this capture. `.ptah/specs/TASK_2026_705_9d53/` is untracked and `.electron-userdata/` is not git-ignored (a `!.ptah/specs/**` rule), which is why it was deleted. Nothing was committed and no source file was edited.
