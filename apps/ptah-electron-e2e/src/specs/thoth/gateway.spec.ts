import type { Locator } from '@playwright/test';
import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

interface BindingFixture {
  id: string;
  platform: 'telegram' | 'discord' | 'slack';
  externalChatId: string;
  displayName: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'revoked';
  ptahSessionId: string | null;
  workspaceRoot: string | null;
  pairingCode: string | null;
  createdAt: number;
  approvedAt: number | null;
  lastActiveAt: number | null;
}

function makeBinding(
  id: string,
  platform: BindingFixture['platform'],
  approvalStatus: BindingFixture['approvalStatus'],
): BindingFixture {
  return {
    id,
    platform,
    externalChatId: 'chat-' + id,
    displayName: 'user ' + id,
    approvalStatus,
    ptahSessionId: null,
    workspaceRoot: null,
    pairingCode: '123456',
    createdAt: 1_700_000_000_000,
    approvedAt: approvalStatus === 'approved' ? 1_700_000_100_000 : null,
    lastActiveAt: null,
  };
}

type GatewayPlatform = BindingFixture['platform'];

function platformPane(ui: UiDriver, platform: GatewayPlatform): Locator {
  return ui.page.locator('#gateway-pane-' + platform);
}

async function selectPlatformTile(
  ui: UiDriver,
  platform: GatewayPlatform,
): Promise<void> {
  await ui.page.locator(`[data-testid="gateway-tile-${platform}"]`).click();
  await platformPane(ui, platform).waitFor({ state: 'visible' });
}

test.describe('Thoth — Gateway tab', () => {
  test('platform tiles and panes render from gateway:status', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'gateway:status': {
        enabled: true,
        adapters: [
          { platform: 'telegram', running: true },
          { platform: 'discord', running: false },
          { platform: 'slack', running: false },
        ],
      },
      'gateway:listBindings': { bindings: [] },
    });

    await ui.openTab('gateway');

    const page = ui.page;

    await expect(
      page.locator('[data-testid="gateway-tile-telegram"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="gateway-tile-discord"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="gateway-tile-slack"]'),
    ).toBeVisible();

    await expect(
      page.locator('[data-testid="gateway-tile-status-telegram"]'),
    ).toHaveText('running');

    await expect(
      page.locator('[data-testid="gateway-platform-card-discord"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="gateway-platform-card-telegram"]'),
    ).toBeHidden();
    await expect(
      page.locator('[data-testid="gateway-platform-card-slack"]'),
    ).toBeHidden();

    await selectPlatformTile(ui, 'telegram');

    await expect(
      page.locator('[data-testid="gateway-platform-card-telegram"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="gateway-platform-status-telegram"]'),
    ).toHaveText('running');
    await expect(
      platformPane(ui, 'telegram').locator(
        '[data-testid="gateway-binding-empty"]',
      ),
    ).toBeVisible();

    await selectPlatformTile(ui, 'slack');

    await expect(
      page.locator('[data-testid="gateway-platform-card-slack"]'),
    ).toBeVisible();

    const observed = await ui.waitForObservedCall('gateway:status');
    expect(observed.method).toBe('gateway:status');
  });

  test('approve a pending binding', async ({ ui }) => {
    const pending = makeBinding('b1', 'telegram', 'pending');
    const approved = makeBinding('b1', 'telegram', 'approved');

    await ui.mockRpc({
      'gateway:status': {
        enabled: true,
        adapters: [{ platform: 'telegram', running: true }],
      },
      'gateway:listBindings': `(params) => {
        const g = globalThis;
        g.__gatewayListCalls = (g.__gatewayListCalls || 0) + 1;
        if (g.__gatewayListCalls <= 1) {
          return { bindings: [${JSON.stringify(pending)}] };
        }
        return { bindings: [${JSON.stringify(approved)}] };
      }`,
      'gateway:approveBinding': {
        ok: true,
        binding: approved,
      },
    });

    await ui.openTab('gateway');
    await selectPlatformTile(ui, 'telegram');

    const telegramPane = platformPane(ui, 'telegram');

    await expect(
      telegramPane.locator('[data-testid="gateway-pending-binding-row"]'),
    ).toHaveCount(1);

    await telegramPane
      .locator('[data-testid="gateway-approve-code"]')
      .fill('123456');
    await telegramPane.locator('[data-testid="gateway-approve-btn"]').click();

    await expect(
      telegramPane.locator('[data-testid="gateway-pending-binding-row"]'),
    ).toHaveCount(0);
    await expect(
      telegramPane.locator('[data-testid="gateway-binding-empty"]'),
    ).toBeVisible();
  });

  test('gateway:statusChanged push transitions a tile and pane to running', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'gateway:status': {
        enabled: true,
        adapters: [
          { platform: 'telegram', running: true },
          { platform: 'discord', running: false },
          { platform: 'slack', running: false },
        ],
      },
      'gateway:listBindings': { bindings: [] },
    });

    await ui.openTab('gateway');

    const page = ui.page;
    const discordPane = platformPane(ui, 'discord');

    await expect(
      page.locator('[data-testid="gateway-tile-status-discord"]'),
    ).toHaveText('stopped');
    await expect(
      discordPane.locator('[data-testid="gateway-platform-status-discord"]'),
    ).toHaveText('stopped');

    await ui.pushEvent({
      type: 'gateway:statusChanged',
      payload: {
        origin: null,
        status: {
          enabled: true,
          adapters: [
            { platform: 'telegram', running: true },
            { platform: 'discord', running: true },
            { platform: 'slack', running: false },
          ],
        },
      },
    });

    await expect(
      page.locator('[data-testid="gateway-tile-status-discord"]'),
    ).toHaveText('running');
    await expect(
      discordPane.locator('[data-testid="gateway-platform-status-discord"]'),
    ).toHaveText('running');
  });
});
