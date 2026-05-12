import {
  Component,
  inject,
  ChangeDetectionStrategy,
  OnInit,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  Bot,
  Clock,
  FolderOpen,
  LucideAngularModule,
  PlusCircle,
  Search,
  Shield,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-angular';
import type { SavedAnalysisMetadata } from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

type WelcomeMode = 'analysis' | 'new';

@Component({
  selector: 'ptah-welcome',
  standalone: true,
  imports: [NgClass, LucideAngularModule],
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
    <div class="h-full flex flex-col items-center px-3 py-4 overflow-y-auto">
      <div class="animate-fadeIn w-full max-w-2xl">
        <!-- Title -->
        <h1 class="text-base font-semibold mb-1 text-center">
          Let's Personalize Your Ptah Experience
        </h1>
        <p class="text-xs text-base-content/60 mb-4 text-center">
          Choose how you'd like to get started
        </p>

        <!-- Mode Selection Cards -->
        <div class="grid grid-cols-2 gap-3 mb-5">
          <!-- Project Analysis Card -->
          <button
            class="border rounded-lg p-4 text-left transition-all cursor-pointer"
            [ngClass]="
              selectedMode() === 'analysis'
                ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                : 'border-base-300 bg-base-200/50 hover:border-primary/40 hover:bg-primary/5'
            "
            (click)="selectMode('analysis')"
          >
            <div class="flex items-center gap-2 mb-2">
              <div class="bg-primary/10 rounded p-1.5">
                <lucide-angular
                  [img]="SearchIcon"
                  class="w-4 h-4 text-primary"
                  aria-hidden="true"
                />
              </div>
              <h3 class="font-semibold text-sm">Project Analysis</h3>
            </div>
            <p class="text-xs text-base-content/60">
              Analyze your existing codebase and generate tailored AI agents for
              your tech stack
            </p>
          </button>

          <!-- New Project Card -->
          <button
            class="border rounded-lg p-4 text-left transition-all cursor-pointer"
            [ngClass]="
              selectedMode() === 'new'
                ? 'border-secondary bg-secondary/10 ring-1 ring-secondary/30'
                : 'border-base-300 bg-base-200/50 hover:border-secondary/40 hover:bg-secondary/5'
            "
            (click)="selectMode('new')"
          >
            <div class="flex items-center gap-2 mb-2">
              <div class="bg-secondary/10 rounded p-1.5">
                <lucide-angular
                  [img]="PlusCircleIcon"
                  class="w-4 h-4 text-secondary"
                  aria-hidden="true"
                />
              </div>
              <h3 class="font-semibold text-sm">New Project</h3>
            </div>
            <p class="text-xs text-base-content/60">
              Start a new project from scratch with guided setup and a generated
              master plan
            </p>
          </button>
        </div>

        <!-- Analysis Mode Content -->
        @if (selectedMode() === 'analysis') {
          <div class="animate-fadeIn">
            <p class="text-xs text-base-content/70 mb-2 text-center">
              We'll scan your project structure, detect your tech stack, and
              generate intelligent agents tailored to your codebase.
            </p>
            <p class="text-xs text-base-content/60 mb-4 text-center">
              <span class="font-semibold">Estimated time:</span> 2-4 minutes
            </p>

            <!-- Feature Cards Grid -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-left">
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
                    <p class="text-xs text-base-content/60">4-phase AI scan</p>
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
                      13 agent templates
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
                    <p class="text-xs text-base-content/60">Under 5 minutes</p>
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
                      Matched to your stack
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- CTA Button -->
            <div class="text-center mb-4">
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
            </div>

            <!-- Previous Analyses Section -->
            @if (isLoadingAnalyses()) {
              <div class="flex items-center justify-center gap-2">
                <span class="loading loading-spinner loading-xs"></span>
                <span class="text-xs text-base-content/50"
                  >Loading previous analyses...</span
                >
              </div>
            } @else if (savedAnalyses().length > 0) {
              <div class="text-left">
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
                              <span>{{
                                formatDuration(analysis.durationMs)
                              }}</span>
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
                            @if (
                              isLoadingAnalysis() &&
                              loadingFilename() === analysis.filename
                            ) {
                              <span
                                class="loading loading-spinner loading-xs"
                              ></span>
                            } @else {
                              Use This
                            }
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
        }

        <!-- New Project Mode Content -->
        @if (selectedMode() === 'new') {
          <div class="animate-fadeIn text-center">
            <p class="text-xs text-base-content/70 mb-2">
              Answer a few questions about your project and we'll generate a
              comprehensive master plan with the right structure, tools, and
              agents.
            </p>
            <p class="text-xs text-base-content/60 mb-4">
              <span class="font-semibold">Estimated time:</span> 3-5 minutes
            </p>

            <button
              class="btn btn-secondary btn-sm"
              aria-label="Start new project"
              (click)="onStartNewProject()"
            >
              <lucide-angular
                [img]="PlusCircleIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              Start New Project
            </button>
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
  protected readonly PlusCircleIcon = PlusCircle;

  protected readonly savedAnalyses = this.wizardState.savedAnalyses;
  protected readonly isLoadingAnalyses = signal(false);
  protected readonly isLoadingAnalysis = signal(false);
  protected readonly loadingFilename = signal<string | null>(null);
  protected readonly selectedMode = signal<WelcomeMode | null>(null);

  public ngOnInit(): void {
    this.loadSavedAnalyses();
  }

  protected selectMode(mode: WelcomeMode): void {
    this.selectedMode.set(mode);
  }

  /**
   * Load saved analyses list on component init.
   * Auto-selects 'analysis' mode if previous analyses exist.
   */
  private async loadSavedAnalyses(): Promise<void> {
    this.isLoadingAnalyses.set(true);
    try {
      const analyses = await this.wizardRpc.listAnalyses();
      this.wizardState.setSavedAnalyses(analyses);

      // Auto-select analysis mode if user has previous analyses
      if (analyses.length > 0) {
        this.selectedMode.set('analysis');
      }
    } catch (error) {
      console.warn(
        '[WelcomeComponent] Failed to load saved analyses:',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.isLoadingAnalyses.set(false);
    }
  }

  protected onStartSetup(): void {
    this.wizardState.setCurrentStep('scan');
  }

  protected async onStartNewProject(): Promise<void> {
    try {
      await this.wizardRpc.startNewProjectChat();
      // Backend disposes the wizard panel; this component will be torn down.
    } catch (error: unknown) {
      console.error(
        '[WelcomeComponent] Failed to start new project chat:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  protected async onUseAnalysis(
    analysis: SavedAnalysisMetadata,
  ): Promise<void> {
    this.isLoadingAnalysis.set(true);
    this.loadingFilename.set(analysis.filename);

    try {
      const multiPhaseData = await this.wizardRpc.loadAnalysis(
        analysis.filename,
      );
      this.wizardState.loadSavedAnalysis(multiPhaseData);

      const recommendations =
        await this.wizardRpc.recommendAgents(multiPhaseData);
      this.wizardState.setRecommendations(recommendations);

      this.wizardState.setCurrentStep('analysis');
    } catch (error) {
      console.error(
        '[WelcomeComponent] Failed to load analysis:',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.isLoadingAnalysis.set(false);
      this.loadingFilename.set(null);
    }
  }

  protected async onDeleteAnalysis(
    analysis: SavedAnalysisMetadata,
  ): Promise<void> {
    const current = this.savedAnalyses();
    this.wizardState.setSavedAnalyses(
      current.filter((a) => a.filename !== analysis.filename),
    );
  }

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
