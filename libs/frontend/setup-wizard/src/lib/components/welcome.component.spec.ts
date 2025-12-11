import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WelcomeComponent } from './welcome.component';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;
  let mockStateService: any;
  let mockRpcService: any;

  beforeEach(async () => {
    mockStateService = {
      setCurrentStep: jest.fn(),
    };
    mockRpcService = {
      startSetupWizard: jest.fn(),
    };

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

  describe('Initial State', () => {
    it('should initialize with isStarting as false', () => {
      expect(component['isStarting']()).toBe(false);
    });

    it('should initialize with null error message', () => {
      expect(component['errorMessage']()).toBeNull();
    });

    it('should display welcome heading', () => {
      const heading = fixture.nativeElement.querySelector('h1');
      expect(heading.textContent).toContain(
        "Let's Personalize Your Ptah Experience"
      );
    });

    it('should display estimated time', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Estimated time: 2-4 minutes');
    });

    it('should display start button', () => {
      const button = fixture.nativeElement.querySelector('button');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('Start Setup');
    });
  });

  describe('Start Setup', () => {
    it('should call RPC service when start button clicked', async () => {
      mockRpcService.startSetupWizard.mockResolvedValue(undefined);

      const button = fixture.nativeElement.querySelector('button');
      button.click();

      await fixture.whenStable();

      expect(mockRpcService.startSetupWizard).toHaveBeenCalled();
    });

    it('should transition to scan step on success', async () => {
      mockRpcService.startSetupWizard.mockResolvedValue(undefined);

      await component['onStartSetup']();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('scan');
    });

    it('should show loading state while starting', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      mockRpcService.startSetupWizard.mockReturnValue(promise);

      const startPromise = component['onStartSetup']();

      expect(component['isStarting']()).toBe(true);

      resolvePromise!();
      await startPromise;

      expect(component['isStarting']()).toBe(false);
    });

    it('should display error message on failure', async () => {
      const errorMessage = 'RPC timeout';
      mockRpcService.startSetupWizard.mockRejectedValue(
        new Error(errorMessage)
      );

      await component['onStartSetup']();

      expect(component['errorMessage']()).toBe(errorMessage);
    });

    it('should display default error message for non-Error failures', async () => {
      mockRpcService.startSetupWizard.mockRejectedValue('String error');

      await component['onStartSetup']();

      expect(component['errorMessage']()).toBe(
        'Failed to start setup wizard. Please try again.'
      );
    });

    it('should clear previous error message on new attempt', async () => {
      mockRpcService.startSetupWizard.mockRejectedValue(
        new Error('First error')
      );
      await component['onStartSetup']();

      expect(component['errorMessage']()).toBe('First error');

      mockRpcService.startSetupWizard.mockResolvedValue(undefined);
      await component['onStartSetup']();

      expect(component['errorMessage']()).toBeNull();
    });

    it('should reset loading state on error', async () => {
      mockRpcService.startSetupWizard.mockRejectedValue(
        new Error('Test error')
      );

      await component['onStartSetup']();

      expect(component['isStarting']()).toBe(false);
    });

    it('should prevent double-click while starting', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      mockRpcService.startSetupWizard.mockReturnValue(promise);

      component['onStartSetup']();
      component['onStartSetup']();

      expect(mockRpcService.startSetupWizard).toHaveBeenCalledTimes(1);

      resolvePromise!();
    });
  });

  describe('UI States', () => {
    it('should show error alert when error message exists', async () => {
      mockRpcService.startSetupWizard.mockRejectedValue(
        new Error('Test error')
      );

      await component['onStartSetup']();
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('.alert-error');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Test error');
    });

    it('should hide error alert when no error message', () => {
      const alert = fixture.nativeElement.querySelector('.alert-error');
      expect(alert).toBeFalsy();
    });

    it('should disable button while starting', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      mockRpcService.startSetupWizard.mockReturnValue(promise);

      component['onStartSetup']();
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button');
      expect(button.disabled).toBe(true);
      expect(button.classList.contains('btn-disabled')).toBe(true);

      resolvePromise!();
    });

    it('should show loading spinner while starting', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      mockRpcService.startSetupWizard.mockReturnValue(promise);

      component['onStartSetup']();
      fixture.detectChanges();

      const spinner = fixture.nativeElement.querySelector('.loading-spinner');
      expect(spinner).toBeTruthy();

      resolvePromise!();
    });

    it('should set aria-busy attribute while starting', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      mockRpcService.startSetupWizard.mockReturnValue(promise);

      component['onStartSetup']();
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button');
      expect(button.getAttribute('aria-busy')).toBe('true');

      resolvePromise!();
    });

    it('should update aria-label based on state', async () => {
      const button = fixture.nativeElement.querySelector('button');
      expect(button.getAttribute('aria-label')).toBe('Start wizard setup');

      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      mockRpcService.startSetupWizard.mockReturnValue(promise);

      component['onStartSetup']();
      fixture.detectChanges();

      expect(button.getAttribute('aria-label')).toBe(
        'Starting wizard setup...'
      );

      resolvePromise!();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      const h1 = fixture.nativeElement.querySelector('h1');
      expect(h1).toBeTruthy();
    });

    it('should have accessible button text', () => {
      const button = fixture.nativeElement.querySelector('button');
      expect(button.textContent.trim()).toBeTruthy();
    });

    it('should have error alert with role', async () => {
      mockRpcService.startSetupWizard.mockRejectedValue(
        new Error('Test error')
      );
      await component['onStartSetup']();
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('.alert-error');
      expect(alert.getAttribute('role')).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle RPC service throwing synchronous error', async () => {
      mockRpcService.startSetupWizard.mockImplementation(() => {
        throw new Error('Sync error');
      });

      try {
        await component['onStartSetup']();
      } catch (error) {
        // Expected
      }

      expect(component['isStarting']()).toBe(false);
    });

    it('should handle null error', async () => {
      mockRpcService.startSetupWizard.mockRejectedValue(null);

      await component['onStartSetup']();

      expect(component['errorMessage']()).toBe(
        'Failed to start setup wizard. Please try again.'
      );
    });

    it('should handle undefined error', async () => {
      mockRpcService.startSetupWizard.mockRejectedValue(undefined);

      await component['onStartSetup']();

      expect(component['errorMessage']()).toBe(
        'Failed to start setup wizard. Please try again.'
      );
    });
  });
});
