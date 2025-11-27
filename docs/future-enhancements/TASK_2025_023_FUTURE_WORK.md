# Future Enhancements - TASK_2025_023 Post-Implementation

**Created**: 2025-11-25
**Related Task**: TASK_2025_023 (Revolutionary ExecutionNode Architecture)
**Previous Task Reference**: TASK_2025_019 (Complete Autocomplete System)

---

## Executive Summary

This document captures all pending enhancements, documented stubs, and integration work discovered during the TASK_2025_023 implementation. The core ExecutionNode architecture is complete and functional, but several auxiliary features require implementation to achieve full Claude CLI parity.

---

## Category 1: AST Analysis (Phase 2 Stubs)

### Current State

The AST analysis system is implemented as a documented Phase 2 stub that returns empty insights.

### Files Affected

| File                                                                              | Status   | Purpose                          |
| --------------------------------------------------------------------------------- | -------- | -------------------------------- |
| `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.ts`             | Stub     | AST parsing service              |
| `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts` | Partial  | Workspace analysis orchestration |
| `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts`               | Disabled | Tree-sitter query definitions    |

### Implementation Requirements

```typescript
// Current stub in ast-analysis.service.ts
async analyzeAst(filePath: string): Promise<AstInsights> {
  this.logger.warn(`AstAnalysisService.analyzeAst() - Phase 2 stub: Returning empty insights for ${filePath}`);
  return {
    classes: [],
    functions: [],
    imports: [],
    exports: [],
  };
}
```

### Proposed Enhancement

1. **Tree-Sitter Integration**

   - Re-enable JavaScript/TypeScript queries in `tree-sitter.config.ts`
   - Add queries for: functions, classes, interfaces, imports, exports
   - Handle complex TypeScript patterns (generics, decorators)

2. **Language Support Matrix**

   - TypeScript/JavaScript (priority)
   - Python
   - Go
   - Rust
   - Java

3. **Use Cases**
   - Symbol extraction for autocomplete
   - Code navigation
   - Refactoring support
   - Dependency analysis

### Priority: Medium

### Estimated Effort: 2-3 days

---

## Category 2: Model Selector & Autopilot Integration

### Current State

The ChatInputComponent has UI for model selection and autopilot toggle, but these are not wired to the backend.

### Files Affected

| File                                                                      | Lines   | Issue                 |
| ------------------------------------------------------------------------- | ------- | --------------------- |
| `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts` | 230-233 | Model selector TODO   |
| `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts` | 238-241 | Autopilot toggle TODO |

### Current Code

```typescript
// Line 230-233
selectModel(model: string): void {
  this._selectedModel.set(model);
  // TODO: Integrate with backend model selection when implemented
}

// Line 238-241
toggleAutopilot(): void {
  this._autopilotEnabled.update((enabled) => !enabled);
  // TODO: Integrate with backend autopilot feature when implemented
}
```

### Implementation Design

#### Model Selector Integration

**Problem**: Model selection can occur in two contexts:

1. **Command Mode**: Direct model switch via `/model opus` command
2. **Chat Mode**: Per-message model selection during conversation

**Proposed Architecture**:

