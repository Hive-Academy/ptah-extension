import {
  Injectable,
  ElementRef,
  inject,
  DestroyRef,
  effect,
  Signal,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * Keyboard navigation configuration
 */
export interface KeyboardNavConfig {
  readonly onArrowDown?: () => void;
  readonly onArrowUp?: () => void;
  readonly onEnter?: () => void;
  readonly onEscape?: () => void;
  readonly onTab?: () => void;
}

/**
 * Configuration for auto-managed listeners
 */
export interface AutoManageConfig {
  readonly isOpenSignal: Signal<boolean>;
  readonly elementRef: ElementRef<HTMLElement>;
  readonly onClickOutside: () => void;
  readonly keyboardNav?: KeyboardNavConfig;
}

/**
 * DropdownInteractionService - Conditional Event Listener Management
 *
 * @deprecated Use @ptah-extension/ui components with CDK Overlay instead.
 * See libs/frontend/ui/CLAUDE.md for migration guide.
 *
 * This service was created in TASK_2025_046 as a temporary fix for dropdown
 * keyboard navigation. It is now superseded by CDK Overlay portal rendering
 * which solves the root cause (textarea event interception).
 *
 * Migration path:
 * - For dropdowns: Use DropdownComponent from @ptah-extension/ui/overlays
 * - For popovers: Use PopoverComponent from @ptah-extension/ui/overlays
 * - For autocomplete: Use AutocompleteComponent from @ptah-extension/ui/selection
 *
 * Root Cause Explanation:
 * DropdownInteractionService attempts to solve keyboard interception with capture-phase
 * document listeners. This is a band-aid approach. The real issue is STRUCTURAL:
 * dropdowns rendered inside component DOM tree (@if rendering) means keyboard events
 * flow through parent textarea BEFORE reaching dropdown handlers.
 *
 * CDK Overlay Solution:
 * Portal rendering at document body level means dropdown is OUTSIDE component hierarchy.
 * No parent textarea/input elements in event path = no interception. Zero document listeners
 * needed - CDK Overlay backdrop handles click-outside detection automatically.
 *
 * Event Flow Comparison:
 * BEFORE: document → ... → textarea (intercepts ArrowDown) → dropdown handler (too late!)
 * AFTER:  document → cdk-overlay-container (at body level) → dropdown handler ✅
 *
 * @example Old Pattern (Deprecated)
 * ```typescript
 * export class MyDropdownComponent {
 *   private readonly dropdownService = inject(DropdownInteractionService);
 *   private readonly elementRef = inject(ElementRef);
 *   private readonly injector = inject(Injector);
 *
 *   private readonly _isOpen = signal(false);
 *   readonly isOpen = this._isOpen.asReadonly();
 *
 *   constructor() {
 *     this.dropdownService.autoManageListeners(this.injector, {
 *       isOpenSignal: this.isOpen,
 *       elementRef: this.elementRef,
 *       onClickOutside: () => this._isOpen.set(false),
 *       keyboardNav: {
 *         onArrowDown: () => this.navigateDown(),
 *         onEnter: () => this.selectFocused(),
 *         onEscape: () => this._isOpen.set(false),
 *       },
 *     });
 *   }
 * }
 * ```
 *
 * @example New Pattern (Recommended)
 * ```typescript
 * import { DropdownComponent, OptionComponent } from '@ptah-extension/ui';
 *
 * export class MyDropdownComponent {
 *   // No DropdownInteractionService needed!
 *   // No manual keyboard navigation methods!
 *   // CDK Overlay handles everything automatically.
 *
 *   private readonly _isOpen = signal(false);
 *   readonly isOpen = this._isOpen.asReadonly();
 *
 *   toggleDropdown(): void {
 *     this._isOpen.set(!this._isOpen());
 *   }
 *
 *   selectItem(item: Item): void {
 *     // Handle selection
 *     this._isOpen.set(false);
 *   }
 * }
 *
 * // Template:
 * // <lib-dropdown [isOpen]="isOpen()" (closed)="toggleDropdown()">
 * //   <button trigger (click)="toggleDropdown()">Open Menu</button>
 * //   <div content>
 * //     @for (item of items(); track item.id; let i = $index) {
 * //       <lib-option [optionId]="'item-' + i" [value]="item" (selected)="selectItem($event)">
 * //         {{ item.name }}
 * //       </lib-option>
 * //     }
 * //   </div>
 * // </lib-dropdown>
 * ```
 */
@Injectable({ providedIn: 'root' })
export class DropdownInteractionService {
  /**
   * Attach click-outside listener conditionally
   *
   * @param destroyRef DestroyRef for automatic cleanup
   * @param elementRef Component's ElementRef to detect outside clicks
   * @param callback Function to call when clicked outside
   * @returns Subscription (caller can unsubscribe early if needed)
   */
  attachClickOutside(
    destroyRef: DestroyRef,
    elementRef: ElementRef<HTMLElement>,
    callback: () => void
  ): Subscription {
    return fromEvent<MouseEvent>(document, 'click')
      .pipe(
        filter((event) => {
          const target = event.target as HTMLElement;
          const hostElement = elementRef.nativeElement;
          // Check if click is OUTSIDE the component
          return !hostElement.contains(target);
        }),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(() => callback());
  }

  /**
   * Attach keyboard navigation listener conditionally
   *
   * IMPORTANT: Uses CAPTURE PHASE to intercept keyboard events BEFORE they reach
   * the textarea/input element. This is critical for dropdown navigation to work
   * when focus is on an input element.
   *
   * Event flow with capture: document (capture) → ... → textarea → ... → document (bubble)
   * By using capture phase, our handler runs FIRST, can preventDefault() and stopPropagation()
   * to prevent the textarea from receiving ArrowUp/ArrowDown/Enter/Escape keys.
   *
   * @param destroyRef DestroyRef for automatic cleanup
   * @param config Keyboard navigation callbacks
   * @returns Subscription (caller can unsubscribe early if needed)
   */
  attachKeyboardNav(
    destroyRef: DestroyRef,
    config: KeyboardNavConfig
  ): Subscription {
    // Use CAPTURE PHASE (third argument = true) to intercept events BEFORE textarea
    // fromEvent supports EventListenerOptions as third parameter
    return fromEvent<KeyboardEvent>(document, 'keydown', { capture: true })
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => {
        switch (event.key) {
          case 'ArrowDown':
            if (config.onArrowDown) {
              event.preventDefault();
              event.stopPropagation(); // Stop event from reaching textarea
              config.onArrowDown();
            }
            break;
          case 'ArrowUp':
            if (config.onArrowUp) {
              event.preventDefault();
              event.stopPropagation(); // Stop event from reaching textarea
              config.onArrowUp();
            }
            break;
          case 'Enter':
            if (config.onEnter) {
              event.preventDefault();
              event.stopPropagation(); // Stop event from reaching textarea
              config.onEnter();
            }
            break;
          case 'Escape':
            if (config.onEscape) {
              event.preventDefault();
              event.stopPropagation(); // Stop event from reaching textarea
              config.onEscape();
            }
            break;
          case 'Tab':
            if (config.onTab) {
              event.preventDefault();
              event.stopPropagation(); // Stop event from reaching textarea
              config.onTab();
            }
            break;
        }
      });
  }

  /**
   * Automatically manage listeners based on isOpen signal
   *
   * This is the RECOMMENDED approach for most dropdowns.
   * Listeners are attached when isOpen() becomes true, and detached when false.
   *
   * @param injector Component's Injector (required for effect() context)
   * @param config Configuration object with signals and callbacks
   */
  autoManageListeners(injector: Injector, config: AutoManageConfig): void {
    const destroyRef = injector.get(DestroyRef);
    let clickSubscription: Subscription | null = null;
    let keyboardSubscription: Subscription | null = null;

    // Use effect() to watch isOpen signal and attach/detach listeners
    runInInjectionContext(injector, () => {
      effect(() => {
        const isOpen = config.isOpenSignal();

        if (isOpen) {
          // Attach listeners when dropdown opens
          // Use a small delay to avoid catching the opening click
          setTimeout(() => {
            if (config.isOpenSignal()) {
              clickSubscription = this.attachClickOutside(
                destroyRef,
                config.elementRef,
                config.onClickOutside
              );
            }
          }, 0);

          if (config.keyboardNav) {
            keyboardSubscription = this.attachKeyboardNav(
              destroyRef,
              config.keyboardNav
            );
          }
        } else {
          // Detach listeners when dropdown closes
          clickSubscription?.unsubscribe();
          keyboardSubscription?.unsubscribe();
          clickSubscription = null;
          keyboardSubscription = null;
        }
      });
    });

    // Final cleanup on component destroy
    destroyRef.onDestroy(() => {
      clickSubscription?.unsubscribe();
      keyboardSubscription?.unsubscribe();
    });
  }
}
