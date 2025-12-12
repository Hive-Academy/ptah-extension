---
trigger: glob
globs: libs/backend/vscode-lm-tools/**/*.ts
---

# vscode-lm - Code Execution MCP Server & VS Code LM API

**Active**: Working in `libs/backend/vscode-lm-tools/**/*.ts`

## Purpose

The **vscode-lm-tools library** provides a Code Execution MCP server for Ptah API integration. It enables VS Code LM and Claude CLI to execute TypeScript/JavaScript code with access to Ptah extension APIs (`workspace`, `search`, `symbols`, `diagnostics`, `git`, `ai`, `files`, `commands`) via the `execute_code` tool in a sandboxed environment.

## Responsibilities

✅ **MCP Server**: `execute_code` tool implementation  
✅ **API Builder**: 8 Ptah API namespaces construction  
✅ **Sandboxed Execution**: Timeout management (5s-30s)  
✅ **Permission Management**: User consent prompts  
✅ **System Prompt Generation**: Tool descriptions for LM

❌ **NOT**: Workspace analysis (→ workspace-intelligence), Domain logic (→ claude-domain)

## Services

```
libs/backend/vscode-lm-tools/src/lib/
├── code-execution/
│   ├── code-execution-mcp.service.ts
│   ├── ptah-api-builder.service.ts
│   ├── types.ts
│   └── ptah-system-prompt.constant.ts
└── permission/
    └── permission-prompt.service.ts
```

## CodeExecutionMCP

### Sandboxed Execution

```typescript
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';

const mcpServer = container.resolve(CodeExecutionMCP);

const result = await mcpServer.executeCode({
  code: `
    const info = await ptah.workspace.getInfo();
    const files = await ptah.search.findFiles({ query: 'auth' });
    return { projectType: info.projectType, fileCount: files.length };
  `,
  timeout: 5000,
});
// { projectType: 'Node.js', fileCount: 5 }
```

**Timeouts**: 5s (read), 15s (analysis), 30s (AI, max)

### Error Handling

```typescript
try {
  await mcpServer.executeCode({ code, timeout: 5000 });
} catch (error) {
  if (error.code === 'TIMEOUT') {
    logger.error('Execution timed out');
  } else if (error.code === 'PERMISSION_DENIED') {
    logger.error('User denied permission');
  } else if (error.code === 'EXECUTION_ERROR') {
    logger.error('Code failed', { error: error.message });
  }
}
```

## PtahAPIBuilder

### Building API Namespaces

```typescript
import { PtahAPIBuilder } from '@ptah-extension/vscode-lm-tools';

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

### API Namespaces

**ptah.workspace**

```typescript
const info = await ptah.workspace.getInfo();
// { projectType: 'Node.js', frameworks: ['NestJS'] }

const projectType = await ptah.workspace.getProjectType();
// ProjectType.Node
```

**ptah.search**

```typescript
const files = await ptah.search.findFiles({
  query: 'authentication service',
  maxResults: 20,
});
// [{ path: '/src/auth.ts', score: 0.95 }]

const configFiles = await ptah.search.findFiles({
  pattern: '**/*.config.ts',
});
```

**ptah.symbols**

```typescript
const symbols = await ptah.symbols.extract('/src/app.ts');
// [{ name: 'AppController', kind: 'class', range: {...} }]

const definitions = await ptah.symbols.findDefinitions('UserService');
// [{ path: '/src/user.service.ts', line: 10 }]
```

**ptah.diagnostics**

```typescript
const diagnostics = await ptah.diagnostics.getProblems();
// [{ file: '/src/app.ts', severity: 'error', message: '...' }]

const errors = await ptah.diagnostics.getProblems({ severity: 'error' });
```

**ptah.git**

```typescript
const status = await ptah.git.getStatus();
// { branch: 'main', modified: ['src/app.ts'] }

const commits = await ptah.git.getHistory({ maxCount: 10 });
const diff = await ptah.git.getDiff({ file: '/src/app.ts' });
```

**ptah.ai**

```typescript
const response = await ptah.ai.generate({
  prompt: 'Explain this code',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
});
// { content: 'This code implements...', tokens: 150 }

