import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { CodexSignInService } from '@ptah-extension/core';
import type { CodexLoginState } from '@ptah-extension/shared';
import { CodexSignInBlockComponent } from './codex-sign-in-block.component';

const base: CodexLoginState = { attemptId: 'one', mode: 'browser', status: 'running' };

describe('CodexSignInBlockComponent', () => {
  const state = signal<CodexLoginState | null>(null);
  const nothingSeen = signal(false);
  const refreshFailed = signal(false);
  const checkAuthStatus = jest.fn(async () => undefined);
  const start = jest.fn(async () => undefined);
  const restart = jest.fn(async (_mode?: 'browser' | 'device') => undefined);
  const cancel = jest.fn(async () => undefined);
  let fixture: ComponentFixture<CodexSignInBlockComponent>;
  let element: HTMLElement;
  const button = (label: string) => [...element.querySelectorAll('button')].find(node => node.textContent?.trim() === label);
  const render = (next: CodexLoginState | null, role: 'chosen' | 'information' = 'chosen') => {
    state.set(next);
    fixture.componentRef.setInput('role', role);
    fixture.detectChanges();
  };

  beforeEach(() => {
    state.set(null);
    nothingSeen.set(false);
    refreshFailed.set(false);
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [CodexSignInBlockComponent],
      providers: [{ provide: CodexSignInService, useValue: { state, nothingSeen, refreshFailed, checkAuthStatus, start, restart, cancel } }],
    });
    fixture = TestBed.createComponent(CodexSignInBlockComponent);
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('renders the installed and bundled ready states', () => {
    fixture.componentRef.setInput('terminalCommand', 'codex login');
    render(null);
    expect(button('Sign in with Codex')).toBeTruthy();
    expect(element.textContent).toContain('codex login');
    fixture.componentRef.setInput('terminalCommand', '"/opt/codex" login');
    fixture.componentRef.setInput('bundledNote', true);
    fixture.detectChanges();
    expect(element.textContent).toContain('bundled copy');
    button('Sign in with Codex')?.click();
    expect(start).toHaveBeenCalled();
  });

  it('keeps starting and empty running states neutral about the browser', () => {
    render({ ...base, status: 'starting' });
    expect(element.textContent).toContain('Ptah is starting Codex');
    expect(element.textContent).not.toContain('opened the sign-in page');
    render(base);
    expect(element.textContent).toContain('waiting for it to show');
    expect(element.textContent).not.toContain('browser opened');
  });

  it('offers recovery after 20 seconds without evidence', () => {
    nothingSeen.set(true);
    render(base);
    expect(element.textContent).toContain('cannot tell whether a browser opened');
    button('Try again')?.click();
    button('Use a device code')?.click();
    expect(restart).toHaveBeenCalledWith();
    expect(restart).toHaveBeenCalledWith('device');
  });

  it('renders a validated link, device code, and browser result only with evidence', () => {
    render({ ...base, status: 'awaiting-user', verificationUrl: 'https://example.com/sign-in', userCode: 'K7QF-3M9PX', browserOpened: true });
    expect(element.textContent).toContain('opened the sign-in page');
    expect(element.querySelector('code')?.getAttribute('aria-label')).toContain('dash');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('https://example.com/sign-in');
    render({ ...base, status: 'awaiting-user', verificationUrl: 'https://example.com', browserOpened: false });
    expect(element.textContent).toContain('could not open your browser');
    render({ ...base, status: 'awaiting-user', verificationUrl: 'http://example.com' });
    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('code')).toBeNull();
  });

  it.each(['chosen', 'information'] as const)('maps completion and failure states for %s', role => {
    render({ ...base, status: 'succeeded' }, role);
    expect(element.textContent).toContain('checking your sign-in');
    render({ ...base, status: 'failed', errorCode: 'exited', exitCode: 1 }, role);
    expect(element.textContent).toContain('exit code 1');
    expect(element.querySelector('[data-testid="codex-sign-in-block"]')?.getAttribute('role')).toBe(role === 'chosen' ? 'alert' : 'status');
    render({ ...base, status: 'failed', errorCode: 'timeout' }, role);
    expect(element.textContent).toContain('stopped waiting after 10 minutes');
    render({ ...base, status: 'cancelled' }, role);
    expect(element.textContent).toContain('Nothing was changed');
    expect(element.querySelector('[data-testid="codex-sign-in-block"]')?.getAttribute('role')).toBe('status');
  });

  it('shows a confirmation failure with a retry action', () => {
    refreshFailed.set(true);
    render({ ...base, status: 'succeeded' });
    expect(element.textContent).toContain('Signed in, but Ptah could not confirm it.');
    expect(element.querySelector('[data-testid="codex-sign-in-block"]')?.getAttribute('role')).toBe('alert');
    button('Check again')?.click();
    expect(checkAuthStatus).toHaveBeenCalledTimes(1);
  });
});
