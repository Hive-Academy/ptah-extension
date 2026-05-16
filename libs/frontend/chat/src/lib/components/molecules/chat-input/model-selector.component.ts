/**
 * ModelSelectorComponent - Elegant AI Model Selection Dropdown
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
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ChevronDown, Check } from 'lucide-angular';
import { ModelStateService } from '@ptah-extension/core';
import {
  NativeDropdownComponent,
  NativeOptionComponent,
  KeyboardNavigationService,
} from '@ptah-extension/ui';
import { ChatStore } from '../../../services/chat.store';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
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
        class="btn btn-ghost btn-xs gap-1 font-normal h-6 min-h-0 px-1.5 max-w-[12rem]"
        [class.ring-1]="isOpen()"
        [class.ring-primary]="isOpen()"
        type="button"
        (click)="toggleDropdown()"
        [disabled]="modelState.isPending()"
      >
        @if (modelState.isPending()) {
          <span class="loading loading-spinner loading-xs"></span>
        }
        @if (effectiveModelProviderHint()) {
          <!-- Provider override active: show provider model as primary -->
          <span
            class="text-[10px] font-mono text-accent truncate"
            [title]="
              effectiveModelDisplay() + ' â†’ ' + effectiveModelProviderHint()
            "
            >{{ effectiveModelProviderHint() }}</span
          >
        } @else {
          <!-- No provider override: show standard display name -->
          <span
            class="text-[10px] font-medium truncate"
            [title]="effectiveModelDisplay()"
            >{{ effectiveModelDisplay() }}</span
          >
        }
        <lucide-angular
          [img]="ChevronDownIcon"
          class="w-2.5 h-2.5 flex-shrink-0 opacity-60"
        />
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
          @for (
            model of effectiveAvailableModels();
            track model.id;
            let i = $index
          ) {
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
                      class="text-[11px] mt-0.5 font-mono text-accent truncate max-w-full"
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
  private readonly tabManager = inject(TabManagerService);
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });

  // Lucide icons
  readonly ChevronDownIcon = ChevronDown;
  readonly CheckIcon = Check;

  // Local state for dropdown visibility
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  // Keyboard navigation - expose activeIndex for template
  readonly activeIndex = this.keyboardNav.activeIndex;

  /**
   * Effective model for this context: per-tab override when in canvas tile,
   * otherwise global ModelStateService selection.
   */
  readonly effectiveModel = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (tabId) {
        const tab = this.tabManager.tabs().find((t) => t.id === tabId);
        if (tab?.overrideModel) return tab.overrideModel;
      }
    }
    return this.modelState.currentModel();
  });

  /**
   * Display name for the effective model (resolves API name to human-readable).
   */
  readonly effectiveModelDisplay = computed(() => {
    const modelId = this.effectiveModel();
    const models = this.modelState.availableModels();
    const model = models.find((m) => m.id === modelId);
    return model?.name ?? modelId;
  });

  /**
   * Provider hint for the effective model.
   */
  readonly effectiveModelProviderHint = computed(() => {
    const modelId = this.effectiveModel();
    const models = this.modelState.availableModels();
    const model = models.find((m) => m.id === modelId);
    return model?.providerModelId ?? null;
  });

  /**
   * Available models with selection state reflecting the effective model.
   */
  readonly effectiveAvailableModels = computed(() => {
    const effective = this.effectiveModel();
    return this.modelState.availableModels().map((m) => ({
      ...m,
      isSelected: m.id === effective,
    }));
  });

  toggleDropdown(): void {
    this._isOpen.set(!this._isOpen());
  }

  closeDropdown(): void {
    this._isOpen.set(false);
  }

  /**
   * Select AI model. When in canvas tile context, stores override per-tab.
   * Otherwise updates the global ModelStateService.
   */
  selectModel(model: string): void {
    this.closeDropdown();

    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (tabId) {
        this.tabManager.setOverrideModel(tabId, model);
        return;
      }
    }

    const sessionId = this.chatStore.currentSessionId() as SessionId | null;
    this.modelState.switchModel(model, sessionId).catch((error) => {
      console.error('[ModelSelectorComponent] Failed to switch model:', error);
    });
  }

  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
