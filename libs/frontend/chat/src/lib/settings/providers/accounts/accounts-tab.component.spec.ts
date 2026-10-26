import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ClaudeAmbientStatusService,
  ProviderAccountsStateService,
  type ClaudeAmbientStatusView,
  type ProviderAccountActionOutcome,
  type ProviderAccountsView,
} from '@ptah-extension/core';
import type {
  ProviderAccountSelection,
  ProviderAccountState,
  ProviderAccountSummary,
  ProviderAccountsSnapshot,
} from '@ptah-extension/shared';
import { AccountUseForComponent } from './account-use-for.component';
import { AccountDetailViewComponent } from './account-detail-view.component';
import { ACCOUNT_ADDED_TOAST, AccountsTabComponent, SELECTION_REFUSED_FALLBACK } from './accounts-tab.component';

const account = (profileId: string, label: string, state: ProviderAccountState = 'signed-in'): ProviderAccountSummary => ({
  profileId, label, provider: 'claude', state, owner: 'unknown', revision: 1, activeRunCount: 0,
});
const snapshot = (
  accounts: readonly ProviderAccountSummary[],
  main: ProviderAccountSelection = { kind: 'omitted' },
  lane: ProviderAccountSelection = { kind: 'omitted' },
): ProviderAccountsSnapshot => ({
  provider: 'claude', workspaceRoot: 'workspace', revision: 3, accounts,
  selections: { main: { scope: 'main', selection: main, revision: 1 }, lane: { scope: 'lane', selection: lane, revision: 1 } },
});
const ready = (snap: ProviderAccountsSnapshot | null): ProviderAccountsView => ({ status: 'ready', snapshot: snap, stale: false, error: null });

const WORK = account('p-work-0001', 'Work');
const TEAM = account('p-team-0002', 'Team plan', 'not-signed-in');
const CONNECTED: ClaudeAmbientStatusView = {
  status: 'ready', result: { state: 'connected', checkedAt: '2026-10-26T10:00:00.000Z' }, localFailure: false,
};

