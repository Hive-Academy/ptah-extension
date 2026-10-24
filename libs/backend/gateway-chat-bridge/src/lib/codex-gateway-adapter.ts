import {
  CodexParityGate,
  type ApprovalSink,
  type CodexContext,
  type CodexParityPlatform,
  type CodexReportedUsage,
  type CodexRuntimeEvent,
  type CodexTurnInput,
} from '@ptah-extension/codex-runtime';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

/**
 * Presentation only. Composition opens/resumes the exact context through
 * resolveGatedCodexRuntime and supplies the same sink registered with that runtime.
 * No SDK fallback, protocol parsing, identity storage or process ownership here.
 */
export class CodexGatewayAdapter {
  private readonly gate = new CodexParityGate();

  constructor(
    private readonly context: CodexContext,
    private readonly sink: ApprovalSink,
    private readonly logger: Pick<Logger, 'warn'>,
    private readonly platform: CodexParityPlatform,
  ) {}

  startTurn(input: CodexTurnInput): AsyncIterable<FlatStreamEventUnion> {
    return this.stream(input);
  }

  /** Editing an approval means declining it first, then steering ordinary text. */
  steer(input: CodexTurnInput): ReturnType<CodexContext['steer']> {
    this.assertReady();
    return this.context.steer(input);
  }

  interrupt(turnId: string): Promise<boolean> {
    return this.context.interrupt(turnId);
  }

  close(): Promise<void> {
    return this.context.close();
  }

  private assertReady(): void {
    if (!this.sink || typeof this.sink.request !== 'function') {
      throw new Error('Codex gateway approval sink is required');
    }
    if (!this.gate.isEnabled('gateway', this.platform)) {
      throw new Error('Codex gateway routing disabled by parity gate');
    }
  }

  private async *stream(
    input: CodexTurnInput,
  ): AsyncIterable<FlatStreamEventUnion> {
    this.assertReady();
    if (input.signal?.aborted) throw new Error('Codex gateway turn cancelled');
    const subscription = new AbortController();
    const abort = () => subscription.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    const identity = this.context.identity;
    const projection = new GatewayEventProjection();
    // Core registers synchronously, so even events before the receipt are retained.
    let terminal = false;
    try {
      const events = this.context.events(subscription.signal);
      const receipt = await this.context.startTurn(input);
      for await (const event of events) {
        if (subscription.signal.aborted) break;
        if (
          event.contextId !== identity.contextId ||
          event.processGeneration !== identity.processGeneration ||
          event.threadId !== receipt.threadId ||
          event.turnId !== receipt.turnId
        )
          continue;
        if (event.type === 'terminal') terminal = true;
        for (const projected of projection.project(event)) yield projected;
        if (terminal) return;
      }
      throw new Error(
        subscription.signal.aborted
          ? 'Codex gateway turn cancelled'
          : 'Codex gateway stream ended without terminal result',
      );
    } finally {
      subscription.abort();
      input.signal?.removeEventListener('abort', abort);
      if (!terminal) {
        // End abandoned work, including early consumer return and failed start.
        try {
          await this.context.close();
        } catch {
          this.logger.warn('[codex-gateway] context cleanup failed');
        }
      }
    }
  }
}

/** Per-turn state; no timers, persisted copies or invented usage counters. */
class GatewayEventProjection {
  private readonly text = new Map<string, string>();
  private readonly reasoning = new Map<string, string>();
  private usage: CodexReportedUsage | undefined;

  *project(event: CodexRuntimeEvent): Iterable<FlatStreamEventUnion> {
    const base = {
      id: JSON.stringify([
        event.contextId,
        event.processGeneration,
        event.sequence,
      ]),
      messageId: JSON.stringify([event.threadId, event.turnId]),
      sessionId: event.threadId,
      timestamp: Date.now(),
      source: 'stream' as const,
    };
    switch (event.type) {
      case 'textDelta':
        this.text.set(
          event.itemId,
          (this.text.get(event.itemId) ?? '') + event.delta,
        );
        yield {
          ...base,
          eventType: 'text_delta',
          delta: event.delta,
          blockIndex: 0,
        };
        break;
      case 'textFinal': {
        const previous = this.text.get(event.itemId) ?? '';
        const delta = event.text.startsWith(previous)
          ? event.text.slice(previous.length)
          : '';
        this.text.set(event.itemId, event.text);
        if (delta)
          yield { ...base, eventType: 'text_delta', delta, blockIndex: 0 };
        break;
      }
      case 'reasoning': {
        const previous = this.reasoning.get(event.itemId) ?? '';
        const delta =
          event.phase === 'delta'
            ? event.text
            : event.text.startsWith(previous)
              ? event.text.slice(previous.length)
              : '';
        this.reasoning.set(
          event.itemId,
          event.phase === 'delta' ? previous + delta : event.text,
        );
        if (delta)
          yield { ...base, eventType: 'thinking_delta', delta, blockIndex: 0 };
        break;
      }
      case 'toolStarted':
        yield {
          ...base,
          eventType: 'tool_start',
          toolCallId: event.toolId,
          toolName: event.toolName,
          isTaskTool: false,
          toolInput:
            typeof event.input === 'object' &&
            event.input !== null &&
            !Array.isArray(event.input)
              ? Object.fromEntries(Object.entries(event.input))
              : undefined,
        };
        break;
      case 'toolCompleted':
        yield {
          ...base,
          eventType: 'tool_result',
          toolCallId: event.toolId,
          output: event.output,
          isError: event.status !== 'completed',
        };
        break;
      case 'usage':
        this.usage = event.usage;
        if (
          event.usage.inputTokens !== undefined &&
          event.usage.outputTokens !== undefined
        )
          yield {
            ...base,
            eventType: 'message_delta',
            tokenUsage: {
              input: event.usage.inputTokens,
              output: event.usage.outputTokens,
            },
          };
        break;
      case 'error':
        throw new Error(event.error.message);
      case 'terminal': {
        if (event.status === 'failed')
          throw new Error(event.error?.message ?? 'Codex gateway turn failed');
        const usage = event.usage ?? this.usage;
        yield {
          ...base,
          eventType: 'message_complete',
          stopReason: event.status,
          cost: usage?.costUsd,
          tokenUsage:
            usage?.inputTokens !== undefined && usage.outputTokens !== undefined
              ? { input: usage.inputTokens, output: usage.outputTokens }
              : undefined,
        };
        break;
      }
      // Gateway pump consumes text only. Do not fabricate text, token measurements,
      // approval responses or attachments for events without a flat counterpart.
      case 'file':
      case 'image':
      case 'compaction':
      case 'approvalRequested':
      case 'approvalSettled':
        break;
    }
  }
}
