import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { UsageSummaryParamsSchema, UsageSummarySchema, UsageTopSessionSchema } from '@ptah-extension/shared';
import type { UsageFact, UsageSummary, UsageSummaryParams, UsageSourceStatus, UsageTopSession } from '@ptah-extension/shared';
import { ClaudeLedgerSource } from './sources/claude-ledger.source';
import { CliSessionSource } from './cli-session.source';
import { CodexSource } from './sources/codex.source';
import { OpenCodeSource } from './sources/opencode.source';
import { GrokSource } from './sources/grok.source';
import { UsagePricingService } from './usage-pricing.service';
import type { UsageContribution, UsageSource } from './usage-source.types';

const DAY_MS = 86_400_000;
const MAX_FACTS = 100_000;
/** Source ids in the same order as `UsageAnalyticsService.sources`. */
const SOURCE_IDS = ['claude-ledger', 'codex', 'opencode', 'grok', 'antigravity', 'ollama-cloud'] as const;

@injectable()
export class UsageAnalyticsService {
  private readonly sources: readonly UsageSource[];

  constructor(
    @inject(ClaudeLedgerSource) claude: UsageSource,
    @inject(UsagePricingService) private readonly pricing: Pick<UsagePricingService, 'price'>,
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'warn'>,
  ) {
    this.sources = [claude, new CodexSource(), new OpenCodeSource(), new GrokSource(), new CliSessionSource('antigravity'), new CliSessionSource('ollama-cloud')];
  }

