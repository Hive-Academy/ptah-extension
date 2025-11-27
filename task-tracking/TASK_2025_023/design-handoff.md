# Design Handoff - TASK_2025_023

## Purpose

This document provides **complete implementation guidance** for frontend developers building the revolutionary nested agent execution UI. All Tailwind classes, DaisyUI patterns, HTML structures, and Angular signal integrations are specified here for direct copy-paste implementation.

---

## Prerequisites

### Dependencies Required

```bash
# Already installed (verified in package.json):
# - Tailwind CSS 4.1.17 ✅
# - Angular 20.1.0 ✅

# REQUIRED INSTALLATIONS:
npm install daisyui@latest
npm install ngx-markdown@latest
npm install marked@latest  # Peer dependency for ngx-markdown
```

### Tailwind Configuration

**File**: `apps/ptah-extension-webview/tailwind.config.js`

```javascript
module.exports = {
  content: ['./apps/ptah-extension-webview/src/**/*.{html,ts}', './libs/frontend/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        'vscode-bg': 'var(--vscode-editor-background)',
        'vscode-fg': 'var(--vscode-editor-foreground)',
        'vscode-border': 'var(--vscode-widget-border)',
        'vscode-accent': 'var(--vscode-button-background)',
      },
      fontFamily: {
        sans: ['var(--vscode-font-family)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--vscode-editor-font-family)', 'SF Mono', 'Monaco', 'monospace'],
      },
      spacing: {
        280: '280px', // Sidebar width
      },
    },
  },
  plugins: [require('daisyui'), require('@tailwindcss/typography')],
  daisyui: {
    themes: [
      {
        ptah: {
          // Primary colors
          primary: 'var(--vscode-button-background)',
          'primary-content': 'var(--vscode-button-foreground)',

          // Secondary
          secondary: '#717171',
          'secondary-content': '#ffffff',

          // Accent
          accent: 'var(--vscode-focusBorder)',
          'accent-content': '#ffffff',

          // Neutral
          neutral: '#2a2a3c',
          'neutral-content': '#cccccc',

          // Base
          'base-100': 'var(--vscode-editor-background)',
          'base-200': '#252526',
          'base-300': '#3c3c3c',
          'base-content': 'var(--vscode-editor-foreground)',

          // Semantic
          info: '#75beff',
          'info-content': '#000000',
          success: '#89d185',
          'success-content': '#000000',
          warning: '#d7ba7d',
          'warning-content': '#000000',
          error: 'var(--vscode-errorForeground)',
          'error-content': '#000000',

          // Radius
          '--rounded-box': '0.5rem',
          '--rounded-btn': '0.375rem',
          '--rounded-badge': '0.25rem',

          // Animation
          '--animation-btn': '0.15s',
          '--animation-input': '0.2s',
        },
      },
    ],
    darkTheme: 'ptah',
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
};
```

### Global Styles Addition

**File**: `apps/ptah-extension-webview/src/styles.css`

**Add at the end**:

```css
/* Tailwind directives */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom shadow utilities */
.shadow-card {
  box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.3);
}

.shadow-card-hover {
  box-shadow: 0 4px 8px 0 rgba(0, 0, 0, 0.4);
}

/* Markdown prose styles for dark theme */
.prose-invert {
  --tw-prose-body: #cccccc;
  --tw-prose-headings: #ffffff;
  --tw-prose-links: #75beff;
  --tw-prose-code: #d7ba7d;
  --tw-prose-pre-bg: #2a2a3c;
}
```

---

## Component Implementation Guide

### 1. MessageBubble Component

**File**: `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts`

#### Component Class

```typescript
import { Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { ExecutionNodeComponent } from './execution-node.component';
import type { ChatMessage } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  imports: [CommonModule, MarkdownModule, ExecutionNodeComponent],
  templateUrl: './message-bubble.component.html',
  styleUrl: './message-bubble.component.css',
})
export class MessageBubbleComponent {
  readonly message = input.required<ChatMessage>();

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  formatDateTime(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }
}
```

#### Template

**File**: `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`

