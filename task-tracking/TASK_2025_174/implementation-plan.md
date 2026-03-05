# Implementation Plan - TASK_2025_174: Smart Prompt Suggestions Component

## Codebase Investigation Summary

### Libraries Discovered

- **@ptah-extension/chat** (`libs/frontend/chat/`) - Chat UI library with Atomic Design hierarchy

  - Key exports: Components, Services, Directives (via `src/index.ts`)
  - Documentation: `libs/frontend/chat/CLAUDE.md`
  - Component pattern: Angular 20+ standalone, `input()` / `output()` function API, `ChangeDetectionStrategy.OnPush`

- **lucide-angular** - Icon library used across all chat components
  - Already imported icons include: `Send`, `Zap`, `Square`, `Clock`, `Puzzle`, `ScanSearch`, `AlertTriangle`, `Bell`, `Sparkles`, `ArrowRight`, `Brain`, `Users`, `ChevronDown`, `Check`, `Star`, `Terminal`, `RefreshCw`, `ExternalLink`, `Copy`, `X`, `Info`, `FileEdit`, `CheckCircle`, `Cpu`, `MessageSquare`, `PlayCircle`, `XCircle`, `Trash2`, `Sun`, `Moon`

### Patterns Identified

**1. Angular 20+ Component Pattern** (used by all components in setup-plugins/):

- `input()` / `input.required<T>()` for reactive inputs
- `output<T>()` for event emitters (NOT `@Output EventEmitter`)
- `signal()` for local state
- `computed()` for derived state
- `ChangeDetectionStrategy.OnPush`
- Standalone components (no NgModules)
- Evidence: `plugin-status-widget.component.ts:135`, `file-tag.component.ts:52`

**2. Output Event Bubbling Pattern** (parent-child communication):

- Child emits via `output()`: `configureClicked = output<void>()` (plugin-status-widget.component.ts:135)
- Parent listens in template: `(configureClicked)="openPluginBrowser()"` (chat-empty-state.component.ts:177)
- This is the standard Angular pattern used throughout the codebase for child-to-parent communication
- Evidence: `plugin-browser-modal.component.ts:308-311` (closed, saved outputs)

**3. Chat Input Content Restoration** (cross-component communication):

- `ChatInputComponent.restoreContentToInput(content: string)` is a public method (chat-input.component.ts:745)
- Currently called via `ChatStore.queueRestoreContent` signal + `effect()` in constructor (chat-input.component.ts:776-798)
- `ChatViewComponent` has both `<ptah-chat-empty-state />` and `<ptah-chat-input />` as children in template (chat-view.component.html:67, 129)
- ChatViewComponent does NOT currently have a `viewChild` reference to `ChatInputComponent`
- Evidence: chat-view.component.html:67-68, 129

**4. DaisyUI + Egyptian Theme Pattern**:

