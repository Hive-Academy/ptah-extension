# Fix Round 1 Review — Electron motion emulation (D2)

Review family: reviewer claude, implementer codex

Score: 4/10
Verdict: REVISE

## Write-path trace
- `settings:setMotion` (settings-rpc.handlers.ts:137-148) validates with zod, then `workspaceProvider.setConfiguration('ptah','motionPreference')`. The value goes to userData `config.json` (not `~/.ptah/settings.json`). `readMotionPreference` (motion-preference.ts:16) reads the same file, so the paths agree. Invalid or missing values fall back to `always`, with a degradation-audit comment (OK).
- main.ts:66 reads the preference once at startup. main.ts:117 registers `browser-window-created` before any window exists (OK).
- `installMotionEmulation` (motion-emulation.ts:17-49): `always` emulates `no-preference`, `reduce` emulates `reduce`, `system` returns early so the OS value stays (OK). It reapplies on `did-start-navigation`, `did-finish-load` and `devtools-closed`, and once at construction. New windows and reloads are covered.
- Errors reach the Logger once the container exists, `reportBootFailure` on a failed boot, and a queue before that (main.ts:106-114, 228-237). No silent swallow.
- Not run: the Electron app, so renderer `matchMedia` and the CSS were not observed.

## Defects
1. BLOCKING — motion-emulation.ts:28 together with electron-browser-capabilities.ts:509-529. The browser tool creates a `BrowserWindow`, which fires the global `browser-window-created`. The motion handler attaches the debugger first. Default is `always`, so emulation is active by default. The tool's own `debugger.attach('1.3')` then throws "already attached". It catches that, destroys the window and throws "Failed to attach debugger", so the browser tool is broken in the default configuration. Fix: skip the browser tool's window, for example by partition `ptah-browser-tool` or an opt-out marker. Alternatively, have the tool tolerate an attached debugger and use `isAttached()`. Add a regression test.
2. SERIOUS — motion-emulation.ts:39-43. Every `detach` event is reported at error level. Opening DevTools, `webContents.destroy()` races and the browser tool's cleanup `detach()` all log "Electron motion emulation failed" as errors. Between DevTools opening and closing the override is lost, with no re-attach. Fix: report only unexpected reasons (not `replaced_with_devtools` or `target closed`), downgrade the rest to debug, and re-apply on the next navigation.
3. MODERATE — motion-emulation.ts:44. `did-start-navigation` fires for every subframe and in-page navigation. The code re-sends `setEmulatedMedia` each time, and a failure calls `reportError` each time, so log volume is unbounded. It is also unclear whether emulation survives a cross-process navigation. Fix: gate on `isMainFrame`, and rate-limit or dedupe errors.
4. MODERATE — motion-preference.spec.ts. There is no test for the shared-debugger conflict with the browser tool, the detach reasons, or DevTools behaviour. The unit spec only mocks `webContents`, so it cannot show that renderer `matchMedia` reports the right value. A real Electron check is needed for "Reduce motion" and "Always animate".
5. MINOR — The preference is fixed for the process lifetime and takes effect only after restart. This is documented, so it is acceptable.

## Verify
`npm run verify -- -p ptah-electron`: 9 tasks succeeded, 9 cached, exit code 0. The cache hit shows the lint, test and typecheck targets pass. It does not cover defect 1, because the real `BrowserWindow` and the browser tool are not exercised.

## Re-review round 1

Review family: reviewer claude, implementer codex

Score: 8/10. Verdict: APPROVED.

1. Browser tool conflict: RESOLVED. `electron-browser-capabilities.ts:509-514` sets `partition: 'ptah-browser-tool'` in the BrowserWindow constructor, so `webContents.session` is already that session when `browser-window-created` fires (`main.ts:124`). `motion-emulation.ts:29` returns early when `contents.session !== session.defaultSession`; its `debugger.attach('1.3')` no longer collides. Main window (`main-window.ts:47`) and Display window (`display-window.ts:133`) set no partition, so both use the default session and still get emulation. `fixtures/shell-security.cjs` is a test fixture only. No other BrowserWindow in apps/ptah-electron or libs/backend.
2. Detach logging: OK. `motion-emulation.ts:53-58` stays quiet for "replaced with devtools" / "target closed" (normalized) and for destroyed contents; other reasons go to warn via `reportWarning`. `devtools-closed` re-applies (`:64`).
3. Navigation: OK. `:59-61` gates on `isMainFrame && !isSameDocument`; `did-finish-load` backs it up. Dedupe keys on message plus cause message, so a new error text is still reported.
4. Tests (`motion-preference.spec.ts:98-152`) assert behaviour: follow-system no-op, browser-tool session skipped, navigation gating, detach reasons and DevTools restore, Error wrapping, dedupe.

Remaining defects (none blocking):
1. Minor, `motion-emulation.ts:31-37`: the dedupe set never clears, so a failure that recurs after a successful apply is silent. Clear it on a successful `sendCommand`.
2. Minor, `motion-emulation.ts:57`: a Display window closed or destroyed mid-detach is suppressed by the `isDestroyed` check, which is right. Warns carry no window identity, which makes multi-window diagnosis harder.
3. Minor, `motion-emulation.ts:45-47`: the `.catch` reports through the callback, so it is not a silent swallow. No degradation-audit comment is needed. A test that a different error after a first one still reports would pin finding 3.

Verify: `npm run verify -- -p ptah-electron` passed, exit 0, 9/9 tasks (lint, test, typecheck), all cache hits.
