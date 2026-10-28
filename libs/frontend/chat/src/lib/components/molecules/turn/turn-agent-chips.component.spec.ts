import { TestBed } from '@angular/core/testing';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { TurnAgentChipsComponent } from './turn-agent-chips.component';

describe('TurnAgentChipsComponent', () => {
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
});
