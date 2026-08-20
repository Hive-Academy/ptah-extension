import type { ExecutionChatMessage } from '@ptah-extension/shared';

/**
 * Compaction noise filter — hides post-compaction user messages that the
 * Claude SDK emits as side-effects of `/compact`:
 *  1. The slash-command echo (`/compact ...`)
 *  2. The ANSI-wrapped hook status (`[2mCompacted PreCompact … completed successfully[22m`)
 * The continuation summary itself ("This session is being continued …") is
 * kept and rendered collapsed by `MessageBubbleComponent`.
 */
export function isCompactionNoiseUserMessage(
  msg: ExecutionChatMessage,
): boolean {
  if (msg.role !== 'user') return false;
  const raw = (msg.rawContent ?? '').trim();
  if (!raw) return false;
  if (/^\/compact\b/i.test(raw)) return true;
  if (/Compacted\s+\w+\s+\[callback\]\s+completed successfully/i.test(raw)) {
    return true;
  }
  return false;
}

export function filterCompactionNoise(
  msgs: readonly ExecutionChatMessage[],
): readonly ExecutionChatMessage[] {
  if (!msgs.some(isCompactionNoiseUserMessage)) return msgs;
  return msgs.filter((m) => !isCompactionNoiseUserMessage(m));
}
