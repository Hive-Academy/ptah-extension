# Implementation Plan - TASK_2025_073: LLM Abstraction Remediation & Phase 5

## Overview

This plan addresses critical findings from code reviews and completes Phase 5 (RPC handlers) from the original LLM abstraction implementation.

---

## Batch Structure

| Batch | Focus                                 | Priority     | Estimated Effort |
| ----- | ------------------------------------- | ------------ | ---------------- |
| 1     | Type Centralization & Package Exports | CRITICAL     | 2 hours          |
| 2     | Race Condition & State Management     | CRITICAL     | 3 hours          |
| 3     | Error Handling & Timeouts             | SERIOUS      | 2 hours          |
| 4     | Logging & Code Consistency            | SERIOUS      | 1.5 hours        |
| 5     | Phase 5: RPC Handlers                 | NEW FEATURE  | 3 hours          |
| 6     | Integration Testing & Verification    | VERIFICATION | 1.5 hours        |

**Total Estimated Effort**: 13 hours

---

## Batch 1: Type Centralization & Package Exports (CRITICAL)

### Purpose

Resolve type coupling issues and verify dynamic import paths have proper package.json exports.

### Issue References

- Style Review: Blocking Issue #3 - Type definition coupling
- Logic Review: Critical Issue #2 - Dynamic import export paths unverified

### Tasks

#### Task 1.1: Create Centralized Type Definitions

**File**: `libs/backend/llm-abstraction/src/lib/types/provider-types.ts` (CREATE)

**Implementation**:

```typescript
/**
 * Centralized LLM Provider Type Definitions
 *
 * TASK_2025_073: Moved from llm-secrets.service.ts for better cohesion
 * All provider-related types should be imported from this file.
 */

/**
 * Supported LLM provider identifiers
 */
export type LlmProviderName = 'anthropic' | 'openai' | 'google-genai' | 'openrouter' | 'vscode-lm';

/**
 * List of all supported providers (for validation)
 */
export const SUPPORTED_PROVIDERS: readonly LlmProviderName[] = ['anthropic', 'openai', 'google-genai', 'openrouter', 'vscode-lm'] as const;

/**
 * Provider display names for UI
 */
export const PROVIDER_DISPLAY_NAMES: Record<LlmProviderName, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  'google-genai': 'Google (Gemini)',
  openrouter: 'OpenRouter',
  'vscode-lm': 'VS Code Language Model',
} as const;

/**
 * Default models per provider
 */
export const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  'google-genai': 'gemini-1.5-pro',
  openrouter: 'anthropic/claude-sonnet-4',
  'vscode-lm': 'copilot-gpt-4o',
} as const;

/**
 * Check if a string is a valid provider name
 */
export function isValidProviderName(name: string): name is LlmProviderName {
  return SUPPORTED_PROVIDERS.includes(name as LlmProviderName);
}
```

#### Task 1.2: Update Imports Across Services

**Files to Update**:

- `libs/backend/llm-abstraction/src/lib/services/llm-secrets.service.ts`
- `libs/backend/llm-abstraction/src/lib/services/llm-configuration.service.ts`
- `libs/backend/llm-abstraction/src/lib/services/llm.service.ts`
- `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts`

**Pattern**:

```typescript
// BEFORE (scattered definitions):
export type LlmProviderName = 'anthropic' | 'openai' | ...;

// AFTER (centralized import):
import {
  LlmProviderName,
  SUPPORTED_PROVIDERS,
  isValidProviderName
} from '../types/provider-types';
```

#### Task 1.3: Add/Verify Package.json Exports

**File**: `libs/backend/llm-abstraction/package.json`

**Implementation**:

```json
{
  "name": "@ptah-extension/llm-abstraction",
  "exports": {
    ".": "./src/index.ts",
    "./anthropic": "./src/anthropic.ts",
    "./openai": "./src/openai.ts",
    "./google": "./src/google.ts",
    "./openrouter": "./src/openrouter.ts",
    "./vscode-lm": "./src/vscode-lm.ts"
  }
}
```

