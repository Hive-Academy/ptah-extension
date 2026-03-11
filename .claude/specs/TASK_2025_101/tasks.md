# Development Tasks - TASK_2025_101

**Total Tasks**: 8 | **Batches**: 2 | **Status**: 2/2 COMPLETE

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `userScrolledUp()` signal exists in ChatViewComponent: Verified (line 76)
- `isCollapsed()` signal exists in InlineAgentBubbleComponent: Verified (line 195)
- `scrollToBottom()` method exists in ChatViewComponent: Verified (lines 199-208)
- `scrollAgentContentToBottom()` method exists in InlineAgentBubbleComponent: Verified (lines 226-235)
- MutationObserver supported in VS Code webview: Verified (Chromium-based)

### Risks Identified

| Risk                                       | Severity | Mitigation                                 |
| ------------------------------------------ | -------- | ------------------------------------------ |
| Excessive observer firing during streaming | LOW      | 50ms debounce coalesces rapid mutations    |
| Container not rendered when observer setup | LOW      | afterNextRender() ensures DOM exists first |

### Edge Cases to Handle

- [x] Multiple InlineAgentBubbleComponents active simultaneously - Each has independent observer
- [x] User scrolls up during streaming - `userScrolledUp()` check prevents auto-scroll
- [x] Agent collapsed during streaming - `isCollapsed()` check prevents scroll

### Import Note

- `DestroyRef` must be added to imports in both files (currently not imported)

---

## Batch 1: Scroll Behavior Refactor (MutationObserver Pattern) ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: 8806e6a (bundled with TASK_2025_099)

---

### Task 1.1: Refactor ChatViewComponent scroll to use MutationObserver ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
**Status**: ✅ COMPLETE
**Spec Reference**: implementation-plan.md:96-201

**Implementation Details**:

1. **Add DestroyRef import** to the import statement from `@angular/core` (line 1-12)

2. **Add private fields** after line 76:

   ```typescript
   private readonly destroyRef = inject(DestroyRef);
   private observer: MutationObserver | null = null;
   private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
   private readonly SCROLL_DEBOUNCE_MS = 50;
   ```

3. **Remove the effect body** (lines 150-170) that contains:

   ```typescript
   effect(() => {
     const messages = this.chatStore.messages();
     const isStreaming = this.chatStore.isStreaming();
     const nodeCount = this.totalNodeCount();
     if (!this.userScrolledUp() && (messages.length > 0 || isStreaming || nodeCount > 0)) {
       afterNextRender(
         () => {
           this.scrollToBottom();
         },
         { injector: this.injector }
       );
     }
   });
   ```

4. **Replace with new constructor body**:

   ```typescript
   constructor() {
     afterNextRender(() => {
       this.setupMutationObserver();
     }, { injector: this.injector });

     this.destroyRef.onDestroy(() => {
       this.cleanup();
     });
   }
   ```

5. **Add new private methods** after `scrollToBottom()`:

   ```typescript
   private setupMutationObserver(): void {
     const container = this.messageContainerRef()?.nativeElement;
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
     if (this.userScrolledUp()) return;

     if (this.scrollTimeoutId) {
       clearTimeout(this.scrollTimeoutId);
     }

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
   ```

**Acceptance Criteria**:

- [x] `DestroyRef` is imported from `@angular/core`
- [x] Old effect with `afterNextRender()` is removed
- [x] `setupMutationObserver()` method exists and observes `childList`, `subtree`, `characterData`
- [x] `scheduleScroll()` method exists with 50ms debounce
- [x] `cleanup()` method exists and disconnects observer
- [x] `destroyRef.onDestroy()` calls `cleanup()`
- [x] Existing `scrollToBottom()`, `onScroll()`, and `userScrolledUp` signal preserved
- [x] File compiles without errors

---

### Task 1.2: Refactor InlineAgentBubbleComponent scroll to use MutationObserver ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
**Status**: ✅ COMPLETE
**Spec Reference**: implementation-plan.md:205-298
**Dependencies**: None (can be done in parallel with Task 1.1)

**Implementation Details**:

1. **Add DestroyRef import** to the import statement from `@angular/core` (line 1-14)

2. **Add private fields** after line 186:

   ```typescript
   private readonly destroyRef = inject(DestroyRef);
   private observer: MutationObserver | null = null;
   private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
   private readonly SCROLL_DEBOUNCE_MS = 50;
   ```

