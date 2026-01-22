import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';
import {
  SetupWizardStateService,
  SkillGenerationProgressItem,
} from '../services/setup-wizard-state.service';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

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
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-4 py-8">
      <div class="max-w-4xl mx-auto">
        <!-- Success Header -->
        <div class="text-center mb-8">
          <div class="flex justify-center mb-6">
            <div class="rounded-full bg-success/20 p-6">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-20 w-20 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          </div>
          <h1 class="text-4xl font-bold mb-4">Setup Complete!</h1>
          <p class="text-lg text-base-content/70 max-w-2xl mx-auto">
            Your personalized agents and orchestration skill have been generated.
            You're ready to start using intelligent development workflows.
          </p>
        </div>

        <!-- Generation Summary Stats -->
        <div class="stats shadow-xl w-full mb-8">
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
        </div>

        <!-- Generated Files Card -->
        <div class="card bg-base-200 shadow-xl mb-8">
          <div class="card-body">
            <h2 class="card-title text-xl mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Generated Files
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <!-- Agents Column -->
              @if (agentFiles().length > 0) {
              <div>
                <h3 class="font-semibold text-primary mb-2 flex items-center gap-2">
                  <span>\u{1F916}</span> Agents
                </h3>
                <ul class="space-y-1 text-sm">
                  @for (file of agentFiles(); track file.id) {
                  <li class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span class="font-mono text-xs truncate" [title]="file.name">{{ file.name }}</span>
                  </li>
                  }
                </ul>
              </div>
              }

              <!-- Commands Column -->
              @if (commandFiles().length > 0) {
              <div>
                <h3 class="font-semibold text-secondary mb-2 flex items-center gap-2">
                  <span>\u{2328}\u{FE0F}</span> Commands
                </h3>
                <ul class="space-y-1 text-sm">
                  @for (file of commandFiles(); track file.id) {
                  <li class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span class="font-mono text-xs truncate" [title]="file.name">{{ file.name }}</span>
                  </li>
                  }
                </ul>
              </div>
              }

              <!-- Skill Files Column -->
              @if (skillFiles().length > 0) {
              <div>
                <h3 class="font-semibold text-accent mb-2 flex items-center gap-2">
                  <span>\u{1F4DD}</span> Skill Files
                </h3>
                <ul class="space-y-1 text-sm">
                  @for (file of skillFiles(); track file.id) {
                  <li class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span class="font-mono text-xs truncate" [title]="file.name">{{ file.name }}</span>
                  </li>
                  }
                </ul>
              </div>
              }
            </div>
          </div>
        </div>

        <!-- Quick Start Guide Card -->
        <div class="card bg-base-200 shadow-xl mb-8">
          <div class="card-body">
            <h2 class="card-title text-xl mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Quick Start Guide
            </h2>

            <div class="space-y-6">
              <!-- Step 1: Using Orchestrate -->
              <div>
                <h3 class="font-semibold mb-2 flex items-center gap-2">
                  <span class="badge badge-primary badge-sm">1</span>
                  Start a Development Workflow
                </h3>
                <p class="text-sm text-base-content/70 mb-2">
                  Use the <code class="bg-base-300 px-1 py-0.5 rounded">/orchestrate</code> command to start an intelligent development workflow:
                </p>
                <div class="mockup-code text-sm">
                  <pre data-prefix="$"><code>/orchestrate Add user authentication with OAuth2</code></pre>
                </div>
                <p class="text-xs text-base-content/60 mt-2">
                  The orchestrator will analyze your task, select the appropriate workflow (FEATURE, BUGFIX, etc.),
                  and coordinate specialized agents.
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
                    <span>\u{2728}</span> FEATURE
                  </div>
                  <div class="badge badge-outline gap-1">
                    <span>\u{1F41B}</span> BUGFIX
                  </div>
                  <div class="badge badge-outline gap-1">
                    <span>\u{1F527}</span> REFACTORING
                  </div>
                  <div class="badge badge-outline gap-1">
                    <span>\u{1F4DA}</span> DOCUMENTATION
                  </div>
                  <div class="badge badge-outline gap-1">
                    <span>\u{1F50D}</span> RESEARCH
                  </div>
                  <div class="badge badge-outline gap-1">
                    <span>\u{2699}\u{FE0F}</span> DEVOPS
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
                    <pre data-prefix="$"><code>/orchestrate Fix the login form validation bug</code></pre>
                    <pre data-prefix=" " class="text-base-content/60"><code># Strategy: BUGFIX - Research -> Team-Leader -> QA</code></pre>
                  </div>
                  <div class="mockup-code text-sm">
                    <pre data-prefix="$"><code>/orchestrate Refactor the UserService to use repository pattern</code></pre>
                    <pre data-prefix=" " class="text-base-content/60"><code># Strategy: REFACTORING - Architect -> Team-Leader</code></pre>
                  </div>
                  <div class="mockup-code text-sm">
                    <pre data-prefix="$"><code>/orchestrate Create API documentation for the auth endpoints</code></pre>
                    <pre data-prefix=" " class="text-base-content/60"><code># Strategy: DOCUMENTATION - Technical-Writer</code></pre>
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
                  <pre data-prefix="$"><code>/orchestrate TASK_2025_XXX</code></pre>
                  <pre data-prefix=" " class="text-base-content/60"><code># Continues from last checkpoint</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tips Card -->
        <div class="alert alert-info mb-8">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-6 h-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <div>
            <h3 class="font-bold mb-1">Pro Tips</h3>
            <ul class="text-sm space-y-1">
              <li>Use <code class="bg-base-300 px-1 py-0.5 rounded">@agent-name</code> to invoke a specific agent directly (e.g., <code class="bg-base-300 px-1 py-0.5 rounded">@frontend-developer</code>)</li>
              <li>Check <code class="bg-base-300 px-1 py-0.5 rounded">.claude/skills/orchestration/SKILL.md</code> for the complete workflow reference</li>
              <li>Task progress is saved in <code class="bg-base-300 px-1 py-0.5 rounded">task-tracking/</code> folder for easy continuation</li>
            </ul>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <button class="btn btn-primary btn-lg" (click)="onOpenClaudeFolder()">
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
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            Open .claude Folder
          </button>
          <button class="btn btn-secondary btn-lg" (click)="onTestOrchestration()">
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
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Test /orchestrate
          </button>
          <button class="btn btn-ghost btn-lg" (click)="onStartNewChat()">
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
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            Start New Chat
          </button>
        </div>
      </div>
    </div>
  `,
})
export class CompletionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly vscodeService = inject(VSCodeService);

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