```html
@if (message().role === 'assistant') {
<!-- Assistant message (left-aligned) -->
<div class="chat chat-start">
  <!-- Avatar -->
  <div class="chat-image avatar">
    <div class="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
      <span class="text-white text-xs font-semibold">AI</span>
    </div>
  </div>

  <!-- Header -->
  <div class="chat-header text-xs text-base-content/70 mb-1">
    Claude
    <time class="ml-2 opacity-60" [attr.datetime]="formatDateTime(message().timestamp)"> {{ formatTime(message().timestamp) }} </time>
  </div>

  <!-- Message bubble -->
  <div class="chat-bubble bg-neutral text-neutral-content shadow-card max-w-[85%] md:max-w-[90%] lg:max-w-[85%]">
    @if (message().executionTree) {
    <!-- ExecutionNode recursive tree -->
    <ptah-execution-node [node]="message().executionTree!" />
    } @else {
    <!-- Fallback text content -->
    <markdown [data]="message().rawContent || ''" class="prose prose-sm prose-invert max-w-none" />
    }
  </div>

  <!-- Action buttons (hover reveal) -->
  <div class="chat-footer opacity-0 hover:opacity-100 transition-opacity duration-200 flex gap-1 mt-1">
    <button class="btn btn-xs btn-ghost" aria-label="Copy message" title="Copy">
      <!-- Copy icon (lucide-angular) -->
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    </button>
    <button class="btn btn-xs btn-ghost" aria-label="Like message" title="Like">
      <!-- Thumbs up icon -->
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M7 10v12" />
        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
      </svg>
    </button>
    <button class="btn btn-xs btn-ghost" aria-label="Dislike message" title="Dislike">
      <!-- Thumbs down icon -->
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 14V2" />
        <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" />
      </svg>
    </button>
  </div>
</div>
} @else {
<!-- User message (right-aligned) -->
<div class="chat chat-end">
  <!-- Avatar -->
  <div class="chat-image avatar">
    <div class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
      <span class="text-white text-xs font-semibold">U</span>
    </div>
  </div>

  <!-- Header -->
  <div class="chat-header text-xs text-base-content/70 mb-1">
    <time class="mr-2 opacity-60" [attr.datetime]="formatDateTime(message().timestamp)"> {{ formatTime(message().timestamp) }} </time>
    You
  </div>

  <!-- Message bubble -->
  <div class="chat-bubble chat-bubble-primary bg-primary text-primary-content shadow-card max-w-[85%] md:max-w-[90%] lg:max-w-[85%]">
    <markdown [data]="message().rawContent || ''" class="prose prose-sm prose-invert max-w-none" />
  </div>
</div>
}
```

#### Styles

**File**: `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.css`

```css
/* Custom markdown styles for message bubbles */
:host ::ng-deep markdown {
  color: inherit;
}

:host ::ng-deep markdown p {
  margin-bottom: 0.5em;
}

:host ::ng-deep markdown p:last-child {
  margin-bottom: 0;
}

:host ::ng-deep markdown code {
  background-color: rgba(0, 0, 0, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

:host ::ng-deep markdown pre {
  background-color: rgba(0, 0, 0, 0.3);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}
```

---

### 2. AgentCard Component

**File**: `libs/frontend/chat/src/lib/components/molecules/agent-card.component.ts`

#### Component Class

```typescript
import { Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExecutionNodeComponent } from '../organisms/execution-node.component';
import type { ExecutionNode } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-agent-card',
  standalone: true,
  imports: [CommonModule, ExecutionNodeComponent],
  templateUrl: './agent-card.component.html',
})
export class AgentCardComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(false);

  // Agent color mapping (Roo Code-inspired)
  getAgentColor(agentType: string): string {
    const colors: Record<string, string> = {
      'software-architect': '#f97316',
      'frontend-developer': '#3b82f6',
      'backend-developer': '#10b981',
      'senior-tester': '#8b5cf6',
      'code-reviewer': '#ec4899',
      'team-leader': '#6366f1',
      'project-manager': '#d97706',
      'researcher-expert': '#06b6d4',
      'ui-ux-designer': '#f59e0b',
    };
    return colors[agentType] || '#717171';
  }

  getAgentInitial(agentType: string): string {
    return agentType.charAt(0).toUpperCase();
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  formatTokens(count: number): string {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  }

  toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }
}
```

