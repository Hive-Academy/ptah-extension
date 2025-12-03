# Tasks - TASK_2025_036

**Total Tasks**: 14 | **Batches**: 4 | **Status**: 2/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ✅ Signal-based state management pattern exists (ChatInputComponent:112-121)
- ✅ DaisyUI component patterns verified (ModelSelectorComponent, AutopilotPopoverComponent)
- ✅ Discovery facades exist (AgentDiscoveryFacade, CommandDiscoveryFacade, MCPDiscoveryFacade)
- ✅ UnifiedSuggestionsDropdown supports discriminated union types (lines 29-38)
- ✅ FileTagComponent exists with VS Code styling (lines 305-381)

### Risks Identified

| Risk                             | Severity | Mitigation                           |
| -------------------------------- | -------- | ------------------------------------ |
| MCP RPC handler location unknown | MEDIUM   | Task 1.1 - grep before deletion      |
| Dropdown positioning complexity  | LOW      | Use fixed position initially         |
| Escape key event conflicts       | LOW      | Task 3.2 - verify no bubbling issues |

### Edge Cases to Handle

- ✅ Whitespace in @ queries closes dropdown (Task 2.2)
- ✅ / trigger only at start of input (Task 2.1)
- ✅ Keyboard navigation wrap-around (Task 3.1)

---

## Batch 1: MCP Cleanup & Type Changes ✅ COMPLETE

**Git Commit**: `c4a0349` - refactor(webview): delete mcp discovery services and types

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Verify MCP RPC Handler Location ✅ COMPLETE

**File**: N/A (Investigation task)
**Spec Reference**: implementation-plan.md:1020-1043 (MCP Cleanup Plan)
**Pattern to Follow**: N/A

**Quality Requirements**:

- Identify all files that register 'autocomplete:mcps' RPC handler
- Document locations for deletion in Task 1.2

**Validation Notes**:

- Risk mitigation: Ensure complete cleanup by finding ALL MCP references
- Search locations: apps/ptah-extension-vscode/src/, libs/backend/vscode-core/src/

**Implementation Details**:

- Use grep/search to find: 'autocomplete:mcps', 'mcp-discovery', 'MCPDiscoveryService'
- Document findings in task report
- No code changes

**Acceptance Criteria**:

- [ ] All RPC handler registrations for 'autocomplete:mcps' identified
- [ ] All imports of MCPDiscoveryService documented
- [ ] File list provided for Task 1.2 deletion

---

### Task 1.2: Delete MCP Discovery Files ✅ COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\mcp-discovery.service.ts (DELETE)
- D:\projects\ptah-extension\libs\frontend\core\src\lib\services\mcp-discovery.facade.ts (DELETE)
- [Additional files from Task 1.1 findings]

**Dependencies**: Task 1.1
**Spec Reference**: implementation-plan.md:1020-1043
**Pattern to Follow**: N/A

**Quality Requirements**:

- Delete backend service file (308 lines)
- Delete frontend facade file (74 lines)
- Remove any RPC handler registrations found in Task 1.1

**Validation Notes**:

- Verify no other files import these deleted files
- Build must pass after deletion

**Implementation Details**:

- Use git rm or direct file deletion
- Run nx build workspace-intelligence to verify backend
- Run nx build core to verify frontend

**Acceptance Criteria**:

- [ ] mcp-discovery.service.ts deleted
- [ ] mcp-discovery.facade.ts deleted
- [ ] All RPC registrations removed
- [ ] Backend builds without errors
- [ ] Frontend builds without errors

---

### Task 1.3: Remove MCP Exports from Index Files ✅ COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\frontend\core\src\lib\services\index.ts
- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts

**Dependencies**: Task 1.2
**Spec Reference**: implementation-plan.md:1026-1032
**Pattern to Follow**: index.ts:34-44 (existing export pattern)

**Quality Requirements**:

- Remove MCPDiscoveryFacade export from frontend core index
- Remove MCPDiscoveryService export from backend workspace-intelligence index
- No other exports affected

**Validation Notes**:

- Edge case: Verify no barrel export re-exports these types

**Implementation Details**:

- Frontend: Remove line 39 in libs/frontend/core/src/lib/services/index.ts
  ```typescript
  export { MCPDiscoveryFacade, type MCPSuggestion } from './mcp-discovery.facade';
  ```
