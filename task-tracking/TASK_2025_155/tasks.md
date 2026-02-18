# Development Tasks - TASK_2025_155

**Total Tasks**: 24 | **Batches**: 6 | **Status**: 0/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `@langchain/core` BaseLanguageModelInput type used in ILlmProvider interface and BaseLlmProvider: RISK - must be replaced
- LlmService imports `BaseLanguageModelInput` from `@langchain/core`: RISK - must be updated
- Provider import map uses secondary entry points that will be deleted: Verified - must update
- VsCodeLmProvider exists independently (no Langchain deps): Verified in vscode-lm.provider.ts
- Settings component exists and can host new LLM providers section: Verified in settings.component.ts

### Risks Identified

| Risk | Severity | Mitigation |
|------|----------|------------|
| `BaseLanguageModelInput` from `@langchain/core` used in ILlmProvider, BaseLlmProvider, LlmService | HIGH | Task 1.2 must replace with native prompt type before providers compile |
| `getStructuredCompletion` uses Langchain `withStructuredOutput` pattern | HIGH | Provider rewrites (Batch 2) must implement native JSON mode |
| Import map references deleted secondary entry points (anthropic, openrouter) | MED | Task 1.3 handles cleanup |
| LLM namespace builder references 'anthropic' and 'openrouter' provider namespaces | MED | Task 4.3 handles cleanup |
| `async-mutex` import in LlmService unrelated to Langchain but verify compatibility | LOW | No change needed |

### Edge Cases to Handle

- [x] What if no API key providers remain after removing anthropic/openrouter -> vscode-lm always available
- [x] What if getStructuredCompletion callers pass Langchain-specific prompt types -> must update callers
- [x] Google provider constructor signature change -> factory function must be updated
- [x] OpenAI provider removes Langchain token counting -> fallback to approximation

---

## Batch 1: Remove Langchain Dependencies and Clean Provider Types [IN PROGRESS]

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Remove Langchain npm packages and add native SDKs [IMPLEMENTED]

**File**: D:\projects\ptah-extension\package.json
**Spec Reference**: implementation-plan.md Phase 1

**Quality Requirements**:
- Remove all 5 Langchain packages: `@langchain/anthropic`, `@langchain/google-genai`, `@langchain/openai`, `@langchain/core`, `langchain`
- Also remove `@google/generative-ai` if present (old Google SDK)
- Add `@google/genai` version `^1.41.0`
- Add `openai` version `^4.100.0`
- Run `npm install` after changes

**Implementation Details**:
- Edit package.json dependencies section
- Remove the 5+1 packages listed above
- Add the 2 new packages
- Run npm install to update lock file

---

### Task 1.2: Update ILlmProvider interface and BaseLlmProvider to remove Langchain types [IMPLEMENTED]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\interfaces\llm-provider.interface.ts
**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\providers\base-llm.provider.ts
**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm.service.ts
**Dependencies**: Task 1.1

**Quality Requirements**:
- Replace `BaseLanguageModelInput` import from `@langchain/core` with a native type
- Define a new type `LlmPromptInput = string | Array<{ role: string; content: string }>` in the interface file
- Update `getStructuredCompletion` signature in ILlmProvider, BaseLlmProvider, ILlmService, and LlmService
- Remove `@langchain/core` import from base-llm.provider.ts
- Remove `@langchain/core` import from llm.service.ts
- All files must compile without Langchain imports

**Validation Notes**:
- This is a HIGH severity risk item - breaks compilation if not done correctly
- Must update ALL files that import BaseLanguageModelInput

**Implementation Details**:
- In `llm-provider.interface.ts`: Remove `import type { BaseLanguageModelInput }` from `@langchain/core/language_models/base`, add `export type LlmPromptInput = string | Array<{ role: string; content: string }>`, replace all `BaseLanguageModelInput` usages with `LlmPromptInput`
- In `base-llm.provider.ts`: Remove the `@langchain/core` import, import `LlmPromptInput` from the interface file instead
- In `llm.service.ts`: Remove the `@langchain/core` import, import `LlmPromptInput` from the interface file, update `getStructuredCompletion` parameter type

---

### Task 1.3: Update provider-types.ts and provider-import-map.ts - remove anthropic/openrouter [IMPLEMENTED]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\types\provider-types.ts
**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\registry\provider-import-map.ts
**Dependencies**: Task 1.2

