/**
 * Lane-event and restart reconciliation of message envelopes (Component 6).
 *
 * With the dispatcher, this is the only writer of envelope transitions that
 * follow lane events. Every handler runs in the lane's serial queue (keyed by
 * the lineage root), so it never overlaps a route for the same lane. Handler
 * failures are logged and never reject into the manager's event emitter.
 */
import { AgentId, type AgentProcessInfo } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentProcessManager } from '../agent-process-manager.service';
import type { AgentIdAliasRegistry } from './agent-id-alias.registry';
import {
  SCHEDULER_BACKOFF_MS,
  type AgentMessageDeliveryScheduling,
} from './agent-message-delivery.scheduler';
import type { AgentMessageEnvelope, EnvelopePatch } from './envelope/agent-message-envelope.schema';
import type { AgentMessageEnvelopeStore } from './envelope/agent-message-envelope.store';
import type { LaneSerialQueue } from './lane-serial-queue';

export type ReconcilerManager = Pick<
  AgentProcessManager,
  'events' | 'getMessageRoutableAgent' | 'getAgentMessageStatus'
>;
export type ReconcilerEnvelopeStore = Pick<AgentMessageEnvelopeStore, 'get' | 'list' | 'transition'>;

export interface AgentMessageReconcilerDeps {
  readonly manager: ReconcilerManager;
  readonly store: ReconcilerEnvelopeStore;
  readonly aliases: Pick<AgentIdAliasRegistry, 'rootOf'>;
  readonly scheduler: AgentMessageDeliveryScheduling;
  readonly serial: LaneSerialQueue;
  readonly logger: Logger;
  readonly clock: () => number;
  /** Host start time: an in-flight envelope last written before it is from a previous run. */
  readonly bootAt: number;
}

interface QueueUpdate {
  readonly agentId: string;
  readonly failures?: readonly { messageId: string; reason: string }[];
}

/** Router reasons for an entry that was parked but never dispatched (exit race, gap 10). */
const EXIT_RACE = new Set(['agent_stopped', 'subprocess_released', 'session_changed']);
const KNOWN_FAILURES = new Set(['continuation_rejected', 'queue-full', 'storage-unavailable']);

/** The lane that owns an envelope's delivery: the resumed lane once there is one. */
export function envelopeLane(envelope: AgentMessageEnvelope): AgentId {
  return envelope.actualAgentId ?? envelope.targetAgentId;
}

/** Remove a parked router entry, so a cancelled or re-routed envelope is never flushed. */
export function removeParkedEntry(
  manager: Pick<AgentProcessManager, 'getMessageRoutableAgent'>,
  laneId: string,
  messageId: string,
): boolean {
  const pending = manager.getMessageRoutableAgent(laneId)?.pendingMessages;
  const index = pending?.findIndex((entry) => entry.messageId === messageId) ?? -1;
  if (!pending || index < 0) return false;
  pending.splice(index, 1);
  return true;
}

export class AgentMessageReconciler {
  private readonly detachers: (() => void)[] = [];

  constructor(private readonly deps: AgentMessageReconcilerDeps) {}

  attach(): void {
    this.listen('agent:turn-started', (info: AgentProcessInfo & { messageId?: string }) =>
      this.onLane(info.agentId, () => this.onTurnStarted(info)));
    this.listen('agent:turn-settled', (info: AgentProcessInfo) =>
      this.onLane(info.agentId, () => this.settleTurn(info)).then(() => {
        const laneId = AgentId.safeParse(info.agentId);
        if (laneId) this.deps.scheduler.onLaneSettled(laneId);
      }));
    this.listen('agent:queue-updated', (update: QueueUpdate) =>
      this.onLane(update.agentId, () => this.onQueueUpdated(update)));
    this.listen('agent:expired', ({ agentId }: { agentId: string }) =>
      this.onLane(agentId, () => this.onExpired(agentId)));
  }

  dispose(): void {
    for (const detach of this.detachers.splice(0)) detach();
  }

  /**
   * Restart reclassification. The envelope store's restore already maps a
   * previous run's `not-started` to `blocked-retryable`/`awaiting-resume`,
   * and `dispatching`/`started` to `outcome-unknown`. This pass enforces the
   * same rule for any in-flight envelope last written before this host
   * started, so a previous run's message is never re-sent blind.
   */
  async reconcileStartup(): Promise<number> {
    const stale = (await this.deps.store.list({ states: ['not-started', 'dispatching', 'started'] }))
      .filter((envelope) => envelope.updatedAt < this.deps.bootAt);
    for (const envelope of stale) {
      const patch: EnvelopePatch = envelope.state === 'not-started'
        ? { state: 'blocked-retryable', reason: 'awaiting-resume', nextRetryAt: undefined }
        : { state: 'outcome-unknown',
          reason: envelope.state === 'dispatching' ? 'dispatch-interrupted' : 'host-restarted' };
      await this.deps.store.transition(envelope.id, patch, [envelope.state]);
    }
    return stale.length;
  }

  /** Settle every started envelope of the lane's finished turn. */
  async settleTurn(info: AgentProcessInfo): Promise<void> {
    if (!info.turnSeq) return;
    const started = (await this.deps.store.list({ states: ['started'] }))
      .filter((envelope) => envelopeLane(envelope) === info.agentId && envelope.turnSeq === info.turnSeq);
    const turnOutcome = info.status === 'completed' ? 'completed'
      : info.status === 'stopped' ? 'stopped' : 'failed';
    for (const envelope of started)
      await this.deps.store.transition(envelope.id, { state: 'settled', turnSeq: info.turnSeq, turnOutcome }, ['started']);
  }

