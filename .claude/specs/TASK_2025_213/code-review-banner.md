# Code Style Review - TASK_2025_213 (Resume Notification Banner)

## Review Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall Score   | 7/10           |
| Assessment      | NEEDS_REVISION |
| Blocking Issues | 1              |
| Serious Issues  | 3              |
| Minor Issues    | 3              |
| Files Reviewed  | 5              |

## The 5 Critical Questions

### 1. What could break in 6 months?

The `getTimeSince()` method at `resume-notification-banner.component.ts:171` is called from the template but has **no access modifier**, making it implicitly `public`. This violates the codebase convention where template-bound methods use `protected`. A future developer might assume it is part of the public API and call it from a parent component or test, creating coupling that makes refactoring harder.

The double `@if` guard (parent template line 71 + component template line 33) means there are two places that define "when to show the banner." If the show-condition evolves, developers must remember to update both guards or risk inconsistent behavior.

### 2. What would confuse a new team member?

The `dismissed` signal at `resume-notification-banner.component.ts:151` has no access modifier (implicitly `public`), yet it is purely internal component state -- the template reads it, but no parent should write it. A new team member looking at this component's public API would see `dismissed` alongside `resumableSubagents` and `resumeRequested` and might think it's part of the intended external interface.

The comment at `session-loader.service.ts:348` says "Clear resumableSubagents for simple-message sessions" but the code actually sets `resumableSubagents ?? []`, which would _populate_ the signal if there are resumable subagents. The comment is misleading -- it should say "Populate" or "Set" rather than "Clear".

### 3. What's the hidden complexity cost?

The `@if` guard in `chat-view.component.html:71` duplicates the visibility check that already exists inside `resume-notification-banner.component.ts:33`. This is redundant DOM-level gating. While it prevents component instantiation (a minor perf win), it creates a maintenance coupling: two files must agree on the show-condition. The `compaction-notification` sibling component does NOT have this pattern -- it is always rendered and handles its own visibility internally.

### 4. What pattern inconsistencies exist?

- `getTimeSince()` at line 171: no `protected` keyword. Every other template-bound method in the molecules directory uses `protected` (see `onResume`, `onDismiss` in the same file, plus `toggleThinking`, `getMainParam`, `formatCost`, `formatTokens`, etc. across the codebase).
- `dismissed` signal at line 151: bare `readonly` (no `protected`). Internal mutable state signals in molecules that are template-accessed typically use bare `readonly` (e.g., `isCollapsed`, `isStatsCollapsed`), so this is actually _consistent_. However, the `resetDismissed()` method at line 204 is `public` when it should arguably be `protected` or removed entirely since the JSDoc says it is deprecated and no longer needed.
- The resume banner comment in `chat-view.component.html:70` says `<!-- Resume Notification Banner -->` without a TASK reference, while the adjacent compaction banner comment at line 16 includes `<!-- TASK_2025_098: Compaction Notification Banner -->`. Inconsistent comment annotation style.

### 5. What would I do differently?

- Remove the outer `@if` guard in `chat-view.component.html:71` and let the component manage its own visibility (matching the `compaction-notification` pattern). This avoids the wrapper `<div class="px-2 py-1">` from ever rendering empty.
- Mark `getTimeSince()` as `protected` to match every other template-bound method.
- Fix the misleading "Clear" comment on line 348 of `session-loader.service.ts`.

---

## Blocking Issues

