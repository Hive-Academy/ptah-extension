import { test, expect } from '../../support/fixtures';
import { gitDiffFileMock } from '../../support/git-diff-mock';

/**
 * Review canvas on a large change set — TASK_2026_576 Batch 60, Requirement
 * 6.2, the A9 gate (`reviews/gate-p4-a9-pierre-perf.md`).
 *
 * The fixture is 200 changed files, each a 120-line file whose lines 11-60 are
 * rewritten: 50 modified lines per file, 10,000 modified lines in all (+10,000
 * / -10,000). The renderer is fed through the mocked `git:diffFile`, so the
 * measurement isolates the canvas (virtualised sections, Pierre, the worker
 * pool) from git itself.
 *
 * The scroll sweep runs inside the page: a requestAnimationFrame loop advances
 * the canvas list's `scrollTop` by a fixed step per frame, so every frame is a
 * scroll frame. Frame timing comes from the same rAF timestamps (fps = frames
 * over elapsed time); main-thread stalls come from a `PerformanceObserver` on
 * `longtask` entries.
 *
 * Budgets (implementation-plan Component 22, Quality requirements): >= 50 fps
 * and no long task longer than 200 ms. The numbers are printed so the run can
 * be recorded in `bundle-measurements.md`.
 */

const FILE_COUNT = 200;
const FILE_LINES = 120;
const CHANGED_FROM = 11;
const CHANGED_TO = 60;

const MIN_FPS = 50;
const MAX_LONG_TASK_MS = 200;

/**
 * Scroll speed of the sweep, in px per second. Time-based, so a slow frame does
 * not shorten the distance covered: a fast trackpad fling is roughly this.
 */
const SCROLL_SPEED_PX_PER_S = Number(process.env['E2E_SCROLL_SPEED'] ?? 3_000);
/** Hard bound on the sweep so a stalled page cannot hang the test. */
const MAX_SWEEP_MS = 150_000;
/** Idle-page rAF measurement taken before the sweep, to read machine load. */
const BASELINE_MS = 2_000;

function filePath(index: number): string {
  const dir = `pkg${String(index % 10).padStart(2, '0')}`;
  return `src/${dir}/file${String(index).padStart(3, '0')}.ts`;
}

function sideContent(index: number, modified: boolean): string {
  const lines: string[] = [];
  for (let line = 1; line <= FILE_LINES; line++) {
    const changed = line >= CHANGED_FROM && line <= CHANGED_TO;
    lines.push(
      changed
        ? `export const f${index}v${line} = ${modified ? line * 3 : line}; // ${modified ? 'worktree' : 'index'}`
        : `export const f${index}v${line} = ${line};`,
    );
  }
  return lines.join('\n') + '\n';
}

interface SweepResult {
  baselineFps: number;
  frames: number;
  durationMs: number;
  fps: number;
  worstFrameMs: number;
  longTasks: number[];
  scrolled: number;
  scrollHeight: number;
}

