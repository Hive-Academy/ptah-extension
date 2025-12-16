# Batch Plan - TASK_2025_076 Review Fixes

**Task**: Settings VS Code Secrets Sync - Code Review Fixes
**Status**: Planning
**Date**: 2025-12-16

---

## Overview

This batch plan addresses all issues identified in the code logic review (score 3/10) and code style review (score 6.5/10). The implementation has **CRITICAL INTEGRATION GAPS** where the SDK's AuthManager cannot read credentials from SecretStorage, making authentication completely non-functional.

**Total Issues**:

- Critical: 2 (SDK integration blockers)
- Serious: 7 (performance, security, type safety)
- Moderate/Minor: 5 (UX, documentation, polish)

---

## Batch Strategy

**Ordering Principle**: SDK integration must be fixed first since it blocks all authentication functionality. Performance and security fixes follow. UX polish comes last.

**Batch Groups**:

1. **Batch 1** - SDK Integration (CRITICAL - blocks everything)
2. **Batch 2** - Migration & Performance (SERIOUS - runs on every RPC call)
3. **Batch 3** - Type Safety & Security (SERIOUS - audit failures)
4. **Batch 4** - Frontend Error Handling (SERIOUS - UX improvements)
5. **Batch 5** - Polish & Documentation (MINOR - nice-to-have)

---

## Batch 1: SDK Integration Fixes (CRITICAL)

**Status**: Pending
**Developer**: backend-developer
**Priority**: CRITICAL - Blocks entire feature
**Estimated Time**: 2-3 hours
**Dependencies**: None

### Why This Batch?

The SDK's AuthManager reads credentials from ConfigManager (plain text), but `auth:saveSettings` now stores them in SecretStorage. This means:

- Users save credentials → SDK never sees them → authentication always fails
- This is a **COMPLETE FEATURE BLOCKER**

### Tasks

#### Task 1.1: Update AuthManager to Read from SecretStorage

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\auth-manager.ts`

**Changes**:

1. Inject `IAuthSecretsService` into constructor
2. Make `configureOAuthToken()` and `configureAPIKey()` async
3. Read credentials from SecretStorage instead of ConfigManager
4. Update all callers to await these methods

**Implementation Details**:

```typescript
// 1. Update imports
import { Logger, ConfigManager, TOKENS, IAuthSecretsService } from '@ptah-extension/vscode-core';

// 2. Inject AuthSecretsService
constructor(
  @inject(TOKENS.LOGGER) private logger: Logger,
  @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
  @inject(TOKENS.AUTH_SECRETS_SERVICE) private authSecrets: IAuthSecretsService // NEW
) {}

// 3. Make methods async and read from SecretStorage
private async configureOAuthToken(): Promise<AuthResult> {
  const oauthToken = await this.authSecrets.getCredential('oauthToken'); // NEW
  const envOAuthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];

  if (oauthToken) {
    return {
      method: 'oauth',
      status: 'success',
      credential: oauthToken,
      source: 'secretStorage',
    };
  }

  if (envOAuthToken) {
    return {
      method: 'oauth',
      status: 'success',
      credential: envOAuthToken,
      source: 'environment',
    };
  }

  return {
    method: 'oauth',
    status: 'error',
    errorMessage: 'No OAuth token configured. Run setup wizard or save in Settings.',
  };
}

private async configureAPIKey(): Promise<AuthResult> {
  const apiKey = await this.authSecrets.getCredential('apiKey'); // NEW
  const envApiKey = process.env['ANTHROPIC_API_KEY'];

  if (apiKey) {
    return {
      method: 'apiKey',
      status: 'success',
      credential: apiKey,
      source: 'secretStorage',
    };
  }

  if (envApiKey) {
    return {
      method: 'apiKey',
      status: 'success',
      credential: envApiKey,
      source: 'environment',
    };
  }

  return {
    method: 'apiKey',
    status: 'error',
    errorMessage: 'No API key configured. Get key from Anthropic Console.',
  };
}

// 4. Update configure() to be async
async configure(): Promise<AuthResult> {
  const authMethod = this.config.get<string>('authMethod') || 'auto';

  switch (authMethod) {
    case 'oauth':
      return await this.configureOAuthToken();
    case 'apiKey':
      return await this.configureAPIKey();
    case 'auto':
    default:
      return await this.autoDetect();
  }
}

