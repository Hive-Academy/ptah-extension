import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, SessionActivityRegistry } from '@ptah-extension/agent-sdk';
import { SessionId, type IAgentAdapter } from '@ptah-extension/shared';
import { CLI_AGENT_RUNTIME_TOKENS } from '../../di/tokens';
import {
  ParentEnvelopeStoreService, type ParentDeliveryEnvelope,
} from './parent-envelope-store.service';

export interface ParentDeliveryEventSink {
  emit(envelope: ParentDeliveryEnvelope): void;
}

@injectable()
export class ParentDeliveryDrainerService {
  private readonly draining = new Map<string, Promise<void>>();
  private readonly accepted = new Map<string, () => void>();
  private readonly unregisterActivity?: () => void;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(ParentEnvelopeStoreService) private readonly store: ParentEnvelopeStoreService,
    @inject(TOKENS.AGENT_ADAPTER, { isOptional: true }) private readonly adapter: IAgentAdapter | null,
    @inject(SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY, { isOptional: true })
    activity: SessionActivityRegistry | null,
    @inject(CLI_AGENT_RUNTIME_TOKENS.PARENT_DELIVERY_EVENT_SINK, { isOptional: true })
    private readonly sink: ParentDeliveryEventSink | null,
  ) {
    this.unregisterActivity = activity?.register(({ sessionId }) => { void this.drain(sessionId); });
  }

  dispose(): void {
    this.unregisterActivity?.();
  }

  find(dedupeKey: string): ParentDeliveryEnvelope | undefined {
    return this.store.find(dedupeKey);
  }

  enqueue(
    envelope: Omit<ParentDeliveryEnvelope, 'state' | 'attempts'>,
    onAccepted?: () => void,
  ): ParentDeliveryEnvelope | null {
    const saved = this.store.enqueue(envelope);
    if (!saved) return null;
    for (const key of this.accepted.keys()) {
      if (this.store.find(key)?.state !== 'pending') this.accepted.delete(key);
    }
    if (onAccepted && saved.state === 'pending') this.accepted.set(saved.dedupeKey, onAccepted);
    if (saved.state === 'pending') this.sink?.emit(saved);
    void this.drain(saved.parentSessionId);
    return saved;
  }

  drain(parentSessionId: string): Promise<void> {
    const existing = this.draining.get(parentSessionId);
    if (existing) return existing;
    const task = Promise.resolve().then(() => this.drainOnce(parentSessionId)).finally(() => {
      this.draining.delete(parentSessionId);
    });
    this.draining.set(parentSessionId, task);
    return task;
  }

  resolveParentSessionId(tabId: string, sessionId: string): Promise<void> {
    this.store.resolveParentSessionId(tabId, sessionId);
    return this.drain(sessionId);
  }

  private async drainOnce(parentSessionId: string): Promise<void> {
    const id = SessionId.safeParse(parentSessionId);
    if (!id || !this.adapter?.isSessionActive(id)) return;
    for (const envelope of this.store.pending(parentSessionId)) {
      try {
        await this.adapter.sendMessageToSession(id, envelope.body, {
          clientMessageId: envelope.id,
          origin: {
            kind: 'peer', from: `ptah-agent:${envelope.agentId}`,
            name: envelope.originName,
          },
        });
        this.store.markDelivered(envelope.dedupeKey);
        this.accepted.get(envelope.dedupeKey)?.();
        this.accepted.delete(envelope.dedupeKey);
        const delivered = this.store.find(envelope.dedupeKey);
        if (delivered) this.sink?.emit(delivered);
      } catch (error: unknown) {
        this.store.markFailed(envelope.dedupeKey,
          error instanceof Error ? error.message : String(error));
        this.logger.warn('[ParentDeliveryDrainer] Parent send failed', {
          parentSessionId, kind: envelope.kind,
        });
        break;
      }
    }
  }
}
