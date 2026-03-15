/**
 * Code Execution API Type Definitions
 *
 * Provides type-safe interfaces for the Ptah Code Execution MCP server.
 * Supports 11 namespaces exposing VS Code extension capabilities to Claude CLI.
 *
 * APPROVED EXCEPTION: This file retains `import * as vscode from 'vscode'`
 * because the DiagnosticsNamespace and related types reference
 * vscode.DiagnosticSeverity for type definitions. These are VS Code-specific
 * type enums with no platform-core equivalent.
 *
 * TASK_2025_025: Expanded API surface for better Claude discoverability
 */

import * as vscode from 'vscode';
import type {
  SpawnAgentRequest,
  SpawnAgentResult,
  AgentProcessInfo,
  AgentOutput,
  CliDetectionResult,
} from '@ptah-extension/shared';
import type {
  WorkspaceInfo,
  ProjectInfo,
  WorkspaceStructureAnalysis,
  StructuralSummaryResult,
} from '@ptah-extension/workspace-intelligence';

// ========================================
// Ptah API - Main Interface
// ========================================

/**
 * Complete Ptah API surface exposed to executed TypeScript code
 * Provides 15 namespaces for comprehensive workspace intelligence
 * TASK_2025_039: Enhanced with ide namespace for LSP and editor superpowers
 * TASK_2025_111: Added orchestration namespace for workflow state management
 */
export interface PtahAPI {
  // Original 8 namespaces
  workspace: WorkspaceNamespace;
  search: SearchNamespace;
  symbols: SymbolsNamespace;
  diagnostics: DiagnosticsNamespace;
  git: GitNamespace;
  ai: AINamespace;
  files: FilesNamespace;
  commands: CommandsNamespace;

  // Extended namespaces (TASK_2025_025)
  context: ContextNamespace;
  project: ProjectNamespace;
  relevance: RelevanceNamespace;

  // AST analysis namespace
  ast: AstNamespace;

  // IDE superpowers namespace (TASK_2025_039)
  ide: IDENamespace;

  // LLM provider namespace (VS Code LM API)
  llm: LLMNamespace;

  // Orchestration workflow state management (TASK_2025_111)
  orchestration: OrchestrationNamespace;

  // Agent orchestration namespace (TASK_2025_157)
  agent: AgentNamespace;

  // Dependencies namespace (TASK_2025_182 - import-based dependency graph)
  dependencies: DependenciesNamespace;

  // Web search namespace (TASK_2025_189)
  webSearch?: {
    search(
      query: string,
      timeoutMs?: number
    ): Promise<{
      query: string;
      summary: string;
      provider: 'vscode-lm' | 'gemini-cli';
      durationMs: number;
    }>;
  };

  /**
   * Get help documentation for Ptah API namespaces
   * @param topic Optional topic (e.g., 'ai', 'workspace', 'ai.ide.lsp'). Omit for overview.
   * @returns Help documentation for the specified topic
   */
  help(topic?: string): Promise<string>;
}

// ========================================
// Namespace Interfaces
// ========================================

/**
 * Workspace analysis capabilities
 * Delegates to WorkspaceAnalyzerService for project detection and structure analysis
 */
export interface WorkspaceNamespace {
  /**
   * Analyze complete workspace structure and project configuration
   * @returns Combined workspace info and structure analysis
   */
  analyze: () => Promise<{
    info: WorkspaceInfo | undefined;
    structure: WorkspaceStructureAnalysis | null;
    projectInfo?: ProjectInfo;
  }>;

  /**
   * Get current workspace information (project type, frameworks, etc.)
   * @returns Workspace metadata
   */
  getInfo: () => Promise<WorkspaceInfo | undefined>;

  /**
   * Get detected project type (React, Angular, NestJS, etc.)
   * @returns Project type string
   */
  getProjectType: () => Promise<string>;

  /**
   * Get detected frameworks in workspace
   * @returns Array of framework names
   */
  getFrameworks: () => Promise<string[]>;
}

/**
 * File search and relevance capabilities
 * Delegates to ContextOrchestrationService for intelligent file discovery
 */
export interface SearchNamespace {
  /**
   * Find files matching a glob pattern
   * @param pattern - Glob pattern (e.g., "src/**\/*.ts")
   * @param limit - Maximum results (default: 20)
   * @returns Array of matching file paths
   */
  findFiles: (pattern: string, limit?: number) => Promise<string[]>;

  /**
   * Get files most relevant to a semantic query
   * @param query - Natural language query describing needed files
   * @param maxFiles - Maximum results (default: 10)
   * @returns Array of relevant file metadata
   */
  getRelevantFiles: (query: string, maxFiles?: number) => Promise<string[]>;
}

/**
 * Symbol search capabilities
 * Uses VS Code's workspace symbol provider API
 */
export interface SymbolsNamespace {
  /**
   * Find symbols by name across workspace
   * @param name - Symbol name to search for
   * @param type - Optional symbol type filter (class, function, method, interface, variable)
   * @returns Array of symbol information
   */
  find: (name: string, type?: string) => Promise<vscode.SymbolInformation[]>;
}

/**
 * Diagnostic (errors/warnings) capabilities
 * Uses VS Code's language diagnostics API
 */
export interface DiagnosticsNamespace {
  /**
   * Get all error-level diagnostics in workspace
   * @returns Array of error diagnostics
   */
  getErrors: () => Promise<DiagnosticInfo[]>;

  /**
   * Get all warning-level diagnostics in workspace
   * @returns Array of warning diagnostics
   */
  getWarnings: () => Promise<DiagnosticInfo[]>;

