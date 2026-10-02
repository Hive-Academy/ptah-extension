import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test as mockedTest, expect } from '../../support/fixtures';
import { test as realTest } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import type { UiDriver } from '../../support/ui-driver';
import { expectNoBlockingViolationsInBothThemes } from '../../support/axe';

/**
 * The review shell's Task tab (`ptah-task-worktree-view`) - TASK_2026_576
 * Batch 61, Requirement 10 (successor of the dock's worktree section).
 *
 * Two layers, each used where it proves the most:
 *  - Mocked RPC (fast): the branch panel with ahead/behind, the worktree rows,
 *    "switch opens the folder only on click", the Remove confirmation, and the
 *    quiet PR line for `gh-missing` and `not-authenticated`. These are
 *    renderer behaviours that need a controlled backend answer.
 *  - Real RPC (slow): add a worktree and remove it again against a real
 *    repository, read back from `git worktree list`, and the PR panel against a
 *    real backend with no GitHub remote.
 */

const WORKSPACE = 'C:\\ptah-e2e-ws';
const WORKTREE_PATH = `${WORKSPACE}\\.claude-worktrees\\agent-task`;
const BRANCH_STATUS = {
  branch: 'main',
  upstream: 'origin/main',
  ahead: 2,
  behind: 1,
};

async function openTaskTab(ui: UiDriver): Promise<void> {
  await ui.goto('git');
  await ui.reviewTab('Task').click();
  await expect(
    ui.page.locator('[data-testid="task-worktree-view"]'),
  ).toBeVisible({ timeout: 30_000 });
}

/** The PR panel must read as quiet text: no alert role, no error styling. */
async function expectQuietUnavailable(
  ui: UiDriver,
  expected?: string,
): Promise<void> {
  const line = ui.page.locator('[data-testid="task-pr-unavailable"]');
  await expect(line).toBeVisible({ timeout: 60_000 });
  if (expected) await expect(line).toContainText(expected);
  await expect(line).not.toHaveAttribute('role', /./);
  await expect(line).not.toHaveClass(/error|alert|warning/);
  const panel = ui.page.locator('[data-testid="task-pr-panel"]');
  await expect(panel.locator('[role="alert"]')).toHaveCount(0);
  await expect(panel.locator('.text-error, .alert-error')).toHaveCount(0);
}

