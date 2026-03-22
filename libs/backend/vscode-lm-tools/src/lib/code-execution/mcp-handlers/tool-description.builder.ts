/**
 * MCP Tool Description Builder
 *
 * Generates comprehensive tool descriptions for the MCP protocol.
 * These descriptions help Claude understand all available capabilities.
 */

import { MCPToolDefinition } from '../types';
import { PTAH_SYSTEM_PROMPT } from '../ptah-system-prompt.constant';

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
            '• IIFE (any style): `(async () => { return await ptah.workspace.getInfo(); })()`\n' +
            '• Direct return: `return "hello"`\n' +
            'Results are automatically extracted from Promises. No special syntax required.',
        },
        timeout: {
          type: 'number',
          description:
            'Execution timeout in milliseconds (default: 15000, max: 30000)',
          default: 15000,
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

// ========================================
// Individual First-Class MCP Tools
// ========================================

/**
 * Build the ptah_workspace_analyze tool definition
 * One-call project understanding — replaces manual exploration
 */
export function buildWorkspaceAnalyzeTool(): MCPToolDefinition {
  return {
    name: 'ptah_workspace_analyze',
    description:
      'Analyze the entire workspace in one call. Returns project type, frameworks, directory structure, and architecture overview. Use this FIRST when starting any task to understand the project.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_search_files tool definition
 * .gitignore-aware, workspace-indexed file discovery
 */
export function buildSearchFilesTool(): MCPToolDefinition {
  return {
    name: 'ptah_search_files',
    description:
      'Find files in the workspace by glob pattern. Respects .gitignore and is workspace-indexed. Faster and more accurate than Glob/find for file discovery.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Glob pattern (e.g., "**/*.ts", "src/**/auth*", "*.spec.ts")',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 50)',
        },
      },
      required: ['pattern'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_get_diagnostics tool definition
 * Live TypeScript errors without compiling
 */
export function buildGetDiagnosticsTool(): MCPToolDefinition {
  return {
    name: 'ptah_get_diagnostics',
    description:
      'Get all TypeScript/JavaScript errors and warnings from VS Code diagnostics. Returns live results from the language server — no need to run a build command. Each diagnostic includes file path, line number, severity, and message.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['error', 'warning', 'all'],
          description:
            'Filter by severity level (default: "all"). Use "error" to see only errors.',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_lsp_references tool definition
 * LSP-accurate cross-file reference finding
 */
export function buildLspReferencesTool(): MCPToolDefinition {
  return {
    name: 'ptah_lsp_references',
    description:
      'Find all references to a symbol at a specific file position using VS Code LSP. More accurate than Grep for finding usages — handles renames, re-exports, and type references. Essential before refactoring.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (absolute or relative to workspace root)',
        },
        line: {
          type: 'number',
          description: 'Line number (0-indexed)',
        },
        col: {
          type: 'number',
          description: 'Column number (0-indexed)',
        },
      },
      required: ['file', 'line', 'col'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_lsp_definitions tool definition
 * Go-to-definition via LSP
 */
export function buildLspDefinitionsTool(): MCPToolDefinition {
  return {
    name: 'ptah_lsp_definitions',
    description:
      'Go to definition for a symbol at a specific file position using VS Code LSP. Returns the source location where the symbol is defined. Works across files, through re-exports, and into node_modules.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (absolute or relative to workspace root)',
        },
        line: {
          type: 'number',
          description: 'Line number (0-indexed)',
        },
        col: {
          type: 'number',
          description: 'Column number (0-indexed)',
        },
      },
      required: ['file', 'line', 'col'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_get_dirty_files tool definition
 * Unsaved VS Code buffers
 */
export function buildGetDirtyFilesTool(): MCPToolDefinition {
  return {
    name: 'ptah_get_dirty_files',
    description:
      'Get all files with unsaved changes in VS Code. Unlike "git status", this shows files that have been modified in the editor but not yet saved to disk.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_count_tokens tool definition
 * Token count for files
 */
export function buildCountTokensTool(): MCPToolDefinition {
  return {
    name: 'ptah_count_tokens',
    description:
      'Count tokens in a file using the model-specific tokenizer. Use this instead of reading a file just to check its size. Returns the token count, which is more useful than byte count for context window planning.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (absolute or relative to workspace root)',
        },
      },
      required: ['file'],
    },
    annotations: { readOnlyHint: true },
  };
}

// ========================================
// Agent Orchestration MCP Tools (TASK_2025_157)
// ========================================

/**
 * Build the ptah_agent_spawn tool definition
 * Spawn a CLI agent to work on a task in the background
 */
export function buildAgentSpawnTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_spawn',
    description:
      'Spawn a headless agent to work on a task in the background. ' +
      'Supports CLI agents (Gemini, Codex, Copilot) and Ptah CLI agents (OpenRouter, Moonshot, Z.AI). ' +
      'The agent runs while you continue working. ' +
      'Use ptah_agent_status to check progress and ptah_agent_read to get output. ' +
      'For Ptah CLI agents, pass ptahCliId (from ptah_agent_list). ' +
      'To resume a previous CLI session, pass resume_session_id with the CLI session ID. ' +
      'Ideal for delegating: code reviews, test generation, documentation, ' +
      'and other independent subtasks.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Task description for the agent. Be specific about what to do, ' +
            'which files to focus on, and what output to produce.',
        },
        cli: {
          type: 'string',
          enum: ['gemini', 'codex', 'copilot'],
          description:
            'Which CLI agent to use. Each requires its CLI installed on PATH. ' +
            'Omit to use the default (auto-detected or user-configured). ' +
            'Not needed when using ptahCliId.',
        },
        ptahCliId: {
          type: 'string',
          description:
            'ID of a Ptah CLI agent to use (from ptah_agent_list results where cli="ptah-cli"). ' +
            'Ptah CLI agents are user-configured Anthropic-compatible providers ' +
            '(OpenRouter, Moonshot, Z.AI, etc.). When set, cli parameter is ignored.',
        },
        workingDirectory: {
          type: 'string',
          description:
            'Working directory for the agent (must be within workspace). Defaults to workspace root.',
        },
        timeout: {
          type: 'number',
          description:
            'Timeout in milliseconds (default: 3600000 = 1hr, max: 3600000 = 1hr)',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files the agent should focus on',
        },
        taskFolder: {
          type: 'string',
          description:
            'Task-tracking folder for shared workspace (e.g., ".claude/specs/TASK_2025_157"). ' +
            'Agent will write deliverables here.',
        },
        model: {
          type: 'string',
          description:
            'Model override for the CLI agent (e.g., "gemini-2.5-pro" for Gemini, "claude-sonnet-4.6" for Copilot). ' +
            'Uses user-configured default if omitted.',
        },
        resume_session_id: {
          type: 'string',
          description:
            'Resume a previous CLI agent session by its CLI-native session ID. ' +
            'For Gemini, this is the UUID from the init event. ' +
            'The agent will continue from where the previous session left off.',
        },
      },
      required: ['task'],
    },
  };
}

/**
 * Build the ptah_agent_status tool definition
 * Check status of one or all agents
 */
export function buildAgentStatusTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_status',
    description:
      'Check the status of a specific agent or all agents. ' +
      'Returns agentId, status (running/completed/failed/timeout/stopped), ' +
      'cli, task, startedAt, duration, and exitCode.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to check. Omit to get status of ALL agents.',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_agent_read tool definition
 * Read agent output
 */
export function buildAgentReadTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_read',
    description:
      'Read the stdout/stderr output from an agent. ' +
      'For running agents, returns output captured so far. ' +
      'Use tail parameter to get only the last N lines.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to read output from',
        },
        tail: {
          type: 'number',
          description: 'Only return the last N lines of output',
        },
      },
      required: ['agentId'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_agent_steer tool definition
 * Send instruction to agent stdin
 */
export function buildAgentSteerTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_steer',
    description:
      'Send a steering instruction to a running agent via stdin. ' +
      'Only works if the CLI supports interactive input. ' +
      'Returns error if steering is not supported for the CLI type.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to steer',
        },
        instruction: {
          type: 'string',
          description: 'Instruction text to send to agent stdin',
        },
      },
      required: ['agentId', 'instruction'],
    },
  };
}

