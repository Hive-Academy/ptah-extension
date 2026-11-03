import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ClaudeReadinessState } from './claude-readiness.store';
import { ClaudeReadinessBannerComponent } from './claude-readiness-banner.component';

describe('ClaudeReadinessBannerComponent', () => {
  let fixture: ComponentFixture<ClaudeReadinessBannerComponent>;

  function render(
    state: ClaudeReadinessState,
    placement: 'home' | 'settings',
  ): HTMLElement | null {
    TestBed.configureTestingModule({
      imports: [ClaudeReadinessBannerComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(ClaudeReadinessBannerComponent);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('placement', placement);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="claude-readiness-banner"]',
    );
  }

  afterEach(() => TestBed.resetTestingModule());

  it.each<[ClaudeReadinessState, string, string]>([
    ['missing', 'Claude Code is not installed.', 'Install Claude Code'],
    ['signed-out', 'Claude Code is not signed in.', 'Sign in'],
    ['error', 'Ptah could not check Claude Code.', 'Check again'],
  ])('renders %s on Home with its lead and action', (state, lead, action) => {
    const banner = render(state, 'home');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toContain(lead);
    expect(banner?.textContent).toContain(
      'Analysis and agent generation may fail until it is ready. You can still pick a path.',
    );
    const link = banner?.querySelector('a');
    expect(link?.textContent?.trim()).toBe(action);
    expect(link?.getAttribute('href')).toBe('/onboarding/ready');
  });

  it.each<ClaudeReadinessState>(['missing', 'signed-out', 'error'])(
    'reads "Fix Claude Code" on stage 2 for %s',
    (state) => {
      const banner = render(state, 'settings');
      expect(banner?.textContent).toContain(
        'You can keep going; some steps may fail until it is ready.',
      );
      expect(banner?.querySelector('a')?.textContent?.trim()).toBe(
        'Fix Claude Code',
      );
    },
  );

  it.each<ClaudeReadinessState>(['checking', 'ready'])(
    'renders nothing for %s',
    (state) => {
      expect(render(state, 'home')).toBeNull();
    },
  );

  it('clears once the state becomes ready', () => {
    expect(render('missing', 'home')).not.toBeNull();
    fixture.componentRef.setInput('state', 'ready');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="claude-readiness-banner"]',
      ),
    ).toBeNull();
  });
});
