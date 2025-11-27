# TASK_2025_019: Complete Autocomplete System (@ Files, MCP Servers, Agents, / Commands)

**Created**: 2025-11-23
**Type**: BUGFIX + FEATURE
**Complexity**: Medium
**Estimated Time**: 12-15 hours

## User Intent

Fix the broken @ mention file autocomplete (currently showing infinite loading spinner) AND implement complete autocomplete system matching Claude CLI functionality:

1. **@ Files** - Include workspace files in chat (CURRENTLY BROKEN)
2. **@ MCP Servers** - Enable/disable MCP servers for conversation
3. **@ Agents** - Invoke custom and global agents
4. **/ Commands** - Execute slash commands (built-in + custom)

## Current Bug

**Symptoms**:

- User types `@` in chat input
- Loading spinner appears
- No file suggestions ever load
- Spinner stuck indefinitely

**Root Cause** (identified at `libs/backend/claude-domain/src/messaging/message-handler.service.ts:676-688`):

```typescript
// context:getFiles
// NOTE: This handler is currently non-functional and serves as a placeholder
// The actual VS Code URI creation must happen in the main app layer
// TODO: Refactor to delegate URI creation to main app
this.subscriptions.push(
  this.eventBus.subscribe(CONTEXT_MESSAGE_TYPES.GET_FILES).subscribe(async (event) => {
    const result = await this.contextOrchestration.getContextFiles({
      requestId: event.correlationId,
    });
    this.publishResponse('context:getFiles', event.correlationId, result);
  })
);
```

**Problem**: The handler returns `result` but doesn't publish `CONTEXT_MESSAGE_TYPES.UPDATE_FILES` event that `FilePickerService` (line 169) is listening for.

**Fix Required**:

```typescript
const result = await this.contextOrchestration.getAllFiles({ requestId: event.correlationId });

if (result.success && result.files) {
  // Publish UPDATE_FILES event for frontend
  this.eventBus.publish(CONTEXT_MESSAGE_TYPES.UPDATE_FILES, {
    includedFiles: result.files.map((f) => f.relativePath || f.uri),
  });
}

this.publishResponse('context:getFiles', event.correlationId, result);
```

## Complete Scope

### Phase 1: Fix @ Files Autocomplete (CRITICAL BUGFIX - 2 hours)

**Backend** (`message-handler.service.ts`):

- Fix `context:getFiles` handler to publish `UPDATE_FILES` event
- Use `contextOrchestration.getAllFiles()` instead of `getContextFiles()`
- Ensure file list includes all workspace files with metadata

**Frontend** (`file-picker.service.ts`):

- Already listens for `UPDATE_FILES` correctly (line 168-174)
- Already has `searchFiles()` working (line 299-326)
- NO CHANGES NEEDED (frontend is correct)

### Phase 2: Extend Backend Discovery APIs (4-5 hours)

Add to `PtahAPIBuilder` (TASK_2025_016 extension):

**New Namespace: ptah.discovery**

```typescript
// Custom agents from .claude/agents/*.md
ptah.discovery.listCustomAgents(): Promise<AgentInfo[]>

// Global agents (hardcoded list from Claude Code)
ptah.discovery.listGlobalAgents(): AgentInfo[]

// Custom commands from .claude/commands/*.md
ptah.discovery.listCustomCommands(): Promise<CommandInfo[]>

// Global commands (hardcoded list)
ptah.discovery.listGlobalCommands(): CommandInfo[]

// MCP servers from config
ptah.discovery.listMCPServers(): Promise<MCPServerInfo[]>
```

**New Namespace: ptah.files** (extend existing)

```typescript
ptah.files.glob(pattern: string): Promise<string[]>
ptah.files.parseMarkdownFrontMatter(content: string): object
```

### Phase 3: Frontend Unified Autocomplete (5-6 hours)

**New Service**: `UnifiedSuggestionsService`

