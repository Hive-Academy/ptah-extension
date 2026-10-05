/**
 * Code Execution API Type Definitions
 *
 * Provides type-safe interfaces for the Ptah Code Execution MCP server.
 * Supports 21 namespaces exposing VS Code extension capabilities to Claude CLI.
 */

import type {
  SpawnAgentRequest,
  SpawnAgentResult,
  AgentProcessInfo,
  AgentOutput,
  AgentMessageOutcome,
  CliDetectionResult,
} from '@ptah-extension/shared';
import type {
  AgentReportDelivery,
  AgentReportInput,
  LaneLimitResult,
  AgentWaitMode,
  AgentWaitResult,
} from '@ptah-extension/cli-agent-runtime';
import type {
  Approximation,
  DiagnosticsCoverageFields,
  LanguageCoverage,
  NotCheckedFiles,
  UnsupportedLanguageAnswer,
} from '@ptah-extension/platform-core';
import type {
  WorkspaceInfo,
  ProjectInfo,
  WorkspaceStructureAnalysis,
  StructuralSummaryResult,
  GraphBuildState,
  GraphCoverage,
} from '@ptah-extension/workspace-intelligence';
import type { HarnessNamespace } from './namespace-builders/harness-namespace.builder';
import type { DashboardNamespace } from './namespace-builders/dashboard-namespace.builder';
import type { SurfaceNamespace } from './namespace-builders/surface-namespace.builder';
import type { SessionNamespace } from './namespace-builders/session-namespace.builder';
import type { SkillNamespace } from './namespace-builders/skill-namespace.builder';
import type { MemoryNamespace } from './namespace-builders/memory-namespace.builder';
import type { CorpusNamespace } from './namespace-builders/corpus-namespace.builder';
import type { CodeNamespace } from './namespace-builders/code-namespace.builder';
import type { TasksNamespace } from './namespace-builders/tasks-namespace.builder';
import type { SessionOrganizationNamespace } from './namespace-builders/session-organization-namespace.builder';
import type {
  WebSearchFailureReason,
  WebSearchProviderType,
} from './services/web-search-provider.interface';

/**
 * Complete Ptah API surface exposed to executed TypeScript code
 * Provides 21 namespaces for comprehensive workspace intelligence
 */
export interface PtahAPI {
  workspace: WorkspaceNamespace;
  search: SearchNamespace;
  diagnostics: DiagnosticsNamespace;
  files: FilesNamespace;
  context: ContextNamespace;
  project: ProjectNamespace;
  relevance: RelevanceNamespace;
  ast: AstNamespace;
  ide: IDENamespace;
  orchestration: OrchestrationNamespace;
  agent: AgentNamespace;
  git: GitNamespace;
  json: JsonNamespace;
  browser: BrowserNamespace;
  skill: SkillNamespace;
  dependencies: DependenciesNamespace;
  /**
   * `.ptah/specs/` task carriers. NON-optional and never namespace-toggleable:
   * the tools it backs are part of the always-on core set, because an agent
   * that cannot rely on the task tools being present will write task metadata
   * by hand — which is the failure mode this namespace exists to remove.
   */
  tasks: TasksNamespace;
  /**
   * Per-user session organization (TASK_2026_580). NON-optional: without a
   * recorder (VS Code) every method returns `organization-unavailable`, so
   * there is no host on which the namespace is missing. Named
   * `sessionOrganization` because TASK_2026_584 owns `session`.
   */
  sessionOrganization: SessionOrganizationNamespace;
  webSearch?: {
    search(
      query: string,
      options?: {
        maxResults?: number;
        timeout?: number;
        /** Overrides the configured provider set for this one call. */
        providers?: WebSearchProviderType[];
      },
    ): Promise<{
      query: string;
      summary: string;
      /** The providers actually attempted, in selection order. */
      providers: WebSearchProviderType[];
      /** 'ok' = every provider succeeded, 'partial' = at least one failed. */
      status: 'ok' | 'partial';
      durationMs: number;
      results: Array<{
        title: string;
        url: string;
        snippet: string;
        sources: WebSearchProviderType[];
      }>;
      resultCount: number;
      /** One entry per selected provider, ok and failed alike. */
      outcomes: Array<{
        provider: WebSearchProviderType;
        status: 'ok' | 'failed';
        durationMs: number;
        resultCount: number;
        reason?: WebSearchFailureReason;
        message?: string;
      }>;
    }>;
  };
  harness?: HarnessNamespace;
  /**
   * Declarative dashboard specs (TASK_2026_493_9f58). NON-optional: its one
   * tool always returns a meaningful plain-text rendering, so it is useful on
   * a host with no dashboard page (the CLI, VS Code) and there is no host on
   * which it has to degrade. Its only collaborator is a broadcast callback.
   */
  dashboard: DashboardNamespace;
  /**
   * Declarative surface contract v2 (TASK_2026_538). NON-optional for the same
   * reason as `dashboard`: without a surface state service it still validates
   * and reports `unavailable`, and an anonymous caller gets plain text.
   */
  surface: SurfaceNamespace;
  /**
   * Child chat sessions of the calling session (TASK_2026_584). NON-optional:
   * on a host without a session spawner every operation throws a NAMED error
   * at call time, and `takeHeldCompletions` returns nothing.
   */
  session: SessionNamespace;
  memory?: MemoryNamespace;
  corpus?: CorpusNamespace;
  code?: CodeNamespace;

