/**
 * DiffViewComponent — unit specs for detectMonacoTheme() and isNewFile (TASK_2026_111 Batch 6).
 *
 * Coverage:
 *   detectMonacoTheme() — returns 'vs'       for data-vscode-theme-kind="vscode-light"
 *   detectMonacoTheme() — returns 'hc-black' for data-vscode-theme-kind="vscode-high-contrast"
 *   detectMonacoTheme() — returns 'vs-dark'  for data-vscode-theme-kind="vscode-dark"
 *   detectMonacoTheme() — returns 'vs'       for data-theme="light" (DaisyUI fallback)
 *   detectMonacoTheme() — returns 'vs-dark'  as default when no attribute is set
 *   isNewFile computed  — true when originalContent === '' AND modifiedContent.length > 0
 *   isNewFile computed  — false when both sides are non-empty (real diff)
 *   isNewFile computed  — false when both sides are empty
 *
 * Monaco is NOT instantiated — we test only the pure logic of detectMonacoTheme()
 * and the computed isNewFile signal via TestBed input updates.
 *
 * Source-under-test:
 *   libs/frontend/editor/src/lib/diff-view/diff-view.component.ts
 */

import { TestBed } from '@angular/core/testing';
import type { ComponentRef } from '@angular/core';
import { DiffViewComponent } from './diff-view.component';

// ---------------------------------------------------------------------------
// detectMonacoTheme is private; access via component instance using index type.
// ---------------------------------------------------------------------------
type AnyComponent = DiffViewComponent & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Fixture builder (minimal — does not require Monaco to be loaded)
// ---------------------------------------------------------------------------
async function createFixture() {
  await TestBed.configureTestingModule({
    imports: [DiffViewComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(DiffViewComponent);
  const componentRef: ComponentRef<DiffViewComponent> = fixture.componentRef;

  // Set all required inputs with neutral defaults
  componentRef.setInput('filePath', 'src/index.ts');
  componentRef.setInput('originalContent', '');
  componentRef.setInput('modifiedContent', '');

  fixture.detectChanges();

  return {
    fixture,
    component: fixture.componentInstance as AnyComponent,
    componentRef,
  };
}

// ---------------------------------------------------------------------------
// Helper: set and clear data-vscode-theme-kind + data-theme attributes
// ---------------------------------------------------------------------------
function setVscodeThemeKind(value: string | null): void {
  if (value !== null) {
    document.body.setAttribute('data-vscode-theme-kind', value);
  } else {
    document.body.removeAttribute('data-vscode-theme-kind');
  }
}

function setDataTheme(value: string | null): void {
  if (value !== null) {
    document.body.setAttribute('data-theme', value);
  } else {
    document.body.removeAttribute('data-theme');
  }
}

function cleanBodyAttributes(): void {
  document.body.removeAttribute('data-vscode-theme-kind');
  document.body.removeAttribute('data-theme');
}

// ===========================================================================
// Test suites
// ===========================================================================

describe('DiffViewComponent', () => {
  afterEach(() => {
    cleanBodyAttributes();
    TestBed.resetTestingModule();
  });

  // ==========================================================================
  // detectMonacoTheme()
  // ==========================================================================

  describe('detectMonacoTheme()', () => {
    it('returns "vs" when data-vscode-theme-kind="vscode-light"', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind('vscode-light');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('vs');
    });

    it('returns "hc-black" when data-vscode-theme-kind="vscode-high-contrast"', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind('vscode-high-contrast');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('hc-black');
    });

    it('returns "vs-dark" when data-vscode-theme-kind="vscode-dark"', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind('vscode-dark');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('vs-dark');
    });

    it('returns "vs" for data-theme="light" (DaisyUI fallback, no vscode attribute)', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind(null); // ensure no vscode attribute
      setDataTheme('light');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('vs');
    });

    it('returns "vs-dark" as default when no theme attribute is set', async () => {
      const { component } = await createFixture();
      cleanBodyAttributes();

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('vs-dark');
    });

    it('returns "vs-dark" for data-theme="dark" (DaisyUI dark fallback)', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind(null);
      setDataTheme('dark');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('vs-dark');
    });

    it('prefers data-vscode-theme-kind over data-theme when both are set', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind('vscode-light');
      setDataTheme('dark'); // conflicting — vscode attribute wins

      const theme = (component['detectMonacoTheme'] as () => string)();

      // vscode-light wins over data-theme=dark
      expect(theme).toBe('vs');
    });
  });

  // ==========================================================================
  // isNewFile computed
  // ==========================================================================

  describe('isNewFile computed signal', () => {
    it('is true when originalContent is empty and modifiedContent is non-empty', async () => {
      const { componentRef, fixture } = await createFixture();

      componentRef.setInput('originalContent', '');
      componentRef.setInput('modifiedContent', 'const x = 1;\n');
      fixture.detectChanges();

      const isNewFile = (fixture.componentInstance as AnyComponent)[
        'isNewFile'
      ] as () => boolean;
      expect(isNewFile()).toBe(true);
    });

    it('is false when both sides are non-empty (real diff)', async () => {
      const { componentRef, fixture } = await createFixture();

      componentRef.setInput('originalContent', 'const x = 0;\n');
      componentRef.setInput('modifiedContent', 'const x = 1;\n');
      fixture.detectChanges();

      const isNewFile = (fixture.componentInstance as AnyComponent)[
        'isNewFile'
      ] as () => boolean;
      expect(isNewFile()).toBe(false);
    });

    it('is false when both sides are empty', async () => {
      const { componentRef, fixture } = await createFixture();

      componentRef.setInput('originalContent', '');
      componentRef.setInput('modifiedContent', '');
      fixture.detectChanges();

      const isNewFile = (fixture.componentInstance as AnyComponent)[
        'isNewFile'
      ] as () => boolean;
      expect(isNewFile()).toBe(false);
    });

    it('is false when originalContent is non-empty but modifiedContent is empty', async () => {
      const { componentRef, fixture } = await createFixture();

      componentRef.setInput('originalContent', 'some existing content\n');
      componentRef.setInput('modifiedContent', '');
      fixture.detectChanges();

      const isNewFile = (fixture.componentInstance as AnyComponent)[
        'isNewFile'
      ] as () => boolean;
      expect(isNewFile()).toBe(false);
    });

    it('transitions from false to true when originalContent is cleared', async () => {
      const { componentRef, fixture } = await createFixture();

      // Start with both non-empty
      componentRef.setInput('originalContent', 'old content\n');
      componentRef.setInput('modifiedContent', 'new content\n');
      fixture.detectChanges();

      const isNewFile = (fixture.componentInstance as AnyComponent)[
        'isNewFile'
      ] as () => boolean;
      expect(isNewFile()).toBe(false);

      // Clear original — now it's a new-file scenario
      componentRef.setInput('originalContent', '');
      fixture.detectChanges();

      expect(isNewFile()).toBe(true);
    });
  });
});
