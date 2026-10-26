import { Clipboard } from '@angular/cdk/clipboard';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ProviderAccountActionKind } from '@ptah-extension/core';
import type {
  ProviderAccountActionResult,
  ProviderAccountOperation,
  ProviderAccountSignInFallback,
  ProviderAccountState,
  ProviderAccountSummary,
} from '@ptah-extension/shared';
import {
  ACCOUNT_NAME_SAVED,
  AccountDetailViewComponent,
  type AccountDetailTab,
  type AccountRenameRequest,
} from './account-detail-view.component';

const account = (
  state: ProviderAccountState = 'signed-in',
  overrides: Partial<ProviderAccountSummary> = {},
): ProviderAccountSummary => ({
  profileId: 'p-work-7c2a',
  label: 'Work',
  provider: 'claude',
  state,
  owner: 'verified',
  revision: 1,
  activeRunCount: 0,
  ...overrides,
});

const OTHER = account('signed-in', { profileId: 'p-team', label: 'Team plan' });

@Component({
  standalone: true,
  imports: [AccountDetailViewComponent],
  template: `
    @if (shown()) {
      <ptah-account-detail-view
        [account]="account()"
        [accounts]="accounts()"
        [operation]="operation()"
        [fallback]="fallback()"
        [busy]="busy()"
        [refusal]="refusal()"
        [feedback]="feedback()"
        [initialTab]="initialTab()"
        (back)="events.push('back')"
        (signIn)="onAction('sign-in', $event)"
        (cancelSignIn)="onAction('cancel-sign-in', $event)"
        (signOut)="onAction('sign-out', $event)"
        (checkStatus)="onAction('check-status', $event)"
        (rename)="onRename($event)"
        (remove)="onAction('remove', $event)"
      />
    }
    <button type="button" data-testid="elsewhere">Elsewhere</button>
  `,
})
class Host {
  readonly shown = signal(true);
  readonly account = signal(account('not-signed-in'));
  readonly accounts = signal<readonly ProviderAccountSummary[]>([]);
  readonly operation = signal<ProviderAccountOperation | null>(null);
  readonly fallback = signal<ProviderAccountSignInFallback | null>(null);
  readonly busy = signal<ProviderAccountActionKind | null>(null);
  readonly refusal = signal<ProviderAccountActionResult | null>(null);
  readonly feedback = signal<string | null>(null);
  readonly initialTab = signal<AccountDetailTab | null>(null);
  readonly events: string[] = [];
  readonly renames: AccountRenameRequest[] = [];
  /** Mirrors the parent: each action starts synchronously and marks the account busy. */
  startOnRequest = true;

  onAction(kind: string, profileId: string): void {
    this.events.push(`${kind}:${profileId}`);
    if (!this.startOnRequest) return;
    const busy: Record<string, ProviderAccountActionKind> = {
      'sign-in': 'sign-in',
      'cancel-sign-in': 'cancel-sign-in',
      'sign-out': 'sign-out',
      'check-status': 'sign-in',
      remove: 'remove',
    };
    this.busy.set(busy[kind] ?? null);
  }

  onRename(request: AccountRenameRequest): void {
    this.renames.push(request);
    if (this.startOnRequest) this.busy.set('rename');
  }
}

