import * as os from 'os';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  type ICuratorLLM,
  type ExtractedMemoryDraft,
  type ResolvedMemoryDraft,
} from '@ptah-extension/memory-contracts';
import {
  PLATFORM_TOKENS,
  resolveMcpSessionWiring,
  type IMcpServerStatus,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '../di/tokens';
import type { InternalQueryService } from '../internal-query';
import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';
import type { IProviderAuthResolver } from '../auth/provider-auth-resolver.port';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
} from './extract-prompt';
import {
  RESOLVE_SYSTEM_PROMPT,
  buildResolveUserPrompt,
} from './resolve-prompt';
import {
  ExtractedDraftSchema,
  ExtractedResponseSchema,
} from './extract.schema';
import { ResolvedDraftSchema, ResolvedResponseSchema } from './resolve.schema';
import { CuratorLlmQueryError } from './curator-llm-query.error';

const CURATOR_MODEL_SECTION = 'ptah';
const CURATOR_MODEL_KEY = 'memory.curatorModel';
const CURATOR_PROVIDER_KEY = 'memory.curatorProvider';
/**
 * Matched by `name` rather than `instanceof` because the error class lives in
 * `auth-providers`, which depends on this lib — importing it here would close
 * the cycle. Kept in sync with `ProviderAuthError`'s constructor.
 */
const PROVIDER_AUTH_ERROR_NAME = 'ProviderAuthError';

/**
 * What the curator asks for when the user has pinned no explicit model.
 *
 * This is a TIER ALIAS, not a model id, and that distinction is the whole fix
 * (TASK_2026_159). `SdkQueryRunner` runs every one-shot model through
 * `ModelResolver.resolve()`, whose two branches are not equivalent:
 *
 *  - a pinned Claude id (`claude-haiku-4-5-...`, what this constant used to be)
 *    only consults `ANTHROPIC_DEFAULT_HAIKU_MODEL`. With that env var absent —
 *    a curator provider whose entry declares no `defaultTiers`, or any point
 *    before `applyPersistedTiers()` has run — the Anthropic id reaches a
 *    non-Anthropic endpoint verbatim and 404s.
 *  - a bare tier consults the env var AND falls back to the resolved provider's
 *    `defaultTiers`, and on direct Anthropic stays the alias, which tracks the
 *    current Haiku instead of pinning a dated snapshot that will be retired.
 *
 * Haiku is the right tier: curation is high-volume, low-reasoning summarisation.
 */
export const CURATOR_DEFAULT_MODEL_TIER = 'haiku';

