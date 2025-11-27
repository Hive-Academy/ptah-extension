# TASK_2025_010 - Implementation Plan

## Workspace Intelligence Commands for Claude CLI

**Goal**: Expose workspace-intelligence and context-manager capabilities as internal VS Code commands that Claude Code CLI can execute directly.

**Approach**: Internal VS Code commands (no MCP server) callable via `vscode.commands.executeCommand()`

---

## Phase 1: Core Command Registration (6-8 hours)

### Command 1: `ptah.analyzeWorkspace`

**Purpose**: Return comprehensive project structure and metadata

**Implementation**:

```typescript
// In CommandHandlers.registerWorkspaceCommands()
this.commandManager.registerCommand('ptah.analyzeWorkspace', async () => {
  try {
    const analysis = await this.workspaceAnalyzer.analyzeWorkspace();

    return {
      success: true,
      data: {
        projectType: analysis.projectType,
        totalFiles: analysis.fileCount,
        languages: analysis.detectedLanguages,
        frameworks: analysis.frameworks,
        structure: analysis.directoryStructure,
        dependencies: analysis.dependencies,
        buildSystem: analysis.buildSystem,
        testFrameworks: analysis.testFrameworks,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Analysis failed',
    };
  }
});
```

**Claude CLI Usage**:

```
I need to understand this codebase structure.
@code ptah.analyzeWorkspace
```

**Expected Output**:

```json
{
  "success": true,
  "data": {
    "projectType": "nx-monorepo",
    "totalFiles": 256,
    "languages": ["typescript", "scss", "html"],
    "frameworks": ["angular", "vscode-extension"],
    "buildSystem": "nx",
    "testFrameworks": ["jest"]
  }
}
```

---

### Command 2: `ptah.searchRelevantFiles`

**Purpose**: Search and rank files by relevance to a query

**Implementation**:

```typescript
interface SearchFilesArgs {
  query: string;
  maxResults?: number;
  includeImages?: boolean;
}

this.commandManager.registerCommand('ptah.searchRelevantFiles', async (args: SearchFilesArgs) => {
  try {
    const options = {
      query: args.query,
      maxResults: args.maxResults || 20,
      includeImages: args.includeImages || false,
      sortBy: 'relevance' as const,
    };

    const results = await this.contextManager.searchFiles(options);

    return {
      success: true,
      data: results.map((file) => ({
        path: file.relativePath,
        fileName: file.fileName,
        fileType: file.fileType,
        relevanceScore: file.relevanceScore,
        size: file.size,
        lastModified: new Date(file.lastModified).toISOString(),
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
    };
  }
});
```

**Claude CLI Usage**:

```
Show me files related to authentication.
@code ptah.searchRelevantFiles --query="authentication" --maxResults=10
```

**Expected Output**:

```json
{
  "success": true,
  "data": [
    {
      "path": "libs/backend/auth/auth.service.ts",
      "fileName": "auth.service.ts",
      "fileType": "text",
      "relevanceScore": 0.95,
      "size": 4521,
      "lastModified": "2025-11-20T10:30:00Z"
    },
    {
      "path": "apps/web/login.component.ts",
      "fileName": "login.component.ts",
      "fileType": "text",
      "relevanceScore": 0.87,
      "size": 2341,
      "lastModified": "2025-11-19T15:20:00Z"
    }
  ]
}
```

---

### Command 3: `ptah.getTokenEstimate`

**Purpose**: Estimate token count for files (accurate counting via TokenCounterService)

**Implementation**:

```typescript
interface TokenEstimateArgs {
  files: string[];
  useAccurateCounting?: boolean;
}

this.commandManager.registerCommand('ptah.getTokenEstimate', async (args: TokenEstimateArgs) => {
  try {
    const tokenCounts: Record<string, number> = {};
    let totalTokens = 0;

    for (const filePath of args.files) {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', filePath);

      const content = await fs.promises.readFile(absolutePath, 'utf-8');

      const tokens = args.useAccurateCounting ? await this.tokenCounter.countTokens(content) : Math.ceil(content.length / 4); // Rough estimate: 4 chars per token

      tokenCounts[filePath] = tokens;
      totalTokens += tokens;
    }

    return {
      success: true,
      data: {
        totalTokens,
        fileTokens: tokenCounts,
        maxContextTokens: 200000,
        percentageUsed: (totalTokens / 200000) * 100,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Token estimation failed',
    };
  }
});
```

