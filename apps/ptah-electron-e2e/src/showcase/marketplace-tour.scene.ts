import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P3.x — "One marketplace, every provider" (Marketplace surface tour).
 *
 * A confident browse across the desktop app's Marketplace hub: the provider
 * registry (Plugins, MCP Registry, Skills, Smithery, Composio), opening a live
 * provider to reveal its browse/search surface, then panning the listings. This
 * is a SCENE, not a test — it asserts almost nothing and is tuned for how it
 * looks on camera.
 *
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so
 * they are written as spoken prose and caption-only beats hold via `voHold`
 * (~65ms/char) so narration finishes before the next beat. Element-targeted
 * captions + spotlight/hover auto-emit `shots.json`, punching the camera onto
 * each provider and listing as the VO names it.
 *
 * Everything here is NON-DESTRUCTIVE: we open providers, scroll listings,
 * spotlight cards and hover into detail. We NEVER click Install, purchase, or
 * download anything, and we never check an install target.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Gating note: the Marketplace hub is Pro-gated. On a premium profile it renders
 * the provider grid; on a non-premium / trial-ended profile it renders an
 * upgrade affordance instead (no provider RPC fires). This scene detects which
 * surface mounted and narrates either gracefully — it never assumes the grid
 * exists.
 *
 * Selector notes (no Settings-style spec exists for Marketplace — these were
 * discovered from `libs/frontend/marketplace` + `chat-ui` setup-plugins):
 * - Top nav is a `role="tab"` tablist; `Marketplace` selects the surface (the
 *   tab itself only renders for premium profiles).
 * - Hub root: `ptah-marketplace-hub`. Provider cards are `<button>` with
 *   `aria-label="Open <name>"` (e.g. "Open MCP Registry"); coming-soon cards
 *   are `disabled`. A selected provider shows a "Back to providers" button.
 * - Live MCP/Skills surfaces (`ptah-mcp-directory-browser`,
 *   `ptah-skill-sh-browser`) expose a Browse/Installed tab pair and a search
 *   input ("Search MCP servers..." / "Search skills...").
 */

/** A provider to open, with the line we narrate while its surface is up. */
interface ProviderBeat {
  /** Display name as it appears in the card `aria-label` ("Open <name>"). */
  readonly name: string;
  /** Single-line teaser caption shown while the provider surface is open. */
  readonly caption: string;
}

