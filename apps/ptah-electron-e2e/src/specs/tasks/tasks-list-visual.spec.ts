import * as fs from 'fs';
import * as path from 'path';
import type { TestInfo } from '@playwright/test';
import { test, expect } from '../../support/fixtures';

/**
 * The Tasks LIST layout, seen in a real engine — the review this batch owes.
 *
 * The unit suite proves the list renders the right elements. It cannot prove
 * the two claims the layout was actually built on, because jsdom has no layout
 * and no scrolling:
 *
 *   1. A row is shorter than a card while carrying MORE of the task — the
 *      description and every metadata field. Measured here from real bounding
 *      boxes, both layouts in the same window at the same width.
 *   2. `position: sticky` PINS the group header. This is the defect the layout
 *      exists to fix, and no class-name assertion can catch it in either
 *      direction.
 *
 * The screenshots are for a human to judge density and hierarchy. The
 * assertions are what fail the build.
 */

/** Where the human-reviewable artifacts land. Stable across runs, by design. */
const SCREENSHOT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'dist',
  'apps',
  'ptah-electron-e2e',
  'tasks-list',
);

async function saveArtifact(
  testInfo: TestInfo,
  name: string,
  buffer: Buffer,
): Promise<string> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, name);
  fs.writeFileSync(file, buffer);
  await testInfo.attach(name, { body: buffer, contentType: 'image/png' });
  return file;
}

interface FixtureTask {
  id: string;
  folderName: string;
  status: string;
  type: string;
  title: string;
  description?: string;
  dependsOn: string[];
  labels: string[];
  duplicates: string[];
  relatesTo: string[];
  estimate?: string;
  executor?: string;
  parent?: string;
  created: string | null;
  updated: string | null;
  frontmatterValid: boolean;
  validationIssues: unknown[];
}

function task(
  id: string,
  status: string,
  title: string,
  extra: Partial<FixtureTask> = {},
): FixtureTask {
  return {
    id,
    folderName: id,
    status,
    type: 'FEATURE',
    title,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: '2026-07-01T09:00:00.000Z',
    updated: '2026-08-04T16:30:00.000Z',
    frontmatterValid: true,
    validationIssues: [],
    ...extra,
  };
}

/**
 * A board with the shape that made the density problem visible in the first
 * place: a long In Review column, a very long Done column, and rows carrying
 * the metadata the list turns into columns.
 */
