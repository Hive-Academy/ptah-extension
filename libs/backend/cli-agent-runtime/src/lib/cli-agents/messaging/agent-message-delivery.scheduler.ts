/**
 * The only place where time-based or startup work happens for lane messages
 * (Component 8).
 *
 * - `start` re-arms stored retry times. What a previous host run left behind
 *   was already reclassified by the envelope store's restore, and is never
 *   re-sent blind: `started` and `dispatching` envelopes may have reached the
 *   adapter (`outcome-unknown`); `not-started` ones never did and are held as
 *   `awaiting-resume` for a manual Retry (no automatic spawn).
 * - `enqueueCold` delivers exit-race entries through the coordinator's cold
 *   path, in creation order, one at a time per lane.
 * - `schedule` keeps ONE `setTimeout` for the whole host, armed for the
 *   earliest due retry and `unref()`-ed.
 * - `onLaneSettled` re-offers `queue-full` holds.
 *
 * Envelopes whose parent session is being deleted are frozen: the purge
 * finishes them, and this scheduler never delivers them.
 */
import type { AgentId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentMessageEnvelope } from './envelope/agent-message-envelope.schema';
import {
  AgentMessageBodyUnavailableError,
  type AgentMessageEnvelopeStore,
} from './envelope/agent-message-envelope.store';
import { LaneSerialQueue } from './lane-serial-queue';

/** The coordinator's delivery entry point. It takes the shared lane queue itself. */
export interface AgentMessageDeliveryTarget {
  deliver(envelopeId: string): Promise<void>;
}

/** The narrow scheduler surface the coordinator and reconciler call. */
export interface AgentMessageDeliveryScheduling {
  enqueueCold(envelopeId: string): void;
  schedule(envelopeId: string, at: number): void;
  onLaneSettled(agentId: AgentId): void;
}

export type SchedulerEnvelopeStore = Pick<
  AgentMessageEnvelopeStore,
  'ready' | 'get' | 'list' | 'transition'
>;

export interface AgentMessageDeliverySchedulerOptions {
  readonly clock?: () => number;
  /** True while the parent session's deletion is in progress. */
  readonly isParentFrozen?: (parentSessionId: string) => boolean;
}

/** Re-arm floor, so a run can never tight-loop the timer. */
export const SCHEDULER_MIN_DELAY_MS = 1_000;
/** Backoff after a failed scheduled or cold delivery, by attempt. */
export const SCHEDULER_BACKOFF_MS = [5_000, 30_000, 120_000] as const;
/** Recheck delay for a due retry whose parent is frozen. */
const FROZEN_RECHECK_MS = 60_000;

export class AgentMessageDeliveryScheduler implements AgentMessageDeliveryScheduling {
  private readonly due = new Map<string, number>();
  private readonly cold = new Set<string>();
  private readonly lanes = new LaneSerialQueue();
  private readonly clock: () => number;
  private readonly isParentFrozen: (parentSessionId: string) => boolean;
  private target?: AgentMessageDeliveryTarget;
  private timer?: ReturnType<typeof setTimeout>;
  private coldDrain?: Promise<void>;
  private disposed = false;

  constructor(
    private readonly store: SchedulerEnvelopeStore,
    private readonly logger: Logger,
    options: AgentMessageDeliverySchedulerOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.isParentFrozen = options.isParentFrozen ?? (() => false);
  }

  /**
   * Attach the coordinator and arm the retry timer for stored holds. Called
   * once by the coordinator factory, after the parent purge recovery. The
   * envelope store's own restore has already reclassified the previous run
   * (`started` / `dispatching` → `outcome-unknown`, `not-started` →
   * `awaiting-resume`), and none of those has a retry time, so nothing from
   * the previous run is re-sent automatically.
   */
  async start(target: AgentMessageDeliveryTarget): Promise<void> {
    this.target = target;
    await this.store.ready;
    const held = await this.store.list({ states: ['blocked-retryable'] });
    for (const envelope of held) {
      if (this.disposed) return;
      if (envelope.nextRetryAt !== undefined && !this.frozen(envelope))
        this.schedule(envelope.id, envelope.nextRetryAt);
    }
    this.drainCold();
  }

  enqueueCold(envelopeId: string): void {
    if (this.disposed) return;
    this.cold.add(envelopeId);
    this.drainCold();
  }

  schedule(envelopeId: string, at: number): void {
    if (this.disposed) return;
    this.due.set(envelopeId, at);
    this.arm();
  }

