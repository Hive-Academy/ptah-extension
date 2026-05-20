export interface SymbolChunkInsert {
  /** Normalized: "code:<kind>:<absoluteFilePath>:<symbolName>" */
  readonly subject: string;
  /** Chunk text for embedding: "<kind> <name> in <relPath>:<startLine>-<endLine>" */
  readonly text: string;
  readonly tokenCount: number;
  readonly filePath: string;
  readonly workspaceRoot: string;
}

export interface ISymbolSink {
  /**
   * Delete all symbol chunks for a given file + workspace before re-indexing.
   * Returns count of deleted memory rows.
   */
  deleteSymbolsForFile(filePath: string, workspaceRoot: string): number;

  /**
   * Insert a batch of symbol chunks as memory entries (kind='entity', tier='archival').
   * Each chunk becomes a separate memory row with a single chunk.
   */
  insertSymbols(chunks: readonly SymbolChunkInsert[]): Promise<void>;
}
