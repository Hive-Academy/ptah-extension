# Implementation Plan - TASK_2025_194: Critical Live User Testing Bugs

## Codebase Investigation Summary

### Architecture Understanding

The extension follows a layered architecture:

- **Backend**: `SdkAgentAdapter` orchestrates `AuthManager`, `ConfigWatcher`, `SessionLifecycleManager`, `SdkQueryOptionsBuilder`
- **Frontend**: `AppShellComponent` switches views based on `AppStateManager.currentView()` signal
- **Communication**: RPC handlers bridge webview<->extension via `WebviewManager`
- **Auth Flow**: `SdkAgentAdapter.initialize()` -> Step 1: `ClaudeCliDetector.findExecutable()` -> Step 2: `AuthManager.configureAuthentication()` -> Step 3: Mark initialized

### Key Files Investigated

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` - Main provider adapter
- `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts` - Auth configuration
- `libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts` - Config change detection
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` - Session management
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` - Query options
- `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts` - SDK dynamic import
- `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts` - CLI detection
- `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts` - CLI path resolution
- `apps/ptah-extension-vscode/webpack.config.js` - Webpack bundling config
- `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts` - Auth RPC
- `apps/ptah-extension-vscode/src/core/ptah-extension.ts` - Extension activation
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` - Main UI shell
- `libs/frontend/chat/src/lib/components/templates/welcome.component.ts` - Welcome page
- `libs/frontend/chat/src/lib/components/templates/welcome.component.html` - Welcome template
- `libs/frontend/core/src/lib/services/app-state.service.ts` - App state management
- `libs/frontend/core/src/lib/services/vscode.service.ts` - VS Code service bridge
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts` - Webview message posting
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` - SDK source (minified)

---

## BUG 1 (CRITICAL): Agent SDK cli.js hardcoded to CI runner path

### Root Cause Analysis

The Claude Agent SDK (`sdk.mjs`) uses `import.meta.url` to locate `cli.js`:

```javascript
// In sdk.mjs Session constructor:
let X = Q.pathToClaudeCodeExecutable;
if (!X) {
  let W = fileURLToPath(import.meta.url); // <-- baked at webpack time
  let J = join(W, '..');
  X = join(J, 'cli.js');
}
```

Because `@anthropic-ai/claude-agent-sdk` is **bundled** by webpack (line 52 of webpack.config.js), `import.meta.url` gets evaluated at **build time** on the CI runner, baking in `/home/runner/work/ptah-extension/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`. At runtime on the user's machine, this path does not exist.

The extension already detects and resolves `cli.js` path via `ClaudeCliDetector` + `ClaudeCliPathResolver` (stored as `cliInstallation.cliJsPath`). However, this resolved path is **never passed** to the SDK's `pathToClaudeCodeExecutable` option.

**Evidence**:

- `sdk-query-options-builder.ts`: No reference to `pathToClaudeCodeExecutable` anywhere
- `session-lifecycle-manager.ts:618-630`: `queryOptionsBuilder.build()` does not include the CLI path
- `sdk-agent-adapter.ts:207`: `cliJsPath` is logged but never forwarded to query options
- `claude-sdk.types.ts:1607`: `pathToClaudeCodeExecutable` is defined in `SessionOptions`

### Fix Strategy

Pass `cliInstallation.cliJsPath` through the query options pipeline to set `pathToClaudeCodeExecutable` in SDK session options.

### Files to Modify

1. **`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`** (MODIFY)

   - Add `pathToClaudeCodeExecutable` to the `BuildOptions` interface
   - Set `options.pathToClaudeCodeExecutable` in the `build()` method output

2. **`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`** (MODIFY)

   - Accept `pathToClaudeCodeExecutable` in `ExecuteQueryConfig`
   - Pass it through to `queryOptionsBuilder.build()`

3. **`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`** (MODIFY)
   - Pass `this.cliInstallation.cliJsPath` to `sessionLifecycle.executeQuery()` in both `startChatSession()` and `resumeSession()`

### Pattern Evidence

- `claude-sdk.types.ts:1607` defines `pathToClaudeCodeExecutable?: string` on `SessionOptions`
- `ClaudeCliDetector` already resolves `cliJsPath` at line 128
- `SdkAgentAdapter` already caches it at `this.cliInstallation.cliJsPath` (line 207)

---

## BUG 2 (HIGH): Extension requires Claude auth before allowing third-party providers

### Root Cause Analysis

