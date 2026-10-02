import type {
  ExecutionChatMessage,
  TurnChangeSet,
} from '@ptah-extension/shared';

/** Message id → the change sets rendered right after that message, oldest first. */
export type ChangeSetAnchors = ReadonlyMap<string, readonly TurnChangeSet[]>;

export const NO_CHANGE_SET_ANCHORS: ChangeSetAnchors = new Map();

/**
 * When a message entered the transcript.
 *
 * `msg.timestamp` alone is NOT usable as a sort key for a streaming bubble:
 * `streamingMessages` builds those with no timestamp, so
 * `createExecutionChatMessage` mints a fresh `Date.now()` on every recompute
 * and the key moves under a burst of deltas. `ExecutionNode.startTime` is
 * copied from the ROOT `message_start` event (`message-node.fn.ts`), and a
 * finalized assistant message keeps the same tree
 * (`message-finalization.service.ts`), so streaming and finalized assistant
 * messages compare on one stable clock. User bubbles carry
 * `streamingState: null` and fall back to their own timestamp, minted once at
 * creation and then carried in the array.
 */
export function transcriptOrderKey(msg: ExecutionChatMessage): number {
  return msg.streamingState?.startTime ?? msg.timestamp;
}

/** First index whose key is greater than `value` (keys ascending). */
function upperBound(keys: readonly number[], value: number): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (keys[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The last assistant message that started inside the turn:
 * `turnStartedAt < key ≤ turnEndedAt`. Assistant keys come from the root
 * `message_start` event, which the backend stamps after the prompt-submit hook
 * that sets `turnStartedAt`, live and replayed alike.
 */
function anchorInTurnWindow(
  messages: readonly ExecutionChatMessage[],
  keys: readonly number[],
  changeSet: TurnChangeSet,
): string | null {
  for (
    let index = upperBound(keys, changeSet.turnEndedAt) - 1;
    index >= 0 && keys[index] > changeSet.turnStartedAt;
    index--
  ) {
    if (messages[index].role === 'assistant') return messages[index].id;
  }
  return null;
}

/**
 * Fallback when no assistant key falls in the window (a clock the two sides
 * do not share): the turn whose user message is the last one sent at or
 * before `turnStartedAt`, and in it the last assistant message before the
 * next user message. A turn whose user message is not in the transcript (an
 * unloaded older page) gets no card rather than a wrong one.
 */
function anchorAfterUserMessage(
  messages: readonly ExecutionChatMessage[],
  keys: readonly number[],
  changeSet: TurnChangeSet,
): string | null {
  let userIndex = upperBound(keys, changeSet.turnStartedAt) - 1;
  while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex--;
  if (userIndex < 0) return null;
  let anchor: string | null = null;
  for (let index = userIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'user') break;
    if (message.role === 'assistant') anchor = message.id;
  }
  return anchor;
}

/**
 * Join each turn change set to the transcript message it renders after
 * (TASK_2026_576 A7).
 *
 * Change sets are keyed by turn (`turnStartedAt`/`turnEndedAt`), not by a
 * message id: `SessionHistoryReplayer.replay` rebuilds messages from raw
 * stream events, so nothing in a replayed transcript carries a turn id. The
 * join is therefore by time — the last assistant message that started inside
 * the turn — falling back to "after the last assistant message before the
 * next user message" of the turn the prompt started. A change set that
 * matches no loaded message is not rendered.
 *
 * `messages` is the transcript order, ascending by {@link transcriptOrderKey}.
 * One pass builds the keys; each change set then costs a binary search, so a
 * recompute per streaming delta stays linear in the message count.
 */
export function anchorChangeSets(
  messages: readonly ExecutionChatMessage[],
  changeSets: readonly TurnChangeSet[],
): ChangeSetAnchors {
  if (messages.length === 0 || changeSets.length === 0) {
    return NO_CHANGE_SET_ANCHORS;
  }
  const keys = messages.map(transcriptOrderKey);
  const anchors = new Map<string, TurnChangeSet[]>();
  for (const changeSet of changeSets) {
    const anchor =
      anchorInTurnWindow(messages, keys, changeSet) ??
      anchorAfterUserMessage(messages, keys, changeSet);
    if (anchor === null) continue;
    const list = anchors.get(anchor);
    if (list) list.push(changeSet);
    else anchors.set(anchor, [changeSet]);
  }
  return anchors.size === 0 ? NO_CHANGE_SET_ANCHORS : anchors;
}