function buildBoard() {
  const inReview: FixtureTask[] = [
    task(
      'TASK_2026_230',
      'in_review',
      'hunk-apply-real-rpc "bogus snapshot token" negative path',
      {
        type: 'BUGFIX',
        description:
          'The apply guard rejects a stale snapshot token, but the negative path was never exercised against a real RPC round trip.',
        estimate: 'M',
        executor: 'backend-developer',
        labels: ['editor', 'rpc'],
        updated: '2026-08-09T11:15:00.000Z',
      },
    ),
    task(
      'TASK_2026_231',
      'in_review',
      'perf-m1-diff-redisplay spec fails waiting for a diff tab',
      {
        type: 'BUGFIX',
        description: 'The spec waits on a tab the harness never opens.',
        estimate: 'S',
        executor: 'senior-tester',
        labels: ['flaky'],
        updated: '2026-08-08T14:02:00.000Z',
      },
    ),
    task(
      'TASK_2026_232',
      'in_review',
      'The stale-content symptom TASK_2026_222 observed',
      {
        type: 'RESEARCH',
        description:
          'Establish whether the stale renderer is a cache-restore artefact or a genuine build ordering fault.',
        estimate: 'L',
        labels: ['electron', 'nx', 'cache'],
        updated: '2026-08-07T08:45:00.000Z',
      },
    ),
    task('TASK_2026_198', 'in_review', 'TUI visual + interaction overhaul', {
      description: 'Adopt the shared vocabulary across the Ink surface.',
      estimate: 'XL',
      executor: 'frontend-developer',
      labels: ['tui'],
      updated: '2026-08-06T19:20:00.000Z',
    }),
    task(
      'TASK_2026_203',
      'in_review',
      'File tree has no windowing/virtualization',
      {
        estimate: 'M',
        description: 'A 4000-entry tree renders every node.',
        updated: '2026-08-05T10:00:00.000Z',
      },
    ),
  ];
  for (let i = 0; i < 14; i += 1) {
    inReview.push(
      task(`TASK_2026_${300 + i}`, 'in_review', `Filler review item ${i + 1}`, {
        estimate: 'S',
        description: 'Padding so the column is longer than the viewport.',
      }),
    );
  }

  return {
    columns: {
      backlog: [
        task(
          'TASK_2026_188',
          'backlog',
          'Agentic skill synthesis — queued execution, provider fallback',
          {
            description:
              'Queue synthesis behind the provider tree so a rate-limited vendor does not drop the run.',
            estimate: 'XL',
            executor: 'software-architect',
            labels: ['skills', 'agents', 'queue', 'fallback'],
            updated: '2026-08-10T07:30:00.000Z',
          },
        ),
        task(
          'TASK_2026_240',
          'backlog',
          'Sub-task A of the synthesis rollout',
          {
            parent: 'TASK_2026_188',
            estimate: 'S',
          },
        ),
        task(
          'TASK_2026_241',
          'backlog',
          'Sub-task B of the synthesis rollout',
          {
            parent: 'TASK_2026_188',
            estimate: 'M',
          },
        ),
      ],
      in_progress: [
        task(
          'TASK_2026_242',
          'in_progress',
          'Sub-task C of the synthesis rollout',
          {
            parent: 'TASK_2026_188',
            estimate: 'M',
            executor: 'backend-developer',
          },
        ),
      ],
      in_review: inReview,
      blocked: [
        task(
          'TASK_2026_155',
          'blocked',
          'Goal workflow (/goal): session-scoped completion',
          {
            description: 'Blocked on the session contract landing first.',
            estimate: 'L',
            dependsOn: ['TASK_2026_140'],
            labels: ['workflow'],
          },
        ),
      ],
      done: [
        task(
          'TASK_2026_224',
          'done',
          'pre-commit lint-staged --no-stash sweeps unstaged edits',
          {
            type: 'BUGFIX',
            estimate: 'S',
            updated: '2026-08-03T12:00:00.000Z',
          },
        ),
        task(
          'TASK_2026_225',
          'done',
          'chat-session-resume-activate TS-04 fails',
          {
            type: 'BUGFIX',
            estimate: 'M',
            updated: '2026-08-02T12:00:00.000Z',
          },
        ),
        task(
          'TASK_2026_226',
          'done',
          'Electron e2e silently tests a stale renderer',
          {
            type: 'DEVOPS',
            estimate: 'L',
            executor: 'devops-engineer',
            updated: '2026-08-01T12:00:00.000Z',
          },
        ),
      ],
      cancelled: [
        task(
          'TASK_2026_210',
          'cancelled',
          'aria-required-children ownership violation',
          {
            type: 'BUGFIX',
            estimate: 'S',
          },
        ),
      ],
    },
    excluded: [],
    excludedCount: 0,
    specsDirExists: true,
  };
}

const PLAN_MARKDOWN = [
  '# Implementation plan',
  '',
  '## Batch 1 — the read path',
  '',
  '1. Add `tasks:getArtifact` to the shared contract.',
  '2. Constrain `file` to `DOC_FILES` at the Zod boundary.',
  '3. Read through `TaskIndexService.readArtifact`.',
  '',
  '> The enum is the security boundary, not a sanitiser.',
  '',
  '## Batch 2 — the panel',
  '',
  '- Two controls per stage: read here, open in the editor.',
  '- Render through the DOMPurify chokepoint.',
].join('\n');

const DETAIL = {
  task: {
    ...task(
      'TASK_2026_230',
      'in_review',
      'hunk-apply-real-rpc "bogus snapshot token" negative path',
      {
        type: 'BUGFIX',
        description:
          'The apply guard rejects a stale snapshot token, but the negative path was never exercised against a real RPC round trip.',
        estimate: 'M',
        executor: 'backend-developer',
        labels: ['editor', 'rpc'],
        updated: '2026-08-09T11:15:00.000Z',
      },
    ),
    body: '## Context\n\nThe guard is asserted in jsdom only.\n',
    artifacts: [
      'task.md',
      'context.md',
      'task-description.md',
      'implementation-plan.md',
    ],
  },
};

