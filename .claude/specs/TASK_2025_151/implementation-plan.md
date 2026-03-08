# Implementation Plan - TASK_2025_151

## Wire Enhanced Prompts into Chat Sessions & Settings UI Toggle

---

## 1. Codebase Investigation Summary

### Libraries Discovered

- **agent-sdk** (`libs/backend/agent-sdk/`) - SDK adapter, session lifecycle, query options builder

  - Key exports: `SdkAgentAdapter`, `SessionLifecycleManager`, `SdkQueryOptionsBuilder`, `EnhancedPromptsService`
  - Documentation: `libs/backend/agent-sdk/CLAUDE.md`
  - DI Tokens: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (SDK_TOKENS)

- **shared** (`libs/shared/`) - RPC types, branded types

  - Key exports: RPC type definitions, `RpcMethodRegistry`, `EnhancedPromptsGetStatusResponse`
  - Enhanced Prompts RPC types already defined (lines 793-905 in `rpc.types.ts`)

- **frontend/chat** (`libs/frontend/chat/`) - Settings UI, ChatStore

  - Key files: `settings.component.ts`, `settings.component.html`
  - Pattern: Signal-based state, DaisyUI styling, `ClaudeRpcService.call()` for RPC

- **frontend/core** (`libs/frontend/core/`) - ClaudeRpcService, AppStateManager
  - Key pattern: `rpcService.call('method:name', params)` returns `RpcResult<T>`

### Patterns Identified

**Pattern 1: Lazy Container Resolution (for circular DI)**

- **Evidence**: `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:354`
- **Usage**: `container.resolve<EnhancedPromptsService>(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE)`
- **Rationale**: Breaks circular dependency EnhancedPromptsService <-> InternalQueryService

**Pattern 2: Premium Feature Gating in Chat Path**

- **Evidence**: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts:128-131`
- **Flow**: `licenseService.verifyLicense()` -> `isPremiumTier()` -> pass to `startChatSession({isPremium, mcpServerRunning})`
- **Propagation**: `SdkAgentAdapter.startChatSession()` -> `SessionLifecycleManager.executeQuery()` -> `SdkQueryOptionsBuilder.build()`

**Pattern 3: QueryOptionsInput Already Has enhancedPromptsContent**

- **Evidence**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:157`
- **Field**: `enhancedPromptsContent?: string` already exists in `QueryOptionsInput`
- **Handler**: `buildSystemPrompt()` at line 397 already handles it (appends to system prompt or falls back to PTAH_CORE)

**Pattern 4: ExecuteQueryConfig Missing enhancedPromptsContent**

- **Evidence**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:80-106`
- **Gap**: `ExecuteQueryConfig` has `isPremium` and `mcpServerRunning` but NOT `enhancedPromptsContent`
- **Impact**: `executeQuery()` at line 488-497 passes `isPremium` and `mcpServerRunning` to `queryOptionsBuilder.build()` but NOT `enhancedPromptsContent`

**Pattern 5: Frontend RPC Calling**

- **Evidence**: `libs/frontend/core/src/lib/services/claude-rpc.service.ts:168-231`
- **Pattern**: `rpcService.call('enhancedPrompts:getStatus', { workspacePath: '.' })` returns `RpcResult<EnhancedPromptsGetStatusResponse>`
- **Type safety**: Compile-time enforced via `RpcMethodRegistry`

**Pattern 6: Settings UI Card Structure**

- **Evidence**: `libs/frontend/chat/src/lib/settings/settings.component.html:411-484`
- **Pattern**: Premium sections use `border-primary/30 rounded-md bg-primary/5` cards within `@if (showPremiumSections())` block
- **Icons**: Lucide Angular icons, `text-xs` typography, DaisyUI badges

### Integration Points

**Backend - Chat Path Data Flow**:

```
ChatRpcHandlers.registerChatStart()
  -> licenseService.verifyLicense() [already done]
  -> sdkAdapter.startChatSession({isPremium, mcpServerRunning})
     -> sessionLifecycle.executeQuery({isPremium, mcpServerRunning})
        -> queryOptionsBuilder.build({isPremium, mcpServerRunning})
           -> buildSystemPrompt(sessionConfig, isPremium, enhancedPromptsContent)
