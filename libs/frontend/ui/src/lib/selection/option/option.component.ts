import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[id]': 'optionId()',
    class: 'block px-3 py-2 rounded-md cursor-pointer transition-colors',
    '[class.bg-primary]': 'isActive()',
    '[class.text-primary-content]': 'isActive()',
    '[class.hover:bg-base-300]': '!isActive()',
    '(click)': 'handleClick()',
    '(mouseenter)': 'hovered.emit()',
    role: 'option',
    '[attr.aria-selected]': 'isActive()',
    tabindex: '-1',
  },
  template: `
    <!-- ActiveDescendantKeyManager pattern: focus managed by parent, not option -->
    <ng-content />
  `,
})
export class OptionComponent<T = unknown> implements Highlightable {
  private readonly elementRef = inject(ElementRef);
  private readonly cdr = inject(ChangeDetectorRef);

  // Inputs
  readonly optionId = input.required<string>();
  readonly value = input.required<T>();

  // Outputs
  readonly selected = output<T>();
  readonly hovered = output<void>();

  /**
   * Highlightable interface state, exposed as a signal so host bindings
   * (`[class.bg-primary]`, `[attr.aria-selected]`, etc.) track it
   * reactively. `ActiveDescendantKeyManager.setFirstItemActive()` mutates
   * this synchronously during change detection, so using a plain field
   * triggers NG0100 (ExpressionChangedAfterItHasBeenCheckedError) when
   * the host bindings are re-checked. Signals defer the re-read to the
   * next scheduler tick, which avoids the false positive while still
   * rendering the correct state.
   */
  readonly isActive = signal(false);

  constructor() {
    // Validate optionId is non-empty
    effect(() => {
      const id = this.optionId();
      if (!id || id.trim().length === 0) {
        throw new Error(
          '[OptionComponent] optionId must be a non-empty string. Empty optionId breaks ARIA aria-activedescendant pattern.',
        );
      }
    });
  }

  /**
   * Highlightable interface - called by ActiveDescendantKeyManager.
   * Sets visual active state without moving focus.
   */
  setActiveStyles(): void {
    this.isActive.set(true);
    this.cdr.markForCheck();
    // Scroll into view when activated via keyboard
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  /**
   * Highlightable interface - called by ActiveDescendantKeyManager.
   * Removes visual active state.
   */
  setInactiveStyles(): void {
    this.isActive.set(false);
    this.cdr.markForCheck();
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
