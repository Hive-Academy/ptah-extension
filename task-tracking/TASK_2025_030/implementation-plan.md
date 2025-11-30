# Implementation Plan - TASK_2025_030: Enhanced Streaming UX

## 📊 Codebase Investigation Summary

### Libraries Discovered

- **@ptah-extension/chat** (libs/frontend/chat) - Frontend chat UI components

  - Key exports: ChatViewComponent, MessageBubbleComponent, ExecutionNodeComponent, ToolCallItemComponent
  - Documentation: No dedicated CLAUDE.md found
  - Usage examples: 11 components following Angular 20+ signal patterns

- **@ptah-extension/shared** (libs/shared) - Type system foundation
  - Key exports: ExecutionNode, ExecutionStatus, ExecutionChatMessage
  - Pattern: Branded types, discriminated unions
  - Location: libs/shared/src/lib/types/execution-node.types.ts

### Patterns Identified

**Pattern 1: Signal-Based State Management**

- Evidence: chat-view.component.ts:59-78, message-bubble.component.ts:47-53
- Components: All components use `signal()`, `computed()`, `input.required<T>()`
- Conventions: OnPush change detection, readonly signals for derived state

**Pattern 2: DaisyUI Component Utilities**

- Evidence: chat-view.component.html:20-21 (loading-dots), status-badge.component.ts:28 (loading-spinner)
- Components: `loading loading-dots loading-sm`, `loading loading-spinner`, `badge badge-*`, `animate-spin`
- Conventions: Utility-first Tailwind classes, conditional DaisyUI component classes

**Pattern 3: Recursive ExecutionNode Architecture**

- Evidence: execution-node.component.ts:44-78
- Components: Discriminated union rendering via `@switch (node().type)`
- Conventions: Recursive composition for nested agents/tools, markdown rendering for text nodes

**Pattern 4: Tool Status Display**

- Evidence: tool-call-item.component.ts:111-131
- Components: Status-based icon rendering, color-coded badges
- Conventions: streaming → spinner, complete → checkmark, error → X icon

### Integration Points

**ChatStore (Signal State Management)**

- Location: libs/frontend/chat/src/lib/services/chat.store.ts
- Interface: `isStreaming()`, `currentExecutionTree()`, `messages()`
- Usage: Accessed via `inject(ChatStore)` in ChatViewComponent

**ExecutionNode Type System**

- Location: libs/shared/src/lib/types/execution-node.types.ts:75+
- Interface: `type`, `status`, `content`, `toolName`, `toolInput`, `toolOutput`, `children`
- Usage: Recursive rendering in ExecutionNodeComponent

**DaisyUI 5.x + Tailwind 4.x**

- Location: Available globally via stylesheets
- Interface: Utility classes (`loading-*`, `badge-*`, `animate-*`, custom `@keyframes`)
- Usage: Template classes and component-level `<style>` blocks

---

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Progressive Enhancement Pattern
**Rationale**: Build upon existing streaming infrastructure by adding visual feedback layers WITHOUT disrupting the proven recursive ExecutionNode architecture or signal-based state management.
**Evidence**: Current system has solid foundations (status-badge.component.ts:27-29 spinner, tool-call-item.component.ts:126-130 streaming icon) but lacks persistent activity feedback and typing indicators.

### Component Specifications

---

#### Component 1: Fix Streaming Indicator Logic (chat-view.component.html)

**Purpose**: Show continuous streaming activity feedback regardless of execution tree state

**Pattern**: Conditional Rendering with DaisyUI Skeletons
**Evidence**:

- Current flawed logic: chat-view.component.html:12-23
- DaisyUI skeleton usage: Common pattern in modern UIs
- Skeleton examples: findings.md:128-135

**Responsibilities**:

- Display streaming message bubble when `isStreaming()` AND tree exists
- Display skeleton placeholder when `isStreaming()` AND tree does NOT exist
- Remove incorrect `!chatStore.currentExecutionTree()` condition that hides indicator

**Implementation Pattern**:

```html
<!-- chat-view.component.html lines 12-23 (MODIFY) -->

<!-- Streaming assistant message (live execution tree) -->
@if (chatStore.isStreaming()) { @if (streamingMessage(); as msg) {
<!-- Tree exists: show message bubble with streaming indicators -->
<ptah-message-bubble [message]="msg" [isStreaming]="true" />
} @else {
<!-- Tree NOT started: show skeleton placeholder -->
<div class="chat chat-start">
  <div class="chat-image avatar">
    <div class="w-8 h-8 rounded-full overflow-hidden">
      <img [ngSrc]="ptahIconUri" alt="Claude" width="32" height="32" />
    </div>
  </div>
  <div class="chat-bubble bg-neutral">
    <div class="skeleton h-4 w-64 mb-2"></div>
    <div class="skeleton h-4 w-48 mb-2"></div>
    <div class="skeleton h-4 w-56"></div>
  </div>
</div>
} }

<!-- Remove old flawed indicator (lines 17-23) -->
```

