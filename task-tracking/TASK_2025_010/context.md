# Task Context for TASK_2025_010

## User Intent

Expose workspace intelligence and context management capabilities as internal VS Code commands that Claude Code CLI can execute directly - no external MCP server required. Transform existing "over-engineered" libraries into powerful Claude CLI tools.

## Conversation Summary

User evaluated current architecture and identified that workspace-intelligence and ai-providers-core/context-manager libraries represent months of work that are currently underutilized. Rather than considering them "over-engineering," user wants to expose them as VS Code commands that Claude CLI can call as internal tools.

**Key Constraint**: No separate MCP server to maintain/publish. Solution must be internal VS Code commands that Claude CLI can execute via `vscode.executeCommand()` API.

## Technical Context

- Branch: feature/TASK_2025_010
- Created: 2025-11-20
- Task Type: FEATURE (New capability enabling Claude CLI workspace analysis)
- Priority: High (Validates architecture investment, provides unique value)
- Effort Estimate: 14-19 hours (Minimum viable implementation)

## Current Assets

**Existing Infrastructure (Ready to Expose)**:

1. **ContextManager** (`libs/backend/ai-providers-core/src/context/context-manager.ts`) - 1000+ lines

   - File search with debouncing & caching
   - Token estimation (rough + accurate via TokenCounterService)
   - Context optimization suggestions
   - File inclusion/exclusion management
   - Project template application

2. **Workspace Intelligence** (`libs/backend/workspace-intelligence/`) - 5 services

   - WorkspaceIndexerService - File indexing
   - TokenCounterService - Accurate token counting
   - FileRelevanceScorerService - Relevance scoring
   - ContextSizeOptimizerService - Context optimization
   - WorkspaceAnalyzerService - Project type detection (13+ types)

3. **Command Infrastructure** (`apps/ptah-extension-vscode/`)
   - CommandManager - Command registration system
   - CommandHandlers - Existing command handlers
   - DI Container - All services already registered

## Value Proposition

**Before TASK_010**: workspace-intelligence is "over-engineered" internal code
**After TASK_010**: workspace-intelligence is a **marketable feature** that makes Claude CLI dramatically smarter about codebases

**Unique Capabilities Unlocked**:

- Claude can analyze project structure automatically
- Claude can search for relevant files before answering
- Claude can estimate token usage before including files
- Claude can optimize context to fit within limits
- Claude can discover project type and framework

## Related Work

- TASK_2025_008: Comprehensive Frontend Architecture Evaluation (in progress)
- TASK_2025_009: Message Type System Refactoring (in progress)
- TASK_2025_005: Rich Claude CLI Features (planned - @ mentions, etc.)

## Execution Strategy

FEATURE_IMPLEMENTATION (New capability, internal commands only)

**Phase Breakdown**:

1. Command Registration (6-8 hours) - Register 5-7 core commands
2. JSON Serialization (1-2 hours) - Ensure all outputs are Claude-compatible
3. Testing & Documentation (3-4 hours) - Verify Claude CLI can call commands
4. Integration Examples (2-3 hours) - Show Claude how to use commands

**Success Criteria**:

- ✅ Claude CLI can call `ptah.analyzeWorkspace` and get project structure
- ✅ Claude CLI can search files with `ptah.searchRelevantFiles --query="auth"`
- ✅ Claude CLI can estimate tokens with `ptah.getTokenEstimate --files=["..."]`
- ✅ Claude CLI can get optimization suggestions with `ptah.optimizeContext`
- ✅ All commands return JSON-serializable data
- ✅ Commands work without UI interaction (headless)
- ✅ Documentation shows Claude how to use commands

## Technical Approach

### VS Code Command Pattern

```typescript
// Commands return JSON-serializable results
// Claude CLI executes: vscode.commands.executeCommand('ptah.analyzeWorkspace')
// Claude receives: { projectType: "nx-monorepo", totalFiles: 256, ... }

interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

### Claude CLI Integration (No MCP Server)

Claude CLI can execute VS Code commands directly:

- Uses VS Code extension host API
- No external server needed
- No publishing/maintenance overhead
- Works immediately in current setup

### Architecture Decision

**Internal Tools Architecture**:

- Commands registered in extension activation
- Commands call existing service methods
- Commands return structured JSON
- Claude CLI calls via `vscode.executeCommand()`
- No webview interaction required

## Risk Assessment

**Low Risk**:

- ✅ Reusing existing, tested code
- ✅ Commands are simple wrappers
- ✅ No breaking changes to existing features
- ✅ VS Code command pattern is stable
- ✅ Can be developed incrementally

**Mitigation**:

- Start with 2-3 core commands
- Add remaining commands after validation
- Extensive testing with Claude CLI
- Fallback error handling for all commands
