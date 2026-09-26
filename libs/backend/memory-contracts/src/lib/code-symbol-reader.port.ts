export interface CodeSymbolHit {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly filePath: string;
  readonly kind: string;
  readonly symbolName: string;
  readonly subject: string;
  readonly text: string;
  readonly tokenCount: number;
  readonly score: number;
}

export interface CodeSymbolHitPage {
  readonly hits: readonly CodeSymbolHit[];
  readonly bm25Only: boolean;
}

/** How current the code-symbol index is for one workspace root. */
export interface CodeIndexFreshness {
  /** Number of indexed symbols under the workspace root; 0 when nothing is indexed. */
  readonly symbolCount: number;
  /** Newest `updated_at` (epoch ms) under the workspace root; `null` when `symbolCount` is 0. */
  readonly newestUpdatedAt: number | null;
}

export interface ICodeSymbolReader {
  searchSymbols(
    query: string,
    topK?: number,
    workspaceRoot?: string,
  ): Promise<CodeSymbolHitPage>;

  /**
   * Optional: a reader that cannot report freshness omits it, and callers treat
   * the absence as "unknown freshness" (never as "stale").
   */
  getIndexFreshness?(workspaceRoot: string): Promise<CodeIndexFreshness>;
}
