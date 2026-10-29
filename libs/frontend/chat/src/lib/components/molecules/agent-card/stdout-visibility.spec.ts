import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import {
  ClaudeRpcService,
  FILE_LINK_OPENER,
  LoggingService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  createMockRpcService,
  provideSurfaceActiveTesting,
} from '@ptah-extension/core/testing';
import { AgentCardComponent } from './agent-card.component';
import { ChatStore } from '../../../services/chat.store';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';

function makeAgent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'stdout-only-agent',
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

async function render(agent: MonitoredAgent) {
  const fixture = TestBed.createComponent(AgentCardComponent);
  fixture.componentRef.setInput('agent', agent);
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  return fixture;
}

function outputOf(fixture: { nativeElement: HTMLElement }): HTMLElement {
  const output = fixture.nativeElement.querySelector('ptah-cli-agent-output');
  expect(output).not.toBeNull();
  return output as HTMLElement;
}

describe('raw stdout fallback', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentCardComponent],
      providers: [
        {
          provide: ChatStore,
          useValue: {
            getPermissionForTool: () => null,
            handlePermissionResponse: jest.fn(),
          },
        },
        provideSurfaceActiveTesting(),
        provideMarkdown(),
        {
          provide: LoggingService,
          useValue: {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          } satisfies Pick<LoggingService, 'debug' | 'info' | 'warn' | 'error'>,
        },
        {
          provide: AgentMonitorStore,
          useValue: { tick: signal(0), agentsById: signal(new Map()) },
        },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
        {
          provide: VSCodeService,
          useValue: { config: signal({ panelId: '' }), postMessage: jest.fn() },
        },
      ],
    });
  });

  it('shows raw stdout without a disclosure while it is the only content', async () => {
    const fixture = await render(
      makeAgent({
        stdout:
          'Initializing sandbox environment\nTool: read_file {"path":"a.ts"}',
      }),
    );

    const output = outputOf(fixture);
    expect(output.textContent).toContain('Initializing sandbox environment');
    expect(output.querySelector('details')).toBeNull();
    expect(output.textContent).not.toContain('Raw stdout');
  });

  it('drops raw stdout once the first structured content arrives', async () => {
    const agent = makeAgent({ stdout: 'Initializing sandbox environment' });
    const fixture = await render(agent);
    expect(outputOf(fixture).textContent).toContain(
      'Initializing sandbox environment',
    );

    fixture.componentRef.setInput('agent', {
      ...agent,
      segments: [{ type: 'text', content: 'I have inspected the repository.' }],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const output = outputOf(fixture);
    expect(output.textContent).not.toContain(
      'Initializing sandbox environment',
    );
    expect(output.textContent).toContain('I have inspected the repository.');
  });

  it('keeps crash error segments visible in the tree', async () => {
    // The opencode crash path (opencode-cli.adapter.ts:550) emits an error
    // SEGMENT, which must render in the always-visible tree region.
    const fixture = await render(
      makeAgent({
        status: 'failed',
        stdout: 'Initializing sandbox environment',
        segments: [
          { type: 'error', content: 'opencode CLI exited with code 1' },
        ],
      }),
    );

    const node = outputOf(fixture).querySelector('ptah-execution-node');
    expect(node?.textContent).toContain('opencode CLI exited with code 1');
  });

  const streamEvents: FlatStreamEventUnion[] = [
    {
      id: 'start',
      eventType: 'message_start',
      messageId: 'message',
      role: 'assistant',
      timestamp: 1000,
    },
    {
      id: 'delta',
      eventType: 'text_delta',
      messageId: 'message',
      blockIndex: 0,
      delta: 'Structured answer',
      timestamp: 1001,
    },
  ];

  it('keeps a terminal error segment visible after stream events', async () => {
    const fixture = await render(makeAgent({
      status: 'failed',
      stdout: 'Initializing sandbox environment',
      streamEvents,
      segments: [
        { type: 'text', content: 'Structured answer' },
        { type: 'error', content: 'CLI exited with code 1' },
      ],
    }));

    const output = outputOf(fixture);
    expect(output.textContent).toContain('CLI exited with code 1');
    expect(output.textContent).not.toContain('Initializing sandbox environment');
  });

  it('keeps a peer message visible after stream events', async () => {
    const fixture = await render(makeAgent({
      stdout: 'Initializing sandbox environment',
      streamEvents,
      segments: [
        { type: 'text', content: 'Structured answer' },
        { type: 'info', content: 'Message from unverified peer "reviewer": Please check this.' },
      ],
    }));

    const output = outputOf(fixture);
    expect(output.textContent).toContain('Message from unverified peer');
    expect(output.textContent).toContain('Please check this.');
    expect(output.textContent).not.toContain('Initializing sandbox environment');
  });

  it('keeps assistant text from segments when the stream events carry no text deltas', async () => {
    const fixture = await render(makeAgent({
      status: 'failed',
      stdout: 'Initializing sandbox environment',
      streamEvents: [streamEvents[0]],
      segments: [
        { type: 'text', content: 'Answer without deltas' },
        { type: 'error', content: 'CLI exited with code 1' },
      ],
    }));

    const output = outputOf(fixture);
    expect(output.textContent).toContain('Answer without deltas');
    expect(output.textContent).toContain('CLI exited with code 1');
  });
});
