/**
 * Session usage aggregator — turns usage ledgers, or already-priced usage
 * contributions, into a `SessionStatsEntry`.
 *
 * Pure: no I/O, no DI, no clock. Scope selection, token totals, the per-model
 * breakdown and cost are all decided here, so the golden accounting specs pin
 * one function. Every stats surface goes through it: the sessions list and the
 * resume prefix aggregate LEDGERS; the live session owner aggregates
 * CONTRIBUTIONS (the fixed history prefix plus the latest cumulative result of
 * each query run). Both finish through the same row/total rules below
 * (TASK_2026_533).
 *
 * ## Cost is a current-rate-card estimate, and never guesses a provider
 *
 * Each model's cost is computed from the transcript's OWN model id through the
 * `lookupPricing` the caller passes. There is no active-provider tier
 * resolution here: a historical session is never priced against whichever
 * provider happens to be active now. A model with no rate stays unpriced.
 *
 * ## A partial sum is not a total
 *
 * `totalCost` is `null` whenever ANY counted usage has an unknown price.
 * `knownCost` carries the priced subtotal as a separately labeled figure, and
 * `pricingCoverage` says how much was priced. A provider-reported `0` is a
 * known zero.
 */

import {
  calculateMessageCost,
  pickPrimaryModel,
  type ModelPricing,
  type ModelUsageEntry,
  type SessionStatsCoverage,
  type SessionStatsEntry,
  type SessionStatsPricingCoverage,
} from '@ptah-extension/shared';
import type { SessionUsageLedger, UsageRecord } from './session-usage-ledger';

/** Which records a stats page counts. */
export type SessionStatsScopeSelection =
  /** Every record of the session's lifetime; compact boundaries ignored. */
  | { readonly kind: 'session' }
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
  /**
   * Subagent identities known to belong to the session, in any alias form
   * (`agent-<id>` file stem or bare `<id>`). The agent count is the number of
   * UNIQUE canonical ids — never the number of files or ledgers.
   */
  readonly subagentIds: readonly string[];
  readonly scope: SessionStatsScopeSelection;
}

/**
 * Already-normalized, already-priced usage to add together.
 *
 * Each contribution is a `SessionStatsReadEntry` for one disjoint slice of the
 * session: the fixed history prefix, or the latest cumulative result of one
 * query run. Its costs are final; nothing is repriced here.
 */
export interface SessionContributionsAggregateInput {
  readonly sessionId: string;
  readonly contributions: readonly SessionStatsReadEntry[];
  /** Subagent identities, any alias form; counted as unique canonical ids. */
  readonly subagentIds: readonly string[];
}

interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** One finished per-model row: the four token classes plus its cost. */
interface PricedRow extends TokenTotals {
  readonly model: string;
  readonly costUSD: number | null;
}

const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

/**
 * Canonical form of a subagent identity.
 *
 * The same agent reaches the backend as `agent-<id>` (its transcript file
 * stem) and as `<id>` (the SDK hook's `agent_id`). Returns `null` for a blank
 * id, which is not an identity.
 */
export function canonicalSubagentId(raw: string): string | null {
  let id = raw.trim();
  if (id.endsWith('.jsonl')) id = id.slice(0, -'.jsonl'.length);
  if (id.startsWith('agent-')) id = id.slice('agent-'.length);
  return id.length > 0 ? id : null;
}

/** Number of unique canonical ids in `ids`. */
export function countUniqueSubagents(ids: Iterable<string>): number {
  const unique = new Set<string>();
  for (const raw of ids) {
    const id = canonicalSubagentId(raw);
    if (id !== null) unique.add(id);
  }
  return unique.size;
}

