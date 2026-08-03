/**
 * DiffViewComponent — unit specs for detectMonacoTheme() and the A-group
 * render states (TASK_2026_173 A1/A2/A3/A4).
 *
 * Coverage:
 *   detectMonacoTheme() — returns 'vs'       for data-vscode-theme-kind="vscode-light"
 *   detectMonacoTheme() — returns 'hc-black' for data-vscode-theme-kind="vscode-high-contrast"
 *   detectMonacoTheme() — returns 'vs-dark'  for data-vscode-theme-kind="vscode-dark"
 *   detectMonacoTheme() — returns 'vs'       for data-theme="light" (DaisyUI fallback)
 *   detectMonacoTheme() — returns 'vs-dark'  as default when no attribute is set
 *   isNewFile           — driven by originalRef.kind === 'absent', NOT by empty content
 *   isNewFile           — FALSE for a genuinely-empty TRACKED file (A3 AC5)
 *   isDeleted           — driven by modifiedRef.kind === 'absent' (A4 AC3)
 *   chromeLabel         — binary > deleted > new file > no changes precedence
 *   gitError            — populated only for status 'error'; overlay is persistent
 *   error overlay       — a failed read is NEVER rendered as content (A3)
 *   retry               — emits the diff tab key from both retry affordances
 *
 * Monaco is NOT instantiated — we test only pure logic and template state.
 *
 * Source-under-test:
 *   libs/frontend/editor/src/lib/diff-view/diff-view.component.ts
 */

import { TestBed } from '@angular/core/testing';
import type { ComponentRef } from '@angular/core';
import { DiffViewComponent } from './diff-view.component';
import type {
  DiffSideRef,
  DiffTabState,
  EditorTab,
} from '../services/editor/editor-tab.types';
import { diffTabKey } from '../services/editor/editor-tab.types';

// ---------------------------------------------------------------------------
// detectMonacoTheme is private; access via component instance using index type.
// ---------------------------------------------------------------------------
type AnyComponent = DiffViewComponent & Record<string, unknown>;

function makeDiffTab(overrides: Partial<DiffTabState> = {}): EditorTab {
  const diff: DiffTabState = {
    comparison: 'worktree',
    path: 'src/index.ts',
    originalPath: 'src/index.ts',
    original: '',
    modified: '',
    originalRef: { kind: 'index' } as DiffSideRef,
    modifiedRef: { kind: 'worktree' } as DiffSideRef,
    snapshotToken: 'token',
    isBinary: false,
    status: 'fresh',
    requestId: 1,
    ...overrides,
  };
  return {
    // Never re-derive the key format here — SEQ-1 keeps exactly one definition.
    filePath: diffTabKey(diff.comparison, diff.path),
    fileName: 'index.ts (working tree)',
    content: diff.modified,
    isDirty: false,
    diff,
  };
}

