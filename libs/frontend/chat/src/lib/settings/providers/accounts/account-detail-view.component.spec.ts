import { Clipboard } from '@angular/cdk/clipboard';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ProviderAccountActionKind } from '@ptah-extension/core';
import type {
  ProviderAccountOperation,
  ProviderAccountSignInFallback,
  ProviderAccountState,
  ProviderAccountSummary,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';
import { ACCOUNT_COPY } from './account-presentation';
import { AccountDetailViewComponent, type AccountRenameRequest } from './account-detail-view.component';

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
const SIGN_IN_OP = { kind: 'sign-in', operationId: 'op-1' } as unknown as ProviderAccountOperation;
const SCRIPT = { platform: 'posix', script: 'claude login --profile work' } as ProviderAccountSignInFallback;

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
        (back)="events.push('back')"
        (signIn)="events.push('sign-in:' + $event)"
        (cancelSignIn)="events.push('cancel-sign-in:' + $event)"
        (signOut)="events.push('sign-out:' + $event)"
        (checkStatus)="events.push('check-status:' + $event)"
        (rename)="renames.push($event)"
        (remove)="events.push('remove:' + $event)"
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
  readonly events: string[] = [];
  readonly renames: AccountRenameRequest[] = [];
}

describe('AccountDetailViewComponent (flat panel)', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let copy: jest.Mock<boolean, [string]>;
  let announce: jest.Mock<void, [string, 'status' | 'alert']>;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const btn = (id: string) => q<HTMLButtonElement>(id) as HTMLButtonElement;
  const nameInput = () => q<HTMLInputElement>('account-detail-rename-input') as HTMLInputElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const render = () => fixture.detectChanges();
  const type = (value: string) => {
    nameInput().value = value;
    nameInput().dispatchEvent(new Event('input'));
    render();
  };
  const setAccount = (summary: ProviderAccountSummary) => {
    host.account.set(summary);
    render();
  };
  const openTerminal = () => {
    host.account.set(account('pending'));
    host.operation.set(SIGN_IN_OP);
    host.fallback.set(SCRIPT);
    render();
    btn('account-detail-terminal-toggle').click();
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
    announce = jest.fn<void, [string, 'status' | 'alert']>();
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: Clipboard, useValue: { copy } },
        { provide: SettingsSaveFeedbackService, useValue: { announce } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
  });

  describe('header', () => {
    it('focuses the h3 heading on open and shows avatar, dot and state word', () => {
      render();
      const heading = q('account-detail-heading') as HTMLElement;
      expect(heading.tagName).toBe('H3');
      expect(heading.getAttribute('tabindex')).toBe('-1');
      expect(heading.getAttribute('title')).toBe('Work');
      expect(document.activeElement).toBe(heading);
      expect(q('account-detail-state')?.textContent?.trim()).toBe('Not signed in');
      expect(q('account-detail-state')?.querySelector('.rounded-full.bg-state-idle')).not.toBeNull();
      expect(q('account-detail')?.className).toContain('space-y-6');
    });

    it('emits back from "← Accounts"', () => {
      render();
      expect(btn('account-detail-back').textContent?.replace(/\s+/g, ' ').trim()).toBe('← Accounts');
      btn('account-detail-back').click();
      expect(host.events).toEqual(['back']);
    });

    it('shows "Waiting for Claude window" with a spinner while sign-in is pending', () => {
      setAccount(account('pending'));
      expect(q('account-detail-state')?.textContent?.trim()).toBe('Waiting for Claude window');
      expect(q('account-detail-state')?.querySelector('.loading-spinner')).not.toBeNull();
    });

    it('marks failed and disconnected with the attention bar', () => {
      setAccount(account('failed'));
      expect(q('account-detail-state')?.textContent?.trim()).toBe('Sign-in failed');
      expect(el().querySelector('.border-l-state-err')).not.toBeNull();
      setAccount(account('signed-in'));
      expect(el().querySelector('.border-l-state-err')).toBeNull();
    });

    it('shows the running badge only for bound runs', () => {
      setAccount(account('signed-in'));
      expect(q('account-detail-runs')).toBeNull();
      setAccount(account('signed-in', { activeRunCount: 2 }));
      expect(q('account-detail-runs')?.textContent?.trim()).toBe('2 running');
      expect(q('account-detail-resume-unavailable')).toBeNull();
    });

    it('shows "Cannot resume" with the full sentence as title and sr-only text when not signed in with bound runs', () => {
      setAccount(account('signed-out', { activeRunCount: 1 }));
      const badge = q('account-detail-resume-unavailable') as HTMLElement;
      expect(badge.textContent).toContain('Cannot resume');
      expect(badge.getAttribute('title')).toBe(ACCOUNT_COPY.resumeUnavailable);
      expect(badge.querySelector('.sr-only')?.textContent).toBe(ACCOUNT_COPY.resumeUnavailable);
    });

    it('is one flat panel: no tabs, live line, helper sentences, profile id or "Set as default"', () => {
      for (const state of ['signed-in', 'pending', 'failed', 'not-signed-in'] as const) {
        setAccount(account(state));
        for (const id of ['tablist', 'live', 'access-copy', 'no-runs', 'held', 'refusal', 'copy-status', 'overview-state', 'remove-copy', 'pending']) {
          expect(q(`account-detail-${id}`)).toBeNull();
        }
        expect(el().querySelectorAll('[role="tab"], [role="tabpanel"], [aria-live]')).toHaveLength(0);
        expect(text()).not.toMatch(/p-work-7c2a|verified|Set as default|Credentials|No runs are bound|Only you see|Waiting for you/);
      }
    });
  });

  describe('actions', () => {
    it('offers Sign in, or Try again after a failure, plus Check status', () => {
      setAccount(account('not-signed-in'));
      expect(btn('account-detail-sign-in').textContent?.trim()).toBe('Sign in');
      btn('account-detail-sign-in').click();
      btn('account-detail-check-status').click();
      expect(host.events).toEqual(['sign-in:p-work-7c2a', 'check-status:p-work-7c2a']);
      setAccount(account('failed'));
      expect(btn('account-detail-sign-in').textContent?.trim()).toBe('Try again');
    });

    it('signed in: Sign out; pending: Cancel sign-in', () => {
      setAccount(account('signed-in'));
      expect(q('account-detail-sign-in')).toBeNull();
      btn('account-detail-sign-out').click();
      setAccount(account('pending'));
      btn('account-detail-cancel-sign-in').click();
      expect(host.events).toEqual(['sign-out:p-work-7c2a', 'cancel-sign-in:p-work-7c2a']);
    });

    it('busy: every action is aria-disabled, stays focusable and emits nothing', () => {
      setAccount(account('signed-in'));
      host.busy.set('sign-out');
      render();
      for (const id of ['account-detail-sign-out', 'account-detail-check-status', 'account-detail-remove']) {
        const control = btn(id);
        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(control.disabled).toBe(false);
        control.focus();
        expect(document.activeElement).toBe(control);
        control.click();
      }
      expect(nameInput().readOnly).toBe(true);
      expect(host.events).toEqual([]);
      expect(el().querySelector('dialog')?.hasAttribute('open')).toBe(false);
    });
  });

  describe('Use terminal', () => {
    it('appears only for a pending sign-in with a script and toggles the script block', () => {
      setAccount(account('pending'));
      expect(q('account-detail-terminal-toggle')).toBeNull();
      host.operation.set(SIGN_IN_OP);
      host.fallback.set(SCRIPT);
      render();
      const toggle = btn('account-detail-terminal-toggle');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(q('account-detail-fallback')).toBeNull();
      toggle.click();
      render();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const pre = q('account-detail-fallback-script') as HTMLElement;
      expect(pre.tagName).toBe('PRE');
      expect(pre.getAttribute('tabindex')).toBe('0');
      expect(pre.getAttribute('aria-label')).toBe('Sign-in script');
      expect(pre.textContent).toBe(SCRIPT.script);
      expect(btn('account-detail-copy-script').getAttribute('aria-label')).toBe('Copy script');
      toggle.click();
      render();
      expect(q('account-detail-fallback')).toBeNull();
    });

    it('is hidden without a sign-in operation or once the account is not pending', () => {
      host.account.set(account('pending'));
      host.operation.set({ kind: 'sign-out', operationId: 'op-2' } as unknown as ProviderAccountOperation);
      host.fallback.set(SCRIPT);
      render();
      expect(q('account-detail-terminal-toggle')).toBeNull();
      openTerminal();
      expect(q('account-detail-fallback')).not.toBeNull();
      setAccount(account('signed-in'));
      expect(q('account-detail-terminal-toggle')).toBeNull();
      expect(q('account-detail-fallback')).toBeNull();
    });

    it('announces the copy result as a toast ("Copied" / alert "Could not copy")', () => {
      openTerminal();
      btn('account-detail-copy-script').click();
      expect(copy).toHaveBeenCalledWith(SCRIPT.script);
      expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.copied, 'status');
      copy.mockReturnValue(false);
      btn('account-detail-copy-script').click();
      expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.copyFailed, 'alert');
    });
  });

  describe('rename', () => {
    beforeEach(() => {
      host.account.set(account('signed-in'));
      host.accounts.set([account('signed-in'), OTHER]);
    });

    it('shows Save only once the name is edited', () => {
      render();
      expect(nameInput().value).toBe('Work');
      expect(el().querySelector('label[for="account-detail-name"]')?.textContent?.trim()).toBe('Name');
      expect(q('account-detail-rename-submit')).toBeNull();
      type('  Work  ');
      expect(q('account-detail-rename-submit')).toBeNull();
      type('   ');
      expect(q('account-detail-rename-submit')).toBeNull();
      type('Personal');
      expect(btn('account-detail-rename-submit').textContent?.trim()).toBe('Save');
    });

    it('emits the trimmed name, allowing a case-only change of its own name', () => {
      render();
      type(' work ');
      btn('account-detail-rename-submit').click();
      expect(host.renames).toEqual([{ profileId: 'p-work-7c2a', label: 'work' }]);
      expect(announce).not.toHaveBeenCalled();
    });

    it('announces a duplicate as the alert "That name is already used." and emits nothing', () => {
      render();
      type('team PLAN');
      btn('account-detail-rename-submit').click();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.nameTaken, 'alert');
      expect(host.renames).toEqual([]);
      expect(q('account-detail-rename-error')).toBeNull();
    });

    it('resets the field to the committed name after a rename lands', () => {
      render();
      type('Personal');
      setAccount(account('signed-in', { label: 'Personal', revision: 2 }));
      expect(nameInput().value).toBe('Personal');
      expect(q('account-detail-rename-submit')).toBeNull();
      expect(q('account-detail-heading')?.textContent).toBe('Personal');
    });
  });

  describe('pending lock', () => {
    it('makes Name readonly and Remove aria-disabled, both focusable and described by the sr-only lock reason', () => {
      setAccount(account('pending'));
      const input = nameInput();
      const remove = btn('account-detail-remove');
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(false);
      expect(input.getAttribute('aria-disabled')).toBe('true');
      expect(remove.getAttribute('aria-disabled')).toBe('true');
      expect(remove.disabled).toBe(false);
      const reasonId = input.getAttribute('aria-describedby') as string;
      expect(reasonId).toBeTruthy();
      expect(remove.getAttribute('aria-describedby')).toBe(reasonId);
      const reason = el().querySelector(`#${reasonId}`) as HTMLElement;
      expect(reason.classList.contains('sr-only')).toBe(true);
      expect(reason.textContent).toBe(ACCOUNT_COPY.signInLocked);
      expect(q('account-detail-locked')?.getAttribute('title')).toBe(ACCOUNT_COPY.signInLocked);
      remove.click();
      render();
      expect(el().querySelector('dialog')?.hasAttribute('open')).toBe(false);
    });

    it('drops the lock when the sign-in ends', () => {
      setAccount(account('pending'));
      setAccount(account('signed-in'));
      expect(nameInput().readOnly).toBe(false);
      expect(nameInput().getAttribute('aria-describedby')).toBeNull();
      expect(btn('account-detail-remove').getAttribute('aria-disabled')).toBeNull();
      expect(q('account-detail-locked')).toBeNull();
    });
  });

  describe('remove dialog', () => {
    const openDialog = () => {
      render();
      btn('account-detail-remove').click();
      render();
      return el().querySelector('dialog') as HTMLDialogElement;
    };

    it('opens "Remove {name}?" with Cancel focused; Cancel returns focus to Remove account', () => {
      const dialog = openDialog();
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(dialog.getAttribute('aria-labelledby')).toBe('account-detail-remove-title');
      expect(el().querySelector('#account-detail-remove-title')?.textContent).toBe('Remove Work?');
      expect(document.activeElement).toBe(btn('account-detail-remove-cancel'));
      btn('account-detail-remove-cancel').click();
      render();
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(document.activeElement).toBe(btn('account-detail-remove'));
      expect(host.events).toEqual([]);
    });

    it('Escape closes only the dialog and returns focus to Remove account', () => {
      const dialog = openDialog();
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      const outer = jest.fn();
      el().addEventListener('keydown', outer);
      dialog.dispatchEvent(escape);
      dialog.dispatchEvent(new Event('cancel'));
      render();
      expect(outer).not.toHaveBeenCalled();
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(document.activeElement).toBe(btn('account-detail-remove'));
      expect(host.events).toEqual([]);
    });

    it('Remove emits the profile id once and assigns nothing locally (B-1)', () => {
      const dialog = openDialog();
      btn('account-detail-remove-confirm').click();
      render();
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(host.events).toEqual(['remove:p-work-7c2a']);
      expect(announce).not.toHaveBeenCalled();
    });
  });

  it('a different account resets the draft, closes the disclosure and focuses its heading', () => {
    openTerminal();
    type('Draft');
    btn('elsewhere').focus();
    host.operation.set(null);
    host.fallback.set(null);
    setAccount(OTHER);
    expect(nameInput().value).toBe('Team plan');
    expect(q('account-detail-fallback')).toBeNull();
    expect(document.activeElement).toBe(q('account-detail-heading'));
  });

  describe('a push that ends the pending sign-in (B-2)', () => {
    const endSignIn = (state: ProviderAccountState) => {
      host.operation.set(null);
      host.fallback.set(null);
      setAccount(account(state));
      render();
    };

    it.each(['signed-in', 'failed'] as const)('focus on Cancel sign-in moves to the heading (%s)', (state) => {
      setAccount(account('pending'));
      btn('account-detail-cancel-sign-in').focus();
      endSignIn(state);
      expect(q('account-detail-cancel-sign-in')).toBeNull();
      expect(document.activeElement).toBe(q('account-detail-heading'));
    });

    it.each(['account-detail-terminal-toggle', 'account-detail-fallback-script', 'account-detail-copy-script'])(
      'focus on the fallback control %s moves to the heading',
      (id) => {
        openTerminal();
        q(id)?.focus();
        expect(document.activeElement).toBe(q(id));
        endSignIn('signed-in');
        expect(q(id)).toBeNull();
        expect(document.activeElement).toBe(q('account-detail-heading'));
      },
    );

    it('focus outside the pending controls stays where it is', () => {
      setAccount(account('pending'));
      btn('account-detail-cancel-sign-in').focus();
      btn('elsewhere').focus();
      endSignIn('signed-in');
      expect(document.activeElement).toBe(btn('elsewhere'));
    });

    it('focus on a control that stays (Check status) is left there', () => {
      setAccount(account('pending'));
      btn('account-detail-check-status').focus();
      endSignIn('failed');
      expect(document.activeElement).toBe(btn('account-detail-check-status'));
    });

    it('moves nothing once the panel is gone', () => {
      setAccount(account('pending'));
      btn('account-detail-cancel-sign-in').focus();
      host.account.set(account('signed-in'));
      host.shown.set(false);
      render();
      render();
      expect(q('account-detail-heading')).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });
  });
});
