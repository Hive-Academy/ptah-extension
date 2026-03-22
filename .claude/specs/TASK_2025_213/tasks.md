# Development Tasks - TASK_2025_213 (Resume Notification Banner Feature)

**Total Tasks**: 5 | **Batches**: 2 | **Status**: 0/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `ResumeNotificationBannerComponent` already exists at `libs/frontend/chat/src/lib/components/molecules/notifications/resume-notification-banner.component.ts`: VERIFIED
- `ChatStore._resumableSubagents` signal and `refreshResumableSubagents()` method exist: VERIFIED (chat.store.ts lines 165-465)
- `SubagentRecord` type has `toolCallId`, `agentId`, `agentType`, `status`, `parentSessionId`, `interruptedAt`: VERIFIED (subagent-registry.types.ts)
- `SessionLoaderService.switchSession()` receives `resumableSubagents` from `chat:resume` response: VERIFIED (session-loader.service.ts line 285)
- `ConversationService.continueConversation()` calls `chat:continue` RPC for sending messages: VERIFIED (conversation.service.ts line 448)
- `chat:continue` handler already auto-injects interrupted agent context into prompt: VERIFIED (chat-rpc.handlers.ts lines 852-899)
- Banner was removed from `chat-view.component.html` in TASK_2025_109: VERIFIED (line 14 comment)

### Risks Identified

| Risk                                                                          | Severity | Mitigation                                                          |
| ----------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| `refreshResumableSubagents()` is never called - signal is always empty        | MED      | Task 1.1 adds calls after session load and after turn completion    |
| Banner may show stale data if agent was already resumed via context injection | LOW      | Task 1.2 clears resumableSubagents when a new turn starts streaming |

### Edge Cases to Handle

- [x] Multiple interrupted agents from same session -> banner shows each with its own resume button
- [x] Agent successfully resumed -> banner auto-dismisses when resumableSubagents becomes empty
- [x] Session switch -> refresh resumableSubagents from new session's data
- [x] No interrupted agents -> banner is hidden (existing @if guard)
- [x] User sends a message (which triggers context injection) -> clear resumableSubagents at turn start

---

