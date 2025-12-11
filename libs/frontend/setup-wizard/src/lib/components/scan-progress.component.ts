import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  ViewChild,
} from '@angular/core';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { ConfirmationModalComponent } from './confirmation-modal.component';

/**
 * ScanProgressComponent - Real-time workspace scan progress display
 *
 * Purpose:
 * - Show live file scanning progress (X of Y files)
 * - Display real-time detection updates (tech stack, frameworks, etc.)
 * - Provide cancel option with confirmation
 *
 * Features:
 * - Reactive progress bar based on files scanned / total files
 * - Live detection list with alert cards
 * - Percentage calculation computed signal
 * - Cancel button with confirmation prompt
 *
 * Usage:
 * ```html
 * <ptah-scan-progress />
 * ```
 */
@Component({
  selector: 'ptah-scan-progress',
  standalone: true,
  imports: [ConfirmationModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-12 max-w-3xl">
      <h2 class="text-4xl font-bold text-center mb-8">Analyzing Workspace</h2>

      @if (errorMessage(); as error) {
      <div class="alert alert-error mb-4" role="alert">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>{{ error }}</span>
      </div>
      } @if (progress(); as progressData) {
      <!-- Progress Bar -->
      <div class="mb-6">
        <div class="flex justify-between mb-2">
          <span class="text-sm font-medium text-base-content/80">
            Analyzing {{ progressData.filesScanned || 0 }} of
            {{ progressData.totalFiles || 0 }} files...
          </span>
          <span class="text-sm font-semibold text-base-content">
            {{ progressPercentage() }}%
          </span>
        </div>
        <progress
          class="progress progress-primary w-full h-3"
          [value]="progressPercentage()"
          max="100"
          role="progressbar"
          [attr.aria-valuenow]="progressPercentage()"
          [attr.aria-valuemin]="0"
          [attr.aria-valuemax]="100"
          [attr.aria-label]="
            'Workspace scan progress: ' +
            progressPercentage() +
            ' percent complete'
          "
        ></progress>
      </div>

      <!-- Detections List -->
      @if (progressData.detections && progressData.detections.length > 0) {
      <div class="space-y-3 mb-8">
        <h3 class="text-lg font-semibold text-base-content/80">Detections:</h3>
        @for (detection of progressData.detections; track detection) {
        <div class="alert alert-info shadow-md">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-6 h-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <span>{{ detection }}</span>
        </div>
        } @empty {
        <p class="text-base-content/60">
          Scanning for project characteristics...
        </p>
        }
      </div>
      } } @else {
      <!-- Fallback: No progress data yet -->
      <div class="flex flex-col items-center gap-4 py-12">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <p class="text-base-content/60">Initializing workspace scan...</p>
      </div>
      }

      <!-- Cancel Button -->
      <div class="flex justify-center mt-8">
        <button
          class="btn btn-ghost"
          [class.btn-disabled]="isCanceling()"
          [disabled]="isCanceling()"
          [attr.aria-busy]="isCanceling()"
          [attr.aria-label]="
            isCanceling() ? 'Canceling scan...' : 'Cancel scan'
          "
          (click)="onCancel()"
        >
          @if (isCanceling()) {
          <span class="loading loading-spinner"></span>
          Canceling... } @else if (errorMessage()) { Retry Cancel } @else {
          Cancel Scan }
        </button>
      </div>
    </div>

    <!-- Confirmation Modal -->
    <ptah-confirmation-modal
      #confirmModal
      [title]="'Cancel Scan?'"
      [message]="
        'Are you sure you want to cancel the scan? Progress will be lost.'
      "
      [confirmText]="'Yes, Cancel Scan'"
      [cancelText]="'No, Continue'"
      [confirmClass]="'btn-error'"
      (confirmed)="onConfirmCancellation()"
      (cancelled)="onDeclineCancellation()"
    />
  `,
})
export class ScanProgressComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  @ViewChild('confirmModal') confirmModal!: ConfirmationModalComponent;

  /**
   * Reactive progress data from state service
   * Direct signal reference for optimal performance
   */
  protected readonly progress = this.wizardState.generationProgress;

  /**
   * Calculated progress percentage (0-100)
   * Handles division by zero and null cases
   */
  protected readonly progressPercentage = computed(() => {
    const progressData = this.progress();
    if (!progressData?.totalFiles || progressData.totalFiles === 0) {
      return 0;
    }
    const scanned = progressData.filesScanned || 0;
    return Math.round((scanned / progressData.totalFiles) * 100);
  });

  // Component-local cancellation state and error state
  protected readonly isCanceling = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Handle cancel button click
   * - Show DaisyUI confirmation modal
   */
  protected async onCancel(): Promise<void> {
    if (this.isCanceling()) {
      return; // Prevent double-click
    }

    // Show confirmation modal
    this.confirmModal.show();
  }

  /**
   * Handle modal confirmation (user confirmed cancellation)
   * - Trigger RPC cancel call
   * - Reset wizard state ONLY on success
   * - Show error message on failure (allow retry)
   */
  protected async onConfirmCancellation(): Promise<void> {
    this.isCanceling.set(true);
    this.errorMessage.set(null);

    try {
      // Trigger RPC cancel (saveProgress = false for scan step)
      await this.wizardRpc.cancelWizard(false);

      // Success - reset wizard state to welcome
      this.wizardState.reset();
    } catch (error) {
      // Handle RPC error - show user-facing message, DON'T reset state
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to cancel scan. Please try again.';
      this.errorMessage.set(message);
      console.error('Scan cancellation failed:', error);
    } finally {
      // Only reset isCanceling if no error occurred
      if (!this.errorMessage()) {
        this.isCanceling.set(false);
      } else {
        // On error, allow user to retry - reset loading state
        this.isCanceling.set(false);
      }
    }
  }

  /**
   * Handle modal cancellation (user declined cancellation)
   * - Do nothing, modal auto-closes
   */
  protected onDeclineCancellation(): void {
    // Modal auto-closes, no action needed
  }
}