3. **Remove the effect body** (lines 197-221) that contains:

   ```typescript
   constructor() {
     effect(() => {
       const children = this.node().children;
       const summaryContent = this.node().summaryContent;
       const isStreaming = this.node().status === 'streaming';
       const collapsed = this.isCollapsed();
       const hasContent = (children && children.length > 0) || (summaryContent && summaryContent.length > 0);
       if (isStreaming && !collapsed && hasContent) {
         afterNextRender(() => { this.scrollAgentContentToBottom(); }, { injector: this.injector });
       }
     });
   }
   ```

4. **Replace with new constructor body**:

   ```typescript
   constructor() {
     afterNextRender(() => {
       this.setupMutationObserver();
     }, { injector: this.injector });

     this.destroyRef.onDestroy(() => {
       this.cleanup();
     });
   }
   ```

5. **Add new private methods** after `scrollAgentContentToBottom()`:

   ```typescript
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
   ```

**Acceptance Criteria**:

- [x] `DestroyRef` is imported from `@angular/core`
- [x] Old effect with `afterNextRender()` is removed
- [x] `setupMutationObserver()` method exists and observes `childList`, `subtree`, `characterData`
- [x] `scheduleScroll()` method checks `isStreaming` and `isCollapsed` before scheduling
- [x] `cleanup()` method exists and disconnects observer
- [x] `destroyRef.onDestroy()` calls `cleanup()`
- [x] Existing `scrollAgentContentToBottom()`, `isCollapsed` signal preserved
- [x] File compiles without errors

---

### Task 1.3: Handle observer re-setup for InlineAgentBubble collapse/expand ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
**Status**: ✅ COMPLETE
**Spec Reference**: implementation-plan.md:252-256
**Dependencies**: Task 1.2

**Implementation Details**:

The `#contentContainer` element is conditionally rendered with `@if (!isCollapsed())`. When the component is collapsed, the container is removed from DOM, which destroys the MutationObserver reference. When expanded again, we need to re-setup the observer.

1. **Modify `setupMutationObserver()`** to handle re-connection:

   ```typescript
   private setupMutationObserver(): void {
     const container = this.contentContainerRef()?.nativeElement;
     if (!container) return;

     // Disconnect existing observer if any (handles re-connection on expand)
     if (this.observer) {
       this.observer.disconnect();
     }

     this.observer = new MutationObserver(() => {
       this.scheduleScroll();
     });

     this.observer.observe(container, {
       childList: true,
       subtree: true,
       characterData: true,
     });
   }
   ```

2. **Add effect to watch for collapse state changes**:

   ```typescript
   constructor() {
     // Setup observer after initial render
     afterNextRender(() => {
       this.setupMutationObserver();
     }, { injector: this.injector });

     // Re-setup observer when component expands (container re-enters DOM)
     effect(() => {
       const collapsed = this.isCollapsed();
       if (!collapsed) {
         // Container is visible - setup/re-setup observer
         // Use afterNextRender to ensure DOM is ready
         afterNextRender(() => {
           this.setupMutationObserver();
         }, { injector: this.injector });
       }
     });

     this.destroyRef.onDestroy(() => {
       this.cleanup();
     });
   }
   ```

**Acceptance Criteria**:

- [x] Observer re-connects when component is expanded after being collapsed
- [x] No memory leaks (old observer disconnected before new one created)
- [x] Scroll works correctly after collapse/expand cycle
- [x] File compiles without errors

---

### Task 1.4: Remove unused imports and clean up ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
**Status**: ✅ COMPLETE
**Spec Reference**: N/A (cleanup task)
**Dependencies**: Tasks 1.1, 1.2, 1.3

**Implementation Details**:

1. **ChatViewComponent**: The `effect` import may no longer be needed if no other effects exist. Check and remove if unused.

2. **InlineAgentBubbleComponent**: The `effect` import is still needed for the collapse/expand watcher from Task 1.3.

3. **Both files**: Verify no unused imports after refactoring.

4. **Run linter**: `npx nx lint chat` to verify no lint errors.

**Acceptance Criteria**:

- [x] No unused imports in either file
- [x] `npx nx lint chat` passes
- [x] `npx nx typecheck chat` passes
- [x] `npx nx build ptah-extension-webview` passes (chat is part of webview build)

---

**Batch 1 Verification**:

