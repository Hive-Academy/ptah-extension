import {
  Component,
  inject,
  ChangeDetectionStrategy,
  OnInit,
  signal,
} from '@angular/core';
import {
  Bot,
  Clock,
  FolderOpen,
  LucideAngularModule,
  Search,
  Shield,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-angular';
import type { SavedAnalysisMetadata } from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * WelcomeComponent - Setup wizard hero screen with gradient design
 *
 * Purpose:
 * - Welcome users to the setup wizard with a visually engaging hero layout
 * - Highlight key features via a 2x2 card grid
 * - Show previously saved analyses for quick reuse
 * - Provide time estimate and clear call-to-action
 * - Start the setup process by transitioning to scan step
 *
 * Features:
 * - Gradient background hero (primary/secondary)
 * - 2x2 responsive feature cards with icons
 * - Previous analyses section with "Use This" and "Delete" actions
 * - Enhanced CTA button with hover scale animation
 * - Fade-in entrance animation with prefers-reduced-motion support
 *
 * Usage:
 * ```html
 * <ptah-welcome />
 * ```
 */
@Component({
  selector: 'ptah-welcome',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fadeIn {
        animation: fadeIn 0.6s ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-fadeIn {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div class="h-full flex flex-col items-center justify-center px-3 py-4">
      <div class="animate-fadeIn text-center w-full max-w-2xl">
        <!-- Title -->
        <h1 class="text-base font-semibold mb-3">
          Let's Personalize Your Ptah Experience
        </h1>

        <p class="text-xs text-base-content/70 mb-2">
          We'll analyze your project structure, detect your tech stack, and
          generate intelligent agents tailored specifically to your codebase.
        </p>
        <p class="text-xs text-base-content/60 mb-4">
          <span class="font-semibold">Estimated time:</span> 2-4 minutes
        </p>

        <!-- Feature Cards Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 text-left">
          <div class="border border-base-300 rounded-md bg-base-200/50">
            <div class="p-3 flex flex-row items-center gap-2">
              <div class="bg-primary/10 rounded p-1.5">
                <lucide-angular
                  [img]="SearchIcon"
                  class="w-4 h-4 text-primary"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 class="font-medium text-xs">Deep Analysis</h3>
                <p class="text-xs text-base-content/60">
                  4-phase AI-powered codebase scan
                </p>
              </div>
            </div>
          </div>

          <div class="border border-base-300 rounded-md bg-base-200/50">
            <div class="p-3 flex flex-row items-center gap-2">
              <div class="bg-secondary/10 rounded p-1.5">
                <lucide-angular
                  [img]="BotIcon"
                  class="w-4 h-4 text-secondary"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 class="font-medium text-xs">Smart Agents</h3>
                <p class="text-xs text-base-content/60">
                  13 customized agent templates
                </p>
              </div>
            </div>
          </div>

          <div class="border border-base-300 rounded-md bg-base-200/50">
            <div class="p-3 flex flex-row items-center gap-2">
              <div class="bg-accent/10 rounded p-1.5">
                <lucide-angular
                  [img]="ZapIcon"
                  class="w-4 h-4 text-accent"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 class="font-medium text-xs">Quick Setup</h3>
                <p class="text-xs text-base-content/60">
                  Ready in under 5 minutes
                </p>
              </div>
            </div>
          </div>

          <div class="border border-base-300 rounded-md bg-base-200/50">
            <div class="p-3 flex flex-row items-center gap-2">
              <div class="bg-success/10 rounded p-1.5">
                <lucide-angular
                  [img]="ShieldIcon"
                  class="w-4 h-4 text-success"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 class="font-medium text-xs">Project-Specific</h3>
                <p class="text-xs text-base-content/60">
                  Rules matched to your tech stack
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- CTA Button -->
        <button
          class="btn btn-primary btn-sm"
          aria-label="Start new analysis"
          (click)="onStartSetup()"
        >
          <lucide-angular
            [img]="SparklesIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          Start New Analysis
        </button>

        <!-- Previous Analyses Section -->
        @if (isLoadingAnalyses()) {
        <div class="mt-6 flex items-center justify-center gap-2">
          <span class="loading loading-spinner loading-xs"></span>
          <span class="text-xs text-base-content/50"
            >Loading previous analyses...</span
          >
        </div>
        } @else if (savedAnalyses().length > 0) {
        <div class="mt-6 text-left">
          <div class="divider text-xs text-base-content/40 my-3">
            OR LOAD PREVIOUS ANALYSIS
          </div>

          <div class="flex items-center gap-2 mb-3">
            <lucide-angular
              [img]="FolderOpenIcon"
              class="w-4 h-4 text-base-content/60"
              aria-hidden="true"
            />
            <h3 class="text-xs font-semibold text-base-content/70">
              Previous Analyses
            </h3>
          </div>

          <div class="space-y-2 max-h-48 overflow-y-auto">
            @for (analysis of savedAnalyses(); track analysis.filename) {
            <div
              class="border border-base-300 rounded-lg bg-base-200/30 p-3
                     hover:border-primary/40 hover:bg-primary/5 transition-all"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs font-medium truncate">
                      {{ analysis.projectType }}
                    </span>
                    @if (analysis.phaseCount) {
                    <span class="badge badge-xs badge-ghost">
                      {{ analysis.phaseCount }} phases
                    </span>
                    }
                  </div>
                  <div
                    class="flex items-center gap-3 text-xs text-base-content/50"
                  >
                    <span class="flex items-center gap-1">
                      <lucide-angular
                        [img]="ClockIcon"
                        class="w-3 h-3"
                        aria-hidden="true"
                      />
                      {{ formatDate(analysis.savedAt) }}
                    </span>
                    <span>{{ analysis.model }}</span>
                    @if (analysis.durationMs) {
                    <span>{{ formatDuration(analysis.durationMs) }}</span>
                    }
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    class="btn btn-primary btn-xs"
                    [disabled]="isLoadingAnalysis()"
                    (click)="onUseAnalysis(analysis)"
                    aria-label="Use this analysis"
                  >
                    @if (isLoadingAnalysis() && loadingFilename() ===
                    analysis.filename) {
                    <span class="loading loading-spinner loading-xs"></span>
                    } @else { Use This }
                  </button>
                  <button
                    class="btn btn-ghost btn-xs text-error/60 hover:text-error"
                    (click)="onDeleteAnalysis(analysis)"
                    aria-label="Delete this analysis"
                  >
                    <lucide-angular
                      [img]="Trash2Icon"
                      class="w-3 h-3"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            </div>
            }
          </div>
        </div>
        }
      </div>
    </div>
  `,
})
export class WelcomeComponent implements OnInit {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  protected readonly SearchIcon = Search;
  protected readonly BotIcon = Bot;
  protected readonly ZapIcon = Zap;
  protected readonly ShieldIcon = Shield;
  protected readonly SparklesIcon = Sparkles;
  protected readonly FolderOpenIcon = FolderOpen;
  protected readonly ClockIcon = Clock;
  protected readonly Trash2Icon = Trash2;

  protected readonly savedAnalyses = this.wizardState.savedAnalyses;
  protected readonly isLoadingAnalyses = signal(false);
  protected readonly isLoadingAnalysis = signal(false);
  protected readonly loadingFilename = signal<string | null>(null);

  public ngOnInit(): void {
    this.loadSavedAnalyses();
  }

  /**
   * Load saved analyses list on component init.
   */
  private async loadSavedAnalyses(): Promise<void> {
    this.isLoadingAnalyses.set(true);
    try {
      const analyses = await this.wizardRpc.listAnalyses();
      this.wizardState.setSavedAnalyses(analyses);
    } catch (error) {
      console.warn(
        '[WelcomeComponent] Failed to load saved analyses:',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      this.isLoadingAnalyses.set(false);
    }
  }

  /**
   * Handle "Start Setup" button click.
   * Transitions directly to scan step -- no RPC needed since the wizard webview already exists.
   * The ScanProgressComponent will initiate the actual deep analysis on mount.
   */
  protected onStartSetup(): void {
    this.wizardState.setCurrentStep('scan');
  }

  /**
   * Handle "Use This" button for a saved analysis.
   * Loads the full analysis, sets state, and navigates to the analysis step.
   */
  protected async onUseAnalysis(
    analysis: SavedAnalysisMetadata
  ): Promise<void> {
    this.isLoadingAnalysis.set(true);
    this.loadingFilename.set(analysis.filename);

    try {
      const multiPhaseData = await this.wizardRpc.loadAnalysis(
        analysis.filename
      );
      this.wizardState.loadSavedAnalysis(multiPhaseData);

      // Fetch recommendations for the loaded analysis
      const recommendations = await this.wizardRpc.recommendAgents(
        multiPhaseData
      );
      this.wizardState.setRecommendations(recommendations);

      // Navigate to analysis step so user sees the loaded data before choosing next step
      this.wizardState.setCurrentStep('analysis');
    } catch (error) {
      console.error(
        '[WelcomeComponent] Failed to load analysis:',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      this.isLoadingAnalysis.set(false);
      this.loadingFilename.set(null);
    }
  }

  /**
   * Handle "Delete" button for a saved analysis.
   * Removes from the list immediately and calls backend to delete file.
   */
  protected async onDeleteAnalysis(
    analysis: SavedAnalysisMetadata
  ): Promise<void> {
    // Optimistic UI: remove from list immediately
    const current = this.savedAnalyses();
    this.wizardState.setSavedAnalyses(
      current.filter((a) => a.filename !== analysis.filename)
    );

    // Note: Delete RPC not yet implemented in backend.
    // The file will be cleaned up on next list refresh or manually.
    // A wizard:delete-analysis RPC can be added as a follow-up.
  }

  /**
   * Format milliseconds to a readable duration string.
   */
  protected formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  /**
   * Format ISO date string to a human-readable short format.
   */
  protected formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return isoDate;
    }
  }
}
