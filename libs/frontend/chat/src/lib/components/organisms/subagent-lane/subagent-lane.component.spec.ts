import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AgentMonitorStore, type SubagentRecord, type SubagentRpcError } from '@ptah-extension/chat-streaming';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import { SubagentUsageSummaryComponent } from '../../molecules/agent-card/subagent-usage-summary.component';
import { SubagentLaneComponent } from './subagent-lane.component';

describe('SubagentLaneComponent', () => {
  const contexts = signal<ReadonlyMap<string, TrayAgentContext>>(new Map());
  const rpcError = signal<SubagentRpcError | null>(null);
  const tick = signal(0);
  const steer = jest.fn<Promise<boolean>, [TrayAgentContext, string]>();
  const stop = jest.fn();
  const sendToBackground = jest.fn();
  const base: SubagentRecord = {
    parentToolUseId: 'tool-1', parentSessionId: 'session-123456',
    teammateName: 'Explore', status: 'running', startedAt: 1000,
    description: 'Inspect files', toolUses: 4,
  };

  function context(flags: { canBackground?: boolean; stoppable?: boolean; steerable?: boolean } = {}): TrayAgentContext {
    return {
      entry: {
        id: 'tool-1', name: 'Explore', origin: 'foreground', status: 'running',
        canBackground: flags.canBackground ?? false,
        stoppable: flags.stoppable ?? false,
        steerable: flags.steerable ?? false,
        canViewTranscript: false,
      },
      taskId: 'task-1', sessionId: 'session-123456', model: null,
    };
  }

  function setup(record: SubagentRecord = base): ComponentFixture<SubagentLaneComponent> {
    const fixture = TestBed.createComponent(SubagentLaneComponent);
    fixture.componentRef.setInput('record', record);
    fixture.componentRef.setInput('sessionId', 'session-123456');
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    contexts.set(new Map());
    rpcError.set(null);
    steer.mockReset();
    stop.mockClear();
    sendToBackground.mockClear();
    TestBed.configureTestingModule({
      imports: [SubagentLaneComponent],
      providers: [
        { provide: AgentMonitorStore, useValue: { tick, subagentRpcError: rpcError, loadSubagentCacheInfo: jest.fn().mockResolvedValue(undefined) } },
        { provide: SessionAgentTrayService, useValue: { contextsFor: () => contexts(), steer, stop, sendToBackground } },
      ],
    });
    TestBed.overrideComponent(SubagentUsageSummaryComponent, {
      set: { template: '<span>Usage summary</span>' },
    });
  });

  it('uses the shared header, fallback counts, and details facts', () => {
    const fixture = setup({ ...base, totalTokens: 1200, usage: { input: 1000, output: 200, model: 'claude-sonnet' } });
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLButtonElement>('[data-test="turn-disclosure-row"]')!;
    expect(row.getAttribute('aria-label')).toContain('4 tools');
    expect(row.getAttribute('aria-label')).toContain('1.2k tokens');
    expect(root.querySelector('ptah-execution-header')?.getAttribute('data-kind')).toBe('subagent');
    expect(root.textContent).toContain('Starting agent');
    expect(root.querySelector('ptah-subagent-usage-summary')).toBeNull();
    row.click();
    fixture.detectChanges();
    const details = root.querySelector('#subagent-lane-details-tool-1')!;
    expect(details.textContent).toContain('Usage summary');
    expect(details.textContent).toContain('Model: claude-sonnet');
    expect(details.textContent).toContain('Task: Inspect files');
    expect(details.textContent).toContain('Parent: session-');
  });

  it('offers only the actions allowed by the tray context', () => {
    const ctx = context({ canBackground: true, stoppable: true, steerable: true });
    contexts.set(new Map([['tool-1', ctx]]));
    const fixture = setup();
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector<HTMLButtonElement>('[aria-label="Send Explore to background"]')!.click();
    root.querySelector<HTMLButtonElement>('[aria-label="Stop Explore"]')!.click();
    root.querySelector<HTMLButtonElement>('[aria-label="Message Explore"]')!.click();
    fixture.detectChanges();
    expect(sendToBackground).toHaveBeenCalledWith(ctx);
    expect(stop).toHaveBeenCalledWith(ctx);
    expect(root.querySelector('ptah-agent-steer-input')).not.toBeNull();
    contexts.set(new Map([['tool-1', context({ steerable: true })]]));
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Stop Explore"]')).toBeNull();
    expect(root.querySelector('[aria-label="Send Explore to background"]')).toBeNull();
  });

  it('shows no actions without tray context and no output when finished', () => {
    const fixture = setup({ ...base, status: 'completed', totalTokens: 0 });
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[executionHeaderActions]')).toBeNull();
    expect(root.querySelector('[data-test="turn-disclosure-row"]')?.getAttribute('aria-label')).not.toContain('tokens');
    expect(root.textContent).toContain('No output recorded');
  });

  it('shows background state and the latest progress in a live row', () => {
    const fixture = setup({ ...base, status: 'background', latestSummary: 'Reviewing tests' });
    const row = fixture.nativeElement.querySelector('[data-test="turn-disclosure-row"]') as HTMLButtonElement;
    const label = row.getAttribute('aria-label') as string;
    expect(label).toContain('Background');
    expect(row.querySelector('[data-test="turn-disclosure-peek"]')?.textContent).toBe('Reviewing tests');
    expect(label).not.toContain('Reviewing tests');
  });

  it('keeps the draft after a failed steer and closes it after success', async () => {
    contexts.set(new Map([['tool-1', context({ steerable: true })]]));
    steer.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const fixture = setup();
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector<HTMLButtonElement>('[aria-label="Message Explore"]')!.click();
    fixture.detectChanges();
    const field = root.querySelector<HTMLInputElement>('ptah-agent-steer-input input')!;
    field.value = 'Check tests';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('[aria-label="Send steer message"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(steer).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1' }), 'Check tests');
    expect(root.textContent).toContain('Could not send your message');
    expect(root.querySelector<HTMLInputElement>('ptah-agent-steer-input input')?.value).toBe('Check tests');
    root.querySelector<HTMLButtonElement>('[aria-label="Send steer message"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('ptah-agent-steer-input')).toBeNull();
  });

  it('shows only this agent’s RPC error', () => {
    const fixture = setup();
    rpcError.set({ parentToolUseId: 'other', method: 'subagent:stop', message: 'Other failed', timestamp: 1 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="subagent-command-error"]')).toBeNull();
    rpcError.set({ parentToolUseId: 'tool-1', method: 'subagent:stop', message: 'Stop failed', timestamp: 2 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="subagent-command-error"]')?.textContent).toContain('Stop failed');
  });
});
