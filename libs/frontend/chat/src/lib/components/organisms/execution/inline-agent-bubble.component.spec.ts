/**
 * InlineAgentBubbleComponent — Phase 3 spec coverage
 *
 * Focuses on the new subagent visibility + bidirectional messaging
 * behavior wired in Phase 3:
 *   - status badge selection by SubagentRecord.status (via canStop / record)
 *   - canStop() gating (running + taskId)
 *   - canSendMessage() gating (running)
 *   - progressLine() falls back latestSummary → lastToolName → description
 *   - send-message submit clears the draft and dispatches sendMessageToAgent
 *   - Cmd/Ctrl+Enter triggers submit, plain Enter does not
 *
 * Tests instantiate the component class directly inside an injection context
 * to avoid pulling the full Angular template/CDK + ngx-markdown ESM chain
 * just to exercise pure component logic. The template is covered indirectly
 * by typecheck + e2e flows.
 */

// Stub ngx-markdown ESM imports pulled in transitively via chat-ui barrel.
import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
} from '@angular/core';
import { signal } from '@angular/core';

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

import { TestBed } from '@angular/core/testing';
import { InlineAgentBubbleComponent } from './inline-agent-bubble.component';
import {
  AgentMonitorStore,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type { ExecutionNode } from '@ptah-extension/shared';

function makeNode(overrides: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    id: 'n-1',
    type: 'agent',
    status: 'streaming',
    content: 'Doing things',
    children: [],
    agentType: 'Explore',
    agentDescription: 'Explore the repo',
    toolCallId: 'toolu_parent_abc',
    startTime: 1,
    isCollapsed: false,
    ...overrides,
  } as ExecutionNode;
}

