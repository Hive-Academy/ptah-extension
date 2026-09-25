import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  Check,
  ChevronDown,
  LucideAngularModule,
  type LucideIconData,
} from 'lucide-angular';
import {
  KeyboardNavigationService,
  NativeDropdownComponent,
  NativeOptionComponent,
} from '@ptah-extension/ui';

/** One choice of a filter select. `value: null` is "any". */
export interface FilterSelectOption {
  readonly value: string | null;
  readonly label: string;
  readonly count: number | null;
  readonly icon: LucideIconData | null;
}

/** Per-instance suffix for listbox and option ids. */
let nextFilterSelectId = 0;

/**
 * A filter dropdown: a button that opens a listbox in `ptah-native-dropdown`
 * (the positioning and backdrop contract of
 * `native-dropdown.component.ts:118-174`), with `ptah-native-option` choices.
 *
 * Keyboard follows the ui selectors (`effort-selector.component.ts`,
 * `model-selector.component.ts`): a component-scoped
 * `KeyboardNavigationService` owns the active option (ArrowUp/ArrowDown,
 * wrapping, and Home/End). This component adds only what the service does
 * not cover: an arrow key on a closed list opens it, Enter/Space choose,
 * Escape and Tab close.
 *
 * Focus stays on the button, and `aria-activedescendant` names the active
 * option. The chosen option has a check icon and a hidden "(selected)". An
 * open list consumes Escape so the page's own Escape handling (closing its
 * inspector) does not also run.
 *
 * The trigger is disabled when `disabled` is set or there is nothing to
 * choose.
 *
 * @example
 * ```html
 * <ptah-provider-filter-select
 *   label="Target"
 *   [options]="targetChoices()"
 *   [value]="filter().target ?? null"
 *   (valueChange)="setTarget($event)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-provider-filter-select',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativeDropdownComponent,
    NativeOptionComponent,
  ],
  providers: [KeyboardNavigationService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <ptah-native-dropdown
      [isOpen]="isOpen()"
      placement="bottom-start"
      [panelRole]="null"
      (closed)="close()"
    >
      <button
        trigger
        type="button"
        class="btn btn-sm btn-ghost gap-1 border border-base-300 font-normal"
        [class.border-primary]="value() !== null"
        aria-haspopup="listbox"
        [disabled]="inactive()"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-controls]="isOpen() ? listboxId : null"
        [attr.aria-activedescendant]="isOpen() ? activeOptionId() : null"
        [attr.data-testid]="testId()"
        (click)="toggle()"
        (keydown)="onKeydown($event)"
      >
        <span class="text-base-content-muted">{{ label() }}:</span>
        <span class="max-w-32 truncate text-base-content">{{
          selectedLabel()
        }}</span>
        <lucide-angular
          [img]="ChevronIcon"
          class="h-3.5 w-3.5 opacity-60"
          aria-hidden="true"
        />
      </button>
      <div
        content
        role="listbox"
        class="max-h-72 w-60 overflow-y-auto p-1"
        [id]="listboxId"
        [attr.aria-label]="label()"
        [attr.data-testid]="testId() + '-listbox'"
      >
        @for (option of options(); track option.value; let i = $index) {
          <ptah-native-option
            [optionId]="optionId(i)"
            [value]="option"
            [isActive]="i === activeIndex()"
            (selected)="choose(option)"
            (hovered)="keyboardNav.setActiveIndex(i)"
          >
            <span class="flex items-center gap-2 text-xs">
              <span class="flex h-3.5 w-3.5 shrink-0 items-center">
                @if (option.value === value()) {
                  <lucide-angular
                    [img]="CheckIcon"
                    class="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  <span class="sr-only">(selected)</span>
                }
              </span>
              @if (option.icon) {
                <lucide-angular
                  [img]="option.icon"
                  class="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
              }
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              @if (option.count !== null) {
                <span class="tabular-nums opacity-70">{{ option.count }}</span>
              }
            </span>
          </ptah-native-option>
        }
      </div>
    </ptah-native-dropdown>
  `,
})
export class ProviderFilterSelectComponent {
  protected readonly keyboardNav = inject(KeyboardNavigationService);

  /** Visible name of the filter ("Target"). */
  public readonly label = input.required<string>();

  /** The choices, "any" first. */
  public readonly options = input.required<readonly FilterSelectOption[]>();

  /** The chosen value, `null` for "any". */
  public readonly value = input<string | null>(null);

  /** Disable the trigger. @default false */
  public readonly disabled = input<boolean>(false);

  /** `data-testid` of the trigger; the listbox gets `<testId>-listbox`. */
  public readonly testId = input<string>('provider-filter-select');

  /** The user chose a value. */
  public readonly valueChange = output<string | null>();

  protected readonly ChevronIcon = ChevronDown;
  protected readonly CheckIcon = Check;

  protected readonly listboxId = `ptah-filter-select-${nextFilterSelectId++}`;
  protected readonly isOpen = signal(false);
  protected readonly activeIndex = this.keyboardNav.activeIndex;

  /** Disabled, or nothing to choose: the list cannot open. */
  protected readonly inactive = computed(
    () => this.disabled() || this.options().length === 0,
  );

  private readonly selectedIndex = computed(() =>
    Math.max(
      0,
      this.options().findIndex((option) => option.value === this.value()),
    ),
  );

  protected readonly selectedLabel = computed(
    () => this.options()[this.selectedIndex()]?.label ?? '',
  );

  protected readonly activeOptionId = computed(() =>
    this.optionId(this.activeIndex()),
  );

  public constructor() {
    // Keep the service's item count in step with the options, and close a
    // list that can no longer be used. `configure` resets the active option,
    // so the current value is re-applied.
    effect(() => {
      const count = this.options().length;
      const inactive = this.inactive();
      untracked(() => {
        this.keyboardNav.configure({ itemCount: count, wrap: true });
        this.keyboardNav.setActiveIndex(this.selectedIndex());
        if (inactive) this.isOpen.set(false);
      });
    });
  }

  protected optionId(index: number): string {
    return `${this.listboxId}-option-${index}`;
  }

  protected toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected choose(option: FilterSelectOption): void {
    this.close();
    if (option.value !== this.value()) this.valueChange.emit(option.value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.isOpen()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.open();
      }
      return;
    }
    if (this.keyboardNav.handleKeyDown(event)) {
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const option = this.options()[this.activeIndex()];
        if (option !== undefined) this.choose(option);
        return;
      }
      case 'Escape':
        // The page owns Escape otherwise (closing its inspector); an open
        // list consumes it.
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      case 'Tab':
        this.close();
        return;
    }
  }

  /** Open on the current value. */
  private open(): void {
    if (this.inactive()) return;
    this.keyboardNav.setActiveIndex(this.selectedIndex());
    this.isOpen.set(true);
  }
}