mockedTest.describe('task tab, mocked backend', () => {
  mockedTest(
    'shows branch and ahead/behind, lists worktrees, switches only on click, and asks before Remove',
    async ({ ui }) => {
      await ui.mockRpc({
        'git:info': {
          isGitRepo: true,
          branch: BRANCH_STATUS,
          files: [],
        },
        'git:worktrees': {
          worktrees: [
            {
              path: WORKSPACE,
              branch: 'main',
              head: 'abc1234',
              isMain: true,
              isBare: false,
            },
            {
              path: WORKTREE_PATH,
              branch: 'agent/task',
              head: 'def5678',
              isMain: false,
              isBare: false,
            },
          ],
        },
        'git:prStatus': { status: 'unavailable', reason: 'gh-missing' },
        'git:removeWorktree': { success: true, pending: false },
      });
      await ui.goto('git');
      await ui.pushEvent({
        type: 'git:status-update',
        payload: { branch: BRANCH_STATUS, files: [], isGitRepo: true },
      });
      await ui.reviewTab('Task').click();
      const page = ui.page;

      // Branch panel: name, upstream, ahead and behind with screen-reader text.
      await expect(page.locator('[data-testid="task-branch-name"]')).toHaveText(
        'main',
      );
      await expect(
        page.locator('[data-testid="task-branch-upstream"]'),
      ).toContainText('origin/main');
      const aheadBehind = page.locator('[data-testid="task-ahead-behind"]');
      await expect(aheadBehind).toContainText('↑2');
      await expect(aheadBehind).toContainText('↓1');
      await expect(aheadBehind).toContainText('ahead');
      await expect(aheadBehind).toContainText('behind');

      // Worktree rows: the main one without Remove, the other with it.
      await expect(
        page.locator('[data-testid="task-worktrees-heading"]'),
      ).toHaveText('Worktrees (2)');
      const rows = page.locator('[data-testid="task-worktree-row"]');
      await expect(rows).toHaveCount(2);
      const mainRow = rows.nth(0);
      const agentRow = rows.nth(1);
      await expect(mainRow).toContainText('main');
      await expect(
        mainRow.locator('[data-testid="task-worktree-remove"]'),
      ).toHaveCount(0);
      const switchButton = agentRow.locator(
        '[data-testid="task-worktree-switch"]',
      );
      await expect(switchButton).toHaveAccessibleName(
        `Switch to agent/task, ${WORKTREE_PATH}`,
      );
      // Switch and Remove are sibling buttons, never nested.
      await expect(
        switchButton.locator('[data-testid="task-worktree-remove"]'),
      ).toHaveCount(0);

      // Listing a worktree opens nothing: switching is a click. (The shell's
      // own workspace sync may call `workspace:switch` for the main folder.)
      const openedWorktree = async (): Promise<boolean> => {
        const calls = [
          ...(await ui.getObservedCalls('workspace:registerFolder')),
          ...(await ui.getObservedCalls('workspace:switch')),
        ];
        return calls.some(
          (call) =>
            (call.params as { path?: string } | null)?.path === WORKTREE_PATH,
        );
      };
      expect(await openedWorktree()).toBe(false);
      await switchButton.click();
      await expect.poll(openedWorktree).toBe(true);

      // Remove asks first; Cancel removes nothing.
      const remove = agentRow.locator('[data-testid="task-worktree-remove"]');
      await expect(remove).toHaveAccessibleName('Remove worktree agent/task');
      await remove.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText('Remove worktree "agent/task"?');
      await expect(dialog).toContainText('Force remove');
      expect(await ui.getObservedCalls('git:removeWorktree')).toHaveLength(0);
      await dialog.locator('[data-testid="git-confirm-cancel"]').click();
      await expect(dialog).toHaveCount(0);
      expect(await ui.getObservedCalls('git:removeWorktree')).toHaveLength(0);
      await expect(rows).toHaveCount(2);

      // Confirming sends exactly one removal for that path, without force.
      await remove.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect
        .poll(async () => ui.getObservedCalls('git:removeWorktree'))
        .toEqual([
          expect.objectContaining({
            params: expect.objectContaining({
              path: WORKTREE_PATH,
              force: false,
            }),
          }),
        ]);
    },
  );

  mockedTest(
    'the PR panel shows a quiet unavailable line when gh is missing or not signed in',
    async ({ ui }) => {
      await ui.mockRpc({
        'git:info': { isGitRepo: true, branch: BRANCH_STATUS, files: [] },
        'git:worktrees': {
          worktrees: [
            {
              path: WORKSPACE,
              branch: 'main',
              head: 'abc1234',
              isMain: true,
              isBare: false,
            },
          ],
        },
        'git:prStatus': { status: 'unavailable', reason: 'gh-missing' },
      });
      await ui.goto('git');
      await ui.pushEvent({
        type: 'git:status-update',
        payload: { branch: BRANCH_STATUS, files: [], isGitRepo: true },
      });
      await ui.reviewTab('Task').click();

      await expectQuietUnavailable(ui, 'GitHub CLI not available');
      await expect(ui.page.locator('[data-testid="task-pr-open"]')).toHaveCount(
        0,
      );

      // The same panel, now `gh` is installed but not authenticated.
      await ui.mockRpc({
        'git:prStatus': { status: 'unavailable', reason: 'not-authenticated' },
      });
      await ui.page.locator('[data-testid="task-refresh"]').click();
      await expectQuietUnavailable(ui, 'GitHub CLI is not signed in');
    },
  );
});

