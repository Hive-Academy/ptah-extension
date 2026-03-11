import {
  Component,
  input,
  output,
  ElementRef,
  inject,
  effect,
} from '@angular/core';
import { Highlightable } from '@angular/cdk/a11y';

/**
 * OptionComponent - Generic Option for Dropdowns/Autocomplete
 *
 * Implements Highlightable interface for ActiveDescendantKeyManager.
 * Content projection allows custom option layouts.
 *
 * @deprecated Use NativeOptionComponent from '@ptah-extension/ui' instead.
 * This component uses CDK A11y (Highlightable interface) which has conflicts with VS Code webview sandboxing.
 * Migration: Replace <ptah-option> with <ptah-native-option> and pass [isActive] input instead of relying on setActiveStyles().
 *
 * @example
 * <ptah-option
 *   [optionId]="'option-' + index"
 *   [value]="item"
 *   (selected)="onSelect($event)">
 *   <div class="flex items-center gap-2">
 *     <span>{{ item.icon }}</span>
 *     <span>{{ item.name }}</span>
 *   </div>
 * </ptah-option>
 */
@Component({
  selector: 'ptah-option',
  standalone: true,
  host: {
    '[id]': 'optionId()',
    class: 'block px-3 py-2 rounded-md cursor-pointer transition-colors',
    '[class.bg-primary]': 'isActive',
    '[class.text-primary-content]': 'isActive',
    '[class.hover:bg-base-300]': '!isActive',
    '(click)': 'handleClick()',
    '(mouseenter)': 'hovered.emit()',
    role: 'option',
    '[attr.aria-selected]': 'isActive',
    tabindex: '-1',
  },
  template: `
    <!-- ActiveDescendantKeyManager pattern: focus managed by parent, not option -->
    <ng-content />
  `,
})
export class OptionComponent<T = unknown> implements Highlightable {
  private readonly elementRef = inject(ElementRef);

  // Inputs
  readonly optionId = input.required<string>();
  readonly value = input.required<T>();

  // Outputs
  readonly selected = output<T>();
  readonly hovered = output<void>();

  // Highlightable interface state
  isActive = false;

  constructor() {
    // Validate optionId is non-empty
    effect(() => {
      const id = this.optionId();
      if (!id || id.trim().length === 0) {
        throw new Error(
          '[OptionComponent] optionId must be a non-empty string. Empty optionId breaks ARIA aria-activedescendant pattern.'
        );
      }
    });
  }

  /**
   * Highlightable interface - called by ActiveDescendantKeyManager
   * Sets visual active state without moving focus
   */
  setActiveStyles(): void {
    this.isActive = true;
    // Scroll into view when activated via keyboard
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  /**
   * Highlightable interface - called by ActiveDescendantKeyManager
   * Removes visual active state
   */
  setInactiveStyles(): void {
    this.isActive = false;
  }

  /**
   * Returns the host element for ActiveDescendantKeyManager.
   * Optional method but recommended for proper keyboard navigation.
   */
  getHostElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }

  /**
   * Handles click events on the option.
   * Emits selected output with the current value.
   */
  handleClick(): void {
    this.selected.emit(this.value());
  }
}
