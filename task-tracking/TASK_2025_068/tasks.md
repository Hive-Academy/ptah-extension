# Development Tasks - TASK_2025_068

**Task Type**: Full-Stack  
**Total Tasks**: 17  
**Total Batches**: 6  
**Batching Strategy**: Layer-based (shared → backend → frontend → integration)  
**Status**: 1/6 batches complete (17%) - Batch 2 in progress

---

## Batch 1: Shared Type Updates ✅ COMPLETE

**Git Commit**: (User handling commit + lint fixes)

**Assigned To**: backend-developer  
**Tasks in Batch**: 3  
**Dependencies**: None  
**Estimated Commits**: 1 (one commit per batch)

### Task 1.1: Update TabState interface in chat.types.ts ✅ COMPLETE

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.types.ts`  
**Specification Reference**: implementation-plan.md:51-113  
**Pattern to Follow**: sdk-session.types.ts:89-140 (StoredSession interface with name field)  
**Expected Commit Pattern**: `feat(webview): add name field and UUID documentation to TabState`

**Quality Requirements**:

- ✅ `placeholderSessionId` documentation updated to specify UUID v4 format
- ✅ `name` field added with clear documentation
- ✅ Backward compatible (existing code treating placeholderSessionId as string still works)

**Implementation Details**:

- **Current `placeholderSessionId` type**: `string | null` (optional)
- **New `placeholderSessionId` type**: `string | null` (required, not optional)
- **Add field**: `name: string` (user-provided or auto-generated session name)
- **Documentation update**: Add JSDoc comment explaining UUID v4 format with example
- **Note**: Keep `title` field for backward compatibility (deprecated annotation)

---

### Task 1.2: Update ChatStartParams and ChatContinueParams in rpc.types.ts ✅ COMPLETE

**File(s)**: `d:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`  
**Specification Reference**: implementation-plan.md:238-295  
**Pattern to Follow**: Existing RPC types with optional parameters  
**Expected Commit Pattern**: `feat(webview): add optional name parameter to chat RPC types`

**Quality Requirements**:

- ✅ Type-safe session naming in RPC calls
- ✅ Optional parameter (backward compatible)
- ✅ Available in both start and continue flows

**Implementation Details**:

- **Line Range**: 17-59 (ChatStartParams and related types)
- **Add to `ChatStartParams`**: `name?: string` with JSDoc comment "User-provided session name (optional)"
- **Add to `ChatContinueParams`**: `name?: string` with JSDoc comment "User-provided session name (optional - for late naming)"

---

### Task 1.3: Install uuid package dependency ✅ COMPLETE

**File(s)**: `d:\projects\ptah-extension\package.json`  
**Specification Reference**: implementation-plan.md:582-608  
**Pattern to Follow**: Existing dependency management  
**Expected Commit Pattern**: `chore(deps): add uuid package for proper UUID v4 generation`

**Quality Requirements**:

- ✅ UUID generation available in frontend
- ✅ Type definitions for UUID v4 function

**Implementation Details**:

- **Add to dependencies**: `"uuid": "^10.0.0"`
- **Add to devDependencies**: `"@types/uuid": "^10.0.0"`
- **Run after adding**: `npm install` to verify installation

---

**Batch 1 Verification Requirements**:

- ✅ All 3 files modified at specified paths
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build shared` and `npx nx build chat`
- ✅ No TypeScript compilation errors
- ✅ Dependencies installed successfully

---

## Batch 2: Backend Session Management 🔄 IN PROGRESS

**Assigned To**: backend-developer  
**Tasks in Batch**: 4  
**Dependencies**: Batch 1 complete (needs RPC types)  
**Estimated Commits**: 1 (one commit per batch)

### Task 2.1: Update SessionLifecycleManager.createSessionRecord() ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`  
**Specification Reference**: implementation-plan.md:304-359  
**Pattern to Follow**: sdk-session-storage.ts (session persistence pattern)  
**Expected Commit Pattern**: `feat(vscode): add session name storage to SessionLifecycleManager`

**Quality Requirements**:

- ✅ Session names stored in `StoredSession.name` field (already exists in schema)
- ✅ Default name generation with consistent format
- ✅ No schema migration required (field already exists)

