# Development Tasks - TASK_2025_073: LLM Abstraction Remediation & Phase 5

**Total Tasks**: 22 | **Batches**: 6 | **Status**: 0/6 complete

---

## Summary

This task addresses code review findings from TASK_2025_071 (LLM Abstraction Implementation) and completes the deferred Phase 5 (RPC handlers).

### Review Scores

- **Code Style Review**: 6.5/10 (NEEDS_REVISION)
- **Code Logic Review**: 6.5/10 (NEEDS_REVISION)

### Issue Breakdown

| Priority | Issues | Addressed In |
| -------- | ------ | ------------ |
| CRITICAL | 5      | Batches 1-2  |
| SERIOUS  | 11     | Batches 3-4  |
| MINOR    | 8      | Nice to have |

---

## Batch 1: Type Centralization & Package Exports ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Priority**: CRITICAL

### Task 1.1: Create Centralized Type Definitions ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\types\provider-types.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Batch 1)

**Quality Requirements**:

- Export `LlmProviderName` type
- Export `SUPPORTED_PROVIDERS` array
- Export `PROVIDER_DISPLAY_NAMES` record
- Export `DEFAULT_MODELS` record
- Export `isValidProviderName()` type guard

**Implementation Details**:

```typescript
export type LlmProviderName = 'anthropic' | 'openai' | 'google-genai' | 'openrouter' | 'vscode-lm';

export const SUPPORTED_PROVIDERS: readonly LlmProviderName[] = ['anthropic', 'openai', 'google-genai', 'openrouter', 'vscode-lm'] as const;

export const PROVIDER_DISPLAY_NAMES: Record<LlmProviderName, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  'google-genai': 'Google (Gemini)',
  openrouter: 'OpenRouter',
  'vscode-lm': 'VS Code Language Model',
} as const;

export const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  'google-genai': 'gemini-1.5-pro',
  openrouter: 'anthropic/claude-sonnet-4',
  'vscode-lm': 'copilot-gpt-4o',
} as const;

export function isValidProviderName(name: string): name is LlmProviderName {
  return SUPPORTED_PROVIDERS.includes(name as LlmProviderName);
}
```

---

### Task 1.2: Update Service Imports to Use Centralized Types ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm-secrets.service.ts`
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm-configuration.service.ts`
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm.service.ts`
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\registry\provider-registry.ts`

**Dependencies**: Task 1.1

**Quality Requirements**:

- Remove duplicate type definitions from each file
- Import from `../types/provider-types`
- Verify no breaking changes to public API

---

### Task 1.3: Add Package.json Exports ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\package.json`
**Dependencies**: Task 1.2

**Quality Requirements**:

- Add `exports` field with all secondary entry points
- Verify webpack can still resolve imports

**Implementation Details**:

```json
{
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

---

### Task 1.4: Create Type-Safe Import Map ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\registry\provider-import-map.ts` (CREATE)
**Dependencies**: Task 1.3

**Quality Requirements**:

- Replace string literal switch statement in provider-registry.ts
- Export typed `PROVIDER_IMPORT_MAP` record
- Each entry is async function returning factory

---

**Batch 1 Verification**:

- [ ] Types centralized in provider-types.ts
- [ ] All services import from centralized file
- [ ] No duplicate type definitions
- [ ] Package.json exports verified
- [ ] Import map provides compile-time safety
- [ ] Build passes: `npx nx build llm-abstraction`

---

## Batch 2: Race Condition & State Management ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete
**Priority**: CRITICAL

### Task 2.1: Add async-mutex Dependency ⏸️ PENDING

**File**: `D:\projects\ptah-extension\package.json`

**Implementation**:

```bash
npm install async-mutex
```

**Quality Requirements**:

- Package added to dependencies (not devDependencies)
- Lock file updated

---

### Task 2.2: Add Mutex Lock for Provider Switching ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm.service.ts`
**Dependencies**: Task 2.1

**Quality Requirements**:

- Import `Mutex` from `async-mutex`
- Create private `providerMutex` instance
- Wrap `setProvider()` in `providerMutex.runExclusive()`
- Preserve previous provider on error

**Implementation Pattern**:

