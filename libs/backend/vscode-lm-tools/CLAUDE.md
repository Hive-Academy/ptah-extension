# libs/backend/vscode-lm-tools - VS Code Language Model Tools & MCP Server

[Back to Main](../../../CLAUDE.md)

## Purpose

The **vscode-lm-tools library** provides a Code Execution MCP (Model Context Protocol) server for Ptah API integration. It enables VS Code Language Models, Claude CLI, and Electron-hosted AI agents to execute TypeScript/JavaScript code with access to Ptah extension APIs (workspace analysis, search, diagnostics, AI, files, and more). This library powers the `execute_code` MCP tool and system prompt generation.

**Platform support**: The MCP server runs on both **VS Code** and **Electron/standalone** platforms. VS Code-exclusive features (LSP, editor state, code actions) gracefully degrade on non-VS Code platforms. Only one file (`ide-capabilities.vscode.ts`) imports the `vscode` module directly, and it is conditionally loaded via DI.

## Boundaries

**Belongs here**:

- Code Execution MCP server implementation
- Ptah API builder (namespace construction)
- System prompt generation for MCP tools (including platform-tailored prompts)
- Permission prompt services for tool execution
- VS Code Language Model API integration
- Secure code execution sandboxing
- Platform abstraction interfaces for IDE capabilities

**Does NOT belong**:

