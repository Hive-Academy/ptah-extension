# TASK_2025_163: Fix @ Trigger Autocomplete Filtering Bug

## Task Type: BUGFIX

## Strategy: BUGFIX (Streamlined)

## Status: Code Implemented - Awaiting Verification & QA

## User Request

Fix the @ trigger autocomplete in chat-input that was not properly filtering file/folder results and had buggy open/close behavior. When typing `@portal`, the dropdown showed all files (`.mcp.json`, `task-tracking`, etc.) instead of filtering to matching files.

## Root Cause Analysis (Completed)

Three issues identified:

### Issue 1: Race Condition (ROOT CAUSE)

`handleAtTriggered` (debounced 150ms) overwrites `_currentQuery` with stale value AFTER `handleQueryChanged` already set the correct immediate value. This causes `filteredSuggestions` computed to use empty/stale query, showing ALL files unfiltered.

### Issue 2: Delayed Dropdown Opening

`_showSuggestions(true)` was ONLY set from the debounced `handleAtTriggered`. Dropdown didn't appear until 150ms after user stopped typing.

### Issue 3: No Relevance Sorting

`FilePickerService.searchFiles()` had proper relevance-based sorting (exact match, startsWith, type preference) but was NEVER called. The inline filtering used simple `includes()` with no sorting.

## Changes Implemented

1. **at-trigger.directive.ts**: Added `atActivated` output (fires IMMEDIATELY on @ detection), modified `atQueryChanged` to also emit on activation
2. **slash-trigger.directive.ts**: Added `slashActivated` output (same pattern)
3. **chat-input.component.ts**: New `handleAtActivated`/`handleSlashActivated` handlers for instant dropdown opening; `handleAtTriggered`/`handleSlashTriggered` no longer overwrite `_currentQuery`; `filteredSuggestions` now uses `searchFiles()` for relevance sorting
4. **file-picker.service.ts**: Enhanced `searchFiles()` with tiered relevance sorting (exact → startsWith → nameContains → type preference → alphabetical), added directory search, increased result limits

## Files Changed

- `libs/frontend/chat/src/lib/directives/at-trigger.directive.ts`
- `libs/frontend/chat/src/lib/directives/slash-trigger.directive.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`
- `libs/frontend/chat/src/lib/services/file-picker.service.ts`

## Verification Status

- [x] `nx typecheck chat` - PASSES (0 errors)
- [x] `nx lint chat` - PASSES (0 errors, only pre-existing warnings)