  /**
   * Get help documentation for Ptah API namespaces
   * @param topic Optional topic (e.g., 'ai', 'workspace', 'ai.ide.lsp'). Omit for overview.
   * @returns Help documentation for the specified topic
   */
  help(topic?: string): Promise<string>;
}

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
 * Diagnostic (errors/warnings) capabilities.
 *
 * Each method returns a `DiagnosticsPayload` that carries status/source/reason
 * alongside the flattened diagnostics, so the formatter can distinguish
 * "unavailable" from "available with zero issues" (TASK_2026_299).
 */
export interface DiagnosticsNamespace {
  getErrors: (files?: readonly string[]) => Promise<DiagnosticsPayload>;
  getWarnings: (files?: readonly string[]) => Promise<DiagnosticsPayload>;
  getAll: (files?: readonly string[]) => Promise<DiagnosticsPayload>;
}

/**
 * Payload returned by diagnostics namespace methods. Preserves the
 * available/unavailable contract from `IDiagnosticsProvider`.
 */
export interface DiagnosticsPayload {
  status: 'available' | 'unavailable';
  source: string;
  reason?: string;
  /**
   * What the answer covered (TASK_2026_559 Batch 25b), on both arms: the
   * provider's own coverage, or, when the provider reports none (the VS Code
   * provider reads whatever the installed language extensions publish),
   * `checks: 'provider-defined'` with every count unknown. The formatter
   * prints a bare "No issues found" only when this passes the clean-answer
   * rule and the check is a type check.
   */
  coverage: LanguageCoverage;
  /** The files the answer did not check, and why; absent when none. */
  notChecked?: readonly NotCheckedFiles[];
  /**
   * The provider's opt-in `go vet` run, its unplaced findings count and its
   * truncation flag (Batch 37b), forwarded as given on both arms. The
   * formatter names each as a limitation; none of them is ever a clean answer.
   */
  goVet?: DiagnosticsCoverageFields['goVet'];
  unmappedFindings?: number;
  diagnosticsTruncated?: boolean;
  diagnostics: DiagnosticInfo[];
  /**
   * The `files` scope of the call as absolute paths, relative entries resolved
   * against the session root the provider was given. Absent for an unscoped
   * call. The formatter lists diagnostics in these files first and in full.
   */
  requestedFiles?: string[];
}

/**
 * Diagnostic information structure
 */
export interface DiagnosticInfo {
  file: string;
  message: string;
  line: number;
  severity?: string;
  code?: string | number;
  source?: string;
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
    directory: string,
  ) => Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
}

/**
 * Agent orchestration namespace
 * Enables spawning, monitoring, and messaging CLI agents as background workers.
 * Supports fire-and-check async delegation pattern.
 */
export interface AgentNamespace {
  /**
   * Spawn a CLI agent with a task
   * @param request - Spawn configuration (task, cli, timeout, files, taskFolder)
   * @returns Spawn result with agentId
   */
  spawn: (request: SpawnAgentRequest) => Promise<SpawnAgentResult>;

  /** Optional plan-limit enrichment for agent tool transports. */
  limits?: (
    rows: readonly CliDetectionResult[],
  ) => Promise<readonly LaneLimitResult<CliDetectionResult>[] | undefined>;

  /**
   * Get status of a specific agent or all agents
   * @param agentId - Optional agent ID. Omit to get all agents.
   * @returns Agent status info
   */
  status: (agentId?: string) => Promise<AgentProcessInfo | AgentProcessInfo[]>;

  /**
   * Read agent output (stdout + stderr)
   * @param agentId - Agent ID
   * @param tail - Optional: lines per stream (default 200, the last ones)
   * @param offset - Optional: 0-based first line of a forward window
   * @returns Agent output
   */
  read: (
    agentId: string,
    tail?: number,
    offset?: number,
  ) => Promise<AgentOutput>;

