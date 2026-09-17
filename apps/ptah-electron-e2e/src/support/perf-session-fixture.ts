import { randomUUID } from 'crypto';
import type { ElementHandle, Page } from '@playwright/test';
import {
  encodeHistoryCursor,
  HISTORY_PAGE_DEFAULT_EVENTS,
  HISTORY_TAIL_PAGE_EVENTS,
  selectHistoryPage,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { expect } from './fixtures';
import type { UiDriver } from './ui-driver';

export interface GeneratedEvent {
  readonly id: string;
  readonly eventType:
    | 'message_start'
    | 'text_delta'
    | 'tool_start'
    | 'tool_result'
    | 'message_complete';
  readonly timestamp: number;
  readonly sessionId: string;
  readonly source: 'history';
  readonly messageId: string;
  readonly parentToolUseId?: string;
  readonly role?: 'user' | 'assistant';
  readonly blockIndex?: number;
  readonly delta?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isTaskTool?: boolean;
  readonly output?: unknown;
  readonly isError?: boolean;
  readonly stopReason?: string;
  readonly tokenUsage?: { input: number; output: number };
}

export interface SessionFixture {
  readonly id: string;
  readonly name: string;
  readonly marker: string;
  readonly events: GeneratedEvent[];
  readonly actualCount: number;
  readonly paging: SessionPagingFixture;
}

export interface HistoryPageFixture {
  readonly events: readonly FlatStreamEventUnion[];
  readonly olderCursor: string | null;
  readonly resumableSubagents: readonly [];
}

export interface SessionPagingFixture {
  readonly tail: HistoryPageFixture;
  readonly olderPages: Readonly<Record<string, HistoryPageFixture>>;
}

export interface PrepareCanvasOptions {
  /**
   * Whether the backend honors the additive paging request. Defaults to true;
   * false simulates an older backend that returns full history.
   */
  readonly supportsPaging?: boolean;
}

/** Deterministic LCG keyed by session id. */
export function makeRand(seedStr: string): () => number {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) % 2_147_483_647;
  }
  if (seed <= 0) seed += 2_147_483_646;
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % 1000;
  };
}

/** Builds one deterministic, chronological session-history event stream. */
export function buildLargeSessionEvents(
  sessionId: string,
  marker: string,
  targetEvents: number,
): { events: GeneratedEvent[]; actualCount: number } {
  const rand = makeRand(sessionId);
  const events: GeneratedEvent[] = [];
  let ts = Date.now();
  let turn = 0;

  const push = (
    partial: Omit<GeneratedEvent, 'id' | 'timestamp' | 'sessionId' | 'source'>,
  ): void => {
    events.push({
      id: randomUUID(),
      timestamp: ts++,
      sessionId,
      source: 'history',
      ...partial,
    });
  };

  while (events.length < targetEvents) {
    const userId = `u-${turn}`;
    const assistantId = `a-${turn}`;
    // Preserve the fixture's random-call order while sizing the exact turn
    // before emitting it. A turn is 4 fixed events, N deltas and 2M tools.
    const deltaCount = 2 + (rand() % 3);
    const toolCount = 1 + (rand() % 2);
    const turnSize = 4 + deltaCount + 2 * toolCount;
    const isFinalTurn = events.length + turnSize >= targetEvents;

    push({ eventType: 'message_start', messageId: userId, role: 'user' });
    push({
      eventType: 'text_delta',
      messageId: userId,
      blockIndex: 0,
      delta: `Turn ${turn}: please continue and re-check the build output.`,
    });
    push({
      eventType: 'message_start',
      messageId: assistantId,
      role: 'assistant',
    });
    for (let i = 0; i < deltaCount; i++) {
      push({
        eventType: 'text_delta',
        messageId: assistantId,
        blockIndex: 0,
        delta:
          isFinalTurn && i === deltaCount - 1
            ? marker
            : `partial response chunk ${turn}.${i} covering the requested change `,
      });
    }
    for (let i = 0; i < toolCount; i++) {
      const toolCallId = `tc-${turn}-${i}`;
      push({
        eventType: 'tool_start',
        messageId: assistantId,
        toolCallId,
        toolName: 'Read',
        isTaskTool: false,
      });
      push({
        eventType: 'tool_result',
        messageId: assistantId,
        toolCallId,
        output: 'ok',
        isError: false,
      });
    }
    push({
      eventType: 'message_complete',
      messageId: assistantId,
      stopReason: 'end_turn',
      tokenUsage: { input: 100 + turn, output: 50 + turn },
    });
    turn++;
  }

  return { events, actualCount: events.length };
}

export function makeSessionFixture(
  label: string,
  targetEvents: number,
): SessionFixture {
  const id = randomUUID();
  const marker = `PTAH_E2E_AC11_${label}_MARKER`;
  const { events, actualCount } = buildLargeSessionEvents(
    id,
    marker,
    targetEvents,
  );
  return {
    id,
    name: `AC-11 perf session ${label}`,
    marker,
    events,
    actualCount,
    paging: buildPagingFixture(events),
  };
}

