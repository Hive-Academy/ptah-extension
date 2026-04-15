/**
 * PromptsStepComponent
 *
 * Step 4: System prompt editor. Large textarea with the AI-generated system prompt,
 * "Enhance with AI" button, section editor for adding custom sections (key-value pairs),
 * and a preview toggle.
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
  FileText,
  Sparkles,
  Plus,
  X,
  Eye,
  EyeOff,
} from 'lucide-angular';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';

@Component({
  selector: 'ptah-prompts-step',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold flex items-center gap-2">
          <lucide-angular
            [img]="FileTextIcon"
            class="w-5 h-5 text-primary"
            aria-hidden="true"
          />
          System Prompt
        </h2>
        <p class="text-sm text-base-content/60 mt-1">
          Customize the system prompt that guides AI behavior.
        </p>
      </div>

      <!-- Generate / Enhance button -->
      <div class="flex gap-2">
        <button
          class="btn btn-primary btn-sm gap-2 flex-1"
          (click)="generatePrompt()"
          [disabled]="isGenerating()"
        >
          @if (isGenerating()) {
            <span class="loading loading-spinner loading-sm"></span>
            Generating...
          } @else {
            <lucide-angular
              [img]="SparklesIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            {{ hasPrompt() ? 'Enhance with AI' : 'Generate with AI' }}
          }
        </button>
        <button
          class="btn btn-outline btn-sm gap-1"
          (click)="showPreview.set(!showPreview())"
          [attr.aria-label]="showPreview() ? 'Hide preview' : 'Show preview'"
        >
          <lucide-angular
            [img]="showPreview() ? EyeOffIcon : EyeIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          {{ showPreview() ? 'Edit' : 'Preview' }}
        </button>
      </div>

      @if (generateError()) {
        <div class="alert alert-error text-xs">
          <span>{{ generateError() }}</span>
        </div>
      }

      <!-- Prompt editor / preview -->
      @if (showPreview()) {
        <div
          class="bg-base-200 rounded-lg p-4 text-sm whitespace-pre-wrap font-mono overflow-y-auto max-h-96"
          role="region"
          aria-label="Prompt preview"
        >
          {{ systemPrompt() || 'No prompt configured yet.' }}
        </div>
      } @else {
        <div class="form-control">
          <label class="label" for="system-prompt">
            <span class="label-text font-medium">System Prompt</span>
          </label>
          <textarea
            id="system-prompt"
            class="textarea textarea-bordered h-64 w-full font-mono text-sm"
            placeholder="Enter the system prompt that will guide AI behavior..."
            [ngModel]="systemPrompt()"
            (ngModelChange)="onPromptChange($event)"
          ></textarea>
        </div>
      }

      <!-- Custom Sections -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-sm">Custom Sections</h3>
          <button
            class="btn btn-ghost btn-xs gap-1"
            (click)="addSection()"
            aria-label="Add custom section"
          >
            <lucide-angular
              [img]="PlusIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
            Add Section
          </button>
        </div>

        @for (section of sectionEntries(); track section.key) {
          <div class="card bg-base-200 p-3 space-y-2">
            <div class="flex items-center gap-2">
              <label class="sr-only" [for]="'section-key-' + $index"
                >Section name</label
              >
              <input
                [id]="'section-key-' + $index"
                type="text"
                class="input input-bordered input-xs flex-1"
                placeholder="Section name"
                [ngModel]="section.key"
                (ngModelChange)="updateSectionKey($index, $event)"
              />
              <button
                class="btn btn-ghost btn-xs btn-circle"
                (click)="removeSection($index)"
                [attr.aria-label]="'Remove section: ' + section.key"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-3.5 h-3.5"
                  aria-hidden="true"
                />
              </button>
            </div>
            <label class="sr-only" [for]="'section-value-' + $index"
              >Section content</label
            >
            <textarea
              [id]="'section-value-' + $index"
              class="textarea textarea-bordered textarea-xs w-full h-20 font-mono"
              placeholder="Section content..."
              [ngModel]="section.value"
              (ngModelChange)="updateSectionValue($index, $event)"
            ></textarea>
          </div>
        }
      </div>
    </div>
  `,
})
export class PromptsStepComponent {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);

  // Icons
  protected readonly FileTextIcon = FileText;
  protected readonly SparklesIcon = Sparkles;
  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;
  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;

  // Local state
  public readonly showPreview = signal(false);
  public readonly isGenerating = signal(false);
  public readonly generateError = signal<string | null>(null);

  public readonly systemPrompt = computed(
    () => this.state.config().prompt?.systemPrompt ?? '',
  );

  public readonly hasPrompt = computed(
    () => this.systemPrompt().trim().length > 0,
  );

  public readonly enhancedSections = computed(
    () => this.state.config().prompt?.enhancedSections ?? {},
  );

  /** Convert sections record to array for iteration */
  public readonly sectionEntries = computed(() => {
    const sections = this.enhancedSections();
    return Object.entries(sections).map(([key, value]) => ({ key, value }));
  });

  public onPromptChange(prompt: string): void {
    this.state.updatePrompt({
      systemPrompt: prompt,
      enhancedSections: this.enhancedSections(),
    });
  }

  public addSection(): void {
    const sections = { ...this.enhancedSections() };
    const key = `section-${Object.keys(sections).length + 1}`;
    sections[key] = '';
    this.state.updatePrompt({
      systemPrompt: this.systemPrompt(),
      enhancedSections: sections,
    });
  }

  public removeSection(index: number): void {
    const entries = this.sectionEntries();
    const sections: Record<string, string> = {};
    entries.forEach((entry, i) => {
      if (i !== index) {
        sections[entry.key] = entry.value;
      }
    });
    this.state.updatePrompt({
      systemPrompt: this.systemPrompt(),
      enhancedSections: sections,
    });
  }

  public updateSectionKey(index: number, newKey: string): void {
    const trimmedKey = newKey.trim();
    const entries = this.sectionEntries();
    const oldKey = entries[index]?.key;

    // Skip if empty, unchanged, or would collide with an existing key
    if (!trimmedKey || trimmedKey === oldKey) return;
    const existingSections = this.enhancedSections();
    if (trimmedKey in existingSections && trimmedKey !== oldKey) {
      return; // Key already exists — don't overwrite
    }

    const sections: Record<string, string> = {};
    entries.forEach((entry, i) => {
      if (i === index) {
        sections[trimmedKey] = entry.value;
      } else {
        sections[entry.key] = entry.value;
      }
    });
    this.state.updatePrompt({
      systemPrompt: this.systemPrompt(),
      enhancedSections: sections,
    });
  }

  public updateSectionValue(index: number, newValue: string): void {
    const entries = this.sectionEntries();
    const sections: Record<string, string> = {};
    entries.forEach((entry, i) => {
      if (i === index) {
        sections[entry.key] = newValue;
      } else {
        sections[entry.key] = entry.value;
      }
    });
    this.state.updatePrompt({
      systemPrompt: this.systemPrompt(),
      enhancedSections: sections,
    });
  }

  public async generatePrompt(): Promise<void> {
    if (this.isGenerating()) return;

    this.isGenerating.set(true);
    this.generateError.set(null);

    try {
      const cfg = this.state.config();
      const enabledAgentIds = Object.entries(cfg.agents?.enabledAgents ?? {})
        .filter(([, v]) => v.enabled)
        .map(([k]) => k);

      const response = await this.rpc.generatePrompt({
        persona: cfg.persona ?? {
          label: '',
          description: '',
          goals: [],
        },
        enabledAgents: enabledAgentIds,
        selectedSkills: cfg.skills?.selectedSkills ?? [],
      });

      this.state.updatePrompt({
        systemPrompt: response.generatedPrompt,
        enhancedSections: response.sections,
      });
    } catch (err) {
      this.generateError.set(
        err instanceof Error ? err.message : 'Failed to generate prompt',
      );
    } finally {
      this.isGenerating.set(false);
    }
  }
}