  /**
   * Send a message to a running agent.
   *
   * The delivery mechanism is chosen from the agent's own declared capability
   * — never from its CLI name — and the mechanism that was used is REPORTED
   * back in {@link AgentMessageOutcome.mode}. `unsupported` means nothing was
   * delivered; `interrupt-resume` means the agent's in-flight turn was aborted
   * and its partial work discarded. Neither is a plain success, so neither may
   * be collapsed into `void`.
   *
   * @param agentId - Agent ID
   * @param message - Text to deliver to the agent
   */
  message: (agentId: string, message: string) => Promise<AgentMessageOutcome>;

  /**
   * Deliver a report to the session that started the reporter.
   *
   * The reporter is either a spawned agent (`agentId`, the `/agent/{id}` URL
   * segment) or a child chat session started with `ptah_session_start`
   * (`childSessionId`, the `/session/{id}` URL segment, TASK_2026_584). Both
   * are supplied by the MCP transport, never by the calling model — a
   * sender-supplied id would be forgeable by any same-user process.
   *
   * Returns `delivered: false` with a machine-readable `reason` whenever the
   * report did not reach a session. It never reports a delivery it did not
   * make.
   */
  report: (input: AgentReportInput) => Promise<AgentReportDelivery>;

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
   * List the agent role names defined for the current workspace. Each name is
   * a valid `role` for {@link AgentNamespace.spawn}.
   * @returns Role names, or an empty array when no role source is wired
   */
  listRoles: () => Promise<string[]>;

  /**
   * Wait for one agent to end. Event-driven (`waitForAgents`), never polled.
   * @param agentId - Agent ID
   * @param options - timeout in ms (default and maximum: 900000, 15 minutes)
   * @returns The agent's terminal status
   * @throws When the agent is unknown or belongs to another workspace, or
   *   when it is still running at the timeout
   */
  waitFor: (
    agentId: string,
    options?: { timeout?: number },
  ) => Promise<AgentProcessInfo>;

  /**
   * Block until the given lanes end (`all`) or the first one does (`any`),
   * or until `timeoutMs` (clamped to 0..900000) passes. A timeout is a
   * partial result (`timedOut: true`), never an error; unknown ids and ids
   * from another workspace are reported per id. Backs `ptah_agent_wait`.
   * An aborted `signal` ends the wait early with `cancelled: true`; the
   * lanes themselves keep running.
   */
  waitForAgents: (
    agentIds: readonly string[],
    mode: AgentWaitMode,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<AgentWaitResult>;
}

/**
 * Git worktree operations namespace
 * Provides list, add, and remove operations for git worktrees via CLI.
 */
export interface GitNamespace {
  /**
   * List all git worktrees in the current repository.
   * Returns both the worktree list and any error that occurred,
   * so the AI agent can distinguish "no worktrees" from "git error".
   *
   * @returns Object with worktrees array and optional error string
   */
  worktreeList(): Promise<{
    worktrees: import('@ptah-extension/shared').GitWorktreeInfo[];
    error?: string;
  }>;

  /**
   * Create a new git worktree
   * @param params - Branch name, optional path, and createBranch flag
   * @returns Success status with worktree path or error
   */
  worktreeAdd(params: {
    branch: string;
    path?: string;
    createBranch?: boolean;
  }): Promise<{ success: boolean; worktreePath?: string; error?: string }>;

  /**
   * Remove a git worktree
   * @param params - Worktree path and optional force flag
   * @returns Success status or error
   */
  worktreeRemove(params: {
    path: string;
    force?: boolean;
  }): Promise<{ success: boolean; error?: string }>;
}

/**
 * JSON validation and repair namespace
 * Validates JSON files written by AI agents, repairs common issues,
 * and overwrites with clean JSON.
 */
export interface JsonNamespace {
  /**
   * Validate and repair a JSON file.
   * Reads the file, extracts JSON from raw agent output (strips markdown fences,
   * prose, fixes trailing commas, unquoted keys, etc.), validates against an
   * optional schema, and overwrites the file with clean JSON.
   *
   * @param params - File path and optional schema
   * @returns Validation result (success with cleaned JSON, or errors for self-correction)
   */
  validate(params: JsonValidateParams): Promise<JsonValidateResult>;
}

/**
 * Parameters for ptah.json.validate()
 */
export interface JsonValidateParams {
  /** Workspace-relative file path to the JSON file */
  file: string;

  /**
   * Optional JSON Schema to validate against.
   * An inline JSON Schema object for structural validation.
   * Use { required: ["key1"], properties: { key1: { type: "string" } } } format.
   */
  schema?: Record<string, unknown>;
}

/**
 * Result of JSON validation and repair.
 * On success, the file has been overwritten with clean, formatted JSON.
 * On failure, errors describe what went wrong so the agent can self-correct.
 */
export interface JsonValidateResult {
  /** Whether validation and repair succeeded */
  success: boolean;

