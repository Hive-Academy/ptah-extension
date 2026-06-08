import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { CompletionComponent } from './completion.component';
import {
  SetupWizardStateService,
  CompletionData,
  EnhancedPromptsWizardStatus,
  SkillGenerationProgressItem,
} from '../services/setup-wizard-state.service';
import { VSCodeService } from '@ptah-extension/core';

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
      expect(text).toContain('/ptah-core:orchestrate');
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

      completionData.set({
        success: true,
        generatedCount: 1,
        warnings: ['Customization failed for section X'],
      });

      expect(component['warnings']()).toEqual([
        'Customization failed for section X',
      ]);
      expect(component['hasWarnings']()).toBe(true);
    });

    it('should derive enhancedPromptsUsed from completion data', () => {
      expect(component['enhancedPromptsUsed']()).toBe(false);
      completionData.set({
        success: true,
        generatedCount: 1,
        enhancedPromptsUsed: true,
      });
      expect(component['enhancedPromptsUsed']()).toBe(true);
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
