import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';

/**
 * `git:applyHunks` end-to-end in Electron — TASK_2026_218.
 *
 * This is the named Batch 8 exit criterion of TASK_2026_173 that no pass met:
 * every data-safety guard is already proven against real git in unit specs,
 * but nothing had ever proven that a click in the running app reaches the real
 * handler. So this spec mocks nothing. It drives the real renderer against the
 * real backend over the real `rpc` IPC channel, pointed at a real repository,
 * and asserts on `git diff --cached` read straight from disk — never on a
 * value the harness itself supplied.
 *
 * The hunk is staged through the roving-tabindex toolbar using the keyboard,
 * which is the affordance Batch 8B actually shipped. The floating hunk-action
 * widget (TASK_2026_221) does not exist yet, and the glyph-margin markers
 * (TASK_2026_222) are checked separately in this same harness.
 */

const FILE_NAME = THREE_HUNK_FILE.split('/').pop() as string;

/**
 * How long the causation control holds before declaring the index untouched.
 * Comfortably longer than the observed apply latency in the positive test, so
 * a pass means "nothing staged", not "the poll was too early".
 */
const CONTROL_HOLD_MS = 6_000;

/**
 * Budget for the stale-snapshot refusal round trip (TASK_2026_230).
 *
 * Stated rather than inherited. `RpcBridge.sendRpc` defaults to 10s, which is
 * a transport default; this call re-derives the snapshot by running `git diff`
 * before it can refuse, and against a warm backend that measured 2.2-4.4s. 30s
 * is roughly 7x the observed cost — wide enough that machine load cannot turn
 * a correct refusal red, narrow enough that a genuinely stuck guard still
 * fails this test well inside its 180s budget rather than hanging it.
 */
const REFUSAL_TIMEOUT_MS = 30_000;

/**
 * Poll the repo's index until `predicate` holds. The apply is asynchronous
 * across an IPC round trip and a `git apply` child process, so the spec waits
 * on the observable end state rather than on a renderer signal — a renderer
 * assertion here would be the same self-referential proof this task exists to
 * replace.
 */
