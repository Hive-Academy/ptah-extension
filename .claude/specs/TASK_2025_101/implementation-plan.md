# Implementation Plan - TASK_2025_101

## Fix Chat Scrolling to Wait for Recursive Component Rendering

---

## Problem Analysis

### Root Cause

The current scroll implementation uses Angular's `afterNextRender()` inside an effect to scroll to bottom when content changes. The problem sequence is:

```
1. Effect detects nodeCount signal change
2. Effect calls afterNextRender()
3. afterNextRender fires after Angular's FIRST render pass completes
4. BUT: Recursive ExecutionNode components haven't finished initializing
5. @defer directives in ExecutionNode → InlineAgentBubble chain delay rendering
6. scrollHeight is measured with INCOMPLETE DOM
7. Child components finish rendering LATER
8. New content appears BELOW the scroll position
```

### Why afterNextRender Fails for Recursive Components

- `afterNextRender()` fires after the **parent template** completes its render cycle
- Recursive components (`ExecutionNode` → `InlineAgentBubble` → `ExecutionNode`) create multiple render passes
- The `@defer` directive in `ExecutionNodeComponent` (line 84) further delays agent bubble rendering
- Angular's render cycle considers the parent "done" before children are fully mounted

### Affected Components

1. **ChatViewComponent** (`chat-view.component.ts:148-208`)

   - Main message container scroll
   - Tracks `totalNodeCount` signal for scroll triggering

2. **InlineAgentBubbleComponent** (`inline-agent-bubble.component.ts:197-235`)
   - Agent content container scroll (within agent bubble)
   - Tracks `children` and `summaryContent` for scroll triggering

---

## Solution Architecture

### Design Philosophy

Replace lifecycle-dependent scroll timing with **DOM mutation observation**. This approach:

1. **Watches actual DOM changes** rather than guessing when rendering completes
2. **Works regardless of component nesting depth** (recursive or not)
3. **Handles @defer, streaming, and rapid updates** naturally via debouncing
4. **Follows Angular signals pattern** (respects `userScrolledUp` signal)

### Architecture Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│  ChatViewComponent                                               │
├─────────────────────────────────────────────────────────────────┤
│  afterNextRender() → Setup MutationObserver on #messageContainer │
│                                                                  │
│  MutationObserver                                                │
│  ├── Watches: childList, subtree, characterData                 │
│  └── On mutation → scheduleScroll()                             │
│                                                                  │
│  scheduleScroll()                                                │
│  ├── Check userScrolledUp() signal → early return if true       │
│  ├── Clear previous debounce timeout                            │
│  └── Set new timeout (50ms) → scrollToBottom()                  │
│                                                                  │
│  DestroyRef → Cleanup observer and timeout                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  InlineAgentBubbleComponent (per instance)                       │
├─────────────────────────────────────────────────────────────────┤
│  Same pattern, scoped to #contentContainer                       │
│  Independent scroll management (no coordination needed)          │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision                                 | Rationale                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| MutationObserver over afterRender phases | Catches ALL DOM changes including @defer, works with any nesting depth |
| 50ms debounce timeout                    | Balances responsiveness with coalescing rapid streaming updates        |
| Observer per container (not shared)      | Simpler, no coordination needed, components are independent            |
| DestroyRef cleanup pattern               | Modern Angular pattern, automatic cleanup on component destruction     |
| Keep userScrolledUp signal               | Preserves existing user experience (reading history uninterrupted)     |

---

## Component Specifications

### Component 1: ChatViewComponent Scroll Refactor

**Purpose**: Fix main message container scroll to wait for complete DOM rendering

**Pattern**: MutationObserver with trailing debounce

**Evidence**:

- Current implementation: `chat-view.component.ts:148-171`
- Similar debounce pattern: `tab-manager.service.ts:434` (localStorage save debounce)
- userScrolledUp signal: `chat-view.component.ts:76`

**Implementation Pattern**:

