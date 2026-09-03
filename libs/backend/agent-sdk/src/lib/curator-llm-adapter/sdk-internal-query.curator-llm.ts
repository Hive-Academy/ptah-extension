import * as os from 'os';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  type ICuratorLLM,
  type CuratorExtraction,
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
 * `ICuratorLLM`'s contract does not grow a failure mode. It DOES grow a
 * discriminator — `extract` resolves `{ status: 'stalled' }` rather than an
 * empty draft list (TASK_2026_306 Batch 10) — because "stopped" and "ran and
 * found nothing" are the same bytes otherwise, and the caller destroys its own
 * input when it cannot tell them apart. Still a resolve, still no throw.
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
 * What one `runQuery` call produced.
 *
 * `runQuery` used to answer `''` for the quota stall, which is the exact point
 * where the information was lost: `''` is also what a model that replied with
 * nothing produces, and by the time `parseDrafts` has turned both into `[]` the
 * distinction is unrecoverable. Carrying it here — the earliest point it
 * exists — is what lets `extract` publish `status: 'stalled'` without
 * reconstructing anything.
 *
 * The same collapse happened a second time, one layer down, and TASK_2026_376
 * F8 is that repeat. With tools reachable (`resolveMcpSessionWiring` below) a
 * run can spend every turn calling them and emit no assistant text at all. The
 * old collector gathered text ONLY, so that run reached the caller as `''` —
 * byte-identical to a model that answered nothing, and byte-identical to a run
 * that never started. Three different events, one value. `tools-only` and
 * `silent` are separate arms for the same reason `cooling-down` is: the caller
 * acts differently on them, and a discriminator is the only thing a `''` cannot
 * be mistaken for.
 */
type CuratorQueryOutcome =
  | { readonly kind: 'text'; readonly text: string; readonly toolUses: number }
  | {
      readonly kind: 'tools-only';
      readonly toolUses: number;
      readonly toolNames: readonly string[];
    }
  | { readonly kind: 'silent' }
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

/**
 * The curator's bounded turn budget.
 *
 * ## What `maxTurns` means, verified rather than assumed
 *
 * Read out of the installed `@anthropic-ai/claude-agent-sdk@0.3.150`:
 *
 *  - `Options.maxTurns` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1527-1530`):
 *    "Maximum number of conversation turns before the query stops. A turn
 *    consists of a user message and assistant response."
 *  - `AgentDefinition.maxTurns` (same file, `:73-75`) states the unit outright:
 *    "Maximum number of agentic turns (API round-trips) before stopping".
 *  - Exceeding it is a RESULT, not a throw: `SDKResultError.subtype` includes
 *    `'error_max_turns'` (`:3402`) and `TerminalReason` includes `'max_turns'`
 *    (`:5687`).
 *  - `SdkQueryRunner` forwards the number to the CLI as `--max-turns`, so the
 *    ceiling is enforced by the `claude` binary, not by this process.
 *
 * One turn is therefore ONE API round-trip. `maxTurns: 1` — what this used to
 * be — buys the model exactly one assistant response. It may emit `tool_use`
 * blocks in it, and the SDK will even run the tools, but delivering the
 * `tool_result` back needs a SECOND round-trip, and that one never happens.
 * The model never observes what its own tool call returned and never writes the
 * JSON that follows from it. The MCP wiring three lines above `maxTurns` was
 * attached and unreachable (TASK_2026_376 F8).
 *
 * ## Why 6
 *
 * Two is the floor: call, observe, answer. Six is the floor plus room for a
 * short chain — search memory, read a file the transcript named, then answer —
 * which is the shape curation actually has.
 *
 * It stays a BOUND, and a small one. `DEFAULT_ONE_SHOT_MAX_TURNS` is 25
 * (`helpers/sdk-query-runner.service.ts:66`); the curator asks for a quarter of
 * that because it runs behind a 60-second per-lane queue budget
 * (`DEFAULT_QUEUE_TIMEOUT_MS`, `internal-query/internal-query.service.ts`) on a
 * lane whose `perLaneLimit` is 1. Every turn this run spends is a turn the next
 * curation window waits, and a window that waits past the budget is DROPPED
 * (TASK_2026_376 F4). A generous ceiling here is not free latency — it is the
 * next window's data loss. Raise it only with that trade in hand.
 */