#### Task 1.4: Create Type-Safe Import Map

**File**: `libs/backend/llm-abstraction/src/lib/registry/provider-import-map.ts` (CREATE)

**Purpose**: Replace string literal imports with type-checked import map

**Implementation**:

```typescript
/**
 * Type-Safe Provider Import Map
 *
 * TASK_2025_073: Provides compile-time verification for dynamic imports
 */

import type { LlmProviderName } from '../types/provider-types';
import type { LlmProviderFactory } from './provider-registry';

/**
 * Provider module structure (what each secondary entry point exports)
 */
interface ProviderModule {
  createAnthropicProvider?: LlmProviderFactory;
  createOpenAIProvider?: LlmProviderFactory;
  createGoogleProvider?: LlmProviderFactory;
  createOpenRouterProvider?: LlmProviderFactory;
  createVsCodeLmProvider?: LlmProviderFactory;
}

/**
 * Import map for provider modules
 * Each entry is a lazy loader function that returns the factory
 */
export const PROVIDER_IMPORT_MAP: Record<LlmProviderName, () => Promise<LlmProviderFactory>> = {
  anthropic: async () => {
    const module = await import('@ptah-extension/llm-abstraction/anthropic');
    return module.createAnthropicProvider;
  },
  openai: async () => {
    const module = await import('@ptah-extension/llm-abstraction/openai');
    return module.createOpenAIProvider;
  },
  'google-genai': async () => {
    const module = await import('@ptah-extension/llm-abstraction/google');
    return module.createGoogleProvider;
  },
  openrouter: async () => {
    const module = await import('@ptah-extension/llm-abstraction/openrouter');
    return module.createOpenRouterProvider;
  },
  'vscode-lm': async () => {
    const module = await import('@ptah-extension/llm-abstraction/vscode-lm');
    return module.createVsCodeLmProvider;
  },
};
```

### Verification

- [ ] Type definitions centralized in single file
- [ ] All services import from centralized types
- [ ] Package.json exports all secondary entry points
- [ ] Import map provides compile-time safety
- [ ] Build passes: `npx nx build llm-abstraction`

---

## Batch 2: Race Condition & State Management (CRITICAL)

### Purpose

Fix provider switching race condition and nullable state management issues.

### Issue References

- Logic Review: Critical Issue #1 - Provider switching race condition
- Style Review: Blocking Issue #2 - Nullable currentProvider state
- Logic Review: Serious Issue #1 - No provider cleanup on error

### Tasks

#### Task 2.1: Add Async Lock for Provider Switching

**File**: `libs/backend/llm-abstraction/src/lib/services/llm.service.ts`

**Implementation**:

```typescript
import { Mutex } from 'async-mutex';

@injectable()
export class LlmService implements ILlmService {
  private currentProvider: ILlmProvider | null = null;
  private readonly providerMutex = new Mutex();

  /**
   * Set the active LLM provider (thread-safe)
   *
   * Uses mutex to prevent race conditions during provider switching.
   * Preserves previous provider on error for recovery.
   */
  public async setProvider(providerName: LlmProviderName, model: string): Promise<Result<void, LlmProviderError>> {
    // Acquire lock to prevent concurrent provider switching
    return this.providerMutex.runExclusive(async () => {
      const previousProvider = this.currentProvider;

      this.logger.debug('[LlmService] setProvider - acquiring lock', {
        providerName,
        model,
        hasPrevious: !!previousProvider,
      });

      const result = await this.providerRegistry.createProvider(providerName, model);

      if (result.isErr()) {
        // Preserve previous provider on error (don't leave in broken state)
        this.logger.warn('[LlmService] Provider creation failed, preserving previous', {
          providerName,
          error: result.error?.message,
        });
        return Result.err(result.error!);
      }

      this.currentProvider = result.value!;
      this.currentProviderName = providerName;
      this.currentModel = model;

      this.logger.info('[LlmService] Provider switched successfully', {
        providerName,
        model,
      });

      return Result.ok(undefined);
    });
  }
}
```

