import { test, expect } from '../../support/fixtures';
import { test as realTest } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import { gitDiffFileMock } from '../../support/git-diff-mock';
import { expectNoBlockingViolationsInBothThemes } from '../../support/axe';

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
 *
 * TASK_2026_576 Batch 59 retargets the file to the review shell
 * (`ptah-review-shell`, mounted by the Electron shell in place of
 * `ptah-git-dock`). The header (`ptah-git-dock-header`, Fetch/Pull/Push) is
 * unchanged. The dock's file list and diff tabs are replaced by the review
 * canvas: a `ptah-changed-file-tree` rail plus one continuous
 * `ptah-file-diff-section` per changed file, so "open, switch and close
 * diff tabs" has no literal successor and is proven as "each changed file
 * has its own independent section and selecting a row activates it". The
 * last case runs axe over the shell in both themes.
 */
test.describe('Git dock', () => {
  test('background worktree creation refreshes the list without switching workspace', async ({
    ui,
  }) => {
    const workspacePath = 'C:\\ptah-e2e-ws';
    const worktreePath = `${workspacePath}\\.claude-worktrees\\agent-task`;
    await ui.mockRpc({
      'git:info': {
        isGitRepo: true,
        branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
        files: [],
      },
      'git:worktrees': {
        worktrees: [
          {
            path: workspacePath,
            branch: 'main',
            head: 'abc1234',
            isMain: true,
            isBare: false,
          },
          {
            path: worktreePath,
            branch: 'agent/task',
            head: 'def5678',
            isMain: false,
            isBare: false,
          },
        ],
      },
    });
    await ui.goto('git');
    // Worktrees moved from a collapsible dock section to the Task tab.
    await ui.reviewTab('Task').click();
    const switchRow = ui.page.getByRole('button', {
      name: `Switch to agent/task, ${worktreePath}`,
      exact: true,
    });

    const switchCallsBefore = (await ui.getObservedCalls('workspace:switch'))
      .length;
    const registerCallsBefore = (
      await ui.getObservedCalls('workspace:registerFolder')
    ).length;

    await ui.pushEvent({
      type: 'git:worktreeChanged',
      payload: {
        action: 'created',
        name: 'agent-task',
        path: worktreePath,
      },
    });

    await expect(switchRow).toBeVisible();
    expect(await ui.getObservedCalls('workspace:switch')).toHaveLength(
      switchCallsBefore,
    );
    expect(await ui.getObservedCalls('workspace:registerFolder')).toHaveLength(
      registerCallsBefore,
    );
  });
  test('git dock header keeps Fetch, Pull and Push available when the branch is in sync', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'git:fetch': { success: true },
      'git:pull': { success: true },
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

    const fetchButton = page.locator('[data-testid="git-fetch-button"]');
    const pullButton = page.locator('[data-testid="git-pull-button"]');
    const pushButton = page.locator('[data-testid="git-push-button"]');

    await expect(fetchButton).toBeVisible();
    await expect(fetchButton).toHaveAccessibleName('Fetch');
    await expect(pullButton).toBeVisible();
    await expect(pullButton).toHaveAccessibleName('Pull');
    await expect(pushButton).toBeVisible();
    await expect(pushButton).toHaveAccessibleName('Push');

    await fetchButton.click();
    expect((await ui.waitForObservedCall('git:fetch')).method).toBe(
      'git:fetch',
    );
    await expect(pullButton).toBeEnabled();
    await pullButton.click();
    expect((await ui.waitForObservedCall('git:pull')).method).toBe('git:pull');
    await expect(pushButton).toBeEnabled();
    await pushButton.click();
    expect((await ui.waitForObservedCall('git:push')).method).toBe('git:push');
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
          behind: 3,
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
    await expect(pushButton).toHaveAccessibleName('Push (2 ahead)');
    await expect(pushButton).toContainText('↑2');

    const pullButton = page.locator('[data-testid="git-pull-button"]');
    await expect(pullButton).toBeVisible();
    await expect(pullButton).toHaveAccessibleName('Pull (3 behind)');
    await expect(pullButton).toContainText('↓3');

    await expect(
      page.locator('[data-testid="git-fetch-button"]'),
    ).toBeVisible();

    await pushButton.click();

    const observed = await ui.waitForObservedCall('git:push');
    expect(observed.method).toBe('git:push');
  });

  test('CX:120 — a synthetic git:status-update reaches the dock (file count and branch)', async ({
    ui,
  }) => {
    await ui.goto('git');
    const page = ui.page;

    await expect(ui.reviewShell()).toBeVisible();

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

    // File count updates: the Changes tab's accessible name carries it.
    await expect(ui.reviewTab(/^Changes, 3 changed files/)).toBeVisible();

    // The tree lists one row per changed file, staged and unstaged apart.
    const tree = page.getByRole('tree', { name: 'Changed files' });
    await expect(tree.locator('[data-testid="tree-row-file"]')).toHaveCount(3);
    await expect(tree.locator('[data-testid="tree-row-section"]')).toHaveCount(
      2,
    );

    // A folder is collapsible: collapsing hides its files, expanding brings
    // them back.
    const srcFolder = tree
      .locator('[data-testid="tree-row-folder"]', { hasText: 'src' })
      .first();
    await expect(srcFolder).toHaveAttribute('aria-expanded', 'true');
    await srcFolder.click();
    await expect(srcFolder).toHaveAttribute('aria-expanded', 'false');
    await expect(tree.locator('[data-testid="tree-row-file"]')).not.toHaveCount(
      3,
    );
    await srcFolder.click();
    await expect(srcFolder).toHaveAttribute('aria-expanded', 'true');
    await expect(tree.locator('[data-testid="tree-row-file"]')).toHaveCount(3);
  });

  test('every changed file gets its own independent diff section', async ({
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
        files: [
          { path: 'alpha.ts', status: 'M', staged: false, isDirectory: false },
          { path: 'beta.ts', status: 'M', staged: false, isDirectory: false },
        ],
        isGitRepo: true,
      },
    });

    // One path-keyed mock, registered before any section reads: a section can
    // re-request its diff (e.g. on a refresh) and must get its own payload,
    // never whatever static reply was installed most recently. The resolver
    // runs in the main process, so the table is embedded rather than closed
    // over.
    const diffByPath = {
      'alpha.ts': gitDiffFileMock({
        path: 'alpha.ts',
        comparison: 'worktree',
        original: "export const value = 'alpha original';\n",
        modified: "export const value = 'alpha modified';\n",
        snapshotToken: 'alpha-snapshot',
      }),
      'beta.ts': gitDiffFileMock({
        path: 'beta.ts',
        comparison: 'worktree',
        original: "export const value = 'beta original';\n",
        modified: "export const value = 'beta modified';\n",
        snapshotToken: 'beta-snapshot',
      }),
    };
    await ui.mockRpc({
      'git:diffFile': `(params) => (${JSON.stringify(diffByPath)})[params.path]`,
    });

    const alpha = ui.reviewFileSection('alpha.ts');
    const beta = ui.reviewFileSection('beta.ts');
    await expect(alpha).toBeVisible();
    await expect(beta).toBeVisible();
    await expect(alpha.getByText('alpha modified')).toBeVisible();
    await expect(beta.getByText('beta modified')).toBeVisible();
    // Each section shows only its own file.
    await expect(alpha.getByText('beta modified')).toHaveCount(0);
    await expect(beta.getByText('alpha modified')).toHaveCount(0);

    // Selecting a tree row activates that file (and only that file).
    const tree = page.getByRole('tree', { name: 'Changed files' });
    const alphaRow = tree.locator('[data-testid="tree-row-file"]', {
      hasText: 'alpha.ts',
    });
    const betaRow = tree.locator('[data-testid="tree-row-file"]', {
      hasText: 'beta.ts',
    });
    await betaRow.click();
    await expect(betaRow).toHaveAttribute('aria-selected', 'true');
    await expect(alphaRow).toHaveAttribute('aria-selected', 'false');
    await alphaRow.click();
    await expect(alphaRow).toHaveAttribute('aria-selected', 'true');
    await expect(betaRow).toHaveAttribute('aria-selected', 'false');
    await expect(alpha.getByText('alpha modified')).toBeVisible();
  });

  test('the review shell has no critical or serious a11y violations in dark and light', async ({
    ui,
  }, testInfo) => {
    await ui.mockRpc({
      'git:diffFile': `(params) => (${JSON.stringify({
        'alpha.ts': gitDiffFileMock({
          path: 'alpha.ts',
          comparison: 'worktree',
          original: "export const value = 'alpha original';\n",
          modified: "export const value = 'alpha modified';\n",
          snapshotToken: 'alpha-snapshot',
        }),
      })})[params.path]`,
    });
    await ui.goto('git');

    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 1,
          behind: 1,
        },
        files: [
          { path: 'alpha.ts', status: 'M', staged: false, isDirectory: false },
        ],
        isGitRepo: true,
      },
    });

    // Audit the populated surface, not the loading placeholder: the tabs, the
    // tree and a rendered diff must all be on screen first.
    await expect(ui.reviewTab(/^Changes, 1 changed file/)).toBeVisible();
    await expect(
      ui.reviewFileSection('alpha.ts').getByText('alpha modified'),
    ).toBeVisible();

    await expectNoBlockingViolationsInBothThemes(
      ui.page,
      'review-shell',
      testInfo,
      { include: 'ptah-review-shell', evidence: true },
    );
    await expectNoBlockingViolationsInBothThemes(
      ui.page,
      'review-header',
      testInfo,
      { include: 'ptah-git-dock-header', evidence: true },
    );
  });
});

