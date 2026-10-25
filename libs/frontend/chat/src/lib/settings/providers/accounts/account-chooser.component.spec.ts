import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ProviderAccountScope,
  ProviderAccountSelection,
  ProviderAccountSummary,
} from '@ptah-extension/shared';
import {
  AccountChooserComponent,
  type AccountChoiceIntent,
} from './account-chooser.component';

const account = (
  profileId: string,
  label: string,
  state: ProviderAccountSummary['state'],
): ProviderAccountSummary => ({
  profileId,
  label,
  provider: 'claude',
  state,
  owner: 'unknown',
  revision: 1,
  activeRunCount: 0,
});
const PERSONAL = account('claude-personal-a91f', 'Personal Claude', 'not-signed-in');
const WORK = account('claude-work-7c2a', 'Work Claude', 'signed-in');
const RESEARCH = account('claude-research-2bf0', 'Research Claude', 'disconnected');

@Component({
  standalone: true,
  imports: [AccountChooserComponent],
  template: `
    <button type="button" data-testid="opener" (click)="open.set(true)">Change</button>
    <ptah-account-chooser
      [open]="open()"
      [scope]="scope()"
      [accounts]="accounts()"
      [selection]="selection()"
      [pending]="pending()"
      [error]="error()"
      (chose)="chosen.push($event)"
      (closed)="open.set(false); closedCount = closedCount + 1"
    />
  `,
})
class Host {
  readonly open = signal(false);
  readonly scope = signal<ProviderAccountScope>('main');
  readonly accounts = signal<readonly ProviderAccountSummary[]>([]);
  readonly selection = signal<ProviderAccountSelection>({ kind: 'omitted' });
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);
  readonly chosen: AccountChoiceIntent[] = [];
  closedCount = 0;
}