#### Template

**File**: `libs/frontend/chat/src/lib/components/molecules/agent-card.component.html`

```html
<div class="card bg-base-200 shadow-card hover:shadow-card-hover transition-shadow duration-200 my-2" [class.ml-4]="true">
  <div class="collapse collapse-arrow">
    <input type="checkbox" [checked]="!isCollapsed()" (change)="toggleCollapse()" [attr.aria-expanded]="!isCollapsed()" [attr.aria-controls]="'agent-content-' + node().id" />

    <!-- Collapse header -->
    <div class="collapse-title min-h-0 py-3 px-3 flex items-center gap-3">
      <!-- Colored letter badge -->
      <div class="avatar placeholder">
        <div class="w-10 h-10 rounded-full flex items-center justify-center" [style.background-color]="getAgentColor(node().agentType!)">
          <span class="text-white text-sm font-bold"> {{ getAgentInitial(node().agentType!) }} </span>
        </div>
      </div>

      <!-- Agent info -->
      <div class="flex-1 min-w-0">
        <!-- Name + Status row -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-sm text-base-content truncate"> {{ node().agentType }} </span>

          <!-- Status badge -->
          @if (node().status === 'streaming') {
          <span class="badge badge-info badge-sm gap-1">
            <span class="loading loading-spinner loading-xs"></span>
            Streaming
          </span>
          } @if (node().status === 'complete') {
          <span class="badge badge-success badge-sm">Done</span>
          } @if (node().status === 'error') {
          <span class="badge badge-error badge-sm">Error</span>
          } @if (node().status === 'pending') {
          <span class="badge badge-ghost badge-sm">Pending</span>
          }
        </div>

        <!-- Metrics row -->
        <div class="flex items-center gap-2 mt-1 flex-wrap">
          @if (node().duration) {
          <span class="badge badge-ghost badge-xs"> {{ formatDuration(node().duration!) }} </span>
          } @if (node().tokenUsage) {
          <span class="badge badge-ghost badge-xs"> {{ formatTokens(node().tokenUsage!.input + node().tokenUsage!.output) }} tokens </span>
          } @if (node().agentModel) {
          <span class="badge badge-outline badge-xs"> {{ node().agentModel }} </span>
          }
        </div>
      </div>
    </div>

    <!-- Collapsible content (nested children) -->
    <div class="collapse-content px-3 pb-3" [attr.id]="'agent-content-' + node().id">
      @for (child of node().children; track child.id) {
      <ptah-execution-node [node]="child" />
      }
    </div>
  </div>
</div>
```

---

### 3. ThinkingBlock Component

**File**: `libs/frontend/chat/src/lib/components/molecules/thinking-block.component.ts`

#### Component Class

```typescript
import { Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import type { ExecutionNode } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-thinking-block',
  standalone: true,
  imports: [CommonModule, MarkdownModule],
  templateUrl: './thinking-block.component.html',
})
export class ThinkingBlockComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default

  toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }
}
```

#### Template

**File**: `libs/frontend/chat/src/lib/components/molecules/thinking-block.component.html`

```html
<div class="collapse collapse-arrow bg-base-300 rounded-md my-2">
  <input type="checkbox" [checked]="!isCollapsed()" (change)="toggleCollapse()" [attr.aria-expanded]="!isCollapsed()" [attr.aria-controls]="'thinking-' + node().id" />

  <div class="collapse-title min-h-0 py-2 px-3 text-sm font-medium flex items-center gap-2">
    <span class="badge badge-info badge-sm">🧠 thinking</span>
    <span class="text-base-content/80">Extended Thinking</span>
  </div>

  <div class="collapse-content px-3 pb-3" [attr.id]="'thinking-' + node().id">
    <div class="prose prose-sm prose-invert max-w-none">
      <markdown [data]="node().content || ''" />
    </div>
  </div>
</div>
```

