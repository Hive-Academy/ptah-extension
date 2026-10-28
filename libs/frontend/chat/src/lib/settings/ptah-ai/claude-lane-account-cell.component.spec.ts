import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeAmbientStatusService,
  ProviderAccountsStateService,
  VSCodeService,
  type ClaudeAmbientStatusView,
  type ProviderAccountActionOutcome,
  type ProviderAccountChoice,
  type ProviderAccountsView,
} from '@ptah-extension/core';
import type {
  ProviderAccountSelection,
  ProviderAccountState,
  ProviderAccountSummary,
  ProviderAccountsSnapshot,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { ACCOUNT_COPY } from '../providers/accounts/account-presentation';
import { ClaudeLaneAccountCellComponent } from './claude-lane-account-cell.component';

const account = (
  profileId: string,
  accountState: ProviderAccountState = 'signed-in',
  label = `Account ${profileId}`,
): ProviderAccountSummary => ({
  profileId,
  label,
  provider: 'claude',
  state: accountState,
  owner: 'unknown',
  revision: 1,
  activeRunCount: 0,
});
const snapshotOf = (
  accounts: readonly ProviderAccountSummary[],
  lane: ProviderAccountSelection = { kind: 'omitted' },
): ProviderAccountsSnapshot => ({
  provider: 'claude',
  workspaceRoot: 'workspace',
  revision: 3,
  accounts,
  selections: {
    main: { scope: 'main', selection: { kind: 'omitted' }, revision: 1 },
    lane: { scope: 'lane', selection: lane, revision: 2 },
  },
});
const readyView = (snapshot: ProviderAccountsSnapshot): ProviderAccountsView => ({
  status: 'ready',
  stale: false,
  error: null,
  snapshot,
});
const TWO_SIGNED_IN = [
  account('p-1'),
  account('p-2'),
  account('p-3', 'not-signed-in'),
];
const CONNECTED: ClaudeAmbientStatusView = {
  status: 'ready',
  localFailure: false,
  result: { state: 'connected', checkedAt: '2026-10-26T10:00:00.000Z' },
};

class AccountsFake {
  readonly view = signal<ProviderAccountsView>(
    readyView(snapshotOf(TWO_SIGNED_IN)),
  );
  readonly state = jest.fn((_provider: 'claude') => this.view.asReadonly());
  readonly open = jest.fn(async (_provider: 'claude') => undefined);
  resolve: (outcome: ProviderAccountActionOutcome) => void = () => undefined;
  readonly setSelection = jest.fn(
    (_provider: 'claude', _scope: 'main' | 'lane', _choice: ProviderAccountChoice) =>
      new Promise<ProviderAccountActionOutcome>((resolve) => {
        this.resolve = resolve;
      }),
  );
}
class AmbientFake {
  readonly view = signal<ClaudeAmbientStatusView>(CONNECTED);
  readonly read = jest.fn(async (_refresh: boolean) => undefined);
}

describe('ClaudeLaneAccountCellComponent', () => {
  let fixture: ComponentFixture<ClaudeLaneAccountCellComponent>;
  let accounts: AccountsFake;
  let ambient: AmbientFake;
  let announce: jest.Mock;
  const element = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
    element().querySelector<T>(selector);
  const trigger = () =>
    q<HTMLButtonElement>('[data-testid="cli-matrix-account-trigger"]');
  const menu = () => q('[role="menu"]');
  const items = () =>
    Array.from(
      element().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
  const item = (value: string) =>
    q<HTMLButtonElement>(`[role="menuitemradio"][data-value="${value}"]`);

  async function settle() {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
    }
  }
  function setup(
    options: {
      isElectron?: boolean;
      view?: ProviderAccountsView;
      ambientView?: ClaudeAmbientStatusView;
    } = {},
  ) {
    accounts = new AccountsFake();
    ambient = new AmbientFake();
    if (options.view) accounts.view.set(options.view);
    if (options.ambientView) ambient.view.set(options.ambientView);
    announce = jest.fn();
    TestBed.configureTestingModule({
      imports: [ClaudeLaneAccountCellComponent],
      providers: [
        { provide: VSCodeService, useValue: { isElectron: options.isElectron ?? true } },
        { provide: ProviderAccountsStateService, useValue: accounts },
        { provide: ClaudeAmbientStatusService, useValue: ambient },
        { provide: SettingsSaveFeedbackService, useValue: { announce } },
      ],
    });
    fixture = TestBed.createComponent(ClaudeLaneAccountCellComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }
  async function openMenu() {
    // Chromium focuses a clicked button; jsdom does not.
    trigger()?.focus();
    trigger()?.click();
    fixture.detectChanges();
    await settle();
  }
  function key(target: HTMLElement, name: string, shiftKey = false) {
    const event = new KeyboardEvent('keydown', {
      key: name,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  describe('visibility (L1, State contract 1-2)', () => {
    it('reads the accounts and the cached ambient answer once on mount', () => {
      setup();
      expect(accounts.open).toHaveBeenCalledTimes(1);
      expect(accounts.open).toHaveBeenCalledWith('claude');
      expect(ambient.read).toHaveBeenCalledTimes(1);
      expect(ambient.read).toHaveBeenCalledWith(false);
    });

    it('renders nothing and reads nothing off Electron', () => {
      setup({ isElectron: false });
      expect(trigger()).toBeNull();
      expect(accounts.open).not.toHaveBeenCalled();
      expect(ambient.read).not.toHaveBeenCalled();
      expect(accounts.state).not.toHaveBeenCalled();
    });

    it('is absent before the first snapshot and when only the existing login is usable', () => {
      setup({
        view: { status: 'loading', stale: false, error: null, snapshot: null },
      });
      expect(trigger()).toBeNull();
      accounts.view.set(readyView(snapshotOf([account('p-3', 'not-signed-in')])));
      fixture.detectChanges();
      expect(trigger()).toBeNull();
      accounts.view.set(readyView(snapshotOf(TWO_SIGNED_IN)));
      fixture.detectChanges();
      expect(trigger()).not.toBeNull();
    });
  });

  describe('cell (L2-L4b)', () => {
    it('shows the stored value with the label, aria and title of the spec', () => {
      setup();
      const cell = q('[data-testid="cli-matrix-account"]');
      expect(cell?.querySelector('span')?.textContent?.trim()).toBe('Account');
      const button = trigger();
      expect(button?.textContent?.trim()).toBe('Existing Claude login');
      expect(button?.getAttribute('aria-label')).toBe(
        'Claude account: Existing Claude login. Change',
      );
      expect(button?.getAttribute('aria-haspopup')).toBe('menu');
      expect(button?.getAttribute('aria-expanded')).toBe('false');
      expect(button?.title).toBe('Existing Claude login');
      expect(button?.className).toContain('max-w-[13rem]');
      expect(button?.querySelector('span')?.className).toContain('truncate');
    });

    it('keeps the ambient suffix from a ready answer (D60)', () => {
      setup({
        ambientView: {
          status: 'ready',
          localFailure: false,
          result: { state: 'signed-out', checkedAt: '2026-10-26T10:00:00.000Z' },
        },
      });
      expect(trigger()?.textContent?.trim()).toMatch(
        /^Existing Claude login \(.+\)$/,
      );
    });

    it('shows a long stored name in full in the title', () => {
      const long = 'A very long account name that goes on and on past the cell';
      setup({
        view: readyView(
          snapshotOf([account('p-1', 'signed-in', long)], {
            kind: 'named',
            profileId: 'p-1',
          }),
        ),
      });
      expect(trigger()?.textContent?.trim()).toBe(long);
      expect(trigger()?.title).toBe(long);
    });

    it('shows a signed-out stored account as checked and disabled (L4a)', async () => {
      setup({
        view: readyView(
          snapshotOf(TWO_SIGNED_IN, { kind: 'named', profileId: 'p-3' }),
        ),
      });
      expect(trigger()?.textContent?.trim()).toBe('Account p-3 (not signed in)');
      await openMenu();
      const stored = item('stored');
      expect(stored?.getAttribute('aria-checked')).toBe('true');
      expect(stored?.getAttribute('aria-disabled')).toBe('true');
      expect(stored?.tabIndex).toBe(0);
      expect(item('named:p-1')?.getAttribute('aria-disabled')).toBeNull();
    });

    it('shows a removed stored account with its sr-only sentence and never reassigns (L4b, B-1)', async () => {
      setup({
        view: readyView(
          snapshotOf(TWO_SIGNED_IN, { kind: 'named', profileId: 'gone' }),
        ),
      });
      expect(trigger()?.textContent?.trim()).toBe(ACCOUNT_COPY.removedOption);
      await openMenu();
      const stored = item('stored');
      expect(stored?.getAttribute('aria-checked')).toBe('true');
      expect(stored?.querySelector('.sr-only')?.textContent).toBe(
        ACCOUNT_COPY.removedAccount,
      );
      expect(accounts.setSelection).not.toHaveBeenCalled();
    });
  });

  describe('menu', () => {
    it('is a labelled menu of menuitemradio items with a roving tabindex', async () => {
      setup();
      await openMenu();
      expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
      const title = q('h3');
      expect(title?.textContent?.trim()).toBe('Account');
      expect(menu()?.getAttribute('aria-labelledby')).toBe(title?.id);
      expect(items().map((node) => node.getAttribute('data-value'))).toEqual([
        'ambient',
        'named:p-1',
        'named:p-2',
        'named:p-3',
      ]);
      expect(items().map((node) => node.tabIndex)).toEqual([0, -1, -1, -1]);
      expect(item('ambient')?.getAttribute('aria-checked')).toBe('true');
      expect(item('named:p-3')?.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(item('ambient'));
    });

    it('moves focus only with the arrows (wrapping), Home and End', async () => {
      setup();
      await openMenu();
      item('ambient')?.focus();
      key(item('ambient') as HTMLElement, 'ArrowUp');
      expect(document.activeElement).toBe(item('named:p-3'));
      key(item('named:p-3') as HTMLElement, 'ArrowDown');
      expect(document.activeElement).toBe(item('ambient'));
      key(item('ambient') as HTMLElement, 'ArrowDown');
      expect(document.activeElement).toBe(item('named:p-1'));
      key(item('named:p-1') as HTMLElement, 'End');
      expect(document.activeElement).toBe(item('named:p-3'));
      key(item('named:p-3') as HTMLElement, 'Home');
      expect(document.activeElement).toBe(item('ambient'));
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(menu()).not.toBeNull();
    });

    it('ignores disabled items and the stored value', async () => {
      setup();
      await openMenu();
      key(item('named:p-3') as HTMLElement, 'Enter');
      item('named:p-3')?.click();
      key(item('ambient') as HTMLElement, ' ');
      fixture.detectChanges();
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(menu()).not.toBeNull();
    });

    it.each(['Escape', 'Tab'])(
      '%s closes the menu and focuses the trigger',
      async (name) => {
        setup();
        await openMenu();
        const event = key(item('ambient') as HTMLElement, name);
        await settle();
        expect(event.defaultPrevented).toBe(true);
        expect(menu()).toBeNull();
        expect(document.activeElement).toBe(trigger());
      },
    );

    it('Shift+Tab closes the menu and focuses the trigger (P6-A7)', async () => {
      setup();
      await openMenu();
      key(item('named:p-1') as HTMLElement, 'Tab', true);
      await settle();
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('Close closes the menu and focuses the trigger', async () => {
      setup();
      await openMenu();
      q<HTMLButtonElement>('[data-testid="cli-matrix-account-close"]')?.click();
      await settle();
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });
  });

  describe('commit (L5, L6, B-1, B-2)', () => {
    it.each([
      ['Enter', (target: HTMLElement) => key(target, 'Enter')],
      ['Space', (target: HTMLElement) => key(target, ' ')],
      ['click', (target: HTMLElement) => target.click()],
    ])('%s saves the lane scope at once', async (_name, activate) => {
      setup();
      await openMenu();
      activate(item('named:p-1') as HTMLElement);
      fixture.detectChanges();
      expect(accounts.setSelection).toHaveBeenCalledTimes(1);
      expect(accounts.setSelection).toHaveBeenCalledWith('claude', 'lane', {
        kind: 'named',
        profileId: 'p-1',
      });
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('is busy while saving, ignores repeats, and keeps the stored value (B-1)', async () => {
      setup();
      await openMenu();
      item('named:p-1')?.click();
      fixture.detectChanges();
      const button = trigger() as HTMLButtonElement;
      expect(button.textContent?.trim()).toBe('Saving…');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.disabled).toBe(false);
      button.click();
      fixture.detectChanges();
      expect(menu()).toBeNull();
      expect(button.getAttribute('aria-label')).toBe(
        'Claude account: Existing Claude login. Change',
      );

      accounts.resolve({
        status: 'saved',
        snapshot: snapshotOf(TWO_SIGNED_IN, { kind: 'named', profileId: 'p-1' }),
      });
      await settle();
      expect(announce).toHaveBeenCalledWith('Lanes use Account p-1', 'status');
      // The cell follows the held snapshot only; the stub was not pushed.
      expect(trigger()?.textContent?.trim()).toBe('Existing Claude login');
      expect(trigger()?.getAttribute('aria-disabled')).toBeNull();
      expect(accounts.setSelection).toHaveBeenCalledTimes(1);
    });

    it('follows a pushed snapshot', async () => {
      setup();
      await openMenu();
      item('named:p-2')?.click();
      accounts.view.set(
        readyView(snapshotOf(TWO_SIGNED_IN, { kind: 'named', profileId: 'p-2' })),
      );
      accounts.resolve({
        status: 'saved',
        snapshot: snapshotOf(TWO_SIGNED_IN, { kind: 'named', profileId: 'p-2' }),
      });
      await settle();
      expect(trigger()?.textContent?.trim()).toBe('Account p-2');
    });

    it.each<[string, ProviderAccountActionOutcome, string]>([
      [
        'failed with a safe sentence',
        {
          status: 'failed',
          result: { code: 'missing-profile', summary: 'That account was removed.' },
        },
        'That account was removed.',
      ],
      [
        'failed with an unsafe sentence',
        { status: 'failed', result: { code: 'missing-profile', summary: ' x' } },
        ACCOUNT_COPY.saveFailed,
      ],
      ['unavailable', { status: 'unavailable' }, ACCOUNT_COPY.saveFailed],
      ['unconfirmed', { status: 'unconfirmed' }, ACCOUNT_COPY.unconfirmed],
    ])('%s: alert toast, cell keeps the stored value', async (_name, outcome, message) => {
      setup();
      await openMenu();
      item('named:p-1')?.click();
      accounts.resolve(outcome);
      await settle();
      expect(announce).toHaveBeenCalledWith(message, 'alert');
      expect(trigger()?.textContent?.trim()).toBe('Existing Claude login');
    });

    it('shows no toast when the saved snapshot names an unlisted account (D60)', async () => {
      setup();
      await openMenu();
      item('named:p-1')?.click();
      accounts.resolve({
        status: 'saved',
        snapshot: snapshotOf(TWO_SIGNED_IN, { kind: 'named', profileId: 'gone' }),
      });
      await settle();
      expect(announce).not.toHaveBeenCalled();
    });

    it('never moves focus after the result when the user moved it (B-2)', async () => {
      setup();
      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      await openMenu();
      item('named:p-1')?.click();
      fixture.detectChanges();
      elsewhere.focus();
      accounts.resolve({
        status: 'saved',
        snapshot: snapshotOf(TWO_SIGNED_IN, { kind: 'named', profileId: 'p-1' }),
      });
      await settle();
      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it('moves no focus and does not throw when destroyed during the save (B-2)', async () => {
      setup();
      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      await openMenu();
      item('named:p-1')?.click();
      fixture.detectChanges();
      fixture.destroy();
      elsewhere.focus();
      accounts.resolve({ status: 'unconfirmed' });
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(document.activeElement).toBe(elsewhere);
      expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.unconfirmed, 'alert');
      elsewhere.remove();
    });
  });
});
