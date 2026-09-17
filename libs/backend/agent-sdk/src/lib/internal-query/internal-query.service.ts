import { injectable, inject } from 'tsyringe';
import {
  TOKENS,
  type BackgroundWorkSignal,
  type DegradationReporter,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '../di/tokens';
import { SdkQueryRunner } from '../helpers/sdk-query-runner.service';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './internal-query.types';
import {
  DEFAULT_INTERNAL_QUERY_LANE,
  GOVERNED_BACKGROUND_LANES,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_CONCURRENT_PER_LANE,
  DEFAULT_QUEUE_TIMEOUT_MS,
  InternalQueryConcurrencyGate,
  backgroundLimit,
} from './internal-query-concurrency-gate';

const SERVICE_TAG = '[InternalQueryService]';

const CONCURRENCY_SECTION = 'ptah';

/** `ptah.internalQuery.maxConcurrent` — see {@link DEFAULT_MAX_CONCURRENT}. */
export const INTERNAL_QUERY_CONCURRENCY_KEY = 'internalQuery.maxConcurrent';

/** `ptah.internalQuery.queueTimeoutMs` — see {@link DEFAULT_QUEUE_TIMEOUT_MS}. */
export const INTERNAL_QUERY_QUEUE_TIMEOUT_KEY = 'internalQuery.queueTimeoutMs';

/** `ptah.internalQuery.maxConcurrentPerLane` — see {@link DEFAULT_MAX_CONCURRENT_PER_LANE}. */
export const INTERNAL_QUERY_LANE_CONCURRENCY_KEY =
  'internalQuery.maxConcurrentPerLane';

/**
 * A caller's lane, or {@link DEFAULT_INTERNAL_QUERY_LANE}.
 *
 * Trimmed and lower-cased so `'Memory-Curator'` and `'memory-curator '` are the
 * same bucket. The lane is a caller-supplied string and a near-miss would
 * silently mint a second lane with its own ceiling — which is the failure this
 * whole mechanism exists to prevent, arriving through a typo.
 */
function resolveLane(lane: string | undefined): string {
  const trimmed = (lane ?? '').trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : DEFAULT_INTERNAL_QUERY_LANE;
}

/** Stable degradation code. Never interpolated — see `rpc-degradation.types.ts`. */
const DEGRADE_UNGOVERNED = 'agent.internal-query.ungoverned';

@injectable()
export class InternalQueryService {
  private readonly gate: InternalQueryConcurrencyGate;
  private ungovernedReported = false;

  constructor(
    @inject(SDK_TOKENS.SDK_QUERY_RUNNER)
    private readonly runner: SdkQueryRunner,
    @inject(TOKENS.LOGGER, { isOptional: true })
    private readonly logger: Logger | null = null,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace: IWorkspaceProvider | null = null,
    @inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true })
    private readonly governor: BackgroundWorkSignal | null = null,
    @inject(TOKENS.DEGRADATION_REPORTER, { isOptional: true })
    private readonly degradation: DegradationReporter | null = null,
  ) {
    this.gate = new InternalQueryConcurrencyGate({
      governor,
      onDeferralCeiling: (lane, maxDeferMs) => {
        this.logger?.warn(
          `${SERVICE_TAG} background lane held past the deferral ceiling — proceeding`,
          { lane, maxDeferMs },
        );
      },
    });
  }

  /**
   * Whether this host initialized the SDK at all.
   *
   * Headless callers (`skill-synthesis`'s lane runner, the memory curator) get
   * registered this service on EVERY host, including the CLI's
   * `withEngine({ requireSdk: false })` boots where `initialize()` never runs.
   * Resolving the DI token therefore does not mean an LLM is reachable, and
   * `execute` would throw `SdkError` on every call. This is the question those
   * callers actually need answered before they spend an attempt.
   */
  isInitialized(): boolean {
    return this.runner.isInitialized();
  }

  /**
   * Run a one-shot query, waiting for a concurrency slot first.
   *
   * The slot is held for the LIFETIME of the query, not just the launch: it is
   * released when the returned stream finishes, is broken out of, or throws, and
   * also by `close()` / `abort()`. Releasing at launch would gate nothing —
   * `runOneShot` returns as soon as the SDK hands back a conversation handle,
   * long before the subprocess has done any work.
   *
   * A caller that neither iterates the stream nor closes the handle holds its
   * slot indefinitely. Every caller in this repo iterates to the `result`
   * message; the guarantee is documented rather than defended because a timeout
   * here would abort real work whose only fault was being slow.
   */
  async execute(config: InternalQueryConfig): Promise<InternalQueryHandle> {
    const release = await this.acquireSlot(config);

    let handle: InternalQueryHandle;
    try {
      handle = await this.runner.runOneShot({
        mode: 'oneShot',
        cwd: config.cwd,
        model: config.model,
        prompt: config.prompt,
        systemPromptAppend: config.systemPromptAppend,
        mcpServerRunning: config.mcpServerRunning,
        mcpPort: config.mcpPort,
        maxTurns: config.maxTurns,
        outputFormat: config.outputFormat,
        abortController: config.abortController,
        auth: config.auth,
      });
    } catch (error: unknown) {
      release();
      throw error;
    }

    return this.holdSlotUntilDone(handle, release);
  }

  private async acquireSlot(config: InternalQueryConfig): Promise<() => void> {
    const limit = this.readMaxConcurrent();
    const perLaneLimit = this.readMaxConcurrentPerLane();
    const lane = resolveLane(config.lane);
    // The allow-list, not `gate.isGoverned`: that is false exactly when there is
    // no governor, which is the one case this report exists for.
    if (GOVERNED_BACKGROUND_LANES.has(lane)) this.reportIfUngoverned(lane);
    const queueTimeoutMs = this.resolveQueueTimeoutMs(config);
    const laneInFlight = this.gate.inFlightForLane(lane);
    const backgroundInFlight = this.gate.inFlightInBackground;
    const backgroundCapped =
      GOVERNED_BACKGROUND_LANES.has(lane) &&
      backgroundInFlight >= backgroundLimit(limit);
    const governorHolds =
      this.gate.isGoverned(lane) && this.governor?.isClear() === false;
    if (
      this.gate.inFlight >= limit ||
      laneInFlight >= perLaneLimit ||
      backgroundCapped ||
      governorHolds
    ) {
      this.logger?.debug(
        `${SERVICE_TAG} one-shot query waiting for a concurrency slot`,
        {
          lane,
          limit,
          perLaneLimit,
          inFlight: this.gate.inFlight,
          laneInFlight,
          backgroundInFlight,
          backgroundCapped,
          queued: this.gate.queued,
          model: config.model,
          // Which ceiling is the binding one. Without it the log says a query
          // waited but not whether the host is busy or its own pipeline is,
          // and those call for opposite fixes.
          blockedBy:
            this.gate.inFlight >= limit
              ? 'global'
              : laneInFlight >= perLaneLimit
                ? 'lane'
                : backgroundCapped
                  ? 'background'
                  : 'governor',
        },
      );
    }
    return this.gate.acquire({
      limit,
      perLaneLimit,
      lane,
      signal: config.abortController?.signal,
      queueTimeoutMs,
    });
  }

  /**
   * A background lane on a host with no governor runs ungoverned: the gate is
   * always clear, which is the pre-governor behaviour. Said once per service,
   * on the first background call — the moment it starts to matter.
   */
  private reportIfUngoverned(lane: string): void {
    if (this.governor !== null || this.ungovernedReported) return;
    this.ungovernedReported = true;
    this.logger?.warn(
      `${SERVICE_TAG} no background-work governor; background lanes are not deferred`,
      { lane },
    );
    this.degradation?.report({
      source: 'agent',
      code: DEGRADE_UNGOVERNED,
      severity: 'degraded',
      summary:
        'Background internal queries run without the background-work governor; they do not yield to foreground turns or event-loop lag.',
      detail: `first lane: ${lane}`,
    });
  }

  private holdSlotUntilDone(
    handle: InternalQueryHandle,
    release: () => void,
  ): InternalQueryHandle {
    const source = handle.stream;
    async function* guarded(): AsyncGenerator<SDKMessage> {
      try {
        yield* source;
      } finally {
        // Runs on normal completion, on `throw`, AND on the `return()` that
        // `for await (…) { break }` performs — which is how every consumer in
        // this repo leaves the loop once it sees the `result` message.
        release();
      }
    }

    return {
      stream: guarded(),
      abort: () => {
        try {
          handle.abort();
        } finally {
          release();
        }
      },
      close: () => {
        try {
          handle.close();
        } finally {
          release();
        }
      },
    };
  }

  private readMaxConcurrent(): number {
    return this.readLimit(
      INTERNAL_QUERY_CONCURRENCY_KEY,
      DEFAULT_MAX_CONCURRENT,
    );
  }

  private readMaxConcurrentPerLane(): number {
    return this.readLimit(
      INTERNAL_QUERY_LANE_CONCURRENCY_KEY,
      DEFAULT_MAX_CONCURRENT_PER_LANE,
    );
  }

  private readLimit(key: string, fallback: number): number {
    if (!this.workspace) return fallback;
    try {
      const value = this.workspace.getConfiguration<number>(
        CONCURRENCY_SECTION,
        key,
        fallback,
      );
      return typeof value === 'number' && Number.isFinite(value) && value >= 1
        ? Math.floor(value)
        : fallback;
    } catch (error: unknown) {
      this.logger?.warn(
        `${SERVICE_TAG} could not read ${key}; using the default`,
        {
          error: error instanceof Error ? error.message : String(error),
          fallback,
        },
      );
      return fallback;
    }
  }

  private resolveQueueTimeoutMs(config: InternalQueryConfig): number {
    if (config.queueTimeoutMs !== undefined) {
      return Number.isFinite(config.queueTimeoutMs) && config.queueTimeoutMs > 0
        ? Math.floor(config.queueTimeoutMs)
        : DEFAULT_QUEUE_TIMEOUT_MS;
    }
    if (!this.workspace) return DEFAULT_QUEUE_TIMEOUT_MS;
    try {
      const value = this.workspace.getConfiguration<number>(
        CONCURRENCY_SECTION,
        INTERNAL_QUERY_QUEUE_TIMEOUT_KEY,
        DEFAULT_QUEUE_TIMEOUT_MS,
      );
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : DEFAULT_QUEUE_TIMEOUT_MS;
    } catch (error: unknown) {
      this.logger?.warn(
        `${SERVICE_TAG} could not read ${INTERNAL_QUERY_QUEUE_TIMEOUT_KEY}; using the default`,
        {
          error: error instanceof Error ? error.message : String(error),
          fallback: DEFAULT_QUEUE_TIMEOUT_MS,
        },
      );
      return DEFAULT_QUEUE_TIMEOUT_MS;
    }
  }
}
