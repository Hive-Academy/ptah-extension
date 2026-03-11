# Development Tasks - TASK_2025_076

**Task Type**: Full-Stack (Backend + Frontend)
**Total Tasks**: 8
**Total Batches**: 3
**Batching Strategy**: Layer-based (Backend Core → RPC Layer → Frontend)
**Status**: 3/3 batches complete (100%) ✅

---

## Batch 1: Backend Core - AuthSecretsService ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 4
**Dependencies**: None
**Git Commit**: `2d689c4` - feat(vscode): add AuthSecretsService for encrypted credential storage

### Task 1.1: Create AuthSecretsService ✅ COMPLETE

**File(s)**: `libs/backend/vscode-core/src/services/auth-secrets.service.ts` **[NEW]**
**Specification Reference**: [implementation-plan.md:Component 1](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_076/implementation-plan.md)
**Pattern to Follow**: [llm-secrets.service.ts:85-246](file:///d:/projects/ptah-extension/libs/backend/llm-abstraction/src/lib/services/llm-secrets.service.ts#L85-L246)

**Quality Requirements**:

- ✅ Injectable class with tsyringe decorators
- ✅ Uses `context.secrets.store()` and `context.secrets.get()`
- ✅ Implements `IAuthSecretsService` interface
- ✅ Includes `migrateFromConfigManager()` method
- ✅ Never logs actual credential values

---

### Task 1.2: Add AUTH_SECRETS_SERVICE Token ✅ COMPLETE

**File(s)**: `libs/backend/vscode-core/src/di/tokens.ts` **[MODIFY]**
**Specification Reference**: [implementation-plan.md:tokens.ts modification](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_076/implementation-plan.md)
**Pattern to Follow**: [tokens.ts:95-99](file:///d:/projects/ptah-extension/libs/backend/vscode-core/src/di/tokens.ts#L95-L99) (LLM_SECRETS_SERVICE token)

**Quality Requirements**:

- ✅ Add `AUTH_SECRETS_SERVICE` Symbol export (line ~100)
- ✅ Add to `TOKENS` constant object (line ~260)
- ✅ Follow existing token naming convention

---

### Task 1.3: Register AuthSecretsService in DI ✅ COMPLETE

**File(s)**: `libs/backend/vscode-core/src/di/register.ts` **[MODIFY]**
**Specification Reference**: [implementation-plan.md:register.ts modification](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_076/implementation-plan.md)
**Pattern to Follow**: [register.ts:100-103](file:///d:/projects/ptah-extension/libs/backend/vscode-core/src/di/register.ts#L100-L103) (AgentSessionWatcherService registration)

**Quality Requirements**:

- ✅ Import `AuthSecretsService` from services
- ✅ Register as singleton with `TOKENS.AUTH_SECRETS_SERVICE`
- ✅ Add to logged services array
- ✅ Place after WEBVIEW_MESSAGE_HANDLER registration

---

### Task 1.4: Export AuthSecretsService from Index ✅ COMPLETE

**File(s)**: `libs/backend/vscode-core/src/index.ts` **[MODIFY]**
**Specification Reference**: [implementation-plan.md:index.ts export](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_076/implementation-plan.md)
**Pattern to Follow**: Existing service exports in index.ts

**Quality Requirements**:

- ✅ Export `AuthSecretsService` class
- ✅ Export `IAuthSecretsService` interface
- ✅ Export `AuthCredentialType` type

---

**Batch 1 Verification**:

- ✅ All 4 files exist/modified at specified paths
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build vscode-core`
- ✅ `AuthSecretsService` is injectable and resolvable
- ✅ Token registered in `TOKENS` constant
- ✅ No compilation errors

---

## Batch 2: RPC Layer - Auth Status Endpoint ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 2
**Dependencies**: Batch 1 complete
**Git Commit**: `407f7ba` - feat(vscode): add auth:getAuthStatus RPC and SecretStorage integration

### Task 2.1: Add RPC Types for Auth Status ✅ COMPLETE

**File(s)**: `libs/shared/src/lib/types/rpc.types.ts` **[MODIFY]**
**Specification Reference**: [implementation-plan.md:Component 2](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_076/implementation-plan.md)
**Pattern to Follow**: [rpc.types.ts:242-255](file:///d:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts#L242-L255) (AuthGetHealthParams/Response)

**Quality Requirements**:

- ✅ Add `AuthGetAuthStatusParams` type (empty Record)
- ✅ Add `AuthGetAuthStatusResponse` interface with boolean flags
- ✅ Document that values are NEVER actual credentials
- ✅ Include `hasOAuthToken`, `hasApiKey`, `authMethod` fields

---

### Task 2.2: Update RPC Handlers for SecretStorage ✅ COMPLETE

**File(s)**: `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts` **[MODIFY]**
**Specification Reference**: [implementation-plan.md:Component 3](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_076/implementation-plan.md)
**Pattern to Follow**: [rpc-method-registration.service.ts:1046-1112](file:///d:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts#L1046-L1112)

**Quality Requirements**:

- ✅ Inject `IAuthSecretsService` in constructor
- ✅ Add `auth:getAuthStatus` RPC handler that returns boolean flags only
- ✅ Update `auth:saveSettings` to store in SecretStorage instead of ConfigManager
- ✅ Run migration on first `auth:getAuthStatus` call
- ✅ Never log or return actual credential values

---

**Batch 2 Verification**:

- ✅ All 2 files modified at specified paths
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build shared`, `npx nx build ptah-extension-vscode`
- ✅ `auth:getAuthStatus` RPC method registered
- ✅ `auth:saveSettings` uses SecretStorage
- ✅ No credentials exposed in RPC responses

---

## Batch 3: Frontend - Auth Status Display ✅ COMPLETE

**Assigned To**: frontend-developer
**Tasks in Batch**: 2
**Dependencies**: Batch 2 complete
**Git Commit**: `b4b9adb` - feat(webview): add auth status visual indicators to settings

### Task 3.1: Add Status Fetch to AuthConfigComponent ✅ COMPLETE

**File(s)**: `libs/frontend/chat/src/lib/settings/auth-config.component.ts` **[MODIFY]**
**Specification Reference**: [implementation-plan.md:Component 5](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_076/implementation-plan.md)
**Pattern to Follow**: [auth-config.component.ts:54-72](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/auth-config.component.ts#L54-L72) (existing signals pattern)
**Expected Commit Pattern**: `feat(chat): add auth status fetch and visual indicators to settings`

**Quality Requirements**:

- ✅ Implement `OnInit` interface with `ngOnInit()` method
- ✅ Add `hasExistingOAuthToken`, `hasExistingApiKey`, `isLoadingStatus` signals
- ✅ Add `fetchAuthStatus()` method that calls `auth:getAuthStatus` RPC
- ✅ Initialize `authMethod` signal from backend response
- ✅ Refetch status after successful save
- ✅ Handle RPC errors gracefully (show empty state)

**Implementation Details**:

- **Imports**: Add `OnInit` from `@angular/core`, `Check` from `lucide-angular`, `AuthGetAuthStatusResponse` from `@ptah-extension/shared`
- **New Signals**: `hasExistingOAuthToken = signal(false)`, `hasExistingApiKey = signal(false)`, `isLoadingStatus = signal(true)`
- **ngOnInit**: Call `fetchAuthStatus()`
- **fetchAuthStatus**: RPC call → set signals → catch errors

---

### Task 3.2: Add Visual Indicators to Template ✅ COMPLETE

**File(s)**: `libs/frontend/chat/src/lib/settings/auth-config.component.html` **[MODIFY]**
**Specification Reference**: [implementation-plan.md:Component 5 HTML](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_076/implementation-plan.md)
**Pattern to Follow**: [auth-config.component.html:49-80](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/auth-config.component.html#L49-L80) (existing input styling)
**Expected Commit Pattern**: (included in batch commit)

**Quality Requirements**:

- ✅ Add "Configured" badge next to OAuth Token label when `hasExistingOAuthToken()` is true
- ✅ Add "Configured" badge next to API Key label when `hasExistingApiKey()` is true
- ✅ Update placeholders: "Token configured - enter new value to replace"
- ✅ Use `lucide-angular` Check icon in badges
- ✅ Add `aria-label` for accessibility

**Implementation Details**:

- **Badge HTML**: `<span class="badge badge-success badge-xs gap-0.5" aria-label="OAuth token configured">`
- **Icon**: `<lucide-angular [img]="CheckIcon" class="w-2.5 h-2.5" />`
- **Dynamic Placeholder**: `[placeholder]="hasExistingOAuthToken() ? 'Token configured...' : 'Enter your OAuth token'"`
- **Both sections**: OAuth Token (line 49-80) and API Key (line 82-115)

---

**Batch 3 Verification Requirements**:

- ✅ All 2 files modified at specified paths
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build chat`
- ✅ Settings page shows "Configured" badge when credentials exist
- ✅ Placeholders update dynamically
- ✅ No visual regressions
- ✅ Accessibility labels present

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates ONE commit for entire batch
5. Developer returns with batch git commit SHA
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per batch (not per task)
- Commit message lists all completed tasks
- Avoids running pre-commit hooks multiple times

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified
- All files exist
- Builds pass for all affected projects:
  - `npx nx build vscode-core`
  - `npx nx build shared`
  - `npx nx build ptah-extension-vscode`
  - `npx nx build chat`

---

## Summary

| Batch | Name                              | Developer          | Tasks | Dependencies |
| ----- | --------------------------------- | ------------------ | ----- | ------------ |
| 1     | Backend Core - AuthSecretsService | backend-developer  | 4     | None         |
| 2     | RPC Layer - Auth Status Endpoint  | backend-developer  | 2     | Batch 1      |
| 3     | Frontend - Auth Status Display    | frontend-developer | 2     | Batch 2      |

**Next Command**: `/phase-6-backend-execution TASK_2025_076`
