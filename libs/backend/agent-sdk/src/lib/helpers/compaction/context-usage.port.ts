/**
 * ContextUsagePort — the single per-turn context reader (TASK_2026_597 A8,
 * component 21; rescoped by Wave D D.3).
 *
 * At a turn end the caller hands the port the session's live query. The port
 * calls the SDK's `getContextUsage({detail:'summary'})` accessor at most once
 * per session and turn, caches the narrowed result and serves it to every
 * reader of that turn: the compaction coordinator (27b) and the rotation
 * advisor (29a) read it back through `getLast(sessionId)`.
 *
 * `SessionControl.applySessionAutoCompactWindow` keeps its own direct
 * before/after read-back: it needs a fresh read right after applying the
 * window, which a per-turn cached value cannot give (D-3).
 *
 * Failure: never throws. A query without the accessor, an accessor that
 * throws or times out, or a response without finite token counts yields
 * `undefined` and one log line (the error type only — never its message).
 * The previous successful reading stays available through `getLast`.
 *
 * Lifetime: the cache entry of a session is released on session end (the
 * port subscribes to the session-end registry) or through `release`.
 */
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../../di/tokens';
import type {
  ContextUsageReadBack,
  Query,
} from '../session-lifecycle-manager';
import type { SessionEndCallbackRegistry } from '../session-end-callback-registry';

/** Bounds one `getContextUsage` control request; a stalled child must not hold the turn end. */
export const CONTEXT_USAGE_READ_TIMEOUT_MS = 5_000;

/** Where a reading came from. The port itself only produces `'sdk-getContextUsage'`. */
export type ContextUsageSource =
  | 'sdk-getContextUsage'
  | 'result-usage'
  | 'estimate';

/** One context reading, as the coordinator and the rotation advisor consume it. */
export interface ContextUsageReading {
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly autoCompactThreshold?: number;
  readonly source: ContextUsageSource;
}

/** The only part of the live query the port touches. */
export type ContextUsageQuery = Pick<Query, 'getContextUsage'>;

export interface IContextUsagePort {
  /**
   * Read the context at the end of `turnId`. A second call for the same
   * session and turn returns the first call's result without a new request.
   */
  readAtTurnEnd(
    sessionId: string,
    turnId: string,
    query: ContextUsageQuery,
  ): Promise<ContextUsageReading | undefined>;
  /** The most recent successful reading of the session, if any. */
  getLast(sessionId: string): ContextUsageReading | undefined;
  /** Drop every cached value of the session. */
  release(sessionId: string): void;
}

interface TurnRead {
  readonly turnId: string;
  readonly result: Promise<ContextUsageReading | undefined>;
}

@injectable()
export class ContextUsagePort implements IContextUsagePort {
  /** The read of the latest turn per session (settled or in flight). */
  private readonly turnReads = new Map<string, TurnRead>();
  /** The latest successful reading per session. */
  private readonly lastReadings = new Map<string, ContextUsageReading>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY)
    sessionEndRegistry: SessionEndCallbackRegistry,
  ) {
    // Singleton for the container's life, so the disposer is not kept.
    sessionEndRegistry.register(({ sessionId }) => this.release(sessionId));
  }

  readAtTurnEnd(
    sessionId: string,
    turnId: string,
    query: ContextUsageQuery,
  ): Promise<ContextUsageReading | undefined> {
    const cached = this.turnReads.get(sessionId);
    if (cached && cached.turnId === turnId) {
      return cached.result;
    }
    const read: TurnRead = {
      turnId,
      result: this.read(sessionId, query).then((reading) => {
        // A release (or a newer turn) while in flight must not be undone.
        if (reading && this.turnReads.get(sessionId) === read) {
          this.lastReadings.set(sessionId, reading);
        }
        return reading;
      }),
    };
    this.turnReads.set(sessionId, read);
    return read.result;
  }

  getLast(sessionId: string): ContextUsageReading | undefined {
    return this.lastReadings.get(sessionId);
  }

  release(sessionId: string): void {
    this.turnReads.delete(sessionId);
    this.lastReadings.delete(sessionId);
  }

  private async read(
    sessionId: string,
    query: ContextUsageQuery,
  ): Promise<ContextUsageReading | undefined> {
    const accessor = query.getContextUsage?.bind(query);
    if (!accessor) {
      this.logger.debug(
        `[ContextUsagePort] no getContextUsage accessor for session ${sessionId}; no reading this turn`,
      );
      return undefined;
    }
    let usage: Partial<ContextUsageReadBack> | undefined;
    let failed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      usage = await Promise.race([
        accessor({ detail: 'summary' }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `getContextUsage timed out after ${CONTEXT_USAGE_READ_TIMEOUT_MS}ms`,
                ),
              ),
            CONTEXT_USAGE_READ_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } catch (error) {
      // Logged, then the turn gets no reading. The type only: an SDK message
      // can carry paths or content.
      failed = true;
      const kind = error instanceof Error ? error.name : typeof error;
      this.logger.warn(
        `[ContextUsagePort] getContextUsage failed for session ${sessionId} (${kind}); no reading this turn`,
      );
    } finally {
      clearTimeout(timer);
    }
    return failed ? undefined : this.toReading(sessionId, usage);
  }

  /** External boundary: the child answers over IPC, so the shape is checked. */
  private toReading(
    sessionId: string,
    usage: Partial<ContextUsageReadBack> | undefined,
  ): ContextUsageReading | undefined {
    const totalTokens = usage?.totalTokens;
    const maxTokens = usage?.maxTokens;
    const autoCompactThreshold = usage?.autoCompactThreshold;
    if (!isTokenCount(totalTokens) || !isTokenCount(maxTokens)) {
      this.logger.warn(
        `[ContextUsagePort] getContextUsage returned no token counts for session ${sessionId}; no reading this turn`,
      );
      return undefined;
    }
    return {
      totalTokens,
      maxTokens,
      ...(isTokenCount(autoCompactThreshold) ? { autoCompactThreshold } : {}),
      source: 'sdk-getContextUsage',
    };
  }
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
