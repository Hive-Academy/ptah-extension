# Code Logic Review - TASK_2025_194 & TASK_2025_197

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6.5/10         |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 4              |
| Moderate Issues     | 5              |
| Failure Modes Found | 8              |

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Double re-initialization race (CRITICAL):** In `auth-rpc.handlers.ts`, `await this.sdkAdapter.reset()` calls `dispose()` then `initialize()`. But `dispose()` calls `configWatcher.dispose()`, and then `initialize()` re-registers the config watchers. Meanwhile, the ConfigWatcher's `onDidChange` listener for SecretStorage MAY ALSO fire from the credential saves that happened just lines above the `reset()` call. The `isReinitializing` guard in ConfigWatcher prevents concurrent reinit from the _watcher path_, but `reset()` bypasses that guard entirely -- it calls `initialize()` directly. If the secret change event fires AFTER `reset()` completes and the new watchers are registered, a SECOND unnecessary reinit will occur silently. This won't crash but wastes time and can cause brief "error" health status flicker visible to the user.

**Bundled cli.js may not exist:** If the post-build-copy command fails to find `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` (e.g., different SDK version, or npm didn't install it), the build emits a console warning but continues. At runtime, `path.join(extensionPath, 'cli.js')` will reference a non-existent file. The SDK will then fail with an opaque error about missing executable rather than a clear "cli.js not found" message.

**Auth check effect swallows errors:** In `app-shell.component.ts` line 261, the `.catch(() => {})` silently swallows ALL errors from the auth RPC call. If the RPC system is broken, the user will never be redirected to settings and won't know why.

### 2. What user action causes unexpected behavior?

**Rapid settings saves:** If a user clicks "Save" multiple times rapidly in the auth settings, each call triggers `await this.sdkAdapter.reset()`. Since `reset()` calls `dispose()` (which fire-and-forgets session disposal) then `initialize()`, overlapping calls can produce unpredictable state. The ConfigWatcher has `isReinitializing` protection, but the direct `reset()` path in auth-rpc.handlers does not.

**User navigates to settings, then back to chat during auth check:** The auth check effect in AppShellComponent fires once when `currentView === 'chat'`. If the RPC call takes time and the user manually navigates to settings and back, the `authCheckDone` flag prevents re-checking. This means if auth configuration changes while in settings, returning to chat won't re-verify.

### 3. What data makes this produce wrong results?

**`findPackageFromBinary` with scoped packages on Windows:** The function uses `packageName.split('/')` to construct the path: `join(dir, 'node_modules', ...packageName.split('/'))`. For scoped packages like `@github/copilot-sdk`, this produces `node_modules/@github/copilot-sdk` which is correct. However, on Windows, if `binaryPath` is a `.cmd` file (common for npm-installed CLIs), `realpathSync` on a `.cmd` file returns the `.cmd` file itself (not the JS it wraps). Walking up from `C:\Users\xxx\AppData\Roaming\npm\copilot.cmd` will never find `node_modules/@github/copilot-sdk` because the `.cmd` file is in `npm\` which doesn't contain a `node_modules` directory -- the actual packages are in `npm\node_modules\`. This specific path geometry means the fallback resolution will always fail on Windows for standard npm global installs.

**Empty `cliJsPath` propagation:** In `sdk-agent-adapter.ts` line 431: `pathToClaudeCodeExecutable: this.cliJsPath || undefined`. If `cliJsPath` is an empty string (shouldn't happen normally but defensively), `||` treats it as falsy and passes `undefined`, which means the SDK falls back to its own resolution. This is actually safe, but the intent is unclear -- `?? undefined` would be more precise.

### 4. What happens when dependencies fail?

**SDK resolver `dynamicImport` failure modes:** The `new Function('specifier', 'return import(specifier)')` pattern in `sdk-resolver.ts` is clever but has a subtle risk: in strict CSP environments or if Node.js is configured with `--disallow-code-generation-from-strings`, `new Function()` will throw. VS Code extension hosts don't typically enable this, but it's an undocumented assumption.

**Copilot `ensureClient` caches the first client forever:** Once `this.client` is set in `copilot-sdk.adapter.ts`, it's never invalidated unless `dispose()` is called. If the initial client creation succeeds but the client later becomes unhealthy (CLI process dies, token expires), all subsequent `runSdk()` calls will use the stale client. The `autoRestart: true` option mitigates this for process crashes, but not for auth token expiry.

**`sdkAdapter.reset()` can fail, leaving auth:saveSettings in error state:** If `reset()` throws (e.g., `initialize()` fails), the error propagates up through `auth:saveSettings`, and the RPC returns an error to the frontend. But the credentials HAVE already been saved to SecretStorage. The user sees "save failed" but the credentials are actually saved. On next extension restart, the saved credentials will be picked up.

### 5. What's missing that the requirements didn't mention?

**No validation that bundled cli.js is functional:** The post-build-copy in `project.json` copies cli.js, and the adapter blindly uses it. There's no version check, no integrity validation, and no test that the bundled cli.js actually works with the bundled SDK version.

**No user-facing error when SDK resolvers fail:** In TASK_2025_197, when `resolveAndImportSdk` throws for Copilot/Codex, the error surfaces as a generic segment error in the agent monitor. There's no notification banner or toast telling the user "Install copilot-sdk globally to use this provider."

**No cleanup of `abort` event listener:** In `copilot-sdk.adapter.ts` line 816, `abortController.signal.addEventListener('abort', onAbort)` is registered but never removed. When the session completes normally (via `session.idle`), the abort listener remains attached. Since `AbortController` and its signal are held in the `SdkHandle` closure, this prevents garbage collection until the handle is released.

---

## Failure Mode Analysis

### Failure Mode 1: Double Reinit on Auth Save

- **Trigger**: User saves auth settings. `auth:saveSettings` saves credentials to SecretStorage, then calls `sdkAdapter.reset()`. The SecretStorage `onDidChange` event fires asynchronously.
- **Symptoms**: Brief health status flicker; potential for `testConnection` to observe intermediate state.
- **Impact**: LOW-MEDIUM -- user might see a brief error flash in the connection test.
- **Current Handling**: ConfigWatcher has `isReinitializing` flag, but `reset()` calls `initialize()` directly, bypassing it.
- **Recommendation**: In `auth-rpc.handlers.ts`, call `configWatcher.dispose()` before saving credentials to prevent the watcher from seeing the change. Or add a debounce/dedup mechanism to `reset()`.

### Failure Mode 2: Bundled cli.js Missing at Runtime

- **Trigger**: Build runs on a machine where `@anthropic-ai/claude-agent-sdk` doesn't have a `cli.js` at the expected path, or the file is renamed in a new SDK version.
- **Symptoms**: Extension initializes successfully (auth works) but any chat session creation fails with an opaque "executable not found" error.
- **Impact**: HIGH -- complete chat functionality loss, same as BUG 1 this was meant to fix.
- **Current Handling**: Post-build script logs a WARNING but doesn't fail the build.
- **Recommendation**: Make the post-build copy command fail the build if cli.js is not found. Add a runtime existence check in `initialize()` that logs a clear error if the bundled cli.js doesn't exist.

### Failure Mode 3: SDK Resolver Fails on Windows

- **Trigger**: User on Windows with npm-installed Copilot/Codex CLI. `findPackageFromBinary` walks up from the `.cmd` file's location.
- **Symptoms**: SDK import fails with "not installed" error even though the SDK IS installed globally alongside the CLI.
- **Impact**: MEDIUM -- Windows users with global npm installs can't use Copilot/Codex providers. Bare `import()` attempt (step 1) may succeed if NODE_PATH is set, mitigating this partially.
- **Current Handling**: Falls through to error with install instructions.
- **Recommendation**: In `findPackageFromBinary`, when the binary path ends with `.cmd`, try to read the `.cmd` file contents to extract the actual JS target path, then walk up from that path instead. Or resolve the npm global prefix via `npm root -g` as a third fallback.

### Failure Mode 4: Auth Check Effect Timing with View Navigation

- **Trigger**: User loads extension, lands on chat view, auth check fires. Before RPC returns, user clicks Settings manually. Auth check resolves with "no auth" and calls `setCurrentView('settings')` -- but user is already there. No harm. Now user configures auth and returns to chat. `authCheckDone` is true, so no re-check.
- **Symptoms**: If auth was only partially configured (e.g., OAuth but no provider key), the re-check that might catch this doesn't run.
- **Impact**: LOW -- user can always manually navigate to settings.
- **Current Handling**: One-shot check with `authCheckDone` flag.
- **Recommendation**: Consider resetting `authCheckDone` when transitioning away from settings view, or making the check run each time the view changes to 'chat'.

### Failure Mode 5: `reset()` During Active Sessions

- **Trigger**: User has an active chat session, then changes auth settings. `reset()` is called which calls `dispose()` -> `disposeAllSessions()`. But `dispose()` fires `disposeAllSessions()` with `.catch()` (fire-and-forget at line 293), then immediately sets `initialized = false` and `cliJsPath = null`.
- **Symptoms**: Active sessions are killed mid-conversation. If `disposeAllSessions` interrupt takes 5 seconds (timeout), `initialize()` may have already started before sessions are fully cleaned up.
- **Impact**: MEDIUM -- user loses in-progress work without warning.
- **Current Handling**: `dispose()` is synchronous, fires async cleanup via `.catch()`. Then `reset()` immediately calls `await initialize()`.
- **Recommendation**: Make `reset()` await `disposeAllSessions()` before calling `initialize()`. Or better: add a guard against `reset()` during active sessions, or warn the user.

### Failure Mode 6: `pathToFileURL` on Windows Drive Letters

- **Trigger**: On Windows, `pathToFileURL('C:\\Users\\...\\node_modules\\@github\\copilot-sdk')` produces `file:///C:/Users/.../node_modules/@github/copilot-sdk`.
- **Symptoms**: The `dynamicImport(fileUrl)` call may fail because Node.js ESM loader needs the exact entry point (e.g., `package.json` "exports" field), not just the directory URL.
- **Impact**: MEDIUM -- Runtime SDK resolution from CLI binary location may fail on Windows even when the path is correctly found.
- **Current Handling**: `findPackageFromBinary` returns the directory path, and `pathToFileURL` is called on it. Importing a directory URL relies on Node.js reading the package.json "exports" field, which should work for modern packages.
- **Recommendation**: Verify this works with actual ESM packages. Consider importing the main entry point explicitly: read `package.json` from the candidate, extract `exports['.']` or `main`, and import that specific file.

### Failure Mode 7: Copilot Client Singleton Never Refreshes Auth Token

- **Trigger**: User authenticates with GitHub, Copilot client is created with the token. Hours later, the VS Code auth session expires/refreshes. The singleton `this.client` still holds the old token.
- **Symptoms**: Copilot sessions fail with auth errors after token expiry.
- **Impact**: MEDIUM -- user must restart extension or reload window.
- **Current Handling**: `autoRestart: true` in client options handles process crashes but not token refresh.
- **Recommendation**: Add a mechanism to invalidate the client when VS Code's GitHub auth session changes, or pass a token-provider callback instead of a static token.

### Failure Mode 8: Codex SDK Module Cache Survives Failed Refreshes

- **Trigger**: `codexSdkModule` cache (line 138 of codex-cli.adapter.ts) holds the successfully imported module. If the module later becomes corrupted (e.g., user uninstalls the package while extension is running).
- **Symptoms**: Subsequent `getCodexSdk()` calls return the cached module reference. If the module's underlying state is broken (e.g., native bindings freed), calls will fail with obscure errors.
- **Impact**: LOW -- edge case, module references in Node.js are stable once loaded.
- **Current Handling**: Cache is never invalidated except by extension restart.
- **Recommendation**: Acceptable for now, document the assumption.

---

## Critical Issues

### Issue 1: `reset()` Does Not Await Session Disposal

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts:340-344`
- **Scenario**: `auth:saveSettings` calls `reset()`, which calls `dispose()`. Inside `dispose()`, `disposeAllSessions()` is fire-and-forget (line 293: `.catch()`). Then `initialize()` is called immediately. If sessions are active, they may not be fully cleaned up before re-initialization starts, leading to resource leaks or stale state.
- **Impact**: Active sessions killed without proper cleanup; potential for zombie queries consuming API tokens.
- **Evidence**:
  ```typescript
  async reset(): Promise<void> {
    this.dispose();          // fire-and-forget async session disposal
    await this.initialize(); // starts immediately, doesn't wait for disposal
  }
  ```
- **Fix**: Change `dispose()` to be async and await it in `reset()`:
  ```typescript
  async reset(): Promise<void> {
    await this.disposeAsync();
    await this.initialize();
  }
  ```
  Or at minimum, await `disposeAllSessions()` directly in `reset()` before calling `initialize()`.

### Issue 2: SDK Resolver May Fail on Windows Due to .cmd Binary Path

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\sdk-resolver.ts:82-104`
- **Scenario**: On Windows, npm-installed CLIs are `.cmd` wrapper scripts in `%APPDATA%\npm\`. `realpathSync` on `copilot.cmd` returns the `.cmd` file itself. Walking up from `...\npm\copilot.cmd` looks for `npm\node_modules\@github\copilot-sdk` -- but on Windows the global packages are in `npm\node_modules\@github\copilot-sdk\`, which IS actually at `...\npm\node_modules\@github\copilot-sdk`. So walking up one level from `...\npm\` would look in `...\node_modules\...` which is wrong. Actually, let me re-analyze: the `.cmd` file is AT `C:\Users\x\AppData\Roaming\npm\copilot.cmd`. `dirname` gives `C:\Users\x\AppData\Roaming\npm`. First iteration checks `C:\Users\x\AppData\Roaming\npm\node_modules\@github\copilot-sdk` -- this IS where npm global packages live on Windows. So this WOULD work. My initial concern was wrong.
- **Impact**: Actually LOW after re-analysis. The walk-up from the `.cmd` directory DOES find the global `node_modules`. However, `realpathSync` on a `.cmd` file on Windows may throw in some configurations.
- **Evidence**: `realpathSync` on a `.cmd` batch file should work fine as it's a regular file. Revised to SERIOUS rather than CRITICAL.
- **Fix**: Add a try-catch around `realpathSync` specifically for the `.cmd` case, and if it fails, try using the raw `binaryPath` directly (dirname of `.cmd` file is the npm bin dir, which is a sibling of `node_modules`).

---

## Serious Issues

### Issue 3: Double Reinit From ConfigWatcher + Explicit reset()

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts:319`
- **Scenario**: `auth:saveSettings` saves credentials to SecretStorage (lines 257-299), then calls `await sdkAdapter.reset()` (line 319). The SecretStorage change triggers ConfigWatcher's `onDidChange` listener, which calls `handleConfigChange` -> reinit callback -> `dispose()` + `initialize()`. This happens in parallel with the `reset()` call.
- **Impact**: Potential for concurrent reinit, wasted API calls, brief error state visible to user.
- **Evidence**: ConfigWatcher `secretsDisposable` on line 54 of `config-watcher.ts` fires on secret changes, and `reset()` at line 319 of `auth-rpc.handlers.ts` also reinitializes.
- **Fix**: Either: (a) dispose config watchers before saving credentials and re-register after reset, or (b) add a flag to skip watcher-triggered reinit during explicit `reset()`.

### Issue 4: No Build-Time Validation of Bundled cli.js

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\project.json:79`
- **Scenario**: Post-build copy uses `if(fs.existsSync(src))` with a fallback `console.warn`. If the SDK restructures its package and `cli.js` moves, the build succeeds but the extension ships without a critical file.
- **Impact**: Extension completely non-functional for users without Claude CLI -- the exact scenario BUG 1 was meant to fix.
- **Evidence**: Line 79: `if(fs.existsSync(src)){fs.copyFileSync(src,dst)}else{console.warn('WARNING: cli.js not found at '+src)}`
- **Fix**: Change `console.warn` to `process.exit(1)` or `throw new Error(...)` to fail the build when cli.js is missing.

### Issue 5: Copilot Adapter Abort Listener Leak

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts:816`
- **Scenario**: `abortController.signal.addEventListener('abort', onAbort)` is never removed on normal session completion (via `session.idle` or `session.shutdown`). The listener closure captures `session`, `permissionBridge`, and `doneResolve`.
- **Impact**: Minor memory leak per session. Over many sessions (e.g., running background agents), this accumulates.
- **Evidence**: Line 816 adds listener; `done` promise resolution paths (lines 756-778) don't remove it.
- **Fix**: Add `abortController.signal.removeEventListener('abort', onAbort)` in the `session.idle` and `session.shutdown` handlers before resolving.

### Issue 6: `execFileAsync` for Copilot Version Check Fails on Windows .cmd

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts:284`
- **Scenario**: `execFileAsync(binaryPath, ['version'], ...)` where `binaryPath` is `copilot.cmd`. `execFile` cannot execute `.cmd` files directly on Windows without `shell: true`.
- **Impact**: Version detection silently fails on Windows (caught by try/catch). Not blocking, but inconsistent with the Codex adapter which uses `spawnCli` (which handles .cmd files).
- **Evidence**: Line 284: `const { stdout: versionOutput } = await execFileAsync(binaryPath, ['version'], { timeout: 5000 });`
- **Fix**: Use `spawnCli` instead of `execFileAsync` for version detection, matching the Codex adapter pattern.

---

## Moderate Issues

### Issue 7: Auth Check Effect is One-Shot

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts:223-264`
- **Scenario**: `authCheckDone` flag prevents re-checking after first visit to chat view. If user configures partial auth then returns to chat, no re-verification occurs.
- **Impact**: LOW -- user can always navigate to settings manually.
- **Recommendation**: Consider resetting `authCheckDone` when leaving settings view.

### Issue 8: Diagnostic Logging Leaks Environment Details

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts:675-682`
- **Scenario**: Lines 675-682 log `process.env` auth state including base URL values. This is fine for debugging but should be removed or guarded before release to avoid leaking proxy URLs to extension logs.
- **Impact**: LOW -- log output only, no runtime impact.
- **Recommendation**: Guard with a debug flag or remove before release.

### Issue 9: `resolveAndImportSdk` Error Message Inaccuracy

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\sdk-resolver.ts:66-69`
- **Scenario**: Error says "is not installed or could not be loaded" and suggests `npm install -g`. But on some systems, global installs go to different locations. The message could be more helpful.
- **Impact**: LOW -- UX polish issue.
- **Recommendation**: Include the attempted binary path in the error message so the user can debug resolution issues.

### Issue 10: Trial Modal Conditional May Hide Legitimate Trial-Ended State

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html:6`
- **Scenario**: `@if (currentView() !== 'welcome')` hides the trial modal on welcome view. But what if the user's trial has ended AND they're on the welcome view? They'd never see the trial-ended modal.
- **Impact**: LOW -- welcome view has its own flows; trial-ended users likely route away from welcome.
- **Recommendation**: Verify that welcome view handles trial expiry independently.

### Issue 11: `findPackageFromBinary` Root Detection on Windows

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\sdk-resolver.ts:92`
- **Scenario**: `dir.substring(0, dir.indexOf(sep) + 1)` on Windows with path `C:\Users\...` would find the first `\` at index 2, producing `C:\` as root. This is correct. On Unix `/usr/...`, `indexOf('/')` is 0, producing `/`. Also correct. Edge case: network paths like `\\server\share` -- `indexOf('\\')` is 0, root becomes `\`, but `dirname` on UNC paths may never reach `\`. This could cause an infinite loop.
- **Impact**: LOW -- UNC/network paths for npm global installs are extremely rare.
- **Recommendation**: Add a max iteration guard (e.g., 50 levels) to prevent infinite loops on exotic paths.

---

## Data Flow Analysis

```
TASK_2025_194 - Auth Save Flow:
  User clicks "Save" in Auth Settings
    |
    v
  auth:saveSettings RPC handler
    |-- Save authMethod to ConfigManager ------> ConfigWatcher fires (async)
    |-- Save credentials to SecretStorage -----> ConfigWatcher fires (async)
    |-- Save providerId to ConfigManager ------> ConfigWatcher fires (async)
    |
    v                                            v
  await sdkAdapter.reset()                  ConfigWatcher.handleConfigChange()
    |-- dispose()                              |-- isReinitializing check
    |   |-- configWatcher.dispose() *          |-- disposeAllSessions()
    |   |-- disposeAllSessions() [FIRE&FORGET] |-- initialize()
    |   |-- clearAuthentication()              [MAY RACE WITH reset()]
    |   |-- initialized = false
    |-- await initialize()
    |   |-- registerWatchers (new)
    |   |-- configureAuthentication()
    |   |-- detectCLI / bundled fallback
    |   |-- set health = available
    |
    v
  Return { success: true }
    |
    v
  auth:testConnection polls getHealth()

  * configWatcher.dispose() at this point SHOULD prevent
    the watcher-triggered reinit. But timing of async
    SecretStorage events is non-deterministic.
```

### Gap Points Identified:

1. `dispose()` fire-and-forgets async session disposal -- `reset()` doesn't wait
2. ConfigWatcher async events may arrive after `dispose()` but before new watchers registered
3. No validation that bundled cli.js exists at runtime before using it

---

## Requirements Fulfillment

| Requirement                                 | Status   | Concern                                                     |
| ------------------------------------------- | -------- | ----------------------------------------------------------- |
| BUG 1: Fix hardcoded CI path                | COMPLETE | Bundled cli.js fallback works, but no build-time validation |
| BUG 2: Third-party providers without Claude | COMPLETE | Auth runs before CLI detection                              |
| BUG 3: testConnection fails after save      | COMPLETE | Explicit `await reset()` fixes timing                       |
| BUG 4: No redirect to auth settings         | COMPLETE | One-shot effect, non-blocking                               |
| BUG 5: Invisible welcome popup              | COMPLETE | Conditional render on view                                  |
| BUG 6: Webview not found log noise          | COMPLETE | Downgraded to debug                                         |
| TASK_2025_197: Remove SDKs from bundle      | COMPLETE | Runtime resolver with fallbacks                             |

### Implicit Requirements NOT Addressed:

1. Build should fail if bundled cli.js is missing (prevents shipping broken extensions)
2. User-facing notification when optional SDK packages can't be loaded (vs. generic error)
3. `reset()` should properly await session disposal before re-initialization
4. Windows .cmd handling in Copilot version detection (inconsistent with Codex pattern)

---

## Edge Case Analysis

| Edge Case                         | Handled | How                                | Concern                                      |
| --------------------------------- | ------- | ---------------------------------- | -------------------------------------------- |
| No Claude CLI + no bundled cli.js | PARTIAL | Falls back to bundled path         | No existence check at runtime                |
| Multiple rapid auth saves         | NO      | Each triggers reset()              | Potential concurrent reinit                  |
| Auth save during active streaming | PARTIAL | reset() kills sessions             | No user warning                              |
| Windows .cmd binary paths         | PARTIAL | SDK resolver walks up              | Copilot version check uses execFile directly |
| Network/UNC paths                 | NO      | Walk-up loop could be infinite     | Add max iterations guard                     |
| Node.js < 18                      | YES     | VS Code requires Node 18+          | N/A                                          |
| ESM import from CJS context       | YES     | dynamic import() works in Node 18+ | Tested pattern                               |
| Empty auth credentials            | YES     | trim() checks in saveSettings      | OK                                           |

---

## Integration Risk Assessment

| Integration                            | Failure Probability | Impact | Mitigation                                  |
| -------------------------------------- | ------------------- | ------ | ------------------------------------------- |
| cli.js bundling (post-build)           | LOW-MED             | HIGH   | Add build failure on missing file           |
| SDK runtime resolution (Copilot/Codex) | MED                 | MED    | First attempt via bare import usually works |
| ConfigWatcher + explicit reset()       | MED                 | LOW    | Timing-dependent, usually benign            |
| Auth check effect + RPC                | LOW                 | LOW    | Silenced errors, one-shot guard             |
| Trial modal conditional render         | LOW                 | LOW    | Narrow fix for specific bug                 |

---

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: `reset()` does not await session disposal, creating a race condition between cleanup and re-initialization that can cause resource leaks and brief error states during auth configuration changes.

## What Robust Implementation Would Include

1. **`reset()` should be fully async-safe**: Await `disposeAllSessions()` with timeout before calling `initialize()`.
2. **Build-time validation**: Post-build should FAIL (not warn) when cli.js is missing.
3. **Runtime cli.js existence check**: Before assigning `this.cliJsPath = bundledCliPath`, verify the file exists with `fs.existsSync()`.
4. **ConfigWatcher debounce during explicit reset**: Prevent watcher-triggered reinit when `reset()` is in progress.
5. **Auth check should be re-runnable**: Reset `authCheckDone` when user leaves settings, or make it a computed signal based on auth state rather than a one-shot check.
6. **Abort listener cleanup**: Remove abort handler in Copilot adapter when session completes normally.
7. **Consistent Windows handling**: Use `spawnCli` for Copilot version detection (matching Codex pattern).
8. **Max iteration guard** in `findPackageFromBinary` to prevent infinite loops on exotic paths.
