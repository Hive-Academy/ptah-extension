/**
 * Type definitions for the standalone MCP test server
 */

/**
 * MCP JSON-RPC 2.0 Request
 */
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP JSON-RPC 2.0 Response
 */
export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP Tool Definition
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Ptah API - Mock interface for standalone testing
 * Matches the full PtahAPI from vscode-lm-tools
 */
export interface PtahAPI {
  workspace: WorkspaceNamespace;
  search: SearchNamespace;
  symbols: SymbolsNamespace;
  diagnostics: DiagnosticsNamespace;
  git: GitNamespace;
  ai: AINamespace;
  files: FilesNamespace;
  commands: CommandsNamespace;
  context: ContextNamespace;
  project: ProjectNamespace;
  relevance: RelevanceNamespace;
  ast: AstNamespace;
  ide: IDENamespace;
  llm: LLMNamespace;
  orchestration: OrchestrationNamespace;
  help: (topic?: string) => Promise<string>;
}

export interface WorkspaceNamespace {
  analyze: () => Promise<{ info: unknown; structure: unknown }>;
  getInfo: () => Promise<unknown>;
  getProjectType: () => Promise<string>;
  getFrameworks: () => Promise<string[]>;
}

export interface SearchNamespace {
  findFiles: (pattern: string, limit?: number) => Promise<unknown[]>;
  getRelevantFiles: (query: string, maxFiles?: number) => Promise<unknown[]>;
}

export interface SymbolsNamespace {
  find: (name: string, type?: string) => Promise<unknown[]>;
}

export interface DiagnosticsNamespace {
  getErrors: () => Promise<unknown[]>;
  getWarnings: () => Promise<unknown[]>;
  getAll: () => Promise<unknown[]>;
}

export interface GitNamespace {
  getStatus: () => Promise<{
    branch: string;
    modified: string[];
    staged: string[];
    untracked: string[];
  }>;
}

export interface AINamespace {
  chat: (message: string, model?: string) => Promise<string>;
  selectModel: (family?: string) => Promise<unknown[]>;
}

export interface FilesNamespace {
  read: (path: string) => Promise<string>;
  exists: (path: string) => Promise<boolean>;
  list: (directory: string) => Promise<string[]>;
}

export interface CommandsNamespace {
  execute: (command: string, ...args: unknown[]) => Promise<unknown>;
  list: () => Promise<string[]>;
}

export interface ContextNamespace {
  getContext: (query: string) => Promise<unknown>;
  getTokenBudget: () => Promise<number>;
}

export interface ProjectNamespace {
  getProjectInfo: () => Promise<unknown>;
  getDependencies: () => Promise<unknown[]>;
}

export interface RelevanceNamespace {
  scoreRelevance: (query: string, files: string[]) => Promise<unknown[]>;
}

export interface AstNamespace {
  parse: (filePath: string) => Promise<unknown>;
  getSymbols: (filePath: string) => Promise<unknown[]>;
}

export interface IDENamespace {
  getActiveEditor: () => Promise<unknown>;
  getDiagnostics: (path?: string) => Promise<unknown[]>;
}

export interface LLMNamespace {
  chat: (message: string) => Promise<string>;
  countTokens: (text: string) => Promise<number>;
}

export interface OrchestrationNamespace {
  getState: () => Promise<unknown>;
  updateState: (state: unknown) => Promise<void>;
}
