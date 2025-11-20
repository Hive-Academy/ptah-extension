# TASK_2025_010 - Quick Start Guide

## What This Task Does

**Transforms "over-engineered" workspace-intelligence library into a powerful Claude CLI feature.**

Instead of building a separate MCP server, we expose existing workspace analysis capabilities as **internal VS Code commands** that Claude Code CLI can call directly.

---

## Architecture: Internal VS Code Commands (No MCP Server)

### How It Works

```
Claude CLI (running in VS Code)
    ↓
    Execute: vscode.commands.executeCommand('ptah.analyzeWorkspace')
    ↓
VS Code Extension (Ptah)
    ↓
    Call: workspaceAnalyzer.analyzeWorkspace()
    ↓
    Return: { success: true, data: { projectType: "nx-monorepo", ... } }
    ↓
Claude CLI receives JSON
    ↓
Claude uses data to provide intelligent responses
```

**Key Insight**: No external server needed! Claude CLI can execute VS Code commands and get JSON results.

---

## The 6 Commands We're Building

### 1. `ptah.analyzeWorkspace`

**What**: Analyze project structure, languages, frameworks
**Claude Usage**: `@code ptah.analyzeWorkspace`
**Returns**: Project type, file count, languages, frameworks, build system

### 2. `ptah.searchRelevantFiles`

**What**: Search and rank files by relevance
**Claude Usage**: `@code ptah.searchRelevantFiles --query="authentication"`
**Returns**: Ranked list of relevant files with scores

### 3. `ptah.getTokenEstimate`

**What**: Estimate token count for files
**Claude Usage**: `@code ptah.getTokenEstimate --files=["src/main.ts"]`
**Returns**: Total tokens, per-file breakdown, percentage used

### 4. `ptah.optimizeContext`

**What**: Get suggestions to reduce token usage
**Claude Usage**: `@code ptah.optimizeContext`
**Returns**: Optimization suggestions (exclude tests, dist files, etc.)

### 5. `ptah.getProjectStructure`

**What**: Get hierarchical directory tree
**Claude Usage**: `@code ptah.getProjectStructure --maxDepth=2`
**Returns**: Directory tree structure

### 6. `ptah.getCurrentContext`

**What**: Show currently included/excluded files
**Claude Usage**: `@code ptah.getCurrentContext`
**Returns**: Included files, excluded files, token estimate

---

## Implementation Effort

| Phase          | Hours     | Status         |
| -------------- | --------- | -------------- |
| Core Commands  | 6-8       | ⬜ Not Started |
| Infrastructure | 1-2       | ⬜ Not Started |
| Testing        | 3-4       | ⬜ Not Started |
| Documentation  | 2-3       | ⬜ Not Started |
| Cleanup        | 1         | ⬜ Not Started |
| **Total**      | **14-20** | **📋 Planned** |

---

## Real-World Claude CLI Workflows

### Workflow 1: New Project Onboarding

```
User: Claude, analyze this project and tell me how it's structured.

Claude: @code ptah.analyzeWorkspace

Claude: This is an Nx monorepo with 14 libraries (2 apps + 12 libs).
It uses TypeScript, Angular 20, and follows a layered architecture...
```

### Workflow 2: Feature Implementation

```
User: I need to add OAuth authentication. Find existing auth code.

Claude: @code ptah.searchRelevantFiles --query="auth"

Claude: I found 3 relevant files:
1. libs/backend/auth/auth.service.ts (95% relevant)
2. apps/web/login.component.ts (87% relevant)
3. libs/shared/auth.types.ts (72% relevant)

Let me analyze the existing patterns...
```

### Workflow 3: Context Optimization

```
User: My context is at 185k tokens. What can I exclude?

Claude: @code ptah.optimizeContext

Claude: I can save 20,500 tokens by excluding:
- 15 test files (12,000 tokens)
- 8 build files (8,500 tokens)

Shall I proceed with these exclusions?
```

---

## Why This Validates the Architecture

**Before TASK_010**:

- workspace-intelligence: "Over-engineered internal code"
- ai-providers-core: "Unused multi-provider abstraction"
- Months of work with limited user-facing value

**After TASK_010**:

- workspace-intelligence: **Marketable feature** that makes Claude smarter
- Unique value proposition: No other VS Code extension does this
- Justifies architecture investment
- 14-20 hours to unlock months of work

---

## Technical Details

### Command Response Format

```typescript
interface CommandResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}
```

All commands return this standardized format for Claude CLI parsing.

### Error Handling

```typescript
try {
  const result = await workspaceAnalyzer.analyzeWorkspace();
  return { success: true, data: result, timestamp: Date.now() };
} catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    timestamp: Date.now(),
  };
}
```

### Testing Strategy

1. **Manual Testing** (Extension Development Host)

   - Launch with F5
   - Test each command in Command Palette
   - Verify JSON output

2. **Claude CLI Integration Testing**

   - Launch Claude CLI in VS Code terminal
   - Execute commands via `@code ptah.commandName`
   - Verify Claude receives and parses results

3. **Automated Tests** (Optional)
   - Unit tests for command handlers
   - Mock service responses
   - Test error scenarios

---

## File Changes

### New Files

- `task-tracking/TASK_2025_010/context.md` ✅
- `task-tracking/TASK_2025_010/implementation-plan.md` ✅
- `task-tracking/TASK_2025_010/tasks.md` ✅
- `task-tracking/TASK_2025_010/QUICK_START.md` ✅
- `docs/CLAUDE_CLI_COMMANDS.md` (pending)
- `apps/ptah-extension-vscode/src/handlers/README_WORKSPACE_COMMANDS.md` (pending)
- `apps/ptah-extension-vscode/src/handlers/command-response.types.ts` (pending)
- `apps/ptah-extension-vscode/src/handlers/command-helpers.ts` (pending)

### Modified Files

- `task-tracking/registry.md` ✅
- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts` (pending)
- `apps/ptah-extension-vscode/src/core/ptah-extension.ts` (pending)
- `README.md` (pending)

---

## Next Steps

1. **Review Implementation Plan** (`implementation-plan.md`)

   - Detailed phase breakdown
   - Code examples for each command
   - JSON response schemas

2. **Review Task Breakdown** (`tasks.md`)

   - 12 atomic tasks
   - Dependencies and sequencing
   - Acceptance criteria

3. **Start Implementation**

   - Begin with Phase 1: Core commands
   - Test each command with Claude CLI immediately
   - Iterate based on feedback

4. **Documentation**
   - User guide for Claude CLI users
   - Developer guide for adding commands
   - Update main README

---

## Success Metrics

- ✅ All 6 commands registered and callable
- ✅ Claude CLI can execute all commands successfully
- ✅ Error handling covers edge cases
- ✅ Documentation includes usage examples
- ✅ Manual testing passes
- ✅ Integration testing with Claude CLI passes
- ✅ Workspace-intelligence library is now a **feature**, not "over-engineering"

---

## Questions?

See detailed documentation:

- `context.md` - Full context and strategy
- `implementation-plan.md` - Phase-by-phase implementation
- `tasks.md` - Atomic task breakdown for team-leader assignment

Ready to turn "over-engineering" into your killer feature? Let's build! 🚀
