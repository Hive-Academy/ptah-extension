import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, TriangleAlert } from 'lucide-angular';
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
    LucideAngularModule,
    ConfirmationModalComponent,
    ArchitecturePatternsCardComponent,
    KeyFileLocationsCardComponent,
    CodeHealthCardComponent,
    TechStackSummaryComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-3 py-4">
      <h2 class="text-xl font-semibold mb-4">Analysis Complete</h2>

      @if (deepAnalysis(); as analysis) {
      <!-- 2-Column Grid Layout -->
      <div class="grid grid-cols-2 gap-4 mb-4">
        <!-- Left Column: Tech Stack Summary -->
        <div>
          <ptah-tech-stack-summary
            [projectType]="analysis.projectType"
            [projectTypeDescription]="analysis.projectTypeDescription"
            [fileCount]="analysis.fileCount"
            [frameworks]="analysis.frameworks"
            [monorepoType]="analysis.monorepoType"
            [languageDistribution]="analysis.languageDistribution"
          />
        </div>

        <!-- Right Column: Architecture Patterns + Code Health -->
        <div class="space-y-4">
          @if (analysis.architecturePatterns &&
          analysis.architecturePatterns.length > 0) {
          <ptah-architecture-patterns-card
            [patterns]="analysis.architecturePatterns"
          />
          } @if (analysis.existingIssues && analysis.testCoverage) {
          <ptah-code-health-card
            [issues]="analysis.existingIssues"
            [testCoverage]="analysis.testCoverage"
          />
          }
        </div>
      </div>

      <!-- Full-Width: Key File Locations -->
      @if (analysis.keyFileLocations) {
      <ptah-key-file-locations-card [locations]="analysis.keyFileLocations" />
      }

      <!-- Confirmation Warning -->
      <div class="alert alert-warning text-xs mb-4">
        <lucide-angular
          [img]="TriangleAlertIcon"
          class="stroke-current shrink-0 h-4 w-4"
          aria-hidden="true"
        />
        <div>
          <div class="font-semibold">Does this look correct?</div>
          <div class="text-xs opacity-80">
            The agents we generate will be tailored to these characteristics.
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2 justify-center">
        <button class="btn btn-ghost btn-sm" (click)="onManualAdjust()">
          No, Let Me Adjust
        </button>
        <button class="btn btn-primary btn-sm" (click)="onContinue()">
          Yes, Continue
        </button>
      </div>

      } @else { @if (projectContext(); as context) {
      <!-- Fallback: Show basic project context if deep analysis not available -->
      <div class="border border-base-300 rounded-md bg-base-200/50 mb-4">
        <div class="p-4">
          <h3 class="text-sm font-medium uppercase tracking-wide mb-3">
            Detected Project Details
          </h3>

          <div class="space-y-3">
            <!-- Project Type -->
            <div>
              <span class="font-semibold text-base-content/80 text-xs"
                >Project Type:</span
              >
              <span class="ml-2 badge badge-primary badge-sm">{{
                context.type
              }}</span>
            </div>

            <!-- Tech Stack -->
            <div>
              <span class="font-semibold text-base-content/80 text-xs"
                >Tech Stack:</span
              >
              <div class="flex flex-wrap gap-2 mt-1">
                @for (tech of context.techStack; track tech) {
                <span class="badge badge-secondary badge-sm">{{ tech }}</span>
                } @empty {
                <span class="text-base-content/60 text-xs"
                  >No tech stack detected</span
                >
                }
              </div>
            </div>

            <!-- Architecture (if present) -->
            @if (context.architecture) {
            <div>
              <span class="font-semibold text-base-content/80 text-xs"
                >Architecture:</span
              >
              <span class="ml-2 text-base-content text-xs">{{
                context.architecture
              }}</span>
            </div>
            }

            <!-- Monorepo Information -->
            <div>
              <span class="font-semibold text-base-content/80 text-xs"
                >Monorepo:</span
              >
              @if (context.isMonorepo) {
              <span class="ml-2 text-success text-xs">
                Yes @if (context.monorepoType) {
                <span class="text-base-content/60 text-xs"
                  >({{ context.monorepoType }})</span
                >
                } @if (context.packageCount) {
                <span class="text-base-content/60 text-xs"
                  >- {{ context.packageCount }} packages</span
                >
                }
              </span>
              } @else {
              <span class="ml-2 text-base-content/60 text-xs">No</span>
              }
            </div>
          </div>
        </div>
      </div>

      <!-- Confirmation Warning -->
      <div class="alert alert-warning text-xs mb-4">
        <lucide-angular
          [img]="TriangleAlertIcon"
          class="stroke-current shrink-0 h-4 w-4"
          aria-hidden="true"
        />
        <div>
          <div class="font-semibold">Does this look correct?</div>
          <div class="text-xs opacity-80">
            The agents we generate will be tailored to these characteristics.
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2 justify-center">
        <button class="btn btn-ghost btn-sm" (click)="onManualAdjust()">
          No, Let Me Adjust
        </button>
        <button class="btn btn-primary btn-sm" (click)="onContinue()">
          Yes, Continue
        </button>
      </div>

      } @else {
      <!-- Skeleton loading state (no context available) -->
      <div class="space-y-4">
        <!-- Skeleton: Tech Stack Summary -->
        <div class="border border-base-300 rounded-md bg-base-200/50">
          <div class="p-4">
            <div class="skeleton h-4 w-48 mb-2"></div>
            <div class="flex flex-wrap gap-2 mb-2">
              <div class="skeleton h-4 w-20 rounded-full"></div>
              <div class="skeleton h-4 w-24 rounded-full"></div>
              <div class="skeleton h-4 w-16 rounded-full"></div>
            </div>
            <div class="skeleton h-3 w-full mb-1"></div>
            <div class="skeleton h-3 w-3/4"></div>
          </div>
        </div>

        <!-- Skeleton: Architecture Patterns -->
        <div class="border border-base-300 rounded-md bg-base-200/50">
          <div class="p-4">
            <div class="skeleton h-4 w-56 mb-2"></div>
            <div class="space-y-2">
              <div class="skeleton h-6 w-full"></div>
              <div class="skeleton h-6 w-full"></div>
            </div>
          </div>
        </div>

        <!-- Skeleton: Action Buttons -->
        <div class="flex gap-2 justify-center">
          <div class="skeleton h-8 w-28 rounded-lg"></div>
          <div class="skeleton h-8 w-28 rounded-lg"></div>
        </div>
      </div>
      } }
    </div>

    <!-- Alert Modal for Future Enhancement -->
    <ptah-confirmation-modal
      #alertModal
      title="Manual Adjustment Coming Soon"
      [message]="confirmationMessage"
      [mode]="'alert'"
      [confirmText]="'OK'"
      (confirmed)="onAlertOk()"
    />
  `,
})
export class AnalysisResultsComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  protected readonly TriangleAlertIcon = TriangleAlert;

  readonly alertModal =
    viewChild.required<ConfirmationModalComponent>('alertModal');

  public readonly confirmationMessage = `Manual adjustment is coming soon!
For now, you can:
1. Continue with detected settings
2. Cancel and manually configure your .claude folder
3. Contact support for custom configuration help`;
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
    this.alertModal().show();
  }

  /**
   * Handle alert modal OK button
   * - Modal auto-closes
   */
  protected onAlertOk(): void {
    // Modal auto-closes, no action needed
  }
}
