import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WelcomeComponent } from './welcome.component';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

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

  beforeEach(async () => {
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Start Setup', () => {
    it('should advance to scan step', () => {
      component['onStartSetup']();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('scan');
    });
  });
});