// 5. Update autoDetect() to be async
private async autoDetect(): Promise<AuthResult> {
  const oauthResult = await this.configureOAuthToken();
  if (oauthResult.status === 'success') {
    return oauthResult;
  }

  const apiKeyResult = await this.configureAPIKey();
  if (apiKeyResult.status === 'success') {
    return apiKeyResult;
  }

  return {
    method: 'auto',
    status: 'error',
    errorMessage: 'No credentials configured. Please configure OAuth token or API key.',
  };
}
```

**Validation**:

- Build passes: `npx nx build agent-sdk`
- All callers of `configure()` are updated to await
- Integration test: Save via UI → SDK can authenticate

---

#### Task 1.2: Update ConfigWatcher to Watch SecretStorage

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\config-watcher.ts`

**Changes**:

1. Add SecretStorage event listener via `context.secrets.onDidChange()`
2. Remove `claudeOAuthToken` and `anthropicApiKey` from ConfigManager watch
3. Keep `authMethod` in ConfigManager watch (non-sensitive)

**Implementation Details**:

```typescript
export class ConfigWatcher {
  private secretsDisposable?: vscode.Disposable;

  watch(onConfigChange: () => void): void {
    this.dispose();

    // Watch authMethod in ConfigManager (non-sensitive)
    const watchKeys = ['authMethod']; // REMOVED: claudeOAuthToken, anthropicApiKey
    for (const key of watchKeys) {
      const watcher = this.config.watch(key, async () => {
        this.logger.info('[ConfigWatcher] Config changed', { key });
        onConfigChange();
      });
      this.watchers.push(watcher);
    }

    // NEW: Watch SecretStorage for credential changes
    this.secretsDisposable = this.context.secrets.onDidChange((event) => {
      if (event.key === 'ptah.auth.claudeOAuthToken' || event.key === 'ptah.auth.anthropicApiKey') {
        this.logger.info('[ConfigWatcher] Secret changed', { key: event.key });
        onConfigChange();
      }
    });
  }

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];

    if (this.secretsDisposable) {
      this.secretsDisposable.dispose();
      this.secretsDisposable = undefined;
    }
  }
}
```

**Validation**:

- Build passes: `npx nx build agent-sdk`
- Test: Change credentials in Settings → SDK re-initializes automatically

---

### Batch 1 Verification

**Success Criteria**:

- ✅ All builds pass (`npx nx build agent-sdk vscode-core`)
- ✅ Integration test: User saves OAuth token → SDK authenticates successfully
- ✅ Integration test: User changes token → SDK detects change and re-initializes
- ✅ No more "No OAuth token configured" errors after saving credentials

**Blocked By**: None (this IS the blocker)
**Blocks**: All other batches (nothing works until this is fixed)

---

## Batch 2: Migration Performance & Safety (SERIOUS)

**Status**: Pending
**Developer**: backend-developer
**Priority**: SERIOUS - Performance degradation and data loss risk
**Estimated Time**: 2 hours
**Dependencies**: None (but should follow Batch 1)

### Why This Batch?

Migration runs on EVERY `auth:getAuthStatus` call (every time Settings page loads). This causes:

- Unnecessary SecretStorage reads (2x per credential check)
- Unnecessary ConfigManager writes
- Performance degradation as extension scales
- No rollback if migration fails mid-way (data loss risk)

### Tasks

#### Task 2.1: Move Migration to Extension Activation

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`

**Changes**:

1. Run migration once during extension activation (before SDK init)
2. Track migration completion with a flag
3. Show notification if migration occurred

**Implementation Details**:

```typescript
export async function activate(context: vscode.ExtensionContext) {
  const container = DIContainer.setup(context);
  const authSecrets = container.resolve<AuthSecretsService>(TOKENS.AUTH_SECRETS_SERVICE);
  const config = container.resolve<ConfigManager>(TOKENS.CONFIG_MANAGER);

  // Check if migration already completed
  const migrationCompleted = config.get<boolean>('migration.secretsV1.completed', false);

  if (!migrationCompleted) {
    const result = await authSecrets.migrateFromConfigManager();

    if (result.oauthMigrated || result.apiKeyMigrated) {
      // Show notification
      vscode.window.showInformationMessage('Your authentication credentials have been migrated to secure storage.');
    }

    // Mark migration as completed
    await config.set('migration.secretsV1.completed', true);
  }

  // ... rest of activation
}
```

**Validation**:

- Extension activates without errors
- Migration runs once per installation
- Notification shows when credentials migrated

---

#### Task 2.2: Remove Migration Call from RPC Handler

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`

**Line**: 1063

