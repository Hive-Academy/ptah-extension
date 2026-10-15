import type { FlatStreamEventUnion } from '@ptah-extension/shared';

export interface CoalescedEvent {
  readonly event: FlatStreamEventUnion;
  readonly sequence: number;
  readonly bytes: number;
}

function key(event: FlatStreamEventUnion): string | undefined {
  if (event.source !== 'stream') return undefined;
  switch (event.eventType) {
    case 'text_delta':
    case 'thinking_delta':
      return `${event.eventType}:${event.blockIndex}`;
    case 'tool_delta':
      return `tool_delta:${event.toolCallId}`;
    default:
      return undefined;
  }
}

function isDelta(event: FlatStreamEventUnion): event is Extract<
  FlatStreamEventUnion,
  { eventType: 'text_delta' | 'thinking_delta' | 'tool_delta' }
> {
  return (
    event.eventType === 'text_delta' ||
    event.eventType === 'thinking_delta' ||
    event.eventType === 'tool_delta'
  );
}

function eventBytes(event: FlatStreamEventUnion): number {
  if (!isDelta(event)) return serializedBytes(event);
  return (
    128 +
    Buffer.byteLength(event.delta, 'utf8') +
    Buffer.byteLength(event.id, 'utf8') +
    Buffer.byteLength(event.messageId, 'utf8') +
    Buffer.byteLength(event.sessionId ?? '', 'utf8') +
    Buffer.byteLength(event.parentToolUseId ?? '', 'utf8') +
    Buffer.byteLength(event.toolCallId ?? '', 'utf8') +
    ('signature' in event ? Buffer.byteLength(event.signature ?? '', 'utf8') : 0)
  );
}

export function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Keeps event order while joining adjacent deltas of each message and block. */
export class StreamDeltaCoalescer {
  private readonly entries: CoalescedEvent[] = [];
  private readonly lastByMessage = new Map<string, { index: number; key: string }>();
  private totalBytes = 0;

  append(event: FlatStreamEventUnion, sequence: number): boolean {
    const eventKey = key(event);
    const last = this.lastByMessage.get(event.messageId);
    if (eventKey && last?.key === eventKey) {
      const previous = this.entries[last.index];
      const previousEvent = previous.event;
      if (isDelta(previousEvent) && isDelta(event)) {
        const bytes = Buffer.byteLength(event.delta, 'utf8');
        const merged = {
          ...previousEvent,
          ...event,
          delta: previousEvent.delta + event.delta,
          ...('signature' in previousEvent &&
            (!('signature' in event) || event.signature === undefined)
            ? { signature: previousEvent.signature }
            : {}),
        } as FlatStreamEventUnion;
        this.entries[last.index] = {
          event: merged,
          sequence: previous.sequence,
          bytes: previous.bytes + bytes,
        };
        this.totalBytes += bytes;
        return true;
      }
    }

    if (
      event.eventType === 'turn_state' ||
      event.eventType === 'compaction_start' ||
      event.eventType === 'compaction_complete'
    ) {
      this.barrier();
    } else if (eventKey) {
      this.lastByMessage.set(event.messageId, {
        index: this.entries.length,
        key: eventKey,
      });
    } else {
      this.lastByMessage.delete(event.messageId);
    }
    const bytes = eventBytes(event);
    this.entries.push({ event, sequence, bytes });
    this.totalBytes += bytes;
    return false;
  }

  get events(): readonly CoalescedEvent[] {
    return this.entries;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  /** Prevents a later delta from merging across a global event. */
  barrier(): void {
    this.lastByMessage.clear();
  }

  clear(): void {
    this.entries.length = 0;
    this.lastByMessage.clear();
    this.totalBytes = 0;
  }
}
