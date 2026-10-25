import { Component, input, output, signal, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ProviderAccountsStateService,
  type ProviderAccountActionKind,
  type ProviderAccountActionOutcome,
  type ProviderAccountsView,
} from '@ptah-extension/core';
import type {
  ProviderAccountActionResult,
  ProviderAccountScope,
  ProviderAccountSelection,
  ProviderAccountSummary,
  ProviderAccountsSnapshot,
} from '@ptah-extension/shared';
import {
  AccountChooserComponent,
  type AccountChoiceIntent,
} from './account-chooser.component';
import {
  ACCOUNT_DEFAULT_TOAST,
  AccountDetailsDrawerComponent,
  type AccountRenameIntent,
} from './account-details-drawer.component';
import { AddAccountDialogComponent } from './add-account-dialog.component';
import {
  ACCOUNT_HELD_NOTE,
  AccountsSectionComponent,
} from './accounts-section.component';

// Child stubs with the real contracts: the section is tested as a composition over the state seam.
@Component({ selector: 'ptah-add-account-dialog', standalone: true, template: '' })
class AddStub {
  readonly open = input.required<boolean>();
  readonly pending = input(false);
  readonly error = input<ProviderAccountActionResult | null>(null);
  readonly add = output<string>();
  readonly closed = output<void>();
}
@Component({ selector: 'ptah-account-chooser', standalone: true, template: '' })
class ChooserStub {
  readonly open = input.required<boolean>();
  readonly scope = input.required<ProviderAccountScope>();
  readonly accounts = input.required<readonly ProviderAccountSummary[]>();
  readonly selection = input.required<ProviderAccountSelection>();
  readonly pending = input(false);
  readonly error = input<string | null>(null);
  readonly chose = output<AccountChoiceIntent>();
  readonly closed = output<void>();
}
@Component({ selector: 'ptah-account-details-drawer', standalone: true, template: '' })
class DrawerStub {
  readonly open = input.required<boolean>();
  readonly account = input.required<ProviderAccountSummary | null>();
  readonly pending = input<ProviderAccountActionKind | null>(null);
  readonly result = input<ProviderAccountActionResult | null>(null);
  readonly saved = input<ProviderAccountActionKind | null>(null);
  readonly refreshStatus = output<string>();
  readonly signIn = output<string>();
  readonly cancelSignIn = output<string>();
  readonly signOut = output<string>();
  readonly rename = output<AccountRenameIntent>();
  readonly setDefault = output<string>();
  readonly remove = output<string>();
  readonly closed = output<void>();
}

const account = (
  profileId: string,
  label: string,
  state: ProviderAccountSummary['state'],
  extra: Partial<ProviderAccountSummary> = {},
): ProviderAccountSummary => ({
  profileId,
  label,
  provider: 'claude',
  state,
  owner: 'unknown',
  revision: 1,
  activeRunCount: 0,
  ...extra,
});
const WORK = account('claude-work-7c2a', 'Work Claude', 'signed-in', {
  owner: 'verified',
  activeRunCount: 2,
});
const PERSONAL = account('claude-personal-a91f', 'Personal Claude', 'disconnected');

function snapshot(
  accounts: readonly ProviderAccountSummary[],
  main: ProviderAccountSelection = { kind: 'omitted' },
  lane: ProviderAccountSelection = { kind: 'omitted' },
): ProviderAccountsSnapshot {
  return {
    provider: 'claude',
    workspaceRoot: '/ws',
    revision: 3,
    accounts,
    selections: {
      main: { scope: 'main', selection: main, revision: 1 },
      lane: { scope: 'lane', selection: lane, revision: 2 },
    },
  };
}
const ready = (snap: ProviderAccountsSnapshot | null, extra: Partial<ProviderAccountsView> = {}): ProviderAccountsView => ({
  status: 'ready',
  snapshot: snap,
  stale: false,
  error: null,
  ...extra,
});
const SAVED: ProviderAccountActionOutcome = { status: 'saved', snapshot: snapshot([WORK]) };
const HELD: ProviderAccountActionResult = { code: 'release-held', summary: 'Named Claude accounts are not available in this release.' };

