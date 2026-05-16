/**
 * EffortSelectorComponent - Reasoning Effort Level Dropdown
 *
 * A standalone dropdown for selecting Claude's reasoning effort level.
 * Uses NativeDropdownComponent to match model-selector and agent-selector patterns.
 *
 * Pattern: Signal-based state, output() API
 * UI: NativeDropdownComponent from @ptah-extension/ui with Floating UI positioning
 * Keyboard Navigation: Parent manages activeIndex signal for NativeOptionComponent
 */

import {
  Component,
  signal,
  computed,
  output,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ChevronDown, Check, Brain } from 'lucide-angular';
import { type EffortLevel } from '@ptah-extension/shared';
import { EffortStateService } from '@ptah-extension/core';
import {
  NativeDropdownComponent,
  NativeOptionComponent,
  KeyboardNavigationService,
} from '@ptah-extension/ui';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';

interface EffortOption {
  value: EffortLevel | '';
  label: string;
  description: string;
  /** Tailwind color class for the level indicator dot */
  dotColor: string;
  /** Tailwind text color for the label in the trigger button */
  textColor: string;
  /** Number of filled bars (0-4) for the level meter */
  bars: number;
}

const EFFORT_OPTIONS: readonly EffortOption[] = [
  {
    value: '',
    label: 'Default',
    description: 'SDK default reasoning effort',
    dotColor: 'bg-base-content/40',
    textColor: 'text-base-content/70',
    bars: 0,
  },
  {
    value: 'low',
    label: 'Low',
    description: 'Faster responses, less reasoning',
    dotColor: 'bg-info',
    textColor: 'text-info',
    bars: 1,
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balanced speed and reasoning',
    dotColor: 'bg-success',
    textColor: 'text-success',
    bars: 2,
  },
  {
    value: 'high',
    label: 'High',
    description: 'More thorough reasoning',
    dotColor: 'bg-warning',
    textColor: 'text-warning',
    bars: 3,
  },
  {
    value: 'xhigh',
    label: 'X-High',
    description: 'Extra-deep reasoning (Opus tier)',
    dotColor: 'bg-error/80',
    textColor: 'text-error/90',
    bars: 4,
  },
  {
    value: 'max',
    label: 'Max',
    description: 'Maximum reasoning depth (Opus tier)',
    dotColor: 'bg-error',
    textColor: 'text-error',
    bars: 5,
  },
] as const;

