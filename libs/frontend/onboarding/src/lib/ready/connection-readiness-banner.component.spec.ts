import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConnectionReadinessBannerComponent } from './connection-readiness-banner.component';
import { deriveChosen, type ProviderReadinessState, type ProviderReadinessView, type SelectionView } from './provider-readiness.derive';

describe('ConnectionReadinessBannerComponent', () => {
  let fixture: ComponentFixture<ConnectionReadinessBannerComponent>;
  const readiness = (provider: ProviderReadinessView['provider'], state: ProviderReadinessState): ProviderReadinessView => ({
    provider, state, errorCause: state === 'error' ? 'timeout' : null,
    failedFact: null, path: null, version: null, source: null,
  });
  const chosen = (selection: SelectionView, claude: ProviderReadinessState, codex: ProviderReadinessState) =>
    deriveChosen(selection, readiness('claude-cli', claude), readiness('openai-codex', codex));
  function render(selection: SelectionView, claude: ProviderReadinessState, codex: ProviderReadinessState,
    placement: 'home' | 'settings' = 'home'): HTMLElement | null {
    TestBed.configureTestingModule({ imports: [ConnectionReadinessBannerComponent], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(ConnectionReadinessBannerComponent);
    fixture.componentRef.setInput('chosen', chosen(selection, claude, codex));
    fixture.componentRef.setInput('placement', placement);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('[data-testid="connection-readiness-banner"]');
  }
  afterEach(() => TestBed.resetTestingModule());

  it.each<[ProviderReadinessState, string, string]>([
    ['missing', 'Claude Code is not installed.', 'Install Claude Code'],
    ['signed-out', 'Claude Code is not signed in.', 'Sign in'],
    ['error', 'Ptah could not check Claude Code.', 'Check again'],
  ])('preserves Claude %s lead and action', (state, lead, action) => {
    const banner = render({ kind: 'claude-cli' }, state, 'ready');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toContain(lead);
    expect(banner?.textContent).toContain('Claude Code is your main connection. You can still pick a path.');
    expect(banner?.textContent).not.toContain('may fail');
    expect(banner?.querySelector('a')?.textContent?.trim()).toBe(action);
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe('/onboarding/ready');
  });
  it.each<[ProviderReadinessState, string, string]>([
    ['missing', 'Codex is not installed.', 'Install Codex'],
    ['signed-out', 'Codex is not signed in.', 'Sign in'],
    ['stale', 'Codex needs you to sign in again.', 'Sign in'],
    ['error', 'Ptah could not check Codex.', 'Check again'],
  ])('renders chosen Codex %s', (state, lead, action) => {
    const banner = render({ kind: 'openai-codex' }, 'ready', state);
    expect(banner?.textContent).toContain(lead);
    expect(banner?.querySelector('a')?.textContent?.trim()).toBe(action);
  });
  it.each<ProviderReadinessState>(['missing', 'signed-out', 'stale', 'error'])(
    'uses the settings action for %s', (state) => {
      const banner = render({ kind: 'openai-codex' }, 'ready', state, 'settings');
      expect(banner?.textContent).toContain('Codex is your main connection. You can keep going.');
      expect(banner?.querySelector('a')?.textContent?.trim()).toBe('Fix Codex');
    });
  it.each<ProviderReadinessState>(['checking', 'slow', 'ready'])(
    'hides the banner while chosen Codex is %s', (state) => {
      expect(render({ kind: 'openai-codex' }, 'missing', state)).toBeNull();
    });
  it('ignores missing Codex when Claude is ready', () => {
    expect(render({ kind: 'claude-cli' }, 'ready', 'missing')).toBeNull();
  });
  it('hides for loading, unreadable, not-confirmed and other selection', () => {
    for (const selection of [{ kind: 'loading' }, { kind: 'unreadable' }, { kind: 'not-confirmed' },
      { kind: 'other', name: 'API key' }] as SelectionView[]) {
      expect(render(selection, 'missing', 'missing')).toBeNull();
      TestBed.resetTestingModule();
    }
  });
  it('clears when the chosen connection becomes ready', () => {
    expect(render({ kind: 'claude-cli' }, 'missing', 'ready')).not.toBeNull();
    fixture.componentRef.setInput('chosen', chosen({ kind: 'claude-cli' }, 'ready', 'missing'));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="connection-readiness-banner"]')).toBeNull();
  });
});