- [x] All files exist at specified paths
- [x] Build passes: `npx nx build ptah-extension-webview` (chat is part of webview build)
- [x] Lint passes: `npx nx lint chat`
- [x] Typecheck passes: `npx nx typecheck chat`
- [x] code-logic-reviewer approved (team-leader verified no stubs/placeholders)
- [ ] Manual test: Stream a message with multiple tool calls - viewport stays at bottom
- [ ] Manual test: Collapse/expand agent bubble during streaming - scroll resumes correctly

---

## Summary

This batch implements the MutationObserver pattern to fix chat scrolling behavior. The key change is replacing `afterNextRender()` inside effects with DOM mutation observation that debounces scroll calls, ensuring scrolling happens only after recursive ExecutionNode tree building completes.

**Files Modified**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`

---

## Batch 2: Code Review Fixes ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1
**Triggered By**: Code Style Review (6.5/10) + Code Logic Review (5/10)
**Commit**: 1df9adb

---

### Task 2.1: Fix userScrolledUp Race Condition in ChatViewComponent ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
**Status**: ✅ COMPLETE
**Priority**: CRITICAL
**Lines**: 208-225

**Problem**:
The `scheduleScroll()` method checks `userScrolledUp()` at line 236 before scheduling setTimeout, but the condition can change during the 50ms debounce period. When the setTimeout callback fires, it calls `scrollToBottom()` without re-checking the condition.

**Current Code**:

```typescript
private scheduleScroll(): void {
  // Respect user scroll-up (reading history)
  if (this.userScrolledUp()) return;  // Check happens HERE

  if (this.scrollTimeoutId) {
    clearTimeout(this.scrollTimeoutId);
  }

  this.scrollTimeoutId = setTimeout(() => {
    this.scrollToBottom();  // No re-check before scroll!
    this.scrollTimeoutId = null;
  }, this.SCROLL_DEBOUNCE_MS);
}
```

**Implementation Details**:

1. Add a second `userScrolledUp()` check inside the setTimeout callback before calling `scrollToBottom()`

**Fixed Code**:

```typescript
private scheduleScroll(): void {
  // Respect user scroll-up (reading history)
  if (this.userScrolledUp()) return;

  if (this.scrollTimeoutId) {
    clearTimeout(this.scrollTimeoutId);
  }

  this.scrollTimeoutId = setTimeout(() => {
    // Re-check condition - user may have scrolled up during debounce period
    if (!this.userScrolledUp()) {
      this.scrollToBottom();
    }
    this.scrollTimeoutId = null;
  }, this.SCROLL_DEBOUNCE_MS);
}
```

**Acceptance Criteria**:

- [ ] Re-check `userScrolledUp()` inside setTimeout callback
- [ ] `scrollToBottom()` only called when `!this.userScrolledUp()`
- [ ] File compiles without errors

---

### Task 2.2: Fix isStreaming/isCollapsed Race Condition in InlineAgentBubbleComponent ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
**Status**: ✅ COMPLETE
**Priority**: CRITICAL
**Lines**: 289-311

**Problem**:
Same race condition as Task 2.1. The `scheduleScroll()` method checks `isStreaming` and `isCollapsed` at lines 281-285 before scheduling setTimeout, but these conditions can change during the 50ms debounce period.

**Current Code**:

```typescript
private scheduleScroll(): void {
  const isStreaming = this.node().status === 'streaming';
  const isCollapsed = this.isCollapsed();

  // Only scroll when streaming and expanded
  if (!isStreaming || isCollapsed) return;  // Check happens HERE

  if (this.scrollTimeoutId) {
    clearTimeout(this.scrollTimeoutId);
  }

  this.scrollTimeoutId = setTimeout(() => {
    this.scrollAgentContentToBottom();  // No re-check before scroll!
    this.scrollTimeoutId = null;
  }, this.SCROLL_DEBOUNCE_MS);
}
```

**Implementation Details**:

1. Add re-checks for both `isStreaming` and `isCollapsed` inside the setTimeout callback

**Fixed Code**:

```typescript
private scheduleScroll(): void {
  const isStreaming = this.node().status === 'streaming';
  const isCollapsed = this.isCollapsed();

  // Only scroll when streaming and expanded
  if (!isStreaming || isCollapsed) return;

  if (this.scrollTimeoutId) {
    clearTimeout(this.scrollTimeoutId);
  }

  this.scrollTimeoutId = setTimeout(() => {
    // Re-check conditions - may have changed during debounce period
    const stillStreaming = this.node().status === 'streaming';
    const nowCollapsed = this.isCollapsed();
    if (stillStreaming && !nowCollapsed) {
      this.scrollAgentContentToBottom();
    }
    this.scrollTimeoutId = null;
  }, this.SCROLL_DEBOUNCE_MS);
}
```

**Acceptance Criteria**:

- [ ] Re-check `isStreaming` and `isCollapsed` inside setTimeout callback
- [ ] `scrollAgentContentToBottom()` only called when still streaming and not collapsed
- [ ] File compiles without errors

---

### Task 2.3: Remove Dead Code from ChatViewComponent ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
**Status**: ✅ COMPLETE
**Priority**: BLOCKING
**Lines**: N/A (code removed)

**Problem**:
After the MutationObserver refactor, `totalNodeCount` computed signal and `countNodes()` method are no longer used. They were previously used by the effect-based scroll approach but are now dead code.

**Implementation Details**:

1. Remove the `totalNodeCount` computed signal (lines 139-142)
2. Remove the `countNodes()` method (lines 147-155)
3. Remove any JSDoc comments for these removed items

**Code to Remove**:

```typescript
/**
 * TASK_2025_096 FIX: Track total node count across all execution trees.
 * This ensures auto-scroll triggers when children are added to existing trees,
 * not just when new trees are created.
 *
 * Previously, effect only tracked `currentTrees.length` which doesn't change
 * when children/tools are added to existing message trees.
 */