/**
 * The canvas audit runs against a real repository: its three hunks give three
 * real hunk rows (the mocked `git:diffFile` replies carry no stage snapshot, so
 * the rows are not projected there).
 */
realTest.describe('Review canvas a11y (TASK_2026_576 Batch 68)', () => {
  realTest.setTimeout(300_000);

  realTest(
    'the review canvas with diffs and hunk rows has no critical or serious a11y violations in dark and light',
    async ({ ui, rpcBridge, repo }, testInfo) => {
      void rpcBridge;
      void repo;
      await ui.goto('git');
      const section = ui.reviewFileSection(THREE_HUNK_FILE);
      await expect(
        section.locator('[data-testid="pierre-hunk-host"]'),
      ).toHaveCount(3, { timeout: 60_000 });

      // Pierre reads the theme when a diff mounts, so each theme gets a fresh
      // mount: leave the Changes tab and come back.
      await expectNoBlockingViolationsInBothThemes(
        ui.page,
        'review-canvas',
        testInfo,
        {
          include: '[data-testid="review-shell-changes-body"]',
          evidence: true,
          remount: async () => {
            await ui.reviewTab('Task').click();
            await ui.reviewTab(/^Changes/).click();
            await expect(
              section.locator('[data-testid="pierre-hunk-host"]'),
            ).toHaveCount(3, { timeout: 30_000 });
          },
        },
      );
    },
  );
});
