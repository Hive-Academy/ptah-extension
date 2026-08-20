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
import type { ComponentFixture } from '@angular/core/testing';
import type { ComponentRef } from '@angular/core';
import {
  DiffViewComponent,
  hunkAtLine,
  hunkLineRange,
} from './diff-view.component';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import type {
  DiffSideRef,
  DiffTabState,
  EditorTab,
  GitHunkRef,
  HunkApplyFn,
} from '../services/editor/editor-tab.types';
import { diffTabKey } from '../services/editor/editor-tab.types';

/**
 * jsdom implements no HTMLDialogElement methods, so the revert dialog's
 * showModal()/close() would throw the moment it opens (TASK_2026_227).
 *
 * The stub reflects the `open` attribute, which is all these specs observe.
 * What it CANNOT stand in for is the top layer itself — jsdom has no layout,
 * no compositing and no hit-testing, which is exactly why the bug this dialog
 * now carries a fix for was invisible here and had to be caught by
 * `apps/ptah-electron-e2e/src/specs/editor/hunk-revert-top-layer.spec.ts`.
 */
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    } as HTMLDialogElement['showModal'];
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    } as HTMLDialogElement['close'];
  }
});

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
    hunks: [],
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

/** Write the two attributes `ThemeService` puts on `<html>`, as it writes them. */
function setRootTheme(theme: string | null, mode: string | null): void {
  const root = document.documentElement;
  if (theme !== null) root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  if (mode !== null) root.setAttribute('data-theme-mode', mode);
  else root.removeAttribute('data-theme-mode');
}

