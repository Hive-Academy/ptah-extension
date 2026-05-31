jest.mock('ngx-markdown', () => {
  const { Component, Input, NgModule, ChangeDetectionStrategy } = jest.requireActual('@angular/core');
  @Component({
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div></div>',
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }
  @NgModule({ imports: [MarkdownStubComponent], exports: [MarkdownStubComponent] })
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

jest.mock('ngx-monaco-editor-v2', () => {
  const { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, forwardRef } = jest.requireActual('@angular/core');
  const { NG_VALUE_ACCESSOR } = jest.requireActual('@angular/forms');
  @Component({
    selector: 'ngx-monaco-editor',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div></div>',
    providers: [
      {
        provide: NG_VALUE_ACCESSOR,
        useExisting: forwardRef(() => EditorStubComponent),
        multi: true,
      },
    ],
  })
  class EditorStubComponent {
    @Input() options: unknown;
    @Output() onInit = new EventEmitter<unknown>();
    writeValue(_v: unknown): void {
      void _v;
    }
    registerOnChange(_fn: (v: unknown) => void): void {
      void _fn;
    }
    registerOnTouched(_fn: () => void): void {
      void _fn;
    }
    setDisabledState(_d: boolean): void {
      void _d;
    }
  }
  return { EditorComponent: EditorStubComponent };
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CodeEditorComponent } from './code-editor.component';
import { VimModeService } from '../services/vim-mode.service';
import { EditorService } from '../services/editor.service';

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
  } as unknown as EditorService;
}

interface FakeEditor {
  getDomNode: jest.Mock;
  dispose: jest.Mock;
  revealLineInCenter: jest.Mock;
  setPosition: jest.Mock;
}

function makeFakeEditor(): { editor: FakeEditor; domNode: HTMLElement } {
  const domNode = document.createElement('div');
  return {
    domNode,
    editor: {
      getDomNode: jest.fn(() => domNode),
      dispose: jest.fn(),
      revealLineInCenter: jest.fn(),
      setPosition: jest.fn(),
    },
  };
}

describe('CodeEditorComponent — keydown + dispose (Batch C)', () => {
  let fixture: ComponentFixture<CodeEditorComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CodeEditorComponent],
      providers: [
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: EditorService, useValue: makeEditorServiceStub() },
      ],
    });
    fixture = TestBed.createComponent(CodeEditorComponent);
    fixture.componentRef.setInput('filePath', '/ws/file.ts');
    fixture.componentRef.setInput('content', 'hello');
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('binds keydown to editor.getDomNode(), NOT document', () => {
    const { editor, domNode } = makeFakeEditor();
    const addOnDocSpy = jest.spyOn(document, 'addEventListener');
    const addOnNodeSpy = jest.spyOn(domNode, 'addEventListener');

    (fixture.componentInstance as unknown as {
      onEditorInit: (e: unknown) => void;
    }).onEditorInit(editor);

    expect(addOnNodeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(addOnDocSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function));

    addOnDocSpy.mockRestore();
    addOnNodeSpy.mockRestore();
  });

  it('saves file on Ctrl+S when focused and filePath is set', () => {
    const { editor, domNode } = makeFakeEditor();
    (fixture.componentInstance as unknown as {
      onEditorInit: (e: unknown) => void;
    }).onEditorInit(editor);

    const savedSpy = jest.fn();
    fixture.componentInstance.fileSaved.subscribe(savedSpy);

    const evt = new KeyboardEvent('keydown', { key: 's', ctrlKey: true });
    domNode.dispatchEvent(evt);

    expect(savedSpy).toHaveBeenCalledWith({
      filePath: '/ws/file.ts',
      content: expect.any(String),
    });
  });

  it('saves file on Cmd+S when focused and filePath is set', () => {
    const { editor, domNode } = makeFakeEditor();
    (fixture.componentInstance as unknown as {
      onEditorInit: (e: unknown) => void;
    }).onEditorInit(editor);

    const savedSpy = jest.fn();
    fixture.componentInstance.fileSaved.subscribe(savedSpy);

    const evt = new KeyboardEvent('keydown', { key: 's', metaKey: true });
    domNode.dispatchEvent(evt);

    expect(savedSpy).toHaveBeenCalledTimes(1);
  });

  it('removes keydown listener from editor dom node on destroy', () => {
    const { editor, domNode } = makeFakeEditor();
    (fixture.componentInstance as unknown as {
      onEditorInit: (e: unknown) => void;
    }).onEditorInit(editor);

    const removeSpy = jest.spyOn(domNode, 'removeEventListener');
    fixture.destroy();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('calls editor.dispose() on destroy and nulls the ref', () => {
    const { editor } = makeFakeEditor();
    (fixture.componentInstance as unknown as {
      onEditorInit: (e: unknown) => void;
    }).onEditorInit(editor);

    fixture.destroy();

    expect(editor.dispose).toHaveBeenCalledTimes(1);

    const c = fixture.componentInstance as unknown as {
      monacoEditor: unknown;
    };
    expect(c.monacoEditor).toBeNull();
  });

  it('does not throw on destroy when editor.dispose() throws', () => {
    const { editor } = makeFakeEditor();
    editor.dispose.mockImplementation(() => {
      throw new Error('already disposed');
    });
    (fixture.componentInstance as unknown as {
      onEditorInit: (e: unknown) => void;
    }).onEditorInit(editor);

    expect(() => fixture.destroy()).not.toThrow();
  });
});