```typescript
// Pattern: MutationObserver-based scroll with debounce
// Verified API: MutationObserver is browser-native, well-supported

import { DestroyRef, afterNextRender, inject, Injector } from '@angular/core';

export class ChatViewComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  // Mutation observer instance (scoped to this component)
  private observer: MutationObserver | null = null;

  // Debounce timeout handle
  private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Debounce delay - balances responsiveness with scroll coalescing
  private readonly SCROLL_DEBOUNCE_MS = 50;

  constructor() {
    // REMOVE: Effect with afterNextRender for scroll (lines 150-170)
    // KEEP: totalNodeCount computed for potential future use

    // NEW: Setup observer after first render
    afterNextRender(
      () => {
        this.setupMutationObserver();
      },
      { injector: this.injector }
    );

    // NEW: Cleanup on component destruction
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  private setupMutationObserver(): void {
    const container = this.messageContainerRef()?.nativeElement;
    if (!container || this.observer) return;

    this.observer = new MutationObserver(() => {
      this.scheduleScroll();
    });

    // Watch for any DOM changes in the container subtree
    this.observer.observe(container, {
      childList: true, // New nodes added/removed
      subtree: true, // Watch entire subtree (recursive components)
      characterData: true, // Text content changes (streaming text)
    });
  }

  private scheduleScroll(): void {
    // Respect user scroll-up (reading history)
    if (this.userScrolledUp()) return;

    // Clear previous debounce (trailing debounce pattern)
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
    }

    // Schedule scroll after debounce period
    this.scrollTimeoutId = setTimeout(() => {
      this.scrollToBottom();
      this.scrollTimeoutId = null;
    }, this.SCROLL_DEBOUNCE_MS);
  }

  private cleanup(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
      this.scrollTimeoutId = null;
    }
  }

  // KEEP: Existing scrollToBottom() method (lines 199-208)
  // KEEP: Existing onScroll() handler (lines 177-189)
}
```

**Quality Requirements**:

- Scroll triggers only after recursive components finish rendering
- Rapid streaming updates coalesce into ~1 scroll per 50ms
- User scroll-up disables auto-scroll
- No memory leaks (observer disconnected on destroy)
- No global subscriptions

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` (MODIFY)

---

### Component 2: InlineAgentBubbleComponent Scroll Refactor

**Purpose**: Fix agent content container scroll with same pattern

**Pattern**: MutationObserver with trailing debounce (identical to ChatViewComponent)

**Evidence**:

- Current implementation: `inline-agent-bubble.component.ts:197-220`
- Content container: `#contentContainer` template reference (line 112)

**Implementation Pattern**:

```typescript
// Pattern: Same as ChatViewComponent, scoped to agent content container

import { DestroyRef, afterNextRender, inject, Injector } from '@angular/core';

export class InlineAgentBubbleComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private observer: MutationObserver | null = null;
  private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly SCROLL_DEBOUNCE_MS = 50;

  constructor() {
    // REMOVE: Effect with afterNextRender (lines 199-220)

    // NEW: Setup observer after render (delayed to ensure container exists)
    afterNextRender(
      () => {
        this.setupMutationObserver();
      },
      { injector: this.injector }
    );

    // NEW: Cleanup
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  private setupMutationObserver(): void {
    const container = this.contentContainerRef()?.nativeElement;
    if (!container || this.observer) return;

    this.observer = new MutationObserver(() => {
      this.scheduleScroll();
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private scheduleScroll(): void {
    // Only scroll when streaming and expanded
    const isStreaming = this.node().status === 'streaming';
    const isCollapsed = this.isCollapsed();

    if (!isStreaming || isCollapsed) return;

    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
    }

    this.scrollTimeoutId = setTimeout(() => {
      this.scrollAgentContentToBottom();
      this.scrollTimeoutId = null;
    }, this.SCROLL_DEBOUNCE_MS);
  }

  private cleanup(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
      this.scrollTimeoutId = null;
    }
  }

  // KEEP: Existing scrollAgentContentToBottom() method (lines 226-235)
}
```

**Quality Requirements**:

- Agent content scroll waits for child ExecutionNodes to render
- Only scrolls when streaming AND expanded
- Independent of main container scroll
- Cleanup on component destruction

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts` (MODIFY)

---

## Integration Architecture

### Integration Points

**No external integration needed** - both components are self-contained:

1. ChatViewComponent observes its own `#messageContainer`
2. InlineAgentBubbleComponent observes its own `#contentContainer`
3. No shared state or coordination required
4. Each component manages its own observer lifecycle

### Data Flow

```
Signal Update (nodeCount, messages, streamingState)
    ↓
Angular Render Cycle Starts
    ↓
DOM Mutations Occur (parent renders, children render, @defer triggers)
    ↓
MutationObserver fires (multiple times during render)
    ↓
scheduleScroll() debounces (clears previous, sets new 50ms timeout)
    ↓
After 50ms of DOM stability → scrollToBottom()
```

### Dependencies

**No new external dependencies** - uses browser-native APIs:

- `MutationObserver` - Built-in browser API
- `setTimeout` / `clearTimeout` - Built-in browser API
- `DestroyRef` - Angular core (`@angular/core`)

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

| Requirement                                              | Verification                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| Scroll waits for recursive ExecutionNode tree completion | Observer fires on all DOM mutations including nested components |
| Handles @defer in ExecutionNode                          | Observer catches deferred component rendering                   |
| Debounces rapid streaming updates                        | 50ms trailing debounce coalesces multiple mutations             |
| Respects user scroll-up                                  | `userScrolledUp()` signal checked before scheduling             |
| Works with multiple streaming messages                   | Each mutation triggers debounced scroll                         |

