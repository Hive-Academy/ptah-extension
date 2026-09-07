import { test, expect } from '../../support/fixtures';

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
    await expect(page.locator('ptah-source-control-file')).toHaveCount(3);
  });
});
