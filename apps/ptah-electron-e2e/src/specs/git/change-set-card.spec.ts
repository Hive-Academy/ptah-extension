import { randomUUID } from 'crypto';
import type { Locator, Page } from '@playwright/test';
import type { TurnChangeSet } from '@ptah-extension/shared';
import { test, expect } from '../../support/fixtures';
import { expectNoBlockingViolationsInBothThemes } from '../../support/axe';
import {
  openSessionFromList,
  prepareCanvasWithSessions,
  type GeneratedEvent,
  type SessionFixture,
} from '../../support/perf-session-fixture';

/**
 * Turn summary chip in the Electron transcript (TASK_2026_623).
 *
 * The backend recorder, store and RPC have their own unit and real-git specs.
 * What only the real renderer can prove is the join: a `git:turnChangeSet`
 * push reaches `ChangeSetStore` through `MESSAGE_HANDLERS`, the transcript
 * places the lazily loaded summary chip after the turn's last assistant
 * message, and a renderer that starts from nothing (reload, then reopen the
 * session) renders the same chip from `git:turnChangeSets` alone.
 *
 * The session is replayed history (the `chat:resume` seam the paging specs
 * use), so the turn's messages carry the recorded timestamps the join reads.
 */

const WORKSPACE = 'C:\\ptah-e2e-ws';
// A reopened transcript can still hold the previous rows while they leave.
const SUMMARY =
  '.chat-msg-item:not([data-ptah-leaving]) [data-testid="chat-turn-summary"]';

/** Text tokens that identify each transcript message in DOM order. */
const TOKENS = {
  user0: 'E2E_CHANGESET_USER_0',
  assistant0: 'E2E_CHANGESET_ASSISTANT_0',
  user1: 'E2E_CHANGESET_USER_1',
  assistant1: 'E2E_CHANGESET_ASSISTANT_1',
} as const;

interface ChangeSetSession {
  readonly session: SessionFixture;
  /** The first turn edited two files. */
  readonly changeSet: TurnChangeSet;
}

/**
 * Two turns, ten seconds apart. Only the first one changed files, so its
 * summary chip must sit between the first assistant reply and second prompt.
 */
function makeChangeSetSession(): ChangeSetSession {
  const id = randomUUID();
  const base = Date.now() - 60_000;
  const events: GeneratedEvent[] = [];
  let seq = 0;
  const push = (
    timestamp: number,
    event: Omit<GeneratedEvent, 'id' | 'timestamp' | 'sessionId' | 'source'>,
  ): void => {
    events.push({
      id: `${id}-${seq++}`,
      timestamp,
      sessionId: id,
      source: 'history',
      ...event,
    });
  };
  const turn = (
    at: number,
    index: number,
    prompt: string,
    reply: string,
  ): void => {
    const userId = `cs-u-${index}`;
    const assistantId = `cs-a-${index}`;
    push(at, { eventType: 'message_start', messageId: userId, role: 'user' });
    push(at + 1, {
      eventType: 'text_delta',
      messageId: userId,
      blockIndex: 0,
      delta: prompt,
    });
    push(at + 1_000, {
      eventType: 'message_start',
      messageId: assistantId,
      role: 'assistant',
    });
    push(at + 1_001, {
      eventType: 'text_delta',
      messageId: assistantId,
      blockIndex: 0,
      delta: reply,
    });
    push(at + 1_002, {
      eventType: 'message_complete',
      messageId: assistantId,
      stopReason: 'end_turn',
      tokenUsage: { input: 1, output: 1 },
    });
  };
  turn(base, 0, `${TOKENS.user0} rename the helpers`, TOKENS.assistant0);
  turn(base + 10_000, 1, `${TOKENS.user1} thanks`, TOKENS.assistant1);

  const changeSet: TurnChangeSet = {
    sessionId: id,
    workspaceRoot: WORKSPACE,
    turnStartedAt: base + 500,
    turnEndedAt: base + 5_000,
    files: [
      { path: 'src/helpers.ts', status: 'M', additions: 12, deletions: 3 },
      { path: 'src/helpers.spec.ts', status: 'A', additions: 40, deletions: 0 },
    ],
    truncatedCount: 0,
    totals: { files: 2, additions: 52, deletions: 3 },
    countsUnavailable: false,
  };

  return {
    session: {
      id,
      name: `Change-set card session ${id.slice(0, 8)}`,
      marker: TOKENS.assistant1,
      events,
      actualCount: events.length,
      // `supportsPaging: false` below: `chat:resume` answers with `events`.
      paging: {
        tail: { events: [], olderCursor: null, resumableSubagents: [] },
        olderPages: {},
      },
    },
    changeSet,
  };
}

async function openSession(
  page: Page,
  session: SessionFixture,
): Promise<Locator> {
  await openSessionFromList(page, session.name);
  // The session renders in the Rail's focused pane (Rail cards echo the marker
  // too, so the scope is the pane, not the board).
  const tile = page
    .locator('ptah-canvas-focus-area')
    .filter({ hasText: session.marker });
  await expect(tile).toBeVisible();
  // The tile header echoes the last reply too; wait for the transcript bubble.
  await expect(
    tile.locator('[data-testid="chat-tool-output"]', {
      hasText: session.marker,
    }),
  ).toBeVisible();
  return tile;
}

