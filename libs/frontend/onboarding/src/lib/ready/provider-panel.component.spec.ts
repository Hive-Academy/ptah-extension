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
