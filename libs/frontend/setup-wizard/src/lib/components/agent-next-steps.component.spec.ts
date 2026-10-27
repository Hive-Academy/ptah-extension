import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import type {
  GenerationTargetInfo,
  SetupGenerationResultFacts,
  SetupGenerationRunState,
} from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { AgentNextStepsComponent } from './agent-next-steps.component';

const run = signal<SetupGenerationRunState | null>(null);
const openSkillsDivergedClones = jest.fn();
let isElectron = true;

const harnessRoot: GenerationTargetInfo = {
  harnessRoot: '/ws',
  openedFolder: '/ws',
  chosen: 'harness-root',
  openedIsHarnessRoot: true,
};

type Outcome = NonNullable<SetupGenerationResultFacts['agentOutcomes']>[number];

const outcome = (
  agentId: string,
  status: Outcome['status'],
  error?: string,
): Outcome => ({
  agentId,
  fileName: `${agentId}.md`,
  status,
  rejectedSections: 0,
  tailoredSections: 0,
  ...(error ? { error } : {}),
});

const RUN_BASE: Pick<
  SetupGenerationRunState,
  'source' | 'effectiveProvider' | 'effectiveModel'
> = {
  source: { kind: 'workspace-discovery', reason: 'missing' },
  effectiveProvider: 'anthropic',
  effectiveModel: 'sonnet',
};

function setResult(facts: Partial<SetupGenerationResultFacts>): void {
  run.set({
    ...RUN_BASE,
    binding: {
      tabId: 'tab-1',
      workspacePath: '/ws',
      workflow: 'setup-agent-generation',
      runId: 'run-1',
    },
    status: 'completed',
    result: { ...RUN_BASE, status: 'completed', success: true, ...facts },
  });
}