  /** workspace is an already authorized absolute workspace path from the RPC boundary. */
  async summarize(params: UsageSummaryParams, workspacePath: string, signal?: AbortSignal): Promise<UsageSummary> {
    const validated = UsageSummaryParamsSchema.parse(params);
    const now = Date.now();
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    const since = today - (validated.range - 1) * DAY_MS;
    const until = today + DAY_MS;
    const statuses: UsageSourceStatus[] = [];
    const seen = new Set<string>();
    const groups = new Map<string, UsageFact>();
    const sessions = new Map<string, UsageTopSession>();
    const sessionModels = new Map<string, Map<string, { providerId: string; modelId: string; costUsd: number | null; tokens: number }>>();
    const subagents = new Set<string>();
    const invalidSessionSources = new Set<string>();
    let messageCount = 0;
    let priceSource: 'openrouter' | 'bundled' | 'unavailable' = 'unavailable';
    for (const [sourceIndex, source] of this.sources.entries()) {
      const sourceId = SOURCE_IDS[sourceIndex];
      if (signal?.aborted) {
        statuses.push({ sourceId, status: 'partial', reason: 'time-budget' });
        statuses.push(...skippedSources(sourceIndex, 'time-budget'));
        break;
      }
      try {
        const result = await source.read(workspacePath, since, until, signal);
        let overflow = false;
        for (const contribution of result.contributions) {
          if (signal?.aborted) break;
          if (!validContribution(contribution, since, until)) continue;
          const dedupKey = `${contribution.sourceId}:${contribution.key}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          const priced = await this.pricing.price(contribution);
          const day = new Date(contribution.timestampMs).toISOString().slice(0, 10);
          const key = JSON.stringify([day, contribution.providerId, contribution.modelId, contribution.sourceId, priced.costSource]);
          const previous = groups.get(key);
          if (!previous && groups.size >= MAX_FACTS) { overflow = true; break; }
          const validSessionId = contribution.sessionId && UsageTopSessionSchema.shape.sessionId.safeParse(contribution.sessionId).success;
          if (contribution.sessionId && !validSessionId && !invalidSessionSources.has(contribution.sourceId)) {
            invalidSessionSources.add(contribution.sourceId);
            this.logger.warn('[UsageAnalytics] Invalid session id omitted', { sourceId: contribution.sourceId });
          }
          if (validSessionId && contribution.sessionId) {
            const sessionKey = `${contribution.sourceId}:${contribution.sessionId}`;
            const previousSession = sessions.get(sessionKey);
            const tokens = contribution.inputUncachedTokens + contribution.cacheReadTokens + contribution.cacheWriteTokens + contribution.outputTokens;
            let models = sessionModels.get(sessionKey);
            if (!models) { models = new Map(); sessionModels.set(sessionKey, models); }
            const modelKey = JSON.stringify([contribution.providerId, contribution.modelId]);
            const previousModel = models.get(modelKey);
            models.set(modelKey, {
              providerId: contribution.providerId, modelId: contribution.modelId,
              costUsd: priced.costUsd === null ? (previousModel?.costUsd ?? null) : (previousModel?.costUsd ?? 0) + priced.costUsd,
              tokens: (previousModel?.tokens ?? 0) + tokens,
            });
            const dominantModel = [...models.values()].sort((a, b) =>
              (a.costUsd === null ? 1 : 0) - (b.costUsd === null ? 1 : 0) ||
              (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.tokens - a.tokens ||
              a.modelId.localeCompare(b.modelId, 'en'),
            )[0];
            const agentKey = contribution.subagentId ? `${sessionKey}:${contribution.subagentId}` : null;
            const newAgent = agentKey !== null && !subagents.has(agentKey);
            if (agentKey) subagents.add(agentKey);
            sessions.set(sessionKey, {
              sessionId: contribution.sessionId,
              title: (contribution.sessionTitle?.trim() || `Session ${contribution.sessionId.slice(0, 8)}`).slice(0, 500),
              providerId: dominantModel.providerId,
              modelId: dominantModel.modelId,
              costUsd: priced.costUsd === null ? (previousSession?.costUsd ?? null) : (previousSession?.costUsd ?? 0) + priced.costUsd,
              unpriced: (previousSession?.unpriced ?? false) || priced.costUsd === null,
              tokens: (previousSession?.tokens ?? 0) + tokens,
              messageCount: (previousSession?.messageCount ?? 0) + (contribution.requestCount ?? 1),
              subagentCount: (previousSession?.subagentCount ?? 0) + Number(newAgent),
              lastActive: new Date(Math.max(contribution.timestampMs, previousSession ? Date.parse(previousSession.lastActive) : 0)).toISOString(),
            });
            messageCount += contribution.requestCount ?? 1;
          }
          if (priced.priceSource === 'openrouter' || (priced.priceSource === 'bundled' && priceSource === 'unavailable')) priceSource = priced.priceSource;
          const row: UsageFact = {
            day, providerId: contribution.providerId, modelId: contribution.modelId,
            sourceId: contribution.sourceId, costSource: priced.costSource,
            inputUncachedTokens: (previous?.inputUncachedTokens ?? 0) + contribution.inputUncachedTokens,
            cacheReadTokens: (previous?.cacheReadTokens ?? 0) + contribution.cacheReadTokens,
            cacheWriteTokens: (previous?.cacheWriteTokens ?? 0) + contribution.cacheWriteTokens,
            outputTokens: (previous?.outputTokens ?? 0) + contribution.outputTokens,
            costUsd: priced.costUsd === null ? null : (previous?.costUsd ?? 0) + priced.costUsd,
            cacheSavingsUsd: priced.cacheSavingsUsd === null ? null : (previous?.cacheSavingsUsd ?? 0) + priced.cacheSavingsUsd,
            ...(contribution.requestCount !== undefined ? { requestCount: (previous?.requestCount ?? 0) + contribution.requestCount } : {}),
          };
          groups.set(key, row);
        }
        statuses.push(signal?.aborted ? { ...result.status, status: 'partial', reason: 'time-budget' } : overflow ? { ...result.status, status: 'partial', reason: 'fact-limit' } : result.status);
        if (signal?.aborted || overflow) {
          statuses.push(...skippedSources(sourceIndex, signal?.aborted ? 'time-budget' : 'fact-limit'));
          break;
        }
      } catch (error: unknown) {
        if (signal?.aborted) {
          statuses.push({ sourceId, status: 'partial', reason: 'time-budget' });
          statuses.push(...skippedSources(sourceIndex, 'time-budget'));
          break;
        }
        this.logger.warn('[UsageAnalytics] Source failed', { reason: error instanceof Error ? error.name : 'unknown' });
        statuses.push({ sourceId, status: 'unavailable', reason: 'Usage source failed' });
      }
    }
    const summary: UsageSummary = {
      version: 1, generatedAt: new Date(now).toISOString(), timeZone: 'UTC',
      fromDay: new Date(since).toISOString().slice(0, 10),
      untilDayExclusive: new Date(until).toISOString().slice(0, 10),
      facts: [...groups.values()].sort((a, b) => JSON.stringify([a.day, a.providerId, a.modelId]).localeCompare(JSON.stringify([b.day, b.providerId, b.modelId]), 'en')),
      topSessions: [...sessions.values()].sort((a, b) =>
        (a.costUsd === null ? 1 : 0) - (b.costUsd === null ? 1 : 0) ||
        (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.tokens - a.tokens ||
        a.sessionId.localeCompare(b.sessionId, 'en'),
      ).slice(0, 5),
      sessionCount: sessions.size, messageCount, subagentCount: subagents.size,
      sources: statuses,
      pricing: { source: priceSource, asOf: priceSource === 'unavailable' ? null : new Date(now).toISOString() },
    };
    const checked = UsageSummarySchema.parse(summary);
    return checked;
  }
}

function validContribution(row: UsageContribution, since: number, until: number): boolean {
  return Number.isFinite(row.timestampMs) && row.timestampMs >= since && row.timestampMs < until &&
    [row.inputUncachedTokens, row.cacheReadTokens, row.cacheWriteTokens, row.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0);
}

/** Statuses for the sources after `lastIndex` that did not run. */
function skippedSources(lastIndex: number, reason: 'time-budget' | 'fact-limit'): UsageSourceStatus[] {
  return SOURCE_IDS.slice(lastIndex + 1).map((sourceId) => ({ sourceId, status: 'unavailable', reason }));
}
