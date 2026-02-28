/**
 * Claude Agent SDK Tool Types
 *
 * TASK_2025_094: Comprehensive tool type system from official SDK reference
 *
 * Provides type-safe interfaces for ALL agent tools:
 * - Tool Input Types: Parameters sent to tools
 * - Tool Output Types: Results returned from tools
 * - Type Guards: Runtime type narrowing functions
 *
 * Source: @anthropic-ai/claude-agent-sdk official documentation
 * Last Updated: 2025-12-29
 *
 * Usage:
 * ```typescript
 * if (isReadToolInput(toolInput)) {
 *   const path = toolInput.file_path; // Type-safe!
 * }
 *
 * if (isGrepToolOutput(toolOutput)) {
 *   const files = toolOutput.files; // Type-safe!
 * }
 * ```
 */

// ============================================================================
// TOOL INPUT TYPES
// ============================================================================

/**
 * Read tool input interface
 * Tool: Read - Read file contents
 */
export interface ReadToolInput {
  /** The absolute path to the file to read */
  file_path: string;
  /** The line number to start reading from */
  offset?: number;
  /** The number of lines to read */
  limit?: number;
}

/**
 * Write tool input interface
 * Tool: Write - Write file contents
 */
export interface WriteToolInput {
  /** The absolute path to the file to write */
  file_path: string;
  /** The content to write to the file */
  content: string;
}

/**
 * Edit tool input interface
 * Tool: Edit - Edit file contents
 */
export interface EditToolInput {
  /** The absolute path to the file to modify */
  file_path: string;
  /** The text to replace */
  old_string: string;
  /** The text to replace it with (must be different from old_string) */
  new_string: string;
  /** Replace all occurrences of old_string (default false) */
  replace_all?: boolean;
}

/**
 * Bash tool input interface
 * Tool: Bash - Execute bash command
 */
export interface BashToolInput {
  /** The command to execute */
  command: string;
  /** Clear, concise description of what this command does in 5-10 words */
  description?: string;
  /** Optional timeout in milliseconds (max 600000) */
  timeout?: number;
  /** Set to true to dangerously disable sandbox mode */
  dangerouslyDisableSandbox?: boolean;
  /** Set to true to run this command in the background */
  run_in_background?: boolean;
}

/**
 * BashOutput tool input interface
 * Tool: BashOutput - Retrieve output from background bash shell
 */
export interface BashOutputToolInput {
  /** The ID of the background shell to retrieve output from */
  bash_id: string;
  /** Optional regex to filter output lines */
  filter?: string;
}

/**
 * Grep tool input interface
 * Tool: Grep - Search file contents
 */
export interface GrepToolInput {
  /** The regular expression pattern to search for */
  pattern: string;
  /** File or directory to search in (defaults to cwd) */
  path?: string;
  /** Glob pattern to filter files (e.g. "*.js") */
  glob?: string;
  /** File type to search (e.g. "js", "py", "rust") */
  type?: string;
  /** Output mode: "content", "files_with_matches", or "count" */
  output_mode?: 'content' | 'files_with_matches' | 'count';
  /** Case insensitive search */
  '-i'?: boolean;
  /** Show line numbers (for content mode) */
  '-n'?: boolean;
  /** Lines to show after each match */
  '-A'?: number;
  /** Lines to show before each match */
  '-B'?: number;
  /** Lines to show before and after each match */
  '-C'?: number;
  /** Enable multiline mode where . matches newlines */
  multiline?: boolean;
  /** Limit output to first N lines/entries */
  head_limit?: number;
  /** Skip first N lines/entries before applying head_limit */
  offset?: number;
}

/**
 * Glob tool input interface
 * Tool: Glob - Find files by pattern
 */
export interface GlobToolInput {
  /** The glob pattern to match files against */
  pattern: string;
  /** The directory to search in (defaults to cwd) */
  path?: string;
}

/**
 * Task tool input interface
 * Tool: Task - Invoke subagent
 */
export interface TaskToolInput {
  /** A short (3-5 word) description of the task */
  description: string;
  /** The task for the agent to perform */
  prompt: string;
  /** The type of specialized agent to use for this task */
  subagent_type: string;
  /** Optional agent ID to resume from a previous invocation */
  resume?: string;
  /** Set to true to run this agent in the background. SDK returns an immediate placeholder tool_result with output_file path. */
  run_in_background?: boolean;
  /** Optional model override for the subagent */
  model?: 'sonnet' | 'opus' | 'haiku';
  /** Maximum number of agentic turns before stopping */
  max_turns?: number;
}

