import { AgentId } from '@ptah-extension/shared';
import type {
  AgentDeliveryReceipt,
  AgentMessageOutcome,
  AgentMessagePreview,
  AgentMessagePreviewRequest,
  AgentMessageRequest,
  AgentProcessInfo,
} from '@ptah-extension/shared';
import { AgentContinueError, type AgentProcessManager } from '../agent-process-manager.service';
import type { CliDetectionService } from '../cli-detection.service';
import { AgentInterruptedDeliveryError } from '../agent-message-router.service';
import { LaneAccountResumeError } from '../lane-resume-gate';
import { AgentDeliveryReceiptStore } from './agent-delivery-receipt-store.service';
import { resolveEffectiveLaneCapabilities } from './agent-effective-capabilities';
import { planAgentDelivery } from './agent-delivery-planner';
import { AgentLaneResumeService } from './agent-lane-resume.service';
import type { Logger } from '@ptah-extension/vscode-core';

interface QueueUpdate {
  readonly agentId: string;
  readonly failures?: readonly { messageId: string; reason: string }[];
}

/** One facade for preview, send, receipt lookup and accepted-message cancellation. */
export class AgentMessageCoordinator {
  private readonly queued = new Map<string, string[]>();
  private readonly started = new Map<string, string[]>();

  constructor(
    private readonly manager: Pick<AgentProcessManager, 'events' | 'findAgentInfo' | 'getMessageRoutableAgent' | 'sendToAgent' | 'getAgentMessageStatus'>,
    private readonly detection: Pick<CliDetectionService, 'getAdapter'>,
    private readonly receipts: AgentDeliveryReceiptStore,
    private readonly resume: Pick<AgentLaneResumeService, 'resume'>,
    private readonly logger?: Logger,
  ) {
    manager.events.on('agent:turn-started', (info: AgentProcessInfo & { messageId?: string }) => {
      void this.onTurnStarted(info).catch((error: unknown) => {
        // Degradation: receipt bookkeeping cannot reject into the host event emitter.
        this.logEventFailure(error);
      });
    });
    manager.events.on('agent:turn-settled', (info: AgentProcessInfo) => {
      void this.onTurnSettled(info).catch((error: unknown) => {
        // Degradation: receipt bookkeeping cannot reject into the host event emitter.
        this.logEventFailure(error);
      });
    });
    manager.events.on('agent:queue-updated', (update: QueueUpdate) => {
      void this.onQueueUpdated(update).catch((error: unknown) => {
        // Degradation: receipt bookkeeping cannot reject into the host event emitter.
        this.logEventFailure(error);
      });
    });
    manager.events.on('agent:expired', ({ agentId }: { agentId: string }) => {
      void this.onAgentExpired(agentId).catch((error: unknown) => {
        // Degradation: record expiry must not reject into the host event emitter.
        this.logEventFailure(error);
      });
    });
  }

  private logEventFailure(error: unknown): void {
    this.logger?.error('[AgentMessageCoordinator] Receipt event failed',
      error instanceof Error ? error : new Error('Receipt event failed'));
  }

  preview(request: AgentMessagePreviewRequest): AgentMessagePreview {
    const info = this.manager.findAgentInfo(request.agentId);
    const tracked = this.manager.getMessageRoutableAgent(request.agentId);
    const manifest = info?.potentialCapabilities ?? (info && this.detection.getAdapter(info.cli)?.capabilities());
    if (!manifest || !info) {
      const unavailable = { state: 'unsupported' as const, reason: 'not_found' };
      return planAgentDelivery({
        agentId: request.agentId, delivery: request.delivery ?? 'queue', info,
        hasLiveHandle: false,
        effectiveCapabilities: { agentId: request.agentId, resolvedAt: Date.now(), source: 'restored-record',
          messaging: { steer: unavailable, interrupt: unavailable, continuation: unavailable, resume: unavailable }, mcp: unavailable },
      });
    }
    const live = Boolean(tracked?.sdkHandle && !tracked.subprocessReleased && !tracked.restored);
    return planAgentDelivery({
      agentId: request.agentId, delivery: request.delivery ?? 'queue', info,
      hasLiveHandle: live,
      effectiveCapabilities: resolveEffectiveLaneCapabilities(info, manifest, tracked?.sdkHandle, !live),
    });
  }

