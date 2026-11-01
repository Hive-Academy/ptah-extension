import { createHash } from 'node:crypto';
import {
  CodexEventTranslator,
  type CodexHistoryThread,
  type CodexHistoryTurn,
  type CodexSessionHistory,
} from '@ptah-extension/codex-runtime';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { CODEX_FAILURE_NOTICE, CodexChatEvents } from './codex-chat-events';
import { HistoryEventFactory } from '../helpers/history/history-event-factory';

export interface CodexHistoryProjection {
  readonly events: FlatStreamEventUnion[];
  /** thread/read does not report token usage. */
  readonly stats: null;
  readonly skippedItems: readonly {
    threadId: string;
    turnId: string;
    itemId: string;
    reason: string;
  }[];
}

type HistoryItem = CodexHistoryTurn['items'][number];
function millis(value: number | null | undefined, fallback: number): number {
  if (value == null) return fallback;
  return value < 100_000_000_000 ? value * 1000 : value;
}

function itemTime(turn: CodexHistoryTurn, index: number, previous: number): number {
  const entry = turn.itemEntries?.[index];
  return Math.max(previous, entry?.startedAtMs ?? entry?.completedAtMs ?? previous);
}

function createsParentCycle(
  owner: CodexHistoryThread,
  receiverId: string,
  threadsById: ReadonlyMap<string, CodexHistoryThread>,
): boolean {
  const visited = new Set<string>();
  let ancestor: CodexHistoryThread | undefined = owner;
  while (ancestor && !visited.has(ancestor.id)) {
    if (ancestor.id === receiverId) return true;
    visited.add(ancestor.id);
    ancestor = ancestor.parentThreadId ? threadsById.get(ancestor.parentThreadId) : undefined;
  }
  return false;
}

/**
 * Replays a fully hydrated native snapshot through the same two mappers as the
 * live stream. The schema fixture is hand-built; pinned-binary replay is UNCONFIRMED.
 */
export function projectCodexHistory(
  sessionId: string,
  snapshot: CodexSessionHistory,
): CodexHistoryProjection {
  const collected: { event: FlatStreamEventUnion; ordinal: number }[] = [];
  const skippedItems: CodexHistoryProjection['skippedItems'][number][] = [];
  let ordinal = 0;
  const push = (events: readonly FlatStreamEventUnion[]) => {
    for (const event of events) collected.push({ event, ordinal: ordinal++ });
  };
  const parentTool = new Map<string, string>();
  const threadsById = new Map(snapshot.threads.map((thread) => [thread.id, thread]));
  const knownTimes = snapshot.threads.flatMap((thread) => [
    millis(thread.createdAt, Number.POSITIVE_INFINITY),
    ...thread.turns.map((turn) => millis(turn.startedAt, Number.POSITIVE_INFINITY)),
  ]);
  const fallbackTime = Math.min(...knownTimes);
  for (const thread of snapshot.threads) {
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (item.type === 'collabAgentToolCall') {
          for (const childId of item.receiverThreadIds) {
            const child = threadsById.get(childId);
            if (childId === snapshot.rootThreadId || !child?.parentThreadId || createsParentCycle(thread, childId, threadsById)) continue;
            const previous = parentTool.get(childId);
            if (!previous || item.tool === 'spawnAgent')
              parentTool.set(childId, item.id);
          }
        }
      }
    }
  }

  for (const thread of snapshot.threads) {
    let threadTime = millis(thread.createdAt, Number.isFinite(fallbackTime) ? fallbackTime : 0);
    const parentThreadId = thread.id === snapshot.rootThreadId ? null : thread.parentThreadId;
    const linked = parentThreadId ? parentTool.get(thread.id) : undefined;
    const parentToolUseId = linked
      ?? (parentThreadId
        ? JSON.stringify([parentThreadId, thread.id, 'unresolved-parent-tool'])
        : undefined);
    if (parentThreadId && !linked)
      skippedItems.push({ threadId: thread.id, turnId: thread.turns[0]?.id ?? '', itemId: thread.id, reason: 'unresolvedParentTool' });
    for (const turn of thread.turns) {
      threadTime = projectTurn(thread, turn, sessionId, parentToolUseId, parentTool, threadTime, push, skippedItems);
    }
  }
  collected.sort((a, b) => a.event.timestamp - b.event.timestamp || a.ordinal - b.ordinal);
  return { events: collected.map(({ event }) => event), stats: null, skippedItems };
}

