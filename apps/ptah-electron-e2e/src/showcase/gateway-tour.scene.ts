import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

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

/** Per-platform narration. */
const PLATFORM_COPY: Record<GatewayPlatform, { hook: string; detail: string }> =
  {
    telegram: {
      hook: 'Telegram — message your agents from anywhere.',
      detail:
        'Paste a bot token, approve a pairing code, and you’re driving Ptah from chat.',
    },
    discord: {
      hook: 'Discord — run Ptah in your server.',
      detail:
        'Invite the bot, register the /ptah command, pick allowed servers.',
    },
    slack: {
      hook: 'Slack — bring Ptah into your workspace.',
      detail: 'Connect a bot token and approve who’s allowed to reach it.',
    },
  };

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
  const copy = PLATFORM_COPY[platform];

  // Draw the eye to the connector tile (icon + live status chip).
  const tile = page.locator(SEL.tile(platform)).first();
  if (await tile.isVisible().catch(() => false)) {
    await director.caption(copy.hook);
    await director.spotlight(tile, 1900);
    await director.caption();
  }

  // Switch to this platform's pane and dwell on the connection chrome.
  const pane = await selectPlatform(page, director, platform);
  if (!pane) return;

  await director.caption(copy.detail);
  // Reveal the full pane (Connection + Access, plus Discord's integration kit).
  await director.scrollThrough(pane, { steps: 4, dwellMs: 700, andBack: true });
  await director.caption();

  // Surface the pairing/approval state without touching it. If there are no
  // bindings yet, narrate the empty pairing flow gracefully.
  const empty = pane.locator(SEL.bindingEmpty).first();
  if (await empty.isVisible().catch(() => false)) {
    await director.caption(
      'Pair safely — approve each device with a one-time code.',
    );
    await director.hover(empty, 2000);
    await director.caption();
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

  // Hook beat.
  await director.caption('Your agents — now in your pocket.');
  await director.hold(1800);
  await director.caption();

  // Into the Gateway tab.
  await goToGateway(page, director);
  await director.hold();

  // Orient: the master status + live stat strip (adapters / pending / approved / voice).
  await director.caption(
    'The Gateway bridges Ptah to your chat apps — Telegram, Discord, Slack.',
  );
  const stats = page.locator(SEL.statsStrip).first();
  if (await stats.isVisible().catch(() => false)) {
    await director.moveTo(stats);
    await director.hold(1200);
    // Glow each live counter so the running/pending/approved numbers read.
    const blocks = page.locator(SEL.statBlock);
    const blockCount = await blocks.count();
    for (let i = 0; i < blockCount; i++) {
      await director.spotlight(blocks.nth(i), 1100);
    }
  }
  await director.hold(1600);
  await director.caption();

  // Show the three connector tiles together before diving into each.
  const section = page.locator(SEL.platformSection).first();
  if (await section.isVisible().catch(() => false)) {
    await director.caption(
      'Three connectors. Pick where your team already talks.',
    );
    await director.moveTo(section);
    await director.hold(2000);
    await director.caption();
  }

  // Deep-dive each platform pane in tab order: Telegram, then Discord, then Slack.
  await tourPlatform(page, director, 'telegram');
  await tourPlatform(page, director, 'discord');
  await tourPlatform(page, director, 'slack');

  // Payoff beat.
  await director.caption(
    'Drive Ptah from your phone — Telegram, Discord, Slack.',
  );
  await director.hold(2800);
  await director.caption();
});