@injectable()
export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQuery: InternalQueryService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER, { isOptional: true })
    private readonly resolver: IProviderAuthResolver | null = null,
    @inject(PLATFORM_TOKENS.MCP_SERVER_STATUS, { isOptional: true })
    private readonly mcpServerStatus: IMcpServerStatus | null = null,
  ) {}

  private resolveCuratorProviderId(): string {
    const rawProvider = this.workspace.getConfiguration<string>(
      CURATOR_MODEL_SECTION,
      CURATOR_PROVIDER_KEY,
      '',
    );
    return (typeof rawProvider === 'string' ? rawProvider : '').trim();
  }

  private async resolveCuratorAuth(): Promise<OneShotAuthOverride | undefined> {
    if (!this.resolver) return undefined;
    const curatorProviderId = this.resolveCuratorProviderId();
    try {
      const auth = await this.resolver.resolve(curatorProviderId);
      return auth ?? undefined;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === PROVIDER_AUTH_ERROR_NAME) {
        this.logger.warn(
          '[memory-curator] curator provider auth unavailable; riding active provider',
          { error: error.message, curatorProviderId },
        );
        return undefined;
      }
      throw error;
    }
  }

  private resolveQueryCwd(): string {
    const root = this.workspace.getWorkspaceRoot();
    return typeof root === 'string' && root.trim().length > 0
      ? root
      : os.homedir();
  }

  private resolveCuratorModel(): string {
    try {
      const rawModel = this.workspace.getConfiguration<string>(
        CURATOR_MODEL_SECTION,
        CURATOR_MODEL_KEY,
        '',
      );
      const configured = (typeof rawModel === 'string' ? rawModel : '').trim();
      if (configured.length === 0) {
        this.logger.debug(
          '[memory-curator] no curator model pinned; riding the haiku tier of the resolved provider',
        );
        return CURATOR_DEFAULT_MODEL_TIER;
      }
      return configured;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        '[memory-curator] curator model resolution failed; using the haiku tier',
        { error: message },
      );
      return CURATOR_DEFAULT_MODEL_TIER;
    }
  }

  async extract(
    transcript: string,
    signal?: AbortSignal,
  ): Promise<readonly ExtractedMemoryDraft[]> {
    const text = await this.runQuery(
      EXTRACT_SYSTEM_PROMPT,
      buildExtractUserPrompt(transcript),
      signal,
    );
    return this.parseDrafts(text);
  }

  async resolve(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly { id: string; subject: string | null; content: string }[],
    signal?: AbortSignal,
  ): Promise<readonly ResolvedMemoryDraft[]> {
    if (drafts.length === 0) return [];
    if (related.length === 0) {
      return drafts.map((d) => ({ ...d, mergeTargetId: null }));
    }
    const text = await this.runQuery(
      RESOLVE_SYSTEM_PROMPT,
      buildResolveUserPrompt(drafts, related),
      signal,
    );
    return this.parseResolved(text, drafts);
  }

  private async runQuery(
    systemPromptAppend: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const abortController = new AbortController();
    if (signal) {
      if (signal.aborted) abortController.abort();
      else
        signal.addEventListener('abort', () => abortController.abort(), {
          once: true,
        });
    }
    try {
      const auth = await this.resolveCuratorAuth();
      const handle = await this.internalQuery.execute({
        cwd: this.resolveQueryCwd(),
        model: this.resolveCuratorModel(),
        prompt,
        systemPromptAppend,
        // Was hard-coded false (defect 13). The curator reads and writes memory
        // through Ptah tools when they are reachable.
        ...resolveMcpSessionWiring(this.mcpServerStatus),
        maxTurns: 1,
        abortController,
        auth,
      });
      let collected = '';
      for await (const msg of handle.stream as AsyncIterable<SDKMessage>) {
        if (msg.type === 'assistant') {
          const message = (
            msg as unknown as {
              message?: { content?: Array<{ type: string; text?: string }> };
            }
          ).message;
          for (const block of message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              collected += block.text;
            }
          }
        }
        if (msg.type === 'result') break;
      }
      return collected;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[memory-curator] curator LLM query failed', {
        error: message,
      });
      throw new CuratorLlmQueryError(
        'The memory curator could not complete its language-model query.',
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }

  private parseDrafts(text: string): readonly ExtractedMemoryDraft[] {
    const json = this.extractJsonObject(text);
    if (!json) return [];
    const env = ExtractedResponseSchema.safeParse(json);
    if (!env.success) return [];
    const out: ExtractedMemoryDraft[] = [];
    for (const item of env.data.memories) {
      const parsed = ExtractedDraftSchema.safeParse(item);
      if (!parsed.success) continue;
      const draft = parsed.data;
      if (draft) out.push(draft);
    }
    return out;
  }

  private parseResolved(
    text: string,
    fallback: readonly ExtractedMemoryDraft[],
  ): readonly ResolvedMemoryDraft[] {
    const json = this.extractJsonObject(text);
    if (!json) return fallback.map((d) => ({ ...d, mergeTargetId: null }));
    const env = ResolvedResponseSchema.safeParse(json);
    if (!env.success)
      return fallback.map((d) => ({ ...d, mergeTargetId: null }));
    const out: ResolvedMemoryDraft[] = [];
    for (const item of env.data.memories) {
      const parsed = ResolvedDraftSchema.safeParse(item);
      if (!parsed.success) continue;
      const draft = parsed.data;
      if (draft) out.push(draft);
    }
    return out.length > 0
      ? out
      : fallback.map((d) => ({ ...d, mergeTargetId: null }));
  }

  private extractJsonObject(text: string): unknown | null {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}
