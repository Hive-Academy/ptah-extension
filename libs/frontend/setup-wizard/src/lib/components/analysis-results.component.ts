import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  ViewChild,
} from '@angular/core';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { ConfirmationModalComponent } from './confirmation-modal.component';
import { ArchitecturePatternsCardComponent } from './analysis/architecture-patterns-card.component';
import { KeyFileLocationsCardComponent } from './analysis/key-file-locations-card.component';
import { CodeHealthCardComponent } from './analysis/code-health-card.component';
import { TechStackSummaryComponent } from './analysis/tech-stack-summary.component';

/**
 * AnalysisResultsComponent - Display detected project characteristics with deep analysis
 *
 * Purpose:
 * - Show detected project type, tech stack, architecture patterns
 * - Display key file locations grouped by type (collapsible)
 * - Show language distribution statistics
 * - Display existing issues count (errors, warnings)
 * - Show test coverage estimate
 * - Get user confirmation before proceeding
 *
 * Features:
 * - Composed of sub-components for maintainability
 * - Architecture patterns with confidence score progress bars
 * - Collapsible sections for key file locations
 * - Language distribution list with percentages
 * - Diagnostics summary (errors, warnings)
 * - Test coverage indicator
 * - Monorepo information (if detected)
 *
 * Usage:
 * ```html
 * <ptah-analysis-results />
 * ```
 */
@Component({
  selector: 'ptah-analysis-results',
  standalone: true,
  imports: [
    ConfirmationModalComponent,
    ArchitecturePatternsCardComponent,
    KeyFileLocationsCardComponent,
    CodeHealthCardComponent,
    TechStackSummaryComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-12 max-w-4xl">
      <h2 class="text-4xl font-bold text-center mb-8">Analysis Complete</h2>

      @if (deepAnalysis(); as analysis) {
        <!-- Tech Stack Summary (Project Overview + Language Distribution) -->
        <ptah-tech-stack-summary
          [projectType]="analysis.projectType"
          [fileCount]="analysis.fileCount"
          [frameworks]="analysis.frameworks"
          [monorepoType]="analysis.monorepoType"
          [languageDistribution]="analysis.languageDistribution"
        />

        <!-- Architecture Patterns Card -->
        @if (analysis.architecturePatterns && analysis.architecturePatterns.length > 0) {
          <ptah-architecture-patterns-card [patterns]="analysis.architecturePatterns" />
        }

        <!-- Key File Locations Card -->
        @if (analysis.keyFileLocations) {
          <ptah-key-file-locations-card [locations]="analysis.keyFileLocations" />
        }

        <!-- Code Health Card (Diagnostics + Test Coverage) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          @if (analysis.existingIssues && analysis.testCoverage) {
            <ptah-code-health-card
              [issues]="analysis.existingIssues"
              [testCoverage]="analysis.testCoverage"
            />
          }
        </div>

        <!-- Confirmation Warning -->
        <div class="alert alert-warning shadow-md mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <div class="font-semibold">Does this look correct?</div>
            <div class="text-sm text-base-content/80">
              The agents we generate will be tailored to these characteristics.
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-4 justify-center">
          <button class="btn btn-ghost" (click)="onManualAdjust()">
            No, Let Me Adjust
          </button>
          <button class="btn btn-primary" (click)="onContinue()">
            Yes, Continue
          </button>
        </div>

      } @else if (projectContext(); as context) {
        <!-- Fallback: Show basic project context if deep analysis not available -->
        <div class="card bg-base-200 shadow-xl mb-6">
          <div class="card-body">
            <h3 class="card-title text-2xl mb-4">Detected Project Details</h3>

            <div class="space-y-4">
              <!-- Project Type -->
              <div>
                <span class="font-semibold text-base-content/80">Project Type:</span>
                <span class="ml-2 badge badge-primary badge-lg">{{ context.type }}</span>
              </div>

              <!-- Tech Stack -->
              <div>
                <span class="font-semibold text-base-content/80">Tech Stack:</span>
                <div class="flex flex-wrap gap-2 mt-2">
                  @for (tech of context.techStack; track tech) {
                    <span class="badge badge-secondary">{{ tech }}</span>
                  } @empty {
                    <span class="text-base-content/60 text-sm">No tech stack detected</span>
                  }
                </div>
              </div>

              <!-- Architecture (if present) -->
              @if (context.architecture) {
                <div>
                  <span class="font-semibold text-base-content/80">Architecture:</span>
                  <span class="ml-2 text-base-content">{{ context.architecture }}</span>
                </div>
              }

              <!-- Monorepo Information -->
              <div>
                <span class="font-semibold text-base-content/80">Monorepo:</span>
                @if (context.isMonorepo) {
                  <span class="ml-2 text-success">
                    Yes
                    @if (context.monorepoType) {
                      <span class="text-base-content/60 text-sm">({{ context.monorepoType }})</span>
                    }
                    @if (context.packageCount) {
                      <span class="text-base-content/60 text-sm">- {{ context.packageCount }} packages</span>
                    }
                  </span>
                } @else {
                  <span class="ml-2 text-base-content/60">No</span>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Confirmation Warning -->
        <div class="alert alert-warning shadow-md mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <div class="font-semibold">Does this look correct?</div>
            <div class="text-sm text-base-content/80">
              The agents we generate will be tailored to these characteristics.
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-4 justify-center">
          <button class="btn btn-ghost" (click)="onManualAdjust()">
            No, Let Me Adjust
          </button>
          <button class="btn btn-primary" (click)="onContinue()">
            Yes, Continue
          </button>
        </div>

      } @else {
        <!-- Fallback: No project context yet -->
        <div class="flex flex-col items-center gap-4 py-12">
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <p class="text-base-content/60">Loading analysis results...</p>
        </div>
      }
    </div>

    <!-- Alert Modal for Future Enhancement -->
    <ptah-confirmation-modal
      #alertModal
      [title]="'Manual Adjustment Coming Soon'"
      [message]="'Manual adjustment is coming soon!

For now, you can:
1. Continue with detected settings
2. Cancel and manually configure your .claude folder
3. Contact support for custom configuration help'"
      [mode]="'alert'"
      [confirmText]="'OK'"
      (confirmed)="onAlertOk()"
    />
  `,
})
export class AnalysisResultsComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  @ViewChild('alertModal') alertModal!: ConfirmationModalComponent;

  /**
   * Reactive deep analysis from state service.
   * Contains comprehensive project insights from MCP-powered analysis.
   */
  protected readonly deepAnalysis = computed(() => {
    return this.wizardState.deepAnalysis();
  });

  /**
   * Reactive project context from state service (fallback).
   * Used when deep analysis is not available.
   */
  protected readonly projectContext = computed(() => {
    return this.wizardState.projectContext();
  });

  /**
   * Handle "Yes, Continue" button click
   * - User confirmed analysis results
   * - Transition to agent selection step
   */
  protected onContinue(): void {
    this.wizardState.setCurrentStep('selection');
  }

  /**
   * Handle "No, Let Me Adjust" button click
   * - Show DaisyUI modal for future enhancement notice
   */
  protected onManualAdjust(): void {
    this.alertModal.show();
  }

  /**
   * Handle alert modal OK button
   * - Modal auto-closes
   */
  protected onAlertOk(): void {
    // Modal auto-closes, no action needed
  }
}