  onLaneSettled(agentId: AgentId): void {
    if (this.disposed || !this.target) return;
    void this.reofferQueueFull(agentId).catch((error: unknown) => {
      this.logger.error('[AgentMessageDeliveryScheduler] Queue-full re-offer failed', this.asError(error));
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.due.clear();
    this.cold.clear();
  }


  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed || this.due.size === 0) return;
    const earliest = Math.min(...this.due.values());
    const delay = Math.max(SCHEDULER_MIN_DELAY_MS, earliest - this.clock());
    const timer = setTimeout(() => {
      this.timer = undefined;
      void this.runDue()
        .catch((error: unknown) => {
          // Degradation: the failed ids were dequeued; a manual Retry still applies.
          this.logger.error('[AgentMessageDeliveryScheduler] Scheduled run failed', this.asError(error));
        })
        .finally(() => this.arm());
    }, delay);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    this.timer = timer;
  }

  private async runDue(): Promise<void> {
    if (!this.target) return;
    const now = this.clock();
    const ready = [...this.due.entries()].filter(([, at]) => at <= now).map(([id]) => id);
    for (const id of ready) this.due.delete(id);
    const envelopes = await this.load(ready);
    await Promise.all(envelopes.map((envelope) => {
      if (envelope.state !== 'blocked-retryable') return Promise.resolve();
      if (this.frozen(envelope)) {
        this.due.set(envelope.id, now + FROZEN_RECHECK_MS);
        return Promise.resolve();
      }
      return this.lanes.run(envelope.targetAgentId, () => this.deliverSafely(envelope));
    }));
  }

  private drainCold(): void {
    if (!this.target || this.coldDrain || this.cold.size === 0) return;
    this.coldDrain = this.drainColdBatch()
      .catch((error: unknown) => {
        this.logger.error('[AgentMessageDeliveryScheduler] Cold delivery drain failed',
          this.asError(error));
      })
      .finally(() => {
        this.coldDrain = undefined;
        this.drainCold();
      });
  }

  private async drainColdBatch(): Promise<void> {
    // Let same-tick enqueues join this batch, so they are sorted together.
    await Promise.resolve();
    const ids = [...this.cold];
    this.cold.clear();
    const envelopes = (await this.load(ids))
      .filter((envelope) => !this.frozen(envelope))
      .sort((a, b) => a.createdAt - b.createdAt);
    await Promise.all(envelopes.map((envelope) =>
      this.lanes.run(envelope.targetAgentId, () => this.deliverSafely(envelope))));
  }

  private async reofferQueueFull(agentId: AgentId): Promise<void> {
    const held = (await this.store.list({ targetAgentId: agentId, states: ['blocked-retryable'] }))
      .filter((envelope) => envelope.reason === 'queue-full' && !this.frozen(envelope))
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const envelope of held)
      await this.lanes.run(envelope.targetAgentId, () => this.deliverSafely(envelope));
  }

  /** A throwing delivery is logged, counted and backed off; it never tight-loops. */
  private async deliverSafely(envelope: AgentMessageEnvelope): Promise<void> {
    const target = this.target;
    if (!target || this.disposed) return;
    try {
      await target.deliver(envelope.id);
    } catch (error: unknown) {
      if (error instanceof AgentMessageBodyUnavailableError) {
        // The envelope is already `failed` with no retry time: nothing to back off.
        this.logger.warn('[AgentMessageDeliveryScheduler] Held message body unavailable; marked failed',
          { envelopeId: error.envelopeId });
        return;
      }
      this.logger.error('[AgentMessageDeliveryScheduler] Scheduled delivery failed',
        this.asError(error));
      await this.backOff(envelope.id);
    }
  }

  private async backOff(envelopeId: string): Promise<void> {
    try {
      const current = await this.store.get(envelopeId);
      // Anything past `blocked-retryable` was decided by the coordinator; leave it.
      if (!current || (current.state !== 'not-started' && current.state !== 'blocked-retryable'))
        return;
      const attemptCount = current.attemptCount + 1;
      const delay = SCHEDULER_BACKOFF_MS[attemptCount - 1];
      const nextRetryAt = delay === undefined ? undefined : this.clock() + delay;
      const next = await this.store.transition(envelopeId, {
        state: 'blocked-retryable',
        attemptCount,
        nextRetryAt,
        ...(current.state === 'blocked-retryable' ? {} : { reason: 'delivery-failed' }),
      }, ['not-started', 'blocked-retryable']);
      // Past the last backoff step the hold is manual: no timer, Retry in the UI.
      if (nextRetryAt !== undefined && next?.nextRetryAt === nextRetryAt)
        this.schedule(envelopeId, nextRetryAt);
    } catch (error: unknown) {
      // Degradation: the envelope keeps its stored state; a manual Retry still applies.
      this.logger.error('[AgentMessageDeliveryScheduler] Backoff write failed', this.asError(error));
    }
  }

  private async load(ids: readonly string[]): Promise<AgentMessageEnvelope[]> {
    const loaded = await Promise.all(ids.map((id) => this.store.get(id)));
    return loaded.filter((envelope): envelope is AgentMessageEnvelope => envelope !== undefined);
  }

  private frozen(envelope: AgentMessageEnvelope): boolean {
    return envelope.parentSessionId !== undefined && this.isParentFrozen(envelope.parentSessionId);
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
