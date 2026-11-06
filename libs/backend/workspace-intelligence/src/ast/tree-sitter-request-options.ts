/**
 * Per-call options for `TreeSitterParserService` parse and query methods.
 *
 * `priority` only matters when the host parses in the tree-sitter worker
 * (Electron): foreground requests are served before queued background work
 * and wait at most a short deadline. Interactive callers (MCP tools, LSP
 * lookups, diagnostics, enrichment) keep the default `foreground`; bulk
 * callers (the code-symbol indexer, dependency-graph builds) pass
 * `background`. The in-process engine ignores it.
 */
export type TreeSitterPriority = 'foreground' | 'background';

export interface TreeSitterRequestOptions {
  readonly priority?: TreeSitterPriority;
}

/** The options every bulk caller passes. */
export const BACKGROUND_PARSE: TreeSitterRequestOptions = {
  priority: 'background',
};
