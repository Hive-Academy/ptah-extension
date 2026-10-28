import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  MESSAGE_TYPES,
  type GenerationAgentOutcome,
} from '@ptah-extension/shared';
import { CompletionComponent } from './completion.component';
import {
  SetupWizardStateService,
  CompletionData,
  EnhancedPromptsWizardStatus,
  SkillGenerationProgressItem,
} from '../services/setup-wizard-state.service';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';

const outcome = (
  overrides: Partial<GenerationAgentOutcome> = {},
): GenerationAgentOutcome => ({
  agentId: 'frontend-developer',
  filePath: '/ws/.claude/agents/frontend-developer.md',
  status: 'written',
  rejectedSections: 0,
  tailoredSections: 0,
  ...overrides,
});

const completion = (
  overrides: Partial<CompletionData> = {},
): CompletionData => ({
  success: true,
  outputDirectory: '/ws/.claude/agents',
  writtenCount: 1,
  unchangedCount: 0,
  failedCount: 0,
  rejectedSections: 0,
  tailoredSections: 0,
  agents: [outcome()],
  ...overrides,
});

describe('CompletionComponent', () => {
  let component: CompletionComponent;
  let fixture: ComponentFixture<CompletionComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockVSCodeService: { postMessage: jest.Mock; isElectron: boolean };
  let openSkillsDivergedClones: jest.Mock;
  let skillGenerationProgress: ReturnType<
    typeof signal<SkillGenerationProgressItem[]>
  >;
  let enhancedPromptsStatus: ReturnType<
    typeof signal<EnhancedPromptsWizardStatus>
  >;
  let completionData: ReturnType<typeof signal<CompletionData | null>>;

  beforeEach(async () => {
    skillGenerationProgress = signal<SkillGenerationProgressItem[]>([]);
    enhancedPromptsStatus = signal<EnhancedPromptsWizardStatus>('idle');
    completionData = signal<CompletionData | null>(null);

    mockStateService = {
      skillGenerationProgress: skillGenerationProgress.asReadonly(),
      enhancedPromptsStatus: enhancedPromptsStatus.asReadonly(),
      completionData: completionData.asReadonly(),
    } as unknown as Partial<SetupWizardStateService>;

    mockVSCodeService = {
      postMessage: jest.fn(),
      isElectron: true,
    };
    openSkillsDivergedClones = jest.fn();

    await TestBed.configureTestingModule({
      imports: [CompletionComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: VSCodeService, useValue: mockVSCodeService },
        {
          provide: AppStateManager,
          useValue: { openSkillsDivergedClones },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompletionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** Runs change detection and waits for the deferred outcome views. */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Success header', () => {
    it('should display success heading', () => {
      const heading = fixture.nativeElement.querySelector('h1');
      expect(heading.textContent).toContain('Setup Complete!');
    });

    it('should display success icon container', () => {
      const iconBg = fixture.nativeElement.querySelector('.bg-success\\/20');
      expect(iconBg).toBeTruthy();
    });

    it('should display success message', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Your personalized agents have been generated');
    });
  });

  describe('Generated agents', () => {
    it('should show zero agent count when no items completed', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('(0)');
    });

    it('counts only agents verified by the completion payload', async () => {
      skillGenerationProgress.set([
        {
          id: '1',
          name: 'frontend-developer.md',
          type: 'agent',
          status: 'complete',
        },
        {
          id: '2',
          name: 'backend-developer.md',
          type: 'agent',
          status: 'pending',
        },
        {
          id: '3',
          name: 'enhanced-prompt-1',
          type: 'enhanced-prompt',
          status: 'complete',
        },
      ]);
      completionData.set(completion({ agents: [outcome()] }));
      await settle();

      expect(component['agentCount']()).toBe(1);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('(1)');
    });

    it('renders a row per verified outcome', async () => {
      skillGenerationProgress.set([
        {
          id: '1',
          name: 'frontend-developer.md',
          type: 'agent',
          status: 'complete',
        },
        {
          id: '2',
          name: 'qa-tester.md',
          type: 'agent',
          status: 'complete',
        },
      ]);
      completionData.set(
        completion({
          agents: [
            outcome(),
            outcome({ agentId: 'qa-tester', filePath: '/ws/qa-tester.md' }),
          ],
        }),
      );
      await settle();

      const rows = fixture.nativeElement.querySelectorAll('li[data-status]');
      expect(rows.length).toBe(2);
    });
  });

  describe('Enhanced prompts badge', () => {
    it('should hide enhanced badge when status is not complete', () => {
      const badge = fixture.nativeElement.querySelector('.badge-success');
      expect(badge).toBeFalsy();
    });

    it('should show enhanced badge when status is complete', async () => {
      enhancedPromptsStatus.set('complete');
      await settle();

      const badge = fixture.nativeElement.querySelector('.badge-success');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain('Enhanced');
    });
  });

  describe('Quick start guide', () => {
    it('should display quick start guide heading', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Quick Start Guide');
    });

    it('should reference the orchestrate command', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('/orchestrate');
    });

    it('should mention @agent-name usage tip', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('@agent-name');
    });
  });

  describe('Close button', () => {
    it('should display a single Close button', () => {
      const button = fixture.nativeElement.querySelector('.btn-primary');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('Close');
    });

    it('should post the complete message when clicked', () => {
      const button = fixture.nativeElement.querySelector('.btn-primary');
      button.click();

      expect(mockVSCodeService.postMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.SETUP_WIZARD_COMPLETE,
      });
    });
  });

  describe('Computed derivations', () => {
    it('should derive enhancedPromptsGenerated from status', () => {
      expect(component['enhancedPromptsGenerated']()).toBe(false);
      enhancedPromptsStatus.set('complete');
      expect(component['enhancedPromptsGenerated']()).toBe(true);
    });

    it('should map status to a label', () => {
      enhancedPromptsStatus.set('skipped');
      expect(component['enhancedPromptsStatusLabel']()).toBe('Pro Only');
      enhancedPromptsStatus.set('error');
      expect(component['enhancedPromptsStatusLabel']()).toBe('Failed');
      enhancedPromptsStatus.set('idle');
      expect(component['enhancedPromptsStatusLabel']()).toBe('Not Generated');
    });

    it('should expose warnings from completion data', () => {
      expect(component['warnings']()).toEqual([]);
      expect(component['hasWarnings']()).toBe(false);

      completionData.set(
        completion({ warnings: ['Customization failed for section X'] }),
      );

      expect(component['warnings']()).toEqual([
        'Customization failed for section X',
      ]);
      expect(component['hasWarnings']()).toBe(true);
    });

    it('should derive enhancedPromptsUsed from completion data', () => {
      expect(component['enhancedPromptsUsed']()).toBe(false);
      completionData.set(completion({ enhancedPromptsUsed: true }));
      expect(component['enhancedPromptsUsed']()).toBe(true);
    });
  });

  function counter(status: string): string | null {
    return (
      (fixture.nativeElement as HTMLElement)
        .querySelector(`[data-outcome="${status}"] b`)
        ?.textContent?.trim() ?? null
    );
  }

  describe('Explicit outcome presentation', () => {
    const mixed = completion({
      success: false,
      writtenCount: 1,
      unchangedCount: 1,
      failedCount: 1,
      agents: [
        outcome(),
        outcome({
          agentId: 'backend-developer',
          filePath: '/ws/.claude/agents/backend-developer.md',
          status: 'unchanged',
        }),
        outcome({
          agentId: 'senior-tester',
          filePath: '/ws/.claude/agents/senior-tester.md',
          status: 'failed',
          error: 'SDK timeout',
        }),
      ],
      errors: ['Generation timed out'],
    });

    it('derives one tile per explicit outcome, not from streamed items', async () => {
      // A stray streamed item must not add a tile once outcomes exist.
      skillGenerationProgress.set([
        { id: 'ghost', name: 'ghost.md', type: 'agent', status: 'complete' },
      ]);
      completionData.set(mixed);
      await settle();

      const tiles = fixture.nativeElement.querySelectorAll('[data-status]');
      expect(tiles.length).toBe(3);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('(3)');
      expect(text).not.toContain('Ghost');
    });

    it('labels an unchanged outcome as already current', async () => {
      completionData.set(mixed);
      await settle();

      const unchangedTile = fixture.nativeElement.querySelector(
        '[data-status="unchanged"]',
      );
      expect(unchangedTile).toBeTruthy();
      expect(unchangedTile.textContent).toContain('Already current');
    });

    it('shows a failed outcome with safe copy instead of the raw error', async () => {
      completionData.set(mixed);
      await settle();

      const failedRow = fixture.nativeElement.querySelector(
        '[data-status="failed"]',
      );
      expect(failedRow.textContent).toContain('Failed');
      const callout = fixture.nativeElement.querySelector(
        '[data-testid="outcome-failure"]',
      );
      expect(callout.textContent).toContain('senior-tester.md');
      expect(callout.textContent).toContain('The request timed out. Try again.');
      expect(callout.textContent).not.toContain('SDK timeout');
    });

    it('shows five counters that equal the per-file rows', async () => {
      completionData.set(mixed);
      await settle();

      expect(counter('written')).toBe('1');
      expect(counter('kept')).toBe('0');
      expect(counter('unchanged')).toBe('1');
      expect(counter('changed-since-preview')).toBe('0');
      expect(counter('failed')).toBe('1');
    });

    it('shows the output directory from the payload', async () => {
      completionData.set(mixed);
      await settle();

      const directory = fixture.nativeElement.querySelector(
        '[data-testid="output-directory"]',
      );
      expect(directory.textContent).toContain('/ws/.claude/agents');
    });

    it('switches the header to an error state when any agent failed', async () => {
      completionData.set(mixed);
      await settle();

      const heading = fixture.nativeElement.querySelector('h1');
      expect(heading.textContent).toContain('Setup Finished With Errors');
    });

    it('lists payload errors and keeps earlier writes visible', async () => {
      completionData.set(mixed);
      await settle();

      const errorsAlert = fixture.nativeElement.querySelector(
        '[data-testid="completion-errors"]',
      );
      expect(errorsAlert.textContent).toContain('Generation timed out');
      // The written agent from before the failure still renders.
      const writtenTile = fixture.nativeElement.querySelector(
        '[data-status="written"]',
      );
      expect(writtenTile.textContent).toContain('frontend-developer.md');
    });

    it('keeps the success header when every outcome is written or unchanged', async () => {
      completionData.set(
        completion({
          writtenCount: 1,
          unchangedCount: 1,
          agents: [
            outcome(),
            outcome({
              agentId: 'backend-developer',
              filePath: '/ws/.claude/agents/backend-developer.md',
              status: 'unchanged',
            }),
          ],
        }),
      );
      await settle();

      const heading = fixture.nativeElement.querySelector('h1');
      expect(heading.textContent).toContain('Setup Complete!');
      expect(counter('failed')).toBe('0');
    });

    it('does not claim completion from streamed items when no payload arrived', async () => {
      skillGenerationProgress.set([
        {
          id: 'frontend-developer',
          name: 'frontend-developer.md',
          type: 'agent',
          status: 'complete',
        },
      ]);
      await settle();

      const tiles = fixture.nativeElement.querySelectorAll('[data-status]');
      expect(tiles.length).toBe(0);
    });

    it('shows the rejected-section count when validation rejected sections', async () => {
      completionData.set(
        completion({ rejectedSections: 11, tailoredSections: 4 }),
      );
      await settle();

      const badge = fixture.nativeElement.querySelector(
        '[data-testid="rejected-sections-count"]',
      );
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain('11 sections rejected');
    });

    it('renders no rejected-sections badge when nothing was rejected', async () => {
      completionData.set(completion({ rejectedSections: 0 }));
      await settle();

      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="rejected-sections-count"]',
        ),
      ).toBeFalsy();
    });
  });

  describe('Kept outcomes, grade expectation and Library notices', () => {
    const harnessRoot = {
      harnessRoot: '/ws',
      openedFolder: '/ws',
      chosen: 'harness-root',
      openedIsHarnessRoot: true,
    } as const;
    const resultFacts = (
      facts: Partial<NonNullable<CompletionData['result']>>,
    ): NonNullable<CompletionData['result']> => ({
      status: 'completed',
      success: true,
      source: { kind: 'workspace-discovery', reason: 'missing' },
      effectiveProvider: 'anthropic',
      effectiveModel: 'sonnet',
      ...facts,
    });
    const keptMix = [
      outcome({ agentId: 'tester', filePath: '/ws/.claude/agents/tester.md' }),
      outcome({
        agentId: 'backend-developer',
        filePath: '/ws/.claude/agents/backend-developer.md',
      }),
      outcome({
        agentId: 'frontend-developer',
        filePath: '/ws/.claude/agents/frontend-developer.md',
        status: 'kept',
      }),
      outcome({
        agentId: 'data-engineer',
        filePath: '/ws/.claude/agents/data-engineer.md',
        status: 'changed-since-preview',
      }),
    ];
    const text = (): string => fixture.nativeElement.textContent as string;
    const byTestId = (id: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

    it('renders kept and changed-since-preview rows with their own labels', async () => {
      completionData.set(completion({ agents: keptMix }));
      await settle();

      const kept = fixture.nativeElement.querySelector('[data-status="kept"]');
      expect(kept.textContent).toContain('Kept (your file)');
      expect(kept.textContent).toContain('not regenerated');
      const changed = fixture.nativeElement.querySelector(
        '[data-status="changed-since-preview"]',
      );
      expect(changed.textContent).toContain('Changed since preview (kept)');
      expect(counter('written')).toBe('2');
      expect(counter('kept')).toBe('1');
      expect(counter('changed-since-preview')).toBe('1');
    });

    it('shows no grade or Library copy when the host sent no result facts', async () => {
      completionData.set(completion({ agents: keptMix }));
      await settle();

      expect(text()).not.toContain('About grades.');
      expect(byTestId('library-stale-notice')).toBeNull();
      expect(byTestId('outcome-diverged')).toBeNull();
    });

    it('shows the grade callout and stale notice for a harness-root run in Electron', async () => {
      completionData.set(
        completion({
          agents: keptMix,
          result: resultFacts({ target: harnessRoot, libraryPass: 'failed' }),
        }),
      );
      await settle();

      expect(text()).toContain('About grades.');
      expect(byTestId('library-stale-notice')?.textContent).toContain(
        'Your files were written.',
      );
    });

    it('names only written agents as diverged, never a kept one', async () => {
      completionData.set(
        completion({
          agents: keptMix,
          result: resultFacts({
            target: harnessRoot,
            libraryPass: 'updated',
            libraryDiverged: ['backend-developer', 'frontend-developer'],
          }),
        }),
      );
      await settle();

      const diverged = byTestId('outcome-diverged');
      expect(diverged?.textContent).toContain('backend-developer');
      expect(diverged?.textContent).not.toContain('frontend-developer');
      expect(byTestId('library-stale-notice')).toBeNull();
      diverged?.querySelector<HTMLButtonElement>('button')?.click();
      expect(openSkillsDivergedClones).toHaveBeenCalledTimes(1);
    });

    it('states that nothing new was written when every agent was kept or current', async () => {
      completionData.set(
        completion({
          writtenCount: 0,
          unchangedCount: 1,
          agents: [
            outcome({ status: 'kept' }),
            outcome({
              agentId: 'code-reviewer',
              filePath: '/ws/.claude/agents/code-reviewer.md',
              status: 'unchanged',
            }),
          ],
          result: resultFacts({
            target: harnessRoot,
            libraryPass: 'not-applicable',
          }),
        }),
      );
      await settle();

      expect(text()).toContain('Nothing new was written');
      expect(text()).toContain('All 2 agents were kept or already current.');
      expect(text()).not.toContain('About grades.');
    });

    it('shows no grade copy and an opened-folder notice for the opened-folder target', async () => {
      completionData.set(
        completion({
          outputDirectory: '/ws/packages/api/.claude/agents',
          agents: keptMix,
          result: resultFacts({
            target: {
              harnessRoot: '/ws',
              openedFolder: '/ws/packages/api',
              chosen: 'opened-folder',
              openedIsHarnessRoot: false,
            },
            libraryPass: 'not-applicable',
          }),
        }),
      );
      await settle();

      expect(text()).not.toContain('About grades.');
      expect(text()).toContain('will not appear in the Library');
    });
  });

  describe('Accessibility', () => {
    it('should have a top-level h1 heading', () => {
      const h1 = fixture.nativeElement.querySelector('h1');
      expect(h1).toBeTruthy();
    });

    it('should have accessible buttons with text', () => {
      const buttons = fixture.nativeElement.querySelectorAll('button');
      buttons.forEach((button: HTMLButtonElement) => {
        expect(button.textContent?.trim()).toBeTruthy();
      });
    });
  });
});