```typescript
import { Mutex } from 'async-mutex';

private readonly providerMutex = new Mutex();

public async setProvider(providerName, model) {
  return this.providerMutex.runExclusive(async () => {
    const previousProvider = this.currentProvider;
    // ... provider creation
    if (result.isErr()) {
      // Don't change currentProvider on error
      return Result.err(result.error);
    }
    this.currentProvider = result.value;
    return Result.ok(undefined);
  });
}
```

---

### Task 2.3: Add Eager Default Provider Initialization ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm.service.ts`
**Dependencies**: Task 2.2

**Quality Requirements**:

- Add `isInitialized` flag
- Call `initializeDefaultProvider()` in constructor (non-blocking)
- Add `ensureProvider()` helper for operations

---

### Task 2.4: Add Error Recovery Logic ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm.service.ts`
**Dependencies**: Task 2.3

**Quality Requirements**:

- On `setProvider()` failure, preserve previous provider
- Log warning when falling back to previous provider
- Never leave service in broken state

---

**Batch 2 Verification**:

- [ ] async-mutex installed
- [ ] Provider switching uses mutex
- [ ] No race conditions possible
- [ ] Previous provider preserved on error
- [ ] Default provider initialized eagerly
- [ ] Build passes: `npx nx build llm-abstraction`

---

## Batch 3: Error Handling & Timeouts ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 2 complete
**Priority**: SERIOUS

### Task 3.1: Add Provider Creation Timeout ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\registry\provider-registry.ts`

**Quality Requirements**:

- Add `PROVIDER_CREATION_TIMEOUT_MS = 30000` constant
- Wrap provider creation in `Promise.race()` with timeout
- Return `LlmProviderError` with code `PROVIDER_TIMEOUT` on timeout

---

### Task 3.2: Fix Error Codes ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm.service.ts`

**Quality Requirements**:

- Change `PROVIDER_NOT_FOUND` to `PROVIDER_NOT_INITIALIZED` where appropriate
- Ensure error codes are accurate and descriptive

---

### Task 3.3: Add SecretStorage Error Handling ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\registry\provider-registry.ts`

**Quality Requirements**:

- Wrap `secretsService.getApiKey()` in try/catch
- Return appropriate error on SecretStorage failure

---

### Task 3.4: Standardize Error Handling Pattern ⏸️ PENDING

**Files**: All llm-abstraction service files

**Quality Requirements**:

- Public methods: Return `Result<T, LlmProviderError>`
- Internal methods: Can throw (caught at public boundary)
- Document pattern in file header

---

**Batch 3 Verification**:

- [ ] 30s timeout on provider creation
- [ ] Error codes accurate
- [ ] SecretStorage errors handled
- [ ] Consistent error handling pattern
- [ ] Build passes: `npx nx build llm-abstraction`

---

## Batch 4: Logging & Code Consistency ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 3 complete
**Priority**: SERIOUS

### Task 4.1: Standardize Logging Format ⏸️ PENDING

**Files**: All llm-abstraction service files

**Quality Requirements**:

- Format: `[ServiceName.methodName] Message`
- Include structured params
- Example: `this.logger.debug('[LlmService.setProvider] Starting', { providerName, model });`

---

### Task 4.2: Remove Duplicate Constants ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm-configuration.service.ts`
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\registry\provider-registry.ts`

**Quality Requirements**:

- Remove `DEFAULT_MODELS` from llm-configuration.service.ts (use centralized)
- Remove `PROVIDER_DISPLAY_NAMES` from llm-configuration.service.ts (use centralized)
- Import from `../types/provider-types`

---

### Task 4.3: Add Missing JSDoc ⏸️ PENDING

**Files**: All llm-abstraction public interfaces

**Quality Requirements**:

- All public methods have JSDoc
- Include @param, @returns, @throws

---

**Batch 4 Verification**:

- [ ] Logging format standardized
- [ ] No duplicate constants
- [ ] All public methods have JSDoc
- [ ] Build passes: `npx nx build llm-abstraction`

---

## Batch 5: Phase 5 - RPC Handlers ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 4 complete
**Priority**: NEW FEATURE

### Task 5.1: Create LlmRpcHandlers Class ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\llm-rpc-handlers.ts` (CREATE)

**Quality Requirements**:

- Implement `getProviderStatus()` - returns status without API keys
- Implement `setApiKey(provider, apiKey)` - stores in SecretStorage
- Implement `removeApiKey(provider)` - deletes from SecretStorage
- Implement `getDefaultProvider()` - returns configured default
- Implement `validateApiKeyFormat(provider, apiKey)` - validates without storing
- API keys NEVER exposed to webview

