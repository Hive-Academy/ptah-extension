import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div data-testid="markdown-stub">{{ data }}</div>',
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

import { TestBed } from '@angular/core/testing';
import { FILE_LINK_OPENER, SURFACE_ACTIVE } from '@ptah-extension/core';
import type { ExecutionNode } from '@ptah-extension/shared';
import { ExecutionNodeComponent } from './execution-node.component';

const PATH =
  'D:\\projects\\ptah-extension\\.claude-worktrees\\x\\.ptah\\specs\\T\\task-description.md';

function textNode(content: string, status = 'complete'): ExecutionNode {
  return {
    id: 'text-1',
    type: 'text',
    status,
    content,
    children: [],
  } as unknown as ExecutionNode;
}

/** A settled text node moves its trailing WROTE lines into the result card. */
describe('ExecutionNodeComponent — lane result card', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExecutionNodeComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  function render(node: ExecutionNode): HTMLElement {
    const fixture = TestBed.createComponent(ExecutionNodeComponent);
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('strips the WROTE lines from the markdown and keeps the raw path', () => {
    const el = render(
      textNode(`Finished the spec.\n\nWROTE: ${PATH} — 21 requirements`),
    );

    expect(
      el.querySelector('[data-testid="markdown-stub"]')?.textContent?.trim(),
    ).toBe('Finished the spec.');
    const row = el.querySelector('[data-testid="lane-result-file"]');
    expect(row?.getAttribute('title')).toBe(PATH);
    expect(
      el.querySelector('[data-testid="lane-result-verdict"]')?.textContent,
    ).toContain('21 requirements');
  });

  it('renders text without WROTE lines unchanged and with no card', () => {
    const el = render(textNode('Just prose.'));

    expect(
      el.querySelector('[data-testid="markdown-stub"]')?.textContent?.trim(),
    ).toBe('Just prose.');
    expect(el.querySelector('[data-testid="lane-result-card"]')).toBeNull();
  });
});
