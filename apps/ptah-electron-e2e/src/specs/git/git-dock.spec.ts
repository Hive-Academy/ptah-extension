import { test, expect } from '../../support/fixtures';
import { gitDiffFileMock } from '../../support/git-diff-mock';

/**
 * Git dock (TASK_2026_385 Batch 3.3).
 *
 * The first two cases are a direct port of `editor.spec.ts:145-194` — same
 * assertions, new host. `GitStatusBarComponent` (the editor library's private
 * copy) is replaced by `GitDockHeaderComponent`, reached through the
 * Electron shell's Git dock (`ui.goto('git')`) instead of the editor panel.
 *
 * The third case pins acceptance criterion CX:120: a synthetic
 * `git:status-update` push must reach the dock's file list and branch label
 * once `GitDockComponent` has armed `GitStatusService.startListening()` —
 * proving the dock is not silently deaf the way it would be before Batch 3.1
 * (see `git-dock.component.ts`'s constructor doc).
 */
test.describe('Git dock', () => {
  test('git dock header hides the push button when there is nothing to push', async ({
    ui,
  }) => {
    await ui.goto('git');
    const page = ui.page;

    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        },
        files: [],
        isGitRepo: true,
      },
    });

    const header = page.locator(
      'ptah-git-dock-header [role="status"][aria-label="Git status"]',
    );
    await expect(header).toBeVisible();

    await expect(page.locator('[data-testid="git-push-button"]')).toHaveCount(
      0,
    );
  });

  test('git dock header push button pushes unpushed commits to remote', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'git:push': { success: true },
    });

    await ui.goto('git');
    const page = ui.page;

    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 2,
          behind: 0,
        },
        files: [],
        isGitRepo: true,
      },
    });

    const header = page.locator(
      'ptah-git-dock-header [role="status"][aria-label="Git status"]',
    );
    await expect(header).toBeVisible();

    const pushButton = page.locator('[data-testid="git-push-button"]');
    await expect(pushButton).toBeVisible();
    await expect(pushButton).toContainText('Push');

    await pushButton.click();

    const observed = await ui.waitForObservedCall('git:push');
    expect(observed.method).toBe('git:push');
  });

  test('CX:120 — a synthetic git:status-update reaches the dock (file count and branch)', async ({
    ui,
  }) => {
    await ui.goto('git');
    const page = ui.page;

    await expect(page.locator('ptah-git-dock')).toBeVisible();

    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: {
          branch: 'feature/cx-120',
          upstream: 'origin/feature/cx-120',
          ahead: 1,
          behind: 0,
        },
        files: [
          { path: 'src/a.ts', status: 'M', staged: false, isDirectory: false },
          { path: 'src/b.ts', status: 'A', staged: true, isDirectory: false },
          { path: 'src/c.ts', status: 'M', staged: false, isDirectory: false },
        ],
        isGitRepo: true,
      },
    });

    // Branch label updates.
    await expect(page.locator('ptah-git-dock-header')).toContainText(
      'feature/cx-120',
    );

    // File count updates — the dock lists one row per changed file.
    const changedFiles = page.getByRole('list', {
      name: 'Changed files',
      exact: true,
    });
    const changedSrc = changedFiles.getByRole('button', {
      name: 'Toggle src folder',
      exact: true,
    });
    await expect(changedSrc).toHaveAttribute('aria-expanded', 'false');
    await changedSrc.click();
    await expect(changedSrc).toHaveAttribute('aria-expanded', 'true');
    await expect(
      changedFiles.getByRole('button', { name: 'Open diff for a.ts' }),
    ).toBeVisible();
    await expect(
      changedFiles.getByRole('button', { name: 'Open diff for c.ts' }),
    ).toBeVisible();
    expect(await ui.getObservedCalls('git:diffFile')).toEqual([]);
    await expect(page.locator('ptah-diff-view')).toHaveCount(0);
    await expect(page.locator('[data-testid="diff-error-overlay"]')).toHaveCount(
      0,
    );

    await changedSrc.click();
    await expect(changedSrc).toHaveAttribute('aria-expanded', 'false');
    await expect(
      changedFiles.getByRole('button', { name: 'Open diff for a.ts' }),
    ).toHaveCount(0);

    await changedSrc.click();
    const stagedSrc = page
      .getByRole('list', { name: 'Staged files', exact: true })
      .getByRole('button', { name: 'Toggle src folder', exact: true });
    await stagedSrc.click();
    await expect(page.locator('ptah-source-control-file')).toHaveCount(3);
  });

  test('opens, switches, and closes independent diff tabs', async ({ ui }) => {
    await ui.goto('git');
    const page = ui.page;

    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        },
        files: [
          { path: 'alpha.ts', status: 'M', staged: false, isDirectory: false },
          { path: 'beta.ts', status: 'M', staged: false, isDirectory: false },
        ],
        isGitRepo: true,
      },
    });

    const changedFiles = page.getByRole('list', {
      name: 'Changed files',
      exact: true,
    });

    await ui.mockRpc({
      'git:diffFile': gitDiffFileMock({
        path: 'alpha.ts',
        comparison: 'worktree',
        original: "export const value = 'alpha original';\n",
        modified: "export const value = 'alpha modified';\n",
        snapshotToken: 'alpha-snapshot',
      }),
    });
    await changedFiles
      .getByRole('button', { name: 'Open diff for alpha.ts', exact: true })
      .click();

    const alphaTab = page.getByRole('tab', {
      name: 'alpha.ts (working tree)',
      exact: true,
    });
    await expect(alphaTab).toBeVisible();
    await expect(page.locator('ptah-diff-view .view-lines').last()).toContainText(
      'alpha modified',
    );

    await ui.mockRpc({
      'git:diffFile': gitDiffFileMock({
        path: 'beta.ts',
        comparison: 'worktree',
        original: "export const value = 'beta original';\n",
        modified: "export const value = 'beta modified';\n",
        snapshotToken: 'beta-snapshot',
      }),
    });
    await changedFiles
      .getByRole('button', { name: 'Open diff for beta.ts', exact: true })
      .click();

    const betaTab = page.getByRole('tab', {
      name: 'beta.ts (working tree)',
      exact: true,
    });
    const diffTablist = page.getByRole('tablist', { name: 'Open diffs' });
    await expect(diffTablist).toBeVisible();
    await expect(diffTablist.getByRole('tab')).toHaveCount(2);
    await expect(betaTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('ptah-diff-view .view-lines').last()).toContainText(
      'beta modified',
    );

    await alphaTab.click();
    await expect(alphaTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('ptah-diff-view .view-lines').last()).toContainText(
      'alpha modified',
    );

    await page
      .getByRole('button', {
        name: 'Close diff for alpha.ts (working tree)',
        exact: true,
      })
      .click();
    await expect(alphaTab).toHaveCount(0);
    await expect(diffTablist.getByRole('tab')).toHaveCount(1);
    await expect(betaTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('ptah-diff-view .view-lines').last()).toContainText(
      'beta modified',
    );
  });
});
