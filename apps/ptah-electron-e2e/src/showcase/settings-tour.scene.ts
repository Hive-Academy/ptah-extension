import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';
import { prewarmNavSurface } from './_harness/prewarm';

/**
 * P3.x — "Tune Ptah to your stack" (Settings surface tour).
 *
 * A calm, confident pan across the desktop app's Settings surface: the four
 * settings tabs (Providers / Authentication, Agent Orchestration, Pro Features,
 * Search & Voice), the data-portability controls, and the global top-bar
 * affordances (Notifications + the live theme switcher). This is a SCENE, not a
 * test — it asserts almost nothing and is tuned for how it looks on camera.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/settings-tour.json` and
 * is narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)` speaks
 * line i, holding for the REAL clip duration (durations.json) so narration,
 * captions and footage stay locked — no estimated holds, no silent gaps.
 * Element-targeted says + spotlight/hover auto-emit `shots.json`, punching the
 * camera onto each control as the VO names it.
 *
 * Everything here is NON-DESTRUCTIVE: we read, scroll, spotlight and hover, and
 * we demo the theme switcher live (a purely cosmetic preference we restore
 * afterwards). We never touch provider keys, never sign out, never import or
 * export, and never flip a persisted toggle.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector notes (verified against the live shell):
 * - Top nav is a `role="tab"` tablist; `Settings` selects the surface.
 * - `Change theme` + `Notifications` are top-bar buttons (stable aria-labels).
 * - Settings chrome: `ptah-settings`, `[data-testid="settings-section-auth"]`,
 *   `[data-testid="settings-back"]`, and the web-search provider select
 *   `[data-testid="settings-toggle-web-search-provider"]` (see
 *   `src/specs/settings/settings.spec.ts`). The four tabs are addressed by
 *   their visible label text.
 */

/**
 * The four settings tabs, in tour order. Script lines 3..6 in
 * `scripts/settings-tour.json` narrate them — one line per tab, same order.
 */
const TAB_LABELS: readonly string[] = [
  'Providers',
  'Agent Orchestration',
  'Pro Features',
  'Search & Voice',
];

/** Script index of the first tab line in `scripts/settings-tour.json`. */
const TAB_SCRIPT_BASE = 3;

/**
 * Click the first visible candidate from a list, easing the cursor to it.
 * Returns true if something was clicked. Best-effort against the live shell.
 */
async function clickFirstVisible(
  director: Director,
  candidates: Locator[],
): Promise<boolean> {
  for (const c of candidates) {
    const first = c.first();
    if (await first.isVisible().catch(() => false)) {
      await director.click(first);
      return true;
    }
  }
  return false;
}

/**
 * Enter the Settings surface from the top nav, then wait for the settings shell
 * to mount so callers can drive its tabs.
 */
async function goToSettings(page: Page, director: Director): Promise<void> {
  await clickFirstVisible(director, [
    page.getByRole('tab', { name: 'Settings' }),
    page.getByRole('button', { name: 'Settings' }),
    page.locator('[title="Settings"]'),
    page.locator('[aria-label="Settings"]'),
  ]);
  await page.locator('ptah-settings').waitFor({ state: 'visible' });
}

/**
 * Pan to a single settings tab: click its label, give the eye a beat to absorb,
 * then narrate script line `scriptIndex` while scrolling through whatever the
 * tab reveals — `say()` holds until the real narration clip has finished.
 */
async function tourTab(
  page: Page,
  director: Director,
  tab: string,
  scriptIndex: number,
): Promise<void> {
  const tabBtn = page.getByRole('button', { name: tab }).first();
  if (await tabBtn.isVisible().catch(() => false)) {
    await director.click(tabBtn);
  }
  await director.hold(500);
  // Reveal the full tab body — these panels can run taller than the viewport.
  await director.say(scriptIndex, {
    during: async () => {
      await director.scrollThrough(page.locator('ptah-settings'), {
        steps: 4,
        dwellMs: 650,
        andBack: true,
      });
    },
  });
}

/**
 * Demo the live theme switcher non-destructively: open the `Change theme`
 * dropdown, remember the currently-active theme, switch to a different one so
 * the whole app re-skins on camera, hold on it, then restore the original.
 *
 * The dropdown items carry a `[data-theme]` attr and the active one is marked
 * with `.bg-base-300`. If anything about the dropdown is unexpected we bail
 * gracefully without leaving the theme changed.
 */
