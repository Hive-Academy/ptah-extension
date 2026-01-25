import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, XCircle, Info } from 'lucide-angular';
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
  imports: [LucideAngularModule, ConfirmationModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-12 max-w-3xl">
      <h2 class="text-4xl font-bold text-center mb-8">Analyzing Workspace</h2>

      @if (errorMessage(); as error) {
      <div class="alert alert-error mb-4" role="alert">
        <lucide-angular
          [img]="XCircleIcon"
          class="h-6 w-6 shrink-0 stroke-current"
          aria-hidden="true"
        />
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
          <lucide-angular
            [img]="InfoIcon"
            class="stroke-current shrink-0 w-6 h-6"
            aria-hidden="true"
          />
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

  protected readonly XCircleIcon = XCircle;
  protected readonly InfoIcon = Info;

  readonly confirmModal =
    viewChild.required<ConfirmationModalComponent>('confirmModal');

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
    this.confirmModal().show();
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