  async send(request: AgentMessageRequest, sender: 'user' | 'parent' = 'parent'): Promise<AgentMessageOutcome> {
    if (!request.message.trim()) throw new Error('Message must not be empty.');
    const delivery = request.delivery === 'steer' ? 'now' : request.delivery ?? 'queue';
    const preview = this.preview({ agentId: request.agentId, delivery });
    if (request.delivery === 'steer' && preview.mode !== 'steer')
      return this.refuse(request.agentId, delivery, 'True steer is unavailable.', sender, request.message);
    if (!preview.supported) return this.refuse(request.agentId, delivery, preview.reason ?? 'Delivery is unavailable.', sender, request.message);
    if (preview.mode === 'interrupt-resume' && request.allowPartialTurnLoss !== true)
      return this.refuse(request.agentId, delivery, 'Confirm partial turn work loss before interrupting.', sender, request.message);
    const info = this.manager.findAgentInfo(request.agentId);
    const receipt = await this.receipts.accept(request.agentId, preview.mode, delivery, info?.cliSessionId, sender, request.message);
    try {
      if (preview.usesResume) {
        if (!info) throw new Error('Agent record disappeared before resume.');
        const spawned = await this.resume.resume(info, request.message);
        this.add(this.started, spawned.agentId, receipt.id);
        const spawnedInfo = this.manager.findAgentInfo(spawned.agentId);
        const started = await this.receipts.transition(receipt.id, { state: 'started', mode: 'start-turn', turnSeq: spawnedInfo?.turnSeq ?? 1 });
        const current = this.manager.findAgentInfo(spawned.agentId);
        if (current && current.status !== 'running') await this.onTurnSettled(current);
        return { mode: 'start-turn', messageId: receipt.id,
          receipt: await this.receipts.get(request.agentId, receipt.id) ?? started ?? receipt };
      }
      this.add(this.queued, request.agentId, receipt.id);
      const result = await this.manager.sendToAgent(request.agentId, request.message,
        request.delivery === 'steer' ? 'steer' : delivery, receipt.id, request.allowPartialTurnLoss === true);
      if (result.mode === 'unsupported') {
        this.remove(this.queued, request.agentId, receipt.id);
        const failed = await this.receipts.transition(receipt.id, { state: 'failed', mode: result.mode, reason: result.reasonCode ?? 'delivery-refused' });
        return { mode: 'unsupported', detail: 'Message delivery unavailable.', messageId: receipt.id, receipt: failed ?? receipt };
      }
      if (result.mode === 'queue-next-turn') {
        await this.receipts.transition(receipt.id, { mode: result.mode });
        return { mode: result.mode, messageId: receipt.id,
          receipt: await this.receipts.get(request.agentId, receipt.id) };
      }
      this.remove(this.queued, request.agentId, receipt.id);
      const current = this.manager.findAgentInfo(request.agentId);
      this.add(this.started, request.agentId, receipt.id);
      const started = await this.receipts.transition(receipt.id, { state: 'started', mode: result.mode, turnSeq: current?.turnSeq ?? info?.turnSeq ?? 1 });
      const latest = this.manager.findAgentInfo(request.agentId);
      if (latest && latest.status !== 'running') await this.onTurnSettled(latest);
      return { mode: result.mode, messageId: receipt.id,
        receipt: await this.receipts.get(request.agentId, receipt.id) ?? started ?? receipt };
    } catch (error: unknown) {
      this.remove(this.queued, request.agentId, receipt.id);
      const interrupted = error instanceof AgentInterruptedDeliveryError;
      const reason = interrupted ? 'interrupted-undelivered'
        : error instanceof LaneAccountResumeError ? 'account_refused'
        : error instanceof AgentContinueError ? error.code : 'delivery-failed';
      const failed = await this.receipts.transition(receipt.id, {
        state: interrupted ? 'interrupted-undelivered' : 'failed',
        partialTurnLost: interrupted,
        reason,
      });
      return { mode: 'unsupported', detail: failed?.reason, messageId: receipt.id, receipt: failed ?? receipt };
    }
  }

  getReceipt(agentId: AgentId, messageId: string): Promise<AgentDeliveryReceipt> {
    return this.receipts.get(agentId, messageId);
  }