```
┌──────────────────────────────────────────────────────────────────┐
│                        Model Selection Flow                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐     ┌──────────────────┐                   │
│  │  ChatInputUI    │     │  /model Command   │                   │
│  │  (Dropdown)     │     │  (Slash Command)  │                   │
│  └────────┬────────┘     └────────┬─────────┘                   │
│           │                       │                              │
│           └───────────┬───────────┘                              │
│                       ▼                                          │
│           ┌───────────────────────┐                              │
│           │   ModelStateService    │  (New Angular Service)      │
│           │   - currentModel       │                              │
│           │   - availableModels    │                              │
│           │   - switchModel()      │                              │
│           └───────────┬───────────┘                              │
│                       │                                          │
│                       ▼                                          │
│           ┌───────────────────────┐                              │
│           │   RPC: model:switch    │                              │
│           └───────────┬───────────┘                              │
│                       │                                          │
│                       ▼                                          │
│           ┌───────────────────────┐                              │
│           │   ClaudeProcess       │  (--model flag)              │
│           └───────────────────────┘                              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**New Files Required**:

1. `libs/frontend/core/src/lib/services/model-state.service.ts`

   ```typescript
   @Injectable({ providedIn: 'root' })
   export class ModelStateService {
     private readonly _currentModel = signal<ClaudeModel>('sonnet');
     private readonly _availableModels = signal<ClaudeModel[]>(['opus', 'sonnet', 'haiku']);

     readonly currentModel = this._currentModel.asReadonly();
     readonly availableModels = this._availableModels.asReadonly();

     async switchModel(model: ClaudeModel): Promise<void> {
       // Call RPC: model:switch
       // Update state on success
     }
   }
   ```

2. Backend RPC handler in `rpc-method-registration.service.ts`:
   ```typescript
   this.rpcHandler.registerMethod('model:switch', async (params: { model: string }) => {
     // Validate model name
     // Store in workspace configuration
     // Return success/failure
   });
   ```

**Integration Points**:

- `ChatInputComponent.selectModel()` → `ModelStateService.switchModel()`
- `ChatStore.sendMessage()` → Pass model from `ModelStateService.currentModel()`
- `ClaudeProcess.start()` → Use `--model` flag when model !== 'sonnet'

#### Autopilot Integration

**Problem**: Autopilot mode enables Claude to make decisions without explicit user confirmation for certain actions (file writes, command execution).

**Proposed Architecture**:

```
┌──────────────────────────────────────────────────────────────────┐
│                        Autopilot Flow                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐                                            │
│  │  ChatInputUI    │                                            │
│  │  (Toggle)       │                                            │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────────────┐                                    │
│  │  AutopilotStateService   │  (New Angular Service)            │
│  │  - enabled               │                                    │
│  │  - permissionLevel       │  ('ask', 'auto-edit', 'yolo')     │
│  │  - toggleAutopilot()     │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │  RPC: autopilot:toggle   │                                    │
│  └───────────┬─────────────┘                                    │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────┐                                    │
│  │  ClaudeProcess           │  (--dangerously-skip-permissions) │
│  └─────────────────────────┘                                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Permission Levels**:

| Level       | Description                 | CLI Flag                         |
| ----------- | --------------------------- | -------------------------------- |
| `ask`       | Always ask for confirmation | (default)                        |
| `auto-edit` | Auto-approve file edits     | `--allowedTools Edit,Write`      |
| `yolo`      | Full autopilot mode         | `--dangerously-skip-permissions` |

**New Files Required**:

1. `libs/frontend/core/src/lib/services/autopilot-state.service.ts`
2. Backend RPC handler for permission mode

### Priority: High (Core UX Feature)

### Estimated Effort: 2-3 days

---

## Category 3: Autocomplete System Re-Integration

### Current State

TASK_2025_019 implemented a complete autocomplete system that was partially broken during the TASK_2025_023 purge. The components and services exist but are not wired to the new ChatInputComponent.

### Discovery Status

| Component                             | Exists | Wired to UI              |
| ------------------------------------- | ------ | ------------------------ |
| `AgentDiscoveryService` (backend)     | ✅     | N/A                      |
| `MCPDiscoveryService` (backend)       | ✅     | N/A                      |
| `CommandDiscoveryService` (backend)   | ✅     | N/A                      |
| `AgentDiscoveryFacade` (frontend)     | ✅     | ❌                       |
| `MCPDiscoveryFacade` (frontend)       | ✅     | ❌                       |
| `CommandDiscoveryFacade` (frontend)   | ✅     | ❌                       |
| `UnifiedSuggestionsDropdownComponent` | ✅     | ❌                       |
| `FileSuggestionsDropdownComponent`    | ✅     | ❌                       |
| `FileTagComponent`                    | ✅     | ❌                       |
| `ChatInputComponent` (new)            | ✅     | Missing @ and / handlers |

### Required Re-Integration

The new `ChatInputComponent` from TASK_2025_023 needs to integrate with the autocomplete system from TASK_2025_019.

**Changes Required to ChatInputComponent**:

```typescript
// Add to imports
import {
  AgentDiscoveryFacade,
  MCPDiscoveryFacade,
  CommandDiscoveryFacade
} from '@ptah-extension/core';
import { FilePickerService } from '../../services/file-picker.service';
import { UnifiedSuggestionsDropdownComponent, SuggestionItem } from '../unified-suggestions-dropdown';

// Add to component
readonly agentDiscovery = inject(AgentDiscoveryFacade);
readonly mcpDiscovery = inject(MCPDiscoveryFacade);
readonly commandDiscovery = inject(CommandDiscoveryFacade);
readonly filePicker = inject(FilePickerService);

// Add signals
private readonly _showSuggestions = signal(false);
private readonly _suggestionType = signal<'file' | 'agent' | 'mcp' | 'command' | null>(null);
private readonly _suggestions = signal<SuggestionItem[]>([]);

// Add handlers
private handleAtSymbolInput(textarea: HTMLTextAreaElement): void { ... }
private handleSlashTrigger(textarea: HTMLTextAreaElement): void { ... }
```

