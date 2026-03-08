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
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-8">
      <div class="max-w-6xl mx-auto space-y-8">
        <!-- Success Header -->
        <div class="text-center">
          <div class="flex justify-center mb-4">
            <div class="rounded-full bg-success/20 p-4">
              <lucide-angular
                [img]="CheckIcon"
                class="h-12 w-12 text-success"
              />
            </div>
          </div>
          <h1 class="text-2xl font-bold mb-3">Setup Complete!</h1>
          <p class="text-base-content/60 max-w-xl mx-auto">
            Your personalized agents have been generated. You're ready to start
            using intelligent development workflows.
          </p>
        </div>

        <!-- Generated Agents Section -->
        <div>
          <div class="flex items-center gap-3 mb-5">
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

          <!-- Agent Tiles Grid -->
          @if (agentFiles().length > 0) {
          <div
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
          >
            @for (file of agentFiles(); track file.id) {
            <div
              class="card bg-base-200/50 hover:bg-base-200 shadow-sm hover:shadow-md transition-all"
            >
              <div class="card-body p-5 text-center">
                <div class="flex justify-center mb-3">
                  <div class="rounded-full bg-success/20 p-2">
                    <lucide-angular
                      [img]="CheckIcon"
                      class="h-4 w-4 text-success"
                    />
                  </div>
                </div>
                <h3
                  class="text-xs font-medium leading-snug opacity-90"
                  [title]="file.name"
                >
                  {{ formatAgentName(file.name) }}
                </h3>
              </div>
            </div>
            }
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
                  <div
                    class="bg-base-300/30 rounded-lg p-4 border border-base-300"
                  >
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
                              >.claude/specs/</code
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
   * Count of generated agents.
   */
  protected readonly agentCount = computed(() => {
    return this.agentFiles().length;
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
   * Format agent filename for display on tiles.
   * Removes file extension and converts kebab-case to Title Case.
   * Example: "frontend-developer.md" -> "Frontend Developer"
   */
  protected formatAgentName(filename: string): string {
    // Remove .md extension
    const nameWithoutExt = filename.replace(/\.md$/i, '');

    // Convert kebab-case to Title Case
    return nameWithoutExt
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Close the wizard and navigate to chat view.
   */
  protected onCloseWizard(): void {
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.SETUP_WIZARD_START_CHAT,
    });
  }
}
