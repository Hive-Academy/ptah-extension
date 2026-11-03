# Electron motion preference D2 fix, round 1

## Root cause and evidence

The switch names are valid and were appended before `app.whenReady()` in the prior `main.ts`, so this is neither a misspelling nor a late switch. [Chromium's `gfx::Animation::PrefersReducedMotion()`](https://chromium.googlesource.com/chromium/src/+/refs/tags/140.0.7291.1/ui/gfx/animation/animation.cc#150) explicitly reads both switches. [Blink's `WebViewImpl`](https://chromium.googlesource.com/chromium/src.git/+/158b9ca49448c359813b56e0809ffad6a60f0e26/third_party/blink/renderer/core/exported/web_view_impl.cc#3785) gets its renderer preference from `web_preferences_.prefers_reduced_motion`. The switch's browser animation path therefore does not establish that Electron forwards it to Blink's media query. The D2 [visual review](../TASK_2026_motion_presets/visual-review.md) measured `app.commandLine.hasSwitch(...) === true` yet `matchMedia('(prefers-reduced-motion: reduce)').matches === false`, including with an explicit command-line switch. This supports a renderer propagation failure, not switch removal; the exact Electron native path was not proven from source.

[Electron's debugger API](https://www.electronjs.org/docs/latest/api/debugger) supports `attach` and `sendCommand`; [CDP `Emulation.setEmulatedMedia`](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setEmulatedMedia) supports media-feature overrides. The fix uses that renderer-targeted mechanism.

## Changes

- `apps/ptah-electron/src/main.ts:66,103-119,228-237`: read the persisted value once; install the override for every `BrowserWindow` before its first load; buffer early errors until the injected logger is available and report them on bootstrap failure.
- `apps/ptah-electron/src/config/motion-preference.ts:25-32`: map `always` to `no-preference`, `reduce` to `reduce`, and `system` to no override. Removed the ineffective switch mapping.
- `apps/ptah-electron/src/config/motion-emulation.ts:17-49` (new): attach the debugger, send `Emulation.setEmulatedMedia`, reapply at navigation start, after load, and after DevTools closes, and report attach, command, and detach errors as `Error` objects.
- `apps/ptah-electron/src/config/motion-preference.spec.ts:7-88`: mock webContents/debugger to test both explicit values, navigation, Follow system, and failures.

## Decisions

- Keep restart-to-apply. `main.ts` reads the config at startup, and each new window inherits that fixed value. Changing it live would require coordinating existing and future windows and the current restart prompt.
- Use `browser-window-created` so the hook covers the preparing, main, reactivated, and detached Display windows before they load. Reassert at `did-start-navigation` and `did-finish-load`; Electron documents that opening DevTools detaches its debugger, so reattach when DevTools closes.
- Keep `Follow system` free of debugger attachment and media emulation. Explicit `always` sends `no-preference`, including on systems that reduce motion.

## Verification

Ran `npm run verify -- -p ptah-electron` after the final edit (exit 0). Exact Nx summary line: `NX   9 tasks: 9 succeeded`. The run covered project lint, tests, and typecheck. Scoped `ptah_get_diagnostics` timed out and returned unchecked before this completed verify run.

## Could not check

Could not run Electron or inspect a live renderer in this lane, so the post-restart `matchMedia` result and animation behavior remain for the Electron visual retest. The unit tests verify command dispatch and lifecycle handling, not Chromium's runtime response.

## Revise round 1

### Defects and changes

- Browser tool debugger conflict: `apps/ptah-electron/src/config/motion-emulation.ts:26-29` now accepts only webContents in the app's default Electron session. `apps/ptah-electron/src/main.ts:124-131` passes `session.defaultSession`, so the browser tool's separate `ptah-browser-tool` session is skipped before attach or listener registration.
- Routine detach logged as an error: `motion-emulation.ts:53-58` ignores destroyed targets and expected DevTools/target-closed reasons; unexpected reasons go through a warning callback. `main.ts:115-121` uses the injected Logger at warn level once available, with a startup console warning fallback. The `devtools-closed` reapply remains at `motion-emulation.ts:63-65`.
- Redundant navigation work and repeated error logs: `motion-emulation.ts:59-61` reapplies only for main-frame, new-document navigation. `motion-emulation.ts:31-37` reports each identical attach/CDP failure once per webContents.

### Tests

`apps/ptah-electron/src/config/motion-preference.spec.ts:105-161` adds browser-tool session exclusion, subframe and same-document navigation gating, expected and unexpected detach handling, DevTools reattach, and repeated-command-error deduplication. Existing preference and command tests still pass.

### Verification

`npm run verify -- -p ptah-electron` completed with exit 0: **9 tasks succeeded, 6 cached**. The first run found a TypeScript overload error in the new test mock (8 succeeded, 1 failed); the mock was corrected and the final scoped run passed.

### Decisions

- Compare session identity with `session.defaultSession` instead of relying on the browser tool's partition name. Both app renderer windows use the default session, while the browser tool owns a separate session. This leaves its debugger attachment untouched without changing the browser tool.
- Ignore expected debugger detaches; warn for unexpected detaches. Keep the existing `devtools-closed` reapply. Keep `Follow system` free of debugger attachment.
- Deduplicate identical errors per window so repeated navigation cannot flood logs, while different failures remain visible.

### Not done

- The required verification scope excludes launching Electron. Renderer `matchMedia` results for Always animate and Reduce motion, and the browser tool's live attach, remain for an Electron runtime check.
- Skill discovery found no locally invocable Electron skill; marketplace results were not invocable in this lane.
