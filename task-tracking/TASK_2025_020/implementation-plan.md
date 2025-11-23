# Implementation Plan - TASK_2025_020

## 📊 Executive Summary

**Problem Statement**: The current architecture routes model selection through a provider abstraction layer designed for multi-provider support. However, the extension is hardcoded to Claude CLI only (VS Code LM API is used internally as an MCP tool, not a user-facing provider). This multi-provider abstraction adds unnecessary complexity (~35+ files, ~3000 lines of code) without providing user value.

**Solution**: Remove the provider abstraction layer and implement direct Claude CLI model management using the native `--model` flag. This preserves model selection functionality while eliminating architectural complexity.

**Scope**:

- **Phase 1**: Model Selection Redesign (NEW implementation) - 8 new files
- **Phase 2**: Provider Abstraction Removal (cleanup) - 35+ files deleted/modified

**Impact**:

- **Files Created**: 8 files (~600 lines)
- **Files Deleted**: 21 files (~3500 lines)
- **Files Modified**: 14 files (~1200 lines removed)
- **Net Reduction**: ~4100 lines of code removed

**Estimated Effort**: 12-16 hours (6-8 hours per phase)

---

## 🏗️ Codebase Investigation Summary

### Libraries Discovered

**1. claude-domain** (`libs/backend/claude-domain/`)

- **Purpose**: Business logic for Claude CLI integration
- **Key Exports**:
  - `ClaudeCliLauncher`: Process spawning with `--model` flag support (line 191)
  - `SessionManager`: Session lifecycle with `ClaudeSessionInfo { model: string }` (line 64)
  - `ChatOrchestrationService`: Chat workflow coordination
- **Documentation**: `libs/backend/claude-domain/CLAUDE.md`
- **Evidence**: `--model` flag ALREADY implemented at `claude-cli-launcher.ts:191`

**2. ai-providers-core** (`libs/backend/ai-providers-core/`)

- **Purpose**: Multi-provider abstraction layer (to be simplified)
- **Key Exports**:
  - `ProviderManager`: Provider orchestration (800+ lines) - DELETE
  - `IntelligentProviderStrategy`: Task-based provider selection - DELETE
  - `ClaudeCliAdapter`: Claude CLI integration - KEEP
  - `VsCodeLmAdapter`: VS Code LM API integration - DELETE
  - `ContextManager`: File context management - KEEP
- **Documentation**: `libs/backend/ai-providers-core/CLAUDE.md`
- **Evidence**: Only ClaudeCliAdapter and ContextManager are actually used

**3. shared** (`libs/shared/`)

- **Purpose**: Type system foundation with message protocol
- **Key Exports**:
  - `PROVIDER_MESSAGE_TYPES`: 14 message types (lines 73-91) - DELETE
  - `SessionId`, `MessageId`, `CorrelationId`: Branded types - KEEP
  - `IAIProvider`, `IProviderManager`: Provider abstractions - DELETE
- **Documentation**: `libs/shared/CLAUDE.md`
- **Evidence**: Message types at `message-types.ts:73-91`

**4. frontend/core** (`libs/frontend/core/`)

- **Purpose**: Webview service layer with signal-based state
- **Key Exports**:
  - `ProviderService`: Provider management (550 lines) - DELETE
  - `ChatService`: Main chat orchestrator - KEEP (modify)
  - `VSCodeService`: VS Code message passing - KEEP (modify)
- **Documentation**: `libs/frontend/core/CLAUDE.md`
- **Evidence**: ProviderService at `provider.service.ts:1-550`

**5. frontend/providers** (`libs/frontend/providers/`)

- **Purpose**: Provider UI components
- **Components**: 5 components (settings panel, selector, cards) - DELETE ENTIRE LIBRARY
- **Evidence**: Found via Glob at `libs/frontend/providers/src/lib/components/`

### Patterns Identified

**Pattern 1: CLI Model Flag Support**

- **Description**: Claude CLI launcher already implements `--model` flag
- **Evidence**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts:191`
  ```typescript
  if (model && model !== 'default') {
    args.push('--model', model);
  }
  ```
- **Components**: `buildArgs()` method builds CLI argument array
- **Conventions**: Model passed as string (alias or full name)

**Pattern 2: Session Model Tracking**

- **Description**: Session metadata already tracks model information
- **Evidence**: `libs/backend/claude-domain/src/session/session-manager.ts:64`
  ```typescript
  export interface ClaudeSessionInfo {
    model: string;
    tools: string[];
    cwd: string;
    capabilities: Record<string, unknown>;
  }
  ```
- **Components**: `SessionManager.setClaudeSessionInfo()` stores model
- **Conventions**: Model stored per-session for resumption

**Pattern 3: Signal-Based State Management**

- **Description**: Frontend services use Angular signals (NOT RxJS BehaviorSubject)
- **Evidence**: `libs/frontend/core/src/lib/services/provider.service.ts:102-119`
  ```typescript
  private readonly _availableProviders = signal<ProviderInfo[]>([]);
  readonly availableProviders = this._availableProviders.asReadonly();
  ```
- **Components**: Private writable signals + public readonly signals
- **Conventions**: Computed signals for derived state, toObservable() for RxJS bridge

**Pattern 4: Message Protocol (Request-Response + Events)**

- **Description**: Type-safe message passing with correlation IDs
- **Evidence**: `libs/shared/src/lib/constants/message-types.ts:1-304`
  ```typescript
  export const PROVIDER_MESSAGE_TYPES = {
    GET_AVAILABLE: 'providers:getAvailable',
    GET_CURRENT: 'providers:getCurrent',
    SWITCH: 'providers:switch',
    // ...
  };
  ```
- **Components**: Message type constants + payload interfaces
- **Conventions**: Domain-prefixed types, `:response` suffix for responses

### Integration Points

**1. ChatOrchestrationService → ClaudeCliLauncher**

- **Location**: `libs/backend/claude-domain/src/chat/chat-orchestration.service.ts`
- **Interface**: `spawnTurn(message, { sessionId, model, resumeSessionId, workspaceRoot })`
- **Usage**: Pass model string, launcher builds `--model` CLI arg
- **Evidence**: `claude-cli-launcher.ts:46` (ClaudeCliLaunchOptions interface)

**2. SessionManager → Claude CLI Session Metadata**

- **Location**: `libs/backend/claude-domain/src/session/session-manager.ts`
- **Interface**: `setClaudeSessionInfo(sessionId, { model, tools, cwd, capabilities })`
- **Usage**: Store model per session for display/resumption
- **Evidence**: `session-manager.ts:648` (setClaudeSessionInfo method)

**3. VSCodeService ↔ Extension Host Message Bridge**

- **Location**: `libs/frontend/core/src/lib/services/vscode.service.ts`
- **Interface**: `postStrictMessage(type, payload)`, `onMessageType(type)`
- **Usage**: Type-safe message passing with RxJS streams
- **Evidence**: Frontend/core CLAUDE.md (VS Code Integration section)

---

## 🎯 Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Direct Claude CLI Model Management

- **Pattern Name**: Configuration-Driven CLI Flag Pattern
- **Rationale**:
  1. Claude CLI natively supports `--model` flag (evidence: `claude-cli-launcher.ts:191`)
  2. No API exists to query available models (Claude CLI limitation)
  3. Session metadata already tracks model (evidence: `session-manager.ts:64`)
  4. Removes unnecessary provider abstraction layer
  5. Simpler architecture: Config → CLI flag (no intermediate layers)

**Evidence**:

- CLI launcher implementation: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts:178-199`
- Session info tracking: `libs/backend/claude-domain/src/session/session-manager.ts:63-68`
- Model flag usage: Line 191 builds args with `--model` flag

---

## 📋 PHASE 1: Model Selection Redesign (NEW Implementation)

### Component 1: ClaudeModelService (Backend)

**Purpose**: Centralized model preference management with VS Code config storage

**Pattern**: Service with injected dependencies (tsyringe DI)

**Evidence**: Similar pattern used in `SessionManager` (`session-manager.ts:144-166`)

```typescript
@injectable()
export class SessionManager {
  constructor(@inject(TOKENS.EVENT_BUS) private readonly eventBus: IEventBus, @inject(TOKENS.SESSION_PROXY) private readonly sessionProxy: SessionProxy) {}
}
```

#### Component Specification

**Responsibilities**:

- Provide hardcoded list of available Claude models
- Get/set current model preference from VS Code config
- Emit MODEL_CHANGED event on preference updates
- Validate model IDs against supported list

**Base Classes/Interfaces** (verified):

- `@injectable()` decorator (source: `tsyringe`)
- `@inject(TOKENS.CONFIG_SERVICE)` for VS Code config (source: `vscode-core/di/tokens.ts`)
- `@inject(TOKENS.EVENT_BUS)` for event publishing (source: `vscode-core/di/tokens.ts`)

