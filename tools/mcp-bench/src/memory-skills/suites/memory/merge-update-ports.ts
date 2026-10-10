/**
 * The product collaborators the Batch 18 memory suites (`mem.dedup`,
 * `mem.dedup.rerank`, `mem.update`, `mem.temporal`, `mem.update.seed`) drive,
 * resolved from the bench host's booted container (benchmark-design.md 3.2,
 * 3.3). The suites only see the {@link MergeUpdatePorts} shape, so their specs
 * run on in-memory fakes and never boot an engine.
 *
 * HOST-ONLY: this module value-imports the memory-curator barrel (tsyringe,
 * vscode-core), so it is listed in `../../host-only-imports.spec.ts` and only
 * the host entry wires it (`createDedupSuites(resolveMergeUpdatePorts)`).
 *
 * Every adapter below calls the product method the curator itself calls, with
 * the arguments it passes (file:line on each), so a suite measures the
 * product rather than a copy of it:
 *   - `collectCandidates` is the curator's own `MergeCandidateCollector`
 *     instance. The collector is not exported from the barrel and has no
 *     public seam; it is read from the singleton `MemoryCuratorService`'s
 *     `mergeCandidates` field and checked at runtime, so a product refactor
 *     fails the suite loudly instead of measuring a stale copy;
 *   - `insertRow` / `appendToRow` / `mergeTarget` are the commit loop's store
 *     calls (`memory-curator.service.ts:836-889`, `:957-960`);
 *   - `reranker` is the embedder worker client, found exactly as
 *     `MemorySearchService` finds it (`memory-search.service.ts:433-435`).
 */

import type {
  ExtractedMemoryDraft,
  ICuratorLLM,
} from '@ptah-extension/memory-contracts';
import {
  baseSalience,
  EmbedderWorkerClient,
  MEMORY_TOKENS,
  memoryId,
  planCuratorWindows,
  type MemoryCuratorService,
  type MemorySearchService,
  type MemoryStore,
} from '@ptah-extension/memory-curator';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import {
  PLATFORM_TOKENS,
  type IMemoryWriter,
  type MemoryWriteRequest,
  type MemoryWriteResult,
} from '@ptah-extension/platform-core';
import { z } from 'zod';

import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';

/**
 * `SDK_TOKENS.SDK_MEMORY_PROMPT_INJECTOR` (`agent-sdk/src/lib/di/tokens.ts:118`).
 * Read through the global symbol registry instead of the agent-sdk barrel,
 * which would load the whole SDK into this module and its specs.
 */
const SDK_MEMORY_PROMPT_INJECTOR = Symbol.for('SdkMemoryPromptInjector');

/** A candidate row as the resolve call receives it (`ICuratorLLM.resolve`). */
export interface MergeCandidateView {
  readonly id: string;
  readonly subject: string | null;
  readonly content: string;
}

/** `MergeCandidateSet` (`merge-candidate-collector.ts:125-132`). */
export interface MergeCandidateCollection {
  readonly candidates: readonly MergeCandidateView[];
  readonly tier1Count: number;
  readonly tier2Count: number;
  readonly tier2Queries: number;
  readonly bm25Only: boolean;
  readonly tier2Skipped: string | null;
}

/** One active row of a workspace scope. */
export interface PortRow {
  readonly id: string;
  readonly subject: string | null;
}

/** One `searchRich` hit, reduced to what the suites read. */
export interface PortHit {
  readonly memoryId: string;
  readonly subject: string | null;
  readonly chunkText: string;
  /** Epoch ms the chunk was written (`memory_chunks.created_at`). */
  readonly chunkCreatedAt: number;
  /** Fused RRF score; the reranker reorders without changing it. */
  readonly score: number;
  readonly bm25Rank: number | null;
  readonly vecRank: number | null;
}

export interface RerankPort {
  rerank(
    query: string,
    candidates: ReadonlyArray<{ id: string; text: string }>,
    topK: number,
  ): Promise<ReadonlyArray<{ id: string; score: number }>>;
}

