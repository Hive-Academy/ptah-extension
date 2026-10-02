import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ThemeService } from '@ptah-extension/core';
import { LazyDiffViewComponent } from './lazy-diff-view.component';

/**
 * `@ptah-extension/git-ui/diff-renderer` is mapped to
 * `src/__mocks__/ptah-git-ui-diff-renderer.ts` (jest.config.ts), so the
 * component's runtime `import()` really runs and really instantiates a
 * stand-in `TextDiffViewComponent`. Failure cases override that mapping with
 * `jest.doMock` and a throwing factory; the spec transpile turns `import()`
 * into `Promise.resolve().then(() => require(...))`, so the import rejects.
 */
const RENDERER_SPECIFIER = '@ptah-extension/git-ui/diff-renderer';

interface TextDiffStandIn {
  oldText(): string | null;
  newText(): string | null;
  fileName(): string;
  themeType(): 'light' | 'dark';
}

/** Lets the dynamic import and the state signal settle. */
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    fixture.detectChanges();
  }
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('LazyDiffViewComponent', () => {
  const isDarkMode = signal(true);
  let fixture: ComponentFixture<LazyDiffViewComponent>;

  function create(original = 'a\nb\n', modified = 'a\nc\n'): void {
    fixture = TestBed.createComponent(LazyDiffViewComponent);
    fixture.componentRef.setInput('label', 'SKILL.md');
    fixture.componentRef.setInput('original', original);
    fixture.componentRef.setInput('modified', modified);
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function renderer(): TextDiffStandIn | null {
    const debugEl = fixture.debugElement.query(By.css('ptah-text-diff-view'));
    return debugEl ? (debugEl.componentInstance as TextDiffStandIn) : null;
  }

  beforeEach(() => {
    isDarkMode.set(true);
    TestBed.configureTestingModule({
      imports: [LazyDiffViewComponent],
      providers: [{ provide: ThemeService, useValue: { isDarkMode } }],
    });
  });

  afterEach(() => {
    jest.dontMock(RENDERER_SPECIFIER);
  });

  it('has no static import of @ptah-extension/git-ui (lazy boundary)', () => {
    const source = readFileSync(
      join(__dirname, 'lazy-diff-view.component.ts'),
      'utf8',
    );

    // Static `import ... from '...'`, side-effect `import '...'`, re-exports
    // and `require(...)` of any git-ui path are all forbidden.
    expect(source).not.toMatch(
      /^\s*(?:import|export)\b[^;]*?from\s*['"]@ptah-extension\/git-ui/m,
    );
    expect(source).not.toMatch(/^\s*import\s*['"]@ptah-extension\/git-ui/m);
    expect(source).not.toMatch(/require\(\s*['"]@ptah-extension\/git-ui/);
    // The only route is the runtime import() of the diff-renderer entry.
    expect(source).toMatch(
      /\bimport\(\s*['"]@ptah-extension\/git-ui\/diff-renderer['"]\s*\)/,
    );
  });

  it('shows the loading state until the renderer chunk resolves', async () => {
    create();
    fixture.detectChanges();
    fixture.detectChanges();

    const loading = query('lazy-diff-loading');
    expect(loading).not.toBeNull();
    expect(loading?.getAttribute('role')).toBe('status');
    expect(renderer()).toBeNull();

    await settle(fixture);
    expect(query('lazy-diff-loading')).toBeNull();
  });

  it('passes the texts, file name and theme to TextDiffViewComponent', async () => {
    create('old body\n', 'new body\n');
    fixture.detectChanges();
    await settle(fixture);

    const view = renderer();
    expect(view).not.toBeNull();
    expect(view?.oldText()).toBe('old body\n');
    expect(view?.newText()).toBe('new body\n');
    expect(view?.fileName()).toBe('SKILL.md');
    expect(view?.themeType()).toBe('dark');
    expect(query('lazy-diff-error')).toBeNull();
  });

  it('pushes input and theme changes into the live renderer without reloading', async () => {
    create();
    fixture.detectChanges();
    await settle(fixture);
    const first = renderer();

    fixture.componentRef.setInput('modified', 'changed\n');
    isDarkMode.set(false);
    fixture.detectChanges();
    await settle(fixture);

    const view = renderer();
    expect(view).toBe(first);
    expect(view?.newText()).toBe('changed\n');
    expect(view?.themeType()).toBe('light');
  });

  it('mounts the renderer with inputs that changed while the import was pending', async () => {
    create('old body\n', 'first\n');
    fixture.detectChanges();
    // The import has started but not resolved yet.
    expect(query('lazy-diff-loading')).not.toBeNull();

    fixture.componentRef.setInput('modified', 'latest\n');
    fixture.componentRef.setInput('label', 'renamed.md');
    isDarkMode.set(false);
    fixture.detectChanges();
    await settle(fixture);

    const view = renderer();
    expect(view?.newText()).toBe('latest\n');
    expect(view?.fileName()).toBe('renamed.md');
    expect(view?.themeType()).toBe('light');
  });

  it('shows the error state when the dynamic import rejects, and recovers on retry', async () => {
    let attempts = 0;
    jest.doMock(RENDERER_SPECIFIER, () => {
      attempts++;
      throw new Error('chunk load failed');
    });

    create();
    fixture.detectChanges();
    await settle(fixture);
    await settle(fixture);

    const error = query('lazy-diff-error');
    expect(error).not.toBeNull();
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('chunk load failed');
    expect(renderer()).toBeNull();
    // Regression: a failed load must not re-trigger itself through the
    // effect (it used to track `state` and retry the import in a loop).
    expect(attempts).toBe(1);

    jest.dontMock(RENDERER_SPECIFIER);
    query('lazy-diff-retry')?.click();
    await settle(fixture);

    expect(query('lazy-diff-error')).toBeNull();
    expect(renderer()?.oldText()).toBe('a\nb\n');
  });
});
