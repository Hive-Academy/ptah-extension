import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
  fixture.detectChanges();
  return fixture;
}

function outputOf(fixture: { nativeElement: HTMLElement }): HTMLElement {
  const output = fixture.nativeElement.querySelector('ptah-cli-agent-output');
  expect(output).not.toBeNull();
  return output as HTMLElement;
}

function detailsOf(output: HTMLElement): HTMLDetailsElement {
  const details = output.querySelector('details');
  expect(details).not.toBeNull();
  return details as HTMLDetailsElement;
}

describe('raw stdout disclosure', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentCardComponent],
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

  it('opens while raw stdout is the only content the agent has', async () => {
    const fixture = await render(
      makeAgent({
        stdout:
          'Initializing sandbox environment\nTool: read_file {"path":"a.ts"}',
      }),
    );

    const output = outputOf(fixture);
    expect(output.textContent).toContain('Initializing sandbox environment');
    // Asserts presentation, not just DOM presence: <details> keeps its children
    // in the DOM when closed, so a textContent check alone cannot tell the two
    // states apart.
    expect(detailsOf(output).open).toBe(true);
  });

  it('collapses once the first structured content arrives', async () => {
    const agent = makeAgent({ stdout: 'Initializing sandbox environment' });
    const fixture = await render(agent);
    expect(detailsOf(outputOf(fixture)).open).toBe(true);

    fixture.componentRef.setInput('agent', {
      ...agent,
      segments: [{ type: 'text', content: 'I have inspected the repository.' }],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const output = outputOf(fixture);
    expect(detailsOf(output).open).toBe(false);
    // Collapsed, but never lost.
    expect(output.textContent).toContain('Initializing sandbox environment');
  });

  it('never overrides a manual toggle after the one auto-collapse', async () => {
    const agent = makeAgent({ stdout: 'Initializing sandbox environment' });
    const withText: MonitoredAgent = {
      ...agent,
      segments: [{ type: 'text', content: 'first' }],
    };
    const fixture = await render(withText);

    const details = detailsOf(outputOf(fixture));
    expect(details.open).toBe(false);

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    fixture.componentRef.setInput('agent', {
      ...agent,
      segments: [
        { type: 'text', content: 'first' },
        { type: 'text', content: 'second' },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(detailsOf(outputOf(fixture)).open).toBe(true);
  });

  it('keeps a manually opened disclosure open across a card collapse', async () => {
    const agent = makeAgent({
      stdout: 'Initializing sandbox environment',
      segments: [{ type: 'text', content: 'first' }],
    });
    const fixture = await render(agent);

    const details = detailsOf(outputOf(fixture));
    expect(details.open).toBe(false);

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    // Collapsing the card unmounts the output component entirely.
    fixture.componentRef.setInput('agent', { ...agent, expanded: false });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('ptah-cli-agent-output'),
    ).toBeNull();

    fixture.componentRef.setInput('agent', { ...agent, expanded: true });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(detailsOf(outputOf(fixture)).open).toBe(true);
  });

  it('keeps crash error segments visible outside the raw stdout disclosure', async () => {
    // The opencode crash path (opencode-cli.adapter.ts:550) emits an error
    // SEGMENT, which must render in the always-visible tree region rather than
    // only inside the raw stdout block.
    const fixture = await render(
      makeAgent({
        status: 'failed',
        stdout: 'Initializing sandbox environment',
        segments: [
          { type: 'error', content: 'opencode CLI exited with code 1' },
        ],
      }),
    );

    const output = outputOf(fixture);
    const node = output.querySelector('ptah-execution-node');
    expect(detailsOf(output).contains(node)).toBe(false);
    expect(node?.textContent).toContain('opencode CLI exited with code 1');
  });
});
