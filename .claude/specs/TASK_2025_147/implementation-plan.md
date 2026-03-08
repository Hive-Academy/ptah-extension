# Implementation Plan - TASK_2025_147

## Setup Wizard UI Enhancement: Markdown Rendering, Stats Dashboard, and DaisyUI Polish

---

## Codebase Investigation Summary

### Libraries Discovered

- **ngx-markdown 21.0**: Already installed and configured at app level via `provideMarkdown()` in `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts:62`. The chat library uses `MarkdownModule` imported per-component (verified in `markdown-block.component.ts:2,15`).
- **lucide-angular 0.542**: Already imported in all wizard components. Available icons verified: `Terminal`, `Brain`, `AlertTriangle`, `Code`, `Info`, `ChevronDown`, `ChevronUp`, `Search`, `Building2`, `HeartPulse`, `ShieldCheck`, `Bot`, `XCircle`, `CheckCircle`, `Loader2`, `Clock`, `BarChart3`, `Hash`, `Zap`, `Activity`, `Sparkles`.
- **DaisyUI 4.12**: Configured via Tailwind in the webview app. Available component classes: `hero`, `card`, `card-body`, `btn`, `badge`, `stat`, `steps`, `progress`, `skeleton`, `alert`, `collapse`, `shadow-*`, `animate-*`.
- **PrismJS**: Configured for syntax highlighting via ngx-markdown. Used by the chat library's markdown rendering.

### Patterns Identified

- **Standalone Components with OnPush**: Every component in the wizard library uses `standalone: true` and `ChangeDetectionStrategy.OnPush`. Evidence: all 7 wizard components.
- **Signal-Based State**: All reactive state uses Angular signals. `SetupWizardStateService` exposes public readonly signals from private writable signals. Evidence: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts:190-384`.
- **MarkdownModule per-component import**: The chat library imports `MarkdownModule` directly in each component's `imports` array (not via shared module). Evidence: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\markdown-block.component.ts:2,15` and `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-input-display.component.ts:7,34`.
- **Prose styling for markdown**: Chat library uses `prose prose-sm prose-invert max-w-none` for markdown rendering. Evidence: `markdown-block.component.ts:19`.
- **Language detection map**: Chat library has a `languageMap` record mapping file extensions to language identifiers. Evidence: `tool-input-display.component.ts:120-141`.
- **Computed signals for derived state**: Metrics and counts are derived via `computed()` from state service signals. Evidence: `setup-wizard-state.service.ts:409-538`.
- **GroupedMessage interface**: Analysis transcript already has grouping logic with `toolCallId` correlation field. Evidence: `analysis-transcript.component.ts:29-42,261-307`.

### Integration Points

- **AnalysisStreamPayload**: Defined in `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts:742-762`. Has `kind` discriminator with 7 values: `text`, `tool_start`, `tool_input`, `tool_result`, `thinking`, `error`, `status`.
- **SetupWizardStateService signals**: `analysisStream()` returns `AnalysisStreamPayload[]`, `scanProgress()` returns `ScanProgress | null`, `deepAnalysis()` returns `ProjectAnalysisResult | null`. Evidence: `setup-wizard-state.service.ts:317-346`.
- **ScanProgressComponent template integration**: Dashboard inserts between phase stepper (line 105) and transcript section (line 149). Evidence: `scan-progress.component.ts:70-237`.

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Fix-then-enhance strategy. Phase 1 fixes broken rendering by adopting proven chat library patterns directly into the wizard. Phase 2 adds new computed-signal-derived dashboard. Phase 3 polishes existing components with DaisyUI utilities.

**Rationale**: The chat library has battle-tested markdown rendering with `MarkdownModule` + prose styling + language detection. Rather than re-inventing or importing chat components (which would violate cross-library boundaries), we extract the same patterns into the wizard library's own components.

**Evidence**: Chat library's `MarkdownBlockComponent` (26 lines) demonstrates the minimal pattern. `ToolInputDisplayComponent` demonstrates language detection. Both are verified working in production.

---

## Phase 1: Fix Markdown Rendering in Analysis Transcript

### Component 1.1: AnalysisTranscriptComponent - Markdown Integration

**Purpose**: Replace raw text rendering with ngx-markdown for all text messages, tool inputs, and tool results.

**Pattern**: Per-component `MarkdownModule` import, matching chat library's `MarkdownBlockComponent`.
**Evidence**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\markdown-block.component.ts:2,15,17-20`

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts` (REWRITE)

#### 1.1.1 Import Changes

**Current imports (line 69)**:

```typescript
imports: [LucideAngularModule],
```

**New imports**:

```typescript
imports: [LucideAngularModule, MarkdownModule],
```

**New import statement at top of file**:

```typescript
import { MarkdownModule } from 'ngx-markdown';
```

**Evidence**: This matches the exact pattern from `markdown-block.component.ts:2` and `tool-input-display.component.ts:7`.

#### 1.1.2 Text Message Rendering (Requirement 1.1)

**Current template (lines 109-115)**:

```html
<div class="bg-base-100 rounded-md px-3 py-2">
  <p class="text-sm font-mono whitespace-pre-wrap break-words text-base-content/80">{{ item.content }}</p>
</div>
```

**New template**:

```html
<div class="bg-base-100 rounded-md px-3 py-2">
  <markdown
    [data]="item.content"
    class="prose prose-sm prose-invert max-w-none
           [&_pre]:my-1 [&_pre]:text-xs [&_code]:text-xs
           [&_p]:my-1 [&_p]:text-sm [&_p]:text-base-content/80
           [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm
           [&_ul]:my-1 [&_ol]:my-1 [&_li]:text-sm"
  />
</div>
```

**Rationale**: The `prose prose-sm prose-invert max-w-none` classes match the chat library's `MarkdownBlockComponent` exactly (evidence: `markdown-block.component.ts:19`). Additional bracket-notation overrides ensure code blocks and paragraphs fit the compact transcript layout.

#### 1.1.3 Tool Input Rendering with Language Detection (Requirement 1.2)

**New method - `getFormattedToolInput()`**:

````typescript
/**
 * Format tool input as markdown with language detection.
 * Pattern source: tool-input-display.component.ts:217-240
 */