  /**
   * Get all diagnostics (errors, warnings, info, hints) in workspace
   * @returns Array of all diagnostics with severity labels
   */
  getAll: () => Promise<DiagnosticInfo[]>;
}

/**
 * Diagnostic information structure
 */
export interface DiagnosticInfo {
  /** File path containing diagnostic */
  file: string;

  /** Diagnostic message */
  message: string;

  /** Line number (0-indexed) */
  line: number;

  /** Severity level (error, warning, info, hint) - only in getAll() */
  severity?: string;
}

/**
 * Git status capabilities
 * Uses VS Code's git extension API
 */
export interface GitNamespace {
  /**
   * Get current git repository status
   * @returns Branch name and file changes
   */
  getStatus: () => Promise<GitStatus>;
}

/**
 * Git repository status
 */
export interface GitStatus {
  /** Current branch name */
  branch: string;

  /** Modified files (working tree changes) */
  modified: string[];

  /** Staged files (index changes) */
  staged: string[];

  /** Untracked files */
  untracked: string[];
}

/**
 * AI/LLM capabilities (MULTI-AGENT SUPPORT)
 * Exposes VS Code Language Model API for Claude CLI → VS Code LM delegation
 * TASK_2025_039: Enhanced with advanced LLM chat, token intelligence, and specialized AI tasks
 */
export interface AINamespace {
  // ========================================
  // Basic Chat (Existing)
  // ========================================

  /**
   * Send a chat message to VS Code language model
   * @param message - User message to send
   * @param model - Optional model family filter (e.g., "claude-3.5-sonnet")
   * @returns Complete model response text
   */
  chat: (message: string, model?: string) => Promise<string>;

  /**
   * Select available language models with full metadata
   * @param family - Optional family filter
   * @returns Array of available model metadata including maxInputTokens, vendor, version
   */
  selectModel: (family?: string) => Promise<
    Array<{
      id: string;
      family: string;
      name: string;
      maxInputTokens: number;
      vendor: string;
      version: string;
    }>
  >;

  // ========================================
  // Chat Enhancements (TASK_2025_039)
  // ========================================

  /**
   * Multi-turn conversation with message history
   * @param messages - Array of chat messages with roles (user/assistant)
   * @param model - Optional model family filter
   * @returns Complete model response text
   */
  chatWithHistory: (messages: ChatMessage[], model?: string) => Promise<string>;

  /**
   * Streaming chat with chunk-by-chunk callback
   * @param message - User message to send
   * @param onChunk - Callback invoked for each response chunk
   * @param model - Optional model family filter
   * @returns Promise that resolves when streaming is complete
   */
  chatStream: (
    message: string,
    onChunk: (chunk: string) => void,
    model?: string
  ) => Promise<void>;

  /**
   * Chat with custom system prompt for task-specific behavior
   * Uses XML-delimited format for clear instruction boundaries
   * @param message - User message to send
   * @param systemPrompt - System prompt defining behavior/role
   * @param model - Optional model family filter
   * @returns Complete model response text
   */
  chatWithSystem: (
    message: string,
    systemPrompt: string,
    model?: string
  ) => Promise<string>;

  /**
   * Invoke an agent with .md file as system prompt
   * Enables Claude CLI to delegate tasks to cheaper models (gpt-4o-mini, haiku)
   * @param agentPath - Path to agent .md file (e.g., ".claude/agents/senior-tester.md")
   * @param task - Task description for the agent
   * @param model - Optional model to use (default: cost-optimized model)
   * @returns Agent's response
   */
  invokeAgent: (
    agentPath: string,
    task: string,
    model?: string
  ) => Promise<string>;

  // ========================================
  // Token Intelligence (TASK_2025_039)
  // ========================================

  /**
   * Count tokens in text using model-specific tokenizer
   * @param text - Text to count tokens for
   * @param model - Optional model family filter (default: active model)
   * @returns Token count
   */
  countTokens: (text: string, model?: string) => Promise<number>;

  /**
   * Count tokens in a file using model-specific tokenizer
   * @param filePath - Absolute or relative file path
   * @param model - Optional model family filter (default: active model)
   * @returns Token count
   */
  countFileTokens: (filePath: string, model?: string) => Promise<number>;

  /**
   * Check if content fits in model's context window
   * @param content - Content to check
   * @param model - Optional model family filter (default: active model)
   * @param reserve - Reserved tokens for response (default: 4000)
   * @returns True if content fits in context window
   */
  fitsInContext: (
    content: string,
    model?: string,
    reserve?: number
  ) => Promise<boolean>;

  // ========================================
  // Tool Integration (TASK_2025_039)
  // ========================================

  /**
   * List all registered VS Code LM tools
   * @returns Array of tool information (name, description, schema)
   */
  getTools: () => Promise<ToolInfo[]>;

  /**
   * Invoke a VS Code LM tool directly
   * @param name - Tool name
   * @param input - Tool input parameters (must match tool's schema)
   * @returns Tool execution result
   */
  invokeTool: (
    name: string,
    input: Record<string, unknown>
  ) => Promise<vscode.LanguageModelToolResult>;

  /**
   * Chat with access to specific VS Code tools
   * @param message - User message to send
   * @param toolNames - Array of tool names to make available
   * @param model - Optional model family filter
   * @returns Complete model response text
   */
  chatWithTools: (
    message: string,
    toolNames: string[],
    model?: string
  ) => Promise<string>;

  // ========================================
  // Specialized AI Tasks (TASK_2025_039)
  // ========================================