```typescript
class UnifiedSuggestionsService {
  // Fetch all suggestion types
  async getFileSuggestions(query: string): Promise<UnifiedSuggestion[]>;
  async getMCPSuggestions(query: string): Promise<UnifiedSuggestion[]>;
  async getAgentSuggestions(query: string): Promise<UnifiedSuggestion[]>;
  async getCommandSuggestions(query: string): Promise<UnifiedSuggestion[]>;

  // Cache management
  private cachedAgents: Signal<AgentInfo[]>;
  private cachedCommands: Signal<CommandInfo[]>;
  private cachedMCPs: Signal<MCPServerInfo[]>;
}
```

**New Component**: `UnifiedSuggestionsDropdownComponent`

- Replaces `FileSuggestionsDropdownComponent`
- Handles files, MCPs, agents, commands
- Type-specific rendering with icons and metadata

**Modified Component**: `ChatInputAreaComponent`

```typescript
// Extend handleAtSymbolInput to also handle slash commands
private handleAutocompleteInput(textarea: HTMLTextAreaElement): void {
  // Detect both @ and / triggers
  // Route to appropriate suggestion handler
  // Show UnifiedSuggestionsDropdownComponent
}
```

### Phase 4: Integration & Testing (1-2 hours)

- Wire UnifiedSuggestionsService to backend APIs
- Test @ file autocomplete (verify bug fix)
- Test @ MCP autocomplete
- Test @ agent autocomplete
- Test / command autocomplete
- Integration with ChatService

## Technical Context

**File Structure**:

```
libs/backend/vscode-lm-tools/
├── src/lib/code-execution/
│   ├── ptah-api-builder.service.ts (MODIFY - add discovery namespace)
│   └── types.ts (MODIFY - add discovery types)

libs/frontend/chat/
├── src/lib/services/
│   ├── file-picker.service.ts (NO CHANGE - already correct)
│   └── unified-suggestions.service.ts (NEW)
└── src/lib/components/
    ├── unified-suggestions-dropdown.component.ts (NEW)
    └── chat-input-area.component.ts (MODIFY)

libs/backend/claude-domain/
└── src/messaging/
    └── message-handler.service.ts (FIX - context:getFiles handler)
```

## Success Criteria

### Phase 1 (Bugfix)

- ✅ @ mention shows file suggestions (not loading spinner)
- ✅ File search works correctly
- ✅ File selection inserts into chat
- ✅ Files included in message context

### Phase 2 (Discovery APIs)

- ✅ Custom agents discovered from `.claude/agents/*.md`
- ✅ Custom commands discovered from `.claude/commands/*.md`
- ✅ MCP servers discovered from config
- ✅ Global agents/commands available (hardcoded lists)

### Phase 3 (Unified Autocomplete)

- ✅ `@` shows files (filtered by query)
- ✅ `@mcp:` shows MCP servers with enabled/disabled status
- ✅ `@agent:` shows agents (global + custom) with descriptions
- ✅ `/` shows commands (global + custom) with descriptions
- ✅ Keyboard navigation works across all types
- ✅ Selection inserts correct syntax

### Phase 4 (Integration)

- ✅ Context manager tracks files, MCPs, agents
- ✅ ChatService passes context to ClaudeCliLauncher
- ✅ Provider-specific handling (Claude CLI vs VS Code LM)

## Related Tasks

- **TASK_2025_016** ✅ Complete - Provides ptah API foundation (will extend)
- **TASK_2025_013** ⏳ Later - Visual UI (file picker, agent dropdown, MCP panel)

## Risk Assessment

**Low Risk**:

- File @ mention fix is straightforward (publish missing event)
- Pattern already exists (FileSuggestionsDropdownComponent)
- Backend APIs well-defined

**Medium Risk**:

- Discovery of global agents/commands (need hardcoded lists)
- MCP config parsing (depends on config format)
- Unified component complexity (multiple types)

## Migration Notes

**From**: FileSuggestionsDropdownComponent (files only)
**To**: UnifiedSuggestionsDropdownComponent (files, MCPs, agents, commands)

**Backwards Compatibility**: Maintain existing `@filename` behavior during migration
