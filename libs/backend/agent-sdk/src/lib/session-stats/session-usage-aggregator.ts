/**
 * Session usage aggregator — turns usage ledgers into a `SessionStatsEntry`.
 *
 * Pure: no I/O, no DI, no clock. Scope selection, token totals, the per-model
 * breakdown and cost are all decided here, so the golden accounting specs pin
 * one function.
 *
 * ## Cost is a current-rate-card estimate, and never guesses a provider
 *
 * Each model's cost is computed from the transcript's OWN model id through the
 * `lookupPricing` the caller passes (the shared runtime rate card). There is no
 * active-provider tier resolution: a historical session is never priced against
 * whichever provider happens to be active now. A model with no rate stays
 * unpriced, `pricingCoverage` says so, and `totalCost` is `null` exactly when
 * no counted model has a rate (TASK_2026_411 B4).
 */

import {
  calculateMessageCost,
  pickPrimaryModel,
  type ModelPricing,
  type ModelUsageEntry,
  type SessionStatsEntry,
  type SessionStatsPricingCoverage,
} from '@ptah-extension/shared';
import type { SessionUsageLedger, UsageRecord } from './session-usage-ledger';

/** Which records a stats page counts. */
export type SessionStatsScopeSelection =
  | { readonly kind: 'current-context' }
  | {
      readonly kind: 'range';
      /** Inclusive, epoch ms. */
      readonly since: number;
      /** Exclusive, epoch ms. */
      readonly until: number;
    };

/** A stats entry as the reader produces it; `cliAgents` is the handler's. */
export type SessionStatsReadEntry = Omit<SessionStatsEntry, 'cliAgents'>;

/** Rate-card lookup. Returns `null` when the model has no published rate. */
export type PricingLookup = (modelId: string) => ModelPricing | null;

export interface SessionUsageAggregateInput {
  readonly sessionId: string;
  readonly parent: SessionUsageLedger;
  readonly subagents: readonly SessionUsageLedger[];
  /** Subagent transcripts that belong to the session but could not be read. */
  readonly unreadableSubagents: number;
  readonly scope: SessionStatsScopeSelection;
}

interface ModelBucket {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

/** Entry for a session whose transcript does not exist. */
export function emptySessionStats(sessionId: string): SessionStatsReadEntry {
  return {
    sessionId,
    model: null,
    totalCost: null,
    tokens: ZERO_TOKENS,
    messageCount: 0,
    status: 'empty',
    coverage: 'complete',
    untimestampedCount: 0,
    pricingCoverage: 'none',
  };
}

/** Entry for a session that could not be read (I/O failure or abort). */
export function failedSessionStats(sessionId: string): SessionStatsReadEntry {
  return {
    sessionId,
    model: null,
    totalCost: null,
    tokens: ZERO_TOKENS,
    messageCount: 0,
    status: 'error',
    coverage: 'partial',
    untimestampedCount: 0,
    pricingCoverage: 'none',
  };
}

/**
 * Aggregate one session.
 *
 * - `current-context`: parent records after the parent's last compact
 *   boundary, plus each subagent's records after THAT subagent's own last
 *   compact boundary (all of them when it has none). A subagent compacts its
 *   own context exactly as the parent does, so its pre-compaction usage is no
 *   more "current" than the parent's. No timestamp filter.
 * - `range`: every parent and subagent record with a timestamp in
 *   `[since, until)`. A usage record with no timestamp is omitted and counted
 *   in `untimestampedCount`, which makes coverage `partial`.
 *
 * `messageCount` counts parent assistant records only, as it always has.
 * A record with no model of its own uses the parent's `init` model.
 */
export function aggregateSessionUsage(
  input: SessionUsageAggregateInput,
  lookupPricing: PricingLookup,
): SessionStatsReadEntry {
  const { parent, scope } = input;
  const fallbackModel = parent.initModel;
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const perModel = new Map<string, ModelBucket>();
  let unattributedTokens = 0;
  let usageRecords = 0;
  let messageCount = 0;
  let untimestampedCount = 0;

  const count = (record: UsageRecord, isParent: boolean): void => {
    if (scope.kind === 'range') {
      if (record.timestampMs === null) {
        if (record.hasUsage) untimestampedCount++;
        return;
      }
      if (record.timestampMs < scope.since || record.timestampMs >= scope.until) {
        return;
      }
    }
    if (isParent && record.assistant) messageCount++;
    if (!record.hasUsage) return;
    usageRecords++;
    totals.input += record.input;
    totals.output += record.output;
    totals.cacheRead += record.cacheRead;
    totals.cacheCreation += record.cacheCreation;
    const model = record.model ?? fallbackModel;
    if (model === null) {
      unattributedTokens += tokenSum(record);
      return;
    }
    const bucket = perModel.get(model) ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    };
    bucket.input += record.input;
    bucket.output += record.output;
    bucket.cacheRead += record.cacheRead;
    bucket.cacheCreation += record.cacheCreation;
    perModel.set(model, bucket);
  };

