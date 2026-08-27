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
  /**
   * Every frame callback ever queued, by the handle rAF handed back.
   *
   * Kept separately from {@link frames} (which `flushFrames` empties) so a test
   * can replay ONE specific callback — the component's — long after the queue
   * it was in has been drained or abandoned.
   */
  let frameByHandle: Map<number, () => void>;
  let nextFrameHandle: number;

  beforeEach(() => {
    frames = [];
    cancelled = [];
    frameByHandle = new Map();
    nextFrameHandle = 0;
    MarkdownStub.renders.length = 0;

    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        const handle = ++nextFrameHandle;
        const run = (): void => cb(0);
        frames.push(run);
        frameByHandle.set(handle, run);
        return handle;
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

  /** The value the component has actually published to the renderer. */
  function published(): string {
    return (
      fixture.componentInstance as unknown as {
        renderedContent: () => string;
      }
    ).renderedContent();
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

  it('cancels its queued frame on destroy, and that frame renders nothing if it fires anyway', () => {
    pushContent('mid-stream', 'streaming');
    // The throttle is holding the content back, so nothing has rendered yet —
    // which is what makes the replay below a real test: if the abandoned frame
    // still published, this count would move.
    expect(renders()).toHaveLength(0);

    // Angular's own scheduler also queues and cancels frames here, so
    // "something was cancelled" identifies nothing. Wrap the COMPONENT's own
    // handle so the assertion below is about its frame and no other.
    const componentFrame = (
      fixture.componentInstance as unknown as {
        pendingFrame: { cancel(): void } | null;
      }
    ).pendingFrame;
    expect(componentFrame).not.toBeNull();

    let componentHandle: number | undefined;
    const realCancel = componentFrame?.cancel.bind(componentFrame);
    if (componentFrame && realCancel) {
      componentFrame.cancel = (): void => {
        const before = cancelled.length;
        realCancel();
        componentHandle = cancelled[before];
      };
    }

    fixture.destroy();

    // The teardown hook cancelled the component's own frame.
    expect(componentHandle).toBeDefined();

    // Cancelling is a REQUEST. A frame the host already dispatched — or a host
    // that ignores `cancelAnimationFrame` at all — still runs the callback, and
    // a callback that writes a signal on a destroyed component is how a
    // "cancelled" throttle becomes an NG0911 at teardown. Replay exactly the
    // frame the component gave up.
    const abandonedFrame = frameByHandle.get(componentHandle as number);
    expect(abandonedFrame).toBeDefined();
    abandonedFrame?.();

    // The destroy hook dropped the pending content, so the replayed callback
    // has nothing left to publish. Asserted on the signal, not only on the
    // markdown stub: a destroyed view no longer propagates to the template, so
    // `renders()` alone would stay flat even for a component that DID write.
    expect(published()).toBe('');
    expect(renders()).toHaveLength(0);
  });
});