### Issue 1: `getTimeSince()` missing `protected` access modifier

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\notifications\resume-notification-banner.component.ts:171`
- **Problem**: `getTimeSince()` is called only from the template but has no access modifier, making it implicitly `public`. Every other template-bound method in the molecules directory uses `protected` (`onResume`, `onDismiss` in the same file; `formatCost`, `formatTokens`, `toggleThinking`, `getMainParam`, etc. across siblings).
- **Impact**: Breaks the codebase-wide convention that template-bound methods are `protected`. A `public` method signals external API to other developers and tooling. This is the only template-bound method in this file without `protected`.
- **Fix**: Change `getTimeSince(` to `protected getTimeSince(` at line 171.

## Serious Issues

### Issue 1: Redundant double `@if` guard between parent and child

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html:71` and `resume-notification-banner.component.ts:33`
- **Problem**: The parent template wraps the banner in `@if (chatStore.resumableSubagents().length > 0)`, and the component's own template also checks `@if (resumableSubagents().length > 0 && !dismissed())`. This creates two sources of truth for the visibility condition. The sibling `compaction-notification` component is rendered unconditionally in the parent (line 17-19) and handles its own visibility.
- **Tradeoff**: The outer `@if` prevents component instantiation when not needed (micro-optimization), but creates maintenance coupling. If the show-condition changes (e.g., adding `&& !isStreaming()`), a developer must remember to update both locations.
- **Recommendation**: Remove the outer `@if` guard and the wrapper `<div class="px-2 py-1">` from `chat-view.component.html:71-78`. Move the padding into the component's own template or add it conditionally inside the component. This matches the `compaction-notification` integration pattern.

### Issue 2: Misleading comment on fallback branch

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts:348`
- **Problem**: Comment says `// TASK_2025_213: Clear resumableSubagents for simple-message sessions` but the code is `this._resumableSubagents.set(resumableSubagents ?? [])`. This is a _set_ operation that may populate the signal if `resumableSubagents` is non-empty. The word "Clear" is misleading.
- **Tradeoff**: Misleading comments are worse than no comments -- they actively mislead future developers.
- **Recommendation**: Change comment to `// TASK_2025_213: Set resumableSubagents for simple-message sessions (may be empty)` or `// TASK_2025_213: Populate resumableSubagents signal for the banner UI` (matching the pattern at line 321).

### Issue 3: Deprecated `resetDismissed()` method should be `protected` or removed

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\notifications\resume-notification-banner.component.ts:204`
- **Problem**: `resetDismissed()` is marked `public` and `@deprecated`, with the JSDoc stating "No longer needed - the component auto-resets via effect." If it is truly dead code, it should be removed. If kept for backward compatibility, it should be `protected` since no external caller should be using it (the deprecation note says the effect handles this).
- **Tradeoff**: Dead `public` methods pollute the component's API surface and confuse developers about what the intended interface is.
- **Recommendation**: Remove `resetDismissed()` entirely since the `@deprecated` annotation and JSDoc confirm it is superseded by the effect. If backward compatibility is genuinely needed, document which caller uses it.

## Minor Issues

1. **Missing TASK reference in HTML comment** -- `chat-view.component.html:70` uses `<!-- Resume Notification Banner -->` while adjacent comments include TASK references (e.g., line 16: `<!-- TASK_2025_098: ... -->`). SUGGESTION: Add `<!-- TASK_2025_213: Resume Notification Banner -->` for consistency.

2. **`resumeAllRequested` deprecated output still present** -- `resume-notification-banner.component.ts:139`: The `@deprecated` output `resumeAllRequested` is declared but never emitted anywhere in the template or class. No parent binds to it either. SUGGESTION: Remove it entirely to avoid confusion about the component's API.

3. **Inconsistent padding wrapper** -- The resume banner uses `<div class="px-2 py-1">` (line 72 in HTML), while the compaction notification uses `<div class="px-4">` (line 17 in HTML). The permission badge at line 81 has no wrapper at all. SUGGESTION: Verify the padding difference is intentional for the visual design or unify to a consistent padding scheme.

---

## File-by-File Analysis

### session-loader.service.ts

**Score**: 8/10
**Issues Found**: 0 blocking, 1 serious, 0 minor

**Analysis**: The signal addition at line 49 follows the exact pattern of existing signals (`_sessions`, `_hasMoreSessions`, etc.). The public readonly at line 66 mirrors the pattern at lines 62-65. The `clearResumableSubagents()` method at lines 421-423 is clean and well-documented with a proper JSDoc block. The section separator at lines 409-411 follows the established `====` comment pattern used throughout the file.

**Specific Concerns**:

1. Line 348: Misleading "Clear" comment (see Serious Issue 2 above). The code on line 322 in the success branch uses "Populate" which is correct. Line 348 should match.

### chat.store.ts

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

**Analysis**: The delegation at line 164 (`readonly resumableSubagents = this.sessionLoader.resumableSubagents`) follows the exact pattern of lines 147-150 (other session signal delegations). The placement after the permission signals block and before the license status block is logical. The `clearResumableSubagents()` facade method at lines 450-452 follows the same single-line delegation pattern used throughout the file (e.g., `loadSessions`, `loadMoreSessions`, `switchSession`). The section separator and JSDoc are consistent with neighboring sections.

**Specific Concerns**: None. This is the cleanest file in the changeset.

### resume-notification-banner.component.ts

**Score**: 6/10
**Issues Found**: 1 blocking, 1 serious, 2 minor

**Analysis**: The component refactoring from a summary count to per-agent iteration is well-structured. The `@for` loop with `track agent.toolCallId` is correct. The DaisyUI class usage (`alert alert-warning`, `badge badge-sm badge-outline`, `btn btn-xs btn-primary`) matches existing patterns. The icon binding pattern (`[img]="PlayCircleIcon"`) matches `compaction-notification.component.ts`. The `effect()` for auto-resetting dismissed state is a reasonable approach.

**Specific Concerns**:

1. Line 171: `getTimeSince()` lacks `protected` (see Blocking Issue 1).
2. Line 204: Dead `public resetDismissed()` (see Serious Issue 3).
3. Line 139: Dead `resumeAllRequested` output (see Minor Issue 2).
4. Line 151: `dismissed` signal uses bare `readonly` -- this is actually consistent with codebase patterns (e.g., `isCollapsed`, `isStatsCollapsed`), so no issue here.

### chat-view.component.ts

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

**Analysis**: The `handleResumeAgent()` method at lines 224-228 follows the pattern of `handlePromptSelected()` at lines 204-209 and `cancelQueue()` at lines 214-217. The import of `SubagentRecord` at line 29 uses `import type` which is correct for a type-only import. The import of `ResumeNotificationBannerComponent` at line 21 is positioned logically near other notification imports (line 22, `CompactionNotificationComponent`). The method placement in the class (after `cancelQueue`, before private methods) follows the public-before-private ordering convention.

**Specific Concerns**: None. The TS file is clean.

### chat-view.component.html

**Score**: 7/10
**Issues Found**: 0 blocking, 1 serious, 1 minor

**Analysis**: The banner placement at lines 70-78 (after message container, before permission badge) matches the task specification. The binding syntax `[resumableSubagents]="chatStore.resumableSubagents()"` and `(resumeRequested)="handleResumeAgent($event)"` follows established patterns in the file (cf. line 82-84 for permission badge). The `@if` guard syntax is correct.

**Specific Concerns**:

1. Lines 71-78: Redundant outer `@if` guard (see Serious Issue 1).
2. Line 70: Missing TASK reference in comment (see Minor Issue 1).

---

## Pattern Compliance

| Pattern                 | Status | Concern                                                        |
| ----------------------- | ------ | -------------------------------------------------------------- |
| Signal-based state      | PASS   | All new signals follow private/readonly pattern                |
| Type safety             | PASS   | `SubagentRecord` type imported correctly, `import type` used   |
| DI patterns             | PASS   | Facade delegation follows established ChatStore pattern        |
| Layer separation        | PASS   | No cross-layer violations                                      |
| Access modifier         | FAIL   | `getTimeSince()` missing `protected` (1 violation)             |
| Template guard pattern  | FAIL   | Double `@if` guard inconsistent with `compaction-notification` |
| Comment style           | FAIL   | Misleading "Clear" comment; missing TASK ref in HTML           |
| DaisyUI class usage     | PASS   | `alert-warning`, `badge`, `btn` classes used correctly         |
| OnPush change detection | PASS   | Component uses `ChangeDetectionStrategy.OnPush`                |
| Lucide icon pattern     | PASS   | `protected readonly XxxIcon = Xxx` pattern followed            |

## Technical Debt Assessment

**Introduced**:

- Deprecated `resetDismissed()` and `resumeAllRequested` are dead code that will linger and confuse. Both should be removed now rather than carried forward.
- The double-guard pattern (parent `@if` + component `@if`) introduces a micro-pattern that differs from the sibling `compaction-notification`, creating inconsistency that future developers will need to navigate.

**Mitigated**:

- The old dead `refreshResumableSubagents()` method was removed from ChatStore (good cleanup).
- The private `_resumableSubagents` signal was properly relocated from ChatStore to SessionLoaderService, which is the correct home for session-scoped data.

**Net Impact**: Slight positive (dead code removed > dead code introduced), but the new dead code should be cleaned up to avoid reverting the progress.

## Verdict

**Recommendation**: NEEDS_REVISION (minor)
**Confidence**: HIGH
**Key Concern**: `getTimeSince()` missing `protected` modifier is a clear convention violation that should be fixed before merge. The other serious issues are worth addressing but could be deferred.

## What Excellence Would Look Like

A 10/10 implementation would:

- Have `getTimeSince()` marked `protected` like every other template method
- Remove the deprecated `resetDismissed()` and `resumeAllRequested` dead code rather than carrying it
- Remove the outer `@if` guard in the parent HTML, matching the `compaction-notification` pattern exactly
- Have consistent comments across all three `switchSession()` branches ("Populate", not "Clear")
- Include `<!-- TASK_2025_213: ... -->` in the HTML comment for traceability

---

---

# Code Logic Review - TASK_2025_213 (Resume Notification Banner)

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 1              |
| Serious Issues      | 2              |
| Moderate Issues     | 3              |
| Failure Modes Found | 6              |

## The 5 Paranoid Questions

### 1. How does this fail silently?

- **Stale banner on session switch exception**: If `switchSession()` throws in the `catch` block (line 370-372 of `session-loader.service.ts`), `_resumableSubagents` is never cleared. The banner continues showing agents from the _previous_ session with no indication they belong to a different session. Clicking "Resume" would send a resume prompt to the _current_ (different) session, which would confuse Claude since it has no knowledge of that agent.

- **sendMessage fires but is not awaited**: `handleResumeAgent` calls `this.chatStore.sendMessage(prompt)` without `await` (line 226 of `chat-view.component.ts`). If the send fails (validation, network, no active tab), the banner has already been cleared by `clearResumableSubagents()` on the very next line. The user sees the banner dismiss, thinks the agent is resuming, but nothing happened. There is no error feedback.

### 2. What user action causes unexpected behavior?

- **Resuming one agent clears all agents**: `handleResumeAgent` calls `clearResumableSubagents()` which sets the entire array to `[]`. If the user has 3 interrupted agents and clicks "Resume" on agent #1, agents #2 and #3 disappear from the banner permanently. The user has no way to resume them unless they switch away from the session and back (triggering a new `switchSession` that reloads the data).

- **Clicking Resume while streaming**: If the user triggers resume while the session is in `streaming` or `resuming` status, `sendMessage` delegates to `messageSender.send()` which checks `activeTab.status === 'loaded'`. During streaming, `status !== 'loaded'`, so `hasExistingSession` is false, and the code falls through to `startNewConversation()`. This would create a brand new session with the resume prompt instead of continuing the existing one. The banner would be cleared, and the resume would be lost. Note: the banner normally only appears after session load, but a race condition with concurrent streaming is theoretically possible.

### 3. What data makes this produce wrong results?

- **Agent with empty agentId**: The resume prompt template is `Resume the interrupted ${agent.agentType} agent (agentId: ${agent.agentId}) using the Task tool with resume parameter set to "${agent.agentId}".` If `agentId` is empty string, the prompt becomes nonsensical. The `SubagentRecord` type marks `agentId` as `readonly string` (non-optional), but runtime data from the backend could still be empty.

- **Agent with agentType containing injection-like content**: The prompt is constructed via string interpolation. If `agentType` contained special characters or very long strings, the prompt could be malformed. Low probability since `agentType` comes from the SDK hook, but there is no validation.

### 4. What happens when dependencies fail?

| Integration Point                                 | Failure Mode        | Current Handling                     | Assessment               |
| ------------------------------------------------- | ------------------- | ------------------------------------ | ------------------------ |
| `chat:resume` RPC returns no `resumableSubagents` | Field is undefined  | `?? []` fallback on lines 322, 349   | OK - handled             |
| `switchSession` throws exception                  | catch block fires   | Does NOT clear `_resumableSubagents` | **BUG** - stale banner   |
| `sendMessage` fails (validation)                  | Returns silently    | Banner already cleared               | **BUG** - silent failure |
| `sendMessage` fails (no session)                  | Creates new session | Unintended new session               | **CONCERN**              |
| Banner input gets empty array                     | `@if` hides banner  | Works correctly                      | OK                       |

### 5. What's missing that the requirements didn't mention?

- **No per-agent removal from the signal**: When one agent is resumed, only that agent should be removed from the array, not all agents. The current `clearResumableSubagents()` is a blunt "clear all" tool.
- **No error feedback on failed resume**: If the message send fails, the user gets no indication.
- **No loading/pending state on the Resume button**: After clicking Resume, the button should show a loading state or be disabled to prevent double-clicks. Currently, rapid clicking sends multiple resume prompts.
- **No session affinity check**: The banner does not verify that the displayed agents belong to the currently active session. If `_resumableSubagents` holds stale data from a different session, clicking Resume sends the wrong context.
- **`getTimeSince` does not update in real-time**: The relative time ("5 min ago") is computed on each change detection cycle but the component uses `OnPush` change detection. Since the input reference does not change over time, the timestamps become increasingly stale until something triggers change detection externally.

## Failure Mode Analysis

### Failure Mode 1: Multi-Agent Resume Clears All

- **Trigger**: User has 3 interrupted agents, clicks Resume on one
- **Symptoms**: All 3 agents disappear from banner; only 1 resume prompt sent
- **Impact**: SERIOUS - User loses ability to resume the other 2 agents without session reload
- **Current Handling**: `clearResumableSubagents()` empties the entire array
- **Recommendation**: Replace with `removeResumableSubagent(toolCallId: string)` that filters out only the resumed agent

### Failure Mode 2: Stale Banner After Session Switch Failure

- **Trigger**: `switchSession()` throws an exception (e.g., network error during RPC call)
- **Symptoms**: Banner shows agents from previous session; clicking Resume sends wrong context
- **Impact**: SERIOUS - Resume prompt goes to wrong session, confusing Claude
- **Current Handling**: `catch` block (line 370-372) logs error but does not clear `_resumableSubagents`
- **Recommendation**: Add `this._resumableSubagents.set([])` to the catch block

### Failure Mode 3: Fire-and-Forget Resume Send

- **Trigger**: `sendMessage` fails (validation, no session, network error)
- **Symptoms**: Banner dismisses, user thinks resume is in progress, nothing happens
- **Impact**: SERIOUS - Silent failure misleads user
- **Current Handling**: `sendMessage` is called without `await`; `clearResumableSubagents` runs unconditionally
- **Recommendation**: `await` the `sendMessage` call, only clear on success, show error toast on failure

### Failure Mode 4: Resume During Streaming Creates New Session

- **Trigger**: Resume button clicked while tab status is `streaming` or `resuming`
- **Symptoms**: A new session is created with the resume prompt; original session unaffected
- **Impact**: MODERATE - Confusing but unlikely since banner should only show after load
- **Current Handling**: `sendMessage` -> `messageSender.send()` falls through to `startNewConversation`
- **Recommendation**: Either disable Resume button during streaming or use `sendOrQueueMessage`

### Failure Mode 5: Double-Click on Resume Button

- **Trigger**: User rapidly clicks the Resume button
- **Symptoms**: Multiple resume prompts sent to Claude before `clearResumableSubagents` takes effect
- **Impact**: MODERATE - Claude receives duplicate instructions
- **Current Handling**: No debounce or disabled state
- **Recommendation**: Disable button after first click or add a guard signal

### Failure Mode 6: Stale Relative Timestamps

- **Trigger**: User leaves banner visible for extended period
- **Symptoms**: "5 min ago" text never updates; becomes inaccurate over time
- **Impact**: MINOR - Cosmetic/UX issue
- **Current Handling**: `getTimeSince()` is called during template rendering; OnPush + stable input ref means no re-evaluation
- **Recommendation**: Use a periodic timer or `setInterval` to force re-evaluation, or accept the limitation

## Critical Issues

### Issue 1: Resuming One Agent Clears All Agents From Banner

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts:227`
- **Scenario**: User has multiple interrupted agents and resumes just one
- **Impact**: Other interrupted agents vanish permanently (until session reload)
- **Evidence**:
  ```typescript
  handleResumeAgent(agent: SubagentRecord): void {
    const prompt = `Resume the interrupted ${agent.agentType} agent...`;
    this.chatStore.sendMessage(prompt);
    this.chatStore.clearResumableSubagents(); // <-- clears ALL, not just the resumed one
  }
  ```
- **Fix**: MUST FIX. Add a `removeResumableSubagent(toolCallId: string)` method to `SessionLoaderService` that uses `_resumableSubagents.update(agents => agents.filter(a => a.toolCallId !== toolCallId))`. Expose through `ChatStore` facade. Call with `agent.toolCallId` instead of `clearResumableSubagents()`.

## Serious Issues

### Issue 2: Stale Resumable Subagents After Session Switch Exception

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts:370-372`
- **Scenario**: `switchSession()` throws (e.g., RPC failure, tab manager error)
- **Impact**: Banner shows agents from a previous session; Resume sends wrong context
- **Evidence**:
  ```typescript
  } catch (error) {
    console.error('[SessionLoaderService] Failed to switch session:', error);
    // MISSING: this._resumableSubagents.set([]);
  }
  ```
- **Fix**: MUST FIX. Add `this._resumableSubagents.set([])` inside the catch block.

### Issue 3: sendMessage Not Awaited, Banner Cleared Regardless of Success

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts:224-228`
- **Scenario**: Send fails (validation rejects content, no active session)
- **Impact**: User sees banner dismiss but resume never actually sent
- **Evidence**:
  ```typescript
  handleResumeAgent(agent: SubagentRecord): void {
    const prompt = `...`;
    this.chatStore.sendMessage(prompt);          // async, not awaited
    this.chatStore.clearResumableSubagents();     // runs immediately regardless
  }
  ```
- **Fix**: SUGGESTION (non-blocking but recommended). Make the method async, await sendMessage, only clear/remove on success. Consider wrapping in try/catch with user feedback on failure.

## Moderate Issues

### Issue 4: No Double-Click Guard on Resume Button

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\notifications\resume-notification-banner.component.ts:74-88`
- **Scenario**: User rapidly clicks Resume
- **Impact**: Multiple resume prompts sent to Claude
- **Fix**: SUGGESTION. Add a `resumeInProgress` signal, set to true on click, disable button while true.

### Issue 5: `getTimeSince` Shows Only Hours for Multi-Day Intervals

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\notifications\resume-notification-banner.component.ts:171-197`
- **Scenario**: Agent interrupted 3 days ago
- **Impact**: Shows "72 hr ago" instead of "3 days ago" -- functional but awkward
- **Fix**: SUGGESTION. Add a `days` tier for intervals > 24 hours.

### Issue 6: Redundant @if Guard in Parent Template

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html:71`
- **Scenario**: The outer `@if (chatStore.resumableSubagents().length > 0)` destroys/recreates the component, resetting its internal `dismissed` signal
- **Impact**: The `dismissed` signal inside the banner is somewhat pointless when `clearResumableSubagents()` is used because the outer `@if` removes the component. However, the dismiss (X) button still works correctly since it uses the internal signal without clearing the data. This is functionally correct but the lifecycle interaction is confusing.
- **Fix**: SUGGESTION. Consider removing the outer `@if` guard and relying solely on the component's internal visibility logic, OR remove the internal `dismissed` logic and rely only on the parent `@if`. Having both creates confusing lifecycle semantics.

## Data Flow Analysis

```
Backend (chat:resume RPC)
  |
  v
SessionLoaderService.switchSession()
  |-- success + events --> _resumableSubagents.set(data ?? [])  [line 322]
  |-- success + messages --> _resumableSubagents.set(data ?? [])  [line 349]
  |-- success + empty --> _resumableSubagents.set([])  [line 368]
  |-- CATCH (exception) --> *** NOT CLEARED *** [GAP]
  |
  v
ChatStore.resumableSubagents (facade delegation)  [line 164]
  |
  v
chat-view.component.html @if guard  [line 71]
  |
  v
ResumeNotificationBannerComponent
  |-- [resumableSubagents] input signal
  |-- effect() watches count changes, auto-resets dismissed
  |-- User clicks Resume --> output.emit(agent)
  |
  v
ChatViewComponent.handleResumeAgent(agent)
  |-- Builds prompt string (no validation)
  |-- chatStore.sendMessage(prompt)  <-- NOT AWAITED [GAP]
  |-- chatStore.clearResumableSubagents()  <-- CLEARS ALL [GAP]
  |
  v
MessageSenderService.send()
  |-- Validates content
  |-- Checks activeTab.status === 'loaded'
  |   |-- If loaded: continueConversation  (happy path)
  |   |-- If streaming: FALLS THROUGH to startNewConversation [GAP]
  |   |-- If no tab: startNewConversation
```

### Gap Points Identified:

1. Catch block in switchSession does not clear resumable subagents (stale data risk)
2. sendMessage not awaited; clearResumableSubagents fires unconditionally
3. clearResumableSubagents is all-or-nothing; no per-agent removal
4. No guard against calling sendMessage during streaming state

## Requirements Fulfillment

| Requirement                                    | Status   | Concern                            |
| ---------------------------------------------- | -------- | ---------------------------------- |
| Populate resumableSubagents after session load | COMPLETE | Catch block gap                    |
| Banner shows each agent individually           | COMPLETE | None                               |
| Per-agent resume button                        | COMPLETE | Clears all instead of one          |
| Display agent type, ID, time since             | COMPLETE | Time display caps at hours         |
| Dismiss (X) button                             | COMPLETE | None                               |
| Banner auto-dismisses on clear                 | COMPLETE | None                               |
| Auto-reset dismissed on new arrivals           | COMPLETE | Effect-based, works well           |
| Wire resume to sendMessage                     | COMPLETE | Not awaited, no error handling     |
| Clear on resume click                          | PARTIAL  | Clears all, not just resumed agent |
| Session switch updates banner                  | PARTIAL  | Catch block gap leaves stale data  |

### Implicit Requirements NOT Addressed:

1. Per-agent removal when resuming one of many agents
2. Error feedback when resume send fails
3. Loading/disabled state on Resume button after click
4. Session affinity validation (banner agents match current session)

## Edge Case Analysis

| Edge Case                                   | Handled | How                                          | Concern                                        |
| ------------------------------------------- | ------- | -------------------------------------------- | ---------------------------------------------- |
| No interrupted agents                       | YES     | Outer @if + inner @if hide banner            | None                                           |
| Multiple interrupted agents                 | YES     | @for iterates all                            | Clearing all on single resume                  |
| Session with no workspace path              | YES     | switchSession returns early (line 232-234)   | resumableSubagents not cleared on early return |
| User clicks Resume but session not active   | PARTIAL | sendMessage checks tab status                | Falls through to new session if streaming      |
| Agent already resumed via context injection | NO      | Banner persists until manual clear           | Stale banner until session reload              |
| switchSession throws exception              | NO      | Catch block does not clear signal            | Stale banner from previous session             |
| Null/undefined interruptedAt                | YES     | getTimeSince returns '' for null/undefined   | Renders empty span                             |
| Future timestamp in interruptedAt           | YES     | getTimeSince returns '' for negative elapsed | Good defensive check                           |
| Very old interruptedAt (days)               | PARTIAL | Shows "72 hr ago"                            | Functional but poor UX                         |
| Rapid clicks on Resume                      | NO      | No debounce/disable                          | Duplicate prompts                              |
| Empty agentId in SubagentRecord             | NO      | Prompt includes empty string                 | Malformed prompt                               |

## Integration Risk Assessment

| Integration                                  | Failure Probability | Impact                    | Mitigation                 |
| -------------------------------------------- | ------------------- | ------------------------- | -------------------------- |
| SessionLoader -> ChatStore signal delegation | LOW                 | Banner shows stale data   | Facade delegation is clean |
| ChatStore -> MessageSender                   | LOW                 | Resume prompt not sent    | No error feedback to user  |
| ChatView -> ChatStore.sendMessage            | MED                 | Send fails silently       | Not awaited, no try/catch  |
| switchSession catch block                    | MED                 | Stale agents shown        | Missing cleanup in catch   |
| Banner effect for auto-reset                 | LOW                 | Dismissed state not reset | Well-implemented           |

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: Resuming one agent clears all agents from the banner, permanently losing the ability to resume others without session reload.

### MUST FIX (blocking):

1. Add `removeResumableSubagent(toolCallId)` to SessionLoaderService + ChatStore facade; use it in `handleResumeAgent` instead of `clearResumableSubagents()`
2. Add `this._resumableSubagents.set([])` to the `catch` block of `switchSession()` at line 371

### SUGGESTION (non-blocking):

3. Make `handleResumeAgent` async, await `sendMessage`, only remove agent on success
4. Add double-click guard or button disable on Resume click
5. Add days tier to `getTimeSince` for intervals > 24 hours
6. Unify the dual `@if` guard pattern (pick either parent or child to own visibility)

## What Robust Implementation Would Include

1. **Per-agent removal**: `removeResumableSubagent(toolCallId: string)` that filters out only the resumed agent from the array, leaving others intact
2. **Awaited send with error handling**: `handleResumeAgent` should be async, await the send, and only remove the agent from the signal on success
3. **Button disabled state**: After clicking Resume, disable the button and show a spinner to prevent double-clicks
4. **Session affinity**: Store the session ID alongside resumable subagents, and clear them if the active session changes to a different ID
5. **Catch block cleanup**: Clear `_resumableSubagents` in the switchSession catch block
6. **Days tier in getTimeSince**: Handle >24h with "X days ago" for better UX
7. **Guard against streaming state**: Use `sendOrQueueMessage` instead of `sendMessage`, or check streaming state before sending

## Files Reviewed

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\notifications\resume-notification-banner.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
- `D:\projects\ptah-extension\libs\shared\src\lib\types\subagent-registry.types.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\message-sender.service.ts`