  /**
   * Summarize content using VS Code LM
   * @param content - Content to summarize
   * @param options - Task options (model, maxLength, format)
   * @returns Summary text
   */
  summarize: (content: string, options?: AITaskOptions) => Promise<string>;

  /**
   * Explain code with context awareness
   * @param code - Code to explain
   * @param options - Task options (model, maxLength, format)
   * @returns Explanation text
   */
  explain: (code: string, options?: AITaskOptions) => Promise<string>;

  /**
   * Code review via VS Code LM
   * @param code - Code to review
   * @param options - Task options (model, maxLength, format)
   * @returns Review feedback text
   */
  review: (code: string, options?: AITaskOptions) => Promise<string>;

  /**
   * Transform code by instruction
   * @param code - Code to transform
   * @param instruction - Transformation instruction
   * @param model - Optional model family filter
   * @returns Transformed code
   */
  transform: (
    code: string,
    instruction: string,
    model?: string
  ) => Promise<string>;

  /**
   * Generate code from description
   * @param description - Description of code to generate
   * @param options - Task options (model, maxLength, format)
   * @returns Generated code
   */
  generate: (description: string, options?: AITaskOptions) => Promise<string>;
}

// ========================================
// AI Namespace Supporting Types (TASK_2025_039)
// ========================================

/**
 * Chat message structure for multi-turn conversations
 */
export interface ChatMessage {
  /** Message role (user or assistant) */
  role: 'user' | 'assistant';

  /** Message content text */
  content: string;
}

/**
 * Options for specialized AI tasks (summarize, explain, review, generate)
 */
export interface AITaskOptions {
  /** Optional model family filter */
  model?: string;

  /** Maximum length for response (in characters) */
  maxLength?: number;

  /** Output format preference */
  format?: 'text' | 'markdown' | 'code';
}

/**
 * VS Code LM tool information
 */
export interface ToolInfo {
  /** Tool name (unique identifier) */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for tool input parameters */
  inputSchema: Record<string, unknown> | undefined;
}

/**
 * File system capabilities
 * Delegates to FileSystemManager for file operations
 */
export interface FilesNamespace {
  /**
   * Read file contents as UTF-8 string
   * @param path - Absolute file path
   * @returns File contents
   */
  read: (path: string) => Promise<string>;

  /**
   * Read and parse JSON file, handling comments and trailing commas
   * @param path - Absolute file path
   * @returns Parsed JSON object
   */
  readJson: (path: string) => Promise<unknown>;

  /**
   * List directory contents
   * @param directory - Directory path
   * @returns Array of directory entries
   */
  list: (
    directory: string
  ) => Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
}

/**
 * VS Code command execution capabilities
 */
export interface CommandsNamespace {
  /**
   * Execute a VS Code command
   * @param commandId - Command identifier
   * @param args - Command arguments
   * @returns Command result
   */
  execute: (commandId: string, ...args: unknown[]) => Promise<unknown>;

  /**
   * List all available Ptah commands
   * @returns Array of command IDs starting with "ptah."
   */
  list: () => Promise<string[]>;
}

// ========================================
// Agent Namespace (TASK_2025_157)
// ========================================

/**
 * Agent orchestration namespace
 * Enables spawning, monitoring, and steering CLI agents as background workers.
 * Supports fire-and-check async delegation pattern.
 */
export interface AgentNamespace {
  /**
   * Spawn a CLI agent with a task
   * @param request - Spawn configuration (task, cli, timeout, files, taskFolder)
   * @returns Spawn result with agentId
   */
  spawn: (request: SpawnAgentRequest) => Promise<SpawnAgentResult>;

  /**
   * Get status of a specific agent or all agents
   * @param agentId - Optional agent ID. Omit to get all agents.
   * @returns Agent status info
   */
  status: (agentId?: string) => Promise<AgentProcessInfo | AgentProcessInfo[]>;

  /**
   * Read agent output (stdout + stderr)
   * @param agentId - Agent ID
   * @param tail - Optional: only return last N lines
   * @returns Agent output
   */
  read: (agentId: string, tail?: number) => Promise<AgentOutput>;

  /**
   * Send steering instruction to agent stdin
   * @param agentId - Agent ID
   * @param instruction - Text to send to stdin
   */
  steer: (agentId: string, instruction: string) => Promise<void>;

  /**
   * Stop a running agent
   * @param agentId - Agent ID
   * @returns Final agent status
   */
  stop: (agentId: string) => Promise<AgentProcessInfo>;

  /**
   * List available CLI agents with installation status
   * @returns Array of CLI detection results
   */
  list: () => Promise<CliDetectionResult[]>;

  /**
   * Wait for an agent to complete (polling)
   * @param agentId - Agent ID
   * @param options - Poll interval (default: 2000ms), timeout (default: no timeout)
   * @returns Final agent status
   */
  waitFor: (
    agentId: string,
    options?: { pollInterval?: number; timeout?: number }
  ) => Promise<AgentProcessInfo>;
}

// ========================================
// MCP Protocol Types (JSON-RPC 2.0)
// ========================================

/**
 * MCP request following JSON-RPC 2.0 specification
 */
export interface MCPRequest {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';

  /** Request ID for correlation */
  id: string | number;

  /** MCP method name (e.g., "tools/list", "tools/call") */
  method: string;

  /** Method-specific parameters */
  params?: Record<string, unknown>;
}

/**
 * MCP response following JSON-RPC 2.0 specification
 */
export interface MCPResponse {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';

  /** Request ID for correlation */
  id: string | number;

