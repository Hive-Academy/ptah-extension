import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { assembleHistoryPage, clipHistoryEvent, historyPageBytes, MAX_HISTORY_EVENT_BYTES, MAX_RPC_RESPONSE_BYTES } from './subagent-history-page';

const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
function textEvent(delta: string, id = 'one'): FlatStreamEventUnion {
  return { eventType: 'text_delta', id, messageId: 'message', timestamp: 1, blockIndex: 0, delta };
}
function resultEvent(output: string): FlatStreamEventUnion {
  return { eventType: 'tool_result', id: 'result', messageId: 'message', timestamp: 1, toolCallId: 'tool', isError: false, output };
}
function toolStart(input: Record<string, unknown>): FlatStreamEventUnion {
  return { eventType: 'tool_start', id: 'start', messageId: 'message', timestamp: 1,
    toolCallId: 'tool', toolName: 'Bash', isTaskTool: false, toolInput: input };
}

describe('subagent history clipping and paging', () => {
  it.each([
    ['large text', textEvent('a'.repeat(300_000))],
    ['escape-heavy text', textEvent('\u0001'.repeat(90_000))],
    ['multibyte text', textEvent('界'.repeat(90_000))],
    ['tool result', resultEvent('z'.repeat(1_000_000))],
    ['tool input', toolStart({ command: 'z'.repeat(200_000) })],
  ] as const)('clips %s by encoded event bytes and advances the cursor', (_name, event) => {
    const clipped = clipHistoryEvent(event);
    expect(clipped.clipped).toBe(true);
    expect(size(clipped.event)).toBeLessThanOrEqual(MAX_HISTORY_EVENT_BYTES);
    const page = assembleHistoryPage([event, textEvent('next', 'two')], 0, 'ok', 'agent-1', false, 1024);
    expect(page.events).toHaveLength(1);
    expect(page.nextCursor).toBe('1');
    expect(page.clippedEvents).toBe(1);
    expect(historyPageBytes(page)).toBeLessThanOrEqual(MAX_RPC_RESPONSE_BYTES);
    expect(assembleHistoryPage([event, textEvent('next', 'two')], 1, 'ok', 'agent-1', false, 1024).done).toBe(true);
  });

  it('retains a 96 KB event within the hard envelope', () => {
    const event = textEvent('x'.repeat(95_000));
    const page = assembleHistoryPage([event], 0, 'ok', 'a'.repeat(128), false, 256 * 1024);
    expect(page.events).toHaveLength(1);
    expect(historyPageBytes(page)).toBeLessThan(MAX_RPC_RESPONSE_BYTES);
  });

  it('accounts for reserved correlation ids on a nearly full page', () => {
    const events = Array.from({ length: 12 }, (_, index) => textEvent('x'.repeat(25_000), String(index)));
    const page = assembleHistoryPage(events, 0, 'ok', 'a'.repeat(128), false, 256 * 1024);
    expect(page.nextCursor).not.toBeNull();
    expect(historyPageBytes(page, 'a'.repeat(36))).toBeLessThanOrEqual(MAX_RPC_RESPONSE_BYTES);
    expect(historyPageBytes(page, 'a'.repeat(64))).toBeLessThanOrEqual(MAX_RPC_RESPONSE_BYTES);
  });

  it('returns distinct empty statuses and a terminal cursor', () => {
    for (const status of ['ok', 'not-found', 'unresolved'] as const) {
      const page = assembleHistoryPage([], 0, status, null, false, 128 * 1024);
      expect(page).toMatchObject({ status, events: [], nextCursor: null, done: true, clippedEvents: 0 });
    }
  });
});
