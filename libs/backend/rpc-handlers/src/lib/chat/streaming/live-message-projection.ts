import type { FlatStreamEventUnion } from '@ptah-extension/shared';

import { serializedBytes, StreamDeltaCoalescer } from './stream-delta-coalescer';

export const STREAM_LIVE_SEED_MAX_BYTES = 1024 * 1024;
const ROOT = '';

interface Context {
  readonly anchor: FlatStreamEventUnion & { eventType: 'message_start' };
  readonly anchorSequence: number;
  readonly suffix: StreamDeltaCoalescer;
  readonly anchorBytes: number;
  streamEnded: boolean;
  truncated: boolean;
  persistedBlocks: number;
}

export interface DeferredAnchor {
  readonly event: FlatStreamEventUnion;
  readonly sequence: number;
}

export interface LiveSeed {
  readonly events: readonly FlatStreamEventUnion[];
  readonly deferredAnchors: readonly DeferredAnchor[];
  readonly blockCounts: Readonly<Record<string, number>>;
}

export function isSeedContent(event: FlatStreamEventUnion): boolean {
  return (
    event.eventType === 'text_delta' ||
    event.eventType === 'thinking_start' ||
    event.eventType === 'thinking_delta' ||
    event.eventType === 'tool_start' ||
    event.eventType === 'tool_delta' ||
    event.eventType === 'signature_delta'
  );
}

/** The open message suffix for each root or subagent context of one tab. */
export class LiveMessageProjection {
  private readonly contexts = new Map<string, Context>();
  private droppedMessageIds: string[] = [];
  private turnState?: { event: FlatStreamEventUnion; sequence: number };
  private totalBytes = 0;

  constructor(private readonly maxBytes = STREAM_LIVE_SEED_MAX_BYTES) {}

  observe(event: FlatStreamEventUnion, sequence: number): boolean {
    if (event.eventType === 'compaction_complete') {
      this.clearContexts();
      return false;
    }
    if (event.eventType === 'turn_state') {
      if (event.retirementOnly) return false;
      this.turnState = { event, sequence };
      for (const context of this.contexts.values()) context.suffix.barrier();
      if (event.phase === 'idle' || event.phase === 'failed') {
        this.clearContexts();
      } else if (event.phase === 'awaiting-background' || event.phase === 'sleeping') {
        const root = this.contexts.get(ROOT);
        if (root) {
          root.streamEnded = true;
          this.closeIfComplete(ROOT, root);
        }
      }
      return false;
    }
    if (event.eventType === 'tool_result' && event.toolCallId) {
      this.drop(event.toolCallId);
    }
    const contextKey = event.parentToolUseId ?? ROOT;
    if (event.eventType === 'message_start' && event.source === 'stream') {
      this.drop(contextKey);
      const anchorBytes = serializedBytes(event);
      const context: Context = {
        anchor: event,
        anchorSequence: sequence,
        anchorBytes,
        suffix: new StreamDeltaCoalescer(),
        streamEnded: false,
        truncated: anchorBytes + this.totalBytes > this.maxBytes,
        persistedBlocks: 0,
      };
      this.contexts.set(contextKey, context);
      this.totalBytes += anchorBytes;
      return context.truncated;
    }
    const context = this.contexts.get(contextKey);
    if (!context || context.anchor.messageId !== event.messageId) return false;
    if (event.source === 'complete') {
      if (
        event.eventType === 'text_delta' ||
        event.eventType === 'tool_start' ||
        (contextKey === ROOT && event.eventType === 'thinking_delta')
      ) {
        context.persistedBlocks++;
      }
      if (event.eventType === 'message_complete') {
        this.totalBytes -= context.suffix.bytes;
        context.suffix.clear();
        context.truncated = false;
        this.closeIfComplete(contextKey, context);
      }
      return false;
    }
    if (event.eventType === 'message_complete' && event.source === 'stream') {
      context.streamEnded = true;
    }
    if (!context.truncated) {
      const before = context.suffix.bytes;
      context.suffix.append(event, sequence);
      this.totalBytes += context.suffix.bytes - before;
      if (this.totalBytes > this.maxBytes) {
        this.totalBytes -= context.suffix.bytes;
        context.suffix.clear();
        context.truncated = true;
        return true;
      }
    }
    this.closeIfComplete(contextKey, context);
    return false;
  }

  buildSeed(): LiveSeed {
    const ordered: Array<{ event: FlatStreamEventUnion; sequence: number }> = [];
    const deferredAnchors: DeferredAnchor[] = [];
    const blockCounts: Record<string, number> = Object.create(null);
    if (this.turnState) ordered.push(this.turnState);
    for (const context of this.contexts.values()) {
      blockCounts[context.anchor.messageId] = context.persistedBlocks;
      const suffix = context.suffix.events;
      if (suffix.some(({ event }) => isSeedContent(event))) {
        ordered.push({ event: context.anchor, sequence: context.anchorSequence });
        ordered.push(...suffix);
      } else {
        deferredAnchors.push({ event: context.anchor, sequence: context.anchorSequence });
      }
    }
    ordered.sort((a, b) => a.sequence - b.sequence);
    return {
      events: ordered.map(({ event }) => event),
      deferredAnchors,
      blockCounts,
    };
  }

  takeDroppedMessageIds(): readonly string[] {
    const dropped = this.droppedMessageIds;
    this.droppedMessageIds = [];
    return dropped;
  }

  isEmpty(): boolean {
    return (
      this.contexts.size === 0 &&
      (!this.turnState ||
        (this.turnState.event.eventType === 'turn_state' &&
          (this.turnState.event.phase === 'idle' ||
            this.turnState.event.phase === 'failed')))
    );
  }

  private closeIfComplete(key: string, context: Context): void {
    if (
      context.streamEnded &&
      !context.truncated &&
      !context.suffix.events.some(({ event }) => isSeedContent(event))
    ) {
      this.drop(key);
    }
  }

  private drop(key: string): void {
    const context = this.contexts.get(key);
    if (!context) return;
    this.totalBytes -= context.anchorBytes + context.suffix.bytes;
    this.contexts.delete(key);
    this.droppedMessageIds.push(context.anchor.messageId);
  }

  private clearContexts(): void {
    for (const context of this.contexts.values()) {
      this.droppedMessageIds.push(context.anchor.messageId);
    }
    this.contexts.clear();
    this.totalBytes = 0;
  }
}
