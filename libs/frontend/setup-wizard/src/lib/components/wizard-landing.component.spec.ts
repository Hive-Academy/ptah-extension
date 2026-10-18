import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import {
  ModelStateService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import type { SavedAnalysisMetadata } from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { WizardLandingComponent } from './wizard-landing.component';

describe('WizardLandingComponent', () => {
  it('offers generation without saved analysis and opens a bound workflow tab', async () => {
    const savedAnalyses = signal<SavedAnalysisMetadata[]>([]);
    const loadSavedAnalysis = jest.fn();
    const setCurrentStep = jest.fn();
    const open = jest
      .fn()
      .mockResolvedValue({ outcome: 'landed', tabId: 'tab-1' });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SetupWizardStateService,
          useValue: {
            savedAnalyses,
            setSavedAnalyses: savedAnalyses.set.bind(savedAnalyses),
            setCurrentStep,
            loadSavedAnalysis,
            setRecommendations: jest.fn(),
          },
        },
        {
          provide: WizardRpcService,
          useValue: {
            listAnalyses: jest.fn().mockResolvedValue([]),
            loadAnalysis: jest.fn().mockResolvedValue({ isMultiPhase: true }),
            recommendAgents: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/workspace' },
        },
        { provide: GenerationWorkflowLauncherService, useValue: { open } },
        {
          provide: ProvidersSettingsStateService,
          useValue: {
            connections: signal({ data: [] }),
            activeProviderId: signal(null),
            writeScopes: () => [],
            reviewContext: () => null,
            open: jest.fn().mockResolvedValue(undefined),
            activateConnection: jest.fn(),
          },
        },
        {
          provide: ModelStateService,
          useValue: {
            availableModels: signal([]),
            currentModel: signal(''),
            isPending: signal(false),
            switchModel: jest.fn(),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(WizardLandingComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Generation works without one',
    );
    fixture.nativeElement.querySelector('ptah-workflow-card button').click();
    await fixture.whenStable();
    expect(open).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      workflow: 'setup-agent-generation',
      origin: 'wizard-landing',
    });
    fixture.nativeElement
      .querySelectorAll('ptah-workflow-card button')[1]
      .click();
    await fixture.whenStable();
    expect(open).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      workflow: 'setup-project-prompt',
      origin: 'wizard-landing',
    });
    open.mockResolvedValueOnce({ outcome: 'cancelled' });
    fixture.nativeElement.querySelector('ptah-workflow-card button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(
      'This workflow could not be opened',
    );
    const provider: HTMLSelectElement = fixture.nativeElement.querySelector(
      '#landing-analysis-provider',
    );
    expect(provider.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'Global provider fallback is read-only',
    );
    savedAnalyses.set([
      {
        filename: 'saved',
        projectType: 'Angular',
        phaseCount: 4,
        savedAt: '2026-10-16',
        model: 'model-a',
        durationMs: 1000,
      },
    ]);
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[aria-label="Use this analysis"]')
      .click();
    await fixture.whenStable();
    expect(loadSavedAnalysis).toHaveBeenCalled();
    expect(setCurrentStep).toHaveBeenCalledWith('analysis');
  });
});
