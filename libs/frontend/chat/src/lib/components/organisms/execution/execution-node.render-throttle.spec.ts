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
    /**
     * Every distinct string ngx-markdown would have tokenized.
     *
     * A real `<markdown>` re-runs `marked` + five custom extensions +
     * DOMPurify + a DOM re-parse over the WHOLE string for each entry here,
     * so the length of this array is precisely the cost the throttle bounds.
     */
    static readonly renders: string[] = [];

    @Input() set data(value: string | null | undefined) {
      MarkdownStubComponent.renders.push(value ?? '');
    }
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
import { MarkdownComponent } from 'ngx-markdown';
import { ExecutionNodeComponent } from './execution-node.component';
import type { ExecutionNode, ExecutionStatus } from '@ptah-extension/shared';

/** The markdown stub, reached through the mocked module's export. */
const MarkdownStub = MarkdownComponent as unknown as {
  readonly renders: string[];
};

function makeNode(
  content: string,
  status: ExecutionStatus,
  overrides: Partial<ExecutionNode> = {},
): ExecutionNode {
  return {
    id: 'n1',
    type: 'text',
    status,
    content,
    ...overrides,
  } as ExecutionNode;
}

describe('ExecutionNodeComponent — streamed markdown render throttle', () => {
  let fixture: ComponentFixture<ExecutionNodeComponent>;
  /**
   * Frame callbacks captured from the rAF stand-in, oldest first.
   *
   * Angular's own change-detection scheduler races `requestAnimationFrame`
   * against `setTimeout`, so this queue is NOT exclusively the component's —
   * every assertion below is on rendered output, never on the queue length.
   */
  let frames: Array<() => void>;
  let cancelled: number[];

  beforeEach(() => {
    frames = [];
    cancelled = [];
    MarkdownStub.renders.length = 0;

    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(() => cb(0));
        return frames.length;
      });
    jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((handle: number) => {
        cancelled.push(handle);
      });

    TestBed.configureTestingModule({ imports: [ExecutionNodeComponent] });
    fixture = TestBed.createComponent(ExecutionNodeComponent);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  /** Run every frame callback queued so far, then let the view settle. */
  function flushFrames(): void {
    const queued = frames;
    frames = [];
    for (const frame of queued) frame();
    fixture.detectChanges();
  }

  function pushContent(content: string, status: ExecutionStatus): void {
    fixture.componentRef.setInput('node', makeNode(content, status));
    fixture.componentRef.setInput('isStreaming', status === 'streaming');
    fixture.detectChanges();
  }

  /**
   * Strings the renderer actually had to tokenize. The empty seed the binding
   * emits before any content arrives is not a markdown cost, so it is dropped
   * — otherwise the counts depend on whether the view effect happens to run
   * before or after the first template pass.
   */
  function renders(): string[] {
    return MarkdownStub.renders.filter((value) => value !== '');
  }

  function flipDisabled(): boolean {
    return (
      fixture.componentInstance as unknown as {
        flipAnimationDisabled: () => boolean;
      }
    ).flipAnimationDisabled();
  }

  it('coalesces 100 rapid deltas into a single markdown render', () => {
    let content = '';
    for (let i = 0; i < 100; i++) {
      content += `delta-${i} `;
      pushContent(content, 'streaming');
    }

    // Nothing reached the renderer while the frame was outstanding: later
    // deltas only replaced the value it would publish.
    expect(renders()).toHaveLength(0);

    flushFrames();

    // 100 content updates → exactly ONE markdown render, of the newest value.
    expect(renders()).toEqual([content]);
  });

  it('bounds renders by painted frames, not by delta count', () => {
    for (let i = 0; i < 30; i++) {
      pushContent(`chunk-${i}`, 'streaming');
      if (i % 10 === 9) flushFrames();
    }

    // 30 deltas over 3 frames → 3 renders.
    expect(renders()).toEqual(['chunk-9', 'chunk-19', 'chunk-29']);
  });

  it('renders the final content immediately when the node leaves streaming', () => {
    pushContent('partial', 'streaming');
    pushContent('partial answ', 'streaming');
    expect(renders()).toHaveLength(0);

    pushContent('partial answer, complete.', 'complete');

    // No frame flush — the settled value is published on the same tick.
    expect(renders()).toEqual(['partial answer, complete.']);

    // The frame queued by the streaming deltas must not republish the stale
    // prefix behind it, whether or not the cancel landed.
    flushFrames();
    expect(renders()).toEqual(['partial answer, complete.']);
  });

  it('renders a settled node on the first pass, without waiting for a frame', () => {
    pushContent('restored transcript body', 'complete');

    expect(renders()).toEqual(['restored transcript body']);
  });

  it('does not re-render when a new node object carries identical content', () => {
    pushContent('stable text', 'complete');
    const before = renders().length;

    // Fresh object identity, same content — the tree builder produces this on
    // every rebuild.
    pushContent('stable text', 'complete');
    pushContent('stable text', 'complete');

    expect(renders()).toHaveLength(before);
  });

  it('disables auto-animate FLIP while streaming and re-enables when settled', () => {
    pushContent('body', 'streaming');
    expect(flipDisabled()).toBe(true);

    pushContent('body done', 'complete');
    expect(flipDisabled()).toBe(false);
  });

  it('treats a node with status "streaming" as streaming even without the bubble flag', () => {
    fixture.componentRef.setInput('node', makeNode('body', 'streaming'));
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();

    expect(flipDisabled()).toBe(true);
    // Throttled, not rendered straight through.
    expect(renders()).toHaveLength(0);
    flushFrames();
    expect(renders()).toEqual(['body']);
  });

  it('keeps FLIP disabled through the finalize burst', () => {
    pushContent('body done', 'complete');
    fixture.componentRef.setInput('isFinalizing', true);
    fixture.detectChanges();

    expect(flipDisabled()).toBe(true);
  });

  it('cancels its queued frame on destroy', () => {
    pushContent('mid-stream', 'streaming');
    const cancelledBeforeDestroy = cancelled.length;

    fixture.destroy();

    expect(cancelled.length).toBeGreaterThan(cancelledBeforeDestroy);
  });
});