protected getFormattedToolInput(item: GroupedMessage): string {
  const content = this.getToolInputContent(item);

  // Try to parse as JSON to detect file paths for language detection
  try {
    const parsed = JSON.parse(item.content);
    if (parsed && typeof parsed === 'object') {
      // Check for file_path parameter to detect language
      const filePath = parsed.file_path || parsed.path || '';
      if (filePath) {
        const language = this.getLanguageFromPath(filePath);
        if (language !== 'text') {
          // If there's a content/command field, wrap it with detected language
          const codeContent = parsed.content || parsed.command || parsed.pattern || '';
          if (codeContent) {
            return '```' + language + '\n' + codeContent + '\n```';
          }
        }
      }
      // Default: format entire JSON with syntax highlighting
      return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
    }
  } catch {
    // Not JSON, try to detect language from content
  }

  // Fallback: wrap in generic code block
  return '```\n' + content + '\n```';
}
````

**New property - `languageMap`** (extracted from `tool-input-display.component.ts:120-141`):

```typescript
private readonly languageMap: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.md': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
};
```

**New method - `getLanguageFromPath()`** (extracted from `tool-input-display.component.ts:262-266`):

```typescript
private getLanguageFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const ext = '.' + normalized.split('.').pop()?.toLowerCase();
  return this.languageMap[ext] || 'text';
}
```

**Updated tool_input template**:

```html
@case ('tool_input') {
<div class="bg-base-100 rounded-md overflow-hidden">
  <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-base-content/60 hover:bg-base-200 transition-colors" (click)="toggleToolInput(item.timestamp)" [attr.aria-expanded]="isToolInputExpanded(item.timestamp)">
    <lucide-angular [img]="CodeIcon" class="w-3 h-3 shrink-0" aria-hidden="true" />
    <span>{{ item.toolName || 'Input' }}</span>
    <lucide-angular [img]="isToolInputExpanded(item.timestamp) ? ChevronUpIcon : ChevronDownIcon" class="w-3 h-3 ml-auto" aria-hidden="true" />
  </button>
  @if (isToolInputExpanded(item.timestamp)) {
  <div class="px-3 pb-2 max-h-40 overflow-y-auto">
    <markdown
      [data]="getFormattedToolInput(item)"
      class="prose prose-xs prose-invert max-w-none
             [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px]
             [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-[10px]"
    />
    @if (item.content.length > 500) {
    <button type="button" class="text-xs text-primary hover:text-primary-focus mt-1" (click)="toggleFullToolInput(item.timestamp)">{{ isFullToolInputShown(item.timestamp) ? 'Show less' : 'Show more' }}</button>
    }
  </div>
  }
</div>
}
```

**Evidence**: The `prose prose-xs prose-invert max-w-none` with bracket overrides matches the pattern from `tool-input-display.component.ts:61` in the chat library.

#### 1.1.4 Tool Result Rendering (Requirement 1.3)

**New method - `getFormattedToolResult()`**:

````typescript
/**
 * Format tool result content as markdown.
 * Handles both error and success results.
 */
protected getFormattedToolResult(item: GroupedMessage): string {
  const content = item.content;
  if (!content) return '_No output_';

  // If content looks like code/file content, wrap in code block
  if (content.includes('\n') && (content.includes('{') || content.includes('import '))) {
    return '```\n' + content + '\n```';
  }

  // Otherwise render as markdown (may contain formatted text)
  return content;
}
````

**Updated tool_result template**:

```html
@case ('tool_result') {
<div class="rounded-md overflow-hidden" [class.border-error/20]="item.isError" [class.border-l-2]="item.isError">
  <div class="flex items-center gap-2 px-3 py-1.5">
    <lucide-angular
      [img]="item.isError ? AlertTriangleIcon : CheckCircleIcon"
      class="w-3.5 h-3.5 shrink-0"
      [class.text-error]="item.isError"
      [class.text-success]="!item.isError"
      aria-hidden="true"
    />
    <span class="text-xs font-medium" [class.text-error]="item.isError">
      {{ item.toolName || 'Result' }}
    </span>
    <span class="badge badge-xs" [class.badge-error]="item.isError" [class.badge-success]="!item.isError">
      {{ item.isError ? 'error' : 'success' }}
    </span>
  </div>
  @if (item.content) {
  <div class="px-3 pb-2 max-h-32 overflow-y-auto">
    <markdown
      [data]="getFormattedToolResult(item)"
      class="prose prose-xs prose-invert max-w-none
             [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px]
             [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-xs"
    />
  </div>
  }
</div>
}
```

**New icon import needed**:

```typescript
import {
  AlertTriangle,
  Brain,
  CheckCircle, // NEW
  ChevronDown,
  ChevronUp,
  Code,
  Info,
  LucideAngularModule,
  Terminal,
} from 'lucide-angular';
```

**New icon property**:

```typescript
protected readonly CheckCircleIcon = CheckCircle;
```

#### 1.1.5 Collapsible Tool Call Groups (Requirement 1.4)

**New interface - `ToolCallGroup`**:

```typescript
/**
 * Groups tool_start + tool_input + tool_result into a single collapsible unit.
 * Identified by shared toolCallId.
 */
interface ToolCallGroup {
  kind: 'tool_group';
  toolCallId: string;
  toolName: string;
  messages: GroupedMessage[];
  isComplete: boolean;
  isError: boolean;
  timestamp: number;
}

/**
 * Union type for displayable items in the transcript.
 */
type TranscriptItem = GroupedMessage | ToolCallGroup;
```

**Enhanced `groupedMessages` computed signal** (replaces current implementation at lines 261-307):

```typescript
/**
 * Processed transcript items with text merging and tool call grouping.
 * - Consecutive text messages are merged
 * - Tool messages with same toolCallId are grouped into ToolCallGroup
 */
protected readonly transcriptItems = computed<TranscriptItem[]>(() => {
  const raw = this.wizardState.analysisStream();
  if (raw.length === 0) return [];

  // Step 1: Merge consecutive text messages (existing logic)
  const grouped: GroupedMessage[] = [];
  let currentTextGroup: GroupedMessage | null = null;

  for (const msg of raw) {
    if (msg.kind === 'text') {
      if (currentTextGroup !== null) {
        const merged: GroupedMessage = {
          ...currentTextGroup,
          content: currentTextGroup.content + msg.content,
        };
        currentTextGroup = merged;
        grouped[grouped.length - 1] = merged;
      } else {
        currentTextGroup = {
          kind: 'text',
          content: msg.content,
          timestamp: msg.timestamp,
        };
        grouped.push(currentTextGroup);
      }
    } else {
      currentTextGroup = null;
      grouped.push({
        kind: msg.kind,
        content: msg.content,
        toolName: msg.toolName,
        toolCallId: msg.toolCallId,
        isError: msg.isError,
        timestamp: msg.timestamp,
      });
    }
  }

  // Step 2: Group tool messages by toolCallId into ToolCallGroups
  const items: TranscriptItem[] = [];
  const toolGroupMap = new Map<string, ToolCallGroup>();

  for (const msg of grouped) {
    if (msg.toolCallId && (msg.kind === 'tool_start' || msg.kind === 'tool_input' || msg.kind === 'tool_result')) {
      let group = toolGroupMap.get(msg.toolCallId);
      if (!group) {
        group = {
          kind: 'tool_group',
          toolCallId: msg.toolCallId,
          toolName: msg.toolName || 'tool',
          messages: [],
          isComplete: false,
          isError: false,
          timestamp: msg.timestamp,
        };
        toolGroupMap.set(msg.toolCallId, group);
        items.push(group);
      }
      group.messages.push(msg);
      if (msg.kind === 'tool_result') {
        group.isComplete = true;
        group.isError = !!msg.isError;
      }
      if (msg.toolName) {
        group.toolName = msg.toolName;
      }
    } else {
      items.push(msg);
    }
  }

  return items;
});
```