  private listen<T>(event: string, handler: (payload: T) => Promise<void>): void {
    const listener = (payload: T) => {
      void handler(payload).catch((error: unknown) => {
        // Degradation: envelope bookkeeping cannot reject into the host event emitter.
        this.deps.logger.error('[AgentMessageCoordinator] Receipt event failed',
          error instanceof Error ? error : new Error('Receipt event failed'));
      });
    };
    this.deps.manager.events.on(event, listener);
    this.detachers.push(() => this.deps.manager.events.off(event, listener));
  }

  private async onLane(agentId: string, task: () => Promise<void>): Promise<void> {
    const laneId = AgentId.safeParse(agentId);
    if (!laneId) {
      this.deps.logger.warn('[AgentMessageCoordinator] Ignored lane event with an invalid agent id');
      return;
    }
    const root = await this.deps.aliases.rootOf(laneId);
    await this.deps.serial.run(root, task);
  }

  private async onTurnStarted(info: AgentProcessInfo & { messageId?: string }): Promise<void> {
    if (!info.messageId || !info.turnSeq) return;
    const envelope = await this.deps.store.get(info.messageId);
    if (!envelope || (envelope.state !== 'dispatching' && envelope.state !== 'not-started')) return;
    const laneId = AgentId.safeParse(info.agentId);
    await this.deps.store.transition(envelope.id, {
      state: 'started', turnSeq: info.turnSeq,
      ...(laneId && laneId !== envelope.targetAgentId ? { actualAgentId: laneId } : {}),
    }, ['dispatching', 'not-started']);
  }

  private async onQueueUpdated({ agentId, failures = [] }: QueueUpdate): Promise<void> {
    const reasons = new Map(failures.map((entry) => [entry.messageId, entry.reason]));
    // A router status the event did not carry (an older emitter) is read from the
    // durable list, never from a memory-only id map.
    const live = (await this.deps.store.list({ states: ['not-started', 'dispatching'] }))
      .filter((envelope) => envelopeLane(envelope) === agentId && !reasons.has(envelope.id));
    for (const envelope of live) {
      const status = this.deps.manager.getAgentMessageStatus(agentId, envelope.id);
      if (status.status === 'failed') reasons.set(envelope.id, status.reason);
    }
    for (const [messageId, reason] of reasons) await this.applyQueueFailure(agentId, messageId, reason);
  }

  private async applyQueueFailure(agentId: string, messageId: string, reason: string): Promise<void> {
    const envelope = await this.deps.store.get(messageId);
    if (!envelope) return;
    if (envelope.state === 'cancelled' || envelope.state === 'settled') {
      removeParkedEntry(this.deps.manager, agentId, messageId);
      return;
    }
    if (envelope.state !== 'not-started' && envelope.state !== 'dispatching') return;
    if (EXIT_RACE.has(reason)) {
      if (envelope.state === 'not-started') {
        // Never dispatched: hand it to the cold inbox instead of failing it (gap 10).
        const cold = await this.deps.store.transition(messageId, { route: 'cold' }, ['not-started']);
        if (cold?.state === 'not-started') this.deps.scheduler.enqueueCold(messageId);
        return;
      }
      // Journalled, then torn down before or during the adapter call: the lane
      // may have received it. Never re-dispatch without duplicate confirmation.
      await this.deps.store.transition(messageId, {
        state: 'outcome-unknown', reason: 'dispatch-interrupted',
      }, ['dispatching']);
      return;
    }
    if (reason === 'continuation_transient' && envelope.state === 'dispatching') {
      const delay = SCHEDULER_BACKOFF_MS[Math.max(0, envelope.attemptCount - 1)];
      const nextRetryAt = delay === undefined ? undefined : this.deps.clock() + delay;
      const held = await this.deps.store.transition(messageId, {
        state: 'blocked-retryable', reason: 'continuation_transient', nextRetryAt,
      }, ['dispatching']);
      if (nextRetryAt !== undefined && held?.nextRetryAt === nextRetryAt)
        this.deps.scheduler.schedule(messageId, nextRetryAt);
      return;
    }
    if (reason === 'storage-unavailable') {
      // The journal write failed, so nothing ran. The entry stays parked for
      // the next flush; Retry needs no confirmation.
      await this.deps.store.transition(messageId, {
        state: 'blocked-retryable', reason: 'storage-unavailable', nextRetryAt: undefined,
      }, ['not-started']);
      return;
    }
    // A permanent rejection keeps the body for Retry, Recover text or Cancel.
    await this.deps.store.transition(messageId, {
      state: 'failed', reason: KNOWN_FAILURES.has(reason) ? reason : 'delivery-failed',
    }, ['not-started', 'dispatching']);
  }

  /**
   * The record is gone from this host run. A lane with a CLI session can be
   * cold-resumed once its record is restored, so its held messages wait for a
   * Retry; without a session they expire. Bodies are kept either way.
   */
  private async onExpired(agentId: string): Promise<void> {
    const held = (await this.deps.store.list({ states: ['not-started', 'blocked-retryable'] }))
      .filter((envelope) => envelopeLane(envelope) === agentId);
    for (const envelope of held) {
      if (envelope.cliSessionId) {
        if (envelope.state === 'not-started')
          await this.deps.store.transition(envelope.id, {
            state: 'blocked-retryable', reason: 'awaiting-resume', route: 'cold', nextRetryAt: undefined,
          }, ['not-started']);
        continue;
      }
      await this.deps.store.transition(envelope.id, {
        state: 'expired', reason: 'agent_expired', nextRetryAt: undefined,
      }, ['not-started', 'blocked-retryable']);
    }
  }
}
