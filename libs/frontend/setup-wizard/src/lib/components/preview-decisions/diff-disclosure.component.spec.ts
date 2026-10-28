import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ThemeService } from '@ptah-extension/core';
import { DiffDisclosureComponent } from './diff-disclosure.component';

/**
 * The runtime `import('@ptah-extension/git-ui/diff-renderer')` is transpiled
 * to `require()`, so `jest.doMock` swaps in this stand-in (the real entry
 * pulls `@pierre/diffs`, which jsdom cannot load). `jest.resetModules()` runs
 * first so each test's factory is the one consulted.
 */
const RENDERER_SPECIFIER = '@ptah-extension/git-ui/diff-renderer';

@Component({
  selector: 'ptah-text-diff-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="mock-text-diff-view"></div>`,
})
class MockTextDiffViewComponent {
  public readonly oldText = input<string | null>(null);
  public readonly newText = input<string | null>(null);
  public readonly fileName = input('');
  public readonly themeType = input<'light' | 'dark'>('dark');
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    fixture.detectChanges();
  }
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('DiffDisclosureComponent', () => {
  const isDarkMode = signal(false);
  let fixture: ComponentFixture<DiffDisclosureComponent>;
  let rendererLoads: number;

  function create(inputs: {
    mode: 'unavailable' | 'diff';
    original?: string;
    modified?: string;
  }): void {
    fixture = TestBed.createComponent(DiffDisclosureComponent);
    fixture.componentRef.setInput('mode', inputs.mode);
    fixture.componentRef.setInput('fileName', 'perf-tuner.md');
    fixture.componentRef.setInput('original', inputs.original);
    fixture.componentRef.setInput('modified', inputs.modified);
    fixture.detectChanges();
  }

  const query = (testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const toggle = (): HTMLButtonElement =>
    query('diff-toggle') as HTMLButtonElement;
  const renderer = (): MockTextDiffViewComponent | null => {
    const debugEl = fixture.debugElement.query(
      By.css('ptah-text-diff-view'),
    );
    return debugEl
      ? (debugEl.componentInstance as MockTextDiffViewComponent)
      : null;
  };

  beforeEach(() => {
    rendererLoads = 0;
    jest.resetModules();
    jest.doMock(RENDERER_SPECIFIER, () => {
      rendererLoads++;
      return { TextDiffViewComponent: MockTextDiffViewComponent };
    });
    TestBed.configureTestingModule({
      imports: [DiffDisclosureComponent],
      providers: [{ provide: ThemeService, useValue: { isDarkMode } }],
    });
  });

  afterEach(() => {
    jest.dontMock(RENDERER_SPECIFIER);
  });

  it('has no static import of @ptah-extension/git-ui (lazy boundary)', () => {
    const source = readFileSync(
      join(__dirname, 'diff-disclosure.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /^\s*(?:import|export)\b[^;]*?from\s*['"]@ptah-extension\/git-ui/m,
    );
    expect(source).toMatch(
      /\bimport\(\s*['"]@ptah-extension\/git-ui\/diff-renderer['"]\s*\)/,
    );
  });

  it('wizard rows: collapsed by default, expand shows the unavailable text', async () => {
    create({ mode: 'unavailable' });
    const region = query('diff-region') as HTMLElement;
    expect(toggle().textContent?.trim()).toBe('What changes');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe(region.id);
    expect(region.hidden).toBe(true);

    toggle().click();
    fixture.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
    expect(query('diff-unavailable')?.textContent?.trim()).toBe(
      'The generated content is not known until generation runs.',
    );
    await settle(fixture);
    expect(rendererLoads).toBe(0);

    toggle().click();
    fixture.detectChanges();
    expect(region.hidden).toBe(true);
  });

  it('pack rows: loads the renderer only on expand and passes the texts', async () => {
    create({ mode: 'diff', original: 'model: sonnet\n', modified: 'model: opus\n' });
    await settle(fixture);
    expect(rendererLoads).toBe(0);

    toggle().click();
    fixture.detectChanges();
    expect(query('diff-loading')?.getAttribute('role')).toBe('status');
    await settle(fixture);

    const view = renderer();
    expect(view).not.toBeNull();
    expect(view?.oldText()).toBe('model: sonnet\n');
    expect(view?.newText()).toBe('model: opus\n');
    expect(view?.fileName()).toBe('perf-tuner.md');
    expect(view?.themeType()).toBe('light');
    expect(query('diff-loading')).toBeNull();
    expect(query('diff-unavailable')).toBeNull();
  });

  it('pack rows without texts show the unavailable state', async () => {
    create({ mode: 'diff' });
    toggle().click();
    await settle(fixture);
    expect(query('diff-unavailable')?.textContent?.trim()).toBe(
      'The differences could not be shown.',
    );
    expect(rendererLoads).toBe(0);
  });

  it('a renderer load failure falls back to the unavailable state without looping', async () => {
    let attempts = 0;
    jest.resetModules();
    jest.doMock(RENDERER_SPECIFIER, () => {
      attempts++;
      throw new Error('chunk load failed');
    });
    create({ mode: 'diff', original: 'a', modified: 'b' });
    toggle().click();
    await settle(fixture);
    await settle(fixture);

    expect(query('diff-unavailable')?.textContent?.trim()).toBe(
      'The differences could not be shown.',
    );
    expect(renderer()).toBeNull();
    expect(attempts).toBe(1);
  });
});
