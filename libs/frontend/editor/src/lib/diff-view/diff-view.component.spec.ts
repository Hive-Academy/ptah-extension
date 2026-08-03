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
import { DiffViewComponent } from './diff-view.component';
import { MonacoLoaderService } from '../services/monaco-loader.service';
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
    setModel(model: { original: FakeModel; modified: FakeModel } | null): void;
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
      createDiffEditor: () => {
        const editor: FakeDiffEditor = {
          model: null,
          options: {},
          layouts: 0,
          setModelCalls: 0,
          savedStates: 0,
          restored: [],
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
