/**
 * KeyboardNavigationService - Native keyboard navigation for list-based components
 *
 * Replaces CDK's ActiveDescendantKeyManager with a signal-based implementation.
 * Uses Angular signals instead of RxJS BehaviorSubject for reactive state management.
 *
 * @example
 * ```typescript
 * @Component({
 *   providers: [KeyboardNavigationService],
 * })
 * export class MyListComponent {
 *   private readonly keyboardNav = inject(KeyboardNavigationService);
 *   readonly activeIndex = this.keyboardNav.activeIndex;
 *
 *   constructor() {
 *     effect(() => {
 *       const count = this.items().length;
 *       this.keyboardNav.configure({ itemCount: count, wrap: true });
 *     });
 *   }
 *
 *   onKeyDown(event: KeyboardEvent): void {
 *     this.keyboardNav.handleKeyDown(event);
 *   }
 * }
 * ```
 */
import { Injectable, signal } from '@angular/core';

/**
 * Configuration for keyboard navigation behavior.
 */
export interface KeyboardNavigationConfig {
  /**
   * Total number of items in the list.
   */
  itemCount: number;

  /**
   * Whether navigation should wrap from last to first and vice versa.
   * @default true
   */
  wrap?: boolean;

  /**
   * Whether to use horizontal navigation (ArrowLeft/ArrowRight).
   * If false, uses vertical navigation (ArrowUp/ArrowDown).
   * @default false
   */
  horizontal?: boolean;
}

/**
 * Service for managing keyboard navigation in list-based components.
 *
 * Provides signal-based active index tracking without CDK A11y dependency.
 * Supports vertical/horizontal navigation, wrap-around, and Home/End keys.
 *
 * Key differences from CDK ActiveDescendantKeyManager:
 * - Uses Angular signals (not BehaviorSubject)
 * - No Highlightable interface required
 * - Parent component controls active state via activeIndex signal
 */
@Injectable()
export class KeyboardNavigationService {
  /**
   * Internal writable signal for active index.
   * -1 indicates no active item.
   */
  private readonly _activeIndex = signal<number>(-1);

  /**
   * Readonly signal exposing the current active index.
   * Subscribe to this in templates via activeIndex().
   */
  readonly activeIndex = this._activeIndex.asReadonly();

  /**
   * Current navigation configuration.
   */
  private config: KeyboardNavigationConfig = { itemCount: 0 };

  /**
   * Configure the keyboard navigation.
   * Call this when the item count changes.
   *
   * @param config - Navigation configuration
   *
   * @example
   * ```typescript
   * effect(() => {
   *   this.keyboardNav.configure({
   *     itemCount: this.suggestions().length,
   *     wrap: true,
   *   });
   * });
   * ```
   */
  configure(config: KeyboardNavigationConfig): void {
    this.config = config;

    // Initialize to first item if we have items and no active selection
    if (config.itemCount > 0 && this._activeIndex() === -1) {
      this._activeIndex.set(0);
    }

    // Reset to valid index if current is out of bounds
    if (config.itemCount > 0 && this._activeIndex() >= config.itemCount) {
      this._activeIndex.set(config.itemCount - 1);
    }

    // Reset if no items
    if (config.itemCount === 0) {
      this._activeIndex.set(-1);
    }
  }

  /**
   * Handle keyboard event for navigation.
   * Returns true if the event was handled (caller should preventDefault).
   *
   * Supported keys:
   * - ArrowDown/ArrowRight: Next item
   * - ArrowUp/ArrowLeft: Previous item
   * - Home: First item
   * - End: Last item
   *
   * @param event - Keyboard event from the input/container
   * @returns True if the event was handled
   *
   * @example
   * ```typescript
   * onKeyDown(event: KeyboardEvent): void {
   *   if (this.keyboardNav.handleKeyDown(event)) {
   *     event.preventDefault();
   *   }
   * }
   * ```
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    const { itemCount, wrap = true, horizontal = false } = this.config;

    if (itemCount === 0) {
      return false;
    }

    const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';
    const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp';

    switch (event.key) {
      case nextKey:
        this.setNext(wrap);
        return true;

      case prevKey:
        this.setPrevious(wrap);
        return true;

      case 'Home':
        this._activeIndex.set(0);
        return true;

      case 'End':
        this._activeIndex.set(itemCount - 1);
        return true;

      default:
        return false;
    }
  }

  /**
   * Move to the next item in the list.
   *
   * @param wrap - Whether to wrap to first item when at end
   */
  setNext(wrap = true): void {
    const current = this._activeIndex();
    const max = this.config.itemCount - 1;

    if (current < max) {
      this._activeIndex.set(current + 1);
    } else if (wrap) {
      this._activeIndex.set(0);
    }
  }

  /**
   * Move to the previous item in the list.
   *
   * @param wrap - Whether to wrap to last item when at start
   */
  setPrevious(wrap = true): void {
    const current = this._activeIndex();
    const max = this.config.itemCount - 1;

    if (current > 0) {
      this._activeIndex.set(current - 1);
    } else if (wrap) {
      this._activeIndex.set(max);
    }
  }

  /**
   * Set the active index to a specific value.
   * Used for mouse hover interactions.
   *
   * @param index - The index to set as active
   *
   * @example
   * ```typescript
   * onHover(index: number): void {
   *   this.keyboardNav.setActiveIndex(index);
   * }
   * ```
   */
  setActiveIndex(index: number): void {
    if (index >= 0 && index < this.config.itemCount) {
      this._activeIndex.set(index);
    }
  }

  /**
   * Reset the active index to the first item (or -1 if no items).
   */
  reset(): void {
    if (this.config.itemCount > 0) {
      this._activeIndex.set(0);
    } else {
      this._activeIndex.set(-1);
    }
  }

  /**
   * Set active index to first item.
   */
  setFirstItemActive(): void {
    if (this.config.itemCount > 0) {
      this._activeIndex.set(0);
    }
  }

  /**
   * Set active index to last item.
   */
  setLastItemActive(): void {
    if (this.config.itemCount > 0) {
      this._activeIndex.set(this.config.itemCount - 1);
    }
  }
}
