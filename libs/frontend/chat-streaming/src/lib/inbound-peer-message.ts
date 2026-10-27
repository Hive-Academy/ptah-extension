import type { ExecutionChatMessage } from '@ptah-extension/shared';

/** An SDK transcript line uuid, the id an echoed or replayed user turn has. */
const LINE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Start of the tail: the user messages after the last non-user message. */
function tailStartIndex(messages: readonly ExecutionChatMessage[]): number {
  let tailStart = messages.length;
  while (tailStart > 0 && messages[tailStart - 1].role === 'user') {
    tailStart--;
  }
  return tailStart;
}

/** Ids of the user messages at the tail of the transcript. */
export function tailUserMessageIds(
  messages: readonly ExecutionChatMessage[],
): Set<string> {
  return new Set(messages.slice(tailStartIndex(messages)).map((m) => m.id));
}

/**
 * A prompt still waiting in the backend queue: one the person sent while a
 * turn was in flight (`queuedPromptIds`, see `QueuedPromptRecord`) and the
 * SDK has not echoed yet. Peer messages and uuid-stamped prompts never are.
 */
function isQueuedPrompt(
  message: ExecutionChatMessage,
  queuedPromptIds: ReadonlySet<string>,
): boolean {
  return (
    message.role === 'user' &&
    !message.inboundPeer &&
    queuedPromptIds.has(message.id) &&
    !message.nativeUuid &&
    !LINE_UUID_PATTERN.test(message.id)
  );
}

/**
 * Place a live inbound peer message (a lane report or lane completion that
 * starts its own SDK turn) in the transcript. Returns `null` when a message
 * with its id is already there, so a replayed start adds nothing.
 *
 * The backend input queue is FIFO, and a prompt sent while a turn was in
 * flight waits in it. If such a prompt is still at the tail when the peer turn
 * starts, it was queued BEHIND the peer, so the peer message goes before the
 * first of them. Any other tail prompt — sent while idle, or left by an
 * interrupted turn — came first, so the peer message is appended.
 */
export function insertInboundPeerMessage(
  messages: readonly ExecutionChatMessage[],
  peer: ExecutionChatMessage,
  queuedPromptIds: ReadonlySet<string>,
): ExecutionChatMessage[] | null {
  if (messages.some((message) => message.id === peer.id)) return null;
  let index = messages.length;
  for (let i = tailStartIndex(messages); i < messages.length; i++) {
    if (isQueuedPrompt(messages[i], queuedPromptIds)) {
      index = i;
      break;
    }
  }
  return [...messages.slice(0, index), peer, ...messages.slice(index)];
}