- Backend: Remove line 115 in libs/backend/workspace-intelligence/src/index.ts
  ```typescript
  export * from './autocomplete/mcp-discovery.service';
  ```

**Acceptance Criteria**:

- [ ] MCPDiscoveryFacade export removed from frontend
- [ ] MCPDiscoveryService export removed from backend
- [ ] No other exports removed
- [ ] Build passes: nx build core && nx build workspace-intelligence

---

### Task 1.4: Remove MCP Type from UnifiedSuggestionsDropdown ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.ts

**Dependencies**: Task 1.3
**Spec Reference**: implementation-plan.md:1034-1038
**Pattern to Follow**: unified-suggestions-dropdown.component.ts:29-38

**Quality Requirements**:

- Remove MCP from SuggestionItem discriminated union
- Remove MCPSuggestion import
- No changes to file/agent/command types

**Validation Notes**:

- Edge case: Ensure no getIcon() or getDescription() logic depends on MCP type

**Implementation Details**:

- Remove import: `import type { MCPSuggestion } from '@ptah-extension/core';` (line 5)
- Simplify SuggestionItem type (lines 31-38):
  ```typescript
  export type SuggestionItem = ({ type: 'file'; icon: string; description: string } & Omit<FileSuggestion, 'type'>) | ({ type: 'agent' } & AgentSuggestion) | ({ type: 'command' } & CommandSuggestion);
  ```
- Verify getIcon(), getName(), getDescription() methods handle remaining types

**Acceptance Criteria**:

- [ ] MCPSuggestion import removed
- [ ] MCP type removed from union (line 37-38 deleted)
- [ ] No TypeScript errors
- [ ] Component builds: nx build chat

---

**Batch 1 Verification**:

- [ ] All MCP files deleted
- [ ] All exports removed
- [ ] Type system clean (no MCP references)
- [ ] Builds pass: nx run-many --target=build --projects=workspace-intelligence,core,chat

---

## Batch 2: ChatInputComponent Integration ✅ COMPLETE

**Git Commit**: `f4b53b7` - feat(webview): add autocomplete state and trigger detection to chat input

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete

### Task 2.1: Add Autocomplete State Signals to ChatInputComponent ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts

**Spec Reference**: implementation-plan.md:146-343
**Pattern to Follow**: chat-input.component.ts:112-121 (existing signal pattern)

**Quality Requirements**:

- Inject FilePickerService, AgentDiscoveryFacade, CommandDiscoveryFacade
- Add 8 new private signals for autocomplete state
- Add 7 computed signals for filtering and positioning
- Follow Angular 20+ signal pattern (private \_signal, public readonly)

**Validation Notes**:

- Risk: Ensure services exist before injection
- Edge case: Computed signals must handle empty arrays gracefully

**Implementation Details**:

- Add service injections after line 105:
  ```typescript
  readonly filePicker = inject(FilePickerService);
  readonly agentDiscovery = inject(AgentDiscoveryFacade);
  readonly commandDiscovery = inject(CommandDiscoveryFacade);
  ```
- Add private signals after line 112:
  ```typescript
  private readonly _showSuggestions = signal(false);
  private readonly _suggestionMode = signal<'at-trigger' | 'slash-trigger' | null>(null);
  private readonly _activeCategory = signal<'all' | 'files' | 'agents'>('all');
  private readonly _currentQuery = signal('');
  private readonly _selectedFiles = signal<ChatFile[]>([]);
  private readonly _isLoadingSuggestions = signal(false);
  ```
- Add public readonly signals after line 115:
  ```typescript
  readonly showSuggestions = this._showSuggestions.asReadonly();
  readonly suggestionMode = this._suggestionMode.asReadonly();
  readonly activeCategory = this._activeCategory.asReadonly();
  readonly selectedFiles = this._selectedFiles.asReadonly();
  readonly isLoadingSuggestions = this._isLoadingSuggestions.asReadonly();
  ```
- Add computed signals (filteredSuggestions, dropdownPosition) - see implementation-plan.md:295-342

**Acceptance Criteria**:

