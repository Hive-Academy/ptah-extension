import { test, expect } from '../../support/fixtures';

/**
 * Branch review controls on the review canvas � TASK_2026_576 Batch 60.
 *
 * Same user behaviour as before (start a branch review, read a file, mark it
 * viewed, Open In, switch branch); the surface changed: the comparison bar's
 * picker starts the review, the canvas section replaces the expandable file
 * row, and Viewed moved to the changed-file tree row.
 */
test.describe('historical branch review controls', () => {
  test.setTimeout(120_000);

  test('clicks mounted branch review, viewed, branch checkout, and Open In controls', async ({
    ui,
    electronApp,
  }) => {
    const root = 'C:\\ptah-e2e-ws';
    const baseSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    await ui.mockRpc({
      'git:info': {
        isGitRepo: true,
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        },
        files: [],
      },
      'git:branches': {
        current: 'main',
        local: [
          { name: 'main', isCurrent: true },
          { name: 'feature/review', isCurrent: false },
        ],
        remote: [],
      },
      'git:stashList': { success: true, entries: [], count: 0 },
      'git:lastCommit': { success: false },
      'git:checkout': { success: true },
      'editor:detectTargets': {
        targets: [{ id: 'kiro', displayName: 'Kiro', executablePath: 'kiro' }],
      },
      'editor:openFile': { success: true },
      'git:reviewChanges': {
        success: true,
        base: { name: 'main', sha: baseSha },
        head: { name: 'HEAD', sha: headSha },
        mergeBaseSha: baseSha,
        files: [
          {
            path: 'src/review.ts',
            status: 'M',
            additions: 3,
            deletions: 1,
            binary: false,
          },
        ],
        totals: { additions: 3, deletions: 1, binaryFiles: 0 },
      },
      'git:reviewFile': {
        success: true,
        path: 'src/review.ts',
        originalPath: 'src/review.ts',
        baseSha,
        headSha,
        original: { outcome: 'content', content: 'export const value = 1;\n' },
        modified: { outcome: 'content', content: 'export const value = 2;\n' },
      },
    });

    await ui.goto('git');
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getSize(),
      ),
    ).toEqual([1200, 800]);

    // The comparison picker (design-spec �6.2) replaced the old "Branch
    // review" toggle: choosing "Branch review�" there starts the review.
    await ui.page.locator('[data-testid="comparison-trigger"]').click();
    await ui.page.locator('[data-testid="comparison-option-branch"]').click();
    const reviewCall = await ui.waitForObservedCall('git:reviewChanges');
    expect(reviewCall.params).toEqual({
      workspaceRoot: root,
      base: 'main',
      head: 'HEAD',
    });
    await expect(
      ui.page.locator('[data-testid="comparison-base"]'),
    ).toHaveValue('main');
    await expect(
      ui.page.locator('[data-testid="comparison-head"]'),
    ).toHaveValue('HEAD');
    await expect(
      ui.page.locator('[data-testid="comparison-trigger"]'),
    ).toHaveText(/Branch review/);

    // Branch review keeps the picker open for its base/head selects; close it.
    await ui.page.keyboard.press('Escape');
    await expect(
      ui.page.locator('[data-testid="comparison-base"]'),
    ).toHaveCount(0);

    // The branch review is one continuous canvas: the file's section reads its
    // own diff as soon as it mounts, with no per-row "expand" click.
    const fileCall = await ui.waitForObservedCall('git:reviewFile');
    expect(fileCall.params).toEqual({
      workspaceRoot: root,
      baseSha,
      headSha,
      path: 'src/review.ts',
    });
    const section = ui.reviewFileSection('src/review.ts');
    await expect(section).toBeVisible();
    await expect(section.getByText('export const value = 2;')).toBeVisible();

    // Branch review is read-only: no hunk Accept/Reject on its toolbars.
    await expect(
      section.locator('[data-testid="hunk-stage"]'),
    ).not.toBeVisible();

    // Viewed lives on the tree row in a branch review (labelled by file name).
    const viewed = ui.page.getByRole('checkbox', {
      name: 'Viewed review.ts',
    });
    await viewed.click();
    await expect(viewed).toBeChecked();

    // Open In on the file header opens the file in the chosen editor.
    await section.locator('[data-testid="open-in-primary"]').click();
    expect((await ui.waitForObservedCall('editor:openFile')).params).toEqual({
      target: 'kiro',
      workspaceRoot: root,
      path: 'src/review.ts',
    });

    await ui.page.locator('[data-testid="current-branch-button"]').click();
    await ui.page
      .getByRole('button', { name: 'feature/review', exact: true })
      .click();
    expect((await ui.waitForObservedCall('git:checkout')).params).toEqual({
      workspaceRoot: root,
      branch: 'feature/review',
    });
  });
});