/**
 * Builds two event-heavy but visually short turns for the pinned-prepend case.
 * Empty deltas exercise paging without making the transcript scrollable.
 */
export function makeSparsePagingSessionFixture(label: string): SessionFixture {
  const id = randomUUID();
  const marker = `PTAH_E2E_SPARSE_${label}_MARKER`;
  const events: GeneratedEvent[] = [];
  let timestamp = Date.now();
  const push = (
    event: Omit<GeneratedEvent, 'id' | 'timestamp' | 'sessionId' | 'source'>,
  ): void => {
    events.push({
      id: randomUUID(),
      timestamp: timestamp++,
      sessionId: id,
      source: 'history',
      ...event,
    });
  };

  for (let turn = 0; turn < 2; turn++) {
    const userId = `sparse-u-${turn}`;
    const assistantId = `sparse-a-${turn}`;
    push({ eventType: 'message_start', messageId: userId, role: 'user' });
    push({
      eventType: 'text_delta',
      messageId: userId,
      blockIndex: 0,
      delta: `Sparse turn ${turn}`,
    });
    push({
      eventType: 'message_start',
      messageId: assistantId,
      role: 'assistant',
    });
    for (let index = 0; index < 140; index++) {
      push({
        eventType: 'text_delta',
        messageId: assistantId,
        blockIndex: 0,
        delta: turn === 1 && index === 139 ? marker : '',
      });
    }
    push({
      eventType: 'message_complete',
      messageId: assistantId,
      stopReason: 'end_turn',
      tokenUsage: { input: 1, output: 1 },
    });
  }

  return {
    id,
    name: `Sparse paging session ${label}`,
    marker,
    events,
    actualCount: events.length,
    paging: buildPagingFixture(events),
  };
}

function buildPagingFixture(
  events: readonly GeneratedEvent[],
): SessionPagingFixture {
  const typedEvents = events.map(toFlatStreamEvent);
  const tail = selectHistoryPage(typedEvents, {
    endIndex: typedEvents.length,
    maxEvents: HISTORY_TAIL_PAGE_EVENTS,
  });
  const olderPages: Record<string, HistoryPageFixture> = {};
  let cursor = tail.olderCursor;

  while (cursor !== null) {
    const endIndex = typedEvents.findIndex(
      (event) =>
        event.eventType === 'message_start' &&
        event.role === 'user' &&
        !event.parentToolUseId &&
        encodeHistoryCursor(event.messageId) === cursor,
    );
    if (endIndex < 0) {
      throw new Error(
        `[AC-11 perf] precomputed history cursor does not resolve: ${cursor}`,
      );
    }
    const page = selectHistoryPage(typedEvents, {
      endIndex,
      maxEvents: HISTORY_PAGE_DEFAULT_EVENTS,
    });
    olderPages[cursor] = {
      events: page.events,
      olderCursor: page.olderCursor,
      resumableSubagents: [],
    };
    cursor = page.olderCursor;
  }

  return {
    tail: {
      events: tail.events,
      olderCursor: tail.olderCursor,
      resumableSubagents: [],
    },
    olderPages,
  };
}

function toFlatStreamEvent(event: GeneratedEvent): FlatStreamEventUnion {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    source: event.source,
    messageId: event.messageId,
    parentToolUseId: event.parentToolUseId,
  } as const;

  switch (event.eventType) {
    case 'message_start':
      if (event.role === undefined) {
        throw new Error(`message_start ${event.id} is missing role`);
      }
      return { ...base, eventType: event.eventType, role: event.role };
    case 'text_delta':
      if (event.blockIndex === undefined || event.delta === undefined) {
        throw new Error(
          `text_delta ${event.id} is missing blockIndex or delta`,
        );
      }
      return {
        ...base,
        eventType: event.eventType,
        blockIndex: event.blockIndex,
        delta: event.delta,
      };
    case 'tool_start':
      if (
        event.toolCallId === undefined ||
        event.toolName === undefined ||
        event.isTaskTool === undefined
      ) {
        throw new Error(
          `tool_start ${event.id} is missing toolCallId, toolName, or isTaskTool`,
        );
      }
      return {
        ...base,
        eventType: event.eventType,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isTaskTool: event.isTaskTool,
      };
    case 'tool_result':
      if (event.toolCallId === undefined || event.isError === undefined) {
        throw new Error(
          `tool_result ${event.id} is missing toolCallId or isError`,
        );
      }
      return {
        ...base,
        eventType: event.eventType,
        toolCallId: event.toolCallId,
        output: event.output,
        isError: event.isError,
      };
    case 'message_complete':
      return {
        ...base,
        eventType: event.eventType,
        stopReason: event.stopReason,
        tokenUsage: event.tokenUsage,
      };
  }
}

