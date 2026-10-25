import type {
  CodexReportedUsage,
  CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';

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
  result(result: CodexChatResult): void;
  /** Complete content replaces the item; it is never presented as a delta. */
  content(item: {
    itemId: string;
    text: string;
    kind: 'text' | 'reasoning';
    blockIndex: number;
  }): void;
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
  private sequence = -1;
  private terminal = false;
  private errorEmitted = false;
  private usage?: CodexReportedUsage;
  private readonly text = new Map<string, string>();
  private readonly blocks = new Map<string, number>();

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
      case 'textFinal':
        this.text.set(event.itemId, event.text);
        this.callbacks.content({
          itemId: event.itemId,
          text: event.text,
          kind: 'text',
          blockIndex: this.block('text', event.itemId),
        });
        return [];
      case 'reasoning': {
        const blockIndex = this.block('reasoning', event.itemId);
        if (event.phase === 'final') {
          this.callbacks.content({
            itemId: event.itemId,
            text: event.text,
            kind: 'reasoning',
            blockIndex,
          });
          return [];
        }
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
        return [
          {
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
          },
        ];
      case 'toolCompleted':
        return [
          {
            ...base,
            eventType: 'tool_result',
            toolCallId: event.toolId,
            output: event.output,
            isError: event.status !== 'completed',
          },
        ];
      case 'usage':
        this.usage = event.usage;
        return [];
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
        this.usage = undefined;
        this.callbacks.result(result);
        // Usage belongs to result only; consumers must not count it twice.
        return [
          { ...base, eventType: 'message_complete', stopReason: event.status },
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
