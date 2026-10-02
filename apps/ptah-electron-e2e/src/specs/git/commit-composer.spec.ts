import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import type { ScratchRepo } from '../../support/git-scratch-repo';
import type { UiDriver } from '../../support/ui-driver';

/**
 * The review shell's Commit tab (`ptah-commit-composer`), end to end in
 * Electron - TASK_2026_576 Batch 61, Requirement 9 (successor of the
 * source-control panel commit box).
 *
 * Nothing is mocked. The real renderer drives the real `git:commit` handler
 * over the real `rpc` channel against a real repository whose `pre-commit`
 * hook the spec writes. Outcomes are read back from git on disk.
 *
 *  1. A hook that prints three lines over two seconds: every line shows in the
 *     `role="log"` region BEFORE the commit completes (arrival timestamps are
 *     recorded in the page by a MutationObserver), then the success line shows
 *     the hash and subject git wrote.
 *  2. Commit is disabled while nothing is staged, and enables when something is.
 *  3. A failing hook keeps the message and the log; a passing hook then
 *     commits from the same screen (causation control).
 *  4. Cancel during a long hook reports "cancelled", keeps the message and
 *     leaves no `index.lock` behind.
 *
 * The streamed output relay (`GitOperationOutputService`) is registered under
 * MESSAGE_HANDLERS since Batch 58; before that, case 1 fails by design.
 */

const COMMIT_MESSAGE = 'feat(calc): scale three values';
const COMMIT_ROUND_TRIP_MS = 60_000;

const LINES = [
  'ptah-e2e-hook: line 1 of 3',
  'ptah-e2e-hook: line 2 of 3',
  'ptah-e2e-hook: line 3 of 3',
] as const;
/** The lines are printed one second apart, so line 3 trails line 1 by ~2 s. */
const HOOK_SPREAD_MS = 2_000;
const FAILING_MARKER = 'ptah-e2e-hook: lint failed in src/calc.ts';
const LONG_HOOK_MARKER = 'ptah-e2e-hook: started a long check';

/**
 * Install `pre-commit` in a hooks directory the APP's git will use (the
 * scratch repo's own `-c core.hooksPath=/dev/null` only reaches the spec's git).
 * LF only: Git for Windows runs hooks through its bundled sh.
 */
function installPreCommitHook(
  repo: ScratchRepo,
  body: readonly string[],
): void {
  const hooksDir = path.join(repo.root, '.git', 'ptah-e2e-hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(hookPath, ['#!/bin/sh', ...body, ''].join('\n'), {
    encoding: 'utf8',
  });
  fs.chmodSync(hookPath, 0o755);
  repo.git('config', 'core.hooksPath', hooksDir.replace(/\\/g, '/'));
}

/**
 * The app's own git runs under the fixture's isolated home, which has no
 * global identity; without a repo-local one git refuses before any hook runs.
 */
function configureIdentity(repo: ScratchRepo): void {
  repo.git('config', 'user.name', 'Ptah E2E');
  repo.git('config', 'user.email', 'e2e@ptah.invalid');
  repo.git('config', 'commit.gpgsign', 'false');
}