#### Task 2.2: Add async-mutex Dependency

**File**: `package.json` (root)

**Implementation**:

```bash
npm install async-mutex
```

#### Task 2.3: Initialize Default Provider Eagerly

**File**: `libs/backend/llm-abstraction/src/lib/services/llm.service.ts`

**Purpose**: Make currentProvider non-nullable by eager initialization

**Implementation**:

```typescript
@injectable()
export class LlmService implements ILlmService {
  private currentProvider: ILlmProvider | null = null;
  private isInitialized = false;

  constructor(
    @inject(TOKENS.PROVIDER_REGISTRY)
    private readonly providerRegistry: ProviderRegistry,
    @inject(TOKENS.LLM_CONFIGURATION_SERVICE)
    private readonly configService: LlmConfigurationService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    // Schedule eager initialization (non-blocking)
    void this.initializeDefaultProvider();
  }

  /**
   * Initialize with default provider (vscode-lm, no API key needed)
   */
  private async initializeDefaultProvider(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const defaultProvider = this.configService.getDefaultProvider();
      const defaultModel = this.configService.getDefaultModel(defaultProvider);

      const result = await this.setProvider(defaultProvider, defaultModel);

      if (result.isOk()) {
        this.isInitialized = true;
        this.logger.info('[LlmService] Default provider initialized', {
          provider: defaultProvider,
          model: defaultModel,
        });
      }
    } catch (error) {
      this.logger.warn('[LlmService] Failed to initialize default provider', { error });
    }
  }

  /**
   * Ensure provider is available before operations
   */
  private async ensureProvider(): Promise<Result<ILlmProvider, LlmProviderError>> {
    if (this.currentProvider) {
      return Result.ok(this.currentProvider);
    }

    // Try to initialize if not done
    await this.initializeDefaultProvider();

    if (this.currentProvider) {
      return Result.ok(this.currentProvider);
    }

    return Result.err(new LlmProviderError('No LLM provider configured. Call setProvider() first or configure API keys.', 'PROVIDER_NOT_INITIALIZED', 'LlmService'));
  }
}
```

### Verification

- [ ] async-mutex installed
- [ ] Provider switching uses mutex lock
- [ ] Previous provider preserved on error
- [ ] Default provider initialized eagerly
- [ ] No race conditions under concurrent calls
- [ ] Build passes: `npx nx build llm-abstraction`

---

## Batch 3: Error Handling & Timeouts (SERIOUS)

### Purpose

Add timeout protection and fix error handling inconsistencies.

### Issue References

- Logic Review: Serious Issue #3 - No timeout for provider creation
- Logic Review: Serious Issue #4 - getProvider() error code inconsistency
- Style Review: Serious Issue #4 - Inconsistent error handling

### Tasks

#### Task 3.1: Add Provider Creation Timeout

**File**: `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts`

**Implementation**:

```typescript
/**
 * Default timeout for provider creation (30 seconds)
 */
const PROVIDER_CREATION_TIMEOUT_MS = 30000;

/**
 * Create a provider with timeout protection
 */
public async createProvider(
  providerName: LlmProviderName,
  model: string,
  timeoutMs: number = PROVIDER_CREATION_TIMEOUT_MS
): Promise<Result<ILlmProvider, LlmProviderError>> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new LlmProviderError(
        `Provider creation timed out after ${timeoutMs}ms`,
        'PROVIDER_TIMEOUT',
        providerName
      ));
    }, timeoutMs);
  });

  try {
    const creationPromise = this.createProviderInternal(providerName, model);
    return await Promise.race([creationPromise, timeoutPromise]);
  } catch (error) {
    if (error instanceof LlmProviderError) {
      return Result.err(error);
    }
    return Result.err(LlmProviderError.fromError(error, providerName));
  }
}

/**
 * Internal provider creation logic (extracted for timeout wrapper)
 */
private async createProviderInternal(
  providerName: LlmProviderName,
  model: string
): Promise<Result<ILlmProvider, LlmProviderError>> {
  // ... existing createProvider logic moved here
}
```

