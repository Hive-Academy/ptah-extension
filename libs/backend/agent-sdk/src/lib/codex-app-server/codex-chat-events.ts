import type {
  CodexReportedUsage,
  CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { CodexChatAdapterError } from './codex-chat-adapter-error';
import { presentCodexTool, presentCodexToolResult } from './codex-tool-presentation';

export const CODEX_FAILURE_NOTICE = 'Codex reported a runtime error.';

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
  error(message: string, cwd?: string): void | Promise<void>;
}

/** One projection per turn. Core events are already normalized. */
export class CodexChatEvents {
  private pending: Promise<void> = Promise.resolve();

  async settled(): Promise<void> {
    if (this.errorEmitted) {
      // Failure publication is best effort. A stuck UI callback cannot retain
      // the native session or keep the terminal state behind it.
      // degradation-audit: reported - The host callback logs publication failures; the native turn must settle independently.
      void this.pending.catch(() => undefined);
      if (this.streamFailure) throw this.streamFailure;
      return;
    }
    await this.pending;
    // Successful turns wait for their callbacks. Failed turns have already
    // signalled the iterator without waiting for error presentation.
    if (this.streamFailure) throw this.streamFailure;
  }

  private track(work: void | Promise<void>): void {
    this.pending = Promise.all([this.pending, work]).then(() => undefined);
  }

  private started = false;
  private sequence = -1;
  private terminal = false;
  private errorEmitted = false;
  /**
   * Set on a failed or interrupted terminal. `settled()` rejects with it,
   * so the turn generator
   * (`codex-chat-turn-stream.ts`) throws before it yields
   * `message_complete`. A clean return is what the gateway seals as a
   * successful reply.
   */
  private streamFailure?: Error;
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
    // Neither a card-only question nor a diagnostic opens assistant content.
    if (
      event.type === 'error' ||
      (event.type === 'userInputAsync' && event.presentation !== 'text') ||
      (event.type === 'terminal' &&
        (event.status !== 'completed' || event.error !== undefined))
    ) return projected;
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
        // A final that is not an extension of the streamed prefix cannot be
        // expressed as another append. Claude's complete assistant message
        // carries the whole block as one `text_delta` with `source:
        // 'complete'` (assistant-message.transformer.ts). The webview
        // accumulator sets that block, including when the final is shorter.
        // Empty final-only text opens no block. An empty correction replaces
        // the existing streamed block with an empty complete-source delta.
        if (!event.text.startsWith(previous)) {
          const blockIndex = this.block('text', event.itemId);
          return [
            {
              ...base,
              source: 'complete',
              eventType: 'text_delta',
              delta: event.text,
              blockIndex,
            },
          ];
        }
        const delta = event.text.slice(previous.length);
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
      case 'userInputAsync':
        return event.presentation === 'text'
          ? this.project({ ...event, type: 'textFinal' }, base)
          : [];
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
        if (event.error.code === 'codexFollowUpRejected') this.error();
        return [];
      case 'terminal': {
        this.terminal = true;
        const failed = event.status === 'failed' || event.error !== undefined;
        if (failed) this.error();
        const usage = event.usage ?? this.usage;
        const result: CodexChatResult = {
          status: failed ? 'failed' : event.status,
          text: [...this.text.values()].join(''),
          ...(usage === undefined ? {} : { usage }),
          ...(failed ? { error: CODEX_FAILURE_NOTICE } : {}),
        };
        this.text.clear();
        this.blocks.clear();
        this.tools.clear();
        this.usage = undefined;
        this.track(this.callbacks.result(result));
        // Failed and interrupted turns must not end the generator normally.
        // `error()` above publishes the host failure notification. The stream
        // adds the transcript notice separately. A completed terminal stays a
        // clean settlement.
        if (failed) {
          this.streamFailure = new CodexChatAdapterError('runtime-failed', 'turn', {
            webviewReported: true,
          });
        } else if (event.status === 'interrupted') {
          this.streamFailure = new CodexChatAdapterError('cancelled', 'turn');
        }
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
    this.track(this.callbacks.error(CODEX_FAILURE_NOTICE));
  }
}
