/**
 * Agent Card Types
 *
 * Shared type definitions for the agent card component family.
 */

/**
 * Unified output segment for rendering.
 * Superset of CliOutputSegment (from shared) + fallback-only types (heading, stderr-info, tool).
 * Using a single interface avoids union-narrowing issues in Angular's strict template checker.
 */
export interface RenderSegment {
  readonly type:
    | 'text'
    | 'thinking'
    | 'tool-call'
    | 'tool-result'
    | 'tool-result-error'
    | 'error'
    | 'info'
    | 'command'
    | 'file-change'
    | 'heading'
    | 'stderr-info'
    | 'tool';
  readonly content: string;
  readonly toolName?: string;
  readonly toolArgs?: string;
  readonly exitCode?: number;
  readonly changeKind?: string;
  readonly toolCallId?: string;
}

/** Parsed stderr segment — informational vs actual error */
export interface StderrSegment {
  type: 'info' | 'error';
  content: string;
}
