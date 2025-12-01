/**
 * MCP Tool Description Builder
 *
 * Generates comprehensive tool descriptions for the MCP protocol.
 * These descriptions help Claude understand all available capabilities.
 */

import { MCPToolDefinition } from '../types';

/**
 * Build the execute_code tool definition
 */
export function buildExecuteCodeTool(): MCPToolDefinition {
  return {
    name: 'execute_code',
    description: buildExecuteCodeDescription(),
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'TypeScript/JavaScript code to execute. Has access to "ptah" global object with 12 namespaces. ' +
            'All methods are async. Code is auto-wrapped for execution - all patterns work:\n' +
            '• Simple: `await ptah.workspace.getInfo()` or `ptah.workspace.getInfo()`\n' +
            '• With variables: `const info = await ptah.workspace.getInfo(); return info;`\n' +
            '• IIFE (any style): `(async () => { return await ptah.git.getStatus(); })()`\n' +
            '• Direct return: `return "hello"`\n' +
            'Results are automatically extracted from Promises. No special syntax required.',
        },
        timeout: {
          type: 'number',
          description:
            'Execution timeout in milliseconds (default: 5000, max: 30000)',
          default: 5000,
        },
      },
      required: ['code'],
    },
  };
}

/**
 * Build the approval_prompt tool definition
 */
export function buildApprovalPromptTool(): MCPToolDefinition {
  return {
    name: 'approval_prompt',
    description:
      'Request user permission to execute a tool via VS Code dialog. ' +
      'Called by Claude CLI when permission is needed for tool execution. ' +
      'Returns approval decision with optional updated input parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'Name of the tool requesting permission',
        },
        input: {
          type: 'object',
          description: 'Input parameters for the tool',
        },
        tool_use_id: {
          type: 'string',
          description: 'Unique tool use request ID',
        },
      },
      required: ['tool_name', 'input'],
    },
  };
}

/**
 * Build comprehensive execute_code tool description with full API reference
 */
function buildExecuteCodeDescription(): string {
  return `Execute TypeScript/JavaScript code with access to VS Code extension APIs via the global "ptah" object.

## Available Namespaces (12 total)

### ptah.workspace - Workspace Analysis
- analyze(): Promise<{info, structure}> - Full workspace analysis
- getInfo(): Promise<WorkspaceInfo> - Project metadata
- getProjectType(): Promise<string> - Detected type (React, Angular, Node, etc.)
- getFrameworks(): Promise<string[]> - Detected frameworks

### ptah.search - File Discovery
- findFiles(pattern: string, limit?: number): Promise<FileInfo[]> - Glob pattern search
- getRelevantFiles(query: string, maxFiles?: number): Promise<FileInfo[]> - Semantic file search

### ptah.symbols - Code Symbol Search
- find(name: string, type?: string): Promise<SymbolInfo[]> - Find symbols (class, function, method, interface, variable)

### ptah.diagnostics - Errors & Warnings
- getErrors(): Promise<DiagnosticInfo[]> - All error-level diagnostics
- getWarnings(): Promise<DiagnosticInfo[]> - All warning-level diagnostics
- getAll(): Promise<DiagnosticInfo[]> - All diagnostics with severity

### ptah.git - Repository Status
- getStatus(): Promise<{branch, modified, staged, untracked}> - Git working tree status

### ptah.ai - VS Code Language Model API
- chat(message: string, model?: string): Promise<string> - Send message to VS Code LM
- selectModel(family?: string): Promise<ModelInfo[]> - List available models

### ptah.files - File Operations
- read(path: string): Promise<string> - Read file contents as UTF-8
- list(directory: string): Promise<{name, type}[]> - List directory contents

### ptah.commands - VS Code Commands
- execute(commandId: string, ...args): Promise<any> - Execute VS Code command
- list(): Promise<string[]> - List ptah.* commands

### ptah.context - Token Budget Management
- optimize(query: string, maxTokens?: number): Promise<OptimizedContext> - Select files within token budget
- countTokens(text: string): Promise<number> - Count tokens in text
- getRecommendedBudget(projectType): number - Get recommended budget for project type

### ptah.project - Project Analysis
- detectMonorepo(): Promise<{isMonorepo, type, workspaceFiles, packageCount}> - Detect monorepo tool
- detectType(): Promise<string> - Detect project type
- analyzeDependencies(): Promise<{name, version, isDev}[]> - Analyze package dependencies

### ptah.relevance - File Ranking
- scoreFile(filePath: string, query: string): Promise<{file, score, reasons}> - Score single file relevance
- rankFiles(query: string, limit?: number): Promise<{file, score, reasons}[]> - Rank files by relevance

### ptah.ast - Code Structure Analysis (tree-sitter)
- analyze(filePath: string): Promise<CodeInsights> - Extract functions, classes, imports, exports from file
- parse(filePath: string, maxDepth?: number): Promise<AstParseResult> - Get full AST structure
- queryFunctions(filePath: string): Promise<FunctionInfo[]> - List all functions/methods
- queryClasses(filePath: string): Promise<ClassInfo[]> - List all classes
- queryImports(filePath: string): Promise<ImportInfo[]> - List all imports
- queryExports(filePath: string): Promise<ExportInfo[]> - List all exports
- getSupportedLanguages(): string[] - Returns ['javascript', 'typescript']

## Usage Examples

\`\`\`typescript
// Get workspace overview
const {info, structure} = await ptah.workspace.analyze();
return {projectType: info.projectType, frameworks: info.frameworks};

// Find authentication-related files with relevance scores
const files = await ptah.relevance.rankFiles('authentication handler', 10);
return files.map(f => ({file: f.file, score: f.score, why: f.reasons}));

// Optimize context for a task within token budget
const optimized = await ptah.context.optimize('implement user auth', 100000);
return {selected: optimized.selectedFiles.length, tokens: optimized.totalTokens};

// Check for TypeScript errors
const errors = await ptah.diagnostics.getErrors();
return errors.filter(e => e.file.endsWith('.ts'));

// Detect monorepo structure
const mono = await ptah.project.detectMonorepo();
if (mono.isMonorepo) return {type: mono.type, packages: mono.packageCount};

// Analyze code structure (AST) - get all functions in a file
const insights = await ptah.ast.analyze('src/services/auth.service.ts');
return {
  functions: insights.functions.map(f => f.name),
  classes: insights.classes.map(c => c.name),
  imports: insights.imports.length
};

// Query specific code elements
const functions = await ptah.ast.queryFunctions('src/app.ts');
return functions.map(f => ({name: f.name, params: f.parameters, line: f.startLine}));

// Get imports from a file
const imports = await ptah.ast.queryImports('src/index.ts');
return imports.map(i => ({from: i.source, symbols: i.importedSymbols}));
\`\`\``;
}
