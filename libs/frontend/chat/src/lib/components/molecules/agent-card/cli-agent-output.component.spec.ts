import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideMarkdown } from 'ngx-markdown';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { createMockRpcService } from '@ptah-extension/core/testing';
import type {
  CliOutputSegment,
  CliType,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { AgentCardComponent } from './agent-card.component';
import { CliAgentOutputComponent } from './cli-agent-output.component';
import { ExecutionNodeComponent } from '../../organisms/execution/execution-node.component';

function agent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'agent-1',
    cli: 'antigravity',
    task: 'Inspect files',
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

describe('unified CLI agent output', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentCardComponent, CliAgentOutputComponent],
      providers: [
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

  function renderCard(value: MonitoredAgent) {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', value);
    fixture.detectChanges();
    return fixture;
  }

  it.each<CliType>([
    'antigravity',
    'cursor',
    'pi',
    'codex',
    'copilot',
    'ptah-cli',
    'opencode',
  ])(
    'renders %s structured tool output through the real ExecutionNode tree',
    (cli) => {
      const fixture = renderCard(
        agent({
          cli,
          segments: [
            {
              type: 'tool-call',
              content: '',
              toolName: 'run_command',
              toolCallId: 'call-1',
              toolInput: { CommandLine: 'pwd' },
            },
            {
              type: 'tool-result',
              content: '/workspace',
              toolCallId: 'call-1',
            },
          ],
        }),
      );
      const node = fixture.debugElement.query(
        By.directive(ExecutionNodeComponent),
      );
      expect(node).not.toBeNull();
      expect(node.componentInstance.node()).toMatchObject({
        type: 'tool',
        toolName: 'run_command',
        toolOutput: '/workspace',
        status: 'complete',
      });
      expect(
        fixture.nativeElement.querySelector('ptah-cli-agent-output'),
      ).not.toBeNull();
      expect(
        fixture.nativeElement.querySelector('ptah-agent-card-output'),
      ).toBeNull();
    },
  );

  it.each<{ cli: CliType; segment: CliOutputSegment; expected: string[] }>([
    {
      cli: 'codex',
      segment: {
        type: 'info',
        content: 'Usage: 100 input, 50 output tokens',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      expected: ['↑ 100', '↓ 50'],
    },
    {
      cli: 'copilot',
      segment: {
        type: 'info',
        content:
          'Usage: model: claude-sonnet-4.5, 1000 input, 500 output, $0.0025, 3.5s',
        usage: {
          model: 'claude-sonnet-4.5',
          inputTokens: 1000,
          outputTokens: 500,
          costUsd: 0.0025,
          durationMs: 3500,
        },
      },
      expected: ['claude-sonnet-4.5', '↑ 1.0k', '↓ 500', '$0.0025', '3.5s'],
    },
    {
      cli: 'antigravity',
      segment: {
        type: 'info',
        content: 'Usage: 168 output tokens',
        usage: { outputTokens: 168 },
      },
      expected: ['↓ 168'],
    },
  ])(
    'renders the $cli adapter usage contract in the stats bar only',
    ({ cli, segment, expected }) => {
      const fixture = renderCard(agent({ cli, segments: [segment] }));
      const output: HTMLElement = fixture.nativeElement.querySelector(
        'ptah-cli-agent-output',
      );
      const text = output.textContent?.replace(/\s+/g, ' ');
      for (const value of expected) expect(text).toContain(value);
      expect(text).not.toContain('Usage:');
      expect(output.querySelector('ptah-execution-node')).toBeNull();
    },
  );

  it('keeps content-bearing segments with usage visible in the tree', async () => {
    const fixture = renderCard(
      agent({
        status: 'completed',
        segments: [
          {
            type: 'text',
            content: 'Answer with usage metadata',
            usage: { outputTokens: 25 },
          },
        ],
      }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const node: HTMLElement = fixture.nativeElement.querySelector(
      'ptah-execution-node',
    );
    expect(node.textContent).toContain('Answer with usage metadata');
    expect(fixture.nativeElement.textContent).toContain('↓ 25');
  });

  it('preserves error and informational stderr blocks beside the rich tree', () => {
    const fixture = renderCard(
      agent({
        segments: [{ type: 'text', content: 'Working' }],
        stderr: 'Loading model\nError: denied <script>alert(1)</script>',
      }),
    );
    const blocks: NodeListOf<HTMLPreElement> =
      fixture.nativeElement.querySelectorAll('ptah-cli-agent-output pre');
    expect(
      Array.from(blocks).map((block) => block.textContent?.trim()),
    ).toEqual(['Loading model', 'Error: denied <script>alert(1)</script>']);
    expect(blocks[0].classList.contains('text-base-content-muted')).toBe(true);
    expect(blocks[1].classList.contains('text-error')).toBe(true);
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
  });

  it('keeps no-segment raw stdout and stderr visible through the fallback renderer', async () => {
    const fixture = renderCard(
      agent({
        cli: 'opencode',
        stdout: 'Raw stdout response\nTool: read_file {"path":"a.ts"}',
        stderr: 'Error: raw failure',
      }),
    );
    expect(
      fixture.nativeElement.querySelector('ptah-agent-card-output'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-cli-agent-output'),
    ).not.toBeNull();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Raw stdout response');
    expect(fixture.nativeElement.textContent).toContain('read_file');
    expect(fixture.nativeElement.textContent).toContain('Error: raw failure');
  });

  it('prefers stream events and responds to revision changes on the same event array', () => {
    const events: FlatStreamEventUnion[] = [
      {
        id: 'start',
        eventType: 'message_start',
        messageId: 'message',
        role: 'assistant',
        timestamp: 1000,
      },
      {
        id: 'delta-1',
        eventType: 'text_delta',
        messageId: 'message',
        blockIndex: 0,
        delta: 'First',
        timestamp: 1001,
      },
    ];
    const fixture = TestBed.createComponent(CliAgentOutputComponent);
    fixture.componentRef.setInput('agentId', 'stream-agent');
    fixture.componentRef.setInput('segments', [
      { type: 'text', content: 'Do not duplicate this' },
    ]);
    fixture.componentRef.setInput('streamEvents', events);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();
    expect(
      fixture.componentInstance.executionNodes().map((node) => node.content),
    ).toEqual(['First']);
    events.push({
      id: 'delta-2',
      eventType: 'text_delta',
      messageId: 'message',
      blockIndex: 0,
      delta: ' second',
      timestamp: 1002,
    });
    fixture.componentRef.setInput('streamRevision', 1);
    fixture.detectChanges();
    expect(
      fixture.componentInstance.executionNodes().map((node) => node.content),
    ).toEqual(['First second']);
  });

  it('renders replacement text when coalescing keeps the segment count unchanged', async () => {
    const fixture = TestBed.createComponent(CliAgentOutputComponent);
    fixture.componentRef.setInput('agentId', 'coalesced');
    fixture.componentRef.setInput('segments', [
      { type: 'text', content: 'First' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('First');
    fixture.componentRef.setInput('segments', [
      { type: 'text', content: 'First second' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('First second');
  });

  it('finalizes orphaned tool nodes only after streaming ends', () => {
    const fixture = TestBed.createComponent(CliAgentOutputComponent);
    fixture.componentRef.setInput('agentId', 'unfinished');
    fixture.componentRef.setInput('segments', [
      { type: 'tool-call', content: '', toolName: 'read_file' },
    ]);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.executionNodes()[0].status).toBe(
      'streaming',
    );
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();
    expect(fixture.componentInstance.executionNodes()[0].status).toBe('error');
  });

  it('shows reported zero values and total-only usage without invented token counts', () => {
    const fixture = renderCard(
      agent({
        segments: [
          {
            type: 'info',
            content: 'Usage: 11867 total tokens',
            usage: { totalTokens: 11867, costUsd: 0, durationMs: 0 },
          },
        ],
      }),
    );
    const text = fixture.nativeElement.querySelector(
      'ptah-cli-agent-output',
    ).textContent;
    expect(text).toContain('Reported total: 11.9k tokens');
    expect(text).toContain('$0.0000');
    expect(text).toContain('0ms');
    expect(text).not.toContain('↑');
    expect(text).not.toContain('↓');
  });
});
