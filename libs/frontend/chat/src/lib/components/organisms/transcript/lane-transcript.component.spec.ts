/**
 * LaneTranscriptComponent: a subagent or CLI lane renders its tree through
 * the main chat's MessageBubble, so its work log shows the same tool rows
 * (TASK_2026_717 D1 regression: tool rows were missing in canvas lanes).
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  signal,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
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
import {
  ClaudeRpcService,
  FILE_LINK_OPENER,
  VSCodeService,
  WallClockService,
} from '@ptah-extension/core';
import {
  createMockRpcService,
  provideSurfaceActiveTesting,
} from '@ptah-extension/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ArtifactStore } from '../../../services/artifact.store';
import { createExecutionNode, type ExecutionNode } from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import { LaneTranscriptComponent } from './lane-transcript.component';

/** The flat node list `AgentMonitorTreeBuilderService` builds for a CLI lane. */
function cliLaneNodes(): ExecutionNode[] {
  return [
    createExecutionNode({
      id: 'seg-thinking-0',
      type: 'thinking',
      status: 'complete',
      content: 'Plan the read',
    }),
    createExecutionNode({
      id: 'seg-text-1',
      type: 'text',
      status: 'complete',
      content: 'I will start by reading the inspector component.',
    }),
    createExecutionNode({
      id: 'seg-tool-2',
      type: 'tool',
      status: 'complete',
      content: null,
      toolName: 'Read',
      toolInput: { file_path: 'C:\\ws\\src\\inspector.component.ts' },
      toolOutput: 'file contents here',
    }),
    createExecutionNode({
      id: 'seg-tool-4',
      type: 'tool',
      status: 'complete',
      content: null,
      toolName: 'Grep',
      toolInput: { pattern: 'grid-cols', path: 'C:\\ws\\src' },
      toolOutput: 'a.ts:12: grid-cols-3',
    }),
    createExecutionNode({
      id: 'seg-text-6',
      type: 'text',
      status: 'complete',
      content: 'Now delegating a deeper check to a subagent.',
    }),
  ];
}