  async cancel(agentId: AgentId, messageId: string): Promise<AgentDeliveryReceipt> {
    const receipt = await this.receipts.get(agentId, messageId);
    if (receipt.state !== 'accepted') throw new Error('Only accepted messages can be cancelled.');
    const tracked = this.manager.getMessageRoutableAgent(agentId);
    const index = tracked?.pendingMessages.findIndex((item) => item.messageId === messageId) ?? -1;
    if (index < 0) throw new Error('Message is no longer cancellable.');
    tracked?.pendingMessages.splice(index, 1);
    this.remove(this.queued, agentId, messageId);
    const cancelled = await this.receipts.transition(messageId, { state: 'failed', reason: 'cancelled-by-user' });
    if (!cancelled) throw new Error('Receipt disappeared during cancellation.');
    return cancelled;
  }

  private async refuse(agentId: AgentId, delivery: 'queue' | 'now', reason: string, sender: 'user' | 'parent', message: string): Promise<AgentMessageOutcome> {
    const receipt = await this.receipts.accept(agentId, 'unsupported', delivery, undefined, sender, message);
    const failed = await this.receipts.transition(receipt.id, { state: 'failed', reason });
    return { mode: 'unsupported', detail: reason, messageId: receipt.id, receipt: failed ?? receipt };
  }

  private add(map: Map<string, string[]>, agentId: string, id: string): void {
    const ids = map.get(agentId) ?? [];
    if (!ids.includes(id)) ids.push(id);
    map.set(agentId, ids);
  }

  private remove(map: Map<string, string[]>, agentId: string, id: string): void {
    const ids = map.get(agentId);
    if (!ids) return;
    const remaining = ids.filter((entry) => entry !== id);
    if (remaining.length) map.set(agentId, remaining);
    else map.delete(agentId);
  }

  private async onAgentExpired(agentId: string): Promise<void> {
    const pending = [...(this.queued.get(agentId) ?? []), ...(this.started.get(agentId) ?? [])];
    this.queued.delete(agentId);
    this.started.delete(agentId);
    for (const id of pending)
      await this.receipts.transition(id, { state: 'failed', reason: 'agent_expired' });
  }

  private async onTurnStarted(info: AgentProcessInfo & { messageId?: string }): Promise<void> {
    const id = info.messageId;
    if (!id || !info.turnSeq || !this.queued.get(info.agentId)?.includes(id)) return;
    this.remove(this.queued, info.agentId, id);
    this.add(this.started, info.agentId, id);
    await this.receipts.transition(id, { state: 'started', turnSeq: info.turnSeq });
  }

  private async onTurnSettled(info: AgentProcessInfo): Promise<void> {
    if (!info.turnSeq) return;
    for (const id of this.started.get(info.agentId) ?? []) {
      const current = await this.receipts.getById(id);
      if (current?.state !== 'started' || current.turnSeq !== info.turnSeq) continue;
      await this.receipts.transition(id, { state: 'settled', turnSeq: info.turnSeq,
        turnOutcome: info.status === 'completed' ? 'completed' : info.status === 'stopped' ? 'stopped' : 'failed' });
      this.remove(this.started, info.agentId, id);
    }
  }

  private async onQueueUpdated({ agentId, failures = [] }: QueueUpdate): Promise<void> {
    const failed = new Map(failures.map((entry) => [entry.messageId, entry.reason]));
    for (const id of [...(this.queued.get(agentId) ?? [])]) {
      const status = this.manager.getAgentMessageStatus(agentId, id);
      if (!failed.has(id) && status.status !== 'failed' && !(status.status === 'unknown' && this.manager.findAgentInfo(agentId)?.status === 'stopped')) continue;
      const parsedId = AgentId.safeParse(agentId);
      if (!parsedId) {
        this.logger?.warn('[AgentMessageCoordinator] Invalid queue agent id');
        this.remove(this.queued, agentId, id);
        continue;
      }
      const receipt = await this.receipts.get(parsedId, id);
      if (receipt.state !== 'accepted') continue;
      const candidate = failed.get(id) ?? (status.status === 'failed' ? status.reason : 'agent_stopped');
      const reason = ['agent_stopped', 'subprocess_released', 'session_changed', 'continuation_rejected'].includes(candidate)
        ? candidate : 'queue-undelivered';
      await this.receipts.transition(id, { state: 'failed', reason });
      this.remove(this.queued, agentId, id);
    }
  }
}
