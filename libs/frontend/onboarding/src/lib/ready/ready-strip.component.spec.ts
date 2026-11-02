import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ClaudeReadinessState } from './claude-readiness.store';
import { ReadyStripComponent } from './ready-strip.component';
import type { ReadyStripSettingsWord } from './ready-strip-state';

describe('ReadyStripComponent', () => {
  let fixture: ComponentFixture<ReadyStripComponent>;

  function render(
    current: 1 | 2 | 3,
    claude: ClaudeReadinessState,
    settings: ReadyStripSettingsWord = 'next',
  ): HTMLElement {
    TestBed.configureTestingModule({ imports: [ReadyStripComponent] });
    fixture = TestBed.createComponent(ReadyStripComponent);
    fixture.componentRef.setInput('current', current);
    fixture.componentRef.setInput('claude', claude);
    fixture.componentRef.setInput('settings', settings);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const item = (el: HTMLElement, step: number): HTMLElement =>
    el.querySelector(`li[data-step="${step}"]`) as HTMLElement;

  afterEach(() => TestBed.resetTestingModule());

  it('is an ordered list labelled "Setup progress" with aria-current on the current item', () => {
    const el = render(2, 'ready');
    expect(el.querySelector('ol')?.getAttribute('aria-label')).toBe(
      'Setup progress',
    );
    expect(item(el, 2).getAttribute('aria-current')).toBe('step');
    expect(item(el, 1).hasAttribute('aria-current')).toBe(false);
    expect(item(el, 3).hasAttribute('aria-current')).toBe(false);
  });

  it.each<[ClaudeReadinessState, string, string]>([
    ['checking', 'Checking', 'checking'],
    ['ready', 'Ready', 'done'],
    ['missing', 'Needs install', 'need'],
    ['signed-out', 'Needs sign-in', 'need'],
    ['error', 'Could not check', 'need'],
  ])('item 1 for %s reads "%s" with marker %s', (state, word, marker) => {
    const el = render(1, state);
    expect(item(el, 1).textContent).toContain(word);
    expect(item(el, 1).getAttribute('data-marker')).toBe(marker);
  });

  it.each<[ReadyStripSettingsWord, string, string]>([
    ['next', 'Next', 'idle'],
    ['done', 'Done', 'done'],
    ['skipped', 'Skipped', 'idle'],
  ])('item 2 for %s reads "%s"', (word, text, marker) => {
    const el = render(3, 'ready', word);
    expect(item(el, 2).textContent).toContain(text);
    expect(item(el, 2).getAttribute('data-marker')).toBe(marker);
    expect(item(el, 3).textContent).toContain('Next');
  });

  it('colours markers by state', () => {
    const el = render(1, 'missing', 'done');
    const marker = (step: number) =>
      item(el, step).querySelector(
        '[data-testid="ready-strip-marker"]',
      ) as HTMLElement;
    expect(marker(1).className).toContain('border-state-need');
    expect(marker(2).className).toContain('border-state-done');
    expect(marker(3).className).toContain('text-base-content-muted');
  });

  it('collapses only the non-current items below 720px', () => {
    const el = render(2, 'ready');
    const text = (step: number) =>
      item(el, step).querySelector(
        '[data-testid="ready-strip-text"]',
      ) as HTMLElement;
    expect(text(1).className).toContain('max-[720px]:sr-only');
    expect(text(2).className).not.toContain('max-[720px]:sr-only');
    expect(text(3).className).toContain('max-[720px]:sr-only');
  });
});
