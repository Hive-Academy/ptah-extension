import { Injectable, signal, computed, OnDestroy } from '@angular/core';
import type {
  HarnessStreamPayload,
  HarnessStreamCompletePayload,
  HarnessStreamOperation,
} from '@ptah-extension/shared';

export interface StreamBlock {
  id: string;
  kind: 'text' | 'thinking' | 'tool' | 'error' | 'status';
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolInput?: string;
  toolResult?: string;
  toolIsError?: boolean;
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class HarnessStreamingService implements OnDestroy {
  private readonly _events = signal<HarnessStreamPayload[]>([]);
  private readonly _isStreaming = signal(false);
  private readonly _currentOperation = signal<HarnessStreamOperation | null>(
    null,
  );
  private readonly _completionResult =
    signal<HarnessStreamCompletePayload | null>(null);

  public readonly events = this._events.asReadonly();
  public readonly isStreaming = this._isStreaming.asReadonly();
  public readonly currentOperation = this._currentOperation.asReadonly();
  public readonly completionResult = this._completionResult.asReadonly();

  public readonly toolCallCount = computed(
    () => this._events().filter((e) => e.kind === 'tool_start').length,
  );

  public readonly hasError = computed(() => {
    const result = this._completionResult();
    return result !== null && !result.success;
  });

  public readonly errorMessage = computed(() => {
    const result = this._completionResult();
    if (result && !result.success) return result.error ?? 'Operation failed';
    const errorEvents = this._events().filter((e) => e.kind === 'error');
    return errorEvents.length > 0
      ? errorEvents[errorEvents.length - 1].content
      : null;
  });

  public readonly blocks = computed(() => this.buildBlocks(this._events()));

  private buildBlocks(events: HarnessStreamPayload[]): StreamBlock[] {
    const blocks: StreamBlock[] = [];
    const toolBlocks = new Map<string, StreamBlock>();
    const completedTools = new Set<string>();

    for (const event of events) {
      switch (event.kind) {
        case 'text': {
          const last = blocks[blocks.length - 1];
          if (last && last.kind === 'text') {
            last.content += event.content;
          } else {
            blocks.push({
              id: `text-${blocks.length}`,
              kind: 'text',
              content: event.content,
              isActive: false,
            });
          }
          break;
        }

        case 'thinking': {
          const last = blocks[blocks.length - 1];
          if (last && last.kind === 'thinking') {
            last.content += event.content;
          } else {
            blocks.push({
              id: `thinking-${blocks.length}`,
              kind: 'thinking',
              content: event.content,
              isActive: false,
            });
          }
          break;
        }

        case 'tool_start': {
          const toolBlock: StreamBlock = {
            id: `tool-${event.toolCallId ?? blocks.length}`,
            kind: 'tool',
            content: '',
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            toolInput: '',
            isActive: true,
          };
          blocks.push(toolBlock);
          if (event.toolCallId) {
            toolBlocks.set(event.toolCallId, toolBlock);
          }
          break;
        }

        case 'tool_input': {
          const target = event.toolCallId
            ? toolBlocks.get(event.toolCallId)
            : undefined;
          if (target) {
            target.toolInput = (target.toolInput ?? '') + event.content;
          }
          break;
        }

        case 'tool_result': {
          const target = event.toolCallId
            ? toolBlocks.get(event.toolCallId)
            : undefined;
          if (target) {
            target.toolResult = event.content;
            target.toolIsError = event.isError;
            target.isActive = false;
          }
          if (event.toolCallId) {
            completedTools.add(event.toolCallId);
          }
          break;
        }

        case 'error': {
          blocks.push({
            id: `error-${blocks.length}`,
            kind: 'error',
            content: event.content,
            isActive: false,
          });
          break;
        }

        case 'status': {
          blocks.push({
            id: `status-${blocks.length}`,
            kind: 'status',
            content: event.content,
            isActive: false,
          });
          break;
        }
      }
    }

    return blocks;
  }

  private readonly messageHandler = (event: MessageEvent): void => {
    const message = event.data;
    if (!message || !message.type) return;

    if (message.type === 'harness:stream') {
      const payload = message.payload as HarnessStreamPayload;
      this._events.update((events) => [...events, payload]);

      if (!this._isStreaming()) {
        this._isStreaming.set(true);
        this._currentOperation.set(payload.operation);
      }
    } else if (message.type === 'harness:stream-complete') {
      const payload = message.payload as HarnessStreamCompletePayload;
      this._completionResult.set(payload);
      this._isStreaming.set(false);
    }
  };

  constructor() {
    window.addEventListener('message', this.messageHandler);
  }

  public ngOnDestroy(): void {
    window.removeEventListener('message', this.messageHandler);
  }

  public reset(): void {
    this._events.set([]);
    this._isStreaming.set(false);
    this._currentOperation.set(null);
    this._completionResult.set(null);
  }
}
