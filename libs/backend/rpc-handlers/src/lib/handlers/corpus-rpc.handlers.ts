/**
 * Knowledge Corpus RPC Handlers (`corpus:` namespace).
 *
 * Nine methods route through `KnowledgeAgentService` (+ `CorpusSuggestionService`):
 *   - `corpus:list`     — workspace-scoped lookup
 *   - `corpus:get`      — single corpus by name
 *   - `corpus:build`    — create + snapshot from persisted filter
 *   - `corpus:prime`    — open a primed session
 *   - `corpus:query`    — send question on most recent alive primed session
 *   - `corpus:reprime`  — end existing primed sessions, open a fresh one
 *   - `corpus:rebuild`  — re-run filter, diff membership
 *   - `corpus:delete`   — drop the corpus row
 *   - `corpus:suggest`  — read-only clustering pass → one-click corpus suggestions
 *
 * License gating: `corpus:` is NOT in `PRO_ONLY_METHOD_PREFIXES` — free tier.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  MEMORY_TOKENS,
  type KnowledgeAgentService,
  type CorpusListEntry,
  type CorpusSuggestionService,
  type CorpusSuggestion,
} from '@ptah-extension/memory-curator';
import type {
  CorpusEntry,
  CorpusListParams,
  CorpusListResult,
  CorpusGetParams,
  CorpusGetResult,
  CorpusBuildParams,
  CorpusBuildResult,
  CorpusPrimeParams,
  CorpusPrimeResult,
  CorpusQueryParams,
  CorpusQueryResult,
  CorpusReprimeParams,
  CorpusReprimeResult,
  CorpusRebuildParams,
  CorpusRebuildResult,
  CorpusDeleteParams,
  CorpusDeleteResult,
  CorpusSuggestParams,
  CorpusSuggestResult,
  CorpusSuggestion as CorpusSuggestionWire,
  RpcMethodName,
} from '@ptah-extension/shared';
import { z } from 'zod';
import {
  CorpusListParamsSchema,
  CorpusGetParamsSchema,
  CorpusBuildParamsSchema,
  CorpusPrimeParamsSchema,
  CorpusQueryParamsSchema,
  CorpusReprimeParamsSchema,
  CorpusRebuildParamsSchema,
  CorpusDeleteParamsSchema,
  CorpusSuggestParamsSchema,
} from './corpus-rpc.schema';

function toWireEntry(entry: CorpusListEntry): CorpusEntry {
  return {
    id: entry.id,
    name: entry.name,
    count: entry.count,
    builtAt: entry.builtAt,
    rebuiltAt: entry.rebuiltAt,
    workspaceRoot: entry.workspaceRoot,
  };
}

/**
 * Map a domain {@link CorpusSuggestion} (memory-curator) to its wire shape
 * (`@ptah-extension/shared`). Structural copy — the domain `filter`'s
 * `MemoryType[]` and the wire `MemoryTypeWire[]` are the same string enum.
 */
function toWireSuggestion(suggestion: CorpusSuggestion): CorpusSuggestionWire {
  const { filter } = suggestion;
  return {
    suggestedName: suggestion.suggestedName,
    filter: {
      name: filter.name,
      workspaceRoot: filter.workspaceRoot,
      type: filter.type,
      concepts: filter.concepts,
      files: filter.files,
      query: filter.query,
      dateRange: filter.dateRange,
      limit: filter.limit,
    },
    memberCount: suggestion.memberCount,
    topConcepts: suggestion.topConcepts,
    rationale: suggestion.rationale,
    signal: suggestion.signal,
  };
}