- Business logic for specific features (belongs in domain libraries)
- Workspace analysis implementation (belongs in `workspace-intelligence`)
- VS Code API wrappers (belongs in `vscode-core`)
- Agent generation logic (belongs in `agent-generation`)
- Platform-core interfaces like `IDiagnosticsProvider`, `IWorkspaceProvider` (belongs in `platform-core`)

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│            MCP Server (Platform-Agnostic Core)            │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  CodeExecutionMCP (MCP Server)                      │  │
│  │  ├─ execute_code tool implementation                │  │
│  │  ├─ Sandboxed code execution (timeout: 5s-30s)      │  │
│  │  ├─ Tool filtering (hasIDECapabilities flag)        │  │
│  │  └─ Optional WebviewManager (lazy DI resolution)    │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │  PtahAPIBuilder (14 Namespace Constructor)          │  │
│  │  ├─ ptah.workspace    - Workspace analysis          │  │
│  │  ├─ ptah.search       - File search & relevance     │  │
│  │  ├─ ptah.diagnostics  - via IDiagnosticsProvider    │  │
│  │  ├─ ptah.files        - File operations             │  │
│  │  ├─ ptah.context      - Token budget management     │  │
│  │  ├─ ptah.project      - Monorepo detection          │  │
│  │  ├─ ptah.relevance    - File scoring                │  │
│  │  ├─ ptah.dependencies - Import graph                │  │
│  │  ├─ ptah.ast          - Tree-sitter analysis        │  │
│  │  ├─ ptah.ide          - via IIDECapabilities        │  │
│  │  ├─ ptah.orchestration- Workflow state              │  │
│  │  ├─ ptah.agent        - Agent orchestration         │  │
│  │  ├─ ptah.git          - Git worktree operations     │  │
│  │  ├─ ptah.json         - JSON validation & repair    │  │
│  │  └─ ptah.webSearch    - Web search (multi-provider) │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │  System Prompt Generation                           │  │
│  │  ├─ PTAH_SYSTEM_PROMPT (static, full prompt)        │  │
│  │  └─ buildPlatformSystemPrompt(hasIDE)               │  │
│  │     └─ Strips VS Code-only tools for Electron       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌──────────────────────┐  ┌───────────────────────────┐  │
│  │  Platform Injection  │  │  Permission Management    │  │
│  │  Points              │  │  └─ PermissionPromptService│  │
│  │  ├─ IDiagnostics-    │  │     ├─ User consent       │  │
│  │  │  Provider         │  │     ├─ Permission caching  │  │
│  │  ├─ IIDECapabilities │  │     └─ Risk assessment     │  │
│  │  ├─ IWorkspace-      │  └───────────────────────────┘  │
│  │  │  Provider         │                                 │
│  │  └─ WebviewManager?  │                                 │
│  └──────────────────────┘                                 │
├───────────────────────────────────────────────────────────┤
│  Platform-Specific Layer (conditionally loaded via DI)    │
│                                                           │
│  VS Code:                     Electron/Standalone:        │
│  ├─ VscodeIDECapabilities     ├─ (no IIDECapabilities)   │
│  │  └─ LSP, editor, actions   │  └─ graceful stubs       │
│  ├─ VscodeDiagnosticsProvider ├─ ElectronDiagnostics-    │
│  │  └─ vscode.languages.*    │    Provider (stub/[])     │
│  ├─ WebviewManager present    ├─ No WebviewManager       │
│  │  └─ approval_prompt UI     │  └─ auto-allow prompts   │
│  └─ Full tool list            └─ Filtered tool list      │
└───────────────────────────────────────────────────────────┘
```

## Platform Abstractions

The library uses three platform abstraction points to decouple from direct VS Code API usage. These enable the MCP server to run on both VS Code and Electron/standalone platforms.

### IDiagnosticsProvider (from platform-core)

**Replaces**: `vscode.languages.getDiagnostics()`, `vscode.DiagnosticSeverity`

Defined in `@ptah-extension/platform-core`. Injected into `PtahAPIBuilder` via `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`. Used by `buildDiagnosticsNamespace()` in `core-namespace.builders.ts`.

- **VS Code**: Wraps `vscode.languages.getDiagnostics()` with severity enum-to-string conversion
- **Electron**: Returns empty array (no live language server); future enhancement could run `tsc --noEmit` and parse output

```typescript
interface IDiagnosticsProvider {
  getDiagnostics(): Array<{
    file: string;
    diagnostics: Array<{
      message: string;
      line: number;
      severity: 'error' | 'warning' | 'info' | 'hint';
    }>;
  }>;
}
```

### IIDECapabilities (local interface)

**Replaces**: `vscode.commands.executeCommand()` (LSP providers), `vscode.window.activeTextEditor`, `vscode.window.visibleTextEditors`, `vscode.workspace.textDocuments`, `vscode.Uri`, `vscode.Position`, `vscode.Range`, `vscode.CodeActionKind`

Defined locally in `ide-namespace.builder.ts`. Implemented by `VscodeIDECapabilities` in `ide-capabilities.vscode.ts`. Resolved lazily via `IDE_CAPABILITIES_TOKEN` Symbol in `PtahAPIBuilder`.

- **VS Code**: `VscodeIDECapabilities` wraps all VS Code LSP commands, editor state, and code actions
- **Electron**: Token is NOT registered; `buildIDENamespace()` receives `undefined` and returns graceful degradation stubs (empty arrays, null, false)

```typescript
interface IIDECapabilities {
  lsp: {
    getDefinition(file, line, col): Promise<Location[]>;
    getReferences(file, line, col): Promise<Location[]>;
    getHover(file, line, col): Promise<HoverInfo | null>;
    getTypeDefinition(file, line, col): Promise<Location[]>;
    getSignatureHelp(file, line, col): Promise<SignatureHelp | null>;
  };
  editor: {
    getActive(): Promise<ActiveEditorInfo | null>;
    getOpenFiles(): Promise<string[]>;
    getDirtyFiles(): Promise<string[]>;
    getRecentFiles(limit?): Promise<string[]>;
    getVisibleRange(): Promise<VisibleRange | null>;
  };
  actions: {
    getAvailable(file, line): Promise<CodeAction[]>;
    apply(file, line, actionTitle): Promise<boolean>;
    rename(file, line, col, newName): Promise<boolean>;
    organizeImports(file): Promise<boolean>;
    fixAll(file, kind?): Promise<boolean>;
  };
}
```

### IWorkspaceProvider.getConfiguration() (from platform-core)

**Replaces**: `vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820)`

Used by `getConfiguredPort()` in `http-server.handler.ts` to read the MCP server port from platform configuration with a default fallback.

- **VS Code**: Reads from VS Code settings (`settings.json`)
- **Electron**: Returns default value (51820) since no VS Code settings system exists

### WebviewManager (optional DI, from vscode-core)

**Replaces**: Direct WebviewManager injection that would crash in Electron

`CodeExecutionMCP` resolves `WebviewManager` lazily via `container.isRegistered(TOKENS.WEBVIEW_MANAGER)`. When absent (Electron), the `approval_prompt` tool auto-allows all requests instead of prompting the user through the webview UI.

## MCP Tool Platform Availability

| Tool                       | VS Code  | Electron         | Notes                                            |
| -------------------------- | -------- | ---------------- | ------------------------------------------------ |
| `execute_code`             | Yes      | Yes              | Full Ptah API access on both platforms           |
| `approval_prompt`          | Yes (UI) | Yes (auto-allow) | Electron auto-allows since no webview UI         |
| `ptah_workspace_analyze`   | Yes      | Yes              | Platform-agnostic via workspace-intelligence     |
| `ptah_search_files`        | Yes      | Yes              | Platform-agnostic via workspace-intelligence     |
| `ptah_get_diagnostics`     | Yes      | Yes              | Via `IDiagnosticsProvider` abstraction           |
| `ptah_lsp_references`      | Yes      | **No**           | Requires VS Code LSP (executeReferenceProvider)  |
| `ptah_lsp_definitions`     | Yes      | **No**           | Requires VS Code LSP (executeDefinitionProvider) |
| `ptah_get_dirty_files`     | Yes      | **No**           | Requires VS Code editor state tracking           |
| `ptah_count_tokens`        | Yes      | Yes              | Platform-agnostic                                |
| `ptah_agent_spawn`         | Yes      | Yes              | Platform-agnostic CLI agent management           |
| `ptah_agent_status`        | Yes      | Yes              | Platform-agnostic                                |
| `ptah_agent_read`          | Yes      | Yes              | Platform-agnostic                                |
| `ptah_agent_steer`         | Yes      | Yes              | Platform-agnostic                                |
| `ptah_agent_stop`          | Yes      | Yes              | Platform-agnostic                                |
| `ptah_agent_list`          | Yes      | Yes              | Platform-agnostic                                |
| `ptah_web_search`          | Yes      | Yes              | Requires Gemini CLI installed                    |
| `ptah_git_worktree_list`   | Yes      | Yes              | Requires git on PATH                             |
| `ptah_git_worktree_add`    | Yes      | Yes              | Requires git on PATH                             |
| `ptah_git_worktree_remove` | Yes      | Yes              | Requires git on PATH                             |
| `ptah_json_validate`       | Yes      | Yes              | Platform-agnostic via IFileSystemProvider        |

**Filtering mechanism**: `CodeExecutionMCP` checks `container.isRegistered(IDE_CAPABILITIES_TOKEN)` at construction time. When `false`, it passes `hasIDECapabilities: false` to the protocol handler, which excludes `ptah_lsp_references`, `ptah_lsp_definitions`, and `ptah_get_dirty_files` from the `tools/list` response. The `buildPlatformSystemPrompt(false)` function similarly strips VS Code-only tool documentation from the system prompt sent to AI agents.

## Key Files

### MCP Server

- `code-execution/code-execution-mcp.service.ts` - MCP server orchestrator with optional WebviewManager and IDE capability detection

### API Builder

- `code-execution/ptah-api-builder.service.ts` - Constructs 14 Ptah API namespaces; resolves IDE capabilities lazily via DI
- `code-execution/types.ts` - PtahAPI type definitions

### System Prompt

- `code-execution/ptah-system-prompt.constant.ts` - Static system prompt (`PTAH_SYSTEM_PROMPT`), token count (`PTAH_SYSTEM_PROMPT_TOKENS`), and platform-tailored prompt builder (`buildPlatformSystemPrompt`)

### Permission Management

- `permission/permission-prompt.service.ts` - User permission prompts for tool execution

### Platform Abstraction (TASK_2025_226)

- `code-execution/namespace-builders/ide-capabilities.vscode.ts` - VS Code implementation of `IIDECapabilities` (the **only** file in this library that imports `vscode` directly)
- `code-execution/namespace-builders/ide-namespace.builder.ts` - Defines `IIDECapabilities` interface; builds IDE namespace with graceful degradation stubs when capabilities are absent
- `code-execution/namespace-builders/core-namespace.builders.ts` - Uses `IDiagnosticsProvider` (from platform-core) instead of direct `vscode.languages.getDiagnostics()`
- `code-execution/mcp-handlers/http-server.handler.ts` - Uses `IWorkspaceProvider.getConfiguration()` instead of `vscode.workspace.getConfiguration()`
- `code-execution/mcp-handlers/protocol-handlers.ts` - Conditional tool list filtering based on `hasIDECapabilities` flag
- `code-execution/mcp-handlers/approval-prompt.handler.ts` - Auto-allows prompts when `WebviewManager` is absent (Electron)

## Dependencies

**Internal**:

- `@ptah-extension/shared` - Type definitions (Result, CorrelationId, CliType)
- `@ptah-extension/vscode-core` - Logger, FileSystemManager, TOKENS, WebviewManager (type only)
- `@ptah-extension/platform-core` - `IWorkspaceProvider`, `IFileSystemProvider`, `IDiagnosticsProvider`, `IStateStorage`, `PLATFORM_TOKENS`
- `@ptah-extension/workspace-intelligence` - Workspace analysis, context orchestration, tree-sitter, indexing
- `@ptah-extension/llm-abstraction` - `AgentProcessManager`, `CliDetectionService`

**External**:

- `vscode` (^1.96.0) - **Only imported in `ide-capabilities.vscode.ts`** (conditionally loaded via DI; not a hard dependency of the library core)
- `tsyringe` (^4.10.0) - Dependency injection
- `minimatch` (^10.0.1) - Glob pattern matching
- `json2md` - Markdown formatting for MCP responses

**Note**: The `vscode` dependency is isolated to a single file (`ide-capabilities.vscode.ts`) which is only instantiated when `IDE_CAPABILITIES_TOKEN` is registered in the DI container (VS Code host). All other files in the library are platform-agnostic, importing only from `@ptah-extension/*` libraries and Node.js built-ins.

## Import Path

```typescript
// Core services
import { CodeExecutionMCP, PtahAPIBuilder, IDE_CAPABILITIES_TOKEN, PermissionPromptService, registerVsCodeLmToolsServices } from '@ptah-extension/vscode-lm-tools';

// System prompt (static + platform-tailored)
import { PTAH_SYSTEM_PROMPT, PTAH_SYSTEM_PROMPT_TOKENS, buildPlatformSystemPrompt } from '@ptah-extension/vscode-lm-tools';

// IDE capabilities (VS Code platform registration)
import { VscodeIDECapabilities } from '@ptah-extension/vscode-lm-tools';

// Type imports
import type { PtahAPI, IIDECapabilities, ToolResultCallback } from '@ptah-extension/vscode-lm-tools';
```

## Commands

```bash
# Build library
nx build vscode-lm-tools

# Run tests
nx test vscode-lm-tools

# Type-check
nx run vscode-lm-tools:typecheck

# Lint
nx lint vscode-lm-tools
```

## Usage Examples

### Code Execution MCP Server

```typescript
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';

const mcpServer = container.resolve(CodeExecutionMCP);

// Execute code with Ptah API access
const result = await mcpServer.executeCode({
  code: `
    // Access Ptah API
    const info = await ptah.workspace.getInfo();
    console.log('Project type:', info.projectType);

    // Search files
    const files = await ptah.search.findFiles({
      query: 'authentication',
      maxResults: 10
    });

    return { info, fileCount: files.length };
  `,
  timeout: 5000, // 5 seconds
});

console.log(result);
// { info: { projectType: 'Node.js', ... }, fileCount: 5 }
```

### Ptah API Builder

```typescript
import { PtahAPIBuilder } from '@ptah-extension/vscode-lm-tools';

const ptahAPI = PtahAPIBuilder.build({
  workspaceAnalyzer: workspaceAnalyzerService,
  contextOrchestration: contextOrchestrationService,
  // ... other services
});

// Use API namespaces
const workspaceInfo = await ptahAPI.workspace.getInfo();
const searchResults = await ptahAPI.search.findFiles({ query: 'auth' });
const diagnostics = await ptahAPI.diagnostics.getProblems();
```

### Permission Prompt Service

```typescript
import { PermissionPromptService } from '@ptah-extension/vscode-lm-tools';

const permissionService = container.resolve(PermissionPromptService);

// Request permission for code execution
const allowed = await permissionService.requestPermission({
  tool: 'execute_code',
  operation: 'file_read',
  target: '/src/sensitive-file.ts',
  riskLevel: 'medium',
});

if (allowed) {
  // Execute operation
  const content = await ptahAPI.files.read('/src/sensitive-file.ts');
} else {
  throw new Error('Permission denied by user');
}
```

### System Prompt Usage

```typescript
import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';

// Use in VS Code Language Model API
const model = await vscode.lm.selectChatModels({
  family: 'claude',
})[0];

const response = await model.sendRequest([
  { role: 'system', content: PTAH_SYSTEM_PROMPT },
  { role: 'user', content: 'Analyze the workspace and find authentication code' },
]);
```

## Ptah API Namespaces

### ptah.workspace - Workspace Operations

```typescript
// Get workspace information
const info = await ptah.workspace.getInfo();
// { projectType: 'Node.js', frameworks: ['NestJS'], hasMonorepo: false }

// Analyze workspace structure
const analysis = await ptah.workspace.analyze();
// { directories: [...], files: [...], complexity: 'high' }

// Get project type
const projectType = await ptah.workspace.getProjectType();
// ProjectType.Node

// Get detected frameworks
const frameworks = await ptah.workspace.getFrameworks();
// ['NestJS', 'TypeORM', 'Jest']
```

### ptah.search - File Search & Relevance

```typescript
// Find files by query
const files = await ptah.search.findFiles({
  query: 'authentication service',
  maxResults: 20,
});
// [{ path: '/src/auth/auth.service.ts', score: 0.95 }, ...]

// Get relevant files for context
const relevantFiles = await ptah.search.getRelevantFiles({
  query: 'user authentication',
  maxResults: 10,
  includeContent: true,
});
// [{ path: '...', content: '...', relevance: 0.98 }, ...]

// Search by pattern
const configFiles = await ptah.search.findFiles({
  pattern: '**/*.config.ts',
  maxResults: 50,
});
```

### ptah.diagnostics - Problem Detection

```typescript
// Get workspace diagnostics
const diagnostics = await ptah.diagnostics.getProblems();
// [
//   { file: '/src/app.ts', line: 10, severity: 'error', message: '...' },
//   { file: '/src/user.ts', line: 5, severity: 'warning', message: '...' }
// ]