/** Entry for a session whose transcript does not exist. */
export function emptySessionStats(sessionId: string): SessionStatsReadEntry {
  return {
    sessionId,
    model: null,
    totalCost: null,
    knownCost: null,
    tokens: ZERO_TOKENS,
    tokenCount: 0,
    messageCount: 0,
    agentSessionCount: 0,
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
    knownCost: null,
    tokens: ZERO_TOKENS,
    tokenCount: 0,
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
 * From LEDGERS (the sessions list and the resume prefix):
 * - `session`: every parent and subagent record, compact boundaries ignored.
 * - `current-context`: parent records after the parent's last compact
 *   boundary, plus each subagent's records after THAT subagent's own last
 *   compact boundary (all of them when it has none). No timestamp filter.
 * - `range`: every parent and subagent record with a timestamp in
 *   `[since, until)`. A usage record with no timestamp is omitted and counted
 *   in `untimestampedCount`, which makes coverage `partial`.
 *
 * `messageCount` counts parent assistant records only, as it always has.
 * A record with no model of its own uses the parent's `init` model.
 *
 * From CONTRIBUTIONS (the live session owner): token classes and per-model
 * rows add up; a contribution's cost is final and is never repriced. A proven
 * empty contribution (`status: 'empty'`, complete coverage) is neutral — its
 * display-level `null` cost cannot poison a later priced run.
 */
export function aggregateSessionUsage(
  input: SessionUsageAggregateInput,
  lookupPricing: PricingLookup,
): SessionStatsReadEntry;
export function aggregateSessionUsage(
  input: SessionContributionsAggregateInput,
): SessionStatsReadEntry;
export function aggregateSessionUsage(
  input: SessionUsageAggregateInput | SessionContributionsAggregateInput,
  lookupPricing?: PricingLookup,
): SessionStatsReadEntry {
  if ('contributions' in input) {
    return aggregateContributions(input);
  }
  if (!lookupPricing) {
    // Unreachable through the overloads; a ledger is priced at serve time.
    throw new TypeError('aggregateSessionUsage: ledgers need a pricing lookup');
  }
  return aggregateLedgers(input, lookupPricing);
}

function aggregateLedgers(
  input: SessionUsageAggregateInput,
  lookupPricing: PricingLookup,
): SessionStatsReadEntry {
  const { parent, scope } = input;
  const fallbackModel = parent.initModel;
  const totals: TokenTotals = { ...ZERO_TOKENS };
  const perModel = new Map<string, TokenTotals>();
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
    addTokens(totals, record);
    const model = record.model ?? fallbackModel;
    if (model === null) {
      unattributedTokens += tokenSum(record);
      return;
    }
    const bucket = perModel.get(model) ?? { ...ZERO_TOKENS };
    addTokens(bucket, record);
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
  const rows: PricedRow[] = Array.from(perModel.entries()).map(
    ([model, bucket]) => {
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
      return { model, ...bucket, costUSD };
    },
  );

  // A member transcript that could not be read holds usage nobody priced:
  // what was read survives as the known subtotal, never as the total.
  const pricingCoverage: SessionStatsPricingCoverage =
    pricedModels === 0
      ? 'none'
      : unpricedTokens > 0 || input.unreadableSubagents > 0
        ? 'partial'
        : 'full';
  const knownCost = pricedModels > 0 ? roundUsd(pricedCost) : null;

  return finishEntry({
    sessionId: input.sessionId,
    rows,
    tokens: totals,
    fallbackModel,
    totalCost: pricingCoverage === 'full' ? knownCost : null,
    knownCost,
    pricingCoverage,
    coverage:
      untimestampedCount > 0 || input.unreadableSubagents > 0
        ? 'partial'
        : 'complete',
    status: usageRecords > 0 ? 'ok' : 'empty',
    messageCount,
    untimestampedCount,
    subagentIds: input.subagentIds,
    scope: scope.kind,
  });
}

function aggregateContributions(
  input: SessionContributionsAggregateInput,
): SessionStatsReadEntry {
  const totals: TokenTotals = { ...ZERO_TOKENS };
  const perModel = new Map<string, TokenTotals & { costUSD: number | null }>();
  let messageCount = 0;
  let untimestampedCount = 0;
  let fallbackModel: string | null = null;
  let totalCost: number | null = 0;
  let knownCost = 0;
  let anyKnownCost = false;
  let coverage: SessionStatsCoverage = 'complete';
  const pricing = new Set<SessionStatsPricingCoverage>();
  let anyOk = false;
  let anyError = false;

  for (const part of input.contributions) {
    const neutral = part.status === 'empty' && part.coverage !== 'partial';
    if (part.coverage === 'partial' || part.status === 'error') {
      coverage = 'partial';
    }
    if (part.status === 'ok') anyOk = true;
    if (part.status === 'error') anyError = true;
    fallbackModel ??= part.model;
    messageCount += part.messageCount;
    untimestampedCount += part.untimestampedCount ?? 0;
    addTokens(totals, part.tokens);
    for (const row of part.modelUsageList ?? []) {
      const merged = perModel.get(row.model) ?? { ...ZERO_TOKENS, costUSD: 0 };
      merged.input += row.inputTokens;
      merged.output += row.outputTokens;
      merged.cacheRead += row.cacheRead ?? 0;
      merged.cacheCreation += row.cacheCreation ?? 0;
      merged.costUSD =
        merged.costUSD === null || row.costUSD === null
          ? null
          : merged.costUSD + row.costUSD;
      perModel.set(row.model, merged);
    }
    if (neutral) continue;

    pricing.add(part.pricingCoverage ?? (part.totalCost === null ? 'none' : 'full'));
    const partKnown = part.totalCost ?? part.knownCost ?? null;
    if (partKnown !== null) {
      knownCost += partKnown;
      anyKnownCost = true;
    }
    totalCost =
      totalCost === null || part.totalCost === null
        ? null
        : totalCost + part.totalCost;
  }

  const counted = pricing.size > 0;
  const pricingCoverage: SessionStatsPricingCoverage = !counted
    ? 'none'
    : pricing.size === 1
      ? [...pricing][0]
      : 'partial';

  const rows: PricedRow[] = Array.from(perModel.entries()).map(
    ([model, row]) => ({
      model,
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      cacheCreation: row.cacheCreation,
      costUSD: row.costUSD === null ? null : roundUsd(row.costUSD),
    }),
  );

  return finishEntry({
    sessionId: input.sessionId,
    rows,
    tokens: totals,
    fallbackModel,
    totalCost: counted && totalCost !== null ? roundUsd(totalCost) : null,
    knownCost: anyKnownCost ? roundUsd(knownCost) : null,
    pricingCoverage,
    coverage,
    status: anyOk ? 'ok' : anyError ? 'error' : 'empty',
    messageCount,
    untimestampedCount,
    subagentIds: input.subagentIds,
    scope: 'session',
  });
}

/** The shared tail of both aggregation paths: row order, model, shape. */
function finishEntry(params: {
  readonly sessionId: string;
  readonly rows: readonly PricedRow[];
  readonly tokens: TokenTotals;
  readonly fallbackModel: string | null;
  readonly totalCost: number | null;
  readonly knownCost: number | null;
  readonly pricingCoverage: SessionStatsPricingCoverage;
  readonly coverage: SessionStatsCoverage;
  readonly status: SessionStatsReadEntry['status'];
  readonly messageCount: number;
  readonly untimestampedCount: number;
  readonly subagentIds: readonly string[];
  readonly scope: NonNullable<SessionStatsReadEntry['scope']>;
}): SessionStatsReadEntry {
  const rows = [...params.rows].sort(
    (a, b) => (b.costUSD ?? -1) - (a.costUSD ?? -1),
  );
  const primaryEntries: ModelUsageEntry[] = rows.map((m) => ({
    model: m.model,
    totalCost: m.costUSD ?? 0,
    tokens: {
      input: m.input,
      output: m.output,
      cacheRead: m.cacheRead,
      cacheCreation: m.cacheCreation,
    },
  }));
  const tokens = { ...params.tokens };

  return {
    sessionId: params.sessionId,
    model: pickPrimaryModel(primaryEntries) ?? params.fallbackModel,
    totalCost: params.totalCost,
    knownCost: params.knownCost,
    tokens,
    tokenCount: tokenSum(tokens),
    messageCount: params.messageCount,
    agentSessionCount: countUniqueSubagents(params.subagentIds),
    ...(rows.length > 0 && {
      modelUsageList: rows.map((m) => ({
        model: m.model,
        inputTokens: m.input,
        outputTokens: m.output,
        cacheRead: m.cacheRead,
        cacheCreation: m.cacheCreation,
        costUSD: m.costUSD,
      })),
    }),
    status: params.status,
    coverage: params.coverage,
    untimestampedCount: params.untimestampedCount,
    pricingCoverage: params.pricingCoverage,
    scope: params.scope,
  };
}

function addTokens(target: TokenTotals, add: Readonly<TokenTotals>): void {
  target.input += add.input;
  target.output += add.output;
  target.cacheRead += add.cacheRead;
  target.cacheCreation += add.cacheCreation;
}

function tokenSum(t: Readonly<TokenTotals>): number {
  return t.input + t.output + t.cacheRead + t.cacheCreation;
}

function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