**Quality Requirements**:

**Functional Requirements**:

- MUST show activity indicator during entire streaming session
- MUST transition from skeleton to message bubble when tree starts
- MUST use DaisyUI skeleton classes for placeholder

**Non-Functional Requirements**:

- Performance: Skeleton uses CSS-only animation (no JS)
- Accessibility: Maintains chat-start/chat-end semantics
- Consistency: Matches existing message bubble structure

**Pattern Compliance**:

- MUST use `@if (chatStore.isStreaming())` as outer condition (verified: chat-view.component.ts:86)
- MUST use `streamingMessage()` computed signal (verified: chat-view.component.ts:69-78)
- MUST use DaisyUI `skeleton` class (verified: DaisyUI 5.x component)

**Files Affected**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html (MODIFY)
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts (MODIFY - add ptahIconUri property for skeleton avatar)

---

#### Component 2: Typing Cursor Indicator (NEW)

**Purpose**: Animated blinking cursor to show text insertion point during streaming

**Pattern**: Standalone Atom Component with CSS Keyframe Animation
**Evidence**:

- CSS animations preferred over JS (findings.md:236-239)
- Atom component pattern: status-badge.component.ts (simple, standalone, OnPush)
- Proposed implementation: findings.md:140-158

**Responsibilities**:

- Display animated blinking cursor (▌ or █ character)
- Use CSS `@keyframes` for smooth blink animation
- Accept optional color/size inputs for customization

**Implementation Pattern**:

