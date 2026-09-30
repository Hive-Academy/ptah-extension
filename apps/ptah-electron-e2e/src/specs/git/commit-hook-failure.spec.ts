import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import type { ScratchRepo } from '../../support/git-scratch-repo';
import { sourceControlFileButton } from '../../support/source-control';

/**
 * A git hook that rejects a commit, end to end in Electron — TASK_2026_576
 * RC1, Requirement 1.2.
 *
 * Nothing is mocked. The real renderer drives the real `git:commit` handler
 * over the real `rpc` IPC channel against a real repository whose
 * `pre-commit` hook fails. The spec asserts what the user must see — the
 * message still in the box, the hook's own output on screen, no success — and
 * reads the outcome back from git on disk, never from a value the harness
 * supplied.
 *
 * It then swaps the hook for a passing one and commits again from the same
 * screen. That second half is the causation control: it proves the failure
 * above came from the hook and not from a panel that cannot commit at all,
 * and it pins the success line to the hash git actually wrote.
 *
 * Depends on TASK_2026_576 Batch 5 (Task 5.2): the backend must return the
 * hook's stdout + stderr as `hookOutput` on `HOOK_FAILED`. Before Batch 5 the
 * backend returns only `error: stderr`, so the `role="log"` region never
 * renders and the hook-output assertion fails by design.
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

  test('keeps the message and shows the hook output; a passing hook then commits', async ({
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

    const stagedRow = await sourceControlFileButton(
      page,
      THREE_HUNK_FILE,
      'Staged files',
    );
    await expect(stagedRow).toBeVisible({ timeout: 30_000 });

    const messageBox = page.getByRole('textbox', { name: 'Commit message' });
    const commitButton = page.getByRole('button', { name: /^Commit \(1\)$/ });
    await messageBox.fill(COMMIT_MESSAGE);
    await expect(commitButton).toBeEnabled();
    await commitButton.click();

    // The hook's own output is on screen, in a keyboard-reachable log.
    const hookLog = page.getByRole('log', { name: 'Commit hook output' });
    await expect(hookLog).toBeVisible({ timeout: COMMIT_ROUND_TRIP_MS });
    await expect(hookLog).toContainText(HOOK_MARKER);
    await expect(hookLog).toHaveAttribute('tabindex', '0');
    await hookLog.focus();
    await expect(hookLog).toBeFocused();

    await expect(
      page.locator('[data-testid="git-commit-failure"] [role="alert"]'),
    ).toContainText('Commit failed');
    await expect(
      page.locator('[data-testid="git-commit-success"]'),
    ).toHaveCount(0);
    // The message survives the failure.
    await expect(messageBox).toHaveValue(COMMIT_MESSAGE);

    // Git agrees: nothing was committed and the index is intact.
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(repo.stagedDiff()).not.toBe('');

    // Causation control: same screen, same message, passing hook.
    installPreCommitHook(repo, 0);
    await expect(commitButton).toBeEnabled();
    await commitButton.click();

    const success = page.locator('[data-testid="git-commit-success"]');
    await expect(success).toBeVisible({ timeout: COMMIT_ROUND_TRIP_MS });
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('2');
    expect(repo.git('log', '-1', '--format=%s')).toBe(COMMIT_MESSAGE);
    await expect(success).toContainText(
      repo.git('rev-parse', '--short', 'HEAD'),
    );
    await expect(messageBox).toHaveValue('');
    await expect(
      page.getByRole('log', { name: 'Commit hook output' }),
    ).toHaveCount(0);
  });
});