export function diagnosticEventCount(raw: string | undefined): number {
  if (raw === undefined) return 2_000;
  const parsed = Number(raw);
  if (parsed !== 500 && parsed !== 1_000 && parsed !== 2_000) {
    throw new Error(
      `[AC-11 perf] PTAH_PERF_EVENTS must be 500, 1000, or 2000; received "${raw}"`,
    );
  }
  return parsed;
}

/** Registers `session:list` + `chat:resume` mocks for every given fixture. */
async function mockSessions(
  ui: UiDriver,
  sessions: readonly SessionFixture[],
  options: PrepareCanvasOptions = {},
): Promise<void> {
  const payloadBySession: Record<string, unknown> = {};
  for (const session of sessions) {
    const stats = {
      totalCost: 12.5,
      tokens: {
        input: 400_000,
        output: 60_000,
        cacheRead: 0,
        cacheCreation: 0,
      },
      messageCount: session.actualCount,
    };
    payloadBySession[session.id] = {
      full: { events: session.events, stats },
      tail: {
        events: session.paging.tail.events,
        stats,
        historyPage: { olderCursor: session.paging.tail.olderCursor },
      },
      olderPages: session.paging.olderPages,
    };
  }

  const serialized = JSON.stringify(payloadBySession);
  const { supportsPaging = true } = options;
  await ui.mockRpc({
    'session:list': {
      sessions: sessions.map((session, index) => ({
        id: session.id,
        name: session.name,
        messageCount: session.actualCount,
        createdAt: Date.now() - (sessions.length - index) * 1000,
        lastActivityAt: Date.now() - (sessions.length - index) * 1000,
        isActive: false,
      })),
      total: sessions.length,
      hasMore: false,
    },
    'session:validate': { exists: true },
    // The shared pager runs above in Node. These renderer-evaluated resolvers
    // only select precomputed JSON, preserving the backend contract without
    // duplicating the page-selection algorithm in a stringified function.
    'chat:resume': `(params) => { const fixture = (${serialized})[params.sessionId]; if (!fixture) return { events: [] }; return params.historyPage && ${String(supportsPaging)} ? fixture.tail : fixture.full; }`,
    // UiDriver wraps every resolver return value in an outer success:true
    // envelope, so it cannot faithfully represent HISTORY_CURSOR_STALE here.
    // The dedicated stale-cursor spec swaps the IPC listener to send the real
    // failure envelope. Throw loudly for any other unknown cursor so no caller
    // can mistake a malformed successful payload for a history page.
    'chat:history-page': `(params) => { const fixture = (${serialized})[params.sessionId]; const page = fixture && fixture.olderPages[params.cursor]; if (!page) throw new Error('[AC-11 perf] HISTORY_CURSOR_STALE: unknown precomputed history cursor'); return page; }`,
  });
}

/** Resolves the sidebar row button without matching its rename/delete buttons. */
export function sessionRowButton(page: Page, name: string) {
  return page
    .locator('li[role="listitem"]')
    .filter({ hasText: name })
    .getByRole('button')
    .first();
}

/** Opens the canvas, mocks the sessions, and waits for their sidebar rows. */
export async function prepareCanvasWithSessions(
  ui: UiDriver,
  sessions: readonly SessionFixture[],
  options: PrepareCanvasOptions = {},
): Promise<void> {
  await mockSessions(ui, sessions, options);
  // `chat` would create an unrelated draft tile; `canvas` does not.
  await ui.goto('canvas');
  // The initial list fetch precedes mock registration, so trigger the same
  // debounced metadata refresh used by the application.
  await ui.pushEvent({ type: 'session:metadataChanged', payload: {} });

  for (const session of sessions) {
    await expect(sessionRowButton(ui.page, session.name)).toBeVisible();
  }
}

/** Waits for a tile carrying `marker`'s own tool-output bubble to render. */
export async function waitForTileMarker(
  page: Page,
  marker: string,
): Promise<void> {
  const tiles = page.locator('[data-testid="canvas-tile"]');
  await expect(
    tiles
      .filter({ hasText: marker })
      .locator('[data-testid="chat-tool-output"]', { hasText: marker }),
  ).toBeVisible({ timeout: 20_000 });
}

/** Resolves sidebar handles before the measured window opens. */
export async function resolveButtonHandles(
  page: Page,
  sessions: readonly SessionFixture[],
): Promise<ElementHandle<HTMLElement>[]> {
  const handles: ElementHandle<HTMLElement>[] = [];
  for (const session of sessions) {
    const handle = await sessionRowButton(page, session.name).elementHandle();
    if (!handle) {
      throw new Error(
        `[AC-11 perf] sessionRowButton element handle not found for "${session.name}"`,
      );
    }
    handles.push(handle as ElementHandle<HTMLElement>);
  }
  return handles;
}
