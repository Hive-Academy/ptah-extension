# Task Context - TASK_2025_036

## User Intent

Integrate File Suggestions system with new ChatInputComponent and modernize styling with DaisyUI components.

## Source Reference

- **Origin Document**: `docs/future-enhancements/TASK_2025_023_FUTURE_WORK.md`
- **Category**: Category 3: Autocomplete System Re-Integration (File Suggestions subset)
- **Priority**: High (Core UX Feature)
- **Estimated Effort**: 3-4 days

## Technical Context

- **Branch**: TBD
- **Created**: 2025-12-01
- **Type**: FEATURE
- **Complexity**: Medium
- **Status**: Planned

## Problem Statement

The file suggestion components from TASK_2025_019 exist but are not wired to the new ChatInputComponent from TASK_2025_023. Additionally, they use custom VS Code-style CSS that should be modernized to DaisyUI.

### Components Status

| Component                          | Exists | Wired to UI       |
| ---------------------------------- | ------ | ----------------- |
| `FileSuggestionsDropdownComponent` | Yes    | No                |
| `FileTagComponent`                 | Yes    | No                |
| `FilePickerService`                | Yes    | No                |
| `ChatInputComponent` (new)         | Yes    | Missing @ handler |

## Implementation Requirements

### 1. Wire File Suggestions to ChatInputComponent

```typescript
// Add to ChatInputComponent
readonly filePicker = inject(FilePickerService);

private readonly _showFileSuggestions = signal(false);
private readonly _fileSuggestions = signal<FileSuggestion[]>([]);

private handleAtSymbolInput(textarea: HTMLTextAreaElement): void { ... }
```

### 2. DaisyUI Modernization

#### FileTagComponent → DaisyUI Card + Badge

- Replace `.vscode-file-tag` classes with DaisyUI `card`, `badge` components
- Use `collapse` for expandable preview

#### FileSuggestionsDropdownComponent → DaisyUI Menu

- Replace `.vscode-file-dropdown` with `dropdown`, `menu` components
- Use `loading` spinner component
- Use `badge` for file size

## Files to Modify

- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`
- `libs/frontend/chat/src/lib/components/file-tag/file-tag.component.ts`
- `libs/frontend/chat/src/lib/components/file-suggestions-dropdown/file-suggestions-dropdown.component.ts`

## Acceptance Criteria

1. @ symbol triggers file suggestions dropdown
2. File selection adds file tag to input
3. File tags display with DaisyUI styling
4. Dropdown uses DaisyUI menu/list components
5. Keyboard navigation works (up/down/enter/escape)
6. No visual regressions in dark/light themes
