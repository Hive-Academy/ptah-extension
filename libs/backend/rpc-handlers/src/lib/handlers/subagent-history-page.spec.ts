import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { assembleHistoryPage, clipHistoryEvent, historyCursor, historyPageBytes, MAX_HISTORY_EVENT_BYTES, MAX_RPC_RESPONSE_BYTES } from './subagent-history-page';

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
    expect(page.nextCursor).toBe(historyCursor(event));
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

  it('replaces an unclippable event with a visible placeholder of the same identity', () => {
    const event = { ...textEvent('small'), numericPayload: Array.from({ length: 60_000 }, (_, index) => index) };
    const clipped = clipHistoryEvent(event);
    expect(clipped).toMatchObject({ clipped: true, event: {
      eventType: 'text_delta', id: event.id, messageId: event.messageId,
      delta: 'Content too large to display',
    } });
    expect(size(clipped.event)).toBeLessThanOrEqual(MAX_HISTORY_EVENT_BYTES);
    expect(clipped.event).not.toHaveProperty('sessionId');
    expect(clipped.event).not.toHaveProperty('parentToolUseId');
    expect(clipped.event).not.toHaveProperty('toolCallId');
    const later = textEvent('x'.repeat(4000), 'later');
    const singlePage = { status: 'ok' as const, agentId: 'agent-1', events: [clipped.event],
      nextCursor: historyCursor(event), done: false, truncated: false, clippedEvents: 1 };
    const maxBytes = Math.max(1024, historyPageBytes(singlePage) + Math.floor(size(later) / 2));
    expect(historyPageBytes({ ...singlePage, events: [clipped.event, later] })).toBeGreaterThan(maxBytes);
    const page = assembleHistoryPage([event, later], 0, 'ok', 'agent-1', false, maxBytes);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toEqual(clipped.event);
    expect(page.nextCursor).toBe(historyCursor(event));
  });

  it('uses a valid text event when oversized lifecycle events cannot keep their fields', () => {
    const numericPayload = Array.from({ length: 60_000 }, (_, index) => index);
    const base = { id: 'large', messageId: 'message', timestamp: 1, numericPayload };
    const events: FlatStreamEventUnion[] = [
      { ...base, eventType: 'agent_start', toolCallId: 'tool', agentType: 'general' },
      { ...base, eventType: 'agent_progress', parentToolUseId: 'tool', taskId: 'task',
        description: 'Working', totalTokens: 1, toolUses: 1, durationMs: 1 },
      { ...base, eventType: 'background_agent_started', toolCallId: 'tool', agentType: 'general' },
      { ...base, eventType: 'compaction_start', trigger: 'auto', preTokens: 1 },
      { ...base, eventType: 'turn_state', phase: 'idle', revision: 1,
        backgroundTasks: [], sessionCrons: [], terminalReason: null },
    ];
    for (const event of events) {
      const clipped = clipHistoryEvent(event);
      expect(clipped.clipped).toBe(true);
      expect(clipped.event).toMatchObject({ eventType: 'text_delta', id: event.id,
        messageId: event.messageId, delta: 'Content too large to display', blockIndex: 0 });
      expect(size(clipped.event)).toBeLessThanOrEqual(MAX_HISTORY_EVENT_BYTES);
      expect(historyCursor(clipped.event)).not.toBe(historyCursor(event));
    }
  });

  it('cuts back a page when the encoded anchor grows beyond the reservation', () => {
    const events = [textEvent('a'.repeat(100), 'first'), textEvent('b', 'x'.repeat(310)), textEvent('c', 'third')];
    const page = assembleHistoryPage(events, 0, 'ok', 'agent-1', false, 1024);
    expect(page.events).toHaveLength(1);
    expect(page.nextCursor).toBe(historyCursor(events[0]));
    expect(historyPageBytes(page)).toBeLessThanOrEqual(1024);
  });

  it('returns distinct empty statuses and a terminal cursor', () => {
    for (const status of ['ok', 'not-found', 'unresolved'] as const) {
      const page = assembleHistoryPage([], 0, status, null, false, 128 * 1024);
      expect(page).toMatchObject({ status, events: [], nextCursor: null, done: true, clippedEvents: 0 });
    }
  });
});
