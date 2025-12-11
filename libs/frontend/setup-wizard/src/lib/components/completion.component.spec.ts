import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CompletionComponent } from './completion.component';
import {
  SetupWizardStateService,
  GenerationProgress,
  AgentProgress,
} from '../services/setup-wizard-state.service';
import { VSCodeService } from '@ptah-extension/core';

describe('CompletionComponent', () => {
  let component: CompletionComponent;
  let fixture: ComponentFixture<CompletionComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockVSCodeService: Partial<VSCodeService>;

  beforeEach(async () => {
    mockStateService = {
      generationProgress: signal<GenerationProgress | null>(null),
    };

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

  describe('Initial State', () => {
    it('should display success heading', () => {
      const heading = fixture.nativeElement.querySelector('h1');
      expect(heading.textContent).toContain('Setup Complete!');
    });

    it('should display success icon', () => {
      const svg = fixture.nativeElement.querySelector('.text-success');
      expect(svg).toBeTruthy();
    });

    it('should display success message', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain(
        'Your personalized agents have been generated and are ready to use'
      );
    });
  });

  describe('Generation Summary', () => {
    it('should display summary card', () => {
      const card = fixture.nativeElement.querySelector('.card');
      expect(card).toBeTruthy();
      expect(card.textContent).toContain('Generation Summary');
    });

    it('should display agents generated count', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
        { id: '2', name: 'Agent 2', status: 'complete', duration: 3000 },
        { id: '3', name: 'Agent 3', status: 'in-progress' },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });
      fixture.detectChanges();

      const stats = fixture.nativeElement.querySelectorAll('.stat-value');
      expect(stats[0].textContent).toContain('2');
    });

    it('should display zero agents when no agents', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
      });

      expect(component['totalAgentsGenerated']()).toBe(0);
    });

    it('should display file location', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('.claude/agents/');
    });
  });

  describe('Total Duration Calculation', () => {
    it('should calculate total duration correctly', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
        { id: '2', name: 'Agent 2', status: 'complete', duration: 3000 },
        { id: '3', name: 'Agent 3', status: 'complete', duration: 2000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['totalDuration']()).toBe(10000);
    });

    it('should ignore agents without duration', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
        { id: '2', name: 'Agent 2', status: 'complete' },
        { id: '3', name: 'Agent 3', status: 'complete', duration: 3000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['totalDuration']()).toBe(8000);
    });

    it('should handle null progress', () => {
      expect(component['totalDuration']()).toBe(0);
    });

    it('should handle progress without agents', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
      });

      expect(component['totalDuration']()).toBe(0);
    });
  });

  describe('Duration Formatting', () => {
    it('should format seconds correctly', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 30000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['formatTotalTime']()).toBe('30s');
    });

    it('should format minutes and seconds correctly', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 125000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['formatTotalTime']()).toBe('2m 5s');
    });

    it('should format hours, minutes correctly', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 3725000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['formatTotalTime']()).toBe('1h 2m');
    });

    it('should handle zero duration', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents: [],
      });

      expect(component['formatTotalTime']()).toBe('0s');
    });

    it('should handle negative duration gracefully', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: -5000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['formatTotalTime']()).toBe('0s');
    });

    it('should handle exact minute', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 60000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['formatTotalTime']()).toBe('1m 0s');
    });

    it('should handle exact hour', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 3600000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['formatTotalTime']()).toBe('1h 0m');
    });
  });

  describe('Action Buttons', () => {
    it('should display open agents folder button', () => {
      const button = fixture.nativeElement.querySelector('.btn-primary');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('Open Agents Folder');
    });

    it('should display start new chat button', () => {
      const button = fixture.nativeElement.querySelector('.btn-ghost');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('Start New Chat');
    });

    it('should send message to open agents folder', () => {
      const button = fixture.nativeElement.querySelector('.btn-primary');
      button.click();

      expect(mockVSCodeService.postMessage).toHaveBeenCalledWith({
        type: 'setup-wizard:open-agents-folder',
      });
    });

    it('should send message to start new chat', () => {
      const button = fixture.nativeElement.querySelector('.btn-ghost');
      button.click();

      expect(mockVSCodeService.postMessage).toHaveBeenCalledWith({
        type: 'setup-wizard:start-chat',
      });
    });

    it('should have icons on buttons', () => {
      const buttons = fixture.nativeElement.querySelectorAll('button svg');
      expect(buttons.length).toBe(2);
    });
  });

  describe('Tips Section', () => {
    it('should display tips alert', () => {
      const alert = fixture.nativeElement.querySelector('.alert-info');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Tip: Using Your Agents');
    });

    it('should display usage instructions', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('@agent-name');
      expect(text).toContain('automatically select the most relevant agent');
    });

    it('should use code tag for @agent-name', () => {
      const code = fixture.nativeElement.querySelector('code');
      expect(code).toBeTruthy();
      expect(code.textContent).toContain('@agent-name');
    });
  });

  describe('Computed Signals', () => {
    it('should compute total agents generated', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
        { id: '2', name: 'Agent 2', status: 'in-progress' },
        { id: '3', name: 'Agent 3', status: 'complete', duration: 3000 },
        { id: '4', name: 'Agent 4', status: 'pending' },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['totalAgentsGenerated']()).toBe(2);
    });

    it('should return 0 when no progress', () => {
      expect(component['totalAgentsGenerated']()).toBe(0);
    });

    it('should return 0 when no agents', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
      });

      expect(component['totalAgentsGenerated']()).toBe(0);
    });

    it('should reactively update total agents', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents: [
          { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
        ],
      });

      expect(component['totalAgentsGenerated']()).toBe(1);

      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents: [
          { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
          { id: '2', name: 'Agent 2', status: 'complete', duration: 3000 },
        ],
      });

      expect(component['totalAgentsGenerated']()).toBe(2);
    });
  });

  describe('Statistics Display', () => {
    it('should display all three statistics', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 60000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });
      fixture.detectChanges();

      const stats = fixture.nativeElement.querySelectorAll('.stat');
      expect(stats.length).toBe(3);
    });

    it('should use correct stat titles', () => {
      const statTitles = fixture.nativeElement.querySelectorAll('.stat-title');
      expect(statTitles[0].textContent).toContain('Agents Generated');
      expect(statTitles[1].textContent).toContain('Total Time');
      expect(statTitles[2].textContent).toContain('Location');
    });

    it('should use color classes for stat values', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });
      fixture.detectChanges();

      const statValues = fixture.nativeElement.querySelectorAll('.stat-value');
      expect(statValues[0].classList.contains('text-primary')).toBe(true);
      expect(statValues[1].classList.contains('text-accent')).toBe(true);
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      const h1 = fixture.nativeElement.querySelector('h1');
      const h2 = fixture.nativeElement.querySelector('h2');
      const h3 = fixture.nativeElement.querySelector('h3');
      expect(h1).toBeTruthy();
      expect(h2).toBeTruthy();
      expect(h3).toBeTruthy();
    });

    it('should have accessible buttons with text', () => {
      const buttons = fixture.nativeElement.querySelectorAll('button');
      buttons.forEach((button: HTMLButtonElement) => {
        expect(button.textContent?.trim()).toBeTruthy();
      });
    });

    it('should have success icon with proper attributes', () => {
      const svg = fixture.nativeElement.querySelector('.text-success');
      expect(svg).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large agent count', () => {
      const agents: AgentProgress[] = Array.from({ length: 100 }, (_, i) => ({
        id: `${i + 1}`,
        name: `Agent ${i + 1}`,
        status: 'complete' as const,
        duration: 1000,
      }));

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['totalAgentsGenerated']()).toBe(100);
      expect(component['formatTotalTime']()).toBe('1m 40s');
    });

    it('should handle mixed agent statuses', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 5000 },
        { id: '2', name: 'Agent 2', status: 'pending' },
        { id: '3', name: 'Agent 3', status: 'in-progress' },
        { id: '4', name: 'Agent 4', status: 'complete', duration: 3000 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['totalAgentsGenerated']()).toBe(2);
    });

    it('should handle very long duration', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 7200000 }, // 2 hours
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['formatTotalTime']()).toBe('2h 0m');
    });

    it('should handle duration just under 60 seconds', () => {
      const agents: AgentProgress[] = [
        { id: '1', name: 'Agent 1', status: 'complete', duration: 59999 },
      ];

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents,
      });

      expect(component['formatTotalTime']()).toBe('59s');
    });

    it('should handle null progress reference', () => {
      expect(component['totalAgentsGenerated']()).toBe(0);
      expect(component['totalDuration']()).toBe(0);
      expect(component['formatTotalTime']()).toBe('0s');
    });

    it('should handle undefined agents array', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'complete',
        percentComplete: 100,
        agents: undefined,
      });

      expect(component['totalAgentsGenerated']()).toBe(0);
      expect(component['totalDuration']()).toBe(0);
    });
  });

  describe('Layout and Styling', () => {
    it('should use hero layout', () => {
      const hero = fixture.nativeElement.querySelector('.hero');
      expect(hero).toBeTruthy();
    });

    it('should have responsive button layout', () => {
      const buttonContainer = fixture.nativeElement.querySelector(
        '.flex.flex-col.sm\\:flex-row'
      );
      expect(buttonContainer).toBeTruthy();
    });

    it('should have card shadow', () => {
      const card = fixture.nativeElement.querySelector('.card.shadow-xl');
      expect(card).toBeTruthy();
    });

    it('should have success icon background', () => {
      const iconBg = fixture.nativeElement.querySelector('.bg-success\\/20');
      expect(iconBg).toBeTruthy();
    });

    it('should use grid layout for stats', () => {
      const grid = fixture.nativeElement.querySelector('.grid');
      expect(grid).toBeTruthy();
    });
  });
});
