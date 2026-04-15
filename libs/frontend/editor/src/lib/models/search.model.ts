/**
 * Search Model Types
 *
 * Defines interfaces for multi-file text search functionality.
 * Used by SearchPanelComponent for UI rendering and by the
 * editor:searchInFiles RPC method for backend communication.
 *
 * TASK_2025_283 Batch 1, Task 1.4
 */

/** A single text match within a file. */
export interface SearchMatch {
  /** 1-based line number where the match occurs */
  line: number;
  /** 1-based column position of the match start */
  column: number;
  /** The text content of the line (trimmed to 200 chars max) */
  lineText: string;
  /** Length of the matched text in characters */
  matchLength: number;
}

/** A file containing one or more search matches. */
export interface SearchFileResult {
  /** Absolute path to the file */
  filePath: string;
  /** Base file name (e.g., 'editor.service.ts') */
  fileName: string;
  /** Path relative to the workspace root (e.g., 'libs/frontend/editor/src/editor.service.ts') */
  relativePath: string;
  /** Array of matches found in this file */
  matches: SearchMatch[];
}

/** Parameters for the editor:searchInFiles RPC call. */
export interface SearchInFilesParams {
  /** The search query text or regex pattern */
  query: string;
  /** Whether the query should be treated as a regular expression */
  isRegex: boolean;
  /** Whether the search should be case-sensitive */
  caseSensitive: boolean;
  /** Maximum number of files to return results for (default: 50) */
  maxFileResults?: number;
  /** Maximum number of matches to return per file (default: 20) */
  maxMatchesPerFile?: number;
}

/** Result of the editor:searchInFiles RPC call. */
export interface SearchInFilesResult {
  /** Array of files containing matches */
  files: SearchFileResult[];
  /** True if results were capped and more matches exist */
  truncated: boolean;
  /** Total number of matches across all returned files */
  totalMatches: number;
}
