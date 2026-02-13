# Development Tasks - TASK_2025_151

**Total Tasks**: 5 | **Batches**: 2 | **Status**: 2/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `QueryOptionsInput.enhancedPromptsContent?: string` exists at `sdk-query-options-builder.ts:157` -- VERIFIED
- `buildSystemPrompt()` already handles `enhancedPromptsContent` (appends or falls back to PTAH_CORE) -- VERIFIED
- `ExecuteQueryConfig` is missing `enhancedPromptsContent` (the gap) -- VERIFIED at `session-lifecycle-manager.ts:80-106`
- `EnhancedPromptsService.getEnhancedPromptContent(workspacePath)` returns `string | null` -- VERIFIED at line 490
- Lazy container resolution pattern (`DependencyContainer` auto-injected by tsyringe) -- VERIFIED at `enhanced-prompts-rpc.handlers.ts:88`
- `SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE` exists -- VERIFIED at `tokens.ts:79`
- Frontend `RpcCallOptions` supports `timeout?: number` -- VERIFIED at `claude-rpc.service.ts:25`
- `EnhancedPromptsGetStatusResponse` has all required fields -- VERIFIED at `rpc.types.ts:830`
- `EnhancedPromptsDetectedStack` has `languages`, `frameworks`, `projectType` -- VERIFIED at `rpc.types.ts:801`
- Settings HTML insertion point: between Pro Features divider (line 417) and MCP Port card (line 419) -- VERIFIED

### Risks Identified

| Risk            | Severity | Mitigation                                   |
| --------------- | -------- | -------------------------------------------- |
| None identified | N/A      | All integration points verified against code |

### Edge Cases to Handle

- [x] `enhancedPromptsContent` undefined -> existing fallback in `buildSystemPrompt()` handles it (uses PTAH_CORE or nothing)
- [x] `EnhancedPromptsService` resolution failure -> graceful fallback to `undefined` (Task 1.3)
- [x] Non-premium user -> skip resolution entirely (Task 1.3)
- [x] No generated prompt yet -> toggle disabled, instruction message shown (Task 2.2)
- [x] Stale cache -> warning displayed in UI (Task 2.2)

---

## Batch 1: Backend - Wire Enhanced Prompts into Chat Sessions COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: 0f13c35

### Task 1.1: Add `enhancedPromptsContent` to `ExecuteQueryConfig` and pass through `executeQuery()` COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
**Spec Reference**: implementation-plan.md: Component 1.1 (lines 122-178)
**Pattern to Follow**: `session-lifecycle-manager.ts:94-105` (existing `isPremium` and `mcpServerRunning` fields)

**Quality Requirements**:

- Add `enhancedPromptsContent?: string` to `ExecuteQueryConfig` interface (after `mcpServerRunning` at line 105)
- Add JSDoc comment explaining the field's purpose and that it is resolved by the caller
- Destructure `enhancedPromptsContent` in `executeQuery()` method alongside existing fields (line 432-440)
- Pass `enhancedPromptsContent` to `this.queryOptionsBuilder.build()` call (line 488-497)
- Field is optional -- when undefined, existing `buildSystemPrompt()` logic falls back correctly
- No behavior change for existing callers that omit the field

**Implementation Details**:

- No new imports needed
- Add field to `ExecuteQueryConfig` interface after line 105
- Add to destructuring at line 432-440: `enhancedPromptsContent,`
- Add to `queryOptionsBuilder.build()` call at line 488-497: `enhancedPromptsContent,`

---

### Task 1.2: Pass `enhancedPromptsContent` through `SdkAgentAdapter` COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Spec Reference**: implementation-plan.md: Component 1.2 (lines 182-232)
**Pattern to Follow**: `sdk-agent-adapter.ts:337-349` (existing `isPremium` and `mcpServerRunning` in `startChatSession` config type)
**Dependencies**: Task 1.1 (ExecuteQueryConfig must have the field first)

**Quality Requirements**:

- Add `enhancedPromptsContent?: string` to `startChatSession()` config type (after `mcpServerRunning` at line 348)
- Add JSDoc comment for the new field
- Destructure `enhancedPromptsContent` alongside `isPremium` and `mcpServerRunning` (line 357)
- Pass to `this.sessionLifecycle.executeQuery()` call (line 368-379)
- Add same field to `resumeSession()` config type (after `mcpServerRunning` at line 435)
- Destructure and pass in `resumeSession()` `executeQuery()` call (line 470-479)
- Purely pass-through -- `SdkAgentAdapter` does NOT interpret the content
- Compatible with existing callers that omit the field

**Implementation Details**:

- No new imports needed
- `startChatSession()`: Add field to inline config type, destructure at line 357, pass at line 368-379
- `resumeSession()`: Add field to inline config type, extract at line 459-460 area, pass at line 470-479

---

### Task 1.3: Resolve Enhanced Prompt Content in Chat RPC Handlers COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md: Component 1.3 (lines 235-331)
**Pattern to Follow**: `enhanced-prompts-rpc.handlers.ts:88` (lazy container resolution), `chat-rpc.handlers.ts:128-131` (premium gating)
**Dependencies**: Task 1.2 (SdkAgentAdapter must accept the field first)

**Quality Requirements**:

- Add `DependencyContainer` import from `tsyringe`
- Add `EnhancedPromptsService` type import and `SDK_TOKENS` import from `@ptah-extension/agent-sdk` (note: `SDK_TOKENS` is already imported on line 24)
- Add `private readonly container: DependencyContainer` to constructor (tsyringe auto-injects this)
- Add private `resolveEnhancedPromptsContent(workspacePath, isPremium)` helper method
- Helper must: skip for non-premium users, use lazy container resolution, call `getEnhancedPromptContent(workspacePath)`, return `undefined` on any error, log at debug level
- In `registerChatStart()`: call resolver after license check (line 130), pass result to `startChatSession()`
- In `registerChatContinue()`: call resolver in the resume path (line 219-221 area), pass result to `resumeSession()`
- Enhanced prompt resolution MUST NOT block or fail the chat start/continue flow
- On any error, return `undefined` (graceful fallback to PTAH_CORE_SYSTEM_PROMPT)