async function waitForStagedDiff(
  read: () => string,
  predicate: (diff: string) => boolean,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    last = read();
    if (predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting on the git index.\n` +
          `Last \`git diff --cached\`:\n${last || '(empty)'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.describe('git:applyHunks end-to-end in Electron (TASK_2026_218)', () => {
  // A real boot into an empty home runs every SQLite migration from zero before
  // the window is created, which does not fit the config-wide 60s budget.
  test.setTimeout(180_000);

  test('stages one hunk from the toolbar and leaves the other two unstaged', async ({
    ui,
    repo,
  }) => {
    const page = ui.page;

    // Preconditions read from real git, not assumed: three unstaged hunks,
    // nothing staged. If this fails the repo fixture is wrong, not the app.
    expect(repo.stagedDiff()).toBe('');
    expect(repo.worktreeDiff().match(/^@@ /gm)?.length).toBe(3);

    await ui.goto('editor');

    await page.getByRole('tab', { name: 'Git' }).click();

    const changedRow = page.locator('[role="listitem"]', {
      hasText: FILE_NAME,
    });
    await expect(changedRow).toBeVisible({ timeout: 20_000 });
    await changedRow.click();

    await expect(page.locator('ptah-diff-view .view-lines').last()).toBeVisible(
      { timeout: 20_000 },
    );

    // The real backend produced the diff, so the toolbar's own count is the
    // first evidence the RPC round trip carried real data.
    const toolbar = page.locator('[data-testid="hunk-toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="hunk-position"]')).toHaveText(
      '3 hunks',
    );

    // Select hunk 1 and stage it, both by keyboard.
    await page.locator('[data-testid="hunk-next"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="hunk-position"]')).toHaveText(
      'Hunk 1 of 3',
    );

    await page.locator('[data-testid="hunk-stage"]').focus();
    await page.keyboard.press('Enter');

    // No error surfaced in the UI...
    await expect(page.locator('[data-testid="hunk-apply-error"]')).toHaveCount(
      0,
    );

    // ...and the index actually moved.
    const staged = await waitForStagedDiff(
      () => repo.stagedDiff(),
      (diff) => diff.length > 0,
    );

    // That hunk, and only that hunk.
    expect(staged).toContain('value10 = 10000');
    expect(staged).not.toContain('value55 = 55000');
    expect(staged).not.toContain('value100 = 100000');
    expect(staged.match(/^@@ /gm)?.length).toBe(1);

    // The other two survive in the working tree — staging one hunk must not
    // discard the rest of the user's edits.
    const worktree = repo.worktreeDiff();
    expect(worktree).toContain('value55 = 55000');
    expect(worktree).toContain('value100 = 100000');
    expect(worktree).not.toContain('value10 = 10000');
  });

  /**
   * NEGATIVE CONTROL 1 — causation.
   *
   * Walks the identical path up to the point of staging and then does NOT
   * stage, so the index must stay empty. Without this, a green positive test
   * is also consistent with something else in the running app staging the file
   * on its own — the git watcher, a background job, an autosave — and the
   * assertion would be measuring ambient behaviour rather than the click.
   */
  test('control: reaching the toolbar without staging leaves the index empty', async ({
    ui,
    repo,
  }) => {
    const page = ui.page;
    expect(repo.stagedDiff()).toBe('');

    await ui.goto('editor');
    await page.getByRole('tab', { name: 'Git' }).click();

    const changedRow = page.locator('[role="listitem"]', {
      hasText: FILE_NAME,
    });
    await expect(changedRow).toBeVisible({ timeout: 20_000 });
    await changedRow.click();

    await expect(page.locator('ptah-diff-view .view-lines').last()).toBeVisible(
      { timeout: 20_000 },
    );

    await page.locator('[data-testid="hunk-next"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="hunk-position"]')).toHaveText(
      'Hunk 1 of 3',
    );

    // No stage press. Hold for longer than the positive test needed to observe
    // its apply, so "empty" means empty rather than "not yet".
    await page.waitForTimeout(CONTROL_HOLD_MS);
    expect(repo.stagedDiff()).toBe('');
    expect(repo.worktreeDiff().match(/^@@ /gm)?.length).toBe(3);
  });

  /**
   * NEGATIVE CONTROL 2 — detection.
   *
   * Sends a well-formed `git:applyHunks` whose `snapshotToken` names a
   * snapshot that was never taken, straight at the real handler. The service
   * must refuse with `STALE_SNAPSHOT` (`git-info.service.ts:965`) and leave
   * the index untouched.
   *
   * This is what makes the positive test's `success` meaningful: it shows the
   * write path discriminates rather than rubber-stamps, so a pass reflects a
   * real apply and not a handler that answers OK to anything shaped right.
   *
   * TASK_2026_230: this case used to fail on `[RpcBridge] sendRpc timed out
   * after 10000ms` rather than on either assertion below, which said nothing
   * about the guard. The guard was never at fault. Two start-up costs were
   * landing on this call — the boot backlog on the main-process event loop,
   * and the first `git` spawn in a fresh app process — and together they
   * exceeded the bridge's 10s transport default. `real-rpc-fixtures` now
   * absorbs both before the test body runs, and the budget below is stated for
   * what this call actually does. See `REFUSAL_TIMEOUT_MS`.
   */
  test('control: a bogus snapshot token is refused and stages nothing', async ({
    rpcBridge,
    repo,
  }) => {
    expect(repo.stagedDiff()).toBe('');

    const response = (await rpcBridge.sendRpc(
      'rpc',
      {
        type: 'rpc:call',
        payload: {
          method: 'git:applyHunks',
          params: {
            workspaceRoot: repo.root,
            path: THREE_HUNK_FILE,
            comparison: 'worktree',
            operation: 'stage',
            hunkIndices: [0],
            snapshotToken: 'not-a-snapshot-this-token-was-never-issued',
          },
        },
      },
      REFUSAL_TIMEOUT_MS,
    )) as { data?: { success?: boolean; code?: string } };

    expect(response.data?.success).toBe(false);
    expect(response.data?.code).toBe('STALE_SNAPSHOT');

    // The refusal is not just a message — nothing was written.
    expect(repo.stagedDiff()).toBe('');
    expect(repo.worktreeDiff().match(/^@@ /gm)?.length).toBe(3);
  });
});
