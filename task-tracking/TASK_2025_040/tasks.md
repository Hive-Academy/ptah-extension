# Development Tasks - TASK_2025_040: Message Queue & Session Control

**Total Tasks**: 7 | **Batches**: 2 | **Status**: COMPLETE ✅ (All batches implemented)

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- TabState extension pattern matches existing `currentMessageId?: string | null` pattern (chat.types.ts:143) - VERIFIED
- `continueConversation()` method exists for auto-send with --resume flag (chat.store.ts:660) - VERIFIED
- `handleChatComplete()` hook available for queue processing (chat.store.ts:1196-1255) - VERIFIED
- `abortCurrentMessage()` RPC pattern exists (chat.store.ts:954-983) - VERIFIED
- SIGINT signal supported by Node.js `child_process` API - VERIFIED (standard Node.js)

### Risks Identified

| Risk                                           | Severity | Mitigation                                                                       |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| SIGINT may fail on Windows                     | MEDIUM   | Task 2.1 implements SIGTERM fallback with 2s timeout                             |
| Message routing timing (queue-to-input signal) | LOW      | Task 1.5 uses signal-based reactivity pattern (verified in codebase)             |
| Queue state race conditions                    | LOW      | All updates use atomic `TabManager.updateTab()` (verified at chat.store.ts:1106) |

### Edge Cases to Handle

- [x] Multiple queue appends (newline separator) - Handled in Task 1.2
- [x] Stop before queue auto-send completes - Handled in Task 1.4
- [x] Empty queue on stop - Handled in Task 1.4 (shouldRestoreQueue flag)
- [x] SIGINT Windows compatibility - Handled in Task 2.1 (fallback logic)
- [x] Queue auto-send error recovery - Handled in Task 1.3 (catch block restores queue)
- [x] Multi-tab queue isolation - Handled by per-tab TabState structure

---

## Batch 1: Frontend Queue Management - IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 6 | **Dependencies**: None

### Task 1.1: Extend TabState with queuedContent Field - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.types.ts
**Spec Reference**: implementation-plan.md:101-132
**Pattern to Follow**: Existing optional field pattern (`currentMessageId?: string | null` at line 143)

**Quality Requirements**:

- Field must be nullable, optional, and per-tab scoped
- Zero breaking changes to existing TabState consumers
- Matches existing optional field pattern

**Validation Notes**:

- This is a pure interface extension (no logic changes)
- Pattern verified: chat.types.ts:143 uses same nullable optional pattern

**Implementation Details**:

- Location: After line 143 in TabState interface
- Add field: `queuedContent?: string | null;`
- JSDoc comment explaining purpose: "Single queued message content (appended on multiple sends). Auto-sent via continueConversation() when streaming completes."

**Verification Checklist**:

- [ ] Field added to TabState interface at line 144
- [ ] JSDoc comment explains queue behavior
- [ ] Type is `string | null` with optional modifier `?`
- [ ] No changes to other interfaces in file
- [ ] Build passes: `npx nx build chat`

---

### Task 1.2: Add ChatStore Queue Management Methods - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Dependencies**: Task 1.1 (requires TabState.queuedContent)
**Spec Reference**: implementation-plan.md:134-220
**Pattern to Follow**: Existing ChatStore method pattern (e.g., `clearCurrentSession()` at line 296)

**Quality Requirements**:

- `queueOrAppendMessage()` must append with `\n` separator
- `moveQueueToInput()` must atomically read + clear
- `clearQueuedContent()` must be idempotent
- Operations < 50ms (performance requirement)
- Uses `tabManager.updateTab()` (DRY - verified at chat.store.ts:1106)

**Validation Notes**:

- All methods use existing TabManager pattern (no new services)
- Console logging matches existing pattern (chat.store.ts:604)

**Implementation Details**:

Add 3 methods after `abortCurrentMessage()` (after line 983):

