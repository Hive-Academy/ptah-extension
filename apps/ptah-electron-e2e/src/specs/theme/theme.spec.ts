import { test, expect } from '../../support/fixtures';

/**
 * Theme split (TASK_2026_187 Unit 9) — 32 daisyUI prebuilt themes moved out
 * of `styles.css` into a non-injected `theme-extra.css`, fetched only when
 * a user's persisted theme needs it (`batch-5-unit9-report.md`). `anubis`
 * and `anubis-light` stay eager.
 *
 * **What this file proves, and what it deliberately does not attempt.**
 * The unit's own report names H1-H6 as the human gate (§10). Of those:
 *
 * - **H2 (theme-extra.css never fetched for anubis/anubis-light) is fully
 *   mechanised here** — this is the one the report itself flags as
 *   "the single highest-value check" and the one static analysis can't
 *   stand in for.
 * - **All-34-selectable and a runtime switch applying (H3's mechanics, not
 *   its visual claim) are also mechanised.**
 * - **H1 (no `anubis` flash on the first *painted frame*) is NOT mechanised,
 *   and this was verified empirically, not assumed.** Three instruments
 *   were tried and rejected before writing this file:
 *     1. `performance.getEntriesByType('resource')` — returns **empty** for
 *        `theme-extra.css` in this Electron/`file://` renderer (same
 *        finding as TASK_2026_187 §3.1's probe for JS chunks — this
 *        extends it to CSS `<link>` fetches too).
 *     2. `page.on('request')`/`page.on('response')` — **does** fire for
 *        `theme-extra.css`, but only carries Node/CDP-side timestamps
 *        (`response.timing()` returns `-1` sentinels for the phases that
 *        don't apply to a `file://` disk read, and its `startTime` is not
 *        on the same axis as `performance.timeOrigin`-relative paint
 *        entries) — there is no clean way to correlate "the sheet arrived"
 *        against "first paint happened" on one clock.
 *     3. Correlating Playwright-side event arrival against
 *        `performance.getEntriesByType('paint')` (the approach used
 *        elsewhere in this validation for coarse ordering, e.g.
 *        `e2e-validation-report.md` §3.2) is precise to tens of
 *        milliseconds at best — nowhere near single-frame (~16ms)
 *        precision, and the property being asked about is exactly
 *        "was the *first* frame already correct," not "did it become
 *        correct soon after."
 *   **Conclusion: H1 needs actual frame-level capture (video/screenshot at
 *   the first-paint boundary) or a human watching it. That is not available
 *   in this harness. This is left in the human gate, not asserted here.**
 * - **The visual "no dark strobe" half of H3, and H1b (the VS Code
 *   upgrade path, which needs two real sequential launches sharing a VS
 *   Code profile) are also left to the human gate** — same reasoning.
 */
test.describe('Theme split — theme-extra.css fetch gating (H2, TASK_2026_187 Unit 9)', () => {
  test('default theme (anubis, no persisted state): theme-extra.css is never requested', async ({
    ui,
  }) => {
    const page = ui.page;
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));

    // No state seeded at all -- the out-of-the-box launch every fresh
    // profile takes.
    await ui.prepare();
    await page.waitForTimeout(500);

    expect(requests.some((u) => u.includes('theme-extra.css'))).toBe(false);
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      ),
    ).toBe('anubis');
  });

  test('anubis-light persisted: theme-extra.css is never requested', async ({
    ui,
    rpcBridge,
  }) => {
    const page = ui.page;
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));

    await rpcBridge.setState({ theme: 'anubis-light' });
    await page.evaluate(() => {
      localStorage.setItem('ptah-theme', 'anubis-light');
    });
    await ui.prepare();
    await page.waitForTimeout(500);

    expect(requests.some((u) => u.includes('theme-extra.css'))).toBe(false);
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      ),
    ).toBe('anubis-light');
  });

  test('a persisted deferred theme (dracula): theme-extra.css IS requested and the theme applies pre-paint', async ({
    ui,
    rpcBridge,
  }) => {
    const page = ui.page;
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));

    // Seed BOTH the pre-paint hint (localStorage) and the authoritative
    // persisted state (vscode.getState(), via the same 'set-state' IPC
    // channel preload.ts uses) -- theme.service.ts re-reads the
    // authoritative source at construction and would otherwise overwrite
    // data-theme back to the default before this test could observe it.
    await rpcBridge.setState({ theme: 'dracula' });
    await page.evaluate(() => {
      localStorage.setItem('ptah-theme', 'dracula');
    });
    await ui.prepare();
    await page.waitForTimeout(500);

    expect(requests.some((u) => u.includes('theme-extra.css'))).toBe(true);
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      ),
    ).toBe('dracula');
  });
});

