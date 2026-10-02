import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import { NativePopoverComponent } from '@ptah-extension/ui';
import type { LicenseGetStatusResponse } from '@ptah-extension/shared';
import { ChatStore } from '../../services/chat.store';
import { LicenseStatusCardComponent } from './license-status-card.component';

/**
 * Popover stub matching `NativePopoverComponent`'s public surface (same shape
 * as the web-search config spec) — jsdom has no real positioning.
 */
@Component({
  selector: 'ptah-native-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content select="[trigger]" />
    @if (isOpen()) {
      <ng-content select="[content]" />
    }
  `,
})
class NativePopoverStub {
  readonly isOpen = input.required<boolean>();
  readonly placement = input<string>('bottom');
  readonly hasBackdrop = input<boolean>(false);
  readonly backdropClass = input<string>('');
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();
}

/** A valid membership key: "ptah_lic_" + 64 hex characters (A5 format check). */
const VALID_KEY = `ptah_lic_${'a'.repeat(64)}`;

/** Base license status fixture; per-test fields are overridden. */
function status(
  overrides: Partial<LicenseGetStatusResponse> = {},
): LicenseGetStatusResponse {
  return {
    valid: true,
    tier: 'community',
    isPremium: false,
    isCommunity: true,
    daysRemaining: null,
    ...overrides,
  };
}

/** Builders-tier fixture with a signed-in user. */
const premiumStatus = status({
  tier: 'builders',
  isPremium: true,
  isCommunity: false,
  plan: { name: 'Builders', description: 'Ptah Builders membership.', features: [] },
  user: { email: 'ada@ptah.dev', firstName: 'Ada', lastName: 'Byron' },
});

describe('LicenseStatusCardComponent', () => {
  let fixture: ComponentFixture<LicenseStatusCardComponent>;
  let component: LicenseStatusCardComponent;
  let element: HTMLElement;
  let rpc: MockRpcService;

  beforeEach(() => { rpc = createMockRpcService(); });
  afterEach(() => { fixture?.destroy(); TestBed.resetTestingModule(); });

  /** Renders the card with the given ChatStore license status. */
  async function render(
    licenseStatusValue: LicenseGetStatusResponse | null,
  ): Promise<void> {
    TestBed.configureTestingModule({
      imports: [LicenseStatusCardComponent, NativePopoverStub],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: ChatStore, useValue: { licenseStatus: signal(licenseStatusValue) } },
      ],
    }).overrideComponent(LicenseStatusCardComponent, {
      remove: { imports: [NativePopoverComponent] },
      add: { imports: [NativePopoverStub] },
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(LicenseStatusCardComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Opens the key popover via its header trigger and returns the input element. */
  async function openKeyPopover(): Promise<HTMLInputElement> {
    element.querySelector<HTMLButtonElement>('[data-testid="membership-key-trigger"]')?.click();
    fixture.detectChanges();
    const input = element.querySelector<HTMLInputElement>('[data-testid="membership-key-input"]');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  /** Types the given key into the popover and clicks Activate. */
  async function activate(key: string): Promise<void> {
    component.licenseKeyInput.set(key);
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="membership-key-activate"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders nothing while the license status is loading', async () => {
    await render(null);
    expect(element.textContent?.trim()).toBe('');
  });

  it('shows the community card with Community and Active badges and one primary action', async () => {
    await render(status());
    expect(element.textContent).toContain('Membership & data');
    const badges = Array.from(element.querySelectorAll('.badge')).map(
      (badge) => badge.textContent?.trim(),
    );
    expect(badges).toContain('Community');
    expect(badges).toContain('Active');
    expect(badges).not.toContain('Builder');
    // A6: exactly one primary action — Create Account.
    expect(element.querySelectorAll('.btn-primary').length).toBe(1);
    expect(element.textContent).toContain('Create Account');
    expect(element.textContent).toContain('Enter Membership Key');
    expect(element.textContent).toContain('Explore Ptah Builders');
  });

  it('shows the member card with the Builder badge, profile row and one primary action', async () => {
    await render(premiumStatus);
    expect(element.textContent).toContain('Builder');
    expect(element.textContent).not.toContain('Community');
    // A6: the member's single primary action is Manage Membership.
    expect(element.querySelectorAll('.btn-primary').length).toBe(1);
    expect(element.textContent).toContain('Manage Membership');
    // A3: profile row with identity and A7: plan text.
    const profile = element.querySelector('[aria-label="User profile"]');
    expect(profile?.textContent).toContain('Ada Byron');
    expect(profile?.textContent).toContain('ada@ptah.dev');
    expect(profile?.textContent).toContain('AB');
    expect(element.textContent).toContain('Ptah Builders membership.');
    const logout = element.querySelector<HTMLButtonElement>('[data-testid="logout-button"]');
    expect(logout?.getAttribute('aria-label')).toBe('Remove membership key and log out');
  });

  it('shows the Needs Attention badge when a member key has a reason', async () => {
    await render(status({ ...premiumStatus, reason: 'expired' }));
    expect(element.textContent).toContain('Needs Attention');
    expect(element.textContent).not.toContain('Active');
    // The A2 alert is community-only.
    expect(element.querySelector('[data-testid="membership-key-alert"]')).toBeNull();
  });

  it('shows the key-not-active alert with verbatim copy and opens the popover from it', async () => {
    await render(status({ valid: false, reason: 'no_license' }));
    const alert = element.querySelector('[data-testid="membership-key-alert"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Membership Key Not Active');
    expect(alert?.textContent).toContain(
      "Ptah's local features remain available either way.",
    );
    element.querySelector<HTMLButtonElement>('[data-testid="membership-key-alert-action"]')?.click();
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="membership-key-popover"]')).not.toBeNull();
  });

  it('confirms before logging out and cancels without an RPC call', async () => {
    await render(premiumStatus);
    element.querySelector<HTMLButtonElement>('[data-testid="logout-button"]')?.click();
    fixture.detectChanges();
    const confirm = element.querySelector('[data-testid="logout-confirm"]');
    expect(confirm?.getAttribute('role')).toBe('group');
    expect(rpc.call).not.toHaveBeenCalled();
    const cancel = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-testid="logout-confirm"] button'))
      .find((button) => button.textContent?.trim() === 'Cancel');
    cancel?.click();
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="logout-confirm"]')).toBeNull();
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('calls license:clearKey on confirmed log out and closes the confirm on success', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ success: true }));
    await render(premiumStatus);
    element.querySelector<HTMLButtonElement>('[data-testid="logout-button"]')?.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="logout-confirm-button"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(rpc.call).toHaveBeenCalledWith('license:clearKey', {});
    // Success reloads the window host-side; the confirm simply closes.
    expect(element.querySelector('[data-testid="logout-confirm"]')).toBeNull();
  });

  /** F1: an RPC failure, `{ success:false, error }` and a thrown Error never show host text. */
  const HOST_FAILURES: ReadonlyArray<[string, (mock: MockRpcService['call']) => void]> = [
    ['an RPC failure', (call) => call.mockResolvedValue(rpcError('host detail'))],
    ['a { success:false, error } answer', (call) => call.mockResolvedValue(rpcSuccess({ success: false, error: 'host detail' }))],
    ['a thrown Error', (call) => call.mockRejectedValue(new Error('host detail'))],
  ];

  it.each(HOST_FAILURES)('keeps the log-out confirm open with a fixed sentence on %s', async (_case, arrange) => {
    arrange(rpc.call);
    await render(premiumStatus);
    element.querySelector<HTMLButtonElement>('[data-testid="logout-button"]')?.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="logout-confirm-button"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="logout-confirm"]')).not.toBeNull();
    const error = element.querySelector('[data-testid="logout-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent?.trim()).toBe('Could not log out.');
    expect(element.textContent).not.toContain('host detail');
  });

  it('rejects a malformed key locally without an RPC call', async () => {
    await render(status());
    await openKeyPopover();
    await activate('not-a-key');
    expect(rpc.call).not.toHaveBeenCalled();
    const error = element.querySelector('[data-testid="membership-key-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Invalid format');
  });

  it('verifies a well-formed key via license:setKey and shows the success line only from the result', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ success: true, tier: 'builders', plan: { name: 'Builders' } }));
    await render(status());
    await openKeyPopover();
    await activate(VALID_KEY);
    expect(rpc.call).toHaveBeenCalledWith('license:setKey', { licenseKey: VALID_KEY });
    const success = element.querySelector('[data-testid="membership-key-success"]');
    expect(success?.getAttribute('role')).toBe('status');
    expect(success?.textContent).toContain(
      'Membership activated! Plan: Builders. Reloading...',
    );
    expect(element.querySelector('[data-testid="membership-key-error"]')).toBeNull();
  });

  it.each(HOST_FAILURES)('shows a fixed sentence inline when key activation fails with %s', async (_case, arrange) => {
    arrange(rpc.call);
    await render(status());
    await openKeyPopover();
    await activate(VALID_KEY);
    const error = element.querySelector('[data-testid="membership-key-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent?.trim()).toBe('Could not activate the membership key.');
    expect(element.textContent).not.toContain('host detail');
    expect(element.querySelector('[data-testid="membership-key-success"]')).toBeNull();
  });

  it('never persists a typed key after the popover closes', async () => {
    await render(status());
    const inputEl = await openKeyPopover();
    component.licenseKeyInput.set(VALID_KEY);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(inputEl.value).toBe(VALID_KEY);
    // Close via the popover's X button.
    element.querySelector<HTMLButtonElement>('[data-testid="membership-key-popover"] button[aria-label="Close"]')?.click();
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="membership-key-popover"]')).toBeNull();
    expect(component.licenseKeyInput()).toBe('');
    // Reopen: the draft never survived the close.
    const reopened = await openKeyPopover();
    expect(reopened.value).toBe('');
    expect(reopened.getAttribute('type')).toBe('password');
  });

  it('toggles key visibility with the show/hide control', async () => {
    await render(status());
    const inputEl = await openKeyPopover();
    const visibility = element.querySelector<HTMLButtonElement>('[data-testid="membership-key-visibility"]');
    expect(visibility?.getAttribute('aria-label')).toBe('Show membership key');
    visibility?.click();
    fixture.detectChanges();
    expect(inputEl.getAttribute('type')).toBe('text');
    expect(element.querySelector('[data-testid="membership-key-visibility"]')?.getAttribute('aria-label'))
      .toBe('Hide membership key');
  });
});