function cleanBodyAttributes(): void {
  document.body.removeAttribute('data-vscode-theme-kind');
  document.body.removeAttribute('data-theme');
  setRootTheme(null, null);
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

    // ------------------------------------------------------------------
    // TASK_2026_222 — the daisyUI branch reads <html>, which is where
    // ThemeService writes. Reading only <body> made it unreachable in every
    // host, so Electron rendered a dark diff editor inside a light app.
    // ------------------------------------------------------------------

    it('returns "vs" for data-theme-mode="light" on <html> (the Electron path)', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind(null);
      setRootTheme('anubis-light', 'light');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('vs');
    });

    it('returns "vs-dark" for data-theme-mode="dark" on <html>', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind(null);
      setRootTheme('anubis', 'dark');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('vs-dark');
    });

    it('uses the mode marker, not the theme NAME — a light theme not called "light" still gets "vs"', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind(null);
      // `cupcake` is one of 33 daisyUI themes whose name says nothing about its
      // lightness; matching on the name alone would send it to a dark editor.
      setRootTheme('cupcake', 'light');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('vs');
    });

    it('still prefers the VS Code kind over the daisyUI attributes on <html>', async () => {
      const { component } = await createFixture();
      setVscodeThemeKind('vscode-high-contrast');
      setRootTheme('anubis-light', 'light');

      const theme = (component['detectMonacoTheme'] as () => string)();

      expect(theme).toBe('hc-black');
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

// ===========================================================================
// B1 / B2 / D3 — editor lifecycle (TASK_2026_173 batch 3)
//
// Monaco is faked, not loaded: these are assertions about WHICH Monaco calls
// the component makes, which is exactly what B1 ("no construction on a return
// switch") and B2 ("update models in place, never via window.monaco") are
// claims about. A real Monaco would make the same assertions untestable in
// jsdom and no more truthful.
// ===========================================================================

class FakeModel {
  disposed = false;
  pushes = 0;
  constructor(
    public value: string,
    public language: string,
    public readonly uri: { toString(): string },
  ) {}
  getValue(): string {
    return this.value;
  }
  getLanguageId(): string {
    return this.language;
  }
  /** Monaco reports at least one line even for an empty document. */
  getLineCount(): number {
    return Math.max(1, this.value.split('\n').length);
  }
  getFullModelRange(): unknown {
    return {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    };
  }
  pushEditOperations(
    _selections: unknown,
    edits: { text: string }[],
    _cursor: unknown,
  ): null {
    this.value = edits[0].text;
    this.pushes++;
    return null;
  }
  dispose(): void {
    this.disposed = true;
  }
}

/**
 * Decoration ranges as Monaco would receive them, so a test can assert WHERE a
 * marker was placed rather than merely that one was requested.
 */
interface FakeDecoration {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  options: {
    isWholeLine?: boolean;
    glyphMarginClassName?: string;
    linesDecorationsClassName?: string | null;
    glyphMarginHoverMessage?: { value: string };
  };
}

interface FakeDecorationsCollection {
  current: FakeDecoration[];
  setCalls: number;
  clears: number;
  set(next: FakeDecoration[]): string[];
  clear(): void;
}

/**
 * Only the slice of monaco.editor.IContentWidget the component supplies
 * (TASK_2026_221) — an id, the DOM node, and the anchor.
 */
interface FakeContentWidget {
  getId(): string;
  getDomNode(): HTMLElement;
  getPosition(): {
    position: { lineNumber: number; column: number };
    preference: number[];
  } | null;
}

/** The modified-side code editor a diff editor exposes (D2 lives on this one). */
interface FakeCodeEditor {
  collections: FakeDecorationsCollection[];
  revealed: number[];
  mouseListeners: ((event: FakeMouseEvent) => void)[];
  contentWidgets: FakeContentWidget[];
  layoutedWidgets: number;
  getModel(): FakeModel | null;
  createDecorationsCollection(
    decorations: FakeDecoration[],
  ): FakeDecorationsCollection;
  revealLineInCenterIfOutsideViewport(line: number): void;
  onMouseDown(listener: (event: FakeMouseEvent) => void): { dispose(): void };
  addContentWidget(widget: FakeContentWidget): void;
  layoutContentWidget(widget: FakeContentWidget): void;
  removeContentWidget(widget: FakeContentWidget): void;
}

interface FakeMouseEvent {
  target: { type: number; position: { lineNumber: number } | null };
}

/** Mirrors monaco.editor.MouseTargetType — only the member the product reads. */
const GUTTER_GLYPH_MARGIN = 2;

function makeFakeMonaco() {
  const models = new Map<string, FakeModel>();
  const created: FakeModel[] = [];
  const diffEditors: FakeDiffEditor[] = [];

  interface FakeDiffEditor {
    model: { original: FakeModel; modified: FakeModel } | null;
    options: Record<string, unknown>;
    layouts: number;
    setModelCalls: number;
    savedStates: number;
    restored: unknown[];
    modifiedEditor: FakeCodeEditor;
    setModel(model: { original: FakeModel; modified: FakeModel } | null): void;
    getModifiedEditor(): FakeCodeEditor;
    saveViewState(): { id: number } | null;
    restoreViewState(state: unknown): void;
    updateOptions(options: Record<string, unknown>): void;
    layout(): void;
    dispose(): void;
  }

  let stateCounter = 0;

  const api = {
    Uri: {
      parse: (raw: string) => ({ toString: () => raw }),
    },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    editor: {
      createModel: (
        value: string,
        language: string,
        uri: { toString(): string },
      ) => {
        const model = new FakeModel(value, language, uri);
        models.set(uri.toString(), model);
        created.push(model);
        return model;
      },
      getModel: (uri: { toString(): string }) =>
        models.get(uri.toString()) ?? null,
      setModelLanguage: (model: FakeModel, language: string) => {
        model.language = language;
      },
      setTheme: jest.fn(),
      MouseTargetType: { GUTTER_GLYPH_MARGIN },
      ContentWidgetPositionPreference: { EXACT: 0, ABOVE: 1, BELOW: 2 },
      createDiffEditor: (
        _container: unknown,
        createOptions: Record<string, unknown> = {},
      ) => {
        const editor: FakeDiffEditor = {
          model: null,
          // Seeded from the CREATION options, not left empty: readOnly,
          // renderMarginRevertIcon and glyphMargin are only ever set here, and
          // a fake that dropped them would make their guards untestable.
          options: { ...createOptions },
          layouts: 0,
          setModelCalls: 0,
          savedStates: 0,
          restored: [],
          modifiedEditor: {
            collections: [],
            revealed: [],
            mouseListeners: [],
            getModel: () => editor.model?.modified ?? null,
            createDecorationsCollection(decorations: FakeDecoration[]) {
              const collection: FakeDecorationsCollection = {
                current: decorations,
                setCalls: 0,
                clears: 0,
                set(next) {
                  this.current = next;
                  this.setCalls++;
                  return next.map((_, i) => `d${i}`);
                },
                clear() {
                  this.current = [];
                  this.clears++;
                },
              };
              this.collections.push(collection);
              return collection;
            },
            revealLineInCenterIfOutsideViewport(line: number) {
              this.revealed.push(line);
            },
            onMouseDown(listener) {
              this.mouseListeners.push(listener);
              return {
                dispose: () => {
                  this.mouseListeners = this.mouseListeners.filter(
                    (l) => l !== listener,
                  );
                },
              };
            },
            contentWidgets: [],
            layoutedWidgets: 0,
            addContentWidget(widget: FakeContentWidget) {
              this.contentWidgets.push(widget);
            },
            layoutContentWidget(_widget: FakeContentWidget) {
              this.layoutedWidgets++;
            },
            removeContentWidget(widget: FakeContentWidget) {
              this.contentWidgets = this.contentWidgets.filter(
                (w) => w !== widget,
              );
            },
          },
          getModifiedEditor() {
            return this.modifiedEditor;
          },
          setModel(model) {
            this.model = model;
            this.setModelCalls++;
          },
          saveViewState() {
            if (!this.model) return null;
            this.savedStates++;
            return { id: ++stateCounter };
          },
          restoreViewState(state: unknown) {
            this.restored.push(state);
          },
          updateOptions(options: Record<string, unknown>) {
            Object.assign(this.options, options);
          },
          layout() {
            this.layouts++;
          },
          dispose() {
            /* no-op */
          },
        };
        diffEditors.push(editor);
        return editor;
      },
    },
  };

  return { api, models, created, diffEditors };
}

type FakeMonaco = ReturnType<typeof makeFakeMonaco>;

/** Immutably patch a diff tab's descriptor, mirroring what the service does. */
function patchDiff(tab: EditorTab, patch: Partial<DiffTabState>): EditorTab {
  const diff = tab.diff;
  if (!diff) throw new Error('not a diff tab');
  return { ...tab, diff: { ...diff, ...patch } };
}

async function createLiveFixture(
  tab: EditorTab | null = makeDiffTab(),
  applyHunks: HunkApplyFn | null = null,
): Promise<{
  fixture: ComponentFixture<DiffViewComponent>;
  componentRef: ComponentRef<DiffViewComponent>;
  monaco: FakeMonaco;
  setTab(next: EditorTab | null): void;
  setOpenKeys(keys: readonly string[]): void;
}> {
  const monaco = makeFakeMonaco();

  await TestBed.configureTestingModule({
    imports: [DiffViewComponent],
    providers: [
      {
        provide: MonacoLoaderService,
        useValue: {
          load: () => Promise.resolve(monaco.api),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DiffViewComponent);
  const componentRef = fixture.componentRef;
  componentRef.setInput('diffTab', tab);
  componentRef.setInput('openDiffKeys', tab ? [tab.filePath] : []);
  componentRef.setInput('applyHunks', applyHunks);
  fixture.detectChanges();
  // afterNextRender ran; let the loader promise resolve and the editor build.
  await fixture.whenStable();
  fixture.detectChanges();

  return {
    fixture,
    componentRef,
    monaco,
    setTab(next: EditorTab | null) {
      componentRef.setInput('diffTab', next);
      fixture.detectChanges();
    },
    setOpenKeys(keys: readonly string[]) {
      componentRef.setInput('openDiffKeys', keys);
      fixture.detectChanges();
    },
  };
}

describe('DiffViewComponent — editor lifecycle (B1, B2, D3)', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    // jsdom has no ResizeObserver; the component observes its own container.
    globalThis.ResizeObserver = class {
      observe(): void {
        /* no-op */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    } as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('creates the diff editor exactly once and never recreates it on a tab switch (B1 AC1)', async () => {
    const first = makeDiffTab({ path: 'src/a.ts' });
    const second = makeDiffTab({ path: 'src/b.ts', modified: 'b\n' });
    const { monaco, setTab, setOpenKeys } = await createLiveFixture(first);

    expect(monaco.diffEditors).toHaveLength(1);
    const modelsAfterFirst = monaco.created.length;

    setOpenKeys([first.filePath, second.filePath]);
    setTab(second);
    setTab(first);
    setTab(second);

    // Still ONE editor, and the second tab's pair was built once and reused.
    expect(monaco.diffEditors).toHaveLength(1);
    expect(monaco.created.length).toBe(modelsAfterFirst + 2);
  });

  it('returns to a tab by re-attaching the CACHED pair, creating no models (B1 AC1)', async () => {
    const tab = makeDiffTab();
    const { monaco, setTab } = await createLiveFixture(tab);
    const modelsAfterOpen = monaco.created.length;

    // Switch away to a plain file tab: the diff detaches but stays mounted.
    setTab(null);
    expect(monaco.diffEditors[0].model).toBeNull();

    setTab(tab);

    expect(monaco.created.length).toBe(modelsAfterOpen);
    expect(monaco.diffEditors[0].model).not.toBeNull();
  });

  it('updates content in place with pushEditOperations, disposing nothing (B2 AC1, AC5)', async () => {
    const tab = makeDiffTab({ original: 'a\n', modified: 'b\n' });
    const { monaco, setTab } = await createLiveFixture(tab);
    const modelsAfterOpen = monaco.created.length;
    const [originalModel, modifiedModel] = monaco.created;

    for (let i = 0; i < 10; i++) {
      setTab(patchDiff(tab, { modified: `b${i}\n`, requestId: i + 2 }));
    }

    // 10 rapid updates: same two models, no new ones, none disposed (AC5).
    expect(monaco.created.length).toBe(modelsAfterOpen);
    expect(modifiedModel.pushes).toBe(10);
    expect(modifiedModel.getValue()).toBe('b9\n');
    expect(originalModel.disposed).toBe(false);
    expect(modifiedModel.disposed).toBe(false);
  });

  it('re-tokenizes in place when the language changes (B2 AC3)', async () => {
    const tab = makeDiffTab({ path: 'src/a.ts' });
    const { monaco, setTab } = await createLiveFixture(tab);
    const [originalModel, modifiedModel] = monaco.created;
    expect(modifiedModel.getLanguageId()).toBe('typescript');

    setTab(patchDiff(tab, { path: 'src/a.py', requestId: 2 }));

    expect(modifiedModel.getLanguageId()).toBe('python');
    expect(originalModel.getLanguageId()).toBe('python');
    expect(modifiedModel.disposed).toBe(false);
  });

  it('never touches window.monaco (B2 AC4 — verified with the global unavailable)', async () => {
    const globalWindow = window as Window & { monaco?: unknown };
    expect(globalWindow.monaco).toBeUndefined();

    const tab = makeDiffTab();
    const { monaco, setTab } = await createLiveFixture(tab);

    setTab(patchDiff(tab, { modified: 'changed\n' }));

    // The update landed even though no global Monaco exists anywhere.
    expect(monaco.created[1].getValue()).toBe('changed\n');
    expect(globalWindow.monaco).toBeUndefined();
  });

  it('saves and restores per-tab view state across a switch (B1 AC3, AC4)', async () => {
    const first = makeDiffTab({ path: 'src/a.ts' });
    const second = makeDiffTab({ path: 'src/b.ts' });
    const { monaco, setTab, setOpenKeys } = await createLiveFixture(first);
    const editor = monaco.diffEditors[0];

    setOpenKeys([first.filePath, second.filePath]);
    setTab(second); // saves A's state
    setTab(first); // saves B's state, restores A's

    // A's state was captured before leaving and handed back on return, and it
    // is A's own state object — not B's.
    const aState = editor.restored[editor.restored.length - 1];
    expect(aState).toEqual({ id: 1 });
    expect(editor.savedStates).toBeGreaterThanOrEqual(2);
  });

  it('disposes a closed tab pair and returns the model count to its start (B1 AC5)', async () => {
    const tabs = Array.from({ length: 30 }, (_, i) =>
      makeDiffTab({ path: `src/file${i}.ts` }),
    );
    const { monaco, setTab, setOpenKeys } = await createLiveFixture(tabs[0]);
    const startingModels = monaco.created.length;

    // Open 30 diff tabs.
    setOpenKeys(tabs.map((t) => t.filePath));
    for (const tab of tabs) setTab(tab);
    expect(monaco.created.length).toBe(startingModels + 29 * 2);

    // Close them all.
    setTab(null);
    setOpenKeys([]);

    const live = monaco.created.filter((m) => !m.disposed);
    expect(live).toHaveLength(0);
  });

  it('survives a workspace switch with no active diff (B1 AC6)', async () => {
    const tab = makeDiffTab();
    const { monaco, setTab, setOpenKeys } = await createLiveFixture(tab);

    // Workspace switch: openTabs is replaced wholesale and nothing is active.
    expect(() => {
      setTab(null);
      setOpenKeys([]);
    }).not.toThrow();

    expect(monaco.diffEditors[0].model).toBeNull();
    expect(monaco.created.every((m) => m.disposed)).toBe(true);
  });

  it('toggles inline / side-by-side on the live editor without recreating it (D3 AC1, AC2)', async () => {
    const { fixture, monaco } = await createLiveFixture();
    const editor = monaco.diffEditors[0];
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="diff-layout-toggle"]',
    );

    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    fixture.detectChanges();

    expect(editor.options['renderSideBySide']).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(monaco.diffEditors).toHaveLength(1);

    toggle.click();
    fixture.detectChanges();

    expect(editor.options['renderSideBySide']).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(monaco.diffEditors).toHaveLength(1);
  });

  it('preserves scroll position across a layout toggle (D3)', async () => {
    const { fixture, monaco } = await createLiveFixture();
    const editor = monaco.diffEditors[0];
    const before = editor.restored.length;

    fixture.nativeElement
      .querySelector('[data-testid="diff-layout-toggle"]')
      .click();
    fixture.detectChanges();

    expect(editor.restored.length).toBe(before + 1);
  });
});

// ===========================================================================
// D2 — hunk affordances (tasks 8.5, 8.6)
//
// These run against the LIVE fixture and the real fake-Monaco harness, so the
// decoration ranges asserted below are the ones the product actually hands to
// Monaco — not ones recomputed by the test.
// ===========================================================================

/** git's `@@` positions for a three-hunk file, as the backend emits them. */
function hunkRef(
  index: number,
  modifiedStart: number,
  modifiedLines = 3,
): GitHunkRef {
  return {
    index,
    originalStart: modifiedStart,
    originalLines: modifiedLines,
    modifiedStart,
    modifiedLines,
    header: `@@ -${modifiedStart},${modifiedLines} +${modifiedStart},${modifiedLines} @@`,
  };
}

const THREE_HUNKS = [hunkRef(0, 2), hunkRef(1, 8), hunkRef(2, 14)];

/** A 20-line modified side, so every hunk above sits inside the model. */
const TWENTY_LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
  '\n',
);

function hunkTab(overrides: Partial<DiffTabState> = {}): EditorTab {
  return makeDiffTab({
    original: TWENTY_LINES,
    modified: TWENTY_LINES,
    hunks: THREE_HUNKS,
    snapshotToken: 'tok-1',
    ...overrides,
  });
}

function query(
  fixture: ComponentFixture<DiffViewComponent>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function click(
  fixture: ComponentFixture<DiffViewComponent>,
  testId: string,
): void {
  (query(fixture, testId) as HTMLButtonElement | null)?.click();
  fixture.detectChanges();
}

describe('DiffViewComponent — hunk affordances (D2)', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe(): void {
        /* no-op */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    } as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // -------------------------------------------------------------------------
  // AC10 / AC11 — when the actions must NOT be there
  // -------------------------------------------------------------------------

  describe('actions are ABSENT, not present-and-broken', () => {
    it('(AC10) a binary file offers no hunk actions at all', async () => {
      const { fixture } = await createLiveFixture(
        hunkTab({ isBinary: true }),
        jest.fn(),
      );

      expect(query(fixture, 'hunk-toolbar')).toBeNull();
    });

    it('a failed read offers none, however many hunks came with it', async () => {
      // A side that could not be read describes nothing — the same reasoning
      // that suppresses new/deleted chrome rather than inventing it.
      const { fixture } = await createLiveFixture(
        hunkTab({ status: 'error', errorMessage: 'Git could not read this.' }),
        jest.fn(),
      );

      expect(query(fixture, 'hunk-toolbar')).toBeNull();
    });

    it('a response that never reached a repository read offers none', async () => {
      const { fixture } = await createLiveFixture(
        hunkTab({ snapshotToken: '' }),
        jest.fn(),
      );

      expect(query(fixture, 'hunk-toolbar')).toBeNull();
    });

    it('a diff with no hunks offers none', async () => {
      const { fixture } = await createLiveFixture(
        hunkTab({ hunks: [] }),
        jest.fn(),
      );

      expect(query(fixture, 'hunk-toolbar')).toBeNull();
    });

    it('a surface with no git behind it offers none — the Skills preview case', async () => {
      // applyHunks left null: the enhancement preview reuses this Monaco
      // surface for two in-memory bodies and must not offer to stage them.
      const { fixture } = await createLiveFixture(hunkTab(), null);

      expect(query(fixture, 'hunk-toolbar')).toBeNull();
    });

    it('(AC11) the modified pane is never writable, and Monaco keeps its own revert arrow off', async () => {
      const { monaco } = await createLiveFixture(hunkTab(), jest.fn());

      // Permanent (plan §4.3). Monaco's revert arrow edits the modified BUFFER,
      // which is the wrong mechanism for a git-backed diff; hunk actions are
      // decorations precisely so no accidental edit is possible.
      expect(monaco.diffEditors[0].options).toMatchObject({
        readOnly: true,
        renderMarginRevertIcon: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // AC1 / D3 AC6 — decorations placed by git's segmentation
  // -------------------------------------------------------------------------

  describe('glyph-margin decorations', () => {
    it('enables the glyph margin, which monaco-editor defaults to OFF', async () => {
      const { monaco } = await createLiveFixture(hunkTab(), jest.fn());

      // vscode defaults this to true, monaco-editor to false. Without it the
      // markers have nowhere to render — silently, with no error.
      expect(monaco.diffEditors[0].options.glyphMargin).toBe(true);
    });

    it('places one marker per hunk, at git\u2019s MODIFIED-side line range', async () => {
      const { monaco } = await createLiveFixture(hunkTab(), jest.fn());

      const collection = monaco.diffEditors[0].modifiedEditor.collections[0];
      expect(collection.current).toHaveLength(3);
      expect(
        collection.current.map((d) => [
          d.range.startLineNumber,
          d.range.endLineNumber,
        ]),
      ).toEqual([
        [2, 4],
        [8, 10],
        [14, 16],
      ]);
      expect(
        collection.current.every((d) =>
          d.options.glyphMarginClassName?.includes('ptah-hunk-glyph'),
        ),
      ).toBe(true);
    });

    it('marks only the selected hunk as selected', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');

      const collection = monaco.diffEditors[0].modifiedEditor.collections[0];
      const selected = collection.current.filter((d) =>
        d.options.glyphMarginClassName?.includes('ptah-hunk-glyph-selected'),
      );
      expect(selected).toHaveLength(1);
      expect(selected[0].range.startLineNumber).toBe(2);
    });

    it('clamps a hunk that removes from the very top of the file', async () => {
      // Real git output for a deletion at line 1 is `@@ -1,3 +0,0 @@`: line 0
      // does not exist in Monaco, and `0 + 0 - 1` would end before it starts.
      const { monaco } = await createLiveFixture(
        hunkTab({
          hunks: [
            {
              index: 0,
              originalStart: 1,
              originalLines: 3,
              modifiedStart: 0,
              modifiedLines: 0,
              header: '@@ -1,3 +0,0 @@',
            },
          ],
        }),
        jest.fn(),
      );

      const collection = monaco.diffEditors[0].modifiedEditor.collections[0];
      expect(collection.current[0].range.startLineNumber).toBe(1);
      expect(collection.current[0].range.endLineNumber).toBe(1);
    });

    it('clamps a hunk that runs past the end of the model', async () => {
      const { monaco } = await createLiveFixture(
        hunkTab({ hunks: [hunkRef(0, 19, 40)] }),
        jest.fn(),
      );

      const collection = monaco.diffEditors[0].modifiedEditor.collections[0];
      expect(collection.current[0].range.endLineNumber).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // TASK_2026_221 — the in-editor action cluster
  // -------------------------------------------------------------------------

  describe('in-editor hunk action widget (TASK_2026_221)', () => {
    it('adds no content widget until a hunk is selected', async () => {
      // Nothing is selected on open, deliberately: a cluster floating over an
      // arbitrary hunk would suggest one was already armed.
      const { monaco } = await createLiveFixture(hunkTab(), jest.fn());

      expect(monaco.diffEditors[0].modifiedEditor.contentWidgets).toHaveLength(
        0,
      );
    });

    it('anchors the widget at the selected hunk modifiedStart, preferring ABOVE', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');

      const widgets = monaco.diffEditors[0].modifiedEditor.contentWidgets;
      expect(widgets).toHaveLength(1);
      const position = widgets[0].getPosition();
      // THREE_HUNKS[0] starts at modified line 2.
      expect(position?.position.lineNumber).toBe(2);
      // ABOVE first — rendering below modifiedStart would cover the hunk's own
      // first line, which is the line the user is deciding about.
      expect(position?.preference[0]).toBe(
        monaco.api.editor.ContentWidgetPositionPreference.ABOVE,
      );
    });

    it('re-anchors the SAME widget when the selection steps, rather than churning the node', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());
      const modified = monaco.diffEditors[0].modifiedEditor;

      click(fixture, 'hunk-next');
      const node = modified.contentWidgets[0].getDomNode();

      click(fixture, 'hunk-next');

      expect(modified.contentWidgets).toHaveLength(1);
      expect(modified.contentWidgets[0].getDomNode()).toBe(node);
      expect(modified.layoutedWidgets).toBeGreaterThan(0);
      expect(
        modified.contentWidgets[0].getPosition()?.position.lineNumber,
      ).toBe(8);
    });

    it('renders the comparison-appropriate actions through Angular, not innerHTML', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');

      const node = monaco.diffEditors[0].modifiedEditor.contentWidgets[0]
        .getDomNode()
        .querySelector('[data-testid="hunk-widget"]');
      expect(node).not.toBeNull();
      // A worktree diff defines stage and revert; unstage belongs to a staged
      // one and is not rendered as a button that would round-trip to
      // INVALID_OPERATION.
      expect(
        node?.querySelector('[data-testid="hunk-widget-stage"]'),
      ).not.toBeNull();
      expect(
        node?.querySelector('[data-testid="hunk-widget-revert"]'),
      ).not.toBeNull();
      expect(
        node?.querySelector('[data-testid="hunk-widget-unstage"]'),
      ).toBeNull();
    });

    it('keeps every widget button out of the tab order — the header toolbar is the keyboard path (AC14)', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');

      const buttons = Array.from(
        monaco.diffEditors[0].modifiedEditor.contentWidgets[0]
          .getDomNode()
          .querySelectorAll('button'),
      );
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button.getAttribute('tabindex')).toBe('-1');
        // Still named, so the cluster is readable with a virtual cursor even
        // though it is not a second tab stop.
        expect(button.getAttribute('aria-label')).toBeTruthy();
      }
    });

    it('stages through the widget button with the token the selection was made against', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture, monaco } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      const stage = monaco.diffEditors[0].modifiedEditor.contentWidgets[0]
        .getDomNode()
        .querySelector<HTMLButtonElement>('[data-testid="hunk-widget-stage"]');
      stage?.click();

      expect(apply).toHaveBeenCalledWith({
        key: 'diff:worktree:src/index.ts',
        operation: 'stage',
        hunkIndices: [0],
        snapshotToken: 'tok-1',
      });
    });

    it('routes the widget Discard through the SAME confirmation dialog, writing nothing on the first click (AC5)', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture, monaco } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      monaco.diffEditors[0].modifiedEditor.contentWidgets[0]
        .getDomNode()
        .querySelector<HTMLButtonElement>('[data-testid="hunk-widget-revert"]')
        ?.click();
      fixture.detectChanges();

      expect(apply).not.toHaveBeenCalled();
      expect(query(fixture, 'hunk-revert-dialog')).not.toBeNull();
    });

    it('REMOVES the widget once the selection is gone, rather than parking it off screen', async () => {
      // Monaco parks a widget whose getPosition returns null; that would leave
      // a cluster in the accessibility tree describing a hunk nobody selected.
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture, monaco } = await createLiveFixture(hunkTab(), apply);
      const modified = monaco.diffEditors[0].modifiedEditor;

      click(fixture, 'hunk-next');
      expect(modified.contentWidgets).toHaveLength(1);

      // A successful apply clears the selection.
      modified.contentWidgets[0]
        .getDomNode()
        .querySelector<HTMLButtonElement>('[data-testid="hunk-widget-stage"]')
        ?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(modified.contentWidgets).toHaveLength(0);
    });

    it('offers no widget on a surface with no git behind it', async () => {
      const { monaco } = await createLiveFixture(hunkTab(), null);

      expect(monaco.diffEditors[0].modifiedEditor.contentWidgets).toHaveLength(
        0,
      );
    });
  });

  describe('hunkLineRange / hunkAtLine (the mapping the affordances stand on)', () => {
    it('maps a normal hunk to its modified-side range', () => {
      expect(hunkLineRange(hunkRef(0, 8, 3), 100)).toEqual({
        startLine: 8,
        endLine: 10,
      });
    });

    it('never produces line 0, and never ends before it starts', () => {
      const deletion = {
        index: 0,
        originalStart: 1,
        originalLines: 4,
        modifiedStart: 0,
        modifiedLines: 0,
        header: '@@ -1,4 +0,0 @@',
      };
      expect(hunkLineRange(deletion, 50)).toEqual({ startLine: 1, endLine: 1 });
    });

    it('answers null for a context line — a missed click selects nothing', () => {
      expect(hunkAtLine(THREE_HUNKS, 6, 20)).toBeNull();
      expect(hunkAtLine(THREE_HUNKS, 9, 20)?.index).toBe(1);
    });
  });

  describe('the glyph margin selects, and only on a hunk', () => {
    it('selects the hunk under a glyph-margin click', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());
      const modified = monaco.diffEditors[0].modifiedEditor;

      modified.mouseListeners[0]({
        target: { type: GUTTER_GLYPH_MARGIN, position: { lineNumber: 9 } },
      });
      fixture.detectChanges();

      expect(query(fixture, 'hunk-position')?.textContent?.trim()).toBe(
        'Hunk 2 of 3',
      );
    });

    it('ignores a click on a line belonging to no hunk', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());
      const modified = monaco.diffEditors[0].modifiedEditor;

      modified.mouseListeners[0]({
        target: { type: GUTTER_GLYPH_MARGIN, position: { lineNumber: 6 } },
      });
      fixture.detectChanges();

      expect(query(fixture, 'hunk-position')?.textContent?.trim()).toBe(
        '3 hunks',
      );
    });

    it('ignores a click that is not on the glyph margin', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());
      const modified = monaco.diffEditors[0].modifiedEditor;

      modified.mouseListeners[0]({
        // CONTENT_TEXT — clicking the code itself must not arm an operation.
        target: { type: 6, position: { lineNumber: 9 } },
      });
      fixture.detectChanges();

      expect(query(fixture, 'hunk-position')?.textContent?.trim()).toBe(
        '3 hunks',
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC14 — keyboard reachability
  // -------------------------------------------------------------------------

  describe('AC14 — the keyboard path', () => {
    it('exposes the actions as a labelled toolbar', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());

      const toolbar = query(fixture, 'hunk-toolbar');
      expect(toolbar?.getAttribute('role')).toBe('toolbar');
      expect(toolbar?.getAttribute('aria-orientation')).toBe('horizontal');
      expect(toolbar?.getAttribute('aria-label')).toContain('Hunk actions');
    });

    it('starts with NOTHING selected, so landing on the toolbar cannot write', async () => {
      const apply = jest.fn();
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      expect(query(fixture, 'hunk-position')?.textContent?.trim()).toBe(
        '3 hunks',
      );
      expect(query(fixture, 'hunk-stage')?.getAttribute('aria-disabled')).toBe(
        'true',
      );

      click(fixture, 'hunk-stage');
      expect(apply).not.toHaveBeenCalled();
    });

    it('walks the hunks with Next and Previous, wrapping at both ends', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());
      const label = () => query(fixture, 'hunk-position')?.textContent?.trim();

      click(fixture, 'hunk-next');
      expect(label()).toBe('Hunk 1 of 3');
      click(fixture, 'hunk-next');
      click(fixture, 'hunk-next');
      expect(label()).toBe('Hunk 3 of 3');
      click(fixture, 'hunk-next');
      expect(label()).toBe('Hunk 1 of 3');
      click(fixture, 'hunk-prev');
      expect(label()).toBe('Hunk 3 of 3');
    });

    it('scrolls the selected hunk into view — reachable is not enough if unseen', async () => {
      const { fixture, monaco } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-next');

      expect(monaco.diffEditors[0].modifiedEditor.revealed).toEqual([2, 8]);
    });

    it('keeps exactly ONE tab stop for the whole group (roving tabindex)', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());

      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll<HTMLButtonElement>(
          '[data-hunk-action]',
        ),
      );
      expect(buttons).toHaveLength(4); // prev, next, stage, revert
      expect(
        buttons.filter((b) => b.getAttribute('tabindex') === '0'),
      ).toHaveLength(1);
    });

    it('moves focus along the toolbar with the arrow keys', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());
      const toolbar = query(fixture, 'hunk-toolbar');
      const stage = query(fixture, 'hunk-stage');

      toolbar?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      fixture.detectChanges();
      toolbar?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      fixture.detectChanges();

      expect(document.activeElement).toBe(stage);
      expect(stage?.getAttribute('tabindex')).toBe('0');
    });

    it('keeps unavailable actions FOCUSABLE via aria-disabled, not disabled', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());

      const stage = query(fixture, 'hunk-stage') as HTMLButtonElement;
      // A `disabled` button leaves the focus order, which would put holes in
      // the roving tabindex and make arrow navigation skip silently.
      expect(stage.disabled).toBe(false);
      expect(stage.getAttribute('aria-disabled')).toBe('true');
    });

    it('names the hunk each action would act on', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());

      expect(
        query(fixture, 'hunk-stage')?.getAttribute('aria-label'),
      ).toContain('no hunk selected yet');
      click(fixture, 'hunk-next');
      expect(query(fixture, 'hunk-stage')?.getAttribute('aria-label')).toBe(
        'Stage hunk 1 of 3',
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC12 (presentation) — which operations a comparison defines
  // -------------------------------------------------------------------------

  describe('the operations offered follow the comparison', () => {
    it('a working-tree diff offers Stage and Discard', async () => {
      const { fixture } = await createLiveFixture(
        hunkTab({ comparison: 'worktree' }),
        jest.fn(),
      );

      expect(query(fixture, 'hunk-stage')).not.toBeNull();
      expect(query(fixture, 'hunk-revert')).not.toBeNull();
      expect(query(fixture, 'hunk-unstage')).toBeNull();
    });

    it('a staged diff offers Unstage only', async () => {
      const { fixture } = await createLiveFixture(
        hunkTab({ comparison: 'staged' }),
        jest.fn(),
      );

      expect(query(fixture, 'hunk-unstage')).not.toBeNull();
      expect(query(fixture, 'hunk-stage')).toBeNull();
      expect(query(fixture, 'hunk-revert')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // AC2 / AC3 — a plain stage / unstage
  // -------------------------------------------------------------------------

  describe('stage and unstage go straight through', () => {
    it('sends the selected ordinal with the token it was selected against', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith({
        key: diffTabKey('worktree', 'src/index.ts'),
        operation: 'stage',
        hunkIndices: [1],
        snapshotToken: 'tok-1',
      });
    });

    it('does NOT confirm a stage — it is undone by one press of Unstage', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');

      expect(query(fixture, 'hunk-revert-dialog')).toBeNull();
      expect(apply).toHaveBeenCalledTimes(1);
    });

    it('clears the selection after a successful apply, closing the re-submit window', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      await fixture.whenStable();
      fixture.detectChanges();

      // The refresh that follows will invalidate the token anyway, but it is
      // asynchronous; this closes the gap deterministically.
      expect(query(fixture, 'hunk-position')?.textContent?.trim()).toBe(
        '3 hunks',
      );
    });
  });

  // -------------------------------------------------------------------------
  // TASK_2026_223 — the click that lands mid-await.
  //
  // `applyInFlight` gates `canApply`, and `onHunkAction` returns early when
  // that is false. The refresh-then-click ordering has a test; the
  // click-DURING-RPC ordering had none, and this batch has twice found guards
  // that looked structurally correct and were never actually exercised, so a
  // refactor could have removed this one with every test still green.
  //
  // The apply promise is held open deliberately rather than awaited, because
  // the whole question is what the component does while it is pending. Every
  // assertion is about how many calls reach the wire, not about whether a
  // handler was entered — a guard that merely runs is exactly the shape that
  // proved vacuous before.
  // -------------------------------------------------------------------------

  describe('a second action landing mid-RPC (TASK_2026_223)', () => {
    /** An apply whose promise the test controls. */
    function deferredApply() {
      let resolve!: (value: { success: boolean; message?: string }) => void;
      const apply = jest.fn(
        () =>
          new Promise<{ success: boolean; message?: string }>((r) => {
            resolve = r;
          }),
      );
      return { apply, settle: () => resolve({ success: true }) };
    }

    it('(223-1) a second toolbar press while the first RPC is pending never reaches the wire', async () => {
      const { apply, settle } = deferredApply();
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      expect(apply).toHaveBeenCalledTimes(1);

      // The RPC has NOT settled. Press again — repeatedly, as an impatient
      // user does.
      fixture.detectChanges();
      click(fixture, 'hunk-stage');
      click(fixture, 'hunk-stage');

      expect(apply).toHaveBeenCalledTimes(1);

      settle();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(apply).toHaveBeenCalledTimes(1);
    });

    it('(223-2) a glyph click mid-RPC re-aims the selection but still cannot fire a second apply', async () => {
      const { apply, settle } = deferredApply();
      const { fixture, monaco } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ hunkIndices: [0] }),
      );

      // The exact ordering the register flagged: the glyph moves the selection
      // while the first write is still in the air.
      monaco.diffEditors[0].modifiedEditor.mouseListeners[0]({
        target: { type: GUTTER_GLYPH_MARGIN, position: { lineNumber: 9 } },
      });
      fixture.detectChanges();
      click(fixture, 'hunk-stage');

      // One call, still aimed at the hunk the user actually pressed for.
      expect(apply).toHaveBeenCalledTimes(1);

      settle();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(apply).toHaveBeenCalledTimes(1);
    });

    it('(223-3) the toolbar is ABSENT-of-action, not latched — a press after the RPC settles works', async () => {
      const { apply, settle } = deferredApply();
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      settle();
      await fixture.whenStable();
      fixture.detectChanges();

      // A successful apply clears the selection, so re-select before pressing.
      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');

      expect(apply).toHaveBeenCalledTimes(2);
    });

    it('(223-4) a failed apply also releases the guard, so the user can retry', async () => {
      let reject!: (reason: unknown) => void;
      const apply = jest.fn(
        () =>
          new Promise<{ success: boolean }>((_, r) => {
            reject = r;
          }),
      );
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      click(fixture, 'hunk-stage');
      expect(apply).toHaveBeenCalledTimes(1);

      reject(new Error('transport died'));
      await fixture.whenStable();
      fixture.detectChanges();

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      expect(apply).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // AC5 — revert is never a single unconfirmed click
  // -------------------------------------------------------------------------

  describe('AC5 — discarding a hunk is confirmed', () => {
    it('writes NOTHING on the first click, and opens an alert dialog instead', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-revert');

      expect(apply).not.toHaveBeenCalled();
      const dialog = query(fixture, 'hunk-revert-dialog');
      expect(dialog?.getAttribute('role')).toBe('alertdialog');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
      expect(dialog?.getAttribute('aria-describedby')).toBeTruthy();
    });

    it('says which hunk, in which file, and that it cannot be undone', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-revert');

      const text = query(fixture, 'hunk-revert-dialog')?.textContent ?? '';
      expect(text).toContain('Hunk 1 of 3');
      expect(text).toContain('src/index.ts');
      expect(text).toContain('cannot be undone');
    });

    it('Cancel writes nothing and closes', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-revert');
      click(fixture, 'hunk-revert-cancel');

      expect(apply).not.toHaveBeenCalled();
      expect(query(fixture, 'hunk-revert-dialog')).toBeNull();
    });

    it('Escape maps to Cancel, the non-destructive choice', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-revert');
      query(fixture, 'hunk-revert-dialog')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();

      expect(apply).not.toHaveBeenCalled();
      expect(query(fixture, 'hunk-revert-dialog')).toBeNull();
    });

    it('Confirm applies exactly one revert', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-revert');
      click(fixture, 'hunk-revert-confirm');

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'revert', hunkIndices: [0] }),
      );
      expect(query(fixture, 'hunk-revert-dialog')).toBeNull();
    });

    it('opens with focus on Cancel and keeps Tab inside the dialog', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-revert');

      const cancel = query(fixture, 'hunk-revert-cancel');
      const confirm = query(fixture, 'hunk-revert-confirm');
      expect(document.activeElement).toBe(cancel);

      query(fixture, 'hunk-revert-dialog')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
      expect(document.activeElement).toBe(confirm);

      query(fixture, 'hunk-revert-dialog')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
      expect(document.activeElement).toBe(cancel);
    });

    it('restores focus to the control that raised it', async () => {
      const { fixture } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');
      const revert = query(fixture, 'hunk-revert') as HTMLButtonElement;
      revert.focus();
      revert.click();
      fixture.detectChanges();

      click(fixture, 'hunk-revert-cancel');
      expect(document.activeElement).toBe(revert);
    });
  });

  // -------------------------------------------------------------------------
  // AC6 (client half) — a selection is bound to the snapshot it was made on
  // -------------------------------------------------------------------------

  describe('AC6 — a selection never outlives the diff it was made on', () => {
    it('drops the selection when a revalidation renumbers the hunks', async () => {
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture, setTab } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-next');
      expect(query(fixture, 'hunk-position')?.textContent?.trim()).toBe(
        'Hunk 2 of 3',
      );

      // A `git:status-update` lands: same tab, new content, NEW token, and the
      // hunk that was ordinal 1 is now something else entirely.
      setTab(
        hunkTab({
          snapshotToken: 'tok-2',
          hunks: [hunkRef(0, 2), hunkRef(1, 8)],
        }),
      );

      expect(query(fixture, 'hunk-position')?.textContent?.trim()).toBe(
        '2 hunks',
      );
      click(fixture, 'hunk-stage');
      expect(apply).not.toHaveBeenCalled();
    });

    it('drops the selection when the tab is switched', async () => {
      const { fixture, setTab } = await createLiveFixture(hunkTab(), jest.fn());

      click(fixture, 'hunk-next');
      setTab(hunkTab({ path: 'src/other.ts', snapshotToken: 'tok-other' }));

      expect(query(fixture, 'hunk-position')?.textContent?.trim()).toBe(
        '3 hunks',
      );
    });

    it('carries the ORIGINAL token through the confirmation dialog', async () => {
      // The dialog is exactly the window in which a revalidation can land.
      // Re-reading the token at confirm time would hand the backend a fresh
      // token with a stale ordinal — which its own AC6 check cannot catch.
      const apply = jest.fn().mockResolvedValue({ success: true });
      const { fixture, setTab } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-revert');

      setTab(
        hunkTab({
          snapshotToken: 'tok-2',
          hunks: [hunkRef(0, 30), hunkRef(1, 40), hunkRef(2, 50)],
        }),
      );
      click(fixture, 'hunk-revert-confirm');

      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotToken: 'tok-1', hunkIndices: [0] }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC7 — say what failed and why
  // -------------------------------------------------------------------------

  describe('AC7 — a failed apply is surfaced, not swallowed', () => {
    it("shows the backend's own sanitized sentence in an alert region", async () => {
      const apply = jest.fn().mockResolvedValue({
        success: false,
        code: 'STALE_SNAPSHOT',
        message: 'The file changed since this diff was read.',
      });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      await fixture.whenStable();
      fixture.detectChanges();

      const alert = query(fixture, 'hunk-apply-error');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toContain(
        'The file changed since this diff was read.',
      );
    });

    it('falls back to copy that still promises nothing was written', async () => {
      const apply = jest.fn().mockResolvedValue({ success: false });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, 'hunk-apply-error')?.textContent).toContain(
        'Nothing was written',
      );
    });

    it('reports a thrown apply without leaking its message', async () => {
      const apply = jest
        .fn()
        .mockRejectedValue(new Error('D:\\secret\\path exploded'));
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      await fixture.whenStable();
      fixture.detectChanges();

      const text = query(fixture, 'hunk-apply-error')?.textContent ?? '';
      expect(text).toContain('Nothing was written');
      expect(text).not.toContain('secret');
    });

    it('clears the error when the user selects another hunk', async () => {
      const apply = jest.fn().mockResolvedValue({ success: false });
      const { fixture } = await createLiveFixture(hunkTab(), apply);

      click(fixture, 'hunk-next');
      click(fixture, 'hunk-stage');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(query(fixture, 'hunk-apply-error')).not.toBeNull();

      click(fixture, 'hunk-next');
      expect(query(fixture, 'hunk-apply-error')).toBeNull();
    });
  });
});