**New signal for collapsed tool groups**:

```typescript
/** Track which tool groups are collapsed (by toolCallId) */
private readonly collapsedToolGroups = signal<Set<string>>(new Set());

/** Toggle a tool group's collapsed state */
protected toggleToolGroup(toolCallId: string): void {
  this.collapsedToolGroups.update((set) => {
    const newSet = new Set(set);
    if (newSet.has(toolCallId)) {
      newSet.delete(toolCallId);
    } else {
      newSet.add(toolCallId);
    }
    return newSet;
  });
}

/** Check if a tool group is collapsed. Completed groups default to collapsed. */
protected isToolGroupCollapsed(group: ToolCallGroup): boolean {
  // If user has explicitly toggled, use that state
  if (this.collapsedToolGroups().has(group.toolCallId)) {
    return !group.isComplete; // Toggled: invert default
  }
  // Default: completed = collapsed, in-progress = expanded
  return group.isComplete;
}
```

**Type guard helper for template**:

```typescript
/** Type guard to check if a transcript item is a ToolCallGroup */
protected isToolGroup(item: TranscriptItem): item is ToolCallGroup {
  return 'kind' in item && item.kind === 'tool_group';
}
```

**New template section for tool groups** (replaces individual tool_start/tool_input/tool_result cases):

The template `@for` loop changes from iterating `groupedMessages()` to `transcriptItems()`, and the `@switch` block gains a new `tool_group` path:

```html
@for (item of transcriptItems(); track $index) {
  @if (isToolGroup(item)) {
    <!-- Tool Call Group (collapsible) -->
    <div class="bg-base-200/30 rounded border border-base-300/50 my-1">
      <!-- Group Header -->
      <button
        type="button"
        class="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-base-300/30 transition-colors text-xs"
        (click)="toggleToolGroup(item.toolCallId)"
        [attr.aria-expanded]="!isToolGroupCollapsed(item)"
      >
        <lucide-angular
          [img]="ChevronDownIcon"
          class="w-3 h-3 shrink-0 text-base-content/50 transition-transform"
          [class.-rotate-90]="isToolGroupCollapsed(item)"
          aria-hidden="true"
        />
        <lucide-angular
          [img]="TerminalIcon"
          class="w-3 h-3 shrink-0"
          [class.text-info]="!item.isComplete"
          [class.text-success]="item.isComplete && !item.isError"
          [class.text-error]="item.isError"
          aria-hidden="true"
        />
        <span class="font-medium">{{ item.toolName }}</span>
        @if (!item.isComplete) {
          <span class="badge badge-xs badge-info badge-outline animate-pulse">running</span>
        } @else if (item.isError) {
          <span class="badge badge-xs badge-error badge-outline">error</span>
        } @else {
          <span class="badge badge-xs badge-success badge-outline">done</span>
        }
      </button>

      <!-- Group Content (collapsible) -->
      @if (!isToolGroupCollapsed(item)) {
        <div class="px-3 pb-2 pt-1 border-t border-base-300/30 space-y-1">
          @for (subItem of item.messages; track $index) {
            @switch (subItem.kind) {
              @case ('tool_start') {
                <!-- Tool start is represented by the header, skip -->
              }
              @case ('tool_input') {
                <div class="bg-base-100 rounded-md overflow-hidden">
                  <div class="px-2 py-1 text-[10px] font-semibold text-base-content/50">Input</div>
                  <div class="px-2 pb-2 max-h-40 overflow-y-auto">
                    <markdown
                      [data]="getFormattedToolInput(subItem)"
                      class="prose prose-xs prose-invert max-w-none
                             [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px]
                             [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-[10px]"
                    />
                  </div>
                </div>
              }
              @case ('tool_result') {
                <div class="rounded-md overflow-hidden" [class.bg-error/5]="subItem.isError">
                  <div class="px-2 py-1 text-[10px] font-semibold text-base-content/50">Output</div>
                  <div class="px-2 pb-2 max-h-32 overflow-y-auto">
                    <markdown
                      [data]="getFormattedToolResult(subItem)"
                      class="prose prose-xs prose-invert max-w-none
                             [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px]
                             [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-xs"
                    />
                  </div>
                </div>
              }
            }
          }
        </div>
      }
    </div>
  } @else {
    <!-- Non-grouped messages (text, thinking, error, status, ungrouped tools) -->
    @switch (item.kind) {
      @case ('text') {
        <div class="bg-base-100 rounded-md px-3 py-2">
          <markdown
            [data]="item.content"
            class="prose prose-sm prose-invert max-w-none
                   [&_pre]:my-1 [&_pre]:text-xs [&_code]:text-xs
                   [&_p]:my-1 [&_p]:text-sm [&_p]:text-base-content/80
                   [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm
                   [&_ul]:my-1 [&_ol]:my-1 [&_li]:text-sm"
          />
        </div>
      }
      @case ('tool_start') {
        <div class="flex items-center gap-2 py-1">
          <lucide-angular [img]="TerminalIcon" class="w-3.5 h-3.5 text-info shrink-0" aria-hidden="true" />
          <span class="badge badge-sm badge-info badge-outline">{{ item.toolName || 'tool' }}</span>
          <span class="text-xs text-base-content/50">started</span>
        </div>
      }
      @case ('tool_input') {
        <div class="bg-base-100 rounded-md overflow-hidden">
          <button type="button"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-base-content/60 hover:bg-base-200 transition-colors"
            (click)="toggleToolInput(item.timestamp)"
            [attr.aria-expanded]="isToolInputExpanded(item.timestamp)">
            <lucide-angular [img]="CodeIcon" class="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>{{ item.toolName || 'Input' }}</span>
            <lucide-angular [img]="isToolInputExpanded(item.timestamp) ? ChevronUpIcon : ChevronDownIcon" class="w-3 h-3 ml-auto" aria-hidden="true" />
          </button>
          @if (isToolInputExpanded(item.timestamp)) {
          <div class="px-3 pb-2 max-h-40 overflow-y-auto">
            <markdown [data]="getFormattedToolInput(item)"
              class="prose prose-xs prose-invert max-w-none [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px] [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-[10px]" />
          </div>
          }
        </div>
      }
      @case ('tool_result') {
        <div class="flex items-start gap-2 py-1" [class.text-error]="item.isError">
          <lucide-angular [img]="item.isError ? AlertTriangleIcon : CheckCircleIcon"
            class="w-3.5 h-3.5 shrink-0 mt-0.5"
            [class.text-error]="item.isError" [class.text-success]="!item.isError" aria-hidden="true" />
          <div class="flex-1 max-h-32 overflow-y-auto">
            <markdown [data]="getFormattedToolResult(item)"
              class="prose prose-xs prose-invert max-w-none [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px] [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-xs" />
          </div>
        </div>
      }
      @case ('thinking') {
        <div class="flex items-start gap-2 py-1">
          <lucide-angular [img]="BrainIcon" class="w-3.5 h-3.5 text-secondary shrink-0 mt-0.5" aria-hidden="true" />
          <p class="text-xs italic text-base-content/50">{{ item.content }}</p>
        </div>
      }
      @case ('error') {
        <div class="alert alert-error py-2 px-3" role="alert">
          <lucide-angular [img]="AlertTriangleIcon" class="w-4 h-4 shrink-0" aria-hidden="true" />
          <span class="text-xs">{{ item.content }}</span>
        </div>
      }
      @case ('status') {
        <div class="flex items-center gap-2 py-1">
          <lucide-angular [img]="InfoIcon" class="w-3.5 h-3.5 text-base-content/40 shrink-0" aria-hidden="true" />
          <span class="text-xs text-base-content/50">{{ item.content }}</span>
        </div>
      }
    }
  }
}
```

