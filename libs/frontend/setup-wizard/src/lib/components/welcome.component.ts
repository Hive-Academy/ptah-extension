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
import { ModelStateService } from '@ptah-extension/core';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

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
    <div class="h-full flex flex-col items-center px-3 py-4 overflow-y-auto">
      <div class="animate-fadeIn w-full max-w-2xl">
        <!-- Title -->
        <h1 class="text-base font-semibold mb-1 text-center">
          Let's Personalize Your Ptah Experience
        </h1>
        <p class="text-xs text-base-content/60 mb-4 text-center">
          Analyze your existing codebase and generate tailored AI agents for
          your tech stack
        </p>

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
                  <p class="text-xs text-base-content/60">13 agent templates</p>
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

          <!-- Model Selection -->
          @if (modelState.availableModels().length > 0) {
            <div class="max-w-sm mx-auto mb-4 text-left">
              <label
                for="wizard-model-select"
                class="text-xs font-semibold text-base-content/70 mb-1.5 block"
              >
                Analysis model
              </label>
              <select
                id="wizard-model-select"
                class="select select-bordered select-sm w-full text-xs"
                [value]="modelState.currentModel()"
                [disabled]="modelState.isPending()"
                (change)="onModelChange($event)"
                aria-label="Select the model used for analysis"
              >
                @for (model of modelState.availableModels(); track model.id) {
                  <option [value]="model.id">
                    {{ model.name
                    }}{{ model.isRecommended ? ' (Recommended)' : '' }}
                  </option>
                }
              </select>
              @if (modelState.currentModelInfo(); as info) {
                <div
                  class="mt-2 rounded-md border border-base-300 bg-base-200/40 px-3 py-2"
                >
                  @if (info.description) {
                    <p class="text-xs text-base-content/70">
                      {{ info.description }}
                    </p>
                  }
                  @if (info.providerModelId) {
                    <p class="text-[11px] font-mono text-accent mt-1 truncate">
                      {{ info.providerModelId }}
                    </p>
                  }
                </div>
              }
            </div>
          }

          <!-- CTA Button -->
          <div class="text-center mb-4">
            <button
              class="btn btn-primary btn-sm"
              aria-label="Start new analysis"
              data-testid="wizard-next-btn"
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
      </div>
    </div>
  `,
})
export class WelcomeComponent implements OnInit {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);
  protected readonly modelState = inject(ModelStateService);

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

  private async loadSavedAnalyses(): Promise<void> {
    this.isLoadingAnalyses.set(true);
    try {
      const analyses = await this.wizardRpc.listAnalyses();
      this.wizardState.setSavedAnalyses(analyses);
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

  protected onModelChange(event: Event): void {
    const model = (event.target as HTMLSelectElement).value;
    if (!model) return;
    void this.modelState.switchModel(model);
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
