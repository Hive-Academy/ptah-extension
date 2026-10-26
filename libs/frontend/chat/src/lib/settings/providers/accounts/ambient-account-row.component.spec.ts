import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ClaudeAmbientStatusView } from '@ptah-extension/core';
import { isDisabledControl } from '../../feedback/busy-disabled.testing';
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
const signedOut: ClaudeAmbientStatusView = {
  status: 'ready',
  result: { state: 'signed-out', checkedAt: CHECKED_AT },
  localFailure: false,
};
const SIGNED_OUT_CUE = 'Sign in with the Claude CLI in a terminal.';
const UNKNOWN_CUE = 'The status could not be read. This does not mean you are signed out.';

describe('AmbientAccountRowComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const word = () => q('ambient-status') as HTMLElement;
  const hint = () => q('ambient-hint');
  const checkButton = () => q<HTMLButtonElement>('ambient-check');
  const name = () => q('ambient-name') as HTMLElement;

  // Synchronous change detection: the clock is faked, so no scheduler wait is used.
  const render = () => fixture.detectChanges();

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

  it('shows Signed in with the age only in the tooltip and sr-only text, and no Check', () => {
    host.ambient.set(connected());
    render();
    expect(name().textContent?.trim()).toBe('Existing Claude login');
    expect(word().textContent?.trim()).toBe('Signed in');
    expect(word().getAttribute('title')).toBe('Last checked 2 minutes ago.');
    expect(hint()?.className).toContain('sr-only');
    expect(hint()?.textContent).toBe('Last checked 2 minutes ago.');
    expect(q('ambient-dot')?.className).toContain('bg-state-done');
    expect(checkButton()).toBeNull();
  });

  it('has no helper sentence and no status live region', () => {
    host.ambient.set(connected());
    render();
    expect(el().textContent).not.toContain('Ptah only reads its status here');
    expect(el().querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    expect(q('ambient-account-row')?.getAttribute('aria-labelledby')).toBe(name().id);
  });

  it('shows Not signed in with the D54 cue in the tooltip and sr-only, plus Check', () => {
    host.ambient.set(signedOut);
    render();
    expect(word().textContent?.trim()).toBe('Not signed in');
    expect(word().getAttribute('title')).toBe(`${SIGNED_OUT_CUE} Last checked 2 minutes ago.`);
    expect(hint()?.textContent).toBe(`${SIGNED_OUT_CUE} Last checked 2 minutes ago.`);
    expect(q('ambient-dot')?.className).toContain('bg-state-need');
    expect(checkButton()?.textContent?.trim()).toBe('Check');
    expect(isDisabledControl(checkButton())).toBe(false);
  });

  it('shows Status unknown with the unknown cue and "Last check failed"', () => {
    host.ambient.set({
      status: 'ready',
      result: { state: 'unknown', checkedAt: CHECKED_AT, reason: 'cli-missing' },
      localFailure: false,
    });
    render();
    expect(word().textContent?.trim()).toBe('Status unknown');
    expect(hint()?.textContent).toBe(`${UNKNOWN_CUE} Last check failed 2 minutes ago.`);
    expect(checkButton()).not.toBeNull();
  });

  it('shows Status unknown with the cue and no age after a local failure', () => {
    host.ambient.set({ status: 'ready', result: null, localFailure: true });
    render();
    expect(word().textContent?.trim()).toBe('Status unknown');
    expect(hint()?.textContent).toBe(UNKNOWN_CUE);
  });

  it('has no tooltip and no sr-only hint when there is nothing to add', () => {
    host.ambient.set(connected(null));
    render();
    expect(word().hasAttribute('title')).toBe(false);
    expect(hint()).toBeNull();
  });

  it('while checking shows the spinner word and keeps Check focusable but busy', () => {
    host.ambient.set({ ...signedOut, status: 'checking' });
    render();
    expect(word().textContent?.trim()).toBe('Checking…');
    expect(q('ambient-spinner')?.getAttribute('aria-hidden')).toBe('true');
    expect(q('ambient-spinner')?.className).toContain('motion-reduce:animate-none');
    const button = checkButton() as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('emits once per press and not while checking', () => {
    host.ambient.set(signedOut);
    render();
    (checkButton() as HTMLButtonElement).click();
    render();
    expect(host.checks).toBe(1);
    (checkButton() as HTMLButtonElement).click();
    render();
    expect(host.checks).toBe(1);
  });

  it('moves focus to the row name when Check vanishes while focused (B-2)', () => {
    host.ambient.set(signedOut);
    render();
    const button = checkButton() as HTMLButtonElement;
    button.focus();
    button.click();
    render();
    expect(document.activeElement).toBe(button);
    host.ambient.set(connected('2026-10-26T10:02:00.000Z'));
    render();
    expect(checkButton()).toBeNull();
    expect(document.activeElement).toBe(name());
    expect(name().getAttribute('tabindex')).toBe('-1');
    expect(name().className).toContain('focus:!outline-none');
  });

  it('keeps focus where it is when Check stays (B-2)', () => {
    host.ambient.set(signedOut);
    render();
    const button = checkButton() as HTMLButtonElement;
    button.focus();
    button.click();
    render();
    host.ambient.set(signedOut);
    render();
    expect(document.activeElement).toBe(checkButton());
  });

  it('does not move focus when the user moved it before Check vanished (B-2)', () => {
    host.ambient.set(signedOut);
    render();
    (checkButton() as HTMLButtonElement).focus();
    (checkButton() as HTMLButtonElement).click();
    render();
    const elsewhere = q<HTMLButtonElement>('elsewhere') as HTMLButtonElement;
    elsewhere.focus();
    host.ambient.set(connected());
    render();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('refreshes the age every 30 seconds while mounted and stops after destroy', () => {
    host.ambient.set(connected());
    render();
    expect(hint()?.textContent).toBe('Last checked 2 minutes ago.');
    jest.advanceTimersByTime(60_000);
    render();
    expect(hint()?.textContent).toBe('Last checked 3 minutes ago.');
    host.shown.set(false);
    render();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('shows "Used by" chips as text nodes and omits the label when unused', () => {
    host.ambient.set(connected());
    render();
    expect(q('ambient-chips')).toBeNull();
    host.chips.set(['Chat', '<b>Lanes</b>']);
    render();
    const chips = q('ambient-chips') as HTMLElement;
    expect(chips.textContent).toContain('Used by');
    expect(chips.textContent).toContain('Chat');
    expect(chips.textContent).toContain('<b>Lanes</b>');
    expect(chips.querySelector('b')).toBeNull();
  });
});
