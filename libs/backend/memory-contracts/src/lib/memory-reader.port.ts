export interface MemoryHit {
  readonly memoryId: string;
  readonly subject: string | null;
  readonly content: string;
  readonly chunkText: string;
  readonly score: number;
  readonly tier: string;
}

export interface MemoryHitPage {
  readonly hits: readonly MemoryHit[];
  readonly bm25Only: boolean;
}

export interface MemoryRecord {
  readonly id: string;
  readonly subject: string | null;
  readonly content: string;
  readonly tier: string;
  readonly kind: string;
  readonly salience: number;
  readonly createdAt: number;
}

export interface MemoryListPage {
  readonly memories: readonly MemoryRecord[];
  readonly total: number;
}

export interface IMemoryReader {
  search(
    query: string,
    topK?: number,
    workspaceRoot?: string,
  ): Promise<MemoryHitPage>;
}

export interface IMemoryLister {
  listAll(
    workspaceRoot?: string,
    tier?: string,
    limit?: number,
    offset?: number,
  ): MemoryListPage;
}
