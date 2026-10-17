import { Injectable, effect, inject } from '@angular/core';
import type { MessageHandler } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  BatchedUpdateService,
  MessageFinalizationService,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import type {
  FlatStreamEventUnion,
  SetupGenerationRunBinding,
} from '@ptah-extension/shared';
import { GenerationWorkflowStore } from './generation-workflow.store';

/** One routed bridge from generator pushes into the ordinary chat transcript. */
@Injectable({ providedIn: 'root' })
export class GenerationRunEventAdapter implements MessageHandler {
  private readonly workflow = inject(GenerationWorkflowStore);
  private readonly tabs = inject(TabManagerService);
  private readonly streaming = inject(StreamingHandlerService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly finalization = inject(MessageFinalizationService);
  private sequence = 0;
  private readonly ownedMessages = new Map<
    string,
    { messageId: string; runId: string }
  >();
  private activeRunId: string | null = null;
  private terminalRunId: string | null = null;
  private terminalPushRunId: string | null = null;
  readonly handledMessageTypes = [
    'setup-wizard:generation-stream',
    'setup-wizard:enhance-stream',
    'setup-wizard:generation-complete',
    'setup-wizard:error',
  ] as const;

  constructor() {
    effect(() => {
      const run = this.workflow.run();
      const binding = this.workflow.binding();
      const runId = run?.binding.runId ?? null;
      if (runId !== this.activeRunId) {
        this.activeRunId = runId;
        this.terminalRunId = null;
        this.terminalPushRunId = null;
      }
      if (binding && run && this.isTerminal(run.status))
        this.finish(run.binding, run.status);
    });
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (
      message.type === 'setup-wizard:generation-stream' ||
      message.type === 'setup-wizard:enhance-stream'
    ) {
      this.accept(message.payload);
    } else if (
      (message.type === 'setup-wizard:generation-complete' ||
        message.type === 'setup-wizard:error') &&
      this.matches(message.payload)
    ) {
      // A push prompts a committed-state reread; it never claims success.
      this.terminalPushRunId = this.workflow.run()?.binding.runId ?? null;
      void this.workflow.refresh();
    }
  }

  accept(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || !this.workflow.isBound())
      return false;
    const value = payload as Record<string, unknown>;
    const binding = value['tabBinding'];
    if (!this.matches(binding)) return false;
    const runId = (binding as SetupGenerationRunBinding).runId;
    if (runId !== this.activeRunId) {
      this.activeRunId = runId;
      this.terminalRunId = null;
      this.terminalPushRunId = null;
    }
    if (this.terminalRunId === runId || this.terminalPushRunId === runId)
      return false;
    const kind = value['kind'];
    if (
      ![
        'text',
        'tool_start',
        'tool_input',
        'tool_result',
        'thinking',
        'error',
        'status',
      ].includes(String(kind))
    )
      return false;

    const tabId = (binding as SetupGenerationRunBinding).tabId;
    const timestamp =
      typeof value['timestamp'] === 'number' &&
      Number.isFinite(value['timestamp'])
        ? value['timestamp']
        : Date.now();
    const content = this.safeText(value['content'], runId, value['sessionId']);
    const toolName = this.safeText(
      value['toolName'],
      runId,
      value['sessionId'],
    );
    const messageId = this.ensureMessage(tabId, runId, timestamp);
    const base = {
      id: `wizard-event-${++this.sequence}`,
      messageId,
      timestamp,
    };
    let event: FlatStreamEventUnion;
    if (kind === 'tool_start') {
      event = {
        ...base,
        eventType: 'tool_start',
        toolCallId: base.id,
        toolName: toolName || 'Tool',
        isTaskTool: false,
      };
    } else if (kind === 'tool_result') {
      event = {
        ...base,
        eventType: 'tool_result',
        toolCallId: base.id,
        output: content,
        isError: false,
      };
    } else {
      event = {
        ...base,
        eventType: 'text_delta',
        delta: kind === 'tool_input' ? `${toolName}: ${content}` : content,
        blockIndex: 0,
      };
    }
    // Construct a closed whitelist. Neither flatEvent nor SDK/run IDs cross it.
    this.streaming.processStreamEvent(event, tabId, undefined, {
      fanOut: false,
    });
    return true;
  }

  /** Verified lookup also closes a run when its terminal push was lost. */
  private finish(binding: SetupGenerationRunBinding, status: string): void {
    if (!this.matches(binding) || this.terminalRunId === binding.runId) return;
    this.terminalRunId = binding.runId;
    const owned = this.ownedMessages.get(binding.tabId);
    if (!owned || owned.runId !== binding.runId) return;
    this.batchedUpdate.flushSync(binding.tabId);
    const tab = this.tabs.findTabByIdAcrossWorkspaces(binding.tabId)?.tab;
    if (
      !tab ||
      tab.streamingState?.currentMessageId !== owned.messageId ||
      tab.status === 'streaming' ||
      tab.status === 'awaiting-background' ||
      tab.status === 'sleeping'
    )
      return;
    this.finalization.finalizeCurrentMessage(
      binding.tabId,
      status !== 'completed',
    );
    this.ownedMessages.delete(binding.tabId);
  }

  private ensureMessage(
    tabId: string,
    runId: string,
    timestamp: number,
  ): string {
    let owned = this.ownedMessages.get(tabId);
    if (!owned) {
      owned = { messageId: `wizard-message-${++this.sequence}`, runId };
      this.ownedMessages.set(tabId, owned);
      this.streaming.processStreamEvent(
        {
          id: `wizard-start-${this.sequence}`,
          eventType: 'message_start',
          messageId: owned.messageId,
          timestamp,
          role: 'assistant',
        },
        tabId,
        undefined,
        { fanOut: false },
      );
    }
    return owned.messageId;
  }

  private matches(payload: unknown): payload is SetupGenerationRunBinding {
    if (!payload || typeof payload !== 'object') return false;
    const value = payload as Record<string, unknown>;
    const candidate = value['tabBinding'] ?? payload;
    if (!candidate || typeof candidate !== 'object') return false;
    const binding = candidate as Record<string, unknown>;
    const current = this.workflow.binding();
    const runId = this.workflow.run()?.binding.runId;
    return (
      !!current &&
      !!runId &&
      binding['tabId'] === current.tabId &&
      binding['workspacePath'] === current.workspacePath &&
      binding['workflow'] === current.workflow &&
      binding['runId'] === runId
    );
  }

  private isTerminal(status: string): boolean {
    return ['completed', 'cancelled', 'failed', 'timed-out'].includes(status);
  }

  private safeText(value: unknown, runId: string, sessionId: unknown): string {
    if (typeof value !== 'string') return '';
    const source = this.workflow.run()?.source;
    const redacted =
      source?.kind === 'verified-analysis' && source.analysisDir
        ? value.replaceAll(source.analysisDir, '[analysis source]')
        : value;
    const withoutIds = [runId, typeof sessionId === 'string' ? sessionId : '']
      .filter(Boolean)
      .reduce((text, id) => text.replaceAll(id, '[generation id]'), redacted);
    return withoutIds
      .replace(/<[^>]*>/g, '')
      .replace(/\p{Cc}/gu, ' ')
      .slice(0, 4000);
  }
}
