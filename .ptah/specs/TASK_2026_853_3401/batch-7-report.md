# Batch 7 report: Electron detached Display window (TASK_2026_853_3401)

## Files

- CREATED `apps/ptah-electron/src/windows/display-window.ts`: `ElectronDisplayWindowHost` (implements
  `IDisplayWindowHost`) and `createDisplayWindow`.
- CREATED `apps/ptah-electron/src/windows/display-window.spec.ts`: runs `runDisplayWindowHostContract`
  plus 14 Electron cases (not-ready, creation failure, load query, trusted id, default/fallback placement,
  saved-bounds restore and rejection, bounds save key, focus/restore, state push, action relay, child
  closed cleanup, close with main window, late `closed` of an old window).
- CREATED `apps/ptah-electron/src/windows/window-guards.ts`: `installNavigationGuard`, `isOnScreen`,
  `WindowBounds` (moved out of `main-window.ts`, bodies unchanged).
- MODIFIED `apps/ptah-electron/src/windows/main-window.ts`: imports the guards from `window-guards.ts`
  and re-exports `installNavigationGuard` and `isOnScreen`.
- MODIFIED `apps/ptah-electron/src/ipc/ipc-sender-policy.ts` + spec: `TrustedIpcSender.webContentsId`
  became `webContentsIds: readonly number[]`; spec cases for a second trusted window and an id no longer in the set.
- MODIFIED `apps/ptah-electron/src/ipc/ipc-bridge.ts`: `setDisplayWindowSender(id | null)`,
  exported `DISPLAY_WINDOW_ALLOWED_METHODS`, `isTrustedSender` replaced by `senderRole()` (`'main' | 'display' | null`).
  Display role: `rpc` only for the 4 allowlisted methods (others get
  `{type:'rpc:response', correlationId, success:false, error:"Method '<m>' is not available in the Display window"}`),
  fire-and-forget refused, `set-state` dropped, `diag:cpu-profile` rejected, `get-state` allowed.
- CREATED `apps/ptah-electron/src/ipc/ipc-bridge.display-window.spec.ts`: 15 cases for the role (real
  tsyringe child container, no casts).
- MODIFIED `apps/ptah-electron/src/activation/bootstrap.ts`: binds `PLATFORM_TOKENS.DISPLAY_WINDOW_HOST`
  with `useValue: new ElectronDisplayWindowHost({...})` right after `WEBVIEW_MANAGER`.

## Behaviour

- Window: same `webPreferences` as the main window (same preload, `contextIsolation`, no
  `nodeIntegration`, `sandbox`, `webSecurity`), same navigation guard, no `parent`, min 360x400, default
  520x760 right of the main window (left if that is off screen, else OS placement), title "Ptah - Display",
  `loadFile(renderer/index.html, {query:{ptahWindow:'display'}})`.
- Bounds: key `displayWindow.bounds` in `PLATFORM_TOKENS.STATE_STORAGE` (the storage `wire-runtime.ts`
  resolves into `refs.resolvedStateStorage`, which `createMainWindow` uses for `window.bounds`). Saved on
  the child's `close`; restored only when well-formed, at least the minimum size and on screen.
- Lifecycle: `main.once('closed')` closes the child; on child `closed` the listener is removed, the
  sender is untrusted, the snapshot dropped and `{type:'displayWindow:closed'}` pushed to the main renderer.
  A late `closed` of an older window does not touch a newer one.
- `publishState` caches and sends `{type:'displayWindow:state', payload: snapshot}` on `to-renderer` to the
  child (same channel and `{type,payload}` shape as `IpcBridge.sendToRenderer`); returns `true`.
  `relayAction` sends `{type:'displayWindow:action', payload:{tabId, action}}` via `IpcBridge.sendToRenderer`
  and returns its delivery result.
- `open()` never rejects: no main window or a window-creation failure answers `{ok:false, reason:'not-ready'}`.

## Decisions

- **Guards moved to `window-guards.ts` (plan deviation).** Options: import from `main-window.ts` as planned,
  or move them. Evidence: `main-window.ts` reads `import.meta.url`; `tsconfig.spec.json` is commonjs, so
  any module a spec loads must not import it (TS1343, `activation/shutdown.ts` header). `bootstrap.ts`
  imports `display-window.ts` and is loaded by four bootstrap specs. `main-window.ts` still re-exports both
  names. Reversible.
- **No `installPermissionPolicy` on the child (plan deviation).** The policy sets handlers on the shared
  default session bound to one `shellContents`; a second install would replace the main window's grants
  (voice input, clipboard write), breaking "detaching must never affect the chat window". The child is
  therefore denied every permission (fail-closed). Consequence: `navigator.clipboard.writeText` in the
  child is denied; batch 9/10 should not rely on it there. Reversible (a multi-contents policy later).
- **Narrow window interfaces** (`DisplayChildWindow`, `DisplayMainWindow`) instead of `BrowserWindow` in the
  host, so specs use plain fakes with no `as unknown as`. A real `BrowserWindow` satisfies both.
- **The bridge passes the same `documentPaths` for both windows** (renderer and boot shell). The child's
  navigation guard prevents it from reaching the boot shell.
- **Refused-method reply carries no `errorCode`**: `RpcUserErrorCode` (shared, outside this batch) has no
  fitting value. Reversible.
- The detached snapshot is cached even while closed; it is dropped when a child closes.

## Verification

`npm run verify -- -p @ptah-extension/platform-vscode,@ptah-extension/platform-cli,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode`
(includes `ptah-electron`, which is batch 7's command):

- `NX 53 tasks: 53 succeeded, 2 cached`
- `lock released after 1145.1s, exit code 0`

## Out of scope / follow-ups

- Clipboard IPC (`clipboard:read-text` / `clipboard:write-text`, `post-window.ts`) has no sender check and is
  reachable from the child too (pre-existing, already listed in the plan risks for the security review).
- `startup-config-ipc.ts` (sync `get-startup-config`) answers the child's preload as for any window; not changed.
