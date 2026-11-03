import { z } from 'zod';
import { PLATFORM_TOKENS, type SessionUsageContribution } from '@ptah-extension/platform-core';
export type { SessionUsageSink, SessionUsageContribution, SessionUsageModelDelta } from '@ptah-extension/platform-core';

/**
 * `SessionUsageSink` — the host-neutral port that persists ACCEPTED live
 * usage into the durable session usage ledger (TASK_2026_870 Phase 1).
 *
 * Producers are the three ingestion boundaries that already own the
 * acceptance decision, each normalizing its provider's own semantics into
 * the one shape below:
 *
 *  - `'sdk-owner'` — `SessionStatsOwnerService` after it ACCEPTS a cumulative
 *    SDK result; the contribution carries that turn's per-model deltas, net
 *    of the run's restored base;
 *  - `'codex-checkpoint'` — `SessionMetadataStore` after it accepts a
 *    non-regressing native Codex usage checkpoint; the contribution carries
 *    the per-thread accrued deltas against the previously stored checkpoint;
 *  - `'cli-lane'` — the CLI lane completion path with the turn total a lane
 *    reported at its terminal transition.
 *
 * The adapter is a host binding under `SESSION_USAGE_SINK` (optional;
 * `persistence-sqlite` binds it in `registerSessionStoreServices`). Every
 * producer keeps working when the binding is absent — live capture is then
 * off.
 *
 * Contract, enforced by {@link sessionUsageContributionSchema}:
 *
 *  - counters are the DELTAS of one accepted event, never cumulative
 *    figures, so a row can be appended and summed without de-duplicating a
 *    running total;
 *  - `eventKey` makes the write idempotent: the adapter upserts by
 *    `(sessionId, producer, eventKey, modelId)`, so a replay of the same
 *    accepted event converges to the same rows and a lost write is repaired
 *    by the next retry of the same event;
 *  - money crosses the port as integer micro-USD, converted once by the
 *    producer through {@link usdToMicroUsd}. An unknown price is `null`,
 *    never zero;
 *  - the adapter stamps `source = 'live'` on every row written through
 *    this port. Live capture is the only producer: transcript backfill is
 *    excluded by decision and never calls this port;
 *  - `recordUsage` may reject on a failed write or a full queue. Producers
 *    log that failure without breaking the agent stream. The adapter logs
 *    each failure and `flush()` reports accumulated failures at shutdown.
 */

/**
 * The ingestion boundary that normalized a contribution. Never a provider
 * name: the same provider reaches the ledger through different boundaries.
 */
export const SESSION_USAGE_PRODUCERS = [
  'sdk-owner',
  'codex-checkpoint',
  'cli-lane',
] as const;
export type SessionUsageProducer = (typeof SESSION_USAGE_PRODUCERS)[number];

/**
 * Who is authoritative for a cost figure, kept independent of the producer:
 * dollars the provider itself reported, a rate-card estimate, or no known
 * price at all.
 */
export const SESSION_USAGE_COST_AUTHORITIES = [
  'provider-reported',
  'model-priced',
  'unpriced',
] as const;
export type SessionUsageCostAuthority =
  (typeof SESSION_USAGE_COST_AUTHORITIES)[number];

/**
 * Row ceiling per contribution. Matches `MAX_USAGE_THREADS` of the native
 * Codex checkpoint, the widest producer; a grouped-by-model projection of a
 * valid checkpoint can never exceed it.
 */
export const MAX_USAGE_MODELS_PER_CONTRIBUTION = 256;

/**
 * Ledger counters must be safe non-negative integers before the SQLite boundary.
 */
const TokenCount = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const MicroUsd = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const Identifier = z.string().min(1);
const CostAuthority = z.enum(SESSION_USAGE_COST_AUTHORITIES);

