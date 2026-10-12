/**
 * The product read path the read-side suites measure (benchmark-design.md
 * 3.3-3.5), as one narrow port so the suites stay pure over it and the specs
 * never boot an engine.
 *
 * {@link containerReadSidePort} resolves the real services from the bench host
 * container. Tokens are the product's own interned `Symbol.for` keys, resolved
 * without value-importing `@ptah-extension/memory-curator` (only host-only
 * modules may load that barrel, `host-only-imports.spec.ts`):
 *   - `PtahMemoryStore`         `libs/backend/memory-curator/src/lib/di/tokens.ts:15`
 *   - `PtahMemorySearch`        `libs/backend/memory-curator/src/lib/di/tokens.ts:13`
 *   - `SdkMemoryPromptInjector` `libs/backend/agent-sdk/src/lib/di/tokens.ts:118`
 *   - `PtahSqliteConnection`    `libs/backend/persistence-sqlite/src/lib/di/tokens.ts:12`
 *
 * The OR baseline runs the pinned pre-473 builder (`fts-or-query.ts`) through
 * the same SQL shape as the product's BM25 leg (`memory-search.service.ts:437-470`:
 * FTS5 MATCH, quarantine predicate, exact `workspace_root IS ?` scope, bm25
 * order), so the only difference is the MATCH expression.
 */

import type { BenchHostContainer } from '../../../transport/bench-host-boot';
import { buildFtsOrQuery } from '../../baselines/fts-or-query';

/** One `searchRich` hit as the suites read it. */
export interface ReadSideHit {
  readonly memoryId: string;
  readonly subject: string | null;
  readonly chunkText: string;
  readonly score: number;
}

/** One stored chunk with its memory row, for relevance labelling. */
export interface ReadSideRow {
  readonly memoryId: string;
  readonly subject: string | null;
  readonly content: string;
  readonly chunkText: string;
}

export interface ReadSidePort {
  /** Store one memory with one chunk under the exact `workspaceRoot` key. */
  insertRow(workspaceRoot: string, content: string): Promise<string>;
  /** Every active chunk stored under the exact `workspaceRoot` key. */
  listRows(workspaceRoot: string): Promise<readonly ReadSideRow[]>;
  /** The product's hybrid search (`MemorySearchService.searchRich`). */
  searchRich(
    query: string,
    topK: number,
    workspaceRoot: string,
  ): Promise<{
    readonly hits: readonly ReadSideHit[];
    readonly bm25Only: boolean;
  }>;
  /** BM25 over the same index with the pinned pre-473 OR expression; memory ids in rank order. */
  searchFtsOr(
    query: string,
    topK: number,
    workspaceRoot: string,
  ): Promise<readonly string[]>;
  /** `MemoryPromptInjector.buildBlock` (mid-session recall). */
  buildBlock(query: string, workspaceRoot: string): Promise<string>;
  /** `MemoryPromptInjector.buildSessionStartBlock` (session-start roster). */
  buildSessionStartBlock(workspaceRoot: string): Promise<string>;
}

/** The structural slices of the product services the port calls. */
interface MemoryStoreSlice {
  insertMemoryWithChunks(
    insert: {
      readonly workspaceRoot: string;
      readonly tier: 'recall';
      readonly kind: 'fact';
      readonly subject: null;
      readonly content: string;
    },
    chunks: readonly {
      readonly ord: number;
      readonly text: string;
      readonly tokenCount: number;
    }[],
  ): Promise<string>;
}

interface MemorySearchSlice {
  searchRich(
    query: string,
    topK: number,
    workspaceRoot: string,
  ): Promise<{
    readonly hits: readonly {
      readonly memory: { readonly id: string; readonly subject: string | null };
      readonly chunk: { readonly text: string };
      readonly score: number;
    }[];
    readonly bm25Only: boolean;
  }>;
}

interface PromptInjectorSlice {
  buildBlock(query: string, workspaceRoot?: string): Promise<string>;
  buildSessionStartBlock(workspaceRoot?: string): Promise<string>;
}