**Claude CLI Usage**:

```
How many tokens are in these files?
@code ptah.getTokenEstimate --files=["src/main.ts", "src/app.ts"] --useAccurateCounting=true
```

**Expected Output**:

```json
{
  "success": true,
  "data": {
    "totalTokens": 12450,
    "fileTokens": {
      "src/main.ts": 5230,
      "src/app.ts": 7220
    },
    "maxContextTokens": 200000,
    "percentageUsed": 6.2
  }
}
```

---

### Command 4: `ptah.optimizeContext`

**Purpose**: Get suggestions to reduce token usage

**Implementation**:

```typescript
this.commandManager.registerCommand('ptah.optimizeContext', async () => {
  try {
    const suggestions = this.contextManager.getOptimizationSuggestions();

    return {
      success: true,
      data: {
        currentTokens: this.contextManager.getTokenEstimate(),
        maxTokens: 200000,
        suggestions: suggestions.map((s) => ({
          type: s.type,
          description: s.description,
          estimatedSavings: s.estimatedSavings,
          autoApplicable: s.autoApplicable,
          files: s.files,
        })),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Optimization analysis failed',
    };
  }
});
```

**Claude CLI Usage**:

```
My context is too large. What can I exclude?
@code ptah.optimizeContext
```

**Expected Output**:

```json
{
  "success": true,
  "data": {
    "currentTokens": 185000,
    "maxTokens": 200000,
    "suggestions": [
      {
        "type": "exclude_pattern",
        "description": "Exclude 15 test files",
        "estimatedSavings": 12000,
        "autoApplicable": true,
        "files": ["src/app.spec.ts", "src/auth.spec.ts", ...]
      },
      {
        "type": "exclude_pattern",
        "description": "Exclude 8 build/generated files",
        "estimatedSavings": 8500,
        "autoApplicable": true,
        "files": ["dist/main.js", "dist/vendor.js", ...]
      }
    ]
  }
}
```

---

### Command 5: `ptah.getProjectStructure`

**Purpose**: Return hierarchical directory structure

**Implementation**:

```typescript
interface ProjectStructureArgs {
  maxDepth?: number;
  excludePatterns?: string[];
}

this.commandManager.registerCommand('ptah.getProjectStructure', async (args: ProjectStructureArgs) => {
  try {
    const structure = await this.workspaceAnalyzer.getProjectStructure(args.maxDepth || 3, args.excludePatterns || ['node_modules', 'dist', '.git']);

    return {
      success: true,
      data: structure,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Structure analysis failed',
    };
  }
});
```

**Claude CLI Usage**:

```
Show me the project folder structure.
@code ptah.getProjectStructure --maxDepth=2
```

**Expected Output**:

```json
{
  "success": true,
  "data": {
    "name": "ptah-extension",
    "type": "directory",
    "children": [
      {
        "name": "apps",
        "type": "directory",
        "children": [
          { "name": "ptah-extension-vscode", "type": "directory" },
          { "name": "ptah-extension-webview", "type": "directory" }
        ]
      },
      {
        "name": "libs",
        "type": "directory",
        "children": [
          { "name": "backend", "type": "directory" },
          { "name": "frontend", "type": "directory" },
          { "name": "shared", "type": "directory" }
        ]
      }
    ]
  }
}
```

---

### Command 6: `ptah.getCurrentContext`

**Purpose**: Show currently included/excluded files in context

**Implementation**:

```typescript
this.commandManager.registerCommand('ptah.getCurrentContext', async () => {
  try {
    const context = this.contextManager.getCurrentContext();

    return {
      success: true,
      data: {
        includedFiles: context.includedFiles,
        excludedFiles: context.excludedFiles,
        tokenEstimate: await this.contextManager.getTokenEstimateAsync(),
        optimizations: context.optimizations,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Context retrieval failed',
    };
  }
});
```