**Key Dependencies** (verified):

- `ConfigService` for workspace config (import from: `@ptah-extension/vscode-core`)
- `EventBus` for MODEL_CHANGED events (import from: `@ptah-extension/vscode-core`)

**Implementation Pattern**:

```typescript
// Pattern source: session-manager.ts:144-166, chat-orchestration.service.ts:1-50
import { injectable, inject } from 'tsyringe';
import { TOKENS, type IConfigService, type EventBus } from '@ptah-extension/vscode-core';
import { CLAUDE_MESSAGE_TYPES } from '@ptah-extension/shared';

export interface ClaudeModel {
  readonly id: string; // Alias: 'sonnet', 'opus', 'haiku'
  readonly name: string; // Display name
  readonly fullName: string; // Full API name: 'claude-sonnet-4-5-20250929'
  readonly contextWindow: number; // Max tokens
}

@injectable()
export class ClaudeModelService {
  private readonly AVAILABLE_MODELS: readonly ClaudeModel[] = [
    {
      id: 'sonnet',
      name: 'Claude Sonnet 4.5',
      fullName: 'claude-sonnet-4-5-20250929',
      contextWindow: 200000,
    },
    {
      id: 'opus',
      name: 'Claude Opus 4',
      fullName: 'claude-opus-4-20250514',
      contextWindow: 200000,
    },
    {
      id: 'haiku',
      name: 'Claude Haiku 3.5',
      fullName: 'claude-3-5-haiku-20241022',
      contextWindow: 200000,
    },
  ];

  constructor(@inject(TOKENS.CONFIG_SERVICE) private readonly config: IConfigService, @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus) {}

  getAvailableModels(): readonly ClaudeModel[] {
    return this.AVAILABLE_MODELS;
  }

  async getCurrentModel(): Promise<string> {
    // Read from workspace config: claude.model
    const modelId = await this.config.get<string>('claude.model', 'sonnet');
    return modelId;
  }

  async setModel(modelId: string): Promise<boolean> {
    // Validate model ID
    const model = this.AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!model) {
      throw new Error(`Invalid model ID: ${modelId}`);
    }

    // Save to workspace config
    await this.config.set('claude.model', modelId);

    // Emit MODEL_CHANGED event
    this.eventBus.publish(CLAUDE_MESSAGE_TYPES.MODEL_CHANGED, {
      modelId,
      model: model.fullName,
    });

    return true;
  }

  getModelById(modelId: string): ClaudeModel | undefined {
    return this.AVAILABLE_MODELS.find((m) => m.id === modelId);
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST provide list of 3 Claude models (sonnet, opus, haiku)
- MUST store model preference in VS Code workspace config (`claude.model`)
- MUST validate model ID before setting
- MUST emit MODEL_CHANGED event on successful update
- MUST return current model synchronously (read from config)

**Non-Functional Requirements**:

- **Performance**: Config reads cached by VS Code API (< 10ms)
- **Reliability**: Fallback to 'sonnet' if config read fails
- **Maintainability**: Hardcoded model list (easy to update)

**Pattern Compliance**:

- MUST use `@injectable()` decorator (verified: `tsyringe`)
- MUST inject dependencies via `@inject(TOKENS.*)` (verified: `vscode-core/di/tokens.ts`)
- MUST publish events via EventBus (verified: `claude-domain/events/claude-domain.events.ts`)

**Files Affected**:

- `libs/backend/claude-domain/src/model/claude-model.service.ts` (CREATE)
- `libs/backend/claude-domain/src/index.ts` (MODIFY - add export)
- `libs/backend/claude-domain/CLAUDE.md` (MODIFY - document service)

---

### Component 2: CLAUDE_MESSAGE_TYPES (Shared Types)

**Purpose**: Define message protocol for model operations

**Pattern**: Constant object with string literals

**Evidence**: Pattern from `message-types.ts:18-68` (CHAT_MESSAGE_TYPES)

#### Component Specification

**Responsibilities**:

- Define 4 new message types for model operations
- Export type-safe message type constants
- Provide payload interfaces for each message type

**Implementation Pattern**:

```typescript
// Pattern source: message-types.ts:18-68
// Location: libs/shared/src/lib/constants/message-types.ts

export const CLAUDE_MESSAGE_TYPES = {
  // Request/Action types (frontend → backend)
  GET_AVAILABLE_MODELS: 'claude:getAvailableModels',
  GET_CURRENT_MODEL: 'claude:getCurrentModel',
  SET_MODEL: 'claude:setModel',

  // Event types (backend → frontend)
  MODEL_CHANGED: 'claude:modelChanged',
} as const;

export const CLAUDE_RESPONSE_TYPES = {
  GET_AVAILABLE_MODELS: 'claude:getAvailableModels:response',
  GET_CURRENT_MODEL: 'claude:getCurrentModel:response',
  SET_MODEL: 'claude:setModel:response',
} as const;
```

**Payload Interfaces**:

```typescript
// Location: libs/shared/src/lib/types/message.types.ts

export interface ClaudeGetAvailableModelsPayload {
  // No payload (request with no parameters)
}

export interface ClaudeGetCurrentModelPayload {
  // No payload
}

export interface ClaudeSetModelPayload {
  readonly modelId: string;
}

export interface ClaudeModelChangedPayload {
  readonly modelId: string;
  readonly model: string; // Full model name
}

// Add to MessagePayloadMap
export interface MessagePayloadMap {
  // ... existing entries
  [CLAUDE_MESSAGE_TYPES.GET_AVAILABLE_MODELS]: ClaudeGetAvailableModelsPayload;
  [CLAUDE_MESSAGE_TYPES.GET_CURRENT_MODEL]: ClaudeGetCurrentModelPayload;
  [CLAUDE_MESSAGE_TYPES.SET_MODEL]: ClaudeSetModelPayload;
  [CLAUDE_MESSAGE_TYPES.MODEL_CHANGED]: ClaudeModelChangedPayload;
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST define 4 message types (3 requests + 1 event)
- MUST follow naming convention: `claude:<action>` (lowercase camelCase)
- MUST provide response types with `:response` suffix
- MUST define payload interfaces for type safety

**Pattern Compliance**:

- MUST use `as const` for message type objects (verified: `message-types.ts:68`)
- MUST add to `MESSAGE_TYPES` union (verified: `message-types.ts:260-277`)
- MUST add payload interfaces to `MessagePayloadMap` (verified: `message.types.ts`)

**Files Affected**:

- `libs/shared/src/lib/constants/message-types.ts` (MODIFY)
- `libs/shared/src/lib/types/message.types.ts` (MODIFY)

---

### Component 3: Message Handlers (Backend)

**Purpose**: Route model-related messages to ClaudeModelService

**Pattern**: Message subscription via EventBus

**Evidence**: Pattern from `message-handler.service.ts` (backend message routing)

#### Component Specification

**Responsibilities**:

- Subscribe to GET_AVAILABLE_MODELS, GET_CURRENT_MODEL, SET_MODEL
- Invoke ClaudeModelService methods
- Send response messages with success/error payloads

**Implementation Pattern**:

```typescript
// Location: libs/backend/claude-domain/src/messaging/message-handler.service.ts
// Modify existing MessageHandlerService to add model subscriptions

// In setupSubscriptions() method:

// GET_AVAILABLE_MODELS
this.eventBus
  .on<ClaudeGetAvailableModelsPayload>(CLAUDE_MESSAGE_TYPES.GET_AVAILABLE_MODELS)
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe(async (message) => {
    try {
      const models = this.modelService.getAvailableModels();

      this.sendResponse(message.id, toResponseType(CLAUDE_MESSAGE_TYPES.GET_AVAILABLE_MODELS), {
        success: true,
        data: { models },
      });
    } catch (error) {
      this.sendErrorResponse(message.id, toResponseType(CLAUDE_MESSAGE_TYPES.GET_AVAILABLE_MODELS), error);
    }
  });

// GET_CURRENT_MODEL
this.eventBus
  .on<ClaudeGetCurrentModelPayload>(CLAUDE_MESSAGE_TYPES.GET_CURRENT_MODEL)
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe(async (message) => {
    try {
      const modelId = await this.modelService.getCurrentModel();
      const model = this.modelService.getModelById(modelId);

      this.sendResponse(message.id, toResponseType(CLAUDE_MESSAGE_TYPES.GET_CURRENT_MODEL), {
        success: true,
        data: { modelId, model },
      });
    } catch (error) {
      this.sendErrorResponse(message.id, toResponseType(CLAUDE_MESSAGE_TYPES.GET_CURRENT_MODEL), error);
    }
  });

// SET_MODEL
this.eventBus
  .on<ClaudeSetModelPayload>(CLAUDE_MESSAGE_TYPES.SET_MODEL)
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe(async (message) => {
    try {
      await this.modelService.setModel(message.payload.modelId);

      this.sendResponse(message.id, toResponseType(CLAUDE_MESSAGE_TYPES.SET_MODEL), {
        success: true,
        data: { modelId: message.payload.modelId },
      });
    } catch (error) {
      this.sendErrorResponse(message.id, toResponseType(CLAUDE_MESSAGE_TYPES.SET_MODEL), error);
    }
  });
```

**Quality Requirements**:

**Functional Requirements**:

- MUST handle all 3 request message types
- MUST send response messages with correlation ID
- MUST catch errors and send error responses
- MUST use ClaudeModelService for business logic

**Pattern Compliance**:

- MUST use EventBus.on() for subscriptions (verified: existing message handlers)
- MUST use toResponseType() helper (verified: `message-types.ts:299`)
- MUST inject ClaudeModelService via DI

**Files Affected**:

- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` (MODIFY)

---

### Component 4: Chat Orchestration Integration (Backend)

**Purpose**: Fetch current model before spawning CLI process

**Pattern**: Service method with async/await

**Evidence**: `chat-orchestration.service.ts` (chat workflow coordination)

#### Component Specification

**Responsibilities**:

- Fetch current model preference from ClaudeModelService
- Pass model to ClaudeCliLauncher.spawnTurn() options
- CLI launcher builds `--model` flag (ALREADY IMPLEMENTED)

**Implementation Pattern**:

```typescript
// Location: libs/backend/claude-domain/src/chat/chat-orchestration.service.ts
// Modify sendMessage() method

async sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
  // ... existing session/message setup code