/**
 * TaskOutput tool input interface
 * Tool: TaskOutput - Get output from background task
 */
export interface TaskOutputToolInput {
  /** The task ID to get output from */
  task_id: string;
  /** Whether to wait for completion (default true) */
  block?: boolean;
  /** Max wait time in ms */
  timeout?: number;
}

/**
 * TaskStop tool input interface
 * Tool: TaskStop - Stop a running background task (agent or shell)
 */
export interface TaskStopToolInput {
  /** The ID of the background task to stop */
  task_id?: string;
  /** @deprecated Use task_id instead */
  shell_id?: string;
}

/**
 * KillShell tool input interface
 * Tool: KillShell - Kill a background bash shell
 */
export interface KillShellToolInput {
  /** The ID of the background shell to kill */
  shell_id: string;
}

/**
 * WebFetch tool input interface
 * Tool: WebFetch - Fetch web content
 */
export interface WebFetchToolInput {
  /** The URL to fetch content from */
  url: string;
  /** The prompt to run on the fetched content */
  prompt: string;
}

/**
 * WebSearch tool input interface
 * Tool: WebSearch - Search the web
 */
export interface WebSearchToolInput {
  /** The search query to use */
  query: string;
  /** Only include results from these domains */
  allowed_domains?: string[];
  /** Never include results from these domains */
  blocked_domains?: string[];
}

/**
 * TodoWrite tool input interface
 * Tool: TodoWrite - Manage task list
 */
export interface TodoWriteToolInput {
  /** The updated todo list */
  todos: TodoItem[];
}

/**
 * Individual todo item
 */
export interface TodoItem {
  /** The task description */
  content: string;
  /** The task status */
  status: 'pending' | 'in_progress' | 'completed';
  /** Active form of the task description */
  activeForm: string;
}

/**
 * AskUserQuestion tool input interface
 * Tool: AskUserQuestion - Ask user clarifying questions
 */
export interface AskUserQuestionToolInput {
  /** Questions to ask the user (1-4 questions) */
  questions: QuestionItem[];
  /** User answers populated by the permission system */
  answers?: Record<string, string>;
}

/**
 * Individual question item
 */
export interface QuestionItem {
  /** The complete question to ask the user */
  question: string;
  /** Very short label displayed as a chip/tag (max 12 chars) */
  header: string;
  /** The available choices (2-4 options) */
  options: QuestionOption[];
  /** Set to true to allow multiple selections */
  multiSelect: boolean;
}

/**
 * Question option
 */
export interface QuestionOption {
  /** Display text for this option (1-5 words) */
  label: string;
  /** Explanation of what this option means */
  description: string;
}

/**
 * NotebookEdit tool input interface
 * Tool: NotebookEdit - Edit Jupyter notebook cells
 */
export interface NotebookEditToolInput {
  /** The absolute path to the Jupyter notebook file */
  notebook_path: string;
  /** The ID of the cell to edit */
  cell_id?: string;
  /** The new source for the cell */
  new_source: string;
  /** The type of the cell (code or markdown) */
  cell_type?: 'code' | 'markdown';
  /** The type of edit (replace, insert, delete) */
  edit_mode?: 'replace' | 'insert' | 'delete';
}

/**
 * ExitPlanMode tool input interface
 * Tool: ExitPlanMode - Exit planning mode
 */
export interface ExitPlanModeToolInput {
  /** The plan to run by the user for approval */
  plan: string;
}

/**
 * ListMcpResources tool input interface
 * Tool: ListMcpResources - List MCP resources
 */
export interface ListMcpResourcesToolInput {
  /** Optional server name to filter resources by */
  server?: string;
}

/**
 * ReadMcpResource tool input interface
 * Tool: ReadMcpResource - Read MCP resource
 */
export interface ReadMcpResourceToolInput {
  /** The MCP server name */
  server: string;
  /** The resource URI to read */
  uri: string;
}

/**
 * LSP tool input interface
 * Tool: LSP - Language Server Protocol operations
 */
export interface LSPToolInput {
  /** The LSP operation to perform */
  operation:
    | 'goToDefinition'
    | 'findReferences'
    | 'hover'
    | 'documentSymbol'
    | 'workspaceSymbol'
    | 'goToImplementation'
    | 'prepareCallHierarchy'
    | 'incomingCalls'
    | 'outgoingCalls';
  /** The absolute or relative path to the file */
  filePath: string;
  /** The line number (1-based) */
  line: number;
  /** The character offset (1-based) */
  character: number;
}

