import { Component, computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ClaudeAmbientStatusView } from '@ptah-extension/core';
import type {
  ProviderAccountScope,
  ProviderAccountSelection,
  ProviderAccountState,
  ProviderAccountSummary,
  ProviderAccountsSnapshot,
} from '@ptah-extension/shared';
import {
  UNAVAILABLE_ACCOUNT_MESSAGE,
  UNAVAILABLE_ACCOUNT_OPTION,
  useForModel,
} from './account-presentation';
import {
  AccountUseForComponent,
  USE_FOR_HEADING_ID,
  type UseForScopeText,
  type UseForSelection,
} from './account-use-for.component';

const account = (
  profileId: string,
  label: string,
  state: ProviderAccountState = 'signed-in',
): ProviderAccountSummary => ({
  profileId,
  label,
  provider: 'claude',
  state,
  owner: 'unknown',
  revision: 1,
  activeRunCount: 0,
});

const snapshot = (
  accounts: readonly ProviderAccountSummary[],
  main: ProviderAccountSelection = { kind: 'omitted' },
  lane: ProviderAccountSelection = { kind: 'omitted' },
): ProviderAccountsSnapshot => ({
  provider: 'claude',
  workspaceRoot: 'workspace',
  revision: 3,
  accounts,
  selections: {
    main: { scope: 'main', selection: main, revision: 1 },
    lane: { scope: 'lane', selection: lane, revision: 1 },
  },
});

const WORK = account('p-work', 'Work', 'signed-in');
const TEAM = account('p-team', 'Team plan', 'not-signed-in');
const SIGNED_OUT: ClaudeAmbientStatusView = {
  status: 'ready',
  result: { state: 'signed-out', checkedAt: '2026-10-26T10:00:00.000Z' },
  localFailure: false,
};

@Component({
  standalone: true,
  imports: [AccountUseForComponent],
  template: `
    @if (shown()) {
      <ptah-account-use-for
        [model]="model()"
        [pendingScopes]="pending()"
        [messages]="messages()"
        [alerts]="alerts()"
        (selectionRequested)="onSelect($event)"
      />
    }
    <button type="button" data-testid="elsewhere">Elsewhere</button>
  `,
})
class Host {
  readonly shown = signal(true);
  readonly snapshot = signal(snapshot([TEAM, WORK]));
  readonly ambient = signal<ClaudeAmbientStatusView>(SIGNED_OUT);
  readonly model = computed(() => useForModel(this.snapshot(), this.ambient()));
  readonly pending = signal<ReadonlySet<ProviderAccountScope>>(new Set());
  readonly messages = signal<UseForScopeText>({ main: null, lane: null });
  readonly alerts = signal<UseForScopeText>({ main: null, lane: null });
  readonly requests: UseForSelection[] = [];
  /** Mirrors the parent: the write starts synchronously and its scope turns pending. */
  startWriteOnRequest = true;

  onSelect(request: UseForSelection): void {
    this.requests.push(request);
    if (this.startWriteOnRequest) this.pending.set(new Set([request.scope]));
  }
}

