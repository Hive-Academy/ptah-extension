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
  /** Element whose visible bounds constrain flip and shift. */
  boundary?: HTMLElement;
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
   * Identifies the live position() request. cleanup() bumps it, and every
   * position() starts with cleanup(), so a request whose token is no longer
   * current was cancelled by a close or superseded by a newer request.
   */
  private requestToken = 0;

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
    const request = this.requestToken;

    const {
      placement = 'bottom-start',
      offset: offsetValue = 8,
      flip: enableFlip = true,
      shift: enableShift = true,
      shiftPadding = 8,
      boundary,
    } = options;
    const middleware = [
      offset(offsetValue),
      ...(enableFlip ? [flip({ boundary })] : []),
      ...(enableShift ? [shift({ boundary, padding: shiftPadding })] : []),
    ];
    // `fixed` matches the `position: fixed` that applyPosition writes: with the default `absolute`, `x`/`y` carry
    // the page scroll, and a scrolled page put the CLI matrix Cursor panel hundreds of px off. Set it first:
    // floating-ui resolves a fixed element's offset parent from its containing block (a modal box's transform),
    // any other element's from its offsetParent.
    floatingEl.style.position = 'fixed';
    const config = { placement, middleware, strategy: 'fixed' as const };
    const { x, y } = await computePosition(referenceEl, floatingEl, config);
    // cleanup() ran or a newer position() started while this one computed: a
    // stale request writes nothing and installs no auto-update, so it can
    // neither leave an observer on a closed panel nor overwrite the live
    // request's cleanup handle.
    if (!this.isCurrent(request)) return;
    this.applyPosition(floatingEl, x, y);
    this.cleanupFn = autoUpdate(referenceEl, floatingEl, async () => {
      const result = await computePosition(referenceEl, floatingEl, config);
      if (!this.isCurrent(request)) return;
      this.applyPosition(floatingEl, result.x, result.y);
    });
  }

  private isCurrent(request: number): boolean {
    return !this.isDestroyed && request === this.requestToken;
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
  }

  /**
   * Cleanup auto-update listeners and cancel a pending position() request.
   * Call this when closing the floating element.
   *
   * Note: Also called automatically on component destroy via DestroyRef.
   */
  cleanup(): void {
    this.requestToken++;
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
  }
}
