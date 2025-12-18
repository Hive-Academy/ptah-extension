/**
 * Type Guards for Tool Inputs
 *
 * TASK_2025_088 Batch 5 Task 5.2: Type-safe tool input access
 *
 * Provides type guards for various tool types to replace unsafe
 * bracket notation access like toolInput?.['file_path'] with
 * type-safe property access after type narrowing.
 *
 * Usage:
 * ```typescript
 * if (isReadToolInput(toolInput)) {
 *   const path = toolInput.file_path; // Type-safe!
 * }
 * ```
 */

/**
 * Read tool input interface
 * Tool: Read - Read file contents
 */
export interface ReadToolInput {
  file_path: string;
  limit?: number;
  offset?: number;
}

/**
 * Write tool input interface
 * Tool: Write - Write file contents
 */
export interface WriteToolInput {
  file_path: string;
  content: string;
}

/**
 * Edit tool input interface
 * Tool: Edit - Edit file contents
 */
export interface EditToolInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/**
 * Bash tool input interface
 * Tool: Bash - Execute bash command
 */
export interface BashToolInput {
  command: string;
  description?: string;
  timeout?: number;
  dangerouslyDisableSandbox?: boolean;
  run_in_background?: boolean;
}

/**
 * Grep tool input interface
 * Tool: Grep - Search file contents
 */
export interface GrepToolInput {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  '-i'?: boolean;
  '-n'?: boolean;
  '-A'?: number;
  '-B'?: number;
  '-C'?: number;
  multiline?: boolean;
  head_limit?: number;
  offset?: number;
}

/**
 * Glob tool input interface
 * Tool: Glob - Find files by pattern
 */
export interface GlobToolInput {
  pattern: string;
  path?: string;
}

/**
 * Task tool input interface
 * Tool: Task - Invoke subagent
 */
export interface TaskToolInput {
  subagent_type?: string;
  description?: string;
  prompt?: string;
}

/**
 * WebFetch tool input interface
 * Tool: WebFetch - Fetch web content
 */
export interface WebFetchToolInput {
  url: string;
  prompt: string;
}

/**
 * WebSearch tool input interface
 * Tool: WebSearch - Search the web
 */
export interface WebSearchToolInput {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

// ============================================================================
// TYPE GUARDS
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
    ('subagent_type' in input || 'description' in input || 'prompt' in input)
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

// ============================================================================
// HELPER TYPE: Union of all tool inputs
// ============================================================================

/**
 * Union type of all known tool inputs
 */
export type ToolInput =
  | ReadToolInput
  | WriteToolInput
  | EditToolInput
  | BashToolInput
  | GrepToolInput
  | GlobToolInput
  | TaskToolInput
  | WebFetchToolInput
  | WebSearchToolInput;
