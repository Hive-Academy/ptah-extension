import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';

const GENERIC_FAILURE = 'Could not send the follow-up. Try again.';

function deliveryFailureReason(reason: string): string {
  if (reason === 'agent_stopped') return 'The lane stopped before receiving this message.';
  if (reason === 'host-restarted') return 'The host restarted before delivery.';
  return GENERIC_FAILURE;
}

type AgentTextMap = ReadonlyMap<string, string>;

function withEntry(map: AgentTextMap, key: string, value: string): AgentTextMap {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

function withoutEntry<T>(map: ReadonlyMap<string, T>, key: string) {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

function withoutMissing<T>(
  map: ReadonlyMap<string, T>,
  present: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  let next: Map<string, T> | null = null;
  for (const key of map.keys()) {
    if (present.has(key)) continue;
    next ??= new Map(map);
    next.delete(key);
  }
  return next ?? map;
}

/** Draft and receipt projection for the backend-owned message queue. */
@Injectable({ providedIn: 'root' })
export class AgentFollowUpQueueService {
  private readonly store = inject(AgentMonitorStore);
  private readonly _queued = signal<AgentTextMap>(new Map());
  private readonly _undelivered = signal<AgentTextMap>(new Map());
  private readonly _errors = signal<AgentTextMap>(new Map());
  private readonly _sending = signal<ReadonlySet<string>>(new Set());
  private readonly accepted = new Map<string, { id: string; text: string }>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly revisions = new Map<string, number>();
  private readonly observed = new Map<string, string>();
  private readonly cancelled = new Set<string>();

  constructor() {
    effect(() => {
      const agents = this.store.agents();
      const receipts = this.store.receipts();
      untracked(() => {
        const present = new Set(agents.map((agent) => agent.agentId));
        this._queued.update((map) => withoutMissing(map, present));
        this._undelivered.update((map) => withoutMissing(map, present));
        this._errors.update((map) => withoutMissing(map, present));
        for (const [agentId, pending] of this.accepted) {
          const receipt = receipts.get(agentId)?.find((item) => item.id === pending.id);
          if (!receipt || this.observed.get(agentId) === `${receipt.id}:${receipt.state}`) continue;
          this.observed.set(agentId, `${receipt.id}:${receipt.state}`);
          if (receipt.reason === 'cancelled-by-user' && this.cancelled.has(receipt.id)) {
            this.accepted.delete(agentId);
            this.cancelled.delete(receipt.id);
          } else if (receipt.state === 'failed' || receipt.state === 'expired' || receipt.state === 'interrupted-undelivered') {
            this.accepted.delete(agentId);
            this.fail(agentId, pending.text, receipt.reason ?? GENERIC_FAILURE);
          } else if (receipt.state === 'settled') {
            this.accepted.delete(agentId);
          }
        }
      });
    });
  }

  queued(agentId: string): string | null {
    return this._queued().get(agentId) ?? this.accepted.get(agentId)?.text ?? null;
  }

  undelivered(agentId: string): string | null {
    return this._undelivered().get(agentId) ?? null;
  }

  error(agentId: string): string | null {
    return this._errors().get(agentId) ?? null;
  }

  sending(agentId: string): boolean {
    return this._sending().has(agentId);
  }

  /** Coalesce another thought into the accepted message while it can still be cancelled. */
  enqueue(agentId: string, message: string): void {
    const prior = this.queued(agentId);
    const text = prior ? `${prior}\n${message}` : message;
    this._queued.update((map) => withEntry(map, agentId, text));
    this._errors.update((map) => withoutEntry(map, agentId));
    const revision = (this.revisions.get(agentId) ?? 0) + 1;
    this.revisions.set(agentId, revision);
    this.schedule(agentId, async () => {
      const accepted = this.accepted.get(agentId);
      if (accepted) {
        this.cancelled.add(accepted.id);
        const cancelled = await this.store.cancelMessage(agentId, accepted.id);
        if (cancelled.reason !== 'cancelled-by-user') {
          this.cancelled.delete(accepted.id);
          this._queued.update((map) => withoutEntry(map, agentId));
          this._errors.update((map) => withEntry(map, agentId, 'Message already started and could not be edited.'));
          return;
        }
        this.accepted.delete(agentId);
      }
      if (this.revisions.get(agentId) !== revision) return;
      const outcome = await this.store.sendMessage(agentId, text, 'queue');
      if (outcome.mode === 'unsupported' || !outcome.receipt) {
        this.fail(agentId, text, outcome.detail ?? GENERIC_FAILURE);
        this._queued.update((map) => withoutEntry(map, agentId));
        return;
      }
      this.accepted.set(agentId, { id: outcome.receipt.id, text });
      if (this.revisions.get(agentId) !== revision && !this._queued().has(agentId)) {
        this.cancelled.add(outcome.receipt.id);
        const cancelled = await this.store.cancelMessage(agentId, outcome.receipt.id);
        if (cancelled.reason === 'cancelled-by-user') this.accepted.delete(agentId);
      }
      if (this.revisions.get(agentId) === revision) this._queued.update((map) => withoutEntry(map, agentId));
    }, text);
  }

  /** Take text back into the composer; cancel an accepted message if possible. */
  unqueue(agentId: string): string | null {
    const text = this.queued(agentId);
    if (text === null) return null;
    this._queued.update((map) => withoutEntry(map, agentId));
    this.revisions.set(agentId, (this.revisions.get(agentId) ?? 0) + 1);
    const pending = this.accepted.get(agentId);
    if (pending) {
      this.schedule(agentId, async () => {
        this.cancelled.add(pending.id);
        const receipt = await this.store.cancelMessage(agentId, pending.id);
        if (receipt.reason === 'cancelled-by-user') this.accepted.delete(agentId);
        else {
          this.cancelled.delete(pending.id);
          this._errors.update((map) => withEntry(map, agentId, 'Message already started and could not be edited.'));
        }
      }, text);
    }
    return text;
  }

  takeUndelivered(agentId: string): string | null {
    const text = this.undelivered(agentId);
    this._undelivered.update((map) => withoutEntry(map, agentId));
    return text;
  }

  /** Direct sends also use the backend coordinator and its receipt. */
  async send(agent: MonitoredAgent, message: string): Promise<void> {
    this._sending.update((set) => new Set(set).add(agent.agentId));
    this._errors.update((map) => withoutEntry(map, agent.agentId));
    try {
      const outcome = await this.store.sendMessage(agent.agentId, message, 'queue');
      if (outcome.mode === 'unsupported' || !outcome.receipt) this.fail(agent.agentId, message, outcome.detail ?? GENERIC_FAILURE);
      else this.accepted.set(agent.agentId, { id: outcome.receipt.id, text: message });
    } catch (error: unknown) {
      this.fail(agent.agentId, message, error instanceof Error ? error.message : GENERIC_FAILURE);
    } finally {
      this._sending.update((set) => { const next = new Set(set); next.delete(agent.agentId); return next; });
    }
  }

  private schedule(agentId: string, operation: () => Promise<void>, text: string): void {
    const previous = this.operations.get(agentId) ?? Promise.resolve();
    const next = previous.then(operation).catch((error: unknown) => {
      this._queued.update((map) => withoutEntry(map, agentId));
      this.fail(agentId, text, error instanceof Error ? error.message : GENERIC_FAILURE);
    });
    this.operations.set(agentId, next);
    void next.then(() => { if (this.operations.get(agentId) === next) this.operations.delete(agentId); });
  }

  private fail(agentId: string, message: string, reason: string): void {
    const prior = this.undelivered(agentId);
    this._undelivered.update((map) => withEntry(map, agentId, prior ? `${prior}\n${message}` : message));
    this._errors.update((map) => withEntry(map, agentId, deliveryFailureReason(reason)));
  }
}

