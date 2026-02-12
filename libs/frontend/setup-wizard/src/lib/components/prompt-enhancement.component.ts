import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import {
  CircleAlert,
  CircleCheck,
  LucideAngularModule,
  RotateCw,
  SkipForward,
  Sparkles,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { AnalysisTranscriptComponent } from './analysis-transcript.component';

/**
 * PromptEnhancementComponent - Dedicated wizard step for Enhanced Prompts generation
 *
 * Purpose:
 * - Auto-trigger Enhanced Prompts generation on entry
 * - Display progress spinner during generation
 * - Show detected tech stack on success
 * - Show error with retry on failure
 * - Provide Skip and Continue buttons
 *
 * Usage:
 * ```html
 * <ptah-prompt-enhancement />
 * ```
 */
@Component({
  selector: 'ptah-prompt-enhancement',
  standalone: true,
  imports: [LucideAngularModule, AnalysisTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-3 py-4">
      <!-- Header -->
      <div class="mb-2 text-center">
        <h2 class="text-lg font-semibold mb-1">Enhance Your Prompts</h2>
        <p class="text-xs text-base-content/70">
          Generate project-specific guidance to improve AI responses for your
          codebase.
        </p>
      </div>

      <!-- Status Card -->
      <div class="border border-base-300 rounded-md bg-base-200/50 mb-4">
        <div class="p-3">
          @switch (status()) { @case ('idle') {
          <div class="flex flex-col items-center gap-2 py-3">
            <span
              class="loading loading-spinner loading-sm text-warning"
            ></span>
            <p class="text-xs text-base-content/70 text-center">
              Preparing to generate project-specific guidance...
            </p>
          </div>
          } @case ('generating') {
          <div class="flex flex-col items-center gap-2 py-3">
            <span
              class="loading loading-spinner loading-sm text-warning"
            ></span>
            <p class="text-sm text-base-content/70 text-center">
              Generating project-specific prompt guidance from analysis data...
            </p>
            <p class="text-sm text-base-content/50">
              This may take a minute while the AI crafts tailored instructions.
            </p>
          </div>
          } @case ('complete') {
          <div class="flex flex-col items-center gap-2 py-3">
            <lucide-angular
              [img]="CircleCheckIcon"
              class="h-8 w-8 text-success"
              aria-hidden="true"
            />
            <div class="text-center">
              <p class="font-semibold text-sm mb-1">
                Enhanced prompts generated successfully!
              </p>
              @if (detectedStack().length > 0) {
              <p class="text-sm text-base-content/70 mb-2">Detected stack:</p>
              <div class="flex flex-wrap justify-center gap-1">
                @for (tech of detectedStack(); track tech) {
                <span class="badge badge-info badge-sm">{{ tech }}</span>
                }
              </div>
              }
            </div>
          </div>
          } @case ('error') {
          <div class="flex flex-col items-center gap-2 py-3">
            <lucide-angular
              [img]="CircleAlertIcon"
              class="h-8 w-8 text-error"
              aria-hidden="true"
            />
            <div class="text-center">
              <p class="font-semibold text-sm mb-1">
                Failed to generate enhanced prompts
              </p>
              @if (errorMsg()) {
              <p class="text-sm text-error mb-2">
                {{ errorMsg() }}
              </p>
              }
              <button
                class="btn btn-error btn-sm"
                (click)="onRetry()"
                aria-label="Retry enhanced prompts generation"
              >
                <lucide-angular
                  [img]="RotateCwIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                Retry
              </button>
            </div>
          </div>
          } @case ('skipped') {
          <div class="flex flex-col items-center gap-2 py-3">
            <lucide-angular
              [img]="SkipForwardIcon"
              class="h-8 w-8 text-base-content/40"
              aria-hidden="true"
            />
            <p class="text-sm text-base-content/60">
              Enhanced prompts generation skipped.
            </p>
          </div>
          } }
        </div>
      </div>

      <!-- Agent Activity (collapsible stream transcript) -->
      @if (hasStreamMessages()) {
      <div class="collapse collapse-arrow bg-base-200 mb-3">
        <input type="checkbox" aria-label="Toggle agent activity log" />
        <div class="collapse-title text-sm font-medium">
          Agent Activity
          <span class="badge badge-sm ml-2">{{ streamMessageCount() }}</span>
        </div>
        <div class="collapse-content">
          <ptah-analysis-transcript [messages]="enhanceStream()" />
        </div>
      </div>
      }

      <!-- Footer Buttons -->
      <div class="flex justify-between items-center">
        <button
          class="btn btn-ghost btn-sm"
          (click)="onSkip()"
          aria-label="Skip enhanced prompts generation"
        >
          <lucide-angular
            [img]="SkipForwardIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          Skip
        </button>
        <button
          class="btn btn-primary btn-sm"
          [disabled]="!canContinue()"
          (click)="onContinue()"
          aria-label="Continue to generation step"
        >
          <lucide-angular
            [img]="SparklesIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          Continue to Generation
        </button>
      </div>
    </div>
  `,
})
export class PromptEnhancementComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly CircleAlertIcon = CircleAlert;
  protected readonly RotateCwIcon = RotateCw;
  protected readonly SkipForwardIcon = SkipForward;
  protected readonly SparklesIcon = Sparkles;

  protected readonly status = this.wizardState.enhancedPromptsStatus;
  protected readonly errorMsg = this.wizardState.enhancedPromptsError;

  protected readonly detectedStack = computed(() => {
    return this.wizardState.enhancedPromptsDetectedStack() ?? [];
  });

  protected readonly canContinue = computed(() => {
    const s = this.status();
    return s === 'complete' || s === 'error' || s === 'skipped';
  });

  /**
   * Enhance stream messages from state service for the activity log transcript.
   */
  protected readonly enhanceStream = this.wizardState.enhanceStream;

  /**
   * Whether there are any enhance stream messages to display.
   */
  protected readonly hasStreamMessages = computed(
    () => this.enhanceStream().length > 0
  );

  /**
   * Count of enhance stream messages for the badge.
   */
  protected readonly streamMessageCount = computed(
    () => this.enhanceStream().length
  );

  /**
   * Auto-trigger enhanced prompts generation when status is idle.
   * Uses queueMicrotask to avoid signal writes during effect execution.
   */
  private readonly autoTriggerEffect = effect(() => {
    const currentStatus = this.status();
    if (currentStatus === 'idle') {
      queueMicrotask(() => this.triggerEnhancedPrompts());
    }
  });

  /**
   * Trigger Enhanced Prompts generation via RPC.
   * Forwards the stored deep analysis from wizard Step 1 as the single source of truth.
   */
  private async triggerEnhancedPrompts(): Promise<void> {
    this.wizardState.setEnhancedPromptsStatus('generating');

    try {
      const workspacePath = '.';
      const analysis = this.wizardState.deepAnalysis();

      if (!analysis) {
        this.wizardState.setEnhancedPromptsStatus('error');
        this.wizardState.setEnhancedPromptsError(
          'No analysis data available. Please re-run the wizard scan.'
        );
        return;
      }

      const result = await this.wizardRpc.runEnhancedPromptsWizard(
        workspacePath,
        analysis
      );

      if (result.success) {
        this.wizardState.setEnhancedPromptsStatus('complete');

        if (result.detectedStack) {
          const stackLabels = [
            ...(result.detectedStack.frameworks ?? []),
            ...(result.detectedStack.languages ?? []),
          ].filter(Boolean);
          this.wizardState.setEnhancedPromptsDetectedStack(stackLabels);
        }
      } else {
        const isPremiumError =
          result.error?.toLowerCase().includes('premium') ||
          result.error?.toLowerCase().includes('upgrade');

        if (isPremiumError) {
          this.wizardState.setEnhancedPromptsStatus('skipped');
          this.wizardState.setEnhancedPromptsError(null);
        } else {
          this.wizardState.setEnhancedPromptsStatus('error');
          this.wizardState.setEnhancedPromptsError(
            result.error ?? 'Failed to generate Enhanced Prompts'
          );
        }
      }
    } catch (error) {
      this.wizardState.setEnhancedPromptsStatus('error');
      this.wizardState.setEnhancedPromptsError(
        error instanceof Error ? error.message : 'Unexpected error'
      );
    }
  }

  /**
   * Skip enhanced prompts generation and advance to generation step.
   */
  protected onSkip(): void {
    this.wizardState.setEnhancedPromptsStatus('skipped');
    this.wizardState.setCurrentStep('generation');
  }

  /**
   * Continue to the generation step.
   */
  protected onContinue(): void {
    this.wizardState.setCurrentStep('generation');
  }

  /**
   * Retry enhanced prompts generation by resetting status to idle.
   * The effect will re-trigger generation automatically.
   */
  protected onRetry(): void {
    this.wizardState.setEnhancedPromptsError(null);
    this.wizardState.setEnhancedPromptsStatus('idle');
  }
}