## Batch 1: Data Flow - Populate resumableSubagents signal at the right times [IMPLEMENTED]

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Populate \_resumableSubagents after session load in SessionLoaderService [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`
**Pattern to Follow**: How `cliSessions` is handled in the same method (lines 286-321)

**Quality Requirements**:

- After `switchSession()` processes events and calls `finalizeSessionHistory()`, it already has `resumableSubagents` from the `chat:resume` response (line 285)
- Pass these to ChatStore so the `_resumableSubagents` signal is populated
- This requires SessionLoaderService to have access to a method that sets the signal

**Validation Notes**:

- SessionLoaderService does NOT currently inject ChatStore (it would create a circular dependency since ChatStore injects SessionLoaderService)
- Solution: Add a `setResumableSubagents(subagents: SubagentRecord[])` callback or use a shared signal service
- Simplest approach: SessionLoaderService already has access to the data. Add a signal directly to SessionLoaderService and expose it through ChatStore facade (same pattern as `sessions`, `hasMoreSessions` etc.)

**Implementation Details**:

1. In `SessionLoaderService`, add a private signal and public readonly:
   ```typescript
   private readonly _resumableSubagents = signal<SubagentRecord[]>([]);
   readonly resumableSubagents = this._resumableSubagents.asReadonly();
   ```
2. In `switchSession()`, after line 313 (after `finalizeSessionHistory`), add:
   ```typescript
   // Populate resumableSubagents signal for the banner UI
   this._resumableSubagents.set(resumableSubagents ?? []);
   ```
3. Also clear it when switching to sessions with no resumable agents (in the fallback and error branches)
4. Import `SubagentRecord` from `@ptah-extension/shared`

---

### Task 1.2: Wire ChatStore facade to delegate resumableSubagents from SessionLoaderService [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`
**Dependencies**: Task 1.1
**Pattern to Follow**: How `sessions`, `hasMoreSessions`, `totalSessions` are delegated (lines 148-151)

**Quality Requirements**:

- Replace the private `_resumableSubagents` signal and `refreshResumableSubagents()` method with delegation to SessionLoaderService
- The `resumableSubagents` public readonly signal should now read from `sessionLoader.resumableSubagents`
- Remove the old `_resumableSubagents` private signal and the `refreshResumableSubagents()` method (dead code -- never called)

**Implementation Details**:

1. Remove lines 165-166 (`_resumableSubagents` signal and `resumableSubagents` readonly)
2. Remove lines 449-465 (`refreshResumableSubagents()` method)
3. Add delegation: `readonly resumableSubagents = this.sessionLoader.resumableSubagents;`
4. Place it alongside other session signal delegations (after line 151)

---

### Task 1.3: Clear resumableSubagents when a new turn starts (streaming begins) [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`
**Dependencies**: Task 1.1

**Quality Requirements**:

- When the user sends a message (triggering `chat:continue`), the backend auto-injects interrupted agent context into the prompt and then clears them from the registry
- The frontend banner should also clear at this point so it disappears during the active turn
- Add a `clearResumableSubagents()` method to SessionLoaderService
- This should be called from ChatStore or ConversationService when a turn starts

**Implementation Details**:

1. In `SessionLoaderService`, add:
   ```typescript
   clearResumableSubagents(): void {
     this._resumableSubagents.set([]);
   }
   ```
2. In `ChatStore.handleSessionStats()` (around line 1007), after the streaming handler completes, call `this.sessionLoader.clearResumableSubagents()` -- because at this point the turn is done and any agents that were injected are now handled. The banner should already be gone because it was cleared at turn start.
3. Actually, the better trigger is when the user SENDS a message. In `ConversationService.continueConversation()`, the message is sent. However, ConversationService does not have access to SessionLoaderService.
4. Best approach: Clear it in `ChatStore.sendOrQueueMessage()` or `ChatStore.sendMessage()` when not streaming. Add a call `this.sessionLoader.clearResumableSubagents()` before the message is sent.
5. Alternatively, add a `clearResumableSubagents()` delegation in ChatStore and call it from `ChatViewComponent` when resume is triggered (simpler).

**Final approach**: Add `clearResumableSubagents()` to SessionLoaderService. Expose as delegation in ChatStore. Call it from the resume banner's event handler in `ChatViewComponent` (Task 2.2).

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- code-logic-reviewer approved
- `resumableSubagents` signal is populated when loading a session with interrupted agents
- Signal is cleared when user resumes an agent

---

## Batch 2: UI Component - Enhanced resume banner with per-agent resume buttons [PENDING]

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 2.1: Enhance ResumeNotificationBannerComponent with per-agent display and individual resume buttons [PENDING]

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\notifications\resume-notification-banner.component.ts`
**Pattern to Follow**: Existing DaisyUI alert styling in the component, agent-card-header.component.ts for agent type display

**Quality Requirements**:

- Show each interrupted agent individually (not just a count)
- Display: agent type, agentId (truncated), time since interruption (e.g., "5 min ago")
- Each agent gets its own "Resume" button
- Keep the "Dismiss" (X) button for manual dismissal
- Remove the "Resume All" button -- replace with individual per-agent resume buttons
- Use DaisyUI `alert alert-warning` (warning instead of info, since these are interrupted agents)
- Add a new output: `resumeRequested` that emits the `SubagentRecord` when a specific agent's resume button is clicked
- Keep the existing `resumeAllRequested` output as deprecated/removed (or keep for backward compat)
- Position: sticky at the bottom of the message list area (handled by parent placement)
- Use relative time display: compute "X min ago" from `interruptedAt` timestamp

**Implementation Details**:

- Template should iterate over `resumableSubagents()` and show each agent as a row:
  ```html
  @for (agent of resumableSubagents(); track agent.toolCallId) {
  <div class="flex items-center justify-between gap-2 py-1">
    <div class="flex items-center gap-2 min-w-0">
      <span class="badge badge-sm badge-outline">{{ agent.agentType }}</span>
      <span class="text-xs opacity-70 font-mono">{{ agent.agentId }}</span>
      <span class="text-xs opacity-50">{{ getTimeSince(agent.interruptedAt) }}</span>
    </div>
    <button class="btn btn-xs btn-primary gap-1" (click)="onResume(agent)">
      <lucide-angular [img]="PlayCircleIcon" class="w-3 h-3" />
      Resume
    </button>
  </div>
  }
  ```
- Add `getTimeSince(timestamp: number | undefined): string` method that returns relative time
- Add `resumeRequested = output<SubagentRecord>()` output
- The `onResume(agent)` method emits on `resumeRequested`

---

### Task 2.2: Re-integrate banner into ChatViewComponent and wire resume action [PENDING]

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` AND `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`

**Dependencies**: Task 2.1, Batch 1
**Pattern to Follow**: How CompactionNotificationComponent is integrated (line 18-20 in HTML, line 66 in TS imports)

**Quality Requirements**:

- Add `ResumeNotificationBannerComponent` back to the imports array in `chat-view.component.ts`
- Add the banner in the HTML template, positioned BELOW the message list (before the permission badge, after the message container div closes)
- Wire the `[resumableSubagents]` input to `chatStore.resumableSubagents()`
- Wire the `(resumeRequested)` output to a handler that:
  1. Builds a resume prompt: `Resume the interrupted [agentType] agent (agentId: [agentId]) using the Task tool with resume parameter set to "[agentId]".`
  2. Calls `chatStore.sendMessage(prompt)` to send it as a continue message
  3. Calls `chatStore.clearResumableSubagents()` (from Task 1.3) to dismiss the banner immediately
- Remove the TASK_2025_109 comment about removal

**Implementation Details**:

1. In `chat-view.component.ts`:

   - Add `ResumeNotificationBannerComponent` to the imports array
   - Remove the comment on line 21 (`// TASK_2025_109: ResumeNotificationBannerComponent removed...`)
   - Add a `handleResumeAgent(agent: SubagentRecord)` method

2. In `chat-view.component.html`:

   - After the message container `</div>` (line 69) and before the permission badge (line 72), add:

   ```html
   <!-- Resume Notification Banner (sticky at bottom of messages) -->
   <ptah-resume-notification-banner [resumableSubagents]="chatStore.resumableSubagents()" (resumeRequested)="handleResumeAgent($event)" />
   ```

   - Remove the comment on line 14 (`<!-- TASK_2025_109: Resume Notification Banner removed...`)

3. The `handleResumeAgent` method:
   ```typescript
   handleResumeAgent(agent: SubagentRecord): void {
     const prompt = `Resume the interrupted ${agent.agentType} agent (agentId: ${agent.agentId}) using the Task tool with resume parameter set to "${agent.agentId}".`;
     this.chatStore.sendMessage(prompt);
   }
   ```

---

**Batch 2 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- code-logic-reviewer approved
- Banner appears at bottom of message list when interrupted agents exist
- Each agent shown with type, ID, and time since interruption
- Clicking "Resume" sends the correct prompt
- Banner dismisses when agents list is cleared
- Manual dismiss (X button) works
- Banner auto-reappears when new interrupted agents arrive