**Note**: The `@empty` block remains:

```html
@empty {
<p class="text-xs text-base-content/40 text-center py-4">Waiting for agent messages...</p>
}
```

#### 1.1.6 Update `messageCount` to use `transcriptItems`

```typescript
/** Total message count for the badge */
protected readonly messageCount = computed(
  () => this.wizardState.analysisStream().length
);
```

This stays the same (counts raw messages, not grouped items).

### Component 1.2: ScanProgressComponent - "0 of 0 Files" Bug Fix (Requirement 1.5)

**Purpose**: Prevent showing "Analyzing 0 of 0 files" during agentic analysis initialization.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (MODIFY)

**Current template (lines 82-146)**:

```html
@if (progress(); as progressData) { @if (progressData.currentPhase) {
<!-- Phase stepper shown -->
} @else {
<!-- Progress bar with "0 of 0 files" shown -->
} }
```

**Problem**: During agentic analysis, the first few messages arrive before `currentPhase` is set. The `@else` block renders "Analyzing 0 of 0 files...".

**Fix**: Add a guard in the `@else` block that checks if we have valid file counts before showing the progress bar. If neither `currentPhase` nor valid file counts exist, show an initializing state.

**Updated template section** (replace lines 119-146):

```html
} @else if (progressData.totalFiles > 0) {
<!-- Progress Bar (only when valid file counts exist) -->
<div class="mb-6">
  <div class="flex justify-between mb-2">
    <span class="text-sm font-medium text-base-content/80"> Analyzing {{ progressData.filesScanned || 0 }} of {{ progressData.totalFiles || 0 }} files... </span>
    <span class="text-sm font-semibold text-base-content"> {{ progressPercentage() }}% </span>
  </div>
  <progress class="progress progress-primary w-full h-3" [value]="progressPercentage()" max="100" role="progressbar" [attr.aria-valuenow]="progressPercentage()" [attr.aria-valuemin]="0" [attr.aria-valuemax]="100" [attr.aria-label]="'Workspace scan progress: ' + progressPercentage() + ' percent complete'"></progress>
</div>
} @else {
<!-- Initializing state: neither phase nor file counts available yet -->
<div class="flex items-center justify-center gap-3 mb-6 py-4">
  <span class="loading loading-spinner loading-sm text-primary"></span>
  <span class="text-sm text-base-content/60">Initializing analysis...</span>
</div>
}
```

**Key change**: The `@else` (line 119) becomes `@else if (progressData.totalFiles > 0)` with a new final `@else` for the initializing state. This ensures:

- If `currentPhase` exists: show phase stepper (agentic path)
- If `totalFiles > 0`: show file progress bar (legacy path)
- Otherwise: show "Initializing analysis..." (brief loading state)

### Phase 1 Files Affected Summary

| File                                                                                                        | Action  | Description                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts` | REWRITE | Add MarkdownModule, language detection, tool result formatting, tool call grouping |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`       | MODIFY  | Fix "0 of 0 files" bug with `totalFiles > 0` guard                                 |

---

## Phase 2: Add Real-Time Stats Dashboard

### Component 2.1: AnalysisStatsDashboardComponent (Requirement 2.1, 2.2, 2.3)

**Purpose**: Display real-time analysis metrics derived from existing state service signals.