**Changes**:
Remove `await this.authSecretsService.migrateFromConfigManager();` line

**Before**:

```typescript
this.rpcHandler.registerMethod('auth:getAuthStatus', async () => {
  await this.authSecretsService.migrateFromConfigManager(); // ❌ REMOVE THIS LINE

  const hasOAuthToken = await this.authSecretsService.hasCredential('oauthToken');
  const hasApiKey = await this.authSecretsService.hasCredential('apiKey');
  // ...
});
```

**After**:

```typescript
this.rpcHandler.registerMethod('auth:getAuthStatus', async () => {
  // Migration now runs once during activation (main.ts)

  const hasOAuthToken = await this.authSecretsService.hasCredential('oauthToken');
  const hasApiKey = await this.authSecretsService.hasCredential('apiKey');
  // ...
});
```

**Validation**:

- RPC calls are faster (no migration overhead)
- Opening Settings page doesn't re-run migration

---

#### Task 2.3: Add Rollback Mechanism to Migration

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\auth-secrets.service.ts`

**Line**: 245-294

**Changes**:
Wrap migration in try-catch with rollback logic for partial failures

**Implementation Details**:

```typescript
async migrateFromConfigManager(): Promise<{ oauthMigrated: boolean; apiKeyMigrated: boolean }> {
  let oauthMigrated = false;
  let apiKeyMigrated = false;

  // Backup original values for rollback
  const oauthConfigKey = this.getConfigKey('oauthToken');
  const apiKeyConfigKey = this.getConfigKey('apiKey');
  const originalOAuth = this.configManager.get<string>(oauthConfigKey);
  const originalApiKey = this.configManager.get<string>(apiKeyConfigKey);

  try {
    // Migrate OAuth token (isolated try-catch for partial success)
    try {
      if (originalOAuth?.trim()) {
        const existingOauth = await this.hasCredential('oauthToken');
        if (!existingOauth) {
          await this.setCredential('oauthToken', originalOAuth);
          await this.configManager.set(oauthConfigKey, '');
          oauthMigrated = true;
          this.logger.info('[AuthSecretsService] OAuth token migrated');
        }
      }
    } catch (error) {
      this.logger.error('[AuthSecretsService] OAuth migration failed', { error });
      // Rollback OAuth if it was partially migrated
      if (originalOAuth) {
        await this.configManager.set(oauthConfigKey, originalOAuth);
      }
    }

    // Migrate API key (isolated try-catch for partial success)
    try {
      if (originalApiKey?.trim()) {
        const existingApiKey = await this.hasCredential('apiKey');
        if (!existingApiKey) {
          await this.setCredential('apiKey', originalApiKey);
          await this.configManager.set(apiKeyConfigKey, '');
          apiKeyMigrated = true;
          this.logger.info('[AuthSecretsService] API key migrated');
        }
      }
    } catch (error) {
      this.logger.error('[AuthSecretsService] API key migration failed', { error });
      // Rollback API key if it was partially migrated
      if (originalApiKey) {
        await this.configManager.set(apiKeyConfigKey, originalApiKey);
      }
    }

    return { oauthMigrated, apiKeyMigrated };
  } catch (error) {
    // Catastrophic failure - restore all original values
    this.logger.error('[AuthSecretsService] Migration catastrophic failure, rolling back', { error });

    if (originalOAuth) {
      await this.configManager.set(oauthConfigKey, originalOAuth);
    }
    if (originalApiKey) {
      await this.configManager.set(apiKeyConfigKey, originalApiKey);
    }

    throw error;
  }
}
```

**Validation**:

- If migration fails partway, credentials are restored to ConfigManager
- Logs show which credentials migrated successfully
- No data loss on migration failure

---

### Batch 2 Verification

**Success Criteria**:

- ✅ Migration runs once per installation (not per RPC call)
- ✅ User sees notification when migration occurs
- ✅ If migration fails, credentials are not lost
- ✅ RPC handler is faster (no migration overhead)

**Blocked By**: Batch 1 (SDK integration)
**Blocks**: None (but performance is critical)

---

## Batch 3: Type Safety & Security Fixes (SERIOUS)

**Status**: Pending
**Developer**: backend-developer
**Priority**: SERIOUS - Security audit failure and type safety violations
**Estimated Time**: 1.5 hours
**Dependencies**: None

### Why This Batch?

Three serious issues:

1. Credential prefix logging (security risk)
2. RPC type mismatch (prevents validation)
3. Duplicate key mapping (maintenance burden)

### Tasks

#### Task 3.1: Remove Credential Prefix from Logging

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\auth-secrets.service.ts`