  /** Success result (mutually exclusive with error) */
  result?: unknown;

  /** Error response (mutually exclusive with result) */
  error?: MCPError;
}

/**
 * MCP error structure
 */
export interface MCPError {
  /** Error code (JSON-RPC standard codes) */
  code: number;

  /** Human-readable error message */
  message: string;

  /** Additional error data (e.g., stack trace) */
  data?: unknown;
}

/**
 * MCP tool definition structure
 */
export interface MCPToolDefinition {
  /** Tool name (must be unique) */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for tool parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };

  /** MCP protocol annotations — hints for LLM clients about tool behavior */
  annotations?: {
    /** Tool only reads data, does not modify state */
    readOnlyHint?: boolean;
    /** Tool may perform destructive/irreversible operations */
    destructiveHint?: boolean;
    /** Calling with same args produces same result (safe to retry) */
    idempotentHint?: boolean;
    /** Tool interacts with external systems beyond the local environment */
    openWorldHint?: boolean;
  };
}

// ========================================
// Code Execution Types
// ========================================

/**
 * Parameters for execute_code tool
 */
export interface ExecuteCodeParams {
  /** TypeScript code to execute */
  code: string;

  /** Execution timeout in milliseconds (default: 15000, max: 30000) */
  timeout?: number;
}

/**
 * Result of code execution
 */
export interface ExecuteCodeResult {
  /** Execution success flag */
  success: boolean;

  /** Return value from code (if success) */
  result?: unknown;

  /** Error message (if failure) */
  error?: string;

  /** Stack trace (if failure) */
  stack?: string;
}

/**
 * Parameters for approval_prompt MCP tool
 * Called by Claude CLI when permission is needed for tool execution
 *
 * @see TASK_2025_026 - MCP Permission Prompt Integration
 */
export interface ApprovalPromptParams {
  /** Name of the tool requesting permission (e.g., "Bash", "Write", "Read") */
  readonly tool_name: string;

  /** Input parameters for the tool (arbitrary JSON-serializable object) */
  readonly input: Readonly<Record<string, unknown>>;

  /** Claude's unique tool use ID for correlation */
  readonly tool_use_id?: string;
}

// ========================================
// New Namespaces (TASK_2025_025)
// ========================================

/**
 * Context optimization capabilities
 * Manages token budgets and intelligent file selection for AI context
 */
export interface ContextNamespace {
  /**
   * Optimize file selection within a token budget
   * @param query - Query describing what context is needed
   * @param maxTokens - Maximum token budget (default: 150000)
   * @returns Optimized context with selected files and stats
   */
  optimize: (
    query: string,
    maxTokens?: number
  ) => Promise<OptimizedContextResult>;

  /**
   * Count tokens in text using VS Code's native tokenizer
   * @param text - Text to count tokens for
   * @returns Token count
   */
  countTokens: (text: string) => Promise<number>;

  /**
   * Get recommended token budget based on project type
   * @param projectType - "monorepo" | "library" | "application" | "unknown"
   * @returns Recommended max tokens
   */
  getRecommendedBudget: (
    projectType: 'monorepo' | 'library' | 'application' | 'unknown'
  ) => number;

  /**
   * Generate a structural summary (.d.ts-style) of a file for reduced token usage.
   * Includes imports, class outlines, and function signatures without bodies.
   * @param filePath - Absolute or workspace-relative file path
   * @param language - Optional language hint ('typescript' | 'javascript')
   * @returns Structural summary with token reduction metrics
   */
  enrichFile: (
    filePath: string,
    language?: string
  ) => Promise<StructuralSummaryResult>;
}

/**
 * Dependencies namespace for import-based dependency graph analysis
 * TASK_2025_182: Exposes DependencyGraphService to agents
 */
export interface DependenciesNamespace {
  /**
   * Build an import-based dependency graph for the given files
   * @param filePaths - Absolute paths of files to include
   * @param workspaceRoot - Workspace root for relative path resolution
   * @returns The built dependency graph summary
   */
  buildGraph: (
    filePaths: string[],
    workspaceRoot: string
  ) => Promise<{
    nodeCount: number;
    edgeCount: number;
    unresolvedCount: number;
    builtAt: number;
  }>;

  /**
   * Get dependencies of a file (what it imports)
   * @param filePath - Absolute file path
   * @param depth - Max traversal depth (1-3, default: 1)
   * @returns Array of dependent file paths
   */
  getDependencies: (filePath: string, depth?: number) => Promise<string[]>;

  /**
   * Get reverse dependencies (what files import this file)
   * @param filePath - Absolute file path
   * @returns Array of file paths that import this file
   */
  getDependents: (filePath: string) => Promise<string[]>;

  /**
   * Get exported symbols per file from the dependency graph
   * @returns Map entries of [filePath, exportedSymbolNames[]]
   */
  getSymbolIndex: () => Promise<Array<{ file: string; symbols: string[] }>>;

  /**
   * Check if the dependency graph has been built
   * @returns true if buildGraph() has been called
   */
  isBuilt: () => Promise<boolean>;
}

/**
 * Result of context optimization
 */
export interface OptimizedContextResult {
  /** Files selected within token budget */
  selectedFiles: Array<{
    path: string;
    relativePath: string;
    size: number;
    estimatedTokens: number;
  }>;

  /** Total tokens of selected files */
  totalTokens: number;

  /** Remaining token budget */
  tokensRemaining: number;

  /** Optimization statistics */
  stats: {
    totalFiles: number;
    selectedFiles: number;
    excludedFiles: number;
    reductionPercentage: number;
  };
}