---

### Task 5.2: Add TOKENS.LLM_RPC_HANDLERS ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
**Dependencies**: Task 5.1

**Implementation**:

```typescript
LLM_RPC_HANDLERS: Symbol.for('LlmRpcHandlers'),
```

---

### Task 5.3: Register LlmRpcHandlers in DI ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\register.ts`
**Dependencies**: Task 5.2

**Implementation**:

```typescript
container.registerSingleton(TOKENS.LLM_RPC_HANDLERS, LlmRpcHandlers);
```

---

### Task 5.4: Wire RPC Methods ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`
**Dependencies**: Task 5.3

**Quality Requirements**:

- Register `llm.getProviderStatus`
- Register `llm.setApiKey`
- Register `llm.removeApiKey`
- Register `llm.getDefaultProvider`
- Register `llm.validateApiKeyFormat`

---

**Batch 5 Verification**:

- [ ] LlmRpcHandlers class created
- [ ] Token added
- [ ] Registered in DI
- [ ] RPC methods wired
- [ ] API keys never exposed
- [ ] Build passes: `npx nx build vscode-core`
- [ ] Build passes: `npx nx build ptah-extension-vscode`

---

## Batch 6: Integration Testing & Verification ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 5 complete
**Priority**: VERIFICATION

### Task 6.1: Build All Affected Projects ⏸️ PENDING

**Commands**:

```bash
npx nx build llm-abstraction
npx nx build vscode-core
npx nx build ptah-extension-vscode
npm run build:all
```

---

### Task 6.2: Run Quality Checks ⏸️ PENDING

**Commands**:

```bash
npm run typecheck:all
npm run lint:all
```

---

### Task 6.3: Manual Testing Checklist ⏸️ PENDING

**Provider Switching**:

- [ ] Switch provider multiple times rapidly (no race condition)
- [ ] Switch to invalid provider (graceful error)
- [ ] Provider preserved on error

**RPC Handlers**:

- [ ] `llm.getProviderStatus` returns all providers
- [ ] `llm.setApiKey` saves key correctly
- [ ] `llm.removeApiKey` removes key correctly
- [ ] `llm.validateApiKeyFormat` validates correctly

**MCP Namespace**:

- [ ] `ptah.llm.vscodeLm.chat()` works
- [ ] `ptah.llm.getConfiguredProviders()` returns correct data
- [ ] `ptah.llm.getDefaultProvider()` returns correct provider

---

**Batch 6 Verification**:

- [ ] All builds pass
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Manual testing complete
- [ ] All review issues addressed

---

## Updated Definition of Done

**MUST COMPLETE**:

- [ ] Batch 1: Type Centralization (CRITICAL)
- [ ] Batch 2: Race Condition Fix (CRITICAL)
- [ ] Batch 3: Error Handling (SERIOUS)
- [ ] Batch 4: Code Consistency (SERIOUS)
- [ ] Batch 5: Phase 5 RPC Handlers (NEW FEATURE)
- [ ] Batch 6: Verification

**SHOULD COMPLETE**:

- [ ] All minor issues addressed
- [ ] Documentation updated

**NICE TO HAVE**:

- [ ] Unit tests for new code
- [ ] Integration tests for RPC handlers

---

## Code Review Issue Mapping

| Issue                                         | Batch | Task     |
| --------------------------------------------- | ----- | -------- |
| Type coupling (LlmProviderName in wrong file) | 1     | 1.1, 1.2 |
| Dynamic import path fragility                 | 1     | 1.3, 1.4 |
| Race condition (no async lock)                | 2     | 2.2      |
| Nullable currentProvider                      | 2     | 2.3      |
| No error recovery                             | 2     | 2.4      |
| No timeout for provider creation              | 3     | 3.1      |
| Error code inconsistency                      | 3     | 3.2      |
| No SecretStorage error handling               | 3     | 3.3      |
| Inconsistent error handling                   | 3     | 3.4      |
| Logging inconsistency                         | 4     | 4.1      |
| Magic string proliferation                    | 4     | 4.2      |
| Missing JSDoc                                 | 4     | 4.3      |
| Phase 5: RPC handlers (deferred)              | 5     | 5.1-5.4  |