describe('AccountDetailViewComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let copy: jest.Mock<boolean, [string]>;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const btn = (id: string) => q<HTMLButtonElement>(id) as HTMLButtonElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const live = () => q('account-detail-live') as HTMLElement;
  const render = () => fixture.detectChanges();
  const openTab = (tab: AccountDetailTab) => {
    btn(`account-detail-tab-${tab}`).click();
    render();
  };

  beforeAll(() => {
    // jsdom has no <dialog> modal API.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  beforeEach(async () => {
    copy = jest.fn<boolean, [string]>(() => true);
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: Clipboard, useValue: { copy } }],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
  });

  describe('header and tabs', () => {
    it('focuses the account heading on open and shows dot + state text', () => {
      render();
      const heading = q('account-detail-heading') as HTMLElement;
      expect(heading.tagName).toBe('H3');
      expect(heading.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(heading);
      expect(q('account-detail-state')?.textContent).toContain('Not signed in');
    });

    it('emits back from All accounts', () => {
      render();
      btn('account-detail-back').click();
      expect(host.events).toEqual(['back']);
    });

    it('opens on Access unless signed in (D39.3)', () => {
      render();
      expect(q('account-detail-panel-access')).not.toBeNull();
      fixture.destroy();
      fixture = TestBed.createComponent(Host);
      host = fixture.componentInstance;
      host.account.set(account('signed-in'));
      render();
      expect(q('account-detail-panel-overview')).not.toBeNull();
    });

    it('honours an explicit initial tab', () => {
      host.initialTab.set('profile');
      render();
      expect(q('account-detail-panel-profile')).not.toBeNull();
    });

    it('is a roving tablist "Account sections" with arrows, Home and End', () => {
      render();
      const list = el().querySelector('[role="tablist"]') as HTMLElement;
      expect(list.getAttribute('aria-label')).toBe('Account sections');
      const tab = (id: AccountDetailTab) => btn(`account-detail-tab-${id}`);
      expect(tab('access').getAttribute('tabindex')).toBe('0');
      expect(tab('overview').getAttribute('tabindex')).toBe('-1');
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      render();
      expect(tab('profile').getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(tab('profile'));
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      render();
      expect(document.activeElement).toBe(tab('overview'));
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      render();
      expect(document.activeElement).toBe(tab('profile'));
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      render();
      expect(document.activeElement).toBe(tab('overview'));
      const panel = q('account-detail-panel-overview') as HTMLElement;
      expect(panel.getAttribute('aria-labelledby')).toBe('account-detail-tab-overview');
    });

    it('shows no profile id, owner, identity or "Set as default" on any tab', () => {
      host.account.set(account('signed-in', { activeRunCount: 2 }));
      render();
      for (const tab of ['overview', 'access', 'profile'] as const) {
        openTab(tab);
        expect(text()).not.toContain('p-work-7c2a');
        expect(text()).not.toMatch(/owner|Verified identity|Set as default|profile ID/i);
      }
    });
  });

  describe('overview', () => {
    it('shows the run binding and the resume notice only for bound runs on a non-signed-in account', () => {
      host.account.set(account('disconnected', { activeRunCount: 1 }));
      host.initialTab.set('overview');
      render();
      expect(q('account-detail-runs')?.textContent).toContain('1 active run uses this account.');
      expect(q('account-detail-resume-unavailable')).not.toBeNull();
      host.account.set(account('signed-in', { activeRunCount: 3 }));
      render();
      expect(q('account-detail-runs')?.textContent).toContain('3 active runs use this account.');
      expect(q('account-detail-resume-unavailable')).toBeNull();
      host.account.set(account('disconnected'));
      render();
      expect(q('account-detail-no-runs')?.textContent).toContain('No runs are bound to this account.');
      expect(q('account-detail-resume-unavailable')).toBeNull();
    });
  });

  describe('access', () => {
    it.each<[ProviderAccountState, string, string]>([
      ['not-signed-in', 'This account is not signed in yet.', 'Sign in'],
      ['signed-out', 'This account is not signed in yet.', 'Sign in'],
      ['cancelled', 'Sign-in was cancelled. The account is still saved but not signed in.', 'Sign in'],
      ['disconnected', 'This account was disconnected. Sign in again to use it.', 'Sign in'],
      ['failed', 'Sign-in did not finish', 'Try again'],
    ])('%s: copy, primary action and Check status', (state, copyText, primary) => {
      host.account.set(account(state));
      render();
      expect(q('account-detail-access-copy')?.textContent).toContain(copyText);
      expect(btn('account-detail-sign-in').textContent?.trim()).toBe(primary);
      expect(q('account-detail-check-status')).not.toBeNull();
      btn('account-detail-sign-in').click();
      expect(host.events).toEqual(['sign-in:p-work-7c2a']);
    });

    it('signed in: Sign out and Check status', () => {
      host.account.set(account('signed-in'));
      host.initialTab.set('access');
      render();
      expect(text()).toContain('Signed in. Credentials stay on this computer and are never shown here.');
      btn('account-detail-sign-out').click();
      expect(host.events).toEqual(['sign-out:p-work-7c2a']);
    });

    it('pending with a window: Finish sign-in copy, Cancel sign-in and Check status', () => {
      host.account.set(account('pending'));
      render();
      expect(q('account-detail-pending')?.textContent).toContain('Finish sign-in in the Claude window');
      expect(q('account-detail-fallback')).toBeNull();
      btn('account-detail-cancel-sign-in').click();
      expect(host.events).toEqual(['cancel-sign-in:p-work-7c2a']);
    });

    it('pending with a fallback for the sign-in operation: script as text, Copy script', () => {
      host.account.set(account('pending'));
      host.operation.set({ operationId: 'op-1', kind: 'sign-in' });
      host.fallback.set({ platform: 'posix', script: 'claude login <x>' });
      render();
      const script = q('account-detail-fallback-script') as HTMLElement;
      expect(script.textContent).toBe('claude login <x>');
      expect(script.getAttribute('tabindex')).toBe('0');
      expect(script.getAttribute('role')).toBe('region');
      expect(script.getAttribute('aria-label')).toBe('Sign-in script');
      expect(script.querySelector('x')).toBeNull();
      btn('account-detail-copy-script').click();
      render();
      expect(copy).toHaveBeenCalledWith('claude login <x>');
      expect(btn('account-detail-copy-script').textContent?.trim()).toBe('Copied');
      expect(q('account-detail-copy-status')?.textContent).toBe('Copied');
    });

    it('hides the fallback without a sign-in operation or once not pending', () => {
      host.account.set(account('pending'));
      host.fallback.set({ platform: 'posix', script: 'claude login' });
      render();
      expect(q('account-detail-fallback')).toBeNull();
      host.operation.set({ operationId: 'op-1', kind: 'sign-in' });
      host.account.set(account('signed-in'));
      render();
      expect(q('account-detail-fallback')).toBeNull();
    });

    it('shows the safe refusal as an alert and a neutral block for release-held', () => {
      host.refusal.set({ code: 'busy', summary: 'Sign-in could not start.' });
      render();
      expect(q('account-detail-refusal')?.getAttribute('role')).toBe('alert');
      expect(q('account-detail-refusal')?.textContent).toContain('Sign-in could not start.');
      host.refusal.set({ code: 'release-held', summary: 'Not on this host.' });
      render();
      expect(q('account-detail-held')?.textContent).toContain('The status is not available right now.');
      expect(q('account-detail-check-status')).not.toBeNull();
    });
  });

  describe('profile', () => {
    beforeEach(() => {
      host.accounts.set([account('signed-in'), OTHER]);
      host.initialTab.set('profile');
    });

    const input = () => q<HTMLInputElement>('account-detail-rename-input') as HTMLInputElement;
    const type = (value: string) => {
      input().value = value;
      input().dispatchEvent(new Event('input'));
      render();
    };

    it('Save name stays disabled until the name is valid and changed', () => {
      render();
      expect(btn('account-detail-rename-submit').disabled).toBe(true);
      type('team PLAN');
      expect(btn('account-detail-rename-submit').disabled).toBe(true);
      expect(q('account-detail-rename-error')?.getAttribute('role')).toBe('alert');
      expect(input().getAttribute('aria-invalid')).toBe('true');
      type('  Personal  ');
      expect(btn('account-detail-rename-submit').disabled).toBe(false);
      btn('account-detail-rename-submit').click();
      expect(host.renames).toEqual([{ profileId: 'p-work-7c2a', label: 'Personal' }]);
    });

    it('allows a case-only change of its own name', () => {
      render();
      type('WORK');
      expect(btn('account-detail-rename-submit').disabled).toBe(false);
    });

    it('locks name and removal while signing in', () => {
      host.account.set(account('pending'));
      render();
      expect(q('account-detail-locked')?.textContent).toContain('Name and removal are locked');
      expect(input().disabled).toBe(true);
      expect(btn('account-detail-remove').disabled).toBe(true);
    });

    it('announces Name saved. and resets the field to the committed name', () => {
      render();
      type('Personal');
      btn('account-detail-rename-submit').click();
      render();
      host.busy.set(null);
      host.account.set(account('signed-in', { label: 'Personal' }));
      host.feedback.set(ACCOUNT_NAME_SAVED);
      render();
      expect(live().textContent).toBe('Name saved.');
      expect(input().value).toBe('Personal');
      expect(q('account-detail-heading')?.textContent).toBe('Personal');
    });

    it('Remove opens a modal with Cancel focused; Cancel returns focus to Remove account', () => {
      render();
      btn('account-detail-remove').click();
      render();
      const dialog = el().querySelector('dialog') as HTMLDialogElement;
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(dialog.getAttribute('aria-labelledby')).toBe('account-detail-remove-title');
      expect(el().querySelector('#account-detail-remove-title')?.textContent).toContain('Remove Work?');
      expect(document.activeElement).toBe(btn('account-detail-remove-cancel'));
      btn('account-detail-remove-cancel').click();
      render();
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(document.activeElement).toBe(btn('account-detail-remove'));
      expect(host.events).toEqual([]);
    });

    it('Escape closes the modal and returns focus to Remove account', () => {
      render();
      btn('account-detail-remove').click();
      render();
      const dialog = el().querySelector('dialog') as HTMLDialogElement;
      dialog.dispatchEvent(new Event('cancel'));
      render();
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(document.activeElement).toBe(btn('account-detail-remove'));
      expect(host.events).toEqual([]);
    });

    it('Remove confirms with the profile id and assigns nothing locally (B-1)', () => {
      render();
      btn('account-detail-remove').click();
      render();
      btn('account-detail-remove-confirm').click();
      render();
      expect(host.events).toEqual(['remove:p-work-7c2a']);
      expect(document.activeElement).toBe(live());
      expect(live().textContent).toBe('Working…');
    });
  });

  describe('busy rule and B-2', () => {
    it('disables every action of the account while busy', () => {
      host.account.set(account('signed-in'));
      host.busy.set('sign-out');
      host.initialTab.set('access');
      render();
      expect(btn('account-detail-sign-out').disabled).toBe(true);
      expect(btn('account-detail-check-status').disabled).toBe(true);
      openTab('profile');
      expect(btn('account-detail-rename-submit').disabled).toBe(true);
      expect(btn('account-detail-remove').disabled).toBe(true);
      expect(live().textContent).toBe('Working…');
    });

    it('returns focus to the originating control when focus is still on the live status (B-2)', () => {
      render();
      btn('account-detail-check-status').focus();
      btn('account-detail-check-status').click();
      render();
      expect(document.activeElement).toBe(live());
      host.busy.set(null);
      render();
      expect(document.activeElement).toBe(btn('account-detail-check-status'));
    });

    it('returns focus to the replacement control when the state replaced the origin (B-2)', () => {
      render();
      btn('account-detail-sign-in').click();
      render();
      host.busy.set(null);
      host.account.set(account('pending'));
      render();
      expect(document.activeElement).toBe(btn('account-detail-cancel-sign-in'));
    });

    it('keeps focus where the user moved it and announces the result (B-2)', () => {
      render();
      btn('account-detail-sign-in').click();
      render();
      const elsewhere = q<HTMLButtonElement>('elsewhere') as HTMLButtonElement;
      elsewhere.focus();
      host.busy.set(null);
      host.feedback.set('Signed in.');
      host.account.set(account('signed-in'));
      render();
      expect(document.activeElement).toBe(elsewhere);
      expect(live().getAttribute('aria-live')).toBe('polite');
      expect(live().textContent).toBe('Signed in.');
    });

    it('does not move focus once the view is gone (B-2)', () => {
      render();
      btn('account-detail-sign-in').click();
      render();
      host.shown.set(false);
      host.busy.set(null);
      render();
      expect(q('account-detail')).toBeNull();
      expect(document.activeElement).not.toBe(q('account-detail-sign-in'));
    });
  });
});