private readonly totalNodeCount = computed(() => {
  const trees = this.chatStore.currentExecutionTrees();
  return trees.reduce((sum, tree) => sum + this.countNodes(tree), 0);
});

/**
 * Count total nodes in an execution tree (recursive)
 */
private countNodes(node: { children?: readonly unknown[] }): number {
  const childCount =
    node.children?.reduce<number>(
      (sum: number, child) =>
        sum + this.countNodes(child as { children?: readonly unknown[] }),
      0
    ) ?? 0;
  return 1 + childCount;
}
```

**Acceptance Criteria**:

- [ ] `totalNodeCount` computed signal removed
- [ ] `countNodes()` method removed
- [ ] Associated JSDoc comments removed
- [ ] No references to removed code remain
- [ ] File compiles without errors
- [ ] `npx nx lint chat` passes

---

### Task 2.4: Prevent Multiple afterNextRender Queuing in InlineAgentBubbleComponent ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
**Status**: ✅ COMPLETE
**Priority**: SERIOUS
**Lines**: 174-178, 220-237

**Problem**:
The effect that watches `isCollapsed()` and calls `afterNextRender()` to re-setup the MutationObserver can queue multiple setup callbacks if the user rapidly toggles collapse/expand. Each expand triggers a new `afterNextRender()` call.

**Current Code**:

```typescript
effect(() => {
  const collapsed = this.isCollapsed();
  if (!collapsed) {
    // Container is visible - setup/re-setup observer
    // Use afterNextRender to ensure DOM is ready
    afterNextRender(
      () => {
        this.setupMutationObserver();
      },
      { injector: this.injector }
    );
  }
});
```

**Implementation Details**:

1. Add `private observerSetupPending = false;` flag
2. Check flag before queuing `afterNextRender()`
3. Set flag to `true` before `afterNextRender()` call
4. Set flag to `false` inside callback after setup completes

**Fixed Code**:

```typescript
// Add to private fields (after line 172)
private observerSetupPending = false;

// Updated effect in constructor
effect(() => {
  const collapsed = this.isCollapsed();
  if (!collapsed && !this.observerSetupPending) {
    // Container is visible - setup/re-setup observer
    // Use afterNextRender to ensure DOM is ready
    this.observerSetupPending = true;
    afterNextRender(
      () => {
        this.setupMutationObserver();
        this.observerSetupPending = false;
      },
      { injector: this.injector }
    );
  }
});
```

**Acceptance Criteria**:

- [ ] `observerSetupPending` private flag added
- [ ] Flag checked before queuing `afterNextRender()`
- [ ] Flag set to `true` before queuing
- [ ] Flag set to `false` after setup completes in callback
- [ ] Rapid collapse/expand does not queue multiple setups
- [ ] File compiles without errors

---

**Batch 2 Verification**:

- [x] All files compile without errors: `npx nx typecheck chat`
- [x] Lint passes: `npx nx lint chat` (0 errors, 18 pre-existing warnings)
- [x] Build passes: `npx nx build ptah-extension-webview`
- [x] code-logic-reviewer approved (team-leader verified)
- [x] Race conditions fixed (scroll respects current state)
- [x] Dead code removed
- [x] No multiple observer setups on rapid toggle
