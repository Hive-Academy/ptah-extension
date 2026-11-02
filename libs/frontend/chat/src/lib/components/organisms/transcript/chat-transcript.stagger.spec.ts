import { ChangeDetectionStrategy, Component, Input, NgModule, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { ExecutionChatMessage, ExecutionNode } from '@ptah-extension/shared';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { TranscriptMotionDirective } from './transcript-motion.directive';
import { STREAM_PRESENTATION_RECORDS_ENABLED } from '../../../services/stream-presentation-store.service';
import {
  configureTranscriptTestBed,
  makeTranscriptMessage,
  makeTranscriptTree,
} from './testing/transcript-spec-harness';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
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

interface Tab {
  readonly id: string;
  readonly claudeSessionId: string;
  readonly status: 'loaded' | 'resuming' | 'streaming';
  readonly messages: readonly ExecutionChatMessage[];
  readonly streamingState: ExecutionNode | null;
}

function messages(...ids: readonly string[]): readonly ExecutionChatMessage[] {
  return ids.map((id, index) => makeTranscriptMessage(id, 'assistant', index + 1));
}

function makeTab(ids: readonly string[], streamingState: ExecutionNode | null = null): Tab {
  return {
    id: 'tab-1',
    claudeSessionId: 'session-1',
    status: streamingState ? 'streaming' : 'loaded',
    messages: messages(...ids),
    streamingState,
  };
}

function mount(initialIds: readonly string[] = [], replaying = false, presentation = false) {
  const tabs = signal<readonly Tab[]>([makeTab(initialIds)]);
  const tree = signal<readonly ExecutionNode[]>([]);
  configureTranscriptTestBed({ tabs, buildTree: () => tree() });
  if (presentation) {
    TestBed.overrideProvider(STREAM_PRESENTATION_RECORDS_ENABLED, { useValue: true });
  }
  const fixture = TestBed.createComponent(ChatTranscriptComponent);
  fixture.componentRef.setInput('tabId', 'tab-1');
  fixture.componentRef.setInput('active', true);
  fixture.componentRef.setInput('historyReplaying', replaying);
  fixture.detectChanges();
  const motion = fixture.debugElement.query(By.directive(TranscriptMotionDirective))
    .injector.get(TranscriptMotionDirective);
  return { fixture, tabs, tree, motion };
}

function update(h: ReturnType<typeof mount>, ids: readonly string[], streamingState: ExecutionNode | null = null): void {
  h.tabs.set([makeTab(ids, streamingState)]);
  h.fixture.detectChanges();
}

function item(fixture: ComponentFixture<ChatTranscriptComponent>, id: string): HTMLElement {
  const node = fixture.nativeElement.querySelector(`.chat-msg-item[data-ptah-msg-item="${id}"]`) as HTMLElement | null;
  if (!node) throw new Error(`Missing message item ${id}`);
  return node;
}

describe('ChatTranscript message stagger', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('stagger indexes the last six messages in an open batch and binds the CSS index', () => {
    const h = mount();
    update(h, Array.from({ length: 20 }, (_, i) => `m${i}`));
    for (let i = 0; i < 20; i++) {
      const id = `m${i}`;
      const index = i < 14 ? null : i - 14;
      expect(h.motion.index(id)).toBe(index);
      expect(h.motion.enterClass(id)).toBe(index === null ? '' : 'ptah-msg-enter');
      expect(item(h.fixture, id).style.getPropertyValue('--ptah-msg-i')).toBe(index === null ? '' : String(index));
    }
  });

  it('keeps a streaming node through chunks and finalization with its item identity', () => {
    const h = mount();
    const tree = makeTranscriptTree('stream', 10);
    h.tree.set([tree]);
    update(h, [], tree);
    const first = item(h.fixture, 'stream');
    expect(h.motion.index('stream')).toBe(0);
    h.tree.set([makeTranscriptTree('stream', 10, 'next chunk')]);
    update(h, [], makeTranscriptTree('root', 10));
    expect(item(h.fixture, 'stream')).toBe(first);
    expect(h.motion.index('stream')).toBe(0);
    h.tree.set([]);
    update(h, ['stream']);
    expect(item(h.fixture, 'stream')).toBe(first);
    expect(h.motion.index('stream')).toBe(0);
  });

  it('keeps the presentation-path item through stream finalization', () => {
    const h = mount([], false, true);
    const tree = makeTranscriptTree('stream', 10);
    h.tree.set([tree]);
    update(h, [], tree);
    h.fixture.detectChanges();
    const first = item(h.fixture, 'stream');
    const index = h.motion.index('stream');
    h.tree.set([]);
    update(h, ['stream']);
    h.fixture.detectChanges();
    expect(item(h.fixture, 'stream')).toBe(first);
    expect(h.motion.index('stream')).toBe(index);
  });

  it('staggers an open batch during a pane switch and pauses it while pending', () => {
    const h = mount();
    h.fixture.componentRef.setInput('paneSwitching', true);
    update(h, ['a', 'b']);
    expect([h.motion.index('a'), h.motion.index('b')]).toEqual([0, 1]);
    expect(item(h.fixture, 'b').style.getPropertyValue('--ptah-msg-i')).toBe('1');
    const scroller = h.fixture.nativeElement.querySelector('[data-testid="chat-transcript-scroller"]') as HTMLElement;
    expect(scroller.classList.contains('ptah-pane-switch-pending')).toBe(true);
    h.fixture.componentRef.setInput('paneSwitching', false);
    h.fixture.componentRef.setInput('entering', true);
    h.fixture.detectChanges();
    expect(scroller.classList.contains('ptah-pane-switch-pending')).toBe(false);
    expect(h.motion.index('b')).toBe(1);
  });

  it('does not re-enter a finalized reply with a different slot id', () => {
    const h = mount(['user']);
    const tree = makeTranscriptTree('stream', 10);
    h.tree.set([tree]);
    update(h, ['user'], tree);
    const removed = item(h.fixture, 'stream');
    h.tree.set([]);
    update(h, ['user', 'final']);
    expect(h.motion.index('final')).toBeNull();
    expect(h.motion.enterClass('final')).toBe('');
    expect(removed.hasAttribute('data-ptah-leave-cut')).toBe(true);
  });

  it('stagger indexes an open replay batch but not later replay pages', () => {
    const h = mount([], true);
    update(h, ['a', 'b']);
    expect([h.motion.index('a'), h.motion.index('b')]).toEqual([0, 1]);
    update(h, ['a', 'b', 'c']);
    expect(h.motion.index('c')).toBeNull();
  });

  it('suppresses a page during the replay hold after replay clears', () => {
    const h = mount([], true);
    update(h, ['a']);
    h.fixture.componentRef.setInput('historyReplaying', false);
    h.fixture.detectChanges();
    update(h, ['a', 'b']);
    expect(h.motion.index('b')).toBeNull();
  });

  it('does not stagger older-history prepends or activation catch-up', () => {
    const h = mount(['b', 'c']);
    update(h, ['a', 'b', 'c']);
    expect(h.motion.index('a')).toBeNull();
    h.fixture.componentRef.setInput('active', false);
    h.fixture.detectChanges();
    update(h, ['a', 'b', 'c', 'd']);
    h.fixture.componentRef.setInput('active', true);
    h.fixture.detectChanges();
    expect(h.motion.index('d')).toBeNull();
  });

  it('marks a removed item inert and hidden before Angular detaches it', () => {
    const h = mount(['a', 'b']);
    const removed = item(h.fixture, 'b');
    update(h, ['a']);
    expect(removed.hasAttribute('inert')).toBe(true);
    expect(removed.getAttribute('aria-hidden')).toBe('true');
    expect(removed.hasAttribute('data-ptah-leaving')).toBe(true);
  });
});