@injectable()
export class CorpusRpcHandlers {
  static readonly METHODS = [
    'corpus:list',
    'corpus:get',
    'corpus:build',
    'corpus:prime',
    'corpus:query',
    'corpus:reprime',
    'corpus:rebuild',
    'corpus:delete',
    'corpus:suggest',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(MEMORY_TOKENS.KNOWLEDGE_AGENT_SERVICE)
    private readonly knowledgeAgent: KnowledgeAgentService,
    @inject(MEMORY_TOKENS.CORPUS_SUGGESTION_SERVICE)
    private readonly suggestions: CorpusSuggestionService,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'corpus:list',
      async (
        params: CorpusListParams | undefined,
      ): Promise<CorpusListResult> => {
        let validated: z.infer<typeof CorpusListParamsSchema>;
        try {
          validated = CorpusListParamsSchema.parse(params ?? {});
        } catch (err: unknown) {
          this.logger.warn('[corpus] list — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:list',
            'INVALID_PARAMS',
          );
        }
        try {
          const corpora = this.knowledgeAgent.listCorpora(
            validated.workspaceRoot,
          );
          return { corpora: corpora.map(toWireEntry) };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] list failed', { error: message });
          throw new RpcUserError(
            'corpus:list failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'corpus:get',
      async (params: CorpusGetParams | undefined): Promise<CorpusGetResult> => {
        let validated: z.infer<typeof CorpusGetParamsSchema>;
        try {
          validated = CorpusGetParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[corpus] get — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:get',
            'INVALID_PARAMS',
          );
        }
        try {
          const matches = this.knowledgeAgent
            .listCorpora()
            .filter((c) => c.name === validated.name);
          const found = matches.length > 0 ? matches[0] : null;
          return { corpus: found ? toWireEntry(found) : null };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] get failed', { error: message });
          throw new RpcUserError(
            'corpus:get failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'corpus:build',
      async (
        params: CorpusBuildParams | undefined,
      ): Promise<CorpusBuildResult> => {
        let validated: z.infer<typeof CorpusBuildParamsSchema>;
        try {
          validated = CorpusBuildParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[corpus] build — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:build',
            'INVALID_PARAMS',
          );
        }
        try {
          const ref = await this.knowledgeAgent.buildCorpus({
            name: validated.name,
            workspaceRoot: validated.workspaceRoot,
            type: validated.type,
            concepts: validated.concepts,
            files: validated.files,
            query: validated.query,
            dateRange: validated.dateRange,
            limit: validated.limit,
          });
          return { corpus: toWireEntry(ref) };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] build failed', { error: message });
          throw new RpcUserError(
            'corpus:build failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'corpus:prime',
      async (
        params: CorpusPrimeParams | undefined,
      ): Promise<CorpusPrimeResult> => {
        let validated: z.infer<typeof CorpusPrimeParamsSchema>;
        try {
          validated = CorpusPrimeParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[corpus] prime — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:prime',
            'INVALID_PARAMS',
          );
        }
        try {
          const r = await this.knowledgeAgent.primeCorpus(validated.name);
          return { sessionId: r.sessionId };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] prime failed', { error: message });
          throw new RpcUserError(
            'corpus:prime failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'corpus:query',
      async (
        params: CorpusQueryParams | undefined,
      ): Promise<CorpusQueryResult> => {
        let validated: z.infer<typeof CorpusQueryParamsSchema>;
        try {
          validated = CorpusQueryParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[corpus] query — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:query',
            'INVALID_PARAMS',
          );
        }
        try {
          const r = await this.knowledgeAgent.queryCorpus(
            validated.name,
            validated.question,
          );
          return { sessionId: r.sessionId };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] query failed', { error: message });
          throw new RpcUserError(
            'corpus:query failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'corpus:reprime',
      async (
        params: CorpusReprimeParams | undefined,
      ): Promise<CorpusReprimeResult> => {
        let validated: z.infer<typeof CorpusReprimeParamsSchema>;
        try {
          validated = CorpusReprimeParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[corpus] reprime — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:reprime',
            'INVALID_PARAMS',
          );
        }
        try {
          const r = await this.knowledgeAgent.reprimeCorpus(validated.name);
          return { sessionId: r.sessionId };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] reprime failed', { error: message });
          throw new RpcUserError(
            'corpus:reprime failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'corpus:rebuild',
      async (
        params: CorpusRebuildParams | undefined,
      ): Promise<CorpusRebuildResult> => {
        let validated: z.infer<typeof CorpusRebuildParamsSchema>;
        try {
          validated = CorpusRebuildParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[corpus] rebuild — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:rebuild',
            'INVALID_PARAMS',
          );
        }
        try {
          const r = await this.knowledgeAgent.rebuildCorpus(validated.name);
          return { added: r.added, removed: r.removed };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] rebuild failed', { error: message });
          throw new RpcUserError(
            'corpus:rebuild failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'corpus:delete',
      async (
        params: CorpusDeleteParams | undefined,
      ): Promise<CorpusDeleteResult> => {
        let validated: z.infer<typeof CorpusDeleteParamsSchema>;
        try {
          validated = CorpusDeleteParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[corpus] delete — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:delete',
            'INVALID_PARAMS',
          );
        }
        try {
          const r = await this.knowledgeAgent.deleteCorpus(validated.name);
          return { deleted: r.deleted };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] delete failed', { error: message });
          throw new RpcUserError(
            'corpus:delete failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'corpus:suggest',
      async (
        params: CorpusSuggestParams | undefined,
      ): Promise<CorpusSuggestResult> => {
        let validated: z.infer<typeof CorpusSuggestParamsSchema>;
        try {
          validated = CorpusSuggestParamsSchema.parse(params ?? {});
        } catch (err: unknown) {
          this.logger.warn('[corpus] suggest — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for corpus:suggest',
            'INVALID_PARAMS',
          );
        }
        try {
          const suggestions = this.suggestions.suggestCorpora({
            workspaceRoot: validated.workspaceRoot,
            minClusterSize: validated.minClusterSize,
            limit: validated.limit,
          });
          return { suggestions: suggestions.map(toWireSuggestion) };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[corpus] suggest failed', { error: message });
          throw new RpcUserError(
            'corpus:suggest failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.logger.info('[corpus] RPC handlers registered');
  }
}
