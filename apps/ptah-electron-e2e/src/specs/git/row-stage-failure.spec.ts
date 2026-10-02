import * as fs from 'fs';
import * as path from 'path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import { sourceControlFileButton } from '../../support/source-control';

/**
 * A failing ROW stage in the source-control panel, end to end in Electron —
 * TASK_2026_576 RC1 (batches.md Task 7.1, visual-review.md capture note).
 *
 * One capture run showed the row error appear only seconds after a confirmed
 * `git:stage` failure, or not within 8 s. Batch 5 stopped unmounting the panel
 * while `gitStatus.isLoading()` is true, which used to destroy the per-row
 * error state on the post-mutation refresh. This spec proves the row error is
 * now shown promptly and stays usable.
 *
 * HOW THE FAILURE IS FORCED (deterministic, real git, nothing mocked): a
 * `.git/index.lock` file held by the spec makes the app's real
 * `git add -- <file>` fail with "Unable to create '.../index.lock': File
 * exists". Batch 5's write lock retries for ~3.1 s, then `git:stage` returns
 * `{ success: false, code: 'LOCKED', error: GIT_LOCKED_MESSAGE }` and the row
 * must show that fixed message, never git's raw stderr. The lock is a plain
 * file the spec owns, so it fails on every run and every OS and is removed in
 * a `finally`.
 *
 * WHY THE TWO-STAGE TIMEOUT: the RPC itself legitimately takes the ~3.1 s lock
 * retry plus a Windows git spawn, so the RPC response is awaited with
 * `STAGE_RPC_BUDGET_MS`. That wait is on the BACKEND. Once the response has
 * been observed leaving the main process, the row error is asserted with
 * Playwright's DEFAULT 5 s expect timeout — no sleep, no generous budget — so
 * a UI that renders the error late (the intermittent symptom) fails here, and
 * "RPC failed" is separated from "UI rendered".
 */

/** Retry window of the write lock (~3.1 s) + a cold Windows git spawn + slack. */
const STAGE_RPC_BUDGET_MS = 30_000;

/** The fixed lock message the row must show (libs/shared git-operation.constants). */
const GIT_LOCKED_MESSAGE = 'Another git process is using this repository.';

interface StageObservation {
  correlationId: string;
  params: unknown;
  requestedAt: number;
  respondedAt?: number;
  response?: unknown;
}

/**
 * Record every `git:stage` request the renderer sends on the real `rpc`
 * channel and the matching `to-renderer` response, from the main process.
 * Additive: the real listener keeps answering and nothing is intercepted, so
 * this is an observer, not a fake (unlike `UiDriver.getObservedCalls`, which
 * exists only under the fake-RPC listener this fixture deliberately avoids).
 */
async function installStageObserver(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const g = globalThis as unknown as {
      __rowStageObs?: {
        correlationId: string;
        params: unknown;
        requestedAt: number;
        respondedAt?: number;
        response?: unknown;
      }[];
    };
    const obs: NonNullable<typeof g.__rowStageObs> = [];
    g.__rowStageObs = obs;
    ipcMain.on('rpc', (_event, msg: unknown) => {
      const m = msg as {
        payload?: { method?: string; params?: unknown; correlationId?: string };
        correlationId?: string;
      };
      if (m?.payload?.method !== 'git:stage') return;
      obs.push({
        correlationId: m.payload.correlationId ?? m.correlationId ?? '',
        params: m.payload.params,
        requestedAt: Date.now(),
      });
    });
    const win = BrowserWindow.getAllWindows()[0];
    const patchable = win.webContents as unknown as {
      send: (channel: string, ...args: unknown[]) => void;
    };
    const originalSend = patchable.send.bind(win.webContents);
    patchable.send = (channel: string, ...args: unknown[]) => {
      if (channel === 'to-renderer') {
        const message = args[0] as { correlationId?: string } | undefined;
        const hit = obs.find(
          (o) => o.correlationId && o.correlationId === message?.correlationId,
        );
        if (hit && hit.respondedAt === undefined) {
          hit.respondedAt = Date.now();
          hit.response = message;
        }
      }
      originalSend(channel, ...args);
    };
  });
}

async function readStageObservations(
  app: ElectronApplication,
): Promise<StageObservation[]> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __rowStageObs?: StageObservation[] };
    return JSON.parse(JSON.stringify(g.__rowStageObs ?? []));
  });
}

async function waitForStageResponse(
  app: ElectronApplication,
  index: number,
): Promise<StageObservation> {
  let last: StageObservation | undefined;
  await expect
    .poll(
      async () => {
        last = (await readStageObservations(app))[index];
        return last?.respondedAt !== undefined;
      },
      {
        message: `git:stage #${index} never answered; observed: ${JSON.stringify(last)}`,
        timeout: STAGE_RPC_BUDGET_MS,
        intervals: [50],
      },
    )
    .toBe(true);
  return last as StageObservation;
}

