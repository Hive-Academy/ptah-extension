import type {
  ChatQueuedMessageStateEvent,
  QueuedFollowUpSnapshot,
  QueuedFollowUpState,
} from '@ptah-extension/shared';

const STATES: ReadonlySet<QueuedFollowUpState> = new Set([
  'queued',
  'delivered',
  'withdrawn',
  'failed',
  'steered',
]);

const MAX_REASON_LENGTH = 300;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate a `chat:queued-message-state` push (external input) before it
 * reaches view state. Returns `null` for anything malformed.
 */
export function parseQueuedMessageStateEvent(
  payload: unknown,
): ChatQueuedMessageStateEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (
    !isNonEmptyString(raw['sessionId']) ||
    !isNonEmptyString(raw['tabId']) ||
    !isNonEmptyString(raw['clientMessageId']) ||
    !STATES.has(raw['state'] as QueuedFollowUpState)
  ) {
    return null;
  }
  const reason = raw['reason'];
  return {
    sessionId: raw['sessionId'] as ChatQueuedMessageStateEvent['sessionId'],
    tabId: raw['tabId'],
    clientMessageId: raw['clientMessageId'],
    state: raw['state'] as QueuedFollowUpState,
    ...(typeof reason === 'string' && reason.trim()
      ? { reason: reason.trim().slice(0, MAX_REASON_LENGTH) }
      : {}),
  };
}

/** Keep only well-formed held items of a `chat:queued-list` / `chat:abort` reply. */
export function validSnapshots(
  items: unknown,
): readonly QueuedFollowUpSnapshot[] {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is QueuedFollowUpSnapshot =>
      !!item &&
      typeof item === 'object' &&
      isNonEmptyString((item as QueuedFollowUpSnapshot).clientMessageId) &&
      typeof (item as QueuedFollowUpSnapshot).content === 'string',
  );
}