**Pattern**: Standalone component with computed signals, DaisyUI `stat` components.
**Evidence**: DaisyUI stat class pattern used across the project. Computed signal pattern from `setup-wizard-state.service.ts:409-538`.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts` (CREATE)

````typescript
import { ChangeDetectionStrategy, Component, computed, inject, signal, effect } from '@angular/core';
import { Activity, Clock, Hash, LucideAngularModule, MessageSquare, Terminal, Brain, AlertTriangle, CheckCircle } from 'lucide-angular';
import type { AnalysisStreamPayload } from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

/**
 * AnalysisStatsDashboardComponent - Real-time analysis metrics display
 *
 * Purpose:
 * - Show live message count, tool call count, elapsed time, current phase
 * - Display message type breakdown with badges
 * - All data derived from existing SetupWizardStateService signals
 * - No new services required
 *
 * Usage:
 * ```html
 * <ptah-analysis-stats-dashboard />
 * ```
 */
@Component({
  selector: 'ptah-analysis-stats-dashboard',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Stats Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <!-- Messages Processed -->
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-figure text-primary">
          <lucide-angular [img]="MessageSquareIcon" class="w-5 h-5" aria-hidden="true" />
        </div>
        <div class="stat-title text-xs">Messages</div>
        <div class="stat-value text-lg">{{ messageCount() }}</div>
      </div>

      <!-- Tool Calls -->
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-figure text-info">
          <lucide-angular [img]="TerminalIcon" class="w-5 h-5" aria-hidden="true" />
        </div>
        <div class="stat-title text-xs">Tool Calls</div>
        <div class="stat-value text-lg">{{ toolCallCount() }}</div>
      </div>

      <!-- Current Phase -->
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-figure text-secondary">
          <lucide-angular [img]="ActivityIcon" class="w-5 h-5" aria-hidden="true" />
        </div>
        <div class="stat-title text-xs">Phase</div>
        <div class="stat-value text-sm truncate">{{ currentPhaseName() }}</div>
        <div class="stat-desc text-[10px]">{{ phaseProgress() }}</div>
      </div>

      <!-- Elapsed Time -->
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-figure text-accent">
          <lucide-angular [img]="ClockIcon" class="w-5 h-5" aria-hidden="true" />
        </div>
        <div class="stat-title text-xs">Elapsed</div>
        <div class="stat-value text-lg">{{ elapsedTime() }}</div>
      </div>
    </div>

    <!-- Message Type Breakdown -->
    @if (messageCount() > 0) {
    <div class="flex flex-wrap gap-2 mb-2">
      @if (textCount() > 0) {
      <span class="badge badge-sm badge-info gap-1">
        <lucide-angular [img]="MessageSquareIcon" class="w-3 h-3" aria-hidden="true" />
        {{ textCount() }} text
      </span>
      } @if (toolCallCount() > 0) {
      <span class="badge badge-sm badge-primary gap-1">
        <lucide-angular [img]="TerminalIcon" class="w-3 h-3" aria-hidden="true" />
        {{ toolCallCount() }} tools
      </span>
      } @if (thinkingCount() > 0) {
      <span class="badge badge-sm badge-secondary gap-1">
        <lucide-angular [img]="BrainIcon" class="w-3 h-3" aria-hidden="true" />
        {{ thinkingCount() }} thinking
      </span>
      } @if (errorCount() > 0) {
      <span class="badge badge-sm badge-error gap-1">
        <lucide-angular [img]="AlertTriangleIcon" class="w-3 h-3" aria-hidden="true" />
        {{ errorCount() }} errors
      </span>
      }
    </div>
    }
  `,
})
export class AnalysisStatsDashboardComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  // Icons
  protected readonly MessageSquareIcon = MessageSquare;
  protected readonly TerminalIcon = Terminal;
  protected readonly ActivityIcon = Activity;
  protected readonly ClockIcon = Clock;
  protected readonly BrainIcon = Brain;
  protected readonly AlertTriangleIcon = AlertTriangle;

  /** Analysis start timestamp (set once when first message arrives) */
  private readonly analysisStartTime = signal<number | null>(null);

  /** Current elapsed time string, updated every second */
  protected readonly elapsedTimeValue = signal('0:00');

  /** Timer interval ID for cleanup */
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Track analysis start time from first message
    effect(() => {
      const stream = this.wizardState.analysisStream();
      if (stream.length > 0 && this.analysisStartTime() === null) {
        this.analysisStartTime.set(stream[0].timestamp);
        this.startTimer();
      }
    });
  }

  // === Computed Signals for Metrics ===

  protected readonly messageCount = computed(() => this.wizardState.analysisStream().length);

  protected readonly toolCallCount = computed(() => this.wizardState.analysisStream().filter((m) => m.kind === 'tool_start').length);

  protected readonly textCount = computed(() => this.wizardState.analysisStream().filter((m) => m.kind === 'text').length);

  protected readonly thinkingCount = computed(() => this.wizardState.analysisStream().filter((m) => m.kind === 'thinking').length);

  protected readonly errorCount = computed(() => this.wizardState.analysisStream().filter((m) => m.kind === 'error').length);

  protected readonly currentPhaseName = computed(() => {
    const progress = this.wizardState.scanProgress();
    if (!progress?.phaseLabel) return 'Starting...';
    return progress.phaseLabel;
  });

  protected readonly phaseProgress = computed(() => {
    const progress = this.wizardState.scanProgress();
    if (!progress) return '';
    const completed = progress.completedPhases?.length || 0;
    return `${completed}/4 complete`;
  });

  protected readonly elapsedTime = this.elapsedTimeValue.asReadonly();

  // === Timer Logic ===

  private startTimer(): void {
    if (this.timerInterval) return;
    this.timerInterval = setInterval(() => {
      const start = this.analysisStartTime();
      if (start) {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        this.elapsedTimeValue.set(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      }
    }, 1000);
  }
}
````

**Icon imports verification**: `MessageSquare`, `Terminal`, `Activity`, `Clock`, `Brain`, `AlertTriangle`, `CheckCircle` are all available in lucide-angular (verified via existing imports across the codebase).

### Component 2.2: Phase Progress Enhancement (Requirement 2.2)

**Purpose**: Enhance the existing phase stepper in ScanProgressComponent with completion indicators and timing.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (MODIFY)

**New import**:

```typescript
import { CheckCircle } from 'lucide-angular'; // Add to existing lucide imports
```

**New icon property**:

```typescript
protected readonly CheckCircleIcon = CheckCircle;
```

**Updated phase stepper template** (replaces lines 87-105):

```html
<ul class="steps steps-horizontal w-full">
  @for (phase of phases; track phase.id) {
  <li class="step transition-all duration-300" [class.step-primary]="isPhaseCompleteOrCurrent(phase.id)" [attr.aria-label]="phase.label + (isPhaseComplete(phase.id) ? ' - complete' : isCurrentPhase(phase.id) ? ' - in progress' : ' - pending')">
    <span class="flex items-center gap-1.5 text-xs">
      @if (isPhaseComplete(phase.id)) {
      <lucide-angular [img]="CheckCircleIcon" class="w-3.5 h-3.5 text-success" aria-hidden="true" />
      } @else if (isCurrentPhase(phase.id)) {
      <lucide-angular [img]="phase.icon" class="w-3.5 h-3.5 animate-pulse" aria-hidden="true" />
      } @else {
      <lucide-angular [img]="phase.icon" class="w-3.5 h-3.5 opacity-40" aria-hidden="true" />
      } {{ phase.label }}
    </span>
  </li>
  }
</ul>
```

