import { test, expect } from '../../support/fixtures';
import { gitDiffFileMock } from '../../support/git-diff-mock';

/**
 * M1 performance harness - diff re-display latency (B0, TASK_2026_173),
 * retargeted to the review canvas (TASK_2026_576 Batch 60).
 *
 * The claim kept: how long the user waits to see a diff again after switching
 * away and back. The Monaco harness timed file tab <-> diff tab; the dock has no
 * file tabs, so the successor "away and back" is the review shell's own tab
 * round trip: Changes -> Task -> Changes. The Changes body stays mounted while
 * hidden (see `diff-view-state.spec.ts`); Pierre disposes its container while
 * nothing is near and re-creates it on return, so the timed window is real
 * work: from the click on the Changes tab to the frame in which the visible
 * section's diff text has rendered and stopped changing.
 *
 * Workload: a single 500-line TypeScript file with one changed line, ten round
 * trips after one warm-up (the Task tab lazy-loads on its first visit, which is
 * not what is being timed). The numbers are printed; they are not comparable
 * with the Monaco-era M1 figures in `measurements.md` (different renderer).
 *
 * Timing mechanism: a requestAnimationFrame loop inside the page compares the
 * text length of the section's Pierre shadow root across two consecutive
 * frames; a `MutationObserver` on `document.body` rechecks eagerly.
 */

const FILE_PATH = 'src/big-file.ts';
const LINE_COUNT = 500;
const ROUND_TRIPS = 10;

function makeContent(changedLine: number, changedValue: string): string {
  const lines: string[] = [];
  for (let i = 1; i <= LINE_COUNT; i++) {
    lines.push(
      i === changedLine ? changedValue : `export const line${i} = ${i};`,
    );
  }
  return lines.join('\n') + '\n';
}

const CHANGED_LINE = 250;
const ORIGINAL_CONTENT = makeContent(
  CHANGED_LINE,
  'export const line250 = -1; // HEAD',
);
const MODIFIED_CONTENT = makeContent(
  CHANGED_LINE,
  'export const line250 = 250; // worktree',
);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

test.describe('perf M1 - review canvas re-display latency', () => {
  test.setTimeout(180_000);

  test('10 Changes -> Task -> Changes round trips (review canvas baseline)', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'git:diffFile': gitDiffFileMock({
        path: FILE_PATH,
        comparison: 'worktree',
        original: ORIGINAL_CONTENT,
        modified: MODIFIED_CONTENT,
        snapshotToken: 'm1-harness-token',
      }),
    });

    await ui.goto('git');
    const page = ui.page;
    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
        files: [
          { path: FILE_PATH, status: 'M', staged: false, isDirectory: false },
        ],
        isGitRepo: true,
      },
    });

    const section = ui.reviewFileSection(FILE_PATH);
    await expect(section.getByText('export const line250 = 250;')).toBeVisible({
      timeout: 60_000,
    });

    const changesTab = ui.reviewTab(/^Changes/);
    const taskTab = ui.reviewTab('Task');

    const roundTrip = async (): Promise<number> => {
      await taskTab.click();
      await expect(taskTab).toHaveAttribute('aria-selected', 'true');
      await expect(
        page.locator('[data-testid="review-canvas-list"]'),
      ).toBeHidden();

      // Arm the in-page timer BEFORE the click that re-displays the canvas.
      await page.evaluate(() => {
        const g = window as unknown as { __m1Promise?: Promise<number> };
        g.__m1Promise = new Promise<number>((resolve) => {
          const start = performance.now();
          let resolved = false;
          let lastLength = -1;
          let stableHit = false;

          const finish = () => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            resolve(performance.now() - start);
          };

          const check = () => {
            if (resolved) return;
            const list = document.querySelector(
              '[data-testid="review-canvas-list"]',
            ) as HTMLElement | null;
            const container = list?.querySelector('diffs-container');
            const visible = !!list && list.offsetParent !== null;
            const length =
              visible && container?.shadowRoot
                ? (container.shadowRoot.textContent?.length ?? 0)
                : 0;
            if (length > 0 && length === lastLength) {
              if (stableHit) {
                requestAnimationFrame(finish);
                return;
              }
              stableHit = true;
            } else {
              stableHit = false;
            }
            lastLength = length;
            requestAnimationFrame(check);
          };

          const observer = new MutationObserver(() => check());
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
          requestAnimationFrame(check);
        });
      });

      await changesTab.click();
      const elapsed = await page.evaluate(() => {
        const g = window as unknown as { __m1Promise?: Promise<number> };
        return g.__m1Promise;
      });
      return elapsed ?? -1;
    };

    // Warm-up: first visit to the Task tab lazy-loads it.
    await roundTrip();

    const samples: number[] = [];
    for (let i = 0; i < ROUND_TRIPS; i++) {
      samples.push(await roundTrip());
    }

    expect(samples.every((s) => s >= 0)).toBe(true);

    const med = median(samples);
    const max = Math.max(...samples);
    console.log(
      `[perf-m1] review canvas re-display - median=${med.toFixed(2)}ms max=${max.toFixed(2)}ms samples=${JSON.stringify(samples.map((s) => Number(s.toFixed(2))))}`,
    );

    // The harness executes end to end and yields plausible timings, and the
    // text really is back on screen after the last round trip.
    expect(samples.length).toBe(ROUND_TRIPS);
    expect(med).toBeGreaterThan(0);
    await expect(
      section.getByText('export const line250 = 250;'),
    ).toBeVisible();
  });
});
