import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { GenerationProgressComponent } from './generation-progress.component';
import {
  SetupWizardStateService,
  GenerationProgress,
  AgentProgress,
} from '../services/setup-wizard-state.service';

describe('GenerationProgressComponent', () => {
  let component: GenerationProgressComponent;
  let fixture: ComponentFixture<GenerationProgressComponent>;
  let mockStateService: Partial<SetupWizardStateService>;

  beforeEach(async () => {
    mockStateService = {
      generationProgress: signal<GenerationProgress | null>(null),
    };

    await TestBed.configureTestingModule({
      imports: [GenerationProgressComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GenerationProgressComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initial State', () => {
    it('should display heading', () => {
      const heading = fixture.nativeElement.querySelector('h2');
      expect(heading.textContent).toContain('Generating Your Agents');
    });

    it('should display description', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain(
        'Analyzing your codebase and customizing agent configurations'
      );
    });
  });

  describe('Progress Display', () => {
    it('should display overall progress bar', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 65,
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar).toBeTruthy();
      expect(progressBar.value).toBe(65);
    });

    it('should display progress percentage', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 80,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('80%');
    });

    it('should set proper aria attributes on progress bar', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 75,
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.getAttribute('aria-valuenow')).toBe('75');
      expect(progressBar.getAttribute('aria-valuemin')).toBe('0');
      expect(progressBar.getAttribute('aria-valuemax')).toBe('100');
      expect(progressBar.getAttribute('aria-label')).toContain(
        '75 percent complete'
      );
    });
  });

  describe('Phase Labels', () => {
    it('should display analysis phase label', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 20,
      });

      expect(component['phaseLabel']()).toBe('Analyzing workspace structure');
    });

    it('should display selection phase label', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'selection',
        percentComplete: 40,
      });

      expect(component['phaseLabel']()).toBe('Selecting agent templates');
    });

    it('should display customization phase label', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 60,
      });

      expect(component['phaseLabel']()).toBe(
        'Customizing agent configurations'
      );
    });

    it('should display rendering phase label', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 80,
      });

      expect(component['phaseLabel']()).toBe('Rendering agent files');
    });

    it('should display complete phase label', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
      });

      expect(component['phaseLabel']()).toBe('Generation complete');
    });

    it('should display initializing label for unknown phase', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'unknown' as any,
        percentComplete: 0,
      });

      expect(component['phaseLabel']()).toBe('Initializing...');
    });

    it('should display initializing label for null progress', () => {
      expect(component['phaseLabel']()).toBe('Initializing...');
    });
  });

  describe('Agent Progress List', () => {
    it('should display agent progress cards', () => {
      const agents: AgentProgress[] = [
        {
          id: '1',
          name: 'Frontend Developer',
          status: 'complete',
          duration: 5000,
        },
        {
          id: '2',
          name: 'Backend Developer',
          status: 'in-progress',
          currentTask: 'Analyzing code',
        },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
        agents,
      });
      fixture.detectChanges();

      const cards = fixture.nativeElement.querySelectorAll('.card');
      expect(cards.length).toBe(2);
    });

    it('should display pending status', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'pending' },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 10,
        agents,
      });
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-outline');
      expect(badge.textContent).toContain('Pending');
    });

    it('should display in-progress status with spinner', () => {
      const agents: AgentProgress[] = [
        {
          id: '1',
          name: 'Agent 1',
          status: 'in-progress',
          currentTask: 'Processing',
        },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
        agents,
      });
      fixture.detectChanges();

      const spinner = fixture.nativeElement.querySelector('.loading-spinner');
      expect(spinner).toBeTruthy();
    });

    it('should display complete status with checkmark', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 3000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 80,
        agents,
      });
      fixture.detectChanges();

      const checkmark = fixture.nativeElement.querySelector('.text-success');
      expect(checkmark).toBeTruthy();
    });

    it('should display agent names', () => {
      const agents: AgentProgress[] = [
        {
          id: '1',
          name: 'Frontend Developer',
          status: 'complete',
          duration: 5000,
        },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 90,
        agents,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Frontend Developer');
    });

    it('should display current task for in-progress agents', () => {
      const agents: AgentProgress[] = [
        {
          id: '1',
          name: 'Agent 1',
          status: 'in-progress',
          currentTask: 'Analyzing codebase',
        },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
        agents,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Analyzing codebase');
    });

    it('should hide current task when not present', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'in-progress' },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
        agents,
      });
      fixture.detectChanges();

      const taskElements = fixture.nativeElement.querySelectorAll(
        '.text-sm.text-base-content\\/60'
      );
      const hasCurrentTask = Array.from(taskElements).some(
        (el: any) => el.textContent && !el.textContent.includes('Agent 1')
      );
      expect(hasCurrentTask).toBe(false);
    });

    it('should display duration for completed agents', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 125000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 90,
        agents,
      });
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-accent');
      expect(badge).toBeTruthy();
    });

    it('should hide duration for non-complete agents', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'pending' },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 30,
        agents,
      });
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-accent');
      expect(badge).toBeFalsy();
    });

    it('should display customization summary', () => {
      const agents: AgentProgress[] = [
        {
          id: '1',
          name: 'Agent 1',
          status: 'complete',
          customizationSummary: 'Added 5 custom prompts',
        },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 90,
        agents,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Added 5 custom prompts');
    });

    it('should hide customization summary when not present', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 3000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 90,
        agents,
      });
      fixture.detectChanges();

      const summary = fixture.nativeElement.querySelector('.bg-base-200');
      expect(summary).toBeFalsy();
    });
  });

  describe('Duration Formatting', () => {
    it('should format seconds correctly', () => {
      expect(component['formatDuration'](5000)).toBe('5s');
      expect(component['formatDuration'](30000)).toBe('30s');
      expect(component['formatDuration'](59000)).toBe('59s');
    });

    it('should format minutes and seconds correctly', () => {
      expect(component['formatDuration'](60000)).toBe('1m 0s');
      expect(component['formatDuration'](125000)).toBe('2m 5s');
      expect(component['formatDuration'](3599000)).toBe('59m 59s');
    });

    it('should handle zero duration', () => {
      expect(component['formatDuration'](0)).toBe('0s');
    });

    it('should handle negative duration gracefully', () => {
      expect(component['formatDuration'](-5000)).toBe('0s');
    });

    it('should handle very small duration', () => {
      expect(component['formatDuration'](500)).toBe('0s');
    });

    it('should handle very large duration', () => {
      expect(component['formatDuration'](3600000)).toBe('60m 0s');
    });
  });

  describe('Computed Signal - Agent Progress List', () => {
    it('should return empty array when no progress', () => {
      expect(component['agentProgressList']()).toEqual([]);
    });

    it('should return empty array when progress has no agents', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 20,
      });

      expect(component['agentProgressList']()).toEqual([]);
    });

    it('should return agents array when present', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
        { id: '2', name: 'Agent 2', status: 'pending' },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
        agents,
      });

      expect(component['agentProgressList']()).toEqual(agents);
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
        agents: [{ id: '1', name: 'Agent 1', status: 'pending' }],
      });
      fixture.detectChanges();

      const h2 = fixture.nativeElement.querySelector('h2');
      const h3 = fixture.nativeElement.querySelector('h3');
      expect(h2).toBeTruthy();
      expect(h3).toBeTruthy();
    });

    it('should have accessible progress bar', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 75,
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.getAttribute('role')).toBe('progressbar');
      expect(progressBar.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null progress gracefully', () => {
      expect(component['agentProgressList']()).toEqual([]);
      expect(component['phaseLabel']()).toBe('Initializing...');
    });

    it('should handle undefined agents array', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
        agents: undefined,
      });

      expect(component['agentProgressList']()).toEqual([]);
    });

    it('should handle progress with 0% complete', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 0,
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.value).toBe(0);
    });

    it('should handle progress with 100% complete', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.value).toBe(100);
    });

    it('should handle agent without duration', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete' },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 90,
        agents,
      });
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-accent');
      expect(badge).toBeFalsy();
    });

    it('should handle very long agent names', () => {
      const agents: AgentProgress[] = [
        {
          id: '1',
          name: 'Very Long Agent Name That Might Cause Layout Issues',
          status: 'in-progress',
        },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
        agents,
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain(
        'Very Long Agent Name That Might Cause Layout Issues'
      );
    });

    it('should handle empty customization summary', () => {
      const agents: AgentProgress[] = [
        {
          id: '1',
          name: 'Agent 1',
          status: 'complete',
          customizationSummary: '',
        },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'rendering',
        percentComplete: 90,
        agents,
      });
      fixture.detectChanges();

      // Should still render summary box but with empty text
      const summary = fixture.nativeElement.querySelector('.bg-base-200');
      expect(summary).toBeTruthy();
    });
  });

  describe('Phase Indicator Alert', () => {
    it('should display phase indicator with icon', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'customization',
        percentComplete: 50,
      });
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('.alert');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Current Phase:');
    });

    it('should update phase label reactively', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 20,
      });
      fixture.detectChanges();

      let text = fixture.nativeElement.textContent;
      expect(text).toContain('Analyzing workspace structure');

      progressSignal.set({
        phase: 'rendering',
        percentComplete: 80,
      });
      fixture.detectChanges();

      text = fixture.nativeElement.textContent;
      expect(text).toContain('Rendering agent files');
    });
  });
});