```

The GAP is between `ChatRpcHandlers` and `SdkAgentAdapter` -- the `enhancedPromptsContent` string never gets resolved and passed through.

**Frontend - RPC Types Available**:

- `enhancedPrompts:getStatus` -> `EnhancedPromptsGetStatusResponse` (enabled, hasGeneratedPrompt, generatedAt, detectedStack, cacheValid)
- `enhancedPrompts:setEnabled` -> `EnhancedPromptsSetEnabledResponse` (success, enabled)
- `enhancedPrompts:regenerate` -> `EnhancedPromptsRegenerateResponse` (success, status)
- `enhancedPrompts:getPromptContent` -> `{ content: string | null; error?: string }`
- `enhancedPrompts:download` -> `{ success: boolean; filePath?: string; error?: string }`

---

## 2. Architecture Design

### Design Philosophy

**Chosen Approach**: Resolve enhanced prompt content at the chat RPC handler level and pass it as a plain string through the existing config chain. No new DI dependencies in the chat path.

**Rationale**: The `SdkQueryOptionsBuilder.buildSystemPrompt()` already handles `enhancedPromptsContent` correctly (line 397). The only gap is that nobody resolves the stored prompt string and passes it through `ExecuteQueryConfig`. The chat RPC handlers already have access to the DI container and resolve `isPremium` -- they are the natural place to also resolve the enhanced prompt content.

**Evidence**: The `InternalQueryService` already demonstrates this lazy-resolution pattern at line 354 using `container.resolve<EnhancedPromptsService>()`.

### Data Flow (After Implementation)

```
ChatRpcHandlers.registerChatStart()
  -> licenseService.verifyLicense()                    [EXISTING]
  -> isPremium = isPremiumTier(licenseStatus)           [EXISTING]
  -> enhancedPromptsContent = resolveEnhancedPrompts()  [NEW - lazy resolve]
  -> sdkAdapter.startChatSession({
       isPremium,
       mcpServerRunning,
       enhancedPromptsContent                           [NEW - pass through]
     })
     -> sessionLifecycle.executeQuery({
          isPremium,
          mcpServerRunning,
          enhancedPromptsContent                        [NEW - pass through]
        })
        -> queryOptionsBuilder.build({
             isPremium,
             mcpServerRunning,
             enhancedPromptsContent                     [ALREADY HANDLED]
           })
```

---

## 3. Component Specifications

### BATCH 1: Backend - Wire Enhanced Prompts into Chat Sessions

#### Component 1.1: Add `enhancedPromptsContent` to `ExecuteQueryConfig`

**Purpose**: Allow the enhanced prompt content string to flow from `SdkAgentAdapter` through `SessionLifecycleManager` to `SdkQueryOptionsBuilder`.

**Pattern**: Same as existing `isPremium` field (verified at `session-lifecycle-manager.ts:95-98`)

**File**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
**Action**: MODIFY

**Changes**:

1. Add `enhancedPromptsContent?: string` to `ExecuteQueryConfig` interface (after `mcpServerRunning` at line 105)
2. In `executeQuery()` method (line 431), destructure the new field alongside `isPremium` and `mcpServerRunning`
3. Pass `enhancedPromptsContent` to `queryOptionsBuilder.build()` call at line 488-497

**Exact Change in ExecuteQueryConfig** (after line 105):

```typescript
/**
 * Enhanced prompt content to use as system prompt (TASK_2025_151)
 * When provided, this AI-generated guidance is appended to the system prompt
 * instead of the default PTAH_CORE_SYSTEM_PROMPT.
 * Resolved by the caller (ChatRpcHandlers) from EnhancedPromptsService.
 */