### DaisyUI Modernization for Autocomplete Components

The preserved components (`FileTagComponent`, `FileSuggestionsDropdownComponent`, `UnifiedSuggestionsDropdownComponent`) currently use custom VS Code-style CSS. They should be modernized to use DaisyUI components.

#### FileTagComponent → DaisyUI Card + Badge

**Current**: Custom `.vscode-file-tag` classes

**Proposed DaisyUI Implementation**:

```html
<div class="card card-compact bg-base-200 shadow-sm">
  <div class="card-body p-2 flex-row items-center gap-2">
    <!-- File Icon -->
    <span class="text-lg">{{ getFileIcon() }}</span>

    <!-- File Info -->
    <div class="flex-1 min-w-0">
      <div class="font-medium truncate">{{ file().name }}</div>
      @if (showMetadata()) {
      <div class="flex gap-2 text-xs opacity-70">
        <span>{{ formatSize(file().size) }}</span>
        @if (file().tokenEstimate > 0) {
        <span class="badge badge-info badge-xs">{{ formatTokens(file().tokenEstimate) }} tokens</span>
        } @if (file().isLarge) {
        <span class="badge badge-warning badge-xs">Large</span>
        }
      </div>
      }
    </div>

    <!-- Expand Toggle (Collapse) -->
    @if (hasPreview()) {
    <div class="collapse collapse-arrow bg-base-100">
      <input type="checkbox" [checked]="isExpanded()" (change)="toggleExpanded()" />
      <div class="collapse-title p-0 min-h-0">▶</div>
      <div class="collapse-content">
        @if (file().type === 'image') {
        <img [src]="file().preview" class="max-w-full rounded" />
        } @else {
        <pre class="text-xs overflow-auto max-h-24">{{ file().preview }}</pre>
        }
      </div>
    </div>
    }

    <!-- Remove Button -->
    <button class="btn btn-circle btn-ghost btn-xs" (click)="removeFile.emit()">✕</button>
  </div>
</div>
```

#### FileSuggestionsDropdownComponent → DaisyUI Menu + List

**Current**: Custom `.vscode-file-dropdown` classes

**Proposed DaisyUI Implementation**:

```html
<div class="dropdown dropdown-open dropdown-top">
  <ul class="dropdown-content menu bg-base-200 rounded-box w-80 max-h-64 overflow-y-auto shadow-lg">
    @if (isLoading()) {
    <li class="disabled">
      <span class="loading loading-spinner loading-sm"></span>
      <span>Loading workspace files...</span>
    </li>
    } @else if (filteredSuggestions().length === 0) {
    <li class="disabled">
      <span>No files found</span>
    </li>
    } @else { @for (suggestion of filteredSuggestions(); track suggestion.path; let i = $index) {
    <li>
      <a [class.active]="i === focusedIndex()" (click)="selectSuggestion(suggestion)" (mouseenter)="setFocusedIndex(i)">
        <span class="text-lg">{{ getFileIcon(suggestion) }}</span>
        <div class="flex flex-col">
          <span class="font-medium">{{ suggestion.name }}</span>
          <span class="text-xs opacity-70">{{ suggestion.directory }}</span>
        </div>
        @if (suggestion.size) {
        <span class="badge badge-ghost badge-sm">{{ formatFileSize(suggestion.size) }}</span>
        }
      </a>
    </li>
    } }
  </ul>
</div>
```

#### UnifiedSuggestionsDropdownComponent → DaisyUI Menu with Tabs

**Current**: Custom `.vscode-unified-dropdown` classes

**Proposed DaisyUI Implementation** (Command Palette Style):

