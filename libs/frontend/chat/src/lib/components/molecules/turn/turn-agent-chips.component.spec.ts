import { TestBed } from '@angular/core/testing';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { TurnAgentChipsComponent } from './turn-agent-chips.component';

describe('TurnAgentChipsComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows status without a frozen duration for a running CLI lane', () => {
    const agent: SessionAgent = {
      key: 'cli:agent-1',
      kind: 'cli',
      name: 'Codex',
      cliId: 'codex',
      agentType: null,
      status: 'running',
      startedAt: 1_000,
      endedAt: 61_000,
      activity: null,
      openRequestIds: [],
    };
    TestBed.configureTestingModule({ imports: [TurnAgentChipsComponent] });
    const fixture = TestBed.createComponent(TurnAgentChipsComponent);
    fixture.componentRef.setInput('agents', [agent]);
    fixture.detectChanges();

    const chip = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-test="turn-agent-chip"]',
    );
    expect(chip?.textContent).toContain('running');
    expect(chip?.textContent).not.toContain('1m');
    expect(chip?.textContent).not.toContain('·');
    expect(chip?.getAttribute('aria-label')).toContain('running');
    expect(chip?.getAttribute('aria-label')).not.toContain('1m');
  });

  it('renders a lane the host cannot open as a status-only chip', () => {
    const agent: SessionAgent = {
      key: 'cli:agent-1', kind: 'cli', name: 'Codex', cliId: 'codex', agentType: null,
      status: 'done', startedAt: 1_000, endedAt: 61_000, activity: null, openRequestIds: [],
    };
    const openLane = jest.fn();
    TestBed.configureTestingModule({
      imports: [TurnAgentChipsComponent],
      providers: [{ provide: SESSION_CARD_ACTIONS, useValue: {
        openLane, openSession: jest.fn(), canOpenLane: (key: string) => !key.startsWith('cli:'),
      } }],
    });
    const fixture = TestBed.createComponent(TurnAgentChipsComponent);
    const requested = jest.fn();
    fixture.componentInstance.laneRequested.subscribe(requested);
    fixture.componentRef.setInput('agents', [agent]);
    fixture.detectChanges();

    const chip = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-test="turn-agent-chip"]',
    )!;
    expect(chip.disabled).toBe(true);
    expect(chip.getAttribute('aria-label')).not.toContain('Open lane');
    chip.click();
    expect(requested).not.toHaveBeenCalled();
  });
});
