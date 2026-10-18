/**
 * LiveSessionStatsPublisher — the in-turn session-stats estimate of ONE
 * stream (TASK_2026_626).
 *
 * Built once per `StreamTransformer.transform()` call. It reads the stream's
 * `assistant` frames (main loop and subagents), keeps the latest usage per
 * API message id, prices the sum from the rate card and publishes the owner's
 * LIVE snapshot (`provisional: true`) at most once per
 * {@link LIVE_STATS_INTERVAL_MS}. The SDK `result` stays authoritative: at
 * every boundary that ends a shown estimate (a result, the owner's release,
 * the stream's end) exactly one authoritative snapshot follows, with a higher
 * revision and without `context`.
 *
 * Lifecycle, all driven by the transformer:
 * - {@link setSessionKey} on `init` — nothing is published before it, and
 *   nothing at all when no current owner exists under that key;
 * - {@link observe} per SDK message;
 * - {@link onResult} at the top of every result branch, {@link settle} at the
 *   end of it, whichever exit it took;
 * - {@link dispose} from the stream's `finally`.
 *
 * Inert (no timer, no watcher, no state) when no callback is wired or the
 * stream has no stats owner. Nothing it does throws into the stream, into
 * `release` or into `recordAgent`.
 */

import { z } from 'zod';
import {
  calculateMessageCost,
  type AuthEnv,
  type LiveStatsCallback,
  type SessionId,
  type SessionStatsEntry,
  type SessionStatsLivePayload,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  RunModelUsage,
  SessionStatsOwnerService,
} from '../session-stats/session-stats-owner.service';
import type { IModelResolver } from '../auth-env.port';
import {
  isTaskStarted,
  type SDKMessage,
} from '../types/sdk-types/claude-sdk.types';

/** At most one live publication per stream per interval. */
export const LIVE_STATS_INTERVAL_MS = 1000;

/** Clock seam, so the spec drives the throttle without real time. */
export interface LiveStatsClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_CLOCK: LiveStatsClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    // A throttle timer is never the reason a process stays alive.
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** The main loop's latest request size, as the stream tracked it. */
export interface MainContextReading {
  readonly model: string;
  readonly contextTokens: number;
}

export interface LiveSessionStatsPublisherOptions {
  readonly statsOwner: Pick<
    SessionStatsOwnerService,
    'watch' | 'publishLive' | 'clearProvisional'
  >;
  readonly modelResolver: Pick<IModelResolver, 'resolveForCost'>;
  /** The query's frozen effective env, as the result path prices with. */
  readonly accountingAuthEnv: Readonly<AuthEnv>;
  /** `null` when the stream has no stats owner: the publisher is inert. */
  readonly statsGeneration: number | null;
  readonly runToken: string;
  /** Absent: the publisher is inert. */
  readonly onLiveStats?: LiveStatsCallback;
  readonly logger: Logger;
  readonly readMainContext: () => MainContextReading | null;
  readonly clock?: LiveStatsClock;
}

const LOG_TAG = '[LiveSessionStatsPublisher]';

/**
 * A usage counter from the external CLI, read as absent when it is missing or
 * malformed, so one bad counter drops only itself (as the transcript ledger
 * reads them).
 */
const UsageCounter = z
  .unknown()
  .optional()
  .transform((value): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : undefined,
  );

/** Boundary schema for the fields an estimate reads from an `assistant` frame. */
const AssistantFrameSchema = z.object({
  message: z.object({
    id: z.string().min(1),
    model: z.string().min(1),
    usage: z.object({
      input_tokens: UsageCounter,
      output_tokens: UsageCounter,
      cache_read_input_tokens: UsageCounter,
      cache_creation_input_tokens: UsageCounter,
    }),
  }),
});

