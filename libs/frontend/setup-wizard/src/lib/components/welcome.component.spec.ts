import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WelcomeComponent } from './welcome.component';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import {
  ModelStateService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';

/**
 * WelcomeComponent tests.
 *
 * The welcome screen is the analysis entry point: it loads saved analyses
 * and advances the wizard to the scan step. New-project creation lives in
 * the harness builder, not the wizard.
 */
describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRpcService: Partial<WizardRpcService>;
  const availableModels = signal<
    Array<{ id: string; name?: string }>
  >([]);
  const currentModel = signal('');
  const connections = signal<{
    status: 'ready';
    data: Array<{ id: string; name: string; configured: boolean }>;
  }>({ status: 'ready', data: [] });
  const activeProviderId = signal<string | null>('');

  beforeEach(async () => {
    availableModels.set([]);
    currentModel.set('');
    connections.set({ status: 'ready', data: [] });
    activeProviderId.set('');
    mockStateService = {
      setCurrentStep: jest.fn(),
      setSavedAnalyses: jest.fn(),
      savedAnalyses: signal([]).asReadonly(),
    } as unknown as Partial<SetupWizardStateService>;

    mockRpcService = {
      listAnalyses: jest.fn().mockResolvedValue([]),
      loadAnalysis: jest.fn(),
      recommendAgents: jest.fn(),
    } as unknown as Partial<WizardRpcService>;

    await TestBed.configureTestingModule({
      imports: [WelcomeComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: WizardRpcService, useValue: mockRpcService },
        {
          provide: ModelStateService,
          useValue: {
            availableModels: availableModels.asReadonly(),
            currentModel: currentModel.asReadonly(),
            currentModelInfo: signal(null).asReadonly(),
            isPending: signal(false).asReadonly(),
            refreshModels: jest.fn(),
            switchModel: jest.fn(),
          },
        },
        {
          provide: ProvidersSettingsStateService,
          useValue: {
            connections: connections.asReadonly(),
            activeProviderId: activeProviderId.asReadonly(),
            reviewContext: jest.fn(() => ({})),
            open: jest.fn(),
            activateConnection: jest.fn(),
            refreshRoute: jest.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows placeholders for unmatched selections and handles choosing the first options', async () => {
    connections.set({
      status: 'ready',
      data: [
        { id: 'provider-a', name: 'Provider A', configured: true },
        { id: 'provider-b', name: 'Provider B', configured: true },
      ],
    });
    activeProviderId.set(null);
    availableModels.set([
      { id: 'model-a', name: 'Model A' },
      { id: 'model-b', name: 'Model B' },
    ]);
    currentModel.set('');
    fixture.detectChanges();

    const providerSelect = fixture.nativeElement.querySelector(
      '#wizard-provider-select',
    ) as HTMLSelectElement;
    const modelSelect = fixture.nativeElement.querySelector(
      '#wizard-model-select',
    ) as HTMLSelectElement;

    expect(providerSelect.value).toBe('');
    expect(providerSelect.options[0].text).toBe('Select a provider');
    expect(modelSelect.value).toBe('');
    expect(modelSelect.options[0].text).toBe('Select a model');

    providerSelect.value = 'provider-a';
    providerSelect.dispatchEvent(new Event('change'));
    modelSelect.value = 'model-a';
    modelSelect.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(
      TestBed.inject(ProvidersSettingsStateService).activateConnection,
    ).toHaveBeenCalledWith('provider-a', 'global', expect.any(Object));
    expect(
      TestBed.inject(ModelStateService).switchModel,
    ).toHaveBeenCalledWith('model-a');
  });

  describe('Start Setup', () => {
    it('should advance to scan step', () => {
      component['onStartSetup']();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('scan');
    });
  });
});
