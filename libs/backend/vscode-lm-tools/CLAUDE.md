# libs/backend/vscode-lm-tools - VS Code Language Model Tools & MCP Server

[Back to Main](../../../CLAUDE.md)

## Purpose

The **vscode-lm-tools library** provides a Code Execution MCP (Model Context Protocol) server for Ptah API integration. It enables VS Code Language Models and Claude CLI to execute TypeScript/JavaScript code with access to Ptah extension APIs (workspace analysis, search, symbols, diagnostics, git, AI, files, commands). This library powers the `execute_code` MCP tool and system prompt generation.

## Boundaries

**Belongs here**:

- Code Execution MCP server implementation
- Ptah API builder (namespace construction)
- System prompt generation for MCP tools
- Permission prompt services for tool execution
- VS Code Language Model API integration
- Secure code execution sandboxing

**Does NOT belong**:

- Business logic for specific features (belongs in domain libraries)
- Workspace analysis implementation (belongs in `workspace-intelligence`)
- VS Code API wrappers (belongs in `vscode-core`)
- Agent generation logic (belongs in `agent-generation`)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│     VS Code Language Model Tools & MCP Layer          │
├──────────────────────────────────────────────────────┤
│  CodeExecutionMCP (MCP Server)                       │
│  ├─ execute_code tool implementation                 │
│  ├─ Sandboxed code execution                         │
│  ├─ Timeout management (5s-30s)                      │
│  └─ Error handling & result serialization            │
├──────────────────────────────────────────────────────┤
│  PtahAPIBuilder (API Namespace Constructor)          │
│  ├─ ptah.workspace   - Workspace operations          │
│  ├─ ptah.search      - File search & relevance       │
│  ├─ ptah.symbols     - Code symbol extraction        │
│  ├─ ptah.diagnostics - Problem detection             │
│  ├─ ptah.git         - Git operations                │
│  ├─ ptah.ai          - AI provider integration       │
│  ├─ ptah.files       - File operations               │
│  └─ ptah.commands    - VS Code command execution     │
├──────────────────────────────────────────────────────┤
│  Permission Management                               │
│  └─ PermissionPromptService                          │
│     ├─ User consent prompts                          │
│     ├─ Permission caching                            │
│     └─ Risk assessment                               │
├──────────────────────────────────────────────────────┤
│  System Prompt Generation                            │
│  └─ PTAH_SYSTEM_PROMPT                               │
│     ├─ Tool descriptions                             │
│     ├─ API documentation                             │
│     └─ Usage examples                                │
└──────────────────────────────────────────────────────┘
```

## Key Files

### MCP Server

- `code-execution/code-execution-mcp.service.ts` - MCP server implementation with execute_code tool

### API Builder

- `code-execution/ptah-api-builder.service.ts` - Constructs Ptah API namespaces for code execution
- `code-execution/types.ts` - PtahAPI type definitions

### System Prompt

- `code-execution/ptah-system-prompt.constant.ts` - System prompt for MCP tool usage

### Permission Management

- `permission/permission-prompt.service.ts` - User permission prompts for tool execution

## Dependencies

**Internal**:

- `@ptah-extension/shared` - Type definitions (Result, CorrelationId)
- `@ptah-extension/vscode-core` - Logger, CommandManager, FileSystemManager
- `@ptah-extension/workspace-intelligence` - Workspace analysis, context orchestration

**External**:

- `vscode` (^1.96.0) - VS Code Extension API, Language Model API
- `tsyringe` (^4.10.0) - Dependency injection
- `eventemitter3` (^5.0.1) - Event emitters
- `rxjs` (^7.8.1) - Reactive programming
- `minimatch` (^10.0.1) - Glob pattern matching

## Import Path

```typescript
import { CodeExecutionMCP, PtahAPIBuilder, PermissionPromptService, PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';

// Type imports
import type { PtahAPI } from '@ptah-extension/vscode-lm-tools';
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
const symbols = await ptahAPI.symbols.extract('/src/app.ts');
const diagnostics = await ptahAPI.diagnostics.getProblems();
const gitStatus = await ptahAPI.git.getStatus();
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

### ptah.symbols - Code Symbol Extraction

```typescript
// Extract symbols from file
const symbols = await ptah.symbols.extract('/src/app.ts');
// [
//   { name: 'AppController', kind: 'class', range: {...} },
//   { name: 'getHello', kind: 'method', range: {...} }
// ]

// Find symbol definitions
const definitions = await ptah.symbols.findDefinitions('UserService');
// [{ path: '/src/user/user.service.ts', line: 10, column: 14 }]

// Get symbol references
const references = await ptah.symbols.findReferences('UserRepository');
// [{ path: '/src/user/user.module.ts', line: 5 }, ...]
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

### ptah.git - Git Operations

```typescript
// Get git status
const status = await ptah.git.getStatus();
// {
//   branch: 'feature/authentication',
//   modified: ['src/auth/auth.service.ts'],
//   added: ['src/auth/auth.guard.ts'],
//   deleted: [],
//   untracked: ['src/auth/auth.dto.ts']
// }

// Get commit history
const commits = await ptah.git.getHistory({ maxCount: 10 });
// [{ hash: 'abc123', message: 'Add auth', author: '...', date: ... }, ...]

// Get file diff
const diff = await ptah.git.getDiff({ file: '/src/app.ts' });
// '+import { AuthModule } from "./auth/auth.module";\n...'
```

### ptah.ai - AI Provider Integration

```typescript
// Generate content with AI
const response = await ptah.ai.generate({
  prompt: 'Explain this code',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
});
// { content: 'This code implements...', tokens: 150 }

// Stream AI responses
await ptah.ai.generateStream({
  prompt: 'Write a tutorial',
  model: 'claude-3-5-sonnet-20241022',
  onChunk: (chunk) => {
    console.log(chunk.content);
  },
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

### ptah.commands - VS Code Command Execution

```typescript
// Execute VS Code command
await ptah.commands.execute('workbench.action.files.save');

// Execute with arguments
await ptah.commands.execute('editor.action.formatDocument', {
  uri: vscode.Uri.file('/src/app.ts'),
});

// Get available commands
const commands = await ptah.commands.list();
// ['workbench.action.files.save', 'editor.action.formatDocument', ...]
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

   // Git operations
   const allowed = await permissionService.requestPermission({
     tool: 'execute_code',
     operation: 'git_commit',
     target: 'workspace',
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
   riskLevel: 'medium'; // files.write(), git.commit()

   // High risk: Destructive operations
   riskLevel: 'high'; // files.delete(), git.reset()
   ```

### MCP Tool Integration

1. **Provide clear tool descriptions**:

   ```typescript
   {
     name: 'execute_code',
     description: 'Execute TypeScript/JavaScript code with access to Ptah extension APIs. Available namespaces: workspace, search, symbols, diagnostics, git, ai, files, commands.',
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

   // Example 3: Symbol extraction
   const symbols = await ptah.symbols.extract('/src/app.ts');
   console.log(
     'Symbols:',
     symbols.map((s) => s.name)
   );
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
     symbolExtractor: container.resolve(SymbolExtractorService),
     diagnosticProvider: container.resolve(DiagnosticProviderService),
     gitService: container.resolve(GitService),
     aiProvider: container.resolve(AIProviderService),
     fileSystem: container.resolve(FileSystemService),
     commandManager: container.resolve(CommandManager),
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

**Description**: Execute TypeScript/JavaScript code with access to Ptah extension APIs. Available namespaces: workspace, search, symbols, diagnostics, git, ai, files, commands.

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

**Uses `@ptah-extension/vscode-core`**:

- Logger for structured logging
- CommandManager for `ptah.commands` namespace
- FileSystemManager for `ptah.files` namespace

**Consumed by `apps/ptah-extension-vscode`**:

- MCP server registration
- Permission prompt integration
- System prompt for VS Code Language Model API

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

- **MCP Server**: `src/lib/code-execution/code-execution-mcp.service.ts`
- **API Builder**: `src/lib/code-execution/ptah-api-builder.service.ts`
- **System Prompt**: `src/lib/code-execution/ptah-system-prompt.constant.ts`
- **Permission**: `src/lib/permission/permission-prompt.service.ts`
- **Types**: `src/lib/code-execution/types.ts`
- **Entry Point**: `src/index.ts`