#### Task 3.2: Fix Error Codes

**File**: `libs/backend/llm-abstraction/src/lib/services/llm.service.ts`

**Pattern**:

```typescript
// BEFORE (misleading):
new LlmProviderError(message, 'PROVIDER_NOT_FOUND', 'LlmService');

// AFTER (accurate):
new LlmProviderError(message, 'PROVIDER_NOT_INITIALIZED', 'LlmService');
```

#### Task 3.3: Standardize Error Handling Strategy

**Document and enforce**:

- Public API methods: Always return `Result<T, LlmProviderError>`
- Internal methods: Can throw (caught at public boundary)
- Never mix throw/Result in same method

### Verification

- [ ] Provider creation has 30s timeout
- [ ] Error codes are accurate and descriptive
- [ ] Error handling is consistent across all methods
- [ ] Build passes: `npx nx build llm-abstraction`

---

## Batch 4: Logging & Code Consistency (SERIOUS)

### Purpose

Standardize logging patterns and fix minor code inconsistencies.

### Issue References

- Style Review: Serious Issue #10 - Logging inconsistency
- Style Review: Serious Issue #5 - Magic string proliferation

### Tasks

#### Task 4.1: Standardize Logging Format

**Pattern**: `[ServiceName.methodName]` with structured params

**Example**:

```typescript
// BEFORE (inconsistent):
this.logger.debug('[LlmService] setProvider', { providerName });
this.logger.info('Provider switched');

// AFTER (consistent):
this.logger.debug('[LlmService.setProvider] Starting', { providerName, model });
this.logger.info('[LlmService.setProvider] Complete', { providerName, model, durationMs });
```

#### Task 4.2: Extract Magic Strings to Constants

**File**: `libs/backend/llm-abstraction/src/lib/types/provider-types.ts`

Already addressed in Batch 1 with `PROVIDER_DISPLAY_NAMES` and `DEFAULT_MODELS`.

#### Task 4.3: Add JSDoc to All Public Methods

Ensure all public methods have:

- Purpose description
- @param documentation
- @returns documentation
- @throws documentation (if applicable)

### Verification

- [ ] All logging uses `[ServiceName.methodName]` format
- [ ] Magic strings extracted to constants
- [ ] All public methods have JSDoc
- [ ] Build passes: `npx nx build llm-abstraction`

---

## Batch 5: Phase 5 - RPC Handlers (NEW FEATURE)

### Purpose

Implement RPC handlers for webview API key management.

### Feature Requirements

- Get/set API keys for each provider via RPC
- List configured providers
- Validate API key format
- Secure: API keys never sent to webview (only masked status)

### Tasks

#### Task 5.1: Create LLM RPC Handlers

**File**: `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts` (CREATE)

**Implementation**:

