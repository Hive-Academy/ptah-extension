import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  GatewayBindingDto,
  GatewayPlatformId,
} from '@ptah-extension/shared';

import { MessagingGatewayTabComponent } from './messaging-gateway-tab.component';
import {
  GatewayStateService,
  type PlatformStatus,
  type RateLimitView,
  type VoiceModelDownloadProgress,
} from '../services/gateway-state.service';

function makeStub() {
  const stopped: PlatformStatus = { state: 'stopped', lastError: null };
  return {
    enabled: signal(false),
    platforms: signal<Record<GatewayPlatformId, PlatformStatus>>({
      telegram: stopped,
      discord: stopped,
      slack: stopped,
    }),
    bindings: signal<readonly GatewayBindingDto[]>([]),
    pendingBindings: signal<readonly GatewayBindingDto[]>([]),
    approvedBindings: signal<readonly GatewayBindingDto[]>([]),
    lastError: signal<Record<GatewayPlatformId, string | null>>({
      telegram: null,
      discord: null,
      slack: null,
    }),
    globalError: signal<string | null>(null),
    voiceEnabled: signal(false),
    whisperModel: signal('base.en'),
    rateLimit: signal<RateLimitView>({ minTimeMs: 500, maxConcurrent: 2 }),
    voiceDownload: signal<VoiceModelDownloadProgress | null>(null),
    testResult: signal<{
      readonly platform: GatewayPlatformId;
      readonly ok: boolean;
      readonly message: string;
    } | null>(null),
    allowLists: signal<Record<GatewayPlatformId, string[]>>({
      telegram: [],
      discord: [],
      slack: [],
    }),
    discordAppId: signal<string | null>(null),
    discordGuilds: signal<readonly { id: string; name: string }[]>([]),
    hasApprovedBindingFor: jest.fn((_platform: GatewayPlatformId) => false),
    initialize: jest.fn(async () => undefined),
    saveAllowList: jest.fn(async () => ({ ok: true as const })),
    loadAllowList: jest.fn(async () => undefined),
    saveDiscordAppId: jest.fn(async () => ({ ok: true as const })),
    loadDiscordGuilds: jest.fn(async () => undefined),
    registerDiscordCommands: jest.fn(async () => ({
      ok: true as const,
      registered: 1,
      scope: 'guild' as const,
    })),
    setToken: jest.fn(async () => undefined),
    approveBinding: jest.fn(async () => ({ ok: true as const })),
    rejectBinding: jest.fn(async () => undefined),
    revokeBinding: jest.fn(async () => undefined),
    sendTest: jest.fn(async () => ({
      ok: true,
      bindingId: 'b1',
      messageId: 'm1',
    })),
    dismissVoiceToast: jest.fn(),
    clearGlobalError: jest.fn(),
  };
}

type StubState = ReturnType<typeof makeStub>;

function mount(
  stub: StubState = makeStub(),
  isElectron = true,
): {
  fixture: ComponentFixture<MessagingGatewayTabComponent>;
  stub: StubState;
} {
  TestBed.configureTestingModule({
    imports: [MessagingGatewayTabComponent],
    providers: [
      { provide: GatewayStateService, useValue: stub },
      { provide: VSCodeService, useValue: { isElectron } },
    ],
  });
  const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
  fixture.detectChanges();
  return { fixture, stub };
}

function pane(
  fixture: ComponentFixture<MessagingGatewayTabComponent>,
  platform: GatewayPlatformId,
): HTMLElement {
  const el = fixture.nativeElement.querySelector(
    `#gateway-pane-${platform}`,
  ) as HTMLElement | null;
  if (!el) throw new Error(`pane not found: ${platform}`);
  return el;
}

function tile(
  fixture: ComponentFixture<MessagingGatewayTabComponent>,
  platform: GatewayPlatformId,
): HTMLButtonElement {
  const el = fixture.nativeElement.querySelector(
    `[data-testid="gateway-tile-${platform}"]`,
  ) as HTMLButtonElement | null;
  if (!el) throw new Error(`tile not found: ${platform}`);
  return el;
}

function buildBinding(
  over: Partial<GatewayBindingDto> & { id: string },
): GatewayBindingDto {
  return {
    id: over.id,
    platform: over.platform ?? 'discord',
    externalChatId: 'chat-' + over.id,
    allowListId: over.allowListId ?? null,
    displayName: over.displayName ?? null,
    approvalStatus: over.approvalStatus ?? 'pending',
    ptahSessionId: null,
    workspaceRoot: null,
    pairingCode: null,
    createdAt: 0,
    approvedAt: null,
    lastActiveAt: null,
  };
}