mockedTest.describe('task tab, accessibility (TASK_2026_576 Batch 68)', () => {
  const worktrees = {
    worktrees: [
      {
        path: WORKSPACE,
        branch: 'main',
        head: 'abc1234',
        isMain: true,
        isBare: false,
      },
      {
        path: WORKTREE_PATH,
        branch: 'agent/task',
        head: 'def5678',
        isMain: false,
        isBare: false,
      },
    ],
  };

  mockedTest(
    'the task view with worktrees and an open PR panel has no critical or serious a11y violations in dark and light',
    async ({ ui }, testInfo) => {
      await ui.mockRpc({
        'git:info': { isGitRepo: true, branch: BRANCH_STATUS, files: [] },
        'git:worktrees': worktrees,
        'git:prStatus': {
          status: 'ok',
          pr: {
            number: 576,
            title: 'Review canvas, spot editor and commit composer',
            state: 'OPEN',
            isDraft: false,
            reviewDecision: 'CHANGES_REQUESTED',
            url: 'https://github.com/Hive-Academy/ptah-extension/pull/576',
            headRefName: 'feat/task-2026-576',
          },
          checks: { passing: 4, failing: 1, pending: 2, total: 7 },
        },
      });
      await ui.goto('git');
      await ui.pushEvent({
        type: 'git:status-update',
        payload: { branch: BRANCH_STATUS, files: [], isGitRepo: true },
      });
      await ui.reviewTab('Task').click();
      const page = ui.page;
      await expect(
        page.locator('[data-testid="task-worktrees-heading"]'),
      ).toHaveText('Worktrees (2)');
      await expect(page.locator('[data-testid="task-pr-open"]')).toBeVisible({
        timeout: 30_000,
      });
      // The add-worktree form is part of the view: audit it open.
      await page.locator('[data-testid="task-worktree-add-toggle"]').click();
      await page.mouse.move(2, 2);
      await expectNoBlockingViolationsInBothThemes(
        page,
        'task-view-pr',
        testInfo,
        { include: '[data-testid="task-worktree-view"]', evidence: true },
      );
    },
  );

  mockedTest(
    'the task view with the quiet PR line has no critical or serious a11y violations in dark and light',
    async ({ ui }, testInfo) => {
      await ui.mockRpc({
        'git:info': { isGitRepo: true, branch: BRANCH_STATUS, files: [] },
        'git:worktrees': worktrees,
        'git:prStatus': { status: 'unavailable', reason: 'gh-missing' },
      });
      await ui.goto('git');
      await ui.pushEvent({
        type: 'git:status-update',
        payload: { branch: BRANCH_STATUS, files: [], isGitRepo: true },
      });
      await ui.reviewTab('Task').click();
      await expectQuietUnavailable(ui, 'GitHub CLI not available');
      await ui.page.mouse.move(2, 2);
      await expectNoBlockingViolationsInBothThemes(
        ui.page,
        'task-view-quiet',
        testInfo,
        { include: '[data-testid="task-worktree-view"]', evidence: true },
      );
    },
  );
});

realTest.describe(
  'task tab, real backend (TASK_2026_576 Requirement 10)',
  () => {
    // A real boot into an empty home runs every SQLite migration from zero.
    realTest.setTimeout(240_000);

    realTest(
      'adds a worktree, then Remove asks for confirmation and removes it; the PR panel stays quiet',
      async ({ ui, rpcBridge, repo }) => {
        void rpcBridge;
        const page = ui.page;
        const worktreeDir = path.join(
          os.tmpdir(),
          `ptah-e2e-wt-${Date.now().toString(36)}`,
        );
        const listed = (): string =>
          repo.git('worktree', 'list', '--porcelain').replace(/\\/g, '/');
        const needle = worktreeDir.replace(/\\/g, '/');

        try {
          await openTaskTab(ui);
          await expect(
            page.locator('[data-testid="task-branch-name"]'),
          ).toHaveText('main', { timeout: 60_000 });
          const rows = page.locator('[data-testid="task-worktree-row"]');
          await expect(rows).toHaveCount(1);
          await expect(rows.first()).toContainText('main');

          // The real backend has no GitHub remote: a muted line, never an alert.
          await expectQuietUnavailable(ui);

          // Add a worktree on a new branch, in a directory of our choosing.
          await page
            .locator('[data-testid="task-worktree-add-toggle"]')
            .click();
          await page
            .locator('[data-testid="task-worktree-branch"]')
            .fill('feature/e2e-worktree');
          await page
            .locator('[data-testid="task-worktree-path"]')
            .fill(worktreeDir);
          await page
            .locator('[data-testid="task-worktree-create-branch"]')
            .check();
          await page.locator('[data-testid="task-worktree-create"]').click();

          await expect(rows).toHaveCount(2, { timeout: 60_000 });
          const added = rows.filter({ hasText: 'feature/e2e-worktree' });
          await expect(added).toHaveCount(1);
          expect(listed()).toContain(needle);
          expect(fs.existsSync(path.join(worktreeDir, THREE_HUNK_FILE))).toBe(
            true,
          );

          // Remove asks first; Cancel leaves the worktree on disk.
          const remove = added.locator('[data-testid="task-worktree-remove"]');
          await remove.click();
          const dialog = page.getByRole('alertdialog');
          await expect(dialog).toContainText(
            'Remove worktree "feature/e2e-worktree"?',
          );
          await dialog.locator('[data-testid="git-confirm-cancel"]').click();
          await expect(dialog).toHaveCount(0);
          await expect(rows).toHaveCount(2);
          expect(listed()).toContain(needle);

          // Confirm: the row goes and git no longer lists the worktree.
          await remove.click();
          await dialog
            .getByRole('button', { name: 'Remove', exact: true })
            .click();
          await expect(rows).toHaveCount(1, { timeout: 60_000 });
          expect(listed()).not.toContain(needle);
          await expect(
            page.locator('[data-testid="task-worktree-remove-error"]'),
          ).toHaveCount(0);
        } finally {
          fs.rmSync(worktreeDir, { recursive: true, force: true });
        }
      },
    );
  },
);