**Quality Requirements**:
- Remove `'anthropic'` and `'openrouter'` from `LlmProviderName` type union
- Remove them from `SUPPORTED_PROVIDERS` array
- Remove them from `PROVIDER_DISPLAY_NAMES` record
- Remove them from `DEFAULT_MODELS` record
- Update `DEFAULT_MODELS['google-genai']` from `'gemini-1.5-pro'` to `'gemini-2.5-flash'`
- In provider-import-map.ts: Remove `anthropic` and `openrouter` entries from `PROVIDER_IMPORT_MAP`
- Remove `createAnthropicProvider` and `createOpenRouterProvider` from `ProviderModule` interface
- Update the `Record<LlmProviderName, ...>` type to match new 3-provider type

**Implementation Details**:
- `LlmProviderName` becomes: `'openai' | 'google-genai' | 'vscode-lm'`
- `SUPPORTED_PROVIDERS` becomes: `['openai', 'google-genai', 'vscode-lm']`
- `PROVIDER_DISPLAY_NAMES` keeps only the 3 remaining
- `DEFAULT_MODELS` becomes: `{ openai: 'gpt-4o', 'google-genai': 'gemini-2.5-flash', 'vscode-lm': 'copilot/gpt-4o' }`
- Import map keeps only `openai`, `google-genai`, `vscode-lm` entries

---

### Task 1.4: Delete removed provider files and secondary entry points [IMPLEMENTED]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\providers\anthropic.provider.ts (DELETE)
**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\providers\openrouter.provider.ts (DELETE)
**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\anthropic.ts (DELETE)
**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\openrouter.ts (DELETE)
**Dependencies**: Task 1.3

**Quality Requirements**:
- Delete all 4 files listed above
- Update `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\index.ts` - remove any references to anthropic/openrouter in comments
- Update `D:\projects\ptah-extension\tsconfig.base.json` - remove `@ptah-extension/llm-abstraction/anthropic` and `@ptah-extension/llm-abstraction/openrouter` path aliases

**Implementation Details**:
- Use git rm or file delete for the 4 files
- Clean up index.ts comments that reference anthropic/openrouter secondary entry points
- Remove 2 path alias entries from tsconfig.base.json

---

### Task 1.5: Update llm-secrets.service.ts and llm-rpc-handlers.ts - remove anthropic/openrouter [IMPLEMENTED]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm-secrets.service.ts
**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\llm-rpc-handlers.ts
**Dependencies**: Task 1.3

**Quality Requirements**:
- In llm-secrets.service.ts: Update `API_KEY_PROVIDERS` to only contain `['openai', 'google-genai']`
- In llm-secrets.service.ts: Remove `'anthropic'` and `'openrouter'` cases from `validateKeyFormat()` switch statement
- In llm-rpc-handlers.ts: Update local `LlmProviderName` type to `'openai' | 'google-genai' | 'vscode-lm'`
- In llm-rpc-handlers.ts: Remove `'anthropic'` and `'openrouter'` cases from `validateApiKeyFormat()` switch statement

**Implementation Details**:
- `API_KEY_PROVIDERS` becomes `['openai', 'google-genai'] as const`
- Remove anthropic/openrouter validation logic from both files
- Keep all other validation logic (openai sk-, google-genai length check)

---

**Batch 1 Verification**:
- All files exist at paths
- No Langchain imports remain in llm-abstraction library (except vscode-lm.provider.ts which never had any)
- Build passes: `npx nx build llm-abstraction` (may have errors from google/openai providers not yet rewritten - expected)
- code-logic-reviewer approved

---

