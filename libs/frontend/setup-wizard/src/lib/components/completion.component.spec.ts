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
import { VSCodeService } from '@ptah-extension/core';

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
  let mockVSCodeService: Partial<VSCodeService>;
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
    };

    await TestBed.configureTestingModule({
      imports: [CompletionComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: VSCodeService, useValue: mockVSCodeService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompletionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

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

    it('should count only completed agent items', () => {
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
      fixture.detectChanges();

      expect(component['agentCount']()).toBe(1);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('(1)');
    });

    it('should render a tile per completed agent', () => {
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
      fixture.detectChanges();

      const tiles = fixture.nativeElement.querySelectorAll(
        '.grid .card .card-body',
      );
      expect(tiles.length).toBe(2);
    });

    it('should format agent filename to Title Case without extension', () => {
      expect(component['formatAgentName']('frontend-developer.md')).toBe(
        'Frontend Developer',
      );
    });
  });

  describe('Enhanced prompts badge', () => {
    it('should hide enhanced badge when status is not complete', () => {
      const badge = fixture.nativeElement.querySelector('.badge-success');
      expect(badge).toBeFalsy();
    });

    it('should show enhanced badge when status is complete', () => {
      enhancedPromptsStatus.set('complete');
      fixture.detectChanges();

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

    it('derives one tile per explicit outcome, not from streamed items', () => {
      // A stray streamed item must not add a tile once outcomes exist.
      skillGenerationProgress.set([
        { id: 'ghost', name: 'ghost.md', type: 'agent', status: 'complete' },
      ]);
      completionData.set(mixed);
      fixture.detectChanges();

      const tiles = fixture.nativeElement.querySelectorAll('[data-status]');
      expect(tiles.length).toBe(3);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('(3)');
      expect(text).not.toContain('Ghost');
    });

    it('labels an unchanged outcome as already current', () => {
      completionData.set(mixed);
      fixture.detectChanges();

      const unchangedTile = fixture.nativeElement.querySelector(
        '[data-status="unchanged"]',
      );
      expect(unchangedTile).toBeTruthy();
      expect(unchangedTile.textContent).toContain('Already current');
    });

    it('shows a failed outcome with its error message', () => {
      completionData.set(mixed);
      fixture.detectChanges();

      const failedTile = fixture.nativeElement.querySelector(
        '[data-status="failed"]',
      );
      expect(failedTile).toBeTruthy();
      expect(failedTile.textContent).toContain('SDK timeout');
    });

    it('shows written/unchanged/failed counts from the payload', () => {
      completionData.set(mixed);
      fixture.detectChanges();

      const written = fixture.nativeElement.querySelector(
        '[data-testid="written-count"]',
      );
      const unchanged = fixture.nativeElement.querySelector(
        '[data-testid="unchanged-count"]',
      );
      const failed = fixture.nativeElement.querySelector(
        '[data-testid="failed-count"]',
      );
      expect(written.textContent).toContain('1 written');
      expect(unchanged.textContent).toContain('1 already current');
      expect(failed.textContent).toContain('1 failed');
    });

    it('shows the output directory from the payload', () => {
      completionData.set(mixed);
      fixture.detectChanges();

      const directory = fixture.nativeElement.querySelector(
        '[data-testid="output-directory"]',
      );
      expect(directory.textContent).toContain('/ws/.claude/agents');
    });

    it('switches the header to an error state when any agent failed', () => {
      completionData.set(mixed);
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector('h1');
      expect(heading.textContent).toContain('Setup Finished With Errors');
    });

    it('lists payload errors and keeps earlier writes visible', () => {
      completionData.set(mixed);
      fixture.detectChanges();

      const errorsAlert = fixture.nativeElement.querySelector(
        '[data-testid="completion-errors"]',
      );
      expect(errorsAlert.textContent).toContain('Generation timed out');
      // The written agent from before the failure still renders.
      const writtenTile = fixture.nativeElement.querySelector(
        '[data-status="written"]',
      );
      expect(writtenTile.textContent).toContain('Frontend Developer');
    });

    it('keeps the success header when every outcome is written or unchanged', () => {
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
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector('h1');
      expect(heading.textContent).toContain('Setup Complete!');
      expect(
        fixture.nativeElement.querySelector('[data-testid="failed-count"]'),
      ).toBeFalsy();
    });

    it('falls back to completed streamed items when no payload arrived', () => {
      skillGenerationProgress.set([
        {
          id: 'frontend-developer',
          name: 'frontend-developer.md',
          type: 'agent',
          status: 'complete',
        },
      ]);
      fixture.detectChanges();

      const tiles = fixture.nativeElement.querySelectorAll('[data-status]');
      expect(tiles.length).toBe(1);
      expect(tiles[0].getAttribute('data-status')).toBe('written');
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
