import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
  provideZonelessChangeDetection,
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
    @Input() data: string | null | undefined;
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
import {
  FILE_LINK_OPENER,
  LoggingService,
  SURFACE_ACTIVE,
} from '@ptah-extension/core';
import { StreamingMarkdownRenderer } from '@ptah-extension/markdown';
import { INCREMENTAL_STREAMING_PRESENTATION_ENABLED } from '../../../services/scroll-dirty.service';
import type { ExecutionNode, ExecutionStatus } from '@ptah-extension/shared';

function makeNode(content: string, status: ExecutionStatus): ExecutionNode {
  return { id: 'n1', type: 'text', status, content } as ExecutionNode;
}

describe('ExecutionNodeComponent — incremental streaming DOM', () => {
  let fixture: ComponentFixture<ExecutionNodeComponent>;
  let frames: Array<() => void>;

  beforeEach(() => {
    frames = [];
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(() => cb(0));
        return frames.length;
      });
    jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      imports: [ExecutionNodeComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
        { provide: INCREMENTAL_STREAMING_PRESENTATION_ENABLED, useValue: true },
      ],
    });
    fixture = TestBed.createComponent(ExecutionNodeComponent);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  /** Push `content` and run the frame the component queued for it. */
  function streamFrame(content: string): void {
    fixture.componentRef.setInput('node', makeNode(content, 'streaming'));
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();
    const queued = frames;
    frames = [];
    for (const frame of queued) frame();
    fixture.detectChanges();
  }

  function root(): HTMLElement {
    const element = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('.ptah-markdown-root');
    if (element === null)
      throw new Error('streaming containment root not rendered');
    return element;
  }

  function blockHosts(): HTMLElement[] {
    return Array.from(
      root().querySelectorAll<HTMLElement>(':scope > div.contents'),
    );
  }

  function tail(): HTMLElement | null {
    return root().querySelector<HTMLElement>(':scope > p.whitespace-pre-line');
  }

  it('wraps the streaming output in the containment root', () => {
    streamFrame('Hello.\n\nopen');

    expect(root().getAttribute('style')).toContain('contain: layout paint');
    expect(root().getAttribute('style')).toContain('isolation: isolate');
  });

  it('keeps an already-rendered block as the same DOM node when a later block arrives', () => {
    streamFrame('First block.\n\nsecond');
    const [first] = blockHosts();
    expect(first.textContent).toContain('First block.');

    streamFrame('First block.\n\nsecond block.\n\nthird');

    const hosts = blockHosts();
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).toBe(first);
    expect(hosts[0].firstElementChild).toBe(first.firstElementChild);
    expect(hosts[1].textContent).toContain('second block.');
  });

  it('a tail-only frame changes only the tail text', () => {
    streamFrame('Done.\n\nopen');
    const [block] = blockHosts();
    const blockChild = block.firstElementChild;

    streamFrame('Done.\n\nopen and growing');

    expect(blockHosts()).toHaveLength(1);
    expect(blockHosts()[0]).toBe(block);
    expect(block.firstElementChild).toBe(blockChild);
    expect(tail()?.textContent).toBe('open and growing');
  });

  it('renders HTML in the open tail as text, never as elements', () => {
    streamFrame('<img src=x onerror=alert(1)><script>alert(2)</script>');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(tail()?.textContent).toBe(
      '<img src=x onerror=alert(1)><script>alert(2)</script>',
    );
  });

  it('a payload split across a block boundary never yields an active element', () => {
    const source =
      '<img src=x\n\nonerror=alert(1)>\n\n<a href="java\n\nscript:alert(1)">x</a>\n\n';
    for (let end = 1; end <= source.length; end++) {
      streamFrame(source.slice(0, end));
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('script')).toBeNull();
      for (const element of Array.from(host.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes)) {
          expect(attribute.name).not.toMatch(/^on/i);
          expect(attribute.value).not.toMatch(/^\s*javascript:/i);
        }
      }
    }
  });

  it('reports a stopped incremental render once through the logger', () => {
    const warn = jest
      .spyOn(TestBed.inject(LoggingService), 'warn')
      .mockImplementation(() => undefined);
    let calls = 0;
    jest
      .spyOn(StreamingMarkdownRenderer.prototype, 'render')
      .mockImplementation((source: string) => ({
        blocks: [],
        tail: source,
        failed: ++calls === 2,
      }));

    streamFrame('a');
    streamFrame('ab');
    streamFrame('abc');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('ExecutionNode');
    expect(tail()?.textContent).toBe('abc');
  });

  it('switches to <markdown> when the node settles', () => {
    streamFrame('Block.\n\ntail');
    expect(root()).toBeTruthy();

    fixture.componentRef.setInput(
      'node',
      makeNode('Block.\n\ntail', 'complete'),
    );
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.ptah-markdown-root')).toBeNull();
    expect(host.querySelector('markdown')).not.toBeNull();
  });

  it('renders a text child with a later sibling as settled markdown while the turn streams', () => {
    const message = {
      id: 'm1',
      type: 'message',
      status: 'streaming',
      content: '',
      children: [
        {
          id: 't1',
          type: 'text',
          status: 'complete',
          content: 'Done.\n> [!WARNING]\n> Careful.',
          children: [],
        },
        {
          id: 't2',
          type: 'text',
          status: 'streaming',
          content: 'Still\n\nopen',
          children: [],
        },
      ],
    } as unknown as ExecutionNode;
    fixture.componentRef.setInput('node', message);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();
    for (const frame of frames.splice(0)) frame();
    fixture.detectChanges();

    const children = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.exec-text-branch',
      ),
    );
    expect(children).toHaveLength(2);
    expect(children[0].querySelector('.ptah-markdown-root')).toBeNull();
    expect(children[0].querySelector('markdown')).not.toBeNull();
    expect(children[1].querySelector('.ptah-markdown-root')).not.toBeNull();
  });
});
