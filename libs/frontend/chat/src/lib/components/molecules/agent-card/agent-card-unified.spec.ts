import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { provideMarkdown } from 'ngx-markdown';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  createMockRpcService,
  provideSurfaceActiveTesting,
} from '@ptah-extension/core/testing';
import { AgentCardComponent } from './agent-card.component';
import { CliAgentOutputComponent } from './cli-agent-output.component';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';
import { extractCliAgentStats } from './stats-bar.utils';

function makeAgent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'test-agent',
    cli: 'opencode',
    task: 'Review task',
    status: 'running',
    startedAt: 1000,
    stdout: '',
    stderr: '',
    expanded: true,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    ...overrides,
  };
}

describe('agent card unified output regressions', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentCardComponent, CliAgentOutputComponent],
      providers: [
        provideSurfaceActiveTesting(),
        provideMarkdown(),
        { provide: AgentMonitorStore, useValue: { tick: signal(0) } },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        {
          provide: VSCodeService,
          useValue: { config: signal({ panelId: '' }), postMessage: jest.fn() },
        },
      ],
    });
  });

  it('reuses unchanged segment trees without clearing independent event state', () => {
    const treeBuilder = TestBed.inject(AgentMonitorTreeBuilderService);
    const clearSpy = jest.spyOn(treeBuilder, 'clearAgentCache');
    const events: FlatStreamEventUnion[] = [
      {
        id: 'message',
        eventType: 'message_start',
        messageId: 'message',
        role: 'assistant',
        timestamp: 1,
      },
      {
        id: 'delta',
        eventType: 'text_delta',
        messageId: 'message',
        blockIndex: 0,
        delta: 'Event text',
        timestamp: 2,
      },
    ];
    const eventTree = treeBuilder.buildTree('agent-cache', events);
    const fixture = TestBed.createComponent(CliAgentOutputComponent);
    fixture.componentRef.setInput('agentId', 'agent-cache');
    fixture.componentRef.setInput('segments', [
      { type: 'text', content: 'Step 1' },
    ]);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();
    const firstTree = fixture.componentInstance.executionNodes();
    fixture.componentRef.setInput('streamRevision', 1);
    fixture.detectChanges();
    expect(fixture.componentInstance.executionNodes()).toBe(firstTree);
    fixture.componentRef.setInput('segments', [
      { type: 'text', content: 'Step 1 completed' },
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.executionNodes()).not.toBe(firstTree);
    expect(fixture.componentInstance.executionNodes()[0].content).toBe(
      'Step 1 completed',
    );
    expect(clearSpy).not.toHaveBeenCalled();
    expect(treeBuilder.buildTree('agent-cache', events)).toBe(eventTree);
  });

  it('keys segment caching by array identity and length', () => {
    const treeBuilder = TestBed.inject(AgentMonitorTreeBuilderService);
    const segments: CliOutputSegment[] = [{ type: 'text', content: 'First' }];
    const first = treeBuilder.buildTreeFromSegments('cache', segments);
    expect(treeBuilder.buildTreeFromSegments('cache', segments)).toBe(first);
    const replacement: CliOutputSegment[] = [
      { type: 'text', content: 'Replacement' },
    ];
    const replaced = treeBuilder.buildTreeFromSegments('cache', replacement);
    expect(replaced).not.toBe(first);
    expect(replaced[0].content).toBe('Replacement');
    replacement.push({ type: 'text', content: ' appended' });
    const appended = treeBuilder.buildTreeFromSegments('cache', replacement);
    expect(appended).not.toBe(replaced);
    expect(appended[0].content).toBe('Replacement appended');
    expect(treeBuilder.buildTreeFromSegments('cache', replacement)).toBe(
      appended,
    );
  });

  it.each(['text', 'error'] as const)(
    'retains stdout, mounted nodes and scroll position when a first %s segment arrives',
    async (type) => {
      // Isolate scroll-container retention from the existing follow-output animation.
      const frames: FrameRequestCallback[] = [];
      const raf = jest
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((callback) => {
          frames.push(callback);
          return frames.length;
        });
      try {
        const agentData = makeAgent({
          stdout:
            'Initializing sandbox environment\nTool: read_file {"path":"a.ts"}',
        });
        const fixture = TestBed.createComponent(AgentCardComponent);
        fixture.componentRef.setInput('agent', agentData);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const output: HTMLElement = fixture.nativeElement.querySelector(
          'ptah-cli-agent-output',
        );
        const scroller = output.firstElementChild as HTMLElement;
        const raw = output.querySelector('ptah-agent-card-output');
        expect(output.textContent).toContain(
          'Initializing sandbox environment',
        );
        expect(raw).not.toBeNull();
        scroller.scrollTop = 37;
        fixture.componentRef.setInput('agent', {
          ...agentData,
          status: type === 'error' ? 'failed' : 'running',
          segments: [
            {
              type,
              content:
                type === 'error'
                  ? 'Process exited with code 1'
                  : 'I have inspected the repository.',
            },
          ],
        });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(
          fixture.nativeElement.querySelector('ptah-cli-agent-output'),
        ).toBe(output);
        expect(output.firstElementChild).toBe(scroller);
        expect(output.querySelector('ptah-agent-card-output')).toBe(raw);
        expect(scroller.scrollTop).toBe(37);
        expect(output.textContent).toContain(
          'Initializing sandbox environment',
        );
        expect(output.textContent).toContain('read_file');
        expect(output.querySelector('ptah-execution-node')).not.toBeNull();
        for (const callback of frames.splice(0)) callback(performance.now());
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(output.textContent).toContain(
          type === 'error'
            ? 'Process exited with code 1'
            : 'I have inspected the repository.',
        );
      } finally {
        raf.mockRestore();
      }
    },
  );

  it('keeps reported totals visible beside later input/output counts', () => {
    // Turn 1: Antigravity reports total tokens only (e.g. 1000 total tokens)
    // Turn 2: Next turn reports input and output tokens (e.g. 200 input, 100 output)
    const segments = [
      {
        type: 'info' as const,
        content: 'Usage: 1000 total tokens',
        usage: { totalTokens: 1000 },
      },
      {
        type: 'info' as const,
        content: 'Usage: 200 input, 100 output tokens',
        usage: { inputTokens: 200, outputTokens: 100 },
      },
    ];

    const stats = extractCliAgentStats(segments);
    expect(stats).toEqual({
      totalTokens: 1000,
      inputTokens: 200,
      outputTokens: 100,
    });

    const fixture = TestBed.createComponent(CliAgentOutputComponent);
    fixture.componentRef.setInput('agentId', 'agent-stats');
    fixture.componentRef.setInput('segments', segments);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    // Input and output are displayed:
    expect(text).toContain('↑ 200');
    expect(text).toContain('↓ 100');
    expect(text).toContain('Reported total: 1.0k tokens');
  });
});
