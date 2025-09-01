import {
  Component,
  Input,
  Output,
  EventEmitter,
  forwardRef,
  ChangeDetectionStrategy,
  ViewChild,
  ElementRef,
  inject,
  DestroyRef,
  HostListener,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Child Components
import { VSCodeDropdownTriggerComponent } from '../../dumb-components/dropdowns/dropdown-trigger.component';
import { VSCodeDropdownSearchComponent } from '../../dumb-components/dropdowns/dropdown-search.component';
import { VSCodeDropdownOptionsListComponent } from '../../dumb-components/dropdowns/dropdown-options-list.component';
import { DropdownOption } from '../../dumb-components/dropdowns/dropdown-option.interface';

/**
 * VS Code Dropdown - Smart Container Component
 * - Orchestrates child components
 * - Manages state and business logic
 * - Form integration with ControlValueAccessor
 * - Accessibility and keyboard navigation
 */
@Component({
  selector: 'vscode-dropdown',
  standalone: true,
  imports: [
    CommonModule,
    VSCodeDropdownTriggerComponent,
    VSCodeDropdownSearchComponent,
    VSCodeDropdownOptionsListComponent,
  ],
  template: `
    <div class="vscode-dropdown-container" [class.vscode-dropdown-disabled]="disabled">
      <!-- Trigger Component -->
      <vscode-dropdown-trigger
        [selectedOption]="selectedOption"
        [placeholder]="placeholder"
        [disabled]="disabled"
        [isOpen]="isOpen"
        [showDescription]="showDescription"
        [ariaLabel]="ariaLabel"
        [ariaDescribedBy]="getAriaDescribedBy()"
        [triggerId]="triggerId"
        (triggerClick)="toggle()"
        (keyDown)="onTriggerKeyDown($event)"
      ></vscode-dropdown-trigger>

      <!-- Dropdown Menu -->
      @if (isOpen) {
        <div class="vscode-dropdown-menu" [style.min-width.px]="minWidth">
          <!-- Search Component -->
          @if (searchable) {
            <vscode-dropdown-search
              [searchTerm]="searchTerm"
              (searchChange)="onSearchChange($event)"
              (keyDown)="onSearchKeyDown($event)"
            ></vscode-dropdown-search>
          }

          <!-- Options List Component -->
          <vscode-dropdown-options-list
            [options]="filteredOptions"
            [selectedValue]="value"
            [focusedIndex]="focusedIndex"
            [hasSearchTerm]="!!searchTerm"
            [listboxId]="listboxId"
            (optionClick)="selectOption($event)"
            (optionHover)="setFocusedIndex($event)"
          ></vscode-dropdown-options-list>
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
      useExisting: forwardRef(() => VSCodeDropdownComponent),
      multi: true,
    },
  ],
})
export class VSCodeDropdownComponent implements ControlValueAccessor {
  @ViewChild(VSCodeDropdownSearchComponent) searchComponent?: VSCodeDropdownSearchComponent;

  private destroyRef = inject(DestroyRef);

  // Unique IDs for accessibility
  readonly triggerId = `vscode-dropdown-${Math.random().toString(36).substr(2, 9)}`;
  readonly listboxId = `${this.triggerId}-listbox`;

  @Input() options: DropdownOption[] = [];
  @Input() placeholder = 'Select an option';
  @Input() disabled = false;
  @Input() searchable = false;
  @Input() showDescription = true;
  @Input() minWidth = 230;
  @Input() ariaLabel = '';

  @Output() selectionChange = new EventEmitter<DropdownOption | null>();
  @Output() opened = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  // Component state
  value = '';
  isOpen = false;
  searchTerm = '';
  focusedIndex = -1;

  // Form integration
  private onChange = (value: string) => {};
  private onTouched = () => {};

  constructor(private elementRef: ElementRef) {}

  get selectedOption(): DropdownOption | null {
    return this.options.find((option) => option.value === this.value) || null;
  }

  get filteredOptions(): DropdownOption[] {
    if (!this.searchTerm) return this.options;

    const term = this.searchTerm.toLowerCase();
    return this.options.filter(
      (option) =>
        option.label.toLowerCase().includes(term) ||
        option.description?.toLowerCase().includes(term) ||
        option.value.toLowerCase().includes(term),
    );
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isOpen) {
      this.close();
    }
  }

  // ControlValueAccessor implementation
  writeValue(value: string): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  toggle(): void {
    if (this.disabled) return;

    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (this.disabled || this.isOpen) return;

    this.isOpen = true;
    this.searchTerm = '';
    this.focusedIndex = this.filteredOptions.findIndex((opt) => opt.value === this.value);
    this.opened.emit();

    // Focus search input if searchable
    if (this.searchable && this.searchComponent) {
      setTimeout(() => this.searchComponent!.focus(), 0);
    }
  }

  close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.searchTerm = '';
    this.focusedIndex = -1;
    this.onTouched();
    this.closed.emit();
  }

  selectOption(option: DropdownOption): void {
    if (option.disabled) return;

    const previousValue = this.value;
    this.value = option.value;
    this.onChange(this.value);

    if (previousValue !== this.value) {
      this.selectionChange.emit(option);
    }

    this.close();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.focusedIndex = 0;
  }

  onTriggerKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          this.navigateOptions(event.key === 'ArrowDown' ? 1 : -1);
        }
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        if (this.isOpen && this.focusedIndex >= 0) {
          this.selectOption(this.filteredOptions[this.focusedIndex]);
        } else {
          this.toggle();
        }
        break;

      case 'Escape':
        if (this.isOpen) {
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

      case 'Enter':
        event.preventDefault();
        if (this.focusedIndex >= 0) {
          this.selectOption(this.filteredOptions[this.focusedIndex]);
        }
        break;
    }
  }

  setFocusedIndex(index: number): void {
    this.focusedIndex = index;
  }

  getAriaDescribedBy(): string {
    // Add any helper text or error message IDs here
    return '';
  }

  private navigateOptions(direction: number): void {
    const options = this.filteredOptions;
    if (options.length === 0) return;

    let newIndex = this.focusedIndex + direction;

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

    this.focusedIndex = newIndex;
  }
}
