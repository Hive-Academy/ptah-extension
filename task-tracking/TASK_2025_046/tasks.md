# Development Tasks - TASK_2025_046

**Total Tasks**: 4 | **Batches**: 1 | **Status**: 1/1 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ✅ DropdownInteractionService exists and is properly exported from @ptah-extension/core
- ✅ Service provides autoManageListeners() with signal-based reactivity
- ✅ Dropdown component has required navigation methods (navigateDown, navigateUp, selectFocused)
- ✅ Document-level listeners will intercept keyboard events before textarea (DOM event ordering)

### Risks Identified

| Risk                                                             | Severity | Mitigation                                             |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| viewChild() signal might not resolve when service callback fires | MEDIUM   | Add null checks in all keyboard callbacks (Task 1.2)   |
| ElementRef needed for click-outside detection                    | LOW      | Inject ElementRef in chat-input constructor (Task 1.1) |
| Race condition with rapid keypresses                             | LOW      | Null checks handle this gracefully (Task 1.2)          |

### Edge Cases to Handle

- [x] Dropdown closed while keyboard event processing → Handled by service's effect() cleanup
- [x] Escape key consumption → Service calls preventDefault() automatically
- [x] viewChild timing race → Null checks in Task 1.2

---

## Batch 1: Fix Dropdown Keyboard Navigation ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: [Pending]

### Task 1.1: Inject DropdownInteractionService and ElementRef ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Spec Reference**: task-description.md:14-18 (Existing Infrastructure)
**Pattern to Follow**: dropdown-interaction.service.ts:55-75 (Usage example in service docs)

**Quality Requirements**:

- Import DropdownInteractionService from '@ptah-extension/core'
- Inject service using inject() function (Angular 20+ pattern)
- Inject ElementRef for component reference
- Inject Injector for service's autoManageListeners() context
- Add private readonly fields following existing component patterns

**Validation Notes**:

- ElementRef is needed for click-outside detection in service
- Injector is required for runInInjectionContext() in service
- Follow existing injection pattern at lines 168-173

**Implementation Details**:

- Imports: Add `ElementRef, Injector` to Angular core imports, `DropdownInteractionService` from '@ptah-extension/core'
- Injections: Use `inject()` pattern after line 173 to add:
  ```typescript
  private readonly dropdownService = inject(DropdownInteractionService);
  private readonly elementRef = inject(ElementRef);
  private readonly injector = inject(Injector);
  ```
- Location: Add injections after existing service injections (commandDiscovery at line 173)

---

### Task 1.2: Configure autoManageListeners in constructor ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Dependencies**: Task 1.1
**Spec Reference**: task-description.md:20-25 (Solution Approach)
**Pattern to Follow**: dropdown-interaction.service.ts:165-209 (autoManageListeners implementation)

**Quality Requirements**:

- Call dropdownService.autoManageListeners() in constructor (after existing effects)
- Pass showSuggestions() signal as isOpenSignal
- Pass elementRef for click-outside detection
- Configure keyboard callbacks to call dropdown methods (navigateDown, navigateUp, selectFocused)
- Add null checks for dropdownRef() in all callbacks (handles viewChild timing race)
- onClickOutside callback should call closeSuggestions()
- onEscape callback should call closeSuggestions()

**Validation Notes**:

- **CRITICAL**: Add null checks in callbacks - dropdownRef() might not be resolved on first keypress
- If dropdownRef() is null, log warning and return early (graceful degradation)
- Service attaches listeners when showSuggestions() becomes true
- Service auto-detaches when showSuggestions() becomes false (zero overhead)

**Implementation Details**:

- Location: Add after session change effect in constructor (after line 631)
- Service config pattern:
  ```typescript
  this.dropdownService.autoManageListeners(this.injector, {
    isOpenSignal: this.showSuggestions,
    elementRef: this.elementRef,
    onClickOutside: () => this.closeSuggestions(),
    keyboardNav: {
      onArrowDown: () => {
        const dropdown = this.dropdownRef();
        if (!dropdown) {
          console.warn('[ChatInputComponent] Dropdown ref not ready for ArrowDown');
          return;
        }
        dropdown.navigateDown();
      },
      onArrowUp: () => {
        const dropdown = this.dropdownRef();
        if (!dropdown) {
          console.warn('[ChatInputComponent] Dropdown ref not ready for ArrowUp');
          return;
        }
        dropdown.navigateUp();
      },
      onEnter: () => {
        const dropdown = this.dropdownRef();
        if (!dropdown) {
          console.warn('[ChatInputComponent] Dropdown ref not ready for Enter');
          return;
        }
        dropdown.selectFocused();
      },
      onEscape: () => this.closeSuggestions(),
    },
  });
  ```
- Null check pattern: `if (!dropdown) { console.warn(...); return; }`

---

