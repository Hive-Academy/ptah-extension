/**
 * CodeEditorComponent specs — direct Monaco lifecycle + per-file model reuse.
 *
 * These assert OUTCOMES, not spy wiring:
 *   - the editor is created exactly once and survives file switches,
 *   - each file gets one cached model; switching back reuses it (no flicker),
 *   - view state (scroll/cursor) is saved on switch-away and restored on return,
 *   - external content updates (revert / reread) mutate the model in place,
 *   - user edits emit contentChanged + flip the dirty badge,
 *   - Ctrl/Cmd+S emits fileSaved with the live model value,
 *   - destroy disposes the editor and every cached model.
 *
 * Monaco is faked so the create/model/view-state paths actually run.
 */

jest.mock('ngx-markdown', () => {
  const { Component, Input, NgModule, ChangeDetectionStrategy } =
    jest.requireActual('@angular/core');
  @Component({
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div></div>',
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }
  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CodeEditorComponent } from './code-editor.component';
import { VimModeService } from '../services/vim-mode.service';
import { EditorService } from '../services/editor.service';
import { MonacoLoaderService } from '../services/monaco-loader.service';

// ---------------------------------------------------------------------------
// Fake Monaco
// ---------------------------------------------------------------------------
interface FakeModel {
  uri: { toString: () => string };
  getValue: jest.Mock<string, []>;
  setValue: jest.Mock<void, [string]>;
  getFullModelRange: jest.Mock;
  pushEditOperations: jest.Mock;
  getLanguageId: jest.Mock<string, []>;
  onDidChangeContent: jest.Mock;
  dispose: jest.Mock;
  _value: string;
  _lang: string;
}

function makeModel(
  value: string,
  lang: string,
  uri: { toString: () => string },
): FakeModel {
  const model = {
    uri,
    _value: value,
    _lang: lang,
  } as FakeModel;
  model.getValue = jest.fn(() => model._value);
  model.setValue = jest.fn((v: string) => {
    model._value = v;
  });
  model.getFullModelRange = jest.fn(() => ({}));
  model.pushEditOperations = jest.fn(
    (_a: unknown, edits: Array<{ text: string }>) => {
      model._value = edits[0].text;
      return null;
    },
  );
  model.getLanguageId = jest.fn(() => model._lang);
  model.onDidChangeContent = jest.fn(() => ({ dispose: jest.fn() }));
  model.dispose = jest.fn();
  return model;
}

interface FakeEditor {
  _active: FakeModel | null;
  _contentCb: (() => void) | null;
  setModel: jest.Mock;
  getModel: jest.Mock<FakeModel | null, []>;
  onDidChangeModelContent: jest.Mock;
  saveViewState: jest.Mock;
  restoreViewState: jest.Mock;
  revealLineInCenter: jest.Mock;
  setPosition: jest.Mock;
  layout: jest.Mock;
  updateOptions: jest.Mock;
  dispose: jest.Mock;
  getDomNode: jest.Mock;
}

function makeFakeMonaco() {
  const registry = new Map<string, FakeModel>();
  const createdModels: FakeModel[] = [];
  let viewStateCounter = 0;

  const editor = {
    _active: null,
    _contentCb: null,
  } as FakeEditor;
  editor.setModel = jest.fn((m: FakeModel | null) => {
    editor._active = m;
  });
  editor.getModel = jest.fn(() => editor._active);
  editor.onDidChangeModelContent = jest.fn((cb: () => void) => {
    editor._contentCb = cb;
    return { dispose: jest.fn() };
  });
  editor.saveViewState = jest.fn(() => ({ id: ++viewStateCounter }));
  editor.restoreViewState = jest.fn();
  editor.revealLineInCenter = jest.fn();
  editor.setPosition = jest.fn();
  editor.layout = jest.fn();
  editor.updateOptions = jest.fn();
  editor.dispose = jest.fn();
  editor.getDomNode = jest.fn(() => document.createElement('div'));

  const api = {
    editor: {
      create: jest.fn(() => editor),
      createModel: jest.fn(
        (value: string, lang: string, uri: { toString: () => string }) => {
          const m = makeModel(value, lang, uri);
          registry.set(uri.toString(), m);
          createdModels.push(m);
          return m;
        },
      ),
      getModel: jest.fn(
        (uri: { toString: () => string }) =>
          registry.get(uri.toString()) ?? null,
      ),
      setModelLanguage: jest.fn((m: FakeModel, lang: string) => {
        m._lang = lang;
      }),
      setTheme: jest.fn(),
    },
    Uri: {
      parse: (s: string) => ({ toString: () => s }),
    },
  };

  return { api, editor, createdModels, registry };
}

function makeVimStub() {
  return {
    enabled: signal(false).asReadonly(),
    attachToEditor: jest.fn(),
    detach: jest.fn(),
  } as unknown as VimModeService;
}

function makeEditorServiceStub() {
  const target = signal<number | undefined>(undefined);
  return {
    targetLine: target.asReadonly(),
    clearTargetLine: jest.fn(() => target.set(undefined)),
    _target: target,
  } as unknown as EditorService & { _target: typeof target };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('CodeEditorComponent — Monaco model reuse (F1)', () => {
  let fixture: ComponentFixture<CodeEditorComponent>;
  let component: CodeEditorComponent;
  let fake: ReturnType<typeof makeFakeMonaco>;
  let loader: { load: jest.Mock };

  async function setup(filePath = '/ws/a.ts', content = 'AAA'): Promise<void> {
    fake = makeFakeMonaco();
    loader = { load: jest.fn(() => Promise.resolve(fake.api)) };

    TestBed.configureTestingModule({
      imports: [CodeEditorComponent],
      providers: [
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: EditorService, useValue: makeEditorServiceStub() },
        { provide: MonacoLoaderService, useValue: loader },
      ],
    });
    fixture = TestBed.createComponent(CodeEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('filePath', filePath);
    fixture.componentRef.setInput('content', content);
    fixture.detectChanges();
    await flush();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('creates the Monaco editor exactly once', async () => {
    await setup();
    expect(fake.api.editor.create).toHaveBeenCalledTimes(1);
    // Initial file gets a model attached.
    expect(fake.editor.setModel).toHaveBeenCalled();
    expect(fake.editor._active?.getValue()).toBe('AAA');
  });

  it('does NOT recreate the editor when switching files', async () => {
    await setup('/ws/a.ts', 'AAA');
    fixture.componentRef.setInput('filePath', '/ws/b.ts');
    fixture.componentRef.setInput('content', 'BBB');
    fixture.detectChanges();
    await flush();

    // Editor created once; two distinct models created (a.ts, b.ts).
    expect(fake.api.editor.create).toHaveBeenCalledTimes(1);
    expect(fake.createdModels).toHaveLength(2);
    expect(fake.editor._active?.getValue()).toBe('BBB');
  });

  it('reuses the cached model when switching back to a prior file', async () => {
    await setup('/ws/a.ts', 'AAA');
    fixture.componentRef.setInput('filePath', '/ws/b.ts');
    fixture.componentRef.setInput('content', 'BBB');
    fixture.detectChanges();
    await flush();

    // Switch back to a.ts — content input carries a.ts's content again.
    fixture.componentRef.setInput('filePath', '/ws/a.ts');
    fixture.componentRef.setInput('content', 'AAA');
    fixture.detectChanges();
    await flush();

    // Still only two models total (no re-creation of a.ts's model).
    expect(fake.createdModels).toHaveLength(2);
    expect(fake.editor._active?.getValue()).toBe('AAA');
  });

  it('saves view state on switch-away and restores it on return', async () => {
    await setup('/ws/a.ts', 'AAA');
    fixture.componentRef.setInput('filePath', '/ws/b.ts');
    fixture.componentRef.setInput('content', 'BBB');
    fixture.detectChanges();
    await flush();
    expect(fake.editor.saveViewState).toHaveBeenCalled();

    fixture.componentRef.setInput('filePath', '/ws/a.ts');
    fixture.componentRef.setInput('content', 'AAA');
    fixture.detectChanges();
    await flush();
    expect(fake.editor.restoreViewState).toHaveBeenCalled();
  });

  it('applies an external content update to the existing model in place', async () => {
    await setup('/ws/a.ts', 'AAA');
    // Same file, new (external) content — e.g. a git revert / reread.
    fixture.componentRef.setInput('content', 'REVERTED');
    fixture.detectChanges();
    await flush();

    // No new model created; the existing one was edited in place.
    expect(fake.createdModels).toHaveLength(1);
    expect(fake.createdModels[0].pushEditOperations).toHaveBeenCalled();
    expect(fake.editor._active?.getValue()).toBe('REVERTED');
    // External update does not emit contentChanged.
  });

  it('emits contentChanged and flips the dirty badge on a user edit', async () => {
    await setup('/ws/a.ts', 'AAA');
    const changed = jest.fn();
    component.contentChanged.subscribe(changed);

    // Simulate a user edit: model value changes, Monaco fires the content cb.
    fake.editor._active!._value = 'AAA edited';
    fake.editor._contentCb?.();
    await flush();

    expect(changed).toHaveBeenCalledWith('AAA edited');
    expect(component.isDirty()).toBe(true);
  });

  it('does NOT emit contentChanged for an external update', async () => {
    await setup('/ws/a.ts', 'AAA');
    const changed = jest.fn();
    component.contentChanged.subscribe(changed);

    fixture.componentRef.setInput('content', 'EXTERNAL');
    fixture.detectChanges();
    await flush();

    expect(changed).not.toHaveBeenCalled();
    expect(component.isDirty()).toBe(false);
  });

  it('emits fileSaved with the live model value on Ctrl+S', async () => {
    await setup('/ws/a.ts', 'AAA');
    const saved = jest.fn();
    component.fileSaved.subscribe(saved);

    fake.editor._active!._value = 'AAA edited';
    const host = fixture.nativeElement.querySelector(
      '[data-testid="editor-monaco"] > div',
    ) as HTMLElement;
    host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true }),
    );

    expect(saved).toHaveBeenCalledWith({
      filePath: '/ws/a.ts',
      content: 'AAA edited',
    });
    expect(component.isDirty()).toBe(false);
  });

  it('disposes the editor and every cached model on destroy', async () => {
    await setup('/ws/a.ts', 'AAA');
    fixture.componentRef.setInput('filePath', '/ws/b.ts');
    fixture.componentRef.setInput('content', 'BBB');
    fixture.detectChanges();
    await flush();

    const models = [...fake.createdModels];
    fixture.destroy();

    expect(fake.editor.dispose).toHaveBeenCalledTimes(1);
    for (const m of models) {
      expect(m.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('does not throw when editor.dispose() throws', async () => {
    await setup('/ws/a.ts', 'AAA');
    fake.editor.dispose.mockImplementation(() => {
      throw new Error('already disposed');
    });
    expect(() => fixture.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Split-pane: two concurrent instances against ONE shared Monaco registry.
// This is the highest-risk area of the rewrite (per-instance URI namespacing
// to avoid "model URI already in use" collisions when the same file is open in
// both the left and right split panes). TASK_2026_154 Moderate #3.
// ---------------------------------------------------------------------------
describe('CodeEditorComponent — split-pane multi-instance (F1)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  async function flush3(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('gives each instance its own model for the SAME file (no URI collision) and isolates dispose', async () => {
    // A single fake Monaco registry shared by both component instances — this
    // is exactly the real Monaco global model registry both split panes hit.
    const shared = makeFakeMonaco();
    const loader = { load: jest.fn(() => Promise.resolve(shared.api)) };

    TestBed.configureTestingModule({
      imports: [CodeEditorComponent],
      providers: [
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: EditorService, useValue: makeEditorServiceStub() },
        { provide: MonacoLoaderService, useValue: loader },
      ],
    });

    // Left pane instance opens /ws/same.ts.
    const left = TestBed.createComponent(CodeEditorComponent);
    left.componentRef.setInput('filePath', '/ws/same.ts');
    left.componentRef.setInput('content', 'LEFT');
    left.detectChanges();
    await flush3();

    // Right pane instance opens the SAME file path.
    const right = TestBed.createComponent(CodeEditorComponent);
    right.componentRef.setInput('filePath', '/ws/same.ts');
    right.componentRef.setInput('content', 'RIGHT');
    right.detectChanges();
    await flush3();

    // Two DISTINCT models were created despite the identical file path — the
    // per-instance URI namespace prevented a registry collision.
    expect(shared.createdModels).toHaveLength(2);
    const [leftModel, rightModel] = shared.createdModels;
    expect(leftModel.uri.toString()).not.toBe(rightModel.uri.toString());
    // Both URIs encode the same file path, differing only in instance prefix.
    const encodedPath = encodeURIComponent('/ws/same.ts');
    expect(leftModel.uri.toString()).toContain(encodedPath);
    expect(rightModel.uri.toString()).toContain(encodedPath);

    // Disposing the left instance must NOT dispose the right instance's model.
    left.destroy();
    expect(leftModel.dispose).toHaveBeenCalledTimes(1);
    expect(rightModel.dispose).not.toHaveBeenCalled();

    right.destroy();
    expect(rightModel.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Pure logic (no Monaco needed)
// ---------------------------------------------------------------------------
describe('CodeEditorComponent — pure computed logic', () => {
  let fixture: ComponentFixture<CodeEditorComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CodeEditorComponent],
      providers: [
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: EditorService, useValue: makeEditorServiceStub() },
        {
          provide: MonacoLoaderService,
          // Never resolves — keeps Monaco out of these pure tests.
          useValue: {
            load: jest.fn(() => new Promise<never>(() => undefined)),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(CodeEditorComponent);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('detects markdown files', () => {
    fixture.componentRef.setInput('filePath', '/ws/readme.MD');
    fixture.detectChanges();
    expect(fixture.componentInstance.isMarkdownFile()).toBe(true);

    fixture.componentRef.setInput('filePath', '/ws/a.ts');
    fixture.detectChanges();
    expect(fixture.componentInstance.isMarkdownFile()).toBe(false);
  });

  it('derives the file name from the path', () => {
    fixture.componentRef.setInput('filePath', 'C:\\repo\\src\\main.ts');
    fixture.detectChanges();
    expect(fixture.componentInstance.fileName()).toBe('main.ts');
  });

  it('maps extensions to Monaco languages', () => {
    const detect = (
      fixture.componentInstance as unknown as {
        detectLanguage: (p?: string) => string;
      }
    ).detectLanguage.bind(fixture.componentInstance);
    expect(detect('/x/a.ts')).toBe('typescript');
    expect(detect('/x/a.py')).toBe('python');
    expect(detect('/x/a.unknownext')).toBe('plaintext');
    expect(detect(undefined)).toBe('plaintext');
  });
});