async function settle(
  fixture: ComponentFixture<MessagingGatewayTabComponent>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('MessagingGatewayTabComponent (shell)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('VS Code parity', () => {
    it('renders the desktop-only placeholder when not Electron', () => {
      const { fixture, stub } = mount(makeStub(), false);

      expect(fixture.nativeElement.textContent).toContain(
        'Messaging gateway is only available in the Ptah desktop app.',
      );
      expect(stub.initialize).not.toHaveBeenCalled();
    });

    it('initializes state when Electron', () => {
      const { stub } = mount();
      expect(stub.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('platform tab tiles', () => {
    it('renders the tablist with Discord selected by default', () => {
      const { fixture } = mount();

      expect(
        fixture.nativeElement.querySelector('[role="tablist"]'),
      ).not.toBeNull();
      expect(tile(fixture, 'discord').getAttribute('aria-selected')).toBe(
        'true',
      );
      expect(tile(fixture, 'slack').getAttribute('aria-selected')).toBe(
        'false',
      );
      expect(tile(fixture, 'telegram').getAttribute('aria-selected')).toBe(
        'false',
      );
    });

    it('keeps all three panes mounted, hiding the unselected ones', () => {
      const { fixture } = mount();

      expect(pane(fixture, 'discord').hidden).toBe(false);
      expect(pane(fixture, 'slack').hidden).toBe(true);
      expect(pane(fixture, 'telegram').hidden).toBe(true);
      expect(
        fixture.nativeElement.querySelectorAll('[role="tabpanel"]').length,
      ).toBe(3);
    });

    it('switches the visible pane when a tile is clicked', () => {
      const { fixture } = mount();

      tile(fixture, 'slack').click();
      fixture.detectChanges();

      expect(pane(fixture, 'discord').hidden).toBe(true);
      expect(pane(fixture, 'slack').hidden).toBe(false);
      expect(tile(fixture, 'slack').getAttribute('aria-selected')).toBe('true');
    });

    it('switches the visible pane via keyboard arrow navigation', () => {
      const { fixture } = mount();

      tile(fixture, 'discord').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );
      fixture.detectChanges();

      expect(pane(fixture, 'slack').hidden).toBe(false);
      expect(tile(fixture, 'slack').getAttribute('aria-selected')).toBe('true');
      expect(tile(fixture, 'discord').getAttribute('aria-selected')).toBe(
        'false',
      );
    });

    it('reflects platform status changes on the tiles', () => {
      const { fixture, stub } = mount();

      stub.platforms.set({
        telegram: { state: 'stopped', lastError: null },
        discord: { state: 'running', lastError: null },
        slack: { state: 'error', lastError: 'boom' },
      });
      fixture.detectChanges();

      expect(
        fixture.nativeElement
          .querySelector('[data-testid="gateway-tile-status-discord"]')
          ?.textContent?.trim(),
      ).toBe('running');
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="gateway-tile-status-slack"]')
          ?.textContent?.trim(),
      ).toBe('error');
    });
  });

  describe('draft survival across tab switches (AC 4.2)', () => {
    it('preserves an unsaved token draft when switching tabs and back', () => {
      const { fixture } = mount();

      const input = pane(fixture, 'discord').querySelector(
        'input[name="bot-token"]',
      ) as HTMLInputElement;
      input.value = 'DRAFT_TOKEN';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      tile(fixture, 'telegram').click();
      fixture.detectChanges();
      tile(fixture, 'discord').click();
      fixture.detectChanges();

      const refetched = pane(fixture, 'discord').querySelector(
        'input[name="bot-token"]',
      ) as HTMLInputElement;
      expect(refetched.value).toBe('DRAFT_TOKEN');
    });

    it('preserves an unsaved allow-list draft when switching tabs and back', () => {
      const { fixture } = mount();

      const textarea = pane(fixture, 'slack').querySelector(
        '[data-testid="gateway-allowlist-slack"]',
      ) as HTMLTextAreaElement;
      tile(fixture, 'slack').click();
      fixture.detectChanges();

      textarea.value = 'T123';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      tile(fixture, 'discord').click();
      fixture.detectChanges();
      tile(fixture, 'slack').click();
      fixture.detectChanges();

      expect(
        (
          pane(fixture, 'slack').querySelector(
            '[data-testid="gateway-allowlist-slack"]',
          ) as HTMLTextAreaElement
        ).value,
      ).toBe('T123');
    });
  });

  describe('global error alert (AC 4.5)', () => {
    it('renders the global error and dismisses via clearGlobalError', () => {
      const { fixture, stub } = mount();

      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="gateway-global-error"]',
        ),
      ).toBeNull();

      stub.globalError.set('rpc transport down');
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector(
        '[data-testid="gateway-global-error"]',
      ) as HTMLElement;
      expect(alert).not.toBeNull();
      expect(alert.textContent).toContain('rpc transport down');

      (alert.querySelector('button') as HTMLButtonElement).click();
      expect(stub.clearGlobalError).toHaveBeenCalledTimes(1);
    });
  });

  describe('token form preservation (AC 4.4)', () => {
    it('submits the bot token to the service and clears the field', async () => {
      const { fixture, stub } = mount();

      const input = pane(fixture, 'discord').querySelector(
        'input[name="bot-token"]',
      ) as HTMLInputElement;
      input.value = 'SECRET_TOKEN_VALUE';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const form = input.closest('form') as HTMLFormElement;
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await settle(fixture);

      expect(stub.setToken).toHaveBeenCalledWith(
        'discord',
        'SECRET_TOKEN_VALUE',
      );
      expect(
        (
          pane(fixture, 'discord').querySelector(
            'input[name="bot-token"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('');
    });

    it('submits both Slack tokens and clears them even on rejection', async () => {
      const { fixture, stub } = mount();
      stub.setToken.mockRejectedValueOnce(new Error('vault-unavailable'));

      tile(fixture, 'slack').click();
      fixture.detectChanges();

      const slackPane = pane(fixture, 'slack');
      const bot = slackPane.querySelector(
        'input[name="bot-token"]',
      ) as HTMLInputElement;
      const app = slackPane.querySelector(
        'input[name="app-token"]',
      ) as HTMLInputElement;
      bot.value = 'xoxb-bot';
      bot.dispatchEvent(new Event('input'));
      app.value = 'xapp-app';
      app.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      (bot.closest('form') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await settle(fixture);

      expect(stub.setToken).toHaveBeenCalledWith(
        'slack',
        'xoxb-bot',
        'xapp-app',
      );
      expect(
        (slackPane.querySelector('input[name="bot-token"]') as HTMLInputElement)
          .value,
      ).toBe('');
      expect(
        (slackPane.querySelector('input[name="app-token"]') as HTMLInputElement)
          .value,
      ).toBe('');
    });

    it('keeps password semantics on all token inputs', () => {
      const { fixture } = mount();
      const inputs = fixture.nativeElement.querySelectorAll(
        'input[type="password"]',
      ) as NodeListOf<HTMLInputElement>;
      expect(inputs.length).toBe(4);
      for (const input of Array.from(inputs)) {
        expect(input.getAttribute('autocomplete')).toBe('new-password');
        expect(input.getAttribute('spellcheck')).toBe('false');
      }
    });
  });

  describe('allow-list preservation (AC 4.4)', () => {
    it('seeds from state and saves trimmed entries to the service', async () => {
      const stub = makeStub();
      stub.allowLists.set({ telegram: [], discord: ['111', '222'], slack: [] });
      const { fixture } = mount(stub);

      const textarea = pane(fixture, 'discord').querySelector(
        '[data-testid="gateway-allowlist-discord"]',
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe('111\n222');

      textarea.value = ' 111 \n\n333\n';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      (
        pane(fixture, 'discord').querySelector(
          '[data-testid="gateway-allowlist-save-discord"]',
        ) as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(stub.saveAllowList).toHaveBeenCalledWith('discord', [
        '111',
        '333',
      ]);
    });
  });

  describe('bindings preservation (AC 4.4)', () => {
    it('shows pending bindings only in their platform pane', () => {
      const stub = makeStub();
      stub.pendingBindings.set([
        buildBinding({ id: 'b-tg', platform: 'telegram' }),
      ]);
      const { fixture } = mount(stub);

      expect(
        pane(fixture, 'telegram').querySelectorAll(
          '[data-testid="gateway-pending-binding-row"]',
        ).length,
      ).toBe(1);
      expect(
        pane(fixture, 'discord').querySelectorAll(
          '[data-testid="gateway-pending-binding-row"]',
        ).length,
      ).toBe(0);
    });

    it('approves with the entered code and the binding platform', async () => {
      const stub = makeStub();
      stub.pendingBindings.set([
        buildBinding({ id: 'bind-1', platform: 'discord' }),
      ]);
      const { fixture } = mount(stub);

      const discordPane = pane(fixture, 'discord');
      const codeInput = discordPane.querySelector(
        '[data-testid="gateway-approve-code"]',
      ) as HTMLInputElement;
      const approveBtn = discordPane.querySelector(
        '[data-testid="gateway-approve-btn"]',
      ) as HTMLButtonElement;

      expect(approveBtn.disabled).toBe(true);
      codeInput.value = 'ABC123';
      codeInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(approveBtn.disabled).toBe(false);

      approveBtn.click();
      await settle(fixture);

      expect(stub.approveBinding).toHaveBeenCalledWith(
        'bind-1',
        'ABC123',
        'discord',
      );
    });

    it('rejects a pending binding with its platform', async () => {
      const stub = makeStub();
      stub.pendingBindings.set([
        buildBinding({ id: 'bind-2', platform: 'discord' }),
      ]);
      const { fixture } = mount(stub);

      const rejectBtn = Array.from(
        pane(fixture, 'discord').querySelectorAll('button'),
      ).find(
        (b) => (b as HTMLButtonElement).textContent?.trim() === 'Reject',
      ) as HTMLButtonElement;
      rejectBtn.click();
      await settle(fixture);

      expect(stub.rejectBinding).toHaveBeenCalledWith('bind-2', 'discord');
    });

    it('revokes an approved binding with its platform', async () => {
      const stub = makeStub();
      stub.approvedBindings.set([
        buildBinding({
          id: 'bind-3',
          platform: 'discord',
          approvalStatus: 'approved',
        }),
      ]);
      const { fixture } = mount(stub);

      const revokeBtn = Array.from(
        pane(fixture, 'discord').querySelectorAll('button'),
      ).find(
        (b) => (b as HTMLButtonElement).textContent?.trim() === 'Revoke',
      ) as HTMLButtonElement;
      revokeBtn.click();
      await settle(fixture);

      expect(stub.revokeBinding).toHaveBeenCalledWith('bind-3', 'discord');
    });

    it('offers allow-sender for a pending binding and appends its id', async () => {
      const stub = makeStub();
      stub.pendingBindings.set([
        buildBinding({
          id: 'b4',
          platform: 'telegram',
          allowListId: '12345',
        }),
      ]);
      const { fixture } = mount(stub);

      const btn = pane(fixture, 'telegram').querySelector(
        '[data-testid="gateway-allow-sender-b4"]',
      ) as HTMLButtonElement;
      expect(btn.textContent?.trim()).toBe('Allow this user');

      btn.click();
      await settle(fixture);
      expect(stub.saveAllowList).toHaveBeenCalledWith('telegram', ['12345']);
    });
  });

  describe('Discord integration kit preservation (AC 4.4)', () => {
    it('renders the integration kit only in the Discord pane', () => {
      const { fixture } = mount();
      expect(
        fixture.nativeElement.querySelectorAll(
          '[data-testid="gateway-discord-integration"]',
        ).length,
      ).toBe(1);
      expect(
        pane(fixture, 'discord').querySelector(
          '[data-testid="gateway-discord-integration"]',
        ),
      ).not.toBeNull();
    });

    it('saves the trimmed application id', async () => {
      const { fixture, stub } = mount();

      const appIdInput = fixture.nativeElement.querySelector(
        '[data-testid="gateway-discord-appid"]',
      ) as HTMLInputElement;
      appIdInput.value = '  789  ';
      appIdInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      (
        fixture.nativeElement.querySelector(
          '[data-testid="gateway-discord-appid-save"]',
        ) as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(stub.saveDiscordAppId).toHaveBeenCalledWith('789');
    });

    it('builds an invite URL once an application id is entered', () => {
      const { fixture } = mount();

      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="gateway-discord-invite"]',
        ),
      ).toBeNull();

      const appIdInput = fixture.nativeElement.querySelector(
        '[data-testid="gateway-discord-appid"]',
      ) as HTMLInputElement;
      appIdInput.value = '123456';
      appIdInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const href =
        fixture.nativeElement
          .querySelector('[data-testid="gateway-discord-invite"]')
          ?.getAttribute('href') ?? '';
      expect(href).toContain('client_id=123456');
      expect(href).toContain('permissions=292057779200');
      expect(href).toContain('scope=bot%20applications.commands');
    });

    it('registers /ptah and shows a success summary', async () => {
      const { fixture, stub } = mount();
      stub.registerDiscordCommands.mockResolvedValueOnce({
        ok: true,
        registered: 2,
        scope: 'guild',
      });

      (
        fixture.nativeElement.querySelector(
          '[data-testid="gateway-discord-register"]',
        ) as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(stub.registerDiscordCommands).toHaveBeenCalledTimes(1);
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="gateway-discord-register-feedback"]',
        )?.textContent,
      ).toContain('Registered /ptah on 2 server(s)');
    });

    it('ticking a server adds it to the allow-list', async () => {
      const stub = makeStub();
      stub.discordGuilds.set([{ id: 'g1', name: 'Alpha' }]);
      const { fixture } = mount(stub);

      (
        fixture.nativeElement.querySelector(
          '[data-testid="gateway-discord-guild-g1"] input',
        ) as HTMLInputElement
      ).click();
      await settle(fixture);

      expect(stub.saveAllowList).toHaveBeenCalledWith('discord', ['g1']);
    });

    it('Refresh re-queries the joined servers', async () => {
      const { fixture, stub } = mount();
      stub.loadDiscordGuilds.mockClear();

      (
        fixture.nativeElement.querySelector(
          '[data-testid="gateway-discord-guilds-refresh"]',
        ) as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(stub.loadDiscordGuilds).toHaveBeenCalledTimes(1);
    });
  });

  describe('send-test preservation (AC 4.4)', () => {
    function sendTestButton(
      fixture: ComponentFixture<MessagingGatewayTabComponent>,
      platform: GatewayPlatformId,
    ): HTMLButtonElement {
      const btn = Array.from(
        pane(fixture, platform).querySelectorAll('button'),
      ).find(
        (b) => (b as HTMLButtonElement).textContent?.trim() === 'Send test',
      ) as HTMLButtonElement | undefined;
      if (!btn) throw new Error('Send test button not found');
      return btn;
    }

    it('is disabled without a running adapter and approved binding', () => {
      const { fixture } = mount();
      expect(sendTestButton(fixture, 'discord').disabled).toBe(true);
    });

    it('dispatches sendTest when running with an approved binding', async () => {
      const stub = makeStub();
      stub.platforms.set({
        telegram: { state: 'stopped', lastError: null },
        discord: { state: 'running', lastError: null },
        slack: { state: 'stopped', lastError: null },
      });
      stub.hasApprovedBindingFor.mockImplementation((p) => p === 'discord');
      const { fixture } = mount(stub);

      const btn = sendTestButton(fixture, 'discord');
      expect(btn.disabled).toBe(false);

      btn.click();
      await settle(fixture);
      expect(stub.sendTest).toHaveBeenCalledWith('discord');
    });
  });

  describe('per-platform error alert (AC 4.5)', () => {
    it('shows a platform error only inside its own pane', () => {
      const stub = makeStub();
      stub.lastError.set({
        telegram: null,
        discord: 'discord exploded',
        slack: null,
      });
      const { fixture } = mount(stub);

      expect(pane(fixture, 'discord').textContent).toContain(
        'discord exploded',
      );
      expect(pane(fixture, 'slack').textContent).not.toContain(
        'discord exploded',
      );
      expect(pane(fixture, 'telegram').textContent).not.toContain(
        'discord exploded',
      );
    });
  });

  describe('setup guide drawer', () => {
    it('opens from the Setup guide button and closes via the backdrop', () => {
      const { fixture } = mount();
      expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();

      const button = Array.from(
        fixture.nativeElement.querySelectorAll('button'),
      ).find(
        (b) => (b as HTMLButtonElement).textContent?.trim() === 'Setup guide',
      ) as HTMLButtonElement;
      button.click();
      fixture.detectChanges();

      const dialog = fixture.nativeElement.querySelector(
        '[role="dialog"]',
      ) as HTMLElement | null;
      expect(dialog).not.toBeNull();
      expect(dialog?.getAttribute('aria-label')).toBe('Gateway setup guide');
      expect(dialog?.textContent).toContain('Discord setup');

      const backdrop = fixture.nativeElement.querySelector(
        'ptah-gateway-setup-guide [aria-hidden="true"]',
      ) as HTMLElement;
      backdrop.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    });
  });
});