/** The success-or-failure payload inside a `to-renderer` RPC response envelope. */
function stageOutcome(observation: StageObservation): {
  success?: boolean;
  code?: string;
  error?: string;
} {
  const env = observation.response as {
    data?: { success?: boolean; code?: string; error?: string };
    result?: { success?: boolean; code?: string; error?: string };
    payload?: { data?: { success?: boolean; code?: string; error?: string } };
  };
  return env?.data ?? env?.result ?? env?.payload?.data ?? {};
}

test.describe('failing row stage in the source-control panel, end to end in Electron (TASK_2026_576 RC1)', () => {
  // A real boot into an empty home runs every SQLite migration from zero
  // before the window is created (see `real-rpc-fixtures.ts`).
  test.setTimeout(240_000);

  test('shows a dismissible row error with the lock message and re-enables Stage; a later stage succeeds', async ({
    ui,
    rpcBridge,
    repo,
    electronApp,
  }) => {
    // Requested for its readiness gate (boot + first git spawn already paid).
    void rpcBridge;
    const page = ui.page;
    const lockPath = path.join(repo.root, '.git', 'index.lock');

    await ui.goto('git');

    const changedRow = await sourceControlFileButton(
      page,
      THREE_HUNK_FILE,
      'Changed files',
    );
    await expect(changedRow).toBeVisible({ timeout: 30_000 });

    // Scoped to the row's own folder list: the app can add an untracked
    // `.mcp.json` to this workspace, which gets its own Stage button.
    const changedList = page
      .getByRole('list', { name: 'Changed files', exact: true })
      .getByRole('list', { name: 'src folder', exact: true });
    const stageButton = changedList.getByRole('button', {
      name: 'Stage file',
      exact: true,
    });
    const rowError = page.getByTestId('git-row-error');
    const dismissButton = page.getByRole('button', {
      name: 'Dismiss error for calc.ts in changes',
      exact: true,
    });

    await installStageObserver(electronApp);

    // Precondition read from real git: nothing staged, the file is modified.
    expect(repo.stagedDiff()).toBe('');
    await expect(rowError).toHaveCount(0);
    await expect(stageButton).toBeEnabled();

    // Force the failure: git cannot take the index lock.
    fs.writeFileSync(lockPath, '');
    try {
      await stageButton.click();

      // 1) Backend: the RPC failed with LOCKED (after the ~3.1 s retry).
      const first = await waitForStageResponse(electronApp, 0);
      expect(
        (first.params as { paths?: string[] }).paths,
        'git:stage must target the clicked file',
      ).toEqual([THREE_HUNK_FILE]);
      const outcome = stageOutcome(first);
      expect(
        outcome,
        `unexpected git:stage envelope: ${JSON.stringify(first.response)}`,
      ).toMatchObject({ success: false, code: 'LOCKED' });
      expect(outcome.error).toBe(GIT_LOCKED_MESSAGE);
      // Git agrees: still nothing staged.
      expect(repo.stagedDiff()).toBe('');

      // 2) UI: with the RPC failure already confirmed, the row error must be
      // on screen within Playwright's DEFAULT expect timeout. No sleep.
      await expect(rowError).toBeVisible();
      await expect(rowError).toHaveCount(1);
      const alert = rowError.getByRole('alert');
      await expect(alert).toHaveText(GIT_LOCKED_MESSAGE);
      await expect(rowError).not.toContainText('index.lock');
      await expect(rowError).not.toContainText('fatal:');

      // The error survives the post-mutation status refresh (the Batch 5
      // regression: the refresh used to unmount the panel and its row state).
      // Wait for the refresh to settle by observing the row still present
      // and the panel still mounted, then re-check the error.
      await expect(changedRow).toBeVisible();
      await expect(rowError).toBeVisible();

      // The row's Stage button is usable again: not disabled, not busy.
      await expect(stageButton).toBeEnabled();
      await expect(stageButton).not.toHaveAttribute('aria-busy', /.*/);

      // The dismiss control is a 24x24 target with a section-unique name.
      await expect(dismissButton).toBeVisible();
      const box = await dismissButton.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(24);
      expect(box?.height).toBeGreaterThanOrEqual(24);

      // Dismissing removes the error and leaves the row intact.
      await dismissButton.click();
      await expect(rowError).toHaveCount(0);
      await expect(changedRow).toBeVisible();
      await expect(stageButton).toBeEnabled();
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
    expect(fs.existsSync(lockPath)).toBe(false);

    // Causation control: same screen, lock gone -> the stage succeeds, so the
    // failure above came from the held lock and not from a dead Stage button.
    await stageButton.click();
    const second = await waitForStageResponse(electronApp, 1);
    expect(stageOutcome(second)).toMatchObject({ success: true });
    await expect(
      await sourceControlFileButton(page, THREE_HUNK_FILE, 'Staged files'),
    ).toBeVisible();
    await expect(rowError).toHaveCount(0);
    expect(repo.stagedDiff()).not.toBe('');
  });
});
