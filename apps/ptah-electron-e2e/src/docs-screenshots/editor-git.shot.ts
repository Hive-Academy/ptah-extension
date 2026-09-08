import type { Page } from '@playwright/test';
import { test, expect, SAMPLE_REPO } from './_harness/docs-fixtures';
import { shoot } from './_harness/shooter';

/**
 * Editor and git shots (TASK_2026_260).
 *
 * Captured against a throwaway sample repo, never a real project: the app
 * rewrites `.codex/agents/*.toml` in whatever workspace it opens, and the
 * Source Control panel's row actions stage files for real.
 */
test.use({ workspace: SAMPLE_REPO });

/**
 * Drag the editor dock's resize handle left so the diff gets most of the
 * window. The handle is the rightmost `ptah-electron-resize-handle` (the
 * workspace and session rails own the others).
 */
async function widenEditorPanel(page: Page): Promise<void> {
  const handles = page.locator('ptah-electron-resize-handle');
  const count = await handles.count();
  let target: { x: number; y: number } | null = null;
  for (let i = 0; i < count; i++) {
    const box = await handles.nth(i).boundingBox();
    if (!box) continue;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (!target || center.x > target.x) target = center;
  }
  if (!target) return;
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(300, target.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

/** Collapse the workspace and session rails so a shot is all editor. */
async function collapseRails(page: Page): Promise<void> {
  for (const rail of ['Toggle Workspaces panel', 'Toggle Sessions panel']) {
    const toggle = page.locator(`[title="${rail}"], [aria-label="${rail}"]`);
    if (
      await toggle
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await toggle.first().click();
      await page.waitForTimeout(400);
    }
  }
}

test.describe('docs screenshots — editor & git', () => {
  test('git status, source control and diff', async ({ ui, page }) => {
    test.setTimeout(300_000);
    await ui.goto('git');

    // ── Git dock header ──────────────────────────────────────────────────────
    const dockHeader = page.locator('ptah-git-dock-header');
    await expect(dockHeader).toBeVisible();
    await shoot(page, 'git-dock-header', { crop: dockHeader });

    // ── Source control, with a commit message typed in ────────────────────────
    const sourceControl = page.locator('ptah-source-control-panel');
    await expect(sourceControl).toBeVisible();
    await page.waitForTimeout(1_500);

    const message = sourceControl.locator('textarea').first();
    if (await message.isVisible().catch(() => false)) {
      await message.fill('Apply the annual billing discount');
      await page.waitForTimeout(300);
    }
    await shoot(page, 'commit-composer', { crop: sourceControl });

    // ── Diff ─────────────────────────────────────────────────────────────────
    // Click the file NAME, not the row: the row carries stage/discard actions
    // and a stray hit on one of those mutates the repository.
    const fileRow = page.locator('ptah-source-control-file', {
      hasText: 'pricing.ts',
    });
    await expect(fileRow.first()).toBeVisible();
    await fileRow.first().getByText('pricing.ts').first().click();

    await expect(page.locator('ptah-diff-view')).toBeVisible();
    // A side-by-side diff squeezed into a third of the window truncates every
    // line it is meant to show.
    await collapseRails(page);
    await widenEditorPanel(page);
    await page.waitForTimeout(3_000);
    await shoot(page, 'diff-side-by-side', {
      crop: page.locator('ptah-git-dock'),
    });
  });
});