  /** The file path that was validated */
  file: string;

  /** Repairs applied (e.g., "stripped markdown fences", "fixed trailing commas") */
  repairs: string[];

  /** Validation errors (when success is false) */
  errors: string[];

  /** Whether the file was overwritten with clean JSON */
  fileOverwritten: boolean;
}

/**
 * Viewport dimensions in pixels.
 * Used across browser session configuration, status reporting, and tool schemas.
 */
export interface ViewportDimensions {
  /** Width in pixels (must be a positive integer, max 7680) */
  width: number;
  /** Height in pixels (must be a positive integer, max 7680) */
  height: number;
}

/**
 * Browser navigation result
 */
export interface BrowserNavigateResult {
  /** Whether navigation succeeded */
  success: boolean;
  /** Final URL after navigation (may differ from requested due to redirects) */
  url: string;
  /** Page title after load */
  title: string;
  /** Error message if navigation failed */
  error?: string;
}

/**
 * Browser screenshot result
 */
export interface BrowserScreenshotResult {
  /** Base64-encoded image data */
  data: string;
  /** Image format (png, jpeg, webp) */
  format: string;
  /** Absolute file path if the screenshot was saved to disk */
  filePath?: string;
  /** Error message if screenshot failed */
  error?: string;
}

/**
 * Browser JavaScript evaluation result
 */
export interface BrowserEvaluateResult {
  /** Evaluated value (serialized) */
  value: unknown;
  /** JavaScript type of the result (string, number, object, etc.) */
  type: string;
  /** Error message if evaluation failed */
  error?: string;
}

/**
 * Browser click result
 */
export interface BrowserClickResult {
  /** Whether click succeeded */
  success: boolean;
  /** Error message if click failed */
  error?: string;
}

/**
 * Browser type (text input) result
 */
export interface BrowserTypeResult {
  /** Whether typing succeeded */
  success: boolean;
  /** Error message if typing failed */
  error?: string;
}

/**
 * Browser page content result
 */
export interface BrowserContentResult {
  /** Outer HTML of the selected element or full page */
  html: string;
  /** Text content of the selected element or full page */
  text: string;
  /** Error message if content extraction failed */
  error?: string;
}

/**
 * Browser network request entry
 */
export interface BrowserNetworkRequestEntry {
  /** Request URL */
  url: string;
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** HTTP response status code */
  status: number;
  /** Resource type (Document, Script, XHR, Fetch, etc.) */
  type: string;
  /** Response size in bytes (if available) */
  size?: number;
}

/**
 * Browser network monitoring result
 */
export interface BrowserNetworkResult {
  /** Captured network requests */
  requests: BrowserNetworkRequestEntry[];
  /** Error message if monitoring failed */
  error?: string;
}

/**
 * Browser session status result
 */
export interface BrowserStatusResult {
  /** Whether browser session is connected */
  connected: boolean;
  /** Current page URL (if connected) */
  url?: string;
  /** Current page title (if connected) */
  title?: string;
  /** Session uptime in milliseconds */
  uptimeMs?: number;
  /** Milliseconds until auto-close due to inactivity or max lifetime */
  autoCloseInMs?: number;
  /** Error message if status check failed */
  error?: string;
  /** Whether the current session is running in headless mode */
  headless?: boolean;
  /** Whether recording is currently active */
  recording?: boolean;
  /** Current viewport dimensions */
  viewport?: ViewportDimensions;
}

/**
 * Result of starting a browser recording
 */
export interface BrowserRecordStartResult {
  /** Whether recording started successfully */
  success: boolean;
  /** Error message if start failed */
  error?: string;
}

/**
 * Result of stopping a browser recording and assembling the GIF
 */
export interface BrowserRecordStopResult {
  /** Absolute file path to the generated GIF */
  filePath: string;
  /** Number of frames captured */
  frameCount: number;
  /** Recording duration in milliseconds */
  durationMs: number;
  /** GIF file size in bytes */
  fileSizeBytes: number;
  /** Whether older frames were discarded due to buffer limit */
  truncated: boolean;
  /** Error message if stop/assembly failed */
  error?: string;
}

/**
 * Browser automation namespace
 * Provides navigate, screenshot, evaluate, click, type, content read,
 * network monitoring, and session management for AI agent browser automation.
 */
export interface BrowserNamespace {
  /**
   * Navigate to a URL and optionally wait for page load.
   * URL is validated against a security blocklist before navigation.
   * If no browser session exists, one is lazily created.
   *
   * Session options (headless, viewport) only take effect when creating a new session.
   * If a session already exists, they are stored for the next session creation.
   *
   * @param params - Navigation parameters and optional session configuration
   * @returns Navigation result with URL and page title
   */
  navigate(params: {
    url: string;
    waitForLoad?: boolean;
    /** Run browser in headless mode (default: false — visible browser window) */
    headless?: boolean;
    /** Viewport dimensions (default: 1920x1080 — desktop). Common presets: desktop 1920x1080, tablet 768x1024, mobile 375x812 */
    viewport?: ViewportDimensions;
  }): Promise<BrowserNavigateResult>;

