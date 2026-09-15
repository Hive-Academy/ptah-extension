import { randomUUID } from 'crypto';
import type { ElementHandle, Page } from '@playwright/test';
import { expect } from './fixtures';
import type { UiDriver } from './ui-driver';

export interface GeneratedEvent {
  readonly id: string;
  readonly eventType: string;
  readonly timestamp: number;
  readonly sessionId: string;
  readonly source: 'history';
  readonly messageId: string;
  readonly role?: 'user' | 'assistant';
  readonly blockIndex?: number;
  readonly delta?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isTaskTool?: boolean;
  readonly output?: string;
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
  };
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
): Promise<void> {
  const resumePayloadBySession: Record<string, unknown> = {};
  for (const session of sessions) {
    resumePayloadBySession[session.id] = {
      events: session.events,
      stats: {
        totalCost: 12.5,
        tokens: {
          input: 400_000,
          output: 60_000,
          cacheRead: 0,
          cacheCreation: 0,
        },
        messageCount: session.actualCount,
      },
    };
  }

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
    // Keyed by resolved session id so each resume gets its own marker. The UI
    // driver memoizes the compiled resolver, so this compiles once per test.
    'chat:resume': `(params) => (${JSON.stringify(resumePayloadBySession)})[params.sessionId] ?? { events: [] }`,
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
): Promise<void> {
  await mockSessions(ui, sessions);
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
