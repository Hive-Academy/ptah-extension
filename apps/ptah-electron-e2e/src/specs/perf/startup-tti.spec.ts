import { test, expect } from '../../support/fixtures';

/**
 * Startup TTI reference (TASK_2026_187, batch-2-report.md §10 item 6 —
 * "DevTools Performance TTI recording").
 *
 * This is NOT a substitute for a DevTools trace and does not assert a hard
 * budget — it follows the same "wall-clock spot-check, reported via
 * console.log, re-runnable and comparable across batches" pattern already
 * established by `specs/editor/perf-m1-diff-redisplay.spec.ts` and
 * `perf-m2-electron-spotcheck.spec.ts`. Nobody could re-run the one-off
 * manual DevTools trace batch-2-report.md §10 asked for and never got; this
 * number can be re-run by any future batch with one command, against the
 * exact renderer bundle it built.
 *
 * Two numbers are recorded:
 *   1. Paint timing from the `ui` fixture's own boot (`fixtures.ts`'s
 *      `driver.prepare()`), read from the Performance API rather than timed
 *      by this test — this is the closest this harness gets to a real
 *      cold-boot number, undistorted by fixture setup overhead.
 *   2. A second, explicitly-timed boot (this test's own `ui.prepare()`
 *      call) instrumented end-to-end with `Date.now()`, for a wall-clock
 *      figure that is directly comparable run-to-run without relying on the
 *      Performance API being populated at all.
 */
test.describe('Startup TTI reference (informational, TASK_2026_187)', () => {
  test('records paint timing + wall-clock time to canvas-interactive', async ({
    ui,
  }) => {
    const page = ui.page;

    // (1) Paint timing from the boot the `ui` fixture already performed.
    const fixtureBootTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const paint = performance
        .getEntriesByType('paint')
        .map((e) => ({ name: e.name, startTime: Math.round(e.startTime) }));
      return {
        domContentLoadedEventEnd: nav
          ? Math.round(nav.domContentLoadedEventEnd)
          : null,
        loadEventEnd: nav ? Math.round(nav.loadEventEnd) : null,
        paint,
      };
    });

    // (2) Explicitly-timed second boot: wall-clock from "reload issued" to
    // "canvas grid interactive" (tile creation available), on a warm process
    // — this isolates renderer bootstrap + lazy-canvas-load time from
    // Electron main-process startup, which the M2/M1 specs' pattern also
    // treats as out of scope for a renderer-side spot-check.
    const start = Date.now();
    await ui.prepare();
    await page
      .getByRole('button', { name: 'Create new session' })
      .waitFor({ state: 'visible' });
    const wallClockToCanvasInteractiveMs = Date.now() - start;

    console.log(
      '[startup-tti] fixture-boot paint entries:',
      JSON.stringify(fixtureBootTiming.paint),
      'domContentLoadedEventEnd(ms):',
      fixtureBootTiming.domContentLoadedEventEnd,
      'loadEventEnd(ms):',
      fixtureBootTiming.loadEventEnd,
    );
    console.log(
      '[startup-tti] second-boot wall-clock reload -> canvas interactive (ms):',
      wallClockToCanvasInteractiveMs,
    );

    // Sanity bounds only — this is a reference number for humans comparing
    // batches, not a regression gate. A value of 0 or a missing paint entry
    // would mean the instrument itself is broken, which IS worth failing on.
    expect(fixtureBootTiming.paint.length).toBeGreaterThan(0);
    expect(wallClockToCanvasInteractiveMs).toBeGreaterThan(0);
  });
});
