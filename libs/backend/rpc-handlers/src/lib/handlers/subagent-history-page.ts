import type { FlatStreamEventUnion, SubagentHistoryPageResult } from '@ptah-extension/shared';

export const MAX_HISTORY_EVENT_BYTES = 96 * 1024;
export const MAX_RPC_RESPONSE_BYTES = 256 * 1024;
export const HISTORY_PAGE_MAX_EVENTS = 2000;
const encoder = new TextEncoder();
const bytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;
const eventTypes: Record<FlatStreamEventUnion['eventType'], true> = {
  message_start: true, text_delta: true, thinking_start: true, thinking_delta: true,
  tool_start: true, tool_delta: true, tool_result: true, agent_start: true,
  message_complete: true, message_delta: true, signature_delta: true,
  compaction_start: true, compaction_complete: true, background_agent_started: true,
  background_agent_completed: true, background_agent_stopped: true,
  agent_progress: true, agent_status: true, agent_completed: true, turn_state: true,
};

function isEventType(value: string): value is FlatStreamEventUnion['eventType'] {
  return Object.prototype.hasOwnProperty.call(eventTypes, value);
}

/** A versioned, canonical token for the last event delivered to the caller. */
export function historyCursor(event: Pick<FlatStreamEventUnion, 'id' | 'eventType'>): string {
  return `v1.${Buffer.from(JSON.stringify([event.id, event.eventType]), 'utf8').toString('base64url')}`;
}

export function parseHistoryCursor(cursor: string): readonly [string, FlatStreamEventUnion['eventType']] | null {
  if (!/^v1\.[A-Za-z0-9_-]{1,4096}$/.test(cursor)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(cursor.slice(3), 'base64url').toString('utf8'));
    if (!Array.isArray(payload) || payload.length !== 2 || typeof payload[0] !== 'string' ||
      payload[0].length === 0 || typeof payload[1] !== 'string' || !isEventType(payload[1])) return null;
    const identity: readonly [string, FlatStreamEventUnion['eventType']] = [payload[0], payload[1]];
    return historyCursor({ id: identity[0], eventType: identity[1] }) === cursor ? identity : null;
  } catch {
    return null;
  }
}

function marker(omitted: number): string {
  return `… [${omitted} characters omitted]`;
}

function shorten(value: string, retained: number): string {
  if (retained >= value.length) return value;
  const tail = Math.min(2048, Math.floor(retained / 2));
  const head = Math.max(0, retained - tail);
  return value.slice(0, head) + marker(value.length - head - tail) + value.slice(value.length - tail);
}

function largestStringPath(value: unknown, prefix: (string | number)[] = []): (string | number)[] | null {
  if (typeof value === 'string') return prefix;
  if (value === null || typeof value !== 'object') return null;
  let best: (string | number)[] | null = null;
  let bestLength = -1;
  for (const [key, child] of Object.entries(value)) {
    const path = largestStringPath(child, [...prefix, key]);
    if (!path) continue;
    const candidate = getPath(value, path.slice(prefix.length));
    if (typeof candidate === 'string' && candidate.length > bestLength) {
      best = path;
      bestLength = candidate.length;
    }
  }
  return best;
}

function getPath(value: unknown, path: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[String(key)];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function replacePath<T extends object>(value: T, path: (string | number)[], replacement: string): T {
  const copy = structuredClone(value);
  let target: unknown = copy;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(target)) return copy;
    target = target[String(key)];
  }
  if (!isRecord(target)) return copy;
  target[String(path[path.length - 1])] = replacement;
  return copy;
}

