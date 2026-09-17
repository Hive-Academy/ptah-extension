import type { FlatStreamEventUnion } from '../types/execution';

/** Event budget for the initial history tail requested by the renderer. */
export const HISTORY_TAIL_PAGE_EVENTS = 250;

/** Default event budget for an older-history page. */
export const HISTORY_PAGE_DEFAULT_EVENTS = 250;

/** Maximum event budget accepted at the history paging boundary. */
export const HISTORY_PAGE_MAX_EVENTS = 2000;

const HISTORY_CURSOR_PATTERN = /^h1:([A-Za-z0-9_-]{1,512})$/;

export interface HistoryPageSelectionOptions {
  /** Exclusive end index in the full replayable event list. */
  readonly endIndex: number;
  /** Preferred maximum; a single whole turn may exceed it. */
  readonly maxEvents: number;
}

export interface HistoryPageSelection {
  readonly events: FlatStreamEventUnion[];
  readonly olderCursor: string | null;
}

/** Raised when a cursor does not use the supported opaque wire format. */
export class HistoryCursorInvalidError extends Error {
  constructor() {
    super('Invalid history cursor');
    this.name = 'HistoryCursorInvalidError';
  }
}

/** Raised when a valid cursor no longer identifies a replayable turn. */
export class HistoryCursorStaleError extends Error {
  constructor() {
    super('History cursor is stale');
    this.name = 'HistoryCursorStaleError';
  }
}

/** Raised when page selection receives an invalid event budget. */
export class HistoryPageInvalidOptionsError extends Error {
  constructor() {
    super('History page maxEvents must be a positive finite integer');
    this.name = 'HistoryPageInvalidOptionsError';
  }
}

function isRootUserTurnStart(event: FlatStreamEventUnion): boolean {
  return (
    event.eventType === 'message_start' &&
    event.role === 'user' &&
    !event.parentToolUseId
  );
}

/** Encode a root user message id as an opaque history cursor. */
export function encodeHistoryCursor(messageId: string): string {
  return `h1:${messageId}`;
}

/** Decode and validate an opaque history cursor. */
export function decodeHistoryCursor(cursor: string): string {
  const match = HISTORY_CURSOR_PATTERN.exec(cursor);
  if (!match) {
    throw new HistoryCursorInvalidError();
  }
  return match[1];
}

/**
 * Resolve a cursor to the exclusive end index for the next older page.
 * Only root user starts are valid anchors; nested agent messages cannot form
 * page boundaries.
 */
export function resolveHistoryCursorEndIndex(
  events: readonly FlatStreamEventUnion[],
  cursor: string,
): number {
  const messageId = decodeHistoryCursor(cursor);
  const index = events.findIndex(
    (event) => isRootUserTurnStart(event) && event.messageId === messageId,
  );
  if (index === -1) {
    throw new HistoryCursorStaleError();
  }
  return index;
}

/**
 * Select a backwards page without splitting a root user turn, tool pair or
 * nested agent subtree. Index 0 is always treated as an implicit turn start,
 * including for an assistant-first transcript. The scan is linear in the
 * selected history prefix.
 */
export function selectHistoryPage(
  events: readonly FlatStreamEventUnion[],
  options: HistoryPageSelectionOptions,
): HistoryPageSelection {
  if (
    !Number.isFinite(options.maxEvents) ||
    !Number.isInteger(options.maxEvents) ||
    options.maxEvents < 1
  ) {
    throw new HistoryPageInvalidOptionsError();
  }

  const endIndex = Math.min(options.endIndex, events.length);
  if (events.length === 0 || endIndex <= 0) {
    return { events: [], olderCursor: null };
  }

  let startIndex = 0;
  let foundNewestTurnStart = false;

  for (let index = endIndex - 1; index > 0; index -= 1) {
    if (!isRootUserTurnStart(events[index])) {
      continue;
    }

    if (!foundNewestTurnStart) {
      startIndex = index;
      foundNewestTurnStart = true;
      continue;
    }

    if (endIndex - index > options.maxEvents) {
      break;
    }
    startIndex = index;
  }

  if (!foundNewestTurnStart || endIndex <= options.maxEvents) {
    startIndex = 0;
  }

  return {
    events: events.slice(startIndex, endIndex),
    olderCursor:
      startIndex > 0 ? encodeHistoryCursor(events[startIndex].messageId) : null,
  };
}