export interface MergeUpdatePorts {
  /**
   * The commit loop's insert (`memory-curator.service.ts:860-889`), every
   * field taken from the resolved draft. `salienceBoost` is not passed: the
   * planted sessions model a plain curate with no boost.
   */
  insertRow(row: {
    readonly sessionId: string;
    readonly workspaceRoot: string;
    readonly draft: ExtractedMemoryDraft;
  }): Promise<string>;
  /** The commit loop's merge append (`memory-curator.service.ts:836-846`). */
  appendToRow(
    id: string,
    text: string,
    workspaceRoot: string,
  ): Promise<'appended' | 'ineligible'>;
  /** `MemoryStore.getMergeTarget` (`memory.store.ts:365-372`). */
  mergeTarget(id: string, workspaceRoot: string): string | null;
  /** Active rows of one scope. */
  listRows(workspaceRoot: string): readonly PortRow[];
  searchRich(
    query: string,
    topK: number,
    workspaceRoot: string,
  ): Promise<{ readonly hits: readonly PortHit[]; readonly bm25Only: boolean }>;
  /** The curator's own collector (`memory-curator.service.ts:776-780`). */
  collectCandidates(
    drafts: readonly ExtractedMemoryDraft[],
    workspaceRoot: string,
    signal?: AbortSignal,
  ): Promise<MergeCandidateCollection>;
  /** The record/replay double installed for `CURATOR_LLM`. */
  readonly curator: Pick<ICuratorLLM, 'extract' | 'resolve'>;
  /** `MemoryPromptInjector.buildBlock` (`memory-prompt-injector.ts:107`). */
  buildBlock(query: string, workspaceRoot: string): Promise<string>;
  /** `MemoryWriterAdapter.upsert`, the setup-wizard seed path. */
  seed(request: MemoryWriteRequest): Promise<MemoryWriteResult>;
  /** `null` when the embedder has no reranker (not the worker client). */
  readonly reranker: RerankPort | null;
  /** The extract windows the curator would send (`curator-window-runner.ts:93-99`). */
  planWindows(transcript: string): readonly string[];
}

/** A collaborator the suites need is missing or no longer has its shape. */
export class MergeUpdatePortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeUpdatePortError';
  }
}

const collectionSchema = z.object({
  candidates: z.array(
    z.object({
      id: z.string(),
      subject: z.string().nullable(),
      content: z.string(),
    }),
  ),
  tier1Count: z.number(),
  tier2Count: z.number(),
  tier2Queries: z.number(),
  bm25Only: z.boolean(),
  tier2Skipped: z.string().nullable(),
});

interface CollectorShape {
  collect(
    drafts: readonly ExtractedMemoryDraft[],
    workspaceRoot: string | null | undefined,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

function isCollector(value: unknown): value is CollectorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { collect?: unknown }).collect === 'function'
  );
}

interface InjectorShape {
  buildBlock(query: string, workspaceRoot?: string): Promise<string>;
}

function isInjector(value: unknown): value is InjectorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { buildBlock?: unknown }).buildBlock === 'function'
  );
}

function resolveRegistered<T>(
  context: MemorySkillsHostSuiteContext,
  token: symbol,
  name: string,
): T {
  if (!context.container.isRegistered(token, true)) {
    throw new MergeUpdatePortError(`the bench host container has no ${name}`);
  }
  return context.container.resolve<T>(token);
}

/** Coarse token estimate, the curator's own (`memory-curator.service.ts:1028-1030`). */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** The curator's merge-candidate collector, read from the singleton service. */
function curatorCollector(service: MemoryCuratorService): CollectorShape {
  const collector: unknown = Reflect.get(service, 'mergeCandidates');
  if (!isCollector(collector)) {
    throw new MergeUpdatePortError(
      'MemoryCuratorService no longer holds a `mergeCandidates` collector with collect(); ' +
        'update merge-update-ports.ts to the new seam',
    );
  }
  return collector;
}