  /**
   * Capture a screenshot of the current page.
   *
   * @param params - Optional screenshot configuration
   * @returns Screenshot result with base64-encoded image data
   */
  screenshot(params?: {
    format?: 'png' | 'jpeg' | 'webp';
    quality?: number;
    fullPage?: boolean;
  }): Promise<BrowserScreenshotResult>;

  /**
   * Execute JavaScript in the browser page context.
   * Expression size is limited to 64KB and execution times out after 10 seconds.
   *
   * @param params - JavaScript expression to evaluate
   * @returns Evaluation result with value and type
   */
  evaluate(params: {
    expression: string;
    returnByValue?: boolean;
  }): Promise<BrowserEvaluateResult>;

  /**
   * Click an element identified by CSS selector.
   * Uses Runtime.evaluate to call element.click() for reliability.
   *
   * @param params - CSS selector for the target element
   * @returns Click result
   */
  click(params: { selector: string }): Promise<BrowserClickResult>;

  /**
   * Type text into an element identified by CSS selector.
   * Focuses the element first, then uses Input.insertText for reliable input.
   *
   * @param params - CSS selector and text to type
   * @returns Type result
   */
  type(params: { selector: string; text: string }): Promise<BrowserTypeResult>;

  /**
   * Get page content (HTML and text) for the full page or a specific element.
   *
   * @param params - Optional CSS selector (defaults to full page body)
   * @returns Content result with HTML and text
   */
  getContent(params?: { selector?: string }): Promise<BrowserContentResult>;

  /**
   * Get recent network requests captured during the session.
   * Network monitoring is read-only (passive capture via Network.enable).
   *
   * @param params - Optional limit on number of requests returned
   * @returns Network result with captured requests
   */
  networkRequests(params?: { limit?: number }): Promise<BrowserNetworkResult>;

  /**
   * Close the browser session and release all resources.
   * In Electron: detaches debugger and destroys BrowserWindow.
   * In VS Code: closes CDP client and kills Chrome process.
   *
   * @returns Close result
   */
  close(): Promise<{ success: boolean; error?: string }>;

  /**
   * Get the current browser session status.
   *
   * @returns Status result with connection state, URL, title, and timing
   */
  status(): Promise<BrowserStatusResult>;

  /**
   * Start recording the browser session as a GIF.
   * Uses CDP Page.startScreencast to capture frames.
   *
   * @param params - Optional recording configuration
   * @returns Start result
   */
  recordStart(params?: {
    maxFrames?: number;
    frameDelay?: number;
  }): Promise<BrowserRecordStartResult>;

  /**
   * Stop recording and assemble captured frames into a GIF file.
   *
   * @returns Stop result with file path and recording stats
   */
  recordStop(): Promise<BrowserRecordStopResult>;
}

export type {
  MCPRequest,
  MCPResponse,
  MCPError,
  MCPNotification,
  MCPToolDefinition,
  ExecuteCodeParams,
  ExecuteCodeResult,
  ApprovalPromptParams,
} from './mcp-core/types/mcp-protocol.types';

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
    maxTokens?: number,
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
    projectType: 'monorepo' | 'library' | 'application' | 'unknown',
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
    language?: string,
  ) => Promise<StructuralSummaryResult>;
}

/**
 * Dependencies namespace for import-based dependency graph analysis
 * Exposes DependencyGraphService to agents
 */
export interface DependenciesNamespace {
  /**
   * Build an import-based dependency graph for the given files
   * @param filePaths - Absolute paths of files to include
   * @param workspaceRoot - Workspace root for relative path resolution
   * @param discoveredFiles - Files found before `filePaths` was capped, so
   *   {@link getGraphCoverage} can report the graph as incomplete; defaults
   *   to `filePaths.length`
   * @param options - `yieldToForeground` for a build nobody awaits: it waits
   *   on the background-work governor before each chunk. Leave it unset when
   *   awaiting the build inside a turn, or the turn waits for itself.
   *   `generation` from {@link reserveGraphBuild}: the build runs under that
   *   reservation instead of taking a new generation when it starts.
   * @returns The built dependency graph summary
   */
  buildGraph: (
    filePaths: string[],
    workspaceRoot: string,
    discoveredFiles?: number,
    options?: {
      yieldToForeground?: boolean;
      generation?: number;
      /**
       * Set when discovery stopped at this many files
       * ({@link GraphSourceDiscovery.truncated}): the coverage census is
       * `truncated`.
       */
      censusLimit?: number;
      /**
       * Set when discovery could not read part of the tree
       * ({@link GraphSourceDiscovery.unreadable}): the coverage census is
       * `unknown`, never clean.
       */
      censusUnknown?: boolean;
    },
  ) => Promise<{
    nodeCount: number;
    edgeCount: number;
    unresolvedCount: number;
    builtAt: number;
    error?: string;
  }>;