/**
 * Build the ptah_agent_list tool definition
 * List all available agents (CLI and custom)
 */
export function buildAgentListTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_list',
    description:
      'List all available agents (CLI and Ptah CLI) that can be spawned. ' +
      'Returns agent type, installation status, and capabilities. ' +
      'Ptah CLI agents include ptahCliId needed for ptah_agent_spawn.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_agent_stop tool definition
 * Stop a running agent
 */
export function buildAgentStopTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_stop',
    description:
      'Stop a running agent. Sends SIGTERM, waits 5 seconds, then SIGKILL. ' +
      'If agent is already completed, returns its final status without error.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to stop',
        },
      },
      required: ['agentId'],
    },
  };
}

// ========================================
// Web Search MCP Tool (TASK_2025_189)
// ========================================

/**
 * Build the ptah_web_search tool definition
 * Web search via LLM providers with fallback chain
 */
export function buildWebSearchTool(): MCPToolDefinition {
  return {
    name: 'ptah_web_search',
    description:
      'Search the web for information using Gemini CLI (native google_web_search). ' +
      'Returns a narrative summary of search results. ' +
      'Requires Gemini CLI installed on PATH. ' +
      'Use this when you need current information from the internet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific for better results.',
        },
        timeout: {
          type: 'number',
          description:
            'Search timeout in milliseconds (default: 30000, max: 60000)',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  };
}

