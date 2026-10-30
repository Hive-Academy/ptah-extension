import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import type {
  StreamingAccumulatorCore,
  AccumulatorContext,
} from './accumulator-core.service';
import type { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { capFinalizedTree } from './execution-tree-retention';
import { ENTRY_EVENT_CAP } from './subagent-execution-retention';
import type { SubagentExecutionEntry } from './subagent-execution.store';

const BLOCK_EVENT_TYPES = new Set([
  'text_delta',
  'thinking_delta',
  'thinking_start',
  'tool_start',
  'tool_delta',
  'tool_result',
]);
const SKIPPABLE_LIVE_TYPES = new Set(['message_start', ...BLOCK_EVENT_TYPES]);

function blockIdentity(event: FlatStreamEventUnion): string {
  const kind = event.eventType.startsWith('tool_')
    ? 'tool'
    : event.eventType.startsWith('thinking_')
      ? 'thinking'
      : 'text';
  return `${event.messageId}:${kind}:${event.toolCallId ?? event.blockIndex ?? 0}`;
}

/** Concatenated text per message, in event order. */
function messageTexts(
  events: readonly FlatStreamEventUnion[],
): Map<string, string> {
  const texts = new Map<string, string>();
  for (const event of events) {
    if (event.eventType !== 'text_delta') continue;
    texts.set(
      event.messageId,
      (texts.get(event.messageId) ?? '') + event.delta,
    );
  }
  return texts;
}

/**
 * Live text-only messages that the snapshot carries under another message id.
 * A message with a tool is matched by its tool id instead (see `idAlias`).
 */
function repeatedTextMessages(
  liveEvents: readonly FlatStreamEventUnion[],
  snapshot: readonly FlatStreamEventUnion[],
  snapshotIds: ReadonlySet<string>,
): Set<string> {
  const snapshotTexts = new Set(messageTexts(snapshot).values());
  const withTools = new Set(
    liveEvents
      .filter((event) => event.eventType.startsWith('tool_'))
      .map((event) => event.messageId),
  );
  const repeated = new Set<string>();
  for (const [messageId, text] of messageTexts(liveEvents)) {
    if (
      text &&
      !snapshotIds.has(messageId) &&
      !withTools.has(messageId) &&
      snapshotTexts.has(text)
    )
      repeated.add(messageId);
  }
  return repeated;
}

export interface MergeSubagentHistoryOptions {
  /**
   * Drop a live text-only message whose text the snapshot already holds
   * under its replay id. A live refresh sets it: the stream and the
   * transcript can name one message differently, and a repeated refresh
   * would otherwise show its text twice.
   */
  readonly dropRepeatedText?: boolean;
}

export function rewriteSubagentEvent(
  event: FlatStreamEventUnion,
  aliases: ReadonlyMap<string, string>,
): FlatStreamEventUnion {
  const messageId = aliases.get(event.messageId);
  return messageId ? { ...event, messageId } : event;
}

export function mergeSubagentHistory(
  key: string,
  entry: SubagentExecutionEntry,
  snapshot: readonly FlatStreamEventUnion[],
  accumulator: StreamingAccumulatorCore,
  builder: ExecutionTreeBuilderService,
  context: AccumulatorContext,
  options: MergeSubagentHistoryOptions = {},
): boolean {
  const fresh = createEmptyStreamingState();
  fresh.eventCap = ENTRY_EVENT_CAP;
  const ctx = { ...context, deduplication: new EventDeduplicationService() };
  // Truncation is reported only for a REAL eviction: a processed event that
  // was absent, was inserted into `fresh.events`, and found the state already
  // at its cap. `stateMutated` alone is not evidence — store-only event types
  // mutate monitor state without ever entering `fresh.events` (PR #751
  // review 4309313437).
  let evicted = false;
  const apply = (event: FlatStreamEventUnion): void => {
    const wasPresent = fresh.events.has(event.id);
    const atCap = fresh.events.size >= ENTRY_EVENT_CAP;
    const result = accumulator.process(fresh, event, ctx);
    if (
      atCap &&
      !wasPresent &&
      result.stateMutated &&
      fresh.events.has(event.id)
    )
      evicted = true;
  };
  for (const event of snapshot) apply(event);

  const snapshotIds = new Set(
    snapshot
      .filter((event) => event.eventType === 'message_start')
      .map((event) => event.messageId),
  );
  const snapshotTools = new Map<string, string>();
  const snapshotBlocks = new Set<string>();
  for (const event of snapshot) {
    if (event.eventType === 'tool_start')
      snapshotTools.set(event.toolCallId, event.messageId);
    if (BLOCK_EVENT_TYPES.has(event.eventType))
      snapshotBlocks.add(blockIdentity(event));
  }

  const live = entry.state;
  if (live) {
    const liveEvents = [...live.events.values()];
    const repeated = options.dropRepeatedText
      ? repeatedTextMessages(liveEvents, snapshot, snapshotIds)
      : new Set<string>();
    for (const event of liveEvents) {
      if (snapshotIds.has(event.messageId)) continue;
      if (event.eventType === 'tool_start') {
        const id = snapshotTools.get(event.toolCallId);
        if (id) entry.idAlias.set(event.messageId, id);
      }
    }
    for (const event of liveEvents) {
      if (repeated.has(event.messageId)) continue;
      const mapped = rewriteSubagentEvent(event, entry.idAlias);
      const matched = snapshotIds.has(mapped.messageId);
      // A repeated live refresh finds the previous snapshot in the live
      // state; the new snapshot already carries those messages.
      if (matched && event.source === 'history') continue;
      if (
        matched &&
        event.source === 'stream' &&
        SKIPPABLE_LIVE_TYPES.has(event.eventType) &&
        (event.eventType === 'message_start' ||
          snapshotBlocks.has(blockIdentity(mapped)))
      ) {
        continue;
      }
      apply(mapped);
    }
    entry.state = fresh;
  } else if (!entry.live) {
    entry.finalized = builder
      .buildTree(fresh, `subagent-${key}`, {
        rootParentToolUseId: key,
      })
      .map(capFinalizedTree);
  } else {
    entry.state = fresh;
  }
  builder.clearCache(`subagent-${key}`);
  return evicted;
}
