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
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '../di/tokens';
import type { InternalQueryService } from '../internal-query';
import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';
import type { ICuratorAuthResolver } from './curator-auth-resolver.port';
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
const CURATOR_AUTH_ERROR_NAME = 'CuratorAuthError';
export const CURATOR_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

@injectable()
export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQuery: InternalQueryService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_CURATOR_AUTH_RESOLVER, { isOptional: true })
    private readonly resolver: ICuratorAuthResolver | null = null,
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
      if (error instanceof Error && error.name === CURATOR_AUTH_ERROR_NAME) {
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
      if (configured.length === 0) return CURATOR_FALLBACK_MODEL;
      return configured;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        '[memory-curator] curator model resolution failed; using fallback',
        { error: message },
      );
      return CURATOR_FALLBACK_MODEL;
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
        mcpServerRunning: false,
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
