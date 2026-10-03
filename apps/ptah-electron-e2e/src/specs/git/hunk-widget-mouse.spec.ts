import * as fs from 'fs';
import * as path from 'path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';

/**
 * The per-hunk action row, driven by the mouse — TASK_2026_221, retargeted to
 * the review canvas by TASK_2026_576 Batch 59.
 *
 * `TASK_2026_218` (`hunk-apply-real-rpc.spec.ts`) proves the KEYBOARD path
 * reaches `git apply`. This spec proves the MOUSE path with nothing else: it
 * clicks the hunk's own Accept and reads the index off disk. Nothing is
 * mocked; the assertion is `git diff --cached`, never a renderer signal.
 *
 * What changed with the surface. The Monaco glyph margin and the floating
 * selection-driven widget (`hunk-widget`, `ptah-hunk-glyph`) no longer exist
 * by design: the review canvas renders each hunk's `ptah-hunk-toolbar`
 * (Hunk i of n, Previous/Next, Accept, Reject) as an Angular-owned row slotted
 * into Pierre's shadow DOM at the hunk itself, so there is no "click the
 * glyph to select" step and no cluster that has to follow a selection. The
 * successor behaviours kept here are the ones the widget existed for:
 *   - the actions sit AT the hunk they act on (a click on hunk 1's Accept
 *     stages hunk 1 and no other);
 *   - the Angular bindings survive being relocated into the renderer's slot
 *     (a click that reaches the real RPC is the proof);
 *   - Reject is never a single unconfirmed click.
 *
 * The reproducible artefact lands in `dist/apps/ptah-electron-e2e/hunk-widget`.
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

async function assertDefaultWindow(
  electronApp: ElectronApplication,
): Promise<void> {
  const size = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getSize(),
  );
  expect(size).toEqual([1200, 800]);
}

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

test.describe('per-hunk action row, mouse (TASK_2026_221 / 576 Batch 59)', () => {
  // A real boot into an empty home runs every SQLite migration from zero before
  // the window is created, which does not fit the config-wide 60s budget.
  test.setTimeout(240_000);

  test('accepts a hunk with the mouse alone, from the hunk row', async ({
    ui,
    repo,
    electronApp,
  }, testInfo) => {
    const page = ui.page;

    expect(repo.stagedDiff()).toBe('');
    expect(repo.worktreeDiff().match(/^@@ /gm)?.length).toBe(3);

    await ui.goto('git');
    await assertDefaultWindow(electronApp);

    const section = ui.reviewFileSection(THREE_HUNK_FILE);
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(
      section.locator('[data-testid="pierre-hunk-host"]'),
    ).toHaveCount(3, { timeout: 30_000 });

    // Every hunk carries its own row from the start: nothing has to be
    // selected first, and each row names the hunk it acts on.
    for (const [index, label] of [
      'Hunk 1 of 3',
      'Hunk 2 of 3',
      'Hunk 3 of 3',
    ].entries()) {
      await expect(
        ui.hunkHost(index, section).locator('[data-testid="hunk-position"]'),
      ).toHaveText(label);
    }

    // The row is anchored AT the hunk, inside the section's own diff body,
    // not parked at a corner of the dock.
    const accept = ui.hunkAction(0, 'stage', section);
    await accept.scrollIntoViewIfNeeded();
    await expect(accept).toBeVisible();
    const acceptBox = await accept.boundingBox();
    const bodyBox = await section
      .locator('[data-testid="file-diff-body"]')
      .boundingBox();
    expect(acceptBox, 'Accept has no painted box').not.toBeNull();
    expect(bodyBox, 'the diff body has no painted box').not.toBeNull();
    expect(acceptBox?.y ?? -1).toBeGreaterThanOrEqual(bodyBox?.y ?? 0);
    expect((acceptBox?.y ?? 0) + (acceptBox?.height ?? 0)).toBeLessThanOrEqual(
      (bodyBox?.y ?? 0) + (bodyBox?.height ?? 0),
    );

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const shot = await page.screenshot({ scale: 'css' });
    const file = path.join(SCREENSHOT_DIR, 'hunk-row-anchored.png');
    fs.writeFileSync(file, shot);
    await testInfo.attach('hunk-row-anchored.png', {
      body: shot,
      contentType: 'image/png',
    });
    console.log(`
=== TASK_2026_221 hunk row evidence ===
  ${file}
`);

    // MOUSE — Accept on hunk 1. No keyboard anywhere in this test.
    await accept.click();

    await expect(page.locator('[data-testid="hunk-refused"]')).toHaveCount(0);

    const staged = await waitForStagedDiff(
      () => repo.stagedDiff(),
      (diff) => diff.length > 0,
    );

    // That hunk, and only that hunk.
    expect(staged).toContain('value10 = 10000');
    expect(staged).not.toContain('value55 = 55000');
    expect(staged).not.toContain('value100 = 100000');
    expect(staged.match(/^@@ /gm)?.length).toBe(1);

    // The accepted hunk leaves the working-tree diff: the other two keep
    // their rows once the re-read lands.
    await expect(
      ui
        .reviewFileSection(THREE_HUNK_FILE)
        .locator('[data-testid="pierre-hunk-host"]'),
    ).toHaveCount(2, { timeout: 30_000 });
  });

  /**
   * Reject is the one destructive action here, and it is never a single
   * unconfirmed click. This checks the confirmation still stands in front of
   * it: a row button that bypassed the dialog would be a data-loss path, not
   * an ergonomic win. The dialog is dismissed with Escape, the keyboard
   * answer the dialog contract promises; mouse answers are covered by
   * `hunk-revert-top-layer.spec.ts`.
   */
  test('Reject stops at the confirmation dialog and writes nothing', async ({
    ui,
    repo,
    electronApp,
  }) => {
    const page = ui.page;

    await ui.goto('git');
    await assertDefaultWindow(electronApp);
    const section = ui.reviewFileSection(THREE_HUNK_FILE);
    await expect(
      section.locator('[data-testid="pierre-hunk-host"]'),
    ).toHaveCount(3, { timeout: 30_000 });

    const before = repo.worktreeDiff();
    expect(before.match(/^@@ /gm)?.length).toBe(3);

    await ui.hunkAction(0, 'revert', section).click();

    const dialog = page.locator('[data-testid="git-confirm-dialog"]');
    await expect(dialog).toBeVisible();

    // Read from git, not from the UI: the press that opened the dialog wrote
    // nothing.
    expect(repo.worktreeDiff()).toBe(before);
    expect(repo.stagedDiff()).toBe('');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Still nothing, after the refusal resolved.
    expect(repo.worktreeDiff()).toBe(before);
    expect(repo.stagedDiff()).toBe('');
  });
});
