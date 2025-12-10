/**
 * ModelSelectorComponent - Elegant AI Model Selection Dropdown
 * TASK_2025_048: Migrate to CDK Overlay with keyboard navigation
 *
 * A standalone dropdown component for selecting Claude AI models.
 * Features rich model metadata display with title, description, and recommended badge.
 *
 * Pattern: Signal-based state from ModelStateService
 * UI: lib-dropdown from @ptah-extension/ui with CDK Overlay portal rendering
 * Keyboard Navigation: Handled by lib-option components (ArrowUp/Down/Enter/Escape)
 */

import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ChevronDown, Check } from 'lucide-angular';
import { ModelStateService } from '@ptah-extension/core';
import { DropdownComponent, OptionComponent } from '@ptah-extension/ui';
import { ChatStore } from '../../services/chat.store';
import { SessionId } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-model-selector',
  imports: [LucideAngularModule, DropdownComponent, OptionComponent],
  template: `
    <ptah-dropdown
      [isOpen]="isOpen()"
      [closeOnBackdropClick]="true"
      (closed)="closeDropdown()"
      (backdropClicked)="closeDropdown()"
    >
      <button
        trigger
        class="btn btn-ghost btn-sm gap-1 font-normal"
        type="button"
        (click)="toggleDropdown()"
        [disabled]="modelState.isPending()"
      >
        @if (modelState.isPending()) {
        <span class="loading loading-spinner loading-xs"></span>
        }
        <span class="text-xs font-medium">{{
          modelState.currentModelDisplay()
        }}</span>
        <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
      </button>

      <div content class="w-72 max-h-80 flex flex-col">
        <!-- Header -->
        <div class="px-3 py-2 border-b border-base-300">
          <span
            class="text-xs font-semibold text-base-content/70 uppercase tracking-wide"
          >
            Select Model
          </span>
        </div>

        <!-- Model List -->
        <div
          class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1"
        >
          @for (model of modelState.availableModels(); track model.id; let i =
          $index) {
          <ptah-option
            [optionId]="'model-' + i"
            [value]="model"
            (selected)="selectModel($event.id)"
          >
            <div class="flex items-start gap-3 py-0.5">
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
                  <span class="badge badge-xs badge-primary">
                    Recommended
                  </span>
                  }
                </div>
                <span class="text-xs mt-0.5 text-base-content/60">
                  {{ model.description }}
                </span>
              </div>
            </div>
          </ptah-option>
          }
        </div>
      </div>
    </ptah-dropdown>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelSelectorComponent {
  readonly modelState = inject(ModelStateService);
  private readonly chatStore = inject(ChatStore);

  // Lucide icons
  readonly ChevronDownIcon = ChevronDown;
  readonly CheckIcon = Check;

  // Local state for dropdown visibility
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  /**
   * Toggle dropdown visibility
   */
  toggleDropdown(): void {
    this._isOpen.set(!this._isOpen());
  }

  /**
   * Close dropdown
   */
  closeDropdown(): void {
    this._isOpen.set(false);
  }

  /**
   * Select AI model for chat sessions.
   * Fires async RPC call - errors are logged but do not block UI.
   * Race condition protection is handled by ModelStateService.
   * Called by lib-option (selected) output.
   *
   * @param model - The model ID to switch to (API name like 'claude-sonnet-4-20250514')
   */
  selectModel(model: string): void {
    this.closeDropdown();

    // Pass sessionId for live SDK sync (cast to SessionId as it's actually a branded type from backend)
    const sessionId = this.chatStore.currentSessionId() as SessionId | null;
    this.modelState.switchModel(model, sessionId).catch((error) => {
      console.error('[ModelSelectorComponent] Failed to switch model:', error);
    });
  }
}