**New helper methods**:

```typescript
/** Check if a specific phase is completed (in completedPhases array) */
protected isPhaseComplete(phaseId: AnalysisPhase): boolean {
  const progressData = this.progress();
  if (!progressData) return false;
  return (progressData.completedPhases || []).includes(phaseId);
}

/** Check if a specific phase is the currently active phase */
protected isCurrentPhase(phaseId: AnalysisPhase): boolean {
  const progressData = this.progress();
  if (!progressData) return false;
  return progressData.currentPhase === phaseId;
}
```

### Component 2.3: Dashboard Integration into ScanProgressComponent (Requirement 2.4)

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (MODIFY)

**New import in component file**:

```typescript
import { AnalysisStatsDashboardComponent } from './analysis-stats-dashboard.component';
```

**Updated imports array** (line 63):

```typescript
imports: [
  LucideAngularModule,
  AnalysisTranscriptComponent,
  ConfirmationModalComponent,
  AnalysisStatsDashboardComponent,  // NEW
],
```

**Updated template** - insert dashboard between phase stepper and transcript (after line ~118, before line 148):

```html
<!-- Stats Dashboard (between phase stepper and transcript) -->
@if (hasStreamMessages()) {
<div class="mb-4">
  <ptah-analysis-stats-dashboard />
</div>
}
```

This goes right after the current phase label section (line 118) and before the agent transcript section (line 148).

### Phase 2 Files Affected Summary

| File                                                                                                             | Action | Description                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts` | CREATE | New dashboard component with computed signals                  |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`            | MODIFY | Integrate dashboard, enhance phase stepper, add helper methods |

---

## Phase 3: DaisyUI Visual Enhancements

### Component 3.1: WelcomeComponent - Hero Section with Gradient (Requirement 3.1)

**Purpose**: Transform the plain welcome screen into a visually striking hero with gradient backgrounds and feature cards.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts` (REWRITE template)

**New imports**:

```typescript
import { LucideAngularModule, Search, Bot, Zap, Shield, Sparkles } from 'lucide-angular';
```

**Updated imports array**:

```typescript
imports: [LucideAngularModule],
```

**New icon properties**:

```typescript
protected readonly SearchIcon = Search;
protected readonly BotIcon = Bot;
protected readonly ZapIcon = Zap;
protected readonly ShieldIcon = Shield;
protected readonly SparklesIcon = Sparkles;
```

**New template**:

```html
<div class="hero min-h-screen bg-gradient-to-br from-primary/10 via-base-200 to-secondary/10">
  <div class="hero-content text-center">
    <div class="max-w-2xl animate-fadeIn">
      <!-- Gradient Title -->
      <h1 class="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">Let's Personalize Your Ptah Experience</h1>

      <p class="text-lg text-base-content/80 mb-4">We'll analyze your project structure, detect your tech stack, and generate intelligent agents tailored specifically to your codebase.</p>
      <p class="text-base text-base-content/60 mb-8"><span class="font-semibold">Estimated time:</span> 2-4 minutes</p>

      <!-- Feature Cards Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 text-left">
        <div class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow duration-300">
          <div class="card-body p-4 flex-row items-center gap-3">
            <div class="bg-primary/10 rounded-lg p-2">
              <lucide-angular [img]="SearchIcon" class="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h3 class="font-semibold text-sm">Deep Analysis</h3>
              <p class="text-xs text-base-content/60">4-phase AI-powered codebase scan</p>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow duration-300">
          <div class="card-body p-4 flex-row items-center gap-3">
            <div class="bg-secondary/10 rounded-lg p-2">
              <lucide-angular [img]="BotIcon" class="w-5 h-5 text-secondary" aria-hidden="true" />
            </div>
            <div>
              <h3 class="font-semibold text-sm">Smart Agents</h3>
              <p class="text-xs text-base-content/60">13 customized agent templates</p>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow duration-300">
          <div class="card-body p-4 flex-row items-center gap-3">
            <div class="bg-accent/10 rounded-lg p-2">
              <lucide-angular [img]="ZapIcon" class="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h3 class="font-semibold text-sm">Quick Setup</h3>
              <p class="text-xs text-base-content/60">Ready in under 5 minutes</p>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow duration-300">
          <div class="card-body p-4 flex-row items-center gap-3">
            <div class="bg-success/10 rounded-lg p-2">
              <lucide-angular [img]="ShieldIcon" class="w-5 h-5 text-success" aria-hidden="true" />
            </div>
            <div>
              <h3 class="font-semibold text-sm">Project-Specific</h3>
              <p class="text-xs text-base-content/60">Rules matched to your tech stack</p>
            </div>
          </div>
        </div>
      </div>

      <!-- CTA Button -->
      <button class="btn btn-primary btn-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105" aria-label="Start wizard setup" (click)="onStartSetup()">
        <lucide-angular [img]="SparklesIcon" class="w-5 h-5" aria-hidden="true" />
        Start Setup
      </button>
    </div>
  </div>
</div>
```

**CSS animation**: Add to the component's `styles` array (or use Tailwind's animation utilities):

```typescript
styles: [`
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.6s ease-out;
  }
`],
```

### Component 3.2: ScanProgressComponent - Gradient Phase Cards (Requirement 3.2)

**Purpose**: Replace the plain DaisyUI steps list with visually distinct gradient cards for each analysis phase.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (MODIFY)

**Updated phase stepper template** (replaces the `<ul class="steps">` from Phase 2):

```html
<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
  @for (phase of phases; track phase.id) {
  <div
    class="card transition-all duration-500"
    [class]="getPhaseCardClasses(phase.id)"
  >
    <div class="card-body p-3 items-center text-center gap-1">
      @if (isPhaseComplete(phase.id)) {
        <lucide-angular
          [img]="CheckCircleIcon"
          class="w-5 h-5 text-success"
          aria-hidden="true"
        />
      } @else if (isCurrentPhase(phase.id)) {
        <lucide-angular
          [img]="phase.icon"
          class="w-5 h-5 text-primary animate-pulse"
          aria-hidden="true"
        />
      } @else {
        <lucide-angular
          [img]="phase.icon"
          class="w-5 h-5 text-base-content/30"
          aria-hidden="true"
        />
      }
      <span class="text-xs font-medium" [class.text-base-content/40]="!isPhaseCompleteOrCurrent(phase.id)">
        {{ phase.label }}
      </span>
      @if (isPhaseComplete(phase.id)) {
        <span class="badge badge-xs badge-success">done</span>
      } @else if (isCurrentPhase(phase.id)) {
        <span class="badge badge-xs badge-info animate-pulse">active</span>
      }
    </div>
  </div>
  }
