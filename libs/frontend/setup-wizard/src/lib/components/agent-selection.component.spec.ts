import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { AgentSelectionComponent } from './agent-selection.component';
import {
  SetupWizardStateService,
  AgentSelection,
} from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

describe.skip('AgentSelectionComponent', () => {
  let component: AgentSelectionComponent;
  let fixture: ComponentFixture<AgentSelectionComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRpcService: Partial<WizardRpcService>;
  let availableAgentsSignal: WritableSignal<AgentSelection[]>;
  let selectedCountSignal: WritableSignal<number>;
  let canProceedSignal: WritableSignal<boolean>;

  beforeEach(async () => {
    availableAgentsSignal = signal<AgentSelection[]>([]);
    selectedCountSignal = signal<number>(0);
    canProceedSignal = signal<boolean>(false);

    mockStateService = {
      toggleAgentSelection: jest.fn(),
      setAvailableAgents: jest.fn(),
      setCurrentStep: jest.fn(),
      availableAgents: availableAgentsSignal,
      selectedCount: selectedCountSignal,
      canProceed: canProceedSignal,
    };

    mockRpcService = {
      submitAgentSelection: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AgentSelectionComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: WizardRpcService, useValue: mockRpcService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentSelectionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initial State', () => {
    it('should initialize with isGenerating as false', () => {
      expect(component['isGenerating']()).toBe(false);
    });

    it('should initialize with null error message', () => {
      expect(component['errorMessage']()).toBeNull();
    });

    it('should display heading', () => {
      const heading = fixture.nativeElement.querySelector('h2');
      expect(heading.textContent).toContain('Select Agents to Generate');
    });

    it('should display description', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain(
        "We've analyzed your project and recommended these agents"
      );
    });
  });

  describe('Agent List Display', () => {
    it('should display agent table', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Frontend Developer',
          selected: true,
          score: 95,
          reason: 'High relevance',
          autoInclude: true,
        },
        {
          id: '2',
          name: 'Backend Developer',
          selected: false,
          score: 80,
          reason: 'Medium relevance',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      selectedCountSignal.set(1);
      fixture.detectChanges();

      const rows = fixture.nativeElement.querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);
    });

    it('should display agent names', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Frontend Developer',
          selected: true,
          score: 95,
          reason: 'High relevance',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Frontend Developer');
    });

    it('should display relevance scores with color coding', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'High Score',
          selected: false,
          score: 95,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Medium Score',
          selected: false,
          score: 70,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '3',
          name: 'Low Score',
          selected: false,
          score: 50,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      const successBadge =
        fixture.nativeElement.querySelector('.badge-success');
      const warningBadge =
        fixture.nativeElement.querySelector('.badge-warning');
      const errorBadge = fixture.nativeElement.querySelector('.badge-error');

      expect(successBadge.textContent).toContain('95%');
      expect(warningBadge.textContent).toContain('70%');
      expect(errorBadge.textContent).toContain('50%');
    });

    it('should display reasons', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: false,
          score: 90,
          reason: 'Matches project type',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Matches project type');
    });

    it('should display auto-include badge', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: true,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-accent');
      expect(badge.textContent).toContain('Auto-included');
    });

    it('should hide auto-include badge when not auto-included', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-accent');
      expect(badge).toBeFalsy();
    });

    it('should show empty state message when no agents', () => {
      availableAgentsSignal.set([]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('No agents available. Please restart the wizard.');
    });
  });

  describe('Selection Controls', () => {
    beforeEach(() => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: false,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      selectedCountSignal.set(1);
      fixture.detectChanges();
    });

    it('should display selection count', () => {
      const badge = fixture.nativeElement.querySelector('.badge-outline');
      expect(badge.textContent).toContain('1 / 2 selected');
    });

    it('should have select all button', () => {
      const button = fixture.nativeElement.querySelector(
        'button:nth-of-type(1)'
      );
      expect(button.textContent).toContain('Select All');
    });

    it('should have deselect all button', () => {
      const button = fixture.nativeElement.querySelector(
        'button:nth-of-type(2)'
      );
      expect(button.textContent).toContain('Deselect All');
    });

    it('should disable select all when all selected', () => {
      selectedCountSignal.set(2);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector(
        'button:nth-of-type(1)'
      );
      expect(button.disabled).toBe(true);
    });

    it('should disable deselect all when none selected', () => {
      selectedCountSignal.set(0);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector(
        'button:nth-of-type(2)'
      );
      expect(button.disabled).toBe(true);
    });
  });

  describe('Agent Selection', () => {
    it('should toggle agent selection on checkbox click', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: false,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      const checkbox = fixture.nativeElement.querySelector(
        'input[type="checkbox"]'
      );
      checkbox.click();

      expect(mockStateService.toggleAgentSelection).toHaveBeenCalledWith('1');
    });

    it('should select all agents', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: false,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: false,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      // component['onSelectAll']();

      expect(mockStateService.setAvailableAgents).toHaveBeenCalledWith([
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: true,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
      ]);
    });

    it('should deselect all agents', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: true,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      component['onDeselectAll']();

      expect(mockStateService.setAvailableAgents).toHaveBeenCalledWith([
        {
          id: '1',
          name: 'Agent 1',
          selected: false,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: false,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
      ]);
    });
  });

  describe('Generate Agents', () => {
    beforeEach(() => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: false,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      selectedCountSignal.set(1);
      canProceedSignal.set(true);
      fixture.detectChanges();
    });

    it('should call RPC service when generate button clicked', async () => {
      (mockRpcService.submitAgentSelection as jest.Mock).mockResolvedValue(
        undefined
      );

      await component['onGenerateAgents']();

      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledWith([
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ]);
    });

    it('should transition to generation step on success', async () => {
      (mockRpcService.submitAgentSelection as jest.Mock).mockResolvedValue(
        undefined
      );

      await component['onGenerateAgents']();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith(
        'generation'
      );
    });

    it('should show loading state while generating', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      (mockRpcService.submitAgentSelection as jest.Mock).mockReturnValue(
        promise
      );

      const generatePromise = component['onGenerateAgents']();

      expect(component['isGenerating']()).toBe(true);

      resolvePromise!();
      await generatePromise;

      expect(component['isGenerating']()).toBe(false);
    });

    it('should display error message on failure', async () => {
      const errorMessage = 'RPC timeout';
      (mockRpcService.submitAgentSelection as jest.Mock).mockRejectedValue(
        new Error(errorMessage)
      );

      await component['onGenerateAgents']();

      expect(component['errorMessage']()).toBe(errorMessage);
    });

    it('should display default error message for non-Error failures', async () => {
      (mockRpcService.submitAgentSelection as jest.Mock).mockRejectedValue(
        'String error'
      );

      await component['onGenerateAgents']();

      expect(component['errorMessage']()).toBe(
        'Failed to generate agents. Please try again.'
      );
    });

    it('should reset loading state on error', async () => {
      (mockRpcService.submitAgentSelection as jest.Mock).mockRejectedValue(
        new Error('Test error')
      );

      await component['onGenerateAgents']();

      expect(component['isGenerating']()).toBe(false);
    });

    it('should prevent double-click while generating', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      (mockRpcService.submitAgentSelection as jest.Mock).mockReturnValue(
        promise
      );

      component['onGenerateAgents']();
      component['onGenerateAgents']();

      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledTimes(1);

      resolvePromise!();
    });

    it('should prevent generation when canProceed is false', async () => {
      canProceedSignal.set(false);

      await component['onGenerateAgents']();

      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
    });

    it('should clear previous error message on new attempt', async () => {
      (mockRpcService.submitAgentSelection as jest.Mock).mockRejectedValue(
        new Error('First error')
      );
      await component['onGenerateAgents']();

      expect(component['errorMessage']()).toBe('First error');

      (mockRpcService.submitAgentSelection as jest.Mock).mockResolvedValue(
        undefined
      );
      await component['onGenerateAgents']();

      expect(component['errorMessage']()).toBeNull();
    });

    it('should log error to console on failure', async () => {
      jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Test error');
      (mockRpcService.submitAgentSelection as jest.Mock).mockRejectedValue(
        error
      );

      await component['onGenerateAgents']();

      expect(console.error).toHaveBeenCalledWith(
        'Agent generation failed:',
        error
      );
    });
  });

  describe('Generate Button', () => {
    it('should display correct button text with singular agent', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      selectedCountSignal.set(1);
      canProceedSignal.set(true);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn-primary');
      expect(button.textContent).toContain('Generate 1 Agent');
    });

    it('should display correct button text with multiple agents', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: true,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      selectedCountSignal.set(2);
      canProceedSignal.set(true);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn-primary');
      expect(button.textContent).toContain('Generate 2 Agents');
    });

    it('should disable button when generating', async () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      selectedCountSignal.set(1);
      canProceedSignal.set(true);
      fixture.detectChanges();

      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      (mockRpcService.submitAgentSelection as jest.Mock).mockReturnValue(
        promise
      );

      component['onGenerateAgents']();
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn-primary');
      expect(button.disabled).toBe(true);

      resolvePromise!();
    });

    it('should disable button when canProceed is false', () => {
      canProceedSignal.set(false);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn-primary');
      expect(button.disabled).toBe(true);
    });
  });

  describe('Computed Signals', () => {
    // it('should compute total count', () => {
    //   const agents: AgentSelection[] = [
    //     {
    //       id: '1',
    //       name: 'Agent 1',
    //       selected: false,
    //       score: 90,
    //       reason: 'Test',
    //       autoInclude: false,
    //     },
    //     {
    //       id: '2',
    //       name: 'Agent 2',
    //       selected: false,
    //       score: 80,
    //       reason: 'Test',
    //       autoInclude: false,
    //     },
    //   ];
    //   availableAgentsSignal.set(agents);

    //   // expect(component['totalCount']()).toBe(2);
    // });

    // it('should compute allSelected correctly', () => {
    //   const agents: AgentSelection[] = [
    //     {
    //       id: '1',
    //       name: 'Agent 1',
    //       selected: false,
    //       score: 90,
    //       reason: 'Test',
    //       autoInclude: false,
    //     },
    //   ];
    //   availableAgentsSignal.set(agents);
    //   selectedCountSignal.set(1);

    //   // expect(component['allSelected']()).toBe(true);
    // });

    // it('should compute allSelected as false when not all selected', () => {
    //   const agents: AgentSelection[] = [
    //     {
    //       id: '1',
    //       name: 'Agent 1',
    //       selected: false,
    //       score: 90,
    //       reason: 'Test',
    //       autoInclude: false,
    //     },
    //     {
    //       id: '2',
    //       name: 'Agent 2',
    //       selected: false,
    //       score: 80,
    //       reason: 'Test',
    //       autoInclude: false,
    //     },
    //   ];
    //   availableAgentsSignal.set(agents);
    //   selectedCountSignal.set(1);

    //   expect(component['allSelected']()).toBe(false);
    // });

    // it('should compute allSelected as false when empty', () => {
    //   availableAgentsSignal.set([]);
    //   selectedCountSignal.set(0);

    //   expect(component['allSelected']()).toBe(false);
    // });

    it('should compute noneSelected correctly', () => {
      selectedCountSignal.set(0);

      expect(component['noneSelected']()).toBe(true);
    });

    it('should compute noneSelected as false when some selected', () => {
      selectedCountSignal.set(1);

      expect(component['noneSelected']()).toBe(false);
    });
  });

  describe('Accessibility', () => {
    it('should have accessible checkboxes', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Frontend Developer',
          selected: false,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      const checkbox = fixture.nativeElement.querySelector(
        'input[type="checkbox"]'
      );
      expect(checkbox.getAttribute('aria-label')).toContain(
        'Frontend Developer'
      );
    });

    it('should have proper heading hierarchy', () => {
      const h2 = fixture.nativeElement.querySelector('h2');
      expect(h2).toBeTruthy();
    });

    it('should have accessible table structure', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: false,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      fixture.detectChanges();

      const table = fixture.nativeElement.querySelector('table');
      const thead = table.querySelector('thead');
      const tbody = table.querySelector('tbody');
      expect(thead).toBeTruthy();
      expect(tbody).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty agent selection', async () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: false,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      canProceedSignal.set(false);
      (mockRpcService.submitAgentSelection as jest.Mock).mockResolvedValue(
        undefined
      );

      await component['onGenerateAgents']();

      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
    });

    it('should handle single agent selection', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      availableAgentsSignal.set(agents);
      selectedCountSignal.set(1);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge-outline');
      expect(badge.textContent).toContain('1 / 1 selected');
    });
  });
});