enhancedPromptsContent?: string;
```

**Exact Change in executeQuery()** (line 432-440, add to destructuring):

```typescript
const {
  sessionId,
  sessionConfig,
  resumeSessionId,
  initialPrompt,
  onCompactionStart,
  isPremium = false,
  mcpServerRunning = true,
  enhancedPromptsContent, // NEW
} = config;
```

**Exact Change in queryOptionsBuilder.build() call** (line 488-497, add field):

```typescript
const queryOptions = await this.queryOptionsBuilder.build({
  userMessageStream,
  abortController,
  sessionConfig,
  resumeSessionId,
  sessionId: sessionId as string,
  onCompactionStart,
  isPremium,
  mcpServerRunning,
  enhancedPromptsContent, // NEW
});
```

**Functional Requirements**:

- `enhancedPromptsContent` is optional -- when undefined, `SdkQueryOptionsBuilder.buildSystemPrompt()` already falls back to `PTAH_CORE_SYSTEM_PROMPT` for premium users or no append for free users
- No behavior change for existing callers that omit the field

---

#### Component 1.2: Pass `enhancedPromptsContent` Through `SdkAgentAdapter`

**Purpose**: Accept `enhancedPromptsContent` in `startChatSession()` and `resumeSession()` config, pass it to `sessionLifecycle.executeQuery()`.

**Pattern**: Same as existing `isPremium` field (verified at `sdk-agent-adapter.ts:337-349`)

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
**Action**: MODIFY

**Changes**:

1. Add `enhancedPromptsContent?: string` to `startChatSession()` config type (after `mcpServerRunning` at line 348)
2. Destructure and pass to `executeQuery()` call at line 368-379
3. Add same field to `resumeSession()` config type (after `mcpServerRunning` at line 435)
4. Destructure and pass to `executeQuery()` call at line 470-479

**startChatSession config type addition** (after line 348):

```typescript
/**
 * Enhanced prompt content for system prompt (TASK_2025_151)
 * AI-generated guidance resolved from EnhancedPromptsService.
 * When provided, appended to system prompt instead of PTAH_CORE_SYSTEM_PROMPT.
 */
enhancedPromptsContent?: string;
```

**startChatSession destructure and pass** (line 357-379):

```typescript
const { tabId, isPremium = false, mcpServerRunning = true, enhancedPromptsContent } = config;
// ...
const { sdkQuery, initialModel } = await this.sessionLifecycle.executeQuery({
  sessionId: trackingId,
  sessionConfig: config,
  initialPrompt: config.prompt ? { content: config.prompt, files: config.files } : undefined,
  onCompactionStart: this.compactionStartCallback || undefined,
  isPremium,
  mcpServerRunning,
  enhancedPromptsContent, // NEW
});
```

**Same pattern for resumeSession** (lines 420-479):

- Add `enhancedPromptsContent?: string` to config type
- Destructure alongside `isPremium`
- Pass to `executeQuery()`

**Functional Requirements**:

- Purely pass-through -- `SdkAgentAdapter` does not interpret `enhancedPromptsContent`
- Compatible with existing callers that omit the field

---

#### Component 1.3: Resolve Enhanced Prompt Content in Chat RPC Handlers

**Purpose**: In `ChatRpcHandlers`, after verifying the license, resolve the enhanced prompt content from `EnhancedPromptsService` and pass it to `startChatSession()` / `resumeSession()`.

**Pattern**: Lazy container resolution (verified at `internal-query.service.ts:354`)

**File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`
**Action**: MODIFY

**Changes**:

1. Add import for `EnhancedPromptsService`, `SDK_TOKENS`, and `DependencyContainer` from tsyringe
2. Add `private readonly container: DependencyContainer` to constructor (same pattern as `enhanced-prompts-rpc.handlers.ts:88`)
3. Add a private `resolveEnhancedPromptsContent(workspacePath)` method that:
   - Only runs when `isPremium` is true
   - Uses lazy container resolution: `container.resolve<EnhancedPromptsService>(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE)`
   - Calls `getEnhancedPromptContent(workspacePath)`
   - Returns the string or `undefined` on any error (graceful fallback)
4. In `registerChatStart()` (line 128-131 area): after `isPremium` check, call `resolveEnhancedPromptsContent()` and pass result to `startChatSession()`
5. In `registerChatContinue()` (line 219-221 area): same pattern for session resume path

**Private helper method**:

```typescript
/**
 * Resolve enhanced prompt content for premium users (TASK_2025_151)
 * Uses lazy container resolution to avoid adding EnhancedPromptsService
 * to the ChatRpcHandlers constructor (keeps chat DI chain simple).
 *
 * @returns Enhanced prompt content string, or undefined on error/disabled
 */
private async resolveEnhancedPromptsContent(
  workspacePath: string | undefined,
  isPremium: boolean
): Promise<string | undefined> {
  if (!isPremium || !workspacePath) {
    return undefined;
  }

  try {
    const enhancedPromptsService = this.container.resolve<EnhancedPromptsService>(
      SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE
    );
    const content = await enhancedPromptsService.getEnhancedPromptContent(workspacePath);
    return content ?? undefined;
  } catch (error) {
    this.logger.debug('Failed to resolve enhanced prompts content, using fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
```

