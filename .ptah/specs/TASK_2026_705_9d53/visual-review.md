# Visual Review (AFTER) - TASK_2026_705

Head under review: refactor/remove-single-layout @ 1264d3d41. Baseline: `visual-before.md` (base 15fe6031a). After PNGs: `screenshots/after/`. Before PNGs: `screenshots/before/`.

## Method

- Rebuilt from this worktree, one at a time: `npx nx build-dev ptah-electron` then `npx nx copy-renderer-dev ptah-electron` (which runs `nx build ptah-extension-webview -c development` and copies the renderer). Both dist dirs were timestamped fresh (22:06) before capture.
- Electron: real app via Playwright `_electron`, private user-data dir `.electron-userdata/` inside the task folder (deleted at the end; Electron process count confirmed 0). Content size forced to 1424x835 (`setContentSize`, screenshot `scale: 'css'`); output PNGs are 1424x835, the same as before. Theme via persisted state + `localStorage['ptah-theme']`; `data-theme` printed per shot (anubis / anubis-light, all correct). 'Single' shots set `localStorage['ptah-layout-mode']='single'` before boot.
- VS Code webview: same headless-Chromium emulation as before (stubbed `acquireVsCodeApi`, `ptahConfig.isVSCode`, local static server, network aborted). 1280x800 and 420x800, dark and light, empty and with 3 sessions created through the real "New session" UI. "Stale single stored" = `ptah-layout-mode=single` set via init script before boot. The Canvas-toggle click step was dropped from the script (button no longer exists).
- Scripts: `capture/electron-after.mjs`, `capture/webview-after.mjs`, `capture/header-check.mjs` (header focus and contrast). Before scripts untouched.
- Header geometry check: bounding boxes of all header buttons in every webview shot, pairwise overlap test, and document horizontal overflow test.

## Checks (all 24 shot states)

| Check | Result |
| --- | --- |
| `ptah-tab-bar` in DOM (Electron x4, webview x16) | 0 everywhere |
| "Toggle canvas grid / single chat" button | 0 everywhere |
| Canvas grid visible with stale `'single'` stored (Electron + webview) | yes, always; storage key stays `single` and is ignored |
| Header buttons overlapping each other (wide + narrow, all themes) | none |
| Horizontal overflow (420 and 1280) | none |
| Header row layout | Intact. The "Orchestra Canvas" static label (`app-shell.component.html:211-214`, `flex-1 min-w-0`) now sits directly after Marketplace (wide: after x=418; narrow: after the 5 icon buttons, x~176-270) and is not clipped or overlapping the pop-out button at 420px. The former toggle slot is simply gone; the freed 66px at wide just widens the flex spacer |
| Rail, focus header, session inspector | Render in all populated shots (wide grid, wide stored, narrow); empty board shows "No sessions on this board" plus the setup card |
| Header focus ring | 2px solid outline on Tribunal, Tasks, Marketplace, Open in editor tab, New Session, dark `oklch(0.77 0.14 91)`, light `oklch(0.48 0.12 70)`; `:focus-visible` true. Evidence: `vscode-wide-header-focus-dark.png`, `-light.png` |
| Contrast, header label "Orchestra Canvas" (12px) | dark 5.71:1, light 5.48:1 (WCAG AA 4.5:1 normal text: pass) |
| Contrast, Settings | dark 14.03, light 14.44 (pass) |
| Target size (WCAG 2.2 AA 2.5.8, 24x24) | header buttons 24px high; icon-only buttons at 420px are 24-26px wide, New Session is 22x24 at narrow (2px short in width, see finding 2) |

## Before / after per surface

| Surface | Before | After | Result |
| --- | --- | --- | --- |
| Electron grid dark | electron-grid-dark.png | electron-grid-dark.png | Same layout; no tab bar, no toggle. Session count differs (profile data), not a regression |
| Electron grid light | electron-grid-light.png | electron-grid-light.png | Same |
| Electron single-stored dark | electron-single-stored-dark.png | electron-single-stored-dark.png | Renders the canvas, identical to grid, as before |
| Electron single-stored light | electron-single-stored-light.png | electron-single-stored-light.png | Same |
| VS Code wide grid empty dark/light | vscode-wide-grid-{dark,light}-empty.png | same names | Toggle removed; label shifted left; rest identical |
| VS Code wide grid 3 sessions dark/light | vscode-wide-grid-{dark,light}.png | same names | Canvas button gone (it was highlighted before); label moved left to follow Marketplace |
| VS Code wide single-stored dark/light | vscode-wide-single-{dark,light}.png (real single layout with tab bar) | vscode-wide-single-stored-{dark,light}.png | INTENTIONAL change: now the canvas, no tab bar, no sliver of header chrome |
| VS Code narrow grid empty + 3 sessions dark/light | vscode-narrow-grid-{dark,light}[-empty].png | same names | Header has one less button; label gains space, no clipping |
| VS Code narrow single-stored dark/light | vscode-narrow-single-{dark,light}.png (squeezed tab bar) | vscode-narrow-single-stored-{dark,light}.png | INTENTIONAL: canvas replaces the squeezed tab bar; this removes the previously cramped state |

Extra after shots: `vscode-{wide,narrow}-single-stored-{dark,light}-empty.png` (stored single, no sessions), `vscode-wide-header-focus-{dark,light}.png`.

## Findings

No visual-breaking or serious issue introduced by this change.

1. Moderate, pre-existing and not caused by the task (not compared against base pixel-for-pixel): in the light theme the active "Dashboard" header item (accent text, 11px) measures 3.73:1, below the 4.5:1 AA threshold for normal text. Evidence: `vscode-wide-grid-light.png`, `header-check.mjs` output. Dark is 8.32:1.
2. Moderate, pre-existing: at 420px the "New Session" icon button is 22x24 CSS px (WCAG 2.2 AA minimum is 24x24, has a 2px spacing allowance via neighbours but is borderline). Evidence: `vscode-narrow-grid-dark.png`, bbox from `webview-after.mjs` log.
3. Moderate (unconfirmed): the "Change theme" trigger reports a transparent 2px outline while `:focus-visible` is true, so the ring may not be visible; the same control exists at base. Evidence: `header-check.mjs` output. Worth a manual look; not a regression from this task.
4. Minor: stale `ptah-layout-mode=single` is left in localStorage rather than cleaned up. Harmless (ignored on boot), observed in `layoutKey` logs.

## Verdict

Verdict: APPROVED, 9/10.

The tab bar and Canvas toggle are gone in both hosts, the header collapses cleanly with no overlap or overflow at 1280 and 420 in either theme, the stale 'single' key renders the canvas everywhere, and focus and contrast of the remaining header controls match the before state. One point withheld for the pre-existing light-theme Dashboard contrast and the unconfirmed theme-trigger focus ring.

## Caveats

- Webview shots are a browser emulation (no host data, broken logo image, no network fonts), as in visual-before.md. 420px is an audit width, not a support contract.
- Electron session names/counts vary with the private profile and timing; status line text varies too.
- Chrome-only; no other browsers were run. No source file under libs/ or apps/ was edited; no state-changing git commands were run.
