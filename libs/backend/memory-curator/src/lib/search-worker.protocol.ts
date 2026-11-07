/**
 * Message protocol between the Electron main process (`SearchWorkerClient`)
 * and the SQLite search utility process (`search-worker.ts`).
 *
 * Both sides parse every inbound message with these schemas. Results are
 * validated per request kind, so a reply cannot resolve a request with the
 * shape of another one, and the parsed value is the typed result the caller
 * receives (no casts across the process boundary).
 */
import { z } from 'zod';
import { chunkId, memoryId } from './memory.types';
import { serializedWorkerErrorSchema } from './search-worker-error';

const MAX_QUERY_CHARS = 10_000;
/** Upper bound on texts the worker may ask the host to embed in one call. */
export const MAX_EMBED_TEXTS = 64;
/** Upper bound on rerank candidates (memory search sends at most limit * 4 = 200). */
export const MAX_RERANK_CANDIDATES = 400;

// ---------------------------------------------------------------------------
// Host -> worker
// ---------------------------------------------------------------------------

const requestId = z.number().int().positive();

export const searchWorkerInitSchema = z.object({
  kind: z.literal('init'),
  dbPath: z.string().min(1),
  vecPath: z.string().min(1).optional(),
  embedderDim: z.number().int().positive(),
  embedderModelId: z.string(),
  rerankAvailable: z.boolean(),
});
export type SearchWorkerInit = z.infer<typeof searchWorkerInitSchema>;

const symbolPageParamsSchema = z.object({
  workspaceRoot: z.string().nullable().optional(),
  query: z.string().max(MAX_QUERY_CHARS).optional(),
  kinds: z.array(z.string()).max(1000).optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().nonnegative().optional(),
});

/** Relative milliseconds remaining at send time; each receiver starts its own clock. */
const budgetMs = z.number().finite().nonnegative().max(60_000).optional();
const sentAtMs = z.number().finite().int().nonnegative().optional();

export const searchWorkerQuerySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('memory'),
    id: requestId,
    query: z.string().max(MAX_QUERY_CHARS),
    topK: z.number().int().min(1).max(50),
    workspaceRoot: z.string().nullable().optional(),
    budgetMs,
    sentAtMs,
  }),
  z.object({
    kind: z.literal('symbols'),
    id: requestId,
    query: z.string().max(MAX_QUERY_CHARS),
    topK: z.number().int().min(1).max(50),
    workspaceRoot: z.string().optional(),
    budgetMs,
    sentAtMs,
  }),
  z.object({
    kind: z.literal('symbol-page'),
    id: requestId,
    params: symbolPageParamsSchema,
    budgetMs,
    sentAtMs,
  }),
  z.object({
    kind: z.literal('list'),
    id: requestId,
    workspaceRoot: z.string(),
    limit: z.number().int().min(1).max(500),
    budgetMs,
    sentAtMs,
  }),
  z.object({
    kind: z.literal('chunks'),
    id: requestId,
    memoryId: z.string().min(1),
    budgetMs,
    sentAtMs,
  }),
]);
export type SearchWorkerQuery = z.infer<typeof searchWorkerQuerySchema>;
export type SearchWorkerQueryKind = SearchWorkerQuery['kind'];

/** Host answers to the worker's embed / rerank calls. */
export const searchWorkerHostReplySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('embed-result'),
    id: requestId,
    vectors: z.array(z.array(z.number())).max(MAX_EMBED_TEXTS),
  }),
  z.object({
    kind: z.literal('rerank-result'),
    id: requestId,
    ranked: z
      .array(z.object({ id: z.string(), score: z.number() }))
      .max(MAX_RERANK_CANDIDATES),
  }),
  z.object({
    kind: z.literal('host-call-failed'),
    id: requestId,
    message: z.string(),
    /** The host shed this optional call (its reranker is busy); not a failure. */
    busy: z.boolean().optional(),
  }),
]);
export type SearchWorkerHostReply = z.infer<typeof searchWorkerHostReplySchema>;

export const searchWorkerInboundSchema = z.union([
  searchWorkerInitSchema,
  searchWorkerQuerySchema,
  searchWorkerHostReplySchema,
]);
export type SearchWorkerInbound = z.infer<typeof searchWorkerInboundSchema>;

// ---------------------------------------------------------------------------
// Worker -> host
// ---------------------------------------------------------------------------

export const searchWorkerLogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type SearchWorkerLogLevel = z.infer<typeof searchWorkerLogLevelSchema>;

export const searchWorkerOutboundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready'), vecLoaded: z.boolean() }),
  z.object({ kind: z.literal('init-failed'), message: z.string() }),
  z.object({ kind: z.literal('result'), id: requestId, result: z.unknown() }),
  z.object({ kind: z.literal('error'), id: requestId, message: z.string() }),
  z.object({
    kind: z.literal('log'),
    level: searchWorkerLogLevelSchema,
    message: z.string(),
    /** Set when the worker logged an `Error`; the host rebuilds a real one. */
    error: serializedWorkerErrorSchema.optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('embed'),
    id: requestId,
    budgetMs,
    texts: z.array(z.string()).max(MAX_EMBED_TEXTS),
    sentAtMs,
  }),
  z.object({
    kind: z.literal('rerank'),
    id: requestId,
    budgetMs,
    sentAtMs,
    query: z.string().max(MAX_QUERY_CHARS),
    candidates: z
      .array(z.object({ id: z.string(), text: z.string() }))
      .max(MAX_RERANK_CANDIDATES),
    topK: z.number().int().positive(),
  }),
]);
export type SearchWorkerOutbound = z.infer<typeof searchWorkerOutboundSchema>;