await ptah.ai.generateStream({
  prompt: 'Write tutorial',
  onChunk: (chunk) => console.log(chunk.content),
});
```

**ptah.files**

```typescript
const content = await ptah.files.read('/src/app.ts');
await ptah.files.write('/src/new.ts', 'export const x = 1');
const exists = await ptah.files.exists('/src/app.ts');
const files = await ptah.files.list('/src');
```

**ptah.commands**

```typescript
await ptah.commands.execute('workbench.action.files.save');
await ptah.commands.execute('editor.action.formatDocument', { uri });
const commands = await ptah.commands.list();
```

## Permission Management

```typescript
import { PermissionPromptService } from '@ptah-extension/vscode-lm-tools';

const permissionService = container.resolve(PermissionPromptService);

// Low risk: Read-only
const allowed = await permissionService.requestPermission({
  tool: 'execute_code',
  operation: 'file_read',
  target: '/src/app.ts',
  riskLevel: 'low',
});

// Medium risk: File write
const allowed = await permissionService.requestPermission({
  tool: 'execute_code',
  operation: 'file_write',
  target: '/src/config.ts',
  riskLevel: 'medium',
});

// High risk: Delete
const allowed = await permissionService.requestPermission({
  tool: 'execute_code',
  operation: 'file_delete',
  target: '/src/old.ts',
  riskLevel: 'high',
});
```

**Permission Caching**: Permissions cached for 5 minutes. Second call uses cache (no prompt).

## System Prompt

```typescript
import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';

const model = await vscode.lm.selectChatModels({ family: 'claude' })[0];

const response = await model.sendRequest([
  { role: 'system', content: PTAH_SYSTEM_PROMPT },
  { role: 'user', content: 'Analyze workspace' },
]);
```

Includes: Tool description, 8 namespace docs, usage examples, timeout guidelines, error patterns.

## Testing

```typescript
describe('CodeExecutionMCP', () => {
  let mcpServer: CodeExecutionMCP;
  let mockPtahAPI: PtahAPI;

  beforeEach(() => {
    mockPtahAPI = {
      workspace: {
        getInfo: jest.fn().mockResolvedValue({
          projectType: 'Node.js',
          frameworks: ['NestJS'],
        }),
      },
      search: {
        findFiles: jest.fn().mockResolvedValue([{ path: '/src/app.ts', score: 0.95 }]),
      },
    };
    mcpServer = new CodeExecutionMCP(mockPtahAPI, logger);
  });

  it('should execute code with Ptah API', async () => {
    const result = await mcpServer.executeCode({
      code: 'const info = await ptah.workspace.getInfo(); return info;',
      timeout: 5000,
    });
    expect(result).toEqual({ projectType: 'Node.js', frameworks: ['NestJS'] });
  });

  it('should timeout long code', async () => {
    const code = 'await new Promise(r => setTimeout(r, 10000))';
    await expect(mcpServer.executeCode({ code, timeout: 1000 })).rejects.toThrow('TIMEOUT');
  });

  it('should handle permission denial', async () => {
    mockPermissionService.requestPermission.mockResolvedValue(false);
    const code = 'await ptah.files.write("/src/x.ts", "content")';
    await expect(mcpServer.executeCode({ code, timeout: 5000 })).rejects.toThrow('PERMISSION_DENIED');
  });
});
```

## Rules

1. **Sandboxed Only** - Never use `eval()` or `Function()` directly. Always sandbox with timeout.

2. **Timeout Best Practices** - 5s (read), 15s (analysis), 30s (AI, max). No exceptions.

3. **Permission Required** - Write, delete, git commit, commands MUST request permission.

4. **Correlation IDs** - All API calls MUST include correlation IDs for tracing.

5. **Error Context** - Propagate full context (operation, target, timeout) in errors.

6. **API Injection** - PtahAPIBuilder receives services via constructor. Never instantiate inside.

7. **No Long Operations** - 30s hard limit. Break complex tasks into multiple calls.

8. **JSON Serializable** - Results MUST be JSON-serializable. No circular references.

## Commands

```bash
nx build vscode-lm-tools
nx test vscode-lm-tools
nx run vscode-lm-tools:typecheck
nx lint vscode-lm-tools
```
