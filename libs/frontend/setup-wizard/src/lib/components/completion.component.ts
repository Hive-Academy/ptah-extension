import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  Check,
  Folder,
  Info,
  LucideAngularModule,
  MessageCircle,
  Sparkles,
  Zap,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

/**
 * CompletionComponent - Success screen with quick start guide and orchestration examples
 *
 * Purpose:
 * - Celebrate successful agent generation
 * - Display generated files organized by category
 * - Show quick start guide with example commands
 * - Include /orchestrate example usage
 * - Add "Open Files" button to reveal .claude folder
 * - Add "Test Orchestration" button to launch chat with sample command
 *
 * Features:
 * - Hero success layout with checkmark icon
 * - Generated files organized by category (Agents, Commands, Skill Files)
 * - Quick start guide with code blocks
 * - Example orchestration commands
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
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-4 py-8">
      <div class="max-w-4xl mx-auto">
        <!-- Success Header -->
        <div class="text-center mb-4">
          <div class="flex justify-center mb-3">
            <div class="rounded-full bg-success/20 p-4">
              <lucide-angular
                [img]="CheckIcon"
                class="h-12 w-12 text-success"
              />
            </div>
          </div>
          <h1 class="text-xl font-bold mb-3">Setup Complete!</h1>
          <p class="text-sm text-base-content/70 max-w-2xl mx-auto">
            Your personalized agents and orchestration skill have been
            generated. You're ready to start using intelligent development
            workflows.
          </p>
        </div>

        <!-- Generation Summary Stats -->
        <div class="stats shadow-xl w-full mb-4">
          <div class="stat place-items-center">
            <div class="stat-title">Agents Generated</div>
            <div class="stat-value text-primary">{{ agentCount() }}</div>
            <div class="stat-desc">.claude/agents/</div>
          </div>
          <div class="stat place-items-center">
            <div class="stat-title">Commands Created</div>
            <div class="stat-value text-secondary">{{ commandCount() }}</div>
            <div class="stat-desc">.claude/commands/</div>
          </div>
          <div class="stat place-items-center">
            <div class="stat-title">Skill Files</div>
            <div class="stat-value text-accent">{{ skillFileCount() }}</div>
            <div class="stat-desc">.claude/skills/orchestration/</div>
          </div>
          <div class="stat place-items-center">
            <div class="stat-title">Enhanced Prompts</div>
            <div
              class="stat-value"
              [class.text-warning]="enhancedPromptsGenerated()"
              [class.opacity-30]="!enhancedPromptsGenerated()"
            >
              @if (enhancedPromptsGenerated()) {
              <lucide-angular [img]="SparklesIcon" class="h-8 w-8" />
              } @else {
              <span class="text-sm">--</span>
              }
            </div>
            <div class="stat-desc">
              @if (enhancedPromptsGenerated()) { Active } @else {
              {{ enhancedPromptsStatusLabel() }}
              }
            </div>
          </div>
        </div>

        <!-- 2-Column Grid: Generated Files + Quick Start Guide -->
        <div class="grid grid-cols-2 gap-4 mb-4">
          <!-- Generated Files Card -->
          <div class="card bg-base-200 shadow-xl">
            <div class="card-body p-4">
              <h2 class="text-sm font-medium uppercase mb-3">
                <lucide-angular [img]="FolderIcon" class="h-6 w-6" />
                Generated Files
              </h2>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Agents Column -->
                @if (agentFiles().length > 0) {
                <div>
                  <h3
                    class="font-semibold text-primary mb-2 flex items-center gap-2"
                  >
                    <span>🤖</span> Agents
                  </h3>
                  <ul class="space-y-1 text-sm">
                    @for (file of agentFiles(); track file.id) {
                    <li class="flex items-center gap-2">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="h-4 w-4 text-success"
                      />
                      <span
                        class="font-mono text-xs truncate"
                        [title]="file.name"
                        >{{ file.name }}</span
                      >
                    </li>
                    }
                  </ul>
                </div>
                }

                <!-- Commands Column -->
                @if (commandFiles().length > 0) {
                <div>
                  <h3
                    class="font-semibold text-secondary mb-2 flex items-center gap-2"
                  >
                    <span>⌨️</span> Commands
                  </h3>
                  <ul class="space-y-1 text-sm">
                    @for (file of commandFiles(); track file.id) {
                    <li class="flex items-center gap-2">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="h-4 w-4 text-success"
                      />
                      <span
                        class="font-mono text-xs truncate"
                        [title]="file.name"
                        >{{ file.name }}</span
                      >
                    </li>
                    }
                  </ul>
                </div>
                }

                <!-- Skill Files Column -->
                @if (skillFiles().length > 0) {
                <div>
                  <h3
                    class="font-semibold text-accent mb-2 flex items-center gap-2"
                  >
                    <span>📝</span> Skill Files
                  </h3>
                  <ul class="space-y-1 text-sm">
                    @for (file of skillFiles(); track file.id) {
                    <li class="flex items-center gap-2">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="h-4 w-4 text-success"
                      />
                      <span
                        class="font-mono text-xs truncate"
                        [title]="file.name"
                        >{{ file.name }}</span
                      >
                    </li>
                    }
                  </ul>
                </div>
                }
              </div>
            </div>
          </div>

          <!-- Quick Start Guide Card -->
          <div class="card bg-base-200 shadow-xl">
            <div class="card-body p-4">
              <h2 class="text-sm font-medium uppercase mb-3">
                <lucide-angular [img]="ZapIcon" class="h-6 w-6" />
                Quick Start Guide
              </h2>

              <div class="space-y-3">
                <!-- Step 1: Using Orchestrate -->
                <div>
                  <h3 class="font-semibold mb-2 flex items-center gap-2">
                    <span class="badge badge-primary badge-sm">1</span>
                    Start a Development Workflow
                  </h3>
                  <p class="text-sm text-base-content/70 mb-2">
                    Use the
                    <code class="bg-base-300 px-1 py-0.5 rounded"
                      >/orchestrate</code
                    >
                    command to start an intelligent development workflow:
                  </p>
                  <div class="mockup-code text-sm">
                    <pre
                      data-prefix="$"
                    ><code>/orchestrate Add user authentication with OAuth2</code></pre>
                  </div>
                  <p class="text-xs text-base-content/60 mt-2">
                    The orchestrator will analyze your task, select the
                    appropriate workflow (FEATURE, BUGFIX, etc.), and coordinate
                    specialized agents.
                  </p>
                </div>

                <!-- Step 2: Workflow Strategies -->
                <div>
                  <h3 class="font-semibold mb-2 flex items-center gap-2">
                    <span class="badge badge-secondary badge-sm">2</span>
                    Available Workflow Strategies
                  </h3>
                  <p class="text-sm text-base-content/70 mb-2">
                    The orchestrator supports multiple workflow types:
                  </p>
                  <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <div class="badge badge-outline gap-1">
                      <span>✨</span> FEATURE
                    </div>
                    <div class="badge badge-outline gap-1">
                      <span>🐛</span> BUGFIX
                    </div>
                    <div class="badge badge-outline gap-1">
                      <span>🔧</span> REFACTORING
                    </div>
                    <div class="badge badge-outline gap-1">
                      <span>📚</span> DOCUMENTATION
                    </div>
                    <div class="badge badge-outline gap-1">
                      <span>🔍</span> RESEARCH
                    </div>
                    <div class="badge badge-outline gap-1">
                      <span>⚙️</span> DEVOPS
                    </div>
                  </div>
                </div>

                <!-- Step 3: Example Commands -->
                <div>
                  <h3 class="font-semibold mb-2 flex items-center gap-2">
                    <span class="badge badge-accent badge-sm">3</span>
                    Example Commands
                  </h3>
                  <div class="space-y-2">
                    <div class="mockup-code text-sm">
                      <pre
                        data-prefix="$"
                      ><code>/orchestrate Fix the login form validation bug</code></pre>
                      <pre
                        data-prefix=" "
                        class="text-base-content/60"
                      ><code># Strategy: BUGFIX - Research -> Team-Leader -> QA</code></pre>
                    </div>
                    <div class="mockup-code text-sm">
                      <pre
                        data-prefix="$"
                      ><code>/orchestrate Refactor the UserService to use repository pattern</code></pre>
                      <pre
                        data-prefix=" "
                        class="text-base-content/60"
                      ><code># Strategy: REFACTORING - Architect -> Team-Leader</code></pre>
                    </div>
                    <div class="mockup-code text-sm">
                      <pre
                        data-prefix="$"
                      ><code>/orchestrate Create API documentation for the auth endpoints</code></pre>
                      <pre
                        data-prefix=" "
                        class="text-base-content/60"
                      ><code># Strategy: DOCUMENTATION - Technical-Writer</code></pre>
                    </div>
                  </div>
                </div>

                <!-- Step 4: Continuing Tasks -->
                <div>
                  <h3 class="font-semibold mb-2 flex items-center gap-2">
                    <span class="badge badge-info badge-sm">4</span>
                    Continuing Existing Tasks
                  </h3>
                  <p class="text-sm text-base-content/70 mb-2">
                    Resume work on an existing task using the task ID:
                  </p>
                  <div class="mockup-code text-sm">
                    <pre
                      data-prefix="$"
                    ><code>/orchestrate TASK_2025_XXX</code></pre>
                    <pre
                      data-prefix=" "
                      class="text-base-content/60"
                    ><code># Continues from last checkpoint</code></pre>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Tips Card -->
          <div class="alert alert-info mb-4">
            <lucide-angular [img]="InfoIcon" class="shrink-0 w-6 h-6" />
            <div>
              <h3 class="font-bold mb-1">Pro Tips</h3>
              <ul class="text-sm space-y-1">
                <li>
                  Use
                  <code class="bg-base-300 px-1 py-0.5 rounded"
                    >@agent-name</code
                  >
                  to invoke a specific agent directly (e.g.,
                  <code class="bg-base-300 px-1 py-0.5 rounded"
                    >@frontend-developer</code
                  >)
                </li>
                <li>
                  Check
                  <code class="bg-base-300 px-1 py-0.5 rounded"
                    >.claude/skills/orchestration/SKILL.md</code
                  >
                  for the complete workflow reference
                </li>
                <li>
                  Task progress is saved in
                  <code class="bg-base-300 px-1 py-0.5 rounded"
                    >task-tracking/</code
                  >
                  folder for easy continuation
                </li>
              </ul>
            </div>
          </div>

          <!-- Warnings Section (collapsible) -->
          @if (hasWarnings()) {
          <div
            class="collapse collapse-arrow bg-warning/10 border border-warning/20 rounded-box mb-4"
          >
            <input type="checkbox" />
            <div class="collapse-title text-sm font-medium text-warning">
              {{ warnings().length }} warning(s) during generation
            </div>
            <div class="collapse-content">
              <ul class="list-disc list-inside text-sm text-base-content/70">
                @for (warning of warnings(); track $index) {
                <li>{{ warning }}</li>
                }
              </ul>
            </div>
          </div>
          }

          <!-- Enhanced Prompts Status Badge -->
          <div class="flex justify-center mb-4">
            @if (enhancedPromptsUsed()) {
            <div class="badge badge-success badge-sm gap-1">
              Enhanced prompts applied
            </div>
            } @else {
            <div class="badge badge-ghost badge-sm gap-1">
              Standard prompts used
            </div>
            }
          </div>

          <!-- Action Buttons -->
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              class="btn btn-primary btn-lg"
              (click)="onOpenClaudeFolder()"
            >
              <lucide-angular [img]="FolderIcon" class="h-5 w-5" />
              Open .claude Folder
            </button>
            <button
              class="btn btn-secondary btn-lg"
              (click)="onTestOrchestration()"
            >
              <lucide-angular [img]="ZapIcon" class="h-5 w-5" />
              Test /orchestrate
            </button>
            <button class="btn btn-ghost btn-lg" (click)="onStartNewChat()">
              <lucide-angular [img]="MessageCircleIcon" class="h-5 w-5" />
              Start New Chat
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CompletionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly vscodeService = inject(VSCodeService);

  // Lucide icon references
  protected readonly CheckIcon = Check;
  protected readonly FolderIcon = Folder;
  protected readonly ZapIcon = Zap;
  protected readonly InfoIcon = Info;
  protected readonly MessageCircleIcon = MessageCircle;
  protected readonly SparklesIcon = Sparkles;

  /**
   * All completed generation items from skill generation progress.
   */
  private readonly completedItems = computed(() => {
    return this.wizardState
      .skillGenerationProgress()
      .filter((item) => item.status === 'complete');
  });

  /**
   * Agent files that were generated.
   */
  protected readonly agentFiles = computed(() => {
    return this.completedItems().filter((item) => item.type === 'agent');
  });

  /**
   * Command files that were generated.
   */
  protected readonly commandFiles = computed(() => {
    return this.completedItems().filter((item) => item.type === 'command');
  });

  /**
   * Skill files that were generated.
   */
  protected readonly skillFiles = computed(() => {
    return this.completedItems().filter((item) => item.type === 'skill-file');
  });

  /**
   * Count of generated agents.
   */
  protected readonly agentCount = computed(() => {
    return this.agentFiles().length;
  });

  /**
   * Count of generated commands.
   */
  protected readonly commandCount = computed(() => {
    return this.commandFiles().length;
  });

  /**
   * Count of generated skill files.
   */
  protected readonly skillFileCount = computed(() => {
    return this.skillFiles().length;
  });

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
    () => this.wizardState.completionData()?.warnings ?? []
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
    () => this.wizardState.completionData()?.enhancedPromptsUsed ?? false
  );

  /**
   * Open .claude folder in VS Code explorer.
   * Reveals the folder in the sidebar file explorer.
   */
  protected onOpenClaudeFolder(): void {
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.SETUP_WIZARD_OPEN_AGENTS_FOLDER,
    });
  }

  /**
   * Test orchestration by launching chat with /orchestrate command.
   * Opens chat view and pre-fills with a sample orchestrate command.
   */
  protected onTestOrchestration(): void {
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.SETUP_WIZARD_START_CHAT,
      payload: {
        prefillMessage: '/orchestrate Show me an example of a FEATURE workflow',
      },
    });
  }

  /**
   * Navigate to chat view and close wizard.
   */
  protected onStartNewChat(): void {
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.SETUP_WIZARD_START_CHAT,
    });
  }
}
