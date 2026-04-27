import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WelcomeComponent } from './welcome.component';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * WelcomeComponent tests.
 *
 * The component now supports a dual-mode flow (existing analyses + new
 * project bootstrap), injecting both the state facade and the RPC service.
 * These tests assert component creation, the two entry-point handlers, and
 * the state transitions they trigger.
 */
describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRpcService: Partial<WizardRpcService>;

  beforeEach(async () => {
    mockStateService = {
      setCurrentStep: jest.fn(),
      setWizardPath: jest.fn(),
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

  describe('Start Setup (existing project)', () => {
    it('should set wizardPath to existing and advance to scan step', () => {
      component['onStartSetup']();

      expect(mockStateService.setWizardPath).toHaveBeenCalledWith('existing');
      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('scan');
    });
  });

  describe('Start Setup (new project)', () => {
    it('should set wizardPath to new and advance to project-type step', () => {
      component['onStartNewProject']();

      expect(mockStateService.setWizardPath).toHaveBeenCalledWith('new');
      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith(
        'project-type',
      );
    });
  });
});
