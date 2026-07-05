import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';
import { prewarmThoth } from './_harness/prewarm';

/**
 * P3.2 — "Drive Ptah from your phone" (Messaging Gateway tour).
 *
 * A DEEP, NON-DESTRUCTIVE dive on the Gateway tab — the Electron-only bridge
 * that lets you run Ptah agents from Telegram, Discord, and Slack. This is a
 * SCENE, not a test: it asserts almost nothing, never connects an adapter,
 * never types a token, and never approves/rejects/revokes a binding. It only
 * tours the chrome — the live status strip, the three platform connector tiles,
 * and each platform's connection / access pane — so a viewer understands they
 * can drive Ptah from chat. Length is tuned for how it looks on camera.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/gateway-tour.json` and is
 * narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)` speaks line
 * i, holding for the REAL clip duration (durations.json) so narration, captions
 * and footage stay locked — no estimated holds, no silent gaps. Element-
 * targeted says + spotlight/hover auto-emit `shots.json`, punching the camera
 * onto each subject as the VO names it.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored (Electron build — the
 *   Gateway tab is desktop-only; in VS Code it renders a download placeholder).
 * - No other Ptah instance is running (single-instance lock).
 * - The profile may have NO active bindings — the scene degrades gracefully and
 *   still tours the connector chrome, narrating the empty pairing state.
 *
 * Selector note: every selector below is verified against the live app —
 * `messaging-gateway-ui` component templates (platform tiles, status chips,
 * platform-card panes, bindings-empty hint) and the Thoth shell's
 * `#thoth-tab-*` / `#thoth-panel-*` ids. If the Gateway chrome changes, the
 * helpers `goToGateway()` / `selectPlatform()` and the `SEL` constants below
 * are the only spots to adjust.
 */

/** The platforms toured, in the order they appear in the tab strip. */
type GatewayPlatform = 'discord' | 'slack' | 'telegram';

/** Live, verified selectors from `libs/frontend/messaging-gateway-ui`. */
const SEL = {
  /** Stat strip wrapper — `aria-label="Gateway statistics"`. */
  statsStrip: '[aria-label="Gateway statistics"]',
  /** Each stat block inside the strip (Adapters / Pending / Approved / Voice). */
  statBlock: '[aria-label="Gateway statistics"] .stat',
  /** Platform configuration section — `aria-label="Platform configuration"`. */
  platformSection: '[aria-label="Platform configuration"]',
  /** Per-platform connector tile button: `gateway-tile-<platform>`. */
  tile: (p: GatewayPlatform): string => `[data-testid="gateway-tile-${p}"]`,
  /** Per-tile status chip: `gateway-tile-status-<platform>` (running/stopped/…). */
  tileStatus: (p: GatewayPlatform): string =>
    `[data-testid="gateway-tile-status-${p}"]`,
  /** Per-platform pane wrapper: `#gateway-pane-<platform>`. */
  pane: (p: GatewayPlatform): string => `#gateway-pane-${p}`,
  /** Per-platform card inside the pane: `gateway-platform-card-<platform>`. */
  card: (p: GatewayPlatform): string =>
    `[data-testid="gateway-platform-card-${p}"]`,
  /** Empty pairing hint inside a pane's bindings panel. */
  bindingEmpty: '[data-testid="gateway-binding-empty"]',
} as const;

/**
 * Script-line base index per platform in `scripts/gateway-tour.json`: the
 * platform's `hook` line lives at `base`, its `detail` line at `base + 1`.
 * (Lines 4–5 telegram, 6–7 discord, 8–9 slack; the shared pairing-approval
 * line is 10.)
 */
const PLATFORM_SCRIPT_BASE: Record<GatewayPlatform, number> = {
  telegram: 4,
  discord: 6,
  slack: 8,
};

/** Script index of the shared "one-time approval code" pairing line. */
const PAIRING_LINE = 10;

/**
 * Navigate from wherever the shell opens into the Thoth → Gateway tab and wait
 * for its panel to render. Dismisses the persistent "trial ended" startup modal
 * both on the way in and again once inside, since it can re-assert after a
 * navigation. Best-effort selectors so the scene survives minor chrome changes.
 */
async function goToGateway(page: Page, director: Director): Promise<void> {
  // Enter the desktop "cockpit" (Thoth shell) via the top nav tab.
  const thothTab = page.getByRole('tab', { name: 'Thoth' });
  if (
    await thothTab
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await director.click(thothTab.first());
  }
  // The trial modal frequently re-appears after entering Thoth — clear it.
  await director.dismissDialogs();

  // Open the Gateway inner tab and wait for its panel.
  const gatewayTab = page.locator('#thoth-tab-gateway');
  await gatewayTab.waitFor({ state: 'visible' });
  await director.click(gatewayTab);
  await page.locator('#thoth-panel-gateway').waitFor({ state: 'visible' });
  await director.dismissDialogs();
}