export const CURATOR_MAX_TURNS = 6;

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
  ): Promise<CuratorExtraction> {
    const outcome = await this.runQuery(
      EXTRACT_SYSTEM_PROMPT,
      buildExtractUserPrompt(transcript),
      signal,
    );
    if (outcome.kind === 'cooling-down') {
      return {
        status: 'stalled',
        reason: 'provider-cooling-down',
        providerId: outcome.providerId,
      };
    }
    // `tools-only` and `silent` both yield no drafts, and the CONTRACT cannot
    // tell them apart: `CuratorExtraction` has two arms, and adding a third
    // means editing `memory-contracts` and `memory-curator`, neither of which
    // this batch owns (reported in b5-report.md). What is inside reach is the
    // record — an operator reading the log can now see that the pass ran, used
    // tools, and chose not to write JSON, which is a different event from a
    // pass that produced nothing at all.
    if (outcome.kind === 'tools-only') {
      this.logger.info(
        '[memory-curator] curator extract pass did its work through tools and returned no JSON; nothing to persist from this pass',
        { toolUses: outcome.toolUses, toolNames: outcome.toolNames },
      );
      return { status: 'extracted', drafts: [] };
    }
    if (outcome.kind === 'silent') {
      this.logger.warn(
        '[memory-curator] curator extract pass produced neither text nor tool calls',
      );
      return { status: 'extracted', drafts: [] };
    }
    return { status: 'extracted', drafts: this.parseDrafts(outcome.text) };
  }

  /**
   * No stalled arm here, deliberately — see the note on `ICuratorLLM.resolve`.
   * A cooldown that starts between `extract` and `resolve` degrades to "store
   * the drafts unmerged", which loses no input, so there is nothing for the
   * caller to decide.
   */
  async resolve(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly { id: string; subject: string | null; content: string }[],
    signal?: AbortSignal,
  ): Promise<readonly ResolvedMemoryDraft[]> {
    if (drafts.length === 0) return [];
    if (related.length === 0) {
      return drafts.map((d) => ({ ...d, mergeTargetId: null }));
    }
    const outcome = await this.runQuery(
      RESOLVE_SYSTEM_PROMPT,
      buildResolveUserPrompt(drafts, related),
      signal,
    );
    if (outcome.kind === 'cooling-down') {
      return drafts.map((d) => ({ ...d, mergeTargetId: null }));
    }
    if (outcome.kind === 'tools-only') {
      this.logger.info(
        '[memory-curator] curator resolve pass used tools and returned no JSON; storing the drafts unmerged',
        { toolUses: outcome.toolUses, toolNames: outcome.toolNames },
      );
      return drafts.map((d) => ({ ...d, mergeTargetId: null }));
    }
    if (outcome.kind === 'silent') {
      this.logger.warn(
        '[memory-curator] curator resolve pass produced neither text nor tool calls; storing the drafts unmerged',
      );
      return drafts.map((d) => ({ ...d, mergeTargetId: null }));
    }
    return this.parseResolved(outcome.text, drafts);
  }

  private async runQuery(
    systemPromptAppend: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<CuratorQueryOutcome> {
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
        // is that the second and later passes cost zero upstream requests.
        //
        // This used to `return ''`, collapsing the stall into the same value a
        // model that said nothing produces. That collapse is finding F1: the
        // trigger service marks its drained observations processed on every
        // resolve, so a stalled pass discarded the episodes it was gated from
        // curating and they never came back. The named outcome is what the
        // caller inspects instead.
        return { kind: 'cooling-down', providerId: decision.providerId };
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
        // Was 1, which made the MCP wiring on the line above unusable: one
        // round-trip cannot carry a tool_result back to the model. See
        // CURATOR_MAX_TURNS for the SDK semantics this number is derived from
        // and for why it stays small.
        maxTurns: CURATOR_MAX_TURNS,
        // The curator's own concurrency lane. Before TASK_2026_352 every
        // internal one-shot shared a single host-wide slot, so a curation pass
        // queued behind an unrelated skill-synthesis lane call and back again
        // — nine times on one boot (`tmp/logs/log.log:938 … 1424`).
        lane: 'memory-curator',
        abortController,
        auth,
      });
      let collected = '';
      let toolUses = 0;
      const toolNames: string[] = [];
      let hitTurnCeiling = false;
      for await (const msg of handle.stream as AsyncIterable<SDKMessage>) {
        if (msg.type === 'assistant') {
          const message = (
            msg as unknown as {
              message?: {
                content?: Array<{ type: string; text?: string; name?: string }>;
              };
            }
          ).message;
          for (const block of message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              collected += block.text;
            }
            // The half the old collector dropped. A turn spent on a tool call
            // contributed NOTHING here, so a run that searched memory and read
            // three files was reported exactly like a run that said nothing.
            if (block.type === 'tool_use') {
              toolUses++;
              if (typeof block.name === 'string' && block.name.length > 0) {
                if (!toolNames.includes(block.name)) toolNames.push(block.name);
              }
            }
          }
        }
        if (msg.type === 'result') {
          // `error_max_turns` is a RESULT in this SDK, never a throw, so an
          // exhausted budget is silent unless it is read here. It is the one
          // signal that says CURATOR_MAX_TURNS is set too low for the work.
          const subtype = (msg as unknown as { subtype?: string }).subtype;
          hitTurnCeiling = subtype === 'error_max_turns';
          break;
        }
      }
      if (hitTurnCeiling) {
        this.logger.warn(
          '[memory-curator] curator run stopped at its turn ceiling; the model had more tool work queued than the budget allows',
          { maxTurns: CURATOR_MAX_TURNS, toolUses, toolNames },
        );
      }
      if (collected.length > 0)
        return { kind: 'text', text: collected, toolUses };
      if (toolUses > 0) return { kind: 'tools-only', toolUses, toolNames };
      return { kind: 'silent' };
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