/** Providers to open in tour order. Live ones only — coming-soon stays teased. */
const PROVIDER_BEATS: readonly ProviderBeat[] = [
  {
    name: 'MCP Registry',
    caption:
      'Browse the official Model Context Protocol registry, right from inside Ptah.',
  },
  {
    name: 'Skills',
    caption:
      'Discover community skills, hand-picked and matched to your project.',
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
 * Enter the Marketplace surface from the top nav, then wait for the hub root to
 * mount so callers can inspect which surface (grid vs. gate) rendered.
 */
async function goToMarketplace(page: Page, director: Director): Promise<void> {
  await clickFirstVisible(director, [
    page.getByRole('tab', { name: 'Marketplace' }),
    page.getByRole('button', { name: 'Marketplace' }),
    page.locator('[title="Marketplace"]'),
    page.locator('[aria-label="Marketplace"]'),
  ]);
  await page
    .locator('ptah-marketplace-hub')
    .waitFor({ state: 'visible' })
    .catch(() => undefined);
}

/**
 * Tour the provider overview grid: spotlight a couple of provider cards so the
 * eye lands on each tile, narrating the breadth of the registry.
 */
async function tourProviderGrid(page: Page, director: Director): Promise<void> {
  const GRID =
    'Plugins, MCP servers, and skills — every provider, gathered in one place.';
  await director.caption(GRID);
  await director.hold(voHold(GRID));
  await director.caption();

  // Spotlight the headline providers by their stable card aria-labels.
  for (const name of ['MCP Registry', 'Skills', 'Smithery']) {
    const card = page.getByRole('button', { name: `Open ${name}` }).first();
    if (await card.isVisible().catch(() => false)) {
      await director.spotlight(card, 1200);
      await director.hover(card, 500);
    }
  }
}

/**
 * Open one live provider, reveal its browse surface, pan the listings, then
 * return to the provider overview. Strictly NON-DESTRUCTIVE — no Install click.
 */
async function tourProvider(
  page: Page,
  director: Director,
  beat: ProviderBeat,
): Promise<void> {
  const card = page.getByRole('button', { name: `Open ${beat.name}` }).first();
  if (!(await card.isVisible().catch(() => false))) return;

  // The click + populate hold + spotlight + scroll below cover the narration, so
  // the caption plays fully during them (no explicit voHold needed).
  await director.caption(beat.caption, card);
  await director.click(card);

  // The selected surface mounts inside the hub; give it a beat to populate from
  // the network, then pan its listings. The two live surfaces share a Browse
  // search box + a results list, so scrolling the hub reveals the catalogue.
  await director.hold(1400);

  const search = page
    .locator(
      'input[placeholder="Search MCP servers..."], input[placeholder="Search skills..."]',
    )
    .first();
  if (await search.isVisible().catch(() => false)) {
    await director.spotlight(search, 1100);
  }

  // Reveal the listings — these run well past the viewport once loaded.
  await director.scrollThrough(page.locator('ptah-marketplace-hub'), {
    steps: 5,
    dwellMs: 700,
    andBack: true,
  });
  await director.caption();

  // Hover the first listing row to draw attention to an item's detail, without
  // clicking the Install button next to it.
  const firstRow = page
    .locator('ptah-marketplace-hub')
    .locator('.rounded-lg.border')
    .first();
  if (await firstRow.isVisible().catch(() => false)) {
    const ROW =
      'Hover over any item to size it up, and install it the moment you are ready.';
    await director.caption(ROW, firstRow);
    await director.spotlight(firstRow, 1400);
    await director.hover(firstRow, 700);
    // spotlight(1400 + 180 settle) + hover(700) already spent ~2.3s of VO time.
    await director.hold(voHold(ROW, 2280));
    await director.caption();
  }

  // Back out to the provider overview for the next beat.
  await clickFirstVisible(director, [
    page.getByRole('button', { name: 'Back to providers' }),
  ]);
  await director.hold(700);
}

test('P3 — marketplace surface tour (providers, browse & detail)', async ({
  page,
  director,
}) => {
  // The persistent authed profile ALWAYS shows the "Pro Trial Has Ended"
  // startup modal — clear it before filming so it stays out of frame.
  await director.dismissDialogs();

  const OPENING =
    'Ptah is built to grow with you — and you can extend it without ever leaving the app.';
  await director.caption(OPENING);
  await director.hold(voHold(OPENING));
  await director.caption();

  // Enter the Marketplace; the trial modal can re-assert after navigation, so
  // dismiss again before we start the tour.
  await goToMarketplace(page, director);
  await director.dismissDialogs();
  await director.hold();

  // Detect which surface mounted: the provider grid (premium) or the Pro gate.
  const aProviderCard = page
    .locator('ptah-marketplace-hub')
    .getByRole('button', { name: /^Open / })
    .first();
  const hasGrid = await aProviderCard.isVisible().catch(() => false);

  if (hasGrid) {
    // Premium path — full tour of the registry.
    await tourProviderGrid(page, director);

    for (const beat of PROVIDER_BEATS) {
      await tourProvider(page, director, beat);
    }

    // Tease the coming-soon provider so the breadth reads as "and more on the
    // way". Composio is a disabled card — spotlight it, never click it.
    const composio = page
      .getByRole('button', { name: 'Open Composio' })
      .first();
    if (await composio.isVisible().catch(() => false)) {
      const SOON =
        'And this is only the beginning — with even more providers landing soon.';
      await director.caption(SOON, composio);
      await director.spotlight(composio, 1500);
      // spotlight(1500 + 180 settle) already spent ~1.7s of VO time.
      await director.hold(voHold(SOON, 1680));
      await director.caption();
    }
  } else {
    // Non-premium / trial-ended path — narrate the Pro gate gracefully and pan
    // whatever copy is visible. No provider RPC fires here by design. The
    // settle + scroll below cover the narration (no explicit voHold needed).
    await director.caption(
      'The full Marketplace is a Pro feature — upgrade any time to unlock it.',
    );
    await director.hold(1600);
    await director.scrollThrough(page.locator('ptah-marketplace-hub'), {
      steps: 3,
      dwellMs: 700,
      andBack: true,
    });
    await director.caption();
  }

  const OUTRO = 'Skills, servers, and integrations — all just one click away.';
  await director.caption(OUTRO);
  await director.hold(voHold(OUTRO) + 600);
  await director.caption();
});