---

### 4. ToolCallItem Component

**File**: `libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.ts`

#### Component Class

```typescript
import { Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { ExecutionNodeComponent } from '../organisms/execution-node.component';
import type { ExecutionNode } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-tool-call-item',
  standalone: true,
  imports: [CommonModule, MarkdownModule, ExecutionNodeComponent],
  templateUrl: './tool-call-item.component.html',
})
export class ToolCallItemComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default

  getToolDescription(node: ExecutionNode): string {
    const toolName = node.toolName!;
    const input = node.toolInput;

    switch (toolName) {
      case 'Read':
        return (input?.['file_path'] as string) || 'Reading file...';
      case 'Write':
        return (input?.['file_path'] as string) || 'Writing file...';
      case 'Bash':
        const cmd = input?.['command'] as string;
        return cmd ? (cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd) : 'Running command...';
      case 'Grep':
        return `Pattern: ${input?.['pattern'] || '...'}`;
      case 'Edit':
        return (input?.['file_path'] as string) || 'Editing file...';
      case 'Glob':
        return `Pattern: ${input?.['pattern'] || '...'}`;
      default:
        return `${toolName} execution`;
    }
  }

  formatToolOutput(output: unknown): string {
    if (typeof output === 'string') return output;
    return JSON.stringify(output, null, 2);
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }
}
```

#### Template

**File**: `libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.html`

```html
<div class="collapse collapse-arrow bg-base-200/50 rounded-md my-1 border border-base-300">
  <input type="checkbox" [checked]="!isCollapsed()" (change)="toggleCollapse()" [attr.aria-expanded]="!isCollapsed()" [attr.aria-controls]="'tool-' + node().id" />

  <div class="collapse-title min-h-0 py-2 px-2.5 text-xs flex items-center gap-2">
    <!-- Tool name badge -->
    <span class="badge badge-sm font-mono" [class.badge-success]="node().status === 'complete'" [class.badge-info]="node().status === 'streaming'" [class.badge-error]="node().status === 'error'" [class.badge-ghost]="node().status === 'pending'"> {{ node().toolName }} </span>

    <!-- Brief description -->
    <span class="text-base-content/60 truncate flex-1 text-xs"> {{ getToolDescription(node()) }} </span>

    <!-- Duration -->
    @if (node().duration) {
    <span class="badge badge-ghost badge-xs"> {{ formatDuration(node().duration!) }} </span>
    }
  </div>

  <div class="collapse-content px-2.5 pb-2" [attr.id]="'tool-' + node().id">
    <!-- Tool input -->
    @if (node().toolInput) {
    <div class="mb-2">
      <div class="text-xs font-semibold text-base-content/70 mb-1">Input:</div>
      <pre class="bg-base-300 rounded p-2 text-xs overflow-x-auto font-mono">{{ JSON.stringify(node().toolInput, null, 2) }}</pre>
    </div>
    }

    <!-- Tool output -->
    @if (node().toolOutput) {
    <div>
      <div class="text-xs font-semibold text-base-content/70 mb-1">Output:</div>
      <div class="bg-base-300 rounded p-2 text-xs">
        <markdown [data]="formatToolOutput(node().toolOutput)" class="prose prose-xs prose-invert max-w-none" />
      </div>
    </div>
    }

    <!-- Nested children (rare, but supported) -->
    @for (child of node().children; track child.id) {
    <ptah-execution-node [node]="child" />
    }
  </div>
</div>
```

---

### 5. ExecutionNode Component (Recursive Key Component)

**File**: `libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts`

#### Component Class

