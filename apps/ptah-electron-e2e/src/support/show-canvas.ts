import { expect } from '@playwright/test';
import type { UiDriver } from './ui-driver';

/**
 * Put the app on the Orchestra Canvas — and keep it there.
 *
 * A real boot does NOT reliably land on the canvas. `AppShellComponent` runs a
 * one-shot `auth:getAuthStatus` check and redirects `chat` -> `settings` when
 * the machine has no usable provider. A developer box reports
 * `claudeCliInstalled` and never sees that redirect; a clean CI runner has no
 * CLI, no keys and an isolated `$HOME`, so it always does. That is the whole
 * difference between a spec passing locally and failing in CI, and the
 * failure reads as a missing heading rather than a redirect: `settings` is a
 * standalone view, the shared chrome (canvas included) goes `display: none`,
 * and a `display: none` heading is not in the accessibility tree at all, so
 * `getByRole` reports "element(s) not found".
 *
 * Any spec that needs the canvas BEHIND something else (a dialog, a modal)
 * has to make the canvas the active view before that collision means
 * anything. Retried rather than clicked once: the redirect is fired from a
 * promise, so a switch that lands before `auth:getAuthStatus` settles can be
 * undone exactly once.
 *
 * Shared by `file-ops-dialogs-top-layer.spec.ts` and
 * `hunk-revert-top-layer.spec.ts` (TASK_2026_216, TASK_2026_227) — both hit
 * the byte-identical failure in CI.
 */
export async function showCanvas(ui: UiDriver): Promise<void> {
  const grid = ui.page.locator('[data-testid="canvas-grid"]');
  await expect(async () => {
    await ui.goto('canvas');
    await expect(grid).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });

  await dismissUpdateBanner(ui);
}

/**
 * `<ptah-update-banner>` is a `position: sticky` bar declared as `<main>`'s
 * sibling in `app.html`, ahead of it in document flow — it is not an overlay.
 * A dev checkout's `app.getVersion()` matches the latest tag, so the banner
 * never renders locally. CI's build reports an older/placeholder version, so
 * `UpdateManager`'s real GitHub-releases check (network access, no mock —
 * see `auto-updater.spec.ts`) finds an update on every run and the banner
 * paints, pushing everything below it down by its own height.
 *
 * That shifts the canvas empty-state content down inside `<main>`, but the
 * file-ops dialogs are native `<dialog>` elements opened with `showModal()`
 * (the whole point of TASK_2026_216/227 — the top layer paints after the
 * entire document and centers on the raw window). The banner has nothing to
 * do with the collision these specs guard, so it is dismissed here rather
 * than left to silently offset the geometry `expectCanvasBehind` measures.
 */
async function dismissUpdateBanner(ui: UiDriver): Promise<void> {
  const later = ui.page
    .getByTestId('update-banner')
    .getByRole('button', { name: 'Later' });
  // The GitHub check is async; give it a moment to land before deciding
  // there is nothing to dismiss. A timeout here just means no banner showed.
  await later.click({ timeout: 5_000 }).catch(() => undefined);
}
