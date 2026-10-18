import { Injectable, effect, inject } from '@angular/core';
import type { MessageHandler } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  BatchedUpdateService,
  MessageFinalizationService,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import type {
  ExecutionNode,
  FlatStreamEventUnion,
  SetupGenerationRunBinding,
} from '@ptah-extension/shared';
import { GenerationWorkflowStore } from './generation-workflow.store';
import { WizardRpcService } from './wizard-rpc.service';

/** One routed bridge from generator pushes into the ordinary chat transcript. */
@Injectable({ providedIn: 'root' })
export class GenerationRunEventAdapter implements MessageHandler {
  private readonly workflow = inject(GenerationWorkflowStore);
  private readonly tabs = inject(TabManagerService);
  private readonly streaming = inject(StreamingHandlerService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly finalization = inject(MessageFinalizationService);
  private readonly rpc = inject(WizardRpcService);
  private sequence = 0;
  private readonly ownedMessages = new Map<
    string,
    { messageId: string; runId: string }
  >();
  private activeRunId: string | null = null;
  private terminalRunId: string | null = null;
  private terminalPushRunId: string | null = null;
  private readonly pendingEvents = new Map<string, unknown[]>();
  private readonly finalized = new Map<
    string,
    { runId: string; messageId: string; status: string }
  >();
  readonly handledMessageTypes = [
    'setup-wizard:generation-stream',
    'setup-wizard:enhance-stream',
    'setup-wizard:generation-complete',
    'setup-wizard:error',
  ] as const;

  constructor() {
    effect(() => {
      this.tabs.tabs();
      const run = this.workflow.run();
      const binding = this.workflow.binding();
      const runId = run?.binding.runId ?? null;
      if (runId !== this.activeRunId) {
        this.activeRunId = runId;
        this.terminalRunId = null;
        this.terminalPushRunId = null;
      }
      if (
        binding &&
        run &&
        !this.isTerminal(run.status) &&
        (this.terminalRunId === runId || this.terminalPushRunId === runId)
      ) {
        this.terminalRunId = null;
        this.terminalPushRunId = null;
        this.ownedMessages.delete(binding.tabId);
      }
      if (binding && run && this.isTerminal(run.status))
        this.finish(run.binding, run.status);
      if (binding && run) {
        const queued = this.pendingEvents.get(binding.tabId) ?? [];
        this.pendingEvents.delete(binding.tabId);
        for (const payload of queued) this.accept(payload);
      }
      if (!binding) this.pendingEvents.clear();
      for (const [tabId] of this.ownedMessages) {
        if (!this.tabs.findTabByIdAcrossWorkspaces(tabId))
          this.ownedMessages.delete(tabId);
      }
      for (const [tabId] of this.pendingEvents) {
        if (!this.tabs.findTabByIdAcrossWorkspaces(tabId))
          this.pendingEvents.delete(tabId);
      }
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
      this.isOwnedTerminalPush(message.payload)
    ) {
      const value = message.payload as {
        tabBinding: SetupGenerationRunBinding;
      };
      const pushed = value.tabBinding;
      if (this.matches(pushed)) {
        this.terminalPushRunId = pushed.runId;
        void this.workflow.refresh();
      } else {
        void this.rpc
          .getBoundRunState(pushed, pushed.runId)
          .then((run) => {
            if (
              run?.binding.runId === pushed.runId &&
              run.binding.tabId === pushed.tabId &&
              run.binding.workspacePath === pushed.workspacePath &&
              run.binding.workflow === pushed.workflow &&
              this.isTerminal(run.status)
            )
              this.finish(pushed, run.status);
          })
          .catch(() => {
            // degradation-audit: reported - a background lookup failure cannot establish a terminal run.
          });
      }
    }
  }

  accept(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const value = payload as Record<string, unknown>;
    const binding = value['tabBinding'];
    if (!this.workflow.run() && this.isCurrentTab(binding)) {
      const tabId = (binding as SetupGenerationRunBinding).tabId;
      const queued = this.pendingEvents.get(tabId) ?? [];
      if (queued.length >= 99) {
        queued.splice(0, queued.length - 98);
        queued.push({
          tabBinding: binding,
          kind: 'status',
          content: 'Earlier generation activity was omitted.',
        });
      }
      queued.push(payload);
      this.pendingEvents.set(tabId, queued);
      return true;
    }
    if (!this.workflow.isBound()) return false;
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
    if (this.terminalRunId === binding.runId) {
      if (status === 'completed') this.correctFinalizedMessage(binding);
      return;
    }
    this.terminalRunId = binding.runId;
    const owned = this.ownedMessages.get(binding.tabId);
    if (!owned || owned.runId !== binding.runId) return;
    this.ownedMessages.delete(binding.tabId);
    this.batchedUpdate.flushSync(binding.tabId);
    const located = this.tabs.findTabByIdAcrossWorkspaces(binding.tabId);
    const tab =
      located?.workspacePath === binding.workspacePath ? located.tab : null;
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
    this.finalized.set(binding.tabId, {
      runId: binding.runId,
      messageId: owned.messageId,
      status,
    });
  }

  private correctFinalizedMessage(binding: SetupGenerationRunBinding): void {
    const prior = this.finalized.get(binding.tabId);
    if (!prior || prior.runId !== binding.runId || prior.status === 'completed')
      return;
    const located = this.tabs.findTabByIdAcrossWorkspaces(binding.tabId);
    if (located?.workspacePath !== binding.workspacePath) return;
    const messages = located.tab.messages;
    if (!messages.some((message) => message.id === prior.messageId)) return;
    const complete = (node: ExecutionNode): ExecutionNode => ({
      ...node,
      status: node.status === 'interrupted' ? 'complete' : node.status,
      children: node.children.map(complete),
    });
    this.tabs.setMessages(
      binding.tabId,
      messages.map((message) =>
        message.id === prior.messageId && message.streamingState
          ? { ...message, streamingState: complete(message.streamingState) }
          : message,
      ),
    );
    this.finalized.set(binding.tabId, { ...prior, status: 'completed' });
  }

  private ensureMessage(
    tabId: string,
    runId: string,
    timestamp: number,
  ): string {
    let owned = this.ownedMessages.get(tabId);
    if (owned?.runId !== runId) {
      const current = this.tabs.findTabByIdAcrossWorkspaces(tabId)?.tab;
      if (
        owned &&
        current?.streamingState?.currentMessageId === owned.messageId
      )
        this.finalization.finalizeCurrentMessage(tabId, true);
      this.ownedMessages.delete(tabId);
      owned = undefined;
    }
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

  private matches(payload: unknown): boolean {
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

  private isCurrentTab(payload: unknown): payload is SetupGenerationRunBinding {
    if (!payload || typeof payload !== 'object') return false;
    const candidate = payload as Partial<SetupGenerationRunBinding>;
    const current = this.workflow.binding();
    return (
      !!current &&
      typeof candidate.runId === 'string' &&
      candidate.tabId === current.tabId &&
      candidate.workspacePath === current.workspacePath &&
      candidate.workflow === current.workflow
    );
  }

  private isOwnedTerminalPush(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const candidate = (payload as { tabBinding?: unknown }).tabBinding;
    if (!candidate || typeof candidate !== 'object') return false;
    const binding = candidate as Partial<SetupGenerationRunBinding>;
    const owned = binding.tabId ? this.ownedMessages.get(binding.tabId) : null;
    const located = binding.tabId
      ? this.tabs.findTabByIdAcrossWorkspaces(binding.tabId)
      : null;
    return (
      this.matches(candidate) ||
      (!!owned &&
        owned.runId === binding.runId &&
        located?.workspacePath === binding.workspacePath &&
        located?.tab.workflow === binding.workflow)
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