describe('InlineAgentBubbleComponent — Phase 3', () => {
  const subagentMap = signal<ReadonlyMap<string, SubagentRecord>>(new Map());

  const storeMock = {
    subagents: subagentMap.asReadonly(),
    isAgentResumed: jest.fn(() => false),
    sendMessageToAgent: jest.fn(async () => undefined),
    stopAgent: jest.fn(async () => undefined),
    interruptSession: jest.fn(async () => undefined),
  } as unknown as AgentMonitorStore;

  function setRecord(rec: SubagentRecord): void {
    const m = new Map<string, SubagentRecord>();
    m.set(rec.parentToolUseId, rec);
    subagentMap.set(m);
  }

  function build(node: ExecutionNode): InlineAgentBubbleComponent {
    TestBed.configureTestingModule({
      providers: [{ provide: AgentMonitorStore, useValue: storeMock }],
    });
    const fixture = TestBed.createComponent(InlineAgentBubbleComponent);
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    subagentMap.set(new Map());
    (storeMock.sendMessageToAgent as jest.Mock).mockClear();
    (storeMock.stopAgent as jest.Mock).mockClear();
    TestBed.resetTestingModule();
  });

  it('exposes the subagent record matching node().toolCallId', () => {
    const cmp = build(makeNode());
    const rec: SubagentRecord = {
      parentToolUseId: 'toolu_parent_abc',
      taskId: 't1',
      status: 'running',
    };
    setRecord(rec);
    expect(cmp.subagentRecord()).toBe(rec);
  });

  it('progressLine prefers latestSummary, then lastToolName, then description', () => {
    const cmp = build(makeNode());
    setRecord({
      parentToolUseId: 'toolu_parent_abc',
      status: 'running',
      latestSummary: 'AI summary',
      lastToolName: 'Read',
      description: 'desc',
    });
    expect(cmp.progressLine()).toBe('AI summary');

    setRecord({
      parentToolUseId: 'toolu_parent_abc',
      status: 'running',
      lastToolName: 'Read',
      description: 'desc',
    });
    expect(cmp.progressLine()).toBe('last: Read');

    setRecord({
      parentToolUseId: 'toolu_parent_abc',
      status: 'running',
      description: 'just a description',
    });
    expect(cmp.progressLine()).toBe('just a description');

    setRecord({
      parentToolUseId: 'toolu_parent_abc',
      status: 'running',
    });
    expect(cmp.progressLine()).toBeNull();
  });

  describe('canStop', () => {
    it('is true when status=running AND taskId present', () => {
      const cmp = build(makeNode());
      setRecord({
        parentToolUseId: 'toolu_parent_abc',
        status: 'running',
        taskId: 't1',
      });
      expect(cmp.canStop()).toBe(true);
    });

    it('is false when taskId is missing', () => {
      const cmp = build(makeNode());
      setRecord({ parentToolUseId: 'toolu_parent_abc', status: 'running' });
      expect(cmp.canStop()).toBe(false);
    });

    it('is false when status is not running', () => {
      const cmp = build(makeNode());
      setRecord({
        parentToolUseId: 'toolu_parent_abc',
        status: 'completed',
        taskId: 't1',
      });
      expect(cmp.canStop()).toBe(false);
    });
  });

  describe('send-message UI', () => {
    it('canSendMessage is false unless record.status === running', () => {
      const cmp = build(makeNode());
      setRecord({ parentToolUseId: 'toolu_parent_abc', status: 'completed' });
      expect(cmp.canSendMessage()).toBe(false);
      setRecord({ parentToolUseId: 'toolu_parent_abc', status: 'running' });
      expect(cmp.canSendMessage()).toBe(true);
    });

    it('onSendSubmit dispatches sendMessageToAgent and clears draft', async () => {
      const cmp = build(makeNode());
      setRecord({
        parentToolUseId: 'toolu_parent_abc',
        status: 'running',
        taskId: 't1',
      });
      cmp.sendDraft.set('hello');
      // Component preserves the draft on send failure (so the user can retry);
      // the success path requires the store to acknowledge with `true`.
      (storeMock.sendMessageToAgent as jest.Mock).mockResolvedValueOnce(true);
      // eslint-disable-next-line @typescript-eslint/dot-notation
      await (cmp as unknown as { onSendSubmit(): Promise<void> })[
        'onSendSubmit'
      ]();
      expect(storeMock.sendMessageToAgent).toHaveBeenCalledWith(
        'toolu_parent_abc',
        'hello',
      );
      expect(cmp.sendDraft()).toBe('');
      expect(cmp.showSentToast()).toBe(true);
    });

    it('onSendSubmit is a no-op when canSubmitSend is false (empty draft)', async () => {
      const cmp = build(makeNode());
      setRecord({ parentToolUseId: 'toolu_parent_abc', status: 'running' });
      cmp.sendDraft.set('   ');
      await (cmp as unknown as { onSendSubmit(): Promise<void> })[
        'onSendSubmit'
      ]();
      expect(storeMock.sendMessageToAgent).not.toHaveBeenCalled();
    });

    it('Cmd/Ctrl+Enter triggers submit; plain Enter does not', async () => {
      const cmp = build(makeNode());
      setRecord({
        parentToolUseId: 'toolu_parent_abc',
        status: 'running',
        taskId: 't1',
      });
      cmp.sendDraft.set('hi');

      const onSendKeydown = (
        cmp as unknown as {
          onSendKeydown(e: KeyboardEvent): void;
        }
      ).onSendKeydown.bind(cmp);

      const plainEnter = new KeyboardEvent('keydown', { key: 'Enter' });
      const preventSpy = jest.spyOn(plainEnter, 'preventDefault');
      onSendKeydown(plainEnter);
      expect(preventSpy).not.toHaveBeenCalled();
      expect(storeMock.sendMessageToAgent).not.toHaveBeenCalled();

      const ctrlEnter = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
      });
      const ctrlPreventSpy = jest.spyOn(ctrlEnter, 'preventDefault');
      onSendKeydown(ctrlEnter);
      expect(ctrlPreventSpy).toHaveBeenCalled();
      // Allow microtask drain for the async submit
      await Promise.resolve();
      await Promise.resolve();
      expect(storeMock.sendMessageToAgent).toHaveBeenCalledWith(
        'toolu_parent_abc',
        'hi',
      );
    });
  });

  describe('onStopClick', () => {
    it('dispatches stopAgent with the record taskId', async () => {
      const cmp = build(makeNode());
      setRecord({
        parentToolUseId: 'toolu_parent_abc',
        status: 'running',
        taskId: 't42',
      });
      const evt = { stopPropagation: jest.fn() } as unknown as Event;
      await (
        cmp as unknown as {
          onStopClick(e: Event): Promise<void>;
        }
      ).onStopClick(evt);
      expect(storeMock.stopAgent).toHaveBeenCalledWith('t42');
    });

    it('is a no-op when there is no taskId', async () => {
      const cmp = build(makeNode());
      setRecord({ parentToolUseId: 'toolu_parent_abc', status: 'running' });
      const evt = { stopPropagation: jest.fn() } as unknown as Event;
      await (
        cmp as unknown as {
          onStopClick(e: Event): Promise<void>;
        }
      ).onStopClick(evt);
      expect(storeMock.stopAgent).not.toHaveBeenCalled();
    });
  });
});