/**
 * Deep project analysis capabilities
 * Detects monorepos, project types, and analyzes dependencies
 */
export interface ProjectNamespace {
  /**
   * Detect if workspace is a monorepo and identify the tool
   * @returns Monorepo detection result
   */
  detectMonorepo: () => Promise<MonorepoResult>;

  /**
   * Detect project type (React, Angular, Node, Python, etc.)
   * @returns Project type string
   */
  detectType: () => Promise<string>;

  /**
   * Analyze project dependencies from package.json/requirements.txt
   * @returns Array of dependency information
   */
  analyzeDependencies: () => Promise<DependencyResult[]>;
}

/**
 * Monorepo detection result
 */
export interface MonorepoResult {
  /** Whether workspace is a monorepo */
  isMonorepo: boolean;

  /** Monorepo tool type (nx, lerna, rush, turborepo, pnpm-workspaces, yarn-workspaces) */
  type: string;

  /** Config files that indicated monorepo */
  workspaceFiles: string[];

  /** Number of packages/projects if detectable */
  packageCount?: number;
}

/**
 * Dependency information
 */
export interface DependencyResult {
  /** Package name */
  name: string;

  /** Version or version range */
  version: string;

  /** Whether it's a development dependency */
  isDev: boolean;
}

/**
 * File relevance scoring with explanations
 * Ranks files by relevance to a query with transparent reasoning
 */
export interface RelevanceNamespace {
  /**
   * Score a single file's relevance to a query
   * @param filePath - Relative file path to score
   * @param query - Query describing what you're looking for
   * @returns Score (0-100) with reasoning
   */
  scoreFile: (filePath: string, query: string) => Promise<FileRelevanceResult>;

  /**
   * Rank multiple files by relevance to a query
   * @param query - Query describing what you're looking for
   * @param limit - Maximum files to return (default: 20)
   * @returns Ranked files with scores and explanations
   */
  rankFiles: (query: string, limit?: number) => Promise<FileRelevanceResult[]>;
}

/**
 * File relevance scoring result
 */
export interface FileRelevanceResult {
  /** File path */
  file: string;

  /** Relevance score (0-100, higher = more relevant) */
  score: number;

  /** Reasons explaining the score */
  reasons: string[];
}

// ========================================
// AST Namespace (TASK_2025_0XX)
// ========================================

/**
 * AST analysis capabilities
 * Provides code structure analysis using tree-sitter parsing
 */
export interface AstNamespace {
  /**
   * Analyze a file and extract code insights (functions, classes, imports, exports)
   * @param filePath - Absolute or relative file path
   * @returns Code insights with structured information
   */
  analyze: (filePath: string) => Promise<AstCodeInsights>;

  /**
   * Parse a file and return the full AST structure
   * @param filePath - Absolute or relative file path
   * @param maxDepth - Maximum tree depth to return (default: 10, for performance)
   * @returns Generic AST node tree
   */
  parse: (filePath: string, maxDepth?: number) => Promise<AstParseResult>;

  /**
   * Query functions from a file
   * @param filePath - Absolute or relative file path
   * @returns Array of function definitions
   */
  queryFunctions: (filePath: string) => Promise<AstFunctionInfo[]>;

  /**
   * Query classes from a file
   * @param filePath - Absolute or relative file path
   * @returns Array of class definitions
   */
  queryClasses: (filePath: string) => Promise<AstClassInfo[]>;

  /**
   * Query imports from a file
   * @param filePath - Absolute or relative file path
   * @returns Array of import statements
   */
  queryImports: (filePath: string) => Promise<AstImportInfo[]>;

  /**
   * Query exports from a file
   * @param filePath - Absolute or relative file path
   * @returns Array of export statements
   */
  queryExports: (filePath: string) => Promise<AstExportInfo[]>;

  /**
   * Get supported languages for AST parsing
   * @returns Array of supported language identifiers
   */
  getSupportedLanguages: () => string[];
}

/**
 * Complete code insights from AST analysis
 */
export interface AstCodeInsights {
  /** File that was analyzed */
  file: string;

  /** Detected language */
  language: string;

  /** Function definitions found */
  functions: AstFunctionInfo[];

  /** Class definitions found */
  classes: AstClassInfo[];

  /** Import statements found */
  imports: AstImportInfo[];

  /** Export statements found */
  exports: AstExportInfo[];
}

/**
 * Function information extracted from AST
 */
export interface AstFunctionInfo {
  /** Function name */
  name: string;

  /** Parameter names */
  parameters: string[];

  /** Start line (0-indexed) */
  startLine?: number;

  /** End line (0-indexed) */
  endLine?: number;

  /** Whether function is async */
  isAsync?: boolean;
}

/**
 * Class information extracted from AST
 */
export interface AstClassInfo {
  /** Class name */
  name: string;

  /** Start line (0-indexed) */
  startLine?: number;

  /** End line (0-indexed) */
  endLine?: number;

  /** Methods in the class */
  methods?: AstFunctionInfo[];
}

/**
 * Import information extracted from AST
 */
export interface AstImportInfo {
  /** Module source path */
  source: string;

  /** Imported symbols */
  importedSymbols?: string[];

  /** Whether this is a default import */
  isDefault?: boolean;

  /** Whether this is a namespace import (import * as X) */
  isNamespace?: boolean;
}

/**
 * Export information extracted from AST
 */
export interface AstExportInfo {
  /** Exported symbol name */
  name: string;

  /** Type of export (function, class, variable, type, interface, unknown) */
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'unknown';

