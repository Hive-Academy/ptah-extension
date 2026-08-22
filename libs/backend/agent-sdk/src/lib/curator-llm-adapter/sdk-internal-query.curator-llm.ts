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
 * The two resolver throws the curator recognises, matched by `name` rather than
 * `instanceof` because both classes live in `auth-providers`, which depends on
 * this lib — importing either here would close the cycle. Kept in sync with
 * `ProviderAuthError`'s and `ProviderQuotaError`'s constructors, and with
 * `skill-synthesis`'s identical mirrors in `lanes/lane-auth-resolver.port.ts`.
 *
 * ## The curator answers them DIFFERENTLY, and that is the whole point
 *
 * `ProviderAuthError` — the curator provider is configured but unusable. The
 * curator FALLS BACK to the active provider, a deliberate divergence from
 * skill-synthesis lanes (which stall) recorded when this adapter was written:
 * curation is small, cheap, and runs on behalf of a user who is present, so
 * riding the foreground provider is better than silently curating nothing.
 * That behaviour is unchanged.
 *
 * `ProviderQuotaError` — the provider that would actually be dialled is
 * rate-limited. The curator STOPS for this pass. The auth fallback is exactly
 * wrong here for two reasons: `''` (no curator provider pinned) resolves TO the
 * active provider, so "fall back to active" would very often mean "retry the
 * provider that just said no"; and where the curator provider IS separate, the
 * fallback would move an exhausted provider's work onto the user's foreground
 * quota, which is the defect the gate exists to stop.
 *
 * Stopping means returning nothing for this pass, never throwing:
 * `ICuratorLLM`'s contract does not grow a failure mode, and
 * `MemoryCuratorService` sees the same shape it sees for an empty transcript.
 */
const PROVIDER_AUTH_ERROR_NAME = 'ProviderAuthError';
const PROVIDER_QUOTA_ERROR_NAME = 'ProviderQuotaError';

/**
 * What `resolveCuratorAuth` decided. `'ride-active'` is the pre-existing
 * `undefined` — either nothing to override, or the documented auth fallback —
 * and `'cooling-down'` is the new quota stop.
 *
 * A discriminated result rather than a second `undefined` because the two mean
 * opposite things to the caller: one says "go, on the active provider", the
 * other says "do not go at all". Collapsing them into `undefined` is precisely
 * how a quota stall would walk straight into the fallback.
 */
type CuratorAuthDecision =
  | { readonly kind: 'ride-active' }
  | { readonly kind: 'override'; readonly auth: OneShotAuthOverride }
  | { readonly kind: 'cooling-down'; readonly providerId: string };

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

  private async resolveCuratorAuth(): Promise<CuratorAuthDecision> {
    if (!this.resolver) return { kind: 'ride-active' };
    const curatorProviderId = this.resolveCuratorProviderId();
    try {
      const auth = await this.resolver.resolve(curatorProviderId);
      return auth ? { kind: 'override', auth } : { kind: 'ride-active' };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === PROVIDER_QUOTA_ERROR_NAME) {
        // The quota branch. See the constants' docblock for why this does NOT
        // reuse the auth fallback below: the provider a fallback would ride is
        // frequently the very one that is rate-limited.
        this.logger.warn(
          '[memory-curator] curator provider is rate-limited; skipping this curation pass until its quota refills',
          { error: error.message, curatorProviderId },
        );
        return { kind: 'cooling-down', providerId: curatorProviderId };
      }
      if (error instanceof Error && error.name === PROVIDER_AUTH_ERROR_NAME) {
        this.logger.warn(
          '[memory-curator] curator provider auth unavailable; riding active provider',
          { error: error.message, curatorProviderId },
        );
        return { kind: 'ride-active' };
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
      const decision = await this.resolveCuratorAuth();
      if (decision.kind === 'cooling-down') {
        // Stop, before the query rather than after it — the point of the gate
        // is that the second and later passes cost zero upstream requests. An
        // empty reply is the shape every other "nothing usable came back" path
        // already produces here (`parseDrafts` yields `[]`, `parseResolved`
        // yields the drafts unmerged), so `ICuratorLLM` grows no new failure
        // mode and `MemoryCuratorService` needs no change.
        return '';
      }
      const auth = decision.kind === 'override' ? decision.auth : undefined;
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
