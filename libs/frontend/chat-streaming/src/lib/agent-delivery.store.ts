/**
 * Agent Delivery Store
 *
 * Renderer view of message delivery to lanes and of lane deliveries to the
 * parent session. The backend owns both queues; this store merges its pushes
 * and the `agent:list*` hydration reads into one monotonic projection, and
 * derives labels that keep transport, turn and acknowledgment apart.
 *
 * Hydration runs on renderer start and on session selection (see
 * `AgentMonitorMessageHandler`). A failed read keeps the push-only state and
 * is logged; the store never fabricates a state the backend did not report.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  AgentDeliveryReceipt,
  AgentMessageAckState,
  AgentMessageDelivery,
  AgentMessageOutcome,
  AgentMessagePreview,
  AgentMonitorParentDeliveryPayload,
  ParentDeliveryState,
  ParentDeliveryView,
} from '@ptah-extension/shared';
import {
  AgentDeliveryReceiptSchema,
  AgentId,
  AgentMonitorParentDeliveryPayloadSchema,
} from '@ptah-extension/shared';
import {
  ClaudeRpcService,
  LoggingService,
  injectWallClock,
} from '@ptah-extension/core';
import { AgentMonitorStore } from './agent-monitor.store';

/** A parent delivery as held by the renderer (a push or a hydrated view). */
export type ParentDeliveryItem = Omit<AgentMonitorParentDeliveryPayload, 'removed'>;

export type DeliveryActionKind = 'retry' | 'cancel' | 'recover';

export interface DeliveryAction {
  readonly kind: DeliveryActionKind;
  readonly label: 'Retry' | 'Retry now' | 'Cancel' | 'Recover text';
  /** Retry may run the work twice: the caller must confirm before calling. */
  readonly confirmDuplicateRisk: boolean;
}

export interface DeliveryStatus {
  /** Label without the age suffix. */
  readonly label: string;
  /** Transport-only label ("Delivered to lane" when settled). */
  readonly transportLabel?: string;
  /** Turn-outcome label when the turn has settled ("Turn ended · completed"). */
  readonly turnOutcomeLabel?: string;
  /** Epoch ms the age counts from, when the label shows an age. */
  readonly since?: number;
  /** Rendered age ("4m"), paired with `since` for a `<time datetime>`. */
  readonly age?: string;
  /** Epoch ms the limit resets at, when a known reset time is shown in `<time datetime>`. */
  readonly resetAt?: number;
  /** Rendered reset clock time, paired with `resetAt` for a `<time datetime>`. */
  readonly resetTime?: string;
  /** Semantic acknowledgment state, separate from transport and turn outcome. */
  readonly ackState?: AgentMessageAckState;
  /** Semantic acknowledgment label ("Awaiting lane ack", "Read by lane", etc.). */
  readonly ackLabel?: string;
  /** Epoch ms when the lane acknowledged the message. */
  readonly ackAt?: number;
  /** Label and age as one plain-text string. */
  readonly text: string;
  /** The item needs the user's attention (status is text, the tone only adds to it). */
  readonly attention: boolean;
  readonly actions: readonly DeliveryAction[];
}

const RECEIPTS_CAP = 1024;
const PARENT_DELIVERIES_CAP = 1024;

const RECEIPT_RANK: Readonly<Record<AgentDeliveryReceipt['state'], number>> = {
  accepted: 0,
  'blocked-retryable': 1,
  dispatching: 1,
  started: 2,
  settled: 3,
  'outcome-unknown': 3,
  failed: 4,
  expired: 4,
  'interrupted-undelivered': 4,
  cancelled: 4,
};

const PARENT_RANK: Readonly<Record<ParentDeliveryState, number>> = {
  pending: 0,
  'blocked-retryable': 1,
  sending: 2,
  'outcome-unknown': 3,
  'not-saved': 3,
  delivered: 4,
  cancelled: 4,
};

const ACK_RANK: Readonly<Record<AgentMessageAckState, number>> = {
  unavailable: 0,
  pending: 0,
  read: 1,
  acted: 2,
  rejected: 2,
};