- [ ] 3 service injections added
- [ ] 6 private signals added
- [ ] 5 public readonly signals added
- [ ] 2 computed signals added (filteredSuggestions, dropdownPosition)
- [ ] No TypeScript errors
- [ ] Component compiles

---

### Task 2.2: Implement Trigger Detection Logic ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts

**Dependencies**: Task 2.1
**Spec Reference**: implementation-plan.md:346-431
**Pattern to Follow**: chat-input.component.ts:126-133 (existing handleInput pattern)

**Quality Requirements**:

- Enhance handleInput() to call detectTriggers()
- Implement detectTriggers() with @ and / trigger logic
- Implement fetchAtSuggestions() and fetchCommandSuggestions()
- / trigger ONLY at start of input
- @ trigger after whitespace or at start
- Dropdown closes on whitespace in query

**Validation Notes**:

- Edge case: "@file name" (whitespace in query) → close dropdown
- Edge case: "hello @world" → @ after non-whitespace → no dropdown
- Risk: Dropdown positioning needs scroll/resize handling (documented, not blocking)

**Implementation Details**:

- Modify handleInput() (line 126-133):

  ```typescript
  handleInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    const value = target.value;
    const cursorPos = target.selectionStart;

    this._currentMessage.set(value);

    // Auto-resize
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`;

    // Trigger detection
    this.detectTriggers(value, cursorPos);
  }
  ```

- Add detectTriggers() method - see implementation-plan.md:365-400
- Add fetchAtSuggestions() method - see implementation-plan.md:405-417
- Add fetchCommandSuggestions() method - see implementation-plan.md:422-431

**Acceptance Criteria**:

- [ ] handleInput() enhanced with detectTriggers() call
- [ ] detectTriggers() method implemented (35 lines)
- [ ] fetchAtSuggestions() method implemented (12 lines)
- [ ] fetchCommandSuggestions() method implemented (10 lines)
- [ ] / trigger only activates at start (textBeforeCursor.startsWith('/'))
- [ ] @ trigger checks for whitespace before symbol
- [ ] Whitespace in query closes dropdown

---

### Task 2.3: Implement Suggestion Selection Handlers ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts

**Dependencies**: Task 2.2
**Spec Reference**: implementation-plan.md:436-508
**Pattern to Follow**: N/A (new functionality)

**Quality Requirements**:

- Implement handleSuggestionSelected() with type discrimination
- Implement addFileTag() for file selection
- Implement removeFile() for file removal
- Implement insertAtCursor() for agent/command text insertion
- Implement closeSuggestions() and setActiveCategory()
- File selection adds tag, agent/command insert text

**Validation Notes**:

- Edge case: Cursor position restoration after text insertion
- Edge case: Duplicate file selection (should skip or show warning)

**Implementation Details**:

- Add handleSuggestionSelected() - see implementation-plan.md:436-449
- Add addFileTag() - see implementation-plan.md:454-465
- Add removeFile() - see implementation-plan.md:470-472
- Add insertAtCursor() - see implementation-plan.md:477-492
- Add closeSuggestions() - see implementation-plan.md:497-500
- Add setActiveCategory() - see implementation-plan.md:505-507

**Acceptance Criteria**:

- [ ] handleSuggestionSelected() implemented (14 lines)
- [ ] addFileTag() implemented (12 lines)
- [ ] removeFile() implemented (3 lines)
- [ ] insertAtCursor() implemented (16 lines)
- [ ] closeSuggestions() implemented (4 lines)
- [ ] setActiveCategory() implemented (3 lines)
- [ ] File selection adds to \_selectedFiles signal
- [ ] Agent/command selection inserts text at cursor

---

### Task 2.4: Update ChatInputComponent Template with Dropdown ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts

**Dependencies**: Task 2.3
**Spec Reference**: implementation-plan.md:164-253
**Pattern to Follow**: chat-input.component.ts:37-99 (existing template)

**Quality Requirements**:

- Add FileTagComponent row above textarea
- Wrap textarea in relative container for dropdown positioning
- Add UnifiedSuggestionsDropdownComponent below textarea
- Import FileTagComponent and UnifiedSuggestionsDropdownComponent
- Update handleKeyDown() to handle Escape when dropdown shown

**Validation Notes**:

- Edge case: File tags overflow handling (flex-wrap gap-2)
- Edge case: Dropdown visibility controlled by showSuggestions() signal

**Implementation Details**:

- Add imports to component decorator (line 35):
  ```typescript
  imports: [LucideAngularModule, ModelSelectorComponent, AutopilotPopoverComponent, UnifiedSuggestionsDropdownComponent, FileTagComponent];
  ```
- Replace template (lines 37-99) - see implementation-plan.md:164-253
- Update handleKeyDown() to check showSuggestions():

  ```typescript
  handleKeyDown(event: KeyboardEvent): void {
    // Escape closes suggestions
    if (event.key === 'Escape' && this.showSuggestions()) {
      event.preventDefault();
      this.closeSuggestions();
      return;
    }

    // Enter sends (if dropdown not shown)
    if (event.key === 'Enter' && !event.shiftKey && !this.showSuggestions()) {
      event.preventDefault();
      this.handleSend();
    }
  }
  ```

- Update handleSend() to include file paths - see implementation-plan.md:533-556

**Acceptance Criteria**:

- [ ] FileTagComponent and UnifiedSuggestionsDropdownComponent imported
- [ ] File tags row added above textarea
- [ ] Dropdown component added below textarea with proper bindings
- [ ] handleKeyDown() handles Escape for dropdown
- [ ] handleSend() sends selectedFiles paths
- [ ] Template renders without errors

---

**Batch 2 Verification**:

- [ ] All ChatInputComponent changes compile
- [ ] @ trigger shows dropdown with files + agents
- [ ] / trigger shows dropdown with commands
- [ ] File selection adds tag above textarea
- [ ] Agent/command selection inserts text
- [ ] Builds pass: nx build chat

---

## Batch 3: DaisyUI Migration 🔄 IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2 complete

### Task 3.1: Migrate UnifiedSuggestionsDropdownComponent to DaisyUI 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.ts

**Spec Reference**: implementation-plan.md:582-836
**Pattern to Follow**: model-selector.component.ts:27-100 (DaisyUI dropdown pattern)

**Quality Requirements**:

- Replace ALL VS Code CSS classes with DaisyUI equivalents
- Add tabs component for @ mode category switching
- Add showTabs and activeCategory inputs
- Add categoryChanged output
- Enhance keyboard navigation with Tab key for category cycling
- Use DaisyUI loading, menu, badge, tabs components

**Validation Notes**:

- Edge case: Tab key conflict with textarea indentation (only use Tab when dropdown focused)
- Risk: Escape key bubbling - verify no conflicts with parent components

**Implementation Details**:

- Add new inputs (after line 277):
  ```typescript
  readonly showTabs = input(false);
  readonly activeCategory = input<'all' | 'files' | 'agents'>('all');
  ```
- Add new output (after line 281):
  ```typescript
  readonly categoryChanged = output<'all' | 'files' | 'agents'>();
  ```
- Replace template with DaisyUI version - see implementation-plan.md:610-693
- Replace styles with DaisyUI utility classes - see implementation-plan.md:695-719
- Enhance onKeyDown() with Tab handling - see implementation-plan.md:767-778
- Replace VS Code CSS classes per migration table - implementation-plan.md:807-816

**Acceptance Criteria**:

- [ ] All VS Code CSS classes removed (.vscode-unified-\*)
- [ ] DaisyUI classes applied (menu, tabs, badge, loading, dropdown-content)
- [ ] Tabs shown when showTabs = true
- [ ] Tab key cycles categories (@ mode only)
- [ ] Loading spinner uses DaisyUI loading component
- [ ] Component builds without errors
- [ ] No VS Code CSS variables used

---

### Task 3.2: Migrate FileTagComponent to DaisyUI 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\file-tag.component.ts

**Dependencies**: Task 3.1
**Spec Reference**: implementation-plan.md:838-988
**Pattern to Follow**: model-selector.component.ts:27-100 (DaisyUI card + badge pattern)

**Quality Requirements**:

- Replace ALL VS Code CSS classes with DaisyUI equivalents
- Use DaisyUI card, badge, btn, collapse components
- Use semantic color classes (badge-warning, badge-info, badge-ghost)
- Maintain all existing functionality (expand/collapse, remove, preview)

**Validation Notes**:

- Edge case: Large file warning should use badge-warning
- Edge case: Preview collapse should use DaisyUI collapse-arrow

**Implementation Details**:

- Replace template with DaisyUI version - see implementation-plan.md:860-920
- Replace styles with DaisyUI classes - see implementation-plan.md:922-934
- Replace VS Code CSS classes per migration table - implementation-plan.md:957-970
- Key class mappings:
  - .vscode-file-tag → .card .card-compact .bg-base-200
  - .vscode-file-tag-remove → .btn .btn-circle .btn-ghost .btn-xs
  - .vscode-file-tag-size → .badge .badge-sm .badge-ghost
  - .vscode-file-tag-tokens → .badge .badge-sm .badge-info
  - .vscode-file-tag-warning → .badge .badge-sm .badge-warning
  - .vscode-file-tag-preview → .collapse .collapse-arrow

**Acceptance Criteria**:

- [ ] All VS Code CSS classes removed (.vscode-file-tag-\*)
- [ ] DaisyUI classes applied (card, badge, btn, collapse)
- [ ] Large file warning uses badge-warning
- [ ] Preview uses collapse-arrow component
- [ ] Remove button uses btn-circle btn-ghost btn-xs
- [ ] Component builds without errors
- [ ] No VS Code CSS variables used

---

### Task 3.3: Deprecate FileSuggestionsDropdownComponent 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\file-suggestions-dropdown.component.ts

**Dependencies**: Task 3.2
**Spec Reference**: implementation-plan.md:990-1018
**Pattern to Follow**: N/A

**Quality Requirements**:

- Add @deprecated JSDoc comment
- Reference UnifiedSuggestionsDropdownComponent as replacement
- No code changes to implementation
- Document removal timeline (TASK_2025_037)

**Validation Notes**:

- This is a documentation-only task
- No functional changes required

**Implementation Details**:

- Add JSDoc comment before @Component decorator:
  ```typescript
  /**
   * FileSuggestionsDropdownComponent - File Autocomplete UI
   *
   * @deprecated Use UnifiedSuggestionsDropdownComponent instead.
   * This component will be removed in TASK_2025_037 (Phase 2 cleanup).
   *
   * Reason: Functionality fully replaced by UnifiedSuggestionsDropdownComponent
   * which supports files, agents, and commands in a single dropdown with DaisyUI styling.
   */
  @Component({ ... })
  ```

**Acceptance Criteria**:

- [ ] @deprecated JSDoc added
- [ ] Removal timeline documented (TASK_2025_037)
- [ ] Replacement component referenced
- [ ] No code changes

---

**Batch 3 Verification**:

- [ ] UnifiedSuggestionsDropdown uses DaisyUI only
- [ ] FileTagComponent uses DaisyUI only
- [ ] FileSuggestionsDropdown marked deprecated
- [ ] Builds pass: nx build chat
- [ ] Visual regression test: Dark/light themes work

---

## Batch 4: Integration Testing & Edge Cases ⏸️ PENDING

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 3 complete

### Task 4.1: Manual Integration Testing ⏸️ PENDING

**File**: N/A (Testing task)

**Spec Reference**: implementation-plan.md:1087-1098, context.md:124-147
**Pattern to Follow**: N/A

**Quality Requirements**:

- Test all 17 acceptance criteria from context.md
- Document any issues found
- Verify keyboard navigation (ArrowUp/Down/Enter/Escape/Tab)
- Test @ trigger with files + agents
- Test / trigger with commands
- Test file tag display and removal

**Validation Notes**:

- Edge case: Long file names → truncation works
- Edge case: 100+ suggestions → scrolling works
- Edge case: Rapid typing → debouncing works (if implemented)

**Implementation Details**:

- Test scenarios:
  1. Type "@auth" → verify dropdown shows files + agents filtered
  2. Type "/help" → verify dropdown shows commands
  3. Select file → verify tag appears above textarea
  4. Select agent → verify "@agent-name" inserted in textarea
  5. Select command → verify "/command-name" replaces input
  6. Press Escape → verify dropdown closes
  7. Press Tab (@ mode) → verify category switches
  8. Type "@file name" (whitespace) → verify dropdown closes
  9. Type "hello @world" (@ after text) → verify no dropdown
  10. Remove file tag → verify tag disappears
- Document results in test report

**Acceptance Criteria**:

- [ ] All 17 acceptance criteria tested
- [ ] @ trigger works for files + agents
- [ ] / trigger works for commands
- [ ] File tags display correctly
- [ ] Agent/command text insertion works
- [ ] Keyboard navigation works
- [ ] Edge cases handled (whitespace, @ position)
- [ ] Test report created

---

### Task 4.2: Fix Dropdown Positioning Issues (If Found) ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts

**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md:1196-1199 (Risk #1)
**Pattern to Follow**: N/A

**Quality Requirements**:

- Address any positioning issues found in Task 4.1
- Ensure dropdown appears below textarea
- Handle scroll/resize events (Phase 2 if complex)

**Validation Notes**:

- Risk: Dynamic textarea height may affect position calculation
- Mitigation: Use fixed position relative to textarea bottom edge initially

**Implementation Details**:

- If Task 4.1 reveals positioning issues, implement fixes:

  ```typescript
  readonly dropdownPosition = computed(() => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (!textarea) return { top: 0, left: 0 };

    const rect = textarea.getBoundingClientRect();
    return {
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX
    };
  });
  ```

- Consider adding scroll/resize listeners if dropdown jumps during interaction

**Acceptance Criteria**:

- [ ] Dropdown appears directly below textarea
- [ ] Position updates when textarea resizes
- [ ] Position correct after scrolling (Phase 2 if blocking)
- [ ] No visual jumps during typing

---

### Task 4.3: Update handleSend to Include File Paths ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts

**Dependencies**: Task 4.2
**Spec Reference**: implementation-plan.md:533-556
**Pattern to Follow**: chat-input.component.ts:150-168 (existing handleSend)

**Quality Requirements**:

- Extract file paths from selectedFiles signal
- Pass file paths to chatStore.sendMessage()
- Clear selectedFiles after send
- Clear textarea and reset height

**Validation Notes**:

- Edge case: ChatStore.sendMessage() may not accept file paths yet
- Mitigation: Check ChatStore interface, add parameter if needed

**Implementation Details**:

- Modify handleSend() method (lines 150-168):

  ```typescript
  async handleSend(): Promise<void> {
    const content = this.currentMessage().trim();
    if (!content || this.isDisabled()) return;

    try {
      // Get file paths from selected files
      const filePaths = this._selectedFiles().map(f => f.path);

      // Send message with files (check if ChatStore supports this)
      await this.chatStore.sendMessage(content, filePaths);

      // Clear input and files
      this._currentMessage.set('');
      this._selectedFiles.set([]);

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

- If ChatStore.sendMessage() doesn't accept filePaths, document as future enhancement

**Acceptance Criteria**:

- [ ] File paths extracted from selectedFiles signal
- [ ] ChatStore.sendMessage() called with file paths (or documented)
- [ ] selectedFiles cleared after send
- [ ] Textarea height reset after send
- [ ] No errors on send

---

**Batch 4 Verification**:

- [ ] All manual tests pass
- [ ] Dropdown positioning works
- [ ] File paths sent with message
- [ ] No visual regressions
- [ ] Builds pass: nx build chat
- [ ] Ready for QA phase

---

## Final Checklist

**Before Completion**:

- [ ] All 4 batches complete
- [ ] All git commits created
- [ ] All acceptance criteria met
- [ ] No TypeScript errors
- [ ] All builds pass
- [ ] Visual regression tests pass (dark/light themes)
- [ ] Manual testing complete
- [ ] Ready for senior-tester QA phase

**Git Commit Strategy** (5 commits):

1. `refactor(chat): delete mcp discovery services and types` (Batch 1)
2. `feat(chat): add autocomplete state and trigger detection to chat input` (Batch 2, Tasks 2.1-2.2)
3. `feat(chat): implement suggestion selection and file tag handling` (Batch 2, Tasks 2.3-2.4)
4. `refactor(chat): migrate dropdown and file tag to daisyui styling` (Batch 3)
5. `test(chat): verify autocomplete integration and fix positioning` (Batch 4)

**Next Phase**: After completion, team-leader invokes senior-tester for QA with focus on:

- Keyboard navigation edge cases
- Dropdown positioning on scroll/resize
- File tag overflow handling
- Dark/light theme consistency