**Line**: 173

**Changes**:
Remove `valuePrefix` from log output entirely

**Before**:

```typescript
this.logger.info('[AuthSecretsService.setCredential] Credential stored', {
  type,
  valueLength: value.length,
  valuePrefix: value.substring(0, 10) + '...', // ❌ SECURITY RISK
});
```

**After**:

```typescript
this.logger.info('[AuthSecretsService.setCredential] Credential stored', {
  type,
  valueLength: value.length,
  // REMOVED: valuePrefix (zero credential exposure)
});
```

**Validation**:

- No credential data (including prefixes) in logs
- Security audit passes

---

#### Task 3.2: Fix RPC Type Mismatch

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`

**Line**: 1051-1057

**Changes**:
Import and use `AuthGetAuthStatusParams` and `AuthGetAuthStatusResponse` types

**Before**:

```typescript
this.rpcHandler.registerMethod<
  void,  // ❌ WRONG - should be AuthGetAuthStatusParams
  { hasOAuthToken: boolean; hasApiKey: boolean; authMethod: 'oauth' | 'apiKey' | 'auto' }
>('auth:getAuthStatus', async () => {
```

**After**:

```typescript
import type {
  AuthGetAuthStatusParams,
  AuthGetAuthStatusResponse
} from '@ptah-extension/shared';

this.rpcHandler.registerMethod<
  AuthGetAuthStatusParams,
  AuthGetAuthStatusResponse
>('auth:getAuthStatus', async (params: AuthGetAuthStatusParams) => {
```

**Validation**:

- TypeScript compilation passes
- RPC type contract matches implementation
- Zod validation can be added later

---

#### Task 3.3: Consolidate Key Mapping Logic

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\auth-secrets.service.ts`

**Line**: 97-114

**Changes**:
Create single KEY_MAP constant, use in both methods

**Before**:

```typescript
private getSecretKey(type: AuthCredentialType): string {
  const keyMap: Record<AuthCredentialType, string> = {
    oauthToken: 'claudeOAuthToken',
    apiKey: 'anthropicApiKey',
  };
  return `${this.SECRET_PREFIX}.${keyMap[type]}`;
}

private getConfigKey(type: AuthCredentialType): string {
  const keyMap: Record<AuthCredentialType, string> = {
    oauthToken: 'claudeOAuthToken',  // DUPLICATE
    apiKey: 'anthropicApiKey',        // DUPLICATE
  };
  return keyMap[type];
}
```

**After**:

```typescript
private readonly KEY_MAP: Record<AuthCredentialType, string> = {
  oauthToken: 'claudeOAuthToken',
  apiKey: 'anthropicApiKey',
};

private getSecretKey(type: AuthCredentialType): string {
  return `${this.SECRET_PREFIX}.${this.KEY_MAP[type]}`;
}

private getConfigKey(type: AuthCredentialType): string {
  return this.KEY_MAP[type];
}
```

**Validation**:

- Single source of truth for key mapping
- Adding new credential type requires updating only KEY_MAP

---

#### Task 3.4: Add Timeout to RPC Handler

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`

**Line**: 1102 (auth:saveSettings handler)

**Changes**:
Wrap RPC handler logic in timeout protection

**Implementation Details**:

```typescript
// Add utility wrapper (if not already exists)
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs))]);
}

// Usage in auth:saveSettings
this.rpcHandler.registerMethod('auth:saveSettings', async (params: unknown) => {
  return withTimeout(
    (async () => {
      // ... existing implementation
    })(),
    10000, // 10 second timeout
    'Save settings operation timed out'
  );
});
```

**Validation**:

- RPC calls don't hang indefinitely
- User gets timeout error after 10 seconds

---

### Batch 3 Verification

**Success Criteria**:

- ✅ No credential data in logs (security audit passes)
- ✅ RPC types match contract (TypeScript compilation passes)
- ✅ Key mapping consolidated (single source of truth)
- ✅ RPC calls have timeout protection

**Blocked By**: None (independent fixes)
**Blocks**: None

---

## Batch 4: Frontend Error Handling & UX (SERIOUS)

**Status**: Pending
**Developer**: frontend-developer
**Priority**: SERIOUS - UX improvements
**Estimated Time**: 1 hour
**Dependencies**: None

### Why This Batch?

Frontend has several UX issues:

1. Async ngOnInit without error handling (silent failures)
2. No loading state for badges (confusing false state display)
3. Verbose placeholder text (mobile UX)

### Tasks

#### Task 4.1: Add Error Handling to ngOnInit

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.ts`

