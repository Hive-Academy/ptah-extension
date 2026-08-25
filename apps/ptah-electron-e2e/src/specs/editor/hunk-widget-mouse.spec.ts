import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';

/**
 * The in-editor hunk action widget, driven by the mouse — TASK_2026_221.
 *
 * `TASK_2026_218` proved the KEYBOARD path reaches `git apply`: it stepped the
 * header toolbar and asserted on `git diff --cached`. It could not prove the
 * mouse path, because until this task there was no affordance at the hunk to
 * click — a mouse user selected in the gutter and then travelled to the header.
 *
 * So this spec drives the whole thing with the mouse and nothing else. It
 * clicks the glyph margin to select, clicks Stage on the floating cluster that
 * appears at the hunk, and then reads the index off disk. Nothing is mocked;
 * the assertion is `git diff --cached`, never a renderer signal.
 *
 * The widget lives in DOM Monaco owns, rendered from an Angular embedded view.
 * A click that reaches the real RPC is therefore also the proof that the
 * Angular bindings survived being relocated into Monaco's content-widget layer
 * — the specific risk Batch 8B named when it declined to build this.
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
  'hunk-widget',
);

const FILE_NAME = THREE_HUNK_FILE.split('/').pop() as string;

/**
 * Poll the repo's index until `predicate` holds. The apply crosses an IPC round
 * trip and a `git apply` child process, so the spec waits on the observable end
 * state rather than on a renderer signal.
 */
async function waitForStagedDiff(
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
        `Timed out after ${timeoutMs}ms waiting on the git index.\n` +
          `Last \`git diff --cached\`:\n${last || '(empty)'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.describe('in-editor hunk action widget (TASK_2026_221)', () => {
  // A real boot into an empty home runs every SQLite migration from zero before
  // the window is created, which does not fit the config-wide 60s budget.
  test.setTimeout(240_000);

  test('stages a hunk with the mouse alone, from the glyph margin to the widget', async ({
    ui,
    repo,
  }, testInfo) => {
    const page = ui.page;

    expect(repo.stagedDiff()).toBe('');
    expect(repo.worktreeDiff().match(/^@@ /gm)?.length).toBe(3);

    await ui.goto('editor');
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

    const widget = page.locator('[data-testid="hunk-widget"]');

    // Nothing selected yet, so no cluster. A widget hovering over an arbitrary
    // hunk would imply one was already armed.
    await expect(widget).toHaveCount(0);

    // MOUSE STEP 1 — click the glyph marker itself. This is the affordance
    // TASK_2026_222 measured; here it is used, not measured.
    const glyph = page
      .locator(
        'ptah-diff-view .modified-in-monaco-diff-editor .ptah-hunk-glyph',
      )
      .first();
    await expect(glyph).toBeVisible({ timeout: 20_000 });
    await glyph.click();

    await expect(page.locator('[data-testid="hunk-position"]')).toHaveText(
      'Hunk 1 of 3',
    );
    await expect(widget).toBeVisible();

    // The cluster is anchored AT the hunk, not parked at an editor corner —
    // that is the whole difference between a content widget and the overlay
    // widget the original task text asked for.
    const widgetBox = await widget.boundingBox();
    const glyphBox = await glyph.boundingBox();
    expect(widgetBox, 'the widget has no painted box').not.toBeNull();
    expect(glyphBox).not.toBeNull();
    const verticalGap = Math.abs(
      (widgetBox?.y ?? 0) + (widgetBox?.height ?? 0) - (glyphBox?.y ?? 0),
    );
    expect(
      verticalGap,
      `the widget is ${verticalGap}px from the hunk it acts on — it is supposed ` +
        'to be anchored at modifiedStart, one line above it',
    ).toBeLessThan(60);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const shot = await page.screenshot({ scale: 'css' });
    const file = path.join(SCREENSHOT_DIR, 'hunk-widget-anchored.png');
    fs.writeFileSync(file, shot);
    await testInfo.attach('hunk-widget-anchored.png', {
      body: shot,
      contentType: 'image/png',
    });
    console.log(`\n=== TASK_2026_221 widget evidence ===\n  ${file}\n`);

    // MOUSE STEP 2 — stage from the cluster. No keyboard anywhere in this test.
    await page.locator('[data-testid="hunk-widget-stage"]').click();

    await expect(page.locator('[data-testid="hunk-apply-error"]')).toHaveCount(
      0,
    );

    const staged = await waitForStagedDiff(
      () => repo.stagedDiff(),
      (diff) => diff.length > 0,
    );

    // That hunk, and only that hunk.
    expect(staged).toContain('value10 = 10000');
    expect(staged).not.toContain('value55 = 55000');
    expect(staged).not.toContain('value100 = 100000');
    expect(staged.match(/^@@ /gm)?.length).toBe(1);

    // The apply clears the selection, so the cluster must go with it rather
    // than linger over a hunk nobody has selected.
    await expect(widget).toHaveCount(0);
  });

  /**
   * Discard is the one destructive action here, and D2 AC5 says it is never a
   * single unconfirmed click. The widget is a NEW entry point to it, so this
   * checks the confirmation still stands in front of it — a floating button
   * that bypassed the dialog would be a data-loss path, not an ergonomic win.
   *
   * The dialog is dismissed with Escape rather than by clicking Cancel, and
   * that is a finding rather than a convenience: in the Electron layout the
   * revert modal paints BEHIND the canvas panel, so its two buttons cannot be
   * clicked at all. That is `TASK_2026_173` Batch 8B's dialog, not this
   * widget — it predates it and the keyboard path (Escape, Tab) still works,
   * which is why no jsdom spec could have caught it. Filed separately; this
   * spec asserts the property that belongs to the widget, which is that
   * pressing Discard on it writes nothing and raises the confirmation.
   */
  test('the widget Discard stops at the confirmation dialog and writes nothing', async ({
    ui,
    repo,
  }) => {
    const page = ui.page;

    await ui.goto('editor');
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

    const before = repo.worktreeDiff();
    expect(before.match(/^@@ /gm)?.length).toBe(3);

    await page
      .locator(
        'ptah-diff-view .modified-in-monaco-diff-editor .ptah-hunk-glyph',
      )
      .first()
      .click();
    await expect(page.locator('[data-testid="hunk-widget"]')).toBeVisible();

    await page.locator('[data-testid="hunk-widget-revert"]').click();

    const dialog = page.locator('[data-testid="hunk-revert-dialog"]');
    await expect(dialog).toBeVisible();

    // Read from git, not from the UI: the point is that nothing was written
    // by the press that opened the dialog.
    expect(repo.worktreeDiff()).toBe(before);
    expect(repo.stagedDiff()).toBe('');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Still nothing, after the refusal resolved.
    expect(repo.worktreeDiff()).toBe(before);
    expect(repo.stagedDiff()).toBe('');
  });
});
