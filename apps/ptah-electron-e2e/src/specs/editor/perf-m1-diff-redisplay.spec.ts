import { test, expect } from '../../support/fixtures';
import { gitDiffFileMock } from '../../support/git-diff-mock';

/**
 * M1 performance harness — diff-tab re-display latency (B0, TASK_2026_173).
 *
 * POST-BATCH-2: this spec now mocks the real, current diff mechanism — the
 * single `git:diffFile` RPC that `EditorDiffSplitHelper.openDiff` calls
 * (`editor-diff-split.ts`) — instead of the pre-rewrite two-RPC
 * `editor:openFile` + `git:showFile` pair the diff tab used to be built from.
 * Its numbers ARE recorded as the Task 2.14 M1 baseline in `measurements.md`,
 * per plan §7 / tasks.md Task 2.14 ("the M1 baseline MUST be captured after
 * Batch 2 lands... on post-batch-2 / pre-batch-3 code").
 *
 * `editor:openFile` is still mocked because the harness opens a plain FILE
 * tab first (step 1 of each round trip switches to it) — that tab is
 * unrelated to the diff mechanism and is not part of what batch 2 rewrote.
 *
 * POST-BATCH-3 (B1/N1): `<ptah-diff-view>` is no longer unmounted when the
 * user switches away — the panel hides it with `[class.invisible]` and the
 * component detaches its models instead. Step 1 below therefore waits for the
 * diff editor to go EMPTY (zero rendered `.view-line`s) rather than for the
 * element to disappear, and additionally asserts the element is still mounted,
 * which is N1's whole claim. The measured window is unchanged: it still runs
 * from the click that re-displays the diff to the frame its content settles.
 *
 * Workload: a synthetic ~500-line TypeScript file, alternating
 * diff-tab <-> file-tab for 10 round trips. Each round trip:
 *   1. Switch to the plain file tab (the diff view stays mounted but detaches
 *      its model pair, so its rendered line count drops to zero).
 *   2. Switch back to the diff tab and time, from the click, until the
 *      modified editor's rendered `.view-line` count first stabilizes across
 *      two animation frames.
 *
 * TASK_2026_231 — why this spec used to fail before the click ever mattered.
 *
 * The mocked `git:diffFile` payload had drifted from `GitDiffFileResult`: it
 * was written before the hunk work added `patch` and `hunks`, and never gained
 * them. Both are REQUIRED fields, so a real backend always sends them and only
 * a mock can leave them out. `DiffViewComponent.hunkActionsAvailable`
 * (`diff-view.component.ts:961`) reads `d.hunks.length` unguarded, so the
 * missing array threw `TypeError: Cannot read properties of undefined
 * (reading 'length')` inside change detection. That aborts the render pass:
 * the diff tab was added to `openTabs` but its tab button never reached the
 * DOM, and the spec then waited out its 30s budget on
 * `[aria-label="Switch to big-file.ts (working tree)"]`.
 *
 * Diagnosed by sampling the tab strip across the click — it never showed the
 * diff tab at any point, so nothing was removing it — and by capturing the
 * renderer console, which carried the TypeError. This was spec drift, not an
 * app defect: the app was fed a payload its own contract forbids.
 *
 * Two consequences worth knowing. It was intermittent, not constant, because
 * `hunkActionsAvailable` short-circuits on several earlier conditions and only
 * reaches `.length` on some interleavings — which is why running this spec
 * after its neighbours could hide it. And now that the payload carries a real
 * hunk, the diff surface under measurement includes the hunk affordances
 * (glyph markers, toolbar) that ship today, so the numbers below are NOT
 * comparable with the figure recorded in `measurements.md` against the
 * hunkless payload.
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

const CHANGED_LINE = 250;
const ORIGINAL_CONTENT = makeContent(
  CHANGED_LINE,
  'export const line250 = -1; // HEAD',
);
const MODIFIED_CONTENT = makeContent(
  CHANGED_LINE,
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

test.describe('perf M1 — diff-tab re-display latency (post-Batch-2, M1 baseline)', () => {
  test('10 round trips against the git:diffFile mechanism (Task 2.14 baseline)', async ({
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
      // The single round-trip openDiff now makes (editor-diff-split.ts).
      // Mirrors the real `M unstaged` row of the SS2.2 side-resolution table:
      // original <- index, modified <- worktree.
      // `patch` and `hunks` are REQUIRED by `GitDiffFileResult` and were once
      // missing here — see the TASK_2026_231 note in the file header. The
      // derivation that fixed it now lives in `git-diff-mock.ts`, shared with
      // the OTHER spec that had drifted the same way and typed as
      // `GitDiffFileResult` so the drift cannot recur silently. Its output for
      // these two content strings is byte-identical to the local function it
      // replaces, so the M1 numbers below stay comparable.
      'git:diffFile': gitDiffFileMock({
        path: 'src/big-file.ts',
        comparison: 'worktree',
        original: ORIGINAL_CONTENT,
        modified: MODIFIED_CONTENT,
        snapshotToken: 'm1-harness-token',
      }),
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
    // Scoped to the CODE editor: post-B1 the diff view is also mounted (and
    // hidden) from first paint, so a bare `.monaco-editor` would resolve to the
    // invisible diff surface.
    await expect(
      page.locator('ptah-code-editor .monaco-editor').first(),
    ).toBeVisible({
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
      'ptah-editor-panel [role="tab"][aria-label="Switch to big-file.ts (working tree)"]',
    );
    await expect(diffTabBtn).toBeVisible();
    await expect(page.locator('ptah-diff-view .view-lines').last()).toBeVisible(
      { timeout: 15_000 },
    );

    const samples: number[] = [];

    for (let i = 0; i < ROUND_TRIPS; i++) {
      // Step 1: switch away. The diff view STAYS MOUNTED (N1) and empties.
      await fileTabBtn.click();
      await expect(page.locator('ptah-diff-view')).toHaveCount(1);
      await expect(page.locator('ptah-diff-view .view-line')).toHaveCount(0);

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
      `[perf-m1] M1 BASELINE (post-Batch-2, git:diffFile mechanism) — ` +
        `median=${med.toFixed(2)}ms max=${max.toFixed(
          2,
        )}ms samples=${JSON.stringify(samples.map((s) => Number(s.toFixed(2))))}`,
    );

    // Proves the harness executes end-to-end and produces plausible timings.
    expect(samples.length).toBe(ROUND_TRIPS);
    expect(med).toBeGreaterThan(0);
  });
});
