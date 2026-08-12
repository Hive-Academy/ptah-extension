import * as fs from 'fs';
import * as path from 'path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';

/**
 * The hunk revert confirmation, answered by MOUSE — TASK_2026_227.
 *
 * The dialog was written carefully and was correct in every dimension jsdom can
 * observe: `alertdialog`, `aria-modal`, labelled and described, focus on the
 * non-destructive choice, Escape to cancel, Tab trapped, no clickable backdrop.
 * It was also unanswerable with a mouse. Its wrapper was a plain positioned
 * `<div class="modal modal-open z-50">`, and a z-index only orders siblings
 * inside the nearest ancestor that establishes a stacking context — here the
 * editor panel's own `isolate` wrapper, inside a gridstack tile. The canvas
 * panel painted over the whole thing and its empty-state text took the clicks
 * on both Cancel and Discard.
 *
 * jsdom cannot hold this spec. It has no layout, no compositing and no
 * hit-testing, so `z-index`, stacking contexts and `pointer-events` do not
 * exist there and all 351 editor unit tests passed throughout. The evidence for
 * the bug was a screenshot; the evidence for the fix has to be a real click in
 * a real window, which is why this lives at the Playwright level.
 *
 * Nothing here is forced. `Locator.click()` performs Playwright's own
 * hit-testing and refuses to click an element that something else would
 * receive the event for, so an unforced click IS the regression assertion — on
 * the pre-fix build it fails with "intercepts pointer events". The explicit
 * `elementFromPoint` probe is there so the failure names the culprit instead of
 * timing out anonymously.
 */

/** Where the human-reviewable artifact lands. Stable across runs, by design. */
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
  'hunk-revert-top-layer',
);

const FILE_NAME = THREE_HUNK_FILE.split('/').pop() as string;

interface HitTest {
  readonly tag: string;
  readonly testid: string | null;
  readonly text: string;
}

/**
 * What the compositor says is on top at the centre of `locator`.
 *
 * This is the exact question the bug got wrong: paint order and hit-testing,
 * not DOM structure. `elementFromPoint` answers it the same way a mouse does.
 */
async function topmostAt(page: Page, locator: Locator): Promise<HitTest> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element has no painted box to probe');
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return {
        tag: el?.tagName.toLowerCase() ?? '(nothing)',
        testid:
          el?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
        text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
}

/** True when the two painted boxes overlap at all. */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * Poll the worktree until `predicate` holds. A revert crosses an IPC round trip
 * and a `git apply` child process, so the spec waits on the observable end
 * state rather than on a renderer signal.
 */