async function openCommitTab(ui: UiDriver): Promise<void> {
  await ui.goto('git');
  await ui.reviewTab(/^Commit/).click();
  await expect(ui.page.locator('[data-testid="commit-composer"]')).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Record, in the page, the first time each hook line shows in the log and the
 * first time the success line shows. Observing from inside the renderer is the
 * only way to timestamp what the user could see, not what Playwright polled.
 */
async function recordTimeline(page: Page): Promise<void> {
  await page.evaluate((lines) => {
    const state = window as unknown as {
      __commitTimeline?: Record<string, number>;
    };
    const seen: Record<string, number> = {};
    state.__commitTimeline = seen;
    const check = (): void => {
      const log = document.querySelector('[data-testid="commit-hook-output"]');
      const text = log?.textContent ?? '';
      for (const line of lines) {
        if (!(line in seen) && text.includes(line)) seen[line] = Date.now();
      }
      if (
        !('success' in seen) &&
        document.querySelector('[data-testid="commit-success"]')
      ) {
        seen['success'] = Date.now();
      }
    };
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, LINES);
}

async function timeline(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () =>
      (window as unknown as { __commitTimeline?: Record<string, number> })
        .__commitTimeline ?? {},
  );
}

test.describe('commit composer, end to end in Electron (TASK_2026_576 Requirement 9)', () => {
  // A real boot into an empty home runs every SQLite migration from zero.
  test.setTimeout(240_000);

  test('hook output streams into the log before the commit completes, then the success line shows hash and subject', async ({
    ui,
    rpcBridge,
    repo,
  }) => {
    void rpcBridge;
    const page = ui.page;
    configureIdentity(repo);
    repo.git('add', THREE_HUNK_FILE);
    installPreCommitHook(repo, [
      `echo "${LINES[0]}"`,
      'sleep 1',
      `echo "${LINES[1]}"`,
      'sleep 1',
      `echo "${LINES[2]}"`,
      'exit 0',
    ]);
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('1');

    await openCommitTab(ui);
    await expect(
      page.locator('[data-testid="commit-staged-count"]'),
    ).toHaveText('Staged: 1 file');
    await page.locator('[data-testid="commit-message"]').fill(COMMIT_MESSAGE);
    const submit = page.locator('[data-testid="commit-submit"]');
    await expect(submit).toBeEnabled();

    await recordTimeline(page);
    await submit.click();

    const log = page.getByRole('log', { name: 'Commit hook output' });
    await expect(log).toBeVisible({ timeout: COMMIT_ROUND_TRIP_MS });
    for (const line of LINES) {
      await expect(log).toContainText(line, { timeout: COMMIT_ROUND_TRIP_MS });
    }

    const success = page.locator('[data-testid="commit-success"]');
    await expect(success).toBeVisible({ timeout: COMMIT_ROUND_TRIP_MS });

    // Every line was on screen before the commit finished, and they arrived
    // as the hook printed them, not as one block at the end.
    const seen = await timeline(page);
    for (const line of LINES) expect(seen[line]).toBeDefined();
    expect(seen['success']).toBeDefined();
    expect(seen[LINES[0]]).toBeLessThan(seen[LINES[1]]);
    expect(seen[LINES[1]]).toBeLessThan(seen[LINES[2]]);
    expect(seen[LINES[2]]).toBeLessThanOrEqual(seen['success']);
    expect(seen[LINES[2]] - seen[LINES[0]]).toBeGreaterThanOrEqual(
      HOOK_SPREAD_MS * 0.6,
    );

    // The commit is real: git agrees, and the line names the hash and subject.
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('2');
    expect(repo.git('log', '-1', '--format=%s')).toBe(COMMIT_MESSAGE);
    await expect(success).toContainText(
      repo.git('rev-parse', '--short', 'HEAD'),
    );
    await expect(success).toContainText(COMMIT_MESSAGE);
    await expect(page.locator('[data-testid="commit-message"]')).toHaveValue(
      '',
    );
  });

  test('Commit is disabled with nothing staged and enables once a file is staged', async ({
    ui,
    rpcBridge,
    repo,
  }) => {
    void rpcBridge;
    const page = ui.page;
    configureIdentity(repo);
    // The fixture repo has three unstaged hunks and nothing staged.
    expect(repo.stagedDiff()).toBe('');

    await openCommitTab(ui);
    const submit = page.locator('[data-testid="commit-submit"]');
    await expect(
      page.locator('[data-testid="commit-staged-count"]'),
    ).toHaveText('Staged: 0 files');
    await page.locator('[data-testid="commit-message"]').fill(COMMIT_MESSAGE);
    await expect(submit).toBeDisabled();
    await expect(
      page.locator('[data-testid="commit-generate"]'),
    ).toBeDisabled();
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('1');

    // Staging a file (outside the UI, as an agent would) enables Commit with
    // the message still in the box.
    repo.git('add', THREE_HUNK_FILE);
    await expect(
      page.locator('[data-testid="commit-staged-count"]'),
    ).toHaveText('Staged: 1 file', { timeout: COMMIT_ROUND_TRIP_MS });
    await expect(submit).toBeEnabled();
    await expect(page.locator('[data-testid="commit-message"]')).toHaveValue(
      COMMIT_MESSAGE,
    );
  });

  test('a failing hook keeps the message and the log; a passing hook then commits from the same screen', async ({
    ui,
    rpcBridge,
    repo,
  }) => {
    void rpcBridge;
    const page = ui.page;
    configureIdentity(repo);
    repo.git('add', THREE_HUNK_FILE);
    installPreCommitHook(repo, [
      `echo "${FAILING_MARKER}"`,
      'echo "ptah-e2e-hook: 1 problem" 1>&2',
      'exit 1',
    ]);

    await openCommitTab(ui);
    const message = page.locator('[data-testid="commit-message"]');
    const submit = page.locator('[data-testid="commit-submit"]');
    await message.fill(COMMIT_MESSAGE);
    await submit.click();

    const log = page.getByRole('log', { name: 'Commit hook output' });
    await expect(log).toBeVisible({ timeout: COMMIT_ROUND_TRIP_MS });
    await expect(log).toContainText(FAILING_MARKER);
    await expect(log).toHaveAttribute('tabindex', '0');
    await expect(page.locator('[data-testid="commit-failure"]')).toContainText(
      'Your message was kept.',
    );
    await expect(page.locator('[data-testid="commit-success"]')).toHaveCount(0);
    await expect(message).toHaveValue(COMMIT_MESSAGE);
    await expect(submit).toBeEnabled();
    // The log is still there once the commit has finished.
    await expect(log).toContainText(FAILING_MARKER);

    // Git agrees: nothing was committed and the index is intact.
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(repo.stagedDiff()).not.toBe('');

    // Causation control: same screen, same message, passing hook.
    installPreCommitHook(repo, ['exit 0']);
    await submit.click();
    const success = page.locator('[data-testid="commit-success"]');
    await expect(success).toBeVisible({ timeout: COMMIT_ROUND_TRIP_MS });
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('2');
    await expect(success).toContainText(
      repo.git('rev-parse', '--short', 'HEAD'),
    );
    await expect(message).toHaveValue('');
    await expect(
      page.getByRole('log', { name: 'Commit hook output' }),
    ).toHaveCount(0);
  });

  test('Cancel during a long hook reports cancelled, keeps the message and leaves no index.lock', async ({
    ui,
    rpcBridge,
    repo,
  }) => {
    void rpcBridge;
    const page = ui.page;
    configureIdentity(repo);
    repo.git('add', THREE_HUNK_FILE);
    installPreCommitHook(repo, [
      `echo "${LONG_HOOK_MARKER}"`,
      'sleep 30',
      'exit 0',
    ]);
    const lock = path.join(repo.root, '.git', 'index.lock');

    await openCommitTab(ui);
    const message = page.locator('[data-testid="commit-message"]');
    await message.fill(COMMIT_MESSAGE);
    await page.locator('[data-testid="commit-submit"]').click();

    const log = page.getByRole('log', { name: 'Commit hook output' });
    await expect(log).toContainText(LONG_HOOK_MARKER, {
      timeout: COMMIT_ROUND_TRIP_MS,
    });
    // While the hook runs git holds the index lock and the field is locked.
    await expect(message).toBeDisabled();
    await expect(page.locator('[data-testid="commit-submit"]')).toBeDisabled();

    await page.locator('[data-testid="commit-cancel"]').click();

    await expect(
      page.locator('[data-testid="commit-cancelled"]'),
    ).toContainText('Commit cancelled. Your message was kept.', {
      timeout: COMMIT_ROUND_TRIP_MS,
    });
    await expect(message).toHaveValue(COMMIT_MESSAGE);
    await expect(message).toBeEnabled();
    await expect(page.locator('[data-testid="commit-success"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="commit-submit"]')).toBeEnabled();

    // Nothing was committed, the index is intact, and no lock was left behind.
    await expect
      .poll(() => fs.existsSync(lock), { timeout: 15_000 })
      .toBe(false);
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(repo.stagedDiff()).not.toBe('');
  });
});