/**
 * Select a platform connector tile and wait for its pane to become visible.
 * Returns the pane locator so the caller can hover/spotlight inside it. Tiles
 * are roving-tabindex tab buttons; clicking emits the selection and un-`[hidden]`s
 * the matching pane. Best-effort: if the tile isn't on screen, returns `null`.
 */
async function selectPlatform(
  page: Page,
  director: Director,
  platform: GatewayPlatform,
): Promise<Locator | null> {
  const tile = page.locator(SEL.tile(platform)).first();
  if (!(await tile.isVisible().catch(() => false))) return null;
  await director.click(tile);
  const pane = page.locator(SEL.pane(platform)).first();
  await pane.waitFor({ state: 'visible' }).catch(() => undefined);
  return pane;
}

/**
 * Tour one platform: spotlight its connector tile + status chip, switch to its
 * pane, and dwell on the Connection / Access chrome. Strictly non-destructive —
 * no token entry, no binding actions; if the profile has no bindings the empty
 * pairing hint is narrated instead.
 */
async function tourPlatform(
  page: Page,
  director: Director,
  platform: GatewayPlatform,
): Promise<void> {
  const base = PLATFORM_SCRIPT_BASE[platform];

  // Draw the eye to the connector tile (icon + live status chip). The targeted
  // say punches the camera onto the tile as the VO names the platform.
  const tile = page.locator(SEL.tile(platform)).first();
  if (await tile.isVisible().catch(() => false)) {
    await director.say(base, {
      target: tile,
      during: async () => {
        await director.spotlight(tile, 1900);
      },
    });
  }

  // Switch to this platform's pane and dwell on the connection chrome.
  const pane = await selectPlatform(page, director, platform);
  if (!pane) return;

  // Reveal the full pane (Connection + Access, plus Discord's integration kit)
  // while the platform's detail line narrates over the pan.
  await director.say(base + 1, {
    target: pane,
    during: async () => {
      await director.scrollThrough(pane, {
        steps: 4,
        dwellMs: 700,
        andBack: true,
      });
    },
  });

  // Surface the pairing/approval state without touching it. If there are no
  // bindings yet, narrate the empty pairing flow gracefully.
  const empty = pane.locator(SEL.bindingEmpty).first();
  if (await empty.isVisible().catch(() => false)) {
    await director.say(PAIRING_LINE, {
      target: empty,
      during: async () => {
        await director.hover(empty, 2000);
      },
    });
  } else {
    await director.hold(1400);
  }
}

test('P3.2 — drive Ptah from your phone (Messaging Gateway)', async ({
  page,
  director,
}) => {
  // Clear the persistent "Your Pro Trial Has Ended" startup modal before filming.
  await director.dismissDialogs();

  // PRE-WARM (trimmed lead-in, before the first beat): the Gateway tab mounts
  // the Telegram/Discord/Slack connector chrome and its live status strip on
  // first visit. Force it now so `goToGateway` below hits a warm panel instead
  // of stalling between the warmup and orient beats. Silent + guarded.
  await prewarmThoth(page, ['gateway']).catch(() => undefined);

  // Hook beat.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  // Into the Gateway tab.
  await goToGateway(page, director);
  await director.hold();

  // Orient: the master status + live stat strip (adapters / pending / approved / voice).
  // The moveTo + per-block spotlight loop runs during the narration.
  const stats = page.locator(SEL.statsStrip).first();
  if (await stats.isVisible().catch(() => false)) {
    await director.say(2, {
      target: stats,
      during: async () => {
        await director.moveTo(stats);
        await director.hold(1200);
        // Glow each live counter so the running/pending/approved numbers read.
        const blocks = page.locator(SEL.statBlock);
        const blockCount = await blocks.count();
        for (let i = 0; i < blockCount; i++) {
          await director.spotlight(blocks.nth(i), 1100);
        }
      },
    });
  } else {
    await director.say(2);
  }

  // Show the three connector tiles together before diving into each.
  const section = page.locator(SEL.platformSection).first();
  if (await section.isVisible().catch(() => false)) {
    await director.say(3, {
      target: section,
      during: async () => {
        await director.moveTo(section);
      },
    });
  }

  // Deep-dive each platform pane in tab order: Telegram, then Discord, then Slack.
  await tourPlatform(page, director, 'telegram');
  await tourPlatform(page, director, 'discord');
  await tourPlatform(page, director, 'slack');

  // Payoff beat.
  await director.say(11, { breathMs: 350 + 600 });
});
