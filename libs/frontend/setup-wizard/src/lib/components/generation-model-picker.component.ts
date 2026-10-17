import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ModelStateService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-generation-model-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-1">
      <label class="text-sm font-medium" [for]="'generation-model-' + tabId()"
        >Model for this tab</label
      >
      <select
        class="select select-bordered select-sm w-full"
        [id]="'generation-model-' + tabId()"
        [value]="selectedModel()"
        [disabled]="locked()"
        (change)="choose($event)"
      >
        @for (model of models.availableModels(); track model.id) {
          <option [value]="model.id" [selected]="model.id === selectedModel()">
            {{ model.name }}
          </option>
        }
      </select>
      <p class="text-xs text-base-content-muted">
        This is the tab model used by generation and chat.
      </p>
      @if (effectiveProvider() && effectiveProvider() !== 'unknown') {
        <p class="text-xs">Workspace provider: {{ effectiveProvider() }}</p>
      }
      @if (effectiveModel() && effectiveModel() !== 'unknown') {
        <p class="text-xs">Run model: {{ effectiveModel() }}</p>
      }
    </div>
  `,
})
export class GenerationModelPickerComponent {
  protected readonly models = inject(ModelStateService);
  private readonly tabs = inject(TabManagerService);
  readonly tabId = input.required<string>();
  readonly locked = input(false);
  readonly effectiveProvider = input<string | null>(null);
  readonly effectiveModel = input<string | null>(null);
  readonly selectedModel = computed(() => {
    const tab = this.tabs
      .tabs()
      .find((candidate) => candidate.id === this.tabId());
    return tab?.overrideModel ?? this.models.currentModel();
  });
  protected choose(event: Event): void {
    this.tabs.setOverrideModel(
      this.tabId(),
      (event.target as HTMLSelectElement).value,
    );
  }
}
