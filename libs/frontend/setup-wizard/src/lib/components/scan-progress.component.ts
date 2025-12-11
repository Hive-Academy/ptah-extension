import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

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
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-12 max-w-3xl">
      <h2 class="text-4xl font-bold text-center mb-8">Analyzing Workspace</h2>

      @if (progress(); as progressData) {
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
          (click)="onCancel()"
        >
          @if (isCanceling()) {
          <span class="loading loading-spinner"></span>
          Canceling... } @else { Cancel Scan }
        </button>
      </div>
    </div>
  `,
})
export class ScanProgressComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  /**
   * Reactive progress data from state service
   * Computed signal automatically updates when generationProgress changes
   */
  protected readonly progress = computed(() => {
    return this.wizardState.generationProgress();
  });

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

  // Component-local cancellation state
  protected readonly isCanceling = signal(false);

  /**
   * Handle cancel button click
   * - Show confirmation (user might lose progress)
   * - Trigger RPC cancel call
   * - Reset wizard state on success
   */
  protected async onCancel(): Promise<void> {
    if (this.isCanceling()) {
      return; // Prevent double-click
    }

    // Confirmation check
    const confirmed = await this.confirmCancel();
    if (!confirmed) {
      return;
    }

    this.isCanceling.set(true);

    try {
      // Trigger RPC cancel (saveProgress = false for scan step)
      await this.wizardRpc.cancelWizard(false);

      // Reset wizard state to welcome
      this.wizardState.reset();
    } catch (error) {
      // Handle RPC error silently (user already saw confirmation)
      console.error('Failed to cancel wizard:', error);
      // Even if RPC fails, reset local state
      this.wizardState.reset();
    } finally {
      this.isCanceling.set(false);
    }
  }

  /**
   * Show native confirmation dialog
   * Note: In VS Code webview, this might need ConfirmationDialogService
   * For now, using basic confirm() - can be replaced with DaisyUI modal
   */
  private async confirmCancel(): Promise<boolean> {
    // TODO: Replace with ConfirmationDialogService for VS Code webview compatibility
    return new Promise((resolve) => {
      const result = window.confirm(
        'Are you sure you want to cancel the scan? Progress will be lost.'
      );
      resolve(result);
    });
  }
}
