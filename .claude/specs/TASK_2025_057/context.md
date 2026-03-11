# Task Context - TASK_2025_057

## User Intent

Complete Authentication System implementation with two parallel tracks:

1. **Backend Track (TASK_2025_055)**: Fix SDK initialization race condition

   - Call `initialize()` on extension activation
   - Add ConfigManager watchers for auth settings changes
   - Add onboarding UI when authentication is missing
   - Validate authentication on startup

2. **Frontend Track (TASK_2025_056)**: Build Settings UI Component
   - Angular webview settings page
   - User-friendly authentication configuration
   - Model selection interface
   - Autopilot settings interface
   - Integration with backend via RPC methods

Both tracks should be developed in parallel by backend-developer and frontend-developer, with integration via RPC methods.

## Conversation Summary

### Race Condition Discovery

**Problem Identified**: Extension activates WITHOUT initializing SDK or checking authentication.

**Current Broken Flow**:

```typescript
// main.ts Line 250
registerSdkServices(container, context, logger);
  ↓
// register.ts Line 56
new SdkAgentAdapter(logger, config, storage, permissionHandler)
  ↓
❌ initialize() NEVER CALLED
  ↓
// User opens webview, tries to chat
❌ SDK has no auth configured
❌ Query fails silently (no feedback to user)
```

### Prior Context

- User has `CLAUDE_CODE_OAUTH_TOKEN` in `.env` file but extension cannot access it
- VS Code extensions don't automatically load `.env` files
- Authentication settings were just added to `package.json` (ptah.claudeOAuthToken, ptah.anthropicApiKey, ptah.authMethod)
- SDK reads from `process.env` but initialization logic never runs
- User wanted to test the free version before starting TASK_2025_043 (License Server)

### User's Decision

User chose Option 3: "Fix both simultaneously (fastest)" - develop SDK initialization fix and Settings UI in parallel.

## Technical Context

- **Branch**: feature/TASK_2025_057
- **Created**: 2025-12-08
- **Type**: FEATURE (dual-track: backend + frontend)
- **Complexity**: Complex
- **Related Tasks**:
  - TASK_2025_055: SDK Initialization & Auth Flow (backend)
  - TASK_2025_056: Settings UI Component (frontend)
  - TASK_2025_043: License Server Implementation (blocked until this completes)

## Key Files Involved

### Backend (SDK Initialization)

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts` - Add initialize() call
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` - Add config watchers
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts` - Add onboarding UI

### Frontend (Settings UI)

- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.component.ts` - Add settings route
- New: `libs\frontend\settings\` - Create settings library
- New: Settings components (auth-config, model-selector, autopilot-config)

### Integration (RPC)

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts` - Add RPC handlers for settings
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\` - RPC method implementations

## Execution Strategy

**FEATURE Strategy (Parallel Development)**:

1. **Phase 1**: project-manager → Creates unified task-description.md for both tracks
2. **USER VALIDATES** ✋
3. **Phase 2**: software-architect → Creates implementation-plan.md with parallel architecture
4. **USER VALIDATES** ✋
5. **Phase 3**: team-leader MODE 1 → Decomposes into parallel batches:
   - **Batch 1 (Backend)**: SDK initialization fix
   - **Batch 2 (Frontend)**: Settings UI components
   - **Batch 3 (Integration)**: RPC methods and wiring
6. **Phase 4**: team-leader MODE 2 (parallel assignments):
   - backend-developer works on Batch 1
   - frontend-developer works on Batch 2
   - Both can work simultaneously
7. **Phase 5**: team-leader MODE 2 (integration):
   - Verify both batches complete
   - Assign Batch 3 (RPC integration)
8. **Phase 6**: team-leader MODE 3 → Final verification
9. **USER CHOOSES QA** ✋
10. **Phase 7**: Git operations
11. **Phase 8**: modernization-detector

## Dependencies

- ✅ Authentication settings already added to `package.json`
- ✅ SDK authentication logic already implemented in `sdk-agent-adapter.ts`
- ✅ ConfigManager service available
- ⏳ Need to implement initialization call
- ⏳ Need to create Settings UI library
- ⏳ Need to add RPC methods

## Success Criteria

### Backend (TASK_2025_055)

- ✅ SDK `initialize()` called during extension activation
- ✅ ConfigManager watchers trigger re-initialization on auth changes
- ✅ Onboarding UI shown when no authentication configured
- ✅ Health status exposed via RPC to webview
- ✅ Clear error messages in logs

### Frontend (TASK_2025_056)

- ✅ Settings route accessible from chat UI
- ✅ AuthConfigComponent with token input and test button
- ✅ ModelSelectorComponent integrated
- ✅ AutopilotConfigComponent integrated
- ✅ Settings saved via RPC to VS Code configuration
- ✅ UI shows connection status after save

### Integration

- ✅ RPC methods handle settings updates
- ✅ Backend re-initializes SDK when settings change
- ✅ Frontend receives success/error feedback
- ✅ Authentication status visible in UI

## Testing Plan

1. **Extension Activation** (no auth configured):

   - Verify onboarding UI appears
   - Verify error logged

2. **Manual Auth Configuration** (via VS Code Settings):

   - Add token via Settings UI (Ctrl+,)
   - Verify SDK re-initializes automatically
   - Verify chat works

3. **Settings UI** (via webview):

   - Open settings page
   - Add/update token
   - Click "Save & Test Connection"
   - Verify success message
   - Verify chat works

4. **Config Watcher**:

   - Change token in VS Code Settings
   - Verify SDK re-initializes without reload

5. **Error Handling**:
   - Invalid token → Show error in UI
   - Empty token → Show onboarding UI
   - Network error → Show connection failed message
