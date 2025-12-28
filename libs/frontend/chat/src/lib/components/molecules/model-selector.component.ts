/**
 * ModelSelectorComponent - Elegant AI Model Selection Dropdown
 * TASK_2025_035: Model selector and autopilot integration
 *
 * A standalone dropdown component for selecting Claude AI models.
 * Features rich model metadata display with title, description, and recommended badge.
 *
 * Pattern: Signal-based state from ModelStateService
 * UI: DaisyUI dropdown with custom styling
 */

import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, ChevronDown, Check } from 'lucide-angular';
import {
  ModelStateService,
  type SelectableClaudeModel,
} from '@ptah-extension/core';

@Component({
  selector: 'ptah-model-selector',
  imports: [LucideAngularModule],
  template: `
    <div class="dropdown dropdown-top dropdown-end">
      <button
        tabindex="0"
        class="btn btn-ghost btn-sm gap-1 font-normal"
        type="button"
        [class.btn-disabled]="modelState.isPending()"
      >
        @if (modelState.isPending()) {
        <span class="loading loading-spinner loading-xs"></span>
        }
        <span class="text-xs font-medium">{{
          modelState.currentModelDisplay()
        }}</span>
        <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
      </button>
      <div
        tabindex="0"
        class="dropdown-content z-50 mb-2 p-1 shadow-lg bg-base-200 rounded-lg w-72 border border-base-300"
      >
        <!-- Header -->
        <div class="px-3 py-2 border-b border-base-300">
          <span
            class="text-xs font-semibold text-base-content/70 uppercase tracking-wide"
          >
            Select Model
          </span>
        </div>

        <!-- Model List -->
        <ul class="menu menu-sm p-1">
          @for (model of modelState.availableModels(); track model.id) {
          <li>
            <button
              type="button"
              class="flex items-start gap-3 py-2.5 px-3 rounded-md transition-colors"
              [class.bg-primary]="model.isSelected"
              [class.text-primary-content]="model.isSelected"
              [class.hover:bg-base-300]="!model.isSelected"
              (click)="selectModel(model.id)"
            >
              <!-- Checkmark for selected -->
              <div class="w-4 h-4 mt-0.5 flex-shrink-0">
                @if (model.isSelected) {
                <lucide-angular [img]="CheckIcon" class="w-4 h-4" />
                }
              </div>

              <!-- Model Info -->
              <div class="flex flex-col items-start flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{ model.name }}</span>
                  @if (model.isRecommended) {
                  <span
                    class="badge badge-xs"
                    [class.badge-primary-content]="model.isSelected"
                    [class.badge-primary]="!model.isSelected"
                  >
                    Recommended
                  </span>
                  }
                </div>
                <span
                  [class]="
                    'text-xs mt-0.5 ' +
                    (model.isSelected
                      ? 'text-primary-content/70'
                      : 'text-base-content/60')
                  "
                >
                  {{ model.description }}
                </span>
              </div>
            </button>
          </li>
          }
        </ul>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelSelectorComponent {
  readonly modelState = inject(ModelStateService);

  // Lucide icons
  readonly ChevronDownIcon = ChevronDown;
  readonly CheckIcon = Check;

  /**
   * Select AI model for chat sessions.
   * Fires async RPC call - errors are logged but do not block UI.
   * Race condition protection is handled by ModelStateService.
   *
   * @param model - The model to switch to ('opus', 'sonnet', or 'haiku')
   */
  selectModel(model: SelectableClaudeModel): void {
    // Close dropdown by removing focus
    const activeElement = document.activeElement as HTMLElement;
    activeElement?.blur();

    this.modelState.switchModel(model).catch((error) => {
      console.error('[ModelSelectorComponent] Failed to switch model:', error);
    });
  }
}