---

### Command 7: `ptah.callVsCodeLM` 🆕 AI Delegation

**Purpose**: Allow Claude CLI to delegate tasks to VS Code Language Model (GitHub Copilot)

**Strategic Value**:

- **Cost Optimization**: Use free Copilot for simple tasks, reserve Claude for complex reasoning
- **Speed**: Copilot typically responds faster for code generation tasks
- **Fallback**: Redundancy if Claude CLI is slow/unavailable
- **Multi-Model Consensus**: Get second opinions on code quality/security
- **Validates Architecture**: Proves multi-provider abstraction is not over-engineering

**Implementation**:

```typescript
interface VsCodeLMCallArgs {
  prompt: string;
  model?: 'gpt-4o' | 'gpt-4-turbo' | 'gpt-3.5-turbo';
  includeContext?: boolean;
  maxTokens?: number;
  systemPrompt?: string;
}

this.commandManager.registerCommand('ptah.callVsCodeLM', async (args: VsCodeLMCallArgs) => {
  try {
    // Validate VS Code LM is available
    const isAvailable = await this.vsCodeLmAdapter.initialize();
    if (!isAvailable) {
      return {
        success: false,
        error: 'VS Code Language Model API is not available. Ensure GitHub Copilot or compatible extension is installed.',
        timestamp: Date.now(),
      };
    }

    // Create ephemeral session for this call
    const sessionId = SessionId.create();

    await this.vsCodeLmAdapter.createSession(sessionId, {
      model: args.model || 'gpt-4o',
      maxTokens: args.maxTokens || 4000,
      systemPrompt: args.systemPrompt,
    });

    // Optionally enhance prompt with workspace context
    let enhancedPrompt = args.prompt;
    if (args.includeContext) {
      const context = this.contextManager.getCurrentContext();
      const relevantFiles = context.includedFiles.slice(0, 5); // Limit to 5 files for token efficiency

      if (relevantFiles.length > 0) {
        enhancedPrompt = `Workspace Context (${relevantFiles.length} files):\n${relevantFiles.join('\n')}\n\nTask:\n${args.prompt}`;
      }
    }

    // Stream response from VS Code LM
    let fullResponse = '';
    const startTime = Date.now();

    for await (const chunk of this.vsCodeLmAdapter.sendMessage(sessionId, enhancedPrompt)) {
      fullResponse += chunk;
    }

    const responseTime = Date.now() - startTime;

    // Cleanup ephemeral session
    this.vsCodeLmAdapter.endSession(sessionId);

    // Calculate approximate token usage
    const promptTokens = Math.ceil(enhancedPrompt.length / 4);
    const responseTokens = Math.ceil(fullResponse.length / 4);

    return {
      success: true,
      data: {
        response: fullResponse,
        model: args.model || 'gpt-4o',
        provider: 'vscode-lm',
        responseTime,
        tokensUsed: {
          prompt: promptTokens,
          response: responseTokens,
          total: promptTokens + responseTokens,
        },
        contextIncluded: args.includeContext || false,
      },
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'VS Code LM call failed',
      timestamp: Date.now(),
    };
  }
});
```

**Claude CLI Usage Examples**:

```bash
# Simple delegation (cost-optimized)
User: "Generate a debounce utility function"

Claude CLI:
  > This is simple boilerplate. Let me delegate to Copilot (free).
  > @code ptah.callVsCodeLM --prompt="Generate TypeScript debounce utility function with generics"

  > Copilot generated: [debounce code]

  > I'll integrate that into your utils folder...
```

```bash
# With model selection
@code ptah.callVsCodeLM --model="gpt-3.5-turbo" --prompt="Add JSDoc comments to debounce function"
```

```bash
# With workspace context
@code ptah.callVsCodeLM --includeContext=true --prompt="Find inconsistencies in our error handling patterns"
```

```bash
# Second opinion / consensus
User: "Is this JWT implementation secure?"

Claude CLI:
  > Let me get Copilot's opinion too.
  > @code ptah.callVsCodeLM --prompt="Review this JWT authentication for security vulnerabilities: [code]"

  > Copilot found: Token stored in localStorage (XSS risk)
  > I also see: Missing token expiration validation

  > Here's a secure implementation addressing both issues...
```

