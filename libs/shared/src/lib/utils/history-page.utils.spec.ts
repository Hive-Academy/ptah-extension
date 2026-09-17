import type { FlatStreamEventUnion } from '../types/execution';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  HISTORY_PAGE_DEFAULT_EVENTS,
  HISTORY_PAGE_MAX_EVENTS,
  HISTORY_TAIL_PAGE_EVENTS,
  HistoryCursorInvalidError,
  HistoryCursorStaleError,
  HistoryPageInvalidOptionsError,
  resolveHistoryCursorEndIndex,
  selectHistoryPage,
} from './history-page.utils';

function messageStart(
  messageId: string,
  role: 'user' | 'assistant' = 'user',
  parentToolUseId?: string,
): FlatStreamEventUnion {
  return {
    id: `start-${messageId}-${parentToolUseId ?? 'root'}`,
    eventType: 'message_start',
    timestamp: 1,
    messageId,
    role,
    ...(parentToolUseId ? { parentToolUseId } : {}),
  };
}

function complete(id: string, messageId: string): FlatStreamEventUnion {
  return {
    id,
    eventType: 'message_complete',
    timestamp: 1,
    messageId,
  };
}

function eventIds(events: readonly FlatStreamEventUnion[]): string[] {
  return events.map((event) => event.id);
}

