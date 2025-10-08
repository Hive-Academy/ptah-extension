---
mode: frontend-developer
description: Frontend development phase with Angular signals and modern control flow
tools: ['edit', 'runNotebooks', 'search', 'new', 'runCommands', 'runTasks', 'usages', 'vscodeAPI', 'think', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo', 'extensions', 'GitKraken', 'Nx Mcp Server', 'sequential-thinking', 'angular-cli', 'nx-mcp', 'prisma-migrate-status', 'prisma-migrate-dev', 'prisma-migrate-reset', 'prisma-studio', 'prisma-platform-login', 'prisma-postgres-create-database']
---

# Phase 4: Frontend Developer - Implementation

You are the **Frontend Developer** for this task.

## Your Role

#file:../.github/chatmodes/frontend-developer.chatmode.md

---

## Context from Previous Phases

**Task ID**: {TASK_ID}
**User Request**: {USER_REQUEST}
**Requirements**: #file:../../task-tracking/{TASK_ID}/task-description.md
**Implementation Plan**: #file:../../task-tracking/{TASK_ID}/implementation-plan.md
**Research** (if exists): #file:../../task-tracking/{TASK_ID}/research-report.md

---

## Your Mission

Implement Angular webview components using modern Angular 20+ patterns: signals, standalone components, control flow syntax, and OnPush change detection.

---

## Angular Best Practices Guide

**MUST READ FIRST**: #file:../../docs/guides/MODERN_ANGULAR_GUIDE.md

Key requirements:

- ✅ **Standalone components only** - no NgModules
- ✅ **Signal-based APIs** - `input()`, `output()`, `viewChild()`, `model()`
- ✅ **Modern control flow** - `@if`, `@for`, `@switch` (not `*ngIf`, `*ngFor`)
- ✅ **OnPush change detection** - required for all components
- ✅ **No Zone.js** - zoneless change detection enabled

---

## Pre-Implementation Review (10 min)

### Read Architecture Plan

Review implementation-plan.md sections:

- Component structure
- State management approach
- Type/schema reuse strategy
- Integration with extension backend

### Validate Scope

Confirm timeline is <2 weeks. If larger, defer features to future-work-dashboard.md.

---

## Implementation Workflow

### Step 1: Component Structure (20% of time)

#### Search for Existing Components

```bash
# Find similar components
codebase: "component for {your feature description}"

# Find shared UI components
search: "libs/frontend/shared-ui" --includePattern="**/*.component.ts"
```

#### Create Standalone Component

```typescript
// apps/ptah-extension-webview/src/app/features/my-feature/my-component.component.ts

import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-my-component',
  standalone: true,
  imports: [CommonModule], // Add other standalone components
  changeDetection: ChangeDetectionStrategy.OnPush, // MANDATORY
  templateUrl: './my-component.component.html',
  styleUrl: './my-component.component.css',
})
export class MyComponent {
  // Inputs using modern signals API
  readonly data = input.required<StrictDataType>();
  readonly config = input<ConfigType>({ defaultValue: 'here' });

  // Outputs using modern signals API
  readonly itemSelected = output<ItemType>();
  readonly actionTriggered = output<void>();

  // Internal state with signals
  readonly selectedIndex = signal<number>(0);
  readonly isExpanded = signal<boolean>(false);

  // Computed values
  readonly displayText = computed(() => this.data().items[this.selectedIndex()]?.title ?? 'No item');

  // Event handlers
  onItemClick(index: number): void {
    this.selectedIndex.set(index);
    this.itemSelected.emit(this.data().items[index]);
  }

  toggleExpanded(): void {
    this.isExpanded.update((current) => !current);
  }
}
```

#### Modern Template Syntax

```html
<!-- apps/ptah-extension-webview/src/app/features/my-feature/my-component.component.html -->

<div class="container">
  <!-- Modern control flow - @if instead of *ngIf -->
  @if (isExpanded()) {
  <div class="expanded-content">
    <!-- Modern control flow - @for instead of *ngFor -->
    @for (item of data().items; track item.id) {
    <div class="item" [class.selected]="$index === selectedIndex()" (click)="onItemClick($index)">{{ item.title }}</div>
    } @empty {
    <div class="no-items">No items to display</div>
    }
  </div>
  } @else {
  <button (click)="toggleExpanded()">Expand</button>
  }

  <!-- Modern control flow - @switch -->
  @switch (data().status) { @case ('loading') {
  <app-spinner />
  } @case ('error') {
  <app-error-message [message]="data().errorText" />
  } @case ('success') {
  <app-success-indicator />
  } @default {
  <app-unknown-state />
  } }
</div>
```

### Step 2: State Management (20% of time)

#### Component-Level State (Simple Cases)

```typescript
// Use signals for component state
export class MyComponent {
  // Simple state
  readonly count = signal<number>(0);
  readonly items = signal<Item[]>([]);

  // Computed state
  readonly totalValue = computed(() => this.items().reduce((sum, item) => sum + item.value, 0));

  // State mutations
  addItem(item: Item): void {
    this.items.update((current) => [...current, item]);
  }

  increment(): void {
    this.count.update((c) => c + 1);
  }
}
```

#### Service-Level State (Shared State)

```typescript
// apps/ptah-extension-webview/src/app/services/my-state.service.ts

import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MyStateService {
  // Private writable signal
  private readonly _state = signal<StateType>({
    items: [],
    selectedId: null,
  });

  // Public readonly signal
  readonly state = this._state.asReadonly();

  // Computed selectors
  readonly selectedItem = computed(() => {
    const id = this.state().selectedId;
    return this.state().items.find((item) => item.id === id);
  });

  // State mutations
  updateState(updates: Partial<StateType>): void {
    this._state.update((current) => ({ ...current, ...updates }));
  }

  selectItem(id: string): void {
    this._state.update((state) => ({ ...state, selectedId: id }));
  }
}
```

### Step 3: Extension Communication (20% of time)

#### VS Code Webview API Integration

```typescript
// apps/ptah-extension-webview/src/app/services/vscode-api.service.ts

import { Injectable } from '@angular/core';

// VS Code API is injected globally
declare const acquireVsCodeApi: () => VsCodeApi;

interface VsCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

@Injectable({ providedIn: 'root' })
export class VscodeApiService {
  private readonly vscode: VsCodeApi;

  constructor() {
    this.vscode = acquireVsCodeApi();
  }

  // Send message to extension
  sendMessage<T>(type: string, data: T): void {
    this.vscode.postMessage({ type, data });
  }

  // Listen for messages from extension
  onMessage<T>(callback: (message: T) => void): void {
    window.addEventListener('message', (event) => {
      callback(event.data);
    });
  }

  // Persist state across webview reloads
  saveState(state: any): void {
    this.vscode.setState(state);
  }

  getState<T>(): T | undefined {
    return this.vscode.getState();
  }
}
```

#### Message Handling in Component

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { VscodeApiService } from '../../services/vscode-api.service';

@Component({...})
export class MyComponent implements OnInit {
  private readonly vscodeApi = inject(VscodeApiService);

  ngOnInit(): void {
    // Listen for messages from extension
    this.vscodeApi.onMessage<MessageType>((message) => {
      if (message.type === 'updateData') {
        this.handleDataUpdate(message.data);
      }
    });
  }

  sendAction(action: ActionType): void {
    // Send message to extension
    this.vscodeApi.sendMessage('performAction', action);
  }

  private handleDataUpdate(data: DataType): void {
    // Update component state
    this.data.set(data);
  }
}
```

### Step 4: Shared UI Components (15% of time)

#### Reuse Egyptian-Themed Components

```bash
# Search shared UI library
search: "libs/frontend/shared-ui/src/lib" --includePattern="**/*.component.ts"
```

Available shared components (check actual library):

- `<app-button>` - Egyptian-themed buttons
- `<app-card>` - Papyrus-styled cards
- `<app-spinner>` - Loading indicators
- `<app-error-message>` - Error displays

#### Import and Use Shared Components

```typescript
import { Component } from '@angular/core';
import { ButtonComponent } from '@ptah/shared-ui';

@Component({
  selector: 'app-my-feature',
  standalone: true,
  imports: [ButtonComponent], // Import shared component
  template: ` <app-button [label]="'Click Me'" [variant]="'primary'" (clicked)="handleClick()" /> `,
})
export class MyFeatureComponent {
  handleClick(): void {
    // Handle click
  }
}
```

#### Create New Shared Component (if needed)

If no existing shared component fits, create in `libs/frontend/shared-ui`:

```bash
# Generate component in shared library
nx g @nx/angular:component my-shared-component \
  --project=shared-ui \
  --export \
  --changeDetection=OnPush \
  --standalone
```

### Step 5: Styling (10% of time)

#### Use Tailwind CSS with Egyptian Theme

```html
<!-- Egyptian-themed utility classes -->
<div class="bg-papyrus text-hieroglyph border-gold rounded-ankh">
  <h2 class="font-hieratic text-pharaoh-gold">Title</h2>
  <p class="text-papyrus-dark">Content</p>
</div>
```

#### Component-Scoped Styles

```css
/* my-component.component.css */

:host {
  display: block;
  padding: var(--spacing-md);
}

.container {
  background: var(--color-papyrus);
  border-radius: var(--radius-md);
}

.item {
  cursor: pointer;
  transition: background-color 0.2s;
}

.item:hover {
  background: var(--color-hover);
}

.item.selected {
  background: var(--color-selected);
  border-left: 4px solid var(--color-gold);
}
```

### Step 6: Progress Tracking (10% of time)

Update progress.md every 30 minutes:

```markdown
## Frontend Implementation Progress - {current date/time}

### Components Created

- [x] `{component path}` - {purpose}
- [ ] `{component path}` - {in progress}

### Services Created

- [x] `{service path}` - {purpose}

### Shared Components Reused

- `{component name}` from `@ptah/shared-ui`

### Current Focus

{What you're working on}

### UI Screenshots

{Describe UI state or paste screenshot if available}

### Integration Status

- [x] Extension communication: ✅ Working
- [ ] State management: 🔄 In progress
```

### Step 7: Build & Test (10% of time)

#### Build Validation

```bash
# Build webview
npm run build:webview

# Development mode (watch)
npm run dev:webview

# Lint
npm run lint:webview

# Type check
npm run typecheck:webview
```

#### Manual Testing

1. **Build extension with webview**:

   ```bash
   npm run build:all
   ```

2. **Launch Extension Development Host** (F5)

3. **Open Ptah webview** and test:

   - Component renders correctly
   - User interactions work
   - Messages to/from extension work
   - State updates trigger UI changes

4. **Document in progress.md**:
   ```markdown
   ## Manual Testing

   - [x] Component rendering: ✅ Pass
   - [x] Button clicks: ✅ Pass
   - [x] Extension messages: ✅ Pass
   - [ ] Edge case: ❌ Found bug with empty state
   ```

---

## Quality Standards (MANDATORY)

### Modern Angular Compliance

- [ ] **Standalone components** - no NgModules
- [ ] **Signal-based APIs** - `input()`, `output()`, `viewChild()`
- [ ] **Modern control flow** - `@if`, `@for`, `@switch`
- [ ] **OnPush change detection** - all components
- [ ] **No decorators** - use function-based APIs

### Type Safety

- [ ] **Strict types** - no `any` in component code
- [ ] **Shared types** - import from `@ptah/shared`
- [ ] **Template type checking** - enabled in tsconfig

### Performance

- [ ] **Lazy loading** - feature routes lazy loaded
- [ ] **Change detection optimization** - OnPush everywhere
- [ ] **Computed for derived state** - not manual recalculation

### Accessibility

- [ ] **Semantic HTML** - proper heading hierarchy
- [ ] **Keyboard navigation** - tab order makes sense
- [ ] **ARIA labels** - for interactive elements

---

## Completion Checklist

Before signaling completion:

- [ ] **All components created** (from implementation-plan.md)
- [ ] **Standalone components** (no NgModules)
- [ ] **Modern control flow** (`@if`, `@for`, `@switch` used)
- [ ] **OnPush change detection** (all components)
- [ ] **Extension communication working** (messages sent/received)
- [ ] **Build successful** (build:webview passes)
- [ ] **Manual testing completed** (documented in progress.md)
- [ ] **Progress.md up to date**
- [ ] **All changes committed**

---

## Completion Signal

Output exactly this format when done:

```markdown
## PHASE 4 (FRONTEND) COMPLETE ✅

**Implementation Summary**:

- **Components Created**: {count} ({list names})
- **Services Created**: {count} ({list names})
- **Shared Components Reused**: {count} ({list names})

**Modern Angular Compliance**:

- ✅ Standalone components: 100%
- ✅ Signal-based APIs: 100%
- ✅ Modern control flow: 100%
- ✅ OnPush change detection: 100%

**Build Status**:

- ✅ Webview build: Passed
- ✅ Type checking: Passed
- ✅ Linting: Passed

**Testing Status**:

- ✅ Manual testing: {count} scenarios validated
- ✅ Extension integration: Working

**Git Status**:

- **Commits**: {count} commits pushed
- **Branch**: feature/{TASK_ID}

**Progress Documentation**: task-tracking/{TASK_ID}/progress.md (updated)
```

---

## 📋 NEXT STEP - Validation Gate

Copy and paste this command into the chat:

```
/validation-gate PHASE_NAME="Phase 4 - Frontend Development" AGENT_NAME="frontend-developer" DELIVERABLE_PATH="Code changes + task-tracking/{TASK_ID}/progress.md" TASK_ID={TASK_ID}
```

**What happens next**: Business analyst will validate your implementation and decide APPROVE or REJECT.

---

**Begin frontend implementation now. Remember: Modern Angular patterns only.**