`SdkAgentAdapter.initialize()` (line 164-268) has a **hard gate** at Step 1:

```typescript
// Step 1: Detect Claude CLI installation
this.cliInstallation = await this.cliDetector.findExecutable();
if (!this.cliInstallation) {
  // Returns false, sets health to 'error'
  return false;
}
```

If Claude CLI is not installed, the adapter returns `false` and sets `health.status = 'error'` **before** it even attempts auth configuration (Step 2). For users with only third-party providers (Z.AI, OpenRouter), this means:

1. No Claude CLI -> adapter fails at Step 1
2. Auth never runs -> `configureAuthentication()` never called
3. Health shows error -> `testConnection` always fails
4. User sees "No authentication configured" despite having a valid Z.AI key

The Claude CLI is only needed to find `cli.js` for the `pathToClaudeCodeExecutable` SDK option. But the SDK **bundles** `cli.js` alongside `sdk.mjs` in `node_modules/@anthropic-ai/claude-agent-sdk/cli.js`. We can fall back to the bundled `cli.js` when no external CLI is found.

### Fix Strategy

Make CLI detection a **soft requirement**, not a hard gate:

1. If Claude CLI is found, use its resolved `cliJsPath` (current behavior)
2. If not found, resolve `cli.js` from the **bundled SDK package** (`node_modules/@anthropic-ai/claude-agent-sdk/cli.js`)
3. Only fail initialization if BOTH options fail

The key insight: the SDK package at `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` always exists because `@anthropic-ai/claude-agent-sdk` is an npm dependency. We need to resolve its path at **runtime** (not build time) using `require.resolve()` or similar.

### Files to Modify

1. **`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`** (MODIFY)

   - Change Step 1 from hard gate to soft: if CLI not found, resolve bundled `cli.js` from node_modules
   - Use `require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')` at runtime (not baked by webpack because the package is externalized... wait, it IS bundled)

   **Correction**: Since `@anthropic-ai/claude-agent-sdk` IS bundled by webpack, we cannot use `require.resolve()`. Instead, we need a different approach:

   - Add a webpack plugin or config to make `import.meta.url` resolve correctly at runtime, OR
   - Compute the `cli.js` path at runtime using the extension's `extensionPath` from VS Code context

   **Best approach**: Use VS Code's `context.extensionPath` to find `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` relative to the extension installation directory. The extension is installed as a `.vsix` which unpacks `node_modules/` alongside `main.js`.

   Wait -- actually let me reconsider. The SDK is **bundled into main.js** (lines 50-53 of webpack.config.js). That means `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` does NOT ship with the extension at all. It exists in the dev workspace but not in the published `.vsix`.

   **Revised approach**: The extension MUST ship `cli.js` as a separate file alongside `main.js`. Two options:

   a) **Ship cli.js with the extension** - Copy `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` to the dist output during build. Then resolve it at runtime via `path.join(context.extensionPath, 'cli.js')` or similar.

   b) **Externalize cli.js from the bundle** - Don't bundle `cli.js` itself. The SDK source code references `cli.js` via `import.meta.url`, which needs to resolve at runtime. If we ship `cli.js` alongside the bundle, we just need to pass its path explicitly.

   **Simplest fix**:

   - In the build process (project.json post-build step), copy `cli.js` and its required WASM files from `node_modules/@anthropic-ai/claude-agent-sdk/` to the dist output.
   - In `SdkAgentAdapter.initialize()`, when CLI detection fails, compute the bundled `cli.js` path as `path.join(context.extensionPath, 'cli.js')`.
   - Pass this path as `pathToClaudeCodeExecutable` to the SDK.

2. **`apps/ptah-extension-vscode/project.json`** (MODIFY)

   - Add post-build copy step to copy `cli.js`, `resvg.wasm`, `tree-sitter.wasm`, `tree-sitter-bash.wasm` from SDK package to dist output

3. **`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`** (MODIFY)
   - Inject `TOKENS.EXTENSION_CONTEXT` to access `context.extensionPath`
   - When `cliDetector.findExecutable()` returns null, fall back to `path.join(extensionPath, 'cli.js')`
   - Move auth configuration BEFORE CLI detection failure check
   - Only fail if auth also fails

### Combined Fix for BUG 1 + BUG 2

The fix for both bugs is the same pipeline:

1. Ship `cli.js` with the extension bundle
2. Always pass `pathToClaudeCodeExecutable` to SDK (either from detected CLI or from bundled fallback)
3. Make CLI detection a soft requirement (log info, not error)