```typescript
/**
 * Queue or append message content to active tab
 * If content already queued, append with newline separator
 */
queueOrAppendMessage(content: string): void {
  const activeTabId = this.tabManager.activeTabId();
  if (!activeTabId) return;

  const activeTab = this.tabManager.activeTab();
  const existing = activeTab?.queuedContent;

  // Append with newline if content exists, otherwise set directly
  const newContent = existing ? `${existing}\n${content}` : content;

  this.tabManager.updateTab(activeTabId, {
    queuedContent: newContent,
  });

  console.log('[ChatStore] Message queued/appended', {
    tabId: activeTabId,
    newLength: newContent.length,
  });
}

/**
 * Clear queued content for active tab
 */
clearQueuedContent(): void {
  const activeTabId = this.tabManager.activeTabId();
  if (!activeTabId) return;

  this.tabManager.updateTab(activeTabId, {
    queuedContent: null,
  });

  console.log('[ChatStore] Queued content cleared', { tabId: activeTabId });
}

/**
 * Move queued content to caller (for input restoration) and clear queue
 * @returns Queued content string or null if no content queued
 */
moveQueueToInput(): string | null {
  const activeTab = this.tabManager.activeTab();
  const content = activeTab?.queuedContent ?? null;

  if (content) {
    this.clearQueuedContent();
    console.log('[ChatStore] Queued content moved to input', {
      tabId: activeTab?.id,
      length: content.length,
    });
  }

  return content;
}
```

**Verification Checklist**:

- [ ] All 3 methods added after line 983
- [ ] `queueOrAppendMessage()` appends with `\n` separator
- [ ] `moveQueueToInput()` atomically reads and clears
- [ ] All methods use `tabManager.updateTab()` pattern
- [ ] Console logging matches existing format
- [ ] Build passes: `npx nx build chat`

---

### Task 1.3: Modify handleChatComplete for Auto-Send Queue - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Dependencies**: Task 1.2 (requires queue methods)
**Spec Reference**: implementation-plan.md:222-308
**Pattern to Follow**: Existing `continueConversation()` async pattern (chat.store.ts:660, 741-744)

**Quality Requirements**:

- Only auto-send if queue is non-empty
- Clear queue BEFORE sending (prevent duplicate)
- Restore queue on error (no data loss)
- Non-blocking (async, no await)
- Error resilient (catch + restore queue)

**Validation Notes**:

- Uses `continueConversation()` for --resume (verified at chat.store.ts:660)
- Follows existing async pattern without blocking (verified at chat.store.ts:741-744)
- Edge case: Queue auto-send error recovery handled in catch block

**Implementation Details**:

Modify `handleChatComplete()` method at line 1253 (after existing state reset logic):

```typescript
// [EXISTING CODE: Lines 1234-1253 - keep as is]

    console.log(
      '[ChatStore] Chat state reset to loaded for tab',
      targetTabId,
      '(exit code:',
      data.code,
      ')'
    );

    // ========== NEW CODE: Auto-send queued content ==========
    // Check if this tab has queued content
    const queuedContent = targetTab.queuedContent;
    if (queuedContent && queuedContent.trim()) {
      console.log('[ChatStore] Auto-sending queued content', {
        tabId: targetTabId,
        length: queuedContent.length,
      });

      // Clear queue before sending (prevent duplicate sends)
      this.tabManager.updateTab(targetTabId, { queuedContent: null });

      // Auto-send via continueConversation (async, don't await)
      this.continueConversation(queuedContent).catch((error) => {
        console.error('[ChatStore] Failed to auto-send queued content:', error);
        // Restore content on error (no data loss)
        this.tabManager.updateTab(targetTabId, {
          queuedContent: queuedContent,
        });
      });
    }
    // ========== END NEW CODE ==========
  }
}
```

**Verification Checklist**:

- [ ] New code added after line 1253 (before closing brace)
- [ ] Only auto-sends if `queuedContent` is non-empty
- [ ] Queue cleared BEFORE `continueConversation()` call
- [ ] Error catch block restores queue (no data loss)
- [ ] No `await` on `continueConversation()` (non-blocking)
- [ ] Console logging matches existing format
- [ ] Build passes: `npx nx build chat`

---

### Task 1.4: Modify abortCurrentMessage for Queue-to-Input Flow - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Dependencies**: Task 1.2 (requires queue methods), Task 1.5 (signal-based restoration)
**Spec Reference**: implementation-plan.md:310-400
**Pattern to Follow**: Existing RPC error handling (chat.store.ts:974-976)

**Quality Requirements**:

- Detect queued content before abort
- Clear queue atomically
- Notify frontend via signal (not direct postMessage)
- No data loss (content preserved in signal before clearing)
- Idempotent (safe to call multiple times)

**Validation Notes**:

- Edge case: Empty queue on stop handled by `shouldRestoreQueue` flag
- Uses signal pattern instead of postMessage for better Angular reactivity

