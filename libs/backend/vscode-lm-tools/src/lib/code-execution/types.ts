/**
 * Code Execution API Type Definitions
 *
 * Provides type-safe interfaces for the Ptah Code Execution MCP server.
 * Supports 11 namespaces exposing VS Code extension capabilities to Claude CLI.
 *
 * TASK_2025_025: Expanded API surface for better Claude discoverability
 */

import * as vscode from 'vscode';

// ========================================
// Ptah API - Main Interface
// ========================================

/**
 * Complete Ptah API surface exposed to executed TypeScript code
 * Provides 11 namespaces for comprehensive workspace intelligence
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

  // New namespaces (TASK_2025_025)
  context: ContextNamespace;
  project: ProjectNamespace;
  relevance: RelevanceNamespace;
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
  analyze: () => Promise<{ info: any; structure: any }>;

  /**
   * Get current workspace information (project type, frameworks, etc.)
   * @returns Workspace metadata
   */
  getInfo: () => Promise<any>;

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
  findFiles: (pattern: string, limit?: number) => Promise<any[]>;

  /**
   * Get files most relevant to a semantic query
   * @param query - Natural language query describing needed files
   * @param maxFiles - Maximum results (default: 10)
   * @returns Array of relevant file metadata
   */
  getRelevantFiles: (query: string, maxFiles?: number) => Promise<any[]>;
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
 */
export interface AINamespace {
  /**
   * Send a chat message to VS Code language model
   * @param message - User message to send
   * @param model - Optional model family filter (e.g., "claude-3.5-sonnet")
   * @returns Complete model response text
   */
  chat: (message: string, model?: string) => Promise<string>;

  /**
   * Select available language models
   * @param family - Optional family filter
   * @returns Array of available model metadata
   */
  selectModel: (
    family?: string
  ) => Promise<Array<{ id: string; family: string; name: string }>>;
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
  execute: (commandId: string, ...args: any[]) => Promise<any>;

  /**
   * List all available Ptah commands
   * @returns Array of command IDs starting with "ptah."
   */
  list: () => Promise<string[]>;
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
  params?: any;
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
  result?: any;

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
  data?: any;
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
    properties: Record<string, any>;
    required?: string[];
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

  /** Execution timeout in milliseconds (default: 5000, max: 30000) */
  timeout?: number;
}

/**
 * Result of code execution
 */
export interface ExecuteCodeResult {
  /** Execution success flag */
  success: boolean;

  /** Return value from code (if success) */
  result?: any;

  /** Error message (if failure) */
  error?: string;

  /** Stack trace (if failure) */
  stack?: string;
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