describe('AccountUseForComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T;
  const select = (scope: ProviderAccountScope) => q<HTMLSelectElement>(`use-for-select-${scope}`);
  const status = (scope: ProviderAccountScope) => q(`use-for-status-${scope}`);
  const options = (scope: ProviderAccountScope) =>
    Array.from(select(scope).options).map((o) => ({ text: o.text, value: o.value, disabled: o.disabled }));
  const choose = (scope: ProviderAccountScope, value: string) => {
    const target = select(scope);
    target.focus();
    target.value = value;
    target.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
  });

  it('renders the heading, the two lines and a labelled select per scope', () => {
    const heading = el().querySelector('h3') as HTMLElement;
    expect(heading.id).toBe(USE_FOR_HEADING_ID);
    expect(heading.textContent?.trim()).toBe('Use for');
    const text = el().textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Changes apply to new sessions only. Credentials stay on this computer.');
    expect(text).toContain('This applies only while Claude sign-in is your main route.');
    expect(el().querySelector('label[for="account-use-for-main"]')?.textContent?.trim()).toBe('New chats');
    expect(el().querySelector('label[for="account-use-for-lane"]')?.textContent?.trim()).toBe('Claude lanes');
    expect(text).toContain('The account your next main chat uses.');
    expect(text).toContain('The account the next Claude lane uses.');
    expect(status('main').getAttribute('tabindex')).toBe('-1');
    expect(status('main').getAttribute('role')).toBe('status');
  });

  it('orders options: existing login with its suffix, signed-in, then disabled "sign in first"', () => {
    expect(options('main')).toEqual([
      { text: 'Existing Claude login (not signed in)', value: 'ambient', disabled: false },
      { text: 'Work', value: 'named:p-work', disabled: false },
      { text: 'Team plan (sign in first)', value: 'named:p-team', disabled: true },
    ]);
  });

  it('shows Existing Claude login selected for an omitted selection', () => {
    expect(select('main').value).toBe('ambient');
    expect(select('lane').value).toBe('ambient');
  });

  it('shows the stored named selection', () => {
    host.snapshot.set(snapshot([TEAM, WORK], { kind: 'named', profileId: 'p-work' }));
    fixture.detectChanges();
    expect(select('main').value).toBe('named:p-work');
    expect(select('lane').value).toBe('ambient');
  });

  it('shows any absent named target generically as the disabled unavailable placeholder (B-1)', () => {
    const absentId = `p-${Math.random().toString(36).slice(2)}`;
    host.snapshot.set(snapshot([TEAM, WORK], { kind: 'ambient' }, { kind: 'named', profileId: absentId }));
    fixture.detectChanges();
    expect(select('lane').value).toBe('unavailable');
    const first = select('lane').options[0];
    expect(first.text).toBe(UNAVAILABLE_ACCOUNT_OPTION);
    expect(first.disabled).toBe(true);
    expect(q('use-for-unavailable-lane').textContent).toBe(UNAVAILABLE_ACCOUNT_MESSAGE);
    expect(select('lane').getAttribute('aria-describedby')).toContain('account-use-for-lane-unavailable');
    expect(el().textContent).not.toContain(absentId);
    expect(select('main').value).toBe('ambient');
  });

  it('keeps the old selection after the selected account is removed until the host snapshot arrives (B-1)', () => {
    host.snapshot.set(snapshot([TEAM, WORK], { kind: 'named', profileId: 'p-work' }));
    fixture.detectChanges();
    // The account leaves the list but the host has not committed a new selection: nothing is reassigned.
    host.snapshot.set(snapshot([TEAM], { kind: 'named', profileId: 'p-work' }));
    fixture.detectChanges();
    expect(select('main').value).toBe('unavailable');
    expect(host.requests).toEqual([]);
    // The host's committed snapshot decides what is shown next.
    host.snapshot.set(snapshot([TEAM], { kind: 'omitted' }));
    fixture.detectChanges();
    expect(select('main').value).toBe('ambient');
    expect(q('use-for-unavailable-main')).toBeNull();
  });

  it('emits only for a different, enabled value', () => {
    choose('main', 'ambient');
    expect(host.requests).toEqual([]);
    choose('main', 'named:p-team');
    expect(host.requests).toEqual([]);
    choose('lane', 'named:p-work');
    expect(host.requests).toEqual([{ scope: 'lane', choice: { kind: 'named', profileId: 'p-work' } }]);
  });

  it('maps the existing login to an ambient choice', () => {
    host.snapshot.set(snapshot([TEAM, WORK], { kind: 'named', profileId: 'p-work' }));
    fixture.detectChanges();
    choose('main', 'ambient');
    expect(host.requests).toEqual([{ scope: 'main', choice: { kind: 'ambient' } }]);
  });

  it('disables only the pending scope, with aria-busy and Saving…', () => {
    choose('lane', 'named:p-work');
    expect(select('lane').disabled).toBe(true);
    expect(select('lane').getAttribute('aria-busy')).toBe('true');
    expect(status('lane').textContent).toBe('Saving…');
    expect(select('main').disabled).toBe(false);
    expect(select('main').getAttribute('aria-busy')).toBe('false');
  });

  it('reverts the DOM value to the stored selection after a refusal and shows the alert', () => {
    choose('lane', 'named:p-work');
    host.pending.set(new Set());
    host.alerts.set({ main: null, lane: 'That account is not available for Claude lanes right now.' });
    fixture.detectChanges();
    expect(select('lane').value).toBe('ambient');
    const alert = q('use-for-alert-lane');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('not available for Claude lanes');
  });

  it('keeps the last snapshot value after an unconfirmed write and shows the warning', () => {
    choose('main', 'named:p-work');
    host.pending.set(new Set());
    host.messages.set({ main: 'This action may not have completed. Accounts were reloaded.', lane: null });
    fixture.detectChanges();
    expect(select('main').value).toBe('ambient');
    expect(status('main').textContent).toContain('may not have completed');
  });

  it('moves focus to the status line, then back to the select when focus is still there (B-2)', () => {
    choose('main', 'named:p-work');
    expect(document.activeElement).toBe(status('main'));
    host.snapshot.set(snapshot([TEAM, WORK], { kind: 'named', profileId: 'p-work' }));
    host.pending.set(new Set());
    fixture.detectChanges();
    expect(document.activeElement).toBe(select('main'));
    expect(select('main').value).toBe('named:p-work');
  });

  it('leaves focus where the user moved it and announces the outcome (B-2)', () => {
    choose('main', 'named:p-work');
    const elsewhere = q<HTMLButtonElement>('elsewhere');
    elsewhere.focus();
    host.pending.set(new Set());
    host.messages.set({ main: 'This action may not have completed. Accounts were reloaded.', lane: null });
    fixture.detectChanges();
    expect(document.activeElement).toBe(elsewhere);
    expect(status('main').getAttribute('aria-live')).toBe('polite');
    expect(status('main').textContent).toContain('may not have completed');
  });

  it('returns focus at once when the parent starts no write', () => {
    host.startWriteOnRequest = false;
    choose('main', 'named:p-work');
    expect(document.activeElement).toBe(select('main'));
  });

  it('renders account names as text, never markup', () => {
    host.snapshot.set(snapshot([account('p-x', '<b>bold</b>')]));
    fixture.detectChanges();
    expect(el().querySelector('b')).toBeNull();
    expect(options('main')[1].text).toBe('<b>bold</b>');
  });
});