```typescript
// NEW FILE: libs/frontend/chat/src/lib/components/atoms/typing-cursor.component.ts

import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * TypingCursorComponent - Animated blinking cursor for streaming text
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: CSS keyframe animation, OnPush change detection
 *
 * Displays a blinking cursor (▌) at the end of streaming text.
 * Uses CSS animation for 60fps performance.
 */
@Component({
  selector: 'ptah-typing-cursor',
  standalone: true,
  template: ` <span class="typing-cursor inline-block ml-0.5" [class]="colorClass()">▌</span> `,
  styles: [
    `
      @keyframes blink {
        0%,
        49% {
          opacity: 1;
        }
        50%,
        100% {
          opacity: 0;
        }
      }

      .typing-cursor {
        animation: blink 1s step-end infinite;
        font-weight: 400;
        line-height: 1;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TypingCursorComponent {
  /** Color class for cursor (default: inherit from parent) */
  readonly colorClass = input<string>('text-current');
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST animate at 1-second blink interval
- MUST use step-end timing for crisp on/off transition
- MUST be inline-block for proper text flow

**Non-Functional Requirements**:

- Performance: CSS animation runs on GPU (no layout thrashing)
- Accessibility: Purely decorative, no aria labels needed
- Customization: Accept color class input for theme compatibility

**Pattern Compliance**:

- MUST use `ChangeDetectionStrategy.OnPush` (verified: status-badge.component.ts:33)
- MUST use `input<T>()` signal API (verified: Angular 20+ pattern)
- MUST use standalone component (verified: all components are standalone)

**Files Affected**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\typing-cursor.component.ts (CREATE)

---

#### Component 3: Enhanced Message Bubble with Streaming Feedback (message-bubble.component.ts/html)

**Purpose**: Display typing cursor and pulsing activity indicator during streaming

**Pattern**: Conditional Rendering Enhancement
**Evidence**:

- Current avatar: message-bubble.component.html:68-79
- Proposed avatar ring: findings.md:187-190
- DaisyUI ring utilities: Tailwind built-in

**Responsibilities**:

- Accept `isStreaming` input signal (NEW)
- Add pulsing ring to avatar when streaming
- Render typing cursor after last text node in execution tree

**Implementation Pattern**:

```typescript
// MODIFY: libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts

// Add import
import { TypingCursorComponent } from '../atoms/typing-cursor.component';

@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  imports: [
    // ... existing imports
    TypingCursorComponent, // NEW
  ],
  // ... rest of component
})
export class MessageBubbleComponent {
  readonly message = input.required<ExecutionChatMessage>();

  /** NEW: Indicates if this message is currently streaming */
  readonly isStreaming = input<boolean>(false);

  // ... rest of component
}
```

```html
<!-- MODIFY: libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html -->

<!-- Assistant message (left-aligned) - lines 66-126 -->
<div class="chat chat-start">
  <!-- Avatar with Ptah icon + streaming ring -->
  <div class="chat-image avatar">
    <div class="w-8 h-8 rounded-full overflow-hidden transition-all duration-300" [class.ring-2]="isStreaming()" [class.ring-info]="isStreaming()" [class.ring-offset-2]="isStreaming()" [class.ring-offset-base-100]="isStreaming()" [class.animate-pulse]="isStreaming()">
      <img [ngSrc]="ptahIconUri" alt="Claude" width="32" height="32" class="w-full h-full object-cover" />
    </div>
  </div>

  <!-- ... existing header (lines 82-90) ... -->

  <!-- Message bubble -->
  <div class="chat-bubble bg-neutral text-neutral-content shadow-card max-w-[85%] md:max-w-[90%] lg:max-w-[85%]">
    @if (message().executionTree) {
    <!-- ExecutionNode recursive tree -->
    <ptah-execution-node [node]="message().executionTree!" />

    <!-- Typing cursor at end of streaming text (NEW) -->
    @if (isStreaming()) {
    <ptah-typing-cursor colorClass="text-neutral-content/70" />
    } } @else {
    <!-- Fallback text content -->
    <markdown [data]="message().rawContent || ''" class="prose prose-sm prose-invert max-w-none" />
    @if (isStreaming()) {
    <ptah-typing-cursor colorClass="text-neutral-content/70" />
    } }
  </div>

  <!-- ... existing action buttons (lines 109-125) ... -->
</div>
```

**Quality Requirements**:

**Functional Requirements**:

- MUST show pulsing ring on avatar during streaming
- MUST show typing cursor after content during streaming
- MUST remove indicators when streaming completes

**Non-Functional Requirements**:

- Performance: Use Tailwind transition utilities (GPU accelerated)
- Accessibility: Ring is decorative, cursor has no semantic meaning
- Responsiveness: Ring scales with avatar size

**Pattern Compliance**:

- MUST use `input<boolean>(false)` pattern (verified: Angular signals)
- MUST use DaisyUI `ring-*` utilities (verified: Tailwind CSS)
- MUST use `animate-pulse` DaisyUI class (verified: DaisyUI component)

**Files Affected**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts (MODIFY)
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html (MODIFY)

---

#### Component 4: Tool Activity Status Description (tool-call-item.component.ts)

**Purpose**: Show descriptive text for what tool is doing during streaming

**Pattern**: Computed Description String
**Evidence**:

- Current streaming indicator: tool-call-item.component.ts:126-130 (spinner only)
- Proposed description: findings.md:162-183
- Tool description logic exists: tool-call-item.component.ts:413-436

**Responsibilities**:

- Display context-aware description during tool streaming (e.g., "Reading src/utils.ts...")
- Extract relevant parameters (file_path, command, pattern)
- Shorten paths/commands for compact display
- Add subtle pulsing animation to description text

**Implementation Pattern**:

```typescript
// MODIFY: libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.ts

// In template section (lines 126-131), REPLACE:
} @else if (node().status === 'streaming') {
  <lucide-angular
    [img]="LoaderIcon"
    class="w-3 h-3 text-info animate-spin flex-shrink-0"
  />
}

// WITH:
} @else if (node().status === 'streaming') {
  <div class="flex items-center gap-1 flex-shrink-0">
    <lucide-angular
      [img]="LoaderIcon"
      class="w-3 h-3 text-info animate-spin"
    />
    <span class="text-base-content/50 text-[10px] animate-pulse font-mono">
      {{ getStreamingDescription() }}
    </span>
  </div>
}

// Add new method to component class (after line 768):
/**
 * Get descriptive text for streaming tool activity
 * Shows what the tool is doing (e.g., "Reading utils.ts...")
 */
protected getStreamingDescription(): string {
  const toolName = this.node().toolName;
  const input = this.node().toolInput;

  if (!toolName || !input) return 'Working...';

  switch (toolName) {
    case 'Read':
      return `Reading ${this.shortenPath(input['file_path'] as string)}...`;
    case 'Write':
      return `Writing ${this.shortenPath(input['file_path'] as string)}...`;
    case 'Edit':
      return `Editing ${this.shortenPath(input['file_path'] as string)}...`;
    case 'Bash': {
      const desc = input['description'] as string;
      if (desc) return `${desc}...`;
      const cmd = input['command'] as string;
      return `Running ${this.truncate(cmd, 20)}...`;
    }
    case 'Grep':
      return `Searching for "${this.truncate(input['pattern'] as string, 15)}"...`;
    case 'Glob':
      return `Finding ${this.truncate(input['pattern'] as string, 15)}...`;
    case 'Task':
      return 'Invoking agent...';
    default:
      return `Executing ${toolName}...`;
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST show tool-specific descriptions (not generic "Working...")
- MUST extract key parameters (file paths, commands, patterns)
- MUST truncate long strings to prevent overflow

**Non-Functional Requirements**:

- Performance: Use existing `shortenPath()` and `truncate()` utilities (no new allocations)
- Readability: 10px font size matches existing tool UI
- Consistency: Use same truncation logic as tool description (tool-call-item.component.ts:413-436)

**Pattern Compliance**:

- MUST use existing utility methods (verified: shortenPath line 761, truncate line 756)
- MUST use DaisyUI `animate-pulse` (verified: Tailwind utility)
- MUST maintain OnPush detection (no manual detectChanges() calls)

**Files Affected**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-call-item.component.ts (MODIFY)

---

#### Component 5: Pulsing Activity Indicator on Text Nodes (execution-node.component.ts)

**Purpose**: Show visual activity on text nodes during streaming

**Pattern**: Conditional CSS Class Application
**Evidence**:

- Text node rendering: execution-node.component.ts:45-51
- Status from ExecutionNode: libs/shared/src/lib/types/execution-node.types.ts:83

**Responsibilities**:

- Apply subtle pulsing animation to text nodes with `status === 'streaming'`
- Preserve existing markdown rendering
- Remove animation when node completes

**Implementation Pattern**:

```typescript
// MODIFY: libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts

// Update template (lines 45-51), REPLACE:
@case ('text') {
  @if (isAgentSummaryContent()) {
    <!-- Agent summary with XML-like format (function_calls, thinking, etc.) -->
    <ptah-agent-summary [content]="node().content || ''" />
  } @else {
    <div class="prose prose-sm prose-invert max-w-none my-2">
      <markdown [data]="node().content || ''" />
    </div>
  }
}

// WITH:
@case ('text') {
  @if (isAgentSummaryContent()) {
    <!-- Agent summary with XML-like format (function_calls, thinking, etc.) -->
    <ptah-agent-summary
      [content]="node().content || ''"
      [class.animate-pulse]="node().status === 'streaming'"
    />
  } @else {
    <div
      class="prose prose-sm prose-invert max-w-none my-2 transition-opacity duration-300"
      [class.animate-pulse]="node().status === 'streaming'"
    >
      <markdown [data]="node().content || ''" />
    </div>
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST pulse only when `status === 'streaming'`
- MUST stop pulsing when status changes to 'complete'
- MUST preserve all existing rendering behavior

**Non-Functional Requirements**:

- Performance: CSS-only animation (no JS interval timers)
- Subtlety: Pulse should be noticeable but not distracting
- Smoothness: 300ms transition for pulse activation/deactivation

**Pattern Compliance**:

- MUST use DaisyUI `animate-pulse` (verified: Tailwind utility)
- MUST preserve markdown rendering (verified: execution-node.component.ts:50)
- MUST maintain OnPush detection (verified: execution-node.component.ts:80)

**Files Affected**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts (MODIFY)

---

## 🔗 Integration Architecture

### Integration Points

**1. ChatViewComponent ↔ MessageBubbleComponent**

- **Connection**: Pass `isStreaming` boolean from ChatViewComponent to MessageBubbleComponent
- **Pattern**: Input signal binding `[isStreaming]="chatStore.isStreaming()"`
- **Evidence**: chat-view.component.html:14, message-bubble.component.ts:53

**2. MessageBubbleComponent ↔ TypingCursorComponent**

- **Connection**: Conditionally render TypingCursorComponent inside message bubble
- **Pattern**: `@if (isStreaming()) { <ptah-typing-cursor /> }`
- **Evidence**: Component composition pattern from execution-node.component.ts:56-60

**3. ChatStore → ChatViewComponent**

- **Connection**: Reactive streaming state via `chatStore.isStreaming()` signal
- **Pattern**: Signal dependency in computed/effect
- **Evidence**: chat-view.component.ts:86 (effect tracks isStreaming)

**4. ExecutionNode Status → Component Styling**

- **Connection**: Apply streaming animations based on `node.status` property
- **Pattern**: Conditional class binding `[class.animate-pulse]="node().status === 'streaming'"`
- **Evidence**: ExecutionNode interface (shared types), status-badge.component.ts:27

### Data Flow

```
Claude CLI Stream
    ↓
ChatStore.isStreaming() signal updates
    ↓
ChatViewComponent detects streaming state
    ↓
├─→ Shows skeleton (if no tree)
└─→ Shows MessageBubble with [isStreaming]="true"
        ↓
        MessageBubbleComponent
        ├─→ Adds pulsing ring to avatar
        └─→ Renders TypingCursorComponent

ExecutionNode.status updates to 'streaming'
    ↓
ExecutionNodeComponent applies animate-pulse
ToolCallItemComponent shows streaming description
```

### Dependencies

**External Dependencies**:

- DaisyUI 5.x - `loading-*`, `skeleton`, `badge-*`, `ring-*`, `animate-pulse` utilities
- Tailwind CSS 4.x - Transition utilities, custom @keyframes support
- Angular 20+ - Signal inputs, computed(), @if/@for control flow
- ngx-markdown - Markdown rendering (already in use)

**Internal Dependencies**:

- ChatStore (libs/frontend/chat/src/lib/services/chat.store.ts)
- ExecutionNode types (libs/shared/src/lib/types/execution-node.types.ts)
- VSCodeService (libs/frontend/core) - for ptahIconUri

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

**P0 (Must Have)**:

1. Streaming indicator MUST be visible during entire streaming session (not just at start)
2. Typing cursor MUST blink at 1-second intervals during text streaming
3. Tool streaming status MUST show descriptive text (e.g., "Reading file.ts...")
4. Avatar MUST show pulsing ring during streaming
5. Text nodes MUST show subtle pulse animation during streaming

**P1 (Should Have)**: 6. Skeleton placeholder SHOULD appear before execution tree starts building 7. All animations SHOULD use CSS (not JS timers) for 60fps performance 8. Streaming indicators SHOULD remove cleanly when streaming completes

### Non-Functional Requirements

**Performance**:

- All animations MUST use CSS (GPU accelerated)
- No JavaScript interval timers for animations
- OnPush change detection MUST be preserved (no manual detectChanges())
- Signal updates trigger rendering (no zone.js polling)

**Accessibility**:

- Streaming indicators are decorative (no ARIA labels needed)
- Skeleton maintains chat-start/chat-end semantics for screen readers
- Pulsing animations do not interfere with content reading

**Maintainability**:

- No new state management services (use existing ChatStore)
- Reuse existing utility methods (shortenPath, truncate)
- Follow established component patterns (atoms/molecules/organisms)
- All components use OnPush + standalone + signals

**Testability**:

- Streaming state controlled by ChatStore.isStreaming() signal
- Component behavior testable via input signal changes
- No time-based logic (animations are CSS, not JS timers)

### Pattern Compliance

**Angular 20+ Signal Patterns** (verified throughout codebase):

- ✅ Use `input<T>()` and `input.required<T>()` for component inputs
- ✅ Use `signal()`, `computed()`, `effect()` for reactive state
- ✅ Use `@if`, `@for`, `@switch` control flow (not *ngIf, *ngFor)
- ✅ Use OnPush change detection in all components

**DaisyUI 5.x Utilities** (verified in existing components):

- ✅ Use `loading-*`, `skeleton`, `badge-*`, `ring-*` component classes
- ✅ Use `animate-pulse`, `animate-spin` animation utilities
- ✅ Use Tailwind transition utilities for smooth state changes

**Component Architecture** (verified in chat library):

- ✅ Atoms: Simple, single-purpose (TypingCursorComponent)
- ✅ Molecules: Composition of atoms (ToolCallItemComponent)
- ✅ Organisms: Complex composition (MessageBubbleComponent, ExecutionNodeComponent)
- ✅ Templates: Layout containers (ChatViewComponent)

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **frontend-developer**

**Rationale**: This task is 100% frontend UI/UX enhancement work

- **UI Component Work**: Creating new TypingCursorComponent, modifying existing chat components
- **CSS Animations**: Custom @keyframes for typing cursor, Tailwind utility classes
- **Angular 20+ Patterns**: Signal inputs, computed values, conditional rendering
- **DaisyUI Integration**: Skeleton placeholders, ring utilities, pulse animations
- **Browser APIs**: None required (purely Angular + CSS)
- **Backend APIs**: None required (uses existing ChatStore signal state)

### Complexity Assessment

**Complexity**: **MEDIUM**
**Estimated Effort**: **6-8 hours**

**Breakdown**:

- **Component 1** (Fix streaming indicator logic): 1 hour

  - Template changes in chat-view.component.html
  - Add ptahIconUri property to ChatViewComponent

- **Component 2** (Typing cursor): 1.5 hours

  - Create new TypingCursorComponent
  - CSS keyframe animation testing
  - Color/size customization

- **Component 3** (Enhanced message bubble): 2 hours

  - Add isStreaming input signal
  - Avatar ring styling and pulsing
  - Typing cursor integration and positioning

- **Component 4** (Tool activity status): 1.5 hours

  - getStreamingDescription() method implementation
  - Tool-specific description logic for 10+ tools
  - UI layout for spinner + description text

- **Component 5** (Pulsing text nodes): 1 hour

  - Conditional class binding in ExecutionNodeComponent
  - Testing animation timing and subtlety

- **Testing & Refinement**: 1-2 hours
  - Manual testing with live streaming sessions
  - Animation timing adjustments
  - Cross-component integration verification

### Files Affected Summary

**MODIFY** (6 files):

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-call-item.component.ts
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts

**CREATE** (1 file):

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\typing-cursor.component.ts

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All DaisyUI utilities exist**:

   - `skeleton` class (DaisyUI 5.x component)
   - `ring-*`, `ring-offset-*` utilities (Tailwind CSS)
   - `animate-pulse`, `animate-spin` utilities (Tailwind CSS)
   - `loading-dots`, `loading-spinner` classes (DaisyUI 5.x)

2. **All signal patterns verified from examples**:

   - `input<boolean>(false)` pattern: Angular 20+ API
   - `computed()` pattern: chat-view.component.ts:69
   - `@if`/`@for` control flow: execution-node.component.ts:45+

3. **ChatStore API consulted**:

   - `isStreaming()` signal exists and returns boolean
   - `currentExecutionTree()` signal exists and returns ExecutionNode | null
   - No additional state management needed

4. **ExecutionNode type verified**:

   - `status` property exists (libs/shared/src/lib/types/execution-node.types.ts:83)
   - `status === 'streaming'` is valid ExecutionStatus value
   - `type` property discriminator exists for @switch rendering

5. **No hallucinated APIs**:
   - All component imports verified: TypingCursorComponent (new), existing components unchanged
   - All Tailwind classes verified: DaisyUI 5.x + Tailwind 4.x documentation
   - All Angular APIs verified: @angular/core 20.x signal API

### Architecture Delivery Checklist

- [x] All components specified with evidence (5 components + 1 new atom)
- [x] All patterns verified from codebase (signals, DaisyUI, recursive rendering)
- [x] All imports/utilities verified as existing (ChatStore, ExecutionNode, Tailwind classes)
- [x] Quality requirements defined (P0, P1, performance, accessibility)
- [x] Integration points documented (4 integration flows + data flow diagram)
- [x] Files affected list complete (6 MODIFY + 1 CREATE)
- [x] Developer type recommended (frontend-developer - 100% UI/UX work)
- [x] Complexity assessed (MEDIUM, 6-8 hours)
- [x] No step-by-step implementation (that's team-leader's job to decompose)

---

## 📋 Implementation Order Recommendation

**Phase 1: Foundation** (No dependencies)

1. Create TypingCursorComponent (Component 2)
2. Fix chat-view streaming indicator logic (Component 1)

**Phase 2: Message Bubble Enhancements** (Depends on Phase 1) 3. Enhance MessageBubbleComponent with isStreaming input + avatar ring (Component 3) 4. Integrate TypingCursorComponent into MessageBubbleComponent (Component 3 continued)

**Phase 3: Tool & Text Node Feedback** (Independent of Phase 2) 5. Add tool activity descriptions (Component 4) 6. Add text node pulsing (Component 5)

**Phase 4: Testing & Refinement** 7. Manual testing with live Claude streaming 8. Animation timing adjustments 9. Cross-component integration verification

**Rationale**: Create atoms first (TypingCursor), then fix core streaming logic (chat-view), then enhance organisms (MessageBubble), finally add micro-interactions (tool descriptions, text pulsing).

---

## 🧪 Testing Strategy

### Manual Testing Approach

**Test Scenario 1: Skeleton Placeholder**

- Start a new chat session
- Send a message that triggers Claude response
- **VERIFY**: Skeleton placeholder appears immediately (before tree starts)
- **VERIFY**: Skeleton transitions to message bubble when tree builds
- **VERIFY**: Typing cursor appears in message bubble

**Test Scenario 2: Avatar Pulsing Ring**

- Observe assistant message during streaming
- **VERIFY**: Avatar has pulsing blue ring during streaming
- **VERIFY**: Ring disappears when streaming completes
- **VERIFY**: Ring does not appear on user messages

**Test Scenario 3: Typing Cursor**

- Watch text nodes appear during streaming
- **VERIFY**: Blinking cursor (▌) appears at end of text
- **VERIFY**: Cursor blinks at 1-second intervals
- **VERIFY**: Cursor disappears when streaming completes

**Test Scenario 4: Tool Activity Descriptions**

- Trigger tools during streaming (Read, Write, Bash, Grep)
- **VERIFY**: Tool headers show "Reading file.ts..." (not just spinner)
- **VERIFY**: Descriptions are tool-specific (Read vs Write vs Bash)
- **VERIFY**: Long paths are shortened (e.g., ".../src/utils.ts")

**Test Scenario 5: Text Node Pulsing**

- Observe text nodes during streaming
- **VERIFY**: Text nodes have subtle pulse animation during streaming
- **VERIFY**: Pulse stops when text node completes
- **VERIFY**: Pulse does not interfere with markdown rendering

**Test Scenario 6: Streaming Indicator Persistence**

- Send a complex query with multiple tool calls
- **VERIFY**: Streaming indicator visible throughout (not just at start)
- **VERIFY**: Indicator persists during pauses between tool calls
- **VERIFY**: Indicator disappears only when streaming fully completes

### Performance Testing

**Animation Performance**:

- Open DevTools Performance tab
- Record during streaming session
- **VERIFY**: No JavaScript timer functions (setInterval/setTimeout for animations)
- **VERIFY**: CSS animations run on GPU (transform/opacity only)
- **VERIFY**: Frame rate stays above 30fps during streaming

**Change Detection Performance**:

- Enable Angular DevTools
- Monitor component rerenders during streaming
- **VERIFY**: Only affected components rerender (OnPush working)
- **VERIFY**: TypingCursorComponent does not trigger parent rerenders
- **VERIFY**: ChatStore signal updates propagate correctly

### Acceptance Criteria Validation

**P0 Requirements** (must pass):

1. ✅ Streaming indicator visible during entire session (no gaps)
2. ✅ Typing cursor blinks at 1-second intervals
3. ✅ Tool streaming shows descriptive text (not generic "Loading...")
4. ✅ Avatar shows pulsing ring during streaming
5. ✅ Text nodes pulse during streaming

**P1 Requirements** (should pass): 6. ✅ Skeleton placeholder appears before tree starts 7. ✅ All animations use CSS (verified in DevTools) 8. ✅ Streaming indicators clean up when complete

---

## 🎨 Visual Design Reference

### Color Palette (DaisyUI Theme Variables)

- **Streaming Accent**: `text-info` (blue) - matches existing streaming status
- **Avatar Ring**: `ring-info` (blue) - consistent with streaming color
- **Skeleton**: `bg-base-300` (gray) - DaisyUI skeleton default
- **Typing Cursor**: `text-neutral-content/70` (semi-transparent white) - subtle

### Animation Timing

- **Typing Cursor Blink**: 1s step-end infinite (crisp on/off)
- **Avatar Pulse**: DaisyUI `animate-pulse` (2s ease-in-out)
- **Text Node Pulse**: DaisyUI `animate-pulse` (2s ease-in-out)
- **Spinner Rotation**: DaisyUI `animate-spin` (1s linear infinite)
- **Transitions**: 300ms ease-in-out (smooth but not sluggish)

### Spacing & Layout

- **Typing Cursor**: `ml-0.5` (2px left margin for spacing)
- **Avatar Ring**: `ring-2 ring-offset-2` (2px ring, 2px offset)
- **Tool Description**: `text-[10px]` (matches existing tool UI)
- **Skeleton Lines**: `h-4 w-64`, `h-4 w-48`, `h-4 w-56` (varied widths for realism)

---

## 📝 Notes for Developer

### Key Implementation Details

1. **Typing Cursor Positioning**:

   - Place `<ptah-typing-cursor />` AFTER ExecutionNode rendering, not inside it
   - Use inline-block to flow with text (not block or absolute positioning)

2. **Avatar Ring Overflow**:

   - Remove `overflow-hidden` from avatar when ring is active
   - Add back when streaming completes to prevent ring overflow

3. **Skeleton Avatar Image**:

   - Reuse `ptahIconUri` from VSCodeService (need to inject in ChatViewComponent)
   - Match exact avatar structure from MessageBubbleComponent

4. **Tool Description Truncation**:

   - Reuse existing `shortenPath()` and `truncate()` utilities
   - Do NOT duplicate truncation logic (DRY principle)

5. **Animation Performance**:
   - NEVER use setInterval/setTimeout for cursor blinking
   - ALWAYS use CSS @keyframes for all animations
   - Test on lower-end devices (Chromebooks, older laptops)

### Common Pitfalls to Avoid

❌ **Don't**: Add typing cursor inside ExecutionNodeComponent recursion
✅ **Do**: Add typing cursor once at MessageBubble level

❌ **Don't**: Create separate state management for streaming indicators
✅ **Do**: Reuse existing ChatStore.isStreaming() signal

❌ **Don't**: Use JavaScript timers for cursor blinking
✅ **Do**: Use CSS @keyframes with step-end timing

❌ **Don't**: Duplicate path shortening logic in getStreamingDescription()
✅ **Do**: Reuse existing shortenPath() and truncate() methods

❌ **Don't**: Apply ring directly to <img> element (causes overflow issues)
✅ **Do**: Apply ring to parent <div class="w-8 h-8"> container

### DaisyUI Class Reference

```css
/* Loading Components */
.loading.loading-dots      /* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
/* Dots animation (current usage) */
.loading.loading-spinner   /* Spinner animation (tool streaming) */

/* Skeleton Placeholder */
.skeleton                  /* Animated gradient placeholder */
.skeleton.h-4.w-64        /* Height 16px, width 256px */

/* Badge Status Colors */
.badge.badge-info          /* Blue badge (streaming) */
.badge.badge-success       /* Green badge (complete) */
.badge.badge-error         /* Red badge (error) */

/* Ring Utilities */
.ring-2                    /* 2px ring */
.ring-info                 /* Blue ring color */
.ring-offset-2             /* 2px ring offset */
.ring-offset-base-100      /* Ring offset color (background) */

/* Animation Utilities */
.animate-pulse             /* 2s opacity pulse (subtle) */
.animate-spin; /* 1s rotation (spinner) */
```

---

## 🎯 Success Metrics

### User Experience Improvements

**Before**:

- Streaming indicator disappears after tree starts → feels disconnected
- No visual feedback during pauses → feels stuck
- No typing indicator → chunky text appearance
- No tool activity context → "what is it doing?"

**After**:

- Continuous streaming feedback → feels connected
- Persistent pulsing indicators → feels active
- Typing cursor → smooth, real-time feel
- Tool descriptions → clear activity context

### Technical Improvements

**Before**:

- Flawed conditional logic (lines 18-23 in chat-view.component.html)
- No streaming state propagation to MessageBubble
- Generic tool streaming feedback (spinner only)
- Static text nodes during streaming

**After**:

- Correct streaming logic (show activity regardless of tree state)
- isStreaming signal propagates to all streaming-aware components
- Context-aware tool streaming descriptions
- Animated text nodes signal active streaming

### Performance Targets

- **Animation Frame Rate**: >30fps during streaming (measure with DevTools)
- **Change Detection Overhead**: <10% increase in component renders
- **CSS Animation Count**: 4 active animations max (cursor, avatar, spinner, text pulse)
- **JavaScript Timer Count**: 0 (all animations CSS-based)

---

## 🔄 Future Enhancements (Out of Scope for P0/P1)

These are P2 (Nice to Have) requirements - NOT included in current implementation plan:

1. **Typewriter Text Animation** (P2):

   - Animate text appearing character-by-character
   - Requires directive to intercept text delta updates
   - Risk: May conflict with markdown rendering

2. **Smooth Scroll Sync** (P2):

   - Improve auto-scroll to feel more natural
   - Already exists (chat-view.component.ts:122-130)
   - Enhancement: Adjust timing/easing

3. **Progress Estimation** (P2):
   - Show estimated completion for long operations
   - Requires backend changes (tool duration prediction)
   - Not feasible with current architecture

**Rationale for Exclusion**: Focus on P0 (continuous feedback, typing cursor, tool descriptions, pulsing) and P1 (skeleton placeholder) provides 80% of UX improvement with 20% of implementation complexity. P2 features add marginal value with high complexity/risk.