class AccountsStub {
  readonly view = signal<ProviderAccountsView>(ready(snapshot([WORK, PERSONAL])));
  readonly state = jest.fn(() => this.view.asReadonly());
  readonly operations = jest.fn(() => signal({}).asReadonly());
  readonly open = jest.fn(async () => undefined);
  readonly refresh = jest.fn(async () => undefined);
  readonly refreshAccountStatus = jest.fn(async () => undefined);
  readonly addAccount = jest.fn(async (): Promise<ProviderAccountActionOutcome> => SAVED);
  readonly renameAccount = jest.fn(async (): Promise<ProviderAccountActionOutcome> => SAVED);
  readonly removeAccount = jest.fn(async (): Promise<ProviderAccountActionOutcome> => SAVED);
  readonly startSignIn = jest.fn(async (): Promise<ProviderAccountActionOutcome> => SAVED);
  readonly cancelSignIn = jest.fn(async (): Promise<ProviderAccountActionOutcome> => SAVED);
  readonly signOut = jest.fn(async (): Promise<ProviderAccountActionOutcome> => SAVED);
  readonly setSelection = jest.fn(async (): Promise<ProviderAccountActionOutcome> => SAVED);
  readonly setDefault = jest.fn(async (): Promise<ProviderAccountActionOutcome> => SAVED);
}

