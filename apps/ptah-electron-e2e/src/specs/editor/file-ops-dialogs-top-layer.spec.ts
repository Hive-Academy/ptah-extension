import * as fs from 'fs';
import * as path from 'path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../support/real-rpc-fixtures';

/**
 * The delete confirmation and the name-input dialog, answered by MOUSE —
 * TASK_2026_216.
 *
 * READ THIS BEFORE TRUSTING THE TASK CARRIER. TASK_2026_216 was escalated from
 * an accessibility gap to a correctness bug on the premise that these two
 * modals shared the hunk revert dialog's defect (TASK_2026_227): a
 * `<div class="modal modal-open z-50">` trapped inside the editor panel's
 * `isolation: isolate` wrapper AND the gridstack tile, painted over by the
 * canvas, with the canvas empty-state text taking the clicks on both buttons.
 *
 * That premise does not hold, and this spec is what established it. The revert
 * dialog is rendered by `<ptah-diff-view>`, which sits INSIDE the isolate
 * wrapper (`editor-panel.component.ts`, the region opened for the Monaco
 * surfaces). These two modals are declared at the END of the same template,
 * outside that wrapper entirely — so only ONE of the two stacking contexts the
 * carrier names ever contained them, and it does not out-rank them here. The
 * pre-fix `<div class="modal modal-open z-50">` shape was run against both
 * assertions below on a real build and PASSED: `elementFromPoint` named the
 * buttons, not the canvas.
 *
 * So the top-layer move is hardening for these two rather than a reproduction.
 * It is still the right shape — it makes reachability a property of the element
 * instead of a property of how gridstack happens to order the tile today, which
 * is exactly the assumption that failed for the sibling dialog — but the
 * mouse-unanswerable failure was never reproduced here, and nobody should read
 * this file as evidence that it was.
 *
 * What the spec is FOR, therefore, is a standing guard: these dialogs are
 * mouse-answerable, and this fails if a future layout change puts anything on
 * top of them. `Locator.click()` runs Playwright's own hit-testing and refuses
 * to click an element another would receive the event for, so an UNFORCED click
 * is itself the assertion; the `elementFromPoint` probe is there so a failure
 * names the culprit instead of timing out anonymously. jsdom can hold none of
 * it — no layout, no compositing, no hit-testing.
 *
 * Modelled on `hunk-revert-top-layer.spec.ts` (TASK_2026_227).
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
  'file-ops-dialogs-top-layer',
);

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
 * Assert the canvas really is behind `dialog`. Without this the spec could pass
 * in a layout where nothing overlaps, and would then be guarding nothing.
 */
async function expectCanvasBehind(page: Page, dialog: Locator): Promise<void> {
  const canvasHeading = page.getByRole('heading', { name: 'Orchestra Canvas' });
  await expect(canvasHeading).toBeVisible();
  const canvasBox = await canvasHeading.boundingBox();
  const boxBox = await dialog.locator('.modal-box').boundingBox();
  expect(canvasBox, 'the canvas heading has no painted box').not.toBeNull();
  expect(boxBox, 'the modal box has no painted box').not.toBeNull();
  expect(
    overlaps(canvasBox!, boxBox!),
    'the canvas heading and the modal box do not overlap, so this run is not ' +
      'exercising the collision the task is about',
  ).toBe(true);
}

/** Write the human-reviewable artifact and attach it to the run. */
async function shoot(
  page: Page,
  name: string,
  testInfo: TestInfo,
): Promise<string> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const shot = await page.screenshot({ scale: 'css' });
  const file = path.join(SCREENSHOT_DIR, name);
  fs.writeFileSync(file, shot);
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
  console.log(`\n=== TASK_2026_216 dialog evidence ===\n  ${file}\n`);
  return file;
}

test.describe('file-ops dialogs are answerable by mouse (TASK_2026_216)', () => {
  // A real boot into an empty home runs every SQLite migration from zero before
  // the window is created, which does not fit the config-wide 60s budget.
  test.setTimeout(240_000);

  /** Right-click a file-tree row and pick a context-menu item, mouse only. */
  async function chooseMenuAction(
    page: Page,
    rowName: string,
    item: string,
  ): Promise<void> {
    const row = page.getByRole('treeitem', { name: rowName, exact: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'File actions' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: item, exact: true }).click();
  }

  test('the delete confirmation paints above the canvas and gives Cancel the mouse', async ({
    ui,
    repo,
  }, testInfo) => {
    const page = ui.page;
    await ui.goto('editor');

    await chooseMenuAction(page, 'src', 'Delete');

    const dialog = page.locator('[data-testid="delete-confirm-dialog"]');
    await expect(dialog).toBeVisible();
    await expectCanvasBehind(page, dialog);

    const cancel = page.locator('[data-testid="delete-confirm-cancel"]');
    const accept = page.locator('[data-testid="delete-confirm-accept"]');

    // The assertion proper. The failure message prints whatever actually won,
    // which is how the equivalent spec for the revert dialog named the canvas
    // empty-state text as the culprit.
    const overCancel = await topmostAt(page, cancel);
    expect(
      overCancel.testid,
      `something else is on top of Cancel: <${overCancel.tag}> "${overCancel.text}"`,
    ).toBe('delete-confirm-cancel');

    const overAccept = await topmostAt(page, accept);
    expect(
      overAccept.testid,
      `something else is on top of Delete: <${overAccept.tag}> "${overAccept.text}"`,
    ).toBe('delete-confirm-accept');

    await shoot(page, 'delete-confirm-above-canvas.png', testInfo);

    // A real, unforced click — Playwright refuses it if anything intercepts.
    await cancel.click();
    await expect(dialog).toHaveCount(0);

    // Read from the filesystem, not the UI: Cancel must destroy nothing.
    expect(fs.existsSync(path.join(repo.root, 'src'))).toBe(true);
  });

  test('the name dialog paints above the canvas and creates the file it was typed into', async ({
    ui,
    repo,
  }, testInfo) => {
    const page = ui.page;
    await ui.goto('editor');

    await chooseMenuAction(page, 'src', 'New File');

    const dialog = page.locator('[data-testid="name-input-dialog"]');
    await expect(dialog).toBeVisible();
    await expectCanvasBehind(page, dialog);

    const input = dialog.locator('input[type="text"]');
    const accept = page.locator('[data-testid="name-input-accept"]');

    const overInput = await topmostAt(page, input);
    expect(
      overInput.testid,
      `something else is on top of the name field: <${overInput.tag}> "${overInput.text}"`,
    ).toBe('name-input-dialog');

    const overAccept = await topmostAt(page, accept);
    expect(
      overAccept.testid,
      `something else is on top of OK: <${overAccept.tag}> "${overAccept.text}"`,
    ).toBe('name-input-accept');

    await shoot(page, 'name-input-above-canvas.png', testInfo);

    // Unforced click into the field, then real typing, then an unforced OK.
    await input.click();
    await input.fill('made-by-mouse.ts');
    await accept.click();
    await expect(dialog).toHaveCount(0);

    const created = path.join(repo.root, 'src', 'made-by-mouse.ts');
    await expect
      .poll(() => fs.existsSync(created), { timeout: 20_000 })
      .toBe(true);
  });
});
