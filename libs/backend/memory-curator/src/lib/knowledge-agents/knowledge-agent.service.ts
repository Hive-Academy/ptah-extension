/**
 * KnowledgeAgentService — orchestrates corpus build → prime → query → rebuild.
 *
 * - `buildCorpus`     : runs the persisted filter through `MemorySearchService.searchIndex`
 *                       and snapshots the resulting memory ids into `corpus_memories`.
 * - `primeCorpus`     : opens a fresh SDK session whose `sessionConfig.corpusName` is set,
 *                       causing `SdkQueryOptionsBuilder` to prepend the corpus block.
 * - `queryCorpus`     : reuses the most recent primed session if alive; otherwise
 *                       auto-primes, then forwards the question via `sendMessage`.
 * - `reprimeCorpus`   : ends any existing primed sessions and opens a new one.
 * - `rebuildCorpus`   : re-runs the persisted filter, diffs membership, returns
 *                       added/removed counts and bumps `rebuilt_at`.
 * - `deleteCorpus`    : drops the corpus (ON DELETE CASCADE clears the join).
 * - `listCorpora`     : workspace-scoped lookup.
 *
 * Privacy: only structured memory summaries cross the SDK boundary via the
 * shared `MemoryPromptInjector` chokepoint.
 */
import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS, RpcUserError, type Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SessionLifecycleManager,
  SdkModelService,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { MEMORY_TOKENS } from '../di/tokens';
import { CorpusStore } from './corpus.store';
import { MemorySearchService } from '../memory-search.service';
import { toSessionId } from './corpus-session-id';
import type {
  BuildCorpusParams,
  CorpusListEntry,
  CorpusRef,
} from './corpus.types';

export interface PrimeCorpusResult {
  readonly sessionId: string;
}

export interface QueryCorpusResult {
  readonly sessionId: string;
}

export interface RebuildCorpusResult {
  readonly added: number;
  readonly removed: number;
}

export interface DeleteCorpusResult {
  readonly deleted: boolean;
}

@injectable()
export class KnowledgeAgentService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(MEMORY_TOKENS.CORPUS_STORE)
    private readonly corpusStore: CorpusStore,
    @inject(MEMORY_TOKENS.MEMORY_SEARCH)
    private readonly search: MemorySearchService,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessions: SessionLifecycleManager,
    @inject(SDK_TOKENS.SDK_MODEL_SERVICE)
    private readonly modelService: SdkModelService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace: IWorkspaceProvider | null = null,
  ) {}

  async buildCorpus(params: BuildCorpusParams): Promise<CorpusRef> {
    const existing = this.corpusStore.getByName(params.name);
    if (existing) {
      throw new Error(`Corpus '${params.name}' already exists`);
    }
    const ref = this.corpusStore.create(params);
    const memoryIds = await this.runFilter(params);
    if (memoryIds.length > 0) {
      this.corpusStore.setMemberIds(ref.id, memoryIds);
    }
    return {
      ...ref,
      count: memoryIds.length,
    };
  }

  async primeCorpus(name: string): Promise<PrimeCorpusResult> {
    const rec = this.corpusStore.getByName(name);
    if (!rec) {
      throw new Error(`Corpus '${name}' not found`);
    }
    const projectPath =
      rec.workspaceRoot ?? this.workspace?.getWorkspaceRoot() ?? null;
    if (!projectPath) {
      throw new RpcUserError(
        'cannot prime corpus outside a workspace',
        'WORKSPACE_NOT_OPEN',
      );
    }
    const model = await this.modelService.getDefaultModel();
    const tabId = `corpus-${randomUUID()}`;
    const sessionId = toSessionId(tabId);
    const abortController = new AbortController();
    const sessionConfig = {
      projectPath,
      tabId,
      model,
      corpusName: name,
      isCorpusPrimingSession: true,
    };
    this.sessions.register(tabId, sessionConfig, abortController);
    try {
      await this.sessions.executeQuery({
        sessionId,
        sessionConfig,
        initialPrompt: {
          content: `[corpus-prime] Loaded knowledge corpus '${name}'.`,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(
        '[knowledge-agent] primeCorpus executeQuery failed; session may be unusable',
        {
          name,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
    const next = unique([...rec.primedSessionIds, sessionId as string]);
    this.corpusStore.setPrimedSessionIds(rec.id, next);
    return { sessionId: sessionId as string };
  }

  async queryCorpus(
    name: string,
    question: string,
  ): Promise<QueryCorpusResult> {
    const rec = this.corpusStore.getByName(name);
    if (!rec) {
      throw new Error(`Corpus '${name}' not found`);
    }
    const alive = this.findAlivePrimedSession(rec.primedSessionIds);
    let sessionId = alive;
    if (!sessionId) {
      const primed = await this.primeCorpus(name);
      sessionId = primed.sessionId;
    }
    await this.sessions.sendMessage(toSessionId(sessionId), question);
    return { sessionId };
  }

  async reprimeCorpus(name: string): Promise<PrimeCorpusResult> {
    const rec = this.corpusStore.getByName(name);
    if (!rec) {
      throw new Error(`Corpus '${name}' not found`);
    }
    for (const sid of rec.primedSessionIds) {
      try {
        await this.sessions.endSession(toSessionId(sid));
      } catch (err: unknown) {
        this.logger.warn('[knowledge-agent] reprime endSession failed', {
          sessionId: sid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.corpusStore.setPrimedSessionIds(rec.id, []);
    return this.primeCorpus(name);
  }

  async rebuildCorpus(name: string): Promise<RebuildCorpusResult> {
    const rec = this.corpusStore.getByName(name);
    if (!rec) {
      throw new Error(`Corpus '${name}' not found`);
    }
    const params = parseQueryJson(rec.queryJson, name);
    const fresh = await this.runFilter(params);
    const current = this.corpusStore.getMemberIds(rec.id);
    const currentSet = new Set(current);
    const freshSet = new Set(fresh);
    let added = 0;
    let removed = 0;
    for (const id of fresh) if (!currentSet.has(id)) added++;
    for (const id of current) if (!freshSet.has(id)) removed++;
    this.corpusStore.setMemberIds(rec.id, fresh);
    this.corpusStore.updateRebuiltAt(rec.id);
    return { added, removed };
  }

  async deleteCorpus(name: string): Promise<DeleteCorpusResult> {
    const rec = this.corpusStore.getByName(name);
    if (!rec) return { deleted: false };
    const deleted = this.corpusStore.delete(rec.id);
    return { deleted };
  }

  listCorpora(workspaceRoot?: string | null): readonly CorpusListEntry[] {
    const filter = workspaceRoot === undefined ? {} : { workspaceRoot };
    return this.corpusStore.list(filter);
  }

  private async runFilter(
    params: BuildCorpusParams,
  ): Promise<readonly string[]> {
    const response = await this.search.searchIndex({
      query: params.query,
      workspaceRoot: params.workspaceRoot ?? undefined,
      type: params.type,
      concepts: params.concepts,
      files: params.files,
      dateRange: params.dateRange,
      topK: params.limit ?? 100,
    });
    return response.rows.map((r) => r.id);
  }

  private findAlivePrimedSession(ids: readonly string[]): string | null {
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i];
      if (this.sessions.find(id)) return id;
    }
    return null;
  }
}

function parseQueryJson(raw: string, name: string): BuildCorpusParams {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as BuildCorpusParams;
    }
  } catch {
    /* fall through */
  }
  return { name };
}

function unique(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}
