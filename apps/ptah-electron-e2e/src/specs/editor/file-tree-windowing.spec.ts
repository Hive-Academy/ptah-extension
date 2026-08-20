/**
 * File-tree windowing in a real host — TASK_2026_203.
 *
 * The jsdom suite (`libs/frontend/editor/src/lib/file-tree/
 * file-tree-windowing.spec.ts`) can count mounted rows, and that is the
 * mechanism the windowing exists for. What it cannot do is see any of this:
 * jsdom reports zero height for every element, runs no layout and does no
 * hit-testing, so a green unit run says nothing about whether the rows
 * actually render, whether the reveal row is reachable, or whether clicking it
 * does anything.
 *
 * This spec asserts exactly the part that needs a browser — real box heights,
 * a real click on a real hit-tested control — against a directory of 5,000
 * entries served through the mocked `editor:getFileTree`.
 */

import { test, expect } from '../../support/fixtures';

const WS = 'C:\\ptah-e2e-ws';
const BIG_DIR = `${WS}\\big`;

/** Well above the 200-node window, and above what any real hand-authored directory holds. */
const CHILD_COUNT = 5000;
const WINDOW_SIZE = 200;

interface FileTreeNodeFixture {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNodeFixture[];
}

function bigTree(): { tree: FileTreeNodeFixture[] } {
  return {
    tree: [
      {
        name: 'big',
        type: 'directory',
        path: BIG_DIR,
        children: Array.from({ length: CHILD_COUNT }, (_, i) => ({
          name: `f${String(i).padStart(6, '0')}.ts`,
          type: 'file' as const,
          path: `${BIG_DIR}\\f${String(i).padStart(6, '0')}.ts`,
        })),
      },
    ],
  };
}

test.describe('File tree — windowing a large directory', () => {
  test('renders one chunk with real geometry, and the reveal row works', async ({
    ui,
  }, testInfo) => {
    await ui.mockRpc({ 'editor:getFileTree': bigTree() });
    await ui.goto('editor');

    const page = ui.page;
    const tree = page.locator(
      'ptah-file-tree [role="tree"][aria-label="File Explorer"]',
    );
    await expect(tree).toBeVisible();

    const rows = page.locator('[data-testid="editor-file-node"]');
    const moreRow = page.locator('[data-testid="editor-file-tree-more"]');

    // Collapsed: the directory row only.
    await expect(rows).toHaveCount(1);
    await expect(moreRow).toHaveCount(0);

    await rows.first().click();

    // One chunk plus the directory row. Unwindowed this was 5,001.
    await expect(rows).toHaveCount(1 + WINDOW_SIZE);
    await expect(moreRow).toHaveCount(1);

    // ---- the half jsdom cannot answer -------------------------------------

    // Rows have real height. In jsdom every one of these is 0, which is why a
    // green unit run is not evidence that anything rendered.
    const firstChild = rows.nth(1);
    const childBox = await firstChild.boundingBox();
    expect(childBox).not.toBeNull();
    expect(childBox?.height ?? 0).toBeGreaterThan(0);
    expect(childBox?.width ?? 0).toBeGreaterThan(0);

    // The reveal row is laid out, on screen, and hit-testable — Playwright's
    // actionability check covers visibility, stability and receiving events.
    await expect(moreRow).toBeVisible();
    const moreBox = await moreRow.boundingBox();
    expect(moreBox?.height ?? 0).toBeGreaterThan(0);

    await expect(moreRow).toHaveText(
      `Show ${WINDOW_SIZE.toLocaleString('en-US')} more ` +
        `(${(CHILD_COUNT - WINDOW_SIZE).toLocaleString('en-US')} hidden)`,
    );

    // Scroll it into frame before capturing: `toBeVisible` and `click` both
    // pass on an element below the fold, so a screenshot taken from the top of
    // the list would be evidence of the rows and not of the control.
    await moreRow.scrollIntoViewIfNeeded();
    await testInfo.attach('file-tree-windowed', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // A real click on the real control reveals exactly one more chunk.
    await moreRow.click();
    await expect(rows).toHaveCount(1 + WINDOW_SIZE * 2);
    await expect(moreRow).toHaveCount(1);

    // The scroll container is the tree's own <aside>; windowing never touches
    // it, so it still scrolls the rows that are rendered.
    const scrollable = await tree.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    );
    expect(scrollable).toBe(true);

    await testInfo.attach('file-tree-after-reveal', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