  /**
   * Discover the source files a graph of `workspaceRoot` is built from: every
   * file with an extension a language is recognised by (graph-capable or
   * not, so the census counts what the graph cannot analyse), with the
   * default workspace excludes and the vendor trees (`.venv`, `vendor`,
   * `obj`, `bin`, ...) excluded inside the bounded walk.
   * @param limit - Census limit (integer 1-50,000, default 50,000). One more
   *   file than this is asked for; when it exists, discovery is `truncated`.
   * @returns Absolute paths, at most `limit` of them.
   */
  discoverSourceFiles: (
    workspaceRoot: string,
    limit?: number,
  ) => Promise<GraphSourceDiscovery>;

  /**
   * The `unsupported-language` answer for a file the dependency graph cannot
   * hold (its language draws no graph edges on this host, or it is not
   * source), or `undefined` when the graph can hold it. Decided by the
   * extension alone.
   */
  unsupportedGraphLanguage: (
    filePath: string,
  ) => UnsupportedLanguageAnswer | undefined;

  /**
   * Reserve a build generation for `workspaceRoot` before discovering its
   * files; pass it to {@link buildGraph} as `options.generation`. A later
   * build or reservation of the root, or its eviction, supersedes it: a
   * superseded build is never published.
   */
  reserveGraphBuild: (workspaceRoot: string) => number;

  /**
   * The root's current build generation (`undefined` when none, or after an
   * eviction) and whether a build of it is running.
   */
  getGraphBuildState: (workspaceRoot: string) => GraphBuildState;

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
   * Get exported symbols per file from the dependency graph.
   *
   * Without `query`: every entry, unpaged, as before. With `query`: one page
   * of the entries under `pathPrefix`, ordered by path (see
   * {@link SymbolIndexQuery}). An invalid `query` throws a `RangeError`.
   * @param workspaceRoot - Optional workspace root to scope the index to a
   *   single workspace's graph; omit to use the sole graph (or a merged union
   *   when several workspaces are open). A relative `pathPrefix` resolves
   *   against it, else against the session's workspace root.
   */
  getSymbolIndex: {
    (workspaceRoot?: string): Promise<SymbolIndexEntry[]>;
    (
      workspaceRoot: string | undefined,
      query: SymbolIndexQuery,
    ): Promise<SymbolIndexPage>;
  };

  /**
   * Check if the dependency graph has been built
   * @param workspaceRoot - Optional workspace root; when provided, checks that
   *   specific workspace's graph, otherwise true if any graph exists.
   * @returns true if buildGraph() has been called
   */
  isBuilt: (workspaceRoot?: string) => Promise<boolean>;

  /**
   * How many files the graph was built from, against how many were
   * discovered (`graphedFiles < discoveredFiles` means a cap dropped files),
   * and its language `coverage`.
   * @param workspaceRoot - That workspace's graph; omit for every graph
   *   combined (the scope of the merged symbol index).
   * @returns No file counts and an unknown `coverage` (census `unknown`,
   *   never clean) when no graph is built
   */
  getGraphCoverage: (workspaceRoot?: string) => Promise<GraphQueryCoverage>;

  /**
   * Coverage of the graph that answers {@link getDependencies} and
   * {@link getDependents} for `filePath` (resolved and routed the same way),
   * and the graph's own spelling of the file when it holds it.
   * @returns No file counts and an unknown `coverage` when no graph answers
   *   that file
   */
  getGraphCoverageForFile: (filePath: string) => Promise<GraphFileCoverage>;
}

/** What {@link DependenciesNamespace.discoverSourceFiles} found. */
export interface GraphSourceDiscovery {
  /** Absolute paths of the discovered files, at most `limit`. */
  files: string[];
  /** More than `limit` files exist: the ones past it were never seen. */
  truncated: boolean;
  /** The census limit the discovery ran with. */
  limit: number;
  /**
   * Paths discovery could not read (directories, links), by error code;
   * absent when everything was read. `files` then holds only what was found,
   * so the census is unknown.
   */
  unreadable?: { paths: number; byCode: Record<string, number> };
}