**In registerChatStart() - after line 130**:

```typescript
const enhancedPromptsContent = await this.resolveEnhancedPromptsContent(workspacePath, isPremium);
```

Then pass to `startChatSession`:

```typescript
const stream = await this.sdkAdapter.startChatSession({
  // ...existing fields...
  enhancedPromptsContent, // NEW
});
```

**In registerChatContinue() - resume path (around line 219)**:

```typescript
const enhancedPromptsContent = await this.resolveEnhancedPromptsContent(workspacePath, isPremium);

const stream = await this.sdkAdapter.resumeSession(sessionId, {
  projectPath: workspacePath,
  model: currentModel,
  isPremium,
  mcpServerRunning,
  enhancedPromptsContent, // NEW
});
```

**Functional Requirements**:

- Enhanced prompt resolution MUST NOT block or fail the chat start/continue flow
- On any error, return `undefined` (falls back to `PTAH_CORE_SYSTEM_PROMPT` via existing builder logic)
- Only attempt resolution for premium users (skip API call for free tier)
- Log at debug level on failure (not error -- this is a graceful degradation)

**Import additions**:

```typescript
import { DependencyContainer } from 'tsyringe';
// eslint-disable-next-line @nx/enforce-module-boundaries
import type { EnhancedPromptsService } from '@ptah-extension/agent-sdk';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
```

Note: `SDK_TOKENS` is already imported on line 24. Only `DependencyContainer` and the `EnhancedPromptsService` type need to be added.

---

### BATCH 2: Frontend - Settings UI "System Prompt Mode" Section

#### Component 2.1: Add Enhanced Prompts State and Methods to SettingsComponent

**Purpose**: Add signal-based state for Enhanced Prompts status, computed signals for UI display, and methods for RPC interactions.

**Pattern**: Same as existing license status signals (verified at `settings.component.ts:89-145`)

**File**: `libs/frontend/chat/src/lib/settings/settings.component.ts`
**Action**: MODIFY

**Changes**:

1. **Add new Lucide icons** to imports:

   - `Wand2` (for enhanced mode icon)
   - `RefreshCw` (for regenerate button)
   - `Download` (for download button)
   - `Eye` (for preview/expand icon)
   - `ChevronDown`, `ChevronUp` (for expandable preview)
   - `Check` (for enabled status)
   - `Zap` (for mode indicator)

2. **Add state signals**:

```typescript
// Enhanced Prompts state (TASK_2025_151)
readonly enhancedPromptsStatus = signal<EnhancedPromptsGetStatusResponse | null>(null);
readonly enhancedPromptsLoading = signal(false);
readonly enhancedPromptsError = signal<string | null>(null);
readonly isRegenerating = signal(false);
readonly promptPreviewContent = signal<string | null>(null);
readonly promptPreviewExpanded = signal(false);
readonly isDownloading = signal(false);
```

3. **Add computed signals**:

```typescript
// Enhanced Prompts computed signals (TASK_2025_151)
readonly enhancedPromptsEnabled = computed(
  () => this.enhancedPromptsStatus()?.enabled ?? false
);

readonly hasGeneratedPrompt = computed(
  () => this.enhancedPromptsStatus()?.hasGeneratedPrompt ?? false
);

readonly enhancedPromptsGeneratedAt = computed(() => {
  const ts = this.enhancedPromptsStatus()?.generatedAt;
  if (!ts) return null;
  return new Date(ts).toLocaleString();
});

readonly enhancedPromptsCacheValid = computed(
  () => this.enhancedPromptsStatus()?.cacheValid ?? false
);

readonly detectedStackSummary = computed(() => {
  const stack = this.enhancedPromptsStatus()?.detectedStack;
  if (!stack) return null;
  const parts: string[] = [];
  if (stack.frameworks.length > 0) parts.push(stack.frameworks.join(', '));
  if (stack.languages.length > 0) parts.push(stack.languages.join(', '));
  if (stack.projectType) parts.push(stack.projectType);
  return parts.join(' | ');
});

readonly showEnhancedPromptsSection = computed(
  () => this.showPremiumSections() && !this.enhancedPromptsLoading()
);
```