```html
<div class="card bg-base-200 shadow-xl w-96 max-h-96">
  <!-- Search/Filter Header -->
  <div class="card-body p-0">
    <!-- Type Tabs -->
    <div role="tablist" class="tabs tabs-boxed tabs-sm p-2">
      <button role="tab" class="tab" [class.tab-active]="activeType() === 'all'">All</button>
      <button role="tab" class="tab" [class.tab-active]="activeType() === 'file'">📄 Files</button>
      <button role="tab" class="tab" [class.tab-active]="activeType() === 'agent'">🤖 Agents</button>
      <button role="tab" class="tab" [class.tab-active]="activeType() === 'mcp'">🔌 MCP</button>
      <button role="tab" class="tab" [class.tab-active]="activeType() === 'command'">⚡ Commands</button>
    </div>

    <!-- Suggestions List -->
    <ul class="menu p-2 max-h-64 overflow-y-auto">
      @if (isLoading()) {
      <li class="disabled">
        <span>
          <span class="loading loading-dots loading-sm"></span>
          Loading suggestions...
        </span>
      </li>
      } @else if (suggestions().length === 0) {
      <li class="disabled"><span>No suggestions found</span></li>
      } @else { @for (item of suggestions(); track trackBy($index, item); let i = $index) {
      <li>
        <a [class.active]="i === focusedIndex()" (click)="selectSuggestion(item)" (mouseenter)="setFocusedIndex(i)">
          <span class="text-xl">{{ getIcon(item) }}</span>
          <div class="flex flex-col flex-1">
            <span class="font-medium">{{ getName(item) }}</span>
            <span class="text-xs opacity-70 truncate">{{ getDescription(item) }}</span>
          </div>
          <kbd class="kbd kbd-xs">{{ getShortcut(item) }}</kbd>
        </a>
      </li>
      } }
    </ul>

    <!-- Footer with Keyboard Hints -->
    <div class="divider m-0"></div>
    <div class="flex gap-4 p-2 text-xs opacity-70 justify-center">
      <span><kbd class="kbd kbd-xs">↑↓</kbd> Navigate</span>
      <span><kbd class="kbd kbd-xs">Enter</kbd> Select</span>
      <span><kbd class="kbd kbd-xs">Esc</kbd> Close</span>
    </div>
  </div>
</div>
```

### Priority: High (Core UX Feature)

### Estimated Effort: 3-4 days

---

## Category 4: Analytics Backend Integration

### Current State

The `AnalyticsService` has a feature flag disabled (`ANALYTICS_ENABLED = false`) and uses fallback mock data.

### Files Affected

| File                                                       | Status             |
| ---------------------------------------------------------- | ------------------ |
| `libs/frontend/core/src/lib/services/analytics.service.ts` | Mock data fallback |

### Current Code

```typescript
// Feature flag: Disable analytics during development
private readonly ANALYTICS_ENABLED = false; // Set to true for production

// Fallback to mock data when backend unavailable
return this.generateFallbackData();
```

### Implementation Requirements

1. Create backend RPC handlers for analytics:

   - `analytics:getPerformance` - Real-time metrics
   - `analytics:getUsage` - Usage statistics
   - `analytics:trackEvent` - Event tracking

2. Wire `AnalyticsService` to RPC when `ANALYTICS_ENABLED = true`

### Priority: Low

### Estimated Effort: 1-2 days

---

## Category 5: Security Improvements

### Path Traversal Validation

**Issue**: `session:load` RPC handler doesn't validate sessionId format.

**Current Code** (rpc-method-registration.service.ts):

```typescript
this.rpcHandler.registerMethod('session:load', async (params: any) => {
  const { sessionId, workspacePath } = params;
  // No validation of sessionId format
  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
});
```

**Fix Required**:

```typescript
this.rpcHandler.registerMethod('session:load', async (params: any) => {
  const { sessionId, workspacePath } = params;

  // Validate sessionId format (alphanumeric + hyphens only)
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error('Invalid session ID format');
  }

  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
});
```

### Priority: Medium (Security)

### Estimated Effort: 1 hour

---

## Implementation Order Recommendation

| Phase | Enhancement                         | Priority | Effort   |
| ----- | ----------------------------------- | -------- | -------- |
| 1     | Security: Path Traversal Validation | Medium   | 1 hour   |
| 2     | Autocomplete Re-Integration         | High     | 3-4 days |
| 3     | Model Selector & Autopilot          | High     | 2-3 days |
| 4     | DaisyUI Component Modernization     | Medium   | 2 days   |
| 5     | AST Analysis Implementation         | Medium   | 2-3 days |
| 6     | Analytics Backend Integration       | Low      | 1-2 days |

**Total Estimated Effort**: 10-15 days

---

## Testing Requirements

Each enhancement should include:

1. **Unit Tests**: Jest tests for new services/methods
2. **Integration Tests**: RPC handler tests
3. **Component Tests**: Angular component testing
4. **Manual Testing**: End-to-end validation in VS Code

---

## Related Documentation

- TASK_2025_019 Context: `task-tracking/TASK_2025_019/context.md`
- TASK_2025_019 Tasks: `task-tracking/TASK_2025_019/tasks.md`
- TASK_2025_023 Implementation Plan: `task-tracking/TASK_2025_023/implementation-plan.md`
- DaisyUI 5 Documentation: https://daisyui.com

---

**Document Version**: 1.0
**Created**: 2025-11-25
**Author**: Code Analysis Agent