```typescript
/**
 * LLM RPC Handlers
 *
 * TASK_2025_073 Phase 5: RPC handlers for webview API key management
 *
 * Security: API keys are never sent to webview - only masked status.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';
import type { ILlmSecretsService, LlmConfigurationService } from '@ptah-extension/llm-abstraction';
import type { LlmProviderName } from '@ptah-extension/llm-abstraction';

export interface LlmProviderStatus {
  provider: LlmProviderName;
  displayName: string;
  isConfigured: boolean;
  defaultModel: string;
}

export interface SetApiKeyRequest {
  provider: LlmProviderName;
  apiKey: string;
}

export interface SetApiKeyResponse {
  success: boolean;
  error?: string;
}

@injectable()
export class LlmRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.LLM_SECRETS_SERVICE)
    private readonly secretsService: ILlmSecretsService,
    @inject(TOKENS.LLM_CONFIGURATION_SERVICE)
    private readonly configService: LlmConfigurationService
  ) {}

  /**
   * Get status of all LLM providers (without exposing API keys)
   */
  async getProviderStatus(): Promise<LlmProviderStatus[]> {
    this.logger.debug('[LlmRpcHandlers.getProviderStatus] Fetching provider status');

    const providers = await this.configService.getAvailableProviders();

    return providers.map((p) => ({
      provider: p.provider,
      displayName: p.displayName,
      isConfigured: p.isConfigured,
      defaultModel: p.model,
    }));
  }

  /**
   * Set API key for a provider
   */
  async setApiKey(request: SetApiKeyRequest): Promise<SetApiKeyResponse> {
    this.logger.debug('[LlmRpcHandlers.setApiKey] Setting API key', {
      provider: request.provider,
    });

    try {
      await this.secretsService.setApiKey(request.provider, request.apiKey);

      this.logger.info('[LlmRpcHandlers.setApiKey] API key saved', {
        provider: request.provider,
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('[LlmRpcHandlers.setApiKey] Failed to save API key', {
        provider: request.provider,
        error: message,
      });

      return { success: false, error: message };
    }
  }

  /**
   * Remove API key for a provider
   */
  async removeApiKey(provider: LlmProviderName): Promise<SetApiKeyResponse> {
    this.logger.debug('[LlmRpcHandlers.removeApiKey] Removing API key', { provider });

    try {
      await this.secretsService.deleteApiKey(provider);

      this.logger.info('[LlmRpcHandlers.removeApiKey] API key removed', { provider });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      return { success: false, error: message };
    }
  }

  /**
   * Get default provider from settings
   */
  getDefaultProvider(): LlmProviderName {
    return this.configService.getDefaultProvider();
  }

  /**
   * Validate API key format (without storing)
   */
  validateApiKeyFormat(provider: LlmProviderName, apiKey: string): { valid: boolean; error?: string } {
    try {
      // This will throw if format is invalid
      this.secretsService.validateKeyFormat(provider, apiKey);
      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid format';
      return { valid: false, error: message };
    }
  }
}
```

#### Task 5.2: Register RPC Handlers

**File**: `libs/backend/vscode-core/src/di/register.ts`

**Add**:

```typescript
import { LlmRpcHandlers } from '../rpc/llm-rpc-handlers';

// In registerVsCodeCoreServices:
container.registerSingleton(TOKENS.LLM_RPC_HANDLERS, LlmRpcHandlers);
```

#### Task 5.3: Add TOKENS for RPC Handlers

**File**: `libs/backend/vscode-core/src/di/tokens.ts`

**Add**:

```typescript
export const TOKENS = {
  // ... existing tokens ...
  LLM_RPC_HANDLERS: Symbol.for('LlmRpcHandlers'),
};
```

#### Task 5.4: Wire RPC Methods

**File**: `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts`

**Add RPC method registrations**:

```typescript
// LLM Provider Management (TASK_2025_073)
this.rpcHandler.registerMethod('llm.getProviderStatus', async () => {
  const handlers = this.container.resolve<LlmRpcHandlers>(TOKENS.LLM_RPC_HANDLERS);
  return handlers.getProviderStatus();
});

this.rpcHandler.registerMethod('llm.setApiKey', async (request: SetApiKeyRequest) => {
  const handlers = this.container.resolve<LlmRpcHandlers>(TOKENS.LLM_RPC_HANDLERS);
  return handlers.setApiKey(request);
});

this.rpcHandler.registerMethod('llm.removeApiKey', async (provider: LlmProviderName) => {
  const handlers = this.container.resolve<LlmRpcHandlers>(TOKENS.LLM_RPC_HANDLERS);
  return handlers.removeApiKey(provider);
});

this.rpcHandler.registerMethod('llm.getDefaultProvider', async () => {
  const handlers = this.container.resolve<LlmRpcHandlers>(TOKENS.LLM_RPC_HANDLERS);
  return handlers.getDefaultProvider();
});

this.rpcHandler.registerMethod('llm.validateApiKeyFormat', async (params: { provider: LlmProviderName; apiKey: string }) => {
  const handlers = this.container.resolve<LlmRpcHandlers>(TOKENS.LLM_RPC_HANDLERS);
  return handlers.validateApiKeyFormat(params.provider, params.apiKey);
});
```

