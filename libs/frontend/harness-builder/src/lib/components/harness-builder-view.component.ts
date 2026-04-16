/**
 * HarnessBuilderViewComponent
 *
 * Main shell component for the Harness Setup Builder wizard.
 * This is the top-level component injected via HARNESS_BUILDER_COMPONENT DI token.
 *
 * Layout:
 * - Header with title and close button
 * - Horizontal step indicator (HarnessStepperComponent)
 * - Two-panel body: step content (left) + AI chat panel (right)
 * - Footer with Back/Next navigation buttons
 *
 * On init, calls harness:initialize to populate workspace context,
 * available agents, skills, and presets.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import {
  LucideAngularModule,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-angular';
import { WebviewNavigationService } from '@ptah-extension/core';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessRpcService } from '../services/harness-rpc.service';
import { HarnessStreamingService } from '../services/harness-streaming.service';
import { HarnessStepperComponent } from './harness-stepper.component';
import { HarnessChatPanelComponent } from './harness-chat-panel.component';
import { HarnessExecutionViewComponent } from './harness-execution-view.component';
import { DescribeStepComponent } from './steps/describe-step.component';
import { AgentsStepComponent } from './steps/agents-step.component';
import { SkillsStepComponent } from './steps/skills-step.component';
import { PromptsStepComponent } from './steps/prompts-step.component';
import { McpStepComponent } from './steps/mcp-step.component';
import { ReviewStepComponent } from './steps/review-step.component';
import type { HarnessWizardStep } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-harness-builder-view',
  standalone: true,
  imports: [
    LucideAngularModule,
    HarnessStepperComponent,
    HarnessChatPanelComponent,
    HarnessExecutionViewComponent,
    DescribeStepComponent,
    AgentsStepComponent,
    SkillsStepComponent,
    PromptsStepComponent,
    McpStepComponent,
    ReviewStepComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }
    `,
  ],
  template: `
    <!-- Loading state -->
    @if (isInitializing()) {
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <lucide-angular
            [img]="Loader2Icon"
            class="w-8 h-8 animate-spin text-primary mx-auto"
            aria-hidden="true"
          />
          <p class="mt-3 text-sm text-base-content/60">
            Initializing Harness Builder...
          </p>
        </div>
      </div>
    }

    <!-- Error state -->
    @else if (initError()) {
      <div class="flex items-center justify-center h-full">
        <div class="alert alert-error max-w-md">
          <span>{{ initError() }}</span>
          <button class="btn btn-sm" (click)="initializeBuilder()">
            Retry
          </button>
        </div>
      </div>
    }

    <!-- Main wizard -->
    @else {
      <!-- Header -->
      <header
        class="flex items-center justify-between px-4 py-3 border-b border-base-300 bg-base-100 shrink-0"
      >
        <h1 class="text-base font-bold text-base-content">
          Harness Setup Builder
        </h1>
        <button
          class="btn btn-ghost btn-sm btn-circle"
          (click)="close()"
          aria-label="Close harness builder"
        >
          <lucide-angular [img]="XIcon" class="w-4 h-4" aria-hidden="true" />
        </button>
      </header>

      <!-- Stepper -->
      <div class="px-4 py-3 border-b border-base-300 bg-base-100 shrink-0">
        <ptah-harness-stepper
          [currentStep]="currentStep()"
          [completedSteps]="completedSteps()"
          (stepClicked)="onStepClicked($event)"
        />
      </div>

      <!-- Body: execution takeover OR step content + chat panel -->
      @if (showExecutionView()) {
        <div class="flex-1 min-h-0 overflow-hidden">
          <ptah-harness-execution-view />
        </div>
      } @else {
        <div class="flex flex-1 min-h-0 overflow-hidden">
          <!-- Step content -->
          <main class="flex-1 overflow-y-auto p-4" role="main">
            @switch (currentStep()) {
              @case ('persona') {
                <ptah-describe-step />
              }
              @case ('agents') {
                <ptah-agents-step />
              }
              @case ('skills') {
                <ptah-skills-step />
              }
              @case ('prompts') {
                <ptah-prompts-step />
              }
              @case ('mcp') {
                <ptah-mcp-step />
              }
              @case ('review') {
                <ptah-review-step />
              }
            }
          </main>

          <!-- AI Chat Panel (right side) -->
          <aside class="w-72 border-l border-base-300 shrink-0 hidden md:block">
            <ptah-harness-chat-panel />
          </aside>
        </div>
      }

      <!-- Footer navigation -->
      <footer
        class="flex items-center justify-between px-4 py-3 border-t border-base-300 bg-base-100 shrink-0"
      >
        <button
          class="btn btn-outline btn-sm gap-1"
          (click)="previousStep()"
          [disabled]="isFirstStep()"
        >
          <lucide-angular
            [img]="ChevronLeftIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          Back
        </button>

        <span class="text-xs text-base-content/50">
          Step {{ currentStepIndex() + 1 }} of 6
        </span>

        @if (!isLastStep()) {
          <button
            class="btn btn-primary btn-sm gap-1"
            (click)="nextStep()"
            [disabled]="!canProceed()"
          >
            Next
            <lucide-angular
              [img]="ChevronRightIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
          </button>
        } @else {
          <!-- On the review step, the apply button is inside the step content -->
          <div></div>
        }
      </footer>
    }
  `,
})
export class HarnessBuilderViewComponent implements OnInit {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly navigation = inject(WebviewNavigationService);
  private readonly streaming = inject(HarnessStreamingService);

  // Icons
  protected readonly XIcon = X;
  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly Loader2Icon = Loader2;

  // Expose individual readonly signals for the template
  readonly currentStep = this.state.currentStep;
  readonly completedSteps = this.state.completedSteps;
  readonly isFirstStep = this.state.isFirstStep;
  readonly isLastStep = this.state.isLastStep;
  readonly canProceed = this.state.canProceed;
  readonly currentStepIndex = this.state.currentStepIndex;

  readonly showExecutionView = computed(
    () =>
      this.streaming.isStreaming() ||
      this.streaming.completionResult() !== null,
  );

  // Initialization state
  public readonly isInitializing = signal(true);
  public readonly initError = signal<string | null>(null);

  public ngOnInit(): void {
    this.initializeBuilder();
  }

  public async initializeBuilder(): Promise<void> {
    this.isInitializing.set(true);
    this.initError.set(null);

    try {
      const response = await this.rpc.initialize();
      this.state.initialize(response);
    } catch (err) {
      this.initError.set(
        err instanceof Error
          ? err.message
          : 'Failed to initialize harness builder',
      );
    } finally {
      this.isInitializing.set(false);
    }
  }

  public close(): void {
    const cfg = this.state.config();
    const hasConfig =
      cfg.persona || cfg.agents || cfg.skills || cfg.prompt || cfg.mcp;
    if (hasConfig) {
      if (
        !confirm('You have unsaved changes. Are you sure you want to close?')
      ) {
        return;
      }
    }
    this.state.reset();
    this.navigation.navigateToView('chat');
  }

  public nextStep(): void {
    this.state.nextStep();
  }

  public previousStep(): void {
    this.state.previousStep();
  }

  public onStepClicked(step: HarnessWizardStep): void {
    if (
      this.state.completedSteps().has(step) ||
      step === this.state.currentStep()
    ) {
      this.state.goToStep(step);
    }
  }
}
