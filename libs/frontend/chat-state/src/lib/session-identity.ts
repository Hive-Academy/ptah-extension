import type { TitleOrigin } from '@ptah-extension/chat-types';

/** Maximum display length for an automatically derived session title. */
export const AUTO_SESSION_TITLE_MAX_LENGTH = 40;

/** Exact shape emitted by frontend/core's defaultSessionName(). */
export const DEFAULT_SESSION_NAME_PATTERN = /^session-\d{2}-\d{2}-\d{2}-\d{2}$/;

/** Limit synchronous markdown cleanup work on the message-send path. */
const AUTO_SESSION_TITLE_INPUT_LIMIT = 500;

interface RoleBearingMessage {
  readonly role: string;
}

/**
 * Turn a first user message into a compact, plain-text session title.
 *
 * This intentionally handles markdown syntax without rendering HTML: title
 * derivation is state work, so it must not pull the markdown/UI sanitizer into
 * the data-access layer. Link labels and code content are retained while
 * decoration and block/list markers are removed. Angle-bracket content is
 * preserved because coding prompts use it for generics and comparisons, and
 * this value is rendered as text rather than HTML.
 */
export function deriveSessionTitle(message: string): string {
  let boundedMessage = message.slice(0, AUTO_SESSION_TITLE_INPUT_LIMIT);
  if (/[\uD800-\uDBFF]$/.test(boundedMessage)) {
    boundedMessage = boundedMessage.slice(0, -1);
  }

  const normalizedSource = boundedMessage.replace(/\s+/g, ' ').trim();
  const plainText = boundedMessage
    .replace(/```(?:[^\n]*)\n?([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(^|[^\w])__([^_\n]+?)__(?=$|[^\w])/g, '$1$2')
    .replace(/(^|[^\w])_([^_\n]+?)_(?=$|[^\w])/g, '$1$2')
    .replace(/[*~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return truncateSessionTitle(plainText || normalizedSource);
}

function truncateSessionTitle(title: string): string {
  const codePoints = Array.from(title);
  if (codePoints.length <= AUTO_SESSION_TITLE_MAX_LENGTH) return title;

  const candidate = codePoints
    .slice(0, AUTO_SESSION_TITLE_MAX_LENGTH - 1)
    .join('');
  const lastBoundary = candidate.lastIndexOf(' ');
  const cutAt =
    lastBoundary >= AUTO_SESSION_TITLE_MAX_LENGTH / 2
      ? lastBoundary
      : candidate.length;
  return `${candidate.slice(0, cutAt).trimEnd()}…`;
}

/** True only for the first user-message write on an untouched default tab. */
export function isGenuinelyNewFirstMessage(
  titleOrigin: TitleOrigin | undefined,
  existingMessages: readonly RoleBearingMessage[],
  nextMessages: readonly RoleBearingMessage[],
): boolean {
  return (
    titleOrigin === 'default' &&
    !existingMessages.some((message) => message.role === 'user') &&
    nextMessages.some((message) => message.role === 'user')
  );
}

/**
 * Derive the human workspace label from the frontend-owned workspace path.
 *
 * The path remains the canonical identity because consumers need it for
 * routing. The basename is derived here (rather than persisted per tab) so a
 * workspace move cannot leave stale duplicated labels in every tab record.
 * Both separators are supported because persisted paths can come from any
 * host OS.
 */
export function workspaceLabelFromPath(workspacePath: string): string {
  const normalized = workspacePath.replace(/[\\/]+$/, '');
  if (!normalized) return workspacePath;
  return normalized.split(/[\\/]/).pop() ?? normalized;
}