@Component({
  selector: 'ptah-effort-selector',
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
        class="btn btn-ghost btn-xs gap-1 font-normal h-6 min-h-0 px-1.5"
        [class.ring-1]="isOpen()"
        [class.ring-primary]="isOpen()"
        type="button"
        (click)="toggleDropdown()"
        aria-label="Select reasoning effort level"
        title="Reasoning effort level"
      >
        <lucide-angular
          [img]="BrainIcon"
          [class]="'w-3 h-3 ' + selectedOption().textColor"
        />
        <!-- Level bars indicator -->
        <div class="flex items-end gap-px h-3">
          @for (bar of barSlots; track bar) {
            <div
              [class]="
                'w-[3px] rounded-[1px] transition-all ' +
                (bar < selectedOption().bars
                  ? selectedOption().dotColor + ' opacity-100'
                  : 'bg-base-content/20 opacity-60')
              "
              [style.height.px]="4 + bar * 2.5"
            ></div>
          }
        </div>
        <span [class]="'text-[10px] font-mono ' + selectedOption().textColor">{{
          selectedLabel()
        }}</span>
        <lucide-angular
          [img]="ChevronDownIcon"
          class="w-2.5 h-2.5 flex-shrink-0 opacity-60"
        />
      </button>

      <div content class="w-56 max-h-80 flex flex-col">
        <!-- Header -->
        <div class="px-2 py-1.5 border-b border-base-300">
          <span
            class="text-[11px] font-semibold text-base-content/70 uppercase tracking-wide"
          >
            Reasoning Effort
          </span>
        </div>

        <!-- Effort Options -->
        <div
          class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1"
        >
          @for (option of effortOptions; track option.value; let i = $index) {
            <ptah-native-option
              [optionId]="'effort-' + i"
              [value]="option"
              [isActive]="i === activeIndex()"
              (selected)="selectEffort($event)"
              (hovered)="onHover(i)"
            >
              <div class="flex items-center gap-2.5 py-0.5">
                <!-- Checkmark for selected -->
                <div
                  class="w-4 h-4 flex-shrink-0 flex items-center justify-center"
                >
                  @if (option.value === effectiveEffort()) {
                    <lucide-angular [img]="CheckIcon" class="w-4 h-4" />
                  }
                </div>

                <!-- Color dot indicator -->
                <div
                  [class]="
                    'w-2 h-2 rounded-full flex-shrink-0 ' + option.dotColor
                  "
                ></div>

                <!-- Option Info -->
                <div class="flex flex-col items-start flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span
                      [class]="
                        'font-medium text-xs ' +
                        (option.value === effectiveEffort()
                          ? option.textColor
                          : '')
                      "
                      >{{ option.label }}</span
                    >
                    <!-- Mini level bars in dropdown -->
                    <div class="flex items-end gap-px h-2.5">
                      @for (bar of barSlots; track bar) {
                        <div
                          [class]="
                            'w-[2px] rounded-[1px] ' +
                            (bar < option.bars
                              ? option.dotColor
                              : 'bg-base-content/15')
                          "
                          [style.height.px]="3 + bar * 1.5"
                        ></div>
                      }
                    </div>
                  </div>
                  <span class="text-[11px] mt-0.5 text-base-content/60">
                    {{ option.description }}
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
export class EffortSelectorComponent {
  private readonly keyboardNav = inject(KeyboardNavigationService);
  private readonly effortState = inject(EffortStateService);
  private readonly tabManager = inject(TabManagerService);
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });

  readonly BrainIcon = Brain;
  readonly ChevronDownIcon = ChevronDown;
  readonly CheckIcon = Check;

  readonly effortOptions = EFFORT_OPTIONS;
  readonly barSlots = [0, 1, 2, 3, 4];

  /**
   * Effective effort for this context: per-tab override when in canvas tile,
   * otherwise global EffortStateService selection.
   * Three-state semantics on TabState:
   *   undefined = not set (follow global), null = explicitly SDK default, EffortLevel = override
   */
  readonly effectiveEffort = computed((): EffortLevel | '' => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (tabId) {
        const tab = this.tabManager.tabs().find((t) => t.id === tabId);
        if (tab?.overrideEffort !== undefined) {
          return tab.overrideEffort ?? '';
        }
      }
    }
    return this.effortState.currentEffort() ?? '';
  });

  readonly selectedOption = computed(() => {
    const value = this.effectiveEffort();
    return EFFORT_OPTIONS.find((o) => o.value === value) ?? EFFORT_OPTIONS[0];
  });

  readonly selectedLabel = computed(() => {
    return this.selectedOption().label;
  });

  readonly effortChanged = output<EffortLevel | undefined>();

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  readonly activeIndex = this.keyboardNav.activeIndex;

  toggleDropdown(): void {
    this._isOpen.set(!this._isOpen());
  }

  closeDropdown(): void {
    this._isOpen.set(false);
  }

  /**
   * Select effort level. When in canvas tile context, stores override per-tab.
   * Otherwise updates the global EffortStateService.
   */
  selectEffort(value: unknown): void {
    const option = value as EffortOption;
    this.closeDropdown();

    const effortValue = option.value === '' ? undefined : option.value;

    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (tabId) {
        this.tabManager.setOverrideEffort(tabId, effortValue ?? null);
        return;
      }
    }

    this.effortChanged.emit(effortValue);
    this.effortState.setEffort(effortValue);
  }

  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
