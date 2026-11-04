import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CodexSignInService } from '@ptah-extension/core';
import { OnboardingAnnouncerService } from '../shell/onboarding-announcer.service';
import { signal } from '@angular/core';
import { ProviderPanelComponent } from './provider-panel.component';
import type { ProviderReadinessView } from './provider-readiness.derive';

const base: ProviderReadinessView = { provider: 'openai-codex', state: 'signed-out', errorCause: null,
  failedFact: null, path: '/usr/bin/codex', version: '1.0', source: 'installed' };

describe('ProviderPanelComponent', () => {
  it.each([
    ['Claude', 'claude-cli', 'Operating system'],
    ['Codex', 'openai-codex', 'Install method for Codex'],
  ] as const)('(parity row 25) %s OS tabs wrap in both directions and move focus', (_name, provider, tablistLabel) => {
    const fixture = TestBed.configureTestingModule({ imports: [ProviderPanelComponent], providers: [
      provideRouter([]),
      { provide: CodexSignInService, useValue: { state: signal(null), nothingSeen: signal(false) } },
      { provide: OnboardingAnnouncerService, useValue: { announce: jest.fn() } },
    ] }).createComponent(ProviderPanelComponent);
    fixture.componentRef.setInput('view', { ...base, provider, state: 'missing', path: null, version: null });
    fixture.componentRef.setInput('role', 'main');
    fixture.componentRef.setInput('platform', 'linux');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    const tablist = element.querySelector<HTMLElement>(`[role="tablist"][aria-label="${tablistLabel}"]`);
    expect(tablist).not.toBeNull();
    const tabs = [...(tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    expect(tabs.length).toBeGreaterThan(1);
    const first = tabs[0];
    const last = tabs[tabs.length - 1];

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(first.tabIndex).toBe(0);
    expect(document.activeElement).toBe(first);

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(last.getAttribute('aria-selected')).toBe('true');
    expect(last.tabIndex).toBe(0);
    expect(document.activeElement).toBe(last);
  });

  it('shows signed-out Codex help and keeps information help closed', () => {
    const fixture = TestBed.configureTestingModule({ imports: [ProviderPanelComponent], providers: [provideRouter([]), { provide: CodexSignInService, useValue: { state: signal(null), nothingSeen: signal(false) } }, { provide: OnboardingAnnouncerService, useValue: { announce: jest.fn() } }] })
      .createComponent(ProviderPanelComponent);
    fixture.componentRef.setInput('view', base);
    fixture.componentRef.setInput('role', 'information');
    fixture.componentRef.setInput('platform', 'linux');
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('details')?.open).toBe(false);
    expect(element.textContent).toContain('Not signed in');
  });
  it('hides Codex sign-in for unreadable home data', () => {
    const fixture = TestBed.configureTestingModule({ imports: [ProviderPanelComponent], providers: [provideRouter([]), { provide: CodexSignInService, useValue: { state: signal(null), nothingSeen: signal(false) } }, { provide: OnboardingAnnouncerService, useValue: { announce: jest.fn() } }] })
      .createComponent(ProviderPanelComponent);
    fixture.componentRef.setInput('view', { ...base, state: 'error', errorCause: 'home', failedFact: 'sign-in' });
    fixture.componentRef.setInput('role', 'main');
    fixture.componentRef.setInput('platform', 'linux');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('ptah-codex-sign-in-block')).toBeNull();
  });
});