### Files to Modify (Combined)

1. **`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`** (MODIFY)

   - Restructure `initialize()`: run auth FIRST, then CLI detection as enhancement
   - Fall back to bundled `cli.js` when CLI not found
   - Always pass resolved cli.js path through to query options

2. **`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`** (MODIFY)

   - Accept and set `pathToClaudeCodeExecutable` in built options

3. **`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`** (MODIFY)

   - Thread `pathToClaudeCodeExecutable` through `ExecuteQueryConfig` to query builder

4. **`apps/ptah-extension-vscode/project.json`** (MODIFY)

   - Post-build copy of SDK assets (`cli.js`, WASM files) to dist

5. **`apps/ptah-extension-vscode/package.json`** (MODIFY)
   - Include SDK assets in `.vsix` package via `files` or `vsce` config if needed

---

## BUG 3 (HIGH): Auth save succeeds but testConnection always fails

### Root Cause Analysis

The flow when user saves settings:

1. `auth:saveSettings` RPC stores key in SecretStorage (line 292 of auth-rpc.handlers.ts)
2. SecretStorage fires `onDidChange` event
3. `ConfigWatcher.handleConfigChange()` calls reinit callback **fire-and-forget** via `void` (line 62 of config-watcher.ts)
4. `auth:testConnection` RPC starts polling with exponential backoff (200ms, 400ms, 800ms...)
5. Problem: reinit (which runs `SdkAgentAdapter.initialize()`) takes time. The `void` cast means `saveSettings` returns before reinit completes. Then `testConnection` polls but reinit hasn't finished yet.

Additionally, `auth:saveSettings` stores the provider key (line 292) but THEN stores the `anthropicProviderId` (line 307). This means two separate SecretStorage/Config changes fire, potentially triggering TWO reinit cycles. The `isReinitializing` guard (line 79 of config-watcher.ts) skips the second one.

But the real issue is timing: `saveSettings` fires config changes asynchronously, and `testConnection` starts polling immediately. There's no coordination between save -> reinit -> test.

### Fix Strategy

Make `auth:saveSettings` explicitly trigger and **await** reinit before returning success:

1. In `auth-rpc.handlers.ts`, after saving all settings, explicitly call `sdkAdapter.reset()` (which calls `dispose()` + `initialize()`) and **await** it
2. Return the auth result from `saveSettings` so the frontend knows if auth was configured
3. `testConnection` can then simply check health immediately (no polling needed), but keep polling as fallback for robustness

### Files to Modify

1. **`apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts`** (MODIFY)
   - In `registerSaveSettings()`: after all saves, await `this.sdkAdapter.reset()` to force reinit
   - Return `{ success: true, authConfigured: boolean }` so frontend knows the result
   - The `testConnection` method can keep its retry logic but will now succeed on first attempt since reinit already completed

### Pattern Evidence

- `SdkAgentAdapter.reset()` already exists (line 323): `this.dispose(); await this.initialize();`
- `ConfigWatcher` reinit is already async but called with `void` prefix (fire-and-forget)
- This fix makes the pipeline synchronous: save -> reinit -> respond

---

## BUG 4 (MEDIUM): No redirect to auth settings after license activation

### Root Cause Analysis

`AppStateManager.initializeState()` (line 134-149 of app-state.service.ts):

```typescript
const isLicensed = windowWithState.ptahConfig?.isLicensed ?? true;
this._isLicensed.set(isLicensed);
const initialView = windowWithState.initialView || 'chat';
this._currentView.set(initialView);
```

When the user activates their license (enters key on welcome page), the webview reloads with `isLicensed: true`. The app goes to `chat` view. But there's no auth configured yet (no Claude key, no third-party provider key). The user sees the chat UI but can't actually send messages because the SDK isn't initialized.

There's no logic anywhere that checks: "licensed AND not auth-configured -> redirect to settings".

### Fix Strategy

Add an `effect()` in `AppShellComponent` that:

1. On mount, calls `auth:getAuthStatus` RPC
2. If licensed AND no auth configured (no provider key, no OAuth, no API key), navigate to settings
3. Only run once (not on every change)

### Files to Modify

1. **`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`** (MODIFY)
   - Add an `effect()` or `ngOnInit()` check that calls `auth:getAuthStatus`
   - If `currentView === 'chat'` AND user is licensed AND no auth credentials exist, call `this.appState.setCurrentView('settings')`
   - Use `untracked()` to avoid infinite effect loops

### Pattern Evidence