/** Coverage of the graph a dependency query is answered by. */
export interface GraphQueryCoverage extends Partial<GraphCoverage> {
  /** Language coverage of that graph; census `unknown` when none answers. */
  coverage: LanguageCoverage;
}

/** {@link GraphQueryCoverage} for one queried file. */
export interface GraphFileCoverage extends GraphQueryCoverage {
  /**
   * The graph's own spelling of the file (its node key), when the answering
   * graph holds it; absent when the file is not in that graph.
   */
  nodePath?: string;
}

/** One file of the symbol index and the names it exports. */
export interface SymbolIndexEntry {
  file: string;
  symbols: string[];
  /**
   * Export forms found in the file that could not be read (`line N:
   * <source>`, e.g. `exports[key] = v`): `symbols` may be incomplete (it can
   * be empty). The graph's coverage counts the file `failed`
   * (`unsupported-syntax`). Absent when every export was read.
   */
  unextractedExports?: string[];
}

/** Paging and filtering of {@link DependenciesNamespace.getSymbolIndex}. */
export interface SymbolIndexQuery {
  /**
   * Keep only files whose absolute path starts with this prefix: absolute, or
   * relative to the workspace root. `\` and `/` are equivalent; Windows paths
   * compare case-insensitively. `..` segments are rejected.
   */
  pathPrefix?: string;
  /** Maximum entries in the page (integer, 1-1000, default 30). */
  limit?: number;
  /** Entries to skip, after the prefix filter (integer ≥ 0, default 0). */
  offset?: number;
}

/** A page of the symbol index, ordered by path. */
export interface SymbolIndexPage {
  files: SymbolIndexEntry[];
  /** Entries in `files`. */
  count: number;
  /** Entries matching `pathPrefix`, across all pages. */
  total: number;
  offset: number;
  /** Offset of the next page; absent on the last page. */
  nextOffset?: number;
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

/**
 * AST analysis capabilities
 * Provides code structure analysis using tree-sitter parsing
 */
export interface AstNamespace {
  /**
   * Analyze a file and extract code insights (functions, classes, imports, exports)
   * @param filePath - Absolute or relative file path
   * @param workspaceRoot - Optional absolute workspace root to resolve a relative
   *   filePath against. Omit to use the active workspace. Disambiguates when
   *   multiple workspaces are open (absolute filePaths ignore this).
   * @returns Code insights with structured information
   */
  analyze: (
    filePath: string,
    workspaceRoot?: string,
  ) => Promise<AstCodeInsights>;

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
   * @returns Parse status and coverage, then the function definitions
   */
  queryFunctions: (filePath: string) => Promise<AstFunctionsResult>;

  /**
   * Query classes from a file
   * @param filePath - Absolute or relative file path
   * @returns Parse status and coverage, then the class definitions
   */
  queryClasses: (filePath: string) => Promise<AstClassesResult>;

  /**
   * Query imports from a file
   * @param filePath - Absolute or relative file path
   * @returns Parse status and coverage, then the import statements
   */
  queryImports: (filePath: string) => Promise<AstImportsResult>;

  /**
   * Query exports from a file
   * @param filePath - Absolute or relative file path
   * @returns Array of export statements
   * @throws When the file has export forms the extractor could not read
   *   (the array would be incomplete): the message carries the coverage
   *   (`unsupported-syntax`) and those forms; `analyze` returns the known
   *   exports with the disclosure.
   */
  queryExports: (filePath: string) => Promise<AstExportInfo[]>;

  /**
   * Get supported languages for AST parsing
   * @returns Array of supported language identifiers
   */
  getSupportedLanguages: () => string[];
}

/**
 * Parse honesty every `ptah.ast` operation that parses a file reports first
 * (`analyze` since Batch 24a; `parse`, `queryFunctions`, `queryClasses` and
 * `queryImports` since Batch 24c), so a recovered parse never reads as a
 * complete answer.
 */
export interface AstParseHonesty {
  /** Recovery is a partial answer; unknown means parser metadata was absent. */
  parseStatus: 'ok' | 'recovered' | 'unknown';
  /** Bounded ERROR/MISSING tally; null when the original parse was not observed. */
  errorNodeCount: number | null;
  errorNodeCountCapped: boolean;
  /** Serialized ahead of paths and lists so result budgets retain coverage. */
  coverage: LanguageCoverage;
}

/** `ptah.ast.queryFunctions` result: parse honesty, then the functions. */
export interface AstFunctionsResult extends AstParseHonesty {
  file: string;
  language: string;
  functions: AstFunctionInfo[];
}

/** `ptah.ast.queryClasses` result: parse honesty, then the classes. */
export interface AstClassesResult extends AstParseHonesty {
  file: string;
  language: string;
  classes: AstClassInfo[];
}

/** `ptah.ast.queryImports` result: parse honesty, then the imports. */
export interface AstImportsResult extends AstParseHonesty {
  file: string;
  language: string;
  imports: AstImportInfo[];
}

/**
 * Complete code insights from AST analysis
 */
export interface AstCodeInsights extends AstParseHonesty {
  /**
   * Export forms seen but not represented in `exports` (`line N: <source>`).
   * Present only when non-empty; coverage then counts the file as failed with
   * reason `unsupported-syntax`, so the answer is never clean.
   */
  unextractedExports?: string[];

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
  /**
   * Exported name: a named default declaration keeps its name, any other
   * default export is `default`, `export { a as b }` is `b`, `export *` is `*`.
   */
  name: string;

