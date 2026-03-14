# Development Tasks - TASK_2025_194: Critical Live User Testing Bugs

**Total Tasks**: 7 | **Batches**: 5 | **Status**: 5/5 complete

---

## Batch 1: SDK Path Fix (BUG 1 + BUG 2) - COMPLETE

**Developer**: team-leader (direct implementation)
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Add SDK assets to build output - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\project.json
**Change**: Added post-build copy command to copy `cli.js` from `node_modules/@anthropic-ai/claude-agent-sdk/` to `dist/apps/ptah-extension-vscode/cli.js`

### Task 1.2: Thread pathToClaudeCodeExecutable through query pipeline - COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts
- D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts

**Changes**:

- Added `pathToClaudeCodeExecutable` to `QueryOptionsInput`, `SdkQueryOptions`, `ExecuteQueryConfig`, and `SlashCommandConfig` interfaces
- Set `pathToClaudeCodeExecutable` in builder output options
- Destructured and passed through in `executeQuery()` and `executeSlashCommandQuery()`

### Task 1.3: Make CLI detection soft, add bundled fallback - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts

**Changes**:

- Injected `TOKENS.EXTENSION_CONTEXT` for `context.extensionPath`
- Restructured `initialize()`: auth runs FIRST (Step 1), CLI detection is Step 2 (soft)
- If CLI not found, falls back to `path.join(extensionPath, 'cli.js')` (bundled)
- Added `cliJsPath` field, always set during initialization
- Passed `pathToClaudeCodeExecutable` to all `executeQuery()` and `executeSlashCommandQuery()` calls
- Reset `cliJsPath` in `dispose()`

---

## Batch 2: Auth Reinit Timing (BUG 3) - COMPLETE

**Developer**: team-leader (direct implementation)
**Tasks**: 1 | **Dependencies**: Batch 1

### Task 2.1: Await reinit in saveSettings - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts

**Change**: After saving all settings, explicitly `await this.sdkAdapter.reset()` before returning success. This ensures reinit completes before testConnection polls.

---

## Batch 3: Auth Redirect (BUG 4) - COMPLETE

**Developer**: team-leader (direct implementation)
**Tasks**: 1 | **Dependencies**: None

### Task 3.1: Add auth-check effect to AppShellComponent - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts

**Change**: Added `effect()` in constructor that:

- Checks if currentView is 'chat' and auth check hasn't run yet
- Calls `auth:getAuthStatus` RPC
- If no auth configured (no OAuth, API key, OpenRouter key, or Copilot), redirects to 'settings'
- Uses `authCheckDone` flag to prevent re-triggering

---

## Batch 4: Welcome Modal Fix (BUG 5) - COMPLETE

**Developer**: team-leader (direct implementation)
**Tasks**: 1 | **Dependencies**: None

### Task 4.1: Conditionally render trial-ended-modal - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html

**Change**: Wrapped `<ptah-trial-ended-modal>` with `@if (currentView() !== 'welcome')` to prevent invisible overlay from stealing focus on welcome view.

---

## Batch 5: Webview Timing Guard (BUG 6) - COMPLETE

**Developer**: team-leader (direct implementation)
**Tasks**: 1 | **Dependencies**: None

### Task 5.1: Soften webview-not-found logging - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\webview-manager.ts

**Change**: Changed `this.logger.error` with "CRITICAL" prefix to `this.logger.debug` with explanatory comment. The message is harmlessly dropped during early init timing; webview requests its initial state upon connection.

---

## Verification

- TypeScript typecheck (ptah-extension-vscode): PASSED
- TypeScript typecheck (chat): PASSED
- All 7 tasks implemented across 8 files