/** Resolve the ports from the booted container. Throws {@link MergeUpdatePortError}. */
export function resolveMergeUpdatePorts(
  context: MemorySkillsHostSuiteContext,
): MergeUpdatePorts {
  const store = resolveRegistered<MemoryStore>(
    context,
    MEMORY_TOKENS.MEMORY_STORE,
    'MEMORY_STORE',
  );
  const search = resolveRegistered<MemorySearchService>(
    context,
    MEMORY_TOKENS.MEMORY_SEARCH,
    'MEMORY_SEARCH',
  );
  const collector = curatorCollector(
    resolveRegistered<MemoryCuratorService>(
      context,
      MEMORY_TOKENS.MEMORY_CURATOR,
      'MEMORY_CURATOR',
    ),
  );
  const injector: unknown = resolveRegistered<unknown>(
    context,
    SDK_MEMORY_PROMPT_INJECTOR,
    'SDK_MEMORY_PROMPT_INJECTOR',
  );
  if (!isInjector(injector)) {
    throw new MergeUpdatePortError(
      'SDK_MEMORY_PROMPT_INJECTOR resolves to an object without buildBlock()',
    );
  }
  const writer = resolveRegistered<IMemoryWriter>(
    context,
    PLATFORM_TOKENS.MEMORY_WRITER,
    'MEMORY_WRITER',
  );
  const embedder: unknown = resolveRegistered<unknown>(
    context,
    PERSISTENCE_TOKENS.EMBEDDER,
    'EMBEDDER',
  );
  const reranker: RerankPort | null =
    embedder instanceof EmbedderWorkerClient
      ? {
          rerank: (query, candidates, topK) =>
            embedder.rerank(query, candidates, topK),
        }
      : null;

  return {
    insertRow: ({ sessionId, workspaceRoot, draft }) =>
      store.insertMemoryWithChunks(
        {
          sessionId,
          workspaceRoot,
          tier: 'recall',
          kind: draft.kind,
          subject: draft.subject,
          content: draft.content,
          salience: baseSalience(draft.salienceHint),
          request: draft.request ?? null,
          investigated: draft.investigated ?? null,
          learned: draft.learned ?? null,
          completed: draft.completed ?? null,
          nextSteps: draft.nextSteps ?? null,
          type: draft.type,
          concepts: draft.concepts,
          files: draft.files,
        },
        [
          {
            ord: 0,
            text: draft.content,
            tokenCount: estimateTokens(draft.content),
          },
        ],
      ),
    appendToRow: (id, text, workspaceRoot) =>
      store.appendChunks(
        memoryId(id),
        [{ ord: 0, text, tokenCount: estimateTokens(text) }],
        { workspaceRoot },
      ),
    mergeTarget: (id, workspaceRoot) =>
      store.getMergeTarget(memoryId(id), workspaceRoot),
    listRows: (workspaceRoot) => {
      const page = store.list({ workspaceRoot, limit: 500 });
      if (page.total > page.memories.length) {
        throw new MergeUpdatePortError(
          `scope ${workspaceRoot} holds ${page.total} rows; the suites expect at most 500`,
        );
      }
      return page.memories.map((m) => ({ id: m.id, subject: m.subject }));
    },
    searchRich: async (query, topK, workspaceRoot) => {
      const response = await search.searchRich(query, topK, workspaceRoot);
      return {
        bm25Only: response.bm25Only,
        hits: response.hits.map((hit) => ({
          memoryId: hit.memory.id,
          subject: hit.memory.subject,
          chunkText: hit.chunk.text,
          chunkCreatedAt: hit.chunk.createdAt,
          score: hit.score,
          bm25Rank: hit.bm25Rank,
          vecRank: hit.vecRank,
        })),
      };
    },
    collectCandidates: async (drafts, workspaceRoot, signal) =>
      collectionSchema.parse(
        await collector.collect(drafts, workspaceRoot, signal),
      ),
    curator: context.doubles.curator,
    buildBlock: (query, workspaceRoot) =>
      injector.buildBlock(query, workspaceRoot),
    seed: (request) => writer.upsert(request),
    reranker,
    planWindows: (transcript) =>
      planCuratorWindows(transcript).windows.map((window) => window.text),
  };
}
