import { test, expect } from '../../support/fixtures';

/**
 * M1 performance harness — diff-tab re-display latency (B0, TASK_2026_173).
 *
 * ⚠️ HARNESS ONLY — DOES NOT CAPTURE THE M1 BASELINE. Per plan §7 / tasks.md
 * Task 0.1 / Task 2.14, the M1 baseline MUST be captured after Batch 2 lands
 * (Batch 2 rewrites the diff fetch path entirely — a number captured against
 * today's `openDiff`/`git:showFile` two-RPC mechanism would not be
 * apples-to-apples with the post-rewrite figure). This spec exists to prove
 * the harness runs end-to-end against TODAY's diff mechanism; its numbers are
 * deliberately NOT recorded in measurements.md as the M1 baseline.
 *
 * Workload: a synthetic ~500-line TypeScript file, alternating
 * diff-tab <-> file-tab for 10 round trips. Each round trip:
 *   1. Switch to the plain file tab (unmounts <ptah-diff-view> — today's
 *      `@if (activeDiffTab())` chain in editor-panel.component.ts:254 tears
 *      the diff editor down on every deactivation; this is exactly what
 *      Batch 3 (B1/N1) fixes).
 *   2. Switch back to the diff tab and time, from the click, until the
 *      modified editor's rendered `.view-line` count first stabilizes across
 *      two animation frames.
 *
 * Timing mechanism: a `MutationObserver` on `document.body` (the diff view's
 * host does not exist until the click resolves, so it cannot be the observer
 * target at setup time) drives an eager recheck; a self-scheduling
 * `requestAnimationFrame` loop is the fallback/settle driver so the promise
 * still resolves once DOM mutations stop. This is a documented, deliberate
 * robustness deviation from the plan's literal "MutationObserver on the
 * modified editor's .view-lines" wording — functionally equivalent, but
 * tolerant of the element not existing yet when the observer is armed.
 */

const MAIN_TS_PATH = 'C:\\ptah-e2e-ws\\src\\big-file.ts';
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

const ORIGINAL_CONTENT = makeContent(250, 'export const line250 = -1; // HEAD');
const MODIFIED_CONTENT = makeContent(
  250,
  'export const line250 = 250; // worktree',
);

function fileTree(): { tree: unknown[] } {
  return {
    tree: [{ name: 'big-file.ts', type: 'file', path: MAIN_TS_PATH }],
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

test.describe('perf M1 — diff-tab re-display latency (B0, harness proof only)', () => {
  test('harness runs end-to-end over 10 round trips (numbers NOT the M1 baseline)', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'editor:getFileTree': fileTree(),
      'editor:openFile': {
        content: MODIFIED_CONTENT,
        language: 'typescript',
        path: MAIN_TS_PATH,
        filePath: MAIN_TS_PATH,
      },
      'git:showFile': { content: ORIGINAL_CONTENT },
    });

    await ui.goto('editor');
    const page = ui.page;

    // Open the plain file tab.
    const fileNode = page.locator('[data-testid="editor-file-node"]', {
      hasText: 'big-file.ts',
    });
    await expect(fileNode).toBeVisible();
    await fileNode.click();

    const fileTabBtn = page.locator(
      'ptah-editor-panel [role="tab"][aria-label="Switch to big-file.ts"]',
    );
    await expect(fileTabBtn).toBeVisible();
    await expect(page.locator('.monaco-editor').first()).toBeVisible({
      timeout: 15_000,
    });

    // Surface the file in Source Control and open its diff tab.
    await page.getByRole('tab', { name: 'Git' }).click();
    const changedRow = page.locator('[role="listitem"]', {
      hasText: 'big-file.ts',
    });

    // Seed git status AFTER the sidebar tab exists so the push targets a
    // mounted SourceControlPanelComponent (mirrors editor.spec.ts's pattern).
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
          {
            path: 'src/big-file.ts',
            status: 'M',
            staged: false,
            isDirectory: false,
          },
        ],
        isGitRepo: true,
      },
    });

    await expect(changedRow).toBeVisible({ timeout: 10_000 });
    await changedRow.click();

    const diffTabBtn = page.locator(
      'ptah-editor-panel [role="tab"][aria-label="Switch to big-file.ts (diff)"]',
    );
    await expect(diffTabBtn).toBeVisible();
    await expect(page.locator('ptah-diff-view .view-lines').last()).toBeVisible(
      { timeout: 15_000 },
    );

    const samples: number[] = [];

    for (let i = 0; i < ROUND_TRIPS; i++) {
      // Step 1: switch away — unmounts <ptah-diff-view> today (N1).
      await fileTabBtn.click();
      await expect(page.locator('ptah-diff-view')).toHaveCount(0);

      // Step 2: arm the in-page timer BEFORE the click that re-mounts it.
      await page.evaluate(() => {
        const g = window as unknown as { __m1Promise?: Promise<number> };
        g.__m1Promise = new Promise<number>((resolve) => {
          const start = performance.now();
          let resolved = false;
          let lastCount = -1;
          let stableHit = false;

          const finish = () => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            resolve(performance.now() - start);
          };

          const check = () => {
            if (resolved) return;
            const lists = document.querySelectorAll(
              'ptah-diff-view .view-lines',
            );
            const modified = lists[lists.length - 1] as Element | undefined;
            const count = modified
              ? modified.querySelectorAll('.view-line').length
              : 0;
            if (count > 0 && count === lastCount) {
              if (stableHit) {
                requestAnimationFrame(finish);
                return;
              }
              stableHit = true;
            } else {
              stableHit = false;
            }
            lastCount = count;
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

      // Step 3: the synthetic click, timed from just before via performance.now().
      await diffTabBtn.click();

      const elapsed = await page.evaluate(() => {
        const g = window as unknown as { __m1Promise?: Promise<number> };
        return g.__m1Promise;
      });
      samples.push(elapsed ?? -1);
    }

    expect(samples.every((s) => s >= 0)).toBe(true);

    const med = median(samples);
    const max = Math.max(...samples);

    console.log(
      `[perf-m1] HARNESS PROOF ONLY (pre-Batch-2 mechanism, NOT the recorded ` +
        `baseline) — median=${med.toFixed(2)}ms max=${max.toFixed(
          2,
        )}ms samples=${JSON.stringify(samples.map((s) => Number(s.toFixed(2))))}`,
    );

    // Proves the harness executes end-to-end and produces plausible timings.
    expect(samples.length).toBe(ROUND_TRIPS);
    expect(med).toBeGreaterThan(0);
  });
});
