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

export const searchWorkerQuerySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('memory'),
    id: requestId,
    query: z.string().max(MAX_QUERY_CHARS),
    topK: z.number().int().min(1).max(50),
    workspaceRoot: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal('symbols'),
    id: requestId,
    query: z.string().max(MAX_QUERY_CHARS),
    topK: z.number().int().min(1).max(50),
    workspaceRoot: z.string().optional(),
  }),
  z.object({
    kind: z.literal('symbol-page'),
    id: requestId,
    params: symbolPageParamsSchema,
  }),
  z.object({
    kind: z.literal('list'),
    id: requestId,
    workspaceRoot: z.string(),
    limit: z.number().int().min(1).max(500),
  }),
  z.object({
    kind: z.literal('chunks'),
    id: requestId,
    memoryId: z.string().min(1),
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
    context: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('embed'),
    id: requestId,
    texts: z.array(z.string()).max(MAX_EMBED_TEXTS),
  }),
  z.object({
    kind: z.literal('rerank'),
    id: requestId,
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

const memorySearchResponseSchema = z.object({
  hits: z.array(
    z.object({
      memory: memorySchema,
      chunk: memoryChunkSchema,
      score: z.number(),
      bm25Rank: z.number().nullable(),
      vecRank: z.number().nullable(),
    }),
  ),
  bm25Only: z.boolean(),
});

const codeSymbolHitPageSchema = z.object({
  hits: z.array(
    z.object({
      id: z.string(),
      workspaceRoot: z.string(),
      filePath: z.string(),
      kind: z.string(),
      symbolName: z.string(),
      subject: z.string(),
      text: z.string(),
      tokenCount: z.number(),
      score: z.number(),
    }),
  ),
  bm25Only: z.boolean(),
});

const codeSymbolSearchResultSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      workspaceRoot: z.string(),
      filePath: z.string(),
      kind: z.string(),
      symbolName: z.string(),
      subject: z.string(),
      tokenCount: z.number(),
      updatedAt: z.number(),
    }),
  ),
  total: z.number(),
});

const memoryListPageSchema = z.object({
  memories: z.array(
    z.object({
      id: z.string(),
      subject: nullableString,
      content: z.string(),
      tier: z.string(),
      kind: z.string(),
      salience: z.number(),
      createdAt: z.number(),
    }),
  ),
  total: z.number(),
});

/** Result schema for each query kind. */
export const searchWorkerResultSchemas = {
  memory: memorySearchResponseSchema,
  symbols: codeSymbolHitPageSchema,
  'symbol-page': codeSymbolSearchResultSchema,
  list: memoryListPageSchema,
  chunks: z.array(memoryChunkSchema),
} as const;

/** Parsed result type for each query kind. */
export type SearchWorkerResultMap = {
  readonly [K in SearchWorkerQueryKind]: z.output<(typeof searchWorkerResultSchemas)[K]>;
};

/**
 * JSON-safe copy of a log context. Structured clone rejects functions and
 * class instances with native handles, which would turn a log call into a
 * worker crash; anything that does not survive JSON is replaced by a marker.
 */
export function toTransferableLogContext(
  context: unknown,
): Record<string, unknown> | undefined {
  if (context === undefined) return undefined;
  if (context instanceof Error) {
    return { error: context.message, errorName: context.name };
  }
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