**Implementation Details**:

- Imports to add: `DependencyContainer` from `tsyringe`, `type { EnhancedPromptsService }` from `@ptah-extension/agent-sdk`
- Note: `SDK_TOKENS` is already imported on line 24 -- do NOT duplicate
- Constructor: add `private readonly container: DependencyContainer` parameter (tsyringe auto-injects the container)
- New private method: `resolveEnhancedPromptsContent(workspacePath: string | undefined, isPremium: boolean): Promise<string | undefined>`
- In `registerChatStart()` after line 130: resolve content, then pass `enhancedPromptsContent` to `startChatSession()` config
- In `registerChatContinue()` resume block around line 239: resolve content, then pass `enhancedPromptsContent` to `resumeSession()` config

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build agent-sdk` and `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved
- No stubs, placeholders, or TODO comments
- Backward compatible -- existing callers that omit `enhancedPromptsContent` continue to work

---

## Batch 2: Frontend - Settings UI "System Prompt Mode" Section COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (backend must be wired first, though frontend can work in parallel since RPC handlers already exist)
**Commit**: 222cd0a

### Task 2.1: Add Enhanced Prompts State and Methods to SettingsComponent COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts`
**Spec Reference**: implementation-plan.md: Component 2.1 (lines 337-513)
**Pattern to Follow**: `settings.component.ts:89-145` (existing license status computed signals)

**Quality Requirements**:

- Add `signal` import to `@angular/core` imports (line 1-7)
- Add `EnhancedPromptsGetStatusResponse` type import from `@ptah-extension/shared`
- Add new Lucide icon imports: no new icons needed beyond what exists -- `Sparkles`, `Clock`, `AlertTriangle`, `ExternalLink`, `ArrowLeft` are already imported
- Add state signals: `enhancedPromptsStatus`, `enhancedPromptsLoading`, `enhancedPromptsError`, `isRegenerating`, `promptPreviewContent`, `promptPreviewExpanded`, `isDownloading`
- Add computed signals: `enhancedPromptsEnabled`, `hasGeneratedPrompt`, `enhancedPromptsGeneratedAt`, `enhancedPromptsCacheValid`, `detectedStackSummary`, `showEnhancedPromptsSection`
- Add lifecycle: in `ngOnInit()`, after `loadAuthStatus()`, if `this.isPremium()` is true, call `loadEnhancedPromptsStatus()`
- Add methods: `loadEnhancedPromptsStatus()`, `toggleEnhancedPrompts(enabled)`, `regenerateEnhancedPrompt()`, `togglePromptPreview()`, `downloadEnhancedPrompt()`
- All methods use `this.rpcService.call()` with proper RPC method names from `RpcMethodRegistry`
- Regenerate uses `{ timeout: 120000 }` option (2 minute timeout for generation)
- All errors stored via `enhancedPromptsError` signal
- All loading states tracked via separate boolean signals

**Implementation Details**:

- Add `signal` to Angular core import (line 1-7)
- Type import: `import type { EnhancedPromptsGetStatusResponse } from '@ptah-extension/shared';`
- State signals block after line 82 (after Lucide icons)
- Computed signals block after existing license computed signals (after line 145)
- Lifecycle change in `ngOnInit()` at line 307-310
- Methods block after `openPricing()` method (after line 344)

---

### Task 2.2: Add Enhanced Prompts UI Section to Settings Template COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html`
**Spec Reference**: implementation-plan.md: Component 2.2 (lines 516-663)
**Pattern to Follow**: `settings.component.html:419-457` (existing MCP Port and LLM Keys premium cards)
**Dependencies**: Task 2.1 (component signals and methods must exist first)

**Quality Requirements**:

- Insert new "System Prompt Mode" card AFTER the Pro Features divider (line 417) and BEFORE the MCP Port card (line 419)
- Card uses `border border-primary/30 rounded-md bg-primary/5` styling (matching MCP Port card)
- Toggle switch: DaisyUI `toggle toggle-primary toggle-xs`, disabled when no generated prompt
- Mode badge: "Ptah Enhanced" (active, `badge-primary`) or "Default Claude Code" (inactive, `badge-ghost`)
- Error display via `enhancedPromptsError()` signal
- When prompt exists: show generated timestamp, detected stack summary, cache validity warning, action buttons (Regenerate, Download), expandable preview
- When no prompt exists: show instruction to run Setup Wizard
- Regenerate button shows loading spinner during generation
- Preview section is collapsible with `togglePromptPreview()`, content in scrollable pre block
- All Lucide icons already available in component: `SparklesIcon`, `ClockIcon`, `AlertTriangleIcon`, `ExternalLinkIcon`, `ArrowLeftIcon`
- Use existing icon references from component (e.g., `SparklesIcon` not `Wand2`)

**Implementation Details**:

- Insert between line 417 (end of Pro Features divider) and line 419 (start of MCP Port card)
- All within existing `@if (showPremiumSections())` block
- Follow exact DaisyUI class patterns from adjacent cards
- `$any($event.target).checked` pattern for checkbox change event (Angular strict template type checking)

---

**Batch 2 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- code-logic-reviewer approved
- No stubs, placeholders, or TODO comments
- UI renders correctly within premium sections
- Toggle, regenerate, preview, and download buttons are wired to component methods
