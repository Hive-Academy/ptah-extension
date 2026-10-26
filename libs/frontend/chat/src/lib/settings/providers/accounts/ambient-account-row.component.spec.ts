import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ClaudeAmbientStatusView } from '@ptah-extension/core';
import { AmbientAccountRowComponent } from './ambient-account-row.component';

@Component({
  standalone: true,
  imports: [AmbientAccountRowComponent],
  template: `
    @if (shown()) {
      <ptah-ambient-account-row [ambient]="ambient()" [chips]="chips()" (checkRequested)="onCheck()" />
    }
    <button type="button" data-testid="elsewhere">Elsewhere</button>
  `,
})
class Host {
  readonly shown = signal(true);
  readonly ambient = signal<ClaudeAmbientStatusView>({ status: 'idle', result: null, localFailure: false });
  readonly chips = signal<readonly string[]>([]);
  checks = 0;
  /** Mirrors the parent: the read starts synchronously and the view turns to checking. */
  startCheckOnRequest = true;

  onCheck(): void {
    this.checks += 1;
    if (this.startCheckOnRequest) this.ambient.update((view) => ({ ...view, status: 'checking' }));
  }
}

const CHECKED_AT = '2026-10-26T10:00:00.000Z';
const connected = (checkedAt: string | null = CHECKED_AT): ClaudeAmbientStatusView => ({
  status: 'ready',
  result: { state: 'connected', checkedAt },
  localFailure: false,
});

describe('AmbientAccountRowComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const status = () => q('ambient-status') as HTMLElement;
  const checkButton = () => q<HTMLButtonElement>('ambient-check-again') as HTMLButtonElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';

  // Synchronous change detection: the clock is faked, so no scheduler wait is used.
  const render = async () => {
    fixture.detectChanges();
  };

  beforeEach(async () => {
    jest.useFakeTimers({ now: Date.parse(CHECKED_AT) + 2 * 60_000 });
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    jest.useRealTimers();
  });

  it('shows Connected with dot, age and an enabled Check again', async () => {
    host.ambient.set(connected());
    await render();
    expect(status().textContent).toContain('Connected');
    expect(status().getAttribute('role')).toBe('status');
    expect(q('ambient-dot')?.className).toContain('bg-state-done');
    expect(q('ambient-age')?.textContent?.trim()).toBe('Last checked 2 minutes ago');
    expect(checkButton().disabled).toBe(false);
    expect(checkButton().getAttribute('aria-label')).toBe('Check the existing Claude login again');
    expect(text()).toContain('The Claude login already on this computer. Ptah only reads its status here.');
  });

  it('shows Not signed in with the CLI help', async () => {
    host.ambient.set({ status: 'ready', result: { state: 'signed-out', checkedAt: CHECKED_AT }, localFailure: false });
    await render();
    expect(status().textContent).toContain('Not signed in');
    expect(q('ambient-extra')?.textContent).toContain('Sign in with the Claude CLI in a terminal.');
    expect(q('ambient-dot')?.className).toContain('bg-state-need');
  });

  it('shows Could not check with "Last check failed" for host unknown', async () => {
    host.ambient.set({
      status: 'ready',
      result: { state: 'unknown', checkedAt: CHECKED_AT, reason: 'cli-missing' },
      localFailure: false,
    });
    await render();
    expect(status().textContent).toContain('Could not check');
    expect(q('ambient-age')?.textContent?.trim()).toBe('Last check failed 2 minutes ago');
  });

  it('shows Could not check with no age line after a local failure', async () => {
    host.ambient.set({ status: 'ready', result: null, localFailure: true });
    await render();
    expect(status().textContent).toContain('Could not check');
    expect(q('ambient-age')).toBeNull();
  });

  it('never shows Connected while checking and disables Check again', async () => {
    host.ambient.set({ ...connected(), status: 'checking' });
    await render();
    expect(status().textContent).toContain('Checking…');
    expect(text()).not.toContain('Connected');
    expect(q('ambient-age')).toBeNull();
    expect(q('ambient-spinner')?.getAttribute('aria-hidden')).toBe('true');
    expect(q('ambient-spinner')?.className).toContain('motion-reduce:animate-none');
    expect(checkButton().disabled).toBe(true);
  });

  it('emits once per press and not while checking', async () => {
    host.ambient.set(connected());
    await render();
    checkButton().click();
    await render();
    expect(host.checks).toBe(1);
    checkButton().click();
    await render();
    expect(host.checks).toBe(1);
  });

  it('returns focus to Check again when focus is still on the status (B-2)', async () => {
    host.ambient.set(connected());
    await render();
    checkButton().focus();
    checkButton().click();
    await render();
    expect(document.activeElement).toBe(status());
    // Programmatic-only focus target: no focus box, even under the glass theme's global :focus-visible ring.
    expect(status().className).toContain('focus:!outline-none');
    expect(status().className).toContain('focus:!shadow-none');
    host.ambient.set(connected('2026-10-26T10:02:00.000Z'));
    await render();
    expect(document.activeElement).toBe(checkButton());
    expect(status().textContent).toContain('Connected');
  });

  it('keeps the user focus elsewhere and announces the result in the status (B-2)', async () => {
    host.ambient.set(connected());
    await render();
    checkButton().focus();
    checkButton().click();
    await render();
    const elsewhere = q<HTMLButtonElement>('elsewhere') as HTMLButtonElement;
    elsewhere.focus();
    host.ambient.set({ status: 'ready', result: null, localFailure: true });
    await render();
    expect(document.activeElement).toBe(elsewhere);
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toContain('Could not check');
  });

  it('refreshes the age line every 30 seconds while mounted and stops after destroy', async () => {
    host.ambient.set(connected());
    await render();
    expect(q('ambient-age')?.textContent?.trim()).toBe('Last checked 2 minutes ago');
    jest.advanceTimersByTime(60_000);
    await render();
    expect(q('ambient-age')?.textContent?.trim()).toBe('Last checked 3 minutes ago');
    host.shown.set(false);
    await render();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('renders chips as text nodes', async () => {
    host.ambient.set(connected());
    host.chips.set(['Used for: New chats', '<b>bold</b>']);
    await render();
    const chips = q('ambient-chips') as HTMLElement;
    expect(chips.textContent).toContain('Used for: New chats');
    expect(chips.textContent).toContain('<b>bold</b>');
    expect(chips.querySelector('b')).toBeNull();
  });
});
