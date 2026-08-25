import { test, expect } from '../../support/fixtures';

/**
 * M4 performance harness — change-detection passes during sidebar-splitter
 * drag (B0, TASK_2026_173).
 *
 * Zero product-code change. Drives `page.mouse.move` over the sidebar resize
 * handle (`[role="separator"][aria-label="Resize sidebar"]`,
 * `editor-panel.component.ts:170-175`) for a 2s window and counts:
 *
 *  - `styleMutations` — a `MutationObserver` on the `<aside>` root inside
 *    `ptah-sidebar`'s `style` attribute (the template binds
 *    `[style.width.px]="width()"` on that `<aside>`, `sidebar.component.ts:40`
 *    — NOT on the `ptah-sidebar` host element itself). Today's `onSidebarResizeStart`
 *    (`editor-panel.component.ts:879-903`) calls `ngZone.run()` synchronously
 *    on every native `mousemove`, so each mutation is one full
 *    change-detection pass — this measures the OBSERVABLE EFFECT of that
 *    (a DOM style write), not Angular internals, so the harness stays
 *    correct across CD implementations (B5's target).
 *  - `frames` — a parallel `requestAnimationFrame` counter over the same
 *    window, establishing the frame budget the drag should be coalesced to
 *    (B5 target: <=1 style mutation per animation frame).
 *
 * 2s window x 5 runs; median + max reported for both counters.
 */

interface DragCdSample {
  styleMutations: number;
  frames: number;
}

interface FileTreeNodeFixture {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

function fileTree(): { tree: FileTreeNodeFixture[] } {
  return {
    tree: [{ name: 'main.ts', type: 'file', path: 'C:\\ptah-e2e-ws\\main.ts' }],
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const RUNS = 5;
const WINDOW_MS = 2_000;

test.describe('perf M4 — drag change-detection passes (B0)', () => {
  test('harness runs end-to-end and reports median + max over 5 runs', async ({
    ui,
  }) => {
    await ui.mockRpc({ 'editor:getFileTree': fileTree() });
    await ui.goto('editor');

    const page = ui.page;

    const handle = page.locator(
      '[role="separator"][aria-label="Resize sidebar"]',
    );
    await expect(handle).toBeVisible();

    const sidebar = page.locator('ptah-sidebar');
    await expect(sidebar).toBeVisible();

    const styleMutationSamples: number[] = [];
    const frameSamples: number[] = [];

    for (let run = 0; run < RUNS; run++) {
      // Re-measure every run: dragging moves the sidebar's right edge (and
      // therefore this handle) each time, so a stale bounding box from
      // before run 1 lands mousedown inside the sidebar body on later runs
      // instead of on the 4px-wide handle, silently no-op-ing the drag.
      const box = await handle.boundingBox();
      if (!box) {
        throw new Error(
          '[perf-m4] resize handle has no bounding box — cannot drive drag',
        );
      }
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();

      await page.evaluate(() => {
        const g = window as unknown as {
          __m4StyleMutations: number;
          __m4Frames: number;
          __m4Observer?: MutationObserver;
          __m4RafHandle?: number;
        };
        g.__m4StyleMutations = 0;
        g.__m4Frames = 0;
        const sidebarEl = document.querySelector(
          'ptah-sidebar aside[role="complementary"]',
        );
        g.__m4Observer = new MutationObserver((mutations) => {
          g.__m4StyleMutations += mutations.length;
        });
        if (sidebarEl) {
          g.__m4Observer.observe(sidebarEl, {
            attributes: true,
            attributeFilter: ['style'],
          });
        }
        const frameLoop = () => {
          g.__m4Frames += 1;
          g.__m4RafHandle = requestAnimationFrame(frameLoop);
        };
        g.__m4RafHandle = requestAnimationFrame(frameLoop);
      });

      const deadline = Date.now() + WINDOW_MS;
      let dx = 0;
      // No artificial delay between moves — as fast as Playwright's CDP
      // round trip allows. FINDING (see measurements.md): this already
      // produces a style-mutation count close to 1:1 with the parallel rAF
      // frame counter, both with and without Playwright's `steps` sub-move
      // synthesis. This is consistent with Chromium coalescing `mousemove`
      // dispatch to (at most) once per rendering frame regardless of the
      // underlying input rate — so THIS harness, run through a Chromium
      // WebContents, may not be able to reproduce the "many raw mousemove
      // events per frame" pathology as dramatically as a genuine
      // high-poll-rate mouse/trackpad would on the shipped app. Reported as
      // a discrepancy against the plan's framing, not silently adjusted.
      while (Date.now() < deadline) {
        dx = (dx + 3) % 60;
        await page.mouse.move(startX + dx, startY);
      }

      await page.mouse.up();

      const sample: DragCdSample = await page.evaluate(() => {
        const g = window as unknown as {
          __m4StyleMutations: number;
          __m4Frames: number;
          __m4Observer?: MutationObserver;
          __m4RafHandle?: number;
        };
        if (g.__m4RafHandle) cancelAnimationFrame(g.__m4RafHandle);
        g.__m4Observer?.disconnect();
        return { styleMutations: g.__m4StyleMutations, frames: g.__m4Frames };
      });

      styleMutationSamples.push(sample.styleMutations);
      frameSamples.push(sample.frames);
    }

    const mutMedian = median(styleMutationSamples);
    const mutMax = Math.max(...styleMutationSamples);
    const frameMedian = median(frameSamples);
    const frameMax = Math.max(...frameSamples);

    console.log(
      `[perf-m4] style-mutations median=${mutMedian} max=${mutMax} samples=${JSON.stringify(
        styleMutationSamples,
      )} | frames median=${frameMedian} max=${frameMax} samples=${JSON.stringify(
        frameSamples,
      )}`,
    );

    // Harness proof only: the drag produced at least one layout write and the
    // rAF counter is alive. This is NOT the B5 pass/fail assertion (that
    // belongs to Batch 4's after-measurement task) — a generous sanity bound.
    expect(mutMax).toBeGreaterThan(0);
    expect(frameMax).toBeGreaterThan(0);
  });
});
