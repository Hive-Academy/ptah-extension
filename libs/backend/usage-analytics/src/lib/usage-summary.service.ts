import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { UsageSummaryParamsSchema, UsageSummarySchema, UsageTopSessionSchema } from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from '@ptah-extension/shared';
import { SessionStatsRepository } from '@ptah-extension/persistence-sqlite';
import type { UsageFact, UsageSummary, UsageSummaryParams, UsageSourceStatus, UsageTopSession } from '@ptah-extension/shared';
import { ClaudeLedgerSource } from './sources/claude-ledger.source';
import { CliSessionSource } from './cli-session.source';
import { CodexSource } from './sources/codex.source';
import { OpenCodeSource } from './sources/opencode.source';
import { GrokSource } from './sources/grok.source';
import { UsagePricingService } from './usage-pricing.service';
import type { UsageContribution, UsageSource } from './usage-source.types';

const DAY_MS = 86_400_000;
const LEDGER_SLICE_MS = 3_600_000;
const MAX_FACTS = 100_000;
/** Source ids in the same order as `UsageAnalyticsService.sources`. */
const EXTERNAL_SOURCE_IDS = ['codex', 'opencode', 'grok', 'antigravity', 'ollama-cloud'] as const;

@injectable()
export class UsageAnalyticsService {
  private readonly sources: readonly UsageSource[];
  private readonly sourceIds: readonly string[];

