import { test, expect } from '../../support/fixtures';
import { expectNoBlockingViolationsInBothThemes } from '../../support/axe';

/**
 * Accessibility of the review shell's conflict banner and History tab -
 * TASK_2026_576 Batch 68, task 68.1.
 *
 * Both surfaces are read-only views of a git answer, so the backend is mocked:
 * the banner needs an operation in progress (`git:info.operation`, the field
 * `GitStatusService.operation()` reads), the timeline needs `git:log` and
 * `git:stashList` payloads that carry a root commit, a merge commit and a
 * truncated list. Each surface gets its own test so one failure never hides
 * the other, and each audit leaves a JSON, a markdown summary and a
 * screenshot per theme under `screenshots/axe/`.
 */

const BRANCH = {
  branch: 'feature/axe',
  upstream: 'origin/feature/axe',
  ahead: 1,
  behind: 0,
};

const COMMITS = [
  {
    sha: 'a'.repeat(40),
    shortSha: 'aaaaaaa',
    subject: 'feat(review): add the hunk toolbar',
    authorName: 'Ptah E2E',
    authorDate: '2026-10-01T10:00:00+03:00',
    parentCount: 1,
    isRoot: false,
  },
  {
    sha: 'b'.repeat(40),
    shortSha: 'bbbbbbb',
    subject: "Merge branch 'main' into feature/axe",
    authorName: 'Ptah E2E',
    authorDate: '2026-09-30T18:30:00+03:00',
    parentCount: 2,
    isRoot: false,
  },
  {
    sha: 'c'.repeat(40),
    shortSha: 'ccccccc',
    subject: 'chore: initial commit',
    authorName: 'Ptah E2E',
    authorDate: '2026-09-01T09:00:00+03:00',
    parentCount: 0,
    isRoot: true,
  },
];

test.describe('conflict banner and history timeline accessibility (TASK_2026_576 Batch 68)', () => {
  test('the conflict banner with a rebase in progress has no critical or serious a11y violations in dark and light', async ({
    ui,
  }, testInfo) => {
    const operation = {
      kind: 'rebase',
      conflictedPaths: ['src/a.ts', 'src/b.ts', 'docs/readme.md'],
    };
    await ui.mockRpc({
      'git:info': {
        isGitRepo: true,
        branch: BRANCH,
        files: [
          { path: 'src/a.ts', status: 'U', staged: false, isDirectory: false },
        ],
        operation,
      },
    });
    await ui.goto('git');
    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: BRANCH,
        files: [
          { path: 'src/a.ts', status: 'U', staged: false, isDirectory: false },
        ],
        isGitRepo: true,
        operation,
      },
    });
    const banner = ui.page.locator('[data-testid="conflict-banner"]');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(
      ui.page.locator('[data-testid="conflict-banner-heading"]'),
    ).toContainText('Rebase');
    await ui.page.mouse.move(2, 2);
    await expectNoBlockingViolationsInBothThemes(
      ui.page,
      'conflict-banner',
      testInfo,
      { include: 'ptah-conflict-banner', evidence: true },
    );
  });

  test('the history timeline with commits and stashes has no critical or serious a11y violations in dark and light', async ({
    ui,
  }, testInfo) => {
    await ui.mockRpc({
      'git:info': { isGitRepo: true, branch: BRANCH, files: [] },
      'git:log': {
        status: 'ok',
        mode: 'since-base',
        base: 'origin/main',
        branch: 'feature/axe',
        commits: COMMITS,
        truncated: true,
      },
      'git:stashList': {
        count: 2,
        entries: [
          {
            index: 0,
            hash: 'd'.repeat(40),
            message: 'WIP on feature/axe: aaaaaaa feat(review)',
            branch: 'feature/axe',
            time: 1_790_000_000_000,
          },
          {
            index: 1,
            hash: 'e'.repeat(40),
            message: 'On main: experiment',
            branch: 'main',
            time: 1_789_000_000_000,
          },
        ],
      },
    });
    await ui.goto('git');
    await ui.pushEvent({
      type: 'git:status-update',
      payload: { branch: BRANCH, files: [], isGitRepo: true },
    });
    await ui.reviewTab('History').click();
    const timeline = ui.page.locator('[data-testid="history-timeline"]');
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    await expect(
      timeline.locator('[data-testid="history-commit"]'),
    ).toHaveCount(2, { timeout: 30_000 });
    await expect(
      timeline.locator('[data-testid="history-root-commit"]'),
    ).toHaveCount(1);
    await expect(
      timeline.locator('[data-testid="history-stash-entry"]'),
    ).toHaveCount(2, { timeout: 30_000 });
    await ui.page.mouse.move(2, 2);
    await expectNoBlockingViolationsInBothThemes(
      ui.page,
      'history-timeline',
      testInfo,
      { include: '[data-testid="history-timeline"]', evidence: true },
    );
  });
});
