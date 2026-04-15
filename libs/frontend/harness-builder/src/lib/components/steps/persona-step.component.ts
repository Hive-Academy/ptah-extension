/**
 * PersonaStepComponent
 *
 * Step 1: Persona selection. User describes their role and goals.
 * Provides a textarea for describing role/goals and an "Get AI Suggestions"
 * button that calls suggestConfig to pre-populate subsequent steps.
 * Extracted goals are shown as editable tags.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Sparkles, X, Plus, User } from 'lucide-angular';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';

@Component({
  selector: 'ptah-persona-step',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold flex items-center gap-2">
          <lucide-angular
            [img]="UserIcon"
            class="w-5 h-5 text-primary"
            aria-hidden="true"
          />
          Define Your Persona
        </h2>
        <p class="text-sm text-base-content/60 mt-1">
          Describe your role, workflow, and what you want to accomplish. The AI
          will use this to suggest optimal configurations.
        </p>
      </div>

      <!-- Persona label -->
      <div class="form-control">
        <label class="label" for="persona-label">
          <span class="label-text font-medium">Persona Name</span>
        </label>
        <input
          id="persona-label"
          type="text"
          class="input input-bordered w-full"
          placeholder="e.g., Full-Stack Developer, Data Engineer, DevOps Lead"
          [ngModel]="personaLabel()"
          (ngModelChange)="onLabelChange($event)"
        />
      </div>

      <!-- Description textarea -->
      <div class="form-control">
        <label class="label" for="persona-description">
          <span class="label-text font-medium">Description</span>
        </label>
        <textarea
          id="persona-description"
          class="textarea textarea-bordered h-32 w-full"
          placeholder="Describe your role, the kind of projects you work on, your preferred tools and workflows, and what you want the AI coding assistant to help with..."
          [ngModel]="personaDescription()"
          (ngModelChange)="onDescriptionChange($event)"
        ></textarea>
      </div>

      <!-- Goals section -->
      <div class="form-control">
        <label class="label" for="goal-input">
          <span class="label-text font-medium">Goals</span>
          <span class="label-text-alt text-base-content/50">
            {{ goals().length }} goal(s)
          </span>
        </label>
        <div class="flex flex-wrap gap-2 mb-2">
          @for (goal of goals(); track $index) {
            <div class="badge badge-lg badge-outline gap-1 pr-1">
              <span class="text-xs">{{ goal }}</span>
              <button
                class="btn btn-ghost btn-xs btn-circle"
                (click)="removeGoal($index)"
                [attr.aria-label]="'Remove goal: ' + goal"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              </button>
            </div>
          }
        </div>
        <div class="flex gap-2">
          <input
            id="goal-input"
            type="text"
            class="input input-bordered input-sm flex-1"
            placeholder="Add a goal..."
            [ngModel]="newGoal()"
            (ngModelChange)="newGoal.set($event)"
            (keydown.enter)="addGoal()"
          />
          <button
            class="btn btn-outline btn-sm"
            (click)="addGoal()"
            [disabled]="!newGoal().trim()"
            aria-label="Add goal"
          >
            <lucide-angular
              [img]="PlusIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Add
          </button>
        </div>
      </div>

      <!-- AI Suggestions button -->
      <div class="divider text-xs text-base-content/40">AI Assistance</div>
      <button
        class="btn btn-primary w-full gap-2"
        (click)="getAiSuggestions()"
        [disabled]="isSuggesting() || !canSuggest()"
      >
        @if (isSuggesting()) {
          <span class="loading loading-spinner loading-sm"></span>
          Analyzing...
        } @else {
          <lucide-angular
            [img]="SparklesIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          Get AI Suggestions
        }
      </button>

      @if (suggestionError()) {
        <div class="alert alert-error text-xs">
          <span>{{ suggestionError() }}</span>
        </div>
      }

      @if (suggestionReasoning()) {
        <div class="alert alert-info text-xs">
          <span>{{ suggestionReasoning() }}</span>
        </div>
      }
    </div>
  `,
})
export class PersonaStepComponent {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);

  // Icons
  protected readonly UserIcon = User;
  protected readonly SparklesIcon = Sparkles;
  protected readonly XIcon = X;
  protected readonly PlusIcon = Plus;

  // Local UI state
  public readonly newGoal = signal('');
  public readonly isSuggesting = signal(false);
  public readonly suggestionError = signal<string | null>(null);
  public readonly suggestionReasoning = signal<string | null>(null);

  // Derived from state
  public readonly personaLabel = computed(
    () => this.state.config().persona?.label ?? '',
  );
  public readonly personaDescription = computed(
    () => this.state.config().persona?.description ?? '',
  );
  public readonly goals = computed(
    () => this.state.config().persona?.goals ?? [],
  );

  /** Can request AI suggestions when there is a description */
  public readonly canSuggest = computed(
    () => this.personaDescription().trim().length > 10,
  );

  public onLabelChange(label: string): void {
    this.state.updatePersona({
      label,
      description: this.personaDescription(),
      goals: this.goals(),
    });
  }

  public onDescriptionChange(description: string): void {
    this.state.updatePersona({
      label: this.personaLabel(),
      description,
      goals: this.goals(),
    });
  }

  public addGoal(): void {
    const goal = this.newGoal().trim();
    if (!goal) return;
    const updated = [...this.goals(), goal];
    this.state.updatePersona({
      label: this.personaLabel(),
      description: this.personaDescription(),
      goals: updated,
    });
    this.newGoal.set('');
  }

  public removeGoal(index: number): void {
    const updated = this.goals().filter((_, i) => i !== index);
    this.state.updatePersona({
      label: this.personaLabel(),
      description: this.personaDescription(),
      goals: updated,
    });
  }

  public async getAiSuggestions(): Promise<void> {
    if (this.isSuggesting()) return;

    this.isSuggesting.set(true);
    this.suggestionError.set(null);
    this.suggestionReasoning.set(null);

    try {
      const response = await this.rpc.suggestConfig({
        personaDescription: this.personaDescription(),
        goals: this.goals(),
      });

      // Pre-populate agents from suggestions
      this.state.updateAgents({ enabledAgents: response.suggestedAgents });

      // Pre-populate skills from suggestions
      this.state.updateSkills({
        selectedSkills: response.suggestedSkills,
        createdSkills: [],
      });

      // Pre-populate prompt from suggestions
      this.state.updatePrompt({
        systemPrompt: response.suggestedPrompt,
        enhancedSections: {},
      });

      // Pre-populate MCP server suggestions
      this.state.setSuggestedMcpServers(response.suggestedMcpServers ?? []);

      this.suggestionReasoning.set(response.reasoning);
    } catch (err) {
      this.suggestionError.set(
        err instanceof Error ? err.message : 'Failed to get suggestions',
      );
    } finally {
      this.isSuggesting.set(false);
    }
  }
}
