# Implementation Tasks - TASK_2025_067

## Task Breakdown

### Task 1: Add Ptah Icon to Sidebar Header ⏸️ PENDING

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
**Action**: Add `<img>` tag with Ptah icon in sidebar header section (around line 14)
**Details**: Use `getPtahIconUri()` from VSCodeService, size ~24x24px

### Task 2: Convert New Session Button to Icon-Only 🔄 IN PROGRESS

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
**Action**: Remove "New Session" text from button (line 20), keep Lucide Plus icon
**Details**: Add proper `aria-label` and `title` for accessibility

### Task 3: Move Tab Bar to Main Header 🔄 IN PROGRESS

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
**Action**:

- Move `<ptah-tab-bar />` from line 137 to inside navbar (after sidebar toggle button)
- Remove the wrapper div structure that's no longer needed
  **Details**: Position tabs between sidebar toggle and settings button

### Task 4: Remove "Ptah" Text from Header 🔄 IN PROGRESS

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
**Action**: Delete the `.flex-1` div containing "Ptah" text (lines 113-115)
**Details**: Layout will be filled by tab-bar component instead

### Task 5: Add Icon Import to Component TypeScript (if needed) ⏸️ PENDING

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
**Action**: Inject VSCodeService and expose `getPtahIconUri()` if not already available
**Details**: Check if vscodeService is already injected for icon usage

## Estimated Time

- Implementation: 10-15 minutes
- Testing: 5 minutes
- Total: ~20 minutes