### Verification

- [ ] LlmRpcHandlers class created
- [ ] TOKENS.LLM_RPC_HANDLERS added
- [ ] RPC handlers registered in DI
- [ ] RPC methods wired in registration service
- [ ] API keys never exposed to webview
- [ ] Build passes: `npx nx build vscode-core`
- [ ] Build passes: `npx nx build ptah-extension-vscode`

---

## Batch 6: Integration Testing & Verification

### Purpose

Verify all changes work correctly end-to-end.

### Tasks

#### Task 6.1: Build All Affected Libraries

```bash
npx nx build llm-abstraction
npx nx build vscode-core
npx nx build ptah-extension-vscode
npm run build:all
```

#### Task 6.2: Run Type Checking

```bash
npm run typecheck:all
```

#### Task 6.3: Run Linting

```bash
npm run lint:all
```

#### Task 6.4: Manual Testing

1. **Provider Switching**:

   - Open extension
   - Switch between providers
   - Verify no race conditions

2. **API Key Management**:

   - Test RPC: `llm.getProviderStatus`
   - Test RPC: `llm.setApiKey`
   - Test RPC: `llm.removeApiKey`

3. **MCP Namespace**:
   - Test `ptah.llm.anthropic.chat()` (if configured)
   - Test `ptah.llm.vscodeLm.chat()` (always available)
   - Test `ptah.llm.getConfiguredProviders()`

#### Task 6.5: Verify Code Review Issues Resolved

| Issue                | Status | Verification               |
| -------------------- | ------ | -------------------------- |
| Type coupling        | [ ]    | Types in provider-types.ts |
| Race condition       | [ ]    | async-mutex used           |
| No timeout           | [ ]    | 30s timeout added          |
| Error codes wrong    | [ ]    | Codes updated              |
| Logging inconsistent | [ ]    | Format standardized        |
| Package exports      | [ ]    | exports in package.json    |

### Verification

- [ ] All builds pass
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Manual testing complete
- [ ] All review issues addressed

---

## Definition of Done

### Required (MUST)

- [ ] All critical issues from code reviews resolved
- [ ] All serious issues from code reviews resolved
- [ ] Phase 5 RPC handlers implemented
- [ ] All builds pass
- [ ] Extension activates without errors

### Desired (SHOULD)

- [ ] Minor issues addressed where practical
- [ ] Documentation updated
- [ ] No new warnings introduced

### Optional (NICE TO HAVE)

- [ ] Unit tests for new code
- [ ] Integration tests for RPC handlers

---

## Risk Assessment

| Risk                               | Probability | Impact | Mitigation                                        |
| ---------------------------------- | ----------- | ------ | ------------------------------------------------- |
| async-mutex breaks other code      | LOW         | HIGH   | Test thoroughly, mutex only on provider switching |
| Package.json exports break webpack | MEDIUM      | HIGH   | Verify webpack aliases still work                 |
| RPC handlers break webview         | LOW         | MEDIUM | Manual testing before merge                       |
| Type centralization breaks imports | MEDIUM      | MEDIUM | Update all imports in same batch                  |

---

## Rollback Strategy

If issues arise:

1. Git revert batch commits individually
2. Each batch is independent and can be reverted separately
3. Phase 5 (RPC handlers) can be reverted without affecting remediation work