**Implementation Details**:

- **Update method signature**: `createSessionRecord(sessionId: SessionId, name?: string)`
- **Add default naming logic**: `const sessionName = name || \`Session ${new Date().toLocaleString()}\`;`
- **Pass to storage**: Store `sessionName` in `StoredSession.name` field
- **Optional method**: Add `updateClaudeSessionId()` if not already exists (preserve name during update)

---

### Task 2.2: Update SdkAgentAdapter.startChatSession() ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`  
**Dependencies**: Task 2.1 (requires createSessionRecord signature change)  
**Specification Reference**: implementation-plan.md:362-392  
**Pattern to Follow**: Existing session creation flow with config object  
**Expected Commit Pattern**: `feat(vscode): pass session name through SdkAgentAdapter`

**Quality Requirements**:

- ✅ Session name passed from RPC layer to storage
- ✅ Backward compatible (name is optional)

**Implementation Details**:

- **Line Range**: 400-430 (startChatSession method)
- **Update method signature**: `startChatSession(sessionId: SessionId, config?: AISessionConfig & { name?: string })`
- **Pass name to lifecycle**: `await this.sessionLifecycle.createSessionRecord(sessionId, config?.name);`
- **Note**: The rest of the method remains unchanged

---

### Task 2.3: Update chat:start RPC handler ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`  
**Dependencies**: Task 2.2 (requires SdkAgentAdapter signature change)  
**Specification Reference**: implementation-plan.md:401-466  
**Pattern to Follow**: Existing RPC parameter extraction pattern (lines 258-262)  
**Expected Commit Pattern**: `feat(vscode): extract and pass session name in chat:start RPC handler`

**Quality Requirements**:

- ✅ Session name extracted from RPC params
- ✅ Logged for debugging
- ✅ Passed to backend session creation

**Implementation Details**:

- **Line Range**: 252-312 (chat:start RPC handler)
- **Extract name**: `const { prompt, sessionId, workspacePath, options, name } = params;`
- **Add debug logging**: Log `sessionName: name` in existing debug logger
- **Pass to adapter**: Add `name` to config object passed to `startChatSession()`

---

### Task 2.4: Update chat:continue RPC handler ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`  
**Dependencies**: None (independent update in same file)  
**Specification Reference**: implementation-plan.md:401-466 (similar pattern to chat:start)  
**Pattern to Follow**: chat:start RPC handler (Task 2.3)  
**Expected Commit Pattern**: `feat(vscode): extract and pass session name in chat:continue RPC handler`

**Quality Requirements**:

- ✅ Session name extracted from RPC params
- ✅ Support for late naming (user can name session after it starts)
- ✅ Logged for debugging

**Implementation Details**:

- **Find chat:continue RPC handler** (search for `'chat:continue'`)
- **Extract name**: `const { ..., name } = params;`
- **Add debug logging**: Log `sessionName: name`
- **Note**: May need to update session record if name provided on continue

---

**Batch 2 Verification Requirements**:

- ✅ All 4 files modified (1 shared file with 2 tasks)
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build agent-sdk` and `npx nx build ptah-extension-vscode`
- ✅ Backend logs show session names when RPC calls include name parameter
- ✅ No TypeScript compilation errors

---

## Batch 3: Frontend Tab Management + UI ⏸️ PENDING

**Assigned To**: frontend-developer  
**Tasks in Batch**: 4  
**Dependencies**: Batch 1 complete (needs TabState with name field)  
**Estimated Commits**: 1 (one commit per batch)

### Task 3.1: Add PopoverComponent and session name state to AppShellComponent ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`  
**Specification Reference**: implementation-plan.md:617-764  
**Pattern to Follow**: confirmation-dialog.component.ts (existing component pattern)  
**Expected Commit Pattern**: `feat(webview): add session name popover state and handlers to AppShell`

**Quality Requirements**:

- ✅ Uses existing `PopoverComponent` from `@ptah-extension/ui`
- ✅ Slugified default naming: `session-MM-DD-HH-mm`
- ✅ Signal-based reactive state
- ✅ Optional session name (empty = default)

