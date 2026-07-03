import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P3.x — "Tune Ptah to your stack" (Settings surface tour).
 *
 * A calm, confident pan across the desktop app's Settings surface: the four
 * settings tabs (Providers / Authentication, Agent Orchestration, Pro Features,
 * Search & Voice), the data-portability controls, and the global top-bar
 * affordances (Notifications + the live theme switcher). This is a SCENE, not a
 * test — it asserts almost nothing and is tuned for how it looks on camera.
 *
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so
 * they are written as spoken prose and caption-only beats hold via `voHold`
 * (~65ms/char) so narration finishes before the next beat. Element-targeted
 * captions + spotlight/hover auto-emit `shots.json`, punching the camera onto
 * each control as the VO names it.
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

/** A settings tab: the visible label that selects it + the line we narrate. */
interface SettingsBeat {
  /** Visible label of the tab button. */
  readonly tab: string;
  /** Single-line teaser caption. */
  readonly caption: string;
}

/** The four settings tabs, in tour order, each with its one-line teaser. */
const TAB_BEATS: readonly SettingsBeat[] = [
  {
    tab: 'Providers',
    caption:
      'Your keys never leave your machine. Bring any provider, and everything stays one hundred percent local.',
  },
  {
    tab: 'Agent Orchestration',
    caption:
      'Want more hands on deck? Wire up command-line agents to do the heavy lifting behind the scenes.',
  },
  {
    tab: 'Pro Features',
    caption:
      'Go further when you are ready — enhanced prompts, MCP servers, and language-model tools.',
  },
  {
    tab: 'Search & Voice',
    caption:
      'Talk to your workspace, hands-free. Pick a web-search provider and a voice for spoken chat.',
  },
];

/**
 * Hold long enough for the narration of `text` to finish before the next beat
 * starts (~65ms/char + settle), minus time already spent in interactions that
 * run between this beat and the next. Captions double as the VO script
 * (`narrate.mjs --source beats`), so this prevents audio overlap.
 */
function voHold(text: string, alreadySpentMs = 0): number {
  return Math.max(600, Math.round(text.length * 65) + 500 - alreadySpentMs);
}

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
 * narrate the teaser, scroll through whatever the tab reveals, then clear.
 */
async function tourTab(
  page: Page,
  director: Director,
  beat: SettingsBeat,
): Promise<void> {
  const tab = page.getByRole('button', { name: beat.tab }).first();
  if (await tab.isVisible().catch(() => false)) {
    await director.click(tab);
  }
  await director.hold(500);
  await director.caption(beat.caption);
  // Reveal the full tab body — these panels can run taller than the viewport.
  // The scroll (4 steps × 650ms × down-and-back) outlasts the narration, so the
  // caption plays fully during it (no explicit voHold needed).
  await director.scrollThrough(page.locator('ptah-settings'), {
    steps: 4,
    dwellMs: 650,
    andBack: true,
  });
  await director.caption();
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

  // The dropdown open + theme switch + hold below cover the narration, so the
  // caption plays fully during them (no explicit voHold needed).
  await director.caption(
    'Prefer a different look? Re-skin the entire app, live, with a single click.',
    trigger,
  );
  await director.click(trigger);
  await director.hold(500);

  const items = page.locator('[data-theme]');
  const count = await items.count().catch(() => 0);
  if (count === 0) {
    // Dropdown didn't open as expected — close it and move on, no harm done.
    await page.keyboard.press('Escape').catch(() => undefined);
    await director.caption();
    return;
  }

  // Remember the active theme so we can restore it after the demo.
  const originalTheme = await page
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
  await director.caption();

  // Restore the original theme so the scene leaves no persisted change.
  if (originalTheme) {
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

  // HOOK — fire immediately so the video opens on a question, not dead air.
  const HOOK =
    'What if your AI workspace adapted to you — instead of the other way around?';
  await director.caption(HOOK);
  await director.hold(voHold(HOOK));
  await director.caption();

  // WARMUP — one line of context before the tour starts.
  const WARMUP =
    'Ptah is an AI coding workspace, and this is its control room. In the next minute, we tune it to your stack.';
  await director.caption(WARMUP);
  await director.hold(voHold(WARMUP));
  await director.caption();

  // Enter Settings; the trial modal can re-assert after navigation, so dismiss
  // again before we start the tour.
  await goToSettings(page, director);
  await director.dismissDialogs();
  await director.hold();

  // Open on the Authentication section — the heart of the Providers tab.
  const CONNECT =
    'Use whatever AI you already pay for. Connect any provider you like — it all starts right here.';
  const authSection = page.locator('[data-testid="settings-section-auth"]');
  await director.caption(CONNECT, authSection);
  if (await authSection.isVisible().catch(() => false)) {
    await director.spotlight(authSection, 1800);
    // spotlight(1800 + 180 settle) already spent ~2s of VO time.
    await director.hold(voHold(CONNECT, 1980));
  } else {
    await director.hold(voHold(CONNECT));
  }
  await director.caption();

  // Walk the four settings tabs, scrolling through each one's body.
  for (const beat of TAB_BEATS) {
    await tourTab(page, director, beat);
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
    const SWAP =
      'Change your mind any time. Swap web-search providers on the fly — no restart, no fuss.';
    await director.caption(SWAP, providerSelect);
    await director.spotlight(providerSelect, 1600);
    await director.hover(providerSelect, 700);
    // spotlight(1600 + 180 settle) + hover(700) already spent ~2.5s of VO time.
    await director.hold(voHold(SWAP, 2480));
    await director.caption();
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
    const EXPORT =
      'Set it up once, take it anywhere. Export your entire configuration — keys, preferences, and providers.';
    await director.caption(EXPORT, exportBtn);
    await director.spotlight(exportBtn, 1500);
    await director.hover(exportBtn, 600);
    // spotlight(1500 + 180 settle) + hover(600) already spent ~2.3s of VO time.
    await director.hold(voHold(EXPORT, 2280));
    await director.caption();
  }

  // Top-bar affordances: hover the Notifications bell, then demo the live theme
  // switcher (restored afterwards — see demoThemeSwitch).
  const bell = page.getByRole('button', { name: 'Notifications' }).first();
  if (await bell.isVisible().catch(() => false)) {
    const BELL =
      'Stay in the loop without breaking focus. Notifications come to you, right in the top bar.';
    await director.caption(BELL, bell);
    await director.spotlight(bell, 1300);
    await director.hover(bell, 600);
    // spotlight(1300 + 180 settle) + hover(600) already spent ~2.1s of VO time.
    await director.hold(voHold(BELL, 2080));
    await director.caption();
  }

  await demoThemeSwitch(page, director);

  const OUTRO =
    'So no, you do not adapt to your tools. Ptah adapts to you — configure it once, and it is yours.';
  await director.caption(OUTRO);
  await director.hold(voHold(OUTRO) + 600);
  await director.caption();
});
