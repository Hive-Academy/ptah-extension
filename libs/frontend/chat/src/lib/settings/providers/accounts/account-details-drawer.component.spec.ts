import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ProviderAccountActionKind } from '@ptah-extension/core';
import type {
  ProviderAccountActionResult,
  ProviderAccountState,
  ProviderAccountSummary,
} from '@ptah-extension/shared';
import {
  ACCOUNT_DEFAULT_TOAST,
  ACCOUNT_REMOVE_CONFIRMATION,
  ACCOUNT_RENAME_HINT,
  AccountDetailsDrawerComponent,
  type AccountRenameIntent,
} from './account-details-drawer.component';

const PROFILE_ID = 'claude-work-7a1c';

function summary(overrides: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary {
  return {
    profileId: PROFILE_ID,
    label: 'Work Claude',
    provider: 'claude',
    state: 'not-signed-in',
    owner: 'unknown',
    revision: 3,
    activeRunCount: 0,
    ...overrides,
  };
}

@Component({
  standalone: true,
  imports: [AccountDetailsDrawerComponent],
  template: `
    <button type="button" data-testid="opener" (click)="open.set(true)">Manage</button>
    <ptah-account-details-drawer
      [open]="open()"
      [account]="account()"
      [pending]="pending()"
      [result]="result()"
      [saved]="saved()"
      (refreshStatus)="events.push('status:' + $event)"
      (signIn)="events.push('sign-in:' + $event)"
      (cancelSignIn)="events.push('cancel:' + $event)"
      (signOut)="events.push('sign-out:' + $event)"
      (rename)="renames.push($event)"
      (setDefault)="events.push('default:' + $event)"
      (remove)="events.push('remove:' + $event)"
      (closed)="open.set(false); events.push('closed')"
    />
  `,
})
class Host {
  readonly open = signal(false);
  readonly account = signal<ProviderAccountSummary | null>(summary());
  readonly pending = signal<ProviderAccountActionKind | null>(null);
  readonly result = signal<ProviderAccountActionResult | null>(null);
  readonly saved = signal<ProviderAccountActionKind | null>(null);
  readonly events: string[] = [];
  readonly renames: AccountRenameIntent[] = [];
}

describe('AccountDetailsDrawerComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const button = (id: string) => q<HTMLButtonElement>(id) as HTMLButtonElement;
  const panel = () => q('native-drawer-panel') as HTMLElement;
  const flushMicrotasks = (): Promise<void> => Promise.resolve();

  async function openFromOpener(): Promise<HTMLButtonElement> {
    const opener = button('opener');
    opener.focus();
    opener.click();
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
    return opener;
  }
  function tab(id: 'overview' | 'access' | 'profile'): void {
    button(`account-tab-${id}`).click();
    fixture.detectChanges();
  }
  function set(update: () => void): void {
    update();
    fixture.detectChanges();
  }
  function accessButtons(): string[] {
    return Array.from(
      q('account-panel-access')?.querySelectorAll('button') ?? [],
    ).map((b) => b.textContent?.trim() ?? '');
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('reuses the native drawer with the accessible name "Account details for [label]"', async () => {
    expect(panel()).toBeNull();
    await openFromOpener();
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(panel().getAttribute('aria-label')).toBe('Account details for Work Claude');
    expect(q('account-drawer-title')?.textContent?.trim()).toBe('Account details for Work Claude');
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('does not render without an account', async () => {
    set(() => host.account.set(null));
    await openFromOpener();
    expect(panel()).toBeNull();
  });

  it('offers Overview, Access and Profile tabs with keyboard navigation', async () => {
    await openFromOpener();
    const tabs = Array.from(el().querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Overview', 'Access', 'Profile']);
    expect(button('account-tab-overview').getAttribute('aria-selected')).toBe('true');
    expect(button('account-tab-access').getAttribute('tabindex')).toBe('-1');

    button('account-tab-overview').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    expect(button('account-tab-access').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(button('account-tab-access'));
    expect(q('account-panel-access')?.getAttribute('aria-labelledby')).toBe('account-tab-access');

    button('account-tab-access').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    fixture.detectChanges();
    expect(q('account-panel-profile')).not.toBeNull();
  });

  it('excludes the hidden tab panels from the focus order', async () => {
    await openFromOpener();
    expect(el().querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    expect(q('account-panel-access')).toBeNull();
    expect(q('account-panel-profile')).toBeNull();
    const focusable = Array.from(
      panel().querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
    ).map((e) => e.dataset['testid']);
    expect(focusable).not.toContain('account-sign-in');
    expect(focusable).not.toContain('account-rename-input');
    expect(focusable).not.toContain('account-remove');
  });

  it('returns focus to the opener on close', async () => {
    const opener = await openFromOpener();
    expect(document.activeElement).not.toBe(opener);
    button('native-drawer-close').click();
    fixture.detectChanges();
    expect(host.open()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('requests close on Escape', async () => {
    await openFromOpener();
    panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.events).toEqual(['closed']);
  });

  it('closing during a pending sign-in does not cancel it', async () => {
    set(() => host.account.set(summary({ state: 'pending' })));
    await openFromOpener();
    tab('access');
    panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await openFromOpener();
    button('native-drawer-close').click();
    fixture.detectChanges();
    expect(host.events).toEqual(['closed', 'closed']);
    expect(host.events.some((e) => e.startsWith('cancel:'))).toBe(false);
  });

  const cases: readonly [ProviderAccountState, string, string[], string | null][] = [
    ['not-signed-in', 'Not signed in', ['Sign in', 'Refresh status'], 'sign-in'],
    ['pending', 'Signing in', ['Cancel sign-in'], 'cancel'],
    ['cancelled', 'Sign-in cancelled', ['Sign in again', 'Refresh status'], 'sign-in'],
    ['failed', 'Sign-in failed', ['Try again', 'Refresh status'], 'sign-in'],
    ['disconnected', 'Disconnected', ['Sign in again', 'Refresh status'], 'sign-in'],
    ['signed-in', 'Signed in', ['Sign out', 'Refresh status'], 'sign-out'],
    ['signed-out', 'Signed out', ['Sign in again', 'Refresh status'], 'sign-in'],
  ];
  it.each(cases)('state %s shows "%s" with its design controls', async (state, heading, controls, intent) => {
    set(() => host.account.set(summary({ state })));
    await openFromOpener();
    expect(q('account-state')?.textContent?.trim()).toBe(heading);
    tab('access');
    expect(q('account-access-heading')?.textContent?.trim()).toBe(heading);
    expect(accessButtons()).toEqual(controls);
    (q('account-panel-access')?.querySelector('button') as HTMLButtonElement).click();
    expect(host.events).toEqual([`${intent}:${PROFILE_ID}`]);
  });

  it('pending shows Cancel only and locks profile changes', async () => {
    set(() => host.account.set(summary({ state: 'pending' })));
    await openFromOpener();
    tab('access');
    expect(accessButtons()).toEqual(['Cancel sign-in']);
    expect(q('account-sign-in')).toBeNull();
    expect(q('account-sign-out')).toBeNull();
    expect(q('account-refresh-status')).toBeNull();
    tab('profile');
    expect(q('account-profile-locked')?.textContent?.trim()).toBe(
      'Finish or cancel sign-in before changing this profile.',
    );
    expect(button('account-set-default').disabled).toBe(true);
    expect(button('account-remove').disabled).toBe(true);
    expect(q<HTMLInputElement>('account-rename-input')?.disabled).toBe(true);
  });

  it('emits a status intent from Refresh status', async () => {
    await openFromOpener();
    tab('access');
    button('account-refresh-status').click();
    expect(host.events).toEqual([`status:${PROFILE_ID}`]);
  });

  it('keeps actions visible when release-held and explains the safe held outcome', async () => {
    set(() =>
      host.result.set({
        code: 'release-held',
        summary: 'Named account commands are awaiting release authorization.',
      }),
    );
    await openFromOpener();
    tab('access');
    const held = q('account-held');
    expect(held?.getAttribute('role')).toBe('alert');
    expect(held?.textContent).toContain('Held for release authorization');
    expect(held?.textContent).toContain('Named account commands are awaiting release authorization.');
    expect(held?.textContent).toContain(
      'Nothing changed on this profile. Existing provider settings stay available.',
    );
    expect(button('account-sign-in').disabled).toBe(false);
    button('account-sign-in').click();
    expect(host.events).toEqual([`sign-in:${PROFILE_ID}`]);
  });

  it('busy: an in-flight action disables every action and announces it', async () => {
    set(() => {
      host.account.set(summary({ state: 'signed-in' }));
      host.pending.set('sign-out');
    });
    await openFromOpener();
    expect(q('account-drawer-status')?.textContent?.trim()).toBe('Signing out…');
    tab('access');
    expect(button('account-sign-out').disabled).toBe(true);
    expect(button('account-refresh-status').disabled).toBe(true);
    tab('profile');
    expect(button('account-set-default').disabled).toBe(true);
    expect(button('account-remove').disabled).toBe(true);
  });

  it('shows a busy refusal only by its safe sentence, otherwise fixed copy', async () => {
    set(() => host.result.set({ code: 'busy', summary: 'Another operation is using this profile.' }));
    await openFromOpener();
    expect(q('account-error')?.textContent?.trim()).toBe('Another operation is using this profile.');
    set(() => host.result.set({ code: 'conflict', summary: 'C:\\Users\\me\\.claude token=abc' }));
    expect(q('account-error')?.textContent?.trim()).toBe(
      'This action did not complete. Refresh and try again.',
    );
  });

  it('never shows a path, email, organization or token value', async () => {
    set(() => host.account.set(summary({ state: 'signed-in', owner: 'verified', activeRunCount: 2 })));
    await openFromOpener();
    for (const id of ['overview', 'access', 'profile'] as const) {
      tab(id);
      const text = panel().textContent ?? '';
      expect(text).not.toMatch(/@|[A-Za-z]:\\|\/home\/|\/Users\/|\.claude\b|sk-ant/);
    }
    tab('overview');
    expect(q('account-owner')?.textContent?.trim()).toBe('Usage owner: Verified identity');
    expect(q('account-profile-id')?.textContent?.trim()).toBe(PROFILE_ID);
    expect(q('account-run-binding')?.textContent).toContain('Run binding — 2 current runs');
  });

  it('shows Unknown owner and no run binding when none is bound', async () => {
    await openFromOpener();
    expect(q('account-owner')?.textContent?.trim()).toBe('Usage owner: Unknown owner');
    expect(q('account-run-binding')).toBeNull();
    expect(q('account-no-runs')?.textContent?.trim()).toBe('No current runs are bound to this profile.');
  });

  it('an unavailable resume shows no recovery chooser', async () => {
    set(() => host.account.set(summary({ state: 'disconnected', activeRunCount: 1 })));
    await openFromOpener();
    const resume = q('account-resume-unavailable');
    expect(resume?.textContent).toContain('Can’t resume this run');
    expect(resume?.textContent).toContain(
      'The profile originally used by this run is unavailable or no longer proves the same identity.',
    );
    expect(resume?.querySelectorAll('button, select, input')).toHaveLength(0);
    expect(
      panel().querySelectorAll('select, [role="listbox"], [role="radio"], input[type="radio"]'),
    ).toHaveLength(0);
    expect(panel().textContent).not.toContain('Use existing default');
  });

  it('signed-in bound runs show no unavailable-resume notice', async () => {
    set(() => host.account.set(summary({ state: 'signed-in', activeRunCount: 1 })));
    await openFromOpener();
    expect(q('account-resume-unavailable')).toBeNull();
  });

  it('Set as default emits the intent and shows the exact default toast once committed', async () => {
    await openFromOpener();
    tab('profile');
    expect(button('account-set-default').className).toContain('btn-outline');
    button('account-set-default').click();
    expect(host.events).toEqual([`default:${PROFILE_ID}`]);
    set(() => host.saved.set('default'));
    const status = q('account-drawer-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent?.trim()).toBe(
      'Default changed for future unbound starts. Existing runs are unchanged.',
    );
    expect(ACCOUNT_DEFAULT_TOAST).toBe(
      'Default changed for future unbound starts. Existing runs are unchanged.',
    );
  });

  it('Remove asks for the metadata-only confirmation before emitting', async () => {
    await openFromOpener();
    tab('profile');
    button('account-remove').click();
    fixture.detectChanges();
    expect(host.events).toEqual([]);
    expect(q('account-remove-copy')?.textContent?.trim()).toBe(
      'This removes only local profile metadata. It does not switch, transfer, or delete a running conversation. A run bound to this profile cannot resume until its binding is available.',
    );
    expect(ACCOUNT_REMOVE_CONFIRMATION).toBe(q('account-remove-copy')?.textContent?.trim());

    button('account-remove-cancel').click();
    fixture.detectChanges();
    expect(q('account-remove-confirm')).toBeNull();
    expect(host.events).toEqual([]);

    button('account-remove').click();
    fixture.detectChanges();
    button('account-remove-confirm-button').click();
    fixture.detectChanges();
    expect(host.events).toEqual([`remove:${PROFILE_ID}`]);
  });

  it('renames the local label only, with the design hint', async () => {
    await openFromOpener();
    tab('profile');
    expect(q('account-rename-form')?.textContent).toContain(ACCOUNT_RENAME_HINT);
    expect(ACCOUNT_RENAME_HINT).toBe(
      'Changes the local label only. Existing runs keep the profile ID they started with.',
    );
    const field = q<HTMLInputElement>('account-rename-input') as HTMLInputElement;
    expect(field.value).toBe('Work Claude');
    expect(button('account-rename-submit').disabled).toBe(true);

    field.value = '  Personal Claude  ';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    q<HTMLFormElement>('account-rename-form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    expect(host.renames).toEqual([{ profileId: PROFILE_ID, label: 'Personal Claude' }]);

    set(() => {
      host.account.set(summary({ label: 'Personal Claude', revision: 4 }));
      host.saved.set('rename');
    });
    expect(q('account-drawer-status')?.textContent?.trim()).toBe('Local label saved.');
    expect(panel().getAttribute('aria-label')).toBe('Account details for Personal Claude');
  });

  it('resets to Overview on reopen', async () => {
    await openFromOpener();
    tab('profile');
    button('native-drawer-close').click();
    fixture.detectChanges();
    await openFromOpener();
    expect(q('account-panel-overview')).not.toBeNull();
  });
});