describe('AccountChooserComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const options = () =>
    Array.from(
      el().querySelectorAll<HTMLButtonElement>(
        '[data-testid^="account-chooser-option-"]',
      ),
    );
  const dialog = () =>
    el().querySelector('dialog') as HTMLDialogElement;

  function openFromOpener(): HTMLButtonElement {
    const opener = q<HTMLButtonElement>('opener');
    if (!opener) throw new Error('no opener');
    opener.focus();
    opener.click();
    fixture.detectChanges();
    return opener;
  }

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('offers only Use existing default and the exact empty copy when there are no named accounts', () => {
    openFromOpener();
    expect(q('account-chooser-ambient')?.textContent).toContain(
      'Use existing default',
    );
    expect((q('account-chooser-ambient') as HTMLButtonElement).disabled).toBe(false);
    expect(options()).toHaveLength(0);
    expect(q('account-chooser-empty')?.textContent?.trim()).toBe(
      'No named Claude accounts yet.',
    );
    expect(q('account-chooser')?.textContent).toContain(
      'This changes only the selected future route.',
    );
  });

  it('lists signed-in profiles first, then every other profile with its own state, and never implies sign-in', () => {
    host.accounts.set([PERSONAL, WORK, RESEARCH]);
    openFromOpener();
    const rows = options();
    expect(rows.map((b) => b.getAttribute('data-testid'))).toEqual([
      'account-chooser-option-claude-work-7c2a',
      'account-chooser-option-claude-personal-a91f',
      'account-chooser-option-claude-research-2bf0',
    ]);
    expect(rows[0].textContent).toContain('Signed in · 7c2a');
    expect(rows[0].textContent).not.toContain('Sign in before using this profile.');
    expect(rows[1].textContent).toContain('Not signed in · a91f');
    expect(rows[1].textContent).toContain('Sign in before using this profile.');
    expect(rows[1].textContent).not.toContain('Signed in ·');
    expect(rows[2].textContent).toContain('Disconnected · 2bf0');
    expect(rows.every((b) => !b.disabled)).toBe(true);
    expect(q('account-chooser-empty')).toBeNull();
  });

  it('marks the stored selection as current without choosing anything implicitly', () => {
    host.accounts.set([WORK, PERSONAL]);
    openFromOpener();
    expect(q('account-chooser-ambient')?.getAttribute('aria-current')).toBe('true');
    host.selection.set({ kind: 'named', profileId: PERSONAL.profileId });
    fixture.detectChanges();
    expect(q('account-chooser-ambient')?.getAttribute('aria-current')).toBeNull();
    expect(
      q(`account-chooser-option-${PERSONAL.profileId}`)?.getAttribute('aria-current'),
    ).toBe('true');
    expect(host.chosen).toEqual([]);
  });

  it('does not select a newly added profile when the accounts input grows', () => {
    openFromOpener();
    host.accounts.set([account('claude-local-1a2b', 'New profile', 'not-signed-in')]);
    fixture.detectChanges();
    expect(q('account-chooser-ambient')?.getAttribute('aria-current')).toBe('true');
    expect(options()[0].getAttribute('aria-current')).toBeNull();
    expect(host.chosen).toEqual([]);
  });

  it('emits a main-scoped ambient or named intent', () => {
    host.accounts.set([WORK, PERSONAL]);
    openFromOpener();
    expect(q('account-chooser')?.textContent).toContain(
      'Choose account for next main session',
    );
    q<HTMLButtonElement>('account-chooser-ambient')?.click();
    q<HTMLButtonElement>(`account-chooser-option-${PERSONAL.profileId}`)?.click();
    expect(host.chosen).toEqual([
      { scope: 'main', choice: { kind: 'ambient' } },
      { scope: 'main', choice: { kind: 'named', profileId: PERSONAL.profileId } },
    ]);
  });

  it('emits a lane-scoped intent when opened for the Claude lane', () => {
    host.scope.set('lane');
    host.accounts.set([WORK]);
    openFromOpener();
    expect(q('account-chooser')?.textContent).toContain(
      'Choose account for next Claude lane',
    );
    q<HTMLButtonElement>(`account-chooser-option-${WORK.profileId}`)?.click();
    expect(host.chosen).toEqual([
      { scope: 'lane', choice: { kind: 'named', profileId: WORK.profileId } },
    ]);
  });

  it('uses native buttons for every choice so Enter and Space work from the keyboard', () => {
    host.accounts.set([WORK]);
    openFromOpener();
    const controls = [q('account-chooser-ambient'), ...options(), q('account-chooser-cancel')];
    for (const control of controls) {
      expect(control?.tagName).toBe('BUTTON');
      expect(control?.getAttribute('type')).toBe('button');
    }
  });

  it('returns focus to the opener on Cancel', () => {
    const opener = openFromOpener();
    q<HTMLButtonElement>('account-chooser-cancel')?.focus();
    q<HTMLButtonElement>('account-chooser-cancel')?.click();
    fixture.detectChanges();
    expect(host.closedCount).toBe(1);
    expect(host.open()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('requests closure on Escape and returns focus to the opener', () => {
    const opener = openFromOpener();
    q<HTMLButtonElement>('account-chooser-ambient')?.focus();
    dialog().dispatchEvent(new Event('cancel'));
    fixture.detectChanges();
    expect(host.closedCount).toBe(1);
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to the opener when the parent closes it after a committed choice', () => {
    host.accounts.set([WORK]);
    const opener = openFromOpener();
    const row = options()[0];
    row.focus();
    row.click();
    expect(host.chosen).toHaveLength(1);
    host.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(opener);
  });

  it('announces a pending write politely and blocks a second choice', () => {
    host.accounts.set([WORK]);
    openFromOpener();
    const status = q('account-chooser-status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent?.trim()).toBe('');
    host.pending.set(true);
    fixture.detectChanges();
    expect(status?.textContent?.trim()).toBe('Saving selection…');
    expect((q('account-chooser-ambient') as HTMLButtonElement).disabled).toBe(true);
    expect(options()[0].disabled).toBe(true);
    expect(host.chosen).toEqual([]);
  });

  it('announces a safe error sentence and replaces unsafe text with fixed copy', () => {
    openFromOpener();
    host.error.set('The selected profile changed. Choose again.');
    fixture.detectChanges();
    const alert = q('account-chooser-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent?.trim()).toBe('The selected profile changed. Choose again.');
    host.error.set('EACCES: C:\\Users\\me\\.claude-work\\credentials.json');
    fixture.detectChanges();
    expect(q('account-chooser-error')?.textContent?.trim()).toBe(
      'This action did not complete. Refresh and try again.',
    );
  });
});
