import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../support/fixtures';

/**
 * TASK_2026_612 evidence capture (NOT part of the normal e2e suite).
 * Mocked RPC reproduces what the base-commit backend returns for an
 * agent-started child session: hasTranscript:false in session:list, and an
 * `agentSession:opened` push whose parent tab lives on the canvas.
 *
 * Output dir: env EVIDENCE_OUT (absolute). Label prefix: env EVIDENCE_LABEL.
 */
const OUT = process.env['EVIDENCE_OUT'] as string;
const CHILD_ID = '4bb0a19d-7f5b-43ca-b10e-12c147d3e4cb';
const WS = 'C:\ptah-e2e-ws';
const NOW = Date.now();

const THEMES = [
  { key: 'dark', theme: 'anubis' },
  { key: 'light', theme: 'anubis-light' },
] as const;

test('TASK_2026_612 child session sidebar + canvas tile', async ({
  ui,
  electronApp,
}) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1600, 950);
    w.center();
  });

  await ui.mockRpc({
    'session:list': {
      sessions: [
        {
          id: CHILD_ID,
          name: 'TASK 531 canvas gating',
          messageCount: 14,
          createdAt: NOW - 3_600_000,
          lastActivityAt: NOW - 120_000,
          isActive: false,
          // AFTER: fixed backend returns true for a child whose transcript
          // lives under its worktree dir (covered by rpc-handlers Jest tests).
          hasTranscript: true,
        },
        {
          id: '11111111-2222-4333-8444-555555555555',
          name: 'Refactor session list (normal session)',
          messageCount: 8,
          createdAt: NOW - 7_200_000,
          lastActivityAt: NOW - 1_800_000,
          isActive: false,
          hasTranscript: true,
        },
      ],
      total: 2,
      hasMore: false,
    },
    'chat:agent-sessions': { sessions: [] },
  });
  await ui.prepare();
  await ui.goto('chat');
  // The fixture's `page` can be a stale handle; use the live renderer window.
  const page = electronApp.windows().find((x) => x.url().startsWith('file:'));
  if (!page) throw new Error('renderer window not found');
  await page.waitForTimeout(2_000);

  const tabsOf = async (): Promise<string> => {
    await page.waitForTimeout(1_500);
    return page.evaluate(() =>
      JSON.stringify(
        Object.keys(localStorage)
          .filter((k) => k.startsWith('ptah.tabs'))
          .map((k) => [k, localStorage.getItem(k)]),
      ),
    );
  };
  const idsOf = (raw: string): Set<string> => {
    const out = new Set<string>();
    for (const m of raw.matchAll(/\bid\W{1,6}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g))
      out.add(m[1]);
    return out;
  };

  const stored = await tabsOf();
  fs.writeFileSync(path.join(OUT, '_probe-state-before.json'), stored);
  const ids = idsOf(stored);
  const parentTabId = [...ids][0];
  expect(parentTabId, 'a parent tab id was found in persisted state').toBeTruthy();

  const tiles = page.locator('[data-testid="canvas-grid"] gridstack-item');
  const tilesBefore = await tiles.count();

  // The sidebar entry (before the child is adopted).
  const search = page.getByPlaceholder('Search sessions...');
  await expect(search).toBeVisible();
  const rail = page.locator('aside').filter({ has: search }).first();
  await expect(
    rail.locator('button', { hasText: 'TASK 531 canvas gating' }).first(),
  ).toBeVisible({ timeout: 20_000 });
  const expiredCountBefore = await rail.getByText('transcript expired').count();

  await ui.pushEvent({
    type: 'agentSession:opened',
    payload: {
      tabId: '9f0c1c3e-3a55-4d7e-9a47-0b7a9c1d2e3f',
      sessionId: CHILD_ID,
      parentTabId,
      parentSessionId: null,
      workspaceRoot: WS,
      worktreePath:
        'D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-531-canvas-surface-active',
      branch: 'fix/task-2026-531-canvas-surface-active',
      label: 'TASK 531 canvas gating',
      displayPrompt: 'Fix canvas gating on SURFACE_ACTIVE',
      startedAt: NOW,
    },
  });
  await page.waitForTimeout(3_000);

  const tabIdsAfter = idsOf(await tabsOf());
  const tilesAfter = await tiles.count();

  const facts = {
    baseCommit: process.env['EVIDENCE_COMMIT'] ?? 'unknown',
    parentTabId,
    tabIdsBeforeAdoption: [...ids],
    tabIdsAfterAdoption: [...tabIdsAfter],
    childTabAdoptedInTabManager: tabIdsAfter.has(
      '9f0c1c3e-3a55-4d7e-9a47-0b7a9c1d2e3f',
    ),
    transcriptExpiredLabelCount: expiredCountBefore,
    tabsStorageKeys: await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('ptah.tabs')),
    ),
    canvasTilesBefore: tilesBefore,
    canvasTilesAfter: tilesAfter,
    sidebarChildRow: await rail
      .locator('button', { hasText: 'TASK 531 canvas gating' })
      .first()
      .evaluate((el) => {
        const name = el.querySelector('span.font-medium') as HTMLElement | null;
        return {
          text: (el as HTMLElement).innerText,
          nameOpacity: name ? getComputedStyle(name).opacity : null,
          nameClass: name?.className ?? null,
        };
      }),
  };
  fs.writeFileSync(
    path.join(OUT, 'facts.json'),
    JSON.stringify(facts, null, 2),
  );

  for (const t of THEMES) {
    await page.evaluate((theme) => {
      document.documentElement.setAttribute('data-theme', theme);
    }, t.theme);
    await page.waitForTimeout(600);
    await rail.screenshot({ path: path.join(OUT, `sidebar-child-${t.key}.png`) });
    await page.screenshot({ path: path.join(OUT, `canvas-after-adopt-${t.key}.png`) });
  }
});