  /** Whether this is a default export */
  isDefault?: boolean;

  /** Whether this is a re-export from another module */
  isReExport?: boolean;

  /** Source module if re-export */
  source?: string;
}

/**
 * Result of parsing a file to AST
 */
export interface AstParseResult {
  /** File that was parsed */
  file: string;

  /** Detected language */
  language: string;

  /** Root AST node (simplified for JSON serialization) */
  ast: AstNode;

  /** Total node count */
  nodeCount: number;
}

/**
 * Simplified AST node for MCP serialization
 */
export interface AstNode {
  /** Node type (e.g., 'function_declaration', 'class_declaration') */
  type: string;

  /** Node text content (may be truncated for large nodes) */
  text?: string;

  /** Start position */
  start: { line: number; column: number };

  /** End position */
  end: { line: number; column: number };

  /** Child nodes */
  children?: AstNode[];
}

// ========================================
// IDE Namespace (TASK_2025_039)
// ========================================

/**
 * IDE superpowers namespace
 * Provides access to LSP, editor state, code actions, and testing
 * These capabilities are impossible to access from outside VS Code
 */
export interface IDENamespace {
  /** Language Server Protocol (LSP) capabilities */
  lsp: LSPNamespace;

  /** Editor state and context */
  editor: EditorNamespace;

  /** Code actions and refactoring */
  actions: ActionsNamespace;

  /** Test execution and coverage */
  testing: TestingNamespace;
}

// ========================================
// LSP Namespace (TASK_2025_039)
// ========================================

/**
 * Language Server Protocol capabilities
 * Provides access to language intelligence features
 */
export interface LSPNamespace {
  /**
   * Get definition location for symbol at position
   * @param file - Absolute or relative file path
   * @param line - Line number (0-indexed)
   * @param col - Column number (0-indexed)
   * @returns Array of definition locations (empty if not found)
   */
  getDefinition: (
    file: string,
    line: number,
    col: number
  ) => Promise<Location[]>;

  /**
   * Find all references to symbol at position
   * @param file - Absolute or relative file path
   * @param line - Line number (0-indexed)
   * @param col - Column number (0-indexed)
   * @returns Array of reference locations (empty if not found)
   */
  getReferences: (
    file: string,
    line: number,
    col: number
  ) => Promise<Location[]>;

  /**
   * Get hover information for symbol at position (types, documentation)
   * @param file - Absolute or relative file path
   * @param line - Line number (0-indexed)
   * @param col - Column number (0-indexed)
   * @returns Hover information or null if not available
   */
  getHover: (
    file: string,
    line: number,
    col: number
  ) => Promise<HoverInfo | null>;

  /**
   * Get type definition location for symbol at position
   * @param file - Absolute or relative file path
   * @param line - Line number (0-indexed)
   * @param col - Column number (0-indexed)
   * @returns Array of type definition locations (empty if not found)
   */
  getTypeDefinition: (
    file: string,
    line: number,
    col: number
  ) => Promise<Location[]>;

  /**
   * Get signature help for function call at position
   * @param file - Absolute or relative file path
   * @param line - Line number (0-indexed)
   * @param col - Column number (0-indexed)
   * @returns Signature help or null if not available
   */
  getSignatureHelp: (
    file: string,
    line: number,
    col: number
  ) => Promise<SignatureHelp | null>;
}

// ========================================
// Editor Namespace (TASK_2025_039)
// ========================================

/**
 * Editor state and context capabilities
 * Provides access to active editor, open files, and visible ranges
 */
export interface EditorNamespace {
  /**
   * Get active editor information (file, cursor position, selection)
   * @returns Active editor info or null if no editor is active
   */
  getActive: () => Promise<ActiveEditorInfo | null>;

  /**
   * Get all currently open files in editor tabs
   * @returns Array of absolute file paths
   */
  getOpenFiles: () => Promise<string[]>;

  /**
   * Get all files with unsaved changes
   * @returns Array of absolute file paths
   */
  getDirtyFiles: () => Promise<string[]>;

  /**
   * Get recently accessed files (most recent first)
   * @param limit - Maximum number of files (default: 10)
   * @returns Array of absolute file paths
   */
  getRecentFiles: (limit?: number) => Promise<string[]>;

  /**
   * Get visible code range in active editor
   * @returns Visible range or null if no editor is active
   */
  getVisibleRange: () => Promise<VisibleRange | null>;
}

// ========================================
// Actions Namespace (TASK_2025_039)
// ========================================

/**
 * Code actions and refactoring capabilities
 * Provides access to language-specific code actions and transformations
 */
export interface ActionsNamespace {
  /**
   * Get available code actions at position
   * @param file - Absolute or relative file path
   * @param line - Line number (0-indexed)
   * @returns Array of available code actions
   */
  getAvailable: (file: string, line: number) => Promise<CodeAction[]>;

  /**
   * Apply a code action by title
   * @param file - Absolute or relative file path
   * @param line - Line number (0-indexed)
   * @param actionTitle - Title of code action to apply
   * @returns True if action was applied successfully
   */
  apply: (file: string, line: number, actionTitle: string) => Promise<boolean>;

  /**
   * Rename symbol at position across workspace
   * @param file - Absolute or relative file path
   * @param line - Line number (0-indexed)
   * @param col - Column number (0-indexed)
   * @param newName - New name for symbol
   * @returns True if rename was successful
   */
  rename: (
    file: string,
    line: number,
    col: number,
    newName: string
  ) => Promise<boolean>;