**Implementation Details**:

- **Import additions**:
  - `import { FormsModule } from '@angular/forms';`
  - `import { PopoverComponent } from '@ptah-extension/ui';`
  - `import { Check, X } from 'lucide-angular';` (add to existing Lucide imports)
- **Add to imports array**: `FormsModule`, `PopoverComponent`
- **Add icons**: `readonly CheckIcon = Check;`, `readonly XIcon = X;`
- **Add popover state signals**:
  - `private readonly _sessionNamePopoverOpen = signal(false);`
  - `readonly sessionNamePopoverOpen = this._sessionNamePopoverOpen.asReadonly();`
  - `readonly sessionNameInput = signal('');`
- **Add helper method**: `private generateDefaultSessionName(): string` (slugified timestamp format)
- **Update `createNewSession()`**: Clear input, open popover
- **Add handlers**: `handleCreateSession()`, `handleCancelSession()`

---

### Task 3.2: Wrap "New Session" button with PopoverComponent ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`  
**Dependencies**: Task 3.1 (requires component state and handlers)  
**Specification Reference**: implementation-plan.md:767-824  
**Pattern to Follow**: PopoverComponent API (isOpen, position, hasBackdrop, closed event)  
**Expected Commit Pattern**: `feat(webview): integrate session name input popover in app-shell template`

**Quality Requirements**:

- ✅ Uses `PopoverComponent API` (isOpen, position, hasBackdrop, closed event)
- ✅ Trigger slot: "New Session" button
- ✅ Content slot: Input form with Cancel/Create buttons
- ✅ Keyboard shortcuts: Enter = create, ESC = cancel
- ✅ Auto-positioned below button via PopoverComponent

**Implementation Details**:

- **Line Range**: 24-32 ("New Session" button location)
- **Wrap button with**: `<ptah-popover>`
- **Popover attributes**:
  - `[isOpen]="sessionNamePopoverOpen()"`
  - `[position]="'below'"`
  - `[hasBackdrop]="true"`
  - `[backdropClass]="'cdk-overlay-transparent-backdrop'"`
  - `(closed)="handleCancelSession()"`
- **Button**: Add `trigger` attribute
- **Popover content**: Add `div` with `content` attribute containing input field and buttons
- **Input field**: `[(ngModel)]="sessionNameInput"`, `( keydown.enter)="handleCreateSession()"`, `(keydown.escape)="handleCancelSession()"`

---

### Task 3.3: Update TabManager.createNewTab() to use uuid v4 ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`  
**Specification Reference**: implementation-plan.md:122-178  
**Pattern to Follow**: chat.store.ts (signal-based state management pattern)  
**Expected Commit Pattern**: `feat(webview): generate proper UUID v4 for placeholderSessionId in TabManager`

**Quality Requirements**:

- ✅ Uses `uuid.v4()` for placeholder IDs (passes UUID validation)
- ✅ Atomic resolution operation (no race conditions)
- ✅ Session naming with timestamp default
- ✅ Backward compatible (title field maintained)

**Implementation Details**:

- **Import**: `import { v4 as uuidv4 } from 'uuid';`
- **Update method signature**: `createNewTab(name?: string): TabState`
- **Generate UUID**: `const placeholderId = uuidv4();` (replace existing msg\_ format)
- **Handle name**: `const sessionName = name || \`Session ${new Date().toLocaleString()}\`;` (Note: Default will be overridden by AppShellComponent's slugified version)
- **Update return object**:
  - `placeholderSessionId: placeholderId` (valid UUID v4)
  - `name: sessionName`
  - `title: sessionName` (keep for backward compatibility)

---

### Task 3.4: Update TabManager.resolveSessionId() for atomic resolution ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`  
**Dependencies**: None (same file as Task 3.3, independent method)  
**Specification Reference**: implementation-plan.md:122-178 (lines 154-169)  
**Pattern to Follow**: chat.store.ts (signal-based state management pattern)  
**Expected Commit Pattern**: `feat(webview): implement atomic session ID resolution in TabManager`

**Quality Requirements**:

- ✅ Atomic resolution operation (no race conditions)
- ✅ Clears placeholderSessionId after resolution
- ✅ Updates status to 'active'

**Implementation Details**:

- **Find or create method**: `resolveSessionId(placeholderId: string, claudeSessionId: string): void`
- **Implementation**: Use `map` over tabs array to find matching placeholder
- **Atomic update**:
  ```typescript
  this.updateTabs((tabs) =>
    tabs.map((tab) =>
      tab.placeholderSessionId === placeholderId
        ? {
            ...tab,
            claudeSessionId,
            placeholderSessionId: null, // Clear after resolution
            status: 'active',
          }
        : tab
    )
  );
  ```

---

**Batch 3 Verification Requirements**:

- ✅ All 2 files modified (app-shell.component.ts + .html, tab-manager.service.ts)
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build chat`
- ✅ PopoverComponent imported correctly from `@ptah-extension/ui`
- ✅ FormsModule imported for ngModel directive
- ✅ UUID package imported and used correctly
- ✅ No TypeScript compilation errors

---

## Batch 4: Frontend RPC Integration ⏸️ PENDING

**Assigned To**: frontend-developer  
**Tasks in Batch**: 2  
**Dependencies**: Batch 2 complete (backend RPC handlers ready), Batch 3 complete (TabState has name field)  
**Estimated Commits**: 1 (one commit per batch)

### Task 4.1: Update MessageSenderService to send session name in RPC calls ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\services\message-sender.service.ts`  
**Specification Reference**: implementation-plan.md:475-526  
**Pattern to Follow**: Existing RPC call pattern with parameter construction  
**Expected Commit Pattern**: `feat(webview): send session name in chat RPC calls from MessageSender`

**Quality Requirements**:

- ✅ Session name sent in RPC calls
- ✅ Available in both start and continue flows
- ✅ Type-safe (TypeScript ensures name exists in params)

**Implementation Details**:

- **Find `sendMessage()` method** (or equivalent method that calls chat:start/continue)
- **Get tab data**: `const tab = this.tabManager.findTabBySessionId(sessionId);`
- **Extract tab name**: `const name = tab.name;`
- **Add to chat:start RPC**: `name: tab.name` (in parameters object)
- **Add to chat:continue RPC**: `name: tab.name` (in parameters object)

---

### Task 4.2: Update SessionLoaderService for atomic resolution ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`  
**Dependencies**: Batch 3 Task 3.4 (requires TabManager.resolveSessionId method)  
**Specification Reference**: implementation-plan.md:535-573  
**Pattern to Follow**: Existing event handler pattern  
**Expected Commit Pattern**: `feat(webview): implement atomic session ID resolution with legacy UUID handling`

**Quality Requirements**:

- ✅ Atomic resolution operation
- ✅ Backward compatible (graceful degradation for legacy IDs)
- ✅ Proper logging for debugging

**Implementation Details**:

- **Find or update method**: `handleSessionIdResolved(placeholder: string, real: string): void`
- **Add logging**: `this.logger.info('[SessionLoader] Session ID resolved', { placeholder, real });`
- **Add UUID validation**:
  ```typescript
  if (!placeholder.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
    this.logger.warn('[SessionLoader] Skipping legacy placeholder ID', { placeholder, format: 'non-UUID' });
    return;
  }
  ```
- **Call TabManager atomic resolution**: `this.tabManager.resolveSessionId(placeholder, real);`

---

**Batch 4 Verification Requirements**:

- ✅ All 2 files modified
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build chat`
- ✅ TabManager integration verified (resolveSessionId called)
- ✅ UUID regex validation works correctly
- ✅ No TypeScript compilation errors

---

## Batch 5: Session Resolution & Cleanup ⏸️ PENDING

**Assigned To**: frontend-developer  
**Tasks in Batch**: 2  
**Dependencies**: Batch 3 complete (Tab Manager atomic resolution ready)  
**Estimated Commits**: 1 (one commit per batch)

### Task 5.1: Refactor PendingSessionManagerService to remove timeout logic ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\services\pending-session-manager.service.ts`  
**Specification Reference**: implementation-plan.md:181-229  
**Pattern to Follow**: Existing constructor and methods, simplified  
**Expected Commit Pattern**: `refactor(webview): simplify PendingSessionManager with immediate cleanup`

**Quality Requirements**:

- ✅ No memory leaks (immediate cleanup, no 60s retention)
- ✅ Simpler logic (remove timeout complexity)
- ✅ Atomic coordination with TabManager

**Implementation Details**:

- **Find `add()` method**: Remove 60-second `setTimeout()` cleanup logic
- **Simplify to**: `this.resolutions.set(placeholderId, tabId);` (no timeout)
- **Update `resolve()` method**:
  ```typescript
  resolve(placeholderId: string, realId: string): void {
    const tabId = this.resolutions.get(placeholderId);
    if (tabId) {
      this.tabManager.resolveSessionId(placeholderId, realId);
      this.resolutions.delete(placeholderId); // Immediate cleanup
    }
  }
  ```
- **Remove timeout-related variables** if any exist

---

### Task 5.2: Add backward compatibility for legacy placeholder IDs ⏸️ PENDING

**File(s)**: `d:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`  
**Dependencies**: Task 4.2 (extends same method)  
**Specification Reference**: implementation-plan.md:535-573 (handleSessionIdResolved method)  
**Pattern to Follow**: Existing event handler pattern  
**Expected Commit Pattern**: `feat(webview): add backward compatibility for legacy msg_ placeholder IDs`

**Quality Requirements**:

- ✅ Legacy placeholder IDs (msg\_\*) gracefully ignored
- ✅ Warning logged for legacy IDs
- ✅ No disruption to existing sessions

**Implementation Details**:

- **Note**: This task is already covered in Task 4.2 (UUID validation)
- **If Task 4.2 not yet complete**: Add UUID validation check to skip non-UUID placeholders
- **If Task 4.2 complete**: Verify UUID validation exists and logs warnings correctly
- **Test with legacy ID**: `msg_1234567_abc` should be skipped with warning

---

**Batch 5 Verification Requirements**:

- ✅ All 2 files modified (pending-session-manager.service.ts, session-loader.service.ts)
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build chat`
- ✅ No setTimeout calls in PendingSessionManager
- ✅ Legacy placeholder IDs handled gracefully
- ✅ No TypeScript compilation errors

---

## Batch 6: Testing & Documentation ⏸️ PENDING

**Assigned To**: frontend-developer OR backend-developer (either can handle)  
**Tasks in Batch**: 2  
**Dependencies**: Batches 1-5 complete (all implementation finished)  
**Estimated Commits**: 1 (one commit per batch)

### Task 6.1: Write unit tests for UUID generation and atomic resolution ⏸️ PENDING

**File(s)**:

- `d:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.spec.ts`
- `d:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.spec.ts`

**Specification Reference**: implementation-plan.md:975-1038 (Verification Plan - Automated Tests)  
**Pattern to Follow**: Existing spec files in same directories  
**Expected Commit Pattern**: `test(webview): add tests for UUID generation, atomic resolution, and dialog UX`

**Quality Requirements**:

- ✅ TabManager tests verify UUID v4 generation
- ✅ TabManager tests verify atomic resolution
- ✅ SessionLifecycleManager tests verify session name storage
- ✅ All tests pass

**Implementation Details**:

**tab-manager.service.spec.ts**:

- Test: `createNewTab() generates valid UUID v4 for placeholderSessionId`
  - Verify format matches UUID regex
  - Verify not null
- Test: `createNewTab() uses provided name or generates default`
  - Call with name → verify tab.name equals provided name
  - Call without name → verify tab.name has default format
- Test: `resolveSessionId() atomically updates tab state`
  - Create tab with placeholder
  - Call resolveSessionId
  - Verify claudeSessionId updated
  - Verify placeholderSessionId is null
  - Verify status is 'active'

**session-lifecycle-manager.spec.ts**:

- Test: `createSessionRecord() stores custom session name`
  - Call with name parameter
  - Verify stored session has correct name
- Test: `createSessionRecord() generates default name when none provided`
  - Call without name parameter
  - Verify stored session has default name format
- Test: `updateClaudeSessionId() preserves session name`
  - Create session with name
  - Update claudeSessionId
  - Verify name unchanged

**Run tests**:

- `npx nx test chat --testPathPattern=tab-manager.service.spec.ts`
- `npx nx test agent-sdk --testPathPattern=session-lifecycle-manager.spec.ts`

---

### Task 6.2: Update session management documentation ⏸️ PENDING

**File(s)**:

- `d:\projects\ptah-extension\libs\frontend\chat\README.md` (or create if doesn't exist)
- `d:\projects\ptah-extension\libs\backend\agent-sdk\README.md` (or create if doesn't exist)

**Specification Reference**: implementation-plan.md (Architecture Summary section)  
**Pattern to Follow**: Existing README files in workspace  
**Expected Commit Pattern**: `docs(webview): update session management documentation with dual-ID system`

**Quality Requirements**:

- ✅ Dual-ID system explained clearly
- ✅ UUID v4 generation documented
- ✅ Named sessions feature documented
- ✅ Migration notes for legacy sessions

**Implementation Details**:

**Frontend README** (`libs/frontend/chat/README.md`):

- Add section: "Session ID Management"
  - Explain dual-ID system (placeholderSessionId → claudeSessionId)
  - Document UUID v4 format requirement
  - Explain atomic resolution process
  - Document backward compatibility for legacy IDs
- Add section: "Named Sessions"
  - Document session name feature
  - Explain default slugified naming format
  - Document PopoverComponent usage

**Backend README** (`libs/backend/agent-sdk/README.md`):

- Add section: "Session Lifecycle"
  - Document session creation with optional name
  - Explain StoredSession.name field
  - Document claudeSessionId resolution
- Add session name parameter to API documentation

---

**Batch 6 Verification Requirements**:

- ✅ All test files created/updated
- ✅ All documentation files updated
- ✅ One git commit for entire batch
- ✅ All tests pass: `npx nx test chat && npx nx test agent-sdk`
- ✅ Documentation reviewed for clarity
- ✅ No TypeScript compilation errors

---

## Batch Execution Protocol

**For Each Batch**:

1. **Team-leader** assigns entire batch to developer
2. **Developer** executes ALL tasks in batch (in order)
3. **Developer** stages files progressively (`git add` after each task)
4. **Developer** creates ONE commit for entire batch
5. **Developer** returns with batch git commit SHA
6. **Team-leader** verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per batch (not per task)
- Commit message follows format from first task in batch
- Staged files accumulate as tasks complete
- Single `git commit` at batch end
- Avoids running pre-commit hooks multiple times

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified
- All files exist and build successfully
- All tests pass

---

## Task Summary by Developer Type

**Backend Developer** (Batches 1, 2):

- 7 tasks across 2 batches
- Files: rpc.types.ts, chat.types.ts, package.json, session-lifecycle-manager.ts, sdk-agent-adapter.ts, rpc-method-registration.service.ts

**Frontend Developer** (Batches 3, 4, 5, 6):

- 10 tasks across 4 batches
- Files: app-shell.component.ts/html, tab-manager.service.ts, message-sender.service.ts, session-loader.service.ts, pending-session-manager.service.ts, test files, documentation

---

## Next Steps

**After Batch 1 Complete**:

- Run: `npx nx build shared && npx nx build chat`
- Verify: UUID package installed, types compile

**After Batch 2 Complete**:

- Run: `npx nx build agent-sdk && npx nx build ptah-extension-vscode`
- Verify: Backend logs session names

**After Batch 3 Complete**:

- Run: `npx nx build chat`
- Verify: PopoverComponent renders, UUID generation works

**After Batch 4 Complete**:

- Run: ` npx nx build chat`
- Verify: Session names sent to backend via RPC

**After Batch 5 Complete**:

- Run: `npx nx build chat`
- Verify: No timeout logic, legacy IDs handled

**After Batch 6 Complete**:

- Run: `npx nx test chat && npx nx test agent-sdk`
- Verify: All tests pass, documentation complete

**Final Verification** (after all batches):

- Manual testing: Create session with name
- Manual testing: Create session without name (slugified default)
- Manual testing: Load legacy session
- All builds pass
- All tests pass