**Line**: 86-88

**Changes**:
Add try-catch with error state handling

**Before**:

```typescript
async ngOnInit(): Promise<void> {
  await this.fetchAuthStatus();  // If this throws, error is lost
}
```

**After**:

```typescript
async ngOnInit(): Promise<void> {
  try {
    await this.fetchAuthStatus();
  } catch (error) {
    console.error('[AuthConfigComponent] Failed to initialize auth status:', error);
    this.errorMessage.set('Failed to load authentication status. Please try refreshing.');
  }
}
```

**Validation**:

- If fetchAuthStatus() throws, user sees error message
- Component doesn't break on initialization failure

---

#### Task 4.2: Add Loading State to Badges

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.html`

**Line**: 52-65

**Changes**:
Show loading skeleton while status is being fetched

**Before**:

```html
@if (hasExistingOAuthToken()) {
<span class="badge badge-success badge-xs gap-0.5" aria-label="OAuth token configured">
  <lucide-angular [img]="CheckIcon" class="w-2.5 h-2.5" />
  <span>Configured</span>
</span>
}
```

**After**:

```html
@if (isLoadingStatus()) {
<span class="badge badge-ghost badge-xs" aria-label="Loading authentication status">
  <span class="loading loading-spinner loading-xs"></span>
</span>
} @else if (hasExistingOAuthToken()) {
<span class="badge badge-success badge-xs gap-0.5" aria-label="OAuth token configured">
  <lucide-angular [img]="CheckIcon" class="w-2.5 h-2.5" />
  <span>Configured</span>
</span>
}
```

**Apply same pattern to API Key badge**

**Validation**:

- Loading spinner shows while fetching status
- No false "not configured" state flash

---

#### Task 4.3: Shorten Placeholder Text

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.html`

**Line**: 72-76

**Changes**:
Make placeholder more concise for mobile

**Before**:

```html
[placeholder]="hasExistingOAuthToken() ? 'Token configured - enter new value to replace' : 'Enter your OAuth token'"
```

**After**:

```html
[placeholder]="hasExistingOAuthToken() ? 'Configured - enter to replace' : 'Enter your OAuth token'"
```

**Apply same pattern to API Key input**

**Validation**:

- Placeholder fits on mobile screens
- Still clear to users

---

### Batch 4 Verification

**Success Criteria**:

- ✅ ngOnInit errors are caught and displayed
- ✅ Loading spinner shows during status fetch
- ✅ No false state flash during initialization
- ✅ Placeholder text fits on mobile

**Blocked By**: None (independent fixes)
**Blocks**: None

---

## Batch 5: Polish & Documentation (MINOR)

**Status**: Pending
**Developer**: backend-developer
**Priority**: MINOR - Nice-to-have improvements
**Estimated Time**: 45 minutes
**Dependencies**: None

### Why This Batch?

Final polish for code quality:

1. Inconsistent JSDoc coverage
2. Magic number for timeout
3. Console.error in production code

### Tasks

#### Task 5.1: Add @example to Interface Methods

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\auth-secrets.service.ts`

**Line**: 27-62

**Changes**:
Add @example tags to all interface methods

**Example**:

````typescript
export interface IAuthSecretsService {
  /**
   * Get credential from SecretStorage
   * @param type - Credential type
   * @returns Credential value or undefined if not set
   *
   * @example
   * ```typescript
   * const token = await authSecrets.getCredential('oauthToken');
   * if (token) {
   *   console.log('Token configured');
   * }
   * ```
   */
  getCredential(type: AuthCredentialType): Promise<string | undefined>;

  // ... add @example to all other methods
}
````

**Validation**:

- All interface methods have @example
- JSDoc consistency across service

---

#### Task 5.2: Extract Magic Number to Constant

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.ts`

**Line**: 196

**Changes**:
Create named constant for timeout value

**Before**:

```typescript
const testResult = await this.callWithTimeout<AuthTestConnectionResponse>(
  'auth:testConnection',
  {},
  10000, // Magic number
  'Connection test timed out after 10 seconds'
);
```

**After**:

```typescript
private readonly CONNECTION_TEST_TIMEOUT_MS = 10000;

const testResult = await this.callWithTimeout<AuthTestConnectionResponse>(
  'auth:testConnection',
  {},
  this.CONNECTION_TEST_TIMEOUT_MS,
  'Connection test timed out after 10 seconds'
);
```

