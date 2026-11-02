# Code Logic Review - TASK_2026_motion_preference

Review family: claude (reviewer) vs codex (implementer)

Score 7/10
Verdict: APPROVED (no Blocking or Serious findings; 5 Moderate/Minor findings recommended before merge)

## Findings

1. Moderate - Host guard `process.versions['electron']` does not identify the Electron desktop app.
   `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:127` and `:138`.
   The VS Code extension host is itself an Electron process, so `process.versions.electron` is set there.
   `settings:getMotion` / `settings:setMotion` therefore do not return `unsupported` in VS Code.
   `setMotion` would call `setConfiguration('ptah','motionPreference')` on the VS Code provider (an undeclared
   VS Code configuration key, so it likely rejects and returns "Could not save Motion setting"; if it is
   accepted, it persists a value nothing reads).
   Mitigation: the only UI (`theme-toggle.component.ts` `@if (isElectron)`, driven by the preload `isElectron`
   flag) is hidden in VS Code, so no restart prompt shows there. The CLI has no `process.versions.electron`,
   so it correctly returns `unsupported`. The guard is only correct by coincidence.
   Fix: gate on a platform/host identity the repo already has (e.g. the platform-core host type or the
   `ElectronWorkspaceProvider` capability) instead of a runtime-version sniff, and add a spec that simulates
   the VS Code case.

2. Moderate - No test proves the write path and the startup reader agree.
   `settings-rpc.handlers.spec.ts:~275` only asserts `setConfiguration` was called with `('ptah','motionPreference',v)`
   (mock). `motion-preference.spec.ts` only feeds hand-written objects to `parseMotionPreference`.
   I traced it manually and the format does match: `ElectronWorkspaceProvider.setConfiguration`
   (`libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:228-232`) stores
   `config.ptah.motionPreference` and `persistConfig` writes it to `<globalStoragePath>/config.json`.
   `registration.ts:107` sets `globalStoragePath: options.userDataPath`, and `bootstrap.ts:339` passes
   `app.getPath('userData')`, the same path `main.ts:65` reads. `isFileBasedSettingKey('motionPreference')`
   is false (no match in platform-core), so it is not diverted to `~/.ptah/settings.json`.
   If the key, the section, or the file-based registry changes later, nothing fails.
   Fix: a spec that writes through a real `ElectronWorkspaceProvider` into a temp dir, then calls
   `readMotionPreference(dir)`.

3. Moderate - The effect of the Chromium switches is unverified in a running app.
   `apps/ptah-electron/src/config/motion-preference.ts:27-28`, `main.ts:65-66`. Specs only test the
   string mapping. No evidence (lane report says no screenshot or run of Electron) that
   `force-prefers-no-reduced-motion` actually flips `matchMedia('(prefers-reduced-motion: reduce)')` to false
   on Electron 44 when Windows animation effects are off, which is the user's core scenario. If the switch is
   ignored, "Always animate" silently does nothing and the UI says "Restart Ptah to apply".
   Fix: before closing, run the packaged or dev app once and check the media query for all three values.

4. Minor - Encoding damage in `settings-rpc.handlers.ts`.
   The diff replaces em dashes with mojibake (`â€”`) in header and JSDoc comments (lines ~23, 182, 246, 297, 470).
   No runtime effect, but it is noisy, unintended churn (the file was apparently rewritten in the wrong
   encoding; CRLF warnings on `theme-toggle.component.ts` suggest the same). Restore the original bytes.

5. Minor - UI load failure and "unsupported" are indistinguishable from a real failure, and the radio shows
   "Always animate" while in the error state.
   `motion-preference.component.ts` `load()`: on RPC failure the signal stays at the default `'always'`
   and the user sees "Motion setting is unavailable." while the radio still looks selected. If the stored value
   is `reduce` and the load fails, picking "Always animate" is a no-op visually but still prompts a restart.
   Low impact, Electron only.

## Not findings (verified correct)

- Default: unset, missing section, wrong value type, corrupt JSON, or missing file all return `'always'`
  (`motion-preference.ts:9-20`; handler `getMotion` also defaults). Note the whole `ptah` object is parsed
  with `.partial()`, so an invalid value falls to `'always'`, not a crash.
- Switch is appended at module top level (`main.ts:65-66`), after `setName` and the dev `userData` override
  and before `requestSingleInstanceLock` / `app.whenReady()`, so it is pre-ready. The userData path read
  matches the one the workspace provider uses later.
- RPC boundary: `settings:setMotion` validates `{preference}` with a strict enum via Zod before persisting;
  invalid input never reaches the provider; errors are fixed strings (no path/value leak) and rejected
  writes return `success:false` (the UI then does not claim a restart is needed and does not update state).
- Registration guards: methods added to `SettingsRpcHandlers.METHODS` (satisfies `RpcMethodName`), registry
  and `RPC_METHOD_ENTRIES` in `rpc.types.ts`. `host-source-registry.contract.spec.ts` filters by a name
  pattern (`turn|recap|ptah-ui|...`) that the new names do not match, so the baseline needs no change.
  No new DI token is needed.
- The shared-type params for `settings:getMotion` are `Record<string, never>`; the frontend passes `{}`.
  Types compile per the lane report's scoped typechecks.

## Checked

- `apps/ptah-electron/src/main.ts`, `config/motion-preference.ts` (+spec).
- `settings-rpc.handlers.ts` (+spec), `rpc.types.ts` diff, `settings-rpc.schema.ts`.
- `theme-toggle.component.ts` (+spec), `motion-preference.component.ts`.
- `ElectronWorkspaceProvider` `getConfiguration` / `setConfiguration` / `loadConfigSync` / `persistConfig`,
  `registration.ts`, `bootstrap.ts` userData wiring; host-source baseline contract.
- Not run: any tests, build, or Electron. Concurrency of `persistConfig` (shared `.tmp` filename between
  concurrent writers) is pre-existing and was not changed by this task.
