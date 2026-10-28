import type {
  CodexReportedUsage,
  CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { presentCodexTool, presentCodexToolResult } from './codex-tool-presentation';

/** Convert a whole-turn OpenAI snapshot into Ptah's disjoint token buckets. */
export function tokenUsage(usage: CodexReportedUsage) {
  return {
    input: Math.max(
      0,
      (usage.inputTokens ?? 0) - (usage.cachedInputTokens ?? 0),
    ),
    output: usage.outputTokens ?? 0,
    cacheRead: usage.cachedInputTokens,
    cacheCreation: usage.cacheWriteInputTokens,
  };
}

export type CodexChatTurnIdentity = Pick<
  CodexRuntimeEvent,
  'contextId' | 'processGeneration' | 'threadId' | 'turnId'
>;
export interface CodexChatResult {
  readonly status: 'completed' | 'interrupted' | 'failed';
  readonly text: string;
  readonly usage?: CodexReportedUsage;
  readonly error?: string;
}
export interface CodexChatEventCallbacks {
  result(result: CodexChatResult): void | Promise<void>;
  /** Complete content replaces the item; it is never presented as a delta. */
  content(item: {
    itemId: string;
    text: string;
    kind: 'text' | 'reasoning';
    blockIndex: number;
  }): void | Promise<void>;
  live(
    event: Extract<
      CodexRuntimeEvent,
      { type: 'file' | 'image' | 'approvalRequested' | 'approvalSettled' }
    >,
  ): void;
  compaction(phase: 'started' | 'completed' | 'failed'): void;
  error(message: string): void;
}

/** One projection per turn. Core events are already normalized. */
export class CodexChatEvents {
  private pending: Promise<void> = Promise.resolve();

  async settled(): Promise<void> {
    await this.pending;
  }

  private track(work: void | Promise<void>): void {
    this.pending = Promise.all([this.pending, work]).then(() => undefined);
  }

  private started = false;
  private sequence = -1;
  private terminal = false;
  private errorEmitted = false;
  private usage?: CodexReportedUsage;
  private readonly text = new Map<string, string>();
  private readonly blocks = new Map<string, number>();
  /** Raw native tool names by tool id, from toolStarted to toolCompleted. */
  private readonly tools = new Map<string, string>();

  constructor(
    private readonly sessionId: string,
    private readonly identity: CodexChatTurnIdentity,
    private readonly callbacks: CodexChatEventCallbacks,
    private readonly now: () => number = Date.now,
  ) {}

  map(event: CodexRuntimeEvent): FlatStreamEventUnion[] {
    if (
      this.terminal ||
      event.sequence <= this.sequence ||
      event.contextId !== this.identity.contextId ||
      event.processGeneration !== this.identity.processGeneration ||
      event.threadId !== this.identity.threadId ||
      event.turnId !== this.identity.turnId
    )
      return [];
    this.sequence = event.sequence;
    const base = {
      id: JSON.stringify([
        event.contextId,
        event.processGeneration,
        event.threadId,
        event.turnId,
        event.sequence,
      ]),
      messageId: JSON.stringify([event.threadId, event.turnId]),
      sessionId: this.sessionId,
      timestamp: this.now(),
      source: 'stream' as const,
    };
    const projected = this.project(event, base);
    if (this.started) return projected;
    this.started = true;
    return [
      {
        ...base,
        id: `${base.messageId}:start`,
        eventType: 'message_start',
        role: 'assistant',
      },
      ...projected,
    ];
  }

  private project(
    event: CodexRuntimeEvent,
    base: {
      id: string;
      messageId: string;
      sessionId: string;
      timestamp: number;
      source: 'stream';
    },
  ): FlatStreamEventUnion[] {
    switch (event.type) {
      case 'textDelta':
        this.text.set(
          event.itemId,
          (this.text.get(event.itemId) ?? '') + event.delta,
        );
        return [
          {
            ...base,
            eventType: 'text_delta',
            delta: event.delta,
            blockIndex: this.block('text', event.itemId),
          },
        ];
      case 'textFinal': {
        const previous = this.text.get(event.itemId) ?? '';
        this.text.set(event.itemId, event.text);
        if (event.text && !event.text.startsWith(previous)) {
          this.track(
            this.callbacks.content({
              itemId: event.itemId,
              text: event.text,
              kind: 'text',
              blockIndex: this.block('text', event.itemId),
            }),
          );
        }
        const delta = event.text.startsWith(previous)
          ? event.text.slice(previous.length)
          : '';
        return delta
          ? [
              {
                ...base,
                eventType: 'text_delta',
                delta,
                blockIndex: this.block('text', event.itemId),
              },
            ]
          : [];
      }
      case 'reasoning': {
        const blockIndex = this.block('reasoning', event.itemId);
        if (event.phase === 'final') {
          // Replace-on-final: the callbacks publish the whole final text as
          // one complete-source thinking_delta, which replaces the streamed
          // deltas for this block (accumulator-core.service.ts:359-367 sets,
          // never appends). An empty reasoning item opens no thinking block.
          if (event.text === '') return [];
          this.track(
            this.callbacks.content({
              itemId: event.itemId,
              text: event.text,
              kind: 'reasoning',
              blockIndex,
            }),
          );
          return [];
        }
        // The runtime contract guarantees a non-empty delta per event.
        return [
          {
            ...base,
            eventType: 'thinking_delta',
            delta: event.text,
            blockIndex,
          },
        ];
      }
      case 'toolStarted':
        this.tools.set(event.toolId, event.toolName);
        return [
          {
            ...base,
            eventType: 'tool_start',
            toolCallId: event.toolId,
            isTaskTool: false,
            ...presentCodexTool(
              event.toolName,
              typeof event.input === 'object' &&
              event.input !== null &&
              !Array.isArray(event.input)
                ? Object.fromEntries(Object.entries(event.input))
                : undefined,
            ),
          },
        ];
      case 'toolCompleted': {
        // The result is shaped like Claude's tool_result for the tool that
        // started (the runtime completion carries no name).
        const toolName = this.tools.get(event.toolId);
        this.tools.delete(event.toolId);
        return [
          {
            ...base,
            eventType: 'tool_result',
            toolCallId: event.toolId,
            ...presentCodexToolResult({
              toolName,
              status: event.status,
              output: event.output,
              ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
              ...(event.errorText === undefined ? {} : { errorText: event.errorText }),
            }),
          },
        ];
      }
      case 'usage':
        this.usage = event.usage;
        return event.usage.inputTokens !== undefined &&
          event.usage.outputTokens !== undefined
          ? [
              {
                ...base,
                eventType: 'message_delta',
                tokenUsage: tokenUsage(event.usage),
              },
            ]
          : [];
      case 'compaction':
        this.callbacks.compaction(event.phase);
        return [];
      case 'file':
      case 'image':
      case 'approvalRequested':
      case 'approvalSettled':
        this.callbacks.live(event);
        return [];
      case 'error':
        this.error();
        return [];
      case 'terminal': {
        this.terminal = true;
        const failed = event.status === 'failed' || event.error !== undefined;
        if (failed) this.error();
        const usage = event.usage ?? this.usage;
        const result: CodexChatResult = {
          status: event.status,
          text: [...this.text.values()].join(''),
          ...(usage === undefined ? {} : { usage }),
          ...(failed ? { error: 'Codex reported a runtime error.' } : {}),
        };
        this.text.clear();
        this.blocks.clear();
        this.tools.clear();
        this.usage = undefined;
        this.track(this.callbacks.result(result));
        // Message usage is the SDK stream contract; result stats are a separate channel.
        return [
          {
            ...base,
            eventType: 'message_complete',
            stopReason: event.status,
            ...(usage?.inputTokens !== undefined &&
            usage.outputTokens !== undefined
              ? {
                  tokenUsage: tokenUsage(usage),
                }
              : {}),
          },
        ];
      }
    }
  }

  private block(kind: string, itemId: string): number {
    const key = JSON.stringify([kind, itemId]);
    let index = this.blocks.get(key);
    if (index === undefined) {
      index = this.blocks.size;
      this.blocks.set(key, index);
    }
    return index;
  }

  private error(): void {
    if (this.errorEmitted) return;
    this.errorEmitted = true;
    this.callbacks.error('Codex reported a runtime error.');
  }
}
