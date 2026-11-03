import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import type { SetupGenerationRunLifecycle, SetupGenerationRunState } from '@ptah-extension/shared';
import { AgentGenerationStore, GenerationHandoffStore, GenerationWorkflowStore, WizardRpcService } from '@ptah-extension/setup-wizard';
import { GenerationStepStore } from './generation-step.store';
import { GenerateAgentsPage } from './generate-agents.page';

const binding = { tabId: 'agent-tab', workspacePath: '/ws', workflow: 'setup-agent-generation' as const };
const run = (status: SetupGenerationRunLifecycle): SetupGenerationRunState => ({
  binding: { ...binding, runId: 'agent-run' }, status,
  source: { kind: 'workspace-discovery', reason: 'missing' }, effectiveProvider: 'unknown', effectiveModel: 'unknown',
});

describe('GenerateAgentsPage', () => {
  const state = signal<'idle' | SetupGenerationRunLifecycle>('idle');
  const current = signal<SetupGenerationRunState | null>(null);
  const mismatch = signal(false);
  const exhausted = signal(false);
  const rejection = signal<{ reason: 'blocked' } | null>(null);
  const pending = signal<{ agentTabId: string; workspacePath: string; guidanceStartDeadline: number } | null>(null);
  const started = signal<{ tabId: string; workspacePath: string; workflow: 'setup-project-prompt'; runId: string } | null>(null);
  const openedTab = signal<{ tabId: string; workspacePath: string } | null>(null);
  const checkpoint = signal(null);
  const workflow = { state, run: current, runMismatch: mismatch, lookupExhausted: exhausted, rejection,
    startError: signal(null), isBound: () => false, bind: jest.fn(), refresh: jest.fn(), stop: jest.fn() };
  const handoff = { pending, started, openedTab, outcome: signal('idle'), startNow: jest.fn(), manualContinue: jest.fn(), skip: jest.fn() };
  const agents = { checkpoint, retryingIds: signal(new Set<string>()), discover: jest.fn(), retry: jest.fn(), resume: jest.fn() };
  const step = { bindAgents: jest.fn() };
  const rpc = { getResumableRun: jest.fn() };
  const router = { navigate: jest.fn() };
  const tabs = { activeWorkspacePath: '/ws', findTabByIdAcrossWorkspaces: jest.fn(), getWorkspaceTabs: jest.fn() };
  let fixture: ReturnType<typeof TestBed.createComponent<GenerateAgentsPage>>;

  beforeEach(() => {
    jest.clearAllMocks(); state.set('idle'); current.set(null); mismatch.set(false); exhausted.set(false); pending.set(null); started.set(null); openedTab.set(null);
    checkpoint.set(null); rejection.set(null);
    workflow.refresh.mockResolvedValue(undefined); handoff.startNow.mockResolvedValue(undefined); handoff.manualContinue.mockResolvedValue(undefined);
    agents.discover.mockResolvedValue(undefined); agents.retry.mockResolvedValue(undefined); agents.resume.mockResolvedValue(undefined);
    step.bindAgents.mockReturnValue('bound'); rpc.getResumableRun.mockResolvedValue({ analysis: null, generation: null }); router.navigate.mockResolvedValue(true);
    tabs.findTabByIdAcrossWorkspaces.mockReturnValue({ workspacePath: '/ws', tab: { id: 'agent-tab', workflow: 'setup-agent-generation' } });
    tabs.getWorkspaceTabs.mockReturnValue([{ id: 'agent-tab', workflow: 'setup-agent-generation' }]);
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ tab: 'agent-tab', run: 'agent-run' }), queryParams: { tab: 'agent-tab', run: 'agent-run' } } } },
      { provide: Router, useValue: router }, { provide: TabManagerService, useValue: tabs }, { provide: VSCodeService, useValue: { config: () => ({ workspaceRoot: '/ws' }) } },
      { provide: GenerationWorkflowStore, useValue: workflow }, { provide: GenerationHandoffStore, useValue: handoff },
      { provide: AgentGenerationStore, useValue: agents }, { provide: GenerationStepStore, useValue: step }, { provide: WizardRpcService, useValue: rpc },
    ] });
  });
  afterEach(() => TestBed.resetTestingModule());

  async function render(status: SetupGenerationRunLifecycle | 'idle' = 'idle') {
    state.set(status); current.set(status === 'idle' ? null : run(status));
    fixture = TestBed.createComponent(GenerateAgentsPage);
    fixture.detectChanges();
    if (pending()) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    else await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  it.each(['starting', 'running', 'cancelling', 'cancelled', 'failed', 'timed-out', 'completed', 'idle'] as const)(
    'reload renders the %s lifecycle', async (status) => {
      const element = await render(status);
      expect(step.bindAgents).toHaveBeenCalledWith(binding, 'agent-run');
      expect(workflow.refresh).toHaveBeenCalled();
      expect(element.querySelector('[data-testid="generate-state-chip"]')?.getAttribute('data-state')).toBe(status);
      if (status === 'starting') {
        (element.querySelector('[data-testid="generate-stop-starting"]') as HTMLButtonElement).click();
        expect(workflow.stop).toHaveBeenCalled();
      }
    },
  );
  it('shows a no longer current recovery for a mismatched run', async () => {
    mismatch.set(true); const element = await render('idle');
    expect(element.querySelector('[data-testid="generate-recovery-panel"]')?.textContent).toContain('no longer current');
  });
  it('renders completed cards from fileName and facts from counts', async () => {
    current.set({ ...run('completed'), result: { status: 'completed', success: true, source: run('completed').source,
      effectiveProvider: 'unknown', effectiveModel: 'unknown',
      counts: { total: 1, written: 1, unchanged: 0, failed: 0, skipped: 0, rejected: 0 },
      agentOutcomes: [{ agentId: 'builder', status: 'written', fileName: 'builder.md' }] } });
    state.set('completed');
    fixture = TestBed.createComponent(GenerateAgentsPage); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="generate-agent-file"]')?.textContent).toContain('builder.md');
    expect(element.querySelector('[data-testid="generate-facts"]')?.textContent).toContain('1 written');
  });
  it.each([
    ['failed', 'Generation failed. Retry the run or start over.'],
    ['timed-out', 'The request timed out. Try again.'],
    ['cancelling', 'Stopping this run. Check its status before starting another.'],
    ['cancelled', 'Generation stopped. Resume when you are ready.'],
  ] as const)('shows state-specific copy for %s', async (status, copy) => {
    const element = await render(status);
    expect(element.querySelector('ptah-run-panel')?.textContent).toContain(copy);
    expect(element.querySelector('ptah-run-panel')?.textContent).not.toContain('The run continues in its bound session.');
  });
  it('uses safe failure copy for a failed run and gives owner retry a clear label', async () => {
    current.set({ ...run('failed'), result: { status: 'failed', success: false, source: run('failed').source,
      effectiveProvider: 'unknown', effectiveModel: 'unknown',
      agentOutcomes: [{ agentId: 'builder', status: 'failed', fileName: 'builder.md', error: 'EACCES /private/key' }] } });
    state.set('failed'); rejection.set({ reason: 'blocked' });
    fixture = TestBed.createComponent(GenerateAgentsPage); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ptah-run-panel')?.textContent).toContain('permission denied');
    expect(element.textContent).not.toContain('/private/key');
    expect(element.querySelector('[data-testid="generate-owner-conflict"]')?.textContent).toContain('Check again');
  });
  it('uses safe failure copy and highlights a failed completed agent', async () => {
    current.set({ ...run('completed'), result: { status: 'completed', success: false, source: run('completed').source,
      effectiveProvider: 'unknown', effectiveModel: 'unknown',
      counts: { total: 1, written: 0, unchanged: 0, failed: 1, skipped: 0, rejected: 0 },
      agentOutcomes: [{ agentId: 'builder', status: 'failed', fileName: 'builder.md', error: 'EACCES /private/key' }] } });
    state.set('completed');
    fixture = TestBed.createComponent(GenerateAgentsPage); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ptah-run-panel')?.textContent).toContain('Some agents failed');
    expect(element.querySelector('[data-testid="generate-partial-warning"]')?.textContent).toContain('Needs attention');
    expect(element.querySelector('[data-testid="generate-agent-status"]')?.className).toContain('text-state-err');
    expect(element.textContent).not.toContain('/private/key');
    expect(element.querySelector('ptah-run-panel button')?.textContent).toContain('Continue to guidance');
  });
  it('retries a failed completed agent against its bound run', async () => {
    current.set({ ...run('completed'), result: { status: 'completed', success: false, source: run('completed').source,
      effectiveProvider: 'unknown', effectiveModel: 'unknown',
      agentOutcomes: [{ agentId: 'builder', status: 'failed', fileName: 'builder.md' }] } });
    state.set('completed');
    fixture = TestBed.createComponent(GenerateAgentsPage); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="generate-agent-card"] button')?.click();
    expect(agents.retry).toHaveBeenCalledWith('builder', run('completed').binding);
  });
  it('starts the countdown now and skips guidance on request', async () => {
    pending.set({ agentTabId: 'agent-tab', workspacePath: '/ws', guidanceStartDeadline: Date.now() + 5000 });
    const element = await render('completed');
    expect(element.querySelector('[data-testid="generate-countdown"]')).not.toBeNull();
    (element.querySelector('[data-testid="generate-start-now"]') as HTMLButtonElement).click();
    expect(handoff.startNow).toHaveBeenCalled();
    (element.querySelector('[data-testid="generate-skip"]') as HTMLButtonElement).click();
    expect(handoff.skip).toHaveBeenCalled();
  });
  it('routes a handoff run with the guidance tab and agent tab', async () => {
    await render('completed');
    started.set({ tabId: 'guidance-tab', workspacePath: '/ws', workflow: 'setup-project-prompt', runId: 'guidance-run' });
    fixture.detectChanges(); await fixture.whenStable();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding', 'analyze', 'guidance'], { queryParams: { tab: 'guidance-tab', gen: 'agent-tab', run: 'guidance-run' } });
  });
  it('routes manual recovery to guidance without a run', async () => {
    await render('completed');
    handoff.manualContinue.mockImplementation(async () => { openedTab.set({ tabId: 'guidance-tab', workspacePath: '/ws' }); handoff.outcome.set('manual-recovery'); });
    await (fixture.componentInstance as unknown as { continueGuidance(): Promise<void> }).continueGuidance();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding', 'analyze', 'guidance'], { queryParams: { tab: 'guidance-tab', gen: 'agent-tab' } });
  });
  it('shows an inline alert when manualContinue throws', async () => {
    await render('completed'); handoff.manualContinue.mockRejectedValueOnce(new Error('offline'));
    await (fixture.componentInstance as unknown as { continueGuidance(): Promise<void> }).continueGuidance(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="generate-continue-error"]')?.getAttribute('role')).toBe('alert');
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it('ignores a pre-existing started run from another workspace', async () => {
    await render('completed');
    started.set({ tabId: 'foreign-tab', workspacePath: '/other', workflow: 'setup-project-prompt', runId: 'foreign-run' });
    fixture.detectChanges(); await fixture.whenStable();
    expect(router.navigate).not.toHaveBeenCalled();
    handoff.manualContinue.mockImplementation(async () => { openedTab.set({ tabId: 'guidance-tab', workspacePath: '/ws' }); });
    await (fixture.componentInstance as unknown as { continueGuidance(): Promise<void> }).continueGuidance();
    expect(handoff.manualContinue).toHaveBeenCalledWith('/ws');
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding', 'analyze', 'guidance'], { queryParams: { tab: 'guidance-tab', gen: 'agent-tab' } });
  });
  it('shows lookup exhaustion with Retry calling refresh', async () => {
    exhausted.set(true); const element = await render('idle');
    (element.querySelector('[data-testid="generate-lookup-exhausted"] button') as HTMLButtonElement).click();
    expect(workflow.refresh).toHaveBeenCalledTimes(2);
  });
});
