import { ApplicationRef, ChangeDetectionStrategy, Component, NgModule, input, signal } from '@angular/core';

jest.mock('ngx-markdown', () => {
  // eslint-disable-next-line @angular-eslint/component-selector
  @Component({ selector: 'markdown', standalone: true, template: '' })
  class MarkdownStubComponent { readonly data = input<string | null>(''); }
  @NgModule({ imports: [MarkdownStubComponent], exports: [MarkdownStubComponent] })
  class MarkdownModule {}
  return {
    MarkdownModule, MarkdownComponent: MarkdownStubComponent, provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS', CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS', MERMAID_OPTIONS: 'MERMAID_OPTIONS', SANITIZE: 'SANITIZE',
  };
});

import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { configureTranscriptTestBed } from './testing/transcript-spec-harness';

@Component({
  standalone: true,
  imports: [ChatTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (id of ids; track id) {
      <ptah-chat-transcript [tabId]="id" [active]="selected() === id" />
    }
  `,
})
class HostComponent {
  readonly ids = ['A', 'B'];
  readonly selected = signal('A');
}

const messages = (prefix: string): ExecutionChatMessage[] =>
  Array.from({ length: 10 }, (_, index) => ({
    id: `${prefix}-${index}`, role: 'assistant', rawContent: `reply ${index}`,
    timestamp: index + 1, streamingState: null,
  } as ExecutionChatMessage));

describe('ChatTranscriptComponent activation scroll restore', () => {
  const tabs = signal([
    { id: 'A', claudeSessionId: 'session-A', status: 'loaded' as const, messages: messages('A'), streamingState: null },
    { id: 'B', claudeSessionId: 'session-B', status: 'loaded' as const, messages: messages('B'), streamingState: null },
  ]);

  beforeEach(() => {
    configureTranscriptTestBed({ tabs, buildTree: jest.fn(() => []) });
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    const tick = () => { fixture.detectChanges(); TestBed.inject(ApplicationRef).tick(); };
    const scroller = (id: string) => fixture.nativeElement.querySelector(
      `[data-ptah-tab-id="${id}"] .chat-scroll-container`,
    ) as HTMLElement;
    const writes = new Map<string, number[]>();
    for (const id of ['A', 'B']) {
      let top = 0;
      const values: number[] = [];
      writes.set(id, values);
      Object.defineProperties(scroller(id), {
        clientHeight: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: 1000 },
        scrollTop: {
          configurable: true,
          get: () => top,
          set: (value: number) => { top = Math.max(0, Math.min(900, value)); values.push(value); },
        },
      });
    }
    const transcript = (id: string) => fixture.debugElement.queryAll(By.directive(ChatTranscriptComponent))
      .map(debug => debug.componentInstance as ChatTranscriptComponent)
      .find(component => component.tabId() === id)!;
    const activate = (id: string) => { fixture.componentInstance.selected.set(id); tick(); };
    const queueRestore = (id: string) => (transcript(id) as unknown as {
      restoreScrollOnActivation(): void;
    }).restoreScrollOnActivation();
    const queueFollow = (id: string) => (transcript(id) as unknown as {
      scheduleStickToBottom(): void;
    }).scheduleStickToBottom();
    return { fixture, tick, scroller, writes, activate, queueRestore, queueFollow };
  }

  it('restores the pinned bottom in the activation render pass without advancing rAF', () => {
    const h = setup();
    h.activate('B');
    expect(h.scroller('B').scrollTop).toBe(900);
    expect(h.writes.get('B')).toContain(1000);
  });

  it('restores the saved offset when the transcript is unpinned', () => {
    const h = setup();
    h.scroller('A').scrollTop = 700;
    h.scroller('A').dispatchEvent(new Event('scroll'));
    h.scroller('A').scrollTop = 300;
    h.scroller('A').dispatchEvent(new Event('scroll'));
    h.activate('B');
    h.scroller('A').scrollTop = 0; // Model display:none resetting the native offset.
    h.activate('A');
    expect(h.scroller('A').scrollTop).toBe(300);
    expect(h.writes.get('A')?.at(-1)).toBe(300);
  });

  it('cancels a pending restore when deactivated before the render pass', () => {
    const h = setup();
    h.queueRestore('A');
    h.activate('B');
    expect(h.writes.get('A')).toEqual([]);
    expect(h.scroller('B').scrollTop).toBe(900);
  });

  it('lets only the latest restore write when activation repeats before the render pass', () => {
    const h = setup();
    h.queueRestore('A');
    h.queueRestore('A');
    h.tick();
    expect(h.writes.get('A')).toEqual([1000]);
  });

  it('does not override a user scroll before the restore write', () => {
    const h = setup();
    h.queueRestore('A');
    h.scroller('A').scrollTop = 300;
    h.writes.get('A')!.length = 0;
    h.scroller('A').dispatchEvent(new Event('scroll'));
    h.tick();
    expect(h.scroller('A').scrollTop).toBe(300);
    expect(h.writes.get('A')).toEqual([]);
  });

  it('resumes pinned follow when a scroll cancels the pending restore', () => {
    const h = setup();
    const frames: FrameRequestCallback[] = [];
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback);
      return frames.length;
    });
    try {
      h.queueRestore('A');
      const beforeFollow = frames.length;
      h.queueFollow('A');
      expect(frames).toHaveLength(beforeFollow);
      h.scroller('A').scrollTop = 300;
      h.scroller('A').dispatchEvent(new Event('scroll'));
      expect(frames.length).toBeGreaterThan(0);
      frames.forEach(frame => frame(0));
      expect(h.scroller('A').scrollTop).toBe(900);
      expect(h.writes.get('A')?.at(-1)).toBe(1000);
    } finally {
      raf.mockRestore();
    }
  });

  it('does not write after destroy with a restore pending', () => {
    const h = setup();
    h.queueRestore('A');
    h.fixture.destroy();
    TestBed.inject(ApplicationRef).tick();
    expect(h.writes.get('A')).toEqual([]);
  });
});