**Expected Output**:

```json
{
  "success": true,
  "data": {
    "response": "function debounce<T extends (...args: any[]) => any>(\n  func: T,\n  delay: number\n): (...args: Parameters<T>) => void {\n  let timeoutId: NodeJS.Timeout;\n  \n  return function(...args: Parameters<T>) {\n    clearTimeout(timeoutId);\n    timeoutId = setTimeout(() => func(...args), delay);\n  };\n}",
    "model": "gpt-4o",
    "provider": "vscode-lm",
    "responseTime": 1842,
    "tokensUsed": {
      "prompt": 32,
      "response": 93,
      "total": 125
    },
    "contextIncluded": false
  },
  "timestamp": 1732118400000
}
```

**Use Cases**:

1. **Cost Optimization**: Free Copilot for boilerplate, reserve Claude for architecture
2. **Speed**: Copilot often faster for simple code generation
3. **Redundancy**: Fallback if Claude CLI is slow/unavailable
4. **Multi-Model Validation**: Compare responses for critical code
5. **Specialized Tasks**: Use best model for each task type

---

## Phase 2: JSON Serialization & Error Handling (1-2 hours)

### Standardized Response Format

```typescript
interface CommandResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: number;
}

// Helper function for all commands
function createCommandResponse<T>(data?: T, error?: Error | string): CommandResponse<T> {
  return {
    success: !error,
    data,
    error: error instanceof Error ? error.message : error,
    timestamp: Date.now(),
  };
}
```

### Error Handling Patterns

```typescript
// Wrap all command implementations
try {
  const result = await someOperation();
  return createCommandResponse(result);
} catch (error) {
  logger.error('Command failed', error);
  return createCommandResponse(undefined, error);
}
```

---

## Phase 3: Testing & Validation (3-4 hours)

### Manual Testing Checklist

1. **Extension Development Host**:

   - Launch extension (F5)
   - Open Command Palette (Ctrl+Shift+P)
   - Test each command manually
   - Verify JSON output in VS Code console

2. **Claude CLI Integration**:

   - Launch Claude CLI in VS Code terminal
   - Execute commands via `@code ptah.commandName`
   - Verify Claude receives and parses JSON
   - Test error scenarios (missing args, invalid paths)

3. **Edge Cases**:
   - Empty workspace (no files)
   - Very large workspace (1000+ files)
   - Files with special characters in names
   - Network drives / symlinks
   - Permission errors (unreadable files)

### Automated Tests

```typescript
// Test command registration
describe('Workspace Commands', () => {
  it('should register all workspace intelligence commands', () => {
    const commands = ['ptah.analyzeWorkspace', 'ptah.searchRelevantFiles', 'ptah.getTokenEstimate', 'ptah.optimizeContext', 'ptah.getProjectStructure', 'ptah.getCurrentContext'];

    commands.forEach((cmd) => {
      expect(vscode.commands.getCommands()).toContain(cmd);
    });
  });

  it('should return valid JSON for analyzeWorkspace', async () => {
    const result = await vscode.commands.executeCommand('ptah.analyzeWorkspace');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('data');
  });

  // ... more tests
});
```

---

## Phase 4: Documentation (2-3 hours)

### User Documentation

**File**: `docs/CLAUDE_CLI_COMMANDS.md`

```markdown
# Claude CLI Workspace Commands

Ptah provides intelligent workspace analysis commands that Claude Code CLI can execute.

## Available Commands

### 1. Analyze Workspace

**Command**: `ptah.analyzeWorkspace`

**Description**: Analyzes project structure, languages, frameworks, and build system.

**Usage**:
```

I need to understand this codebase.
@code ptah.analyzeWorkspace

```

**Returns**: Project type, file count, languages, frameworks, dependencies

---

### 2. Search Relevant Files

**Command**: `ptah.searchRelevantFiles`

**Description**: Searches files by keyword and ranks by relevance.

**Arguments**:
- `query` (required): Search keyword
- `maxResults` (optional): Max files to return (default: 20)
- `includeImages` (optional): Include image files (default: false)

**Usage**:
```

