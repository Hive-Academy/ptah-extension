/**
 * DescribeStepComponent
 *
 * Step 1: Describe Your Harness. Accepts ANY freeform input — a simple instruction
 * like "build a harness for real-estate marketing", a pasted PRD document, or any
 * description. The AI analyzes the intent and architects a complete harness:
 * personas, subagents, skills, system prompt, MCP servers — everything.
 *
 * After analysis, shows a summary of what was configured with counts and a
 * reasoning panel, then the user can proceed to fine-tune individual steps.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Sparkles,
  Wand2,
  Bot,
  Wrench,
  FileText,
  Server,
  CheckCircle,
  AlertCircle,
} from 'lucide-angular';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { HarnessStreamingService } from '../../services/harness-streaming.service';

@Component({
  selector: 'ptah-describe-step',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold flex items-center gap-2">
          <lucide-angular
            [img]="Wand2Icon"
            class="w-5 h-5 text-primary"
            aria-hidden="true"
          />
          Describe Your Harness
        </h2>
        <p class="text-sm text-base-content/60 mt-1">
          Tell the AI what you need — paste a PRD, describe a workflow, or just
          say what you want to build. The AI will architect everything for you.
        </p>
      </div>

      <!-- Freeform input -->
      <div class="form-control">
        <label class="label" for="intent-input">
          <span class="label-text font-medium">What do you want to build?</span>
          <span class="label-text-alt text-base-content/50">
            {{ inputText().length }} characters
          </span>
        </label>
        <textarea
          id="intent-input"
          class="textarea textarea-bordered w-full"
          [class.h-48]="!intentAnalyzed()"
          [class.h-24]="intentAnalyzed()"
          placeholder="Examples:
• Build a harness for real-estate marketing with social media automation
• I need an AI coding assistant for a React + Node.js monorepo with CI/CD
• [Paste your entire PRD document here]
• Create a content creation pipeline with SEO optimization and brand voice"
          [ngModel]="inputText()"
          (ngModelChange)="onInputChange($event)"
          [disabled]="isAnalyzing()"
          aria-label="Describe your harness"
        ></textarea>
      </div>

      <!-- Architect button -->
      <button
        type="button"
        class="btn btn-primary w-full gap-2"
        (click)="analyzeIntent()"
        [disabled]="isAnalyzing() || !canAnalyze()"
      >
        @if (isAnalyzing()) {
          <span class="loading loading-spinner loading-sm"></span>
          Architecting your harness...
        } @else {
          <lucide-angular
            [img]="SparklesIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          {{ intentAnalyzed() ? 'Re-analyze' : 'Architect with AI' }}
        }
      </button>

      @if (analysisError()) {
        <div class="alert alert-error text-xs">
          <lucide-angular
            [img]="AlertCircleIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          <span>{{ analysisError() }}</span>
        </div>
      }

      <!-- Analysis Results -->
      @if (intentAnalyzed()) {
        <div class="space-y-4">
          <div class="divider text-xs text-base-content/40">
            <lucide-angular
              [img]="CheckCircleIcon"
              class="w-4 h-4 text-success"
              aria-hidden="true"
            />
            Harness Architected
          </div>

          <!-- Summary -->
          @if (intentSummary()) {
            <div class="alert alert-success text-sm">
              <span>{{ intentSummary() }}</span>
            </div>
          }

          <!-- What was configured — stats grid -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            <!-- Persona -->
            <div class="card bg-base-200 p-3 text-center">
              <lucide-angular
                [img]="SparklesIcon"
                class="w-5 h-5 text-primary mx-auto mb-1"
                aria-hidden="true"
              />
              <div class="text-xs font-medium text-base-content/70">
                Persona
              </div>
              <div class="text-sm font-bold">
                {{ personaLabel() || 'Set' }}
              </div>
            </div>

            <!-- Agents -->
            <div class="card bg-base-200 p-3 text-center">
              <lucide-angular
                [img]="BotIcon"
                class="w-5 h-5 text-primary mx-auto mb-1"
                aria-hidden="true"
              />
              <div class="text-xs font-medium text-base-content/70">Agents</div>
              <div class="text-sm font-bold">
                {{ enabledAgentCount() + harnessSubagentCount() || 'None' }}
              </div>
            </div>

            <!-- Skills -->
            <div class="card bg-base-200 p-3 text-center">
              <lucide-angular
                [img]="WrenchIcon"
                class="w-5 h-5 text-primary mx-auto mb-1"
                aria-hidden="true"
              />
              <div class="text-xs font-medium text-base-content/70">Skills</div>
              <div class="text-sm font-bold">
                {{ skillCount() || 'None' }}
              </div>
            </div>

            <!-- MCP -->
            <div class="card bg-base-200 p-3 text-center">
              <lucide-angular
                [img]="ServerIcon"
                class="w-5 h-5 text-primary mx-auto mb-1"
                aria-hidden="true"
              />
              <div class="text-xs font-medium text-base-content/70">MCP</div>
              <div class="text-sm font-bold">
                {{ mcpSuggestionCount() || 'None' }}
              </div>
            </div>
          </div>

          <!-- Prompt preview -->
          @if (hasPrompt()) {
            <div class="card bg-base-200 p-3">
              <div class="flex items-center gap-2 mb-2">
                <lucide-angular
                  [img]="FileTextIcon"
                  class="w-4 h-4 text-primary"
                  aria-hidden="true"
                />
                <span class="font-medium text-sm">System Prompt</span>
                <span class="badge badge-xs badge-ghost">generated</span>
              </div>
              <p class="text-xs text-base-content/70 line-clamp-3">
                {{ promptPreview() }}
              </p>
            </div>
          }

          <!-- Reasoning -->
          @if (analysisReasoning()) {
            <details class="collapse collapse-arrow bg-base-200 rounded-lg">
              <summary class="collapse-title text-sm font-medium min-h-0 py-2">
                AI Reasoning
              </summary>
              <div class="collapse-content text-xs text-base-content/70">
                {{ analysisReasoning() }}
              </div>
            </details>
          }

          <p class="text-xs text-base-content/50 text-center">
            Proceed to the next steps to review and fine-tune each section.
          </p>
        </div>
      }
    </div>
  `,
})
export class DescribeStepComponent {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly streaming = inject(HarnessStreamingService);

  // Icons
  protected readonly SparklesIcon = Sparkles;
  protected readonly Wand2Icon = Wand2;
  protected readonly BotIcon = Bot;
  protected readonly WrenchIcon = Wrench;
  protected readonly FileTextIcon = FileText;
  protected readonly ServerIcon = Server;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly AlertCircleIcon = AlertCircle;

  // Local UI state
  public readonly inputText = computed(() => this.state.intentInput());
  public readonly isAnalyzing = signal(false);
  public readonly analysisError = signal<string | null>(null);
  public readonly analysisReasoning = signal<string | null>(null);

  // Derived from state
  public readonly intentAnalyzed = computed(() => this.state.intentAnalyzed());
  public readonly intentSummary = computed(() => this.state.intentSummary());

  public readonly personaLabel = computed(
    () => this.state.config().persona?.label ?? '',
  );

  public readonly enabledAgentCount = computed(() => {
    const agents = this.state.config().agents?.enabledAgents ?? {};
    return Object.values(agents).filter((a) => a.enabled).length;
  });

  public readonly harnessSubagentCount = computed(
    () => (this.state.config().agents?.harnessSubagents ?? []).length,
  );

  public readonly skillCount = computed(() => {
    const selected = this.state.config().skills?.selectedSkills?.length ?? 0;
    const generated = this.state.generatedSkillSpecs().length;
    return selected + generated;
  });

  public readonly mcpSuggestionCount = computed(
    () => this.state.suggestedMcpServers().length,
  );

  public readonly hasPrompt = computed(
    () => (this.state.config().prompt?.systemPrompt?.length ?? 0) > 0,
  );

  public readonly promptPreview = computed(() => {
    const prompt = this.state.config().prompt?.systemPrompt ?? '';
    return prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt;
  });

  /** Can analyze when there is meaningful input */
  public readonly canAnalyze = computed(
    () => this.state.intentInput().trim().length > 10,
  );

  /** Handle input text changes by persisting to state service */
  public onInputChange(text: string): void {
    this.state.setIntentInput(text);
  }

  public async analyzeIntent(): Promise<void> {
    if (this.isAnalyzing()) return;

    this.isAnalyzing.set(true);
    this.analysisError.set(null);
    this.analysisReasoning.set(null);
    this.streaming.reset();

    try {
      const response = await this.rpc.analyzeIntent({
        input: this.state.intentInput().trim(),
        workspaceContext: this.state.workspaceContext() ?? undefined,
      });

      // Bulk-populate all steps from the AI's analysis
      this.state.applyIntentAnalysis(response);
      this.analysisReasoning.set(response.reasoning);
    } catch (err) {
      this.analysisError.set(
        err instanceof Error ? err.message : 'Failed to analyze intent',
      );
    } finally {
      this.isAnalyzing.set(false);
    }
  }
}