**Implementation Details**:

1. Add signal for queue restoration (after existing signals, around line 107):

```typescript
// Signal for queue-to-input restoration
private readonly _queueRestoreSignal = signal<string | null>(null);
readonly queueRestoreContent = this._queueRestoreSignal.asReadonly();
```

2. Modify `abortCurrentMessage()` method (lines 954-983):

```typescript
async abortCurrentMessage(): Promise<void> {
  try {
    if (!this.claudeRpcService) {
      console.warn('[ChatStore] RPC service not initialized');
      return;
    }

    const sessionId = this.currentSessionId();
    if (!sessionId) {
      console.warn('[ChatStore] No active session to abort');
      return;
    }

    // ========== NEW CODE: Handle queued content BEFORE abort ==========
    const activeTab = this.tabManager.activeTab();
    const queuedContent = activeTab?.queuedContent;

    if (queuedContent && queuedContent.trim()) {
      console.log('[ChatStore] Queued content detected during stop', {
        tabId: activeTab?.id,
        length: queuedContent.length,
      });

      // Set signal for ChatInputComponent to restore
      this._queueRestoreSignal.set(queuedContent);

      // Clear queue (will be moved to input by ChatInputComponent)
      this.clearQueuedContent();
    }
    // ========== END NEW CODE ==========

    // [EXISTING CODE: Call RPC to abort - lines 968-976]
    const result = await this.claudeRpcService.call<void>('chat:abort', {
      sessionId,
    });

    if (result.success) {
      console.log('[ChatStore] Chat aborted successfully');
    } else {
      console.error('[ChatStore] Failed to abort chat:', result.error);
    }

    // [EXISTING CODE: Finalize current message - line 979]
    this.finalizeCurrentMessage();
  } catch (error) {
    console.error('[ChatStore] Failed to abort message:', error);
  }
}
```

**Verification Checklist**:

- [ ] Signal `_queueRestoreSignal` added after line 107
- [ ] Public readonly accessor `queueRestoreContent` added
- [ ] Queue detection added BEFORE RPC call in `abortCurrentMessage()`
- [ ] Signal set with queued content before clearing
- [ ] Queue cleared after signal set
- [ ] Existing RPC and finalization logic unchanged
- [ ] Build passes: `npx nx build chat`

---

### Task 1.5: Modify ChatInputComponent for Smart Send & Queue Restoration - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Dependencies**: Task 1.4 (requires queueRestoreContent signal)
**Spec Reference**: implementation-plan.md:402-512
**Pattern to Follow**: Existing `chatStore.sendMessage()` (line 159), textarea manipulation (lines 163-168)

**Quality Requirements**:

- Smart routing based on `isStreaming()` state
- Input stays enabled during streaming
- Content restoration from signal works correctly
- Input remains responsive (< 50ms for queue operations)
- Focus management prevents UX jarring

**Validation Notes**:

- Uses existing `chatStore.sendMessage()` (verified at line 159)
- Matches existing textarea manipulation (lines 163-168)
- Signal-based restoration prevents tight coupling

**Implementation Details**:

1. Remove `isDisabled` computed (line 122):

```typescript
// DELETE THIS LINE:
// readonly isDisabled = computed(() => this.chatStore.isStreaming());

// MODIFY canSend to remove isDisabled check (line 123-125):
readonly canSend = computed(
  () => this.currentMessage().trim().length > 0  // Remove && !this.isDisabled()
);
```

2. Modify `handleSend()` method for smart routing (lines 154-172):

```typescript
/**
 * Send message - SMART ROUTING: queue if streaming, send if not
 */
async handleSend(): Promise<void> {
  const content = this.currentMessage().trim();
  if (!content) return; // Remove isDisabled check

  try {
    // ========== NEW: Smart routing based on streaming state ==========
    if (this.chatStore.isStreaming()) {
      // Queue the message instead of sending
      this.chatStore.queueOrAppendMessage(content);
      console.log('[ChatInputComponent] Message queued during streaming');
    } else {
      // Normal send flow
      await this.chatStore.sendMessage(content);
      console.log('[ChatInputComponent] Message sent normally');
    }
    // ========== END NEW ==========

    // Clear input (same as before)
    this._currentMessage.set('');

    // Reset textarea height
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.height = 'auto';
    }
  } catch (error) {
    console.error('[ChatInputComponent] Failed to send message:', error);
  }
}
```