4. **Add lifecycle method**: In `ngOnInit()`, after loading auth status, if premium, load enhanced prompts status:

```typescript
async ngOnInit(): Promise<void> {
  await this.authState.loadAuthStatus();
  // Load enhanced prompts status for premium users (TASK_2025_151)
  if (this.isPremium()) {
    await this.loadEnhancedPromptsStatus();
  }
}
```

5. **Add interaction methods**:

```typescript
// TASK_2025_151: Enhanced Prompts methods

async loadEnhancedPromptsStatus(): Promise<void> {
  this.enhancedPromptsLoading.set(true);
  this.enhancedPromptsError.set(null);
  try {
    const result = await this.rpcService.call('enhancedPrompts:getStatus', {
      workspacePath: '.',
    });
    if (result.isSuccess()) {
      this.enhancedPromptsStatus.set(result.data);
    } else {
      this.enhancedPromptsError.set(result.error ?? 'Failed to load status');
    }
  } catch (error) {
    this.enhancedPromptsError.set('Failed to load enhanced prompts status');
  } finally {
    this.enhancedPromptsLoading.set(false);
  }
}

async toggleEnhancedPrompts(enabled: boolean): Promise<void> {
  this.enhancedPromptsError.set(null);
  const result = await this.rpcService.call('enhancedPrompts:setEnabled', {
    workspacePath: '.',
    enabled,
  });
  if (result.isSuccess()) {
    // Reload status to get updated state
    await this.loadEnhancedPromptsStatus();
  } else {
    this.enhancedPromptsError.set(result.error ?? 'Failed to toggle');
  }
}

async regenerateEnhancedPrompt(): Promise<void> {
  this.isRegenerating.set(true);
  this.enhancedPromptsError.set(null);
  try {
    const result = await this.rpcService.call('enhancedPrompts:regenerate', {
      workspacePath: '.',
      force: true,
    }, { timeout: 120000 }); // 2 minute timeout for generation
    if (result.isSuccess()) {
      await this.loadEnhancedPromptsStatus();
    } else {
      this.enhancedPromptsError.set(result.error ?? 'Regeneration failed');
    }
  } finally {
    this.isRegenerating.set(false);
  }
}

async togglePromptPreview(): Promise<void> {
  if (this.promptPreviewExpanded()) {
    this.promptPreviewExpanded.set(false);
    return;
  }
  // Fetch content if not already loaded
  if (!this.promptPreviewContent()) {
    const result = await this.rpcService.call('enhancedPrompts:getPromptContent', {
      workspacePath: '.',
    });
    if (result.isSuccess() && result.data.content) {
      this.promptPreviewContent.set(result.data.content);
    }
  }
  this.promptPreviewExpanded.set(true);
}

async downloadEnhancedPrompt(): Promise<void> {
  this.isDownloading.set(true);
  try {
    await this.rpcService.call('enhancedPrompts:download', {
      workspacePath: '.',
    });
  } finally {
    this.isDownloading.set(false);
  }
}
```

6. **Add imports** to the component file:

```typescript
import type { EnhancedPromptsGetStatusResponse } from '@ptah-extension/shared';
```

**Functional Requirements**:

- Enhanced prompts status is loaded lazily on settings open (only for premium users)
- Toggle immediately calls RPC and refreshes status
- Regenerate has a 2-minute timeout (generation involves SDK query)
- Preview content is fetched once and cached in signal
- Download delegates to backend save dialog
- All errors displayed via `enhancedPromptsError` signal
- All loading states tracked via separate signals

---

#### Component 2.2: Add Enhanced Prompts UI Section to Settings Template

**Purpose**: Add the "System Prompt Mode" card to the settings page within the premium sections block.

**Pattern**: Same as existing MCP Port and LLM Keys cards (verified at `settings.component.html:419-457`)

**File**: `libs/frontend/chat/src/lib/settings/settings.component.html`
**Action**: MODIFY

**Location**: Insert BEFORE the MCP Port card (line 419), still within the `@if (showPremiumSections())` block (after the Pro Features divider at line 414-417).

**HTML Template** (to insert between Pro Features divider and MCP Port card):

