/**
 * EffortSelectorComponent - Reasoning Effort Level Dropdown
 * TASK_2025_184: Reasoning Effort Configuration
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
  output,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ChevronDown, Check, Brain } from 'lucide-angular';
import { type EffortLevel } from '@ptah-extension/shared';
import {
  NativeDropdownComponent,
  NativeOptionComponent,
  KeyboardNavigationService,
} from '@ptah-extension/ui';

interface EffortOption {
  value: EffortLevel | '';
  label: string;
  description: string;
}

const EFFORT_OPTIONS: readonly EffortOption[] = [
  { value: '', label: 'Default', description: 'SDK default reasoning effort' },
  {
    value: 'low',
    label: 'Low',
    description: 'Faster responses, less reasoning',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balanced speed and reasoning',
  },
  { value: 'high', label: 'High', description: 'More thorough reasoning' },
  { value: 'max', label: 'Max', description: 'Maximum reasoning depth' },
] as const;

@Component({
  selector: 'ptah-effort-selector',
  standalone: true,
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
        <lucide-angular [img]="BrainIcon" class="w-3 h-3" />
        <span class="text-[10px] font-mono">{{ selectedLabel() }}</span>
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
            <div class="flex items-start gap-3 py-0.5">
              <!-- Checkmark for selected -->
              <div class="w-4 h-4 mt-0.5 flex-shrink-0">
                @if (option.value === selectedEffort()) {
                <lucide-angular [img]="CheckIcon" class="w-4 h-4" />
                }
              </div>

              <!-- Option Info -->
              <div class="flex flex-col items-start flex-1 min-w-0">
                <span class="font-medium text-xs">{{ option.label }}</span>
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

  // Lucide icons
  readonly BrainIcon = Brain;
  readonly ChevronDownIcon = ChevronDown;
  readonly CheckIcon = Check;

  // Options data
  readonly effortOptions = EFFORT_OPTIONS;

  /** Current selected effort level. Empty string means SDK default. */
  readonly selectedEffort = signal<EffortLevel | ''>('');

  /** Display label for the trigger button */
  readonly selectedLabel = () => {
    const value = this.selectedEffort();
    const option = EFFORT_OPTIONS.find((o) => o.value === value);
    return option?.label ?? 'Default';
  };

  /** Emits when user changes effort level. undefined means use SDK default. */
  readonly effortChanged = output<EffortLevel | undefined>();

  // Local state for dropdown visibility
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  // Keyboard navigation - expose activeIndex for template
  readonly activeIndex = this.keyboardNav.activeIndex;

  toggleDropdown(): void {
    this._isOpen.set(!this._isOpen());
  }

  closeDropdown(): void {
    this._isOpen.set(false);
  }

  selectEffort(value: unknown): void {
    const option = value as EffortOption;
    this.closeDropdown();

    if (option.value === '') {
      this.selectedEffort.set('');
      this.effortChanged.emit(undefined);
    } else {
      this.selectedEffort.set(option.value);
      this.effortChanged.emit(option.value);
    }
  }

  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