describe('history paging', () => {
  it('exports the decided page budgets', () => {
    expect(HISTORY_TAIL_PAGE_EVENTS).toBe(250);
    expect(HISTORY_PAGE_DEFAULT_EVENTS).toBe(250);
    expect(HISTORY_PAGE_MAX_EVENTS).toBe(2000);
  });

  it('returns an empty page for empty input', () => {
    expect(selectHistoryPage([], { endIndex: 0, maxEvents: 250 })).toEqual({
      events: [],
      olderCursor: null,
    });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -1,
    1.5,
  ])('rejects invalid maxEvents value %p', (maxEvents) => {
    expect(() => selectHistoryPage([], { endIndex: 0, maxEvents })).toThrow(
      HistoryPageInvalidOptionsError,
    );
  });

  it('snaps a tail page to a root user turn start', () => {
    const events = [
      messageStart('u-1'),
      complete('u-1-complete', 'u-1'),
      complete('a-1-complete', 'a-1'),
      messageStart('u-2'),
      complete('u-2-complete', 'u-2'),
      complete('a-2-complete', 'a-2'),
      messageStart('u-3'),
      complete('u-3-complete', 'u-3'),
      complete('a-3-complete', 'a-3'),
    ];

    const page = selectHistoryPage(events, {
      endIndex: events.length,
      maxEvents: 4,
    });

    expect(eventIds(page.events)).toEqual([
      'start-u-3-root',
      'u-3-complete',
      'a-3-complete',
    ]);
    expect(page.olderCursor).toBe('h1:u-3');
  });

  it('keeps a tool pair in its whole turn', () => {
    const events: FlatStreamEventUnion[] = [
      messageStart('u-old'),
      complete('old-complete', 'u-old'),
      messageStart('u-tools'),
      {
        id: 'tool-start',
        eventType: 'tool_start',
        timestamp: 1,
        messageId: 'a-tools',
        toolCallId: 'tool-1',
        toolName: 'Read',
        isTaskTool: false,
      },
      {
        id: 'tool-result',
        eventType: 'tool_result',
        timestamp: 1,
        messageId: 'a-tools',
        toolCallId: 'tool-1',
        output: 'done',
        isError: false,
      },
      complete('tools-complete', 'a-tools'),
    ];

    const page = selectHistoryPage(events, {
      endIndex: events.length,
      maxEvents: 2,
    });

    expect(eventIds(page.events)).toEqual([
      'start-u-tools-root',
      'tool-start',
      'tool-result',
      'tools-complete',
    ]);
  });

  it('does not treat a nested agent user message as a page boundary', () => {
    const events: FlatStreamEventUnion[] = [
      messageStart('u-old'),
      complete('old-complete', 'u-old'),
      messageStart('u-agent'),
      {
        id: 'agent-start',
        eventType: 'agent_start',
        timestamp: 1,
        messageId: 'a-agent',
        toolCallId: 'task-1',
        agentType: 'explorer',
      },
      messageStart('nested-user', 'user', 'task-1'),
      complete('nested-complete', 'nested-user'),
    ];

    const page = selectHistoryPage(events, {
      endIndex: events.length,
      maxEvents: 2,
    });

    expect(eventIds(page.events)).toEqual([
      'start-u-agent-root',
      'agent-start',
      'start-nested-user-task-1',
      'nested-complete',
    ]);
  });

  it('returns one oversize turn whole', () => {
    const events = [
      messageStart('u-old'),
      complete('old-complete', 'u-old'),
      messageStart('u-large'),
      complete('large-1', 'u-large'),
      complete('large-2', 'a-large'),
      complete('large-3', 'a-large'),
      complete('large-4', 'a-large'),
    ];

    expect(
      eventIds(
        selectHistoryPage(events, {
          endIndex: events.length,
          maxEvents: 2,
        }).events,
      ),
    ).toEqual([
      'start-u-large-root',
      'large-1',
      'large-2',
      'large-3',
      'large-4',
    ]);
  });

  it('includes preceding whole turns on an exact maxEvents fit', () => {
    const events = [
      messageStart('u-1'),
      complete('u-1-complete', 'u-1'),
      messageStart('u-2'),
      complete('u-2-complete', 'u-2'),
      messageStart('u-3'),
      complete('u-3-complete', 'u-3'),
    ];

    const page = selectHistoryPage(events, {
      endIndex: events.length,
      maxEvents: 4,
    });

    expect(eventIds(page.events)).toEqual([
      'start-u-2-root',
      'u-2-complete',
      'start-u-3-root',
      'u-3-complete',
    ]);
  });

  it('treats index zero as the start of an assistant-first transcript', () => {
    const events = [
      messageStart('a-first', 'assistant'),
      complete('assistant-prefix', 'a-first'),
      messageStart('u-1'),
      complete('u-1-complete', 'u-1'),
    ];

    const tail = selectHistoryPage(events, {
      endIndex: events.length,
      maxEvents: 2,
    });
    const olderEnd = resolveHistoryCursorEndIndex(
      events,
      tail.olderCursor as string,
    );
    const older = selectHistoryPage(events, {
      endIndex: olderEnd,
      maxEvents: 2,
    });

    expect(eventIds(older.events)).toEqual([
      'start-a-first-root',
      'assistant-prefix',
    ]);
    expect(older.olderCursor).toBeNull();
  });

  it.each(['5f8b3bf8-0f6b-47a5-a6f6-60538fb6bd20', 'u-12'])(
    'round trips supported message id %s',
    (messageId) => {
      expect(decodeHistoryCursor(encodeHistoryCursor(messageId))).toBe(
        messageId,
      );
    },
  );

  it.each([
    ['one-character', 'a'],
    ['512-character', 'a'.repeat(512)],
  ])('round trips a %s cursor id', (_label, messageId) => {
    expect(decodeHistoryCursor(encodeHistoryCursor(messageId))).toBe(messageId);
  });

  it.each(['', 'h2:u-1', 'h1:', 'h1:contains.dot', `h1:${'a'.repeat(513)}`])(
    'rejects malformed cursor %p',
    (cursor) => {
      expect(() => decodeHistoryCursor(cursor)).toThrow(
        HistoryCursorInvalidError,
      );
    },
  );

  it('reports a valid cursor whose root anchor is missing as stale', () => {
    const events = [messageStart('u-1')];
    expect(() => resolveHistoryCursorEndIndex(events, 'h1:u-missing')).toThrow(
      HistoryCursorStaleError,
    );
  });

  it('does not resolve a cursor to a nested user message', () => {
    const events = [messageStart('nested', 'user', 'task-1')];
    expect(() => resolveHistoryCursorEndIndex(events, 'h1:nested')).toThrow(
      HistoryCursorStaleError,
    );
  });

  it('walks older pages to null with disjoint pages that reconstruct input', () => {
    const events = [
      messageStart('u-1'),
      complete('u-1-complete', 'u-1'),
      messageStart('u-2'),
      complete('u-2-complete', 'u-2'),
      messageStart('u-3'),
      complete('u-3-complete', 'u-3'),
      messageStart('u-4'),
      complete('u-4-complete', 'u-4'),
    ];
    const pages: FlatStreamEventUnion[][] = [];
    let endIndex = events.length;
    let olderCursor: string | null;

    do {
      const page = selectHistoryPage(events, { endIndex, maxEvents: 3 });
      pages.unshift(page.events);
      olderCursor = page.olderCursor;
      if (olderCursor !== null) {
        endIndex = resolveHistoryCursorEndIndex(events, olderCursor);
      }
    } while (olderCursor !== null);

    const reconstructed = pages.flat();
    expect(eventIds(reconstructed)).toEqual(eventIds(events));
    expect(new Set(eventIds(reconstructed)).size).toBe(events.length);
  });
});