// ============================================================================
// TOOL OUTPUT TYPES
// ============================================================================

/**
 * Task tool output interface
 * Tool: Task - Result from subagent
 */
export interface TaskToolOutput {
  /** Final result message from the subagent */
  result: string;
  /** Token usage statistics */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** Total cost in USD */
  total_cost_usd?: number;
  /** Execution duration in milliseconds */
  duration_ms?: number;
}

/**
 * AskUserQuestion tool output interface
 */
export interface AskUserQuestionToolOutput {
  /** The questions that were asked */
  questions: QuestionItem[];
  /** The answers provided by the user */
  answers: Record<string, string>;
}

/**
 * Bash tool output interface
 */
export interface BashToolOutput {
  /** Combined stdout and stderr output */
  output: string;
  /** Exit code of the command */
  exitCode: number;
  /** Whether the command was killed due to timeout */
  killed?: boolean;
  /** Shell ID for background processes */
  shellId?: string;
}

/**
 * BashOutput tool output interface
 */
export interface BashOutputToolOutput {
  /** New output since last check */
  output: string;
  /** Current shell status */
  status: 'running' | 'completed' | 'failed';
  /** Exit code (when completed) */
  exitCode?: number;
}

/**
 * Edit tool output interface
 */
export interface EditToolOutput {
  /** Confirmation message */
  message: string;
  /** Number of replacements made */
  replacements: number;
  /** File path that was edited */
  file_path: string;
}

/**
 * Read tool output - Text file
 */
export interface ReadTextFileOutput {
  /** File contents with line numbers */
  content: string;
  /** Total number of lines in file */
  total_lines: number;
  /** Lines actually returned */
  lines_returned: number;
}

/**
 * Read tool output - Image file
 */
export interface ReadImageFileOutput {
  /** Base64 encoded image data */
  image: string;
  /** Image MIME type */
  mime_type: string;
  /** File size in bytes */
  file_size: number;
}

/**
 * Read tool output - PDF file
 */
export interface ReadPDFFileOutput {
  /** Array of page contents */
  pages: Array<{
    page_number: number;
    text?: string;
    images?: Array<{
      image: string;
      mime_type: string;
    }>;
  }>;
  /** Total number of pages */
  total_pages: number;
}

/**
 * Read tool output - Jupyter notebook
 */
export interface ReadNotebookFileOutput {
  /** Jupyter notebook cells */
  cells: Array<{
    cell_type: 'code' | 'markdown';
    source: string;
    outputs?: unknown[];
    execution_count?: number;
  }>;
  /** Notebook metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Read tool output - Union type
 */
export type ReadToolOutput =
  | ReadTextFileOutput
  | ReadImageFileOutput
  | ReadPDFFileOutput
  | ReadNotebookFileOutput;

/**
 * Write tool output interface
 */
export interface WriteToolOutput {
  /** Success message */
  message: string;
  /** Number of bytes written */
  bytes_written: number;
  /** File path that was written */
  file_path: string;
}

/**
 * Glob tool output interface
 */
export interface GlobToolOutput {
  /** Array of matching file paths */
  matches: string[];
  /** Number of matches found */
  count: number;
  /** Search directory used */
  search_path: string;
}

/**
 * Grep tool output - Content mode
 */
export interface GrepContentOutput {
  /** Matching lines with context */
  matches: Array<{
    file: string;
    line_number?: number;
    line: string;
    before_context?: string[];
    after_context?: string[];
  }>;
  /** Total number of matches */
  total_matches: number;
}

/**
 * Grep tool output - Files mode
 */
export interface GrepFilesOutput {
  /** Files containing matches */
  files: string[];
  /** Number of files with matches */
  count: number;
}

/**
 * Grep tool output - Count mode
 */
export interface GrepCountOutput {
  /** Match counts per file */
  counts: Array<{
    file: string;
    count: number;
  }>;
  /** Total matches across all files */
  total: number;
}

/**
 * Grep tool output - Union type
 */
export type GrepToolOutput =
  | GrepContentOutput
  | GrepFilesOutput
  | GrepCountOutput;

/**
 * KillBash tool output interface
 */
export interface KillBashToolOutput {
  /** Success message */
  message: string;
  /** ID of the killed shell */
  shell_id: string;
}

/**
 * NotebookEdit tool output interface
 */
export interface NotebookEditToolOutput {
  /** Success message */
  message: string;
  /** Type of edit performed */
  edit_type: 'replaced' | 'inserted' | 'deleted';
  /** Cell ID that was affected */
  cell_id?: string;
  /** Total cells in notebook after edit */
  total_cells: number;
}

/**
 * WebFetch tool output interface
 */
export interface WebFetchToolOutput {
  /** AI model's response to the prompt */
  response: string;
  /** URL that was fetched */
  url: string;
  /** Final URL after redirects */
  final_url?: string;
  /** HTTP status code */
  status_code?: number;
}

/**
 * WebSearch tool output interface
 */
export interface WebSearchToolOutput {
  /** Search results */
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    /** Additional metadata if available */
    metadata?: Record<string, unknown>;
  }>;
  /** Total number of results */
  total_results: number;
  /** The query that was searched */
  query: string;
}