function projectTurn(
  thread: CodexHistoryThread,
  turn: CodexHistoryTurn,
  sessionId: string,
  parentToolUseId: string | undefined,
  parentTool: ReadonlyMap<string, string>,
  fallbackTime: number,
  push: (events: readonly FlatStreamEventUnion[]) => void,
  skipped: CodexHistoryProjection['skippedItems'][number][],
): number {
  const turnStart = Math.max(fallbackTime, millis(turn.startedAt, fallbackTime));
  const messageId = JSON.stringify([thread.id, turn.id]);
  const identity = { contextId: 'history', processGeneration: 0, threadId: thread.id, turnId: turn.id };
  const translator = new CodexEventTranslator(identity.contextId, identity.processGeneration);
  let timestamp = turnStart;
  let assistantStarted = false;
  const completeContent: FlatStreamEventUnion[] = [];
  const skip = (itemId: string, reason: string) => {
    if (!skipped.some((entry) => entry.threadId === thread.id && entry.turnId === turn.id && entry.itemId === itemId && entry.reason === reason))
      skipped.push({ threadId: thread.id, turnId: turn.id, itemId, reason });
  };
  const projection = new CodexChatEvents(sessionId, identity, {
    result: () => undefined,
    content: ({ itemId, text, kind, blockIndex }) => {
      const contentEvent = {
        id: JSON.stringify([thread.id, turn.id, itemId, `${kind}-final`]),
        source: 'complete' as const, timestamp, sessionId, messageId,
        blockIndex, delta: text,
        ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
      };
      completeContent.push(kind === 'text'
        ? { ...contentEvent, eventType: 'text_delta' }
        : { ...contentEvent, eventType: 'thinking_delta' });
    },
    live: () => undefined,
    compaction: () => undefined,
    error: () => undefined,
  }, () => timestamp);
  const emit = (method: 'item/started' | 'item/completed', item: HistoryItem) => {
    const translated = translator.translate({
      method,
      params: {
        threadId: thread.id,
        turnId: turn.id,
        item,
        ...(method === 'item/started'
          ? { startedAtMs: timestamp }
          : { completedAtMs: timestamp }),
      },
    });
    for (const event of translated) {
      if (event.type === 'error') {
        skip(item.id, event.error.code);
        continue;
      }
      if (event.type === 'reasoning' && event.phase === 'final' && event.text === '') continue;
      if (event.type === 'compaction') {
        skip(item.id, 'compactionNotPresented');
        continue;
      }
      // Live streamed async questions show their assistant text; replay has no
      // delta notification, so supply the same presentation hint to the mapper.
      const presented = event.type === 'userInputAsync' ? { ...event, presentation: 'text' as const } : event;
      if (event.type === 'userInputAsync' && event.questions.length > 0)
        skip(item.id, 'asyncQuestionsNotPresented');
      const mapped = projection.map(presented);
      if (mapped.some((entry) => entry.eventType === 'message_start')) assistantStarted = true;
      push(mapped.map((entry, index) => ({
        ...entry,
        id: entry.eventType === 'message_start'
          ? entry.id
          : JSON.stringify([thread.id, turn.id, item.id, entry.eventType, method, index]),
        ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
      })));
      if (completeContent.length) push(completeContent.splice(0));
      if (item.type === 'collabAgentToolCall' && event.type === 'toolStarted') {
        for (const childId of item.receiverThreadIds.filter((id) => parentTool.get(id) === item.id)) push([{
          ...new HistoryEventFactory().createAgentStart(sessionId, messageId, item.id, {}, 0, timestamp, parentToolUseId, childId),
          id: JSON.stringify([thread.id, turn.id, item.id, childId, 'agent-start']),
        }]);
      }
    }
  };
  turn.items.forEach((item, index) => {
    timestamp = itemTime(turn, index, timestamp);
    if (item.type === 'userMessage') {
      // Older-page cursors accept only URL-safe message ids; keep this stable
      // across full thread reads without changing assistant live-stream ids.
      const userId = createHash('sha256')
        .update(JSON.stringify([thread.id, turn.id, item.id]))
        .digest('base64url');
      const texts = item.content.filter((part) => part.type === 'text');
      const imageCount = item.content.filter((part) => part.type === 'image' || part.type === 'localImage').length;
      for (const part of item.content) {
        if (part.type !== 'text' && part.type !== 'image' && part.type !== 'localImage')
          skip(item.id, `unsupportedUserContent:${part.type}`);
      }
      push([{
        id: `${userId}:start`, messageId: userId, sessionId, timestamp,
        source: 'history', eventType: 'message_start', role: 'user',
        ...(item.clientId == null ? {} : { clientMessageId: item.clientId }),
        ...(imageCount ? { imageCount } : {}),
        ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
      }]);
      texts.forEach((part, textIndex) => push([{
        id: `${userId}:text:${textIndex}`, messageId: userId, sessionId, timestamp,
        source: 'history', eventType: 'text_delta', delta: part.text, blockIndex: textIndex,
        ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
      }]));
      push([{
        id: `${userId}:complete`, messageId: userId, sessionId, timestamp,
        source: 'history', eventType: 'message_complete',
        ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
      }]);
      return;
    }
    // The live translator needs both notifications to retain tool names and
    // produce the same tool_start/tool_result pair as an active turn.
    emit('item/started', item);
    emit('item/completed', item);
  });
  if (turn.status === 'failed' && !assistantStarted) {
    push([{
      id: `${messageId}:start`, eventType: 'message_start', source: 'history',
      timestamp, sessionId, messageId, role: 'assistant',
      ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
    }]);
    assistantStarted = true;
  }
  if (assistantStarted) {
    timestamp = Math.max(timestamp, millis(turn.completedAt, timestamp));
    if (turn.status === 'failed') push([{
      id: JSON.stringify([thread.id, turn.id, 'failure-text']),
      eventType: 'text_delta', source: 'complete', timestamp, sessionId, messageId,
       delta: CODEX_FAILURE_NOTICE, blockIndex: turn.items.length,
      ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
    }]);
    const terminal = projection.map({
      ...identity, sequence: Number.MAX_SAFE_INTEGER, type: 'terminal',
      status: turn.status === 'inProgress' ? 'interrupted' : turn.status,
    });
    push(terminal.map((entry) => ({
      ...entry, id: JSON.stringify([thread.id, turn.id, 'terminal', entry.eventType]),
      ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
    })));
  }
  translator.dispose();
  return timestamp;
}