```typescript
import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { AgentCardComponent } from '../molecules/agent-card.component';
import { ThinkingBlockComponent } from '../molecules/thinking-block.component';
import { ToolCallItemComponent } from '../molecules/tool-call-item.component';
import type { ExecutionNode } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  imports: [CommonModule, MarkdownModule, AgentCardComponent, ThinkingBlockComponent, ToolCallItemComponent],
  template: `
    @switch (node().type) { @case ('text') {
    <div class="prose prose-sm prose-invert max-w-none my-2">
      <markdown [data]="node().content || ''" />
    </div>
    } @case ('thinking') {
    <ptah-thinking-block [node]="node()" />
    } @case ('tool') {
    <ptah-tool-call-item [node]="node()" />
    } @case ('agent') {
    <ptah-agent-card [node]="node()" />
    } @case ('message') {
    <!-- Render all children (unwrapped message node) -->
    @for (child of node().children; track child.id) {
    <ptah-execution-node [node]="child" />
    } } @case ('system') {
    <!-- System messages (session init, etc.) -->
    <div class="alert alert-info my-2 text-xs">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <span>{{ node().content }}</span>
    </div>
    } }
  `,
})
export class ExecutionNodeComponent {
  readonly node = input.required<ExecutionNode>();
}
```

---

### 6. InputArea Component

**File**: `libs/frontend/chat/src/lib/components/molecules/input-area.component.ts`

#### Component Class

```typescript
import { Component, signal, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FileTagComponent } from '../file-tag/file-tag.component';

export interface AttachedFile {
  path: string;
  name: string;
}

@Component({
  selector: 'ptah-input-area',
  standalone: true,
  imports: [CommonModule, FormsModule, FileTagComponent],
  templateUrl: './input-area.component.html',
})
export class InputAreaComponent {
  readonly inputValue = signal('');
  readonly attachedFiles = signal<AttachedFile[]>([]);
  readonly isStreaming = signal(false); // Will be bound from parent

  readonly sendMessage = output<{ text: string; files: AttachedFile[] }>();
  readonly attachFile = output<void>();

  readonly canSend = computed(() => {
    const text = this.inputValue().trim();
    return text.length > 0 && !this.isStreaming();
  });

  onInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.inputValue.set(textarea.value);

    // Auto-resize
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = newHeight + 'px';
  }

  onEnterPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  send(): void {
    if (!this.canSend()) return;

    this.sendMessage.emit({
      text: this.inputValue(),
      files: this.attachedFiles(),
    });

    // Clear input
    this.inputValue.set('');
    this.attachedFiles.set([]);

    // Reset textarea height
    const textarea = document.querySelector('textarea');
    if (textarea) textarea.style.height = 'auto';
  }

  onAttachFile(): void {
    this.attachFile.emit();
  }

  removeFile(file: AttachedFile): void {
    this.attachedFiles.update((files) => files.filter((f) => f.path !== file.path));
  }
}
```

#### Template

**File**: `libs/frontend/chat/src/lib/components/molecules/input-area.component.html`

```html
<div class="flex flex-col gap-2 bg-base-200 rounded-lg p-3">
  <!-- File tags (if any) -->
  @if (attachedFiles().length > 0) {
  <div class="flex flex-wrap gap-2">
    @for (file of attachedFiles(); track file.path) {
    <ptah-file-tag [file]="file" (remove)="removeFile(file)" />
    }
  </div>
  }

  <!-- Input row -->
  <div class="flex items-end gap-2">
    <!-- Textarea -->
    <textarea class="textarea textarea-bordered flex-1 min-h-[44px] max-h-[200px] resize-none bg-base-100 text-sm" placeholder="Ask a question or describe a task..." rows="1" [disabled]="isStreaming()" [value]="inputValue()" (input)="onInput($event)" (keydown)="onEnterPress($event)" aria-label="Chat message input"></textarea>

    <!-- Action buttons -->
    <div class="flex gap-1">
      <!-- Attach file button -->
      <button class="btn btn-square btn-ghost btn-sm" [disabled]="isStreaming()" (click)="onAttachFile()" aria-label="Attach file" title="Attach file">
        <!-- Paperclip icon -->
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      <!-- Send button -->
      <button class="btn btn-primary btn-sm gap-1" [disabled]="!canSend()" (click)="send()" aria-label="Send message" title="Send (Enter)">
        <span class="hidden sm:inline">Send</span>
        <!-- Send arrow icon -->
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Model selector + hint text -->
  <div class="flex justify-between items-center">
    <span class="text-xs text-base-content/50"> Shift+Enter for new line </span>
    <select class="select select-bordered select-xs bg-base-100 text-xs max-w-[200px]">
      <option>Claude Sonnet 4.0</option>
      <option>Claude Opus 4.0</option>
    </select>
  </div>
</div>
```