  // Every ledger — parent and subagent alike — compacts independently, so
  // `current-context` starts each one at its OWN last boundary.
  const contextStart = (ledger: SessionUsageLedger): number =>
    scope.kind === 'current-context' ? ledger.currentContextStart : 0;
  for (let i = contextStart(parent); i < parent.records.length; i++) {
    count(parent.records[i], true);
  }
  for (const subagent of input.subagents) {
    for (let i = contextStart(subagent); i < subagent.records.length; i++) {
      count(subagent.records[i], false);
    }
  }

  let pricedModels = 0;
  let pricedCost = 0;
  let unpricedTokens = unattributedTokens;
  const modelUsageList = Array.from(perModel.entries())
    .map(([model, bucket]) => {
      const costUSD = calculateMessageCost(
        model,
        {
          input: bucket.input,
          output: bucket.output,
          cacheHit: bucket.cacheRead,
          cacheCreation: bucket.cacheCreation,
        },
        lookupPricing(model),
      );
      if (costUSD === null) {
        unpricedTokens += tokenSum(bucket);
      } else {
        pricedModels++;
        pricedCost += costUSD;
      }
      return {
        model,
        inputTokens: bucket.input,
        outputTokens: bucket.output,
        costUSD,
        cacheRead: bucket.cacheRead,
        cacheCreation: bucket.cacheCreation,
      };
    })
    .sort((a, b) => (b.costUSD ?? -1) - (a.costUSD ?? -1));

  const pricingCoverage: SessionStatsPricingCoverage =
    pricedModels === 0 ? 'none' : unpricedTokens > 0 ? 'partial' : 'full';
  const primaryEntries: ModelUsageEntry[] = modelUsageList.map((m) => ({
    model: m.model,
    totalCost: m.costUSD ?? 0,
    tokens: {
      input: m.inputTokens,
      output: m.outputTokens,
      cacheRead: m.cacheRead,
      cacheCreation: m.cacheCreation,
    },
  }));

  return {
    sessionId: input.sessionId,
    model: pickPrimaryModel(primaryEntries) ?? fallbackModel,
    totalCost: pricedModels > 0 ? Math.round(pricedCost * 1e6) / 1e6 : null,
    tokens: totals,
    messageCount,
    agentSessionCount: input.subagents.length + input.unreadableSubagents,
    ...(modelUsageList.length > 0 && {
      modelUsageList: modelUsageList.map((m) => ({
        model: m.model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        costUSD: m.costUSD,
      })),
    }),
    status: usageRecords > 0 ? 'ok' : 'empty',
    coverage:
      untimestampedCount > 0 || input.unreadableSubagents > 0
        ? 'partial'
        : 'complete',
    untimestampedCount,
    pricingCoverage,
  };
}

function tokenSum(t: {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}): number {
  return t.input + t.output + t.cacheRead + t.cacheCreation;
}