Find authentication-related files.
@code ptah.searchRelevantFiles --query="authentication" --maxResults=10

```

**Returns**: List of files with relevance scores

---

[... continue for all commands ...]
```

### Developer Documentation

**File**: `apps/ptah-extension-vscode/src/handlers/README_WORKSPACE_COMMANDS.md`

```markdown
# Workspace Intelligence Commands - Developer Guide

## Architecture

Commands are registered in `CommandHandlers.registerWorkspaceCommands()`:

1. Each command wraps a service method call
2. Results are JSON-serialized
3. Errors are caught and returned in standardized format
4. All commands are stateless (no side effects)

## Adding New Commands

1. Add command registration in `CommandHandlers.registerWorkspaceCommands()`
2. Define command args interface (if needed)
3. Call service method and wrap result
4. Add tests in `workspace-commands.spec.ts`
5. Update `CLAUDE_CLI_COMMANDS.md` docs

## Testing

Commands can be tested via:

- VS Code Command Palette (manual)
- Claude CLI (integration)
- Unit tests (automated)
```

---

## Phase 5: Integration Examples (2-3 hours)

### Claude CLI Workflow Examples

**Example 1: New Project Onboarding**

```
Claude, analyze this project and tell me how it's structured.

@code ptah.analyzeWorkspace

Based on the analysis, create a README.md with:
- Project architecture overview
- Key technologies used
- Build/test commands
```

**Example 2: Feature Implementation**

```
I need to add authentication to this app. Find existing auth-related code.

@code ptah.searchRelevantFiles --query="auth"

Now analyze the token usage if I include these files:

@code ptah.getTokenEstimate --files=["libs/backend/auth/auth.service.ts", "apps/web/login.component.ts"]

Based on the existing patterns, help me implement OAuth2.
```

**Example 3: Context Optimization**

```
My context is nearing the limit. What can I exclude?

@code ptah.optimizeContext

Apply the suggestions and show the new token count:

@code ptah.getCurrentContext
```

---

## File Changes Summary

### New Files

- `task-tracking/TASK_2025_010/context.md`
- `task-tracking/TASK_2025_010/implementation-plan.md`
- `task-tracking/TASK_2025_010/tasks.md`
- `docs/CLAUDE_CLI_COMMANDS.md`
- `apps/ptah-extension-vscode/src/handlers/README_WORKSPACE_COMMANDS.md`

### Modified Files

- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts` - Add workspace commands
- `apps/ptah-extension-vscode/src/core/ptah-extension.ts` - Wire up command registration
- `task-tracking/registry.md` - Add TASK_2025_010 entry

### Test Files

- `apps/ptah-extension-vscode/src/handlers/__tests__/workspace-commands.spec.ts` - New tests

---

## Success Metrics

- ✅ 6 commands registered and callable
- ✅ All commands return JSON-serializable data
- ✅ Claude CLI can execute all commands successfully
- ✅ Error handling covers edge cases
- ✅ Documentation includes usage examples
- ✅ Manual testing in Extension Development Host passes
- ✅ Integration testing with Claude CLI passes

---

## Effort Estimate Breakdown

| Phase     | Task                                   | Hours           |
| --------- | -------------------------------------- | --------------- |
| 1         | Core Command Registration (7 commands) | 8-11            |
| 2         | JSON Serialization & Error Handling    | 1-2             |
| 3         | Testing & Validation                   | 3-4             |
| 4         | Documentation                          | 2-3             |
| 5         | Integration Examples                   | 2-3             |
| **Total** |                                        | **16-23 hours** |

**Command 7 Impact** (+2-3 hours):

- Registration & implementation: +1.5 hours
- VsCodeLmAdapter integration: +0.5 hours (already exists!)
- Testing with both providers: +1 hour

---

## Next Steps

1. Review and approve implementation plan
2. Begin Phase 1: Core command registration
3. Test with Claude CLI after each command
4. Iterate based on feedback
5. Complete documentation
6. Merge to main branch