test.describe('review canvas — 200 files / 10,000 modified lines (A9)', () => {
  test.setTimeout(240_000);

  test('scrolls through the whole canvas at >= 50 fps with no long task over 200 ms @perf', async ({
    ui,
    electronApp,
  }) => {
    // An occluded window gets its rAF throttled to ~1 fps, which would measure
    // the desktop, not the canvas. The idle baseline below makes any residual
    // throttling visible in the log.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.setBackgroundThrottling(false);
    });
    const diffByPath: Record<string, unknown> = {};
    const files: {
      path: string;
      status: string;
      staged: boolean;
      isDirectory: boolean;
    }[] = [];
    for (let i = 0; i < FILE_COUNT; i++) {
      const path = filePath(i);
      files.push({ path, status: 'M', staged: false, isDirectory: false });
      diffByPath[path] = gitDiffFileMock({
        path,
        comparison: 'worktree',
        original: sideContent(i, false),
        modified: sideContent(i, true),
        snapshotToken: `large-${i}`,
      });
    }
    await ui.mockRpc({
      'git:diffFile': `(params) => (${JSON.stringify(diffByPath)})[params.path]`,
    });

    await ui.goto('git');
    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
        files,
        isGitRepo: true,
      },
    });

    const list = ui.page.locator('[data-testid="review-canvas-list"]');
    await expect(ui.reviewTab(/^Changes, 200 changed files/)).toBeVisible({
      timeout: 60_000,
    });
    // The first section reads and renders before the sweep starts.
    await expect(
      ui.reviewFileSection(filePath(0)).getByText('f0v11 = 33'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(list.locator('ptah-file-diff-section')).toHaveCount(
      FILE_COUNT,
    );

    // Arm the long-task observer, then sweep the list top to bottom.
    const sweep = await ui.page.evaluate(
      ({ speed, maxMs, baselineMs }): Promise<SweepResult> => {
        const scroller = document.querySelector<HTMLElement>(
          '[data-testid="review-canvas-list"]',
        );
        if (!scroller) throw new Error('review canvas list not found');
        scroller.scrollTop = 0;

        const baseline = (): Promise<number> =>
          new Promise((resolve) => {
            let frames = 0;
            let first = 0;
            const tick = (now: number): void => {
              if (frames === 0) first = now;
              frames++;
              if (now - first >= baselineMs) {
                resolve(((frames - 1) / (now - first)) * 1000);
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });

        const sweep = (baselineFps: number): Promise<SweepResult> => {
          const longTasks: number[] = [];
          const observer = new PerformanceObserver((entries) => {
            for (const entry of entries.getEntries()) {
              longTasks.push(entry.duration);
            }
          });
          observer.observe({ type: 'longtask', buffered: false });
          return new Promise<SweepResult>((resolve) => {
            let frames = 0;
            let first = 0;
            let previous = 0;
            let worstFrame = 0;
            const tick = (now: number): void => {
              if (frames === 0) {
                first = now;
              } else {
                worstFrame = Math.max(worstFrame, now - previous);
              }
              previous = now;
              frames++;
              const elapsed = now - first;
              scroller.scrollTop = (elapsed / 1000) * speed;
              const atEnd =
                scroller.scrollTop + scroller.clientHeight >=
                scroller.scrollHeight - 1;
              if (atEnd || elapsed >= maxMs) {
                observer.disconnect();
                resolve({
                  baselineFps,
                  frames,
                  durationMs: elapsed,
                  fps: elapsed > 0 ? ((frames - 1) / elapsed) * 1000 : 0,
                  worstFrameMs: worstFrame,
                  longTasks,
                  scrolled: scroller.scrollTop,
                  scrollHeight: scroller.scrollHeight,
                });
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        };

        return baseline().then(sweep);
      },
      {
        speed: SCROLL_SPEED_PX_PER_S,
        maxMs: MAX_SWEEP_MS,
        baselineMs: BASELINE_MS,
      },
    );

    const maxLongTask = sweep.longTasks.length
      ? Math.max(...sweep.longTasks)
      : 0;
    console.log(
      `[review-canvas-large] fixture=${FILE_COUNT} files x ${
        CHANGED_TO - CHANGED_FROM + 1
      } modified lines (${FILE_COUNT * (CHANGED_TO - CHANGED_FROM + 1)} total) ` +
        `speed=${SCROLL_SPEED_PX_PER_S}px/s idleFps=${sweep.baselineFps.toFixed(1)} frames=${sweep.frames} duration=${sweep.durationMs.toFixed(0)}ms ` +
        `fps=${sweep.fps.toFixed(1)} worstFrame=${sweep.worstFrameMs.toFixed(1)}ms ` +
        `longTasks=${sweep.longTasks.length} maxLongTask=${maxLongTask.toFixed(1)}ms ` +
        `scrollHeight=${sweep.scrollHeight} scrolled=${sweep.scrolled}`,
    );

    // The sweep really crossed the list rather than stopping early.
    expect(sweep.scrolled + 1).toBeGreaterThan(sweep.scrollHeight / 2);
    expect(sweep.frames).toBeGreaterThan(60);
    expect(sweep.scrolled + sweep.scrollHeight * 0.02).toBeGreaterThanOrEqual(
      sweep.scrollHeight - 1_000,
    );

    // A throttled page (idle rAF far below display rate) invalidates the run.
    expect(
      sweep.baselineFps,
      'idle rAF rate: the window was throttled, so the sweep is not a measurement',
    ).toBeGreaterThan(30);

    expect(sweep.fps).toBeGreaterThanOrEqual(MIN_FPS);
    expect(maxLongTask).toBeLessThanOrEqual(MAX_LONG_TASK_MS);
  });
});
