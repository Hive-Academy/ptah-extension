import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ModelStateService } from '@ptah-extension/core';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { InspectorAgentsSectionComponent } from './inspector-agents-section.component';
import { agentRunLabel, formatAgentDuration } from '@ptah-extension/chat-ui';

function agent(usageTotals?: SessionAgent['usageTotals']): SessionAgent {
  return {
    key: 'cli:lane-1', kind: 'cli', name: 'Codex', cliId: 'codex',
    agentType: null, status: 'done', startedAt: 1000, endedAt: 6000,
    activity: 'Reading files', openRequestIds: [], usageTotals,
  };
}

describe('inspector CLI usage badges', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InspectorAgentsSectionComponent],
      providers: [
        { provide: SessionAgentTrayService, useValue: {
          contextsFor: () => new Map(), extrasFor: () => new Map(),
        } },
        { provide: ModelStateService, useValue: { availableModels: signal([]) } },
      ],
    });
  });

  function render(row: SessionAgent): HTMLElement {
    const fixture = TestBed.createComponent(InspectorAgentsSectionComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('agents', {
      status: 'ready', data: { rows: [{ agent: row, requests: [] }], active: 0, finished: 1 },
    });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders known token, cost, and duration badges', () => {
    const el = render(agent({ inputTokens: 1200, outputTokens: 300, costUsd: 0.25 }));
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain('1.5k tokens');
    expect(el.querySelector('[title="Reported or estimated cost"]')?.textContent).toContain('~$0.25 est.');
    expect(el.querySelector('ptah-cost-badge')).toBeNull();
    expect(el.querySelector('[title="Elapsed duration"]')?.textContent).toContain('5s');
    expect(el.textContent).toContain('CLI lane');
  });

  it('uses reported total tokens when only the total is available', () => {
    const el = render(agent({ totalTokens: 2400 }));
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain('2.4k tokens');
  });

  it('sums input and output tokens when a total is unavailable', () => {
    const el = render(agent({ inputTokens: 1200, outputTokens: 300 }));
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain('1.5k tokens');
  });

  it('omits the token badge when only input tokens are available', () => {
    const el = render(agent({ inputTokens: 1200 }));
    expect(el.querySelector('ptah-token-badge')).toBeNull();
  });

  it('omits a zero token total', () => {
    const el = render(agent({ totalTokens: 0, inputTokens: 1200, outputTokens: 300 }));
    expect(el.querySelector('ptah-token-badge')).toBeNull();
  });

  it('omits token and cost badges when usage is absent', () => {
    const el = render(agent());
    expect(el.querySelector('ptah-token-badge')).toBeNull();
    expect(el.querySelector('[title="Reported or estimated cost"]')).toBeNull();
  });

  it('omits partial badges when totals are null and no usage segments exist', () => {
    const el = render({ ...agent(null), segments: [] });
    expect(el.querySelector('ptah-token-badge')).toBeNull();
    expect(el.querySelector('[title="Reported or estimated cost"]')).toBeNull();
    expect(el.querySelector('[title="From retained output, may be partial"]')).toBeNull();
    expect(el.textContent).not.toContain('≥');
  });

  it('uses segment usage and the lane duration text for a restored CLI lane', () => {
    const row = { ...agent(null), startedAt: 0, endedAt: (67 * 60 + 14) * 60_000,
      segments: [{ type: 'info' as const, content: '', usage: { inputTokens: 11_900, outputTokens: 56, costUsd: 0.15 } }],
    };
    const el = render(row);
    expect(el.querySelector('[title="From retained output, may be partial"]')?.textContent).toContain('≥ 12.0k tokens');
    expect(el.querySelector('[title="From retained output, may be partial"]')?.getAttribute('aria-label')).toBe('at least 12.0k tokens');
    expect(Array.from(el.querySelectorAll('[title="From retained output, may be partial"]')).some((badge) => badge.textContent?.includes('≥ ~$0.15 est.'))).toBe(true);
    expect(el.querySelector('[title="Elapsed duration"]')?.textContent).toContain('67h 14m');
    expect(el.querySelector('[data-agent-key]')?.getAttribute('aria-label')).toContain('67h 14m');
  });

  it('keeps structured totals unmarked and formats CLI duration like the lane', () => {
    const row = { ...agent({ totalTokens: 65, costUsd: 0.01 }), startedAt: 0, endedAt: 65_000 };
    const el = render(row);
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain('65 tokens');
    expect(el.querySelector('[title="Reported or estimated cost"]')?.textContent).toContain('~$0.01 est.');
    expect(el.textContent).not.toContain('≥');
    expect(el.querySelector('[title="Elapsed duration"]')?.textContent).toContain(formatAgentDuration(65_000));
    expect(el.querySelector('[data-agent-key]')?.getAttribute('aria-label')).toContain(formatAgentDuration(65_000));
  });

  it('restored CLI lane without end time shows Worked, not lane age', () => {
    const el = render({ ...agent(), startedAt: 1_000, endedAt: null });
    expect(el.querySelector('[title="Elapsed duration"]')).toBeNull();
    expect(agentRunLabel({ running: false, startedAt: 1_000 }, 1_000_000)).toBe('Worked');
    expect(el.querySelector('[data-agent-key]')?.getAttribute('aria-label')).not.toContain('999s');
  });
});
