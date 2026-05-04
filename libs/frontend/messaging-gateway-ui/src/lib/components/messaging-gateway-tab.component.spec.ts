import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type { GatewayBindingDto } from '@ptah-extension/shared';

import { MessagingGatewayTabComponent } from './messaging-gateway-tab.component';
import {
  GatewayStateService,
  PlatformStatus,
  RateLimitView,
  VoiceModelDownloadProgress,
} from '../services/gateway-state.service';

interface StubState {
  readonly enabled: ReturnType<typeof signal<boolean>>;
  readonly platforms: ReturnType<
    typeof signal<Record<'telegram' | 'discord' | 'slack', PlatformStatus>>
  >;
  readonly bindings: ReturnType<typeof signal<readonly GatewayBindingDto[]>>;
  readonly pendingBindings: ReturnType<
    typeof signal<readonly GatewayBindingDto[]>
  >;
  readonly approvedBindings: ReturnType<
    typeof signal<readonly GatewayBindingDto[]>
  >;
  readonly lastError: ReturnType<
    typeof signal<Record<'telegram' | 'discord' | 'slack', string | null>>
  >;
  readonly voiceEnabled: ReturnType<typeof signal<boolean>>;
  readonly whisperModel: ReturnType<typeof signal<string>>;
  readonly rateLimit: ReturnType<typeof signal<RateLimitView>>;
  readonly voiceDownload: ReturnType<
    typeof signal<VoiceModelDownloadProgress | null>
  >;
  readonly testResult: ReturnType<
    typeof signal<{
      readonly platform: 'telegram' | 'discord' | 'slack';
      readonly ok: boolean;
      readonly message: string;
    } | null>
  >;
  readonly hasApprovedBindingFor: jest.Mock<
    boolean,
    ['telegram' | 'discord' | 'slack']
  >;
  readonly initialize: jest.Mock<Promise<void>, []>;
  readonly setToken: jest.Mock<
    Promise<void>,
    ['telegram' | 'discord' | 'slack', string, string?]
  >;
  readonly approveBinding: jest.Mock<Promise<void>, [string]>;
  readonly rejectBinding: jest.Mock<Promise<void>, [string]>;
  readonly revokeBinding: jest.Mock<Promise<void>, [string]>;
  readonly sendTest: jest.Mock<
    Promise<{ ok: boolean; bindingId: string; messageId: string | null }>,
    ['telegram' | 'discord' | 'slack' | 'whatsapp', string?]
  >;
  readonly dismissVoiceToast: jest.Mock<void, []>;
}

function makeStub(): StubState {
  const stoppedStatus: PlatformStatus = { state: 'stopped', lastError: null };
  return {
    enabled: signal(false),
    platforms: signal({
      telegram: stoppedStatus,
      discord: stoppedStatus,
      slack: stoppedStatus,
    }),
    bindings: signal<readonly GatewayBindingDto[]>([]),
    pendingBindings: signal<readonly GatewayBindingDto[]>([]),
    approvedBindings: signal<readonly GatewayBindingDto[]>([]),
    lastError: signal({ telegram: null, discord: null, slack: null }),
    voiceEnabled: signal(false),
    whisperModel: signal('base.en'),
    rateLimit: signal<RateLimitView>({ minTimeMs: 500, maxConcurrent: 2 }),
    voiceDownload: signal<VoiceModelDownloadProgress | null>(null),
    testResult: signal<{
      readonly platform: 'telegram' | 'discord' | 'slack';
      readonly ok: boolean;
      readonly message: string;
    } | null>(null),
    hasApprovedBindingFor: jest.fn(() => false),
    initialize: jest.fn(async () => undefined),
    setToken: jest.fn(async () => undefined),
    approveBinding: jest.fn(async () => undefined),
    rejectBinding: jest.fn(async () => undefined),
    revokeBinding: jest.fn(async () => undefined),
    sendTest: jest.fn(async () => ({
      ok: true,
      bindingId: 'b1',
      messageId: 'm1',
    })),
    dismissVoiceToast: jest.fn(),
  };
}

function makeVscodeStub(isElectron = true): { isElectron: boolean } {
  return { isElectron };
}