/** Receipt states that show an age and so keep the shared clock running. */
const AGED_RECEIPT_STATES: ReadonlySet<AgentDeliveryReceipt['state']> = new Set([
  'accepted',
  'blocked-retryable',
  'outcome-unknown',
  'failed',
  'expired',
  'interrupted-undelivered',
]);
const AGED_PARENT_STATES: ReadonlySet<ParentDeliveryState> = new Set([
  'pending',
  'outcome-unknown',
  'not-saved',
]);
/** Cancel is offered for every state the lane has not started. */
const CANCELLABLE_RECEIPT_STATES: ReadonlySet<AgentDeliveryReceipt['state']> = new Set([
  'accepted',
  'blocked-retryable',
  'outcome-unknown',
  'failed',
  'expired',
  'interrupted-undelivered',
]);

const REASON_TEXT: Readonly<Partial<Record<string, string>>> = {
  agent_stopped: 'lane stopped',
  agent_expired: 'lane gone',
  'host-restarted': 'host restarted',
  'resume-failed': 'resume failed',
  'queue-full': 'lane queue full',
  subprocess_released: 'lane process released',
  session_changed: 'lane session changed',
  'lane-at-limit': 'lane at limit',
  account_refused: 'account refused',
  'delivery-refused': 'lane refused it',
  'delivery-failed': 'delivery failed',
  'body-too-large': 'message too large',
  'storage-unavailable': 'storage unavailable',
  'dispatch-interrupted': 'sending was interrupted',
};

const CANCEL: DeliveryAction = { kind: 'cancel', label: 'Cancel', confirmDuplicateRisk: false };
const RECOVER: DeliveryAction = { kind: 'recover', label: 'Recover text', confirmDuplicateRisk: false };
function retry(confirmDuplicateRisk: boolean, label: 'Retry' | 'Retry now' = 'Retry'): DeliveryAction {
  return { kind: 'retry', label, confirmDuplicateRisk };
}

/** Compact age: "just now", "4m", "3h", "2d". */
export function formatDeliveryAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Newer `updatedAt` wins; an older one never overwrites. At the same instant
 * the higher rank wins. A settled, delivered or cancelled item never changes
 * state again.
 */
function supersedes(
  incoming: { readonly at: number; readonly rank: number; readonly state: string },
  existing: { readonly at: number; readonly rank: number; readonly state: string; readonly final: boolean },
): boolean {
  if (existing.final && incoming.state !== existing.state) return false;
  if (incoming.at !== existing.at) return incoming.at > existing.at;
  return incoming.rank >= existing.rank;
}

function laneKeysOf(receipt: AgentDeliveryReceipt): readonly string[] {
  const actual = receipt.actualAgentId;
  return actual && actual !== receipt.agentId ? [actual, receipt.agentId] : [receipt.agentId];
}

function isLaneDeliveryId(id: string): id is ParentDeliveryView['deliveryId'] {
  return id.startsWith('lane-delivery:');
}

function parentKeyOf(item: ParentDeliveryItem): string {
  return item.deliveryId ?? `${item.agentId}:${item.kind}`;
}

/** Drop the oldest-updated entries past `cap`, final entries first. */
function capped<T>(map: Map<string, T>, cap: number, isFinal: (item: T) => boolean): Map<string, T> {
  if (map.size <= cap) return map;
  for (const pass of [true, false]) {
    for (const [key, item] of map) {
      if (map.size <= cap) return map;
      if (!pass || isFinal(item)) map.delete(key);
    }
  }
  return map;
}

type PreviewMap = ReadonlyMap<string, Readonly<Partial<Record<AgentMessageDelivery, AgentMessagePreview>>>>;