### Non-Functional Requirements

| Requirement     | Solution                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| Performance     | MutationObserver is browser-optimized; 50ms debounce limits scroll calls |
| Memory          | DestroyRef cleanup prevents leaks; observer disconnected on destroy      |
| Maintainability | Same pattern in both components; clear separation of concerns            |
| Testability     | MutationObserver can be mocked; debounce timing is configurable constant |

### Pattern Compliance

| Pattern                   | Verified Source                                          |
| ------------------------- | -------------------------------------------------------- |
| Angular DestroyRef        | Core Angular pattern for cleanup                         |
| Signal-based state        | Uses existing `userScrolledUp` signal                    |
| afterNextRender for setup | Angular lifecycle best practice (verified: Angular docs) |
| Debounce pattern          | Existing in codebase: `tab-manager.service.ts:434`       |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: `frontend-developer`

**Rationale**:

- Pure Angular component modifications
- Browser API (MutationObserver) integration
- No backend changes required
- UI behavior fix

### Complexity Assessment

**Complexity**: MEDIUM

**Estimated Effort**: 2-3 hours

**Breakdown**:

- ChatViewComponent refactor: 1 hour
- InlineAgentBubbleComponent refactor: 1 hour
- Testing and verification: 1 hour

### Files Affected Summary

**MODIFY**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`

### Critical Verification Points

**Before Implementation, Developer Must Verify:**

1. **Imports exist in Angular core**:

   - `DestroyRef` from `@angular/core`
   - `afterNextRender` from `@angular/core` (already imported)
   - `Injector` from `@angular/core` (already imported)

2. **Browser API compatibility**:

   - `MutationObserver` - Supported in all modern browsers
   - No polyfill needed for VS Code webview

3. **Existing code to preserve**:

   - `scrollToBottom()` method in ChatViewComponent
   - `scrollAgentContentToBottom()` method in InlineAgentBubbleComponent
   - `onScroll()` handler in ChatViewComponent
   - `userScrolledUp` signal in ChatViewComponent
   - `isCollapsed` signal in InlineAgentBubbleComponent

4. **Existing code to remove**:
   - Effect body that calls `afterNextRender()` in ChatViewComponent (lines 150-170)
   - Effect body that calls `afterNextRender()` in InlineAgentBubbleComponent (lines 199-220)

### Architecture Delivery Checklist

- [x] Problem analyzed with root cause identified
- [x] Solution architecture designed with MutationObserver pattern
- [x] Both affected components specified with implementation patterns
- [x] Quality requirements defined (functional and non-functional)
- [x] Integration points documented (independent, no coordination needed)
- [x] Files affected list complete
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM, 2-3 hours)
- [x] Browser API verified (MutationObserver well-supported)
- [x] Angular patterns verified (DestroyRef, afterNextRender)

---

## Testing Strategy

### Unit Tests

```typescript
describe('ChatViewComponent scroll behavior', () => {
  it('should setup MutationObserver after initial render', () => {
    // Verify observer.observe() called with correct options
  });

  it('should debounce rapid DOM mutations', () => {
    // Trigger multiple mutations rapidly
    // Verify single scroll call after debounce period
  });

  it('should not scroll when userScrolledUp is true', () => {
    // Set userScrolledUp to true
    // Trigger mutation
    // Verify scrollToBottom not called
  });

  it('should cleanup observer on destroy', () => {
    // Destroy component
    // Verify observer.disconnect() called
    // Verify timeout cleared
  });
});

describe('InlineAgentBubbleComponent scroll behavior', () => {
  it('should only scroll when streaming and expanded', () => {
    // Set isCollapsed = true or status !== 'streaming'
    // Trigger mutation
    // Verify scroll not called
  });

  it('should scroll agent content to bottom during streaming', () => {
    // Set streaming state, expanded
    // Trigger mutation
    // Verify scrollAgentContentToBottom called after debounce
  });
});
```

### Integration Tests

```typescript
describe('Recursive component scroll timing', () => {
  it('should scroll after ExecutionNode tree fully renders', () => {
    // Render message with nested tool calls
    // Verify scrollTop equals scrollHeight - clientHeight
  });

  it('should handle @defer in ExecutionNode', () => {
    // Render message with agent node (uses @defer)
    // Verify scroll happens after deferred content renders
  });
});
```

### Manual Testing Checklist

- [ ] Stream a message with multiple tool calls - viewport stays at bottom
- [ ] Stream a message that spawns an agent - agent bubble scroll works
- [ ] Scroll up during streaming - auto-scroll disables
- [ ] Scroll back to bottom - auto-scroll re-enables
- [ ] Load session with history - scrolls to bottom after all messages render
- [ ] Rapid streaming (many events/second) - smooth scrolling, no jitter
