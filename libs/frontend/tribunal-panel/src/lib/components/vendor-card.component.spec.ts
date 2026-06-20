import {
  ChangeDetectionStrategy,
  Component,
  Input,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  AgentMonitorTreeBuilderService,
  AgentContinueInputComponent,
  ExecutionNodeComponent,
} from '@ptah-extension/chat';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { VSCodeService } from '@ptah-extension/core';
import { TribunalStateService } from '../services/tribunal-state.service';
import { VendorCardComponent } from './vendor-card.component';
import type { VendorLane } from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-markdown-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="markdown-stub">{{ content }}</div>`,
})
class MarkdownBlockStubComponent {
  @Input() content!: string;
}

@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="execution-node-stub"></div>`,
})
class ExecutionNodeStubComponent {
  @Input() node!: unknown;
  @Input() isStreaming = false;
}

@Component({
  selector: 'ptah-agent-continue-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="agent-continue-stub"></div>`,
})
class AgentContinueStubComponent {
  @Input() agent!: unknown;
}

@Component({
  standalone: true,
  imports: [VendorCardComponent],
  template: `<ptah-vendor-card
    [lane]="lane"
    [tribunalSessionId]="sessionId"
  />`,
})
class TestHostComponent {
  lane!: VendorLane;
  sessionId = '';
}

function makeLane(overrides: Partial<VendorLane> = {}): VendorLane {
  return {
    laneId: 'lane-1',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    model: 'gpt-4o',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'agent-1',
    cli: 'codex',
    task: '',
    status: 'running',
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    expanded: false,
    segments: [],
    streamEvents: [],
    permissionQueue: [],
    displayName: 'Codex',
    model: 'gpt-4o',
    ...overrides,
  };
}

describe('VendorCardComponent', () => {
  let laneBindingsSig: ReturnType<
    typeof signal<ReadonlyMap<string, MonitoredAgent | null>>
  >;

  function configure() {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        {
          provide: TribunalStateService,
          useValue: { laneBindings: () => laneBindingsSig() },
        },
        {
          provide: AgentMonitorStore,
          useValue: {
            tick: jest.fn(),
            agentsForSession: jest.fn().mockReturnValue([]),
            clearPermission: jest.fn(),
          },
        },
        {
          provide: AgentMonitorTreeBuilderService,
          useValue: {
            buildTree: jest.fn().mockReturnValue([]),
            finalizeOrphanedTools: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: jest.fn().mockReturnValue([]) },
        },
        { provide: VSCodeService, useValue: { postMessage: jest.fn() } },
      ],
    });

    TestBed.overrideComponent(VendorCardComponent, {
      remove: {
        imports: [
          MarkdownBlockComponent,
          ExecutionNodeComponent,
          AgentContinueInputComponent,
        ],
      },
      add: {
        imports: [
          MarkdownBlockStubComponent,
          ExecutionNodeStubComponent,
          AgentContinueStubComponent,
        ],
      },
    });
  }

  beforeEach(() => {
    laneBindingsSig = signal(new Map());
  });

  it('renders the Awaiting placeholder when the lane is unbound', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();
    fixture.componentInstance.sessionId = 'session-1';
    laneBindingsSig.set(new Map([['lane-1', null]]));

    expect(() => fixture.detectChanges()).not.toThrow();

    const card = fixture.debugElement.query(
      By.css('[data-testid="tribunal-vendor-card"]'),
    );
    expect(card.nativeElement.textContent).toContain('Awaiting');
  });

  it('renders Idle status when no session id is set', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();
    fixture.componentInstance.sessionId = '';

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.nativeElement.textContent).toContain('Idle');
  });

  it('reads the bound agent from laneBindings and reflects running status', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();
    fixture.componentInstance.sessionId = 'session-1';
    laneBindingsSig.set(
      new Map([['lane-1', makeAgent({ status: 'running' })]]),
    );

    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Running');
    expect(
      fixture.debugElement.query(By.css('[data-testid="agent-continue-stub"]')),
    ).toBeNull();
  });

  it('disables steer for a non-ptah-cli (codex) bound agent', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane({ cli: 'codex' });
    fixture.componentInstance.sessionId = 'session-1';
    laneBindingsSig.set(
      new Map([
        ['lane-1', makeAgent({ cli: 'codex', supportsContinuation: true })],
      ]),
    );

    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('[data-testid="agent-continue-stub"]')),
    ).toBeNull();
    const steerBtn = fixture.debugElement.query(By.css('button[disabled]'));
    expect(steerBtn).toBeTruthy();
  });

  it('enables steer for a ptah-cli agent that supports continuation', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane({
      cli: 'ptah-cli',
      displayName: 'Moonshot',
      model: 'kimi',
    });
    fixture.componentInstance.sessionId = 'session-1';
    laneBindingsSig.set(
      new Map([
        [
          'lane-1',
          makeAgent({
            cli: 'ptah-cli',
            displayName: 'Moonshot',
            model: 'kimi',
            supportsContinuation: true,
          }),
        ],
      ]),
    );

    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('[data-testid="agent-continue-stub"]')),
    ).toBeTruthy();
  });

  it('disables steer for a ptah-cli agent that does not support continuation', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane({
      cli: 'ptah-cli',
      displayName: 'Moonshot',
      model: 'kimi',
    });
    fixture.componentInstance.sessionId = 'session-1';
    laneBindingsSig.set(
      new Map([
        [
          'lane-1',
          makeAgent({
            cli: 'ptah-cli',
            displayName: 'Moonshot',
            model: 'kimi',
            supportsContinuation: false,
          }),
        ],
      ]),
    );

    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('[data-testid="agent-continue-stub"]')),
    ).toBeNull();
  });
});