describe('AccountsSectionComponent', () => {
  let fixture: ComponentFixture<AccountsSectionComponent>;
  let element: HTMLElement;
  let accounts: AccountsStub;

  beforeEach(async () => {
    accounts = new AccountsStub();
    await TestBed.configureTestingModule({
      imports: [AccountsSectionComponent],
      providers: [{ provide: ProviderAccountsStateService, useValue: accounts }],
    })
      .overrideComponent(AccountsSectionComponent, {
        remove: { imports: [AddAccountDialogComponent, AccountChooserComponent, AccountDetailsDrawerComponent] },
        add: { imports: [AddStub, ChooserStub, DrawerStub] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(AccountsSectionComponent);
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => fixture.destroy());

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const stub = <T>(type: Type<T>): T =>
    fixture.debugElement.query(By.directive(type)).componentInstance as T;
  const q = (testId: string): HTMLElement | null => element.querySelector(`[data-testid="${testId}"]`);
  function button(label: string, root: ParentNode = element): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
    if (!found) throw new Error(`No button "${label}"`);
    return found;
  }
  const card = (profileId: string): HTMLElement => q(`account-${profileId}`) as HTMLElement;

  it('opens the Claude slot once and renders nothing on an inert (non-Electron) host', async () => {
    accounts.view.set({ status: 'inert', snapshot: null, stale: false, error: null });
    await render();
    expect(accounts.open).toHaveBeenCalledWith('claude');
    expect(q('accounts-section')).toBeNull();
    expect(element.querySelector('ptah-account-details-drawer')).toBeNull();
  });

  describe('read states', () => {
    it('loading without a snapshot shows progress and disables Add', async () => {
      accounts.view.set({ status: 'loading', snapshot: null, stale: false, error: null });
      await render();
      expect(q('accounts-loading')?.textContent).toContain('Loading accounts…');
      expect(q('accounts-section')?.getAttribute('aria-busy')).toBe('true');
      expect(button('Add Claude account').disabled).toBe(true);
    });

    it('a failed first read is an alert whose Retry re-reads the region', async () => {
      accounts.view.set({ status: 'error', snapshot: null, stale: false, error: 'Could not load accounts. Retry.' });
      await render();
      const alert = q('accounts-error');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toContain('Could not load accounts. Retry.');
      button('Retry', alert as HTMLElement).click();
      expect(accounts.refresh).toHaveBeenCalledWith('claude');
    });

    it('a failed re-read keeps the last snapshot, labelled stale, with Retry', async () => {
      accounts.view.set(ready(snapshot([WORK]), { status: 'error', stale: true, error: 'Could not load accounts. Retry.' }));
      await render();
      expect(q('accounts-stale')?.textContent).toContain('Showing the last loaded accounts');
      expect(card(WORK.profileId)).not.toBeNull();
      button('Retry', q('accounts-stale') as HTMLElement).click();
      expect(accounts.refresh).toHaveBeenCalledTimes(1);
    });

    it('empty: both routes use the existing default and no profile row exists', async () => {
      accounts.view.set(ready(snapshot([])));
      await render();
      expect(q('accounts-empty')?.textContent).toContain('No named Claude accounts yet.');
      expect(q('routing-main')?.textContent).toContain('Use existing default');
      expect(q('routing-lane')?.textContent).toContain('Use existing default');
      expect(q('routing-held')).toBeNull();
    });
  });

  describe('profile cards', () => {
    it('shows owner evidence, state text and a run binding only when its count is positive', async () => {
      await render();
      const work = card(WORK.profileId);
      const personal = card(PERSONAL.profileId);
      expect(work.textContent).toContain('Verified identity');
      expect(work.textContent).toContain('Signed in');
      expect(work.querySelector('[data-testid="run-binding"]')?.textContent).toContain('2 active runs');
      expect(personal.textContent).toContain('Unknown owner');
      expect(personal.textContent).toContain('Disconnected');
      expect(personal.querySelector('[data-testid="run-binding"]')).toBeNull();
      expect(personal.className).toContain('border-l-error');
    });

    it('assignment badges follow the stored selections; a named route is never shown as admitted', async () => {
      accounts.view.set(ready(snapshot([WORK, PERSONAL], { kind: 'named', profileId: WORK.profileId }, { kind: 'ambient' })));
      await render();
      expect(card(WORK.profileId).textContent).toContain('Next main');
      expect(card(WORK.profileId).textContent).not.toContain('Next lane');
      expect(q('routing-main')?.textContent).toContain('Work Claude');
      expect(q('routing-main')?.textContent).toContain(ACCOUNT_HELD_NOTE);
      expect(q('routing-main')?.textContent?.toLowerCase()).not.toContain('admitted');
      expect(q('routing-lane')?.textContent).toContain('Use existing default');
    });

    it('a card click or Enter opens the drawer for that profile', async () => {
      await render();
      card(PERSONAL.profileId).click();
      await render();
      expect(stub(DrawerStub).open()).toBe(true);
      expect(stub(DrawerStub).account()).toEqual(PERSONAL);
      stub(DrawerStub).closed.emit();
      await render();
      expect(stub(DrawerStub).open()).toBe(false);
      card(WORK.profileId).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await render();
      expect(stub(DrawerStub).account()).toEqual(WORK);
    });

    it('the nested Manage button opens the drawer and stops the card click', async () => {
      await render();
      const row = card(WORK.profileId);
      const outer = jest.fn();
      row.parentElement?.addEventListener('click', outer);
      button('Manage', row).click();
      await render();
      expect(outer).not.toHaveBeenCalled();
      expect(stub(DrawerStub).account()).toEqual(WORK);
    });
  });

  describe('main and lane choices', () => {
    it('each Change opens the chooser for its own scope and writes only that scope', async () => {
      accounts.view.set(ready(snapshot([WORK], { kind: 'ambient' }, { kind: 'named', profileId: WORK.profileId })));
      await render();
      button('Change', q('routing-lane') as HTMLElement).click();
      await render();
      const chooser = stub(ChooserStub);
      expect(chooser.open()).toBe(true);
      expect(chooser.scope()).toBe('lane');
      expect(chooser.selection()).toEqual({ kind: 'named', profileId: WORK.profileId });
      chooser.chose.emit({ scope: 'lane', choice: { kind: 'ambient' } });
      await render();
      expect(accounts.setSelection).toHaveBeenCalledWith('claude', 'lane', { kind: 'ambient' });
      expect(accounts.setDefault).not.toHaveBeenCalled();
      expect(chooser.open()).toBe(false);
      expect(q('accounts-toast')?.textContent).toContain('Next Claude lane account saved.');

      button('Change', q('routing-main') as HTMLElement).click();
      await render();
      expect(chooser.scope()).toBe('main');
      chooser.chose.emit({ scope: 'main', choice: { kind: 'named', profileId: WORK.profileId } });
      await render();
      expect(accounts.setSelection).toHaveBeenLastCalledWith('claude', 'main', { kind: 'named', profileId: WORK.profileId });
      expect(accounts.setSelection).toHaveBeenCalledTimes(2);
    });

    it('a refused choice keeps the chooser open with the safe host sentence', async () => {
      accounts.setSelection.mockResolvedValueOnce({ status: 'failed', result: HELD });
      await render();
      button('Change', q('routing-main') as HTMLElement).click();
      await render();
      stub(ChooserStub).chose.emit({ scope: 'main', choice: { kind: 'named', profileId: WORK.profileId } });
      await render();
      expect(stub(ChooserStub).open()).toBe(true);
      expect(stub(ChooserStub).error()).toBe(HELD.summary);
    });
  });

  describe('account actions through the state seam', () => {
    it('Add writes the label only, closes on commit and never selects the profile', async () => {
      await render();
      button('Add Claude account').click();
      await render();
      expect(stub(AddStub).open()).toBe(true);
      stub(AddStub).add.emit('Research');
      await render();
      expect(accounts.addAccount).toHaveBeenCalledWith('claude', 'Research');
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(stub(AddStub).open()).toBe(false);
      expect(q('accounts-toast')?.textContent).toContain('not selected for any route');
    });

    it('a refused Add stays open with the result', async () => {
      const refusal: ProviderAccountActionResult = { code: 'conflict', summary: 'This local account directory is already represented by another profile. Rename that profile instead.' };
      accounts.addAccount.mockResolvedValueOnce({ status: 'failed', result: refusal });
      await render();
      button('Add Claude account').click();
      await render();
      stub(AddStub).add.emit('Dup');
      await render();
      expect(stub(AddStub).open()).toBe(true);
      expect(stub(AddStub).error()).toEqual(refusal);
    });

    it('drawer intents call the matching state method; pending, failure and saved reach the drawer', async () => {
      let resolve: (outcome: ProviderAccountActionOutcome) => void = () => undefined;
      accounts.startSignIn.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      await render();
      card(PERSONAL.profileId).click();
      await render();
      const drawer = stub(DrawerStub);
      const id = PERSONAL.profileId;

      drawer.signIn.emit(id);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(accounts.startSignIn).toHaveBeenCalledWith('claude', id);
      expect(drawer.pending()).toBe('sign-in');
      resolve({ status: 'failed', result: HELD });
      await render();
      expect(drawer.pending()).toBeNull();
      expect(drawer.result()).toEqual(HELD);

      drawer.cancelSignIn.emit(id);
      drawer.signOut.emit(id);
      drawer.refreshStatus.emit(id);
      drawer.rename.emit({ profileId: id, label: 'Home' });
      await render();
      expect(accounts.cancelSignIn).toHaveBeenCalledWith('claude', id);
      expect(accounts.signOut).toHaveBeenCalledWith('claude', id);
      expect(accounts.refreshAccountStatus).toHaveBeenCalledWith('claude', id);
      expect(accounts.renameAccount).toHaveBeenCalledWith('claude', id, 'Home');
      expect(drawer.saved()).toBe('rename');

      drawer.setDefault.emit(id);
      await render();
      expect(accounts.setDefault).toHaveBeenCalledWith('claude', { kind: 'named', profileId: id });
      expect(q('accounts-toast')?.textContent?.trim()).toBe(ACCOUNT_DEFAULT_TOAST);

      drawer.remove.emit(id);
      await render();
      expect(accounts.removeAccount).toHaveBeenCalledWith('claude', id);
    });

    it('an unconfirmed write is reported as such, never as saved or rolled back', async () => {
      accounts.signOut.mockResolvedValueOnce({ status: 'unconfirmed' });
      await render();
      card(WORK.profileId).click();
      await render();
      stub(DrawerStub).signOut.emit(WORK.profileId);
      await render();
      expect(q('accounts-toast')?.textContent).toContain('may not have completed');
      expect(stub(DrawerStub).pending()).toBeNull();
      expect(stub(DrawerStub).result()).toBeNull();
    });
  });
});