// Get diagnostics for specific file
const fileDiagnostics = await ptah.diagnostics.getProblems({
  file: '/src/app.ts',
});

// Get only errors
const errors = await ptah.diagnostics.getProblems({
  severity: 'error',
});
```

### ptah.files - File Operations

```typescript
// Read file content
const content = await ptah.files.read('/src/app.ts');
// "import { Module } from '@nestjs/common';\n..."

// Write file
await ptah.files.write('/src/new-file.ts', 'export const config = {...}');

// Check if file exists
const exists = await ptah.files.exists('/src/app.ts');
// true

// List directory contents
const files = await ptah.files.list('/src');
// ['app.ts', 'main.ts', 'auth/', 'user/']
```

## Guidelines

### Code Execution Security

1. **Always execute code in sandboxed environment**:

   ```typescript
   // ✅ CORRECT - Sandboxed execution
   const result = await mcpServer.executeCode({
     code: userCode,
     timeout: 5000,
   });

   // ❌ WRONG - Direct eval (unsafe)
   const result = eval(userCode);
   ```

2. **Set appropriate timeouts**:

   ```typescript
   // Quick operations: 5s
   await mcpServer.executeCode({ code, timeout: 5000 });

   // Workspace analysis: 15s
   await mcpServer.executeCode({ code, timeout: 15000 });

   // Complex operations: 30s (max)
   await mcpServer.executeCode({ code, timeout: 30000 });
   ```

3. **Handle execution errors gracefully**:
   ```typescript
   try {
     const result = await mcpServer.executeCode({ code, timeout });
   } catch (error) {
     if (error.code === 'TIMEOUT') {
       logger.error('Code execution timed out', { timeout });
     } else if (error.code === 'PERMISSION_DENIED') {
       logger.error('User denied permission', { operation });
     } else {
       logger.error('Code execution failed', { error });
     }
   }
   ```

### Permission Management

1. **Request permissions for sensitive operations**:

   ```typescript
   // File operations
   const allowed = await permissionService.requestPermission({
     tool: 'execute_code',
     operation: 'file_write',
     target: '/src/config.ts',
     riskLevel: 'high',
   });

   // File operations (medium risk)
   const allowed = await permissionService.requestPermission({
     tool: 'execute_code',
     operation: 'file_write',
     target: '/src/config.ts',
     riskLevel: 'medium',
   });
   ```

2. **Cache permissions for repeated operations**:

   ```typescript
   // Permission cached for 5 minutes
   const allowed1 = await permissionService.requestPermission({
     tool: 'execute_code',
     operation: 'file_read',
     target: '/src/app.ts',
   });

   // Uses cached permission (no prompt)
   const allowed2 = await permissionService.requestPermission({
     tool: 'execute_code',
     operation: 'file_read',
     target: '/src/app.ts',
   });
   ```

3. **Assess risk levels appropriately**:

   ```typescript
   // Low risk: Read-only operations
   riskLevel: 'low'; // workspace.getInfo(), search.findFiles()

   // Medium risk: File modifications
   riskLevel: 'medium'; // files.write()

   // High risk: Destructive operations
   riskLevel: 'high'; // files.delete()
   ```

### MCP Tool Integration

1. **Provide clear tool descriptions**:

   ```typescript
   {
     name: 'execute_code',
     description: 'Execute TypeScript/JavaScript code with access to Ptah extension APIs. Available namespaces: workspace, search, diagnostics, ai, files, context, project, relevance, ast, ide, llm, orchestration, agent, dependencies.',
     inputSchema: {
       type: 'object',
       properties: {
         code: {
           type: 'string',
           description: 'TypeScript/JavaScript code to execute. Has access to "ptah" global object.'
         },
         timeout: {
           type: 'number',
           description: 'Execution timeout in milliseconds (default: 5000, max: 30000)'
         }
       },
       required: ['code']
     }
   }
   ```

2. **Include usage examples in system prompt**:

   ```typescript
   // Example 1: Workspace analysis
   const info = await ptah.workspace.getInfo();
   console.log('Project:', info.projectType);

   // Example 2: File search
   const files = await ptah.search.findFiles({ query: 'auth' });
   console.log('Found:', files.length, 'files');
   ```

3. **Document API limitations**:

   ```typescript
   // ✅ Supported: Async operations
   const result = await ptah.workspace.getInfo();

   // ✅ Supported: Promise chains
   const files = await ptah.search.findFiles({ query: 'auth' });
   const content = await ptah.files.read(files[0].path);

   // ❌ Not supported: Long-running operations (> 30s)
   // ❌ Not supported: Blocking synchronous I/O
   ```

### API Builder Best Practices

1. **Inject all required services**:

   ```typescript
   const ptahAPI = PtahAPIBuilder.build({
     workspaceAnalyzer: container.resolve(WorkspaceAnalyzerService),
     contextOrchestration: container.resolve(ContextOrchestrationService),
     diagnosticProvider: container.resolve(DiagnosticProviderService),
     aiProvider: container.resolve(AIProviderService),
     fileSystem: container.resolve(FileSystemService),
     logger: container.resolve(Logger),
   });
   ```

2. **Handle API errors gracefully**:

   ```typescript
   try {
     const info = await ptahAPI.workspace.getInfo();
   } catch (error) {
     logger.error('Failed to get workspace info', { error });
     // Return default or throw user-friendly error
     return { projectType: 'Unknown', frameworks: [] };
   }
   ```

3. **Use correlation IDs for tracing**:

   ```typescript
   const correlationId = generateCorrelationId();

   const files = await ptahAPI.search.findFiles({
     requestId: correlationId,
     query: 'auth',
   });
   // All logs include correlationId for tracing
   ```

### Testing

1. **Mock Ptah API for tests**:

   ```typescript
   const mockPtahAPI: PtahAPI = {
     workspace: {
       getInfo: jest.fn().mockResolvedValue({
         projectType: 'Node.js',
         frameworks: ['NestJS'],
       }),
     },
     search: {
       findFiles: jest.fn().mockResolvedValue([{ path: '/src/app.ts', score: 0.95 }]),
     },
     // ... other namespaces
   };

   const mcpServer = new CodeExecutionMCP(mockPtahAPI, logger);
   ```

2. **Test code execution timeout**:

   ```typescript
   it('should timeout long-running code', async () => {
     const code = `
       await new Promise(resolve => setTimeout(resolve, 10000));
       return 'done';
     `;

     await expect(mcpServer.executeCode({ code, timeout: 1000 })).rejects.toThrow('TIMEOUT');
   });
   ```

3. **Test permission handling**:

   ```typescript
   it('should request permission for sensitive operations', async () => {
     const mockPermissionService = {
       requestPermission: jest.fn().mockResolvedValue(true),
     };

     const code = `await ptah.files.write('/src/new-file.ts', 'content')`;
     await mcpServer.executeCode({ code, timeout: 5000 });

     expect(mockPermissionService.requestPermission).toHaveBeenCalledWith({
       tool: 'execute_code',
       operation: 'file_write',
       target: '/src/new-file.ts',
     });
   });
   ```

## MCP Tool Description

### execute_code

**Name**: `execute_code`

**Description**: Execute TypeScript/JavaScript code with access to Ptah extension APIs. Available namespaces: workspace, search, diagnostics, ai, files, context, project, relevance, ast, ide, llm, orchestration, agent, dependencies.

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "TypeScript/JavaScript code to execute. Has access to \"ptah\" global object."
    },
    "timeout": {
      "type": "number",
      "description": "Execution timeout in milliseconds (default: 5000, max: 30000)"
    }
  },
  "required": ["code"]
}
```