// ---------------------------------------------------------------------------
// Result payloads, one schema per query kind
// ---------------------------------------------------------------------------

const nullableString = z.string().nullable();

const memorySchema = z.object({
  id: z.string().min(1).transform(memoryId),
  sessionId: nullableString,
  workspaceRoot: nullableString,
  tier: z.enum(['core', 'recall', 'archival']),
  kind: z.enum(['fact', 'preference', 'event', 'entity']),
  subject: nullableString,
  content: z.string(),
  sourceMessageIds: z.array(z.string()),
  salience: z.number(),
  decayRate: z.number(),
  hits: z.number(),
  pinned: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastUsedAt: z.number(),
  expiresAt: z.number().nullable(),
  request: nullableString,
  investigated: nullableString,
  learned: nullableString,
  completed: nullableString,
  nextSteps: nullableString,
  type: z.enum(['bugfix', 'feature', 'decision', 'discovery', 'refactor', 'change']),
  concepts: z.array(z.string()),
  files: z.array(z.string()),
});

const memoryChunkSchema = z.object({
  id: z.string().min(1).transform(chunkId),
  memoryId: z.string().min(1).transform(memoryId),
  ord: z.number(),
  text: z.string(),
  tokenCount: z.number(),
  createdAt: z.number(),
});

/** What a tolerant array reports about the rows it dropped. */
export interface DroppedRowsReport {
  readonly kind: SearchWorkerQueryKind;
  readonly dropped: number;
  readonly kept: number;
  readonly issue: string | undefined;
  readonly path: string | undefined;
}

export type DroppedRowsReporter = (report: DroppedRowsReport) => void;

/**
 * An array whose invalid rows are dropped and reported instead of failing the
 * whole result: one row with a value the schema does not know (the DB has no
 * CHECK on `memories.type`, for example) must not blank a search page.
 */
function tolerantArray<T extends z.ZodType>(
  item: T,
  kind: SearchWorkerQueryKind,
  report: DroppedRowsReporter,
) {
  return z.array(z.unknown()).transform((rows) => {
    const kept: Array<z.output<T>> = [];
    let first: z.ZodError['issues'][number] | undefined;
    for (const row of rows) {
      const parsed = item.safeParse(row);
      if (parsed.success) kept.push(parsed.data);
      else first ??= parsed.error.issues[0];
    }
    const dropped = rows.length - kept.length;
    if (dropped > 0) {
      report({
        kind,
        dropped,
        kept: kept.length,
        issue: first?.message,
        path: first?.path.map(String).join('.'),
      });
    }
    return kept;
  });
}

const memoryHitSchema = z.object({
  memory: memorySchema,
  chunk: memoryChunkSchema,
  score: z.number(),
  bm25Rank: z.number().nullable(),
  vecRank: z.number().nullable(),
});

const codeSymbolHitSchema = z.object({
  id: z.string(),
  workspaceRoot: z.string(),
  filePath: z.string(),
  kind: z.string(),
  symbolName: z.string(),
  subject: z.string(),
  text: z.string(),
  tokenCount: z.number(),
  score: z.number(),
});

const codeSymbolItemSchema = z.object({
  id: z.string(),
  workspaceRoot: z.string(),
  filePath: z.string(),
  kind: z.string(),
  symbolName: z.string(),
  subject: z.string(),
  tokenCount: z.number(),
  updatedAt: z.number(),
});

const memoryListItemSchema = z.object({
  id: z.string(),
  subject: nullableString,
  content: z.string(),
  tier: z.string(),
  kind: z.string(),
  salience: z.number(),
  createdAt: z.number(),
});

/**
 * Result schema for each query kind. Row arrays are tolerant: a row that
 * fails its schema is dropped and passed to `report`; the envelope itself
 * (`bm25Only`, `total`) still has to be valid.
 */
export function createSearchWorkerResultSchemas(report: DroppedRowsReporter) {
  return {
    memory: z.object({ hits: tolerantArray(memoryHitSchema, 'memory', report), bm25Only: z.boolean() }),
    symbols: z.object({ hits: tolerantArray(codeSymbolHitSchema, 'symbols', report), bm25Only: z.boolean() }),
    'symbol-page': z.object({
      items: tolerantArray(codeSymbolItemSchema, 'symbol-page', report),
      total: z.number(),
    }),
    list: z.object({ memories: tolerantArray(memoryListItemSchema, 'list', report), total: z.number() }),
    chunks: tolerantArray(memoryChunkSchema, 'chunks', report),
  } as const;
}

export type SearchWorkerResultSchemas = ReturnType<typeof createSearchWorkerResultSchemas>;

/** Parsed result type for each query kind. */
export type SearchWorkerResultMap = {
  readonly [K in SearchWorkerQueryKind]: z.output<SearchWorkerResultSchemas[K]>;
};

/**
 * JSON-safe copy of a non-error log context. Structured clone rejects
 * functions and class instances with native handles, which would turn a log
 * call into a worker crash; anything that does not survive JSON is replaced
 * by a marker. An `Error` goes through `serializeWorkerError` instead.
 */
export function toTransferableLogContext(
  context: unknown,
): Record<string, unknown> | undefined {
  if (context === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(context) ?? 'null');
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed));
    }
    return { value: parsed };
  } catch (error: unknown) {
    return {
      unserializableContext: error instanceof Error ? error.message : String(error),
    };
  }
}
