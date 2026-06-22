import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { AgentMonitorPanelComponent } from '@ptah-extension/chat';
import { TribunalStateService } from '../services/tribunal-state.service';
import { VendorCardComponent } from './vendor-card.component';
import type { VendorLane } from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-agent-monitor-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="agent-monitor-stub">
    {{ embeddedAgents()?.length ?? 0 }}
  </div>`,
})
class AgentMonitorPanelStubComponent {
  readonly embeddedAgents = input<MonitoredAgent[] | undefined>(undefined);
  readonly embeddedOpen = input<boolean | undefined>(undefined);
  readonly sessionId = input<string | null>(null);
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
    streamRevision: 0,
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
      ],
    });

    TestBed.overrideComponent(VendorCardComponent, {
      remove: { imports: [AgentMonitorPanelComponent] },
      add: { imports: [AgentMonitorPanelStubComponent] },
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
    expect(
      fixture.debugElement.query(By.css('[data-testid="agent-monitor-stub"]')),
    ).toBeNull();
  });

  it('renders the Awaiting placeholder when no session id is set', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();
    fixture.componentInstance.sessionId = '';

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(
      fixture.debugElement.query(By.css('[data-testid="agent-monitor-stub"]')),
    ).toBeNull();
  });

  it('renders the embedded agent-monitor panel with the bound agent', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();
    fixture.componentInstance.sessionId = 'session-1';
    laneBindingsSig.set(
      new Map([['lane-1', makeAgent({ status: 'running' })]]),
    );

    fixture.detectChanges();

    const panel = fixture.debugElement.query(
      By.css('[data-testid="agent-monitor-stub"]'),
    );
    expect(panel).toBeTruthy();
    expect(panel.nativeElement.textContent.trim()).toBe('1');
  });
});