  /**
   * Type of export. `unknown`: a binding exported without its declaration
   * (`export { a }`, `export default a`); `namespace`: a TS namespace or
   * `export * as ns`; `wildcard`: a plain `export *` (names live in `source`).
   */
  kind:
    | 'function'
    | 'class'
    | 'variable'
    | 'type'
    | 'interface'
    | 'enum'
    | 'namespace'
    | 'wildcard'
    | 'unknown';

  /** Whether this is a default export */
  isDefault?: boolean;

  /** Whether this is a re-export from another module */
  isReExport?: boolean;

  /** Source module if re-export */
  source?: string;

  /** Local (or source-module) name when it differs from `name` */
  localName?: string;
}

/**
 * Result of parsing a file to AST
 */
export interface AstParseResult extends AstParseHonesty {
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
    col: number,
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
    col: number,
  ) => Promise<Location[]>;

  /**
   * Definition lookup with how it was answered. Prefer this over
   * `getDefinition`: an empty `locations` means "none found" only when
   * `mechanism` is not `'none'` and nothing in the report qualifies it.
   */
  getDefinitionReport: (
    file: string,
    line: number,
    col: number,
  ) => Promise<LspLocationReport>;

  /** Reference lookup with how it was answered (see `getDefinitionReport`). */
  getReferencesReport: (
    file: string,
    line: number,
    col: number,
  ) => Promise<LspLocationReport>;

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
    col: number,
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
    col: number,
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
    col: number,
  ) => Promise<SignatureHelp | null>;
}

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
    newName: string,
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

/**
 * How a definition or reference lookup was answered.
 * - `provider-defined`: the host's own providers (VS Code language services);
 *   the host did not describe its mechanism further.
 * - `symbol-index`: the workspace code-symbol index.
 * - `declaration-scan`: an index-free tree-sitter declaration scan, following
 *   the file's imports.
 * - `graph-scoped-scan`: a word scan narrowed to files the dependency graph
 *   links to the declaration.
 * - `text-scan`: a bounded word scan of workspace files.
 * - `none`: no lookup mechanism exists on this host; nothing was searched.
 */
export type LspMechanism =
  | 'provider-defined'
  | 'symbol-index'
  | 'declaration-scan'
  | 'graph-scoped-scan'
  | 'text-scan'
  | 'none';

/**
 * A definition or reference answer that says how it was produced, so an empty
 * list is never mistaken for "the symbol has none".
 */
export interface LspLocationReport {
  locations: Location[];
  mechanism: LspMechanism;
  /** Registry language of the queried file, or `null` when none claims it. */
  language: string | null;
  /**
   * Whether `mechanism` supports `language`; `null` when the host did not
   * say (`provider-defined`).
   */
  languageSupported: boolean | null;
  /** Approximations the answer rests on (e.g. `text-scan`). */
  approximations: readonly Approximation[];
  /** A scan or result cap was hit; more locations may exist. */
  truncated?: boolean;
}

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

/**
 * Orchestration workflow phase
 * Represents the current stage of an orchestration workflow
 */
export type OrchestrationPhase =
  'planning' | 'design' | 'implementation' | 'qa' | 'complete';

/**
 * Checkpoint type for orchestration workflow
 * Identifies the type of user approval checkpoint
 */
export type CheckpointType =
  'requirements' | 'architecture' | 'batch-complete' | null;

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
 * Stored in .ptah/specs/{taskId}/.orchestration-state.json
 */
export interface OrchestrationState {
  /** Task identifier */
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
  'invoke-agent' | 'present-checkpoint' | 'complete';

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
   * @param taskId - Task identifier
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
    state: Partial<OrchestrationState>,
  ) => Promise<void>;

  /**
   * Analyze current state and recommend the next action
   * @param taskId - Task identifier
   * @returns Recommended next action for the orchestrator
   */
  getNextAction: (taskId: string) => Promise<OrchestrationNextAction>;
}
