import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentId, type AgentDeliveryReceipt, type AgentMessageDelivery, type AgentMessagePreviewMode } from '@ptah-extension/shared';
import type { IStateStorage } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

const receiptSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().refine(AgentId.validate).transform(AgentId.from),
  state: z.enum(['accepted', 'started', 'settled', 'failed', 'expired', 'interrupted-undelivered']),
  mode: z.enum(['steer', 'queue-next-turn', 'interrupt-resume', 'start-turn', 'unsupported']),
  delivery: z.enum(['queue', 'now']),
  sender: z.enum(['user', 'parent']).optional(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  turnSeq: z.number().int().positive().optional(),
  cliSessionId: z.string().optional(),
  reason: z.string().optional(),
  partialTurnLost: z.boolean().optional(),
  turnOutcome: z.enum(['completed', 'failed', 'stopped']).optional(),
}).strict();

const KEY = 'ptah:agent-delivery-receipts:v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TERMINAL_PER_AGENT = 64;
const MAX_TERMINAL_GLOBAL = 256;
const terminal = new Set<AgentDeliveryReceipt['state']>(['settled', 'failed', 'expired', 'interrupted-undelivered']);

/** Storage port is host neutral; persisted values contain receipt metadata only. */
export interface AgentDeliveryReceiptPersistence {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

export interface AgentDeliveryReceiptEventSink {
  changed(receipt: AgentDeliveryReceipt): void;
}

export class AgentDeliveryReceiptStore {
  private readonly receipts = new Map<string, AgentDeliveryReceipt>();
  private readonly ready: Promise<void>;

  constructor(
    private readonly storage: AgentDeliveryReceiptPersistence,
    private readonly sink?: AgentDeliveryReceiptEventSink,
    private readonly clock: () => number = Date.now,
    private readonly logger?: Logger,
  ) {
    this.ready = this.restore().catch((error: unknown) => {
      // Degradation: corrupt or unavailable storage must not disable live messaging.
      this.logger?.error('[AgentDeliveryReceiptStore] Restore failed',
        error instanceof Error ? error : new Error('Receipt restore failed'));
      this.receipts.clear();
    });
  }

  static fromStateStorage(storage: IStateStorage, sink?: AgentDeliveryReceiptEventSink, logger?: Logger): AgentDeliveryReceiptStore {
    return new AgentDeliveryReceiptStore(storage, sink, Date.now, logger);
  }

  private async restore(): Promise<void> {
    const stored = this.storage.get<unknown>(KEY);
    if (!Array.isArray(stored)) return;
    let changed = false;
    let malformed = 0;
    let expired = 0;
    for (const entry of stored) {
      const parsed = receiptSchema.safeParse(entry);
      if (!parsed.success) { changed = true; malformed++; continue; }
      const receipt = parsed.data;
      if (this.clock() - receipt.createdAt >= TTL_MS) { changed = true; expired++; continue; }
      const restored: AgentDeliveryReceipt = terminal.has(receipt.state)
        ? receipt
        : { ...receipt, state: 'failed', reason: 'host-restarted', updatedAt: this.clock() };
      if (restored !== receipt) changed = true;
      this.receipts.set(receipt.id, restored);
    }
    if (malformed || expired) this.logger?.warn('[AgentDeliveryReceiptStore] Dropped stored receipts',
      { malformed, expired, restored: this.receipts.size });
    this.prune();
    if (changed) await this.persist();
  }

  async accept(agentId: AgentId, mode: AgentMessagePreviewMode, delivery: AgentMessageDelivery, cliSessionId?: string, sender: 'user' | 'parent' = 'parent', message?: string): Promise<AgentDeliveryReceipt> {
    await this.ready;
    const now = this.clock();
    const preview = message?.replace(/\s+/g, ' ').trim().slice(0, 160);
    const receipt: AgentDeliveryReceipt = { id: randomUUID(), agentId, mode, delivery, sender, preview, state: 'accepted', createdAt: now, updatedAt: now, cliSessionId };
    this.receipts.set(receipt.id, receipt);
    await this.persist();
    try { this.sink?.changed(receipt); } catch (error: unknown) {
      // Degradation: notification sinks cannot reverse an accepted message.
      this.logger?.error('[AgentDeliveryReceiptStore] Receipt sink failed',
        error instanceof Error ? error : new Error('Receipt sink failed'));
    }
    return receipt;
  }

  async transition(id: string, patch: Partial<Pick<AgentDeliveryReceipt, 'state' | 'mode' | 'turnSeq' | 'reason' | 'partialTurnLost' | 'turnOutcome' | 'cliSessionId'>>): Promise<AgentDeliveryReceipt | undefined> {
    await this.ready;
    const existing = this.receipts.get(id);
    if (!existing) return undefined;
    if (terminal.has(existing.state)) return existing;
    const next = { ...existing, ...patch, updatedAt: this.clock() };
    if (next.state === 'started' && next.turnSeq === undefined) throw new Error('A started receipt requires turnSeq.');
    if (existing.state === 'started' && next.state === 'started' && existing.turnSeq !== next.turnSeq)
      throw new Error('A started receipt cannot change turns.');
    if (next.state === 'settled' && (existing.state !== 'started' || existing.turnSeq !== next.turnSeq)) throw new Error('A receipt settles only its started turn.');
    this.receipts.set(id, next);
    this.prune();
    await this.persist();
    try { this.sink?.changed(next); } catch (error: unknown) {
      // Degradation: notification sinks cannot reverse a committed receipt transition.
      this.logger?.error('[AgentDeliveryReceiptStore] Receipt sink failed',
        error instanceof Error ? error : new Error('Receipt sink failed'));
    }
    return next;
  }

  async get(agentId: AgentId, id: string): Promise<AgentDeliveryReceipt> {
    await this.ready;
    const found = this.receipts.get(id);
    if (found && found.agentId === agentId && this.clock() - found.createdAt < TTL_MS) return found;
    const now = this.clock();
    return { id, agentId, state: 'expired', mode: 'unsupported', delivery: 'queue', createdAt: now, updatedAt: now, reason: 'receipt-expired' };
  }

  async getById(id: string): Promise<AgentDeliveryReceipt | undefined> {
    await this.ready;
    return this.receipts.get(id);
  }

  private prune(): void {
    const groups = new Map<AgentId, AgentDeliveryReceipt[]>();
    for (const [id, receipt] of this.receipts) {
      if (this.clock() - receipt.createdAt >= TTL_MS) { this.receipts.delete(id); continue; }
      if (!terminal.has(receipt.state)) continue;
      const group = groups.get(receipt.agentId) ?? [];
      group.push(receipt);
      groups.set(receipt.agentId, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => b.updatedAt - a.updatedAt);
      for (const receipt of group.slice(MAX_TERMINAL_PER_AGENT)) this.receipts.delete(receipt.id);
    }
    const terminals = [...this.receipts.values()].filter((receipt) => terminal.has(receipt.state))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const receipt of terminals.slice(MAX_TERMINAL_GLOBAL)) this.receipts.delete(receipt.id);
  }

  private async persist(): Promise<void> {
    try {
      await this.storage.update(KEY, [...this.receipts.values()].map(({ preview: _preview, ...receipt }) => receipt));
    } catch (error: unknown) {
      // Degradation: persistence is best effort; the in-memory delivery receipt remains authoritative.
      this.logger?.error('[AgentDeliveryReceiptStore] Persist failed',
        error instanceof Error ? error : new Error('Receipt persist failed'));
    }
  }
}
