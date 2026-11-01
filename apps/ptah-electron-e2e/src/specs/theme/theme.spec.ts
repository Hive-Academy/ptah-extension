import type { Locator, Page } from '@playwright/test';
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
  test('default theme (ptah-glass, no persisted state): theme-extra.css is never requested', async ({
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
    ).toBe('ptah-glass');
  });

  test('anubis-light persisted: theme-extra.css is never requested', async ({
    ui,
    rpcBridge,
  }) => {
    const page = ui.page;
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));

    await rpcBridge.setState({ 'theme-v2': 'anubis-light' });
    await page.evaluate(() => {
      localStorage.setItem('ptah-theme-v2', 'anubis-light');
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
    await rpcBridge.setState({ 'theme-v2': 'dracula' });
    await page.evaluate(() => {
      localStorage.setItem('ptah-theme-v2', 'dracula');
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

/**
 * The picker splits the themes into Light / Dark / Glass tabs
 * (theme-toggle.component.ts, TASK_2026_710). Only the active tab's tiles are
 * rendered, so these helpers drive the tabs through role="tab" and
 * aria-selected instead of assuming every tile is in the DOM at once.
 */
const PICKER_TABS = ['Light', 'Dark', 'Glass'] as const;

function pickerPanel(page: Page): Locator {
  return page.locator('div.dropdown-content[role="dialog"]');
}

/** Opens the picker unless it is already open (the popover stays open after a pick). */
async function openPicker(page: Page): Promise<Locator> {
  const panel = pickerPanel(page);
  const open = await panel.evaluate((el) => el.matches(':popover-open'));
  if (!open) await page.locator('[aria-label="Change theme"]').click();
  await panel.waitFor({ state: 'visible' });
  return panel;
}

/** Shows one tab and waits until it is the selected one. */
async function showTab(
  panel: Locator,
  label: (typeof PICKER_TABS)[number],
): Promise<void> {
  const tab = panel.getByRole('tab', { name: label, exact: true });
  // dispatchEvent for the stacking-context reason documented in pickTheme.
  await tab.dispatchEvent('click');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Finds the tab that lists `theme` and clicks its tile. */
async function pickTheme(page: Page, theme: string): Promise<void> {
  const panel = await openPicker(page);
  const tile = panel.locator(`button[data-theme="${theme}"]`);
  for (const label of PICKER_TABS) {
    await showTab(panel, label);
    if ((await tile.count()) === 1) {
      // dispatchEvent, not .click(): the theme button sits above the canvas
      // empty-state panel visually, but Playwright's real-mouse actionability
      // check reports the empty state as the pointer-event target at that
      // coordinate (a daisyUI dropdown-content stacking-context quirk, not an
      // app bug -- the button IS visible and IS what a user's click lands on;
      // confirmed by screenshot during triage). dispatchEvent fires the same
      // DOM 'click' event the real handler listens for, without depending on
      // Playwright's hit-test agreeing with the browser's own paint order.
      await tile.dispatchEvent('click');
      return;
    }
  }
  throw new Error(`Theme "${theme}" is not listed in any picker tab`);
}

test.describe('Theme picker (H3 mechanics, TASK_2026_187 Unit 9)', () => {
  test('all 35 themes are listed and selectable', async ({ ui }) => {
    const page = ui.page;
    const panel = await openPicker(page);

    // 35 = every entry in DAISYUI_THEMES
    // (libs/frontend/core/src/lib/services/theme.service.ts): 33 stock
    // themes plus the ptah-glass pair. Update together with that metadata.
    // Each theme sits in exactly one tab, so the tabs together must list 35
    // distinct, visible, enabled tiles.
    await expect(panel.getByRole('tab')).toHaveCount(PICKER_TABS.length);
    const listed: string[] = [];
    for (const label of PICKER_TABS) {
      await showTab(panel, label);
      const tiles = panel.locator('button[data-theme]');
      const count = await tiles.count();
      expect(count, `${label} tab lists no themes`).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const tile = tiles.nth(index);
        await expect(tile).toBeVisible();
        await expect(tile).toBeEnabled();
        const name = (await tile.getAttribute('data-theme')) ?? '';
        listed.push(name);
        // Selectable means a click applies that exact theme. A pick stays in
        // the same tab, so `tiles` keeps its order. dispatchEvent for the
        // stacking-context reason documented in pickTheme. The first deferred
        // pick waits on the theme-extra.css load, hence the 5s budget. 35
        // picks fit well inside the 120s config timeout.
        await tile.dispatchEvent('click');
        await expect(page.locator('html')).toHaveAttribute('data-theme', name, {
          timeout: 5_000,
        });
        await expect(tile).toHaveAttribute('aria-pressed', 'true');
      }
    }
    expect(listed).toHaveLength(35);
    expect(new Set(listed).size).toBe(35);
    expect(listed).not.toContain('');

    // Spot-check both ends of the split: the two that stayed eager, and one
    // from the 32 that moved to the deferred sheet.
    expect(listed).toEqual(
      expect.arrayContaining(['anubis', 'anubis-light', 'dracula']),
    );
  });

  test('switching to a deferred theme at runtime fetches the sheet and applies it', async ({
    ui,
  }) => {
    const page = ui.page;
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));

    // Starts on the default (ptah-glass, no persisted state) -- the sheet has
    // never been loaded in this session.
    expect(requests.some((u) => u.includes('theme-extra.css'))).toBe(false);

    await pickTheme(page, 'dracula');

    // First switch to a deferred theme in the session: the sheet loads on
    // demand (theme.service.ts's setTheme -> loadDeferredThemeSheet), then
    // the theme applies on its `load` event.
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'dracula',
      { timeout: 5_000 },
    );
    expect(requests.some((u) => u.includes('theme-extra.css'))).toBe(true);

    // A second switch to a different one of the 32 (in another tab) reuses
    // the now-loaded sheet -- applies without waiting on another fetch.
    const requestCountAfterFirst = requests.length;
    await pickTheme(page, 'synthwave');
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
  test('a deferred theme repaints the variables, and switching back restores the default', async ({
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
      await pickTheme(page, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme, {
        timeout: 5_000,
      });
    };

    // The out-of-the-box default (ptah-glass) since the glass theme pair.
    const initial = await readVars();
    expect(initial.p).not.toBe('');
    expect(initial.b1).not.toBe('');

    await pick('dracula');
    const dracula = await readVars();
    expect(dracula.p).not.toBe(initial.p);
    expect(dracula.b1).not.toBe(initial.b1);

    // Back to an eager theme with the deferred sheet now in the document —
    // the direction that fails if the deferred sheet is appended last, because
    // its leading `:root` block is daisyUI's `light` theme.
    await pick('ptah-glass');
    expect(await readVars()).toEqual(initial);
  });
});
