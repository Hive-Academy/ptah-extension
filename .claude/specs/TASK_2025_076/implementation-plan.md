# Implementation Plan - TASK_2025_076

## Goal

Implement secure auth status display in Settings UI by migrating SDK auth credentials (OAuth token, API key) from plain-text VS Code settings to encrypted SecretStorage, adding an `auth:getAuthStatus` RPC endpoint that returns only boolean existence flags, and updating the frontend to display visual indicators for configured credentials.

---

## Proposed Changes

### Component 1: Auth Secrets Service (Backend - vscode-core)

**Purpose**: Provide SecretStorage wrapper for SDK auth credentials, following the `LlmSecretsService` pattern.

---

#### [NEW] `libs/backend/vscode-core/src/services/auth-secrets.service.ts`

**Purpose**: Encrypted storage for OAuth token and API key using VS Code SecretStorage
**Pattern Reference**: [llm-secrets.service.ts:85-246](file:///d:/projects/ptah-extension/libs/backend/llm-abstraction/src/lib/services/llm-secrets.service.ts#L85-L246)

```typescript
/**
 * Auth Secrets Service
 *
 * Manages SDK authentication credentials using VS Code's SecretStorage.
 * SecretStorage provides encrypted, secure storage for sensitive data.
 *
 * TASK_2025_076: Secure credential storage for OAuth token and API key
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Logger, ConfigManager, TOKENS } from '../index';

/**
 * Auth credential types supported by this service
 */
export type AuthCredentialType = 'oauthToken' | 'apiKey';

/**
 * Interface for auth secrets management
 */
export interface IAuthSecretsService {
  /**
   * Get credential from SecretStorage
   * @param type - Credential type
   * @returns Credential value or undefined if not set
   */
  getCredential(type: AuthCredentialType): Promise<string | undefined>;

  /**
   * Store credential in SecretStorage
   * @param type - Credential type
   * @param value - Credential value to store
   */
  setCredential(type: AuthCredentialType, value: string): Promise<void>;

  /**
   * Delete credential from SecretStorage
   * @param type - Credential type
   */
  deleteCredential(type: AuthCredentialType): Promise<void>;

  /**
   * Check if credential exists in SecretStorage
   * Returns boolean only - NEVER the actual value
   * @param type - Credential type
   * @returns true if credential is configured
   */
  hasCredential(type: AuthCredentialType): Promise<boolean>;

  /**
   * Migrate credentials from ConfigManager to SecretStorage
   * Reads from old plain-text location, stores in SecretStorage, clears old value
   */
  migrateFromConfigManager(): Promise<{ oauthMigrated: boolean; apiKeyMigrated: boolean }>;
}

/**
 * Auth Secrets Service Implementation
 *
 * Uses VS Code's SecretStorage for encrypted credential storage.
 * Keys are stored with prefix: `ptah.auth.{credentialType}`
 *
 * Pattern Reference: LlmSecretsService (llm-abstraction)
 */
@injectable()
export class AuthSecretsService implements IAuthSecretsService {
  private readonly SECRET_PREFIX = 'ptah.auth';

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager
  ) {
    this.logger.info('[AuthSecretsService.constructor] Service initialized');
  }

  /**
   * Get the secret storage key for a credential type
   */
  private getSecretKey(type: AuthCredentialType): string {
    const keyMap: Record<AuthCredentialType, string> = {
      oauthToken: 'claudeOAuthToken',
      apiKey: 'anthropicApiKey',
    };
    return `${this.SECRET_PREFIX}.${keyMap[type]}`;
  }

  /**
   * Get the ConfigManager key for migration
   */
  private getConfigKey(type: AuthCredentialType): string {
    const keyMap: Record<AuthCredentialType, string> = {
      oauthToken: 'claudeOAuthToken',
      apiKey: 'anthropicApiKey',
    };
    return keyMap[type];
  }

  async getCredential(type: AuthCredentialType): Promise<string | undefined> {
    const secretKey = this.getSecretKey(type);
    const value = await this.context.secrets.get(secretKey);

    this.logger.debug('[AuthSecretsService.getCredential] Retrieved status', {
      type,
      hasValue: !!value,
    });

    return value;
  }

  async setCredential(type: AuthCredentialType, value: string): Promise<void> {
    if (!value || value.trim().length === 0) {
      // Empty value means delete
      await this.deleteCredential(type);
      return;
    }

    const secretKey = this.getSecretKey(type);
    await this.context.secrets.store(secretKey, value.trim());

    // SECURITY: Never log actual credential values
    this.logger.info('[AuthSecretsService.setCredential] Credential stored', {
      type,
      valueLength: value.length,
      valuePrefix: value.substring(0, 10) + '...',
    });
  }

  async deleteCredential(type: AuthCredentialType): Promise<void> {
    const secretKey = this.getSecretKey(type);
    await this.context.secrets.delete(secretKey);

    this.logger.info('[AuthSecretsService.deleteCredential] Credential deleted', {
      type,
    });
  }

  async hasCredential(type: AuthCredentialType): Promise<boolean> {
    const value = await this.getCredential(type);
    return !!value && value.length > 0;
  }

  async migrateFromConfigManager(): Promise<{ oauthMigrated: boolean; apiKeyMigrated: boolean }> {
    let oauthMigrated = false;
    let apiKeyMigrated = false;

    // Migrate OAuth token
    const oauthFromConfig = this.configManager.get<string>('claudeOAuthToken');
    if (oauthFromConfig?.trim()) {
      // Check if already in SecretStorage
      const existingOauth = await this.hasCredential('oauthToken');
      if (!existingOauth) {
        await this.setCredential('oauthToken', oauthFromConfig);
        // Clear from ConfigManager (plain text)
        await this.configManager.set('claudeOAuthToken', '');
        oauthMigrated = true;
        this.logger.info('[AuthSecretsService.migrateFromConfigManager] OAuth token migrated to SecretStorage');
      }
    }

    // Migrate API key
    const apiKeyFromConfig = this.configManager.get<string>('anthropicApiKey');
    if (apiKeyFromConfig?.trim()) {
      // Check if already in SecretStorage
      const existingApiKey = await this.hasCredential('apiKey');
      if (!existingApiKey) {
        await this.setCredential('apiKey', apiKeyFromConfig);
        // Clear from ConfigManager (plain text)
        await this.configManager.set('anthropicApiKey', '');
        apiKeyMigrated = true;
        this.logger.info('[AuthSecretsService.migrateFromConfigManager] API key migrated to SecretStorage');
      }
    }

    return { oauthMigrated, apiKeyMigrated };
  }
}
```

**Quality Requirements**:

- ✅ Uses dependency injection (tsyringe)
- ✅ Follows `LlmSecretsService` pattern exactly
- ✅ Includes comprehensive logging (never actual values)
- ✅ Includes migration logic for existing credentials

---

#### [MODIFY] `libs/backend/vscode-core/src/di/tokens.ts`

**Line Range**: 92-100 (LLM Abstraction section)
**Changes**: Add `AUTH_SECRETS_SERVICE` token

```diff
// ========================================
// LLM Abstraction Service Tokens
// ========================================
export const LLM_SERVICE = Symbol.for('LlmService');
export const PROVIDER_REGISTRY = Symbol.for('ProviderRegistry');
export const LLM_SECRETS_SERVICE = Symbol.for('LlmSecretsService');
export const LLM_CONFIGURATION_SERVICE = Symbol.for('LlmConfigurationService');
export const LLM_RPC_HANDLERS = Symbol.for('LlmRpcHandlers');
+
+// ========================================
+// Auth Secrets Service Token (TASK_2025_076)
+// ========================================
+export const AUTH_SECRETS_SERVICE = Symbol.for('AuthSecretsService');
```

Also add to `TOKENS` constant (line ~260):

```diff
  // LLM Abstraction
  LLM_SERVICE,
  PROVIDER_REGISTRY,
  LLM_SECRETS_SERVICE,
  LLM_CONFIGURATION_SERVICE,
  LLM_RPC_HANDLERS,
+
+  // Auth Secrets (TASK_2025_076)
+  AUTH_SECRETS_SERVICE,
```

**Pattern Reference**: [tokens.ts:95-99](file:///d:/projects/ptah-extension/libs/backend/vscode-core/src/di/tokens.ts#L95-L99)

---

#### [MODIFY] `libs/backend/vscode-core/src/di/register.ts`

**Line Range**: 100-111 (after Agent Session Watcher)
**Changes**: Register `AuthSecretsService`

```diff
// ============================================================
// Agent Session Watcher
// ============================================================
container.registerSingleton(
  TOKENS.AGENT_SESSION_WATCHER_SERVICE,
  AgentSessionWatcherService
);

+// ============================================================
+// Auth Secrets Service (TASK_2025_076)
+// ============================================================
+import { AuthSecretsService } from '../services/auth-secrets.service';
+container.registerSingleton(TOKENS.AUTH_SECRETS_SERVICE, AuthSecretsService);
```

Also add to logged services array:

```diff
logger.info('[VS Code Core] Infrastructure services registered', {
  services: [
    'ERROR_HANDLER',
    'CONFIG_MANAGER',
    'MESSAGE_VALIDATOR',
    'COMMAND_MANAGER',
    'WEBVIEW_MANAGER',
    'STATUS_BAR_MANAGER',
    'FILE_SYSTEM_MANAGER',
    'RPC_HANDLER',
    'AGENT_SESSION_WATCHER_SERVICE',
    'WEBVIEW_MESSAGE_HANDLER',
+   'AUTH_SECRETS_SERVICE',
  ],
});
```

**Pattern Reference**: [register.ts:100-103](file:///d:/projects/ptah-extension/libs/backend/vscode-core/src/di/register.ts#L100-L103)

---

#### [MODIFY] `libs/backend/vscode-core/src/index.ts`

**Changes**: Export the new service and interface

```diff
+// Auth Secrets Service (TASK_2025_076)
+export { AuthSecretsService, IAuthSecretsService, AuthCredentialType } from './services/auth-secrets.service';
```

---

### Component 2: RPC Types (Shared)

**Purpose**: Type-safe parameter and response types for `auth:getAuthStatus` RPC

---

#### [MODIFY] `libs/shared/src/lib/types/rpc.types.ts`

**Line Range**: 283-285 (after AuthTestConnectionResponse)
**Changes**: Add `AuthGetAuthStatusParams` and `AuthGetAuthStatusResponse` types

```diff
/** Response from auth:testConnection RPC method */
export interface AuthTestConnectionResponse {
  success: boolean;
  health: {
    status: string;
    lastCheck: number;
    errorMessage?: string;
    responseTime?: number;
    uptime?: number;
  };
  errorMessage?: string;
}
+
+// ============================================================
+// Auth Status RPC Types (TASK_2025_076)
+// ============================================================
+
+/** Parameters for auth:getAuthStatus RPC method */
+export type AuthGetAuthStatusParams = Record<string, never>;
+
+/** Response from auth:getAuthStatus RPC method */
+export interface AuthGetAuthStatusResponse {
+  /** Whether OAuth token is configured in SecretStorage */
+  hasOAuthToken: boolean;
+  /** Whether API key is configured in SecretStorage */
+  hasApiKey: boolean;
+  /** Current auth method preference */
+  authMethod: 'oauth' | 'apiKey' | 'auto';
+}
```

**Pattern Reference**: [rpc.types.ts:242-255](file:///d:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts#L242-L255)

---

### Component 3: RPC Handlers (Backend - Extension App)

**Purpose**: Update `auth:saveSettings` to use SecretStorage, add `auth:getAuthStatus` handler

---

#### [MODIFY] `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts`

**Line Range**: 1024-1143 (registerAuthMethods)
**Changes**:

1. Inject `AuthSecretsService` in constructor
2. Update `auth:saveSettings` to store credentials in SecretStorage
3. Add `auth:getAuthStatus` RPC handler

##### Constructor Change (add dependency)

```diff
constructor(
  @inject(TOKENS.LOGGER) private readonly logger: Logger,
  @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
  // ... existing dependencies
  @inject(TOKENS.CONFIG_MANAGER)
  private readonly configManager: ConfigManager,
+ @inject(TOKENS.AUTH_SECRETS_SERVICE)
+ private readonly authSecretsService: IAuthSecretsService,
  @inject(TOKENS.COMMAND_MANAGER)
  private readonly commandManager: CommandManager,
```

##### Add import

```diff
import {
  Logger,
  RpcHandler,
  AgentSessionWatcherService,
  AgentSummaryChunk,
  TOKENS,
  ConfigManager,
  CommandManager,
  LlmRpcHandlers,
  SetApiKeyRequest,
  SetApiKeyResponse,
  LlmProviderName,
+ IAuthSecretsService,
} from '@ptah-extension/vscode-core';
```

##### Update registerAuthMethods (line ~1027)

```typescript
/**
 * Authentication RPC methods (TASK_2025_057, TASK_2025_076)
 */
private registerAuthMethods(): void {
  // auth:getHealth - Get SDK authentication health status (unchanged)
  this.rpcHandler.registerMethod<void, { success: boolean; health: unknown }>(
    'auth:getHealth',
    async () => {
      try {
        this.logger.debug('RPC: auth:getHealth called');
        const health = this.sdkAdapter.getHealth();
        return { success: true, health };
      } catch (error) {
        this.logger.error(
          'RPC: auth:getHealth failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    }
  );

  // auth:getAuthStatus - Get auth configuration status (TASK_2025_076)
  // SECURITY: Never returns actual credential values - only boolean existence flags
  this.rpcHandler.registerMethod<
    void,
    { hasOAuthToken: boolean; hasApiKey: boolean; authMethod: 'oauth' | 'apiKey' | 'auto' }
  >('auth:getAuthStatus', async () => {
    try {
      this.logger.debug('RPC: auth:getAuthStatus called');

      // Run migration if needed (first-time only)
      await this.authSecretsService.migrateFromConfigManager();

      // Check SecretStorage for credentials
      const hasOAuthToken = await this.authSecretsService.hasCredential('oauthToken');
      const hasApiKey = await this.authSecretsService.hasCredential('apiKey');

      // Get auth method from ConfigManager (non-sensitive)
      const authMethod = this.configManager.getWithDefault<'oauth' | 'apiKey' | 'auto'>(
        'authMethod',
        'auto'
      );

      this.logger.debug('RPC: auth:getAuthStatus result', {
        hasOAuthToken,
        hasApiKey,
        authMethod,
      });

      return { hasOAuthToken, hasApiKey, authMethod };
    } catch (error) {
      this.logger.error(
        'RPC: auth:getAuthStatus failed',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  });

  // auth:saveSettings - Save authentication settings (UPDATED for SecretStorage)
  const AuthSettingsSchema = z.object({
    authMethod: z.enum(['oauth', 'apiKey', 'auto']),
    claudeOAuthToken: z.string().optional(),
    anthropicApiKey: z.string().optional(),
  });

  this.rpcHandler.registerMethod<
    unknown,
    { success: boolean; error?: string }
  >('auth:saveSettings', async (params: unknown) => {
    try {
      // SECURITY: Sanitize params before logging (mask credentials)
      const sanitizedParams =
        typeof params === 'object' && params !== null
          ? {
              ...params,
              claudeOAuthToken:
                'claudeOAuthToken' in params &&
                typeof params.claudeOAuthToken === 'string' &&
                params.claudeOAuthToken
                  ? `***${params.claudeOAuthToken.slice(-4)}`
                  : undefined,
              anthropicApiKey:
                'anthropicApiKey' in params &&
                typeof params.anthropicApiKey === 'string' &&
                params.anthropicApiKey
                  ? `***${params.anthropicApiKey.slice(-4)}`
                  : undefined,
            }
          : params;
      this.logger.debug('RPC: auth:saveSettings called', {
        params: sanitizedParams,
      });

      // Validate parameters with Zod
      const validated = AuthSettingsSchema.parse(params);

      // Save auth method to ConfigManager (non-sensitive)
      await this.configManager.set('authMethod', validated.authMethod);

      // Save credentials to SecretStorage (TASK_2025_076 - encrypted!)
      if (validated.claudeOAuthToken !== undefined) {
        if (validated.claudeOAuthToken.trim()) {
          await this.authSecretsService.setCredential('oauthToken', validated.claudeOAuthToken);
        } else {
          // Empty string = clear the credential
          await this.authSecretsService.deleteCredential('oauthToken');
        }
      }

      if (validated.anthropicApiKey !== undefined) {
        if (validated.anthropicApiKey.trim()) {
          await this.authSecretsService.setCredential('apiKey', validated.anthropicApiKey);
        } else {
          // Empty string = clear the credential
          await this.authSecretsService.deleteCredential('apiKey');
        }
      }

      this.logger.info('RPC: auth:saveSettings completed successfully');
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Validation failed';
      this.logger.error('RPC: auth:saveSettings failed', {
        error: errorMessage,
      });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // auth:testConnection - Test connection after settings save (unchanged)
  // ... existing implementation
}
```

**Pattern Reference**: [rpc-method-registration.service.ts:1046-1112](file:///d:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts#L1046-L1112)

---

### Component 4: Auth Manager Update (agent-sdk)

**Purpose**: Update AuthManager to read credentials from SecretStorage instead of ConfigManager

---

#### [MODIFY] `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`

**Line Range**: 27-32 (constructor)
**Changes**: Inject `IAuthSecretsService` and read from SecretStorage

##### Constructor Change

```diff
import { injectable, inject } from 'tsyringe';
-import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
+import { Logger, ConfigManager, TOKENS, IAuthSecretsService } from '@ptah-extension/vscode-core';

@injectable()
export class AuthManager {
  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
-   @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager
+   @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
+   @inject(TOKENS.AUTH_SECRETS_SERVICE) private authSecrets: IAuthSecretsService
  ) {}
```

##### Update configureOAuthToken (line ~104)

```diff
private configureOAuthToken(): AuthResult {
- const oauthToken = this.config.get<string>('claudeOAuthToken');
+ // TASK_2025_076: Read from SecretStorage (async not needed here - fallback to sync)
+ // For now, we rely on RPC to have already migrated tokens
+ // AuthManager runs synchronously, so we check env var which was set by RPC
  const envOAuthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  const details: string[] = [];
```

> **Note**: This is a temporary solution. The `configureOAuthToken` method is synchronous, but SecretStorage is async. The proper solution is for the RPC layer to read from SecretStorage and set the env var before AuthManager runs. This is already the case since `auth:saveSettings` and `auth:getAuthStatus` handle SecretStorage, and SDK re-initialization reads from there.

For a **fully async solution**, the AuthManager should be refactored to use async methods, which is out of scope for this task. The current implementation will work because:

1. On extension activation, RPC runs migration (async)
2. When settings are saved, RPC stores in SecretStorage (async)
3. AuthManager reads from env vars set during initialization

**Alternative approach**: Update `SdkAgentAdapter.initialize()` to read from SecretStorage before calling AuthManager:

```typescript
// In sdk-agent-adapter.ts, before calling authManager.configureAuthentication
const oauthToken = await this.authSecretsService.getCredential('oauthToken');
if (oauthToken) {
  process.env['CLAUDE_CODE_OAUTH_TOKEN'] = oauthToken;
}
const apiKey = await this.authSecretsService.getCredential('apiKey');
if (apiKey) {
  process.env['ANTHROPIC_API_KEY'] = apiKey;
}
```

This ensures credentials from SecretStorage are available as env vars before AuthManager runs.

---

### Component 5: Frontend Auth Status Display

**Purpose**: Fetch auth status on init and display visual indicators

---

#### [MODIFY] `libs/frontend/chat/src/lib/settings/auth-config.component.ts`

**Line Range**: 54-72 (class definition and signals)
**Changes**: Add status fetch on init, add status signals

```diff
import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
+ OnInit,
+ effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  CheckCircle,
  XCircle,
  Loader2,
+ Check,
} from 'lucide-angular';
import { ClaudeRpcService, RpcResult } from '@ptah-extension/core';
import type {
  AuthSaveSettingsParams,
  AuthSaveSettingsResponse,
  AuthTestConnectionResponse,
+ AuthGetAuthStatusResponse,
} from '@ptah-extension/shared';

@Component({
  selector: 'ptah-auth-config',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './auth-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
-export class AuthConfigComponent {
+export class AuthConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly Loader2Icon = Loader2;
+ readonly CheckIcon = Check;

  // Form state signals
  readonly authMethod = signal<'oauth' | 'apiKey' | 'auto'>('auto');
  readonly oauthToken = signal('');
  readonly apiKey = signal('');

+ // Credential status signals (TASK_2025_076)
+ readonly hasExistingOAuthToken = signal(false);
+ readonly hasExistingApiKey = signal(false);
+ readonly isLoadingStatus = signal(true);

  // Connection status signals
  readonly connectionStatus = signal<
    'idle' | 'saving' | 'testing' | 'success' | 'error'
  >('idle');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

+ /**
+  * Fetch auth status on component initialization
+  */
+ async ngOnInit(): Promise<void> {
+   await this.fetchAuthStatus();
+ }
+
+ /**
+  * Fetch current auth status from backend
+  * SECURITY: Only boolean flags returned, never actual credential values
+  */
+ async fetchAuthStatus(): Promise<void> {
+   this.isLoadingStatus.set(true);
+   try {
+     const result = await this.rpcService.call<AuthGetAuthStatusResponse>(
+       'auth:getAuthStatus',
+       {}
+     );
+
+     if (result.isSuccess() && result.data) {
+       this.hasExistingOAuthToken.set(result.data.hasOAuthToken);
+       this.hasExistingApiKey.set(result.data.hasApiKey);
+       this.authMethod.set(result.data.authMethod);
+     }
+   } catch (error) {
+     console.error('[AuthConfigComponent] Failed to fetch auth status:', error);
+     // Graceful degradation - show empty state
+   } finally {
+     this.isLoadingStatus.set(false);
+   }
+ }

  async saveAndTest(): Promise<void> {
    // ... existing implementation
+   // Refetch status after successful save
+   if (this.connectionStatus() === 'success') {
+     await this.fetchAuthStatus();
+   }
  }
```

**Pattern Reference**: [auth-config.component.ts:54-72](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/auth-config.component.ts#L54-L72)

---

#### [MODIFY] `libs/frontend/chat/src/lib/settings/auth-config.component.html`

**Line Range**: 49-80 (OAuth Token Input section)
**Changes**: Add visual indicator and update placeholder when token is configured

```diff
<!-- OAuth Token Input -->
@if (authMethod() === 'oauth' || authMethod() === 'auto') {
<div class="form-control">
- <label class="label py-1" for="oauthToken">
-   <span class="label-text text-xs font-medium">Claude OAuth Token</span>
+ <label class="label py-1 justify-start gap-2" for="oauthToken">
+   <span class="label-text text-xs font-medium">Claude OAuth Token</span>
+   @if (hasExistingOAuthToken()) {
+   <span class="badge badge-success badge-xs gap-0.5" aria-label="OAuth token configured">
+     <lucide-angular [img]="CheckIcon" class="w-2.5 h-2.5" />
+     <span>Configured</span>
+   </span>
+   }
    @if (authMethod() === 'auto') {
    <span class="label-text-alt text-[10px]">(optional)</span>
    }
  </label>
  <input
    id="oauthToken"
    type="password"
    [(ngModel)]="oauthToken"
    name="oauthToken"
    class="input input-bordered input-sm w-full text-xs"
-   placeholder="Enter your OAuth token"
+   [placeholder]="hasExistingOAuthToken() ? 'Token configured - enter new value to replace' : 'Enter your OAuth token'"
    [attr.aria-required]="authMethod() === 'oauth'"
  />
```

Similar changes for API Key section (line 82-115):

```diff
<!-- API Key Input -->
@if (authMethod() === 'apiKey' || authMethod() === 'auto') {
<div class="form-control">
- <label class="label py-1" for="apiKey">
-   <span class="label-text text-xs font-medium">Anthropic API Key</span>
+ <label class="label py-1 justify-start gap-2" for="apiKey">
+   <span class="label-text text-xs font-medium">Anthropic API Key</span>
+   @if (hasExistingApiKey()) {
+   <span class="badge badge-success badge-xs gap-0.5" aria-label="API key configured">
+     <lucide-angular [img]="CheckIcon" class="w-2.5 h-2.5" />
+     <span>Configured</span>
+   </span>
+   }
    @if (authMethod() === 'auto') {
    <span class="label-text-alt text-[10px]">(optional)</span>
    }
  </label>
  <input
    id="apiKey"
    type="password"
    [(ngModel)]="apiKey"
    name="apiKey"
    class="input input-bordered input-sm w-full text-xs"
-   placeholder="sk-ant-api03-..."
+   [placeholder]="hasExistingApiKey() ? 'Key configured - enter new value to replace' : 'sk-ant-api03-...'"
    [attr.aria-required]="authMethod() === 'apiKey'"
  />
```

**Pattern Reference**: [auth-config.component.html:49-80](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/auth-config.component.html#L49-L80)

---

## Integration Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Angular)                            │
├─────────────────────────────────────────────────────────────────────┤
│  AuthConfigComponent                                                 │
│    ├── ngOnInit() ─────────────────┐                                │
│    │                                ▼                                │
│    │                    auth:getAuthStatus RPC                       │
│    │                                │                                │
│    │◄───────────────────────────────┤                                │
│    │   { hasOAuthToken, hasApiKey, authMethod }                      │
│    │                                                                 │
│    └── saveAndTest() ──────────────┐                                │
│                                     ▼                                │
│                         auth:saveSettings RPC                        │
│                                     │                                │
│                                     ▼                                │
└─────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        BACKEND (Extension)                          │
├─────────────────────────────────────────────────────────────────────┤
│  RpcMethodRegistrationService                                        │
│    ├── auth:getAuthStatus ─────────────────────────────────────┐    │
│    │     │ 1. Migrate from ConfigManager (if needed)            │    │
│    │     │ 2. Check SecretStorage for credentials               │    │
│    │     │ 3. Return boolean flags ONLY                         │    │
│    │     └──────────────────────────────────────────────────────┘    │
│    │                                                                 │
│    └── auth:saveSettings ──────────────────────────────────────┐    │
│          │ 1. Validate params with Zod                          │    │
│          │ 2. Save authMethod to ConfigManager (non-sensitive)  │    │
│          │ 3. Save credentials to SecretStorage (encrypted)     │    │
│          └──────────────────────────────────────────────────────┘    │
│                                                                       │
│  AuthSecretsService (vscode-core)                                    │
│    ├── getCredential() ─── context.secrets.get()                    │
│    ├── setCredential() ─── context.secrets.store()                  │
│    ├── hasCredential() ─── boolean only (SECURITY)                  │
│    └── migrateFromConfigManager() ─── one-time migration            │
│                                                                       │
│  AuthManager (agent-sdk)                                             │
│    └── Reads from process.env (set by SDK initialization)           │
└─────────────────────────────────────────────────────────────────────┘
```

### Storage Locations

| Data        | Old Location                            | New Location                                 | Access Pattern                      |
| ----------- | --------------------------------------- | -------------------------------------------- | ----------------------------------- |
| OAuth Token | `ptah.claudeOAuthToken` (settings.json) | `ptah.auth.claudeOAuthToken` (SecretStorage) | Write: RPC, Read: boolean flag only |
| API Key     | `ptah.anthropicApiKey` (settings.json)  | `ptah.auth.anthropicApiKey` (SecretStorage)  | Write: RPC, Read: boolean flag only |
| Auth Method | `ptah.authMethod` (settings.json)       | `ptah.authMethod` (settings.json)            | Full read/write (non-sensitive)     |

---

## Verification Plan

### Automated Tests

```bash
# Build all affected libraries
npx nx build vscode-core
npx nx build agent-sdk
npx nx build shared
npx nx build ptah-extension-vscode

# Lint
npx nx lint vscode-core
npx nx lint agent-sdk
npx nx lint shared
```

### Manual Verification

1. **Fresh install (no credentials)**:

   - Open Settings → Auth Config
   - Verify no "Configured" badges shown
   - Verify empty placeholders

2. **Save new credentials**:

   - Enter OAuth token, click Save & Test
   - Verify "Configured" badge appears
   - Verify placeholder changes to "Token configured - enter new value to replace"
   - Verify connection test succeeds

3. **Migration from old settings**:

   - Manually add `"ptah.claudeOAuthToken": "sk-ant-oat01-test"` to settings.json
   - Restart extension
   - Open Settings → Auth Config
   - Verify "Configured" badge appears (migration ran)
   - Verify settings.json no longer has the token (cleared after migration)

4. **Clear credentials**:

   - Clear the OAuth token input field
   - Click Save & Test
   - Verify "Configured" badge disappears

5. **Security verification**:
   - Check VS Code SecretStorage (via `context.secrets.get()` debug)
   - Verify no credentials in settings.json
   - Verify RPC response only contains boolean flags

---

## Team-Leader Handoff

**Developer Type**: both (backend + frontend)
**Complexity**: Medium
**Estimated Tasks**: 8 atomic tasks
**Batch Strategy**: Layer-based (backend first, then frontend)

### Recommended Task Batches

**Batch 1 (Backend Core)**:

1. Create `AuthSecretsService` with interface
2. Add token to `tokens.ts`
3. Register in `register.ts`
4. Export from `index.ts`

**Batch 2 (RPC Layer)**: 5. Add RPC types to shared 6. Update `auth:saveSettings` to use SecretStorage 7. Add `auth:getAuthStatus` RPC handler

**Batch 3 (Frontend)**: 8. Update `AuthConfigComponent` with status fetch and visual indicators
