/**
 * Work-log parity (TASK_2026_717): the same turn, rendered through the main
 * transcript and through a lane transcript, reaches MessageBubbleComponent
 * with the same work-log inputs, streaming and finished. The bubble's own
 * structure for those inputs (label, open log, tool rows, answer) is pinned
 * by lane-transcript.component.spec.ts with the real bubble.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  computed,
  signal,
} from '@angular/core';

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
import { By } from '@angular/platform-browser';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
} from '@ptah-extension/shared';
import { MessageBubbleComponent } from '../message-bubble.component';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { LaneTranscriptComponent } from './lane-transcript.component';
import { turnLogOpenOf } from './transcript-turn-contexts';
import { splitTurnMessage } from '../../../utils/turn-answer-split.utils';
import {
  TranscriptMessageBubbleStub,
  configureTranscriptTestBed,
  installFakeIntersectionObserver,
  installFakeResizeObserver,
  removeFakeIntersectionObserver,
  removeFakeResizeObserver,
} from './testing/transcript-spec-harness';

/** One assistant turn: thinking, text, two tools, closing text. */
function turnRoot(streaming: boolean): ExecutionNode {
  const status = streaming ? 'streaming' : 'complete';
  return createExecutionNode({
    id: 'turn-root',
    type: 'message',
    status,
    startTime: 1000,
    children: [
      createExecutionNode({ id: 'th', type: 'thinking', status: 'complete', content: 'Plan', startTime: 1000 }),
      createExecutionNode({ id: 't1', type: 'text', status: 'complete', content: 'Reading.', startTime: 1001 }),
      createExecutionNode({ id: 'read', type: 'tool', status: 'complete', toolName: 'Read', startTime: 1002 }),
      createExecutionNode({ id: 'grep', type: 'tool', status: 'complete', toolName: 'Grep', startTime: 1003 }),
      createExecutionNode({ id: 't2', type: 'text', status, content: 'Done.', startTime: 1004 }),
    ],
  });
}

interface WorkLogInputs {
  readonly logOpen: boolean | null;
  readonly isStreaming: boolean;
  readonly viewMode: 'full' | 'compact';
  readonly agentTileMode: boolean;
  readonly firstAssistant: boolean | undefined;
  readonly hasActivity: boolean | undefined;
  readonly children: readonly string[];
}

function inputsOf(bubble: TranscriptMessageBubbleStub): WorkLogInputs {
  return {
    logOpen: bubble.logOpen,
    isStreaming: bubble.isStreaming,
    viewMode: bubble.viewMode,
    agentTileMode: bubble.agentTileMode,
    firstAssistant: bubble.turn?.isFirstAssistant,
    hasActivity: bubble.turn?.hasActivity,
    children: (bubble.message.streamingState?.children ?? []).map((n) => n.id),
  };
}

function mainInputs(streaming: boolean): WorkLogInputs {
  const root = turnRoot(streaming);
  const messages: readonly ExecutionChatMessage[] = streaming
    ? []
    : [
        createExecutionChatMessage({
          id: 'turn-root',
          role: 'assistant',
          timestamp: 1000,
          streamingState: root,
        }),
      ];
  const tabs = computed(() => [
    {
      id: 'tab-1',
      claudeSessionId: 'session-1',
      status: streaming ? 'streaming' : 'loaded',
      viewMode: 'full',
      messages,
      streamingState: streaming ? { revision: 1 } : null,
    },
  ]);
  configureTranscriptTestBed({
    tabs,
    buildTree: (() => (streaming ? [root] : [])) as (...args: never[]) => unknown,
  });
  const fixture = TestBed.createComponent(ChatTranscriptComponent);
  fixture.componentRef.setInput('tabId', 'tab-1');
  fixture.componentRef.setInput('active', true);
  fixture.detectChanges();
  const bubbles = fixture.debugElement
    .queryAll(By.directive(TranscriptMessageBubbleStub))
    .map((d) => d.componentInstance as TranscriptMessageBubbleStub);
  expect(bubbles).toHaveLength(1);
  const result = inputsOf(bubbles[0]);
  fixture.destroy();
  TestBed.resetTestingModule();
  return result;
}

function laneInputs(
  streaming: boolean,
  nodes: readonly ExecutionNode[] = [turnRoot(streaming)],
): WorkLogInputs {
  TestBed.configureTestingModule({
    imports: [LaneTranscriptComponent],
    providers: [{ provide: AgentMonitorStore, useValue: { tick: signal(0) } }],
  });
  TestBed.overrideComponent(LaneTranscriptComponent, {
    remove: { imports: [MessageBubbleComponent] },
    add: { imports: [TranscriptMessageBubbleStub] },
  });
  const fixture = TestBed.createComponent(LaneTranscriptComponent);
  fixture.componentRef.setInput('laneId', 'lane-1');
  fixture.componentRef.setInput('nodes', nodes);
  fixture.componentRef.setInput('isStreaming', streaming);
  fixture.detectChanges();
  const bubbles = fixture.debugElement
    .queryAll(By.directive(TranscriptMessageBubbleStub))
    .map((d) => d.componentInstance as TranscriptMessageBubbleStub);
  expect(bubbles).toHaveLength(1);
  const result = inputsOf(bubbles[0]);
  fixture.destroy();
  TestBed.resetTestingModule();
  return result;
}

describe('main and lane transcript work-log parity', () => {
  beforeEach(() => {
    installFakeIntersectionObserver();
    installFakeResizeObserver();
  });
  afterEach(() => {
    removeFakeIntersectionObserver();
    removeFakeResizeObserver();
  });

  it.each([true, false])(
    'passes the same work-log inputs to the bubble (streaming: %s)',
    (streaming) => {
      const main = mainInputs(streaming);
      const lane = laneInputs(streaming);
      expect(lane).toEqual(main);
      // The shared rule: open while the turn streams, the bubble's default
      // (closed) once it is finished.
      expect(main.logOpen).toBe(streaming ? true : null);
      expect(main.children).toEqual(['th', 't1', 'read', 'grep', 't2']);
    },
  );

  // TASK_2026_717 item 4: a CLI lane is a flat node list. With one text
  // node per provider message, the lane bubble gets the same children as a
  // main message, so the bubble splits log and answer the same way.
  it('gives a CLI lane turn the same work-log inputs as main', () => {
    const main = mainInputs(false);
    const lane = laneInputs(false, turnRoot(false).children);
    expect(lane).toEqual(main);
    const split = splitTurnMessage(turnRoot(false), {
      isLastAssistant: true,
      streaming: false,
    });
    expect(split.answer.map((node) => node.id)).toEqual(['t2']);
    expect(split.log.map((node) => node.id)).toContain('t1');
  });

  it('keeps a user choice over the streaming default', () => {
    expect(turnLogOpenOf(false, 'full', true)).toBe(false);
    expect(turnLogOpenOf(true, 'compact', false)).toBe(true);
    expect(turnLogOpenOf(undefined, 'compact', true)).toBeNull();
    expect(turnLogOpenOf(undefined, 'full', true)).toBe(true);
    expect(turnLogOpenOf(undefined, 'full', false)).toBeNull();
  });
});
