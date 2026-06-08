import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
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

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ExecutionNodeComponent } from './execution-node.component';
import type { ExecutionNode } from '@ptah-extension/shared';

function makeNode(
  id: string,
  content: string,
  overrides: Partial<ExecutionNode> = {},
): ExecutionNode {
  return {
    id,
    type: 'text',
    status: 'completed',
    content,
    ...overrides,
  } as ExecutionNode;
}

function getCache(component: ExecutionNodeComponent): Map<string, string> {
  return (
    component as unknown as { _renderCache: Map<string, string> }
  )._renderCache;
}

describe('ExecutionNodeComponent — FNV-1a render memo (Batch A)', () => {
  let fixture: ComponentFixture<ExecutionNodeComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ExecutionNodeComponent] });
    fixture = TestBed.createComponent(ExecutionNodeComponent);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('returns the same string ref for identical content reads', () => {
    fixture.componentRef.setInput('node', makeNode('n1', 'hello'));
    fixture.detectChanges();

    const first = (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();
    const second = (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();
    expect(second).toBe(first);
  });

  it('streaming append with same tail-hash short-circuit returns cached ref when content unchanged', () => {
    const node1 = makeNode('n1', 'hello world');
    fixture.componentRef.setInput('node', node1);
    fixture.detectChanges();
    const initial = (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();

    fixture.componentRef.setInput('node', { ...node1, content: 'hello world' });
    fixture.detectChanges();
    const after = (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();

    expect(after).toBe(initial);
    expect(getCache(fixture.componentInstance).size).toBe(1);
  });

  it('different content invalidates the memo — new value is returned', () => {
    fixture.componentRef.setInput('node', makeNode('n1', 'hello'));
    fixture.detectChanges();
    const initial = (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();
    expect(initial).toBe('hello');

    fixture.componentRef.setInput(
      'node',
      makeNode('n1', 'hello world appended'),
    );
    fixture.detectChanges();
    const next = (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();
    expect(next).toBe('hello world appended');
  });

  it('LRU evicts the oldest entry at the 33rd unique entry', () => {
    fixture.componentRef.setInput('node', makeNode('seed', 'seed-content'));
    fixture.detectChanges();
    (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();
    const cache = getCache(fixture.componentInstance);
    cache.clear();

    for (let i = 0; i < 33; i++) {
      fixture.componentRef.setInput(
        'node',
        makeNode(`node-${i}`, `content-${i}`),
      );
      fixture.detectChanges();
      (fixture.componentInstance as unknown as {
        renderedContent: () => string;
      }).renderedContent();
    }

    expect(cache.size).toBe(32);
    const keys = Array.from(cache.keys());
    expect(keys[0]).not.toContain('node-0:');
  });

  it('LRU keeps recently-used entries fresh on access', () => {
    fixture.componentRef.setInput('node', makeNode('seed', 'seed-content'));
    fixture.detectChanges();
    (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();
    getCache(fixture.componentInstance).clear();

    for (let i = 0; i < 32; i++) {
      fixture.componentRef.setInput(
        'node',
        makeNode(`node-${i}`, `c-${i}`),
      );
      fixture.detectChanges();
      (fixture.componentInstance as unknown as {
        renderedContent: () => string;
      }).renderedContent();
    }

    fixture.componentRef.setInput('node', makeNode('node-0', 'c-0'));
    fixture.detectChanges();
    (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();

    fixture.componentRef.setInput(
      'node',
      makeNode('node-NEW', 'c-new'),
    );
    fixture.detectChanges();
    (fixture.componentInstance as unknown as {
      renderedContent: () => string;
    }).renderedContent();

    const cache = getCache(fixture.componentInstance);
    expect(cache.size).toBe(32);
    const keys = Array.from(cache.keys());
    expect(keys.some((k) => k.startsWith('node-0:'))).toBe(true);
  });
});