### Task 1.3: Remove old keyboard handling from handleKeyDown ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Dependencies**: Task 1.2
**Spec Reference**: task-description.md:9-12 (Root Cause Analysis - Event Priority)
**Pattern to Follow**: N/A (removal task)

**Quality Requirements**:

- Remove dropdown keyboard handling logic from handleKeyDown method (lines 494-520)
- Keep ONLY the "Enter sends message" logic (lines 522-526)
- Simplify method to handle textarea-only keyboard events
- Remove dropdownRef() variable declaration (line 495)
- Remove if (dropdown && this.showSuggestions()) block (lines 498-520)

**Validation Notes**:

- Old pattern: Parent component manually calls dropdown methods on textarea keydown
- New pattern: Service captures at document level (higher priority than textarea)
- Removal ensures no conflicting event handlers

**Implementation Details**:

- Replace handleKeyDown method body (lines 494-527) with simplified version:
  ```typescript
  handleKeyDown(event: KeyboardEvent): void {
    // Enter sends message (only when dropdown NOT shown)
    // Note: When dropdown is shown, service intercepts Enter before this handler
    if (event.key === 'Enter' && !event.shiftKey && !this.showSuggestions()) {
      event.preventDefault();
      this.handleSend();
    }
  }
  ```
- Add comment explaining that dropdown navigation is handled by DropdownInteractionService

---

### Task 1.4: Test keyboard navigation functionality ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Dependencies**: Task 1.3
**Spec Reference**: task-description.md:31-34 (Performance Requirements)

**Quality Requirements**:

- Verify dropdown opens with @ trigger
- Test ArrowDown navigates through suggestions
- Test ArrowUp navigates through suggestions (including wrap-around)
- Test Enter selects focused suggestion
- Test Escape closes dropdown
- Verify typing normal characters still works when dropdown is closed
- Verify Enter sends message when dropdown is closed
- Check browser DevTools console for any "Dropdown ref not ready" warnings
- Confirm no memory leaks (listeners detach when dropdown closes)

**Validation Notes**:

- Test with rapid keystrokes to verify null check handling
- Verify first keypress after dropdown opens works (validates viewChild timing fix)
- Check that textarea doesn't intercept events when dropdown is showing
- Verify zero document-level listeners when dropdown is closed (check in DevTools)

**Implementation Details**:

- Manual testing steps:
  1. Type `@` in textarea → Dropdown opens
  2. Press ArrowDown 3 times → Focus moves through first 3 items
  3. Press ArrowUp → Focus moves back up
  4. Press Enter → Selected item is inserted
  5. Type `@` again → Dropdown opens
  6. Press Escape → Dropdown closes
  7. Type normal text → No interference
  8. Press Enter → Message sends
  9. Open DevTools Event Listeners panel → Verify no keydown listeners when closed
- If warnings appear in console, increase setTimeout delay in service (currently 0ms)
- Expected: All keyboard navigation works smoothly, no textarea interference

---

**Batch 1 Verification**:

- All imports added correctly
- Service configured in constructor
- Old keyboard handling removed
- Build passes: `npx nx build chat`
- TypeScript errors resolved
- Manual testing confirms keyboard navigation works
- No "Dropdown ref not ready" warnings in console (or only on very first keypress)
- Zero document-level listeners when dropdown closed

---

## Testing Strategy

### Manual Test Cases

1. **Basic Navigation**

   - Type `@` → Dropdown shows
   - ArrowDown × 3 → Focus moves
   - Enter → Selection works

2. **Edge Cases**

   - Rapid typing after `@` → No errors
   - Escape closes dropdown correctly
   - Normal typing unaffected

3. **Performance Validation**
   - DevTools → Event Listeners panel
   - When closed: Zero keydown/click listeners
   - When open: Only 2 listeners (keydown + click)
   - On close: Listeners removed

### Success Criteria

- ✅ Keyboard navigation works on first keypress after dropdown opens
- ✅ No textarea event interference when dropdown is showing
- ✅ Zero overhead when dropdown is closed
- ✅ Graceful handling of viewChild timing race (null checks)
- ✅ All existing functionality preserved (file tags, command autocomplete, message sending)

---

## Notes

**Architecture Decision**: Using DropdownInteractionService instead of direct viewChild method calls solves the timing race by:

1. Document-level listeners intercept events BEFORE they reach textarea
2. Effect-based reactive attachment ensures listeners exist when dropdown opens
3. Signal-based cleanup (via effect) guarantees zero overhead when closed
4. Null checks provide graceful degradation if viewChild timing is slower than expected

**Performance Impact**: ~75% reduction in event handler executions (service's documented benchmark). Listeners only active when dropdown is open.

**Future Enhancements**: If null check warnings appear frequently, consider:

- Increasing setTimeout delay in service (currently 0ms)
- Using requestAnimationFrame for callback scheduling
- Add afterNextRender() hook to ensure viewChild resolution