/** The latest usage of one API message, as its frames reported it. */
interface MessageUsage {
  readonly model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export class LiveSessionStatsPublisher {
  private readonly clock: LiveStatsClock;
  private readonly inert: boolean;
  /** Latest usage per API `message.id` since the last result boundary. */
  private readonly usageById = new Map<string, MessageUsage>();
  /** The usage map changed since the last flush. */
  private dirty = false;
  /** A visible owner cache change still needs a live publication. */
  private cacheDirty = false;
  private sessionId: SessionId | null = null;
  private detachWatcher: (() => void) | null = null;
  private timer: { readonly handle: unknown } | null = null;
  private lastPublishAt: number | null = null;
  /** Revision and kind of the last payload, so an unchanged one is not resent. */
  private lastEmitted: { revision: number; provisional: boolean } | null = null;
  /** Latest revision successfully handed to the result callback. */
  private resultPublishedRevision = -1;
  /** A provisional snapshot was emitted and no authoritative one followed. */
  private estimateShown = false;
  /** Between {@link onResult} and {@link settle}. */
  private settling = false;
  /** The owner released this stream's owner; nothing is emitted any more. */
  private released = false;
  private disposed = false;
  /** Failure kinds already logged, so a failing path warns once per stream. */
  private readonly warned = new Set<string>();

  constructor(private readonly options: LiveSessionStatsPublisherOptions) {
    this.clock = options.clock ?? REAL_CLOCK;
    this.inert = !options.onLiveStats || options.statsGeneration === null;
  }

  /**
   * The session the stream is bound to, from `init`. Attaches the owner
   * watcher; a second call (resume rebinding) detaches the previous one
   * first. When no current owner is keyed under `sessionId` (bind refused,
   * owner still under the tab key) the publisher stays silent.
   */
  setSessionKey(sessionId: SessionId): void {
    if (this.inert || this.released || this.disposed) return;
    const generation = this.options.statsGeneration;
    if (generation === null) return;
    this.detach();
    const detach = this.options.statsOwner.watch(sessionId, generation, {
      onAgentRecorded: () => this.onAgentRecorded(),
      onCacheChanged: () => this.onCacheChanged(),
      onReleased: (settled) => this.onOwnerReleased(settled),
    });
    if (detach === null) {
      this.sessionId = null;
      return;
    }
    this.sessionId = sessionId;
    this.detachWatcher = detach;
    // Frames seen before `init` publish with the first flush.
    if (this.usageById.size > 0) this.requestFlush();
  }

  /** Read one SDK message of the stream. Never throws. */
  observe(message: SDKMessage): void {
    if (this.inert || this.released || this.disposed) return;
    try {
      let flush = false;
      if (message.type === 'assistant' && this.recordUsage(message)) {
        flush = true;
      }
      // A subagent started or worked: the agent count is read at flush time.
      if (isTaskStarted(message) || hasParentToolUse(message)) flush = true;
      if (flush) this.requestFlush();
    } catch (error: unknown) {
      this.warnOnce('observe', 'Live stats observation failed', error);
    }
  }

  /**
   * Top of a result branch, before any `await`: cancel the pending flush,
   * forget the turn's usage and clear the run's estimate in the owner, so
   * every authoritative snapshot built from here on supersedes every live
   * one. Flush requests are ignored until {@link settle}.
   */
  onResult(): void {
    if (this.inert) return;
    this.cancelTimer();
    this.usageById.clear();
    this.dirty = false;
    if (this.released || this.disposed) return;
    this.clearEstimate();
    this.settling = true;
  }

  /** Record only a result snapshot that its callback actually accepted. */
  noteResultPublished(snapshot: SessionStatsEntry): void {
    this.resultPublishedRevision = Math.max(
      this.resultPublishedRevision,
      snapshot.revision ?? -1,
    );
  }

  /**
   * End of a result branch, on every exit: settle a shown estimate or a cache
   * revision that the result callback did not publish.
   */
  settle(): void {
    if (this.inert) return;
    this.settling = false;
    if (this.released || this.disposed) return;
    if (this.estimateShown || this.cacheDirty) {
      this.emitAuthoritative(this.authoritativeSnapshot());
    }
  }

  /**
   * Stream end (the transformer's `finally`). Cancels the timer, detaches the
   * watcher and, unless the owner's release already settled, clears the
   * estimate and emits any pending authoritative cache or estimate snapshot.
   * Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTimer();
    this.detach();
    this.usageById.clear();
    this.dirty = false;
    if (this.inert || this.released) return;
    try {
      // Cleared even when nothing was shown: a stream that ended without a
      // result must not strand its estimate on the owner.
      this.clearEstimate();
      if (this.estimateShown || this.cacheDirty) {
        this.emitAuthoritative(this.authoritativeSnapshot());
      }
    } catch (error: unknown) {
      this.warnOnce('dispose', 'Live stats settle at stream end failed', error);
    } finally {
      this.estimateShown = false;
    }
  }

  /**
   * Owner watcher: a subagent was recorded. Runs inside `recordAgent`, so it
   * never flushes synchronously: it arms the throttle timer instead.
   */
  private onAgentRecorded(): void {
    try {
      if (!this.canFlush() || this.timer !== null) return;
      const delay =
        this.lastPublishAt === null
          ? 0
          : Math.max(
              0,
              this.lastPublishAt + LIVE_STATS_INTERVAL_MS - this.clock.now(),
            );
      this.arm(delay);
    } catch (error: unknown) {
      this.warnOnce('agent', 'Live stats agent signal failed', error);
    }
  }

  /** Owner cache signals may arrive during a result branch. */
  private onCacheChanged(): void {
    try {
      if (this.released || this.disposed) return;
      this.cacheDirty = true;
      this.requestFlush();
    } catch (error: unknown) {
      // degradation-audit: observer - cache signals cannot interrupt owner writes
      this.warnOnce('cache', 'Live stats cache signal failed', error);
    }
  }

  /**
   * Owner watcher: the owner was released (Stop, `/clear`, session end),
   * possibly before the stream's `finally`. Settles synchronously with the
   * owner's final snapshot, even mid result branch, and silences the
   * publisher for good.
   */
  private onOwnerReleased(settled: SessionStatsEntry | null): void {
    try {
      this.cancelTimer();
      // The owner state that held the watcher is gone.
      this.detachWatcher = null;
      this.usageById.clear();
      this.dirty = false;
      if (this.released || this.disposed) return;
      this.released = true;
      this.emitAuthoritative(settled);
    } catch (error: unknown) {
      this.warnOnce('release', 'Live stats settle at release failed', error);
    }
  }

  /** Fold one `assistant` frame in; `true` when any counter grew. */
  private recordUsage(message: SDKMessage): boolean {
    const parsed = AssistantFrameSchema.safeParse(message);
    if (!parsed.success) return false;
    const { id, model, usage } = parsed.data.message;
    // Synthetic placeholders (`<synthetic>`) are not billed models.
    if (model.startsWith('<') && model.endsWith('>')) return false;
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;
    const previous = this.usageById.get(id);
    if (!previous) {
      if (input + output + cacheRead + cacheCreation === 0) return false;
      this.usageById.set(id, {
        model,
        input,
        output,
        cacheRead,
        cacheCreation,
      });
      this.dirty = true;
      return true;
    }
    // Partial and final frames of one message report the same usage growing;
    // the max keeps a late frame with a partial count from shrinking it.
    let grew = false;
    if (input > previous.input) {
      previous.input = input;
      grew = true;
    }
    if (output > previous.output) {
      previous.output = output;
      grew = true;
    }
    if (cacheRead > previous.cacheRead) {
      previous.cacheRead = cacheRead;
      grew = true;
    }
    if (cacheCreation > previous.cacheCreation) {
      previous.cacheCreation = cacheCreation;
      grew = true;
    }
    if (grew) this.dirty = true;
    return grew;
  }

  private canFlush(): boolean {
    return (
      !this.inert &&
      !this.released &&
      !this.disposed &&
      !this.settling &&
      this.sessionId !== null
    );
  }

  /**
   * Publish now when nothing was published in the last interval; otherwise
   * leave it to the one trailing timer, which coalesces every change.
   */
  private requestFlush(): void {
    if (!this.canFlush() || this.timer !== null) return;
    const now = this.clock.now();
    if (
      this.lastPublishAt === null ||
      now - this.lastPublishAt >= LIVE_STATS_INTERVAL_MS
    ) {
      this.flush();
      return;
    }
    this.arm(this.lastPublishAt + LIVE_STATS_INTERVAL_MS - now);
  }

  private arm(delay: number): void {
    const handle = this.clock.setTimeout(() => {
      this.timer = null;
      try {
        this.flush();
      } catch (error: unknown) {
        this.warnOnce('flush', 'Live stats flush failed', error);
      }
    }, delay);
    this.timer = { handle };
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private detach(): void {
    const detach = this.detachWatcher;
    this.detachWatcher = null;
    detach?.();
  }

  private flush(): void {
    this.cancelTimer();
    const generation = this.options.statsGeneration;
    if (!this.canFlush() || generation === null || this.sessionId === null) {
      return;
    }
    this.lastPublishAt = this.clock.now();
    // Unchanged usage passes `null`: the owner keeps the run's estimate and
    // only re-reads what else changed (the agent count).
    const rows = this.dirty ? this.estimateRows() : null;
    this.dirty = false;
    const snapshot = this.options.statsOwner.publishLive(
      this.sessionId,
      generation,
      this.options.runToken,
      rows !== null && rows.length > 0 ? rows : null,
    );
    if (snapshot === null) return;
    const provisional = snapshot.provisional === true;
    if (
      this.lastEmitted !== null &&
      this.lastEmitted.revision === snapshot.revision &&
      this.lastEmitted.provisional === provisional
    ) {
      this.cacheDirty = false;
      return;
    }
    // Context rides only on a provisional snapshot: an authoritative one must
    // never replace the context the result path derived from `modelUsage`.
    const context = provisional ? this.mainContext() : null;
    const cacheWasDirty = this.cacheDirty;
    this.cacheDirty = false;
    const emitted = this.emit({
      sessionId: this.sessionId,
      sessionStats: snapshot,
      ...(context !== null && { context }),
    });
    if (!emitted && cacheWasDirty) this.cacheDirty = true;
    if (provisional) this.estimateShown = true;
  }

  /** Drop this run's estimate on the owner (a no-op when it has none). */
  private clearEstimate(): void {
    const generation = this.options.statsGeneration;
    if (this.sessionId === null || generation === null) return;
    this.options.statsOwner.clearProvisional(
      this.sessionId,
      generation,
      this.options.runToken,
    );
  }

  /**
   * The owner's snapshot once this run's estimate is cleared. Normally done
   * by {@link onResult} already; clearing again is a no-op. Still
   * provisional only while ANOTHER run of the owner holds an estimate.
   */
  private authoritativeSnapshot(): SessionStatsEntry | null {
    const generation = this.options.statsGeneration;
    if (this.sessionId === null || generation === null) return null;
    this.clearEstimate();
    return this.options.statsOwner.publishLive(
      this.sessionId,
      generation,
      this.options.runToken,
      null,
    );
  }

  /**
   * The one exit of a shown estimate: emit `snapshot` (never with `context`)
   * when an estimate is showing, then mark none as showing in every case, so
   * exactly one authoritative payload follows whichever path settles first.
   */
  private emitAuthoritative(snapshot: SessionStatsEntry | null): void {
    const sessionId = this.sessionId;
    const shown = this.estimateShown;
    this.estimateShown = false;
    if (snapshot === null || sessionId === null) return;
    const revision = snapshot.revision ?? -1;
    const cacheIsNewer =
      this.cacheDirty &&
      revision > (this.lastEmitted?.revision ?? -1) &&
      revision > this.resultPublishedRevision;
    if (shown || cacheIsNewer) {
      const cacheWasDirty = this.cacheDirty;
      this.cacheDirty = false;
      if (!this.emit({ sessionId, sessionStats: snapshot }) && cacheWasDirty) {
        this.cacheDirty = true;
      }
    } else if (this.cacheDirty) {
      this.cacheDirty = false;
    }
  }

  /** One row per raw model, priced from the rate card. */
  private estimateRows(): RunModelUsage[] {
    const byModel = new Map<string, MessageUsage>();
    for (const usage of this.usageById.values()) {
      const sum = byModel.get(usage.model);
      if (sum) {
        sum.input += usage.input;
        sum.output += usage.output;
        sum.cacheRead += usage.cacheRead;
        sum.cacheCreation += usage.cacheCreation;
      } else {
        byModel.set(usage.model, { ...usage });
      }
    }
    return [...byModel.values()].map((usage) => ({
      model: usage.model,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheRead: usage.cacheRead,
      cacheCreation: usage.cacheCreation,
      costUSD: this.price(usage),
    }));
  }

  /** Rate-card cost of one model's usage; `null` when its price is unknown. */
  private price(usage: MessageUsage): number | null {
    try {
      const priced = this.options.modelResolver.resolveForCost(
        usage.model,
        this.options.accountingAuthEnv,
      );
      if (priced.pricing === null) return null;
      return calculateMessageCost(
        priced.modelId,
        {
          input: usage.input,
          output: usage.output,
          cacheHit: usage.cacheRead,
          cacheCreation: usage.cacheCreation,
        },
        priced.pricing,
      );
    } catch (error: unknown) {
      // degradation-audit: optional-capability — an unpriced model leaves the
      // provisional cost unknown; the authoritative result still prices it.
      this.warnOnce('price', 'Live stats pricing failed', error);
      return null;
    }
  }

  /** The main loop's context, its model labelled as result rows are. */
  private mainContext(): MainContextReading | null {
    try {
      const reading = this.options.readMainContext();
      if (
        reading === null ||
        reading.model.length === 0 ||
        !Number.isFinite(reading.contextTokens) ||
        reading.contextTokens < 0
      ) {
        return null;
      }
      const model = this.options.modelResolver.resolveForCost(
        reading.model,
        this.options.accountingAuthEnv,
      ).modelId;
      return { model, contextTokens: reading.contextTokens };
    } catch (error: unknown) {
      // degradation-audit: optional-capability — an unread context leaves the
      // provisional fill unknown; the authoritative result still reports it.
      this.warnOnce('context', 'Live stats context read failed', error);
      return null;
    }
  }

  /** Hand one payload to the callback; a sync or async failure is logged. */
  private emit(payload: SessionStatsLivePayload): boolean {
    const callback = this.options.onLiveStats;
    if (!callback) return false;
    try {
      const result: unknown = callback(payload);
      this.lastEmitted = {
        revision: payload.sessionStats.revision ?? -1,
        provisional: payload.sessionStats.provisional === true,
      };
      if (isThenable(result)) {
        result.then(undefined, (error: unknown) =>
          this.warnOnce('callback', 'onLiveStats callback failed', error),
        );
      }
      return true;
    } catch (error: unknown) {
      this.warnOnce('callback', 'onLiveStats callback failed', error);
      return false;
    }
  }

  /**
   * Log a failure once per kind per stream, at `warn`, with the error's name
   * only: a message may carry session content.
   */
  private warnOnce(kind: string, message: string, error: unknown): void {
    if (this.warned.has(kind)) return;
    this.warned.add(kind);
    this.options.logger.warn(`${LOG_TAG} ${message}`, {
      sessionId: this.sessionId,
      error: error instanceof Error ? error.name : typeof error,
    });
  }
}

function hasParentToolUse(message: SDKMessage): boolean {
  return (
    'parent_tool_use_id' in message &&
    typeof message.parent_tool_use_id === 'string' &&
    message.parent_tool_use_id.length > 0
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'then' in value &&
    typeof value.then === 'function'
  );
}