async function demoThemeSwitch(page: Page, director: Director): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Change theme' }).first();
  if (!(await trigger.isVisible().catch(() => false))) return;

  let originalTheme: string | null = null;
  let switched = false;

  // Script line 10 — the dropdown open + theme switch + hold all run inside
  // `during`, and say() keeps holding until the narration clip has finished.
  await director.say(10, {
    target: trigger,
    during: async () => {
      await director.click(trigger);
      await director.hold(500);

      const items = page.locator('[data-theme]');
      const count = await items.count().catch(() => 0);
      if (count === 0) {
        // Dropdown didn't open as expected — close it and move on, no harm done.
        await page.keyboard.press('Escape').catch(() => undefined);
        return;
      }

      // Remember the active theme so we can restore it after the demo.
      originalTheme = await page
        .evaluate(
          () =>
            document.documentElement.getAttribute('data-theme') ??
            document
              .querySelector('[data-theme].bg-base-300')
              ?.getAttribute('data-theme') ??
            null,
        )
        .catch(() => null);

      // Pick a theme that ISN'T the current one so the switch is visible on camera.
      let target: Locator | null = null;
      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        const name = await item.getAttribute('data-theme').catch(() => null);
        if (name && name !== originalTheme) {
          target = item;
          break;
        }
      }
      if (!target) target = items.first();

      await director.spotlight(target, 1100);
      await director.click(target);
      await director.hold(1600);
      switched = true;
    },
  });

  // Restore the original theme so the scene leaves no persisted change.
  if (switched && originalTheme) {
    await director.click(trigger);
    await director.hold(400);
    const restore = page.locator(`[data-theme="${originalTheme}"]`).first();
    if (await restore.isVisible().catch(() => false)) {
      await director.click(restore);
    } else {
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    await director.hold(600);
  }
}

test('P3 — settings surface tour (providers, tabs & live theme)', async ({
  page,
  director,
}) => {
  // The persistent authed profile ALWAYS shows the "Pro Trial Has Ended"
  // startup modal — clear it before filming so it stays out of frame.
  await director.dismissDialogs();

  // PRE-WARM (trimmed lead-in, before the first beat): force the Settings shell
  // to take its first-mount cost now so `goToSettings` below hits a warm surface
  // instead of stalling between the warmup and auth-section beats. Read-only
  // navigation — no key, toggle, or theme is touched here. Silent + guarded.
  await prewarmNavSurface(page, 'Settings', 'ptah-settings').catch(
    () => undefined,
  );

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  // Enter Settings; the trial modal can re-assert after navigation, so dismiss
  // again before we start the tour.
  await goToSettings(page, director);
  await director.dismissDialogs();
  await director.hold();

  // Open on the Authentication section — the heart of the Providers tab.
  const authSection = page.locator('[data-testid="settings-section-auth"]');
  await director.say(2, {
    target: authSection,
    during: async () => {
      if (await authSection.isVisible().catch(() => false)) {
        await director.spotlight(authSection, 1800);
      }
    },
  });

  // Walk the four settings tabs, scrolling through each one's body.
  for (const [i, tab] of TAB_LABELS.entries()) {
    await tourTab(page, director, tab, TAB_SCRIPT_BASE + i);
  }

  // Land on Search & Voice and spotlight the verified web-search provider
  // select — a real, named control that reads great on camera. NON-DESTRUCTIVE:
  // we spotlight and hover, we never change its value.
  await clickFirstVisible(director, [
    page.getByRole('button', { name: 'Search & Voice' }),
  ]);
  await director.hold(400);
  const providerSelect = page.locator(
    '[data-testid="settings-toggle-web-search-provider"]',
  );
  if (await providerSelect.isVisible().catch(() => false)) {
    await director.say(7, {
      target: providerSelect,
      during: async () => {
        await director.spotlight(providerSelect, 1600);
        await director.hover(providerSelect, 700);
      },
    });
  }

  // Pop back to the Providers tab and spotlight the data-portability controls —
  // export/import settings live at the top of the surface.
  await clickFirstVisible(director, [
    page.getByRole('button', { name: 'Providers' }),
  ]);
  await director.hold(400);
  await director.scrollThrough(page.locator('ptah-settings'), {
    steps: 3,
    dwellMs: 550,
    andBack: false,
  });
  const exportBtn = page
    .getByRole('button', { name: 'Export settings' })
    .first();
  if (await exportBtn.isVisible().catch(() => false)) {
    await director.say(8, {
      target: exportBtn,
      during: async () => {
        await director.spotlight(exportBtn, 1500);
        await director.hover(exportBtn, 600);
      },
    });
  }

  // Top-bar affordances: hover the Notifications bell, then demo the live theme
  // switcher (restored afterwards — see demoThemeSwitch).
  const bell = page.getByRole('button', { name: 'Notifications' }).first();
  if (await bell.isVisible().catch(() => false)) {
    await director.say(9, {
      target: bell,
      during: async () => {
        await director.spotlight(bell, 1300);
        await director.hover(bell, 600);
      },
    });
  }

  await demoThemeSwitch(page, director);

  await director.say(11, { breathMs: 950 });
});
