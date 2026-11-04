import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { deriveChosen, type ProviderReadinessState, type ProviderReadinessView, type SelectionView } from './provider-readiness.derive';
import { ReadyStripComponent } from './ready-strip.component';
import type { ReadyStripSettingsWord } from './ready-strip-state';

describe('ReadyStripComponent', () => {
  let fixture: ComponentFixture<ReadyStripComponent>;

  function render(
    current: 1 | 2 | 3,
    settings: ReadyStripSettingsWord = 'next',
  ): HTMLElement {
    TestBed.configureTestingModule({ imports: [ReadyStripComponent] });
    fixture = TestBed.createComponent(ReadyStripComponent);
    fixture.componentRef.setInput('current', current);
    const readiness: ProviderReadinessView = { provider: 'claude-cli', state: 'ready',
      errorCause: null, failedFact: null, path: null, version: null, source: null };
    fixture.componentRef.setInput('connection', deriveChosen({ kind: 'claude-cli' }, readiness, readiness));
    fixture.componentRef.setInput('settings', settings);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const item = (el: HTMLElement, step: number): HTMLElement =>
    el.querySelector(`li[data-step="${step}"]`) as HTMLElement;

  function renderConnection(selection: SelectionView, claude: ProviderReadinessState,
    codex: ProviderReadinessState): HTMLElement {
    const readiness = (provider: ProviderReadinessView['provider'], state: ProviderReadinessState): ProviderReadinessView => ({
      provider, state, errorCause: null, failedFact: null, path: null, version: null, source: null,
    });
    TestBed.configureTestingModule({ imports: [ReadyStripComponent] });
    fixture = TestBed.createComponent(ReadyStripComponent);
    fixture.componentRef.setInput('current', 1);
    fixture.componentRef.setInput('settings', 'next');
    fixture.componentRef.setInput('connection', deriveChosen(selection,
      readiness('claude-cli', claude), readiness('openai-codex', codex)));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('is an ordered list labelled "Setup progress" with aria-current on the current item', () => {
    const el = render(2);
    expect(el.querySelector('ol')?.getAttribute('aria-label')).toBe(
      'Setup progress',
    );
    expect(item(el, 2).getAttribute('aria-current')).toBe('step');
    expect(item(el, 1).hasAttribute('aria-current')).toBe(false);
    expect(item(el, 3).hasAttribute('aria-current')).toBe(false);
  });

  it.each<[ProviderReadinessState, string, string]>([
    ['checking', 'Checking', 'checking'], ['slow', 'Taking longer', 'checking'],
    ['ready', 'Ready', 'done'], ['missing', 'Needs install', 'need'],
    ['signed-out', 'Needs sign-in', 'need'], ['stale', 'Needs sign-in', 'need'],
    ['error', 'Could not check', 'need'],
  ])('maps chosen Codex %s to %s', (state, word, marker) => {
    const el = renderConnection({ kind: 'openai-codex' }, 'missing', state);
    expect(item(el, 1).textContent).toContain(`1 Codex`);
    expect(item(el, 1).textContent).toContain(word);
    expect(item(el, 1).getAttribute('data-marker')).toBe(marker);
  });

  it('ignores the nonchosen provider', () => {
    const el = renderConnection({ kind: 'claude-cli' }, 'ready', 'missing');
    expect(item(el, 1).getAttribute('data-marker')).toBe('done');
  });

  it.each<[SelectionView, string, string, string]>([
    [{ kind: 'other', name: 'API key' }, 'API key', 'Set in Providers', 'idle'],
    [{ kind: 'loading' }, 'Connection', 'Checking', 'checking'],
    [{ kind: 'unreadable' }, 'Connection', 'Not confirmed', 'idle'],
    [{ kind: 'not-confirmed' }, 'Connection', 'Not confirmed', 'idle'],
  ])('maps selection %o without provider need', (selection, label, word, marker) => {
    const el = renderConnection(selection, 'missing', 'missing');
    expect(item(el, 1).textContent).toContain(label);
    expect(item(el, 1).textContent).toContain(word);
    expect(item(el, 1).getAttribute('data-marker')).toBe(marker);
  });

  it.each<[ReadyStripSettingsWord, string, string]>([
    ['next', 'Next', 'idle'],
    ['done', 'Done', 'done'],
    ['skipped', 'Skipped', 'idle'],
  ])('item 2 for %s reads "%s"', (word, text, marker) => {
    const el = render(3, word);
    expect(item(el, 2).textContent).toContain(text);
    expect(item(el, 2).getAttribute('data-marker')).toBe(marker);
    expect(item(el, 3).textContent).toContain('Next');
  });

  it('colours markers by state', () => {
    const el = renderConnection({ kind: 'claude-cli' }, 'missing', 'ready');
    const marker = (step: number) =>
      item(el, step).querySelector(
        '[data-testid="ready-strip-marker"]',
      ) as HTMLElement;
    expect(marker(1).className).toContain('border-state-need');
    expect(marker(2).className).toContain('border-base-300');
    expect(marker(3).className).toContain('text-base-content-muted');
  });

  it('collapses only the non-current items below 720px', () => {
    const el = render(2);
    const text = (step: number) =>
      item(el, step).querySelector(
        '[data-testid="ready-strip-text"]',
      ) as HTMLElement;
    expect(text(1).className).toContain('max-[720px]:sr-only');
    expect(text(2).className).not.toContain('max-[720px]:sr-only');
    expect(text(3).className).toContain('max-[720px]:sr-only');
  });
});
