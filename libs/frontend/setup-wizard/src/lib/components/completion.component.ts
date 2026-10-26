import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  Check,
  Folder,
  Info,
  LucideAngularModule,
  MessageCircle,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { GradeExpectationComponent } from './completion/grade-expectation.component';
import { LibraryStaleNoticeComponent } from './completion/library-stale-notice.component';
import {
  OutcomeSummaryComponent,
  libraryReachable,
  type OutcomeFileRow,
} from './completion/outcome-summary.component';

/**
 * CompletionComponent - Success screen with quick start guide and orchestration examples
 *
 * Purpose:
 * - Celebrate successful agent generation
 * - Display generated agent files
 * - Show quick start guide with example commands
 * - Include /orchestrate example usage
 * - Add "Open Files" button to reveal .claude folder
 * - Add "Test Orchestration" button to launch chat with sample command
 *
 * Features:
 * - Hero success layout with checkmark icon
 * - Generated agent files list
 * - Quick start guide with code blocks
 * - Action buttons (Open .claude Folder, Test Orchestration, Start New Chat)
 * - Signal-based reactive statistics
 *
 * Usage:
 * ```html
 * <ptah-completion />
 * ```
 */
@Component({
  selector: 'ptah-completion',
  standalone: true,
  imports: [
    LucideAngularModule,
    OutcomeSummaryComponent,
    GradeExpectationComponent,
    LibraryStaleNoticeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-8">
      <div class="max-w-6xl mx-auto space-y-8">
        <!-- Outcome Header -->
        <div class="text-center">
          <div class="flex justify-center mb-4">
            @if (hasFailures()) {
              <div class="rounded-full bg-error/20 p-4">
                <lucide-angular
                  [img]="XCircleIcon"
                  class="h-12 w-12 text-error"
                />
              </div>
            } @else {
              <div class="rounded-full bg-success/20 p-4">
                <lucide-angular
                  [img]="CheckIcon"
                  class="h-12 w-12 text-success"
                />
              </div>
            }
          </div>
          @if (hasFailures()) {
            <h1 class="text-2xl font-bold mb-3">Setup Finished With Errors</h1>
            <p class="text-base-content-muted max-w-xl mx-auto">
              Some agents were not generated. Files written earlier are kept —
              review the failures below.
            </p>
          } @else {
            <h1 class="text-2xl font-bold mb-3">Setup Complete!</h1>
            <p class="text-base-content-muted max-w-xl mx-auto">
              Your personalized agents have been generated. You're ready to
              start using intelligent development workflows.
            </p>
          }
        </div>

        <!-- Generated Agents Section -->
        <div>
          <div class="flex items-center gap-3 mb-2">
            <lucide-angular [img]="FolderIcon" class="h-5 w-5" />
            <h2 class="text-base font-semibold">
              Generated Agents
              <span class="ml-2 opacity-60">({{ agentCount() }})</span>
            </h2>
            @if (enhancedPromptsGenerated()) {
              <div class="badge badge-success badge-sm gap-1">
                <lucide-angular [img]="SparklesIcon" class="h-3 w-3" />
                Enhanced
              </div>
            }
          </div>

          <!-- Outcomes (from the completion payload, not stream items) -->
          @if (completion(); as data) {
            @if (data.rejectedSections > 0) {
              <div class="flex flex-wrap items-center gap-2 mb-3 text-xs">
                <span
                  class="badge badge-warning badge-sm"
                  data-testid="rejected-sections-count"
                >
                  {{ data.rejectedSections }} sections rejected
                </span>
              </div>
            }
            <div
              class="flex items-center gap-2 mb-4 text-xs text-base-content-muted"
              data-testid="output-directory"
            >
              <lucide-angular [img]="FolderIcon" class="h-3.5 w-3.5 shrink-0" />
              <code class="bg-base-300 px-1.5 py-0.5 rounded break-all">{{
                data.outputDirectory
              }}</code>
            </div>
            <ptah-outcome-summary
              [rows]="outcomeRows()"
              [libraryDiverged]="data.result?.libraryDiverged ?? []"
              [target]="data.result?.target"
              [isElectron]="isElectron"
              [outputDirectory]="data.outputDirectory"
              (openLibrary)="onOpenLibrary()"
            />
            @if (showsLibrary()) {
              <ptah-grade-expectation [rows]="outcomeRows()" />
              <ptah-library-stale-notice
                [libraryPass]="data.result?.libraryPass"
              />
            }
          }

          <!-- Generation errors from the completion payload -->
          @if (errors().length > 0) {
            <div
              class="alert alert-error text-xs mt-4"
              data-testid="completion-errors"
            >
              <lucide-angular [img]="XCircleIcon" class="h-4 w-4 shrink-0" />
              <ul class="list-disc list-inside space-y-1">
                @for (error of errors(); track error) {
                  <li>{{ error }}</li>
                }
              </ul>
            </div>
          }
        </div>

        <!-- Quick Start Guide Section -->
        <div>
          <div class="flex items-center gap-3 mb-5">
            <lucide-angular [img]="ZapIcon" class="h-5 w-5" />
            <h2 class="text-base font-semibold">Quick Start Guide</h2>
          </div>

          <div class="card bg-base-200/50 shadow-sm">
            <div class="card-body p-6">
              <div class="grid md:grid-cols-2 gap-8">
                <!-- Left Column: Getting Started -->
                <div class="space-y-6">
                  <!-- Step 1: Using Orchestrate -->
                  <div>
                    <h3
                      class="text-sm font-semibold mb-3 flex items-center gap-2"
                    >
                      <span class="badge badge-primary badge-sm">1</span>
                      Start a Development Workflow
                    </h3>
                    <p class="text-xs opacity-70 mb-3 leading-relaxed">
                      Use the
                      <code class="bg-base-300 px-1.5 py-0.5 rounded text-xs"
                        >/orchestrate</code
                      >
                      command to start an intelligent workflow:
                    </p>
                    <div class="mockup-code text-xs mb-3">
                      <pre
                        data-prefix="$"
                      ><code>/orchestrate Add user authentication</code></pre>
                    </div>
                    <p class="text-xs opacity-60 leading-relaxed">
                      The orchestrator will analyze your task and coordinate
                      specialized agents.
                    </p>
                  </div>

                  <!-- Step 2: Workflow Strategies -->
                  <div>
                    <h3
                      class="text-sm font-semibold mb-3 flex items-center gap-2"
                    >
                      <span class="badge badge-secondary badge-sm">2</span>
                      Available Workflow Types
                    </h3>
                    <div class="grid grid-cols-2 gap-2">
                      <div class="badge badge-outline badge-sm gap-1">
                        ✨ FEATURE
                      </div>
                      <div class="badge badge-outline badge-sm gap-1">
                        🐛 BUGFIX
                      </div>
                      <div class="badge badge-outline badge-sm gap-1">
                        🔧 REFACTORING
                      </div>
                      <div class="badge badge-outline badge-sm gap-1">
                        📚 DOCS
                      </div>
                      <div class="badge badge-outline badge-sm gap-1">
                        🔍 RESEARCH
                      </div>
                      <div class="badge badge-outline badge-sm gap-1">
                        ⚙️ DEVOPS
                      </div>
                    </div>
                  </div>

                  <!-- Pro Tips -->
                  <div class="surface-2 rounded-lg p-4">
                    <div class="flex gap-3">
                      <lucide-angular
                        [img]="InfoIcon"
                        class="shrink-0 w-4 h-4 opacity-60 mt-0.5"
                      />
                      <div>
                        <h3 class="font-semibold text-xs mb-2">Pro Tips</h3>
                        <ul class="text-xs space-y-1.5 opacity-70">
                          <li>
                            Use
                            <code class="bg-base-300 px-1 py-0.5 rounded"
                              >@agent-name</code
                            >
                            to invoke specific agents
                          </li>
                          <li>
                            Progress saved in
                            <code class="bg-base-300 px-1 py-0.5 rounded"
                              >.ptah/specs/</code
                            >
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Right Column: Example Commands -->
                <div class="space-y-6">
                  <h3
                    class="text-sm font-semibold mb-3 flex items-center gap-2"
                  >
                    <span class="badge badge-accent badge-sm">3</span>
                    Example Commands
                  </h3>

                  <div class="space-y-3">
                    <div class="mockup-code text-xs">
                      <pre
                        data-prefix="$"
                      ><code>/orchestrate Fix login form validation</code></pre>
                      <pre
                        data-prefix=" "
                        class="opacity-60"
                      ><code># BUGFIX workflow</code></pre>
                    </div>

                    <div class="mockup-code text-xs">
                      <pre
                        data-prefix="$"
                      ><code>/orchestrate Refactor UserService</code></pre>
                      <pre
                        data-prefix=" "
                        class="opacity-60"
                      ><code># REFACTORING workflow</code></pre>
                    </div>

                    <div class="mockup-code text-xs">
                      <pre
                        data-prefix="$"
                      ><code>/orchestrate Create API docs</code></pre>
                      <pre
                        data-prefix=" "
                        class="opacity-60"
                      ><code># DOCUMENTATION workflow</code></pre>
                    </div>

                    <div class="divider my-3 opacity-30"></div>

                    <div>
                      <h4 class="font-semibold text-xs mb-2 opacity-90">
                        Continue Existing Tasks
                      </h4>
                      <div class="mockup-code text-xs">
                        <pre
                          data-prefix="$"
                        ><code>/orchestrate TASK_2025_XXX</code></pre>
                        <pre
                          data-prefix=" "
                          class="opacity-60"
                        ><code># Resumes from checkpoint</code></pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Single Close Button -->
        <div class="flex justify-center pt-4">
          <button
            class="btn btn-primary btn-lg min-w-48"
            (click)="onCloseWizard()"
          >
            <lucide-angular [img]="CheckIcon" class="h-5 w-5" />
            Close
          </button>
        </div>
      </div>
    </div>
  `,
})
export class CompletionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  /** Library copy is Electron-only (D3). */
  protected readonly isElectron = this.vscodeService.isElectron === true;
  protected readonly CheckIcon = Check;
  protected readonly FolderIcon = Folder;
  protected readonly ZapIcon = Zap;
  protected readonly InfoIcon = Info;
  protected readonly MessageCircleIcon = MessageCircle;
  protected readonly SparklesIcon = Sparkles;
  protected readonly XCircleIcon = XCircle;

  /** The completion payload with explicit terminal agent outcomes. */
  protected readonly completion = this.wizardState.completionData;

  /**
   * One row per explicit outcome in the completion payload. Streamed
   * progress never establishes a terminal write outcome.
   */
  protected readonly outcomeRows = computed<OutcomeFileRow[]>(() => {
    const data = this.completion();
    if (!data) return [];
    return data.agents.map((outcome) => {
      const fileName = outcome.filePath.split(/[\\/]/).pop();
      return {
        id: outcome.agentId,
        fileName:
          fileName && fileName.length > 0 ? fileName : `${outcome.agentId}.md`,
        status: outcome.status,
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    });
  });

  /**
   * Count of agents with a terminal outcome.
   */
  protected readonly agentCount = computed(() => this.outcomeRows().length);

  /**
   * Grade and stale-Library copy: Electron, harness-root target, and only
   * when the host reported the result facts (absent facts show neither).
   */
  protected readonly showsLibrary = computed(() =>
    libraryReachable(this.isElectron, this.completion()?.result?.target),
  );

  /**
   * Whether the run reported any failure. Drives the header state.
   */
  protected readonly hasFailures = computed(() => {
    const data = this.completion();
    if (!data) return false;
    return data.failedCount > 0 || !data.success;
  });

  /**
   * Error messages from the completion payload.
   */
  protected readonly errors = computed(() => this.completion()?.errors ?? []);

  /**
   * Whether Enhanced Prompts was successfully generated.
   */
  protected readonly enhancedPromptsGenerated = computed(() => {
    return this.wizardState.enhancedPromptsStatus() === 'complete';
  });

  /**
   * Label for Enhanced Prompts status in the stats card.
   */
  protected readonly enhancedPromptsStatusLabel = computed(() => {
    const status = this.wizardState.enhancedPromptsStatus();
    switch (status) {
      case 'skipped':
        return 'Pro Only';
      case 'error':
        return 'Failed';
      default:
        return 'Not Generated';
    }
  });

  /**
   * Generation warnings from completion data.
   * Contains per-section customization failure messages.
   */
  protected readonly warnings = computed(
    () => this.wizardState.completionData()?.warnings ?? [],
  );

  /**
   * Whether any generation warnings exist.
   */
  protected readonly hasWarnings = computed(() => this.warnings().length > 0);

  /**
   * Whether enhanced prompts were used during generation.
   * Derived from completion data payload.
   */
  protected readonly enhancedPromptsUsed = computed(
    () => this.wizardState.completionData()?.enhancedPromptsUsed ?? false,
  );

  /** Open the Library filtered to the diverged copies this run named. */
  protected onOpenLibrary(): void {
    this.appState.openSkillsDivergedClones();
  }

  /**
   * Close the wizard and navigate to chat view.
   */
  protected onCloseWizard(): void {
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.SETUP_WIZARD_COMPLETE,
    });
  }
}
