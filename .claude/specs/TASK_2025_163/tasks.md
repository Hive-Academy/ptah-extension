# Development Tasks - TASK_2025_163

**Total Tasks**: 4 | **Batches**: 1 | **Status**: 1/1 COMPLETE

## Batch 1: Fix @ Trigger Race Condition & Filtering - COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: 77c5ef7b

### Task 1.1: Add atActivated output to at-trigger directive

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\directives\at-trigger.directive.ts
**Status**: COMPLETE
**Changes**: Added `atActivated` output that fires IMMEDIATELY on inactive->active transition. Modified pairwise subscription to emit activation event and `atQueryChanged` on activation (not just on query change).

### Task 1.2: Add slashActivated output to slash-trigger directive

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\directives\slash-trigger.directive.ts
**Status**: COMPLETE
**Changes**: Added `slashActivated` output (same pattern as at-trigger). Modified pairwise subscription to emit activation and query change on activation.

### Task 1.3: Fix chat-input event handlers to eliminate race condition

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Status**: COMPLETE
**Changes**:

- Added `handleAtActivated` handler that opens dropdown IMMEDIATELY (sets mode, trigger position, query, shows suggestions, fetches files)
- Modified `handleAtTriggered` to only update trigger position (no longer overwrites `_currentQuery`)
- Added `handleSlashActivated` handler (same pattern)
- Modified `handleSlashTriggered` to no-op (no query overwrite)
- Modified `filteredSuggestions` computed to use `FilePickerService.searchFiles()` for relevance-based sorting
- Wired new template events: `(atActivated)`, `(slashActivated)`

### Task 1.4: Enhance FilePickerService.searchFiles() relevance sorting

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\file-picker.service.ts
**Status**: COMPLETE
**Changes**:

- Added tiered relevance sorting: exact name match -> startsWith -> nameContains -> path-only match -> type preference -> alphabetical
- Added `directory` field to search filter
- Increased empty query limit from 10 to 50, query results from 20 to 30