/**
 * The transcript items' children in DOM order, each reduced to the message token
 * it shows or `summary` for a turn summary chip.
 */
async function transcriptOrder(tile: Locator): Promise<string[]> {
  return tile.evaluate((host, tokens) => {
    const content = host.querySelector('.chat-scroll-content');
    if (!content) return [];
    return Array.from(content.children)
      .filter((item) => item.matches('.chat-msg-item:not([data-ptah-leaving])'))
      .flatMap((item) => Array.from(item.children))
      .flatMap((child) => {
        if (child.getAttribute('data-testid') === 'chat-turn-summary') {
          return ['summary'];
        }
        const text = child.textContent ?? '';
        return tokens.filter((token) => text.includes(token));
      });
  }, Object.values(TOKENS));
}

test.describe('turn summary chip', () => {
  test('TASK_2026_623: a turn that edits two files shows its summary chip, and the chip survives reopening the session', async ({
    mainWindow,
    ui,
  }) => {
    const { session, changeSet } = makeChangeSetSession();
    await ui.mockRpc({
      'git:turnChangeSets': { changeSets: [] },
      // Both files are still changed, so no row reads "No longer changes HEAD".
      'git:info': {
        isGitRepo: true,
        branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
        files: [
          { path: 'src/helpers.ts', status: 'M', staged: false },
          { path: 'src/helpers.spec.ts', status: '??', staged: false },
        ],
      },
    });

    // -----------------------------------------------------------------------
    // 1. Live: the turn-end push adds the chip to the open session.
    // -----------------------------------------------------------------------
    await prepareCanvasWithSessions(ui, [session], { supportsPaging: false });
    const tile = await openSession(mainWindow, session);
    await expect
      .poll(async () =>
        (await ui.getObservedCalls('git:turnChangeSets')).some(
          (call) =>
            (call.params as { sessionId?: string } | undefined)?.sessionId ===
            session.id,
        ),
      )
      .toBe(true);
    await expect(tile.locator(SUMMARY)).toHaveCount(0);

    await ui.pushEvent({
      type: 'git:turnChangeSet',
      payload: { changeSet },
    });

    const summary = tile.locator(SUMMARY);
    await expect(summary).toBeVisible();
    await expect(summary.getByTestId('turn-summary-chip-metrics')).toContainText(
      '2 files',
    );
    await expect(summary.getByTestId('turn-summary-chip-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await summary.getByTestId('turn-summary-chip-toggle').click();
    const filesCard = summary
      .getByTestId('turn-summary-chip-card')
      .filter({ hasText: 'Files' });
    await expect(filesCard).toContainText('2');
    expect(await transcriptOrder(tile)).toEqual([
      TOKENS.user0,
      TOKENS.assistant0,
      'summary',
      TOKENS.user1,
      TOKENS.assistant1,
    ]);

    // -----------------------------------------------------------------------
    // 2. Reopen: a fresh renderer has only the persisted record.
    // -----------------------------------------------------------------------
    await ui.mockRpc({ 'git:turnChangeSets': { changeSets: [changeSet] } });
    await ui.prepare();
    await prepareCanvasWithSessions(ui, [session], { supportsPaging: false });
    const reopened = await openSession(mainWindow, session);

    const persisted = reopened.locator(SUMMARY);
    await expect(persisted).toBeVisible();
    await expect(persisted.getByTestId('turn-summary-chip-metrics')).toContainText(
      '2 files',
    );
    expect(await transcriptOrder(reopened)).toEqual([
      TOKENS.user0,
      TOKENS.assistant0,
      'summary',
      TOKENS.user1,
      TOKENS.assistant1,
    ]);
  });

  test('TASK_2026_623: the collapsed and expanded turn summary chip have no critical or serious a11y violations in dark and light', async ({
    mainWindow,
    ui,
  }, testInfo) => {
    const { session, changeSet } = makeChangeSetSession();
    await ui.mockRpc({
      'git:turnChangeSets': { changeSets: [changeSet] },
      'git:info': {
        isGitRepo: true,
        branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
        files: [
          { path: 'src/helpers.ts', status: 'M', staged: false },
          { path: 'src/helpers.spec.ts', status: '??', staged: false },
        ],
      },
    });
    await prepareCanvasWithSessions(ui, [session], { supportsPaging: false });
    const tile = await openSession(mainWindow, session);
    const summary = tile.locator(SUMMARY);
    await expect(summary).toBeVisible();
    await ui.page.mouse.move(2, 2);
    await expectNoBlockingViolationsInBothThemes(
      ui.page,
      'turn-summary-chip-collapsed',
      testInfo,
      { include: SUMMARY, evidence: true },
    );
    await summary.getByTestId('turn-summary-chip-toggle').click();
    await expectNoBlockingViolationsInBothThemes(
      ui.page,
      'turn-summary-chip-expanded',
      testInfo,
      { include: SUMMARY, evidence: true },
    );
  });
});