/**
 * TodoWrite tool output interface
 */
export interface TodoWriteToolOutput {
  /** Success message */
  message: string;
  /** Current todo statistics */
  stats: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
  };
}

/**
 * ExitPlanMode tool output interface
 */
export interface ExitPlanModeToolOutput {
  /** Confirmation message */
  message: string;
  /** Whether user approved the plan */
  approved?: boolean;
}

/**
 * ListMcpResources tool output interface
 */
export interface ListMcpResourcesToolOutput {
  /** Available resources */
  resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    server: string;
  }>;
  /** Total number of resources */
  total: number;
}

/**
 * ReadMcpResource tool output interface
 */
export interface ReadMcpResourceToolOutput {
  /** Resource contents */
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
  /** Server that provided the resource */
  server: string;
}

// ============================================================================
// TOOL INPUT TYPE GUARDS
// ============================================================================

/**
 * Type guard for Read tool input
 */
export function isReadToolInput(input: unknown): input is ReadToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'file_path' in input &&
    typeof (input as ReadToolInput).file_path === 'string'
  );
}

/**
 * Type guard for Write tool input
 */
export function isWriteToolInput(input: unknown): input is WriteToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'file_path' in input &&
    typeof (input as WriteToolInput).file_path === 'string' &&
    'content' in input &&
    typeof (input as WriteToolInput).content === 'string'
  );
}

/**
 * Type guard for Edit tool input
 */
export function isEditToolInput(input: unknown): input is EditToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'file_path' in input &&
    typeof (input as EditToolInput).file_path === 'string' &&
    'old_string' in input &&
    typeof (input as EditToolInput).old_string === 'string' &&
    'new_string' in input &&
    typeof (input as EditToolInput).new_string === 'string'
  );
}

/**
 * Type guard for Bash tool input
 */
export function isBashToolInput(input: unknown): input is BashToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'command' in input &&
    typeof (input as BashToolInput).command === 'string'
  );
}

/**
 * Type guard for BashOutput tool input
 */
export function isBashOutputToolInput(
  input: unknown
): input is BashOutputToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'bash_id' in input &&
    typeof (input as BashOutputToolInput).bash_id === 'string'
  );
}

/**
 * Type guard for Grep tool input
 */
export function isGrepToolInput(input: unknown): input is GrepToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'pattern' in input &&
    typeof (input as GrepToolInput).pattern === 'string'
  );
}

/**
 * Type guard for Glob tool input
 */
export function isGlobToolInput(input: unknown): input is GlobToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'pattern' in input &&
    typeof (input as GlobToolInput).pattern === 'string'
  );
}

/**
 * Type guard for Task tool input
 */
export function isTaskToolInput(input: unknown): input is TaskToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'subagent_type' in input &&
    typeof (input as TaskToolInput).subagent_type === 'string'
  );
}

/**
 * Type guard for TaskOutput tool input
 */
export function isTaskOutputToolInput(
  input: unknown
): input is TaskOutputToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'task_id' in input &&
    typeof (input as TaskOutputToolInput).task_id === 'string'
  );
}

/**
 * Type guard for TaskStop tool input
 */
export function isTaskStopToolInput(
  input: unknown
): input is TaskStopToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    ('task_id' in input || 'shell_id' in input)
  );
}

/**
 * Type guard for KillShell tool input
 */