  constructor(
    @inject(ClaudeLedgerSource) claude: UsageSource,
    @inject(UsagePricingService) private readonly pricing: Pick<UsagePricingService, 'price'>,
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'warn'>,
    @inject(SessionStatsRepository, { isOptional: true }) private readonly statsRepository?: SessionStatsRepository,
  ) {
    const external = [new CodexSource(), new OpenCodeSource(), new GrokSource(), new CliSessionSource('antigravity'), new CliSessionSource('ollama-cloud')];
    this.sources = statsRepository ? external : [claude, ...external];
    this.sourceIds = statsRepository ? EXTERNAL_SOURCE_IDS : ['claude-ledger', ...EXTERNAL_SOURCE_IDS];
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
    const ledgerTopSessions: UsageTopSession[] = [];
    let ledgerSessionCount = 0;
    const sessionModels = new Map<string, Map<string, { providerId: string; modelId: string; costUsd: number | null; tokens: number }>>();
    const subagents = new Set<string>();
    const invalidSessionSources = new Set<string>();
    const ledgerCodexSessions = new Map<string, boolean>();
    let workspaceKey: string | undefined;
    let messageCount = 0;
    let priceSource: 'openrouter' | 'bundled' | 'unavailable' = 'unavailable';
    if (this.statsRepository) {
      try {
        workspaceKey = normalizeWorkspaceRoot(workspacePath);
        if (signal?.aborted) throw new Error('time-budget');
        const coverage = await this.statsRepository.getWorkspaceCoverage(workspaceKey);
        let factLimitReached = false;
        for (let cursor = since; cursor < until; cursor += signal ? LEDGER_SLICE_MS : until - since) {
          if (signal?.aborted) break;
          const ledgerGroups = await this.statsRepository.getWorkspaceUsageGroups(workspaceKey, cursor, Math.min(until, cursor + (signal ? LEDGER_SLICE_MS : until - since)));
          for (const row of ledgerGroups) {
          if (signal?.aborted) break;
          const costSource = row.has_unpriced === 0 && (row.cost_authority === 'provider-reported' || row.cost_authority === 'model-priced')
            ? row.cost_authority : 'unpriced';
          const fact: UsageFact = {
            day: row.day, providerId: row.provider_id, modelId: row.model_id,
            sourceId: 'claude-ledger', costSource,
            inputUncachedTokens: row.input_tokens, outputTokens: row.output_tokens,
            cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens,
            costUsd: costSource === 'unpriced' ? null : (row.known_cost_micro_usd ?? 0) / 1_000_000,
            ...(row.known_cost_micro_usd !== null ? { knownCostUsd: row.known_cost_micro_usd / 1_000_000 } : {}),
            cacheSavingsUsd: null,
          };
          const key = JSON.stringify([fact.day, fact.providerId, fact.modelId, fact.sourceId, fact.costSource, row.source]);
          const prior = groups.get(key);
          if (!prior && groups.size >= MAX_FACTS) { factLimitReached = true; continue; }
          groups.set(key, prior ? {
            ...fact,
            inputUncachedTokens: prior.inputUncachedTokens + fact.inputUncachedTokens,
            outputTokens: prior.outputTokens + fact.outputTokens,
            cacheReadTokens: prior.cacheReadTokens + fact.cacheReadTokens,
            cacheWriteTokens: prior.cacheWriteTokens + fact.cacheWriteTokens,
            costUsd: prior.costUsd === null || fact.costUsd === null ? null : prior.costUsd + fact.costUsd,
            ...mergeKnownCost(prior.knownCostUsd, fact.knownCostUsd),
          } : fact);
          }
          if (signal) await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (!signal?.aborted) {
        ledgerSessionCount = await this.statsRepository.getWorkspaceSessionCount(workspaceKey, since, until);
        if (signal?.aborted) throw new Error('time-budget');
        messageCount += await this.statsRepository.getWorkspaceMessageCount(workspaceKey, since, until);
        if (signal?.aborted) throw new Error('time-budget');
        const topRows = await this.statsRepository.getWorkspaceTopSessions(workspaceKey, since, until);
        for (const row of topRows) {
          ledgerTopSessions.push(UsageTopSessionSchema.parse({
            sessionId: row.session_id,
            title: (row.title.trim() || `Session ${row.session_id.slice(0, 8)}`).slice(0, 500),
            providerId: row.provider_id,
            modelId: row.model_id,
            costUsd: row.known_cost_micro_usd === null ? null : row.known_cost_micro_usd / 1_000_000,
            unpriced: row.has_unpriced === 1,
            tokens: row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens,
            messageCount: row.message_count,
            subagentCount: 0,
            lastActive: new Date(row.last_active_ms).toISOString(),
          }));
        }
        }
        statuses.push({ sourceId: 'claude-ledger', status: 'partial', ...(coverage ? { coverageStart: new Date(coverage.first_captured_at_ms).toISOString().slice(0, 10) } : {}), reason: signal?.aborted ? 'time-budget' : factLimitReached
          ? 'fact-limit' : coverage
            ? `Historical sessions were not backfilled; data starts ${new Date(coverage.first_captured_at_ms).toISOString()}; subagent counts unavailable`
            : 'Historical sessions were not backfilled; no live usage captured yet' });
      } catch (error: unknown) {
        if (signal?.aborted) {
          statuses.push({ sourceId: 'claude-ledger', status: 'partial', reason: 'time-budget' });
        } else {
        this.logger.warn('[UsageAnalytics] Session ledger unavailable', { reason: error instanceof Error ? error.name : 'unknown' });
        statuses.push({ sourceId: 'claude-ledger', status: 'unavailable', reason: 'Session ledger unavailable' });
        }
      }
    }
    for (const [sourceIndex, source] of this.sources.entries()) {
      const sourceId = this.sourceIds[sourceIndex];
      if (signal?.aborted) {
        statuses.push({ sourceId, status: 'partial', reason: 'time-budget' });
        statuses.push(...skippedSources(this.sourceIds, sourceIndex, 'time-budget'));
        break;
      }
      try {
        const result = await source.read(workspacePath, since, until, signal);
        let overflow = false;
        for (const contribution of result.contributions) {
          if (signal?.aborted) break;
          if (!validContribution(contribution, since, until)) continue;
          if (sourceId === 'codex' && contribution.sessionId && this.statsRepository && workspaceKey) {
            let overlaps = ledgerCodexSessions.get(contribution.sessionId);
            if (overlaps === undefined) {
              overlaps = await this.statsRepository.hasWorkspaceCodexRun(workspaceKey, contribution.sessionId, since, until);
              ledgerCodexSessions.set(contribution.sessionId, overlaps);
            }
            if (overlaps) continue;
          }
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
          statuses.push(...skippedSources(this.sourceIds, sourceIndex, signal?.aborted ? 'time-budget' : 'fact-limit'));
          break;
        }
      } catch (error: unknown) {
        if (signal?.aborted) {
          statuses.push({ sourceId, status: 'partial', reason: 'time-budget' });
          statuses.push(...skippedSources(this.sourceIds, sourceIndex, 'time-budget'));
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
      topSessions: [...ledgerTopSessions, ...sessions.values()].sort((a, b) =>
        (a.costUsd === null ? 1 : 0) - (b.costUsd === null ? 1 : 0) ||
        (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.tokens - a.tokens ||
        a.sessionId.localeCompare(b.sessionId, 'en'),
      ).slice(0, 5),
      sessionCount: ledgerSessionCount + sessions.size, messageCount, subagentCount: subagents.size,
      sources: statuses,
      pricing: { source: priceSource, asOf: priceSource === 'unavailable' ? null : new Date(now).toISOString() },
    };
    const checked = UsageSummarySchema.parse(summary);
    return checked;
  }
}

/**
 * Sum two optional known costs across ledger slices. When neither slice had a
 * known cost the field stays absent, so the UI shows "no data" and not $0.00.
 */
export function mergeKnownCost(
  prior: number | undefined,
  next: number | undefined,
): { knownCostUsd?: number } {
  if (prior === undefined && next === undefined) return {};
  return { knownCostUsd: (prior ?? 0) + (next ?? 0) };
}

function validContribution(row: UsageContribution, since: number, until: number): boolean {
  return Number.isFinite(row.timestampMs) && row.timestampMs >= since && row.timestampMs < until &&
    [row.inputUncachedTokens, row.cacheReadTokens, row.cacheWriteTokens, row.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0);
}

/** Statuses for the sources after `lastIndex` that did not run. */
function skippedSources(sourceIds: readonly string[], lastIndex: number, reason: 'time-budget' | 'fact-limit'): UsageSourceStatus[] {
  return sourceIds.slice(lastIndex + 1).map((sourceId) => ({ sourceId, status: 'unavailable', reason }));
}
