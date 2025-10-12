import {
  Component,
  forwardRef,
  ChangeDetectionStrategy,
  viewChild,
  ElementRef,
  inject,
  DestroyRef,
  HostListener,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';

// Child Components
import { DropdownTriggerComponent } from '../dropdown-trigger/dropdown-trigger.component';
import { DropdownSearchComponent } from '../dropdown-search/dropdown-search.component';
import { DropdownOptionsListComponent } from '../dropdown-options-list/dropdown-options-list.component';
import { DropdownOption } from '@ptah-extension/shared';

/**
 * Dropdown Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), output(), viewChild(), signal(), computed())
 * - OnPush change detection
 * - Modern control flow (@if)
 * - Smart container with state management
 * - Form integration with ControlValueAccessor
 */
@Component({
  selector: 'ptah-dropdown',
  standalone: true,
  imports: [
    CommonModule,
    DropdownTriggerComponent,
    DropdownSearchComponent,
    DropdownOptionsListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vscode-dropdown-container" [class.vscode-dropdown-disabled]="disabled()">
      <!-- Trigger Component -->
      <ptah-dropdown-trigger
        [selectedOption]="selectedOption()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        [isOpen]="isOpen()"
        [showDescription]="showDescription()"
        [ariaLabel]="ariaLabel()"
        [ariaDescribedBy]="getAriaDescribedBy()"
        [triggerId]="triggerId"
        (triggerClick)="toggle()"
        (keyDown)="onTriggerKeyDown($event)"
      ></ptah-dropdown-trigger>

      <!-- Dropdown Menu -->
      @if (isOpen()) {
        <div class="vscode-dropdown-menu" [style.min-width.px]="minWidth()">
          <!-- Search Component -->
          @if (searchable()) {
            <ptah-dropdown-search
              [searchTerm]="searchTerm()"
              (searchChange)="onSearchChange($event)"
              (keyDown)="onSearchKeyDown($event)"
            ></ptah-dropdown-search>
          }

          <!-- Options List Component -->
          <ptah-dropdown-options-list
            [options]="filteredOptions()"
            [selectedValue]="value()"
            [focusedIndex]="focusedIndex()"
            [hasSearchTerm]="!!searchTerm()"
            [listboxId]="listboxId"
            (optionClick)="selectOption($event)"
            (optionHover)="setFocusedIndex($event)"
          ></ptah-dropdown-options-list>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .vscode-dropdown-container {
        position: relative;
        width: 100%;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
      }

      .vscode-dropdown-container.vscode-dropdown-disabled {
        pointer-events: none;
      }

      .vscode-dropdown-menu {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        z-index: 1000;
        background-color: var(--vscode-dropdown-listBackground);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 2px;
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
        margin-bottom: 2px;
        max-height: 200px;
        overflow: hidden;
        animation: vscode-dropdown-fadeUp 0.15s ease-out;
      }

      @keyframes vscode-dropdown-fadeUp {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* High Contrast Mode Support */
      @media (prefers-contrast: high) {
        .vscode-dropdown-menu {
          border-width: 2px;
        }
      }

      /* Reduced Motion Support */
      @media (prefers-reduced-motion: reduce) {
        .vscode-dropdown-menu {
          animation: none;
        }
      }
    `,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DropdownComponent),
      multi: true,
    },
  ],
})
export class DropdownComponent implements ControlValueAccessor {
  // Signal-based ViewChild (Angular 20+)
  searchComponent = viewChild(DropdownSearchComponent);

  private destroyRef = inject(DestroyRef);
  private elementRef = inject(ElementRef);

  // Unique IDs for accessibility
  readonly triggerId = `vscode-dropdown-${Math.random().toString(36).substr(2, 9)}`;
  readonly listboxId = `${this.triggerId}-listbox`;

  // Signal-based inputs (Angular 20+)
  options = input<DropdownOption[]>([]);
  placeholder = input<string>('Select an option');
  disabled = input<boolean>(false);
  searchable = input<boolean>(false);
  showDescription = input<boolean>(true);
  minWidth = input<number>(230);
  ariaLabel = input<string>('');

  // Signal-based outputs (Angular 20+)
  selectionChange = output<DropdownOption | null>();
  opened = output<void>();
  closed = output<void>();

  // Component state as signals
  value = signal<string>('');
  isOpen = signal<boolean>(false);
  searchTerm = signal<string>('');
  focusedIndex = signal<number>(-1);

  // Computed values (Angular 20+)
  selectedOption = computed(() => {
    return this.options().find((option) => option.value === this.value()) || null;
  });

  filteredOptions = computed(() => {
    const term = this.searchTerm();
    if (!term) return this.options();

    const termLower = term.toLowerCase();
    return this.options().filter(
      (option) =>
        option.label.toLowerCase().includes(termLower) ||
        option.description?.toLowerCase().includes(termLower) ||
        option.value.toLowerCase().includes(termLower),
    );
  });

  // Form integration
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private onChange = (_value: string) => {
    // Implemented by Angular Forms - registered via registerOnChange()
  };
  private onTouched = () => {
    // Implemented by Angular Forms - registered via registerOnTouched()
  };

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isOpen()) {
      this.close();
    }
  }

  // ControlValueAccessor implementation
  writeValue(value: string): void {
    this.value.set(value || '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setDisabledState(_isDisabled: boolean): void {
    // disabled is now an input signal, handled by parent
  }

  toggle(): void {
    if (this.disabled()) return;

    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (this.disabled() || this.isOpen()) return;

    this.isOpen.set(true);
    this.searchTerm.set('');
    const currentIndex = this.filteredOptions().findIndex((opt) => opt.value === this.value());
    this.focusedIndex.set(currentIndex);
    this.opened.emit();

    // Focus search input if searchable
    const searchComp = this.searchComponent();
    if (this.searchable() && searchComp) {
      setTimeout(() => searchComp.focus(), 0);
    }
  }

  close(): void {
    if (!this.isOpen()) return;

    this.isOpen.set(false);
    this.searchTerm.set('');
    this.focusedIndex.set(-1);
    this.onTouched();
    this.closed.emit();
  }

  selectOption(option: DropdownOption): void {
    if (option.disabled) return;

    const previousValue = this.value();
    this.value.set(option.value);
    this.onChange(this.value());

    if (previousValue !== this.value()) {
      this.selectionChange.emit(option);
    }

    this.close();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm.set(searchTerm);
    this.focusedIndex.set(0);
  }

  onTriggerKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!this.isOpen()) {
          this.open();
        } else {
          this.navigateOptions(event.key === 'ArrowDown' ? 1 : -1);
        }
        break;

      case 'Enter':
      case ' ': {
        event.preventDefault();
        const currentFocusedIndex = this.focusedIndex();
        if (this.isOpen() && currentFocusedIndex >= 0) {
          this.selectOption(this.filteredOptions()[currentFocusedIndex]);
        } else {
          this.toggle();
        }
        break;
      }

      case 'Escape':
        if (this.isOpen()) {
          event.preventDefault();
          this.close();
        }
        break;
    }
  }

  onSearchKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        this.navigateOptions(event.key === 'ArrowDown' ? 1 : -1);
        break;

      case 'Enter': {
        event.preventDefault();
        const currentFocusedIndex = this.focusedIndex();
        if (currentFocusedIndex >= 0) {
          this.selectOption(this.filteredOptions()[currentFocusedIndex]);
        }
        break;
      }
    }
  }

  setFocusedIndex(index: number): void {
    this.focusedIndex.set(index);
  }

  getAriaDescribedBy(): string {
    // Add any helper text or error message IDs here
    return '';
  }

  private navigateOptions(direction: number): void {
    const options = this.filteredOptions();
    if (options.length === 0) return;

    let newIndex = this.focusedIndex() + direction;

    // Wrap around
    if (newIndex >= options.length) {
      newIndex = 0;
    } else if (newIndex < 0) {
      newIndex = options.length - 1;
    }

    // Skip disabled options
    let attempts = 0;
    while (options[newIndex]?.disabled && attempts < options.length) {
      newIndex += direction;
      if (newIndex >= options.length) newIndex = 0;
      if (newIndex < 0) newIndex = options.length - 1;
      attempts++;
    }

    this.focusedIndex.set(newIndex);
  }
}