- Glass panels: `glass-panel glass-panel-divine` classes
- Cards: `card bg-base-200/50 border border-base-300` with hover transitions
- Badges: `badge badge-sm badge-outline badge-secondary`
- Colors: `text-secondary` (Pharaoh's Gold), `text-primary` (Lapis Lazuli Blue)
- Font: `font-display` for Cinzel headers
- Hieroglyphic symbols: `U+13000` block characters
- Evidence: chat-empty-state.component.ts:148-269

**5. Tab Content Animation**:

- `.tab-content-animated` class with `fadeIn` keyframe animation
- Evidence: chat-empty-state.component.ts:421-435

### Integration Points

**ChatViewComponent** (template orchestrator):

- Location: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- Template: `chat-view.component.html`
- Currently renders `<ptah-chat-empty-state />` on line 67 with no bindings
- Currently renders `<ptah-chat-input />` on line 129 with no bindings
- Will need to wire output event from empty state to chat input via `viewChild`

**ChatEmptyStateComponent** (parent of new component):

- Location: `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts`
- Currently has static "Get Started" section (lines 247-269 in skills tab, 353-375 in setup tab)
- Will embed new `<ptah-prompt-suggestions>` component and forward its output event upward

**ChatInputComponent** (target for prompt fill):

- Location: `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`
- Has `restoreContentToInput(content: string)` public method (line 745)
- Has private `_currentMessage` signal (line 271)
- Has `textareaRef` viewChild for focus management (line 244)

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Output event bubbling through component hierarchy (PromptSuggestions -> ChatEmptyState -> ChatView -> ChatInput)

**Rationale**: This follows the established Angular pattern used by `PluginStatusWidgetComponent.configureClicked` -> `ChatEmptyStateComponent.openPluginBrowser()`. It avoids adding new signals to ChatStore (which is already a large facade at ~900 lines) for what is purely a UI interaction concern.

**Evidence**: `plugin-status-widget.component.ts:135`, `chat-empty-state.component.ts:177`

**Alternative Considered**: Adding a `promptSuggestionContent` signal to ChatStore (similar to `queueRestoreContent`). Rejected because this is a simple UI click-to-fill action, not a cross-cutting state concern. The ChatStore signal pattern is designed for async operations across service boundaries (streaming completion triggers queue restore), not for synchronous UI events.

### Component Specifications

#### Component 1: PromptSuggestionsComponent (CREATE)

**Purpose**: Display categorized, clickable prompt suggestion cards that users can click to fill the chat input with intelligent prompts. Replaces the static "Get Started" mockup-code section.

**Pattern**: Molecule component (combination of styled cards with event emission)
**Evidence**: Follows same pattern as `PluginStatusWidgetComponent` (setup-plugins/plugin-status-widget.component.ts) - standalone, `output()`, `ChangeDetectionStrategy.OnPush`

**Responsibilities**:

- Define prompt suggestion data (categories with icons, prompts with text)
- Render categorized prompt cards in a compact, scrollable layout
- Emit selected prompt text to parent on click
- Optional: Track which category is expanded (accordion-style for narrow sidebar)

**Implementation Pattern**:

```typescript
// Pattern source: plugin-status-widget.component.ts, file-tag.component.ts
import { Component, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule /* icons */ } from 'lucide-angular';

interface PromptCategory {
  id: string;
  label: string;
  icon: LucideIconData; // Lucide icon reference
  hieroglyph: string; // Egyptian Unicode symbol
  prompts: PromptItem[];
}

interface PromptItem {
  label: string; // Short display label
  text: string; // Full prompt text to insert
  description?: string; // Optional tooltip/subtext
}

@Component({
  selector: 'ptah-prompt-suggestions',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // inline template + styles (follows chat-empty-state pattern)
})
export class PromptSuggestionsComponent {
  /** Emitted when user clicks a prompt suggestion */
  readonly promptSelected = output<string>();

  /** Currently expanded category (null = all collapsed) */
  readonly expandedCategory = signal<string | null>(null);

  /** Prompt categories with intelligent suggestions */
  readonly categories: PromptCategory[] = [
    /* defined inline */
  ];

  /** Toggle category expansion (accordion behavior) */
  toggleCategory(categoryId: string): void {
    this.expandedCategory.update((current) => (current === categoryId ? null : categoryId));
  }

  /** Handle prompt click - emit the full prompt text */
  selectPrompt(prompt: PromptItem): void {
    this.promptSelected.emit(prompt.text);
  }
}
```

**Prompt Categories and Items**:

| Category          | Icon          | Hieroglyph | Prompts                                                                                                                                                                                                                      |
| ----------------- | ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build**         | `Sparkles`    | `𓂀`        | `/orchestrate Add user authentication with OAuth2 and JWT tokens`, `/orchestrate Create a REST API endpoint for [resource] with CRUD operations`, `/orchestrate Build a responsive dashboard page with charts and metrics`   |
| **Fix & Improve** | `RefreshCw`   | `𓁹`        | `/orchestrate BUGFIX: Fix [describe the bug you're seeing]`, `/simplify Review my recent changes for code quality and reuse opportunities`, `/orchestrate REFACTORING: Modernize [component/module] to use current patterns` |
| **Review**        | `CheckCircle` | `𓅓`        | `/review-code Check the current branch for code quality issues`, `/review-logic Verify business logic correctness in [module]`, `/review-security Scan for security vulnerabilities in authentication flow`                  |
| **Explore**       | `ScanSearch`  | `𓀀`        | `/orchestrate RESEARCH: Analyze the codebase architecture and document key patterns`, `/orchestrate DOCUMENTATION: Generate API documentation for [module]`, `Explain how [feature/system] works in this codebase`           |

**Note on prompt text**: The prompts use actual slash commands from the orchestration skill (`/orchestrate`, `/review-code`, `/review-logic`, `/review-security`, `/simplify`) with placeholder brackets `[...]` that the user can customize. The bracketed portions are guides, not literal text.

**Template Structure**:

The component uses an accordion pattern to keep things compact in the narrow sidebar (~300px). Each category header is clickable to expand/collapse its prompts. When expanded, prompts appear as compact clickable rows with a subtle hover effect.

```html
<!-- Section header -->
<div class="flex items-center gap-2 mb-3">
  <span class="text-secondary text-base">📜</span>
  <h3 class="text-xs md:text-sm font-semibold text-secondary uppercase tracking-wider">Get Started</h3>
  <div class="divider divider-horizontal flex-1 my-0 before:bg-secondary/20 after:bg-transparent"></div>
</div>

<!-- Category accordion -->
@for (category of categories; track category.id) {
<!-- Category header (clickable) -->
<button
  class="w-full flex items-center gap-2 p-2 rounded-lg
           bg-base-200/30 hover:bg-base-200/60 transition-all duration-200
           border border-transparent hover:border-base-300 mb-1.5"
  (click)="toggleCategory(category.id)"
  type="button"
>
  <span class="text-sm">{{ category.hieroglyph }}</span>
  <lucide-angular [img]="category.icon" class="w-3.5 h-3.5 text-secondary/70" />
  <span class="text-xs font-medium flex-1 text-left">{{ category.label }}</span>
  <lucide-angular [img]="ChevronRightIcon" class="w-3 h-3 text-base-content/40 transition-transform duration-200" [class.rotate-90]="expandedCategory() === category.id" />
</button>

<!-- Expanded prompts -->
@if (expandedCategory() === category.id) {
<div class="pl-2 mb-2 space-y-1 tab-content-animated">
  @for (prompt of category.prompts; track prompt.label) {
  <button
    class="w-full text-left px-3 py-2 rounded-md text-xs
                 bg-base-300/30 hover:bg-primary/10 hover:text-primary
                 border border-transparent hover:border-primary/20
                 transition-all duration-150 cursor-pointer group"
    (click)="selectPrompt(prompt)"
    [title]="prompt.text"
    type="button"
  >
    <span class="group-hover:text-primary">{{ prompt.label }}</span>
    @if (prompt.description) {
    <span class="block text-[10px] text-base-content/40 mt-0.5 group-hover:text-primary/60"> {{ prompt.description }} </span>
    }
  </button>
  }
</div>
} }
```

**Quality Requirements**:

- Must use `ChangeDetectionStrategy.OnPush`
- Must be `standalone: true`
- Must use `output()` function API (not `@Output EventEmitter`)
- Must use `signal()` for expandedCategory state
- All interactive elements must have `type="button"` and meaningful `title`/`aria-label`
- Must render well at ~300px sidebar width (no overflow, no truncation of prompt labels)
- Hover states must feel responsive (150-200ms transitions)
- Accordion animation must use the existing `tab-content-animated` class pattern

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/setup-plugins/prompt-suggestions.component.ts` (CREATE)

---

#### Component 2: ChatEmptyStateComponent (MODIFY)

**Purpose**: Embed the new `PromptSuggestionsComponent` in place of the two static "Get Started" sections, and forward the `promptSelected` output event upward to the parent `ChatViewComponent`.

**Pattern**: Add output event and forward child event (same pattern as `configureClicked` forwarding from PluginStatusWidget)
**Evidence**: chat-empty-state.component.ts:177, 459-461

**Changes Required**:

1. **Add import** for `PromptSuggestionsComponent`
2. **Add to `imports` array** in `@Component` decorator
3. **Add `output()`** for `promptSelected` event
4. **Replace** both static "Get Started" sections (skills tab lines 247-269, setup tab lines 353-375) with `<ptah-prompt-suggestions (promptSelected)="promptSelected.emit($event)" />`
5. **Remove** the second duplicate "Get Started" section from the setup tab (it's currently identical)

**Implementation Pattern**:

```typescript
// In component class:
import { PromptSuggestionsComponent } from './prompt-suggestions.component';

// Add to imports array:
imports: [
  // ... existing imports
  PromptSuggestionsComponent,
],

// Add output:
readonly promptSelected = output<string>();
```

```html
<!-- Replace the static "Get Started" card with: -->
<ptah-prompt-suggestions (promptSelected)="promptSelected.emit($event)" />
```

**Quality Requirements**:

- Both "Get Started" sections (in both tabs) must be replaced with the new component
- The output event must use the exact same `output<string>()` signature
- No other changes to the component (preserve all existing functionality)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts` (MODIFY)

---

#### Component 3: ChatViewComponent (MODIFY)

**Purpose**: Wire the `promptSelected` output from `ChatEmptyStateComponent` to `ChatInputComponent.restoreContentToInput()` using a `viewChild` reference.

**Pattern**: `viewChild` + event handler method (Angular 20+ signal-based viewChild pattern)
**Evidence**: `chat-view.component.ts:92-93` (already uses `viewChild` for messageContainer), `chat-input.component.ts:745` (restoreContentToInput is public)

**Changes Required**:

1. **Add `viewChild` reference** to `ChatInputComponent`
2. **Add event handler method** `handlePromptSelected(promptText: string)`
3. **Update template** to bind `(promptSelected)` on `<ptah-chat-empty-state>`

**Implementation Pattern**:

```typescript
// In ChatViewComponent class:

/** Signal-based viewChild for chat input (Angular 20+ pattern) */
private readonly chatInputRef = viewChild(ChatInputComponent);

/** Handle prompt selection from empty state - fill chat input */
handlePromptSelected(promptText: string): void {
  const chatInput = this.chatInputRef();
  if (chatInput) {
    chatInput.restoreContentToInput(promptText);
  }
}
```

```html
<!-- In chat-view.component.html, update line 67: -->
<ptah-chat-empty-state (promptSelected)="handlePromptSelected($event)" />
```

**Quality Requirements**:

- Must use signal-based `viewChild()` (not `@ViewChild` decorator) to match existing pattern at line 92
- The `restoreContentToInput` method already handles focus and textarea resize (chat-input.component.ts:760-766)
- No need to add a `#chatInput` template variable since `viewChild(ChatInputComponent)` uses type-based query

**Files Affected**:

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (MODIFY)
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` (MODIFY)

---

## Integration Architecture

### Event Flow (Prompt Click to Input Fill)

```
User clicks prompt card
    |
    v
PromptSuggestionsComponent
    | promptSelected.emit("prompt text")
    v
ChatEmptyStateComponent (template binding)
    | (promptSelected)="promptSelected.emit($event)"
    v
ChatViewComponent (template binding)
    | (promptSelected)="handlePromptSelected($event)"
    v
ChatViewComponent.handlePromptSelected()
    | this.chatInputRef()?.restoreContentToInput(promptText)
    v
ChatInputComponent.restoreContentToInput()
    | Sets _currentMessage signal
    | Focuses textarea
    | Auto-resizes textarea height
```

### Data Flow

- **Input**: None (prompt data is static, defined in PromptSuggestionsComponent)
- **Output**: `string` (the full prompt text to insert into chat input)
- **No services needed**: This is a pure UI interaction with no backend calls

### Dependencies

- **External**: `lucide-angular` (already a dependency of the chat library)
- **Internal**: No new library dependencies. All components are within `@ptah-extension/chat`

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

- Clicking a prompt card must fill the chat input textarea with the prompt text
- The textarea must receive focus after fill (already handled by `restoreContentToInput`)
- Prompt text must use real slash commands that the orchestration system understands
- Accordion categories must toggle independently (one open at a time)
- The component must render correctly in a ~300px sidebar width
- Both tabs (Skills and Setup) should show the prompt suggestions in place of "Get Started"

### Non-Functional Requirements

- **Performance**: No services injected, no RPC calls, no subscriptions. Pure presentational component with static data. Zero performance impact.
- **Maintainability**: Prompt data defined as a typed constant array, easy to add/modify prompts
- **Accessibility**: All clickable elements must be `<button>` elements with `type="button"`, have meaningful `title` attributes, and support keyboard navigation (Tab + Enter)
- **Design Consistency**: Must use the same DaisyUI classes, Egyptian hieroglyphs, and color scheme as the parent `ChatEmptyStateComponent`

### Pattern Compliance

- `ChangeDetectionStrategy.OnPush` (all components in chat library: verified across 48+ components)
- `standalone: true` (all components in chat library: verified)
- `output()` function API (verified at file-tag.component.ts:52, plugin-status-widget.component.ts:135)
- `signal()` for local state (verified across all chat components)
- Signal-based `viewChild()` (verified at chat-view.component.ts:92-93)
- Inline template + styles for molecules (verified at chat-empty-state.component.ts:65-451)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**: This is purely a UI component task with no backend changes:

- New Angular component creation (PromptSuggestionsComponent)
- Template modifications (ChatEmptyState, ChatView)
- DaisyUI/Tailwind styling
- Output event wiring between components
- No services, no RPC calls, no backend logic

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 1-2 hours

**Breakdown**:

- PromptSuggestionsComponent creation: 30-45 min (template, styles, prompt data, accordion logic)
- ChatEmptyStateComponent modification: 15 min (import, embed, forward output)
- ChatViewComponent wiring: 15 min (viewChild, handler method, template binding)
- Testing & polish: 15-30 min (visual verification in sidebar, hover states, accessibility)

### Files Affected Summary

**CREATE**:

- `libs/frontend/chat/src/lib/components/molecules/setup-plugins/prompt-suggestions.component.ts`

**MODIFY**:

- `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `output` from `@angular/core` (verified: file-tag.component.ts:4)
   - `viewChild` from `@angular/core` (verified: chat-view.component.ts:6)
   - `LucideAngularModule` from `lucide-angular` (verified: chat-empty-state.component.ts:14)
   - Lucide icons: `Sparkles` (notification-bell.component.ts), `RefreshCw` (compaction-notification.component.ts), `CheckCircle` (diff-display.component.ts), `ScanSearch` (chat-empty-state.component.ts:12), `ChevronRight` (expandable-content.component.ts)

2. **All patterns verified from examples**:

   - `output<string>()` pattern: file-tag.component.ts:52 (uses `output<void>()`, same API)
   - `viewChild(ComponentType)` pattern: chat-view.component.ts:92-93 (uses `viewChild<ElementRef>`)
   - `signal<string | null>(null)` pattern: chat-input.component.ts:229
   - Accordion toggle pattern: thinking-block.component.ts uses similar expand/collapse

3. **`restoreContentToInput` is public and safe to call**:

   - Defined at chat-input.component.ts:745
   - Guards against overwriting user input (line 747: checks if `_currentMessage` is non-empty)
   - Handles focus and auto-resize (lines 760-766)

4. **No hallucinated APIs**:
   - All Lucide icon names verified in existing imports across the codebase
   - `output()` function verified (Angular 20+ API, used in 5+ components in chat library)
   - `viewChild()` function verified (Angular 20+ API, used in chat-view.component.ts:92)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented (event flow diagram)
- [x] Files affected list complete (1 CREATE, 3 MODIFY)
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (LOW-MEDIUM, 1-2 hours)
- [x] No step-by-step implementation instructions (that is the team-leader's responsibility)
- [x] No backward compatibility layers (direct replacement of static sections)
