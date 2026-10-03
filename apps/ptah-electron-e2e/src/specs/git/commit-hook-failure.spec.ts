import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import type { ScratchRepo } from '../../support/git-scratch-repo';

/**
 * A git hook that rejects a commit, on the Commit tab (`ptah-commit-composer`)
 * - TASK_2026_576 RC1, Requirement 1.2.
 *
 * Nothing is mocked: the real renderer drives the real `git:commit` handler
 * over the real `rpc` channel against a real repository whose `pre-commit`
 * hook fails. Outcomes are read back from git on disk.
 *
 * `commit-composer.spec.ts` already proves the failing-then-passing round trip
 * and the kept message. This spec pins what that one does not: BOTH of the
 * hook's streams (stdout and stderr) reach the log, the log can take keyboard
 * focus, and the failure is announced in a `role="alert"` inside
 * `commit-failure`.
 */

/** A marker only the failing hook prints, so the log assertion cannot pass by accident. */
const HOOK_MARKER = 'ptah-e2e-hook: lint failed in src/calc.ts';

const COMMIT_MESSAGE = 'feat(calc): scale three values';

/**
 * Budget for one commit round trip. The renderer's own RPC timeout for a
 * commit is 615 s (hook timeout + margin); a two-line shell hook needs a few
 * seconds even on a cold Windows git, so this bounds a stuck commit without
 * turning machine load red.
 */
const COMMIT_ROUND_TRIP_MS = 60_000;

/**
 * Install `pre-commit` in a hooks directory the APP's git will use.
 *
 * The scratch repo's own git calls pass `-c core.hooksPath=/dev/null`, which
 * only reaches the processes the spec spawns (command-line config wins, so
 * the spec's own `git` calls still never run the hook). The app spawns its
 * own git, which reads the repository config — so the hooks path is written
 * there, overriding any global `core.hooksPath` on the machine. The directory
 * sits inside `.git` so it never shows up as a changed file.
 */
function installPreCommitHook(repo: ScratchRepo, exitCode: 0 | 1): void {
  const hooksDir = path.join(repo.root, '.git', 'ptah-e2e-hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-commit');
  const body =
    exitCode === 0
      ? ['#!/bin/sh', 'exit 0', '']
      : [
          '#!/bin/sh',
          `echo "${HOOK_MARKER}"`,
          'echo "ptah-e2e-hook: 1 problem" 1>&2',
          'exit 1',
          '',
        ];
  // LF only: Git for Windows runs hooks through its bundled sh.
  fs.writeFileSync(hookPath, body.join('\n'), { encoding: 'utf8' });
  fs.chmodSync(hookPath, 0o755);
  repo.git('config', 'core.hooksPath', hooksDir.replace(/\\/g, '/'));
}

test.describe('commit rejected by a git hook, end to end in Electron (TASK_2026_576 RC1)', () => {
  // A real boot into an empty home runs every SQLite migration from zero
  // before the window is created (see `real-rpc-fixtures.ts`).
  test.setTimeout(240_000);

  test('shows both hook streams in a focusable log and announces the failure; the message is kept', async ({
    ui,
    rpcBridge,
    repo,
  }) => {
    // `rpcBridge` is requested for its readiness gate: it waits out boot and
    // the first git spawn, so the commit below is timed on its own cost.
    void rpcBridge;
    const page = ui.page;

    // The app's own git runs under the fixture's isolated home, which has no
    // global identity; the scratch repo's `-c user.*` only reaches the spec's
    // git. Without a repo-local identity git refuses before any hook runs
    // ("Author identity unknown"), which is not the failure under test.
    repo.git('config', 'user.name', 'Ptah E2E');
    repo.git('config', 'user.email', 'e2e@ptah.invalid');
    repo.git('config', 'commit.gpgsign', 'false');

    repo.git('add', THREE_HUNK_FILE);
    installPreCommitHook(repo, 1);

    // Preconditions read from real git: one baseline commit, one staged file.
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(repo.stagedDiff()).not.toBe('');

    await ui.goto('git');
    await ui.reviewTab(/^Commit/).click();
    await expect(page.locator('[data-testid="commit-composer"]')).toBeVisible({
      timeout: 30_000,
    });

    const messageBox = page.locator('[data-testid="commit-message"]');
    const submit = page.locator('[data-testid="commit-submit"]');
    await messageBox.fill(COMMIT_MESSAGE);
    await expect(submit).toBeEnabled();
    await submit.click();

    // The hook's own output (stdout and stderr) is on screen, in a
    // keyboard-reachable log.
    const hookLog = page.getByRole('log', { name: 'Commit hook output' });
    await expect(hookLog).toBeVisible({ timeout: COMMIT_ROUND_TRIP_MS });
    await expect(hookLog).toContainText(HOOK_MARKER);
    await expect(hookLog).toContainText('ptah-e2e-hook: 1 problem');
    await expect(hookLog).toHaveAttribute('tabindex', '0');
    await hookLog.focus();
    await expect(hookLog).toBeFocused();

    await expect(
      page.locator('[data-testid="commit-failure"][role="alert"]'),
    ).toContainText('Your message was kept.');
    await expect(page.locator('[data-testid="commit-success"]')).toHaveCount(0);
    await expect(messageBox).toHaveValue(COMMIT_MESSAGE);

    // Git agrees: nothing was committed and the index is intact.
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(repo.stagedDiff()).not.toBe('');
  });
});