function setInputValue(
  fixture: { nativeElement: HTMLElement; detectChanges: () => void },
  selector: string,
  value: string,
): HTMLInputElement {
  const input = fixture.nativeElement.querySelector(
    selector,
  ) as HTMLInputElement | null;
  if (!input) throw new Error(`input not found: ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  return input;
}

describe('MessagingGatewayTabComponent', () => {
  describe('VS Code parity', () => {
    it('renders the desktop-only placeholder when not Electron', () => {
      const stub = makeStub();
      TestBed.configureTestingModule({
        imports: [MessagingGatewayTabComponent],
        providers: [
          { provide: GatewayStateService, useValue: stub },
          { provide: VSCodeService, useValue: makeVscodeStub(false) },
        ],
      });
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'Messaging gateway is only available in the Ptah desktop app.',
      );
      expect(stub.initialize).not.toHaveBeenCalled();
    });

    it('initializes state when Electron', () => {
      const stub = makeStub();
      TestBed.configureTestingModule({
        imports: [MessagingGatewayTabComponent],
        providers: [
          { provide: GatewayStateService, useValue: stub },
          { provide: VSCodeService, useValue: makeVscodeStub(true) },
        ],
      });
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();
      expect(stub.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('token input security', () => {
    let stub: StubState;
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let setItemSpy: jest.SpyInstance;
    let sessionSetItemSpy: jest.SpyInstance;

    beforeEach(() => {
      stub = makeStub();
      TestBed.configureTestingModule({
        imports: [MessagingGatewayTabComponent],
        providers: [
          { provide: GatewayStateService, useValue: stub },
          { provide: VSCodeService, useValue: makeVscodeStub(true) },
        ],
      });
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {
        // intentionally empty
      });
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        // intentionally empty
      });
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
        // intentionally empty
      });
      setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      sessionSetItemSpy = jest.spyOn(window.sessionStorage, 'setItem');
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      setItemSpy.mockRestore();
      sessionSetItemSpy.mockRestore();
    });

    it('uses autocomplete=new-password and password type on the bot token input', () => {
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();
      const inputs = fixture.nativeElement.querySelectorAll(
        'input[type="password"]',
      ) as NodeListOf<HTMLInputElement>;
      // 3 platforms × 1 bot token + 1 slack app token = 4 password fields
      expect(inputs.length).toBe(4);
      for (const input of Array.from(inputs)) {
        expect(input.getAttribute('autocomplete')).toBe('new-password');
        expect(input.getAttribute('autocorrect')).toBe('off');
        expect(input.getAttribute('autocapitalize')).toBe('off');
        expect(input.getAttribute('spellcheck')).toBe('false');
      }
    });

    it('clears the token input synchronously after setToken resolves', async () => {
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();

      const input = setInputValue(
        fixture,
        'input[name="bot-token"]',
        'SECRET_TOKEN_VALUE',
      );
      expect(input.value).toBe('SECRET_TOKEN_VALUE');

      const form = input.closest('form') as HTMLFormElement;
      // Submit the form — wait for the promise chain.
      const submitEvent = new Event('submit', {
        cancelable: true,
        bubbles: true,
      });
      form.dispatchEvent(submitEvent);
      // Wait one microtask cycle for the async submitToken to settle.
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(stub.setToken).toHaveBeenCalledTimes(1);
      const secondArg = stub.setToken.mock.calls[0]?.[1];
      expect(secondArg).toBe('SECRET_TOKEN_VALUE');

      // Field cleared synchronously after promise settles.
      const refetched = fixture.nativeElement.querySelector(
        'input[name="bot-token"]',
      ) as HTMLInputElement;
      expect(refetched.value).toBe('');
    });

    it('clears the token input even when setToken rejects', async () => {
      stub.setToken.mockRejectedValueOnce(new Error('vault-unavailable'));
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();

      const input = setInputValue(
        fixture,
        'input[name="bot-token"]',
        'TOKEN_THAT_FAILS',
      );

      const form = input.closest('form') as HTMLFormElement;
      const submitEvent = new Event('submit', {
        cancelable: true,
        bubbles: true,
      });
      form.dispatchEvent(submitEvent);
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const refetched = fixture.nativeElement.querySelector(
        'input[name="bot-token"]',
      ) as HTMLInputElement;
      expect(refetched.value).toBe('');
    });

    it('never logs the token to console.* and never persists it to storage', async () => {
      const TOKEN = 'XOXB-LEAK-CHECK-987654321';
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();

      const input = setInputValue(fixture, 'input[name="bot-token"]', TOKEN);
      const form = input.closest('form') as HTMLFormElement;
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      // Inspect every captured console call — none may contain the token.
      const logCalls = [
        ...consoleLogSpy.mock.calls,
        ...consoleWarnSpy.mock.calls,
        ...consoleErrorSpy.mock.calls,
      ];
      for (const call of logCalls) {
        const joined = call.map((arg) => String(arg)).join(' ');
        expect(joined).not.toContain(TOKEN);
      }

      // Storage must never receive the token.
      for (const call of setItemSpy.mock.calls) {
        const [, value] = call;
        expect(String(value)).not.toContain(TOKEN);
      }
      for (const call of sessionSetItemSpy.mock.calls) {
        const [, value] = call;
        expect(String(value)).not.toContain(TOKEN);
      }
    });
  });

  describe('send test button', () => {
    it('is disabled when no approved bindings exist', () => {
      const stub = makeStub();
      stub.platforms.set({
        telegram: { state: 'running', lastError: null },
        discord: { state: 'stopped', lastError: null },
        slack: { state: 'stopped', lastError: null },
      });
      stub.hasApprovedBindingFor.mockReturnValue(false);

      TestBed.configureTestingModule({
        imports: [MessagingGatewayTabComponent],
        providers: [
          { provide: GatewayStateService, useValue: stub },
          { provide: VSCodeService, useValue: makeVscodeStub(true) },
        ],
      });
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();

      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('button.btn-outline.btn-sm'),
      ) as HTMLButtonElement[];
      const testButtons = buttons.filter(
        (b) => b.textContent?.trim() === 'Send test',
      );
      expect(testButtons.length).toBe(3);
      for (const b of testButtons) {
        expect(b.disabled).toBe(true);
      }
    });

    it('is enabled when running AND has at least one approved binding', () => {
      const stub = makeStub();
      stub.platforms.set({
        telegram: { state: 'running', lastError: null },
        discord: { state: 'stopped', lastError: null },
        slack: { state: 'stopped', lastError: null },
      });
      stub.hasApprovedBindingFor.mockImplementation((p) => p === 'telegram');

      TestBed.configureTestingModule({
        imports: [MessagingGatewayTabComponent],
        providers: [
          { provide: GatewayStateService, useValue: stub },
          { provide: VSCodeService, useValue: makeVscodeStub(true) },
        ],
      });
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();

      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('button.btn-outline.btn-sm'),
      ) as HTMLButtonElement[];
      const testButtons = buttons.filter(
        (b) => b.textContent?.trim() === 'Send test',
      );
      // First card (Telegram) should be enabled; others disabled.
      expect(testButtons[0]?.disabled).toBe(false);
      expect(testButtons[1]?.disabled).toBe(true);
      expect(testButtons[2]?.disabled).toBe(true);
    });
  });

  describe('pending bindings approval queue', () => {
    function pendingBinding(id: string): GatewayBindingDto {
      return {
        id,
        platform: 'telegram',
        externalChatId: 'chat-' + id,
        displayName: null,
        approvalStatus: 'pending',
        ptahSessionId: null,
        workspaceRoot: null,
        pairingCode: null,
        createdAt: 0,
        approvedAt: null,
        lastActiveAt: null,
      };
    }

    it('renders a code-entry input for each pending binding and dispatches approveBinding on click', async () => {
      const stub = makeStub();
      stub.pendingBindings.set([pendingBinding('bind-1')]);

      TestBed.configureTestingModule({
        imports: [MessagingGatewayTabComponent],
        providers: [
          { provide: GatewayStateService, useValue: stub },
          { provide: VSCodeService, useValue: makeVscodeStub(true) },
        ],
      });
      const fixture = TestBed.createComponent(MessagingGatewayTabComponent);
      fixture.detectChanges();

      // Code-entry input rendered.
      const codeInput = fixture.nativeElement.querySelector(
        'input[placeholder="code"]',
      ) as HTMLInputElement | null;
      expect(codeInput).not.toBeNull();

      // Approve button starts disabled (empty code).
      const approveBtn = Array.from(
        fixture.nativeElement.querySelectorAll('button'),
      ).find(
        (b) => (b as HTMLButtonElement).textContent?.trim() === 'Approve',
      ) as HTMLButtonElement | undefined;
      expect(approveBtn).toBeDefined();
      expect(approveBtn?.disabled).toBe(true);

      // Type a code → button enables → click dispatches.
      if (codeInput) {
        codeInput.value = 'ABC123';
        codeInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      }
      expect(approveBtn?.disabled).toBe(false);

      approveBtn?.click();
      await Promise.resolve();
      expect(stub.approveBinding).toHaveBeenCalledWith('bind-1');
    });
  });
});