</div>
```

**New method - `getPhaseCardClasses()`**:

```typescript
/**
 * Get DaisyUI/Tailwind classes for a phase card based on its state.
 */
protected getPhaseCardClasses(phaseId: AnalysisPhase): string {
  if (this.isPhaseComplete(phaseId)) {
    return 'bg-success/10 border border-success/30 shadow-sm';
  }
  if (this.isCurrentPhase(phaseId)) {
    return 'bg-primary/10 border border-primary/30 shadow-md';
  }
  return 'bg-base-200 border border-base-300/50 opacity-60';
}
```

### Component 3.3: Badge System Standardization (Requirement 3.3)

**Purpose**: Ensure consistent badge usage across all wizard components.

This is primarily addressed by the badge classes already defined in the Phase 1 and Phase 2 templates above:

- **Phase status**: `badge-info` active, `badge-success` completed, `badge-ghost` pending (Phase 3.2 template)
- **Tool call status**: `badge-info badge-outline animate-pulse` running, `badge-success badge-outline` done, `badge-error badge-outline` error (Phase 1.4 template)
- **Message count**: `badge badge-sm badge-ghost` (existing, line 88 of transcript)
- **Dashboard categories**: `badge-sm badge-info` text, `badge-sm badge-primary` tools, `badge-sm badge-secondary` thinking, `badge-sm badge-error` errors (Phase 2.1 template)

No additional component changes needed beyond what is already specified. The badge system is standardized through the templates defined above.

### Component 3.4: Loading Skeleton States (Requirement 3.4)

**File 1**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts` (MODIFY)

Replace the `@empty` block's "Waiting for agent messages..." text:

```html
@empty {
<div class="space-y-3 py-4">
  <div class="flex items-center gap-2">
    <div class="skeleton w-4 h-4 rounded-full shrink-0"></div>
    <div class="skeleton h-3 w-3/4"></div>
  </div>
  <div class="skeleton h-12 w-full rounded-md"></div>
  <div class="flex items-center gap-2">
    <div class="skeleton w-4 h-4 rounded-full shrink-0"></div>
    <div class="skeleton h-3 w-1/2"></div>
  </div>
  <div class="skeleton h-8 w-full rounded-md"></div>
</div>
}
```

**File 2**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts` (MODIFY)

Replace the loading spinner block (lines 209-213):

```html
} @else {
<!-- Skeleton loading state -->
<div class="space-y-6">
  <!-- Skeleton: Tech Stack Summary -->
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body">
      <div class="skeleton h-6 w-48 mb-4"></div>
      <div class="flex flex-wrap gap-2 mb-3">
        <div class="skeleton h-6 w-20 rounded-full"></div>
        <div class="skeleton h-6 w-24 rounded-full"></div>
        <div class="skeleton h-6 w-16 rounded-full"></div>
      </div>
      <div class="skeleton h-4 w-full mb-2"></div>
      <div class="skeleton h-4 w-3/4"></div>
    </div>
  </div>

  <!-- Skeleton: Architecture Patterns -->
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body">
      <div class="skeleton h-6 w-56 mb-4"></div>
      <div class="space-y-3">
        <div class="skeleton h-8 w-full"></div>
        <div class="skeleton h-8 w-full"></div>
      </div>
    </div>
  </div>

  <!-- Skeleton: Action Buttons -->
  <div class="flex gap-4 justify-center">
    <div class="skeleton h-12 w-32 rounded-lg"></div>
    <div class="skeleton h-12 w-32 rounded-lg"></div>
  </div>
</div>
}
```

**File 3**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts` (MODIFY - add skeleton to template)

Wrap the stats grid in a conditional:

```html
@if (messageCount() > 0) {
<!-- Stats Grid (existing template) -->
... } @else {
<!-- Skeleton Stats -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
  @for (_ of [1,2,3,4]; track $index) {
  <div class="stat bg-base-200 rounded-lg p-3">
    <div class="skeleton h-4 w-16 mb-2"></div>
    <div class="skeleton h-6 w-12"></div>
  </div>
  }
</div>
}
```

### Component 3.5: Smooth Transitions and Animations (Requirement 3.5)

**File 1**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts` (MODIFY)

Add fade transition to the step content area. Wrap the `@switch` block's inner content:

**Updated template section** (lines 108-121):

```html
<!-- Step content -->
<div class="wizard-content flex-1 overflow-y-auto p-4">
  <div class="animate-fadeIn">@switch (currentStep()) { @case ('welcome') { <ptah-welcome /> } @case ('scan') { <ptah-scan-progress /> } @case ('analysis') { <ptah-analysis-results /> } @case ('selection') { <ptah-agent-selection /> } @case ('generation') { <ptah-generation-progress /> } @case ('completion') { <ptah-completion /> } }</div>
</div>
```

Add styles to `WizardViewComponent`:

```typescript
styles: [`
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.3s ease-out;
  }
`],
```

**File 2**: Add `transition-all duration-200` to all interactive elements across wizard components. This is already included in the Phase 1 and Phase 2 templates via:

- `hover:bg-base-300/30 transition-colors` on tool group headers
- `transition-all duration-300` on welcome cards
- `transition-all duration-500` on phase cards
- `hover:shadow-xl transition-all duration-300 hover:scale-105` on CTA button

**File 3**: Add `prefers-reduced-motion` media query respect.

All CSS animations should include a reduced-motion override. Add to `WizardViewComponent` styles:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-fadeIn {
    animation: none;
  }
  .animate-pulse {
    animation: none;
  }
}
```

### Phase 3 Files Affected Summary

| File                                                                                                             | Action  | Description                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------- |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts`                  | REWRITE | Gradient hero, feature cards, animations          |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`            | MODIFY  | Gradient phase cards replacing steps list         |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts`      | MODIFY  | Skeleton loading states                           |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`         | MODIFY  | Skeleton loading states                           |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts` | MODIFY  | Skeleton loading states for dashboard             |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`              | MODIFY  | Step transition animation, reduced-motion support |

---

## Integration Architecture

### Integration Points

