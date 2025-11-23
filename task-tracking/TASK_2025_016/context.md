# TASK_2025_016: Code Execution API for Autonomous Claude CLI Tool Usage

**Created**: 2025-11-23
**Type**: FEATURE
**Complexity**: Medium
**Estimated Time**: 5-6 hours

## User Intent

Enable spawned Claude CLI processes to autonomously call back into the Ptah extension's tools and services without requiring external MCP server publication or separate CLI tooling. Implement a code execution pattern (inspired by [Anthropic's code execution article](https://www.anthropic.com/engineering/code-execution-with-mcp)) that provides 98.7% token reduction through single-tool execution instead of individual tool calls.

## Business Problem

Currently, when Ptah spawns a Claude CLI process to handle tasks (e.g., "fix this bug"), the CLI process has no way to:

- Discover what extension features are available
- Autonomously call extension tools (workspace analysis, file search, diagnostics, etc.)
- Delegate work to VS Code's LM API for multi-agent patterns
- Access the same services that the extension UI uses

This creates a one-way integration where the extension can call Claude CLI, but Claude CLI cannot leverage the extension's rich workspace intelligence and tool ecosystem.

## Solution Approach

Implement an **internal HTTP MCP server** with a single "execute_code" tool that:

1. **Skips VM2 sandboxing** for performance (we trust our own code, Extension Host provides security boundary)
2. **Reuses existing vscode-lm-tools services** via dependency injection (DRY principle)
3. **Exposes 7 API namespaces** including VS Code LM API for multi-agent patterns
4. **Works when published** (self-contained, no external dependencies)
5. **Preserves existing commands** (orthogonal concerns - both use same services)

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────┐
│  Claude CLI Process (spawned by extension)              │
│  - Receives MCP config with localhost port              │
│  - Calls execute_code tool with TypeScript snippets     │
└─────────────────────────────────────────────────────────┘
                         ↓ HTTP/JSON-RPC 2.0
┌─────────────────────────────────────────────────────────┐
│  CodeExecutionMCP Service (new)                         │
│  - HTTP server on random localhost port                 │
│  - Single tool: execute_code                            │
│  - Direct AsyncFunction execution (no VM2)              │
│  - Promise.race() timeout (5000ms default)              │
└─────────────────────────────────────────────────────────┘
                         ↓ calls
┌─────────────────────────────────────────────────────────┐
│  PtahAPIBuilder Service (new)                           │
│  - Builds complete "ptah" API object                    │
│  - Injects existing services via DI                     │
│  - 7 namespaces: workspace, search, symbols,            │
│    diagnostics, git, ai, files, commands                │
└─────────────────────────────────────────────────────────┘
                         ↓ uses
┌─────────────────────────────────────────────────────────┐
│  Existing Services (vscode-lm-tools + others)           │
│  - WorkspaceAnalyzerService                             │
│  - FileIndexerService                                   │
│  - CommandService                                       │
│  - vscode.lm API (VS Code LM API)                       │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **No VM2 Dependency**: Direct `AsyncFunction` execution for performance

   - Security provided by Extension Host sandbox
   - Timeout via `Promise.race()` prevents hanging
   - Trust model: we control both sides (extension + spawned CLI)

2. **Service Reuse**: PtahAPIBuilder directly injects existing services

   - Zero code duplication
   - Same business logic as VS Code commands
   - Consistent behavior across all interfaces

3. **Multi-Agent Support**: Expose `vscode.lm` API

   - Enables Claude CLI orchestrator → VS Code LM worker pattern
   - Claude CLI can delegate specific tasks to specialized models
   - Full access to VS Code's language model ecosystem

4. **Orthogonal to Commands**: Code execution API and Command Palette are parallel interfaces
   - Both call the same business logic (CommandService, etc.)
   - Command Palette = UI integration layer
   - Code Execution API = programmatic integration layer
   - No conflicts, perfect separation of concerns

## API Surface (7 Namespaces)

### 1. Workspace Namespace

```typescript
ptah.workspace.analyze(); // Get project type, frameworks, structure
ptah.workspace.getInfo(); // Get workspace metadata
ptah.workspace.getProjectType(); // Get detected project type
ptah.workspace.getFrameworks(); // Get detected frameworks
```

### 2. Search Namespace

```typescript
ptah.search.findFiles(pattern, limit?)       // Search files by pattern
ptah.search.getRelevantFiles(query, maxFiles?) // Semantic file search
```

### 3. Symbols Namespace

```typescript
ptah.symbols.find(name, type?)      // Find symbols in workspace
```

### 4. Diagnostics Namespace

```typescript
ptah.diagnostics.getErrors(); // Get all errors
ptah.diagnostics.getWarnings(); // Get all warnings
ptah.diagnostics.getAll(); // Get all diagnostics
```

### 5. Git Namespace

```typescript
ptah.git.getStatus(); // Get git status (branch, modified, staged, untracked)
```

### 6. AI Namespace (Multi-Agent!)

```typescript
ptah.ai.chat(message, model?)       // Call VS Code LM API
ptah.ai.selectModel(family)         // List available models
```

### 7. Files Namespace

```typescript
ptah.files.read(path); // Read file content
ptah.files.list(directory); // List directory contents
```

### 8. Commands Namespace

```typescript
ptah.commands.execute(commandId, ...args); // Execute VS Code command
ptah.commands.list(); // List available commands
```

## Technical Constraints

1. **Performance**: Must be faster than VM2 sandboxing (direct execution achieves this)
2. **Token Efficiency**: 98.7% reduction vs individual tools (per Anthropic article)
3. **Self-Contained**: Must work when extension is published (no external servers)
4. **Type Safety**: TypeScript execution with runtime error handling
5. **Timeout Protection**: Prevent runaway code (5000ms default, 30000ms max)

## Success Criteria

- ✅ No VM2 dependency (performance optimization)
- ✅ Reuses vscode-lm-tools services (DRY principle)
- ✅ Exposes VS Code LM API (multi-agent support)
- ✅ Commands unaffected (orthogonal architecture)
- ✅ Works when published (self-contained)
- ✅ 98.7% token reduction (code execution pattern)
- ✅ HTTP MCP server starts/stops cleanly
- ✅ Port stored in workspace state for discovery
- ✅ Claude CLI integration working end-to-end

## Related Tasks

- **TASK_2025_010**: Workspace Intelligence Commands (provides services we'll expose)
- **TASK_2025_014**: Session Management Refactoring (SessionProxy patterns)

## Files to Create

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (NEW)
2. `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts` (NEW)
3. `libs/backend/vscode-lm-tools/src/lib/code-execution/index.ts` (NEW - export barrel)

## Files to Modify

1. `apps/ptah-extension-vscode/src/main.ts` (start MCP server on activation)
2. `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts` (pass MCP config to spawned process)
3. `libs/backend/vscode-lm-tools/src/index.ts` (export new services)
4. `libs/backend/vscode-core/src/di/tokens.ts` (add new DI tokens)

## Example Usage (Claude CLI Perspective)

```typescript
// Claude CLI receives this in its context:
// "You have access to the Ptah extension via the 'execute_code' MCP tool.
//  Execute TypeScript code with access to the 'ptah' global object."

// Example 1: Analyze workspace
const workspaceInfo = await execute_code({
  code: `
    const info = await ptah.workspace.analyze();
    return {
      projectType: info.info.projectType,
      frameworks: info.info.frameworks,
      fileCount: info.structure.totalFiles
    };
  `,
});

// Example 2: Find all TypeScript errors
const errors = await execute_code({
  code: `
    const errors = await ptah.diagnostics.getErrors();
    return errors.filter(e => e.file.endsWith('.ts'));
  `,
});

// Example 3: Multi-agent delegation
const analysis = await execute_code({
  code: `
    // Claude CLI orchestrator delegates to VS Code LM worker
    const response = await ptah.ai.chat(
      "Analyze this codebase structure and suggest improvements",
      "claude-3.5-sonnet"
    );
    return response;
  `,
});
```

## Benefits Over Individual Tools

**Before (Individual Tools)**:

- 15+ separate MCP tools (ptah_analyze_workspace, ptah_search_files, etc.)
- Each tool call = separate round trip
- Complex parameter validation for each tool
- High token overhead (tool definitions + invocations)

**After (Code Execution)**:

- Single tool: execute_code
- Compose multiple operations in one call
- Natural TypeScript syntax
- 98.7% token reduction (per Anthropic research)
- Faster execution (fewer round trips)

## Implementation Strategy

This task will follow the standard orchestration workflow:

1. **Project Manager**: Define detailed requirements
2. **Software Architect**: Design complete implementation plan
3. **Team Leader**: Break down into atomic tasks
4. **Developers**: Implement services, integration, tests
5. **QA**: Testing and code review

---

**Next Steps**: Invoke `/orchestrate TASK_2025_016` to begin implementation workflow.