```html
<!-- System Prompt Mode (TASK_2025_151: R9) -->
<div class="border border-primary/30 rounded-md bg-primary/5">
  <div class="p-3">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-1.5">
        <lucide-angular [img]="SparklesIcon" class="w-4 h-4 text-primary" />
        <h2 class="text-xs font-medium uppercase tracking-wide">System Prompt Mode</h2>
      </div>
      <!-- Toggle switch -->
      <input type="checkbox" class="toggle toggle-primary toggle-xs" [checked]="enhancedPromptsEnabled()" (change)="toggleEnhancedPrompts($any($event.target).checked)" [disabled]="!hasGeneratedPrompt() && !enhancedPromptsEnabled()" aria-label="Toggle Enhanced System Prompt" />
    </div>

    <!-- Mode description -->
    @if (enhancedPromptsEnabled()) {
    <div class="flex items-center gap-1 mb-2">
      <span class="badge badge-primary badge-xs gap-1">
        <lucide-angular [img]="SparklesIcon" class="w-2 h-2" />
        Ptah Enhanced
      </span>
      <span class="text-xs text-base-content/60">Active for all sessions</span>
    </div>
    } @else {
    <div class="flex items-center gap-1 mb-2">
      <span class="badge badge-ghost badge-xs">Default Claude Code</span>
      <span class="text-xs text-base-content/60">Standard system prompt</span>
    </div>
    }

    <!-- Error display -->
    @if (enhancedPromptsError()) {
    <div class="text-xs text-error mb-2">{{ enhancedPromptsError() }}</div>
    }

    <!-- Enhanced prompts details (when prompt exists) -->
    @if (hasGeneratedPrompt()) {
    <div class="space-y-1.5 mb-2">
      <!-- Generated timestamp -->
      @if (enhancedPromptsGeneratedAt()) {
      <div class="flex items-center gap-1 text-xs text-base-content/60">
        <lucide-angular [img]="ClockIcon" class="w-3 h-3" />
        <span>Generated: {{ enhancedPromptsGeneratedAt() }}</span>
      </div>
      }

      <!-- Detected stack -->
      @if (detectedStackSummary()) {
      <div class="text-xs text-base-content/60 truncate" [title]="detectedStackSummary()!">Stack: {{ detectedStackSummary() }}</div>
      }

      <!-- Cache validity warning -->
      @if (enhancedPromptsEnabled() && !enhancedPromptsCacheValid()) {
      <div class="flex items-center gap-1 text-xs text-warning">
        <lucide-angular [img]="AlertTriangleIcon" class="w-3 h-3" />
        <span>Prompt may be outdated. Consider regenerating.</span>
      </div>
      }
    </div>

    <!-- Action buttons -->
    <div class="flex gap-2">
      <button class="btn btn-outline btn-xs gap-1 flex-1" (click)="regenerateEnhancedPrompt()" [disabled]="isRegenerating()" aria-label="Regenerate Enhanced Prompt">
        @if (isRegenerating()) {
        <span class="loading loading-spinner loading-xs"></span>
        <span>Generating...</span>
        } @else {
        <lucide-angular [img]="ArrowLeftIcon" class="w-3 h-3 rotate-[135deg]" />
        <span>Regenerate</span>
        }
      </button>
      <button class="btn btn-ghost btn-xs gap-1" (click)="downloadEnhancedPrompt()" [disabled]="isDownloading()" aria-label="Download Enhanced Prompt">
        <lucide-angular [img]="ExternalLinkIcon" class="w-3 h-3" />
        <span>Download</span>
      </button>
    </div>

    <!-- Expandable preview (R10a) -->
    <div class="mt-2">
      <button class="btn btn-ghost btn-xs gap-1 w-full justify-start" (click)="togglePromptPreview()" aria-label="Toggle Prompt Preview">
        <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
        <span>{{ promptPreviewExpanded() ? 'Hide' : 'View' }} Generated Prompt</span>
      </button>
      @if (promptPreviewExpanded() && promptPreviewContent()) {
      <div class="mt-1.5 max-h-48 overflow-y-auto border border-base-300 rounded p-2 bg-base-200/50">
        <pre class="text-xs whitespace-pre-wrap break-words text-base-content/80">{{ promptPreviewContent() }}</pre>
      </div>
      }
    </div>
    } @else {
    <!-- No prompt generated yet -->
    <p class="text-xs text-base-content/50 mb-2">Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project.</p>
    }
  </div>
</div>
```

