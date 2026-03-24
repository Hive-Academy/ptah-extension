# TASK_2025_194: Critical Live User Testing Bugs

## Task Type: BUGFIX

## Complexity: Medium-High

## Strategy: Partial (Architect -> Team-Leader -> QA)

## User Request

Fix 6 critical bugs discovered from live user testing. The user (iamb0ody) on macOS tested the extension with a Z.AI third-party provider and no Claude/Anthropic subscription. The extension is completely non-functional in this scenario.

## Bug List (Priority Order)

### BUG 1 (CRITICAL): Agent SDK cli.js hardcoded to CI runner path

- **Error**: `Claude Code executable not found at /home/runner/work/ptah-extension/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/cli.js`
- **Cause**: Webpack bundle bakes in absolute path from GitHub Actions CI at build time
- **Impact**: Chat completely non-functional — can't start any session
- **Evidence**: Log 2 line 505, Log 3 line 274

### BUG 2 (HIGH): Extension requires Claude auth before allowing third-party providers

- **Error**: User saves Z.AI API key but AuthManager says "No authentication configured"
- **Cause**: AuthManager.configureAuthentication() is Claude-centric — checks for Claude CLI and Anthropic auth first. Third-party providers like Z.AI need to work WITHOUT any Claude subscription.
- **Impact**: Users without Claude subscription can't use the extension at all
- **Evidence**: Log 2 lines 594-601
- **User feedback**: "Extension should support users who don't have any Claude subscription and want to rely on our providers"

### BUG 3 (HIGH): Auth save succeeds but testConnection always fails

- **Error**: `auth:testConnection completed (exhausted retries): {"success":false}`
- **Cause**: `auth:saveSettings` stores key in SecretStorage but AuthManager only runs on init. ConfigWatcher fires secret change as void (fire-and-forget). Retries exhaust before reinit completes.
- **Impact**: User saves API key, test button always shows failure
- **Evidence**: Log 2 line 601

### BUG 4 (MEDIUM): No redirect to auth settings after license activation

- **Error**: AppStateManager initializes with `view: chat, isLicensed: true` even when auth not configured
- **Cause**: No effect in AppShellComponent that checks auth status and redirects to settings
- **Impact**: User sees loading/welcome state, doesn't know to configure auth
- **Evidence**: Log 2 line 489

### BUG 5 (MEDIUM): Invisible welcome popup steals focus (aria-hidden conflict)

- **Error**: `Blocked aria-hidden on an element because its descendant retained focus`
- **Cause**: Modal overlay (`div.fixed inset-0 z-40`) has `aria-hidden="true"` but retains focus
- **Impact**: Invisible popup blocking interaction
- **Evidence**: Log 2 line 572-574, Log 3 line 1-3

### BUG 6 (LOW): Webview not found during early init timing

- **Error**: `[WebviewManager] CRITICAL: Webview ptah.main not found`
- **Cause**: ConfigWatcher reinit at Step 7 tries to post to webview before registration at Step 10
- **Impact**: Error log noise, potential message loss during init
- **Evidence**: All 3 logs

## Key Architecture Constraint

The most important architectural issue: **The auth system assumes Claude/Anthropic as the primary provider**. The extension MUST work for users who:

1. Have NO Claude CLI installed
2. Have NO Anthropic API key
3. Only use third-party providers (Z.AI, OpenRouter, etc.)

## Affected Systems

- `libs/backend/agent-sdk/` — AuthManager, ConfigWatcher, SdkAgentAdapter, SdkModelService, SessionLifecycleManager
- `apps/ptah-extension-vscode/` — webpack config, RPC handlers, activation flow
- `libs/frontend/chat/` — AppShellComponent, ConversationService
- `libs/frontend/core/` — AppStateManager

## Log Files Analyzed

1. `vscode-app-1773513257652.log` — First launch, license active, no auth
2. `vscode-app-1773515062069.log` — Second launch, user adds Z.AI provider
3. `vscode-app-1773515342966.log` — User tries to send a message, fatal SDK error
