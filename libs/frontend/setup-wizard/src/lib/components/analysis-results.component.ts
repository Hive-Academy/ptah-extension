import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  ViewChild,
  signal,
} from '@angular/core';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { ConfirmationModalComponent } from './confirmation-modal.component';

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
 * - Card layout with project context details
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
  imports: [ConfirmationModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-12 max-w-4xl">
      <h2 class="text-4xl font-bold text-center mb-8">Analysis Complete</h2>

      @if (deepAnalysis(); as analysis) {
      <!-- Project Overview Card -->
      <div class="card bg-base-200 shadow-xl mb-6">
        <div class="card-body">
          <h3 class="card-title text-2xl mb-4">Project Overview</h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Project Type -->
            <div>
              <span class="font-semibold text-base-content/80"
                >Project Type:</span
              >
              <span class="ml-2 badge badge-primary badge-lg">{{
                analysis.projectType
              }}</span>
            </div>

            <!-- File Count -->
            <div>
              <span class="font-semibold text-base-content/80"
                >Total Files:</span
              >
              <span class="ml-2 text-base-content">{{
                analysis.fileCount | number
              }}</span>
            </div>

            <!-- Frameworks -->
            <div class="md:col-span-2">
              <span class="font-semibold text-base-content/80"
                >Frameworks:</span
              >
              <div class="flex flex-wrap gap-2 mt-2">
                @for (framework of analysis.frameworks; track framework) {
                <span class="badge badge-secondary">{{ framework }}</span>
                } @empty {
                <span class="text-base-content/60 text-sm"
                  >No frameworks detected</span
                >
                }
              </div>
            </div>

            <!-- Monorepo Information -->
            @if (analysis.monorepoType) {
            <div class="md:col-span-2">
              <span class="font-semibold text-base-content/80">Monorepo:</span>
              <span class="ml-2 text-success">
                Yes
                <span class="text-base-content/60 text-sm"
                  >({{ analysis.monorepoType }})</span
                >
              </span>
            </div>
            }
          </div>
        </div>
      </div>

      <!-- Architecture Patterns Card -->
      @if (analysis.architecturePatterns && analysis.architecturePatterns.length
      > 0) {
      <div class="card bg-base-200 shadow-xl mb-6">
        <div class="card-body">
          <h3 class="card-title text-xl mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            Architecture Patterns Detected
          </h3>

          <div class="space-y-4">
            @for (pattern of analysis.architecturePatterns; track pattern.name)
            {
            <div class="p-4 bg-base-100 rounded-lg">
              <div class="flex justify-between items-center mb-2">
                <span class="font-semibold">{{ pattern.name }}</span>
                <span
                  class="badge"
                  [class]="getConfidenceBadgeClass(pattern.confidence)"
                >
                  {{ pattern.confidence }}% confidence
                </span>
              </div>
              <progress
                class="progress w-full"
                [class]="getConfidenceProgressClass(pattern.confidence)"
                [value]="pattern.confidence"
                max="100"
                [attr.aria-label]="
                  pattern.name +
                  ' confidence: ' +
                  pattern.confidence +
                  ' percent'
                "
              ></progress>
              @if (pattern.description) {
              <p class="text-sm text-base-content/70 mt-2">
                {{ pattern.description }}
              </p>
              } @if (pattern.evidence && pattern.evidence.length > 0) {
              <div class="mt-2">
                <span class="text-xs text-base-content/60">Evidence: </span>
                <span class="text-xs text-base-content/60">{{
                  pattern.evidence.slice(0, 3).join(', ')
                }}</span>
                @if (pattern.evidence.length > 3) {
                <span class="text-xs text-base-content/60">
                  +{{ pattern.evidence.length - 3 }} more</span
                >
                }
              </div>
              }
            </div>
            }
          </div>
        </div>
      </div>
      }

      <!-- Key File Locations Card (Collapsible) -->
      @if (analysis.keyFileLocations) {
      <div class="card bg-base-200 shadow-xl mb-6">
        <div class="card-body">
          <h3 class="card-title text-xl mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            Key File Locations
          </h3>

          <div class="space-y-2">
            <!-- Entry Points -->
            @if (analysis.keyFileLocations.entryPoints?.length) {
            <div tabindex="0" class="collapse collapse-arrow bg-base-100">
              <div class="collapse-title font-medium">
                Entry Points
                <span class="badge badge-sm badge-ghost ml-2">{{
                  analysis.keyFileLocations.entryPoints.length
                }}</span>
              </div>
              <div class="collapse-content">
                <ul class="text-sm text-base-content/80 space-y-1">
                  @for (file of analysis.keyFileLocations.entryPoints; track
                  file) {
                  <li class="font-mono text-xs truncate" [title]="file">
                    {{ file }}
                  </li>
                  }
                </ul>
              </div>
            </div>
            }

            <!-- Config Files -->
            @if (analysis.keyFileLocations.configs?.length) {
            <div tabindex="0" class="collapse collapse-arrow bg-base-100">
              <div class="collapse-title font-medium">
                Configuration Files
                <span class="badge badge-sm badge-ghost ml-2">{{
                  analysis.keyFileLocations.configs.length
                }}</span>
              </div>
              <div class="collapse-content">
                <ul class="text-sm text-base-content/80 space-y-1">
                  @for (file of analysis.keyFileLocations.configs.slice(0, 10);
                  track file) {
                  <li class="font-mono text-xs truncate" [title]="file">
                    {{ file }}
                  </li>
                  } @if (analysis.keyFileLocations.configs.length > 10) {
                  <li class="text-xs text-base-content/60">
                    +{{ analysis.keyFileLocations.configs.length - 10 }} more
                    files
                  </li>
                  }
                </ul>
              </div>
            </div>
            }

            <!-- Test Directories -->
            @if (analysis.keyFileLocations.testDirectories?.length) {
            <div tabindex="0" class="collapse collapse-arrow bg-base-100">
              <div class="collapse-title font-medium">
                Test Directories
                <span class="badge badge-sm badge-ghost ml-2">{{
                  analysis.keyFileLocations.testDirectories.length
                }}</span>
              </div>
              <div class="collapse-content">
                <ul class="text-sm text-base-content/80 space-y-1">
                  @for (dir of analysis.keyFileLocations.testDirectories; track
                  dir) {
                  <li class="font-mono text-xs truncate" [title]="dir">
                    {{ dir }}
                  </li>
                  }
                </ul>
              </div>
            </div>
            }

            <!-- Components -->
            @if (analysis.keyFileLocations.components?.length) {
            <div tabindex="0" class="collapse collapse-arrow bg-base-100">
              <div class="collapse-title font-medium">
                Components
                <span class="badge badge-sm badge-ghost ml-2">{{
                  analysis.keyFileLocations.components.length
                }}</span>
              </div>
              <div class="collapse-content">
                <ul class="text-sm text-base-content/80 space-y-1">
                  @for (dir of analysis.keyFileLocations.components.slice(0,
                  10); track dir) {
                  <li class="font-mono text-xs truncate" [title]="dir">
                    {{ dir }}
                  </li>
                  } @if (analysis.keyFileLocations.components.length > 10) {
                  <li class="text-xs text-base-content/60">
                    +{{ analysis.keyFileLocations.components.length - 10 }} more
                  </li>
                  }
                </ul>
              </div>
            </div>
            }

            <!-- Services -->
            @if (analysis.keyFileLocations.services?.length) {
            <div tabindex="0" class="collapse collapse-arrow bg-base-100">
              <div class="collapse-title font-medium">
                Services
                <span class="badge badge-sm badge-ghost ml-2">{{
                  analysis.keyFileLocations.services.length
                }}</span>
              </div>
              <div class="collapse-content">
                <ul class="text-sm text-base-content/80 space-y-1">
                  @for (dir of analysis.keyFileLocations.services.slice(0, 10);
                  track dir) {
                  <li class="font-mono text-xs truncate" [title]="dir">
                    {{ dir }}
                  </li>
                  } @if (analysis.keyFileLocations.services.length > 10) {
                  <li class="text-xs text-base-content/60">
                    +{{ analysis.keyFileLocations.services.length - 10 }} more
                  </li>
                  }
                </ul>
              </div>
            </div>
            }

            <!-- API Routes -->
            @if (analysis.keyFileLocations.apiRoutes?.length) {
            <div tabindex="0" class="collapse collapse-arrow bg-base-100">
              <div class="collapse-title font-medium">
                API Routes
                <span class="badge badge-sm badge-ghost ml-2">{{
                  analysis.keyFileLocations.apiRoutes.length
                }}</span>
              </div>
              <div class="collapse-content">
                <ul class="text-sm text-base-content/80 space-y-1">
                  @for (route of analysis.keyFileLocations.apiRoutes.slice(0,
                  10); track route) {
                  <li class="font-mono text-xs truncate" [title]="route">
                    {{ route }}
                  </li>
                  } @if (analysis.keyFileLocations.apiRoutes.length > 10) {
                  <li class="text-xs text-base-content/60">
                    +{{ analysis.keyFileLocations.apiRoutes.length - 10 }} more
                  </li>
                  }
                </ul>
              </div>
            </div>
            }
          </div>
        </div>
      </div>
      }

      <!-- Code Health Card -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <!-- Language Distribution -->
        @if (analysis.languageDistribution &&
        analysis.languageDistribution.length > 0) {
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body">
            <h3 class="card-title text-lg mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
              Language Distribution
            </h3>

            <div class="space-y-3">
              @for (lang of analysis.languageDistribution; track lang.language)
              {
              <div>
                <div class="flex justify-between text-sm mb-1">
                  <span class="font-medium">{{ lang.language }}</span>
                  <span class="text-base-content/70"
                    >{{ lang.percentage }}% ({{ lang.fileCount }} files)</span
                  >
                </div>
                <progress
                  class="progress progress-info w-full"
                  [value]="lang.percentage"
                  max="100"
                  [attr.aria-label]="
                    lang.language + ': ' + lang.percentage + ' percent'
                  "
                ></progress>
              </div>
              }
            </div>
          </div>
        </div>
        }

        <!-- Diagnostics & Test Coverage -->
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body">
            <h3 class="card-title text-lg mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Code Health
            </h3>

            <!-- Existing Issues -->
            @if (analysis.existingIssues) {
            <div class="mb-4">
              <span class="text-sm font-semibold text-base-content/80"
                >Existing Issues:</span
              >
              <div class="flex gap-3 mt-2">
                <div class="badge badge-error gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {{ analysis.existingIssues.errorCount }} errors
                </div>
                <div class="badge badge-warning gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  {{ analysis.existingIssues.warningCount }} warnings
                </div>
                @if (analysis.existingIssues.infoCount) {
                <div class="badge badge-info gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {{ analysis.existingIssues.infoCount }} info
                </div>
                }
              </div>
            </div>
            }

            <!-- Test Coverage -->
            @if (analysis.testCoverage) {
            <div>
              <span class="text-sm font-semibold text-base-content/80"
                >Test Coverage Estimate:</span
              >
              <div class="mt-2">
                @if (analysis.testCoverage.hasTests) {
                <div class="flex items-center gap-2 mb-2">
                  <div
                    class="radial-progress text-primary"
                    [style]="
                      '--value:' +
                      analysis.testCoverage.percentage +
                      '; --size:4rem;'
                    "
                    role="progressbar"
                    [attr.aria-valuenow]="analysis.testCoverage.percentage"
                  >
                    {{ analysis.testCoverage.percentage }}%
                  </div>
                  <div class="text-sm">
                    @if (analysis.testCoverage.testFramework) {
                    <div class="badge badge-outline badge-sm">
                      {{ analysis.testCoverage.testFramework }}
                    </div>
                    }
                    <div class="flex flex-wrap gap-1 mt-1">
                      @if (analysis.testCoverage.hasUnitTests) {
                      <span class="badge badge-success badge-xs">Unit</span>
                      } @if (analysis.testCoverage.hasIntegrationTests) {
                      <span class="badge badge-success badge-xs"
                        >Integration</span
                      >
                      } @if (analysis.testCoverage.hasE2eTests) {
                      <span class="badge badge-success badge-xs">E2E</span>
                      }
                    </div>
                  </div>
                </div>
                } @else {
                <div class="text-sm text-base-content/60">
                  <span class="badge badge-ghost">No tests detected</span>
                </div>
                }
              </div>
            </div>
            }
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

      } @else if (projectContext(); as context) {
      <!-- Fallback: Show basic project context if deep analysis not available -->
      <div class="card bg-base-200 shadow-xl mb-6">
        <div class="card-body">
          <h3 class="card-title text-2xl mb-4">Detected Project Details</h3>

          <div class="space-y-4">
            <!-- Project Type -->
            <div>
              <span class="font-semibold text-base-content/80"
                >Project Type:</span
              >
              <span class="ml-2 badge badge-primary badge-lg">{{
                context.type
              }}</span>
            </div>

            <!-- Tech Stack -->
            <div>
              <span class="font-semibold text-base-content/80"
                >Tech Stack:</span
              >
              <div class="flex flex-wrap gap-2 mt-2">
                @for (tech of context.techStack; track tech) {
                <span class="badge badge-secondary">{{ tech }}</span>
                } @empty {
                <span class="text-base-content/60 text-sm"
                  >No tech stack detected</span
                >
                }
              </div>
            </div>

            <!-- Architecture (if present) -->
            @if (context.architecture) {
            <div>
              <span class="font-semibold text-base-content/80"
                >Architecture:</span
              >
              <span class="ml-2 text-base-content">{{
                context.architecture
              }}</span>
            </div>
            }

            <!-- Monorepo Information -->
            <div>
              <span class="font-semibold text-base-content/80">Monorepo:</span>
              @if (context.isMonorepo) {
              <span class="ml-2 text-success">
                Yes @if (context.monorepoType) {
                <span class="text-base-content/60 text-sm"
                  >({{ context.monorepoType }})</span
                >
                } @if (context.packageCount) {
                <span class="text-base-content/60 text-sm"
                  >- {{ context.packageCount }} packages</span
                >
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
      [message]="
        'Manual adjustment is coming soon!

For now, you can:
1. Continue with detected settings
2. Cancel and manually configure your .claude folder
3. Contact support for custom configuration help'
      "
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
   * Get badge class based on confidence score.
   * High confidence (>= 80): success
   * Medium confidence (>= 60): warning
   * Low confidence (< 60): error
   */
  protected getConfidenceBadgeClass(confidence: number): string {
    if (confidence >= 80) return 'badge-success';
    if (confidence >= 60) return 'badge-warning';
    return 'badge-error';
  }

  /**
   * Get progress bar class based on confidence score.
   */
  protected getConfidenceProgressClass(confidence: number): string {
    if (confidence >= 80) return 'progress-success';
    if (confidence >= 60) return 'progress-warning';
    return 'progress-error';
  }

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