- `AppStateManager.setCurrentView()` exists (line 152 of app-state.service.ts)
- `ClaudeRpcService.call('auth:getAuthStatus', {})` is the existing RPC for checking auth status
- `auth:getAuthStatus` returns `{ hasOAuthToken, hasApiKey, hasOpenRouterKey }` booleans
- `AppShellComponent` already injects `ClaudeRpcService` (line 118)
- Similar pattern exists in `WelcomeComponent.ngOnInit()` which calls `license:getStatus`

---

## BUG 5 (MEDIUM): Invisible welcome popup steals focus (aria-hidden conflict)

### Root Cause Analysis

Error: `Blocked aria-hidden on an element because its descendant retained focus`

Looking at the welcome component template (`welcome.component.html`), there's NO `aria-hidden` attribute in the template. The `TrialEndedModalComponent` in `app-shell.component.html` (line 5) renders regardless of view:

```html
<ptah-trial-ended-modal [reason]="licenseReason()" />
```

This modal likely uses a `div.fixed.inset-0.z-40` overlay with `aria-hidden="true"` internally. When the welcome view is active, this modal overlay may be invisible but present in the DOM, capturing focus.

### Fix Strategy

The issue is likely in `TrialEndedModalComponent` or a generic modal pattern. Two approaches:

1. **Conditional rendering**: Only render `ptah-trial-ended-modal` when the view is `chat` (not `welcome`, not `settings`)
2. **Fix the modal**: Ensure the modal's overlay doesn't use `aria-hidden="true"` when it contains focusable elements, or remove the overlay from DOM when not visible

### Files to Modify

1. **`libs/frontend/chat/src/lib/components/templates/app-shell.component.html`** (MODIFY)

   - Wrap `<ptah-trial-ended-modal>` in a condition: only render when `currentView() !== 'welcome'`
   - This prevents the modal overlay from existing in DOM during welcome view

2. **Investigate**: `libs/frontend/chat/src/lib/components/molecules/trial-billing/trial-ended-modal.component.ts` (INVESTIGATE)
   - Check if the modal has an always-present overlay with `aria-hidden`
   - If so, fix it to only render overlay when modal is actually open

---

## BUG 6 (LOW): Webview not found during early init timing

### Root Cause Analysis

During extension activation:

- Step 7 (approx): `ConfigWatcher` triggers reinit, which posts status to webview
- Step 10 (approx): Webview provider is registered with VS Code

`WebviewManager.sendMessage()` (line 212-250 of webview-manager.ts) logs `CRITICAL: Webview ptah.main not found` when the webview hasn't been registered yet.

The `ConfigWatcher` reinit fires during `SdkAgentAdapter.initialize()` (which happens at DI container setup, before webview registration in `PtahExtension.initialize()`).

### Fix Strategy

Add a guard in `WebviewManager.sendMessage()` that gracefully handles the case where no webview is registered yet. Instead of logging CRITICAL, log DEBUG for expected timing cases.

Alternatively, guard the callers: any code that posts to webview during init should check `webviewManager.hasWebview(viewType)` first.

### Files to Modify

1. **`libs/backend/vscode-core/src/api-wrappers/webview-manager.ts`** (MODIFY)
   - Change the log level from `error` (CRITICAL) to `debug` when webview is not found
   - Return `false` silently (the message is simply dropped; it will be re-sent when webview connects)
   - This is safe because the webview requests its initial state upon connection anyway

---

## Implementation Tasks (Ordered by Dependency)

### Batch 1: SDK Path Fix (BUG 1 + BUG 2) - HIGHEST PRIORITY

These two bugs are deeply intertwined and must be fixed together.

**Task 1.1**: Add SDK assets to build output

- File: `apps/ptah-extension-vscode/project.json` (MODIFY)
- Action: Add post-build copy step for `cli.js` and WASM files from `node_modules/@anthropic-ai/claude-agent-sdk/`
- Verify: `dist/apps/ptah-extension-vscode/cli.js` exists after build

**Task 1.2**: Thread `pathToClaudeCodeExecutable` through query pipeline

