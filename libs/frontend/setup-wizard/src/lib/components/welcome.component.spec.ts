import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WelcomeComponent } from './welcome.component';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * WelcomeComponent tests.
 *
 * The welcome screen has two entry points: existing-project analysis (drives
 * the wizard locally) and new-project chat handoff (delegates to the backend
 * via WizardRpcService.startNewProjectChat). These tests assert component
 * creation and the two entry-point handlers.
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
      startNewProjectChat: jest.fn().mockResolvedValue(undefined),
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

  describe('Start Setup (existing project)', () => {
    it('should advance to scan step', () => {
      component['onStartSetup']();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('scan');
    });
  });

  describe('Start Setup (new project)', () => {
    it('should delegate to wizardRpc.startNewProjectChat', async () => {
      await component['onStartNewProject']();

      expect(mockRpcService.startNewProjectChat).toHaveBeenCalled();
    });

    it('should swallow RPC errors and log them', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {
        /* silence */
      });
      (mockRpcService.startNewProjectChat as jest.Mock).mockRejectedValueOnce(
        new Error('boom'),
      );

      await expect(component['onStartNewProject']()).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalled();

      errSpy.mockRestore();
    });
  });
});