**Example Usage**:

```typescript
// MCP tool invocation
{
  "tool": "execute_code",
  "arguments": {
    "code": "const info = await ptah.workspace.getInfo(); return info;",
    "timeout": 5000
  }
}
```

## Integration with Other Libraries

**Uses `@ptah-extension/workspace-intelligence`**:

- Workspace analysis for `ptah.workspace` namespace
- File search for `ptah.search` namespace
- Context orchestration for relevance ranking
- Tree-sitter parsing for `ptah.ast` namespace
- Context enrichment and dependency graph for `ptah.dependencies` namespace

**Uses `@ptah-extension/platform-core`**:

- `IDiagnosticsProvider` for `ptah.diagnostics` namespace
- `IWorkspaceProvider` for configuration access and workspace root
- `IFileSystemProvider` for platform-agnostic file system access
- `IStateStorage` for workspace state persistence

**Uses `@ptah-extension/vscode-core`**:

- Logger for structured logging
- FileSystemManager for `ptah.files` namespace
- WebviewManager (optional, type only) for approval prompt UI
- DI TOKENS for service registration

**Uses `@ptah-extension/llm-abstraction`**:

- AgentProcessManager for `ptah.agent` namespace
- CliDetectionService for agent and web search capabilities

**Consumed by `apps/ptah-extension-vscode`**:

