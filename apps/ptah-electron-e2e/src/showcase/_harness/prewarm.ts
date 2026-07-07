import type { Page } from '@playwright/test';

/**
 * Silent, best-effort PRE-WARM helpers for showcase scenes.
 *
 * Heavy UI surfaces (Monaco in the editor panel, the Thoth shell's SQLite/
 * embedder-backed tabs, the Pro-gated marketplace hub, …) pay a large one-time
 * FIRST-MOUNT cost. When that mount happens BETWEEN two narration beats it airs
 * as dead footage. render-all trims everything before a scene's first
 * `director.say()` (minus 700ms lead-in), so any first-mount we force BEFORE
 * that first beat is free — it never airs. These helpers do exactly that: visit
 * the slow surface once, let it mount, then return to the starting surface, so
 * the scene body's own navigation hits a warm surface and stays snappy.
 *
 * Hard rules these helpers obey (see the scene-authoring constraints):
 *  - SILENT: they use RAW Playwright actions only, never Director helpers. The
 *    Director auto-emits a virtual-camera shot from every `click`/`hover`/
 *    `spotlight`/targeted `caption`; raw `locator.click()` records nothing, so
 *    pre-warm never pollutes `shots.json` (`flushShots` stays a no-op unless the
 *    scene body records a real targeted interaction).
 *  - GUARDED: every step is visibility-checked and swallows errors, so a missing
 *    surface (unmounted panel, gated tab, chrome rename) can never fail a scene.
 *  - NON-DESTRUCTIVE: they only navigate / toggle / open read-only surfaces.
 *    They never fire an agent run, convene a panel, submit a form, or mutate
 *    state.
 */

/** The persistent Electron top-nav tablist wrapper. */
const NAV = '.electron-tabs';

/** `title` of the active top-nav tab, captured so pre-warm can restore it. */
async function activeNavTitle(page: Page): Promise<string | null> {
  return page
    .locator(`${NAV} [role="tab"][aria-selected="true"]`)
    .first()
    .getAttribute('title')
    .catch(() => null);
}

/** Best-effort re-select of a top-nav tab by its `title` (no-op when unknown). */
async function restoreNav(page: Page, title: string | null): Promise<void> {
  if (!title) return;
  const tab = page.locator(`${NAV} [role="tab"][title="${title}"]`).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click().catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

/**
 * Pre-warm a top-nav surface: remember the active tab, click the tab named
 * `navName`, wait for `ready` to mount, then restore the original tab. When the
 * tab isn't on screen (gated / renamed) nothing happens and the original view is
 * left untouched.
 */
export async function prewarmNavSurface(
  page: Page,
  navName: string,
  ready: string,
  timeoutMs = 20_000,
): Promise<void> {
  const original = await activeNavTitle(page);
  const tab = page.getByRole('tab', { name: navName }).first();
  if (!(await tab.isVisible().catch(() => false))) return;
  await tab.click().catch(() => undefined);
  await page
    .locator(ready)
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .catch(() => undefined);
  await page.waitForTimeout(400);
  await restoreNav(page, original);
}

/**
 * Pre-warm the Thoth shell and one or more of its inner tabs. Enters Thoth,
 * waits for the shell tablist, clicks each requested inner tab so its
 * SQLite/embedder-backed panel takes its first-mount cost here (in the trimmed
 * lead-in), then returns to the starting surface.
 */
export async function prewarmThoth(
  page: Page,
  tabIds: readonly ('memory' | 'skills' | 'cron' | 'gateway')[],
): Promise<void> {
  const original = await activeNavTitle(page);
  const thoth = page.getByRole('tab', { name: 'Thoth' }).first();
  if (!(await thoth.isVisible().catch(() => false))) return;
  await thoth.click().catch(() => undefined);
  // The shell renders its inner tablist once mounted — memory is always first.
  await page
    .locator('#thoth-tab-memory')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);
  for (const id of tabIds) {
    const tab = page.locator(`#thoth-tab-${id}`).first();
    if (!(await tab.isVisible().catch(() => false))) continue;
    await tab.click().catch(() => undefined);
    await page
      .locator(`#thoth-panel-${id}`)
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => undefined);
    // Let the panel's async data (SQLite reads / embedder stats) settle.
    await page.waitForTimeout(500);
  }
  await restoreNav(page, original);
}

/**
 * Expand into the file tree and open the first reachable leaf file — raw, silent
 * version of the editor-tour's `openAFile`. Only needs to mount SOME file so the
 * Monaco runtime + workers initialise; the scene body then opens its real file
 * against a warm editor.
 */
async function openLeafFileRaw(page: Page): Promise<void> {
  const leaf = page.locator(
    '[data-testid="editor-file-node"]:not([aria-expanded])',
  );
  const dirs = page.locator(
    '[data-testid="editor-file-node"][aria-expanded="false"]',
  );
  if (
    await leaf
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await leaf
      .first()
      .click()
      .catch(() => undefined);
    return;
  }
  for (let depth = 0; depth < 3; depth++) {
    const dir = dirs.first();
    if (!(await dir.isVisible().catch(() => false))) break;
    await dir.click().catch(() => undefined);
    await page.waitForTimeout(500);
    if (
      await leaf
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await leaf
        .first()
        .click()
        .catch(() => undefined);
      return;
    }
  }
}

/**
 * Pre-warm the editor panel — the known worst offender (~31s first-mount of the
 * Monaco host + file-tree fetch). Toggles the panel open (if closed), waits for
 * it, opens a leaf file to force the Monaco runtime to mount, then closes the
 * panel again (iff we opened it) so the scene starts on its original surface.
 * The scene body's `openEditorPanel` / `openAFile` then re-open against a warm
 * Monaco and no longer stall between beats.
 */
export async function prewarmEditor(page: Page): Promise<void> {
  const panel = page.locator('ptah-editor-panel').first();
  const wasOpen = await panel.isVisible().catch(() => false);
  const toggle = () =>
    page.locator('[aria-label="Toggle Editor panel"]').first();

  if (!wasOpen) {
    const t = toggle();
    if (await t.isVisible().catch(() => false)) {
      await t.click().catch(() => undefined);
    }
  }
  await panel
    .waitFor({ state: 'visible', timeout: 25_000 })
    .catch(() => undefined);
  if (!(await panel.isVisible().catch(() => false))) return;

  await openLeafFileRaw(page);
  // The heavy part: wait for a real Monaco instance to mount.
  await page
    .locator('.monaco-editor')
    .first()
    .waitFor({ state: 'visible', timeout: 25_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);

  // Return to the starting surface: close the panel only if we opened it.
  if (!wasOpen) {
    const t = toggle();
    if (await t.isVisible().catch(() => false)) {
      await t.click().catch(() => undefined);
      await panel
        .waitFor({ state: 'hidden', timeout: 8_000 })
        .catch(() => undefined);
    }
  }
}