## Batch 2: Rewrite Google and OpenAI Providers with Native SDKs [PENDING]

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Rewrite google-genai.provider.ts with @google/genai SDK [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\providers\google-genai.provider.ts
**Spec Reference**: implementation-plan.md Phase 2
**Pattern to Follow**: Current provider structure (extends BaseLlmProvider, Result pattern)

**Quality Requirements**:
- Replace ALL Langchain imports with `@google/genai` SDK
- Import `GoogleGenAI` from `@google/genai`
- Implement `getCompletion()` using `this.ai.models.generateContent()`
- Implement `getStructuredCompletion()` using JSON mode (`responseMimeType: 'application/json'`)
- Add `generateImage()` method for image generation (used later by MCP tool)
- Support both Gemini native image gen and Imagen API
- Keep retry logic with exponential backoff
- Keep Result<T, LlmProviderError> return types

**Implementation Details**:
- Constructor: `this.ai = new GoogleGenAI({ apiKey })`
- getCompletion: Use `this.ai.models.generateContent({ model, contents, config: { systemInstruction } })`
- getStructuredCompletion: Use `responseMimeType: 'application/json'` + `responseSchema` config
- generateImage (Gemini): Use `generateContent` with `config: { responseModalities: ['TEXT', 'IMAGE'] }`
- generateImage (Imagen): Use `this.ai.models.generateImages({ model, prompt, config })`
- Export image generation types: `ImageGenOptions`, `ImageGenResult`
- Default context size: 1048576 (Gemini 2.5 flash)

---

### Task 2.2: Rewrite openai.provider.ts with native openai SDK [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\providers\openai.provider.ts
**Spec Reference**: implementation-plan.md Phase 3
**Pattern to Follow**: Current provider structure (extends BaseLlmProvider, Result pattern)

**Quality Requirements**:
- Replace ALL Langchain imports with native `openai` SDK
- Import `OpenAI` from `openai`
- Implement `getCompletion()` using `this.client.chat.completions.create()`
- Implement `getStructuredCompletion()` using `response_format: { type: 'json_schema' }`
- Keep context window size logic for known models
- Keep retry logic with exponential backoff
- Token counting: Use approximation (Langchain's getNumTokens is gone)
- Keep Result<T, LlmProviderError> return types

**Implementation Details**:
- Constructor: `this.client = new OpenAI({ apiKey })`
- getCompletion: `this.client.chat.completions.create({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] })`
- getStructuredCompletion: `response_format: { type: 'json_schema', json_schema: { name: 'result', schema } }`
- countTokens: Use `Math.ceil(text.length / 4)` approximation
- Add gpt-4o context window (128000) to model size map
- Keep `_getDefaultContextSizeForModel()` with updated model names

---

### Task 2.3: Update google and openai secondary entry points (factory functions) [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\google.ts
**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\openai.ts
**Dependencies**: Task 2.1, Task 2.2

**Quality Requirements**:
- Update factory functions to work with new native SDK providers
- Factory signature: `(apiKey: string, model: string) => Result<ILlmProvider, LlmProviderError>`
- Remove any Langchain references from these entry point files

**Implementation Details**:
- google.ts: Export `createGoogleProvider` factory that creates `GoogleGenAIProvider`
- openai.ts: Export `createOpenAIProvider` factory that creates `OpenAIProvider`
- Both should wrap construction in try/catch and return Result

---

### Task 2.4: Update provider-import-map.ts factory types for new providers [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\registry\provider-import-map.ts
**Dependencies**: Task 2.3

**Quality Requirements**:
- Update `ProviderModule` interface - only keep `createOpenAIProvider`, `createGoogleProvider`, `createVsCodeLmProvider`
- Verify import paths still work with secondary entry points
- Remove all Langchain-related comments

**Implementation Details**:
- ProviderModule: `{ createOpenAIProvider?: LlmProviderFactory; createGoogleProvider?: LlmProviderFactory; createVsCodeLmProvider?: LlmProviderFactory; }`
- Update comments on each entry to say "Native SDK" instead of "Langchain"

---

**Batch 2 Verification**:
- All files exist at paths
- Build passes: `npx nx build llm-abstraction`
- No Langchain imports remain anywhere in llm-abstraction library
- code-logic-reviewer approved
- Both providers have REAL implementations (no stubs)

---

## Batch 3: Fix Wizard Hardcoded Model [PENDING]

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (needs updated LlmProviderName type)

### Task 3.1: Fix VsCodeLmService hardcoded gpt-4o model [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\vscode-lm.service.ts
**Spec Reference**: implementation-plan.md Phase 4

**Quality Requirements**:
- Remove hardcoded `{ family: 'gpt-4o' }` on line 95
- Inject `LlmConfigurationService` to read the user's configured default model
- Use the DI token `TOKENS.LLM_CONFIGURATION_SERVICE`
- Extract family from model string: `defaultModel.split('/')[1] || defaultModel`
- Fall back to 'gpt-4o' if config returns empty

**Validation Notes**:
- The model format for vscode-lm is 'vendor/family' (e.g., 'copilot/gpt-4o')
- VsCodeLmProvider expects `{ family: string }` in constructor
- Must handle edge case where model has no '/' separator

**Implementation Details**:
- Add constructor parameter: `@inject(TOKENS.LLM_CONFIGURATION_SERVICE) private readonly configService: LlmConfigurationService`
- Import `LlmConfigurationService` from `@ptah-extension/llm-abstraction`
- Import `TOKENS` from `@ptah-extension/vscode-core`
- In `initialize()`: `const defaultModel = this.configService.getDefaultModel('vscode-lm')`
- Parse family: `const family = defaultModel.includes('/') ? defaultModel.split('/')[1] : defaultModel`
- Fallback: `const family = parsedFamily || 'gpt-4o'`

---

### Task 3.2: Verify DI wiring in container.ts [PENDING]

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts
**Dependencies**: Task 3.1

**Quality Requirements**:
- Verify `TOKENS.LLM_CONFIGURATION_SERVICE` is registered in DI container
- If not registered, add registration
- Verify VsCodeLmService can resolve the new dependency

**Implementation Details**:
- Read container.ts to check if LlmConfigurationService is already registered
- If missing: `container.register(TOKENS.LLM_CONFIGURATION_SERVICE, { useClass: LlmConfigurationService })`
- The service is likely already registered from TASK_2025_073 - just verify

---

**Batch 3 Verification**:
- All files exist at paths
- VsCodeLmService no longer has hardcoded 'gpt-4o'
- Build passes: `npx nx build agent-generation`
- code-logic-reviewer approved

---

## Batch 4: Types, RPC, and Backend Wiring [PENDING]

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 2

### Task 4.1: Add new RPC types to shared library [PENDING]

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts
**Spec Reference**: implementation-plan.md Phase 6 RPC section

**Quality Requirements**:
- Add `LlmProviderStatusResponse` type with provider status array
- Add `SetDefaultProviderRequest` and `SetDefaultProviderResponse` types
- Add `LlmProviderCapability` type: `'text-chat' | 'image-generation' | 'structured-output'`
- All types should be exported

**Implementation Details**:
```typescript
export interface LlmProviderStatusResponse {
  providers: Array<{
    provider: string;
    displayName: string;
    isConfigured: boolean;
    defaultModel: string;
    capabilities: LlmProviderCapability[];
  }>;
  defaultProvider: string;
}

export type LlmProviderCapability = 'text-chat' | 'image-generation' | 'structured-output';

export interface SetDefaultProviderRequest {
  provider: string;
}

export interface SetDefaultProviderResponse {
  success: boolean;
  error?: string;
}
```

---

### Task 4.2: Add setDefaultProvider RPC handler [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\llm-rpc-handlers.ts
**Dependencies**: Task 4.1

**Quality Requirements**:
- Add `setDefaultProvider()` method to LlmRpcHandlers class
- Method should update VS Code settings `ptah.llm.defaultProvider`
- Add `getProviderCapabilities()` method that returns capabilities per provider
- Google: ['text-chat', 'image-generation', 'structured-output']
- OpenAI: ['text-chat', 'structured-output']
- VS Code LM: ['text-chat']

**Implementation Details**:
- `setDefaultProvider(provider: LlmProviderName)`: Use ConfigManager to write `ptah.llm.defaultProvider` setting
- Inject ConfigManager if not already injected
- `getProviderCapabilities(provider)`: Return static capability arrays based on provider name
- Update `getProviderStatus()` to include capabilities in response

---

### Task 4.3: Update LLM namespace builder - remove anthropic/openrouter [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\llm-namespace.builder.ts
**Dependencies**: Batch 1

**Quality Requirements**:
- Remove `anthropic` and `openrouter` provider namespace entries from `buildLLMNamespace()`
- Keep only `openai`, `google`, `vscodeLm` namespaces
- Update comments to remove Langchain references
- Update the LLMNamespace type if defined locally

**Implementation Details**:
- In `buildLLMNamespace()`: Remove `anthropic: buildProviderNamespace(deps, 'anthropic')` line
- Remove `openrouter: buildProviderNamespace(deps, 'openrouter')` line
- Keep `openai`, `google`, `vscodeLm` entries
- Update the top-of-file comment block

---

### Task 4.4: Update LLM namespace types [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts
**Dependencies**: Task 4.3

**Quality Requirements**:
- Update `LLMNamespace` interface to remove `anthropic` and `openrouter` properties
- Keep `openai`, `google`, `vscodeLm`, `chat`, `getConfiguredProviders`, `getDefaultProvider`, `getConfiguration`

**Implementation Details**:
- Read types.ts to find LLMNamespace interface
- Remove `anthropic: LLMProviderNamespace` and `openrouter: LLMProviderNamespace` properties

---

### Task 4.5: Update LlmConfigurationService for new provider set [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm-configuration.service.ts
**Dependencies**: Task 1.3

**Quality Requirements**:
- Verify `getProviderSettingsKey()` mapping is correct for remaining 3 providers
- Verify `getAvailableProviders()` works with reduced provider set
- No code changes needed if it already works with the new `LlmProviderName` type
- Update any comments referencing anthropic/openrouter

**Implementation Details**:
- Likely just comment cleanup since the service reads from the type system
- The switch statement in `getProviderSettingsKey` should still work (unmatched cases fall to default)

---

**Batch 4 Verification**:
- All files exist at paths
- Build passes: `npx nx build vscode-core` and `npx nx build vscode-lm-tools`
- No references to 'anthropic' or 'openrouter' remain in LLM namespace
- code-logic-reviewer approved

---

## Batch 5: Frontend Settings UI for LLM Provider Management [PENDING]

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 4

### Task 5.1: Create LlmProviderStateService [PENDING]

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\llm-provider-state.service.ts
**Spec Reference**: implementation-plan.md Phase 6

**Quality Requirements**:
- Angular injectable service with signal-based state
- `providers` signal containing provider status array
- `defaultProvider` signal
- `loadProviderStatus()` method that calls `llm:getProviderStatus` RPC
- `setApiKey(provider, key)` method that calls `llm:setApiKey` RPC
- `removeApiKey(provider)` method that calls `llm:removeApiKey` RPC
- `setDefaultProvider(provider)` method that calls `llm:setDefaultProvider` RPC
- Use `ClaudeRpcService` for RPC calls
- Export from `D:\projects\ptah-extension\libs\frontend\core\src\index.ts`

**Implementation Details**:
- Inject `ClaudeRpcService` from `@ptah-extension/core`
- Signal types match `LlmProviderStatusResponse` from shared types
- All methods handle errors gracefully (set error signal)
- Include `isLoading` signal for loading state

---

### Task 5.2: Create LlmProvidersConfigComponent [PENDING]

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\llm-providers-config.component.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\llm-providers-config.component.html
**Spec Reference**: implementation-plan.md Phase 6 UI Layout
**Dependencies**: Task 5.1

**Quality Requirements**:
- Standalone Angular component with OnPush change detection
- Display all 3 providers (Google Gemini, OpenAI, VS Code LM) as cards
- Each card shows: provider name, configuration status, default model, capabilities
- API key input for Google and OpenAI (masked, with Save/Remove buttons)
- VS Code LM card shows "No API key needed" with available models
- Default provider selector dropdown
- Use DaisyUI styling (card, input, btn, badge classes)
- Use Lucide icons for visual elements
- Call LlmProviderStateService for all operations
- Load provider status on init

**Implementation Details**:
- Inject `LlmProviderStateService`
- Template: iterate providers signal, render card per provider
- API key input: `type="password"` with toggle visibility
- Save button calls `setApiKey()`, Remove button calls `removeApiKey()`
- Default provider: `<select>` bound to `setDefaultProvider()`
- Status badges: "Configured" (green), "Not Configured" (gray)
- Capabilities as small badges: "Text Chat", "Image Generation", "Structured Output"

---

### Task 5.3: Integrate LlmProvidersConfigComponent into SettingsComponent [PENDING]

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html
**Dependencies**: Task 5.2

**Quality Requirements**:
- Import `LlmProvidersConfigComponent` in SettingsComponent imports array
- Add `<ptah-llm-providers-config>` to settings template
- Place it after the auth config section
- Conditionally show only when `showPremiumSections()` is true (or always show - depends on business logic)
- For now: show always when authenticated (API key management doesn't need premium)

**Implementation Details**:
- Add to imports: `LlmProvidersConfigComponent`
- In template: Add section with header "AI Providers" and the component
- Position: after authentication section, before enhanced prompts section

---

### Task 5.4: Export LlmProviderStateService from core library [PENDING]

**File**: D:\projects\ptah-extension\libs\frontend\core\src\index.ts
**Dependencies**: Task 5.1

**Quality Requirements**:
- Add export for `LlmProviderStateService` from the core library index
- Verify no circular dependency introduced

**Implementation Details**:
- Add: `export { LlmProviderStateService } from './lib/services/llm-provider-state.service';`

---

**Batch 5 Verification**:
- All files exist at paths
- Build passes: `npx nx build chat`
- Settings UI shows provider cards with API key management
- code-logic-reviewer approved

---

## Batch 6: Image Generation MCP Tool [PENDING]

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 2 (needs Google provider with image gen)

### Task 6.1: Create image-generation.service.ts [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\image-generation.service.ts
**Spec Reference**: implementation-plan.md Phase 7

**Quality Requirements**:
- Injectable service that uses GoogleGenAIProvider for image generation
- `generateImage(prompt, options?)` method
- Support both Gemini native (generateContent with IMAGE modality) and Imagen (generateImages)
- Model routing: `gemini-*` models -> generateContent, `imagen-*` models -> generateImages
- Save generated images to workspace `.ptah/generated-images/{timestamp}-{index}.png`
- Return file paths in result
- Check Google auth (API key from SecretStorage) before generating
- Return clear error if Google provider not configured
- Use `@google/genai` SDK directly (GoogleGenAI class)

**Implementation Details**:
- Inject: `TOKENS.LLM_SECRETS_SERVICE` for API key, `TOKENS.LOGGER` for logging
- Create `GoogleGenAI` instance with API key from secrets service
- For Gemini native: `ai.models.generateContent({ model, contents: prompt, config: { responseModalities: ['TEXT', 'IMAGE'] } })`
- For Imagen: `ai.models.generateImages({ model, prompt, config: { numberOfImages, aspectRatio } })`
- Save images: Write base64 to workspace path using fs
- Return: `{ images: Array<{ path: string; mimeType: string }>, model: string }`

---

### Task 6.2: Create image-namespace.builder.ts [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\image-namespace.builder.ts
**Spec Reference**: implementation-plan.md Phase 7 ptah.image namespace
**Dependencies**: Task 6.1

**Quality Requirements**:
- Build `ptah.image` namespace with 3 methods:
  - `generate(prompt, options?)` - Generate image(s)
  - `listModels()` - Return available image models
  - `isAvailable()` - Check if Google key configured
- Use ImageGenerationService internally
- Export `buildImageNamespace` function

**Implementation Details**:
- `generate`: Delegate to ImageGenerationService.generateImage()
- `listModels`: Return static list of supported image models
- `isAvailable`: Check if google-genai API key exists in SecretStorage
- Type: `ImageNamespace { generate, listModels, isAvailable }`

---

### Task 6.3: Register ptah_generate_image MCP tool [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts
**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts
**Dependencies**: Task 6.1

**Quality Requirements**:
- Add `ptah_generate_image` tool schema to tool-description.builder.ts
- Add handler routing in protocol-handlers.ts for the new tool
- Tool schema: prompt (required string), model (optional string, default 'gemini-2.5-flash-image'), aspectRatio (optional string, default '1:1'), numberOfImages (optional number, default 1)
- Handler: Parse arguments, call ImageGenerationService, return file paths

**Implementation Details**:
- In tool-description.builder.ts: Add new tool object to the tools array
- In protocol-handlers.ts: Add case for 'ptah_generate_image' tool name
- Parse and validate arguments from MCP tool call
- Return result with generated image file paths

---

### Task 6.4: Register ptah.image namespace in PtahAPIBuilder [PENDING]

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts
**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\index.ts
**Dependencies**: Task 6.2

**Quality Requirements**:
- Add `image` namespace to PtahAPI object
- Import and call `buildImageNamespace()` in PtahAPIBuilder
- Export from namespace-builders index.ts
- Update PtahAPI type in types.ts to include `image` property

**Implementation Details**:
- In ptah-api-builder.service.ts: Add `image: buildImageNamespace(deps)` to the API object
- In index.ts (namespace-builders): Export `buildImageNamespace`
- In types.ts: Add `image: ImageNamespace` to PtahAPI interface
- Pass required dependencies (secrets service) to builder

---

**Batch 6 Verification**:
- All files exist at paths
- Build passes: `npx nx build vscode-lm-tools`
- ptah_generate_image MCP tool is registered
- ptah.image namespace is available
- code-logic-reviewer approved

---

## Status Icons Reference

| Status | Meaning | Who Sets |
|--------|---------|----------|
| PENDING | Not started | team-leader (initial) |
| IN PROGRESS | Assigned to developer | team-leader |
| IMPLEMENTED | Developer done, awaiting verify | developer |
| COMPLETE | Verified and committed | team-leader |
| FAILED | Verification failed | team-leader |