interface SqliteSlice {
  readonly db: {
    prepare(sql: string): { all(...params: unknown[]): unknown[] };
  };
}

const TOKENS = {
  memoryStore: Symbol.for('PtahMemoryStore'),
  memorySearch: Symbol.for('PtahMemorySearch'),
  promptInjector: Symbol.for('SdkMemoryPromptInjector'),
  sqlite: Symbol.for('PtahSqliteConnection'),
} as const;

/** A product service the port needs is not registered in the bench container. */
export class ReadSidePortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadSidePortError';
  }
}

function resolveService<T>(container: BenchHostContainer, token: symbol): T {
  if (!container.isRegistered(token, true)) {
    throw new ReadSidePortError(
      `the bench host container has no ${token.description ?? String(token)}`,
    );
  }
  return container.resolve<T>(token);
}

/** Rough token count for a stored chunk; the store only persists it. */
function tokenCountOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

const LIST_ROWS_SQL = `
  SELECT m.id AS memory_id, m.subject AS subject, m.content AS content,
         mc.text AS text
  FROM memories m
  JOIN memory_chunks mc ON mc.memory_id = m.id
  WHERE m.workspace_root IS ? AND m.quarantined_at IS NULL
  ORDER BY m.id ASC, mc.ord ASC
`;

const OR_SEARCH_SQL = `
  SELECT mc.memory_id AS memory_id
  FROM memory_chunks_fts fts
  JOIN memory_chunks mc ON mc.rowid = fts.rowid
  JOIN memories m ON m.id = mc.memory_id
  WHERE memory_chunks_fts MATCH ?
  AND m.quarantined_at IS NULL
  AND m.workspace_root IS ?
  ORDER BY bm25(memory_chunks_fts) ASC
  LIMIT ?
`;

interface ListedRow {
  readonly memory_id: string;
  readonly subject: string | null;
  readonly content: string;
  readonly text: string;
}

/** Memory ids in first-seen order: relevance is judged per memory, not per chunk. */
export function distinctInOrder(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** The real port over the bench host container. Throws {@link ReadSidePortError}. */
export function containerReadSidePort(
  container: BenchHostContainer,
): ReadSidePort {
  const store = resolveService<MemoryStoreSlice>(container, TOKENS.memoryStore);
  const search = resolveService<MemorySearchSlice>(
    container,
    TOKENS.memorySearch,
  );
  const injector = resolveService<PromptInjectorSlice>(
    container,
    TOKENS.promptInjector,
  );
  const sqlite = resolveService<SqliteSlice>(container, TOKENS.sqlite);
  return {
    insertRow: (workspaceRoot, content) =>
      store.insertMemoryWithChunks(
        { workspaceRoot, tier: 'recall', kind: 'fact', subject: null, content },
        [{ ord: 0, text: content, tokenCount: tokenCountOf(content) }],
      ),
    listRows: async (workspaceRoot) =>
      (sqlite.db.prepare(LIST_ROWS_SQL).all(workspaceRoot) as ListedRow[]).map(
        (row) => ({
          memoryId: row.memory_id,
          subject: row.subject,
          content: row.content,
          chunkText: row.text,
        }),
      ),
    searchRich: async (query, topK, workspaceRoot) => {
      const response = await search.searchRich(query, topK, workspaceRoot);
      return {
        bm25Only: response.bm25Only,
        hits: response.hits.map((hit) => ({
          memoryId: hit.memory.id,
          subject: hit.memory.subject,
          chunkText: hit.chunk.text,
          score: hit.score,
        })),
      };
    },
    searchFtsOr: async (query, topK, workspaceRoot) => {
      const rows = sqlite.db
        .prepare(OR_SEARCH_SQL)
        .all(buildFtsOrQuery(query), workspaceRoot, topK * 4) as {
        memory_id: string;
      }[];
      return distinctInOrder(rows.map((row) => row.memory_id)).slice(0, topK);
    },
    buildBlock: (query, workspaceRoot) =>
      injector.buildBlock(query, workspaceRoot),
    buildSessionStartBlock: (workspaceRoot) =>
      injector.buildSessionStartBlock(workspaceRoot),
  };
}
