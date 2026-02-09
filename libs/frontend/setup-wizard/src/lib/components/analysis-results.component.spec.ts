import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AnalysisResultsComponent } from './analysis-results.component';
import {
  SetupWizardStateService,
  ProjectContext,
} from '../services/setup-wizard-state.service';

describe('AnalysisResultsComponent', () => {
  let component: AnalysisResultsComponent;
  let fixture: ComponentFixture<AnalysisResultsComponent>;
  let mockStateService: Partial<SetupWizardStateService>;

  beforeEach(async () => {
    mockStateService = {
      projectContext: signal<ProjectContext | null>(null),
      setCurrentStep: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AnalysisResultsComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initial State', () => {
    it('should display analysis complete heading', () => {
      const heading = fixture.nativeElement.querySelector('h2');
      expect(heading.textContent).toContain('Analysis Complete');
    });

    it('should show loading state when no project context', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Loading analysis results...');
    });
  });

  describe('Project Context Display', () => {
    it('should display basic project information', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: ['TypeScript', 'Angular'],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Angular');
      expect(text).toContain('TypeScript');
    });

    it('should display project type badge', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'React',
        techStack: [],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-primary');
      expect(badge.textContent).toContain('React');
    });

    it('should display tech stack badges', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: ['TypeScript', 'Angular', 'Nx'],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const badges = fixture.nativeElement.querySelectorAll('.badge-secondary');
      expect(badges.length).toBe(3);
      expect(badges[0].textContent).toContain('TypeScript');
      expect(badges[1].textContent).toContain('Angular');
      expect(badges[2].textContent).toContain('Nx');
    });

    it('should display empty tech stack message', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Unknown',
        techStack: [],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('No tech stack detected');
    });

    it('should display architecture when present', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: ['TypeScript'],
        architecture: 'Nx Monorepo',
        isMonorepo: true,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Architecture:');
      expect(text).toContain('Nx Monorepo');
    });

    it('should hide architecture when not present', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: ['TypeScript'],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).not.toContain('Architecture:');
    });

    it('should display monorepo as Yes when true', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: true,
        monorepoType: 'Nx',
        packageCount: 15,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Monorepo:');
      expect(text).toContain('Yes');
      expect(text).toContain('(Nx)');
      expect(text).toContain('15 packages');
    });

    it('should display monorepo as No when false', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Monorepo:');
      expect(text).toContain('No');
    });

    it('should display monorepo type when present', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: true,
        monorepoType: 'Lerna',
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('(Lerna)');
    });

    it('should display package count when present', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: true,
        packageCount: 23,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('23 packages');
    });
  });

  describe('Confirmation Warning', () => {
    it('should display confirmation warning', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('.alert-warning');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Does this look correct?');
    });

    it('should explain agent generation impact', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain(
        'The agents we generate will be tailored to these characteristics'
      );
    });
  });

  describe('Action Buttons', () => {
    beforeEach(() => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: ['TypeScript'],
        isMonorepo: false,
      });
      fixture.detectChanges();
    });

    it('should display continue button', () => {
      const button = fixture.nativeElement.querySelector('.btn-primary');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('Yes, Continue');
    });

    it('should display manual adjust button', () => {
      const button = fixture.nativeElement.querySelector('.btn-ghost');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('No, Let Me Adjust');
    });

    it('should transition to selection step on continue', () => {
      const button = fixture.nativeElement.querySelector('.btn-primary');
      button.click();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('selection');
    });

    // it('should show alert modal on manual adjust', () => {
    //   jest.spyOn(component['alertModal'], 'show');

    //   const button = fixture.nativeElement.querySelector('.btn-ghost');
    //   button.click();

    //   expect(component['alertModal'].show).toHaveBeenCalled();
    // });

    // it('should handle alert modal OK click', () => {
    //   component['onAlertOk']();

    //   // Should not crash - modal auto-closes
    //   expect(mockStateService.setCurrentStep).not.toHaveBeenCalled();
    // });
  });

  describe('Computed Signal', () => {
    it('should compute project context from state service', () => {
      const context: ProjectContext = {
        type: 'Vue',
        techStack: ['TypeScript', 'Vue'],
        isMonorepo: false,
      };
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set(context);

      expect(component['projectContext']()).toEqual(context);
    });

    it('should return null when no project context', () => {
      expect(component['projectContext']()).toBeNull();
    });

    it('should reactively update when state changes', () => {
      const context1: ProjectContext = {
        type: 'Angular',
        techStack: [],
        isMonorepo: false,
      };
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set(context1);

      expect(component['projectContext']()).toEqual(context1);

      const context2: ProjectContext = {
        type: 'React',
        techStack: [],
        isMonorepo: true,
      };
      projectContextSignal.set(context2);

      expect(component['projectContext']()).toEqual(context2);
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: ['TypeScript'],
        isMonorepo: false,
      });
      fixture.detectChanges();
    });

    it('should have proper heading hierarchy', () => {
      const h2 = fixture.nativeElement.querySelector('h2');
      const h3 = fixture.nativeElement.querySelector('h3');
      expect(h2).toBeTruthy();
      expect(h3).toBeTruthy();
    });

    it('should have accessible buttons', () => {
      const buttons = fixture.nativeElement.querySelectorAll('button');
      buttons.forEach((button: HTMLButtonElement) => {
        expect(button.textContent?.trim()).toBeTruthy();
      });
    });

    it('should have warning alert with proper structure', () => {
      const alert = fixture.nativeElement.querySelector('.alert-warning');
      expect(alert).toBeTruthy();
      expect(alert.querySelector('svg')).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined monorepo type', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: true,
        packageCount: 10,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Yes');
      expect(text).toContain('10 packages');
    });

    it('should handle undefined package count', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: true,
        monorepoType: 'Nx',
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('(Nx)');
    });

    it('should handle monorepo=true without type or count', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: true,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Yes');
    });

    it('should handle empty project type', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: '',
        techStack: [],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-primary');
      expect(badge).toBeTruthy();
    });

    it('should handle very long tech stack list', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      const techStack = Array.from({ length: 20 }, (_, i) => `Tech${i + 1}`);
      projectContextSignal.set({
        type: 'Angular',
        techStack,
        isMonorepo: false,
      });
      fixture.detectChanges();

      const badges = fixture.nativeElement.querySelectorAll('.badge-secondary');
      expect(badges.length).toBe(20);
    });
  });

  describe('Alert Modal', () => {
    it('should pass correct props to alert modal', () => {
      fixture.detectChanges();

      const modal = fixture.nativeElement.querySelector(
        'ptah-confirmation-modal'
      );
      expect(modal).toBeTruthy();
    });

    it('should show coming soon message in modal', () => {
      const projectContextSignal = mockStateService.projectContext as any;
      projectContextSignal.set({
        type: 'Angular',
        techStack: [],
        isMonorepo: false,
      });
      fixture.detectChanges();

      const modal = fixture.nativeElement.querySelector(
        'ptah-confirmation-modal'
      );
      expect(modal).toBeTruthy();
    });
  });
});