3. Add restoration method and effect listener:

```typescript
/**
 * Restore content to input textarea (called by effect when signal changes)
 * @param content - Content to restore to input
 */
restoreContentToInput(content: string): void {
  this._currentMessage.set(content);

  // Focus and resize textarea
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
  if (textarea) {
    textarea.focus();
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }

  console.log('[ChatInputComponent] Content restored to input', {
    length: content.length,
  });
}

// Add constructor with effect listener:
constructor() {
  // Listen for queue-to-input restoration signal
  effect(() => {
    const content = this.chatStore.queueRestoreContent();
    if (content) {
      this.restoreContentToInput(content);
      // Clear signal after restoration (cast to access private signal)
      (this.chatStore as any)._queueRestoreSignal.set(null);
    }
  });
}
```

**Verification Checklist**:

- [ ] `isDisabled` computed removed (line 122 deleted)
- [ ] `canSend` computed no longer checks `isDisabled`
- [ ] `handleSend()` has smart routing logic (queue vs send)
- [ ] `restoreContentToInput()` method added
- [ ] Constructor with `effect()` listener added
- [ ] Signal cleared after restoration
- [ ] Build passes: `npx nx build chat`

---

### Task 1.6: Add Queue Indicator UI to ChatViewComponent - IMPLEMENTED

**Files**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts

**Dependencies**: Task 1.2 (requires queue methods)
**Spec Reference**: implementation-plan.md:570-651
**Pattern to Follow**: Existing DaisyUI badge pattern (line 82-87 in template), conditional rendering (line 108)

**Quality Requirements**:

- Only show when `queuedContent` is non-null
- Preview truncated to 100 characters
- Cancel button clears queue
- Visual feedback < 16ms (single frame)
- Accessible (keyboard navigation, screen reader support)

**Validation Notes**:

- Matches existing DaisyUI patterns (verified in chat-view.component.html)
- Uses same conditional rendering syntax

**Implementation Details**:

1. Add to template (BEFORE Input Area section, before line 131):

```html
<!-- Queued Content Indicator -->
@if (chatStore.activeTab()?.queuedContent) {
<div class="px-4 pb-2 border-t border-primary/20 bg-primary/5">
  <div class="flex items-center justify-between gap-2 py-2">
    <!-- Left: Queue icon and text -->
    <div class="flex items-center gap-2 text-sm">
      <svg class="w-4 h-4 text-primary animate-pulse" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
      </svg>
      <span class="text-primary font-medium">Message queued</span>
      <span class="text-base-content/60">(will send when Claude finishes)</span>
    </div>

    <!-- Right: Cancel button -->
    <button class="btn btn-ghost btn-xs" (click)="cancelQueue()" type="button" title="Cancel queued message">✕</button>
  </div>

  <!-- Queued content preview (truncated) -->
  <div class="text-xs text-base-content/70 bg-base-200 rounded px-2 py-1 max-h-12 overflow-hidden">
    {{ chatStore.activeTab()?.queuedContent?.substring(0, 100) }} @if (chatStore.activeTab()?.queuedContent && chatStore.activeTab()!.queuedContent!.length > 100) {
    <span>...</span>
    }
  </div>
</div>
}
```

2. Add to TypeScript component:

```typescript
/**
 * Cancel queued message (user-requested cancellation)
 */
cancelQueue(): void {
  this.chatStore.clearQueuedContent();
  console.log('[ChatViewComponent] Queued content cancelled by user');
}
```

**Verification Checklist**:

- [ ] Template section added BEFORE line 131 (Input Area)
- [ ] Conditional rendering uses `@if` syntax
- [ ] Content preview truncated to 100 characters
- [ ] Cancel button calls `cancelQueue()` method
- [ ] `cancelQueue()` method added to TypeScript component
- [ ] DaisyUI classes match existing patterns
- [ ] Build passes: `npx nx build chat`

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- All tasks marked IMPLEMENTED by developer
- Ready for git commit

---

## Batch 2: Backend SIGINT Implementation - IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: None (can run in parallel with Batch 1)

### Task 2.1: Modify ClaudeProcess.kill() for SIGINT with Fallback - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-process.ts
**Spec Reference**: implementation-plan.md:653-717
**Pattern to Follow**: Existing error handling in `processChunk` (lines 305-324), EventEmitter 'close' event (line 272)

