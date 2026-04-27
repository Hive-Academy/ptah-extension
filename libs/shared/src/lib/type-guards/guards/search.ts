// Search domain tool types and guards.
// Tools: Grep, Glob.
// Extracted from tool-input-guards.ts (TASK_2025_291 Wave C2) — zero behavior change.

// --- TOOL INPUT TYPES ---
/** Grep tool input — Tool: Grep (search file contents). */
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
/** Glob tool input — Tool: Glob (find files by pattern). */
export interface GlobToolInput {
  /** The glob pattern to match files against */
  pattern: string;
  /** The directory to search in (defaults to cwd) */
  path?: string;
}

// --- TOOL OUTPUT TYPES ---
/** Glob tool output interface */
export interface GlobToolOutput {
  /** Array of matching file paths */
  matches: string[];
  /** Number of matches found */
  count: number;
  /** Search directory used */
  search_path: string;
}
/** Grep tool output — Content mode */
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
/** Grep tool output — Files mode */
export interface GrepFilesOutput {
  /** Files containing matches */
  files: string[];
  /** Number of files with matches */
  count: number;
}
/** Grep tool output — Count mode */
export interface GrepCountOutput {
  /** Match counts per file */
  counts: Array<{
    file: string;
    count: number;
  }>;
  /** Total matches across all files */
  total: number;
}
/** Grep tool output — Union type */
export type GrepToolOutput =
  | GrepContentOutput
  | GrepFilesOutput
  | GrepCountOutput;

// --- TOOL INPUT TYPE GUARDS ---
/** Type guard for Grep tool input */
export function isGrepToolInput(input: unknown): input is GrepToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'pattern' in input &&
    typeof (input as GrepToolInput).pattern === 'string'
  );
}
/** Type guard for Glob tool input */
export function isGlobToolInput(input: unknown): input is GlobToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'pattern' in input &&
    typeof (input as GlobToolInput).pattern === 'string'
  );
}

// --- TOOL OUTPUT TYPE GUARDS ---
/** Type guard for Glob tool output */
export function isGlobToolOutput(output: unknown): output is GlobToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'matches' in output &&
    Array.isArray((output as GlobToolOutput).matches) &&
    'count' in output
  );
}
/** Type guard for Grep content output */
export function isGrepContentOutput(
  output: unknown,
): output is GrepContentOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'matches' in output &&
    Array.isArray((output as GrepContentOutput).matches) &&
    'total_matches' in output
  );
}
/** Type guard for Grep files output */
export function isGrepFilesOutput(output: unknown): output is GrepFilesOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'files' in output &&
    Array.isArray((output as GrepFilesOutput).files) &&
    'count' in output
  );
}
/** Type guard for Grep count output */
export function isGrepCountOutput(output: unknown): output is GrepCountOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'counts' in output &&
    Array.isArray((output as GrepCountOutput).counts) &&
    'total' in output
  );
}
