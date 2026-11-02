# Popover tabs - code logic review

Review family: reviewer claude, implementer codex

Score: 7.5/10 - Verdict: APPROVED (with moderate follow-ups)

## Verify
`npm run verify -- -p @ptah-extension/chat-ui,ptah-extension-webview`: 6 tasks succeeded (6 cached from the lane's identical run), exit 0.

## Requirements
Tabs Themes (default) / Animation, Electron only, no tabs elsewhere, roving tabindex plus Left/Right/Home/End, ids unique via per-instance menuId, aria-controls/labelledby resolve (both panels always in DOM), hidden panel via [hidden], Escape and onDialogKeydown intact (surface-tab branch checked before generic [role=tab], theme-toggle.component.ts onDialogKeydown). Preserved: mode switch, swatch grid, accent, backdrop, motion radios + restart note + error, style picker. Height caps: Electron viewport-8px, others min(viewport, 28rem) in place() and CSS. Not proven in a real render (jsdom only).

## Defects
1. Moderate - theme-toggle.component.ts animation panel (`@if (activeSurface() === 'animation')`): Motion components are destroyed when leaving the tab. "Restart Ptah to apply" note is lost after switching to Themes and back, and the radio shows 'always' until settings:getMotion resolves (wrong-answer flash; user can pick during load, disabled only while saving). Fix: keep mounted (use [hidden] only), or hoist state.
2. Moderate - place() only re-runs on tab change/theme change. Motion load result (error text, restart note) changes panel height after the follow-up, so the popover can overflow the bottom edge/scroll until resize. Fix: re-place after RPC settle (output event) or ResizeObserver.
3. Minor - template for the new tabs is dense/unformatted, and the Animation tab has no tab-specific no-scroll test with real content height at 1186x738 (only placement cap checks).
4. Minor - after click/keyboard tab switch the pending focus is cleared (null); on keyboard switch focus stays on the tab, correct. No defect found there.

## settings:getMotion finding (item 7)
Wiring is correct: method in SettingsRpcHandlers.METHODS (settings-rpc.handlers.ts:88), registered at :126, `settings:` is in ALLOWED_METHOD_PREFIXES (vscode-core rpc-handler.ts:~70), handler included in host-profile manifest (:362), typed in rpc.types.ts:1826 and the method list at :3456. `motionPreference` is not a file-based key, so ElectronWorkspaceProvider.getConfiguration reads config.json in memory and returns undefined -> 'always'; it does not throw on a missing config. setConfiguration persists to config.json, which readMotionPreference in main.ts reads. So in a correctly built Electron main the call cannot fail. It returns {success:false,'unsupported'} only if process.versions.electron is falsy (non-Electron).
Most likely cause of the red text: the running Electron main process is stale (started before these uncommitted handler/allowlist/manifest changes), so the method is "not registered" and RPC returns an error, while the freshly served webview calls it. Restart the dev Electron main (rebuild). Hardening: load() collapses every failure into one string and logs nothing in the renderer; distinguishing "method not found" from handler failure would help diagnosis. Not a code defect in the registered path.

## Re-review round 1

Review family: reviewer claude, implementer codex

Score: 8.5/10. Verdict: APPROVED.

Checks
1. Both panels stay mounted: themes panel always rendered (theme-toggle.component.ts:252-258), animation panel under `@if (isElectron)` only (342-353), each toggled by native `[hidden]` (257, 347). Hidden gives display:none, so no focus and no AT exposure; no CSS sets display on these divs. `ptah-motion-preference` is never destroyed on tab switch, so its radio state and the restart note persist, and getMotion runs once per component instance (spec 142-183). Note: `activeSurface` resets to 'themes' on each open (onBeforeToggle ~517) but the panels stay mounted, so there is still no extra RPC.
2. ResizeObserver (632-645, created in scheduleFollowup at 612 after the first place): guarded by `typeof ResizeObserver === 'undefined'`; callback is gated on menuOpen/destroyed; disconnected in cancelFollowup (627), which runs on close (onBeforeToggle closed branch) and in ngOnDestroy. No loop: it observes the inner panels, while place() writes only the outer popover's width/height/position. The width write can reflow the children once, then place() writes the same value and the observer settles. A tab switch fires the observer through display toggling (one redundant place(), harmless).
3. Tab ARIA, roving tabindex, Left/Right/Home/End, Escape and the non-Electron 28rem cap (place() line ~689) are unchanged.

Defects
1. Minor, theme-toggle.component.ts:259-341: the template inside the themes panel `<div>` is not re-indented, so the "tidy" is only partial. Cosmetic, no behavior impact.
2. Minor, theme-toggle.component.ts:633-635: if the observer is first built when themesPanel is missing it returns early and retries on the next followup. This is fine today because the panel always exists.
3. Minor, no test covers a missing ResizeObserver (the guard at 633 is only exercised by inspection).

Verify: `npm run verify -- -p @ptah-extension/chat-ui,ptah-extension-webview` returned 6 tasks, 6 succeeded (5 cached), exit 0.