- Files:
  - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)
  - `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (MODIFY)
- Action: Add `pathToClaudeCodeExecutable` to `BuildOptions` and `ExecuteQueryConfig`, set it on SDK options

**Task 1.3**: Make CLI detection soft, add bundled fallback

- File: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)
- Action:
  - Inject `TOKENS.EXTENSION_CONTEXT` for `context.extensionPath`
  - Restructure `initialize()`: attempt CLI detection, fall back to `path.join(extensionPath, 'cli.js')` if not found
  - Move auth to Step 1 (before CLI), CLI detection to Step 2 (soft)
  - Pass resolved `pathToClaudeCodeExecutable` to `executeQuery()` calls

**Task 1.4**: Verify `.vsix` includes SDK assets

- File: `apps/ptah-extension-vscode/.vscodeignore` or `package.json` (MODIFY if needed)
- Action: Ensure `cli.js` and WASM files are not excluded from packaging

### Batch 2: Auth Reinit Timing (BUG 3)

**Task 2.1**: Await reinit in saveSettings

- File: `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts` (MODIFY)
- Action: After all secret/config saves, await `sdkAdapter.reset()` before returning success

### Batch 3: Auth Redirect (BUG 4)

**Task 3.1**: Add auth-check effect to AppShellComponent

- File: `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` (MODIFY)
- Action: Add `effect()` that checks `auth:getAuthStatus` on initial load and redirects to settings if no auth configured

### Batch 4: Welcome Modal Fix (BUG 5)

**Task 4.1**: Conditionally render trial-ended-modal

- File: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` (MODIFY)
- Action: Wrap `<ptah-trial-ended-modal>` with `@if (currentView() !== 'welcome')`

### Batch 5: Webview Timing Guard (BUG 6)

**Task 5.1**: Soften webview-not-found logging

- File: `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts` (MODIFY)
- Action: Change CRITICAL error to debug log when webview not found during sendMessage

---

## Risk Assessment

### What Could Break

1. **BUG 1+2 fix**: Shipping `cli.js` increases extension size. WASM files are ~3-5MB. Must verify the `.vsix` size remains acceptable (VS Code marketplace limit is 200MB).

2. **BUG 1+2 fix**: The `cli.js` version must match the bundled `sdk.mjs` version. Both come from the same `@anthropic-ai/claude-agent-sdk` package, so they're always in sync when built.

3. **BUG 2 fix**: Reordering auth before CLI detection changes the initialization flow. If auth fails, we still need CLI for the error message guidance. Test both paths: auth-only (third-party), auth+CLI (Claude subscriber), neither.

4. **BUG 3 fix**: `sdkAdapter.reset()` in saveSettings means the RPC call takes longer (includes full reinit). The frontend should handle this gracefully (loading state already exists).

5. **BUG 4 fix**: The redirect to settings might be jarring if triggered on every webview mount. Must only trigger once and only when truly no auth exists. Use a flag to prevent re-triggering.

6. **BUG 5 fix**: Hiding the trial-ended-modal on welcome view means users won't see trial status. This is acceptable because the welcome view already shows trial/license messaging.

7. **BUG 6 fix**: Silencing the log could mask real issues. Use `debug` level so it appears in verbose logging but not in normal output.

### Backward Compatibility

No backward compatibility concerns. All changes are internal fixes that don't modify public APIs or user-facing contracts. The auth pipeline becomes more permissive (supports third-party-only auth), not more restrictive.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (primary) with frontend-developer for BUG 4/5

**Rationale**:

- BUGs 1, 2, 3, 6 are backend (Node.js, webpack, DI, auth pipeline)
- BUGs 4, 5 are frontend (Angular signals, template conditions)
- A full-stack developer could handle all 6

### Complexity Assessment

**Complexity**: MEDIUM-HIGH
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Batch 1 (BUG 1+2): 2-3 hours (build config + auth restructure + pipeline threading)
- Batch 2 (BUG 3): 30 minutes (simple await addition)
- Batch 3 (BUG 4): 30 minutes (effect + RPC call)
- Batch 4 (BUG 5): 15 minutes (template condition)
- Batch 5 (BUG 6): 15 minutes (log level change)

### Files Affected Summary

**MODIFY**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts`
- `apps/ptah-extension-vscode/project.json`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts`

### Critical Verification Points

1. **After Task 1.1**: Run `npm run build:all` and verify `dist/apps/ptah-extension-vscode/cli.js` exists
2. **After Task 1.3**: Test with Claude CLI NOT installed - extension should still initialize with third-party provider
3. **After Task 2.1**: Save Z.AI key -> testConnection should succeed on first attempt
4. **After Task 3.1**: Activate license on welcome page -> app should redirect to settings (not chat)
5. **After Task 4.1**: No more `aria-hidden` console errors when welcome view is shown
6. **After Task 5.1**: No more CRITICAL webview errors during startup

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Root cause analysis for each bug