interface Deferred<T> { readonly promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

class FakeAccounts {
  readonly view = signal<ProviderAccountsView>(ready(snapshot([WORK, TEAM])));
  readonly ops = signal({});
  readonly fbs = signal({});
  readonly pending = deferred<ProviderAccountActionOutcome>();
  state = () => this.view;
  operations = () => this.ops;
  fallbacks = () => this.fbs;
  open = jest.fn(async () => undefined);
  refresh = jest.fn(async () => undefined);
  refreshAccountStatus = jest.fn(async () => undefined);
  setSelection = jest.fn(() => this.pending.promise);
  addAccount = jest.fn(() => this.pending.promise);
  renameAccount = jest.fn(() => this.pending.promise);
  removeAccount = jest.fn(() => this.pending.promise);
  startSignIn = jest.fn(() => this.pending.promise);
  signOut = jest.fn(() => this.pending.promise);
  cancelSignIn = jest.fn(() => this.pending.promise);
}

class FakeAmbient {
  readonly state = signal<ClaudeAmbientStatusView>(CONNECTED);
  readonly view = this.state.asReadonly();
  read = jest.fn(async () => undefined);
}

describe('AccountsTabComponent', () => {
  beforeAll(() => {
    // jsdom has no modal dialog API; the detail's remove dialog (ptah-native-modal) calls it.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  });

  let fixture: ComponentFixture<AccountsTabComponent>;
  let accounts: FakeAccounts;
  let ambient: FakeAmbient;

  beforeEach(() => {
    accounts = new FakeAccounts();
    ambient = new FakeAmbient();
    TestBed.configureTestingModule({
      imports: [AccountsTabComponent],
      providers: [
        { provide: ProviderAccountsStateService, useValue: accounts },
        { provide: ClaudeAmbientStatusService, useValue: ambient },
      ],
    });
    fixture = TestBed.createComponent(AccountsTabComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    TestBed.resetTestingModule();
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string) => root().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (id: string) => Array.from(root().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const selects = () => Array.from(root().querySelectorAll<HTMLSelectElement>('select'));
  const useFor = () => fixture.debugElement.query(By.directive(AccountUseForComponent)).componentInstance as AccountUseForComponent;
  const detail = () => fixture.debugElement.query(By.directive(AccountDetailViewComponent))?.componentInstance as
    AccountDetailViewComponent | undefined;
  const pendingScopes = () => fixture.componentInstance['pendingScopes']();
  const busy = () => fixture.componentInstance['busy']();
  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      fixture.detectChanges();
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }
  /** The real form flow: type, then press "Add account" (the form focuses its own status first). */
  async function submitAdd(label: string): Promise<void> {
    byTestId('accounts-tab-add')?.click();
    await settle();
    const input = root().querySelector<HTMLInputElement>('ptah-add-account-form input');
    if (!input) throw new Error('add form not open');
    input.value = label;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    Array.from(root().querySelectorAll<HTMLButtonElement>('ptah-add-account-form button'))
      .find((button) => button.textContent?.trim() === 'Add account')?.click();
    fixture.detectChanges();
  }
  function openDetailOf(label: string): void {
    root().querySelector<HTMLElement>(`[aria-label="Manage ${label}"]`)?.click();
    fixture.detectChanges();
  }

  it('starts the account list and a fresh ambient read when the tab opens', () => {
    expect(accounts.open).toHaveBeenCalledWith('claude');
    expect(ambient.read).toHaveBeenCalledWith(true);
  });

  it('is a region labelled by the Use for heading, busy while a read is in flight', () => {
    const region = byTestId('accounts-tab');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-labelledby')).toBe('account-use-for-heading');
    expect(region?.getAttribute('aria-busy')).toBe('false');
    ambient.state.set({ ...CONNECTED, status: 'checking' });
    fixture.detectChanges();
    expect(region?.getAttribute('aria-busy')).toBe('true');
  });

  it('S1: with no named account shows the ambient row and Add, and no empty-list copy', () => {
    accounts.view.set(ready(snapshot([])));
    fixture.detectChanges();
    expect(byTestId('accounts-tab-list')?.querySelectorAll('li')).toHaveLength(1);
    expect(byTestId('accounts-tab-list')?.textContent).toContain('Existing Claude login');
    expect((byTestId('accounts-tab-add') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables Add until a snapshot exists, and offers Try again on a first-load failure', () => {
    accounts.view.set({ status: 'error', snapshot: null, stale: false, error: 'Could not load accounts. Retry.' });
    fixture.detectChanges();
    expect((byTestId('accounts-tab-add') as HTMLButtonElement).disabled).toBe(true);
    expect(byTestId('accounts-tab-error')?.textContent).toContain('Accounts could not be loaded.');
    byTestId('accounts-tab-error')?.querySelector('button')?.click();
    expect(accounts.refresh).toHaveBeenCalledWith('claude');
  });

  it('orders signed-in accounts first, renders names as text, spines failed rows', () => {
    accounts.view.set(ready(snapshot([account('p-x', '<b>Bold</b>', 'failed'), WORK])));
    fixture.detectChanges();
    const rows = all('accounts-tab-row');
    expect(rows[0].textContent).toContain('Work');
    expect(rows[1].textContent).toContain('<b>Bold</b>');
    expect(rows[1].querySelector('b')).toBeNull();
    expect(rows[1].className).toContain('border-l-state-err');
    expect(rows[1].querySelector('[data-testid="accounts-tab-row-sign-in"]')).not.toBeNull();
  });

  it('opens the detail on Overview for a signed-in account and on Access otherwise', () => {
    openDetailOf('Work');
    expect(detail()?.initialTab()).toBe('overview');
    detail()?.back.emit();
    fixture.detectChanges();
    all('accounts-tab-row-body')[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(detail()?.account().label).toBe('Team plan');
    expect(detail()?.initialTab()).toBe('access');
  });

  it('All accounts returns to the list with focus on that account Manage button', async () => {
    openDetailOf('Team plan');
    detail()?.back.emit();
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Manage Team plan');
  });

  describe('selection writes', () => {
    it('marks only that scope busy in the same handler, before anything async', () => {
      useFor().selectionRequested.emit({ scope: 'main', choice: { kind: 'named', profileId: WORK.profileId } });
      expect(pendingScopes().has('main')).toBe(true);
      expect(pendingScopes().has('lane')).toBe(false);
      fixture.detectChanges();
      expect(selects()[0].disabled).toBe(true);
      expect(selects()[1].disabled).toBe(false);
      expect(accounts.setSelection).toHaveBeenCalledWith('claude', 'main', { kind: 'named', profileId: WORK.profileId });
    });

    it('saved: the toast names the account from the host snapshot', async () => {
      useFor().selectionRequested.emit({ scope: 'lane', choice: { kind: 'named', profileId: WORK.profileId } });
      const saved = snapshot([WORK, TEAM], { kind: 'omitted' }, { kind: 'named', profileId: WORK.profileId });
      accounts.view.set(ready(saved));
      accounts.pending.resolve({ status: 'saved', snapshot: saved });
      await settle();
      expect(byTestId('accounts-tab-toast')?.textContent).toBe('Claude lanes will use Work for new sessions.');
      expect(pendingScopes().size).toBe(0);
    });

    it('refused: the stored value stays and the alert shows the fallback for an unsafe host sentence', async () => {
      useFor().selectionRequested.emit({ scope: 'main', choice: { kind: 'named', profileId: WORK.profileId } });
      accounts.pending.resolve({ status: 'failed', result: { code: 'conflict', summary: 'C:\\Users\\x\\.claude\nboom' } });
      await settle();
      expect(useFor().alerts().main).toBe(SELECTION_REFUSED_FALLBACK);
      expect(selects()[0].value).toBe('ambient');
    });

    it('unconfirmed: select and chips keep the last host snapshot and the warning shows', async () => {
      useFor().selectionRequested.emit({ scope: 'main', choice: { kind: 'named', profileId: WORK.profileId } });
      accounts.pending.resolve({ status: 'unconfirmed' });
      await settle();
      expect(useFor().messages().main).toBe('This action may not have completed. Accounts were reloaded.');
      expect(selects()[0].value).toBe('ambient');
      expect(all('accounts-tab-row-chip')).toHaveLength(0);
      expect(byTestId('accounts-tab-toast')?.textContent).toBe('');
    });
  });

  describe('account actions', () => {
    it('marks the account busy in the same handler and passes it to the detail', () => {
      openDetailOf('Team plan');
      detail()?.signIn.emit(TEAM.profileId);
      expect(busy().get(TEAM.profileId)).toBe('sign-in');
      fixture.detectChanges();
      expect(detail()?.busy()).toBe('sign-in');
      expect(accounts.startSignIn).toHaveBeenCalledWith('claude', TEAM.profileId);
    });

    it('a row Sign in stays focusable while busy and does not start twice', () => {
      const signIn = byTestId('accounts-tab-row-sign-in') as HTMLButtonElement;
      signIn.focus();
      signIn.click();
      fixture.detectChanges();
      expect(signIn.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(signIn);
      signIn.click();
      expect(accounts.startSignIn).toHaveBeenCalledTimes(1);
    });

    it('a saved rename gives the detail "Name saved."', async () => {
      openDetailOf('Work');
      detail()?.rename.emit({ profileId: WORK.profileId, label: 'Office' });
      accounts.pending.resolve({ status: 'saved', snapshot: snapshot([WORK, TEAM]) });
      await settle();
      expect(detail()?.feedback()).toBe('Name saved.');
    });
  });

  describe('removal (B-1, B-2)', () => {
    async function removeWork(hostSnapshot: ProviderAccountsSnapshot, focusInside: boolean): Promise<void> {
      accounts.view.set(ready(snapshot([WORK, TEAM], { kind: 'named', profileId: WORK.profileId })));
      fixture.detectChanges();
      openDetailOf('Work');
      await settle();
      detail()?.remove.emit(WORK.profileId);
      fixture.detectChanges();
      if (focusInside) byTestId('account-detail-live')?.focus();
      else selects()[1].focus();
      accounts.view.set(ready(hostSnapshot));
      accounts.pending.resolve({ status: 'saved', snapshot: hostSnapshot });
      await settle();
    }

    it('never writes a selection; the host snapshot with the selection omitted shows Existing Claude login', async () => {
      await removeWork(snapshot([TEAM]), true);
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(detail()).toBeUndefined();
      expect(selects()[0].value).toBe('ambient');
      expect(byTestId('accounts-tab-toast')?.textContent).toBe('Work was removed.');
      expect(document.activeElement).toBe(byTestId('accounts-tab-heading'));
    });

    it('a host snapshot that still names the removed id shows the unavailable placeholder', async () => {
      await removeWork(snapshot([TEAM], { kind: 'named', profileId: WORK.profileId }), true);
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(selects()[0].value).toBe('unavailable');
    });

    it('keeps focus where the user moved it while the removal ran', async () => {
      await removeWork(snapshot([TEAM]), false);
      expect(document.activeElement).toBe(selects()[1]);
      expect(byTestId('accounts-tab-toast')?.textContent).toBe('Work was removed.');
    });

    it('a push that removes the open account returns to the list', async () => {
      openDetailOf('Team plan');
      await settle();
      accounts.view.set(ready(snapshot([WORK])));
      await settle();
      expect(detail()).toBeUndefined();
      expect(byTestId('accounts-tab-list')).not.toBeNull();
    });
  });

  describe('add', () => {
    it('success opens the new account on Access with the toast and selects nothing', async () => {
      const added = account('p-new-0009', 'Side', 'not-signed-in');
      await submitAdd('Side');
      expect(accounts.addAccount).toHaveBeenCalledWith('claude', 'Side');
      expect(fixture.componentInstance['addPending']()).toBe(true);
      const next = snapshot([WORK, TEAM, added]);
      accounts.view.set(ready(next));
      accounts.pending.resolve({ status: 'saved', snapshot: next });
      await settle();
      expect(byTestId('accounts-tab-toast')?.textContent).toBe(ACCOUNT_ADDED_TOAST);
      expect(detail()?.account().profileId).toBe('p-new-0009');
      expect(detail()?.initialTab()).toBe('access');
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(accounts.startSignIn).not.toHaveBeenCalled();
    });

    it('a refusal keeps the form open with the safe host sentence', async () => {
      await submitAdd('Work 2');
      accounts.pending.resolve({ status: 'failed', result: { code: 'conflict', summary: 'That name is already used. Names must be different.' } });
      await settle();
      expect(root().querySelector('ptah-add-account-form')).not.toBeNull();
      expect(root().querySelector('ptah-add-account-form [role="alert"]')?.textContent).toContain('That name is already used.');
    });

    it('Cancel closes the form and focuses Add another account', async () => {
      byTestId('accounts-tab-add')?.click();
      await settle();
      expect(document.activeElement).toBe(root().querySelector('ptah-add-account-form input'));
      fixture.debugElement.query(By.css('ptah-add-account-form')).componentInstance.cancelled.emit();
      await settle();
      expect(document.activeElement).toBe(byTestId('accounts-tab-add'));
    });
  });

  it('Check again on the ambient row requests a fresh read', () => {
    ambient.read.mockClear();
    root().querySelector<HTMLButtonElement>('[aria-label="Check the existing Claude login again"]')?.click();
    expect(ambient.read).toHaveBeenCalledWith(true);
  });
});