**Functional Requirements**:

- Toggle is disabled when no prompt has been generated yet (can't enable something that doesn't exist)
- Mode badge shows "Ptah Enhanced" (active) or "Default Claude Code" (inactive)
- Stale cache warning shown when prompt may be outdated
- Regenerate button shows loading spinner during generation
- Preview section is collapsible, content fetched on first expand
- Download triggers VS Code save dialog
- When no prompt exists, shows instruction to run Setup Wizard
- All styling uses existing DaisyUI patterns matching MCP Port / LLM Keys cards

---

## 4. Files Affected Summary

### BATCH 1: Backend (Chat Path Wiring)

| File                                                                        | Action | Changes                                                                                                              |
| --------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`       | MODIFY | Add `enhancedPromptsContent?: string` to `ExecuteQueryConfig`, pass through `executeQuery()`                         |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                       | MODIFY | Add `enhancedPromptsContent?: string` to `startChatSession()` and `resumeSession()` config types, pass through       |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` | MODIFY | Add `resolveEnhancedPromptsContent()` helper, call in `registerChatStart()` and `registerChatContinue()` resume path |

### BATCH 2: Frontend (Settings UI)

| File                                                          | Action | Changes                                                                        |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`   | MODIFY | Add enhanced prompts signals, computed signals, RPC methods, lifecycle loading |
| `libs/frontend/chat/src/lib/settings/settings.component.html` | MODIFY | Add "System Prompt Mode" card in premium section                               |

### NO CHANGES NEEDED

| File                                                                                         | Reason                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`                        | Already handles `enhancedPromptsContent` in `QueryOptionsInput` and `buildSystemPrompt()` |
| `libs/shared/src/lib/types/rpc.types.ts`                                                     | All RPC types already defined                                                             |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/enhanced-prompts-rpc.handlers.ts`      | All RPC handlers already registered                                                       |
| `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts` | `getEnhancedPromptContent()` already works correctly                                      |

---

## 5. Team-Leader Handoff

### Developer Type Recommendation

**Batch 1 (Backend)**: **backend-developer**

- Reason: TypeScript backend, DI container, SDK integration, RPC handlers
- All changes are in Node.js/VS Code extension host code

**Batch 2 (Frontend)**: **frontend-developer**

- Reason: Angular signals, DaisyUI template, component state management
- All changes are in Angular webview code

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-4 hours total

**Breakdown**:

- Batch 1 (Backend): ~1-2 hours -- mostly adding optional fields and one helper method
- Batch 2 (Frontend): ~1-2 hours -- template + signals (no new components, just section additions)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `EnhancedPromptsService` from `@ptah-extension/agent-sdk` (verified: `src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`)
   - `SDK_TOKENS` from `@ptah-extension/agent-sdk` (verified: `src/lib/di/tokens.ts:79`)
   - `DependencyContainer` from `tsyringe` (verified: used in `enhanced-prompts-rpc.handlers.ts:21`)
   - `EnhancedPromptsGetStatusResponse` from `@ptah-extension/shared` (verified: `rpc.types.ts:830`)

2. **All patterns verified from examples**:

   - Lazy container resolution: `internal-query.service.ts:354`
   - Premium gating in chat handlers: `chat-rpc.handlers.ts:128-131`
   - Config pass-through: `sdk-agent-adapter.ts:337-379`
   - Settings signal pattern: `settings.component.ts:89-145`
   - Settings card HTML pattern: `settings.component.html:419-457`

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md`
   - `libs/frontend/chat/CLAUDE.md`
   - `libs/frontend/core/CLAUDE.md`
   - `libs/shared/CLAUDE.md`

4. **No hallucinated APIs**:
   - `EnhancedPromptsService.getEnhancedPromptContent()`: verified at `enhanced-prompts.service.ts:490`
   - `SdkQueryOptionsBuilder.QueryOptionsInput.enhancedPromptsContent`: verified at `sdk-query-options-builder.ts:157`
   - `ClaudeRpcService.call()`: verified at `claude-rpc.service.ts:168`
   - All RPC method names verified in `RpcMethodRegistry`: `rpc.types.ts:1237-1262`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
