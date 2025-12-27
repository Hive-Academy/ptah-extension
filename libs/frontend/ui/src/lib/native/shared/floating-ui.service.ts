/**
 * FloatingUIService - Lightweight positioning service using @floating-ui/dom
 *
 * Replaces CDK Overlay positioning which has conflicts with VS Code webview sandboxing.
 * Uses Floating UI for viewport-aware positioning with flip/shift middleware.
 *
 * @example
 * ```typescript
 * @Component({
 *   providers: [FloatingUIService],
 * })
 * export class MyDropdownComponent {
 *   private readonly floatingUI = inject(FloatingUIService);
 *
 *   async position(): Promise<void> {
 *     await this.floatingUI.position(triggerEl, floatingEl, {
 *       placement: 'bottom-start',
 *       offset: 8,
 *     });
 *   }
 *
 *   close(): void {
 *     this.floatingUI.cleanup();
 *   }
 * }
 * ```
 */
import { Injectable, inject, DestroyRef } from '@angular/core';
import {
  computePosition,
  flip,
  shift,
  offset,
  autoUpdate,
  Placement,
} from '@floating-ui/dom';

/**
 * Configuration options for positioning floating elements.
 */
export interface FloatingUIOptions {
  /**
   * Placement of the floating element relative to reference.
   * @default 'bottom-start'
   */
  placement?: Placement;

  /**
   * Offset distance from the reference element in pixels.
   * @default 8
   */
  offset?: number;

  /**
   * Whether to flip placement when there's not enough space.
   * @default true
   */
  flip?: boolean;

  /**
   * Whether to shift along the axis to stay in view.
   * @default true
   */
  shift?: boolean;

  /**
   * Padding for shift middleware to maintain distance from viewport edges.
   * @default 8
   */
  shiftPadding?: number;
}

/**
 * Service for positioning floating elements using Floating UI.
 *
 * Provides lightweight positioning without CDK Overlay portal rendering,
 * avoiding VS Code webview sandboxing conflicts.
 *
 * Key features:
 * - Viewport-aware positioning with flip/shift
 * - Auto-updates on scroll/resize
 * - Automatic cleanup on DestroyRef
 */
@Injectable()
export class FloatingUIService {
  private readonly destroyRef = inject(DestroyRef);
  private cleanupFn: (() => void) | null = null;

  /**
   * Flag to track if the service has been destroyed.
   * Used to prevent position updates after component destruction.
   */
  private isDestroyed = false;

  constructor() {
    // Ensure cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      this.isDestroyed = true;
      this.cleanup();
    });
  }

  /**
   * Position a floating element relative to a reference element.
   * Automatically updates position on scroll/resize.
   *
   * @param referenceEl - The trigger/anchor element
   * @param floatingEl - The floating element to position
   * @param options - Positioning configuration
   *
   * @example
   * ```typescript
   * await this.floatingUI.position(buttonEl, dropdownEl, {
   *   placement: 'bottom-start',
   *   offset: 4,
   * });
   * ```
   */
  async position(
    referenceEl: HTMLElement,
    floatingEl: HTMLElement,
    options: FloatingUIOptions = {}
  ): Promise<void> {
    // Cleanup any existing auto-update listener
    this.cleanup();

    const {
      placement = 'bottom-start',
      offset: offsetValue = 8,
      flip: enableFlip = true,
      shift: enableShift = true,
      shiftPadding = 8,
    } = options;

    // Build middleware array based on options
    const middleware = [
      offset(offsetValue),
      ...(enableFlip ? [flip()] : []),
      ...(enableShift ? [shift({ padding: shiftPadding })] : []),
    ];

    // Compute initial position
    const { x, y } = await computePosition(referenceEl, floatingEl, {
      placement,
      middleware,
    });

    // Don't apply if destroyed during async computation
    if (this.isDestroyed) return;

    // Apply position styles
    this.applyPosition(floatingEl, x, y);

    // Set up auto-update for scroll/resize
    this.cleanupFn = autoUpdate(referenceEl, floatingEl, async () => {
      const result = await computePosition(referenceEl, floatingEl, {
        placement,
        middleware,
      });
      // Don't apply if destroyed during async computation
      if (this.isDestroyed) return;
      this.applyPosition(floatingEl, result.x, result.y);
    });
  }

  /**
   * Apply position styles to the floating element.
   * Uses CSS positioning for better performance.
   */
  private applyPosition(floatingEl: HTMLElement, x: number, y: number): void {
    Object.assign(floatingEl.style, {
      position: 'absolute',
      left: `${x}px`,
      top: `${y}px`,
      // Ensure visibility after positioning to prevent flash at 0,0
      visibility: 'visible',
    });
  }

  /**
   * Cleanup auto-update listeners.
   * Call this when closing the floating element.
   *
   * Note: Also called automatically on component destroy via DestroyRef.
   */
  cleanup(): void {
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
  }
}