---

### 7. ChatView Component (Message List + Input)

**File**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

#### Component Class

```typescript
import { Component, inject, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { InputAreaComponent, type AttachedFile } from '../molecules/input-area.component';
import { ChatStore } from '../../services/chat.store';

@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  imports: [CommonModule, MessageBubbleComponent, InputAreaComponent],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.css',
})
export class ChatViewComponent implements AfterViewChecked {
  readonly chatStore = inject(ChatStore);

  @ViewChild('messageContainer') messageContainer?: ElementRef;

  private shouldAutoScroll = true;

  ngAfterViewChecked(): void {
    if (this.shouldAutoScroll) {
      this.scrollToBottom();
    }
  }

  onSend(data: { text: string; files: AttachedFile[] }): void {
    this.chatStore.sendMessage(
      data.text,
      data.files.map((f) => f.path)
    );
    this.shouldAutoScroll = true;
  }

  onAttachFile(): void {
    // TODO: Integrate with FilePickerService
    console.log('Attach file clicked');
  }

  private scrollToBottom(): void {
    if (!this.messageContainer) return;

    const container = this.messageContainer.nativeElement;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }
}
```

#### Template

**File**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

```html
<div class="flex flex-col h-full">
  <!-- Message List -->
  <div class="flex-1 overflow-y-auto p-4 space-y-3" #messageContainer>
    @for (message of chatStore.messages(); track message.id) {
    <ptah-message-bubble [message]="message" />
    }

    <!-- Streaming indicator -->
    @if (chatStore.isStreaming()) {
    <div class="flex items-center gap-2 text-sm text-base-content/60 ml-4">
      <span class="loading loading-dots loading-sm"></span>
      Claude is responding...
    </div>
    }

    <!-- Empty state -->
    @if (chatStore.messages().length === 0) {
    <div class="flex flex-col items-center justify-center h-full text-center">
      <div class="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h3 class="text-lg font-semibold mb-2">Start a conversation</h3>
      <p class="text-sm text-base-content/70 max-w-md">Ask Claude to help with code, explain concepts, or work on tasks together.</p>
    </div>
    }
  </div>

  <!-- Input Area -->
  <div class="border-t border-base-300 p-4">
    <ptah-input-area (sendMessage)="onSend($event)" (attachFile)="onAttachFile()" />
  </div>
</div>
```

#### Styles

**File**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.css`

```css
:host {
  display: block;
  height: 100%;
}

/* Custom scrollbar for message container */
:host ::ng-deep .overflow-y-auto::-webkit-scrollbar {
  width: 8px;
}

:host ::ng-deep .overflow-y-auto::-webkit-scrollbar-track {
  background: var(--vscode-scrollbar-shadow);
}

:host ::ng-deep .overflow-y-auto::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background);
  border-radius: 4px;
}

:host ::ng-deep .overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground);
}
```

---

### 8. AppShell Component (Sidebar + Main Content)

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`

#### Component Class

```typescript
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatViewComponent } from './chat-view.component';
import { ChatStore } from '../../services/chat.store';

@Component({
  selector: 'ptah-app-shell',
  standalone: true,
  imports: [CommonModule, ChatViewComponent],
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  readonly chatStore = inject(ChatStore);
}
```