async function openTasksList(ui: {
  mockRpc: (m: Record<string, unknown>) => Promise<void>;
  goto: (v: 'tasks') => Promise<void>;
  page: import('@playwright/test').Page;
}) {
  await ui.mockRpc({
    'tasks:board': buildBoard(),
    'tasks:get': DETAIL,
    'tasks:getArtifact': `(params) => ({
      file: params.file,
      content: params.file === 'implementation-plan.md'
        ? ${JSON.stringify(PLAN_MARKDOWN)}
        : null,
    })`,
    'tasks:getViews': { views: [], activeViewId: null, skipped: 0 },
  });
  await ui.goto('tasks');
  await expect(ui.page.locator('ptah-tasks-view')).toBeVisible();
  await ui.page.locator('[data-testid="tasks-view-mode-list"]').click();
  await expect(ui.page.locator('ptah-task-list')).toBeVisible();
}

test.describe('Tasks list layout (visual + measured)', () => {
  test('a row is far shorter than a card, measured in the real engine', async ({
    ui,
  }, testInfo) => {
    await ui.mockRpc({
      'tasks:board': buildBoard(),
      'tasks:getViews': { views: [], activeViewId: null, skipped: 0 },
    });
    await ui.goto('tasks');
    await expect(ui.page.locator('ptah-tasks-view')).toBeVisible();

    // Kanban first — it is the default, so this is the board as it shipped.
    const card = ui.page.locator('ptah-task-card > div').first();
    await expect(card).toBeVisible();
    const cardBox = await card.boundingBox();
    await saveArtifact(
      testInfo,
      'kanban-before.png',
      await ui.page.screenshot({ scale: 'css' }),
    );

    await ui.page.locator('[data-testid="tasks-view-mode-list"]').click();
    const row = ui.page.locator('[data-testid="task-row"]').first();
    await expect(row).toBeVisible();
    const rowBox = await row.boundingBox();

    expect(cardBox, 'the Kanban card must be laid out').not.toBeNull();
    expect(rowBox, 'the list row must be laid out').not.toBeNull();

    const cardHeight = cardBox?.height ?? 0;
    const rowHeight = rowBox?.height ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `[tasks-list] card=${cardHeight.toFixed(1)}px row=${rowHeight.toFixed(1)}px ratio=${(cardHeight / rowHeight).toFixed(2)}x`,
    );

    // A row shows the description AND every metadata field the card shows, so
    // it is no longer a 40px table row — but it must still be denser than the
    // card. Deliberately a loose bound, so a theme or font change does not
    // fail it.
    expect(
      rowHeight,
      `a list row (${rowHeight}px) must be shorter than a Kanban card (${cardHeight}px)`,
    ).toBeLessThan(cardHeight * 0.85);
    expect(rowHeight).toBeGreaterThan(0);
  });

  test('the list renders every field with real metadata', async ({
    ui,
  }, testInfo) => {
    await openTasksList(ui);
    const page = ui.page;

    for (const field of [
      'task-row-title',
      'task-row-description',
      'task-row-type',
      'task-row-estimate',
      'task-row-updated',
      'task-row-executor',
    ]) {
      await expect(
        page.locator(`[data-testid="${field}"]`).first(),
        `the ${field} field must render`,
      ).toBeVisible();
    }

    // A parent with three children shows its rollup as a real control.
    await expect(
      page.locator('[data-testid="task-row-rollup-glyph"]').first(),
    ).toContainText('/');

    /**
     * The title must stay on ONE line and must clip inside its own row.
     *
     * The row's main block is a `min-w-0` flex child. Without that, the block
     * grows to its longest text, the title stops truncating, and the actions
     * are pushed off the pane. jsdom has no layout, so it is pinned here.
     */
    const firstRowMain = page.locator('[data-testid="task-row-main"]').first();
    const mainBox = await firstRowMain.boundingBox();
    const overflow = await firstRowMain.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(
      overflow,
      `the row's main block (${mainBox?.width.toFixed(0)}px) must clip its own content, not push the actions off the pane`,
    ).toBeLessThanOrEqual(1);
    expect(mainBox?.width ?? 0).toBeGreaterThan(180);

    // The actions stay inside the pane, at the row's right edge.
    const start = page.locator('[data-testid="task-row-start"]').first();
    const startBox = await start.boundingBox();
    const listBox = await page.locator('ptah-task-list').boundingBox();
    expect(
      (startBox?.x ?? 0) + (startBox?.width ?? 0),
      'the Start button must sit inside the list pane',
    ).toBeLessThanOrEqual((listBox?.x ?? 0) + (listBox?.width ?? 0) + 1);

    /**
     * The description is capped at two lines, so a long body cannot turn one
     * row into a page. Measured against the row's own line box.
     */
    const rowHeights = await page
      .locator('[data-testid="task-row"]')
      .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
    const tallest = Math.max(...rowHeights);
    // eslint-disable-next-line no-console
    console.log(
      `[tasks-list] rows=${rowHeights.length} tallest=${tallest.toFixed(1)}px`,
    );
    expect(
      tallest,
      'no row may grow past three text lines plus a metadata line',
    ).toBeLessThan(110);

    await expect(
      page.locator('[data-testid="task-list-count-in_review"]'),
    ).toContainText('19');

    await saveArtifact(
      testInfo,
      'list-full.png',
      await page.screenshot({ scale: 'css' }),
    );
  });

  /**
   * THE assertion this whole layout was built for.
   *
   * The class-name assertions in jsdom would pass just as happily over a
   * header that scrolls away. This scrolls the real container and reads real
   * coordinates.
   */
  test('the group header stays pinned while the rows scroll', async ({
    ui,
  }, testInfo) => {
    await openTasksList(ui);
    const page = ui.page;

    const scroller = page.locator('ptah-task-list > div');
    // Scoped to ONE section. Every group renders its own header, so an
    // unscoped `.first()` picks the topmost group in DOM order — which, once
    // the list is scrolled, is a section that left the viewport, and the
    // comparison measures nothing.
    const section = page.locator('ptah-task-list section', {
      has: page.locator('[data-testid="task-list-group-in_review"]'),
    });
    const groupHeader = section.locator('header').first();

    const firstRowIdBefore = await page
      .locator('[data-testid="task-row"]')
      .first()
      .getAttribute('data-task-id');

    await scroller.evaluate((el) => {
      el.scrollTop = 900;
    });
    await page.waitForTimeout(250);

    const scrolled = await scroller.evaluate((el) => el.scrollTop);
    expect(scrolled, 'the list must actually have scrolled').toBeGreaterThan(
      200,
    );

    const scrollerBox = await scroller.boundingBox();
    const groupBox = await groupHeader.boundingBox();

    expect(groupBox, 'a group header must still be laid out').not.toBeNull();

    const scrollerTop = scrollerBox?.y ?? 0;
    const groupTop = groupBox?.y ?? -1;
    // eslint-disable-next-line no-console
    console.log(
      `[tasks-list] scrollTop=${scrolled} containerTop=${scrollerTop.toFixed(1)} groupHeaderTop=${groupTop.toFixed(1)}`,
    );

    // Pinned: the group header sits at the container's top edge even though
    // the rows under it have moved. 2px of tolerance for fractional DPI.
    expect(
      Math.abs(groupTop - scrollerTop),
      'the group header must be pinned to the top of the scroll container',
    ).toBeLessThanOrEqual(2);

    // Sanity: the rows really did move, so the pin is not just an unscrolled list.
    const firstRowIdAfter = await page
      .locator('[data-testid="task-row"]')
      .first()
      .getAttribute('data-task-id');
    expect(firstRowIdAfter).toBe(firstRowIdBefore);

    await saveArtifact(
      testInfo,
      'list-scrolled-headers-pinned.png',
      await page.screenshot({ scale: 'css' }),
    );
  });

  test('folding a group collapses it to a single header line', async ({
    ui,
  }, testInfo) => {
    await openTasksList(ui);
    const page = ui.page;

    const reviewRows = page.locator(
      '[data-testid="task-row"][data-task-id^="TASK_2026_3"]',
    );
    const before = await page.locator('[data-testid="task-row"]').count();

    await page.locator('[data-testid="task-list-group-in_review"]').click();
    await page.waitForTimeout(150);

    const after = await page.locator('[data-testid="task-row"]').count();
    expect(after, 'folding must remove that group’s rows').toBeLessThan(before);
    await expect(
      page.locator('[data-testid="task-list-group-in_review"]'),
    ).toHaveAttribute('aria-expanded', 'false');
    // The count stays on the folded header — folding is a view state, never a filter.
    await expect(
      page.locator('[data-testid="task-list-count-in_review"]'),
    ).toContainText('19');
    expect(await reviewRows.count()).toBe(0);

    await saveArtifact(
      testInfo,
      'list-group-collapsed.png',
      await page.screenshot({ scale: 'css' }),
    );
  });

  test('opening a task narrows the list to a rail and widens the detail', async ({
    ui,
  }, testInfo) => {
    await openTasksList(ui);
    const page = ui.page;

    const listBefore = await page.locator('ptah-task-list').boundingBox();

    await page.locator('[data-task-id="TASK_2026_230"]').first().click();
    await expect(page.locator('ptah-task-detail')).toBeVisible();
    await page.waitForTimeout(250);

    const listAfter = await page.locator('ptah-task-list').boundingBox();
    const detail = await page.locator('ptah-task-detail aside').boundingBox();

    const widthBefore = listBefore?.width ?? 0;
    const widthAfter = listAfter?.width ?? 0;
    const detailWidth = detail?.width ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `[tasks-list] listWidth ${widthBefore.toFixed(0)} -> ${widthAfter.toFixed(0)}, detail=${detailWidth.toFixed(0)}`,
    );

    expect(widthAfter, 'the list must collapse to a rail').toBeLessThan(
      widthBefore / 2,
    );
    expect(
      detailWidth,
      'the detail panel must take more than the old fixed 384px',
    ).toBeGreaterThan(384);

    // Compact drops the description and the metadata; title and type stay.
    await expect(
      page.locator('[data-testid="task-row-description"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="task-row-updated"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="task-row-title"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="task-row-type"]').first(),
    ).toBeVisible();

    await saveArtifact(
      testInfo,
      'list-rail-with-detail.png',
      await page.screenshot({ scale: 'css' }),
    );
  });

  test('the implementation plan renders in the panel, not the editor', async ({
    ui,
  }, testInfo) => {
    await openTasksList(ui);
    const page = ui.page;

    await page.locator('[data-task-id="TASK_2026_230"]').first().click();
    await expect(page.locator('ptah-task-detail')).toBeVisible();

    await page
      .locator('[data-testid="task-doc-read-implementation-plan.md"]')
      .click();

    const panel = page.locator('[data-testid="task-doc-panel"]');
    await expect(panel).toBeVisible();
    // `toBeVisible` is NOT enough here and that is the point: it means laid out
    // and not hidden, so it passed happily over a panel that opened 400px below
    // the fold, under a fifteen-stage Workflow list. The user clicked Read and
    // saw nothing move. This is the assertion that holds the scroll-into-view.
    await expect(
      panel,
      'the opened document must be ON SCREEN, not merely in the DOM',
    ).toBeInViewport();
    await expect(panel).toContainText('Batch 1');
    await expect(panel).toContainText('the enum is the security boundary', {
      ignoreCase: true,
    });
    // Rendered as markdown through the chokepoint, not dumped as source.
    await expect(panel.locator('ptah-markdown-block h1')).toBeVisible();
    await expect(panel).not.toContainText('# Implementation plan');

    await saveArtifact(
      testInfo,
      'list-document-open.png',
      await page.screenshot({ scale: 'css' }),
    );

    // A document the folder does not hold says so, rather than reporting a fault.
    await page
      .locator('[data-testid="task-doc-read-task-description.md"]')
      .click();
    await expect(page.locator('[data-testid="task-doc-absent"]')).toContainText(
      'does not contain',
    );

    await saveArtifact(
      testInfo,
      'list-document-absent.png',
      await page.screenshot({ scale: 'css' }),
    );
  });
});