  /**
   * Organize imports in file
   * @param file - Absolute or relative file path
   * @returns True if organize imports was successful
   */
  organizeImports: (file: string) => Promise<boolean>;

  /**
   * Apply all auto-fixes in file
   * @param file - Absolute or relative file path
   * @param kind - Optional code action kind filter (e.g., "source.fixAll.eslint")
   * @returns True if fixes were applied successfully
   */
  fixAll: (file: string, kind?: string) => Promise<boolean>;
}

// ========================================
// Testing Namespace (TASK_2025_039)
// ========================================

/**
 * Test execution and coverage capabilities
 * Provides access to VS Code Test API for test discovery and execution
 */
export interface TestingNamespace {
  /**
   * Discover all tests in workspace
   * @returns Array of test items with hierarchy
   */
  discover: () => Promise<TestItem[]>;

  /**
   * Run tests with optional filtering and debugging
   * @param options - Test run options (include/exclude patterns, debug mode)
   * @returns Test run results with pass/fail counts
   */
  run: (options?: TestRunOptions) => Promise<TestResult>;

  /**
   * Get results from last test run
   * @returns Last test results or null if no tests have been run
   */
  getLastResults: () => Promise<TestResult | null>;

  /**
   * Get coverage information for file
   * @param file - Absolute or relative file path
   * @returns Coverage info or null if not available
   */
  getCoverage: (file: string) => Promise<CoverageInfo | null>;
}

// ========================================
// IDE Supporting Types (TASK_2025_039)
// ========================================

/**
 * Location in source code
 */
export interface Location {
  /** Absolute file path */
  file: string;

  /** Line number (0-indexed) */
  line: number;

  /** Column number (0-indexed) */
  column: number;

  /** Optional end line (0-indexed) */
  endLine?: number;

  /** Optional end column (0-indexed) */
  endColumn?: number;
}

/**
 * Hover information (types, documentation)
 */
export interface HoverInfo {
  /** Hover content (markdown strings) */
  contents: string[];

  /** Optional range for hover */
  range?: { start: Location; end: Location };
}

/**
 * Signature help for function calls
 */
export interface SignatureHelp {
  /** Available signatures */
  signatures: SignatureInfo[];

  /** Index of active signature */
  activeSignature: number;

  /** Index of active parameter in active signature */
  activeParameter: number;
}

/**
 * Function signature information
 */
export interface SignatureInfo {
  /** Signature label (e.g., "function(param1: string, param2: number)") */
  label: string;

  /** Optional documentation */
  documentation?: string;

  /** Parameter information */
  parameters: ParameterInfo[];
}

/**
 * Parameter information
 */
export interface ParameterInfo {
  /** Parameter label */
  label: string;

  /** Optional documentation */
  documentation?: string;
}

/**
 * Active editor information
 */
export interface ActiveEditorInfo {
  /** Absolute file path */
  file: string;

  /** Cursor line (0-indexed) */
  line: number;

  /** Cursor column (0-indexed) */
  column: number;

  /** Optional selection range */
  selection?: { start: Location; end: Location };
}

/**
 * Visible range in editor
 */
export interface VisibleRange {
  /** Absolute file path */
  file: string;

  /** Start line of visible range (0-indexed) */
  startLine: number;

  /** End line of visible range (0-indexed) */
  endLine: number;
}

/**
 * Code action information
 */
export interface CodeAction {
  /** Action title (used for identification) */
  title: string;

  /** Action kind (e.g., "quickfix", "refactor", "source.organizeImports") */
  kind: string;

  /** Whether this is the preferred action */
  isPreferred?: boolean;
}

/**
 * Test item (test suite or test case)
 */
export interface TestItem {
  /** Test identifier */
  id: string;

  /** Display label */
  label: string;

  /** Absolute file path */
  file: string;

  /** Optional line number (0-indexed) */
  line?: number;

  /** Child test items (for test suites) */
  children?: TestItem[];
}

/**
 * Test run options
 */
export interface TestRunOptions {
  /** Test IDs to include (default: all) */
  include?: string[];

  /** Test IDs to exclude (default: none) */
  exclude?: string[];

  /** Run in debug mode (default: false) */
  debug?: boolean;
}

/**
 * Test run result
 */
export interface TestResult {
  /** Number of passed tests */
  passed: number;

  /** Number of failed tests */
  failed: number;

  /** Number of skipped tests */
  skipped: number;

  /** Total number of tests */
  total: number;

  /** Execution duration in milliseconds */
  duration: number;

  /** Optional failure details */
  failures?: TestFailure[];
}

/**
 * Test failure information
 */
export interface TestFailure {
  /** Test identifier */
  test: string;

  /** Failure message */
  message: string;

  /** Optional file path */
  file?: string;

  /** Optional line number (0-indexed) */
  line?: number;
}

/**
 * Code coverage information
 */
export interface CoverageInfo {
  /** File path */
  file: string;

  /** Line coverage */
  lines: { covered: number; total: number };

  /** Function coverage */
  functions: { covered: number; total: number };

  /** Branch coverage */
  branches: { covered: number; total: number };
}

// ========================================
// LLM Namespace (Native SDK Abstraction)
// ========================================

/**
 * LLM provider namespace
 * Enables Claude CLI to delegate tasks to other AI models via VS Code LM API.
 */
export interface LLMNamespace {
  /** VS Code Language Model API (always available) */
  vscodeLm: LLMProviderNamespace;

  /**
   * Chat with the default configured provider
   * @param message - User message to send
   * @param options - Optional chat configuration
   * @returns Complete model response text
   */
  chat: (message: string, options?: LLMChatOptions) => Promise<string>;