describe('AgentNextStepsComponent', () => {
  beforeEach(() => {
    run.set(null);
    openSkillsDivergedClones.mockReset();
    isElectron = true;
    TestBed.configureTestingModule({
      imports: [AgentNextStepsComponent],
      providers: [
        { provide: GenerationWorkflowStore, useValue: { run } },
        { provide: AppStateManager, useValue: { openSkillsDivergedClones } },
        {
          provide: VSCodeService,
          useValue: {
            get isElectron() {
              return isElectron;
            },
          },
        },
      ],
    });
  });

  it('shows countdown actions only for a pending handoff', () => {
    const fixture = TestBed.createComponent(AgentNextStepsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Continue to project guidance',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Start now');
    fixture.componentRef.setInput('pending', true);
    fixture.componentRef.setInput('remainingSeconds', 5);
    fixture.componentRef.setInput('previewModel', 'sonnet');
    fixture.componentRef.setInput('previewProvider', 'anthropic');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Start now');
    expect(fixture.nativeElement.textContent).toContain('5 seconds');
    expect(fixture.nativeElement.textContent).toContain('Will use: anthropic');
    expect(fixture.nativeElement.textContent).toContain('sonnet');
    const start = jest.fn();
    const skip = jest.fn();
    fixture.componentInstance.startNow.subscribe(start);
    fixture.componentInstance.skip.subscribe(skip);
    const buttons = fixture.nativeElement.querySelectorAll('button');
    buttons[0].click();
    buttons[1].click();
    expect(start).toHaveBeenCalledTimes(1);
    expect(skip).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(5);
  });

  it('turns manual Skip into a visible skipped state', () => {
    const fixture = TestBed.createComponent(AgentNextStepsComponent);
    fixture.componentRef.setInput('manualRecovery', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Skip guidance');
    fixture.componentRef.setInput('skipped', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Project guidance skipped',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Skip guidance');
  });
  it('acknowledges a started handoff without inviting another start', () => {
    const fixture = TestBed.createComponent(AgentNextStepsComponent);
    fixture.componentRef.setInput('started', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Project guidance started',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Continue to project guidance',
    );
  });

  describe('verified outcome summary', () => {
    const mixed: Outcome[] = [
      outcome('tester', 'written'),
      outcome('backend-developer', 'written'),
      outcome('frontend-developer', 'kept'),
      outcome('planner', 'kept'),
      outcome('code-reviewer', 'unchanged'),
      outcome('data-engineer', 'changed-since-preview'),
      outcome('e2e-tester', 'skipped'),
    ];

    /** Renders and waits for the deferred outcome views to load. */
    async function render(): Promise<HTMLElement> {
      const fixture = TestBed.createComponent(AgentNextStepsComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    function counter(root: HTMLElement, status: string): string | null {
      return (
        root
          .querySelector(`[data-outcome="${status}"] b`)
          ?.textContent?.trim() ?? null
      );
    }

    it('shows counters that equal the per-file rows, failed hidden at 0', async () => {
      setResult({
        agentOutcomes: mixed,
        target: harnessRoot,
        libraryPass: 'updated',
        libraryDiverged: ['backend-developer'],
      });
      const root = await render();
      expect(counter(root, 'written')).toBe('2');
      expect(counter(root, 'kept')).toBe('2');
      expect(counter(root, 'unchanged')).toBe('1');
      expect(counter(root, 'changed-since-preview')).toBe('1');
      expect(root.querySelector('[data-outcome="failed"]')).toBeNull();
      expect(root.querySelectorAll('li[data-status]')).toHaveLength(6);
      expect(root.textContent).toContain('About grades.');
      expect(
        root.querySelector('[data-testid="outcome-diverged"]')?.textContent,
      ).toContain('backend-developer');
    });

    it('counts a rejected agent as failed and shows its reason', async () => {
      setResult({
        agentOutcomes: [
          outcome('tester', 'rejected', 'permission denied'),
          outcome('planner', 'written'),
        ],
        target: harnessRoot,
        libraryPass: 'updated',
      });
      const root = await render();
      expect(counter(root, 'failed')).toBe('1');
      expect(
        root.querySelector('[data-testid="outcome-failure"]')?.textContent,
      ).toContain('permission denied');
    });

    it('shows the all-kept statement without the grade callout', async () => {
      setResult({
        agentOutcomes: [
          outcome('planner', 'kept'),
          outcome('code-reviewer', 'unchanged'),
        ],
        target: harnessRoot,
        libraryPass: 'not-applicable',
      });
      const root = await render();
      expect(root.textContent).toContain('Nothing new was written');
      expect(root.textContent).toContain('All 2 agents were kept');
      expect(root.textContent).not.toContain('About grades.');
    });

    it('shows the stale-Library notice only when the Library pass failed', async () => {
      setResult({
        agentOutcomes: [outcome('tester', 'written')],
        target: harnessRoot,
        libraryPass: 'failed',
      });
      expect(
        (await render()).querySelector('[data-testid="library-stale-notice"]'),
      ).not.toBeNull();
      setResult({
        agentOutcomes: [outcome('tester', 'written')],
        target: harnessRoot,
        libraryPass: 'updated',
      });
      expect(
        (await render()).querySelector('[data-testid="library-stale-notice"]'),
      ).toBeNull();
    });

    it('hides grade and Library copy in VS Code', async () => {
      isElectron = false;
      setResult({
        agentOutcomes: [outcome('tester', 'written')],
        target: harnessRoot,
        libraryPass: 'failed',
        libraryDiverged: ['tester'],
      });
      const root = await render();
      expect(counter(root, 'written')).toBe('1');
      expect(root.textContent).not.toContain('About grades.');
      expect(
        root.querySelector('[data-testid="library-stale-notice"]'),
      ).toBeNull();
      expect(root.querySelector('[data-testid="outcome-diverged"]')).toBeNull();
    });

    it('opens the Library diverged filter from the diverged callout', async () => {
      setResult({
        agentOutcomes: [outcome('tester', 'written')],
        target: harnessRoot,
        libraryPass: 'updated',
        libraryDiverged: ['tester'],
      });
      const root = await render();
      root
        .querySelector<HTMLButtonElement>(
          '[data-testid="outcome-diverged"] button',
        )
        ?.click();
      expect(openSkillsDivergedClones).toHaveBeenCalledTimes(1);
    });

    it('renders no summary before the run reports outcomes', async () => {
      const root = await render();
      expect(root.querySelector('ptah-outcome-summary')).toBeNull();
    });
  });
});