- MCP server registration via `registerVsCodeLmToolsServices()`
- `VscodeIDECapabilities` registered under `IDE_CAPABILITIES_TOKEN`
- `PTAH_SYSTEM_PROMPT` / `buildPlatformSystemPrompt()` for AI agent context

**Consumed by `apps/ptah-electron`**:

- Same `registerVsCodeLmToolsServices()` registration (no shim needed)
- IDE capabilities token is NOT registered, so IDE namespace returns graceful stubs
- `buildPlatformSystemPrompt(false)` strips VS Code-only tool documentation

## Performance Characteristics

- **Code execution overhead**: ~10ms per execution
- **API namespace construction**: ~5ms (one-time)
- **Permission prompt**: 100ms-5s (user interaction)
- **Workspace analysis**: 50ms-500ms (depends on workspace size)
- **File search**: 10ms-200ms (depends on query complexity)

## Future Enhancements

- Multi-file code execution (import support)
- Persistent code execution context (session-based)
- Custom tool registration
- Advanced permission policies (workspace-level, session-level)
- Code execution telemetry and analytics
- Debugging support for executed code

## Testing

```bash
# Run tests
nx test vscode-lm-tools

# Run tests with coverage
nx test vscode-lm-tools --coverage

# Run specific test
nx test vscode-lm-tools --testFile=code-execution-mcp.service.spec.ts
```