  try {
    // NEW: Fetch current model preference
    const modelId = await this.modelService.getCurrentModel();

    // Get full model name for CLI
    const modelInfo = this.modelService.getModelById(modelId);
    const modelName = modelInfo?.id || 'sonnet'; // Use alias (CLI accepts both)

    // Spawn CLI process with model
    const stream = await this.launcher.spawnTurn(messageContent, {
      sessionId: session.id,
      model: modelName, // Pass to CLI launcher
      resumeSessionId: this.sessionManager.getClaudeSessionId(session.id),
      workspaceRoot,
    });

    // ... existing stream handling code
  } catch (error) {
    // ... existing error handling
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST fetch model before every CLI spawn
- MUST pass model to ClaudeCliLauncher options
- MUST handle errors (fallback to default if model service fails)
- MUST NOT modify ClaudeCliLauncher (already supports --model flag)

**Pattern Compliance**:

- MUST use async/await for model fetch
- MUST inject ClaudeModelService via DI
- MUST use existing spawnTurn() interface (verified: `claude-cli-launcher.ts:42-45`)

**Files Affected**:

- `libs/backend/claude-domain/src/chat/chat-orchestration.service.ts` (MODIFY)

---

### Component 5: ModelSelectorDropdownComponent (Frontend)

**Purpose**: Dropdown UI for model selection in chat header

**Pattern**: Standalone Angular 20 component with signals

**Evidence**: `shared-ui` components use standalone + signals pattern

#### Component Specification

**Responsibilities**:

- Display dropdown with available models
- Show current model selection
- Send SET_MODEL message on user change
- Listen for MODEL_CHANGED events to update UI

**Implementation Pattern**:

```typescript
// Location: libs/frontend/chat/src/lib/components/model-selector/model-selector.component.ts
import { Component, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VSCodeService } from '@ptah-extension/core';
import { CLAUDE_MESSAGE_TYPES, CorrelationId } from '@ptah-extension/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export interface ClaudeModel {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  readonly contextWindow: number;
}

@Component({
  selector: 'ptah-model-selector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="model-selector">
      <label for="model-select">Model:</label>
      <select id="model-select" [value]="currentModelId()" (change)="onModelChange($event)" [disabled]="isLoading()">
        @for (model of availableModels(); track model.id) {
        <option [value]="model.id">{{ model.name }}</option>
        }
      </select>
    </div>
  `,
  styles: [
    `
      .model-selector {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        padding: 4px 8px;
        border-radius: 2px;
        cursor: pointer;
      }

      select:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class ModelSelectorComponent {
  private readonly vscode = inject(VSCodeService);

  // Signal-based state
  private readonly _availableModels = signal<ClaudeModel[]>([]);
  private readonly _currentModelId = signal<string>('sonnet');
  private readonly _isLoading = signal<boolean>(false);

  readonly availableModels = this._availableModels.asReadonly();
  readonly currentModelId = this._currentModelId.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  constructor() {
    // Fetch initial data
    this.loadModels();
    this.loadCurrentModel();

    // Listen for model changes
    this.vscode
      .onMessageType(CLAUDE_MESSAGE_TYPES.MODEL_CHANGED)
      .pipe(takeUntilDestroyed())
      .subscribe((payload) => {
        this._currentModelId.set(payload.modelId);
      });
  }

  private async loadModels(): Promise<void> {
    this._isLoading.set(true);

    const response = await this.vscode.sendRequest(CLAUDE_MESSAGE_TYPES.GET_AVAILABLE_MODELS, {});

    if (response.success && response.data?.models) {
      this._availableModels.set(response.data.models);
    }

    this._isLoading.set(false);
  }

  private async loadCurrentModel(): Promise<void> {
    const response = await this.vscode.sendRequest(CLAUDE_MESSAGE_TYPES.GET_CURRENT_MODEL, {});

    if (response.success && response.data?.modelId) {
      this._currentModelId.set(response.data.modelId);
    }
  }

  async onModelChange(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const modelId = select.value;

    this._isLoading.set(true);

    try {
      await this.vscode.sendRequest(CLAUDE_MESSAGE_TYPES.SET_MODEL, { modelId });

      // Update will come via MODEL_CHANGED event
    } catch (error) {
      console.error('Failed to change model:', error);
      // Revert selection on error
      this.loadCurrentModel();
    } finally {
      this._isLoading.set(false);
    }
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST display dropdown with 3 Claude models
- MUST show current model selection
- MUST send SET_MODEL message on user change
- MUST update UI on MODEL_CHANGED event
- MUST disable dropdown while loading

**Non-Functional Requirements**:

- **Accessibility**: Proper label/select association (aria-label)
- **Performance**: Debounce rapid selection changes (300ms)
- **UX**: Loading state during model change

**Pattern Compliance**:

- MUST use standalone component (verified: Angular 20 pattern)
- MUST use signals for state (verified: `core` library pattern)
- MUST inject VSCodeService via inject() (verified: Angular 20 pattern)
- MUST use takeUntilDestroyed() for subscriptions (verified: Angular 20 pattern)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.html` (CREATE)
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.css` (CREATE)
- `libs/frontend/chat/src/lib/components/index.ts` (MODIFY - export component)
- `libs/frontend/chat/src/index.ts` (MODIFY - re-export component)

---

### Component 6: Chat Header Integration (Frontend)

**Purpose**: Add ModelSelectorComponent to chat UI header

**Pattern**: Component composition with standalone imports

**Evidence**: `ChatComponent` structure (chat library)

#### Component Specification

**Responsibilities**:

- Import ModelSelectorComponent
- Add to chat header template
- Position near session info

**Implementation Pattern**:

```typescript
// Location: libs/frontend/chat/src/lib/components/chat/chat.component.ts
import { ModelSelectorComponent } from '../model-selector/model-selector.component';

@Component({
  // ...
  imports: [
    // ... existing imports
    ModelSelectorComponent,
  ],
  template: `
    <div class="chat-header">
      <div class="session-info">
        <!-- ... existing session info -->
      </div>

      <!-- NEW: Model selector -->
      <ptah-model-selector />

      <div class="actions">
        <!-- ... existing actions -->
      </div>
    </div>

    <!-- ... rest of template -->
  `,
})
export class ChatComponent {
  // No changes to component logic
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST import ModelSelectorComponent
- MUST add to chat header section
- MUST position between session info and actions

**Pattern Compliance**:

- MUST use standalone component import (verified: Angular 20 pattern)
- MUST NOT modify component logic (purely template change)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/chat/chat.component.ts` (MODIFY)
- `libs/frontend/chat/src/lib/components/chat/chat.component.html` (MODIFY)

---

## 📋 PHASE 2: Provider Abstraction Removal (Cleanup)

### Removal Plan by Category

#### Category 1: Frontend Library Deletion

**1.1 Delete libs/frontend/providers/ (Entire Library)**

**Files to DELETE** (11 files):

- `libs/frontend/providers/src/lib/components/provider-card/provider-card.component.ts`
- `libs/frontend/providers/src/lib/components/provider-selector-dropdown.component.ts`
- `libs/frontend/providers/src/lib/components/provider-settings.component.ts`
- `libs/frontend/providers/src/lib/components/settings-view/settings-view.component.ts`
- `libs/frontend/providers/src/lib/components/index.ts`
- `libs/frontend/providers/src/lib/containers/provider-manager.component.ts`
- `libs/frontend/providers/src/lib/containers/index.ts`
- `libs/frontend/providers/src/index.ts`
- `libs/frontend/providers/src/test-setup.ts`
- `libs/frontend/providers/jest.config.ts`
- `libs/frontend/providers/project.json`

**Files to MODIFY**:

- `tsconfig.base.json` - Remove `@ptah-extension/providers` path mapping
- `apps/ptah-extension-webview/src/app/app.ts` - Remove provider imports

**Evidence**: Glob found 11 TypeScript files in `libs/frontend/providers/`

**Impact**: ~800 lines deleted, removes all provider UI

---

#### Category 2: Frontend Service Removal

**2.1 Delete ProviderService from frontend/core**

**Files to DELETE** (1 file):

- `libs/frontend/core/src/lib/services/provider.service.ts` (550 lines)

**Files to MODIFY**:

- `libs/frontend/core/src/lib/services/index.ts` - Remove export
- `libs/frontend/core/CLAUDE.md` - Remove documentation
- `apps/ptah-extension-webview/src/app/app.ts` - Remove service initialization

**Evidence**: Read `provider.service.ts:1-550` (full file)

**Impact**: ~550 lines deleted, removes frontend provider management

**Migration Steps**:

1. Search for `ProviderService` imports: `Grep("ProviderService" in libs/frontend/)`
2. Remove all imports and usages
3. Delete service file
4. Update barrel exports
5. Update documentation

---

#### Category 3: Backend Orchestration Removal

**3.1 Delete ProviderOrchestrationService**

**Files to DELETE** (1 file):

- `libs/backend/claude-domain/src/provider/provider-orchestration.service.ts` (800+ lines)

**Files to MODIFY**:

- `libs/backend/claude-domain/src/index.ts` - Remove export
- `libs/backend/claude-domain/CLAUDE.md` - Remove documentation
- `libs/backend/claude-domain/src/di/register.ts` - Remove DI registration

**Evidence**: Read `provider-orchestration.service.ts:1-100` (header)

**Impact**: ~800 lines deleted, removes backend provider orchestration

**Migration Steps**:

1. Search for `ProviderOrchestrationService` imports
2. Remove message handler subscriptions
3. Remove DI registration
4. Delete service file
5. Update documentation

---

**3.2 Remove Provider Message Handlers**

**Files to MODIFY**:

- `libs/backend/claude-domain/src/messaging/message-handler.service.ts`

**Lines to REMOVE**:

- All subscriptions for `PROVIDER_MESSAGE_TYPES.*`
- Approximately 200 lines

**Evidence**: Message handler subscribes to all provider message types

**Impact**: Removes 14 message type handlers

---

#### Category 4: Backend Library Simplification

**4.1 Simplify ai-providers-core Library**

**Files to DELETE** (5 files):

- `libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.ts`
- `libs/backend/ai-providers-core/src/manager/provider-manager.ts`
- `libs/backend/ai-providers-core/src/manager/provider-state.types.ts`
- `libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.ts`
- `libs/backend/ai-providers-core/src/interfaces/provider-selection.interface.ts`

**Files to KEEP**:

- `libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.ts` (Claude CLI integration)
- `libs/backend/ai-providers-core/src/context/context-manager.ts` (File context management)

**Files to MODIFY**:

- `libs/backend/ai-providers-core/src/index.ts` - Simplified exports
- `libs/backend/ai-providers-core/CLAUDE.md` - Update documentation

**Evidence**: Read `ai-providers-core/src/index.ts` (exports analyzed)

**Impact**: ~1500 lines deleted, library reduced to essentials

**Simplified Exports**:

```typescript
// NEW: libs/backend/ai-providers-core/src/index.ts
export { ClaudeCliAdapter } from './adapters';
export { ContextManager, type FileSearchResult, type FileSearchOptions } from './context';
```

---

#### Category 5: Shared Types Cleanup

**5.1 Delete PROVIDER_MESSAGE_TYPES**

**Files to MODIFY**:

- `libs/shared/src/lib/constants/message-types.ts`

**Lines to DELETE**:

- Lines 72-91: PROVIDER_MESSAGE_TYPES constant (14 types)
- Lines 203-213: PROVIDER_RESPONSE_TYPES constant

**Evidence**: Read `message-types.ts:72-91`

**Impact**: ~40 lines deleted

**Before** (lines 72-91):

```typescript
export const PROVIDER_MESSAGE_TYPES = {
  GET_AVAILABLE: 'providers:getAvailable',
  GET_CURRENT: 'providers:getCurrent',
  SWITCH: 'providers:switch',
  GET_HEALTH: 'providers:getHealth',
  GET_ALL_HEALTH: 'providers:getAllHealth',
  SET_DEFAULT: 'providers:setDefault',
  ENABLE_FALLBACK: 'providers:enableFallback',
  SET_AUTO_SWITCH: 'providers:setAutoSwitch',
  SELECT_MODEL: 'providers:selectModel',
  CURRENT_CHANGED: 'providers:currentChanged',
  HEALTH_CHANGED: 'providers:healthChanged',
  ERROR: 'providers:error',
  AVAILABLE_UPDATED: 'providers:availableUpdated',
  MODEL_CHANGED: 'providers:modelChanged',
} as const;
```

**After**: DELETE entire constant

---

**5.2 Delete Provider Payload Interfaces**

**Files to MODIFY**:

- `libs/shared/src/lib/types/message.types.ts`

**Interfaces to DELETE** (~200 lines):

- `ProvidersGetAvailablePayload`
- `ProvidersGetCurrentPayload`
- `ProvidersSwitchPayload`
- `ProvidersGetHealthPayload`
- `ProvidersGetAllHealthPayload`
- `ProvidersSetDefaultPayload`
- `ProvidersEnableFallbackPayload`
- `ProvidersSetAutoSwitchPayload`
- `ProvidersSelectModelPayload` (from TASK_2025_012)
- `ProvidersModelChangedPayload`
- `ProvidersCurrentChangedPayload`
- `ProvidersHealthChangedPayload`
- `ProvidersErrorPayload`
- `ProvidersAvailableUpdatedPayload`

**Evidence**: Provider payload interfaces span ~200 lines in `message.types.ts`

**Impact**: ~200 lines deleted

---

**5.3 Simplify ai-provider.types.ts**

**Files to MODIFY**:

- `libs/shared/src/lib/types/ai-provider.types.ts`

**Types to DELETE**:

- `IProviderManager` interface
- `ProviderSelectionCriteria` interface
- `ProviderSelectionResult` interface

**Types to KEEP**:

- `IAIProvider` interface (may be used internally by ClaudeCliAdapter)
- `ProviderId` branded type
- `ProviderHealth` type

**Evidence**: IProviderManager used by ProviderOrchestrationService (being deleted)

**Impact**: ~100 lines deleted

---

#### Category 6: VS Code Integration Updates

**6.1 Remove Provider DI Registration**

**Files to MODIFY**:

- `apps/ptah-extension-vscode/src/di/container.ts`

**Lines to REMOVE**:

- ProviderManager registration
- ProviderOrchestrationService registration
- Related DI token registrations

**Evidence**: Container.ts registers all backend services

**Impact**: ~20 lines removed

---

**6.2 Remove Provider Commands**

**Files to MODIFY**:

- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts`

**Commands to REMOVE**:

- `ptah.switchProvider`
- `ptah.getProviderHealth`
- `ptah.setDefaultProvider`

**Evidence**: Command handlers for provider management

**Impact**: ~60 lines removed

---

**6.3 Remove Provider Tokens**

**Files to MODIFY**:

- `libs/backend/vscode-core/src/di/tokens.ts`

**Tokens to REMOVE**:

- `PROVIDER_MANAGER`
- `PROVIDER_ORCHESTRATION_SERVICE`
- `INTELLIGENT_PROVIDER_STRATEGY`

**Evidence**: Tokens for provider DI

**Impact**: ~10 lines removed

---

### File Inventory Summary

#### NEW Files (Phase 1) - 8 files

**Backend** (2 files):

1. `libs/backend/claude-domain/src/model/claude-model.service.ts` (150 lines)
2. `libs/backend/claude-domain/src/model/claude-model.service.spec.ts` (100 lines)

**Shared** (0 new files, modifications only):

- Modifications to existing files for message types

**Frontend** (6 files): 3. `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.ts` (120 lines) 4. `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.html` (20 lines) 5. `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.css` (30 lines) 6. `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.spec.ts` (80 lines) 7. `libs/frontend/chat/src/lib/services/model.service.ts` (100 lines) 8. `libs/frontend/chat/src/lib/services/model.service.spec.ts` (80 lines)

**Total NEW Lines**: ~680 lines

---

#### FILES to DELETE (Phase 2) - 21 files

**Frontend Library** (11 files):

1. `libs/frontend/providers/` (entire directory)

**Frontend Services** (1 file): 2. `libs/frontend/core/src/lib/services/provider.service.ts` (550 lines)

**Backend Services** (1 file): 3. `libs/backend/claude-domain/src/provider/provider-orchestration.service.ts` (800 lines)

**Backend Library** (5 files): 4. `libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.ts` 5. `libs/backend/ai-providers-core/src/manager/provider-manager.ts` 6. `libs/backend/ai-providers-core/src/manager/provider-state.types.ts` 7. `libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.ts` 8. `libs/backend/ai-providers-core/src/interfaces/provider-selection.interface.ts`

**Test Files** (3 files):
9-11. Associated `.spec.ts` files for deleted services

**Total DELETED Lines**: ~3500 lines

---

#### FILES to MODIFY (Phase 1 & 2) - 14 files

**Phase 1 Modifications** (6 files):

1. `libs/shared/src/lib/constants/message-types.ts` - Add CLAUDE_MESSAGE_TYPES
2. `libs/shared/src/lib/types/message.types.ts` - Add Claude payloads
3. `libs/backend/claude-domain/src/messaging/message-handler.service.ts` - Add model handlers
4. `libs/backend/claude-domain/src/chat/chat-orchestration.service.ts` - Integrate model fetch
5. `libs/frontend/chat/src/lib/components/chat/chat.component.ts` - Add model selector
6. `libs/frontend/chat/src/lib/components/index.ts` - Export model selector

**Phase 2 Modifications** (8 files): 7. `libs/shared/src/lib/constants/message-types.ts` - Remove PROVIDER_MESSAGE_TYPES 8. `libs/shared/src/lib/types/message.types.ts` - Remove provider payloads 9. `libs/shared/src/lib/types/ai-provider.types.ts` - Simplify types 10. `libs/backend/ai-providers-core/src/index.ts` - Simplified exports 11. `libs/backend/claude-domain/src/index.ts` - Remove provider exports 12. `apps/ptah-extension-vscode/src/di/container.ts` - Remove provider DI 13. `apps/ptah-extension-vscode/src/handlers/command-handlers.ts` - Remove provider commands 14. `tsconfig.base.json` - Remove provider path mapping

**Total MODIFIED Lines Removed**: ~1200 lines

---

### Total Impact Summary

- **NEW Files**: 8 files (~680 lines)
- **DELETED Files**: 21 files (~3500 lines)
- **MODIFIED Files**: 14 files (~1200 lines removed)
- **NET REDUCTION**: ~4020 lines of code removed
- **Complexity Reduction**: 35+ files eliminated, simplified architecture

---

## 🔗 Integration Architecture

### Integration Point 1: Model Configuration → CLI Flag

**How Components Connect**:

```
User selects model in ModelSelectorComponent
  ↓
SET_MODEL message sent to backend
  ↓
ClaudeModelService.setModel() updates VS Code config
  ↓
MODEL_CHANGED event published
  ↓
ChatOrchestrationService fetches model on next message
  ↓
ClaudeCliLauncher.spawnTurn() builds --model flag
  ↓
Claude CLI subprocess spawned with model
```

**Pattern**: Configuration-driven CLI flag injection

**Evidence**:

- Config storage: `ClaudeModelService.setModel()` (new)
- CLI flag building: `claude-cli-launcher.ts:191` (existing)

---

### Integration Point 2: Frontend State Synchronization

**How Components Connect**:

```
Backend MODEL_CHANGED event
  ↓
VSCodeService.onMessageType() observable
  ↓
ModelSelectorComponent subscription
  ↓
Signal update: _currentModelId.set()
  ↓
UI re-renders with new selection
```

**Pattern**: Event-driven UI synchronization via signals

**Evidence**:

- Signal pattern: `provider.service.ts:102-119` (pattern reference)
- Message subscription: `vscode.service.ts` (VS Code integration)

---

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (Angular Webview)                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ModelSelectorComponent                                           │
│  ├─ availableModels signal (3 Claude models)                     │
│  ├─ currentModelId signal ('sonnet' | 'opus' | 'haiku')          │
│  └─ onModelChange() → postMessage(SET_MODEL)                     │
│                                                                   │
│         │                                                         │
│         │ Message Protocol (type-safe)                           │
│         ▼                                                         │
└─────────────────────────────────────────────────────────────────┘
         │
         │ VS Code Webview Message Bridge
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND (Extension Host)                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  MessageHandlerService                                            │
│  └─ Subscribe to SET_MODEL → route to ClaudeModelService         │
│                                                                   │
│  ClaudeModelService                                               │
│  ├─ getAvailableModels() → hardcoded list                        │
│  ├─ getCurrentModel() → read from config ('claude.model')        │
│  ├─ setModel(id) → save to config + emit MODEL_CHANGED           │
│  └─ getModelById(id) → lookup model info                         │
│                                                                   │
│         │                                                         │
│         │ Config Storage (VS Code workspace)                     │
│         ▼                                                         │
│                                                                   │
│  ChatOrchestrationService.sendMessage()                           │
│  ├─ await modelService.getCurrentModel()                         │
│  └─ launcher.spawnTurn({ model: 'sonnet' })                      │
│                                                                   │
│         │                                                         │
│         │ CLI Spawn                                               │
│         ▼                                                         │
│                                                                   │
│  ClaudeCliLauncher.buildArgs()                                    │
│  └─ args.push('--model', model) ← ALREADY IMPLEMENTED (line 191) │
│                                                                   │
│         │                                                         │
│         │ Child Process                                           │
│         ▼                                                         │
└─────────────────────────────────────────────────────────────────┘
         │
         │ CLI Execution
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Claude CLI Subprocess                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  claude -p --output-format=stream-json --model=sonnet            │
│                                                                   │
│  Native --model flag support (aliases + full names)              │
│  ✓ sonnet, opus, haiku                                           │
│  ✓ claude-sonnet-4-5-20250929 (full name)                        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

### Dependencies Between Components

**Phase 1 Dependencies** (NEW implementation):

```
MessageHandlerService
  ↓ depends on
ClaudeModelService
  ↓ depends on
[ConfigService, EventBus] (vscode-core)

ChatOrchestrationService
  ↓ depends on
ClaudeModelService

ModelSelectorComponent
  ↓ depends on
VSCodeService (core)
```

**Phase 2 Dependencies** (Removal order):

```
1. Frontend: Delete libs/frontend/providers/ (no dependencies)
2. Frontend: Delete ProviderService (no dependencies after #1)
3. Backend: Remove message handlers (requires #2 complete)
4. Backend: Delete ProviderOrchestrationService (requires #3)
5. Backend: Simplify ai-providers-core (requires #4)
6. Shared: Delete message types (requires all backend removals)
7. VS Code: Update DI/commands (final cleanup)
```

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

**Phase 1 (Model Selection)**:

- FR-1: System MUST display dropdown with 3 Claude models (sonnet, opus, haiku)
- FR-2: System MUST persist model preference to VS Code workspace config
- FR-3: System MUST apply selected model to CLI spawn via `--model` flag
- FR-4: System MUST support both model aliases ('sonnet') and full names ('claude-sonnet-4-5-20250929')
- FR-5: System MUST emit MODEL_CHANGED event on preference update
- FR-6: System MUST synchronize UI selection across all webview instances

**Phase 2 (Provider Removal)**:

- FR-7: System MUST NOT contain any provider selection UI after removal
- FR-8: System MUST NOT reference PROVIDER_MESSAGE_TYPES after removal
- FR-9: System MUST compile with zero TypeScript errors after removal
- FR-10: System MUST launch extension without provider errors after removal

### Non-Functional Requirements

**Performance**:

- NFR-1: Model config read < 10ms (VS Code API caching)
- NFR-2: Model dropdown render < 50ms (3 items only)
- NFR-3: Model change message round-trip < 100ms

**Security**:

- NFR-4: Model config stored in workspace scope (not user/global)
- NFR-5: Model validation prevents invalid model IDs

**Maintainability**:

- NFR-6: Hardcoded model list for easy updates (no dynamic API)
- NFR-7: Zero `any` types in all new components
- NFR-8: Full JSDoc documentation for all new services
- NFR-9: Unit test coverage ≥ 80% for all new components

**Testability**:

- NFR-10: ClaudeModelService injectable with mock config
- NFR-11: ModelSelectorComponent testable with mock VS Code service
- NFR-12: Message handlers testable with EventBus mock

### Pattern Compliance

**Architecture Patterns**:

- PC-1: All backend services MUST use tsyringe DI (`@injectable()`, `@inject()`)
- PC-2: All frontend components MUST be standalone with signals
- PC-3: All message types MUST be defined in `message-types.ts` constants
- PC-4: All cross-boundary types MUST be defined in `libs/shared`
- PC-5: All business logic MUST be in orchestration services (NOT message handlers)

**Evidence for Patterns**:

- PC-1: `session-manager.ts:144` (DI pattern)
- PC-2: `model-selector.component.ts` (standalone + signals)
- PC-3: `message-types.ts:18-68` (message constants)
- PC-4: `shared/src/lib/types/` (type contracts)
- PC-5: `chat-orchestration.service.ts` (business logic layer)

---

## 🔄 Implementation Order (CRITICAL)

### Phase 1: Model Selection Redesign (6-8 hours)

**MUST complete Phase 1 BEFORE starting Phase 2** to preserve model selection functionality.

**Task 1.1**: Create ClaudeModelService (Backend)

- Create `claude-model.service.ts` with hardcoded model list
- Inject ConfigService and EventBus
- Implement getAvailableModels(), getCurrentModel(), setModel()
- Write unit tests (80% coverage)
- **Verification**: Service returns 3 models, persists to config, emits event

**Task 1.2**: Define CLAUDE_MESSAGE_TYPES (Shared)

- Add CLAUDE_MESSAGE_TYPES to `message-types.ts`
- Add CLAUDE_RESPONSE_TYPES for responses
- Define payload interfaces in `message.types.ts`
- Add to MessagePayloadMap for type safety
- **Verification**: TypeScript compiles, message types are type-safe

**Task 1.3**: Add Message Handlers (Backend)

- Modify MessageHandlerService to add model subscriptions
- Handle GET_AVAILABLE_MODELS, GET_CURRENT_MODEL, SET_MODEL
- Send success/error responses with correlation IDs
- **Verification**: Backend responds to model messages correctly

**Task 1.4**: Integrate Model Fetch in Chat Orchestration (Backend)

- Modify ChatOrchestrationService.sendMessage()
- Fetch current model before CLI spawn
- Pass model to ClaudeCliLauncher.spawnTurn() options
- **Verification**: CLI spawns with correct `--model` flag in logs

**Task 1.5**: Create ModelSelectorComponent (Frontend)

- Create standalone component with signals
- Fetch available models on init
- Display dropdown with current selection
- Send SET_MODEL on user change
- Listen for MODEL_CHANGED events
- Write component tests
- **Verification**: Dropdown appears, selection persists, UI updates on event

**Task 1.6**: Integrate Model Selector in Chat UI (Frontend)

- Import ModelSelectorComponent in ChatComponent
- Add to chat header template
- Position near session info
- **Verification**: Model selector visible in chat header, functional

**Task 1.7**: End-to-End Testing (Full Stack)

- Test full flow: UI → backend → config → CLI spawn
- Verify `--model` flag in CLI process logs
- Test model persistence across sessions
- Test MODEL_CHANGED event synchronization
- **Verification**: Model selection works end-to-end, CLI uses correct model

---

### Phase 2: Provider Abstraction Removal (6-8 hours)

**MUST complete Phase 1 BEFORE starting Phase 2.**

**Task 2.1**: Delete Frontend Provider Library

- Delete `libs/frontend/providers/` directory (11 files)
- Remove `@ptah-extension/providers` from `tsconfig.base.json`
- Remove provider imports from `app.ts`
- **Verification**: No TypeScript errors after deletion, app compiles

**Task 2.2**: Delete Frontend ProviderService

- Delete `provider.service.ts` from `libs/frontend/core`
- Search for ProviderService imports: `Grep("ProviderService" in libs/frontend/)`
- Remove all imports and usages
- Update barrel exports in `core/src/lib/services/index.ts`
- Update `core/CLAUDE.md` documentation
- **Verification**: No references to ProviderService remain, library compiles

**Task 2.3**: Delete Backend ProviderOrchestrationService

- Delete `provider-orchestration.service.ts` from `claude-domain`
- Remove export from `claude-domain/src/index.ts`
- Remove DI registration from `claude-domain/src/di/register.ts`
- Update `claude-domain/CLAUDE.md` documentation
- **Verification**: No references to service remain, library compiles

**Task 2.4**: Remove Provider Message Handlers

- Modify `message-handler.service.ts` in claude-domain
- Remove all subscriptions for PROVIDER_MESSAGE_TYPES
- Remove approximately 200 lines of message handling code
- **Verification**: No provider message subscriptions remain, backend compiles

**Task 2.5**: Simplify ai-providers-core Library

- Delete VsCodeLmAdapter, ProviderManager, IntelligentProviderStrategy
- Delete provider-state.types.ts, provider-selection.interface.ts
- Keep ClaudeCliAdapter and ContextManager
- Simplify `index.ts` exports to only ClaudeCliAdapter + ContextManager
- Update `ai-providers-core/CLAUDE.md` documentation
- **Verification**: Library compiles with simplified exports, no broken imports

**Task 2.6**: Delete PROVIDER_MESSAGE_TYPES (Shared)

- Remove PROVIDER_MESSAGE_TYPES from `message-types.ts` (lines 72-91)
- Remove PROVIDER_RESPONSE_TYPES (lines 203-213)
- Remove from MESSAGE_TYPES union
- **Verification**: TypeScript compiles, no references to provider types

**Task 2.7**: Delete Provider Payload Interfaces (Shared)

- Remove 14 provider payload interfaces from `message.types.ts`
- Remove from MessagePayloadMap
- Remove approximately 200 lines
- **Verification**: TypeScript compiles, no broken payload references

**Task 2.8**: Simplify ai-provider.types.ts (Shared)

- Delete IProviderManager interface
- Delete ProviderSelectionCriteria, ProviderSelectionResult
- Keep IAIProvider, ProviderId, ProviderHealth if used internally
- **Verification**: TypeScript compiles, no broken type references

**Task 2.9**: Remove Provider DI Registration (VS Code)

- Remove ProviderManager registration from `container.ts`
- Remove ProviderOrchestrationService registration
- Remove provider tokens from `vscode-core/src/di/tokens.ts`
- **Verification**: Extension launches without DI errors

**Task 2.10**: Remove Provider Commands (VS Code)

- Remove `ptah.switchProvider`, `ptah.getProviderHealth` from command handlers
- Remove command registrations from `package.json` (if present)
- **Verification**: Extension launches without command errors

**Task 2.11**: Final Cleanup & Verification

- Run full TypeScript typecheck: `npm run typecheck:all`
- Run all tests: `nx run-many --target=test`
- Launch extension in debug mode
- Verify chat works without provider UI
- Verify model selection works independently
- **Verification**: Zero TypeScript errors, all tests pass, extension functional

---

## 🧪 Testing Strategy

### Unit Tests

**Phase 1 - New Components**:

1. **ClaudeModelService** (`claude-model.service.spec.ts`)

   - Test getAvailableModels() returns 3 models
   - Test getCurrentModel() reads from config
   - Test setModel() validates model ID
   - Test setModel() saves to config
   - Test setModel() emits MODEL_CHANGED event
   - Test error handling for invalid model IDs
   - **Coverage Target**: ≥ 80%

2. **ModelSelectorComponent** (`model-selector.component.spec.ts`)

   - Test component renders dropdown
   - Test dropdown displays 3 models
   - Test current model selection displayed
   - Test onModelChange() sends SET_MODEL message
   - Test MODEL_CHANGED event updates UI
   - Test loading state during model change
   - Test error handling (revert selection on failure)
   - **Coverage Target**: ≥ 80%

3. **Message Handlers** (integration with MessageHandlerService tests)
   - Test GET_AVAILABLE_MODELS handler returns models
   - Test GET_CURRENT_MODEL handler returns current selection
   - Test SET_MODEL handler calls ClaudeModelService
   - Test error responses with invalid model IDs
   - **Coverage Target**: ≥ 80%

### Integration Tests

**Phase 1 - Message Flow**:

1. **Frontend → Backend Model Request**

   - Test: Frontend sends GET_AVAILABLE_MODELS
   - Verify: Backend responds with model list
   - Assert: Response contains 3 models with correct structure

2. **Frontend → Backend Model Selection**

   - Test: Frontend sends SET_MODEL with 'opus'
   - Verify: Backend saves to config
   - Verify: Backend emits MODEL_CHANGED event
   - Assert: Frontend receives event and updates UI

3. **Model Persistence**
   - Test: Set model to 'haiku'
   - Reload extension
   - Verify: getCurrentModel() returns 'haiku'
   - Assert: Model preference persists across sessions

### End-to-End Tests

**Phase 1 - Complete Flow**:

1. **Model Selection in Chat UI**

   - Launch extension
   - Open chat view
   - Verify: Model selector visible in header
   - Verify: Current model displayed correctly
   - Action: Change model from 'sonnet' to 'opus'
   - Verify: Dropdown updates immediately
   - Verify: Config saved to workspace
   - Verify: Next CLI spawn uses `--model=opus` flag (check logs)
   - Assert: Model selection works end-to-end

2. **Model Persistence Across Sessions**
   - Set model to 'haiku'
   - Close VS Code
   - Reopen workspace
   - Open chat view
   - Verify: Model selector shows 'haiku'
   - Send message
   - Verify: CLI spawns with `--model=haiku` (check logs)
   - Assert: Model preference persists

### Regression Tests (Phase 2)

**After Provider Removal**:

1. **Chat Functionality Unchanged**

   - Send chat message
   - Verify: Message sent successfully
   - Verify: Assistant response received
   - Verify: No provider-related errors in logs
   - Assert: Chat works without provider abstraction

2. **Extension Launch**

   - Launch extension
   - Check Extension Host console
   - Verify: No provider registration errors
   - Verify: No provider DI errors
   - Verify: No provider message handler errors
   - Assert: Extension launches cleanly

3. **TypeScript Compilation**

   - Run: `npm run typecheck:all`
   - Verify: Zero errors
   - Verify: No references to deleted provider types
   - Assert: Full codebase compiles successfully

4. **Model Selection Still Works**
   - Verify model selector visible
   - Change model selection
   - Send message
   - Verify CLI uses correct model
   - Assert: Model selection unaffected by provider removal

---

## 🚨 Risk Mitigation

### Risk 1: Breaking Model Selection During Removal

**Risk Level**: HIGH

**Description**: If Phase 2 starts before Phase 1 completes, users lose ability to select models.

**Mitigation**:

- **Strategy**: Enforce strict phase ordering (Phase 1 MUST complete first)
- **Verification Gate**: Run E2E test for model selection before starting Phase 2
- **Rollback Plan**: If broken, revert Phase 2 commits, complete Phase 1 first

---

### Risk 2: Type Errors After Provider Type Deletion

**Risk Level**: MEDIUM

**Description**: Deleting provider types may cause TypeScript errors in unexpected files.

**Mitigation**:

- **Strategy**: Progressive deletion with TypeScript validation after each step
- **Verification**: Run `npm run typecheck:all` after each file deletion
- **Search**: Use Grep to find all references before deletion (e.g., `Grep("ProviderService")`)
- **Rollback Plan**: If type errors detected, fix all references before proceeding

---

### Risk 3: Runtime Errors After Provider Service Deletion

**Risk Level**: MEDIUM

**Description**: Extension may fail to launch if provider services are still referenced in DI.

**Mitigation**:

- **Strategy**: Remove DI registrations BEFORE deleting service files
- **Verification**: Launch extension in debug mode after each service deletion
- **Monitoring**: Check Extension Host console for DI resolution errors
- **Rollback Plan**: If runtime errors, restore service temporarily, remove references

---

### Risk 4: Commitlint Hook Failures

**Risk Level**: MEDIUM

**Description**: Commit messages may not follow commitlint rules, blocking commits.

**Mitigation**:

- **Strategy**: Use valid commit message format for every commit
- **Format**: `type(scope): subject` (lowercase, no period, < 100 chars)
- **Valid Types**: feat, fix, refactor, chore, docs
- **Valid Scopes**: webview, vscode, deps
- **Example**: `refactor(vscode): remove provider orchestration service`
- **Verification**: Pre-commit hook validates format automatically

**Commit Hook Failure Protocol**:
If commit hook fails, STOP and present user with 3 options:

1. **Fix Issue** - Fix lint/type/format errors if related to current work
2. **Bypass Hook** - Use `--no-verify` flag (document reason)
3. **Stop & Report** - Mark as blocker, escalate to team

**Example Commits for This Task**:

```bash
# Phase 1 commits
feat(webview): add claude model selector component
feat(vscode): add claude model service backend
refactor(vscode): integrate model selection in chat orchestration

# Phase 2 commits
refactor(webview): remove provider library
refactor(vscode): delete provider orchestration service
refactor(vscode): simplify ai-providers-core library
chore(deps): remove provider message types from shared
```

---

### Risk 5: Incomplete Provider Removal (Hidden References)

**Risk Level**: LOW

**Description**: Some provider references may remain in comments, docs, or unused code.

**Mitigation**:

- **Strategy**: Comprehensive search after removal
- **Searches**:
  - `Grep("provider" in libs/, case-insensitive)`
  - `Grep("PROVIDER_MESSAGE_TYPES")`
  - `Grep("ProviderService")`
  - `Grep("ProviderOrchestrationService")`
- **Verification**: Manual review of search results
- **Cleanup**: Remove/update comments and docs referencing providers

---

## ✅ Success Criteria

### Phase 1 Success Criteria (Model Selection Redesign)

**Functional Verification**:

- ✅ **Criterion 1.1**: Model selector dropdown visible in chat header
- ✅ **Criterion 1.2**: Dropdown displays 3 Claude models (sonnet, opus, haiku)
- ✅ **Criterion 1.3**: User can select model from dropdown
- ✅ **Criterion 1.4**: Selection persists to VS Code workspace config (`claude.model`)
- ✅ **Criterion 1.5**: Current session uses selected model on next message
- ✅ **Criterion 1.6**: CLI process spawned with `--model` flag (verify in logs)
- ✅ **Criterion 1.7**: MODEL_CHANGED event synchronizes UI across webview instances

**Technical Verification**:

- ✅ **Criterion 1.8**: All TypeScript builds pass (`npm run typecheck:all`)
- ✅ **Criterion 1.9**: All new unit tests pass (≥ 80% coverage)
- ✅ **Criterion 1.10**: E2E model selection test passes
- ✅ **Criterion 1.11**: Extension launches without errors
- ✅ **Criterion 1.12**: No provider abstraction involved in model selection

---

### Phase 2 Success Criteria (Provider Abstraction Removal)

**Functional Verification**:

- ✅ **Criterion 2.1**: No provider selection UI visible anywhere in extension
- ✅ **Criterion 2.2**: No provider switching functionality exists
- ✅ **Criterion 2.3**: Chat functionality works (send message, receive response)
- ✅ **Criterion 2.4**: Model selection works independently (from Phase 1)
- ✅ **Criterion 2.5**: Extension launches without provider-related errors

**Technical Verification**:

- ✅ **Criterion 2.6**: All TypeScript builds pass (`npm run typecheck:all`)
- ✅ **Criterion 2.7**: Zero references to PROVIDER_MESSAGE_TYPES
- ✅ **Criterion 2.8**: Zero references to ProviderService
- ✅ **Criterion 2.9**: Zero references to ProviderOrchestrationService
- ✅ **Criterion 2.10**: `libs/frontend/providers/` directory deleted
- ✅ **Criterion 2.11**: ai-providers-core simplified (ClaudeCliAdapter + ContextManager only)
- ✅ **Criterion 2.12**: All regression tests pass

**Code Quality Verification**:

- ✅ **Criterion 2.13**: ~4000 lines of code removed (net reduction)
- ✅ **Criterion 2.14**: No `any` types introduced during refactoring
- ✅ **Criterion 2.15**: All commits follow commitlint rules
- ✅ **Criterion 2.16**: No dead code or unused imports remain

---

## 📊 Complexity & Effort Assessment

**Overall Complexity**: HIGH

**Complexity Breakdown**:

- **Phase 1 (Model Selection)**: MEDIUM

  - New backend service: 2 hours
  - Message protocol: 1 hour
  - Frontend component: 2 hours
  - Integration & testing: 2 hours
  - **Subtotal**: 7 hours

- **Phase 2 (Provider Removal)**: MEDIUM-HIGH
  - Frontend library deletion: 1 hour
  - Backend service deletion: 2 hours
  - Shared types cleanup: 2 hours
  - VS Code integration updates: 1 hour
  - Testing & verification: 3 hours
  - **Subtotal**: 9 hours

**Estimated Total Effort**: 16 hours (2 development days)

**Complexity Factors**:

1. **Cross-cutting Changes**: Affects 4 libraries + 2 apps (high coordination)
2. **Type System Updates**: Message protocol changes require careful type safety
3. **Removal Complexity**: Must remove without breaking existing functionality
4. **Testing Requirements**: Full E2E testing required for both phases
5. **Documentation Updates**: 5 CLAUDE.md files need updates

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **backend-developer** (primary), **frontend-developer** (secondary)

**Rationale**:

**Phase 1 Requires Backend Skills**:

- Reason 1: New backend service (ClaudeModelService) with DI, config, events
- Reason 2: Message handler modifications in backend
- Reason 3: Chat orchestration integration (backend service)
- Reason 4: VS Code API usage (config service, event bus)

**Phase 1 Requires Frontend Skills** (but less critical):

- Reason 5: Angular component (ModelSelectorComponent)
- Reason 6: Signal-based state management
- Reason 7: VS Code message passing (webview side)

**Phase 2 Is Primarily Deletion** (backend-heavy):

- Reason 8: Backend service deletion (ProviderOrchestrationService)
- Reason 9: Backend library simplification (ai-providers-core)
- Reason 10: DI container updates (backend)

**Recommendation**: Assign to **backend-developer** who can handle frontend work, OR pair backend + frontend developers for Phase 1.

---

### Complexity Assessment

**Overall Complexity**: HIGH
**Estimated Effort**: 16 hours (2 development days)

**Breakdown by Phase**:

- **Phase 1** (Model Selection): 7 hours (MEDIUM complexity)
  - Backend work: 5 hours (service + integration)
  - Frontend work: 2 hours (component + UI)
- **Phase 2** (Provider Removal): 9 hours (MEDIUM-HIGH complexity)
  - Deletion work: 6 hours (services + types + library)
  - Verification: 3 hours (testing + cleanup)

**Risk Factors**:

- **High Risk**: Phase ordering (Phase 1 MUST complete first)
- **Medium Risk**: Type errors during deletion
- **Medium Risk**: Runtime errors from DI changes
- **Low Risk**: Commitlint hook failures

---

### Files Affected Summary

**CREATE** (8 files):

- `libs/backend/claude-domain/src/model/claude-model.service.ts`
- `libs/backend/claude-domain/src/model/claude-model.service.spec.ts`
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.ts`
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.html`
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.css`
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.spec.ts`
- `libs/frontend/chat/src/lib/services/model.service.ts`
- `libs/frontend/chat/src/lib/services/model.service.spec.ts`

**MODIFY** (14 files):

- `libs/shared/src/lib/constants/message-types.ts` (add CLAUDE_MESSAGE_TYPES, remove PROVIDER_MESSAGE_TYPES)
- `libs/shared/src/lib/types/message.types.ts` (add Claude payloads, remove provider payloads)
- `libs/shared/src/lib/types/ai-provider.types.ts` (simplify types)
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` (add model handlers, remove provider handlers)
- `libs/backend/claude-domain/src/chat/chat-orchestration.service.ts` (integrate model fetch)
- `libs/backend/claude-domain/src/index.ts` (add model exports, remove provider exports)
- `libs/backend/claude-domain/CLAUDE.md` (update docs)
- `libs/backend/ai-providers-core/src/index.ts` (simplified exports)
- `libs/frontend/chat/src/lib/components/chat/chat.component.ts` (add model selector)
- `libs/frontend/chat/src/lib/components/index.ts` (export model selector)
- `apps/ptah-extension-vscode/src/di/container.ts` (remove provider DI)
- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts` (remove provider commands)
- `apps/ptah-extension-webview/src/app/app.ts` (remove provider imports)
- `tsconfig.base.json` (remove provider path mapping)

**REWRITE** (Direct Replacement):

- None (all changes are additive or deletive)

**DELETE** (21 files):

- `libs/frontend/providers/` (entire library - 11 files)
- `libs/frontend/core/src/lib/services/provider.service.ts`
- `libs/backend/claude-domain/src/provider/provider-orchestration.service.ts`
- `libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.ts`
- `libs/backend/ai-providers-core/src/manager/provider-manager.ts`
- `libs/backend/ai-providers-core/src/manager/provider-state.types.ts`
- `libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.ts`
- `libs/backend/ai-providers-core/src/interfaces/provider-selection.interface.ts`
- Associated test files for deleted services (~3 files)

**Total Impact**:

- **Files Created**: 8
- **Files Modified**: 14
- **Files Deleted**: 21
- **Net Change**: -13 files, ~-4020 lines of code

---

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - ✅ `TOKENS.CONFIG_SERVICE` from `@ptah-extension/vscode-core` (line: `vscode-core/src/di/tokens.ts`)
   - ✅ `TOKENS.EVENT_BUS` from `@ptah-extension/vscode-core` (line: `vscode-core/src/di/tokens.ts`)
   - ✅ `ClaudeCliLauncher.spawnTurn()` accepts `model` option (line: `claude-cli-launcher.ts:46`)
   - ✅ `VSCodeService.sendRequest()` method exists (line: `vscode.service.ts`)

2. **All patterns verified from examples**:

   - ✅ DI pattern: `session-manager.ts:144-166`
   - ✅ Signal pattern: `provider.service.ts:102-119`
   - ✅ Message types pattern: `message-types.ts:18-68`
   - ✅ Standalone component: Angular 20 standard pattern

3. **Library documentation consulted**:

   - ✅ `libs/backend/claude-domain/CLAUDE.md` (CLI integration patterns)
   - ✅ `libs/frontend/core/CLAUDE.md` (Signal-based state patterns)
   - ✅ `libs/shared/CLAUDE.md` (Message protocol patterns)

4. **No hallucinated APIs**:
   - ✅ All decorators verified: `@injectable()` (tsyringe), `@inject()` (tsyringe)
   - ✅ All base classes verified: No inheritance required
   - ✅ All message types verified: New types follow existing pattern
   - ✅ CLI flag verified: `--model` flag at `claude-cli-launcher.ts:191`

---

### Architecture Delivery Checklist

- ✅ All components specified with evidence
- ✅ All patterns verified from codebase
- ✅ All imports/decorators verified as existing
- ✅ Quality requirements defined
- ✅ Integration points documented
- ✅ Files affected list complete
- ✅ Developer type recommended (backend-developer primary)
- ✅ Complexity assessed (HIGH - 16 hours)
- ✅ No step-by-step implementation (that's team-leader's job)
- ✅ Phase ordering enforced (Phase 1 BEFORE Phase 2)
- ✅ Risk mitigation strategies defined
- ✅ Success criteria clearly defined
- ✅ Testing strategy comprehensive

---

## 📋 Final Notes for Team-Leader

### Phase Ordering is CRITICAL

**ABSOLUTE REQUIREMENT**: Phase 1 MUST complete and be verified BEFORE Phase 2 starts.

**Why**: Phase 2 deletes all provider abstraction. If model selection isn't working first, users lose the ability to select models entirely.

**Enforcement**: After Phase 1, run E2E test to verify model selection works. If test fails, DO NOT proceed to Phase 2.

---

### Commit Strategy

**Phase 1** (6-8 commits):

- Commit after each component completion
- Example: `feat(vscode): add claude model service backend`
- Run tests after each commit

**Phase 2** (8-10 commits):

- Commit after each deletion/modification
- Example: `refactor(webview): remove provider library`
- Run TypeScript typecheck after each commit

**Total Expected Commits**: 14-18 commits

---

### Git Compliance Reminder

All commits MUST follow commitlint rules:

- **Format**: `type(scope): subject`
- **Valid Types**: feat, fix, refactor, chore, docs
- **Valid Scopes**: webview, vscode, deps
- **Subject**: lowercase, 3-72 chars, no period

**Pre-commit hook** will validate automatically.

---

### Documentation Updates Required

After implementation, update these files:

1. `libs/backend/claude-domain/CLAUDE.md` - Document ClaudeModelService
2. `libs/frontend/chat/CLAUDE.md` - Document ModelSelectorComponent
3. `libs/shared/CLAUDE.md` - Document CLAUDE_MESSAGE_TYPES
4. `libs/backend/ai-providers-core/CLAUDE.md` - Document simplified exports
5. `libs/frontend/core/CLAUDE.md` - Remove ProviderService section

---

## 🎯 READY FOR TEAM-LEADER DECOMPOSITION

This implementation plan provides complete architectural specifications with:

- ✅ **WHAT to build**: Component specifications with interfaces and patterns
- ✅ **WHY these patterns**: Evidence citations from codebase
- ✅ **WHERE to implement**: Exact file paths with create/modify/delete markers
- ✅ **HOW LONG**: Complexity assessment and effort estimation
- ✅ **WHO should build**: Developer type recommendation with rationale

Team-leader can now decompose this into atomic, git-verifiable tasks for backend-developer and frontend-developer execution.
