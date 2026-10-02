# Req 9.2 Evidence - Electron Apps lazy chunk is not requested until the Apps tab is clicked

## Environment

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-494-qa`, branch `fix/task-494-close-qa`, commit `a90c086d7` (origin/main).
- Real Electron app (not the browser-only substitute), launched via Playwright `_electron.launch` with `dist/apps/ptah-electron/main.mjs`, `NODE_ENV=development`. The main window loads the renderer with `loadFile` (file:// protocol).
- Setup: `node_modules` junctions (prismjs, daisyui, monaco-editor, electron, better-sqlite3) pointing at the root `node_modules`, per the lazy-load-gate.md Environment note.
- Build commands run:
  - `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache` (exit 0)
  - `npx nx build-main ptah-electron --configuration=development --skip-nx-cache`, then `build-preload`, `build-embedder-worker`, `build-voice-worker`, `build-integrity-worker`, `build-state-storage-worker`, `build-workspace-watch-host` (all exit 0)
  - `node scripts/copy-wasm.js dist/apps/ptah-electron`
  - `node apps/ptah-electron/scripts/copy-renderer.js` (copies the production webview into `dist/apps/ptah-electron/renderer`)
- Driver: `.ptah/tmp/req92-driver.cjs` (throwaway, uncommitted). It records Playwright context `request` events, which cover file:// loads, plus `performance.getEntriesByType('resource')`.

## How the Apps chunk was identified (this build)

In `dist/apps/ptah-electron/renderer`:

- `grep -l AppsPageComponent *.js` matched `main.js` and `chunk-bnRXTPxc.js`.
- `main.js` holds only the lazy route reference: `` import(`./chunk-bnRXTPxc.js`).then(i=>i.AppsPageComponent) ``.
- `grep -l "ptah-apps-page\|declarative-dashboard" *.js` matched only `chunk-bnRXTPxc.js`.

The Apps chunk for this build is therefore **`chunk-bnRXTPxc.js`**. The old `chunk-CJCaMDSn.js` name is not used here, as expected from content-derived hashing.

## Before click (cold start, settled on default chat view)

- The app waited for the `Apps` tab to render, then 8 s more.
- Request list: `visual/req-9-2/requests-before-click.txt`. It has 171 request events, 11 of them `chunk-*.js` scripts: `chunk-DnRTbWB9`, `C-uNnTFe`, `BrQXuOh3`, `BH7kxxqo`, `BkdGGdpl`, `D0yWoLZ3`, `29pmPUe_`, `DlML7vIL`, `CCilwPfF`, `DinKK6hE`, `RMCXhirL`.
- **`chunk-bnRXTPxc.js` appears 0 times** in the request events or in the performance resource list.
- Screenshot: `visual/req-9-2/before-click.png` shows the Chat tab active with the Orchestra Canvas.

## After click (Apps tab)

- Request list: `visual/req-9-2/requests-after-click.txt`.
- The only new request after the click is
  `script file:///D:/projects/ptah-extension/.claude-worktrees/task-494-qa/dist/apps/ptah-electron/renderer/chunk-bnRXTPxc.js`.
- Screenshot: `visual/req-9-2/after-click.png` shows the Apps tab active and the Apps page rendered ("No app yet").
- Machine summary: `visual/req-9-2/summary.json`: `beforeHasChunk=false`, `afterHasChunk=true`.

## Caveat

`performance.getEntriesByType('resource')` is not informative for file:// loads. It held only 1 entry (a Google Fonts woff2) in both states, so the evidence rests on the Playwright context request events, which did capture the file:// script loads.

## Artifacts

- `visual/req-9-2/before-click.png`
- `visual/req-9-2/after-click.png`
- `visual/req-9-2/requests-before-click.txt`
- `visual/req-9-2/requests-after-click.txt`
- `visual/req-9-2/summary.json`

## Verdict

**Req 9.2: PASS** - On a cold start in the real Electron app, `chunk-bnRXTPxc.js` (the Apps chunk, which holds `AppsPageComponent`) was not requested while on the chat view. It was requested for the first time on the Apps tab click.