export function isKillShellToolInput(
  input: unknown
): input is KillShellToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'shell_id' in input &&
    typeof (input as KillShellToolInput).shell_id === 'string'
  );
}

/**
 * Type guard for WebFetch tool input
 */
export function isWebFetchToolInput(
  input: unknown
): input is WebFetchToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'url' in input &&
    typeof (input as WebFetchToolInput).url === 'string' &&
    'prompt' in input &&
    typeof (input as WebFetchToolInput).prompt === 'string'
  );
}

/**
 * Type guard for WebSearch tool input
 */
export function isWebSearchToolInput(
  input: unknown
): input is WebSearchToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'query' in input &&
    typeof (input as WebSearchToolInput).query === 'string'
  );
}

/**
 * Type guard for TodoWrite tool input
 */
export function isTodoWriteToolInput(
  input: unknown
): input is TodoWriteToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'todos' in input &&
    Array.isArray((input as TodoWriteToolInput).todos)
  );
}

/**
 * Type guard for AskUserQuestion tool input
 */
export function isAskUserQuestionToolInput(
  input: unknown
): input is AskUserQuestionToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'questions' in input &&
    Array.isArray((input as AskUserQuestionToolInput).questions)
  );
}

/**
 * Type guard for NotebookEdit tool input
 */
export function isNotebookEditToolInput(
  input: unknown
): input is NotebookEditToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'notebook_path' in input &&
    typeof (input as NotebookEditToolInput).notebook_path === 'string' &&
    'new_source' in input &&
    typeof (input as NotebookEditToolInput).new_source === 'string'
  );
}

/**
 * Type guard for ExitPlanMode tool input
 */
export function isExitPlanModeToolInput(
  input: unknown
): input is ExitPlanModeToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'plan' in input &&
    typeof (input as ExitPlanModeToolInput).plan === 'string'
  );
}

/**
 * Type guard for ListMcpResources tool input
 */
export function isListMcpResourcesToolInput(
  input: unknown
): input is ListMcpResourcesToolInput {
  return typeof input === 'object' && input !== null;
}

/**
 * Type guard for ReadMcpResource tool input
 */
export function isReadMcpResourceToolInput(
  input: unknown
): input is ReadMcpResourceToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'server' in input &&
    typeof (input as ReadMcpResourceToolInput).server === 'string' &&
    'uri' in input &&
    typeof (input as ReadMcpResourceToolInput).uri === 'string'
  );
}

/**
 * Type guard for LSP tool input
 */
export function isLSPToolInput(input: unknown): input is LSPToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'operation' in input &&
    'filePath' in input &&
    'line' in input &&
    'character' in input
  );
}

// ============================================================================
// TOOL OUTPUT TYPE GUARDS
// ============================================================================

/**
 * Type guard for Task tool output
 */
export function isTaskToolOutput(output: unknown): output is TaskToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'result' in output &&
    typeof (output as TaskToolOutput).result === 'string'
  );
}

/**
 * Type guard for Bash tool output
 */
export function isBashToolOutput(output: unknown): output is BashToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'output' in output &&
    'exitCode' in output
  );
}

/**
 * Type guard for Edit tool output
 */
export function isEditToolOutput(output: unknown): output is EditToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'message' in output &&
    'replacements' in output &&
    'file_path' in output
  );
}

/**
 * Type guard for Write tool output
 */
export function isWriteToolOutput(output: unknown): output is WriteToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'message' in output &&
    'bytes_written' in output &&
    'file_path' in output
  );
}

/**
 * Type guard for Glob tool output
 */
export function isGlobToolOutput(output: unknown): output is GlobToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'matches' in output &&
    Array.isArray((output as GlobToolOutput).matches) &&
    'count' in output
  );
}

/**
 * Type guard for Grep content output
 */
export function isGrepContentOutput(
  output: unknown
): output is GrepContentOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'matches' in output &&
    Array.isArray((output as GrepContentOutput).matches) &&
    'total_matches' in output
  );
}

/**
 * Type guard for Grep files output
 */
export function isGrepFilesOutput(output: unknown): output is GrepFilesOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'files' in output &&
    Array.isArray((output as GrepFilesOutput).files) &&
    'count' in output
  );
}

/**
 * Type guard for Grep count output
 */
export function isGrepCountOutput(output: unknown): output is GrepCountOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'counts' in output &&
    Array.isArray((output as GrepCountOutput).counts) &&
    'total' in output
  );
}