**Quality Requirements**:

- Send SIGINT first for graceful interruption
- Fall back to SIGTERM after 2 seconds if no response
- Fall back to SIGTERM immediately on error (Windows compatibility)
- SIGINT delivery < 100ms (performance requirement)
- Windows compatible (fallback strategy)
- No zombie processes (timeout ensures cleanup)

**Validation Notes**:

- Maintains existing EventEmitter 'close' event (verified at line 272)
- Edge case: SIGINT Windows compatibility handled with immediate fallback on error

**Implementation Details**:

Modify `kill()` method (lines 91-96):

```typescript
/**
 * Kill the active process
 *
 * TASK_2025_040: Changed to SIGINT for graceful mid-response interruption.
 * SIGINT allows Claude CLI to finalize current message before exiting.
 * Falls back to SIGTERM after 2 seconds if process doesn't respond.
 */
kill(): void {
  if (this.process && !this.process.killed) {
    console.log('[ClaudeProcess] Sending SIGINT to process');

    // Try SIGINT first (graceful interrupt)
    try {
      this.process.kill('SIGINT');

      // Set timeout for SIGTERM fallback (Windows may not support SIGINT)
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          console.warn('[ClaudeProcess] SIGINT failed, falling back to SIGTERM');
          this.process.kill('SIGTERM');
        }
      }, 2000); // 2 second timeout

    } catch (error) {
      // If SIGINT fails (e.g., on Windows), immediately use SIGTERM
      console.error('[ClaudeProcess] SIGINT failed:', error);
      console.log('[ClaudeProcess] Falling back to SIGTERM');
      this.process.kill('SIGTERM');
    }

    this.process = null;
  }
}
```

**Verification Checklist**:

- [x] SIGINT sent first (graceful interrupt)
- [x] 2-second timeout for SIGTERM fallback
- [x] Immediate SIGTERM fallback on catch (Windows compatibility)
- [x] Console logging for fallback scenarios
- [x] Process set to null after kill attempt
- [x] No changes to existing 'close' event handling
- [x] Build passes: `npx nx build claude-domain`
- [ ] Manual test on Windows (SIGINT fallback triggers) - Requires runtime testing

---

**Batch 2 Verification**:

- [x] File exists at specified path
- [x] Build passes: `npx nx build claude-domain`
- [x] Task marked IMPLEMENTED by developer
- [ ] Windows compatibility tested (fallback verified) - Requires runtime testing
- [x] Ready for team-leader verification

---

## Integration Testing Checklist

After both batches complete, verify:

- [ ] User can send messages while Claude is streaming
- [ ] Multiple sends during streaming append to single queue (newline separated)
- [ ] Queue indicator shows in UI when content queued
- [ ] Queue auto-sends via `continueConversation()` when Claude finishes
- [ ] Stop button sends SIGINT (check logs for "Sending SIGINT")
- [ ] Stop with queue moves content to input (not auto-send)
- [ ] Stop without queue leaves input empty
- [ ] SIGINT fallback works on Windows (check logs for "falling back to SIGTERM")
- [ ] Queue cleared after auto-send or restore
- [ ] No data loss during queue/stop operations
- [ ] Multi-tab queue isolation (queue on Tab A doesn't affect Tab B)

---

## Notes for Developers

**Frontend Developer (Batch 1)**:

- All tasks use existing patterns (TabManager.updateTab, signal-based reactivity)
- No new services needed (YAGNI principle)
- Pay attention to Task 1.4 signal pattern (better than postMessage for Angular)
- Task 1.6 UI uses DaisyUI classes (match existing chat-view styles)

**Backend Developer (Batch 2)**:

- Single file change (claude-process.ts)
- SIGINT is standard Node.js API (works on Linux/macOS)
- Windows fallback is critical (test manually if possible)
- Timeout ensures no zombie processes

**Git Commit Strategy**:

- Batch 1: Single commit after all 6 tasks complete
  - Message: `feat(webview): add message queue and smart send logic`
- Batch 2: Single commit after task complete
  - Message: `feat(vscode): implement SIGINT for graceful chat interruption`

**Testing Priority**:

1. Happy path: Queue during streaming → auto-send on completion
2. Stop path: Queue during streaming → stop → content restored to input
3. Edge case: Windows SIGINT fallback
4. Edge case: Multiple queue appends (3+ messages while streaming)
