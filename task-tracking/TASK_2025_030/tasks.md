# TASK_2025_030: Enhanced Streaming UX - Task Decomposition

## Overview

| Total Batches | Total Tasks | Developer Type     | Status          |
| ------------- | ----------- | ------------------ | --------------- |
| 4             | 7           | frontend-developer | ✅ COMPLETE 4/4 |

---

## Batch 1: Foundation - Typing Cursor & Streaming Logic Fix

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Tasks**: 2
**Dependencies**: None
**Batch Commit**: e773e51

### Task 1.1: Create TypingCursorComponent

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\typing-cursor.component.ts`

**Spec Reference**: implementation-plan.md:142-227

**Pattern to Follow**:

- `libs/frontend/chat/src/lib/components/atoms/status-badge.component.ts` (atom component pattern)
- OnPush change detection, standalone component, signal-based inputs

**Quality Requirements**:

**Functional**:

- MUST animate at 1-second blink interval
- MUST use step-end timing for crisp on/off transition
- MUST be inline-block for proper text flow
- MUST accept color class input for theme compatibility

**Non-Functional**:

- Performance: CSS animation runs on GPU (no layout thrashing)
- Accessibility: Purely decorative, no aria labels needed
- Pattern: OnPush change detection, standalone, signal inputs

**Implementation Details**:

**Component Structure**:

```typescript
@Component({
  selector: 'ptah-typing-cursor',
  standalone: true,
  template: `
    <span class="typing-cursor inline-block ml-0.5" [class]="colorClass()">▌</span>
  `,
  styles: [`
    @keyframes blink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }
    .typing-cursor {
      animation: blink 1s step-end infinite;
      font-weight: 400;
      line-height: 1;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
```

**Key Inputs**:

- `colorClass = input<string>('text-current')` - Color customization

**Acceptance Criteria**:

- [ ] Component renders blinking cursor (▌ character)
- [ ] CSS @keyframes blink animation works at 1s intervals
- [ ] OnPush change detection enabled
- [ ] Standalone component with signal input
- [ ] Cursor is inline-block for text flow

---

### Task 1.2: Fix chat-view streaming indicator logic

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Dependencies**: None
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html` (lines 12-23)
- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` (add ptahIconUri property)

**Spec Reference**: implementation-plan.md:70-140

**Pattern to Follow**:

- Current flawed logic: chat-view.component.html:12-23
- DaisyUI skeleton pattern: implementation-plan.md:107-115

**Quality Requirements**:

**Functional**:

- MUST show activity indicator during entire streaming session
- MUST transition from skeleton to message bubble when tree starts
- MUST use DaisyUI skeleton classes for placeholder
- MUST show indicator whether execution tree exists or not

**Non-Functional**:

- Performance: Skeleton uses CSS-only animation (no JS)
- Accessibility: Maintains chat-start/chat-end semantics
- Consistency: Matches existing message bubble structure

**Implementation Details**:

**ChatViewComponent (TypeScript)**:

- Add `ptahIconUri` property (inject VSCodeService to get icon URI)
- Ensure `streamingMessage()` computed signal is accessible in template

**ChatViewComponent (HTML) - Replace lines 12-23**:

```html
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
```

**Key Logic**:

- Outer condition: `@if (chatStore.isStreaming())`
- Inner condition: `@if (streamingMessage(); as msg)` for tree existence
- Remove old flawed `!chatStore.currentExecutionTree()` condition

**Acceptance Criteria**:

- [ ] Streaming indicator visible during entire streaming session
- [ ] Skeleton shows when streaming starts but no tree yet
- [ ] Skeleton transitions to message bubble when tree builds
- [ ] ptahIconUri property added to ChatViewComponent
- [ ] DaisyUI skeleton classes used correctly

**Batch 1 Verification**:

- [ ] TypingCursorComponent file exists at path
- [ ] chat-view.component.html modified correctly
- [ ] chat-view.component.ts has ptahIconUri property
- [ ] Build passes: `npx nx build chat`
- [ ] code-logic-reviewer approved

---

## Batch 2: Message Bubble Enhancements

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Tasks**: 2
**Dependencies**: Batch 1 (needs TypingCursorComponent)
**Batch Commit**: 36276ee

### Task 2.1: Add isStreaming input and avatar pulsing to MessageBubbleComponent

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Dependencies**: Task 1.1 (TypingCursorComponent must exist)
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts`
- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` (lines 66-79 for avatar)

**Spec Reference**: implementation-plan.md:229-346

**Pattern to Follow**:

- Current avatar: message-bubble.component.html:68-79
- DaisyUI ring utilities: Tailwind built-in (ring-_, ring-offset-_)
- Signal input pattern: `input<boolean>(false)`

**Quality Requirements**:

**Functional**:

- MUST accept `isStreaming` input signal
- MUST show pulsing ring on avatar during streaming
- MUST remove ring when streaming completes
- MUST NOT show ring on user messages (only assistant)

**Non-Functional**:

- Performance: Use Tailwind transition utilities (GPU accelerated)
- Accessibility: Ring is decorative
- Responsiveness: Ring scales with avatar size

**Implementation Details**:

**TypeScript Changes**:

```typescript
// Add import
import { TypingCursorComponent } from '../atoms/typing-cursor.component';

// Add to imports array
imports: [
  // ... existing imports
  TypingCursorComponent,
],

// Add input signal
readonly isStreaming = input<boolean>(false);
```

**HTML Changes (Avatar section - lines 66-79)**:

```html
<!-- Assistant message (left-aligned) - lines 66-126 -->
<div class="chat chat-start">
  <!-- Avatar with Ptah icon + streaming ring -->
  <div class="chat-image avatar">
    <div class="w-8 h-8 rounded-full overflow-hidden transition-all duration-300" [class.ring-2]="isStreaming()" [class.ring-info]="isStreaming()" [class.ring-offset-2]="isStreaming()" [class.ring-offset-base-100]="isStreaming()" [class.animate-pulse]="isStreaming()">
      <img [ngSrc]="ptahIconUri" alt="Claude" width="32" height="32" class="w-full h-full object-cover" />
    </div>
  </div>
  <!-- ... rest of component ... -->
</div>
```

**Key Classes**:

- `ring-2`: 2px ring border
- `ring-info`: Blue ring color (DaisyUI theme)
- `ring-offset-2`: 2px offset from avatar
- `ring-offset-base-100`: Ring offset color matches background
- `animate-pulse`: DaisyUI pulsing animation

**Acceptance Criteria**:

- [ ] isStreaming input signal added to component
- [ ] TypingCursorComponent imported
- [ ] Avatar has conditional ring classes
- [ ] Ring pulses during streaming
- [ ] Ring removed when streaming completes
- [ ] Build passes: `npx nx build chat`

---

### Task 2.2: Integrate typing cursor into message bubble content

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Dependencies**: Task 2.1
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` (lines 91-108 for message bubble content)

**Spec Reference**: implementation-plan.md:302-320

**Pattern to Follow**:

- Conditional rendering: `@if (isStreaming())`
- Component composition pattern from execution-node.component.ts

**Quality Requirements**:

**Functional**:

- MUST show typing cursor after content during streaming
- MUST show cursor in both execution tree and fallback content
- MUST remove cursor when streaming completes

**Non-Functional**:

- Positioning: Cursor flows inline with text (not absolute positioned)
- Color: Use semi-transparent color to blend with content

**Implementation Details**:

**HTML Changes (Message bubble content - lines 91-108)**:

```html
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
```

**Key Details**:

- Place cursor AFTER `<ptah-execution-node>`, not inside it
- Use `text-neutral-content/70` for semi-transparent cursor
- Cursor appears in both execution tree and markdown fallback

**Acceptance Criteria**:

- [ ] Typing cursor appears after execution tree content
- [ ] Typing cursor appears after markdown fallback content
- [ ] Cursor only visible when isStreaming() is true
- [ ] Cursor color is semi-transparent (text-neutral-content/70)
- [ ] Cursor flows inline with text
- [ ] Build passes: `npx nx build chat`

**Batch 2 Verification**:

- [ ] All message-bubble files modified correctly
- [ ] isStreaming input works
- [ ] Avatar pulsing ring works
- [ ] Typing cursor integrated
- [ ] Build passes: `npx nx build chat`
- [ ] code-logic-reviewer approved

---

## Batch 3: Tool & Text Feedback Enhancements

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Tasks**: 2
**Dependencies**: None (independent of Batch 2)
**Batch Commit**: 0579feb

### Task 3.1: Add tool activity descriptions to ToolCallItemComponent

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Dependencies**: None
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-call-item.component.ts` (lines 126-131 template, add method after line 768)

**Spec Reference**: implementation-plan.md:349-445

**Pattern to Follow**:

- Current streaming indicator: tool-call-item.component.ts:126-130
- Tool description logic: tool-call-item.component.ts:413-436
- Existing utilities: `shortenPath()` line 761, `truncate()` line 756

**Quality Requirements**:

**Functional**:

- MUST show tool-specific descriptions (not generic "Working...")
- MUST extract key parameters (file paths, commands, patterns)
- MUST truncate long strings to prevent overflow
- MUST handle 10+ tool types (Read, Write, Edit, Bash, Grep, Glob, Task, etc.)

**Non-Functional**:

- Performance: Use existing utility methods (no new allocations)
- Readability: 10px font size matches existing tool UI
- Consistency: Use same truncation logic as tool description

**Implementation Details**:

**Template Changes (lines 126-131) - REPLACE**:

```typescript
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
```

**New Method (add after line 768)**:

```typescript
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

**Key Logic**:

- Extract `toolName` and `toolInput` from `node()`
- Use `shortenPath()` for file paths (libs/...src/utils.ts)
- Use `truncate()` for commands/patterns (max 15-20 chars)
- Handle Bash special case (description or command)
- Fallback to generic description for unknown tools

**Acceptance Criteria**:

- [ ] getStreamingDescription() method added
- [ ] Template updated with spinner + description
- [ ] Tool-specific descriptions work for Read, Write, Edit, Bash, Grep, Glob, Task
- [ ] Long paths shortened using shortenPath()
- [ ] Long commands/patterns truncated using truncate()
- [ ] Spinner + description flex layout correct
- [ ] Build passes: `npx nx build chat`

---

### Task 3.2: Add pulsing activity indicator to text nodes

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Dependencies**: None
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts` (lines 45-51 template)

**Spec Reference**: implementation-plan.md:449-517

**Pattern to Follow**:

- Text node rendering: execution-node.component.ts:45-51
- Status from ExecutionNode: libs/shared/src/lib/types/execution-node.types.ts:83
- DaisyUI animate-pulse: Tailwind utility class

**Quality Requirements**:

**Functional**:

- MUST pulse only when `status === 'streaming'`
- MUST stop pulsing when status changes to 'complete'
- MUST preserve all existing rendering behavior
- MUST work for both agent summary and markdown content

**Non-Functional**:

- Performance: CSS-only animation (no JS interval timers)
- Subtlety: Pulse should be noticeable but not distracting
- Smoothness: 300ms transition for pulse activation/deactivation

**Implementation Details**:

**Template Changes (lines 45-51) - REPLACE**:

```typescript
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

**Key Classes**:

- `animate-pulse`: DaisyUI pulsing animation (2s ease-in-out)
- `transition-opacity duration-300`: Smooth fade in/out
- Conditional binding: `[class.animate-pulse]="node().status === 'streaming'"`

**Acceptance Criteria**:

- [ ] animate-pulse class applied conditionally
- [ ] Pulse only active when status === 'streaming'
- [ ] Pulse stops when status changes to 'complete'
- [ ] Works for both agent summary and markdown
- [ ] Transition is smooth (300ms)
- [ ] Build passes: `npx nx build chat`

**Batch 3 Verification**:

- [ ] Tool activity descriptions work
- [ ] Text node pulsing works
- [ ] Both features independent of message bubble changes
- [ ] Build passes: `npx nx build chat`
- [ ] code-logic-reviewer approved

---

## Batch 4: Testing & Refinement

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Tasks**: 1
**Dependencies**: Batches 1, 2, 3 complete
**Batch Commit**: Pending

### Task 4.1: Manual testing with live streaming and refinements

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Dependencies**: All previous batches complete
**Files**:

- MODIFY: Any files needing adjustments based on testing

**Spec Reference**: implementation-plan.md:773-843

**Pattern to Follow**:

- Manual testing scenarios: implementation-plan.md:776-812
- Performance testing: implementation-plan.md:814-828

**Quality Requirements**:

**Functional Testing**:

- MUST verify all 6 test scenarios pass
- MUST verify all P0 acceptance criteria met
- MUST verify animations work smoothly

**Performance Testing**:

- MUST verify no JavaScript timers for animations (use DevTools)
- MUST verify CSS animations run on GPU
- MUST verify frame rate >30fps during streaming
- MUST verify OnPush change detection working

**Implementation Details**:

**Test Scenario 1: Skeleton Placeholder**

- Start new chat, send message
- VERIFY: Skeleton appears before tree starts
- VERIFY: Skeleton transitions to message bubble
- VERIFY: Typing cursor appears in message bubble

**Test Scenario 2: Avatar Pulsing Ring**

- Observe assistant message during streaming
- VERIFY: Avatar has pulsing blue ring
- VERIFY: Ring disappears when complete
- VERIFY: Ring doesn't appear on user messages

**Test Scenario 3: Typing Cursor**

- Watch text nodes during streaming
- VERIFY: Blinking cursor (▌) at end of text
- VERIFY: Cursor blinks at 1-second intervals
- VERIFY: Cursor disappears when complete

**Test Scenario 4: Tool Activity Descriptions**

- Trigger tools (Read, Write, Bash, Grep)
- VERIFY: Tool headers show "Reading file.ts..."
- VERIFY: Descriptions are tool-specific
- VERIFY: Long paths shortened

**Test Scenario 5: Text Node Pulsing**

- Observe text nodes during streaming
- VERIFY: Subtle pulse animation
- VERIFY: Pulse stops when complete
- VERIFY: Doesn't interfere with markdown

**Test Scenario 6: Streaming Indicator Persistence**

- Send complex query with multiple tool calls
- VERIFY: Indicator visible throughout
- VERIFY: Indicator persists during pauses
- VERIFY: Indicator disappears only when fully complete

**Performance Checks (DevTools)**:

- Open Performance tab, record during streaming
- VERIFY: No setInterval/setTimeout for animations
- VERIFY: CSS animations on GPU (transform/opacity)
- VERIFY: Frame rate >30fps

**Change Detection Checks (Angular DevTools)**:

- Monitor component rerenders
- VERIFY: Only affected components rerender (OnPush)
- VERIFY: TypingCursorComponent doesn't trigger parent rerenders
- VERIFY: ChatStore signals propagate correctly

**Acceptance Criteria**:

- [ ] All 6 manual test scenarios pass
- [ ] All P0 requirements verified (5 items)
- [ ] Performance tests pass (no JS timers, >30fps)
- [ ] Change detection tests pass (OnPush working)
- [ ] Any identified issues fixed
- [ ] Final build passes: `npx nx build chat`
- [ ] code-logic-reviewer final approval

**Batch 4 Verification**:

- [ ] All testing scenarios completed
- [ ] All acceptance criteria verified
- [ ] Any adjustments made based on testing
- [ ] Final build passes: `npx nx build chat`
- [ ] code-logic-reviewer approved

---

## Implementation Summary

**Total Complexity**: MEDIUM (6-8 hours)

**Breakdown**:

- Batch 1 (Foundation): 2.5 hours
  - Task 1.1: Create TypingCursorComponent (1.5h)
  - Task 1.2: Fix streaming indicator logic (1h)
- Batch 2 (Message Bubble): 2 hours
  - Task 2.1: Add isStreaming + avatar pulsing (1h)
  - Task 2.2: Integrate typing cursor (1h)
- Batch 3 (Tool & Text Feedback): 2.5 hours
  - Task 3.1: Tool activity descriptions (1.5h)
  - Task 3.2: Text node pulsing (1h)
- Batch 4 (Testing): 1-2 hours
  - Task 4.1: Manual testing + refinements (1-2h)

**Files Summary**:

- CREATE: 1 file (TypingCursorComponent)
- MODIFY: 6 files (chat-view, message-bubble, tool-call-item, execution-node)

**Key Integration Points**:

- ChatViewComponent → MessageBubbleComponent (isStreaming signal)
- MessageBubbleComponent → TypingCursorComponent (composition)
- ChatStore → ChatViewComponent (isStreaming reactive state)
- ExecutionNode status → Component styling (conditional classes)

**Critical Success Factors**:

- All animations MUST use CSS (not JavaScript timers)
- All components MUST maintain OnPush change detection
- All DaisyUI utilities MUST be verified before use
- ChatStore.isStreaming() signal MUST be single source of truth