const sessionUsageModelDeltaSchema = z
  .object({
    /**
     * The provider's own model id, or `null` when the usage is real but not
     * attributable to a model. Distinct from the session-level residual the
     * ADAPTER derives; a `null` here is honest missing attribution.
     */
    modelId: Identifier.nullable(),
    inputTokens: TokenCount,
    outputTokens: TokenCount,
    cacheReadTokens: TokenCount,
    cacheCreationTokens: TokenCount,
    /** This row's own cost in micro-USD, `null` when it has no known price. */
    knownCostMicroUsd: MicroUsd.nullable(),
    costAuthority: CostAuthority,
  })
  .strict();

/**
 * One accepted usage event, normalized at one ingestion boundary. All fields
 * are required at the port; a producer that lacks a value passes `null`.
 */
export const sessionUsageContributionSchema = z
  .object({
    /** The Ptah session the usage belongs to (the lane's own session for lanes). */
    sessionId: Identifier,
    producer: z.enum(SESSION_USAGE_PRODUCERS),
    /** Producer-scoped run identity: query run token, root thread id, lane id. */
    runId: Identifier,
    /** Producer-scoped turn identity inside the run, when one is known. */
    turnId: Identifier.nullable(),
    /**
     * Idempotency key of the accepted event within
     * `(sessionId, producer, runId)`. A replay of the same event must reuse
     * it; two different accepted events must not.
     */
    eventKey: Identifier,
    /** The Ptah session that spawned this session, when one is known. */
    parentSessionId: Identifier.nullable(),
    /** The subagent identity inside the parent session, when one exists. */
    subagentId: Identifier.nullable(),
    /** The provider the usage ran on, when the boundary knows it. */
    providerId: Identifier.nullable(),
    /** When the event happened; ingestion time is acceptable for live capture. */
    occurredAtMs: TokenCount,
    /**
     * The producer's monotonic counter for the session at this event. The
     * adapter uses it to refuse downgrades, never to order writes.
     */
    revision: TokenCount,
    /** Per-model deltas of this event, at most {@link MAX_USAGE_MODELS_PER_CONTRIBUTION}. */
    models: z
      .array(sessionUsageModelDeltaSchema)
      .max(MAX_USAGE_MODELS_PER_CONTRIBUTION),
    /**
     * The event's own authoritative total in micro-USD, `null` when unknown.
     * On a provider-reported route this is the reported delta and may exceed
     * the per-model sum; the adapter stores the difference as the
     * session-level residual and never stores a negative one.
     */
    totalCostMicroUsd: MicroUsd.nullable(),
    /** Authority of {@link SessionUsageContribution.totalCostMicroUsd}. */
    totalCostAuthority: CostAuthority,
    /** Non-secret catalog evidence the cost was priced against, when known. */
    pricingVersion: Identifier.nullable(),
    runCostSnapshot: z.boolean().optional(),
    workspaceKey: Identifier.nullable().optional(),
    host: Identifier.nullable().optional(),
  })
  .strict();

/**
 * Validate a built contribution at the boundary. Returns `null` when it is
 * malformed; the caller logs that and skips the write — a broken
 * normalization must never break the stream it observed.
 */
export function parseSessionUsageContribution(
  raw: unknown,
): SessionUsageContribution | null {
  const parsed = sessionUsageContributionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Convert a non-negative finite USD figure to integer micro-USD. Returns
 * `null` for a negative, non-finite or unrepresentable value: an invalid
 * cost is unknown, never zero.
 */
export function usdToMicroUsd(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const micro = Math.round(value * 1e6);
  return Number.isSafeInteger(micro) ? micro : null;
}

/**
 * The port. `recordUsage` hands one validated contribution to the adapter
 * and returns immediately; see the module contract above.
 */
/**
 * DI token for the optional `SessionUsageSink` host binding, exported through
 * the public index so a host binds its adapter without reaching into
 * agent-sdk internals. The agent-sdk producers inject it with
 * `{ isOptional: true }`. `persistence-sqlite` binds its adapter under this
 * token in `registerSessionStoreServices`, which must run before the stats
 * owner and the session metadata store resolve — both capture the binding
 * once at construction.
 */
export const SESSION_USAGE_SINK = PLATFORM_TOKENS.SESSION_USAGE_SINK;
