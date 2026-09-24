/**
 * Stream Transformer
 *
 * Transforms SDK message streams into FlatStreamEventUnion for UI rendering.
 *
 * Responsibilities:
 * - Transform SDK stream_event messages to flat events for frontend
 * - Extract real session ID from system 'init' message
 * - Extract stats (cost, tokens, duration) from result messages
 *
 * NOTE: Does NOT store messages - SDK handles persistence natively.
 */

import { injectable, inject } from 'tsyringe';
import {
  SessionId,
  FlatStreamEventUnion,
  MessageTokenUsage,
  calculateMessageCost,
  resolveContextCapacity,
  type ContextCapacity,
  type ContextCapacityRoute,
  AuthEnv,
  type ModelPricing,
  type SessionStatsEntry,
} from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  RunModelUsage,
  SessionStatsOwnerService,
  UsageCostSource,
} from '../session-stats/session-stats-owner.service';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import { SDK_TOKENS } from '../di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import {
  SDKMessage,
  isResultMessage,
  isSystemInit,
  isStreamEvent,
  isMessageStart,
  isMessageDelta,
  isCompactBoundary,
  isLocalCommandOutput,
  isTaskStarted,
  isTaskProgress,
  isTaskUpdated,
  isTaskNotification,
} from '../types/sdk-types/claude-sdk.types';
import type { IModelResolver } from '../auth-env.port';
import type { IPricingProvider } from '../pricing.port';
import type { NoActivityWatchdog } from './no-activity-watchdog';
import type { SessionMcpStatusCallbackRegistry } from './session-mcp-status-callback-registry';

/**
 * Callback type for notifying when real session ID is received from SDK.
 * - tabId: Frontend tab ID for direct routing (undefined for resumed sessions)
 * - realSessionId: The actual SDK UUID that should be used for all subsequent operations
 */
export type SessionIdResolvedCallback = (
  tabId: string | undefined,
  realSessionId: string,
) => void;

/** One model's last-turn context components, as the stream reported them. */
interface TrackedTurnContext {
  input: number;
  cacheRead: number;
  cacheCreation: number;
}

/**
 * Reduce a model id to the spelling the two key spaces share.
 *
 * `modelUsage` is keyed by the raw model string the CLI ran (the SDK's
 * `ModelUsage.canonicalModel` doc: "may differ from the raw model string this
 * entry is keyed by"), so the 1M variant arrives as `claude-opus-5[1m]`. The
 * CLI strips that tag before calling the API, so the `message_start` the
 * tracker reads carries the bare id. Lowercase, trailing `[..]` variant tags,
 * a `provider/` prefix and a date snapshot suffix are spelling, not identity.
 */
function normalizeModelKey(modelId: string): string {
  const lower = modelId
    .trim()
    .toLowerCase()
    .replace(/(\[[^\]]*\])+$/, '');
  const unprefixed = lower.slice(lower.lastIndexOf('/') + 1);
  return unprefixed.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, '');
}

/**
 * Pair each `modelUsage` key with the last-turn context the stream tracked.
 *
 * Exact key first. A tracked entry left unclaimed is then matched by
 * normalized spelling against the key and its aliases (the SDK's canonical id,
 * the pricing-resolved id) — but only when the pairing is unambiguous in both
 * directions. Two rows that normalize alike (a `[1m]` main loop and a bare
 * subagent row of the same model) must not both receive the main loop's fill;
 * the row is left `undefined` instead, and the frontend fallback applies.
 */
