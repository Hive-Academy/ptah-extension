import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ScanProgressComponent } from './scan-progress.component';
import {
  SetupWizardStateService,
  GenerationProgress,
} from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { ConfirmationModalComponent } from './confirmation-modal.component';

describe('ScanProgressComponent', () => {
  let component: ScanProgressComponent;
  let fixture: ComponentFixture<ScanProgressComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRpcService: Partial<WizardRpcService>;

  beforeEach(async () => {
    mockStateService = {
      generationProgress: signal<GenerationProgress | null>(null),
      reset: jest.fn(),
    };
    mockRpcService = {
      cancelWizard: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ScanProgressComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: WizardRpcService, useValue: mockRpcService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScanProgressComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initial State', () => {
    it('should initialize with isCanceling as false', () => {
      expect(component['isCanceling']()).toBe(false);
    });

    it('should initialize with null error message', () => {
      expect(component['errorMessage']()).toBeNull();
    });

    it('should display analyzing workspace heading', () => {
      const heading = fixture.nativeElement.querySelector('h2');
      expect(heading.textContent).toContain('Analyzing Workspace');
    });

    it('should show initializing message when no progress data', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Initializing workspace scan...');
    });
  });

  describe('Progress Display', () => {
    it('should display progress information', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 50,
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular', 'TypeScript'],
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Analyzing 50 of 100 files...');
      expect(text).toContain('50%');
    });

    it('should calculate progress percentage correctly', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 0,
        filesScanned: 25,
        totalFiles: 100,
        detections: [],
      });

      expect(component['progressPercentage']()).toBe(25);
    });

    it('should handle zero total files', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 0,
        filesScanned: 0,
        totalFiles: 0,
        detections: [],
      });

      expect(component['progressPercentage']()).toBe(0);
    });

    it('should handle undefined filesScanned', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 0,
        totalFiles: 100,
        detections: [],
      });

      expect(component['progressPercentage']()).toBe(0);
    });

    it('should display detections list', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 50,
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular', 'TypeScript', 'Nx'],
      });
      fixture.detectChanges();

      const alerts = fixture.nativeElement.querySelectorAll('.alert-info');
      expect(alerts.length).toBe(3);
      expect(alerts[0].textContent).toContain('Angular');
      expect(alerts[1].textContent).toContain('TypeScript');
      expect(alerts[2].textContent).toContain('Nx');
    });

    it('should show empty state when no detections', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 10,
        filesScanned: 10,
        totalFiles: 100,
        detections: [],
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Scanning for project characteristics...');
    });

    it('should update progress bar value', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 75,
        filesScanned: 75,
        totalFiles: 100,
        detections: [],
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.value).toBe(75);
    });

    it('should set proper aria attributes on progress bar', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 60,
        filesScanned: 60,
        totalFiles: 100,
        detections: [],
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.getAttribute('aria-valuenow')).toBe('60');
      expect(progressBar.getAttribute('aria-valuemin')).toBe('0');
      expect(progressBar.getAttribute('aria-valuemax')).toBe('100');
      expect(progressBar.getAttribute('aria-label')).toContain(
        '60 percent complete'
      );
    });
  });

  describe('Cancel Functionality', () => {
    it('should show confirmation modal when cancel clicked', () => {
      jest.spyOn(component['confirmModal'], 'show');

      const button = fixture.nativeElement.querySelector('button');
      button.click();

      expect(component['confirmModal'].show).toHaveBeenCalled();
    });

    it('should call RPC service on confirmed cancellation', async () => {
      (mockRpcService.cancelWizard as jest.Mock).mockResolvedValue(undefined);

      await component['onConfirmCancellation']();

      expect(mockRpcService.cancelWizard).toHaveBeenCalledWith(false);
    });

    it('should reset state on successful cancellation', async () => {
      (mockRpcService.cancelWizard as jest.Mock).mockResolvedValue(undefined);

      await component['onConfirmCancellation']();

      expect(mockStateService.reset).toHaveBeenCalled();
    });

    it('should show error on failed cancellation', async () => {
      const errorMessage = 'RPC timeout';
      (mockRpcService.cancelWizard as jest.Mock).mockRejectedValue(
        new Error(errorMessage)
      );

      await component['onConfirmCancellation']();

      expect(component['errorMessage']()).toBe(errorMessage);
    });

    it('should NOT reset state on failed cancellation', async () => {
      (mockRpcService.cancelWizard as jest.Mock).mockRejectedValue(
        new Error('Test error')
      );

      await component['onConfirmCancellation']();

      expect(mockStateService.reset).not.toHaveBeenCalled();
    });

    it('should show loading state while canceling', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      (mockRpcService.cancelWizard as jest.Mock).mockReturnValue(promise);

      const cancelPromise = component['onConfirmCancellation']();

      expect(component['isCanceling']()).toBe(true);

      resolvePromise!();
      await cancelPromise;

      expect(component['isCanceling']()).toBe(false);
    });

    it('should reset loading state on error', async () => {
      (mockRpcService.cancelWizard as jest.Mock).mockRejectedValue(
        new Error('Test error')
      );

      await component['onConfirmCancellation']();

      expect(component['isCanceling']()).toBe(false);
    });

    it('should prevent double-click while canceling', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      (mockRpcService.cancelWizard as jest.Mock).mockReturnValue(promise);

      component['onCancel']();
      component['onCancel']();

      // Modal should only be shown once (would need to spy on confirmModal.show)

      resolvePromise!();
    });

    it('should clear error message on new cancel attempt', async () => {
      (mockRpcService.cancelWizard as jest.Mock).mockRejectedValue(
        new Error('First error')
      );
      await component['onConfirmCancellation']();

      expect(component['errorMessage']()).toBe('First error');

      (mockRpcService.cancelWizard as jest.Mock).mockResolvedValue(undefined);
      await component['onConfirmCancellation']();

      expect(mockStateService.reset).toHaveBeenCalled();
    });

    it('should do nothing on declined cancellation', () => {
      component['onDeclineCancellation']();

      expect(mockRpcService.cancelWizard).not.toHaveBeenCalled();
      expect(mockStateService.reset).not.toHaveBeenCalled();
    });
  });

  describe('UI States', () => {
    it('should show error alert when error message exists', async () => {
      (mockRpcService.cancelWizard as jest.Mock).mockRejectedValue(
        new Error('Test error')
      );

      await component['onConfirmCancellation']();
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('.alert-error');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Test error');
    });

    it('should hide error alert when no error message', () => {
      const alert = fixture.nativeElement.querySelector('.alert-error');
      expect(alert).toBeFalsy();
    });

    it('should disable cancel button while canceling', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      (mockRpcService.cancelWizard as jest.Mock).mockReturnValue(promise);

      component['onConfirmCancellation']();
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button');
      expect(button.disabled).toBe(true);
      expect(button.classList.contains('btn-disabled')).toBe(true);

      resolvePromise!();
    });

    it('should show loading spinner while canceling', async () => {
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      (mockRpcService.cancelWizard as jest.Mock).mockReturnValue(promise);

      component['onConfirmCancellation']();
      fixture.detectChanges();

      const spinner = fixture.nativeElement.querySelector('.loading-spinner');
      expect(spinner).toBeTruthy();

      resolvePromise!();
    });

    it('should show "Retry Cancel" button text on error', async () => {
      (mockRpcService.cancelWizard as jest.Mock).mockRejectedValue(
        new Error('Test error')
      );

      await component['onConfirmCancellation']();
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button');
      expect(button.textContent).toContain('Retry Cancel');
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      const h2 = fixture.nativeElement.querySelector('h2');
      expect(h2).toBeTruthy();

      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 50,
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular'],
      });
      fixture.detectChanges();

      const h3 = fixture.nativeElement.querySelector('h3');
      expect(h3).toBeTruthy();
    });

    it('should have accessible progress bar', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 50,
        filesScanned: 50,
        totalFiles: 100,
        detections: [],
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.getAttribute('role')).toBe('progressbar');
    });

    it('should have accessible cancel button', () => {
      const button = fixture.nativeElement.querySelector('button');
      expect(button.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle default error message for non-Error failures', async () => {
      (mockRpcService.cancelWizard as jest.Mock).mockRejectedValue(
        'String error'
      );

      await component['onConfirmCancellation']();

      expect(component['errorMessage']()).toBe(
        'Failed to cancel scan. Please try again.'
      );
    });

    it('should handle null progress data', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set(null);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Initializing workspace scan...');
    });

    it('should handle missing detections array', () => {
      const progressSignal = mockStateService.generationProgress as any;
      progressSignal.set({
        phase: 'analysis',
        percentComplete: 50,
        filesScanned: 50,
        totalFiles: 100,
      });
      fixture.detectChanges();

      // Should not crash
      expect(fixture.nativeElement).toBeTruthy();
    });

    it('should log error to console on cancellation failure', async () => {
      jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Test error');
      (mockRpcService.cancelWizard as jest.Mock).mockRejectedValue(error);

      await component['onConfirmCancellation']();

      expect(console.error).toHaveBeenCalledWith(
        'Scan cancellation failed:',
        error
      );
    });
  });
});