describe('LaneTranscriptComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LaneTranscriptComponent],
      // No DisplayDockState: only a session chat view
      // provides it, and a canvas lane renders outside that view. Before the
      // fix ToolCallItemComponent required both, so every tool row in a lane
      // failed to create (NG0201) and left an empty node.
      providers: [
        provideSurfaceActiveTesting(),
        {
          provide: VSCodeService,
          useValue: {
            getPtahIconUri: () => '',
            getPtahUserIconUri: () => '',
          },
        },
        {
          provide: ChatStore,
          useValue: {
            getPermissionForTool: () => null,
            handlePermissionResponse: jest.fn(),
          },
        },
        {
          provide: ArtifactStore,
          useValue: {
            records: signal({}),
            lastError: signal(null),
            recordById: () => null,
            forSession: () => signal([]),
            reload: jest.fn(),
          },
        },
        { provide: TabManagerService, useValue: { activeTabId: signal(null) } },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
      ],
    });
  });

  it('keeps the live elapsed label ticking through the shared clock', () => {
    const now = signal(100_000);
    const release = jest.fn();
    const acquire = jest.fn(() => release);
    TestBed.overrideProvider(WallClockService, {
      useValue: { now: () => now.asReadonly(), acquire },
    });
    const fixture = TestBed.createComponent(LaneTranscriptComponent);
    fixture.componentRef.setInput('laneId', 'cli-clock');
    fixture.componentRef.setInput('events', [
      {
        id: 'prompt-start',
        eventType: 'message_start',
        messageId: 'prompt',
        role: 'user',
        timestamp: 98_000,
      },
      {
        id: 'prompt-text',
        eventType: 'text_delta',
        messageId: 'prompt',
        delta: 'Read the file',
        timestamp: 98_000,
      },
    ]);
    fixture.componentRef.setInput('nodes', [
      createExecutionNode({
        id: 'live-tool',
        type: 'tool',
        status: 'streaming',
        content: null,
        toolName: 'Read',
        toolInput: { file_path: 'C:\\ws\\src\\a.ts' },
        startTime: 98_001,
      }),
    ]);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();
    const label = () => (fixture.nativeElement as HTMLElement)
      .querySelector('[data-test="turn-disclosure-row"]')?.textContent;

    expect(acquire).toHaveBeenCalledWith('second');
    expect(label()).toContain('Working · 2s');
    now.set(101_000);
    fixture.detectChanges();
    expect(label()).toContain('Working · 3s');

    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();
    expect(release).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it.each([true, false])(
    'renders the tool rows of a lane turn in its work log (streaming: %s)',
    (streaming) => {
      const fixture = TestBed.createComponent(LaneTranscriptComponent);
      fixture.componentRef.setInput('laneId', 'cli-1');
      fixture.componentRef.setInput('nodes', cliLaneNodes());
      fixture.componentRef.setInput('isStreaming', streaming);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const row = root.querySelector<HTMLButtonElement>(
        '[data-test="turn-disclosure-row"]',
      );
      expect(row).not.toBeNull();
      // The main chat's rule: a streaming turn opens its work log, a
      // finished one starts closed with its answer after the log.
      expect(row?.textContent).toContain(streaming ? 'Working' : 'Worked');
      expect(row?.getAttribute('aria-expanded')).toBe(String(streaming));
      const answer = root.querySelector('.cs-answer');
      if (streaming) {
        expect(answer).toBeNull();
      } else {
        expect(answer?.textContent).toContain('Now delegating');
        expect(answer?.querySelector('ptah-tool-call-item')).toBeNull();
        row?.click();
        fixture.detectChanges();
      }
      const tools = [...root.querySelectorAll('ptah-tool-call-item')];
      expect(tools).toHaveLength(2);
      expect(tools[0].textContent).toContain('Read');
      expect(tools[1].textContent).toContain('Grep');
      expect(
        root.querySelector('[data-test="turn-disclosure-meta"]')?.textContent,
      ).toContain('2 tools');
      fixture.destroy();
    },
  );

  // TASK_2026_717 regression (e2e task-337): a nested tool that arrives after
  // the Task tool result is finalized as a second tree of the same agent
  // message. Two bubbles with one id shared one turn context whose
  // `isFirstAssistant` was false, so the disclosure row vanished.
  it('counts a tool streamed after finalize in the same message bubble', () => {
    const tool = (id: string, toolName: string) =>
      createExecutionNode({
        id,
        type: 'tool',
        status: 'complete',
        content: null,
        toolName,
        toolInput: { file_path: 'C:\\ws\\src\\a.ts', pattern: 'x' },
        startTime: 20,
      });
    const message = (children: ExecutionNode[]) =>
      createExecutionNode({
        id: 'agent-message-start',
        type: 'message',
        status: 'streaming',
        startTime: 10,
        children,
      });
    const fixture = TestBed.createComponent(LaneTranscriptComponent);
    fixture.componentRef.setInput('laneId', 'toolu_task');
    fixture.componentRef.setInput('nodes', [
      message([tool('toolu_child_1', 'Read')]),
      message([tool('toolu_child_2', 'Grep')]),
    ]);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('ptah-message-bubble')).toHaveLength(1);
    const meta = root.querySelectorAll('[data-test="turn-disclosure-meta"]');
    expect(meta).toHaveLength(1);
    expect(meta[0].textContent).toContain('2 tools');
    fixture.destroy();
  });

  // TASK_2026_717 D7: a tab switch destroys the lane; main keeps the choice.
  it('keeps the work-log choice when the lane is recreated', () => {
    const render = () => {
      const fixture = TestBed.createComponent(LaneTranscriptComponent);
      fixture.componentRef.setInput('laneId', 'cli-1');
      fixture.componentRef.setInput('nodes', cliLaneNodes());
      fixture.detectChanges();
      return fixture;
    };
    const rowOf = (fixture: ReturnType<typeof render>) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '[data-test="turn-disclosure-row"]',
      );
    const first = render();
    expect(rowOf(first)?.getAttribute('aria-expanded')).toBe('false');
    rowOf(first)?.click();
    first.detectChanges();
    expect(rowOf(first)?.getAttribute('aria-expanded')).toBe('true');
    first.destroy();

    const second = render();
    expect(rowOf(second)?.getAttribute('aria-expanded')).toBe('true');
    second.destroy();
  });

  it('shows a loaded artifact read-only, without dead Open actions', () => {
    TestBed.overrideProvider(ArtifactStore, {
      useValue: {
        records: signal({}),
        lastError: signal(null),
        recordById: (id: string) => ({ id, title: 'Report' }),
        forSession: () => signal([]),
        reload: jest.fn(),
      },
    });
    const fixture = TestBed.createComponent(LaneTranscriptComponent);
    fixture.componentRef.setInput('laneId', 'cli-1');
    fixture.componentRef.setInput('nodes', [
      createExecutionNode({
        id: 'seg-tool-0',
        type: 'tool',
        status: 'complete',
        content: null,
        toolName: 'ptah_artifact_publish',
        toolInput: {},
        toolOutput: JSON.stringify({ id: 'art-1', title: 'Report' }),
      }),
    ]);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    // The tool row keeps a compact read-only line; Open lives on the reply
    // card of a session transcript (TASK_2026_853_3401, plan C).
    expect(
      root.querySelector('[data-testid="tool-artifact-line"]')?.textContent?.trim(),
    ).toBe('Artifact · Report');
    expect(root.querySelector('ptah-artifact-card')).toBeNull();
    expect(root.querySelector('[data-testid="artifact-card-open"]')).toBeNull();
    expect(
      root.querySelector('[data-testid="artifact-card-fullscreen"]'),
    ).toBeNull();
    fixture.destroy();
  });
});