function matchTrackedContexts(
  usageKeys: ReadonlyArray<{
    readonly key: string;
    readonly aliases: readonly string[];
  }>,
  tracked: ReadonlyMap<string, TrackedTurnContext>,
): Map<string, TrackedTurnContext> {
  const matched = new Map<string, TrackedTurnContext>();
  for (const { key } of usageKeys) {
    const exact = tracked.get(key);
    if (exact) matched.set(key, exact);
  }
  const unclaimed = [...tracked.keys()].filter((key) => !matched.has(key));
  if (unclaimed.length === 0) return matched;

  const hitsByUsageKey = new Map<string, string[]>();
  const usageKeyCountByTracked = new Map<string, number>();
  for (const { key, aliases } of usageKeys) {
    if (matched.has(key)) continue;
    const spellings = new Set(
      [key, ...aliases].filter(Boolean).map(normalizeModelKey),
    );
    const hits = unclaimed.filter((trackedKey) =>
      spellings.has(normalizeModelKey(trackedKey)),
    );
    hitsByUsageKey.set(key, hits);
    for (const trackedKey of hits) {
      usageKeyCountByTracked.set(
        trackedKey,
        (usageKeyCountByTracked.get(trackedKey) ?? 0) + 1,
      );
    }
  }
  for (const [key, hits] of hitsByUsageKey) {
    if (hits.length !== 1 || usageKeyCountByTracked.get(hits[0]) !== 1) {
      continue;
    }
    const context = tracked.get(hits[0]);
    if (context) matched.set(key, context);
  }
  return matched;
}

/**
 * Model usage data from SDK result message
 * Contains context window size for percentage calculation
 */
export interface ResultModelUsage {
  /** Model identifier (e.g., "claude-sonnet-4-20250514") */
  model: string;
  /** Input tokens used by this model (cumulative across all turns) */
  inputTokens: number;
  /** Output tokens generated by this model (cumulative across all turns) */
  outputTokens: number;
  /** Total context window size for this model */
  contextWindow: number;
  contextCapacity?: ContextCapacity;
  /** Per-model cost in USD from SDK */
  costUSD: number | null;
  /** Cache read input tokens for this model (cumulative across all turns) */
  cacheReadInputTokens: number;
  /**
   * Current context fill from the last API turn (input + cache_read +
   * cache_creation tokens). Unlike the cumulative
   * inputTokens/cacheReadInputTokens, this represents the actual prompt size
   * sent on the most recent turn — i.e., the real context window fill level.
   * Written from `message_start` usage and replaced by the final
   * `message_delta` usage when the delta carries input/cache numbers (proxied
   * providers send only synthetic zeros in `message_start` and the real
   * numbers in the delta). Excludes cumulative output. Undefined if no usage
   * was captured for the model.
   */
  lastTurnContextTokens?: number;
}

/**
 * Callback type for notifying when result message with stats is received
 * Uses MessageTokenUsage from shared for type consistency
 */
export type ResultStatsCallback = (stats: {
  sessionId: SessionId;
  cost: number | null;
  tokens: MessageTokenUsage;
  duration: number;
  /** Per-model usage data including context window size */
  modelUsage?: ResultModelUsage[];
  /**
   * The session owner's lifetime snapshot after this result (TASK_2026_533).
   * The per-result fields above keep their footer/context meaning.
   */
  sessionStats?: SessionStatsEntry;
}) => void;

/**
 * Configuration for stream transformation
 */
