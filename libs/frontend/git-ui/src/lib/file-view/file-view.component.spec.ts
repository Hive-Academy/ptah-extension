import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    template: `<div data-testid="markdown-rendered">{{ data }}</div>`,
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  class MarkdownStubComponent {
    @Input() data = '';
  }
  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}
  return { MarkdownModule };
});
jest.mock('@ptah-extension/markdown', () => ({
  MarkdownBlockComponent: jest.requireActual(
    '../../../../markdown/src/lib/markdown-block.component',
  ).MarkdownBlockComponent,
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import type { EditorTab, FileViewTabState } from '../types/diff-tab.types';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import { FileViewComponent } from './file-view.component';

function viewState(
  overrides: Partial<FileViewTabState> = {},
): FileViewTabState {
  return {
    absolutePath: '/ws/readme.md',
    workspaceRoot: '/ws',
    relativePath: 'readme.md',
    content: '# Safe preview',
    sizeBytes: 14,
    isMarkdown: true,
    reveal: { line: 50, column: 50 },
    status: 'fresh',
    request: { path: '/ws/readme.md', workspaceRoot: '/ws' },
    requestId: 1,
    ...overrides,
  };
}

function tab(view: FileViewTabState = viewState()): EditorTab {
  return {
    filePath: `view:${view.absolutePath}`,
    fileName: view.absolutePath.split('/').at(-1) ?? view.absolutePath,
    content: view.content,
    isDirty: false,
    view,
  };
}

function fakeMonaco() {
  const setSelection = jest.fn();
  const revealPositionInCenter = jest.fn();
  const editorDispose = jest.fn();
  const modelDispose = jest.fn();
  const model = {
    getValue: jest.fn(() => '# Safe preview'),
    setValue: jest.fn(),
    getLineCount: jest.fn(() => 3),
    getLineMaxColumn: jest.fn(() => 5),
    dispose: modelDispose,
  };
  const editor = {
    setModel: jest.fn(),
    setSelection,
    revealPositionInCenter,
    layout: jest.fn(),
    dispose: editorDispose,
  };
  const api = {
    editor: {
      create: jest.fn(() => editor),
      createModel: jest.fn(() => model),
      setTheme: jest.fn(),
    },
    languages: {
      getLanguages: jest.fn(() => [
        { id: 'markdown', extensions: ['.md', '.markdown', '.mdx'] },
        { id: 'typescript', extensions: ['.ts'] },
      ]),
    },
    Uri: { parse: jest.fn((value: string) => value) },
  };
  return {
    api,
    editor,
    model,
    setSelection,
    revealPositionInCenter,
    editorDispose,
    modelDispose,
  };
}

describe('FileViewComponent', () => {
  let monaco: ReturnType<typeof fakeMonaco>;

  beforeEach(() => {
    monaco = fakeMonaco();
    TestBed.configureTestingModule({
      imports: [FileViewComponent],
      providers: [
        {
          provide: MonacoLoaderService,
          useValue: { load: jest.fn().mockResolvedValue(monaco.api) },
        },
      ],
    });
  });

  async function render(initial = tab()) {
    const fixture = TestBed.createComponent(FileViewComponent);
    fixture.componentRef.setInput('tab', initial);
    fixture.componentRef.setInput('editorTargets', [
      { id: 'kiro', displayName: 'Kiro' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders markdown preview first through MarkdownBlockComponent and toggles to source', async () => {
    const fixture = await render();
    const host = fixture.nativeElement.querySelector(
      '[data-ptah-file-links]',
    ) as HTMLElement;
    expect(host.getAttribute('data-ptah-link-root')).toBe('/ws');
    expect(host.getAttribute('data-ptah-link-document')).toBe('/ws/readme.md');
    expect(
      fixture.nativeElement.querySelector('[data-testid="markdown-rendered"]')
        .textContent,
    ).toContain('# Safe preview');
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="file-view-preview-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-testid="file-view-editor"]')
        .classList,
    ).not.toContain('invisible');
  });

  it('uses read-only Monaco, detects language, and clamps reveal position', async () => {
    await render();
    expect(monaco.api.editor.create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ readOnly: true, domReadOnly: true }),
    );
    expect(monaco.api.editor.createModel).toHaveBeenCalledWith(
      '# Safe preview',
      'markdown',
      expect.anything(),
    );
    expect(monaco.setSelection).toHaveBeenCalledWith({
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 5,
    });
    expect(monaco.revealPositionInCenter).toHaveBeenCalledWith({
      lineNumber: 3,
      column: 5,
    });
  });

  it('disables preview over 512 KiB and disposes the prior model on tab change', async () => {
    const fixture = await render(tab(viewState({ sizeBytes: 512 * 1024 + 1 })));
    expect(fixture.nativeElement.textContent).toContain(
      'Preview is disabled for files over 512 KB.',
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="file-view-preview"]'),
    ).toBeNull();

    fixture.componentRef.setInput(
      'tab',
      tab(
        viewState({
          absolutePath: '/ws/b.ts',
          relativePath: 'b.ts',
          isMarkdown: false,
          content: 'const b = 1;',
          sizeBytes: 12,
        }),
      ),
    );
    fixture.detectChanges();
    expect(monaco.modelDispose).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(monaco.editorDispose).toHaveBeenCalledTimes(1);
  });

  it('shows fixed refusal copy and hides Open In when external open is disallowed', async () => {
    const fixture = await render(
      tab(
        viewState({
          status: 'blocked',
          content: '',
          failure: {
            reason: 'unsupported-path',
            message: 'This path form is not supported.',
            externalOpenAllowed: false,
          },
        }),
      ),
    );
    expect(fixture.nativeElement.textContent).toContain(
      'This path form is not supported.',
    );
    expect(
      fixture.nativeElement.querySelector('ptah-open-in-button'),
    ).toBeNull();
  });

  it('requires explicit confirmation showing path and editor before external open', async () => {
    const blocked = viewState({
      absolutePath: '/outside/a.ts',
      status: 'blocked',
      content: '',
      failure: {
        reason: 'outside-roots',
        message: 'This file is outside the open workspaces.',
        externalOpenAllowed: true,
      },
    });
    const fixture = await render(tab(blocked));
    const emitted: unknown[] = [];
    fixture.componentInstance.openExternal.subscribe((value) =>
      emitted.push(value),
    );
    const primary = fixture.nativeElement.querySelector(
      '[data-testid="open-in-primary"]',
    ) as HTMLButtonElement;
    primary.click();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector(
      '[role="alertdialog"]',
    ) as HTMLElement;
    expect(dialog.textContent).toContain('/outside/a.ts');
    expect(dialog.textContent).toContain('Kiro');
    expect(emitted).toEqual([]);
    (
      dialog.querySelector(
        '[data-testid="confirm-external-open"]',
      ) as HTMLButtonElement
    ).click();
    expect(emitted).toEqual([
      expect.objectContaining({ target: 'kiro', path: '/outside/a.ts' }),
    ]);
  });

  it('cancel emits nothing', async () => {
    const fixture = await render(
      tab(
        viewState({
          absolutePath: '/outside/a.ts',
          status: 'blocked',
          content: '',
          failure: {
            reason: 'outside-roots',
            message: 'Outside roots.',
            externalOpenAllowed: true,
          },
        }),
      ),
    );
    const emitted: unknown[] = [];
    fixture.componentInstance.openExternal.subscribe((value) =>
      emitted.push(value),
    );
    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-primary"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[role="alertdialog"] button'),
    ) as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.trim() === 'Cancel')?.click();
    fixture.detectChanges();
    expect(emitted).toEqual([]);
    expect(
      fixture.nativeElement.querySelector('[role="alertdialog"]'),
    ).toBeNull();
  });

  it('contains no innerHTML binding', () => {
    const source = readFileSync(
      join(__dirname, 'file-view.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\[innerHTML\]|\.innerHTML/);
  });
});
