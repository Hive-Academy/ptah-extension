# TASK_2025_046: Dropdown Keyboard Navigation Fix

## Task Type

BUGFIX

## Problem Statement

When the dropdown suggestions (file picker, slash commands) are showing and the cursor is in the textarea, keyboard events (ArrowUp, ArrowDown, Enter, Escape) are being captured by the textarea instead of the dropdown. This breaks keyboard navigation.

## Root Cause Analysis

1. **ViewChild Timing Race**: The `dropdownRef()` obtained via `viewChild` signal may not be resolved when dropdown first opens
2. **Event Priority**: Textarea keydown handler fires before the dropdown can intercept
3. **Current Pattern**: Parent component calls dropdown methods directly, but the reference isn't available on first render tick

## Existing Infrastructure

- `DropdownInteractionService` at `libs/frontend/core/src/lib/services/dropdown-interaction.service.ts`
- Already designed for conditional document-level listeners
- Uses `autoManageListeners()` with signal-based open/close detection
- Automatic cleanup via `takeUntilDestroyed()`

## Solution Approach

Use `DropdownInteractionService.autoManageListeners()` to:

1. Attach document-level keyboard listeners when dropdown opens
2. Intercept ArrowUp/ArrowDown/Enter/Escape at document level (before textarea)
3. Auto-detach listeners when dropdown closes (zero overhead)
4. Preserve normal textarea typing for all other keys

## Files to Modify

- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`
- Potentially remove unused keyboard handling from `unified-suggestions-dropdown.component.ts`

## Performance Requirements

- Zero event handlers when dropdown is closed
- Automatic cleanup on component destroy
- No interference with normal typing

## User Context

User reported: "when i try to use keyboard when the dropdown is showing and the cursor is on the textarea the textarea is interacting to the keyboard events not the dropdown"

## Created

2025-12-04