## File Paths Reference

- **Entry Point**: `src/index.ts`
- **MCP Server**: `src/lib/code-execution/code-execution-mcp.service.ts`
- **API Builder**: `src/lib/code-execution/ptah-api-builder.service.ts`
- **System Prompt**: `src/lib/code-execution/ptah-system-prompt.constant.ts`
- **Permission**: `src/lib/permission/permission-prompt.service.ts`
- **Types**: `src/lib/code-execution/types.ts`
- **DI Registration**: `src/lib/di/register.ts`
- **IDE Capabilities (VS Code)**: `src/lib/code-execution/namespace-builders/ide-capabilities.vscode.ts`
- **IDE Namespace Builder**: `src/lib/code-execution/namespace-builders/ide-namespace.builder.ts`
- **Core Namespaces**: `src/lib/code-execution/namespace-builders/core-namespace.builders.ts`
- **HTTP Server Handler**: `src/lib/code-execution/mcp-handlers/http-server.handler.ts`
- **Protocol Handlers**: `src/lib/code-execution/mcp-handlers/protocol-handlers.ts`
- **Approval Prompt**: `src/lib/code-execution/mcp-handlers/approval-prompt.handler.ts`
- **Tool Descriptions**: `src/lib/code-execution/mcp-handlers/tool-description.builder.ts`
- **Code Execution Engine**: `src/lib/code-execution/mcp-handlers/code-execution.engine.ts`
- **MCP Response Formatter**: `src/lib/code-execution/mcp-handlers/mcp-response-formatter.ts`
- **Analysis Namespaces**: `src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`
- **AST Namespace**: `src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`
- **System Namespaces**: `src/lib/code-execution/namespace-builders/system-namespace.builders.ts`
- **Orchestration Namespace**: `src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts`
- **Agent Namespace**: `src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
- **Git Namespace**: `src/lib/code-execution/namespace-builders/git-namespace.builder.ts`
- **JSON Namespace**: `src/lib/code-execution/namespace-builders/json-namespace.builder.ts`
- **Web Search Service**: `src/lib/code-execution/services/web-search.service.ts`