async function waitForWorktreeDiff(
  read: () => string,
  predicate: (diff: string) => boolean,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    last = read();
    if (predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting on the working tree.\n` +
          `Last \`git diff\`:\n${last || '(empty)'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.describe('hunk revert dialog is answerable by mouse (TASK_2026_227)', () => {
  // A real boot into an empty home runs every SQLite migration from zero before
  // the window is created, which does not fit the config-wide 60s budget.
  test.setTimeout(240_000);

  /**
   * Drive the UI to an open revert dialog using the mouse only, and hand back
   * the locators the assertions need.
   */
  async function openRevertDialog(page: Page) {
    await page.getByRole('tab', { name: 'Git' }).click();

    const changedRow = page.locator('[role="listitem"]', {
      hasText: FILE_NAME,
    });
    await expect(changedRow).toBeVisible({ timeout: 20_000 });
    await changedRow.click();

    await expect(page.locator('ptah-diff-view .view-lines').last()).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect(page.locator('[data-testid="hunk-position"]')).toHaveText(
      '3 hunks',
      { timeout: 20_000 },
    );

    await page
      .locator(
        'ptah-diff-view .modified-in-monaco-diff-editor .ptah-hunk-glyph',
      )
      .first()
      .click();
    await expect(page.locator('[data-testid="hunk-position"]')).toHaveText(
      'Hunk 1 of 3',
    );

    await page.locator('[data-testid="hunk-widget-revert"]').click();

    const dialog = page.locator('[data-testid="hunk-revert-dialog"]');
    await expect(dialog).toBeVisible();
    return {
      dialog,
      cancel: page.locator('[data-testid="hunk-revert-cancel"]'),
      confirm: page.locator('[data-testid="hunk-revert-confirm"]'),
    };
  }

  test('paints above the canvas and gives Cancel the mouse, writing nothing', async ({
    ui,
    repo,
  }, testInfo) => {
    const page = ui.page;
    await ui.goto('editor');

    const before = repo.worktreeDiff();
    expect(before.match(/^@@ /gm)?.length).toBe(3);

    const { dialog, cancel, confirm } = await openRevertDialog(page);

    // The condition the bug needed: the canvas really is behind this dialog.
    // Without this the spec could pass in a layout where nothing overlaps and
    // would stop guarding anything.
    const canvasHeading = page.getByRole('heading', {
      name: 'Orchestra Canvas',
    });
    await expect(canvasHeading).toBeVisible();
    const canvasBox = await canvasHeading.boundingBox();
    const boxBox = await dialog.locator('.modal-box').boundingBox();
    expect(canvasBox, 'the canvas heading has no painted box').not.toBeNull();
    expect(boxBox, 'the modal box has no painted box').not.toBeNull();
    expect(
      overlaps(canvasBox!, boxBox!),
      'the canvas heading and the modal box do not overlap, so this run is ' +
        'not exercising the collision the task is about',
    ).toBe(true);

    // The assertion proper. Before the fix these came back as the canvas
    // empty-state text; the failure message prints whatever actually won.
    const overCancel = await topmostAt(page, cancel);
    expect(
      overCancel.testid,
      `something else is on top of Cancel: <${overCancel.tag}> "${overCancel.text}"`,
    ).toBe('hunk-revert-cancel');

    const overConfirm = await topmostAt(page, confirm);
    expect(
      overConfirm.testid,
      `something else is on top of Discard: <${overConfirm.tag}> "${overConfirm.text}"`,
    ).toBe('hunk-revert-confirm');

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const shot = await page.screenshot({ scale: 'css' });
    const file = path.join(SCREENSHOT_DIR, 'revert-dialog-above-canvas.png');
    fs.writeFileSync(file, shot);
    await testInfo.attach('revert-dialog-above-canvas.png', {
      body: shot,
      contentType: 'image/png',
    });
    console.log(`\n=== TASK_2026_227 dialog evidence ===\n  ${file}\n`);

    // A real, unforced click. This is what a user could not do.
    await cancel.click();
    await expect(dialog).toHaveCount(0);

    // Read from git, not from the UI: Cancel must leave the tree untouched.
    expect(repo.worktreeDiff()).toBe(before);
    expect(repo.stagedDiff()).toBe('');
  });

  test('gives Discard the mouse, and discards exactly the hunk it was opened for', async ({
    ui,
    repo,
  }) => {
    const page = ui.page;
    await ui.goto('editor');

    const before = repo.worktreeDiff();
    expect(before.match(/^@@ /gm)?.length).toBe(3);
    expect(before).toContain('value10 = 10000');

    const { dialog, confirm } = await openRevertDialog(page);

    const overConfirm = await topmostAt(page, confirm);
    expect(
      overConfirm.testid,
      `something else is on top of Discard: <${overConfirm.tag}> "${overConfirm.text}"`,
    ).toBe('hunk-revert-confirm');

    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-testid="hunk-apply-error"]')).toHaveCount(
      0,
    );

    const after = await waitForWorktreeDiff(
      () => repo.worktreeDiff(),
      (diff) => (diff.match(/^@@ /gm)?.length ?? 3) < 3,
    );

    // That hunk, and only that hunk. The other two regions are still modified.
    expect(after).not.toContain('value10 = 10000');
    expect(after).toContain('value55 = 55000');
    expect(after).toContain('value100 = 100000');
    expect(after.match(/^@@ /gm)?.length, `diff after revert:\n${after}`).toBe(
      2,
    );

    // A revert writes the working tree and nothing else.
    expect(repo.stagedDiff()).toBe('');
  });
});