#### Template

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`

```html
<div class="drawer lg:drawer-open">
  <!-- Hidden checkbox for mobile drawer toggle -->
  <input id="session-drawer" type="checkbox" class="drawer-toggle" />

  <!-- Main Content -->
  <div class="drawer-content flex flex-col">
    <!-- Header -->
    <div class="navbar bg-base-100 border-b border-base-300 min-h-[48px]">
      <!-- Mobile hamburger -->
      <label for="session-drawer" class="btn btn-square btn-ghost lg:hidden" aria-label="Open menu">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="4" x2="20" y1="12" y2="12" />
          <line x1="4" x2="20" y1="6" y2="6" />
          <line x1="4" x2="20" y1="18" y2="18" />
        </svg>
      </label>

      <!-- Title -->
      <div class="flex-1">
        <span class="text-xl font-bold">Ptah</span>
      </div>

      <!-- Header actions (optional) -->
      <div class="flex gap-2">
        <button class="btn btn-square btn-ghost btn-sm" aria-label="Settings">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Chat View -->
    <ptah-chat-view class="flex-1 overflow-hidden" />
  </div>

  <!-- Session Sidebar -->
  <div class="drawer-side z-40">
    <label for="session-drawer" class="drawer-overlay" aria-label="Close menu"></label>

    <aside class="menu bg-base-200 w-80 min-h-full p-4">
      <!-- Sidebar header -->
      <div class="mb-4">
        <h2 class="text-lg font-bold mb-2">Sessions</h2>
        <button class="btn btn-primary btn-sm w-full gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          New Session
        </button>
      </div>

      <!-- Session list -->
      <ul class="space-y-1">
        @for (session of chatStore.sessions(); track session.id) {
        <li>
          <a class="flex items-center justify-between gap-2 py-3 px-4 hover:bg-base-300 rounded-md transition-colors" [class.active]="session.id === chatStore.currentSession()?.id" (click)="chatStore.switchSession(session.id)">
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">{{ session.name }}</div>
              <div class="text-xs text-base-content/60">{{ session.lastActiveAt | date:'short' }}</div>
            </div>
            <span class="badge badge-sm badge-ghost">{{ session.messageCount }}</span>
          </a>
        </li>
        }
      </ul>
    </aside>
  </div>
</div>
```

---

## Angular Signal Integration Patterns

### ChatStore Signal Usage

```typescript
// In components that consume ChatStore
import { inject } from '@angular/core';
import { ChatStore } from '@ptah-extension/chat';

export class SomeComponent {
  readonly chatStore = inject(ChatStore);

  // Access signals directly
  readonly messages = this.chatStore.messages;
  readonly isStreaming = this.chatStore.isStreaming;
  readonly currentSession = this.chatStore.currentSession;

  // Call actions
  sendMessage(): void {
    this.chatStore.sendMessage('Hello!', []);
  }

  switchSession(sessionId: string): void {
    this.chatStore.switchSession(sessionId);
  }
}
```

### Template Signal Binding

```html
<!-- Direct signal binding (auto-unwraps) -->
<div>{{ chatStore.messages().length }} messages</div>

<!-- Computed signal usage -->
<div>Current session: {{ chatStore.currentSession()?.name || 'None' }}</div>

<!-- Conditional rendering -->
@if (chatStore.isStreaming()) {
<span class="loading loading-spinner"></span>
}

