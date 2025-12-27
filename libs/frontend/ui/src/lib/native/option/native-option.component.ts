/**
 * NativeOptionComponent - Native Option for Dropdowns/Autocomplete
 *
 * Simple selectable option component that replaces CDK Highlightable-based OptionComponent.
 * Key difference: isActive is an INPUT signal controlled by parent, not self-managed state.
 * This avoids the signal dependency loop issue caused by CDK's setActiveStyles()/setInactiveStyles().
 *
 * Uses DaisyUI classes for VS Code theme-compatible styling.
 *
 * @example
 * ```typescript
 * <ptah-native-option
 *   [optionId]="'option-' + index"
 *   [value]="item"
 *   [isActive]="index === activeIndex()"
 *   (selected)="onSelect($event)"
 *   (hovered)="onHover(index)">
 *   <div class="flex items-center gap-2">
 *     <span>{{ item.icon }}</span>
 *     <span>{{ item.name }}</span>
 *   </div>
 * </ptah-native-option>
 * ```
 */
import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  ElementRef,
  inject,
  effect,
} from '@angular/core';

/**
 * Native option component for dropdown/autocomplete lists.
 *
 * Unlike the CDK-based OptionComponent which implements Highlightable interface
 * and manages its own active state via setActiveStyles()/setInactiveStyles(),
 * this component receives isActive as an input signal from the parent.
 *
 * This pattern:
 * - Eliminates signal dependency loops in effects
 * - Simplifies parent-child communication
 * - Enables proper reactive state flow
 */
@Component({
  selector: 'ptah-native-option',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[id]': 'optionId()',
    class: 'block px-3 py-2 rounded-md cursor-pointer transition-colors',
    '[class.bg-primary]': 'isActive()',
    '[class.text-primary-content]': 'isActive()',
    '[class.hover:bg-base-300]': '!isActive()',
    '(click)': 'handleClick()',
    '(mouseenter)': 'handleMouseEnter()',
    role: 'option',
    '[attr.aria-selected]': 'isActive()',
    tabindex: '-1',
  },
  template: `<ng-content />`,
})
export class NativeOptionComponent<T = unknown> {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  /**
   * Unique ID for the option element.
   * Required for ARIA aria-activedescendant pattern.
   */
  readonly optionId = input.required<string>();

  /**
   * The value this option represents.
   * Emitted when the option is selected.
   */
  readonly value = input.required<T>();

  /**
   * Whether this option is currently active/highlighted.
   * CONTROLLED BY PARENT - not self-managed like CDK Highlightable.
   * Parent passes this based on keyboard navigation state.
   */
  readonly isActive = input<boolean>(false);

  /**
   * Emitted when the option is clicked/selected.
   * Parent should handle selection logic.
   */
  readonly selected = output<T>();

  /**
   * Emitted when mouse enters the option.
   * Parent should update active index on hover.
   */
  readonly hovered = output<void>();

  constructor() {
    // Validate optionId is non-empty to prevent ARIA accessibility issues
    effect(() => {
      const id = this.optionId();
      if (!id || id.trim().length === 0) {
        throw new Error(
          '[NativeOptionComponent] optionId must be a non-empty string. ' +
            'Empty optionId breaks ARIA aria-activedescendant pattern.'
        );
      }
    });
  }

  /**
   * Handle click events on the option.
   * Emits selected output with the current value.
   */
  handleClick(): void {
    this.selected.emit(this.value());
  }

  /**
   * Handle mouse enter events.
   * Emits hovered output for parent to update active index.
   */
  handleMouseEnter(): void {
    this.hovered.emit();
  }

  /**
   * Scroll this option into view.
   * Called by parent when this becomes active via keyboard navigation.
   *
   * @example
   * ```typescript
   * effect(() => {
   *   const index = this.activeIndex();
   *   const options = this.optionComponents();
   *   if (index >= 0 && index < options.length) {
   *     options[index].scrollIntoView();
   *   }
   * });
   * ```
   */
  scrollIntoView(): void {
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  /**
   * Returns the host element.
   * Useful for parent components that need direct element access.
   */
  getHostElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }
}