/**
 * Build comprehensive execute_code tool description with full API reference.
 * Uses progressive disclosure: top namespaces inline, rest via ptah.help().
 */
function buildExecuteCodeDescription(): string {
  return `IDE access tool — execute TypeScript/JavaScript code with access to VS Code APIs via the global "ptah" object. Use this for code structure analysis (AST), dependency graphs, LSP operations, and multi-step API workflows.

${PTAH_SYSTEM_PROMPT}

## Top Namespaces (13 total — use ptah.help(topic) for full details)

### ptah.workspace - Workspace Analysis
- analyze(): Promise<{info, structure}> - Full workspace analysis
- getInfo(): Promise<WorkspaceInfo> - Project metadata
- getProjectType(): Promise<string> - Detected type (React, Angular, Node, etc.)
- getFrameworks(): Promise<string[]> - Detected frameworks

### ptah.search - File Discovery
- findFiles(pattern: string, limit?: number): Promise<string[]> - Glob pattern search (returns file paths)
- getRelevantFiles(query: string, maxFiles?: number): Promise<string[]> - Semantic file search (returns file paths)

### ptah.diagnostics - Errors & Warnings
- getErrors(): Promise<{file, message, line}[]> - All error-level diagnostics
- getWarnings(): Promise<{file, message, line}[]> - All warning-level diagnostics
- getAll(): Promise<{file, message, line, severity}[]> - All diagnostics with severity

### ptah.ide - VS Code IDE Superpowers (exclusive to VS Code)
- ide.lsp.getDefinition(file, line, col) - Go to definition
- ide.lsp.getReferences(file, line, col) - Find all references
- ide.lsp.getHover(file, line, col) - Get type info and docs
- ide.editor.getActive() - Active file, cursor, selection
- ide.editor.getOpenFiles() - All open file paths
- ide.actions.rename(file, line, col, newName) - Rename symbol workspace-wide
- ide.actions.organizeImports(file) - Clean imports
- ide.testing.run(options?) - Run tests

### ptah.files - File Operations (READ-ONLY)
- read(path: string): Promise<string> - Read file (path can be relative like 'package.json' or absolute)
- readJson(path: string): Promise<any> - Read and parse JSON (handles comments/trailing commas)
- list(directory: string): Promise<{name, type}[]> - List directory contents

Relative paths are resolved from workspace root. Absolute paths work as-is.
⚠️ IMPORTANT: Use ptah.search.findFiles() to discover files before reading.
⚠️ NO write, delete, exists, or rename methods. This namespace is read-only.

### ptah.project - Project Analysis
- detectMonorepo(): Promise<{isMonorepo, type, workspaceFiles}> - Detect monorepo
- detectType(): Promise<string> - Detect project type (React, Angular, Node, etc.)
- analyzeDependencies(): Promise<{name, version, isDev}[]> - Analyze package dependencies
⚠️ NO getMonorepoInfo(). Use detectMonorepo() instead.

### ptah.ast - Code Structure Analysis (Tree-Sitter) — PREFER OVER FULL FILE READS
- analyze(file): Promise<{functions, classes, imports, exports}> - Full structural analysis with line ranges
- queryFunctions(file): Promise<{name, parameters, startLine, endLine}[]> - All functions
- queryClasses(file): Promise<{name, startLine, endLine}[]> - All classes
- queryImports(file): Promise<{source, importedSymbols}[]> - All imports
- queryExports(file): Promise<{name, kind}[]> - All exports
- parse(file): Promise<{ast, nodeCount}> - Raw AST tree
- getSupportedLanguages(): Promise<string[]> - Supported languages (JS/TS)

Use ptah.ast BEFORE reading files to understand structure at 40-60% token savings.

### ptah.dependencies - Import-Based Dependency Graph
- buildGraph(filePaths, workspaceRoot): Promise<void> - Build the graph (call once)
- getDependencies(file): Promise<string[]> - What this file imports
- getDependents(file): Promise<string[]> - What imports this file
- getSymbolIndex(): Promise<Record<string, string[]>> - Exported symbols per file
- isBuilt(): Promise<boolean> - Check if graph exists

### Other Namespaces (use ptah.help('topic') for details)
- ptah.context.* - Token budget optimization, enrichFile() for structural summaries (40-60% token reduction)
- ptah.relevance.* - File relevance scoring
- ptah.orchestration.* - Workflow state management
- ptah.agent.* - Agent orchestration (spawn, monitor Gemini CLI / Codex SDK / VS Code LM)

## Error Handling
If a call fails, it returns an error message. Use try-catch for robustness:
\`\`\`typescript
try { const files = await ptah.search.findFiles('**/*.ts'); } catch(e) { return 'Error: ' + e.message; }
\`\`\`

## Usage Examples

\`\`\`typescript
// BEST: Discover files FIRST, then read them
const tsFiles = await ptah.search.findFiles('**/*.ts', 100);
const packageFiles = tsFiles.filter(f => f.includes('package'));
if (packageFiles.length > 0) {
  const packageJson = await ptah.files.readJson(packageFiles[0]); // Absolute path from search
  return packageJson.dependencies;
}

// OK: If you KNOW the file exists, use relative path from workspace root
const pkg = await ptah.files.readJson('package.json'); // Resolved to workspace root
return pkg.version;

// Get workspace overview
const {info, structure} = await ptah.workspace.analyze();
return {projectType: info.projectType, frameworks: info.frameworks};

// Find files and filter (findFiles returns string paths)
const files = await ptah.search.findFiles('**/*', 500);
return files.filter(f => f.endsWith('.ts'));

// Find references before refactoring
const refs = await ptah.ide.lsp.getReferences('src/app.ts', 10, 5);
return refs.map(r => r.file + ':' + r.line);

// Check for TypeScript errors
const errors = await ptah.diagnostics.getErrors();
return errors.filter(e => e.file.endsWith('.ts'));

// Analyze code structure (AST)
const insights = await ptah.ast.analyze('src/services/auth.service.ts');
return { functions: insights.functions.map(f => f.name), classes: insights.classes.map(c => c.name) };
\`\`\``;
}