export interface StreamTransformConfig {
  sdkQuery: AsyncIterable<SDKMessage>;
  sessionId: SessionId;
  initialModel: string;
  /** Frozen effective route; absent legacy callers publish unknown capacity. */
  capacityRoute?: ContextCapacityRoute;
  /**
   * `SessionRecord.token` of the query this stream reads — the identity of
   * the query RUN for session accounting. Results carrying the same token
   * replace each other; a new token is a new run. Backend-only.
   */
  runToken: string;
  /** Cost authority frozen on the record at query creation. */
  usageCostSource: UsageCostSource;
  /**
   * The query's effective auth env, frozen with `usageCostSource`. Model
   * aliases are resolved for pricing against it — never the global env.
   */
  accountingAuthEnv: Readonly<AuthEnv>;
  /**
   * Generation of the session stats owner this run publishes to, captured
   * when the run was prepared; `null` when no owner exists (nothing is
   * published). Results for a released or replaced owner are dropped.
   */
  statsGeneration: number | null;
  onSessionIdResolved?: SessionIdResolvedCallback;
  onResultStats?: ResultStatsCallback;
  /**
   * Fired on the SDK `result` message — the turn boundary — BEFORE any stats
   * work. Deliberately separate from `onResultStats`, which is skipped when
   * `validateStats` rejects a malformed payload and which awaits a pricing
   * lookup first. The streaming pump's turn claim must be released on every
   * result, promptly and unconditionally, or a message held mid-turn waits for
   * the 180s no-activity watchdog instead of the turn (TASK_2026_294).
   */
  onTurnEnd?: () => void;
  /**
   * Passed to callback so frontend can find tab directly without temp ID lookup.
   */
  tabId?: string;
  /**
   * No-stream-activity watchdog for the underlying SDK query. When present, the
   * transformer `start()`s it before consuming the stream, `kick()`s it on
   * every SDK message (any event — message, partial/streaming delta, tool_use,
   * tool_result, thinking — resets the inactivity window), and `stop()`s it in
   * the `finally` so it can neither leak nor fire after the turn ends. On
   * timeout the watchdog resolves pending permissions and aborts the query with
   * a descriptive error, so a genuinely stuck session surfaces instead of
   * hanging forever; a long-but-alive turn keeps kicking it and never trips it.
   */
  activityWatchdog?: NoActivityWatchdog;
}

/**
 * Validated stats interface
 * Uses MessageTokenUsage from shared for type consistency
 */
interface ValidatedStats {
  sessionId: SessionId;
  cost: number | null;
  tokens: MessageTokenUsage;
  duration: number;
  /** Per-model usage data including context window size */
  modelUsage?: ResultModelUsage[];
}

/**
 * Validate stats from SDK result message
 * Rejects corrupt negative or non-finite numeric values from the SDK
 *
 * @param stats - Raw stats extracted from SDK result message
 * @param logger - Logger instance for validation warnings
 * @returns Validated stats or null if validation fails
 */
function validateStats(
  stats: {
    sessionId: SessionId;
    cost: number | null;
    tokens: { input: number; output: number };
    duration: number;
    modelUsage?: ResultModelUsage[];
  },
  logger: Logger,
): ValidatedStats | null {
  // Cost and token figures are cumulative per session, and duration can cover
  // a long-running turn, so none has a fixed upper bound. Production logs
  // recorded valid cumulative costs above $100 (up to about $356); rejecting a
  // large value drops the whole payload and freezes the UI stats.
  // Negative and non-finite checks are deliberately the whole defence.
  if (
    stats.cost !== null &&
    (stats.cost < 0 || isNaN(stats.cost) || !isFinite(stats.cost))
  ) {
    logger.warn('[StreamTransformer] Invalid cost value from SDK:', {
      cost: stats.cost,
      sessionId: stats.sessionId,
    });
    return null;
  }
  if (
    stats.tokens.input < 0 ||
    isNaN(stats.tokens.input) ||
    !isFinite(stats.tokens.input) ||
    stats.tokens.output < 0 ||
    isNaN(stats.tokens.output) ||
    !isFinite(stats.tokens.output)
  ) {
    logger.warn('[StreamTransformer] Invalid token values from SDK:', {
      tokens: stats.tokens,
      sessionId: stats.sessionId,
    });
    return null;
  }
  if (
    stats.duration < 0 ||
    isNaN(stats.duration) ||
    !isFinite(stats.duration)
  ) {
    logger.warn('[StreamTransformer] Invalid duration value from SDK:', {
      duration: stats.duration,
      sessionId: stats.sessionId,
    });
    return null;
  }

  return stats; // All validations passed
}

/**
 * StreamTransformer - Transforms SDK messages to flat stream events
 *
 * Responsibilities:
 * - Transform SDK stream_event messages to FlatStreamEventUnion
 * - Extract real session ID from system 'init' message
 * - Extract stats (cost, tokens, duration) from result messages
 * - Handle authentication errors gracefully
 *
 * Does NOT store messages - SDK handles persistence natively.
 */