  /**
   * Get list of configured providers (those with API keys)
   * @returns Array of configured provider info
   */
  getConfiguredProviders: () => Promise<LLMConfiguredProvider[]>;

  /**
   * Get the default provider name from settings
   * @returns Default provider identifier
   */
  getDefaultProvider: () => string;

  /**
   * Get full configuration state for all providers
   * @returns Configuration including default provider and all provider configs
   */
  getConfiguration: () => Promise<{
    defaultProvider: string;
    providers: LLMConfiguredProvider[];
  }>;
}

/**
 * Provider-specific namespace (e.g., ptah.llm.anthropic)
 */
export interface LLMProviderNamespace {
  /**
   * Send a chat message to this provider
   * @param message - User message to send
   * @param options - Optional chat configuration
   * @returns Complete model response text
   */
  chat: (message: string, options?: LLMChatOptions) => Promise<string>;

  /**
   * Check if this provider is available (has API key configured)
   * @returns true if provider can be used
   */
  isAvailable: () => Promise<boolean>;

  /**
   * Get the default model for this provider
   * @returns Default model identifier
   */
  getDefaultModel: () => string;

  /**
   * Get display name for this provider
   * @returns Human-readable provider name
   */
  getDisplayName: () => string;
}

/**
 * Options for LLM chat requests
 */
export interface LLMChatOptions {
  /** Specific model to use (overrides default) */
  model?: string;

  /** System prompt to use (overrides default) */
  systemPrompt?: string;

  /** Temperature for response generation (0-1) */
  temperature?: number;

  /** Maximum tokens in response */
  maxTokens?: number;
}

/**
 * Information about a configured LLM provider
 */
export interface LLMConfiguredProvider {
  /** Provider identifier (e.g., 'vscode-lm') */
  name: string;

  /** Human-readable display name */
  displayName: string;

  /** Default model for this provider */
  defaultModel: string;

  /** Whether provider has API key configured */
  isConfigured: boolean;
}

// ========================================
// Orchestration Namespace (TASK_2025_111)
// ========================================

/**
 * Orchestration workflow phase
 * Represents the current stage of an orchestration workflow
 */
export type OrchestrationPhase =
  | 'planning'
  | 'design'
  | 'implementation'
  | 'qa'
  | 'complete';

/**
 * Checkpoint type for orchestration workflow
 * Identifies the type of user approval checkpoint
 */
export type CheckpointType =
  | 'requirements'
  | 'architecture'
  | 'batch-complete'
  | null;

/**
 * Checkpoint status for orchestration workflow
 * Represents the approval status of a checkpoint
 */
export type CheckpointStatus = 'pending' | 'approved' | 'rejected';

/**
 * Orchestration checkpoint state
 * Tracks the last checkpoint presented to the user
 */
export interface OrchestrationCheckpoint {
  /** Type of checkpoint that was presented */
  type: CheckpointType;

  /** Approval status from user */
  status: CheckpointStatus;

  /** ISO timestamp when checkpoint was presented */
  timestamp: string;
}

/**
 * Orchestration workflow state
 * Persists the complete state of an orchestration workflow for a task.
 * Stored in .claude/specs/TASK_XXX/.orchestration-state.json
 */
export interface OrchestrationState {
  /** Task identifier (e.g., "TASK_2025_111") */
  taskId: string;

  /** Current workflow phase */
  phase: OrchestrationPhase;

  /** Currently active agent (null if between agent invocations) */
  currentAgent: string | null;

  /** Last checkpoint presented to user */
  lastCheckpoint: OrchestrationCheckpoint;

  /** List of pending actions to be executed */
  pendingActions: string[];

  /** Selected workflow strategy (e.g., "FEATURE", "BUGFIX") */
  strategy: string;

  /** Additional metadata for workflow context */
  metadata: Record<string, unknown>;
}

/**
 * Next action type for orchestration workflow
 * Determines what the orchestrator should do next
 */
export type OrchestrationActionType =
  | 'invoke-agent'
  | 'present-checkpoint'
  | 'complete';

/**
 * Next action recommendation for orchestration workflow
 * Returned by getNextAction to guide the orchestrator on what to do next
 */
export interface OrchestrationNextAction {
  /** Type of action to perform */
  action: OrchestrationActionType;

  /** Agent to invoke (when action is 'invoke-agent') */
  agent?: string;

  /** Context to pass to the agent */
  context?: Record<string, unknown>;

  /** Required inputs that must be available before proceeding */
  requiredInputs?: string[];

  /** Checkpoint type to present (when action is 'present-checkpoint') */
  checkpointType?: string;
}

/**
 * Orchestration namespace for MCP
 * Provides state management tools for orchestration workflows.
 * Enables workflow state persistence and continuation across sessions.
 */
export interface OrchestrationNamespace {
  /**
   * Get the current orchestration state for a task
   * @param taskId - Task identifier (e.g., "TASK_2025_111")
   * @returns Current state or null if no state exists
   */
  getState: (taskId: string) => Promise<OrchestrationState | null>;

  /**
   * Update the orchestration state for a task
   * @param taskId - Task identifier
   * @param state - Partial state to merge with existing state
   */
  setState: (
    taskId: string,
    state: Partial<OrchestrationState>
  ) => Promise<void>;

  /**
   * Analyze current state and recommend the next action
   * @param taskId - Task identifier
   * @returns Recommended next action for the orchestrator
   */
  getNextAction: (taskId: string) => Promise<OrchestrationNextAction>;
}
