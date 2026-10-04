# Visual B-0 Report - BEFORE screenshots (base 21c27d17f)

Status: COMPLETE. All four screenshots captured from the real `ptah-extension-webview` bundle built at the base commit.

## Source and viewport

- Base checkout: `D:\projects\ptah-extension\.claude-worktrees\task-609-before` (detached, `git log -1` = `21c27d17f`, `git status` clean after the run; nothing edited in either checkout).
- Viewport: 1280x800 (Chromium, Playwright), full screenshot of the viewport (not full-page). Use the same for AFTER.
- Themes: dark = `anubis`, light = `anubis-light` (via `data-theme` + `data-theme-mode` on `<html>`, set after boot; the stylesheet follows the attribute).

## Commands

1. Build (from the base checkout; output `dist/apps/ptah-extension-webview/browser`, development configuration):
   `npx nx build ptah-extension-webview --configuration=development`
2. Capture (from the base checkout; Playwright Chromium was already installed):
   `B0_OUT=<task>/screenshots npx playwright test -c <task>/b0-capture/playwright.config.mjs`
   - Config and spec live in `b0-capture/` in the task folder (outside the base checkout). The spec imports the harness helpers (`test-fixtures`, `postmessage-bridge`, `csp-stub`) from the checkout by absolute path and sets `test.use({ useAppBuild: true })`, so the harness's fixture server serves the built bundle. `b0-capture/package.json.disabled` (rename to `package.json`, content `{"private":true,"type":"module"}`, only while running; it is disabled because a nameless package.json breaks the Nx project graph) is needed for the harness's `import.meta`.
   - The pattern (in-page RPC auto-responder, `ptahConfig` with `isElectron: true`, `switchView` inject) is copied from `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts`. `isElectron: true` is required because the Library tab is Electron-only.
   - Re-run result: 4 passed (about 11 s).
3. Servers: the fixture server is started and closed by the Playwright worker; no dev servers or background processes left running.

## Files (all under `screenshots/`)

| File | State |
| --- | --- |
| `before-agents-dark.png` | Thoth > Skills > Library > Agents tab, 6 agent cards (clone, diverged, authored, synth; per-card actions Enhance now / Revert / Rebase to upstream / Keep mine; "Rebase all diverged (1)" toolbar visible) |
| `before-agents-light.png` | same, light |
| `before-wizard-dark.png` | Setup wizard step 4 "Select", 5 recommended agents preselected, "Generate 5 Agents" button visible (scrolled into view) |
| `before-wizard-light.png` | same, light. Footer visually confirmed.|

Wizard path used: `switchView` setup-wizard, Welcome step, "Use" a saved analysis (fixture `wizard:list-analyses`, `wizard:load-analysis`, `wizard:recommend-agents`), "Yes, Continue", Select step.

## Gaps and caveats

- All data is fixture data (RPC auto-responder); no real backend. Methods not in the fixtures stay unanswered, so the Memory/Schedules/Messaging sidebar tiles read "Unavailable" and the top-left logo image is broken (no assets served). These are identical before and after if the same script is reused.
- Agent cards show the base-commit actions only. The base has no provider chips, Sync, quarantine panel, model section, or wizard preview modal, which is expected for BEFORE.
- Agents screenshots show the first two card rows; lower cards (software-architect, code-logic-reviewer, visual-reviewer, senior-tester) are below the fold at 1280x800.
- The light screenshots were produced by flipping the `data-theme` attribute after boot rather than via a persisted theme; the rendered palette is the `anubis-light` theme, but the AFTER run must use the same method for a fair compare.
- To reproduce AFTER: copy `b0-capture/`, repoint the three absolute import paths and the build at the feature worktree, change output filenames from `before-` to `after-`, and add the new modal/panel steps.
