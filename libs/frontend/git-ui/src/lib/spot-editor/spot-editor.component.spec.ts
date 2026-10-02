import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  signal,
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

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => ({
  rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  VSCodeService: class VSCodeService {},
  ThemeService: class ThemeService {},
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { insertNewline } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import type {
  FileSaveContentResult,
  FileViewContentResult,
} from '@ptah-extension/shared';
import type { FileViewOpenRequest } from '../types/diff-tab.types';
import { detectLineSeparator } from './codemirror-setup';
import { SpotEditorComponent } from './spot-editor.component';

const { VSCodeService, ThemeService } = jest.requireMock(
  '@ptah-extension/core',
);

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

type ViewSuccess = Extract<FileViewContentResult, { success: true }>;

function viewResult(overrides: Partial<ViewSuccess> = {}): ViewSuccess {
  const content = overrides.content ?? 'const a = 1;\n';
  return {
    success: true,
    absolutePath: '/ws/src/a.ts',
    workspaceRoot: '/ws',
    relativePath: 'src/a.ts',
    content,
    sizeBytes: content.length,
    encoding: 'utf-8',
    sha256: SHA_A,
    bom: false,
    ...overrides,
  };
}

/**
 * Routes `file:viewContent` to a queue of read results (the last one repeats)
 * and `file:saveContent` to a queue of transport responses.
 */
function routeRpc(
  reads: FileViewContentResult[],
  saves: { success: boolean; data?: FileSaveContentResult; error?: string }[] = [],
): void {
  mockRpcCall.mockImplementation(
    async (_vscode: unknown, method: string): Promise<unknown> => {
      if (method === 'file:viewContent') {
        const next = reads.length > 1 ? reads.shift() : reads[0];
        return { success: true, data: next };
      }
      if (method === 'file:saveContent') {
        return (
          saves.shift() ?? {
            success: true,
            data: { success: true, sha256: SHA_B },
          }
        );
      }
      throw new Error(`unexpected ${method}`);
    },
  );
}

function saveCalls(): Record<string, unknown>[] {
  return mockRpcCall.mock.calls
    .filter((call) => call[1] === 'file:saveContent')
    .map((call) => call[2] as Record<string, unknown>);
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 6; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  fixture.detectChanges();
}

describe('SpotEditorComponent', () => {
  const isDarkMode = signal(false);

  beforeAll(() => {
    // jsdom implements no HTMLDialogElement methods; reflecting `open` is enough.
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
    // jsdom has no layout; CodeMirror only needs these to exist.
    const rangeProto = Range.prototype as unknown as Record<string, unknown>;
    rangeProto['getClientRects'] ??= () => [];
    rangeProto['getBoundingClientRect'] ??= () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    });
  });

  beforeEach(() => {
    mockRpcCall.mockReset();
    isDarkMode.set(false);
    TestBed.configureTestingModule({
      imports: [SpotEditorComponent],
      providers: [
        { provide: VSCodeService, useValue: {} },
        { provide: ThemeService, useValue: { isDarkMode } },
      ],
    });
  });

  async function render(
    request: FileViewOpenRequest = { path: '/ws/src/a.ts', workspaceRoot: '/ws' },
    startEditable = false,
  ) {
    const fixture = TestBed.createComponent(SpotEditorComponent);
    fixture.componentRef.setInput('request', request);
    fixture.componentRef.setInput('startEditable', startEditable);
    fixture.componentRef.setInput('editorTargets', [
      { id: 'vscode', displayName: 'VS Code' },
    ]);
    await settle(fixture);
    return fixture;
  }

  function el(fixture: ComponentFixture<unknown>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function byTestId<T extends HTMLElement = HTMLElement>(
    fixture: ComponentFixture<unknown>,
    id: string,
  ): T | null {
    return el(fixture).querySelector<T>(`[data-testid="${id}"]`);
  }

  function editorView(fixture: ComponentFixture<unknown>): EditorView {
    const content = el(fixture).querySelector<HTMLElement>('.cm-content');
    if (!content) throw new Error('CodeMirror did not mount');
    const view = EditorView.findFromDOM(content);
    if (!view) throw new Error('no EditorView');
    return view;
  }

  function type(
    fixture: ComponentFixture<unknown>,
    insert: string,
    at?: number,
  ): void {
    const view = editorView(fixture);
    const from = at ?? view.state.doc.length;
    view.dispatch({ changes: { from, insert } });
    fixture.detectChanges();
  }

  async function clickSave(fixture: ComponentFixture<unknown>): Promise<void> {
    byTestId<HTMLButtonElement>(fixture, 'spot-editor-save')?.click();
    await settle(fixture);
  }

  function dialogButton(
    fixture: ComponentFixture<unknown>,
    which: 'confirm' | 'cancel',
  ): HTMLButtonElement {
    const button = byTestId<HTMLButtonElement>(fixture, `git-confirm-${which}`);
    if (!button) throw new Error('dialog is not open');
    return button;
  }

  describe('lazy loading', () => {
    it('reaches CodeMirror only through a dynamic import of codemirror-setup', () => {
      const source = readFileSync(
        join(__dirname, 'spot-editor.component.ts'),
        'utf8',
      );
      expect(source).not.toMatch(/from\s+['"]@codemirror\//);
      expect(source).not.toMatch(/import\s+(?!type\b)[^;]*from\s+['"]\.\/codemirror-setup['"]/);
      expect(source).toContain("import('./codemirror-setup')");
    });
  });

  describe('modes', () => {
    it('opens read-only by default (chat links) with an Edit button', async () => {
      routeRpc([viewResult()]);
      const fixture = await render();

      expect(byTestId(fixture, 'spot-editor-ro')?.textContent).toContain(
        'Read only',
      );
      expect(byTestId(fixture, 'spot-editor-edit')).not.toBeNull();
      expect(editorView(fixture).state.readOnly).toBe(true);
      expect(
        el(fixture).querySelector('.cm-content')?.getAttribute('contenteditable'),
      ).toBe('false');
      expect(
        byTestId<HTMLButtonElement>(fixture, 'spot-editor-save')?.disabled,
      ).toBe(true);
    });

    it('Edit switches the same editor to editable', async () => {
      routeRpc([viewResult()]);
      const fixture = await render();
      byTestId<HTMLButtonElement>(fixture, 'spot-editor-edit')?.click();
      await settle(fixture);

      expect(byTestId(fixture, 'spot-editor-ro')).toBeNull();
      expect(byTestId(fixture, 'spot-editor-edit')).toBeNull();
      expect(editorView(fixture).state.readOnly).toBe(false);
    });

    it('opens editable when the canvas Edit action asks for it', async () => {
      routeRpc([viewResult()]);
      const fixture = await render(undefined, true);
      expect(byTestId(fixture, 'spot-editor-ro')).toBeNull();
      expect(editorView(fixture).state.readOnly).toBe(false);
    });

    it('opens at the linked line and column', async () => {
      routeRpc([viewResult({ content: 'one\ntwo\nthree\n' })]);
      const fixture = await render({ path: 'a.ts', line: 2, column: 3 });
      const view = editorView(fixture);
      const head = view.state.selection.main.head;
      expect(view.state.doc.lineAt(head).number).toBe(2);
      expect(head - view.state.doc.line(2).from).toBe(2);
    });

    it('keeps UTF-16 files read-only with a note and no Edit button', async () => {
      routeRpc([viewResult({ encoding: 'utf-16le', bom: true })]);
      const fixture = await render(undefined, true);
      expect(byTestId(fixture, 'spot-editor-ro')).not.toBeNull();
      expect(byTestId(fixture, 'spot-editor-edit')).toBeNull();
      expect(byTestId(fixture, 'spot-editor-ro-note')?.textContent).toContain(
        'UTF-16 files open read-only.',
      );
      expect(editorView(fixture).state.readOnly).toBe(true);
    });

    it('follows the dark theme', async () => {
      routeRpc([viewResult()]);
      const fixture = await render();
      const editor = el(fixture).querySelector('.cm-editor');
      const lightClasses = editor?.className;
      isDarkMode.set(true);
      await settle(fixture);
      expect(editor?.className).not.toBe(lightClasses);
    });
  });

  describe('save', () => {
    it('sends the read hash, the resolved path and the buffer; a second save uses the new hash', async () => {
      routeRpc([viewResult()]);
      const fixture = await render(undefined, true);
      type(fixture, '// edit\n');
      await clickSave(fixture);

      expect(saveCalls()[0]).toEqual({
        path: '/ws/src/a.ts',
        workspaceRoot: '/ws',
        content: 'const a = 1;\n// edit\n',
        expectedSha256: SHA_A,
      });
      expect(
        byTestId<HTMLButtonElement>(fixture, 'spot-editor-save')?.disabled,
      ).toBe(true);
      expect(el(fixture).textContent).toContain('Saved.');

      type(fixture, 'x');
      await clickSave(fixture);
      expect(saveCalls()[1]?.['expectedSha256']).toBe(SHA_B);
    });

    it('A12: saves CRLF files with CRLF, including new lines the user adds', async () => {
      routeRpc([viewResult({ content: 'a\r\nb\r\n' })]);
      const fixture = await render(undefined, true);
      const view = editorView(fixture);
      expect(view.state.lineBreak).toBe('\r\n');

      type(fixture, 'x', 0);
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      insertNewline(view);
      fixture.detectChanges();
      await clickSave(fixture);

      expect(saveCalls()[0]?.['content']).toBe('xa\r\nb\r\n\r\n');
    });

    it('A12: leaves LF files LF and keeps a stray separator of the other kind byte-identical', async () => {
      routeRpc([viewResult({ content: 'a\nb\n' })]);
      const lf = await render(undefined, true);
      type(lf, 'c');
      await clickSave(lf);
      expect(saveCalls()[0]?.['content']).toBe('a\nb\nc');
      lf.destroy();

      mockRpcCall.mockReset();
      routeRpc([viewResult({ content: 'a\r\nb\nc\r\n' })]);
      const mixed = await render(undefined, true);
      type(mixed, 'x');
      await clickSave(mixed);
      expect(saveCalls()[0]?.['content']).toBe('a\r\nb\nc\r\nx');
    });

    it('detects the majority separator', () => {
      expect(detectLineSeparator('a\r\nb\r\nc\n')).toBe('\r\n');
      expect(detectLineSeparator('a\nb\r\nc\n')).toBe('\n');
      expect(detectLineSeparator('no newline')).toBe('\n');
    });

    it('shows the backend sentence for a refused save and keeps the buffer', async () => {
      routeRpc(
        [viewResult()],
        [
          {
            success: true,
            data: {
              success: false,
              reason: 'unwritable',
              error: 'This file cannot be written.',
            },
          },
        ],
      );
      const fixture = await render(undefined, true);
      type(fixture, 'x');
      await clickSave(fixture);

      expect(byTestId(fixture, 'spot-editor-save-error')?.textContent).toContain(
        'This file cannot be written.',
      );
      expect(editorView(fixture).state.sliceDoc()).toBe('const a = 1;\nx');
      expect(
        byTestId<HTMLButtonElement>(fixture, 'spot-editor-save')?.disabled,
      ).toBe(false);
    });

    it('treats a host without file:saveContent as read-only', async () => {
      routeRpc(
        [viewResult()],
        [{ success: false, error: 'Method not found: file:saveContent' }],
      );
      const fixture = await render(undefined, true);
      type(fixture, 'x');
      await clickSave(fixture);

      expect(byTestId(fixture, 'spot-editor-save-error')?.textContent).toContain(
        'Saving is not available in this window.',
      );
      expect(byTestId(fixture, 'spot-editor-ro')).not.toBeNull();
      expect(byTestId(fixture, 'spot-editor-edit')).toBeNull();
      expect(editorView(fixture).state.readOnly).toBe(true);
      expect(editorView(fixture).state.sliceDoc()).toBe('const a = 1;\nx');
    });

    it('uses generic copy when the transport fails for another reason', async () => {
      routeRpc(
        [viewResult()],
        [{ success: false, error: 'RPC timeout: file:saveContent' }],
      );
      const fixture = await render(undefined, true);
      type(fixture, 'x');
      await clickSave(fixture);
      expect(byTestId(fixture, 'spot-editor-save-error')?.textContent).toContain(
        'The file could not be saved.',
      );
      expect(editorView(fixture).state.readOnly).toBe(false);
    });
  });

  describe('disk conflict', () => {
    const conflict = {
      success: true,
      data: {
        success: false as const,
        reason: 'conflict' as const,
        error: 'The file changed on disk.',
      },
    };

    it('asks Reload (focused) or Overwrite; Overwrite resends with overwrite:true', async () => {
      routeRpc([viewResult()], [conflict]);
      const fixture = await render(undefined, true);
      type(fixture, 'x');
      await clickSave(fixture);

      const reload = dialogButton(fixture, 'cancel');
      expect(reload.textContent).toContain('Reload');
      expect(document.activeElement).toBe(reload);
      expect(dialogButton(fixture, 'confirm').textContent).toContain(
        'Overwrite',
      );

      dialogButton(fixture, 'confirm').click();
      await settle(fixture);
      expect(saveCalls()).toHaveLength(2);
      expect(saveCalls()[1]).toMatchObject({
        content: 'const a = 1;\nx',
        expectedSha256: SHA_A,
        overwrite: true,
      });
    });

    it('Reload re-reads the file and drops the local edits', async () => {
      routeRpc(
        [viewResult(), viewResult({ content: 'from disk\n', sha256: SHA_B })],
        [conflict],
      );
      const fixture = await render(undefined, true);
      type(fixture, 'x');
      await clickSave(fixture);

      dialogButton(fixture, 'cancel').click();
      await settle(fixture);
      expect(editorView(fixture).state.sliceDoc()).toBe('from disk\n');
      expect(
        byTestId<HTMLButtonElement>(fixture, 'spot-editor-save')?.disabled,
      ).toBe(true);

      type(fixture, 'y');
      await clickSave(fixture);
      expect(saveCalls().at(-1)?.['expectedSha256']).toBe(SHA_B);
    });
  });

  describe('disk changes', () => {
    it('reloads silently when there are no local edits', async () => {
      routeRpc([viewResult(), viewResult({ content: 'new\n', sha256: SHA_B })]);
      const fixture = await render();
      fixture.componentInstance.notifyDiskChange(['/ws/src/a.ts'], false);
      await settle(fixture);
      expect(editorView(fixture).state.sliceDoc()).toBe('new\n');
      expect(byTestId(fixture, 'spot-editor-stale')).toBeNull();
    });

    it('marks the file stale when there are local edits', async () => {
      routeRpc([viewResult()]);
      const fixture = await render(undefined, true);
      type(fixture, 'x');
      fixture.componentInstance.notifyDiskChange(['/ws/other.ts'], false);
      await settle(fixture);
      expect(byTestId(fixture, 'spot-editor-stale')).toBeNull();

      fixture.componentInstance.notifyDiskChange(['/ws/src/a.ts'], false);
      await settle(fixture);
      expect(byTestId(fixture, 'spot-editor-stale')).not.toBeNull();
      expect(editorView(fixture).state.sliceDoc()).toBe('const a = 1;\nx');
    });
  });

  describe('replacing the open file', () => {
    it('opens the next file directly when there are no edits', async () => {
      routeRpc([
        viewResult(),
        viewResult({ absolutePath: '/ws/b.ts', relativePath: 'b.ts', content: 'b\n' }),
      ]);
      const fixture = await render();
      fixture.componentRef.setInput('request', { path: '/ws/b.ts' });
      await settle(fixture);
      expect(byTestId(fixture, 'git-confirm-dialog')).toBeNull();
      expect(editorView(fixture).state.sliceDoc()).toBe('b\n');
    });

    it('asks before discarding unsaved edits; Cancel keeps them', async () => {
      routeRpc([
        viewResult(),
        viewResult({ absolutePath: '/ws/b.ts', relativePath: 'b.ts', content: 'b\n' }),
      ]);
      const fixture = await render(undefined, true);
      type(fixture, 'x');
      fixture.componentRef.setInput('request', { path: '/ws/b.ts' });
      await settle(fixture);

      const cancel = dialogButton(fixture, 'cancel');
      expect(document.activeElement).toBe(cancel);
      expect(dialogButton(fixture, 'confirm').textContent).toContain(
        'Discard and open',
      );
      cancel.click();
      await settle(fixture);
      expect(editorView(fixture).state.sliceDoc()).toBe('const a = 1;\nx');
    });

    it('Discard and open replaces the file', async () => {
      routeRpc([
        viewResult(),
        viewResult({ absolutePath: '/ws/b.ts', relativePath: 'b.ts', content: 'b\n' }),
      ]);
      const fixture = await render(undefined, true);
      type(fixture, 'x');
      fixture.componentRef.setInput('request', { path: '/ws/b.ts' });
      await settle(fixture);
      dialogButton(fixture, 'confirm').click();
      await settle(fixture);
      expect(editorView(fixture).state.sliceDoc()).toBe('b\n');
      expect(byTestId(fixture, 'spot-editor-path')?.textContent).toContain(
        'b.ts',
      );
    });

    it('Back to review asks first with unsaved edits, and leaves directly without', async () => {
      routeRpc([viewResult()]);
      const fixture = await render(undefined, true);
      const back = jest.fn();
      fixture.componentInstance.backToReview.subscribe(back);

      byTestId<HTMLButtonElement>(fixture, 'spot-editor-back')?.click();
      expect(back).toHaveBeenCalledTimes(1);

      type(fixture, 'x');
      byTestId<HTMLButtonElement>(fixture, 'spot-editor-back')?.click();
      await settle(fixture);
      expect(back).toHaveBeenCalledTimes(1);
      dialogButton(fixture, 'confirm').click();
      expect(back).toHaveBeenCalledTimes(2);
    });
  });

  describe('markdown preview', () => {
    it('previews markdown read-only and switches to source', async () => {
      routeRpc([
        viewResult({
          absolutePath: '/ws/readme.md',
          relativePath: 'readme.md',
          content: '# Title',
        }),
      ]);
      const fixture = await render({ path: '/ws/readme.md' });
      expect(byTestId(fixture, 'spot-editor-preview-body')).not.toBeNull();
      expect(byTestId(fixture, 'markdown-rendered')?.textContent).toContain(
        '# Title',
      );

      byTestId<HTMLButtonElement>(fixture, 'spot-editor-source')?.click();
      await settle(fixture);
      expect(byTestId(fixture, 'spot-editor-preview-body')).toBeNull();
      expect(
        byTestId(fixture, 'spot-editor-source')?.getAttribute('aria-pressed'),
      ).toBe('true');
    });

    it('disables the preview over 512 KB with a note', async () => {
      routeRpc([
        viewResult({
          absolutePath: '/ws/big.md',
          relativePath: 'big.md',
          content: '# Big',
          sizeBytes: 512 * 1024 + 1,
        }),
      ]);
      const fixture = await render({ path: '/ws/big.md' });
      const preview = byTestId<HTMLButtonElement>(fixture, 'spot-editor-preview');
      expect(preview?.disabled).toBe(true);
      expect(preview?.title).toBe('Preview is disabled for files over 512 KB.');
      expect(byTestId(fixture, 'spot-editor-preview-body')).toBeNull();
    });
  });

  describe('blocked and failed reads', () => {
    it('shows the blocked reason and confirms before opening outside the workspace', async () => {
      routeRpc([
        {
          success: false,
          reason: 'outside-roots',
          error: 'This file is outside the open workspace folders.',
          absolutePath: '/outside/a.ts',
          externalOpenAllowed: true,
        },
      ]);
      const fixture = await render({ path: '/outside/a.ts' });
      const opened = jest.fn();
      fixture.componentInstance.openExternal.subscribe(opened);

      expect(byTestId(fixture, 'spot-editor-blocked')?.textContent).toContain(
        'This file is outside the open workspace folders.',
      );
      expect(byTestId(fixture, 'spot-editor-edit')).toBeNull();

      (
        fixture.debugElement.query(
          (node) => node.name === 'ptah-open-in-button',
        ).componentInstance as { open: { emit(v: unknown): void } }
      ).open.emit({ target: 'vscode', path: '/outside/a.ts' });
      await settle(fixture);
      expect(el(fixture).textContent).toContain(
        'Open /outside/a.ts in VS Code?',
      );
      expect(opened).not.toHaveBeenCalled();

      dialogButton(fixture, 'confirm').click();
      expect(opened).toHaveBeenCalledWith({
        target: 'vscode',
        path: '/outside/a.ts',
      });
    });

    it('shows a read failure with Retry', async () => {
      routeRpc([
        {
          success: false,
          reason: 'not-found',
          error: 'The file does not exist.',
          externalOpenAllowed: false,
        },
        viewResult(),
      ]);
      const fixture = await render();
      expect(byTestId(fixture, 'spot-editor-read-error')?.textContent).toContain(
        'The file does not exist.',
      );
      el(fixture)
        .querySelector<HTMLButtonElement>(
          '[data-testid="spot-editor-read-error"] button',
        )
        ?.click();
      await settle(fixture);
      expect(byTestId(fixture, 'spot-editor-read-error')).toBeNull();
      expect(editorView(fixture).state.sliceDoc()).toBe('const a = 1;\n');
    });
  });
});
