import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import {
  AgentDeliveryStore,
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import {
  ClaudeRpcService,
  FILE_LINK_OPENER,
  ModelStateService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  createMockRpcService,
  provideSurfaceActiveTesting,
} from '@ptah-extension/core/testing';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';
import { AgentCardComponent } from './agent-card.component';

function lane(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'lane-1',
    cli: 'codex',
    task: 'Inspect files',
    status: 'completed',
    startedAt: 1000,
    completedAt: 3000,
    stdout: '',
    stderr: '',
    expanded: true,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    cliSessionId: 'cli-123',
    parentSessionId: 'parent-456',
    model: 'gpt-5',
    usageTotals: { inputTokens: 1200, outputTokens: 80, contextTokens: 2000 },
    ...overrides,
  };
}

describe('AgentCardComponent flat execution header', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentCardComponent],
      providers: [
        provideSurfaceActiveTesting(),
        provideMarkdown(),
        { provide: AgentDeliveryStore, useValue: { receipts: signal(new Map()), recovered: signal(new Map()), takeRecovered: () => null,
          composerState: () => ({ queue: { mode: 'queue-next-turn' }, now: { mode: 'steer' } }), previewMessage: jest.fn().mockResolvedValue(undefined),
          receiptLabel: () => 'Queued', receiptStatus: () => ({ label: 'Queued' }), newIdempotencyKey: () => 'key' } },
        {
          provide: AgentMonitorStore,
          useValue: { tick: signal(0), agentsById: signal(new Map()), receipts: signal(new Map()), composerState: () => ({ queue: { mode: 'queue-next-turn' }, now: { mode: 'steer' } }), previewMessage: jest.fn().mockResolvedValue(undefined), receiptLabel: jest.fn() },
        },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
        {
          provide: VSCodeService,
          useValue: { config: signal({ panelId: '' }), postMessage: jest.fn() },
        },
        {
          provide: ModelStateService,
          useValue: { availableModels: signal([]) },
        },
      ],
    });
  });

  it('renders no execution header in flat mode', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane({ status: 'running' }));
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('ptah-execution-header')).toBeNull();
    expect(root.querySelector('ptah-agent-card-header')).toBeNull();
    expect(root.querySelector('[aria-label^="Stop"]')).toBeNull();
  });

  it('keeps card mode header and its actions', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane({ status: 'running' }));
    fixture.componentRef.setInput('presentation', 'card');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('ptah-agent-card-header')).not.toBeNull();
    expect(root.querySelector('[aria-label^="Stop"]')).not.toBeNull();
  });
});