@Injectable({ providedIn: 'root' })
export class AgentDeliveryStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  private readonly monitor = inject(AgentMonitorStore);

  /** Receipts by message id; insertion order is update order. */
  private readonly _receipts = signal<ReadonlyMap<string, AgentDeliveryReceipt>>(new Map());
  /** Parent deliveries by delivery id; insertion order is update order. */
  private readonly _parentDeliveries = signal<ReadonlyMap<string, ParentDeliveryItem>>(new Map());
  private readonly _previews = signal<PreviewMap>(new Map());
  /** Text recovered from the backend body store, waiting for the lane composer. */
  private readonly _recovered = signal<ReadonlyMap<string, string>>(new Map());

  /** Receipts grouped by lane: the resolved lane after a cold resume, and the lane addressed. */
  readonly receipts = computed<ReadonlyMap<string, readonly AgentDeliveryReceipt[]>>(() => {
    const byLane = new Map<string, AgentDeliveryReceipt[]>();
    for (const receipt of this._receipts().values()) {
      for (const key of laneKeysOf(receipt)) {
        const list = byLane.get(key);
        if (list) list.push(receipt);
        else byLane.set(key, [receipt]);
      }
    }
    for (const list of byLane.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    return byLane;
  });

  /** Parent deliveries grouped by lane, oldest first. */
  readonly parentDelivery = computed<ReadonlyMap<string, readonly ParentDeliveryItem[]>>(() => {
    const byLane = new Map<string, ParentDeliveryItem[]>();
    for (const item of this._parentDeliveries().values()) {
      const list = byLane.get(item.agentId);
      if (list) list.push(item);
      else byLane.set(item.agentId, [item]);
    }
    for (const list of byLane.values()) list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    return byLane;
  });

  readonly recovered = this._recovered.asReadonly();

  private readonly hasAgedItems = computed(() => {
    for (const receipt of this._receipts().values()) {
      if (AGED_RECEIPT_STATES.has(receipt.state)) return true;
    }
    for (const item of this._parentDeliveries().values()) {
      if (AGED_PARENT_STATES.has(item.state)) return true;
    }
    return false;
  });

  /** One shared 30 s clock, held only while an item shows an age. */
  private readonly now = injectWallClock('coarse', () => this.hasAgedItems());

  receipt(agentId: string, messageId: string): AgentDeliveryReceipt | undefined {
    const receipt = this._receipts().get(messageId);
    return receipt && laneKeysOf(receipt).includes(agentId) ? receipt : undefined;
  }

  onMessageReceipt(receipt: AgentDeliveryReceipt): void {
    this._receipts.update((current) => {
      const existing = current.get(receipt.id);
      const merged = existing ? this.mergeReceipt(existing, receipt) : receipt;
      if (merged === existing) return current;
      const next = new Map(current);
      next.delete(receipt.id);
      next.set(receipt.id, merged);
      return capped(next, RECEIPTS_CAP, (item) => item.state === 'settled' || item.state === 'cancelled');
    });
  }

  onParentDelivery(payload: AgentMonitorParentDeliveryPayload): void {
    const { removed, ...item } = payload;
    const key = parentKeyOf(item);
    this._parentDeliveries.update((current) => {
      const existing = current.get(key);
      if (removed) {
        if (!existing) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      }
      if (existing && !supersedes(
        { at: item.updatedAt ?? item.createdAt ?? 0, rank: PARENT_RANK[item.state], state: item.state },
        { at: existing.updatedAt ?? existing.createdAt ?? 0, rank: PARENT_RANK[existing.state], state: existing.state,
          final: existing.state === 'delivered' || existing.state === 'cancelled' },
      )) return current;
      const next = new Map(current);
      next.delete(key);
      next.set(key, { ...item, preview: item.preview ?? existing?.preview });
      return capped(next, PARENT_DELIVERIES_CAP, (entry) => entry.state === 'delivered' || entry.state === 'cancelled');
    });
  }

  /** Read the backend's durable receipts and parent deliveries and merge them in. */
  async hydrate(parentSessionId?: string): Promise<void> {
    const params = parentSessionId ? { parentSessionId } : {};
    const [receipts, deliveries] = await Promise.allSettled([
      this.rpc.call('agent:listMessageReceipts', params),
      this.rpc.call('agent:listParentDeliveries', params),
    ]);
    if (receipts.status === 'fulfilled' && receipts.value.isSuccess()) {
      for (const raw of receipts.value.data.receipts) {
        const parsed = AgentDeliveryReceiptSchema.safeParse(raw);
        const agentId = parsed.success ? AgentId.safeParse(parsed.data.agentId) : null;
        if (parsed.success && agentId) this.onMessageReceipt({ ...parsed.data, agentId });
        else this.logger.warn('AgentDeliveryStore', 'Hydrated receipt refused');
      }
    } else {
      this.logger.warn('AgentDeliveryStore', 'Receipt hydration failed; keeping pushed state',
        receipts.status === 'fulfilled' ? receipts.value.error : String(receipts.reason));
    }
    if (deliveries.status === 'fulfilled' && deliveries.value.isSuccess()) {
      for (const raw of deliveries.value.data.deliveries) {
        const parsed = AgentMonitorParentDeliveryPayloadSchema.safeParse(raw);
        const agentId = parsed.success ? AgentId.safeParse(parsed.data.agentId) : null;
        if (parsed.success && agentId) this.onParentDelivery({ ...parsed.data, agentId });
        else this.logger.warn('AgentDeliveryStore', 'Hydrated parent delivery refused');
      }
    } else {
      this.logger.warn('AgentDeliveryStore', 'Parent delivery hydration failed; keeping pushed state',
        deliveries.status === 'fulfilled' ? deliveries.value.error : String(deliveries.reason));
    }
  }

  /** The newest parent delivery of `kind` for a lane. */
  latestParentDelivery(agentId: string, kind: 'completion' | 'report'): ParentDeliveryItem | undefined {
    const items = this.parentDelivery().get(agentId) ?? [];
    for (let index = items.length - 1; index >= 0; index--) {
      if (items[index].kind === kind) return items[index];
    }
    return undefined;
  }

  receiptStatus(receipt: AgentDeliveryReceipt): DeliveryStatus {
    const confirmRetry = receipt.everDispatched === true || receipt.state === 'outcome-unknown';
    const recoverable = receipt.hasRecoverableBody !== false;
    const cancel = CANCELLABLE_RECEIPT_STATES.has(receipt.state) ? [CANCEL] : [];
    const aged = (label: string, actions: readonly DeliveryAction[], attention = true) =>
      this.status(label, receipt.createdAt, actions, attention, receipt);
    const plain = (label: string, attention = false) => this.status(label, undefined, [], attention, receipt);
    switch (receipt.state) {
      case 'accepted':
        return aged('Queued', cancel, false);
      case 'blocked-retryable':
        if (receipt.reason === 'awaiting-resume') return aged('Held after restart', [retry(confirmRetry), ...cancel]);
        if (receipt.reason === 'lane-at-limit') {
          const resetAt = receipt.limit?.known ? receipt.limit.resetAt : undefined;
          return resetAt === undefined
            ? aged('Lane at limit', [retry(confirmRetry), ...cancel])
            : this.status('Waiting for limit reset', undefined, cancel, true, receipt, resetAt);
        }
        return this.status(`Retrying · attempt ${receipt.attemptCount ?? 1}`, undefined,
          [retry(confirmRetry, 'Retry now'), ...cancel], true, receipt);
      case 'dispatching':
        return plain('Sending to lane');
      case 'started':
        return plain('Delivered to lane');
      case 'settled':
        return plain(receipt.turnOutcome ? `Turn ended · ${receipt.turnOutcome}` : 'Turn ended');
      case 'outcome-unknown':
        return aged('Outcome unknown — may already have run; check the lane',
          [retry(true), ...(recoverable ? [RECOVER] : []), ...cancel]);
      case 'failed':
        return aged(`Not delivered: ${this.reasonText(receipt)}`,
          [retry(confirmRetry), ...(recoverable ? [RECOVER] : []), ...cancel]);
      case 'interrupted-undelivered':
        return aged('Interrupted — not sent',
          [retry(confirmRetry), ...(recoverable ? [RECOVER] : []), ...cancel]);
      case 'expired':
        return aged('Lane gone — not delivered',
          [...(recoverable ? [RECOVER] : []), ...(this.isResumable(receipt.agentId) ? [retry(confirmRetry)] : []), ...cancel]);
      case 'cancelled':
        return plain('Cancelled');
    }
  }

  /** Plain-text label for consumers that only show text. */
  receiptLabel(receipt: AgentDeliveryReceipt): string {
    return this.receiptStatus(receipt).text;
  }

  /** Exact user-facing label for a lane message acknowledgment state. */
  static ackLabel(
    input: Pick<AgentDeliveryReceipt, 'ackState' | 'ackNote'> | AgentMessageAckState | null | undefined,
    ackNote?: string,
  ): string | null {
    const state = typeof input === 'string' ? input : input?.ackState;
    const note = (typeof input === 'string' ? ackNote : input?.ackNote ?? ackNote)?.trim();
    switch (state) {
      case 'pending':
        return 'Awaiting lane ack';
      case 'read':
        return 'Read by lane';
      case 'acted':
        return 'Lane reports acted';
      case 'rejected':
        return note ? `Lane rejected: ${note}` : 'Lane rejected';
      case 'unavailable':
        return 'Ack unavailable (no MCP)';
      case undefined:
        return null;
    }
  }

  parentStatus(item: ParentDeliveryItem): DeliveryStatus {
    const actionable = item.deliveryId !== undefined;
    const confirmRetry = item.everDispatched === true || item.state === 'outcome-unknown';
    const since = item.createdAt ?? item.updatedAt;
    const actions = (list: readonly DeliveryAction[]) => (actionable ? list : []);
    switch (item.state) {
      case 'pending':
        return this.status('Waiting for parent', since, actions([CANCEL]), true);
      case 'sending':
        return this.status('Sending to parent', undefined, [], false);
      case 'delivered':
        return this.status('Accepted by parent session', undefined, [], false);
      case 'blocked-retryable':
        return this.status(
          item.nextRetryAt === undefined ? 'Parent did not accept' : `Parent did not accept · next try ${clockTime(item.nextRetryAt)}`,
          undefined, actions([retry(confirmRetry, 'Retry now'), CANCEL]), true);
      case 'outcome-unknown':
        return this.status('Parent delivery uncertain — may already be in the parent chat', since,
          actions([retry(true), CANCEL]), true);
      case 'cancelled':
        return this.status('Cancelled', undefined, [], false);
      case 'not-saved':
        return this.status('Completion not delivered — not saved', since, actions([retry(confirmRetry)]), true);
    }
  }

  composerState(agentId: string): {
    readonly queue?: AgentMessagePreview;
    readonly now?: AgentMessagePreview;
    readonly queueDisabledReason?: string;
    readonly nowDisabledReason?: string;
    readonly queueHint: string;
    readonly nowHint: string;
  } {
    const previews = this.monitor.agentsById().has(agentId) ? this._previews().get(agentId) : undefined;
    const queue = previews?.queue;
    const now = previews?.now;
    return {
      queue,
      now,
      queueDisabledReason: queue?.supported === false ? queue.reason ?? 'Unavailable' : undefined,
      nowDisabledReason: now?.supported === false ? now.reason ?? 'Unavailable' : undefined,
      queueHint: queue?.mode === 'start-turn' ? 'Start turn' : queue?.usesResume ? 'Resume session' : 'Queue next turn',
      nowHint: now?.lossDisclosure ? now.lossDisclosure.text : now?.usesResume ? 'Resume session now' : 'Send now',
    };
  }

  async previewMessage(agentId: string, delivery: AgentMessageDelivery): Promise<AgentMessagePreview> {
    const result = await this.rpc.call('agent:previewMessage', { agentId: AgentId.from(agentId), delivery });
    if (!result.isSuccess()) throw new Error(result.error ?? 'Message preview failed');
    const preview = result.data;
    const live = this.monitor.agentsById();
    this._previews.update((current) => {
      const next = new Map([...current].filter(([id]) => id === agentId || live.has(id)));
      next.set(agentId, { ...next.get(agentId), [delivery]: preview });
      return next;
    });
    return preview;
  }

  /** A fresh key for one composer submission; reuse it when that submission is retried. */
  newIdempotencyKey(): string {
    return crypto.randomUUID();
  }

  async sendMessage(
    agentId: string,
    text: string,
    delivery: AgentMessageDelivery = 'queue',
    allowPartialTurnLoss?: boolean,
    idempotencyKey: string = this.newIdempotencyKey(),
  ): Promise<AgentMessageOutcome> {
    const result = await this.rpc.call('agent:sendMessage', {
      agentId: AgentId.from(agentId), message: text, delivery, allowPartialTurnLoss, idempotencyKey,
    });
    if (!result.isSuccess()) throw new Error(result.error ?? 'Message send failed');
    if (result.data.receipt) this.onMessageReceipt(result.data.receipt);
    return result.data;
  }

  async retryMessage(agentId: string, messageId: string, confirmDuplicateRisk = false): Promise<AgentMessageOutcome> {
    const result = await this.rpc.call('agent:retryMessage', {
      agentId: AgentId.from(agentId), messageId, ...(confirmDuplicateRisk ? { confirmDuplicateRisk: true } : {}),
    });
    if (!result.isSuccess()) throw new Error(result.error ?? 'Message retry failed');
    if (result.data.receipt) this.onMessageReceipt(result.data.receipt);
    return result.data;
  }

  async cancelMessage(agentId: string, messageId: string): Promise<AgentDeliveryReceipt> {
    const result = await this.rpc.call('agent:cancelMessage', { agentId: AgentId.from(agentId), messageId });
    if (!result.isSuccess()) throw new Error(result.error ?? 'Message cancellation failed');
    this.onMessageReceipt(result.data);
    return result.data;
  }

  /** Read an undelivered message's text back from the backend body store. */
  async recoverQueuedText(agentId: string, messageId: string): Promise<string> {
    const result = await this.rpc.call('agent:getQueuedMessageBody', { agentId: AgentId.from(agentId), messageId });
    if (!result.isSuccess()) throw new Error(result.error ?? 'Message text is no longer available');
    return result.data.text;
  }

  /**
   * Run an action the status offered. A retry that may run the work twice is
   * refused unless the caller confirmed the duplicate risk.
   */
  async runReceiptAction(receipt: AgentDeliveryReceipt, kind: DeliveryActionKind, confirmDuplicateRisk = false): Promise<void> {
    const action = this.receiptStatus(receipt).actions.find((item) => item.kind === kind);
    if (!action) throw new Error(`${kind} is not available for this message`);
    if (action.confirmDuplicateRisk && !confirmDuplicateRisk) throw new Error('Confirm the duplicate risk before retrying');
    switch (kind) {
      case 'retry':
        await this.retryMessage(receipt.agentId, receipt.id, action.confirmDuplicateRisk);
        return;
      case 'cancel':
        await this.cancelMessage(receipt.agentId, receipt.id);
        return;
      case 'recover':
        await this.recoverIntoComposer(receipt.actualAgentId ?? receipt.agentId, receipt.agentId, receipt.id);
        return;
    }
  }

  async runParentAction(item: ParentDeliveryItem, kind: DeliveryActionKind, confirmDuplicateRisk = false): Promise<void> {
    const action = this.parentStatus(item).actions.find((entry) => entry.kind === kind);
    const deliveryId = item.deliveryId;
    if (!action || deliveryId === undefined || !isLaneDeliveryId(deliveryId)) {
      throw new Error(`${kind} is not available for this delivery`);
    }
    if (action.confirmDuplicateRisk && !confirmDuplicateRisk) throw new Error('Confirm the duplicate risk before retrying');
    if (kind === 'retry') await this.retryParentDelivery(deliveryId, action.confirmDuplicateRisk);
    else if (kind === 'cancel') await this.cancelParentDelivery(deliveryId);
  }

  /** Recover the text and hand it to a lane's composer (see `takeRecovered`). */
  async recoverIntoComposer(composerAgentId: string, agentId: string, messageId: string): Promise<void> {
    const text = await this.recoverQueuedText(agentId, messageId);
    this._recovered.update((current) => {
      const next = new Map(current);
      const prior = next.get(composerAgentId);
      next.set(composerAgentId, prior ? `${prior}\n${text}` : text);
      return next;
    });
  }

  /** Take recovered text for a lane's composer; returns null when none waits. */
  takeRecovered(agentId: string): string | null {
    const text = this._recovered().get(agentId);
    if (text === undefined) return null;
    this._recovered.update((current) => {
      const next = new Map(current);
      next.delete(agentId);
      return next;
    });
    return text;
  }

  async retryParentDelivery(deliveryId: ParentDeliveryView['deliveryId'], confirmDuplicateRisk = false): Promise<ParentDeliveryView> {
    const result = await this.rpc.call('agent:retryParentDelivery', {
      deliveryId, ...(confirmDuplicateRisk ? { confirmDuplicateRisk: true } : {}),
    });
    if (!result.isSuccess()) throw new Error(result.error ?? 'Parent delivery retry failed');
    this.applyParentView(result.data);
    return result.data;
  }

  async cancelParentDelivery(deliveryId: ParentDeliveryView['deliveryId']): Promise<ParentDeliveryView> {
    const result = await this.rpc.call('agent:cancelParentDelivery', { deliveryId });
    if (!result.isSuccess()) throw new Error(result.error ?? 'Parent delivery cancellation failed');
    this.applyParentView(result.data);
    return result.data;
  }

  private applyParentView(view: ParentDeliveryView): void {
    const agentId = AgentId.safeParse(view.agentId);
    if (agentId) this.onParentDelivery({ ...view, agentId });
  }

  private mergeReceipt(existing: AgentDeliveryReceipt, incoming: AgentDeliveryReceipt): AgentDeliveryReceipt {
    const stateWins = supersedes(
      { at: incoming.updatedAt, rank: RECEIPT_RANK[incoming.state], state: incoming.state },
      { at: existing.updatedAt, rank: RECEIPT_RANK[existing.state], state: existing.state,
        final: existing.state === 'settled' || existing.state === 'cancelled' },
    );
    const base = stateWins ? { ...incoming, preview: incoming.preview ?? existing.preview } : existing;
    const ackFrom = this.newerAck(existing, incoming);
    if (!stateWins && ackFrom === existing) return existing;
    return ackFrom === base
      ? base
      : { ...base, ackState: ackFrom.ackState, ackAt: ackFrom.ackAt, ackNote: ackFrom.ackNote };
  }

  /** Acknowledgment has its own monotonic rank, independent of transport. */
  private newerAck(existing: AgentDeliveryReceipt, incoming: AgentDeliveryReceipt): AgentDeliveryReceipt {
    if (!incoming.ackState) return existing;
    if (!existing.ackState) return incoming;
    const incomingRank = ACK_RANK[incoming.ackState];
    const existingRank = ACK_RANK[existing.ackState];
    if (incomingRank !== existingRank) return incomingRank > existingRank ? incoming : existing;
    return incomingRank === 0 && incoming.updatedAt > existing.updatedAt ? incoming : existing;
  }

  private status(
    label: string,
    since: number | undefined,
    actions: readonly DeliveryAction[],
    attention: boolean,
    receipt?: AgentDeliveryReceipt,
    resetAt?: number,
  ): DeliveryStatus {
    const resolved = receipt?.actualAgentId && receipt.actualAgentId !== receipt.agentId
      ? ` · resumed as ${this.laneName(receipt.actualAgentId)}` : '';
    const fullLabel = `${label}${resolved}`;
    const ackLabel = AgentDeliveryStore.ackLabel(receipt) ?? undefined;
    const ackFields = receipt?.ackState
      ? { ackState: receipt.ackState, ackLabel, ackAt: receipt.ackAt }
      : {};
    const settledFields = receipt?.state === 'settled'
      ? { transportLabel: `Delivered to lane${resolved}`, turnOutcomeLabel: fullLabel }
      : { transportLabel: fullLabel };
    const extra = receipt ? { ...settledFields, ...ackFields } : {};
    if (resetAt !== undefined) {
      const resetTime = clockTime(resetAt);
      return { label: fullLabel, resetAt, resetTime, text: `${fullLabel} · ${resetTime}`, attention, actions, ...extra };
    }
    if (since === undefined) return { label: fullLabel, text: fullLabel, attention, actions, ...extra };
    const age = formatDeliveryAge(this.now() - since);
    return { label: fullLabel, since, age, text: `${fullLabel} · ${age}`, attention, actions, ...extra };
  }

  private reasonText(receipt: AgentDeliveryReceipt): string {
    return (receipt.reason && REASON_TEXT[receipt.reason]) ?? receipt.lastError ?? receipt.reason ?? 'unknown reason';
  }

  private laneName(agentId: string): string {
    const agent = this.monitor.agentsById().get(agentId);
    return agent?.displayName ?? agent?.cli ?? 'another lane';
  }

  /** A gone lane can be retried only when the renderer knows a session to resume. */
  private isResumable(agentId: string): boolean {
    return !!this.monitor.agentsById().get(agentId)?.cliSessionId;
  }
}
