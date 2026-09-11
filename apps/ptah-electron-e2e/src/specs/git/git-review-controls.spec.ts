import { test, expect } from '../../support/fixtures';

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

    await ui.page
      .getByRole('button', { name: 'Branch review', exact: true })
      .click();
    await expect(ui.page.locator('ptah-git-review-panel')).toBeVisible();
    await expect(
      ui.page.getByRole('button', { name: /src\/review\.ts/ }).first(),
    ).toBeVisible();
    const reviewCall = await ui.waitForObservedCall('git:reviewChanges');
    expect(reviewCall.params).toEqual({
      workspaceRoot: root,
      base: 'main',
      head: 'HEAD',
    });

    await ui.page
      .getByRole('button', { name: /src\/review\.ts/ })
      .first()
      .click();
    const fileCall = await ui.waitForObservedCall('git:reviewFile');
    expect(fileCall.params).toEqual({
      workspaceRoot: root,
      baseSha,
      headSha,
      path: 'src/review.ts',
    });
    await expect(
      ui.page.locator('ptah-git-review-file-row ptah-diff-view'),
    ).toBeVisible();

    await ui.page
      .getByRole('button', { name: 'Mark as viewed', exact: true })
      .click();
    await expect(
      ui.page.getByRole('button', { name: 'Unmark viewed', exact: true }),
    ).toBeVisible();
    await ui.page
      .locator('ptah-git-review-file-row [data-testid="open-in-primary"]')
      .click();
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
      force: false,
    });
  });
});