- **MarkdownModule**: Imported per-component in `analysis-transcript.component.ts`. The app-level `provideMarkdown()` in `app.config.ts:62` provides the markdown service globally, so per-component `MarkdownModule` imports just add the template directives. No changes to app config needed.
- **SetupWizardStateService**: Dashboard reads existing signals (`analysisStream`, `scanProgress`). No mutations to state service required.
- **ScanProgressComponent**: Integrates dashboard via component import and template insertion.

### Data Flow

```
SetupWizardStateService.analysisStream() signal
  |
  +-> AnalysisTranscriptComponent.transcriptItems (computed: merge + group)
  |     |-> MarkdownModule renders text, tool inputs, tool results
  |     |-> ToolCallGroups provide collapsible tool call sections
  |
  +-> AnalysisStatsDashboardComponent (computed: counts + timer)
        |-> messageCount, toolCallCount, textCount, thinkingCount, errorCount
        |-> elapsedTime (interval-based timer)

SetupWizardStateService.scanProgress() signal
  |
  +-> ScanProgressComponent.phases (phase stepper with gradient cards)
  +-> AnalysisStatsDashboardComponent.currentPhaseName, phaseProgress
```

### Dependencies

**No new npm dependencies required.** All libraries are already installed:

- `ngx-markdown` 21.0 (used by chat library)
- `lucide-angular` 0.542 (used by all wizard components)
- `DaisyUI` 4.12 (configured via Tailwind)

**No shared type changes required.** All enhancements are purely frontend, using existing `AnalysisStreamPayload` and `ScanProgress` types from `@ptah-extension/shared`.

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

- Analysis transcript renders markdown with syntax highlighting identical to chat view quality
- Tool calls are grouped by `toolCallId` with collapsible sections
- "0 of 0 files" never displayed during agentic analysis
- Dashboard metrics update reactively as stream messages arrive
- Elapsed time counts up in real-time during analysis
- Welcome screen has gradient hero and feature cards
- Phase stepper uses gradient cards with state-based styling
- Skeleton loading states appear before data arrives
- All transitions respect `prefers-reduced-motion`

### Non-Functional Requirements

- **Performance**: All computed signals complete within 16ms (single frame). The `transcriptItems` computed iterates the stream array twice (merge + group), which is O(n) and fast for up to 2000 messages.
- **Bundle Size**: Adding `MarkdownModule` to wizard components reuses the already-chunked ngx-markdown code from the chat library. Expected impact: <2KB additional chunk overlap.
- **Accessibility**: All interactive elements have `aria-label` or `aria-expanded`. Keyboard navigation via button/click handlers. `prefers-reduced-motion` respected.
- **Error Recovery**: If markdown rendering fails, content is still present in the DOM (ngx-markdown degrades gracefully to raw text). All computed signals handle empty/null states.

### Pattern Compliance

- All components use `standalone: true` (verified across all 7 existing wizard components)
- All components use `ChangeDetectionStrategy.OnPush` (verified across all 7 existing wizard components)
- All state uses Angular signals, no RxJS BehaviorSubject (verified in `SetupWizardStateService`)
- `MarkdownModule` imported per-component, not via shared module (matches chat library pattern at `markdown-block.component.ts:2,15`)
- DaisyUI component classes used consistently (stat, card, badge, skeleton, alert, hero, steps)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**: All changes are Angular component templates, TypeScript methods, and Tailwind/DaisyUI styling within the `setup-wizard` frontend library. No backend, no shared types, no VS Code API changes.

- Phase 1: Angular template refactoring + ngx-markdown integration + computed signal logic
- Phase 2: New Angular standalone component + computed signal derivation
- Phase 3: Tailwind/DaisyUI class changes + CSS animations

### Complexity Assessment

**Complexity**: MEDIUM-HIGH
**Estimated Effort**: 10-14 hours

**Breakdown**:

- Phase 1 (Markdown + Grouping + Bug Fix): 5-7 hours (largest, most complex)
- Phase 2 (Dashboard): 2-3 hours (new component, straightforward computed signals)
- Phase 3 (DaisyUI Polish): 2-3 hours (template changes, styling)
- Testing and verification: 1-2 hours

### Files Affected Summary

**CREATE**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts`

**REWRITE** (Direct Replacement):

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts`

**MODIFY**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `MarkdownModule` from `ngx-markdown` (verified: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\markdown-block.component.ts:2`)
   - `LucideAngularModule` and all icon imports from `lucide-angular` (verified: all wizard components import these)
   - `SetupWizardStateService` from `../services/setup-wizard-state.service` (verified: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`)
   - `AnalysisStreamPayload` from `@ptah-extension/shared` (verified: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts:742`)

2. **All patterns verified from examples**:

   - Markdown rendering with `prose prose-sm prose-invert max-w-none`: verified at `markdown-block.component.ts:19`
   - Language detection map: verified at `tool-input-display.component.ts:120-141`
   - Computed signal derivation: verified at `setup-wizard-state.service.ts:409-538`
   - DaisyUI stat component: verified via DaisyUI 4.12 docs (class `stat`, `stat-title`, `stat-value`, `stat-desc`, `stat-figure`)
   - DaisyUI skeleton component: verified via DaisyUI 4.12 docs (class `skeleton`)

3. **Library documentation consulted**:

   - `D:\projects\ptah-extension\libs\frontend\setup-wizard\CLAUDE.md` - Wizard architecture
   - `D:\projects\ptah-extension\libs\frontend\chat\CLAUDE.md` - Chat reference patterns
   - `D:\projects\ptah-extension\libs\shared\CLAUDE.md` - Shared type contracts

4. **No hallucinated APIs**:
   - All decorators verified: `@Component` with `standalone`, `OnPush`, `imports` array (standard Angular 20)
   - All ngx-markdown usage: `<markdown [data]="...">` verified at `markdown-block.component.ts:17-20`
   - All DaisyUI classes: `stat`, `card`, `badge`, `skeleton`, `hero`, `steps`, `btn`, `alert` (standard DaisyUI 4.12)
   - All Tailwind utilities: `bg-gradient-to-*`, `from-*`, `via-*`, `to-*`, `prose`, `animate-*`, `transition-*` (standard Tailwind 3.4)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (performance, accessibility, error recovery)
- [x] Integration points documented (MarkdownModule, state service signals, component composition)
- [x] Files affected list complete (1 CREATE, 2 REWRITE, 3 MODIFY)
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM-HIGH, 10-14 hours)
- [x] Sequential phase dependency documented (Phase 1 -> Phase 2 -> Phase 3)
- [x] No backward compatibility layers (direct replacement approach)
- [x] No shared type modifications required
- [x] No backend changes required
