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
} from '@ptah-extension/core';
import {
  createMockRpcService,
  provideSurfaceActiveTesting,
} from '@ptah-extension/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
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
      // No DisplayDockState / DisplaySheetState: only a session chat view
      // provides them, and a canvas lane renders outside that view. Before the
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
        { provide: AgentMonitorStore, useValue: { tick: signal(0) } },
      ],
    });
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
    expect(root.querySelector('[data-testid="artifact-card-title"]')?.textContent)
      .toContain('Report');
    expect(
      root.querySelector('[data-testid="artifact-card-status"]')?.textContent,
    ).toContain('Preview not available here');
    expect(root.querySelector('[data-testid="artifact-card-open"]')).toBeNull();
    expect(
      root.querySelector('[data-testid="artifact-card-fullscreen"]'),
    ).toBeNull();
    fixture.destroy();
  });
});
