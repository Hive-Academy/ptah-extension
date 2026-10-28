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
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';
import { ACCOUNT_COPY } from './account-presentation';
import { AccountDetailViewComponent } from './account-detail-view.component';
import { AddAccountFormComponent } from './add-account-form.component';
import { AmbientAccountRowComponent } from './ambient-account-row.component';
import { AccountsTabComponent } from './accounts-tab.component';

type StatusReadOutcome = Awaited<ReturnType<ProviderAccountsStateService['refreshAccountStatus']>>;

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
  readonly statusRead = deferred<StatusReadOutcome>();
  state = () => this.view;
  operations = () => this.ops;
  fallbacks = () => this.fbs;
  open = jest.fn(async () => undefined);
  refresh = jest.fn(async () => undefined);
  refreshAccountStatus = jest.fn(() => this.statusRead.promise);
  setSelection = jest.fn(() => this.pending.promise);
  addAccount = jest.fn(() => this.pending.promise);
  renameAccount = jest.fn(() => this.pending.promise);
  removeAccount = jest.fn(() => this.pending.promise);
  startSignIn = jest.fn(() => this.pending.promise);
  signOut = jest.fn(() => this.pending.promise);
  cancelSignIn = jest.fn(() => this.pending.promise);
  /** The state service applies a write's response snapshot before the write resolves. */
  commit(next: ProviderAccountsSnapshot): void {
    this.view.set(ready(next));
    this.pending.resolve({ status: 'saved', snapshot: next });
  }
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
  let announce: jest.Mock;
  let outside: HTMLButtonElement | null = null;
  /** A control outside the tab (e.g. the drawer's tab strip). */
  const focusOutside = (): HTMLButtonElement => {
    outside ??= document.body.appendChild(document.createElement('button'));
    outside.focus();
    return outside;
  };

  function create(): void {
    fixture = TestBed.createComponent(AccountsTabComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  beforeEach(() => {
    accounts = new FakeAccounts();
    ambient = new FakeAmbient();
    announce = jest.fn();
    TestBed.configureTestingModule({
      imports: [AccountsTabComponent],
      providers: [
        { provide: ProviderAccountsStateService, useValue: accounts },
        { provide: ClaudeAmbientStatusService, useValue: ambient },
        { provide: SettingsSaveFeedbackService, useValue: { announce } },
      ],
    });
    create();
  });
  afterEach(() => {
    outside?.remove();
    outside = null;
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    TestBed.resetTestingModule();
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string) => root().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (id: string) => Array.from(root().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const rowOf = (label: string) =>
    all('accounts-tab-row').find((row) => row.querySelector('[data-testid="accounts-tab-row-name"]')?.textContent?.trim() === label);
  const detail = () => fixture.debugElement.query(By.directive(AccountDetailViewComponent))?.componentInstance as
    AccountDetailViewComponent | undefined;
  const addForm = () => fixture.debugElement.query(By.directive(AddAccountFormComponent))?.componentInstance as
    AddAccountFormComponent | undefined;
  const busy = () => fixture.componentInstance['busy']();
  const detailHeading = () => root().querySelector<HTMLElement>('[data-testid="account-detail-heading"]');
  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      fixture.detectChanges();
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function setView(view: ProviderAccountsView): void {
    accounts.view.set(view);
    fixture.detectChanges();
  }
  async function openDetailOf(label: string): Promise<void> {
    root().querySelector<HTMLElement>(`[aria-label="Manage ${label}"]`)?.click();
    await settle();
  }

  it('starts the account list and a fresh ambient read when the tab opens', () => {
    expect(accounts.open).toHaveBeenCalledWith('claude');
    expect(ambient.read).toHaveBeenCalledWith(true);
  });

  describe('region, header and body states', () => {
    it('is always labelled "Claude accounts", calm spacing, busy while a read runs, with no inline feedback line', () => {
      const region = root().querySelector<HTMLElement>('[role="region"]');
      expect(region?.getAttribute('aria-label')).toBe('Claude accounts');
      expect(region?.getAttribute('aria-labelledby')).toBeNull();
      expect(region?.className).toContain('space-y-6');
      expect(region?.className).toContain('text-sm');
      expect(region?.getAttribute('aria-busy')).toBe('false');
      expect(root().querySelector('[aria-live]')).toBeNull();
      expect(root().querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(0);
      expect(root().querySelector('select')).toBeNull();
      setView({ ...ready(snapshot([WORK])), status: 'loading' });
      expect(region?.getAttribute('aria-busy')).toBe('true');
    });

    it('header: Accounts heading (focusable by script) and Add account', () => {
      const heading = byTestId('accounts-tab-heading');
      expect(heading?.tagName).toBe('H3');
      expect(heading?.getAttribute('tabindex')).toBe('-1');
      const add = byTestId('accounts-tab-add');
      expect(add?.textContent?.trim()).toBe('Add account');
      expect(add?.className).toContain('btn-outline');
      expect(add?.className).toContain('min-h-8');
      expect(add?.getAttribute('aria-disabled')).toBeNull();
    });

    it('loading: busy list with a "Loading…" row; Add aria-disabled and inert', () => {
      setView({ status: 'loading', snapshot: null, stale: false, error: null });
      expect(byTestId('accounts-tab-loading')?.textContent?.trim()).toBe('Loading…');
      expect(byTestId('accounts-tab-list')?.getAttribute('aria-busy')).toBe('true');
      const add = byTestId('accounts-tab-add');
      expect(add?.getAttribute('aria-disabled')).toBe('true');
      add?.click();
      fixture.detectChanges();
      expect(addForm()).toBeUndefined();
    });

    it('no workspace: the same row reads "Open a workspace"', () => {
      setView({ status: 'idle', snapshot: null, stale: false, error: null });
      expect(byTestId('accounts-tab-loading')?.textContent?.trim()).toBe('Open a workspace');
    });

    it('first-load failure: an alert row with Try again', () => {
      setView({ status: 'error', snapshot: null, stale: false, error: 'Could not load accounts. Retry.' });
      const error = byTestId('accounts-tab-error');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(error?.textContent).toContain('Could not load accounts');
      error?.querySelector('button')?.click();
      expect(accounts.refresh).toHaveBeenCalledWith('claude');
    });

    it('stale: an "Out of date" status badge and Try again; the rows stay', () => {
      setView({ ...ready(snapshot([WORK, TEAM])), stale: true });
      const badge = byTestId('accounts-tab-stale');
      expect(badge?.getAttribute('role')).toBe('status');
      expect(badge?.textContent?.trim()).toBe('Out of date');
      expect(all('accounts-tab-row')).toHaveLength(2);
      byTestId('accounts-tab-stale-retry')?.click();
      expect(accounts.refresh).toHaveBeenCalledWith('claude');
      expect(root().textContent).not.toContain('latest refresh failed');
    });

    it('empty: the ambient row and Add only, no paragraph', () => {
      setView(ready(snapshot([])));
      expect(fixture.debugElement.query(By.directive(AmbientAccountRowComponent))).not.toBeNull();
      expect(all('accounts-tab-row')).toHaveLength(0);
      // The tab's own markup has no helper paragraph (the ambient row's markup belongs to component 8).
      const ownParagraphs = Array.from(root().querySelectorAll('p')).filter((p) => !p.closest('ptah-ambient-account-row'));
      expect(ownParagraphs).toHaveLength(0);
    });
  });

  describe('rows', () => {
    it('list spacing has no inline margin; rows px-4 py-3, signed-in first, names as truncated titled text', () => {
      const list = byTestId('accounts-tab-list');
      expect(list?.getAttribute('aria-label')).toBe('Claude accounts');
      expect(list?.className).toContain('space-y-3');
      expect(list?.className).not.toMatch(/\bm[tby]?-/);
      const names = all('accounts-tab-row-name');
      expect(names.map((name) => name.textContent?.trim())).toEqual(['Work', 'Team plan']);
      expect(names[0].getAttribute('title')).toBe('Work');
      expect(names[0].className).toContain('truncate');
      expect(all('accounts-tab-row')[0].className).toContain('px-4 py-3');
    });

    it('Manage chevron on every named row; Sign in only for not-signed-in, failed and cancelled; no row button', () => {
      setView(ready(snapshot([
        WORK, TEAM, account('p-fail-0003', 'Broken', 'failed'), account('p-out-0004', 'Out', 'signed-out'),
        account('p-can-0005', 'Stopped', 'cancelled'),
      ])));
      expect(root().querySelector('[role="button"]')).toBeNull();
      for (const label of ['Work', 'Team plan', 'Broken', 'Out', 'Stopped']) {
        const manage = rowOf(label)?.querySelector<HTMLElement>('[data-testid="accounts-tab-row-manage"]');
        expect(manage?.getAttribute('aria-label')).toBe(`Manage ${label}`);
        expect(manage?.getAttribute('title')).toBe('Manage');
      }
      const signIns = (label: string) => rowOf(label)?.querySelectorAll('[data-testid="accounts-tab-row-sign-in"]').length;
      expect([signIns('Work'), signIns('Team plan'), signIns('Broken'), signIns('Out'), signIns('Stopped')])
        .toEqual([0, 1, 1, 0, 1]);
      expect(rowOf('Broken')?.className).toContain('border-l-state-err');
    });

    it('pending: spinner and "Signing in…", no Sign in, Manage still there', () => {
      setView(ready(snapshot([account('p-pend-0006', 'Waiting', 'pending')])));
      const row = rowOf('Waiting');
      expect(row?.querySelector('[data-testid="accounts-tab-row-spinner"]')).not.toBeNull();
      expect(row?.querySelector('[data-testid="accounts-tab-row-state"]')?.textContent?.trim()).toBe('Signing in…');
      expect(row?.querySelector('[data-testid="accounts-tab-row-sign-in"]')).toBeNull();
      expect(row?.querySelector('[data-testid="accounts-tab-row-manage"]')).not.toBeNull();
    });

    it('"Used by" chips come from the host snapshot; unused rows have no label; the ambient row gets its chips', () => {
      setView(ready(snapshot([WORK, TEAM], { kind: 'named', profileId: WORK.profileId }, { kind: 'omitted' })));
      const usedBy = rowOf('Work')?.querySelector('[data-testid="accounts-tab-row-used-by"]');
      expect(usedBy?.textContent).toContain('Used by');
      expect(Array.from(usedBy?.querySelectorAll('[data-testid="accounts-tab-row-chip"]') ?? []).map((c) => c.textContent?.trim()))
        .toEqual(['Chat']);
      expect(rowOf('Team plan')?.querySelector('[data-testid="accounts-tab-row-used-by"]')).toBeNull();
      const ambientRow = fixture.debugElement.query(By.directive(AmbientAccountRowComponent)).componentInstance as
        AmbientAccountRowComponent;
      expect(ambientRow.chips()).toEqual(['Lanes']);
      expect(root().textContent).not.toContain('Run binding');
    });
  });

  describe('list and detail', () => {
    it('Manage opens the detail (component 7 inputs only) with focus on its heading; the header leaves', async () => {
      await openDetailOf('Team plan');
      expect(detail()?.account().profileId).toBe(TEAM.profileId);
      expect(detail()?.accounts()).toEqual([WORK, TEAM]);
      expect(byTestId('accounts-tab-heading')).toBeNull();
      expect(byTestId('accounts-tab-list')).toBeNull();
      expect(document.activeElement).toBe(detailHeading());
    });

    it('Back returns to the list with focus on that account Manage chevron', async () => {
      await openDetailOf('Team plan');
      detail()?.back.emit();
      await settle();
      expect(document.activeElement).toBe(rowOf('Team plan')?.querySelector('[data-testid="accounts-tab-row-manage"]'));
    });

    it('a push that removes the open account: back to the list, status toast, heading focus as focus was inside', async () => {
      await openDetailOf('Team plan');
      expect(root().querySelector('[data-testid="accounts-tab-detail"]')?.contains(document.activeElement)).toBe(true);
      setView(ready(snapshot([WORK])));
      await settle();
      expect(detail()).toBeUndefined();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.accountGone, 'status');
      expect(document.activeElement).toBe(byTestId('accounts-tab-heading'));
    });

    it('a push that removes the open account while focus is outside the tab leaves focus there', async () => {
      await openDetailOf('Team plan');
      const away = focusOutside();
      setView(ready(snapshot([WORK])));
      await settle();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.accountGone, 'status');
      expect(document.activeElement).toBe(away);
    });
  });

  describe('account actions', () => {
    it('row Sign in: busy in the same handler, focusable while busy, a repeat is ignored', () => {
      const signIn = rowOf('Team plan')?.querySelector<HTMLButtonElement>('[data-testid="accounts-tab-row-sign-in"]');
      signIn?.click();
      expect(busy().get(TEAM.profileId)).toBe('sign-in');
      fixture.detectChanges();
      expect(signIn?.disabled).toBe(false);
      expect(signIn?.getAttribute('aria-disabled')).toBe('true');
      signIn?.click();
      expect(accounts.startSignIn).toHaveBeenCalledTimes(1);
    });

    it('a started sign-in announces the host state word', async () => {
      rowOf('Team plan')?.querySelector<HTMLButtonElement>('[data-testid="accounts-tab-row-sign-in"]')?.click();
      accounts.commit(snapshot([WORK, { ...TEAM, state: 'pending' }]));
      await settle();
      expect(announce).toHaveBeenCalledWith('Signing in…', 'status');
      expect(busy().size).toBe(0);
    });

    describe('a later push that ends a pending sign-in', () => {
      const PENDING_TEAM = { ...TEAM, state: 'pending' as const };
      const calls = (message: string) => announce.mock.calls.filter(([text]) => text === message);
      async function startPending(): Promise<void> {
        rowOf('Team plan')?.querySelector<HTMLButtonElement>('[data-testid="accounts-tab-row-sign-in"]')?.click();
        accounts.commit(snapshot([WORK, PENDING_TEAM]));
        await settle();
        expect(announce).toHaveBeenLastCalledWith('Signing in…', 'status');
      }
      async function push(state: ProviderAccountState, revision = 1): Promise<void> {
        setView(ready(snapshot([WORK, { ...TEAM, state, revision }])));
        await settle();
      }

      it('announces "Signed in" once, ignoring a duplicate push', async () => {
        await startPending();
        await push('signed-in');
        expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.signedIn, 'status');
        await push('signed-in', 2);
        expect(calls(ACCOUNT_COPY.signedIn)).toHaveLength(1);
      });

      it.each([
        ['signed-in', ACCOUNT_COPY.signedIn, 'status'],
        ['failed', ACCOUNT_COPY.actionFailed, 'alert'],
      ] as const)('a %s push that lands before a late pending response is announced once', async (state, message, tone) => {
        rowOf('Team plan')?.querySelector<HTMLButtonElement>('[data-testid="accounts-tab-row-sign-in"]')?.click();
        await push('pending');
        await push(state, 2);
        // The state service rejected the older start snapshot but still returns it as the outcome.
        accounts.pending.resolve({ status: 'saved', snapshot: snapshot([WORK, PENDING_TEAM]) });
        await settle();
        expect(calls(message)).toEqual([[message, tone]]);
        expect(calls('Signing in…')).toHaveLength(0);
        await push(state, 3);
        expect(calls(message)).toHaveLength(1);
      });

      it('announces a failure once as the fixed alert, ignoring a duplicate push', async () => {
        await startPending();
        await push('failed');
        expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.actionFailed, 'alert');
        await push('failed', 2);
        expect(calls(ACCOUNT_COPY.actionFailed)).toHaveLength(1);
        expect(calls(ACCOUNT_COPY.signedIn)).toHaveLength(0);
      });

      it('a start whose response is already signed in is announced once, by the response', async () => {
        rowOf('Team plan')?.querySelector<HTMLButtonElement>('[data-testid="accounts-tab-row-sign-in"]')?.click();
        accounts.commit(snapshot([WORK, { ...TEAM, state: 'signed-in' }]));
        await settle();
        await push('signed-in', 2);
        expect(calls(ACCOUNT_COPY.signedIn)).toHaveLength(1);
      });

      it('a pending sign-in seen in a push (started elsewhere) is announced when it ends', async () => {
        await push('pending');
        await push('signed-in', 2);
        expect(calls(ACCOUNT_COPY.signedIn)).toHaveLength(1);
      });

      it.each(['cancelled', 'failed'] as const)(
        'Cancel announces once; the push that then ends the sign-in (%s) stays silent',
        async (state) => {
          await push('pending');
          await openDetailOf('Team plan');
          detail()?.cancelSignIn.emit(TEAM.profileId);
          // The Cancel response still reads pending; the terminal state arrives in a later push.
          accounts.commit(snapshot([WORK, PENDING_TEAM]));
          await settle();
          expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.signInCancelled, 'status');
          await push(state, 2);
          await push(state, 3);
          expect(calls(ACCOUNT_COPY.signInCancelled)).toHaveLength(1);
          expect(calls(ACCOUNT_COPY.actionFailed)).toHaveLength(0);
        },
      );

      it('focus on Cancel sign-in moves to the detail heading when the push removes it', async () => {
        await push('pending');
        await openDetailOf('Team plan');
        root().querySelector<HTMLButtonElement>('[data-testid="account-detail-cancel-sign-in"]')?.focus();
        await push('signed-in', 2);
        expect(root().querySelector('[data-testid="account-detail-cancel-sign-in"]')).toBeNull();
        expect(document.activeElement).toBe(detailHeading());
      });

      it('focus outside the tab stays there when the push ends the sign-in', async () => {
        await push('pending');
        await openDetailOf('Team plan');
        const away = focusOutside();
        await push('failed', 2);
        expect(document.activeElement).toBe(away);
        expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.actionFailed, 'alert');
      });
    });

    it.each([
      ['signOut', 'signOut', ACCOUNT_COPY.signedOut],
      ['cancelSignIn', 'cancelSignIn', ACCOUNT_COPY.signInCancelled],
    ] as const)('detail %s saved announces its toast', async (output, method, message) => {
      await openDetailOf('Work');
      detail()?.[output].emit(WORK.profileId);
      expect(accounts[method]).toHaveBeenCalledWith('claude', WORK.profileId);
      expect(busy().has(WORK.profileId)).toBe(true);
      accounts.commit(snapshot([WORK, TEAM]));
      await settle();
      expect(announce).toHaveBeenCalledWith(message, 'status');
    });

    it('a saved rename announces "Name saved"', async () => {
      await openDetailOf('Work');
      detail()?.rename.emit({ profileId: WORK.profileId, label: 'Job' });
      expect(accounts.renameAccount).toHaveBeenCalledWith('claude', WORK.profileId, 'Job');
      accounts.commit(snapshot([{ ...WORK, label: 'Job' }, TEAM]));
      await settle();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.nameSaved, 'status');
    });

    it('a refusal announces the safe host sentence as an alert, else the fixed alert', async () => {
      await openDetailOf('Work');
      detail()?.signOut.emit(WORK.profileId);
      accounts.pending.resolve({ status: 'failed', result: { code: 'busy', summary: 'Another sign-in is running.' } });
      await settle();
      expect(announce).toHaveBeenLastCalledWith('Another sign-in is running.', 'alert');
    });

    it('an unsafe host sentence is replaced by the fixed alert', async () => {
      await openDetailOf('Work');
      detail()?.signOut.emit(WORK.profileId);
      accounts.pending.resolve({ status: 'failed', result: { code: 'busy', summary: 'C:\\Users\\me\\.claude failed' } });
      await settle();
      expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.actionFailed, 'alert');
    });

    it('unconfirmed never reads "not saved"', async () => {
      await openDetailOf('Work');
      detail()?.signOut.emit(WORK.profileId);
      accounts.pending.resolve({ status: 'unconfirmed' });
      await settle();
      expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.unconfirmed, 'alert');
    });

    it('B-2: a detail action keeps focus where the user moved it', async () => {
      await openDetailOf('Work');
      detailHeading()?.focus();
      detail()?.signOut.emit(WORK.profileId);
      const away = focusOutside();
      accounts.commit(snapshot([{ ...WORK, state: 'signed-out' }, TEAM]));
      await settle();
      expect(document.activeElement).toBe(away);
    });

    it('a write that resolves after the tab closed is still announced but moves no focus', async () => {
      await openDetailOf('Work');
      detail()?.signOut.emit(WORK.profileId);
      const away = focusOutside();
      fixture.destroy();
      accounts.commit(snapshot([WORK, TEAM]));
      await Promise.resolve();
      await Promise.resolve();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.signedOut, 'status');
      expect(document.activeElement).toBe(away);
    });
  });

  describe('release-held (P6-A8)', () => {
    it('after a release-held refusal Add is aria-disabled with a title and activating it announces the host sentence', async () => {
      await openDetailOf('Work');
      detail()?.signOut.emit(WORK.profileId);
      accounts.pending.resolve({ status: 'failed', result: { code: 'release-held', summary: 'C:\\unsafe' } });
      await settle();
      expect(announce).toHaveBeenLastCalledWith(ACCOUNT_COPY.hostUnsupported, 'alert');
      detail()?.back.emit();
      await settle();
      const add = byTestId('accounts-tab-add');
      expect(add?.getAttribute('aria-disabled')).toBe('true');
      expect(add?.getAttribute('title')).toBe(ACCOUNT_COPY.notAvailableOnHost);
      announce.mockClear();
      add?.click();
      fixture.detectChanges();
      expect(addForm()).toBeUndefined();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.hostUnsupported, 'alert');
    });
  });

  describe('Check status and ambient Check', () => {
    it('sets busy in the same handler, rejects a repeat, and announces a successful read', async () => {
      await openDetailOf('Work');
      detail()?.checkStatus.emit(WORK.profileId);
      expect(busy().get(WORK.profileId)).toBe('check-status');
      detail()?.checkStatus.emit(WORK.profileId);
      expect(accounts.refreshAccountStatus).toHaveBeenCalledTimes(1);
      accounts.statusRead.resolve({ status: 'read' });
      await settle();
      expect(busy().size).toBe(0);
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.statusChecked, 'status');
    });

    it('a transport failure announces the fixed alert', async () => {
      await openDetailOf('Work');
      detail()?.checkStatus.emit(WORK.profileId);
      accounts.statusRead.resolve({ status: 'unavailable' });
      await settle();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.actionFailed, 'alert');
    });

    it('the ambient row Check requests a fresh read and announces "Status checked"', async () => {
      ambient.read.mockClear();
      const row = fixture.debugElement.query(By.directive(AmbientAccountRowComponent)).componentInstance as
        AmbientAccountRowComponent;
      row.checkRequested.emit();
      expect(ambient.read).toHaveBeenCalledWith(true);
      await settle();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.statusChecked, 'status');
    });
  });

  describe('removal (B-1, B-2)', () => {
    it('never writes a selection; announces "Account removed" once and not "no longer in the list"', async () => {
      await openDetailOf('Work');
      detail()?.remove.emit(WORK.profileId);
      accounts.commit(snapshot([TEAM]));
      await settle();
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.accountRemoved, 'status');
      expect(announce).not.toHaveBeenCalledWith(ACCOUNT_COPY.accountGone, 'status');
      expect(detail()).toBeUndefined();
    });

    it('focus on the Remove origin moves to the Accounts heading when the detail leaves', async () => {
      await openDetailOf('Work');
      detailHeading()?.focus();
      detail()?.remove.emit(WORK.profileId);
      accounts.commit(snapshot([TEAM]));
      await settle();
      expect(document.activeElement).toBe(byTestId('accounts-tab-heading'));
    });

    it('focus moved outside the tab during the removal stays there', async () => {
      await openDetailOf('Work');
      detail()?.remove.emit(WORK.profileId);
      const away = focusOutside();
      accounts.commit(snapshot([TEAM]));
      await settle();
      expect(document.activeElement).toBe(away);
    });

    it('a refused removal keeps the detail and announces the alert', async () => {
      await openDetailOf('Work');
      detail()?.remove.emit(WORK.profileId);
      accounts.pending.resolve({ status: 'unavailable' });
      await settle();
      expect(detail()?.account().profileId).toBe(WORK.profileId);
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.actionFailed, 'alert');
    });
  });

  describe('add', () => {
    const NEW = account('p-new-0009', 'Side', 'not-signed-in');
    async function openAdd(): Promise<AddAccountFormComponent> {
      byTestId('accounts-tab-add')?.click();
      await settle();
      const form = addForm();
      if (!form) throw new Error('add form not open');
      return form;
    }

    it('the form replaces the list and binds accounts and pending', async () => {
      const form = await openAdd();
      expect(byTestId('accounts-tab-list')).toBeNull();
      expect(form.accounts()).toEqual([WORK, TEAM]);
      expect(form.pending()).toBe(false);
    });

    it('success with focus still in the form: "Account added", the new detail opens with its heading focused', async () => {
      const form = await openAdd();
      root().querySelector<HTMLElement>('ptah-add-account-form input')?.focus();
      form.submitted.emit('Side');
      expect(accounts.addAccount).toHaveBeenCalledWith('claude', 'Side');
      fixture.detectChanges();
      expect(form.pending()).toBe(true);
      accounts.commit(snapshot([WORK, TEAM, NEW]));
      await settle();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.accountAdded, 'status');
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(detail()?.account().profileId).toBe(NEW.profileId);
      expect(document.activeElement).toBe(detailHeading());
    });

    it('success after focus left the form: the list shows, no detail, no focus move', async () => {
      const form = await openAdd();
      form.submitted.emit('Side');
      const away = focusOutside();
      accounts.commit(snapshot([WORK, TEAM, NEW]));
      await settle();
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.accountAdded, 'status');
      expect(detail()).toBeUndefined();
      expect(byTestId('accounts-tab-list')).not.toBeNull();
      expect(document.activeElement).toBe(away);
    });

    it('a refusal keeps the form open and announces the safe host sentence', async () => {
      const form = await openAdd();
      form.submitted.emit('Side');
      accounts.pending.resolve({ status: 'failed', result: { code: 'busy', summary: 'That name is already used.' } });
      await settle();
      expect(addForm()).toBeDefined();
      expect(announce).toHaveBeenCalledWith('That name is already used.', 'alert');
    });

    it('Cancel closes the form and focuses Add account', async () => {
      const form = await openAdd();
      form.cancelled.emit();
      await settle();
      expect(addForm()).toBeUndefined();
      expect(document.activeElement).toBe(byTestId('accounts-tab-add'));
    });
  });
});
