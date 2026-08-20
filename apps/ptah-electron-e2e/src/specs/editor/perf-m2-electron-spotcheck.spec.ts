import { test, expect } from '../../support/fixtures';

/**
 * M2 Electron spot-check (B0, TASK_2026_173) — CONFIRMATION ONLY.
 *
 * The reported M2 figure lives in
 * libs/frontend/editor/src/lib/file-tree/perf-m2-status-update.spec.ts (Jest),
 * per the deliberate B0 AC5 deviation documented there and restated in
 * measurements.md: M2's cost is renderer-side and host-identical, and Jest is
 * far more reproducible than a GPU-scheduled Electron window.
 *
 * This spec exists only to confirm the Jest figure is not an artifact of the
 * Jest/jsdom environment — it drives the SAME shape of workload (300 changed
 * files, 100 of them visible file-tree nodes) through a real Electron
 * renderer and measures wall-clock time from the IPC push to the DOM
 * reflecting the new git-status badges. This number is expected to be LARGER
 * than the Jest figure (it includes main->renderer IPC, Electron's real
 * change-detection scheduling, and Playwright's own polling granularity) —
 * that gap is expected and is not evidence the Jest figure is wrong.
 */

const NODE_COUNT = 100;
const STATUS_ENTRY_COUNT = 300;
const ITERATIONS = 5;

function fileTree(): { tree: unknown[] } {
  return {
    tree: Array.from({ length: NODE_COUNT }, (_, i) => ({
      name: `file${i}.ts`,
      type: 'file',
      path: `C:\\ptah-e2e-ws\\file${i}.ts`,
    })),
  };
}

function buildFiles(label: 'M' | 'A'): {
  path: string;
  status: 'M' | 'A';
  staged: boolean;
  isDirectory: boolean;
}[] {
  const files = [];
  for (let i = 0; i < STATUS_ENTRY_COUNT; i++) {
    files.push({
      path: i < NODE_COUNT ? `file${i}.ts` : `unrelated/file${i}.ts`,
      status: i < NODE_COUNT ? label : 'M',
      staged: false,
      isDirectory: false,
    } as const);
  }
  return files;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

test.describe('perf M2 — Electron spot-check (B0, confirmation only)', () => {
  test('300-entry git:status-update reflects in the file tree DOM within a bounded wall-clock time', async ({
    ui,
  }) => {
    await ui.mockRpc({ 'editor:getFileTree': fileTree() });
    await ui.goto('editor');
    const page = ui.page;

    await expect(
      page.locator('[data-testid="editor-file-node"]').first(),
    ).toBeVisible();

    const samples: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const targetLabel = i % 2 === 0 ? 'M' : 'A';
      const targetTitle = targetLabel === 'M' ? 'Modified' : 'Added';

      const start = Date.now();
      await ui.pushEvent({
        type: 'git:status-update',
        payload: {
          branch: {
            branch: 'main',
            upstream: 'origin/main',
            ahead: 0,
            behind: 0,
          },
          files: buildFiles(targetLabel),
          isGitRepo: true,
        },
      });

      await page.waitForFunction(
        (title) =>
          document.querySelectorAll(`span[title="${title}"]`).length >= 100,
        targetTitle,
        { timeout: 10_000 },
      );
      samples.push(Date.now() - start);
    }

    const med = median(samples);
    const max = Math.max(...samples);

    console.log(
      `[perf-m2-electron-spotcheck] wall-clock median=${med}ms max=${max}ms ` +
        `samples=${JSON.stringify(samples)} (confirmation only — Jest is the ` +
        `reported M2 figure; see measurements.md)`,
    );

    expect(samples.length).toBe(ITERATIONS);
    expect(med).toBeGreaterThan(0);
  });
});
