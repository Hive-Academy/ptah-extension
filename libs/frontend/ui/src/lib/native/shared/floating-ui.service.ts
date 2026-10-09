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
  platform,
  Placement,
  Platform,
} from '@floating-ui/dom';

/** floating-ui's DOM platform with the window as every offset parent, so it always returns viewport coordinates. */
const VIEWPORT_PLATFORM: Platform = {
  ...platform,
  getOffsetParent: () => window,
};

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
    options: FloatingUIOptions = {},
  ): Promise<void> {
    this.cleanup();

    const {
      placement = 'bottom-start',
      offset: offsetValue = 8,
      flip: enableFlip = true,
      shift: enableShift = true,
      shiftPadding = 8,
    } = options;
    const middleware = [
      offset(offsetValue),
      ...(enableFlip ? [flip()] : []),
      ...(enableShift ? [shift({ padding: shiftPadding })] : []),
    ];
    // `fixed` matches the `position: fixed` that applyPosition writes. The window as offset parent keeps `x`/`y`
    // in viewport coordinates even when floating-ui detects a containing-block ancestor: applyPosition measures
    // the frame the browser really uses, which can differ from the one floating-ui would assume.
    const config = {
      placement,
      middleware,
      strategy: 'fixed' as const,
      platform: VIEWPORT_PLATFORM,
    };
    const { x, y } = await computePosition(referenceEl, floatingEl, config);
    if (this.isDestroyed) return;
    this.applyPosition(floatingEl, x, y);
    this.cleanupFn = autoUpdate(referenceEl, floatingEl, async () => {
      const result = await computePosition(referenceEl, floatingEl, config);
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
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      visibility: 'visible',
    });
    // `x`/`y` are viewport coordinates, but a containing-block ancestor offsets a fixed element: the CLI matrix
    // host's `container-type` (floating-ui misses it) or a modal box's transform. Measure where the panel really
    // is and shift it by the difference.
    const rect = floatingEl.getBoundingClientRect();
    // No box (hidden, or no layout engine as in JSDOM): nothing to measure.
    if (rect.width === 0 && rect.height === 0) return;
    const dx = rect.left - x;
    const dy = rect.top - y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      floatingEl.style.left = `${x - dx}px`;
      floatingEl.style.top = `${y - dy}px`;
    }
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