test.describe('Theme picker (H3 mechanics, TASK_2026_187 Unit 9)', () => {
  test('all 34 themes are listed and selectable', async ({ ui }) => {
    const page = ui.page;
    await page.locator('[aria-label="Change theme"]').click();

    const themeButtons = page.locator(
      'div.dropdown-content button[data-theme]',
    );
    await expect(themeButtons).toHaveCount(34);

    // Spot-check both ends of the split: the two that stayed eager, and one
    // from the 32 that moved to the deferred sheet.
    await expect(
      page.locator('div.dropdown-content button[data-theme="anubis"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('div.dropdown-content button[data-theme="anubis-light"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('div.dropdown-content button[data-theme="dracula"]'),
    ).toHaveCount(1);
  });

  test('switching to a deferred theme at runtime fetches the sheet and applies it', async ({
    ui,
  }) => {
    const page = ui.page;
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));

    // Starts on the default (anubis, no persisted state) -- the sheet has
    // never been loaded in this session.
    expect(requests.some((u) => u.includes('theme-extra.css'))).toBe(false);

    await page.locator('[aria-label="Change theme"]').click();
    await page.locator('div.dropdown-content').waitFor({ state: 'visible' });
    // dispatchEvent, not .click(): the theme button sits above the canvas
    // empty-state panel visually, but Playwright's real-mouse actionability
    // check reports the empty state as the pointer-event target at that
    // coordinate (a daisyUI dropdown-content stacking-context quirk, not an
    // app bug -- the button IS visible and IS what a user's click lands on;
    // confirmed by screenshot during triage). dispatchEvent fires the same
    // DOM 'click' event the real handler listens for, without depending on
    // Playwright's hit-test agreeing with the browser's own paint order.
    await page
      .locator('div.dropdown-content button[data-theme="dracula"]')
      .dispatchEvent('click');

    // First switch to a deferred theme in the session: the sheet loads on
    // demand (theme.service.ts's setTheme -> loadDeferredThemeSheet), then
    // the theme applies on its `load` event.
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'dracula',
      { timeout: 5_000 },
    );
    expect(requests.some((u) => u.includes('theme-extra.css'))).toBe(true);

    // A second switch to a different one of the 32 reuses the now-loaded
    // sheet -- applies without waiting on another fetch.
    const requestCountAfterFirst = requests.length;
    await page.locator('[aria-label="Change theme"]').click();
    await page.locator('div.dropdown-content').waitFor({ state: 'visible' });
    await page
      .locator('div.dropdown-content button[data-theme="synthwave"]')
      .dispatchEvent('click');
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'synthwave',
      { timeout: 5_000 },
    );
    expect(
      requests
        .slice(requestCountAfterFirst)
        .some((u) => u.includes('theme-extra.css')),
    ).toBe(false);
  });

  /**
   * The `data-theme` attribute flipping is NOT evidence that the theme
   * applied. TASK_2026_186 shipped a regression where every switch set the
   * attribute correctly and repainted nothing: `styles.css` loads after
   * `theme-extra.css`, both carry (0,1,0) selectors, and daisyUI's `:root`
   * copy of `anubis` in `styles.css` therefore beat every
   * `[data-theme=<one of 32>]` rule. The only visible change was `--bcm`,
   * which `styles.css` sets per theme itself. Every existing test above
   * passed throughout.
   *
   * This asserts the computed variables, which is the property that broke.
   */
  test('a deferred theme repaints the variables, and switching back restores anubis', async ({
    ui,
  }) => {
    const page = ui.page;
    const readVars = () =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return {
          p: style.getPropertyValue('--p').trim(),
          b1: style.getPropertyValue('--b1').trim(),
        };
      });
    const pick = async (theme: string) => {
      await page.locator('[aria-label="Change theme"]').click();
      await page.locator('div.dropdown-content').waitFor({ state: 'visible' });
      // dispatchEvent for the same stacking-context reason as the test above.
      await page
        .locator(`div.dropdown-content button[data-theme="${theme}"]`)
        .dispatchEvent('click');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme, {
        timeout: 5_000,
      });
    };

    const anubis = await readVars();
    expect(anubis.p).not.toBe('');
    expect(anubis.b1).not.toBe('');

    await pick('dracula');
    const dracula = await readVars();
    expect(dracula.p).not.toBe(anubis.p);
    expect(dracula.b1).not.toBe(anubis.b1);

    // Back to an eager theme with the deferred sheet now in the document —
    // the direction that fails if the deferred sheet is appended last, because
    // its leading `:root` block is daisyUI's `light` theme.
    await pick('anubis');
    expect(await readVars()).toEqual(anubis);
  });
});
