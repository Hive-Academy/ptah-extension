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

export interface ICodeSymbolReader {
  searchSymbols(
    query: string,
    topK?: number,
    workspaceRoot?: string,
  ): Promise<CodeSymbolHitPage>;
}