/** Clip one event without mutating replay's cached events. */
export function clipHistoryEvent(event: FlatStreamEventUnion): { event: FlatStreamEventUnion; clipped: boolean } {
  let result = event;
  let clipped = false;
  // Mirrors execution-tree-retention's 24K output, 16K input, and 2K tail budgets.
  if ((event.eventType === 'text_delta' || event.eventType === 'thinking_delta' || event.eventType === 'tool_delta') && event.delta.length > 96 * 1024) {
    result = { ...event, delta: shorten(event.delta, 96 * 1024) };
    clipped = true;
  } else if (event.eventType === 'tool_result') {
    const output = typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
    if (output && output.length > 24 * 1024) {
      result = { ...event, output: shorten(output, 24 * 1024) };
      clipped = true;
    }
  } else if (event.eventType === 'tool_start' && event.toolInput && JSON.stringify(event.toolInput).length > 16 * 1024) {
    result = { ...event, toolInput: { clipped: shorten(JSON.stringify(event.toolInput), 16 * 1024) } };
    clipped = true;
  }

  for (let attempt = 0; bytes(result) > MAX_HISTORY_EVENT_BYTES && attempt < 8; attempt++) {
    const record: Record<string, unknown> = { ...result };
    const path = largestStringPath(record);
    if (!path) break;
    const original = getPath(record, path);
    if (typeof original !== 'string') break;
    let low = 0;
    let high = original.length;
    let best: FlatStreamEventUnion | null = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = replacePath(result, path, shorten(original, mid));
      if (bytes(candidate) <= MAX_HISTORY_EVENT_BYTES) {
        best = candidate;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (best) result = best;
    else if (result.eventType === 'tool_start') result = { ...result, toolInput: { omitted: true, characters: JSON.stringify(result.toolInput).length } };
    else if (result.eventType === 'tool_result') result = { ...result, output: marker(String(result.output).length) };
    else result = replacePath(result, path, marker(original.length));
    clipped = true;
  }
  if (bytes(result) > MAX_HISTORY_EVENT_BYTES) {
    const common = { id: event.id, eventType: event.eventType, messageId: event.messageId,
      timestamp: event.timestamp,
      ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
      ...(event.parentToolUseId !== undefined ? { parentToolUseId: event.parentToolUseId } : {}),
      ...(event.blockIndex !== undefined ? { blockIndex: event.blockIndex } : {}),
      ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}) };
    const notice = 'Content too large to display';
    switch (event.eventType) {
      case 'text_delta': case 'thinking_delta':
        result = { ...common, eventType: event.eventType, blockIndex: event.blockIndex, delta: notice };
        break;
      case 'tool_delta':
        result = { ...common, eventType: 'tool_delta', toolCallId: event.toolCallId, delta: notice };
        break;
      case 'tool_start':
        result = { ...common, eventType: 'tool_start', toolCallId: event.toolCallId,
          toolName: notice, isTaskTool: event.isTaskTool, toolInput: { clipped: notice } };
        break;
      case 'tool_result':
        result = { ...common, eventType: 'tool_result', toolCallId: event.toolCallId,
          isError: event.isError, output: notice };
        break;
      case 'message_start':
        result = { ...common, eventType: 'message_start', role: event.role, inboundPeer: { label: notice } };
        break;
      case 'message_complete':
        result = { ...common, eventType: 'message_complete', stopReason: notice };
        break;
      default:
        // A text delta is accepted by the accumulator even when the source kind
        // has required fields too large to retain. Keep its identity for paging.
        result = { ...common, eventType: 'text_delta', blockIndex: event.blockIndex ?? 0, delta: notice };
        break;
    }
    clipped = true;
  }
  return { event: result, clipped };
}

export function historyPageBytes(result: SubagentHistoryPageResult, correlationId = 'x'.repeat(64)): number {
  return bytes({ success: true, data: { ...result, agentId: result.agentId?.padEnd(128, 'x') ?? null,
    nextCursor: result.nextCursor?.padEnd(32, 'x') ?? 'x'.repeat(32) }, correlationId: correlationId.padEnd(64, 'x') });
}

/** Assemble a page using the full RPC envelope, including cursor and correlation reservations. */
export function assembleHistoryPage(
  source: readonly FlatStreamEventUnion[], start: number, status: SubagentHistoryPageResult['status'],
  agentId: string | null, truncated: boolean, maxBytes: number,
): SubagentHistoryPageResult {
  const rpcBytes = Math.min(maxBytes, MAX_RPC_RESPONSE_BYTES);
  const base = (events: FlatStreamEventUnion[], end: number, clippedEvents: number): SubagentHistoryPageResult => ({
    status, agentId, events, nextCursor: end < source.length && end > 0 ? historyCursor(source[end - 1]) : null,
    done: end >= source.length, truncated, clippedEvents,
  });
  const envelopeBytes = historyPageBytes(base([], start, 0));
  const eventBudget = rpcBytes - envelopeBytes;
  if (eventBudget <= 0) throw new Error('Agent output page exceeds RPC budget');
  const events: FlatStreamEventUnion[] = [];
  const clippedFlags: boolean[] = [];
  let used = 0;
  for (let index = start; index < source.length && events.length < HISTORY_PAGE_MAX_EVENTS; index++) {
    const clipped = clipHistoryEvent(source[index]);
    const cost = bytes(clipped.event) + (events.length ? 1 : 0);
    if (events.length && used + cost > eventBudget) break;
    events.push(clipped.event);
    clippedFlags.push(clipped.clipped);
    used += cost;
  }
  while (historyPageBytes(base(events, start + events.length, clippedFlags.filter(Boolean).length)) > rpcBytes && events.length > 1) {
    events.pop();
    clippedFlags.pop();
  }
  const page = base(events, start + events.length, clippedFlags.filter(Boolean).length);
  if (events.length > 0 && historyPageBytes(page) > MAX_RPC_RESPONSE_BYTES) throw new Error('Agent output page exceeds RPC budget');
  return page;
}