**Validation**:

- No magic numbers in code
- Easy to change timeout value

---

#### Task 5.3: Consider Logging Service (Optional)

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.ts`

**Line**: 108

**Note**: This is optional since console.error is acceptable in frontend code.

**Changes**:
If frontend logging service exists, use it instead of console.error

**Before**:

```typescript
catch (error) {
  console.error('[AuthConfigComponent] Failed to fetch auth status:', error);
}
```

**After** (if logging service exists):

```typescript
catch (error) {
  this.logger.error('Failed to fetch auth status', { error });
}
```

**Validation**:

- Consistent logging pattern across codebase

---

### Batch 5 Verification

**Success Criteria**:

- ✅ All interface methods have @example
- ✅ No magic numbers in code
- ✅ (Optional) Consistent logging pattern

**Blocked By**: None (polish tasks)
**Blocks**: None

---

## Summary & Execution Order

### Execution Sequence

```
Batch 1 (CRITICAL) → Batch 2 (SERIOUS) → Batch 3 (SERIOUS) → Batch 4 (SERIOUS) → Batch 5 (MINOR)
    ↓                      ↓                      ↓                      ↓                   ↓
SDK Integration    Migration Performance   Type Safety/Security   Frontend UX         Polish
(2-3 hours)          (2 hours)              (1.5 hours)           (1 hour)           (45 min)
```

**Total Estimated Time**: 7-8 hours

### Batch Assignments

| Batch   | Developer          | Priority | Time | Blocking? |
| ------- | ------------------ | -------- | ---- | --------- |
| Batch 1 | backend-developer  | CRITICAL | 2-3h | YES       |
| Batch 2 | backend-developer  | SERIOUS  | 2h   | NO        |
| Batch 3 | backend-developer  | SERIOUS  | 1.5h | NO        |
| Batch 4 | frontend-developer | SERIOUS  | 1h   | NO        |
| Batch 5 | backend-developer  | MINOR    | 45m  | NO        |

### Files Modified by Batch

**Batch 1**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\auth-manager.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\config-watcher.ts`

**Batch 2**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\auth-secrets.service.ts`

**Batch 3**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\auth-secrets.service.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`

**Batch 4**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.html`

**Batch 5**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\auth-secrets.service.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.ts`

### Success Metrics

**Before Fixes**:

- Code Logic Score: 3/10 (REJECTED)
- Code Style Score: 6.5/10 (NEEDS_REVISION)
- Authentication: BROKEN

**After All Batches**:

- Code Logic Score: 9/10 (APPROVED)
- Code Style Score: 9/10 (APPROVED)
- Authentication: FUNCTIONAL
- Security: AUDIT PASSES
- Performance: OPTIMIZED

---

## Risk Assessment

| Risk                                 | Probability | Impact   | Mitigation                               |
| ------------------------------------ | ----------- | -------- | ---------------------------------------- |
| Batch 1 breaks SDK initialization    | Medium      | CRITICAL | Test after each task, rollback if needed |
| Migration fails after Batch 2        | Low         | MODERATE | Rollback mechanism in Task 2.3           |
| Type changes break RPC clients       | Low         | MODERATE | Type is compatible (no runtime changes)  |
| Frontend loading state breaks UI     | Very Low    | LOW      | Simple template change, easy to test     |
| Documentation changes have no impact | N/A         | N/A      | Pure documentation (no code impact)      |

---

## Next Steps

1. **Orchestrator**: Invoke backend-developer with Batch 1
2. **After Batch 1**: Verify SDK integration with integration test
3. **After Batch 2**: Verify migration runs once and has rollback
4. **After Batch 3**: Run security audit on logs
5. **After Batch 4**: Test frontend on mobile viewport
6. **After Batch 5**: Run final QA and close task

---

## Validation Checklist

After all batches complete:

- [ ] User saves OAuth token → SDK authenticates successfully
- [ ] User changes token → SDK detects change and re-initializes
- [ ] Migration runs once per installation (not per RPC call)
- [ ] If migration fails, credentials are not lost
- [ ] No credential data (including prefixes) in logs
- [ ] RPC types match contract (TypeScript compilation passes)
- [ ] Loading spinner shows while fetching auth status
- [ ] All interface methods have @example tags
- [ ] No magic numbers in code
- [ ] All builds pass: `npx nx run-many --target=build --all`
- [ ] All lints pass: `npx nx run-many --target=lint --all`
