/**
 * ModelSelectorComponent - Elegant AI Model Selection Dropdown
 * TASK_2025_048: Migrate to CDK Overlay with keyboard navigation
 * TASK_2025_092: Migrate to Native components (Floating UI)
 *
 * A standalone dropdown component for selecting Claude AI models.
 * Features rich model metadata display with title, description, and recommended badge.
 *
 * Pattern: Signal-based state from ModelStateService
 * UI: NativeDropdownComponent from @ptah-extension/ui with Floating UI positioning
 * Keyboard Navigation: Parent manages activeIndex signal for NativeOptionComponent
 */

import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ChevronDown, Check } from 'lucide-angular';
import { ModelStateService } from '@ptah-extension/core';
import {
  NativeDropdownComponent,
  NativeOptionComponent,
  KeyboardNavigationService,
} from '@ptah-extension/ui';
import { ChatStore } from '../../services/chat.store';
import { SessionId } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-model-selector',
  imports: [
    LucideAngularModule,
    NativeDropdownComponent,
    NativeOptionComponent,
  ],
  providers: [KeyboardNavigationService],
  template: `
    <ptah-native-dropdown
      [isOpen]="isOpen()"
      [placement]="'bottom-end'"
      [closeOnBackdropClick]="true"
      (closed)="closeDropdown()"
      (backdropClicked)="closeDropdown()"
    >
      <button
        trigger
        class="btn btn-ghost btn-sm gap-1 font-normal"
        [class.ring-2]="isOpen()"
        [class.ring-primary]="isOpen()"
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
        <div class="px-2 py-1.5 border-b border-base-300">
          <span
            class="text-[11px] font-semibold text-base-content/70 uppercase tracking-wide"
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
          <ptah-native-option
            [optionId]="'model-' + i"
            [value]="model"
            [isActive]="i === activeIndex()"
            (selected)="selectModel($event.id)"
            (hovered)="onHover(i)"
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
                  <span class="font-medium text-xs">{{ model.name }}</span>
                  @if (model.isRecommended) {
                  <span class="badge badge-xs badge-primary">
                    Recommended
                  </span>
                  }
                </div>
                @if (model.providerModelId) {
                <span
                  class="text-[11px] mt-0.5 font-mono text-accent"
                >
                  {{ model.providerModelId }}
                </span>
                }
                <span class="text-[11px] mt-0.5 text-base-content/60">
                  {{ model.description }}
                </span>
              </div>
            </div>
          </ptah-native-option>
          }
        </div>
      </div>
    </ptah-native-dropdown>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelSelectorComponent {
  readonly modelState = inject(ModelStateService);
  private readonly chatStore = inject(ChatStore);
  private readonly keyboardNav = inject(KeyboardNavigationService);

  // Lucide icons
  readonly ChevronDownIcon = ChevronDown;
  readonly CheckIcon = Check;

  // Local state for dropdown visibility
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  // Keyboard navigation - expose activeIndex for template
  readonly activeIndex = this.keyboardNav.activeIndex;

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
   * Called by NativeOptionComponent (selected) output.
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

  /**
   * Handle hover on option - update active index
   */
  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
