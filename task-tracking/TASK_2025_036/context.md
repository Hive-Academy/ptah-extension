# Task Context - TASK_2025_036

## User Intent

Integrate **Complete Autocomplete System** with ChatInputComponent and modernize styling with DaisyUI components. This includes:

- `@` trigger → Files, Agents, MCP servers (like Claude CLI)
- `/` trigger → Commands (built-in + custom from `.claude/commands/`)

## Source Reference

- **Origin Document**: `docs/future-enhancements/TASK_2025_023_FUTURE_WORK.md`
- **Category**: Category 3: Autocomplete System Re-Integration (FULL SCOPE)
- **Priority**: High (Core UX Feature - Claude CLI Parity)
- **Estimated Effort**: 5-7 days

## Technical Context

- **Branch**: TBD
- **Created**: 2025-12-01
- **Type**: FEATURE
- **Complexity**: Medium-High
- **Status**: In Progress (Architecture Phase)

## Problem Statement

The autocomplete system from TASK_2025_019 exists but is not wired to the new ChatInputComponent from TASK_2025_023. The system should provide Claude CLI-like autocomplete:

1. **`@` trigger** shows unified dropdown with:

   - 📄 Files (workspace files via FilePickerService)
   - 🤖 Agents (built-in + `.claude/agents/*.md`)
   - 🔌 MCP servers (from `.mcp.json` - dynamic, not absolute paths)

2. **`/` trigger** shows commands dropdown with:
   - ⚡ Built-in commands (help, clear, model, etc.)
   - 📁 Project commands (`.claude/commands/*.md`)
   - 👤 User commands (`~/.claude/commands/*.md`)

### Components Status

| Component                             | Exists | Wired to UI        | Needs DaisyUI |
| ------------------------------------- | ------ | ------------------ | ------------- |
| `FileSuggestionsDropdownComponent`    | Yes    | No                 | Yes           |
| `FileTagComponent`                    | Yes    | No                 | Yes           |
| `UnifiedSuggestionsDropdownComponent` | Yes    | No                 | Yes           |
| `FilePickerService`                   | Yes    | No                 | N/A           |
| `AgentDiscoveryFacade`                | Yes    | No                 | N/A           |
| `CommandDiscoveryFacade`              | Yes    | No                 | N/A           |
| `MCPDiscoveryFacade`                  | Yes    | No (⚠️ absolute)   | N/A           |
| `ChatInputComponent` (new)            | Yes    | Missing @/handlers | N/A           |

### Backend Services Status

| Service                   | Location                                                | Status        |
| ------------------------- | ------------------------------------------------------- | ------------- |
| `AgentDiscoveryService`   | `libs/backend/workspace-intelligence/src/autocomplete/` | ✅ Complete   |
| `CommandDiscoveryService` | `libs/backend/workspace-intelligence/src/autocomplete/` | ✅ Complete   |
| `MCPDiscoveryService`     | `libs/backend/workspace-intelligence/src/autocomplete/` | ⚠️ Delete/Fix |

**MCP Discovery Issue**: Current implementation uses absolute paths. Should be deleted or replaced with dynamic `claude mcp list` query.

## Implementation Requirements

### 1. ChatInputComponent Integration

```typescript
// Add to ChatInputComponent
readonly filePicker = inject(FilePickerService);
readonly agentDiscovery = inject(AgentDiscoveryFacade);
readonly commandDiscovery = inject(CommandDiscoveryFacade);

private readonly _showSuggestions = signal(false);
private readonly _suggestionType = signal<'file' | 'agent' | 'command' | null>(null);
private readonly _suggestions = signal<SuggestionItem[]>([]);

private handleAtSymbolInput(): void { ... }  // @ → files + agents + MCP
private handleSlashTrigger(): void { ... }   // / → commands
```

### 2. Unified Dropdown with Tabs/Categories

The `@` trigger should show a unified dropdown with categories:

- All (combined)
- 📄 Files
- 🤖 Agents
- 🔌 MCP (if available)

### 3. DaisyUI Modernization

#### FileTagComponent → DaisyUI Card + Badge

- Replace `.vscode-file-tag` classes with DaisyUI `card`, `badge` components
- Use `collapse` for expandable preview

#### FileSuggestionsDropdownComponent → DaisyUI Menu

- Replace `.vscode-file-dropdown` with `dropdown`, `menu` components
- Use `loading` spinner component
- Use `badge` for file size

#### UnifiedSuggestionsDropdownComponent → DaisyUI Menu + Tabs

- Replace `.vscode-unified-dropdown` with DaisyUI `tabs`, `menu` components
- Category tabs for filtering (All/Files/Agents/MCP)
- Consistent styling with FileSuggestionsDropdown

### 4. MCP Discovery Fix

**Option A**: Delete `MCPDiscoveryService` entirely, exclude MCP from autocomplete
**Option B**: Replace with dynamic `claude mcp list` query via RPC

## Files to Modify

### Frontend Components

- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`
- `libs/frontend/chat/src/lib/components/file-suggestions/file-tag.component.ts`
- `libs/frontend/chat/src/lib/components/file-suggestions/file-suggestions-dropdown.component.ts`
- `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts`

### Frontend Services (Wire facades)

- `libs/frontend/core/src/lib/services/agent-discovery.facade.ts` (verify wiring)
- `libs/frontend/core/src/lib/services/command-discovery.facade.ts` (verify wiring)
- `libs/frontend/core/src/lib/services/mcp-discovery.facade.ts` (delete or fix)

### Backend (MCP fix)

- `libs/backend/workspace-intelligence/src/autocomplete/mcp-discovery.service.ts` (delete or fix)

## Acceptance Criteria

### @ Trigger (Files + Agents + MCP)

1. `@` symbol triggers unified suggestions dropdown
2. Dropdown shows tabs: All / Files / Agents / MCP
3. Files come from FilePickerService (workspace files)
4. Agents come from AgentDiscoveryFacade (built-in + .claude/agents/)
5. MCP servers shown if available (dynamic, not hardcoded)
6. File selection adds file tag to input
7. Agent selection inserts `@agent-name` in input
8. Keyboard navigation works (up/down/enter/escape/tab for categories)

### / Trigger (Commands)

9. `/` at start of input triggers command suggestions
10. Shows built-in commands (help, clear, model, etc.)
11. Shows project commands from `.claude/commands/`
12. Shows user commands from `~/.claude/commands/`
13. Command selection inserts `/command-name` in input

### UI/UX

14. File tags display with DaisyUI styling
15. All dropdowns use DaisyUI menu/list components
16. No visual regressions in dark/light themes
17. Consistent styling across all dropdown types
