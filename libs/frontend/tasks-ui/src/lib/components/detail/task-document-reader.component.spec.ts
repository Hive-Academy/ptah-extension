import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import {
  TaskDocumentReaderComponent,
  type TaskOpenDocumentState,
} from './task-document-reader.component';

describe('TaskDocumentReaderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskDocumentReaderComponent] });
  });

  function render(state: TaskOpenDocumentState, openable = true) {
    const fixture = TestBed.createComponent(TaskDocumentReaderComponent);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('openable', openable);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const byId = (id: string) =>
      host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return { fixture, host, byId };
  }

  it('renders ready content through the shared markdown block, theme-aware', () => {
    const source =
      '# Plan\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\n[docs](https://example.com)';
    const { fixture, host, byId } = render({
      status: 'ready',
      file: 'implementation-plan.md',
      content: source,
    });

    const block = fixture.debugElement.query(
      By.directive(MarkdownBlockComponent),
    );
    expect(block).not.toBeNull();
    const instance: MarkdownBlockComponent = block.componentInstance;
    expect(instance.content()).toBe(source);
    expect(instance.variant()).toBe('auto');
    // The auto variant follows the colour scheme rather than forcing invert.
    expect(block.nativeElement.querySelector('markdown')?.className).toContain(
      'dark:prose-invert',
    );
    // The source never reaches the DOM as raw HTML.
    expect(host.innerHTML).not.toContain('# Plan');
    expect(byId('task-doc-file')?.textContent).toContain(
      'implementation-plan.md',
    );
    expect(byId('task-doc-state')?.textContent).toBe('Markdown · Present');
  });

  it('never binds an HTML or script payload as markup', () => {
    const { host } = render({
      status: 'ready',
      file: 'decisions.md',
      content:
        '<script>alert(1)</script><img src=x onerror="alert(2)">[x](javascript:alert(3))',
    });
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('says the file has no readable body when the content is blank', () => {
    const { fixture, byId } = render({
      status: 'ready',
      file: 'context.md',
      content: '  \n\n ',
    });
    expect(byId('task-doc-empty')?.textContent).toContain(
      'This file has no readable body.',
    );
    expect(
      fixture.debugElement.query(By.directive(MarkdownBlockComponent)),
    ).toBeNull();
  });

  it('keeps the header and shows labelled skeleton lines while loading', () => {
    const { host, byId } = render({ status: 'loading', file: 'context.md' });
    const loading = byId('task-doc-loading');
    expect(loading?.getAttribute('role')).toBe('status');
    expect(loading?.getAttribute('aria-label')).toBe('Loading context.md');
    expect(loading?.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(byId('task-doc-file')?.textContent).toContain('context.md');
    expect(
      host
        .querySelector('[data-testid="task-doc-panel"]')
        ?.getAttribute('aria-busy'),
    ).toBe('true');
  });

  it.each([
    ['missing', 'does not contain this file yet', 'Missing'],
    ['unreadable', 'could not be read', 'Unreadable'],
    ['binary', 'not UTF-8 text', 'Binary'],
    ['directory', 'This is a folder', 'Folder'],
    ['too_large', '1 MiB', 'Too large'],
    ['rejected', 'refused this path', 'Rejected'],
  ] as const)(
    'gives the %s state a specific reason and badge',
    (status, reason, badge) => {
      const { fixture, byId } = render({ status, file: 'notes.md' });
      expect(byId(`task-doc-${status}`)?.textContent).toContain(reason);
      expect(byId('task-doc-state')?.textContent).toBe(badge);
      expect(
        fixture.debugElement.query(By.directive(MarkdownBlockComponent)),
      ).toBeNull();
    },
  );

  it('reports a failed read as an alert with its message', () => {
    const { byId } = render({
      status: 'error',
      file: 'context.md',
      message: 'transport closed',
    });
    const error = byId('task-doc-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('transport closed');
  });

  it('offers Open in editor for an openable file and emits its name', () => {
    const { fixture, byId } = render({
      status: 'ready',
      file: 'context.md',
      content: 'x',
    });
    const opened: string[] = [];
    fixture.componentInstance.openInEditor.subscribe((file) =>
      opened.push(file),
    );
    const button = byId('task-doc-open-editor') as HTMLButtonElement;
    expect(button.className).toContain('btn-primary');
    expect(button.getAttribute('aria-label')).toBe(
      'Open context.md in the editor',
    );
    button.click();
    expect(opened).toEqual(['context.md']);
  });

  it.each(['rejected', 'missing', 'directory'] as const)(
    'offers no editor action for a %s file',
    (status) => {
      const { byId } = render({ status, file: 'notes.md' }, true);
      expect(byId('task-doc-open-editor')).toBeNull();
    },
  );

  it('offers no editor action when the file is not openable', () => {
    const { byId } = render(
      { status: 'ready', file: 'context.md', content: 'x' },
      false,
    );
    expect(byId('task-doc-open-editor')).toBeNull();
  });

  it('closes on its labelled close button', () => {
    const { fixture, byId } = render({
      status: 'ready',
      file: 'context.md',
      content: 'x',
    });
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    const close = byId('task-doc-close') as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toBe('Close context.md');
    close.click();
    expect(closed).toBe(1);
  });

  it('renders the latest state it is given', () => {
    const { fixture, byId } = render({ status: 'loading', file: 'a.md' });
    fixture.componentRef.setInput('state', {
      status: 'ready',
      file: 'b.md',
      content: '# B',
    });
    fixture.detectChanges();
    expect(byId('task-doc-file')?.textContent).toContain('b.md');
    expect(byId('task-doc-loading')).toBeNull();
  });
});