// ---------------------------------------------------------------------------
// Fixture builder (minimal — does not require Monaco to be loaded)
// ---------------------------------------------------------------------------
async function createFixture(tab: EditorTab | null = makeDiffTab()) {
  await TestBed.configureTestingModule({
    imports: [DiffViewComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(DiffViewComponent);
  const componentRef: ComponentRef<DiffViewComponent> = fixture.componentRef;

  componentRef.setInput('diffTab', tab);
  fixture.detectChanges();

  return {
    fixture,
    component: fixture.componentInstance as AnyComponent,
    componentRef,
  };
}

function readSignal<T>(component: AnyComponent, name: string): T {
  return (component[name] as () => T)();
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
  // A3 AC5 — chrome is driven by the resolved refs, never by empty content
  // ==========================================================================

  describe('new / deleted chrome (A3 AC5, A4 AC3)', () => {
    it('is a new file when the original side is absent, even with content on both sides', async () => {
      const { component } = await createFixture(
        makeDiffTab({
          originalRef: { kind: 'absent' },
          original: '',
          modified: 'const x = 1;\n',
        }),
      );

      expect(readSignal<boolean>(component, 'isNewFile')).toBe(true);
      expect(readSignal<string>(component, 'chromeLabel')).toBe('new file');
    });

    it('is NOT a new file for a genuinely-empty TRACKED file (the A3 AC5 defect)', async () => {
      const { component, fixture } = await createFixture(
        makeDiffTab({
          // Empty on both sides, but the original side genuinely resolved to
          // the index — this is an empty tracked file, not a new file.
          originalRef: { kind: 'index' },
          modifiedRef: { kind: 'worktree' },
          original: '',
          modified: '',
        }),
      );

      expect(readSignal<boolean>(component, 'isNewFile')).toBe(false);
      expect(readSignal<string>(component, 'chromeLabel')).toBe('no changes');
      expect(fixture.nativeElement.textContent).not.toContain('new file');
    });

    it('is deleted when the modified side is absent (A4 AC3)', async () => {
      const { component } = await createFixture(
        makeDiffTab({
          comparison: 'worktree',
          originalRef: { kind: 'index' },
          modifiedRef: { kind: 'absent' },
          original: 'gone\n',
          modified: '',
        }),
      );

      expect(readSignal<boolean>(component, 'isDeleted')).toBe(true);
      expect(readSignal<string>(component, 'chromeLabel')).toBe('deleted');
    });

    it('reports binary ahead of every other chrome state', async () => {
      const { component, fixture } = await createFixture(
        makeDiffTab({ isBinary: true, originalRef: { kind: 'absent' } }),
      );

      expect(readSignal<string>(component, 'chromeLabel')).toBe('binary');
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="diff-binary-overlay"]',
        ),
      ).toBeTruthy();
    });

    it('reports "no changes" when both sides resolved and are identical (A1 AC3)', async () => {
      const { component } = await createFixture(
        makeDiffTab({ original: 'same\n', modified: 'same\n' }),
      );

      expect(readSignal<string>(component, 'chromeLabel')).toBe('no changes');
    });
  });

  // ==========================================================================
  // A1 AC7 / A3 — failed reads are surfaced, never rendered as content
  // ==========================================================================

  describe('error state', () => {
    it('shows a persistent overlay for status "error" and never an empty diff', async () => {
      const { fixture, component } = await createFixture(
        makeDiffTab({
          status: 'error',
          errorMessage: 'This repository has no commits yet.',
          errorDetail: 'src/index.ts',
        }),
      );

      expect(readSignal<string | null>(component, 'gitError')).toBe(
        'This repository has no commits yet.',
      );
      const overlay = fixture.nativeElement.querySelector(
        '[data-testid="diff-error-overlay"]',
      );
      expect(overlay).toBeTruthy();
      expect(overlay.textContent).toContain('no commits yet');
      expect(overlay.getAttribute('role')).toBe('alert');
    });

    it('claims no diff shape when the read failed, even with absent refs', async () => {
      const { component, fixture } = await createFixture(
        makeDiffTab({
          status: 'error',
          errorMessage: 'Git could not read this file.',
          snapshotToken: '',
          originalRef: { kind: 'absent' },
          modifiedRef: { kind: 'absent' },
        }),
      );

      expect(readSignal<string>(component, 'chromeLabel')).toBe('');
      expect(
        fixture.nativeElement.querySelector('[data-testid="diff-chrome"]'),
      ).toBeNull();
    });

    it('renders no error overlay while the read is fresh', async () => {
      const { fixture, component } = await createFixture();

      expect(readSignal<string | null>(component, 'gitError')).toBeNull();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="diff-error-overlay"]',
        ),
      ).toBeNull();
    });

    it('surfaces a stale status chip without an error overlay', async () => {
      const { fixture, component } = await createFixture(
        makeDiffTab({ status: 'stale', errorMessage: 'backend unreachable' }),
      );

      expect(readSignal<string>(component, 'statusLabel')).toBe('stale');
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="diff-error-overlay"]',
        ),
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="diff-status-chip"]'),
      ).toBeTruthy();
    });
  });

  // ==========================================================================
  // Retry + header identity
  // ==========================================================================

  describe('header bar', () => {
    it('emits the diff tab key when the header retry button is pressed', async () => {
      const tab = makeDiffTab();
      const { fixture } = await createFixture(tab);

      const emitted: string[] = [];
      fixture.componentInstance.retryRequested.subscribe((key: string) =>
        emitted.push(key),
      );

      fixture.nativeElement.querySelector('[data-testid="diff-retry"]').click();

      expect(emitted).toEqual([tab.filePath]);
    });

    it('shows the pre-rename source path for a staged rename (A2 AC6 / N3)', async () => {
      const { fixture, component } = await createFixture(
        makeDiffTab({
          comparison: 'staged',
          path: 'src/new-name.ts',
          originalPath: 'src/old-name.ts',
        }),
      );

      expect(readSignal<boolean>(component, 'isRename')).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('src/old-name.ts');
    });

    it('labels the comparison so it is readable without hovering (A2 AC4)', async () => {
      const { fixture } = await createFixture(
        makeDiffTab({ comparison: 'staged' }),
      );

      expect(fixture.nativeElement.textContent).toContain('staged');
    });

    it('renders no header at all when there is no diff tab', async () => {
      const { fixture, component } = await createFixture(null);

      expect(readSignal<unknown>(component, 'diff')).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="diff-retry"]'),
      ).toBeNull();
    });
  });
});
