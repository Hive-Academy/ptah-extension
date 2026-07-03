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
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so
 * they are spoken prose and caption-only beats hold via `voHold` (~65ms/char)
 * so narration finishes before the next beat. Element-targeted captions +
 * spotlight/hover auto-emit `shots.json`, punching the camera onto each subject.
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

/**
 * Hold long enough for the narration of `text` to finish before the next beat
 * starts (~65ms/char + settle), minus time already spent in interactions that
 * run between this beat and the next. Captions double as the VO script
 * (`narrate.mjs --source beats`), so this prevents audio overlap.
 */
function voHold(text: string, alreadySpentMs = 0): number {
  return Math.max(600, Math.round(text.length * 65) + 500 - alreadySpentMs);
}

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
      hook: 'Start with Telegram, and message your agents from absolutely anywhere.',
      detail:
        'Paste in a bot token, approve a one-time pairing code, and just like that you are driving Ptah straight from a chat window.',
    },
    discord: {
      hook: 'Or bring Ptah right into your Discord server, where your whole team already hangs out.',
      detail:
        'Invite the bot, register the slash-ptah command, and choose exactly which servers are allowed to reach it.',
    },
    slack: {
      hook: 'And Slack fits in just the same, dropping Ptah into the workspace where your team already works.',
      detail:
        'Connect a bot token, then approve precisely who is allowed to talk to it.',
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

  // Draw the eye to the connector tile (icon + live status chip). The targeted
  // caption punches the camera onto the tile as the VO names the platform.
  const tile = page.locator(SEL.tile(platform)).first();
  if (await tile.isVisible().catch(() => false)) {
    await director.caption(copy.hook, tile);
    await director.spotlight(tile, 1900);
    // spotlight(1900 + 180 settle) already spent ~2.1s of this beat's VO.
    await director.hold(voHold(copy.hook, 2080));
    await director.caption();
  }

  // Switch to this platform's pane and dwell on the connection chrome.
  const pane = await selectPlatform(page, director, platform);
  if (!pane) return;

  // The scrollThrough (4 steps × 700ms × down-and-back) outlasts the narration,
  // so the caption plays fully during it — no explicit voHold needed here.
  await director.caption(copy.detail, pane);
  // Reveal the full pane (Connection + Access, plus Discord's integration kit).
  await director.scrollThrough(pane, { steps: 4, dwellMs: 700, andBack: true });
  await director.caption();

  // Surface the pairing/approval state without touching it. If there are no
  // bindings yet, narrate the empty pairing flow gracefully.
  const empty = pane.locator(SEL.bindingEmpty).first();
  if (await empty.isVisible().catch(() => false)) {
    const PAIR =
      'Every pairing is safe by design — you approve each new device with a one-time code before it can do a thing.';
    await director.caption(PAIR, empty);
    await director.hover(empty, 2000);
    // hover(2000 + 180 settle) already covered ~2.2s of the narration.
    await director.hold(voHold(PAIR, 2180));
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
  const OPENING = 'What if your agents lived right in your pocket?';
  await director.caption(OPENING);
  await director.hold(voHold(OPENING));
  await director.caption();

  // Into the Gateway tab.
  await goToGateway(page, director);
  await director.hold();

  // Orient: the master status + live stat strip (adapters / pending / approved / voice).
  // The moveTo + per-block spotlight loop below outlasts the narration, so the
  // caption plays fully across it.
  const GATEWAY_INTRO =
    'This is the Gateway — the bridge that connects Ptah to the chat apps you already use every day: Telegram, Discord, and Slack.';
  const stats = page.locator(SEL.statsStrip).first();
  if (await stats.isVisible().catch(() => false)) {
    await director.caption(GATEWAY_INTRO, stats);
    await director.moveTo(stats);
    await director.hold(1200);
    // Glow each live counter so the running/pending/approved numbers read.
    const blocks = page.locator(SEL.statBlock);
    const blockCount = await blocks.count();
    for (let i = 0; i < blockCount; i++) {
      await director.spotlight(blocks.nth(i), 1100);
    }
  } else {
    await director.caption(GATEWAY_INTRO);
  }
  await director.hold(1600);
  await director.caption();

  // Show the three connector tiles together before diving into each.
  const section = page.locator(SEL.platformSection).first();
  if (await section.isVisible().catch(() => false)) {
    const THREE_CONNECTORS =
      'There are three connectors here, so you can simply pick the place where your team already talks.';
    await director.caption(THREE_CONNECTORS, section);
    await director.moveTo(section);
    await director.hold(voHold(THREE_CONNECTORS, 300));
    await director.caption();
  }

  // Deep-dive each platform pane in tab order: Telegram, then Discord, then Slack.
  await tourPlatform(page, director, 'telegram');
  await tourPlatform(page, director, 'discord');
  await tourPlatform(page, director, 'slack');

  // Payoff beat.
  const OUTRO =
    'Telegram, Discord, or Slack — now you can drive Ptah from your phone, wherever you are.';
  await director.caption(OUTRO);
  await director.hold(voHold(OUTRO) + 600);
  await director.caption();
});
