# Motion preference implementation

## Changes

- `apps/ptah-electron/src/config/motion-preference.ts:5`: Zod enum, invalid/missing fallback to `always`, synchronous `<userData>/config.json` read with startup-safe fallback, and pure preference-to-switch mapping. `motion-preference.spec.ts:1` covers mapping, bad values, and corrupt JSON.
- `apps/ptah-electron/src/main.ts:65`: applies the Chromium switch after the dev userData path is selected and before `app.whenReady()`.
- `libs/shared/src/lib/types/rpc.types.ts:1826` and `:3456`: typed `settings:getMotion` / `settings:setMotion` contracts and registry entries.
- `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:125`: adds Electron-only get/set on the existing settings handler, validates writes with Zod, persists through `IWorkspaceProvider`, and reports `unsupported` on other hosts. `settings-rpc.handlers.spec.ts:275` covers defaults, invalid writes, save, and unsupported behavior.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:298`: shows the Motion control next to theme/glass controls only when the reactive host flag says Electron. `theme-toggle.component.spec.ts:136` covers choices, loaded value, save RPC, and restart note.
- `libs/frontend/chat-ui/src/lib/atoms/motion-preference.component.ts:7`: standalone OnPush radio control with three short descriptions, signal state, typed RPC calls, and an inline `Restart Ptah to apply` note after a successful save.
- `.ptah/specs/TASK_2026_motion_preference/motion-preview.html:1` and `motion-preview.png`: static rendered layout preview and screenshot. I inspected the three choices, descriptions, and restart note beneath the appearance picker pattern. This is not a screenshot of the running Electron renderer.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Store `ptah.motionPreference` in `<userData>/config.json` | Electron config; shared `~/.ptah/settings.json` | `ElectronWorkspaceProvider` uses `config.json` under `userData` and routes only registered shared keys to the home settings file. Motion is Electron-only. | Yes; migrate/read another key later. |
| Add methods to `SettingsRpcHandlers` | Existing handler; new handler and DI token | It already owns `IWorkspaceProvider` and the `settings:` RPC registration. The RPC/DI guards derive method names from its `METHODS` list, so no new registration or guard edits were needed. | Yes. |
| Place the control in the theme picker | Theme picker; separate settings view | The existing theme and glass controls live in `ThemeToggleComponent`; this places Motion beside them. | Yes. |
| Show a restart note only | Note; relaunch button | The host has reload-window RPC but no app relaunch RPC. A reload does not reapply a pre-ready Chromium switch. | Yes; add a button if an app relaunch RPC is introduced. |

## Verification

- `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/chat-ui,ptah-extension-webview,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` - first attempt acquired a slot but did not reach a target header after about three minutes; stopped.
- `$env:NX_DAEMON='false'; npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/chat-ui,ptah-extension-webview,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` - completed with four failed targets: two `TS4111` errors in the new RPC handler plus unrelated Windows filesystem tests. I corrected both property accesses. This run also pulled Nx dependency builds through target dependencies.
- `$env:NX_DAEMON='false'; npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/chat-ui,ptah-extension-webview,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui -- --output-style=static` - stopped when implicit dependency build targets became visible; the next run excluded them.
- `$env:NX_DAEMON='false'; npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/chat-ui,ptah-extension-webview,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui -- --output-style=static --excludeTaskDependencies` - header confirmed `Running targets lint, test, typecheck for 8 projects`. All eight typechecks and lint targets passed (warnings only). Shared, chat UI, webview, and Electron tests passed; Electron: 79 active suites / 1,418 tests, chat UI: 100 suites / 1,773 tests. Four test targets failed for the causes below.
- `@ptah-extension/rpc-handlers:test`: 188 suites / 5,205 tests passed, including the Motion handler spec; 12 tests in four unrelated chat-session specs failed from Windows symlink permissions, chmod semantics, and slash-vs-backslash path expectations.
- `ptah-extension-vscode:test`, `ptah-cli:test`, `ptah-tui:test`: source suites passed except built-artifact gate tests requiring missing `dist` outputs. The gates document `PTAH_ALLOW_SKIP_UNBUILT=1` for local runs; no build was requested.
- `ptah_get_diagnostics` scoped to changed files timed out once while its compiler was preparing. The completed scoped typechecks above provide the error check.
- `ptah_browser_navigate` on the in-workspace preview HTML and `ptah_browser_screenshot` to `motion-preview.png` succeeded. The image was visually inspected against the current theme/glass picker layout.

## Not done / open questions

- Full eight-project verify remains red due to the unrelated Windows filesystem tests and unbuilt-artifact gates listed above. No unrelated tests or build targets were changed to work around them.
- A running Electron screenshot was unavailable under the no-build, no-serve, no-dev constraint. The static preview checks layout only.