<!-- Iteration -->
@for (msg of chatStore.messages(); track msg.id) {
<ptah-message-bubble [message]="msg" />
}
```

---

## Testing Checklist

### Visual Regression Tests

- [ ] MessageBubble renders correctly for user/assistant messages
- [ ] AgentCard displays colored badges matching agent types
- [ ] AgentCard nesting indents correctly (ml-4 per level)
- [ ] ThinkingBlock collapses/expands smoothly
- [ ] ToolCallItem shows correct tool name badges
- [ ] ExecutionNode recursively renders nested agents
- [ ] InputArea resizes textarea correctly (max 200px)
- [ ] SessionList highlights active session
- [ ] Drawer opens/closes on mobile
- [ ] All hover states work (shadows, opacity changes)

### Accessibility Tests

- [ ] All buttons have `aria-label`
- [ ] Collapse components have `aria-expanded` and `aria-controls`
- [ ] Message list has `role="log"` and `aria-live="polite"`
- [ ] Timestamps use `<time datetime="ISO">` format
- [ ] Keyboard navigation works (Tab, Enter, Space, Escape)
- [ ] Focus visible indicators on all interactive elements
- [ ] Touch targets are ≥ 44x44px
- [ ] Color contrast ratios meet WCAG 2.1 AA (4.5:1 minimum)

### Responsive Tests

- [ ] Desktop (1024px+): Sidebar always visible, max-w-[85%] bubbles
- [ ] Tablet (768-1024px): Drawer pattern works, max-w-[90%] bubbles
- [ ] Mobile (< 768px): Hamburger menu, max-w-[95%] bubbles, smaller badges
- [ ] Agent card letter badges resize (40px → 32px on mobile)
- [ ] Input area stacks model selector on very small screens

### Performance Tests

- [ ] Message list scrolls smoothly with 100+ messages
- [ ] Collapse animations don't jank (use Chrome DevTools Performance)
- [ ] Textarea auto-resize doesn't lag
- [ ] Nested agents (5+ levels deep) render without delay
- [ ] DaisyUI classes don't bloat bundle size

---

## Implementation Order (Recommended)

1. **Setup Dependencies** (30 min)

   - Install DaisyUI, ngx-markdown
   - Update tailwind.config.js
   - Add global styles

2. **Build Atom Components** (2 hours)

   - ThinkingBlock (simplest)
   - ToolCallItem (medium complexity)
   - AgentCard (complex, no recursion yet)

3. **Build ExecutionNode** (1 hour)

   - Wire up @switch logic
   - Test recursion with mock data

4. **Build MessageBubble** (1 hour)

   - Wire up chat-start/chat-end
   - Integrate ExecutionNode

5. **Build InputArea** (1 hour)

   - Textarea auto-resize
   - Send button logic

6. **Build ChatView** (1 hour)

   - Message list with auto-scroll
   - Wire up InputArea

7. **Build AppShell** (1 hour)

   - DaisyUI drawer
   - Session sidebar

8. **Integration Testing** (2 hours)
   - Test with real ChatStore
   - Fix any layout issues

**Total Estimated Time**: 9-10 hours

---

## Developer Notes

### Tailwind Class Naming Conventions

**Use DaisyUI semantic classes** when possible:

- ✅ `chat-bubble-primary` (DaisyUI)
- ❌ `bg-blue-500` (raw Tailwind)

**Exception**: Use Tailwind utilities for spacing, sizing, layout:

- ✅ `ml-4`, `py-3`, `gap-2`, `flex-1`

### VS Code Variable Usage

**Always use DaisyUI theme colors** (which map to VS Code variables):

- ✅ `bg-base-100` (maps to --vscode-editor-background)
- ❌ `bg-[var(--vscode-editor-background)]` (bypasses theme)

**Direct variable usage** only for custom utilities:

- ✅ `.vscode-border { border-color: var(--vscode-widget-border); }`

### DaisyUI Gotchas

1. **Collapse requires checkbox**: Must have `<input type="checkbox">` even if hidden
2. **Chat bubble max-width**: Use `max-w-[85%]` to prevent full-width
3. **Drawer toggle**: Use `drawer-toggle` class on checkbox for mobile
4. **Badge sizes**: `badge-xs`, `badge-sm`, `badge-md`, `badge-lg`
5. **Loading spinner**: Use `loading-spinner` with size modifiers

### Angular Signal Gotchas

1. **Always use `()` to read signals** in templates: `message()`, not `message`
2. **Use `computed()` for derived state**: Don't recalculate in templates
3. **Update signals with `.set()` or `.update()`**: Never mutate directly
4. **Input signals are readonly**: Can't update from inside component

---

## Quality Assurance

### Before Marking Complete

- [ ] All components compile without errors
- [ ] No console warnings about missing dependencies
- [ ] Dark theme colors match VS Code exactly
- [ ] All accessibility attributes present
- [ ] Keyboard navigation tested manually
- [ ] Mobile drawer tested on small screen
- [ ] Nested agent cards render correctly (3+ levels tested)
- [ ] Bundle size checked (should stay under 600KB)

---

**Document Version**: 1.0
**Created**: 2025-11-25
**Author**: ui-ux-designer
**Task**: TASK_2025_023
**Status**: Complete - Ready for frontend-developer implementation
