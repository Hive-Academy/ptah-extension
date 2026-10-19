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
    for (const event of liveEvents) {
      if (snapshotIds.has(event.messageId)) continue;
      if (event.eventType === 'tool_start') {
        const id = snapshotTools.get(event.toolCallId);
        if (id) entry.idAlias.set(event.messageId, id);
      }
    }
    for (const event of liveEvents) {
      const mapped = rewriteSubagentEvent(event, entry.idAlias);
      const matched = snapshotIds.has(mapped.messageId);
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