/**
 * Type guard for TodoWrite tool output
 */
export function isTodoWriteToolOutput(
  output: unknown
): output is TodoWriteToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'message' in output &&
    'stats' in output
  );
}

/**
 * Type guard for WebFetch tool output
 */
export function isWebFetchToolOutput(
  output: unknown
): output is WebFetchToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'response' in output &&
    'url' in output
  );
}

/**
 * Type guard for WebSearch tool output
 */
export function isWebSearchToolOutput(
  output: unknown
): output is WebSearchToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'results' in output &&
    Array.isArray((output as WebSearchToolOutput).results) &&
    'query' in output
  );
}

// ============================================================================
// UNION TYPES
// ============================================================================

/**
 * Union type of ALL tool input types
 */
export type ToolInput =
  | ReadToolInput
  | WriteToolInput
  | EditToolInput
  | BashToolInput
  | BashOutputToolInput
  | GrepToolInput
  | GlobToolInput
  | TaskToolInput
  | TaskOutputToolInput
  | TaskStopToolInput
  | KillShellToolInput
  | WebFetchToolInput
  | WebSearchToolInput
  | TodoWriteToolInput
  | AskUserQuestionToolInput
  | NotebookEditToolInput
  | ExitPlanModeToolInput
  | ListMcpResourcesToolInput
  | ReadMcpResourceToolInput
  | LSPToolInput;

/**
 * Union type of ALL tool output types
 */
export type ToolOutput =
  | TaskToolOutput
  | AskUserQuestionToolOutput
  | BashToolOutput
  | BashOutputToolOutput
  | EditToolOutput
  | ReadToolOutput
  | WriteToolOutput
  | GlobToolOutput
  | GrepToolOutput
  | KillBashToolOutput
  | NotebookEditToolOutput
  | WebFetchToolOutput
  | WebSearchToolOutput
  | TodoWriteToolOutput
  | ExitPlanModeToolOutput
  | ListMcpResourcesToolOutput
  | ReadMcpResourceToolOutput;

// ============================================================================
// TOOL NAME MAPPING
// ============================================================================

/**
 * Map of tool names to their input types
 * Enables type-safe tool input lookup
 */
export interface ToolInputMap {
  Read: ReadToolInput;
  Write: WriteToolInput;
  Edit: EditToolInput;
  Bash: BashToolInput;
  BashOutput: BashOutputToolInput;
  Grep: GrepToolInput;
  Glob: GlobToolInput;
  Task: TaskToolInput;
  TaskOutput: TaskOutputToolInput;
  TaskStop: TaskStopToolInput;
  KillShell: KillShellToolInput;
  WebFetch: WebFetchToolInput;
  WebSearch: WebSearchToolInput;
  TodoWrite: TodoWriteToolInput;
  AskUserQuestion: AskUserQuestionToolInput;
  NotebookEdit: NotebookEditToolInput;
  ExitPlanMode: ExitPlanModeToolInput;
  ListMcpResources: ListMcpResourcesToolInput;
  ReadMcpResource: ReadMcpResourceToolInput;
  LSP: LSPToolInput;
}

/**
 * Map of tool names to their output types
 * Enables type-safe tool output lookup
 */
export interface ToolOutputMap {
  Task: TaskToolOutput;
  AskUserQuestion: AskUserQuestionToolOutput;
  Bash: BashToolOutput;
  BashOutput: BashOutputToolOutput;
  Edit: EditToolOutput;
  Read: ReadToolOutput;
  Write: WriteToolOutput;
  Glob: GlobToolOutput;
  Grep: GrepToolOutput;
  KillShell: KillBashToolOutput;
  NotebookEdit: NotebookEditToolOutput;
  WebFetch: WebFetchToolOutput;
  WebSearch: WebSearchToolOutput;
  TodoWrite: TodoWriteToolOutput;
  ExitPlanMode: ExitPlanModeToolOutput;
  ListMcpResources: ListMcpResourcesToolOutput;
  ReadMcpResource: ReadMcpResourceToolOutput;
}

/**
 * Known tool names
 */
export type ToolName = keyof ToolInputMap;

/**
 * Get typed tool input for a specific tool
 */
export type GetToolInput<T extends ToolName> = ToolInputMap[T];

/**
 * Get typed tool output for a specific tool
 */
export type GetToolOutput<T extends keyof ToolOutputMap> = ToolOutputMap[T];