@injectable()
export class StreamTransformer {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: IModelResolver,
    @inject(SDK_TOKENS.PRICING_PROVIDER)
    private readonly pricingProvider: IPricingProvider,
    /**
     * Fan-out for what the CLI reported about this session's MCP servers.
     *
     * NOT a `StreamTransformConfig` callback, because the other producer of the
     * same signal — the CLI stderr notice in `SdkQueryOptionsBuilder` — is on
     * the other side of the session-start path and shares no config object with
     * this one. See the registry's own file header.
     */
    @inject(SDK_TOKENS.SDK_SESSION_MCP_STATUS_CALLBACK_REGISTRY)
    private readonly mcpStatus: SessionMcpStatusCallbackRegistry,
    /** The single authority every accepted result is published to. */
    @inject(SDK_TOKENS.SDK_SESSION_STATS_OWNER)
    private readonly statsOwner: SessionStatsOwnerService,
  ) {}

  /**
   * Create a transformed flat event stream from SDK messages
   */
  transform(
    config: StreamTransformConfig,
  ): AsyncIterable<FlatStreamEventUnion> {
    const {
      sdkQuery,
      sessionId,
      initialModel,
      onSessionIdResolved,
      onResultStats,
      onTurnEnd,
      tabId,
      activityWatchdog,
      runToken,
      usageCostSource,
      accountingAuthEnv,
      capacityRoute,
      statsGeneration,
    } = config;
    const logger = this.logger;
    const statsOwner = this.statsOwner;
    // ONE transformer per stream, never the DI singleton (TASK_2026_370).
    //
    // `SdkMessageTransformer` keys its streaming bookkeeping on
    // `parent_tool_use_id || ''` — a context, with no session dimension — and is
    // registered `Lifecycle.Singleton`. Every root assistant turn of every
    // session therefore wrote the same `''` slot: with two chat sessions live,
    // session A's `content_block_start` resolved to session B's message id (so
    // A's text landed on B's bubble), `onMessageDelta` attributed A's token
    // usage to B's message, and a compact boundary in either session called
    // `clearStreamingState()` on the maps of BOTH.
    //
    // `createIsolated()` is the mechanism that already existed for exactly this;
    // `HarnessStreamBroadcaster` and the Ptah-CLI stream loop each take one per
    // stream, and the interactive chat path was the one caller that did not.
    // `transform()` is called once per session stream, so this is the per-stream
    // seam. The shared collaborators (`usageTracker`, `turnState`,
    // `sessionLifecycle`) are passed through by `createIsolated` and stay
    // shared — they are keyed by session id already.
    const messageTransformer = this.messageTransformer.createIsolated();
    const authEnv = this.authEnv;
    const modelResolver = this.modelResolver;
    const pricingProvider = this.pricingProvider;
    const mcpStatus = this.mcpStatus;

    return {
      async *[Symbol.asyncIterator]() {
        let sdkMessageCount = 0;
        let yieldedEventCount = 0;
        let effectiveSessionId = sessionId;
        // Per-component last-turn context, keyed by model. message_start
        // REPLACES all three components; the final message_delta REPLACES only
        // the components it carries (`??` skips null/undefined only, so an
        // explicit 0 is a real reading and an absent field keeps the last
        // known value). Components are stored separately so an output-only
        // delta — the direct Anthropic shape — cannot zero input/cache.
        const lastTurnContextByModel = new Map<string, TrackedTurnContext>();
        // message_delta carries no model, so the tracker remembers the model
        // of the message_start it belongs to.
        let currentStreamModel: string | null = null;
        let loggedEagerMcpTools = false;

        // Arm the no-activity watchdog before consuming the stream. It fires
        // only if NO SDK message arrives for the full inactivity window; every
        // message below kicks it, so a slow-but-alive turn never trips it.
        activityWatchdog?.start();

        try {
          for await (const sdkMessage of sdkQuery) {
            // Any stream activity — message, partial/streaming delta, tool_use,
            // tool_result, thinking — resets the inactivity window.
            activityWatchdog?.observe(sdkMessage);
            sdkMessageCount++;

            // The gauge measures the MAIN loop's prompt, so a partial event
            // that belongs to a subagent must not overwrite it (same model,
            // different conversation). `SDKPartialAssistantMessage` types
            // `parent_tool_use_id` as `string | null`; the bundled CLI builds
            // its stream events with `null` today, so this is the contract's
            // guard, not a behaviour seen on the wire.
            if (isStreamEvent(sdkMessage) && !sdkMessage.parent_tool_use_id) {
              const event = sdkMessage.event;
              if (isMessageStart(event)) {
                const model = event.message.model;
                const turnUsage = event.message.usage;
                currentStreamModel = model ?? null;
                if (model && turnUsage) {
                  lastTurnContextByModel.set(model, {
                    input: turnUsage.input_tokens ?? 0,
                    cacheRead: turnUsage.cache_read_input_tokens ?? 0,
                    cacheCreation: turnUsage.cache_creation_input_tokens ?? 0,
                  });
                }
              } else if (isMessageDelta(event)) {
                // Proxied providers (Codex/OpenRouter via the responses
                // translation proxy) emit message_start with synthetic zero
                // usage and the real input/cache numbers ONLY in the final
                // message_delta. Read them here so the context gauge tracks
                // the real prompt size. `MessageDeltaEvent.usage` is typed
                // output-only because direct Anthropic deltas normally are,
                // so read the optional input/cache fields through the same
                // widened structural cast as
                // stream-event.transformer's onMessageDelta.
                const model = currentStreamModel;
                const previous = model
                  ? lastTurnContextByModel.get(model)
                  : undefined;
                const usage = (
                  event as {
                    usage?: {
                      input_tokens?: number;
                      cache_read_input_tokens?: number;
                      cache_creation_input_tokens?: number;
                    };
                  }
                ).usage;
                if (model && previous && usage) {
                  lastTurnContextByModel.set(model, {
                    input: usage.input_tokens ?? previous.input,
                    cacheRead:
                      usage.cache_read_input_tokens ?? previous.cacheRead,
                    cacheCreation:
                      usage.cache_creation_input_tokens ??
                      previous.cacheCreation,
                  });
                }
              }
            }
            if (isSystemInit(sdkMessage)) {
              const realSessionId = sdkMessage.session_id;
              effectiveSessionId = realSessionId as SessionId;
              if (onSessionIdResolved) {
                onSessionIdResolved(tabId, realSessionId);
              }
              if (!loggedEagerMcpTools) {
                loggedEagerMcpTools = true;
                const eagerPtahTools = sdkMessage.tools.filter((name) =>
                  name.startsWith('mcp__ptah'),
                );
                logger.debug(
                  `[StreamTransformer] Eager-loaded ptah MCP tools (${eagerPtahTools.length})`,
                  {
                    sessionId: realSessionId,
                    eagerPtahTools,
                    eagerPtahToolCount: eagerPtahTools.length,
                    mcpServers: sdkMessage.mcp_servers,
                  },
                );
              }
              // Publish the same `mcp_servers` the log above prints. Before
              // TASK_2026_375 this was the ONLY place it went: a Smithery
              // server the CLI itself reported as `needs-auth` was logged at
              // debug level and the UI showed it as installed and working.
              //
              // This is not turn state — it lands once per session, at init,
              // and no chunk depends on it — so the direct channel is correct
              // here in a way it is not for `turn_state`. See the registry's
              // file header.
              if (Array.isArray(sdkMessage.mcp_servers)) {
                mcpStatus.notifyAll({
                  kind: 'servers',
                  sessionId: realSessionId,
                  servers: sdkMessage.mcp_servers.map((server) => ({
                    name: server.name,
                    status: server.status,
                  })),
                });
              }
            }
            if (isResultMessage(sdkMessage)) {
              // Turn boundary first — see `onTurnEnd`'s contract. Nothing below
              // may gate it.
              onTurnEnd?.();
              const reported = usageCostSource === 'reported';
              // Footer/context rows, labelled by the resolved pricing id as
              // they always were.
              const modelUsageList: ResultModelUsage[] = [];
              // Accounting rows, labelled by the SDK's OWN model id — the key
              // its saved `cost-state` uses — with all four token classes.
              const runModels: RunModelUsage[] = [];
              if (sdkMessage.modelUsage) {
                const usageEntries = Object.entries(sdkMessage.modelUsage)
                  .filter(
                    ([model]) =>
                      !(model.startsWith('<') && model.endsWith('>')),
                  )
                  .map(([model, usage]) => ({
                    model,
                    usage,
                    // Alias resolution stays (proxy routes report Claude
                    // aliases for other models), but against the query's
                    // FROZEN effective env, never the mutable process-global
                    // one.
                    priced: modelResolver.resolveForCost(
                      model,
                      accountingAuthEnv,
                    ),
                  }));
                const trackedContextByModel = matchTrackedContexts(
                  usageEntries.map(({ model, usage, priced }) => ({
                    key: model,
                    aliases: [usage.canonicalModel, priced.modelId].filter(
                      (alias): alias is string => Boolean(alias),
                    ),
                  })),
                  lastTurnContextByModel,
                );
                const untrackedModels = usageEntries
                  .map(({ model }) => model)
                  .filter((model) => !trackedContextByModel.has(model));
                if (untrackedModels.length > 0) {
                  // Not an error: a model that streamed nothing on the main
                  // loop since the last compaction (a subagent-only model, a
                  // turn with no API call) has no fill to report, and the
                  // frontend falls back for it. Logged so a key mismatch
                  // that slips past `matchTrackedContexts` is diagnosable.
                  logger.debug(
                    '[StreamTransformer] No last-turn context tracked for some modelUsage keys',
                    {
                      sessionId: effectiveSessionId,
                      untrackedModels,
                      modelUsageKeys: usageEntries.map(({ model }) => model),
                      canonicalModels: usageEntries.map(
                        ({ usage }) => usage.canonicalModel ?? null,
                      ),
                      trackedKeys: [...lastTurnContextByModel.keys()],
                    },
                  );
                }
                for (const { model, usage, priced } of usageEntries) {
                  const resolvedModel = priced.modelId;
                  const cacheRead = usage.cacheReadInputTokens ?? 0;
                  const cacheCreation = usage.cacheCreationInputTokens ?? 0;
                  let costUSD: number | null;
                  let rate: ModelPricing | null = null;
                  if (reported) {
                    costUSD =
                      typeof usage.costUSD === 'number' ? usage.costUSD : null;
                  } else {
                    // Prefer the already-hydrated map; only pay for a catalog
                    // round-trip when the model is genuinely unknown to it.
                    rate =
                      priced.pricing ??
                      (await pricingProvider.getPricing(resolvedModel));
                    costUSD = rate
                      ? calculateMessageCost(
                          resolvedModel,
                          {
                            input: usage.inputTokens,
                            output: usage.outputTokens,
                            cacheHit: cacheRead,
                            cacheCreation,
                          },
                          rate,
                        )
                      : null;
                  }
                  runModels.push({
                    model,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    cacheRead,
                    cacheCreation,
                    costUSD,
                    ...(!reported && { pricing: rate }),
                  });
                  const trackedContext = trackedContextByModel.get(model);
                  const contextCapacity = resolveContextCapacity({
                    route: capacityRoute,
                    model: resolvedModel,
                    sdkContextWindow: usage.contextWindow,
                  });
                  modelUsageList.push({
                    model: resolvedModel,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    contextWindow: contextCapacity.tokens ?? 0,
                    contextCapacity,
                    costUSD: reported ? usage.costUSD : costUSD,
                    cacheReadInputTokens: cacheRead,
                    lastTurnContextTokens: trackedContext
                      ? trackedContext.input +
                        trackedContext.cacheRead +
                        trackedContext.cacheCreation
                      : undefined,
                  });
                }
                if (modelUsageList.length > 1) {
                  modelUsageList.sort((a, b) => {
                    if (initialModel) {
                      const normalizedInit = initialModel.toLowerCase();
                      const aFuzzy =
                        a.model === initialModel ||
                        a.model.toLowerCase().includes(normalizedInit) ||
                        normalizedInit.includes(a.model.toLowerCase())
                          ? 1
                          : 0;
                      const bFuzzy =
                        b.model === initialModel ||
                        b.model.toLowerCase().includes(normalizedInit) ||
                        normalizedInit.includes(b.model.toLowerCase())
                          ? 1
                          : 0;
                      if (aFuzzy !== bFuzzy) return bFuzzy - aFuzzy;
                    }
                    return b.outputTokens - a.outputTokens;
                  });
                }
              }
              let totalCost: number | null;
              if (reported) {
                totalCost = sdkMessage.total_cost_usd;
              } else if (
                runModels.length === 0 ||
                runModels.some((m) => m.costUSD === null)
              ) {
                totalCost = null;
              } else {
                totalCost = 0;
                for (const row of runModels) {
                  totalCost += row.costUSD ?? 0;
                }
              }

              const sdkTokens = {
                input: sdkMessage.usage.input_tokens,
                output: sdkMessage.usage.output_tokens,
                cacheRead: sdkMessage.usage.cache_read_input_tokens ?? 0,
                cacheCreation:
                  sdkMessage.usage.cache_creation_input_tokens ?? 0,
              };
              const hasNoSdkTokenUsage =
                sdkTokens.input === 0 &&
                sdkTokens.output === 0 &&
                sdkTokens.cacheRead === 0 &&
                sdkTokens.cacheCreation === 0;

              // Session accounting runs for EVERY result, whether or not a UI
              // callback is registered. `modelUsage` is the query's cumulative
              // running total (sdk.d.ts), so the owner REPLACES this run's
              // stored value with it. `usage` is per-turn and main-loop only:
              // it is never counted as a run total — a result that carries
              // only that marks the run under-counted instead.
              // The owner generation is checked HERE, after every pricing
              // await above: a result whose owner was released or replaced
              // meanwhile is dropped, and can never recreate an owner.
              let sessionStats: SessionStatsEntry | undefined;
              if (statsGeneration === null) {
                // No owner was prepared for this stream: nothing to publish.
              } else if (runModels.length > 0) {
                const { outcome, snapshot, firstRejection } =
                  statsOwner.replaceRun(
                    effectiveSessionId,
                    statsGeneration,
                    runToken,
                    {
                      models: runModels,
                      totalCost:
                        typeof totalCost === 'number' ? totalCost : null,
                      costSource: usageCostSource,
                      isErrorResult:
                        sdkMessage.subtype !== 'success' || sdkMessage.is_error,
                      // Per turn; the owner adds it only when it accepts the
                      // result, and validates it.
                      durationMs: sdkMessage.duration_ms,
                    },
                  );
                if (outcome === 'rejected-invalid') {
                  logger.warn(
                    '[StreamTransformer] Session stats owner rejected a malformed result; keeping the accepted snapshot',
                    { sessionId: effectiveSessionId },
                  );
                } else if (firstRejection) {
                  // The owner reports this once per run: an SDK that keeps
                  // omitting a model would otherwise log on every turn.
                  logger.warn(
                    '[StreamTransformer] Session stats owner rejected a result that does not continue the run total (a model is missing or a counter decreased); keeping the accepted snapshot',
                    { sessionId: effectiveSessionId },
                  );
                } else if (outcome === 'stale-owner') {
                  logger.debug(
                    '[StreamTransformer] Dropped a result for a released session stats owner',
                    { sessionId: effectiveSessionId },
                  );
                }
                sessionStats = snapshot ?? undefined;
              } else if (!hasNoSdkTokenUsage) {
                sessionStats =
                  statsOwner.markRunIncomplete(
                    effectiveSessionId,
                    statsGeneration,
                    runToken,
                  ) ?? undefined;
              }

              if (!onResultStats) {
                logger.error(
                  '[StreamTransformer] Result stats callback not set - stats will be lost!',
                  { sessionId: effectiveSessionId },
                );
              } else if (!hasNoSdkTokenUsage || modelUsageList.length > 0) {
                // A result with neither aggregate usage nor per-model usage is
                // a turn boundary, not a stats update. Emitting its zero values
                // would overwrite the populated session header after resume.
                // `sdkTokens` is a per-turn delta for the message footer;
                // `modelUsageList` is cumulative per query and must not be
                // summed into that delta or earlier turns are counted again.
                const rawStats = {
                  sessionId: effectiveSessionId,
                  cost: totalCost,
                  tokens: sdkTokens,
                  duration: sdkMessage.duration_ms,
                  modelUsage:
                    modelUsageList.length > 0 ? modelUsageList : undefined,
                };
                const validatedStats = validateStats(rawStats, logger);
                if (validatedStats) {
                  onResultStats({
                    ...validatedStats,
                    ...(sessionStats && { sessionStats }),
                  });
                }
              }
            }
            if (isCompactBoundary(sdkMessage)) {
              lastTurnContextByModel.clear();
            }

            if (
              sdkMessage.type === 'stream_event' ||
              sdkMessage.type === 'assistant' ||
              sdkMessage.type === 'user' ||
              // The result's `turn_state` must travel IN the stream, after the
              // last chunk of the turn it closes (TASK_2026_360).
              isResultMessage(sdkMessage) ||
              isCompactBoundary(sdkMessage) ||
              isLocalCommandOutput(sdkMessage) ||
              isTaskStarted(sdkMessage) ||
              isTaskProgress(sdkMessage) ||
              isTaskUpdated(sdkMessage) ||
              isTaskNotification(sdkMessage)
            ) {
              const flatEvents = messageTransformer.transform(
                sdkMessage,
                effectiveSessionId,
              );

              for (const event of flatEvents) {
                yieldedEventCount++;

                yield event;
              }
            }
          }

          logger.debug(
            `[StreamTransformer] Stream ended for ${sessionId}: ${sdkMessageCount} SDK messages, ${yieldedEventCount} events yielded`,
          );
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));
          const lowerMessage = errorObj.message.toLowerCase();
          const isUserAbort =
            lowerMessage.includes('aborted by user') ||
            lowerMessage.includes('abort') ||
            lowerMessage.includes('cancelled') ||
            lowerMessage.includes('canceled');

          if (isUserAbort) {
            logger.debug(
              `[StreamTransformer] Session ${sessionId} aborted by user`,
            );
          } else {
            logger.error(
              `[StreamTransformer] Session ${sessionId} error: ${errorObj.message}`,
              errorObj,
            );
            const isAuthError =
              errorObj.message.includes('401') ||
              lowerMessage.includes('unauthorized') ||
              lowerMessage.includes('authentication failed') ||
              lowerMessage.includes('invalid api key') ||
              lowerMessage.includes('invalid token') ||
              lowerMessage.includes('api_key');

            if (isAuthError) {
              logger.error('[StreamTransformer] AUTHENTICATION ERROR!');
              logger.error(
                '[StreamTransformer] SDK requires valid API key from console.anthropic.com',
              );
              logger.error(
                `[StreamTransformer] Current: ANTHROPIC_API_KEY=${
                  authEnv.ANTHROPIC_API_KEY
                    ? `SET (${authEnv.ANTHROPIC_API_KEY.substring(0, 10)}...)`
                    : 'NOT SET'
                }`,
              );
            }
          }

          throw error;
        } finally {
          // Stop the watchdog on every teardown path (end-of-stream, error,
          // abort) so it can neither leak nor fire after the turn ends.
          activityWatchdog?.stop();
          logger.debug(`[StreamTransformer] Session ${sessionId} stream ended`);
        }
      },
    };
  }
}
