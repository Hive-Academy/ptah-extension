/**
 * NativePopoverComponent - Native Popover with Focus Management
 *
 * Modal-like popover using Floating UI for positioning, replacing CDK Overlay + FocusTrap.
 * Provides native focus management: stores previous focus and restores on close.
 *
 * Key differences from CDK PopoverComponent:
 * - Uses Floating UI instead of CDK Overlay for positioning
 * - Native focus management instead of CDK FocusTrap
 * - No portal: the open shell stays in this component and joins the top layer
 *   (`popover="manual"`) so an isolating glass ancestor cannot clip it
 * - Native backdrop element with dark/transparent options
 *
 * @example
 * ```typescript
 * <ptah-native-popover
 *   [isOpen]="isOpen()"
 *   [placement]="'bottom'"
 *   [hasBackdrop]="true"
 *   [backdropClass]="'dark'"
 *   (opened)="onOpen()"
 *   (closed)="onClose()">
 *
 *   <button trigger (click)="togglePopover()">
 *     Open Settings
 *   </button>
 *
 *   <div content class="popover-panel p-4">
 *     <h3>Settings</h3>
 *     <button (click)="save()">Save</button>
 *     <button (click)="cancel()">Cancel</button>
 *   </div>
 * </ptah-native-popover>
 * ```
 */
import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  viewChild,
  ElementRef,
  inject,
  effect,
  isDevMode,
  OnDestroy,
  afterNextRender,
  Injector,
} from '@angular/core';
import { Placement } from '@floating-ui/dom';
import { DEFAULT_OVERLAY_OFFSET, FloatingUIService } from '../shared';

/**
 * Upper bound on the wait for the first position. Positioning normally settles
 * within a frame; past this bound the panel is shown unpositioned rather than
 * left invisible behind its backdrop.
 */
export const POPOVER_POSITION_TIMEOUT_MS = 1000;

type PositionOutcome = 'positioned' | 'failed' | 'timed out';

/**
 * Native popover component using Floating UI for positioning.
 *
 * Unlike CDK PopoverComponent which uses CDK FocusTrap,
 * this component implements native focus management:
 * - Stores the previously focused element before opening
 * - Focuses the popover content on open
 * - Restores focus to the previous element on close
 *
 * This pattern:
 * - Avoids CDK A11y module dependency
 * - Works reliably in VS Code webview environment
 * - Maintains keyboard accessibility
 */
@Component({
  selector: 'ptah-native-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FloatingUIService],
  host: {
    '(keydown)': 'handleHostKeyDown($event)',
  },
  template: `
    <!-- Trigger element (always rendered) -->
    <div #triggerRef class="popover-trigger inline-block">
      <ng-content select="[trigger]" />
    </div>

    <!-- Open shell only. manual popover: top layer, no light dismiss. -->
    @if (isOpen()) {
      <div #layerRef popover="manual" class="ptah-popover-layer">
        <!-- Backdrop (optional). The native ::backdrop stays click-through. -->
        @if (hasBackdrop()) {
          <div
            class="fixed inset-0 z-40"
            [class]="backdropClass() === 'dark' ? 'bg-black/50' : ''"
            (click)="handleBackdropClick()"
            tabindex="-1"
            role="presentation"
            aria-hidden="true"
          ></div>
        }

        <!-- Floating content - starts hidden until positioned -->
        <div
          #floatingRef
          class="popover-panel surface-3 z-50 rounded-xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
          style="visibility: hidden;"
          tabindex="-1"
        >
          <ng-content select="[content]" />
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      /* Full-viewport top-layer shell. No transform, filter, contain, or
         will-change: any of those would make Floating UI's fixed coordinates miss. */
      .ptah-popover-layer {
        position: fixed;
        inset: 0;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        margin: 0;
        border: 0;
        padding: 0;
        overflow: visible;
        background: transparent;
        color: inherit;
        box-shadow: none;
        pointer-events: none;
      }

      .ptah-popover-layer::backdrop {
        background: transparent !important;
        pointer-events: none !important;
      }

      .ptah-popover-layer > .popover-panel,
      .ptah-popover-layer > [role='presentation'] {
        pointer-events: auto;
      }
    `,
  ],
})
export class NativePopoverComponent implements OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);
  private readonly injector = inject(Injector);

  /**
   * Whether the popover is open.
   * Parent controls this state.
   */
  readonly isOpen = input.required<boolean>();

  /**
   * Placement of the popover relative to trigger.
   * Uses Floating UI Placement type.
   * @default 'bottom'
   */
  readonly placement = input<Placement>('bottom');

  /** Optional external positioning anchor; defaults to the projected trigger. */
  readonly anchor = input<HTMLElement | null>(null);

  /**
   * Offset distance from trigger element in pixels.
   * @default DEFAULT_OVERLAY_OFFSET
   */
  readonly offset = input<number>(DEFAULT_OVERLAY_OFFSET);

  /**
   * Whether to show a backdrop.
   * Popover typically uses backdrop for modal-like behavior.
   * @default true
   */
  readonly hasBackdrop = input<boolean>(true);

  /**
   * Backdrop appearance: 'transparent' or 'dark'.
   * Popovers typically use dark backdrop for modal UX.
   * @default 'dark'
   */
  readonly backdropClass = input<'transparent' | 'dark'>('dark');

  /**
   * Opt-in: keep the whole panel inside the viewport by also shifting it along the placement axis (it may then
   * overlap the trigger). For a height-capped panel that can be taller than either side of its trigger.
   * @default false
   */
  readonly keepInViewport = input<boolean>(false);

  /**
   * Emitted when popover opens and is positioned.
   */
  readonly opened = output<void>();

  /**
   * Emitted when popover should close.
   * Parent should set isOpen to false.
   */
  readonly closed = output<void>();

  /**
   * Emitted when backdrop is clicked.
   */
  readonly backdropClicked = output<void>();

  private readonly triggerRef =
    viewChild<ElementRef<HTMLElement>>('triggerRef');
  private readonly floatingRef =
    viewChild<ElementRef<HTMLElement>>('floatingRef');
  private readonly layerRef = viewChild<ElementRef<HTMLElement>>('layerRef');

  /** Layer element that showPopover promoted. Survives the @if teardown. */
  private layerElement: HTMLElement | null = null;

  /** True only after showPopover succeeded, so hide is not called twice. */
  private layerShowing = false;

  /** Set in ngOnDestroy so a queued open cannot show or focus afterwards. */
  private destroyed = false;

  /**
   * Stores the element that had focus before popover opened.
   * Used to restore focus when popover closes.
   */
  private previousActiveElement: HTMLElement | null = null;

  /**
   * Bumped by every open, close and destroy, so an open whose positioning
   * settles after the popover closed (or reopened) is recognised as stale.
   */
  private openGeneration = 0;

  constructor() {
    effect(() => {
      const isOpen = this.isOpen();
      if (isOpen) {
        queueMicrotask(() => this.openPopover());
      } else {
        this.closePopover();
      }
    });
  }

  /**
   * Open the popover: store focus, position content, focus popover.
   */
  private async openPopover(): Promise<void> {
    // Closed again before the queued open ran: nothing to open.
    if (!this.isOpen() || this.destroyed) return;
    const generation = ++this.openGeneration;
    this.previousActiveElement = document.activeElement as HTMLElement;

    const anchor = this.anchor();
    const trigger = anchor?.isConnected ? anchor : this.triggerRef()?.nativeElement;
    const floating = this.floatingRef()?.nativeElement;
    if (!floating || this.destroyed || generation !== this.openGeneration) return;

    // A hidden [popover] is display:none. Promote before any measurement so
    // Floating UI sees the panel, and so the shell is already the top layer.
    this.showLayer();
    if (this.destroyed || generation !== this.openGeneration || !this.isOpen()) {
      this.hideLayer();
      return;
    }

    if (!trigger?.isConnected) {
      if (isDevMode()) console.error('ptah-native-popover: no connected anchor; showing the panel unpositioned.');
      this.revealUnpositioned(floating, null);
      floating.focus();
      this.opened.emit();
      return;
    }

    const outcome = await this.positionPanel(trigger, floating);
    // Closed, destroyed or reopened while positioning ran: the close path has
    // already restored focus, so a stale open neither focuses nor reports.
    // Its cleanup() (or the newer position()) cancelled the request in the
    // service, which installs no auto-update when it settles late.
    if (this.destroyed || generation !== this.openGeneration) return;
    if (outcome !== 'positioned') {
      // The shell is a full-viewport containing block, so an in-flow panel
      // would sit at the viewport origin. Pin it under the trigger instead.
      // Still no flip, shift, or auto-update: this is the unpositioned fallback.
      if (isDevMode()) {
        console.error(
          `ptah-native-popover: positioning ${outcome}; showing the panel unpositioned.`,
        );
      }
      this.revealUnpositioned(floating, trigger);
    }
    floating.focus();
    this.opened.emit();
  }

  /**
   * Show the manual popover shell. Missing or rejected Popover API leaves the
   * panel in place (the pre-top-layer behaviour) and still lets positioning run.
   */
  private showLayer(): void {
    const layer = this.layerRef()?.nativeElement;
    if (!layer || this.destroyed) return;
    this.layerElement = layer;
    if (this.layerShowing) return;
    if (typeof layer.showPopover !== 'function') {
      // No Popover API: the attribute's UA rule would keep the shell at
      // display:none. Stay in place so positioning still has a box.
      this.keepLayerInPlace(layer);
      return;
    }
    try {
      layer.showPopover();
      this.layerShowing = true;
    } catch (error: unknown) {
      this.keepLayerInPlace(layer);
      if (isDevMode()) {
        console.error('ptah-native-popover: showPopover failed:', error);
      }
    }
  }

  /** Undo a non-open popover's display:none when promotion did not happen. */
  private keepLayerInPlace(layer: HTMLElement): void {
    layer.style.display = 'block';
  }

  /**
   * Leave the top layer. Safe when the view already removed the shell: a
   * disconnected popover is hidden by the engine, and a second hide throws.
   */
  private hideLayer(): void {
    const layer = this.layerElement;
    const showing = this.layerShowing;
    this.layerShowing = false;
    this.layerElement = null;
    if (layer) layer.style.display = '';
    if (!layer || !showing || typeof layer.hidePopover !== 'function') return;
    try {
      layer.hidePopover();
    } catch (error: unknown) {
      if (layer.isConnected && isDevMode()) {
        console.error('ptah-native-popover: hidePopover failed:', error);
      }
    }
  }

  /** Make a failed or anchor-less panel visible without a position pass. */
  private revealUnpositioned(
    floating: HTMLElement,
    trigger: HTMLElement | null,
  ): void {
    if (trigger?.isConnected) {
      const rect = trigger.getBoundingClientRect();
      floating.style.position = 'fixed';
      floating.style.left = `${rect.left}px`;
      floating.style.top = `${rect.bottom}px`;
    }
    floating.style.visibility = 'visible';
  }

  /**
   * First positioning of the panel, bounded by POPOVER_POSITION_TIMEOUT_MS.
   * A late success still applies its position through the service while the
   * popover stays open; after a close the service drops it.
   */
  private async positionPanel(
    trigger: HTMLElement,
    floating: HTMLElement,
  ): Promise<PositionOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<PositionOutcome>((resolve) => {
      timer = setTimeout(
        () => resolve('timed out'),
        POPOVER_POSITION_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([
        this.floatingUI
          .position(trigger, floating, {
            placement: this.placement(),
            offset: this.offset(),
            flip: true,
            shift: true,
            ...(this.keepInViewport() ? { shiftCrossAxis: true } : {}),
          })
          .then((): PositionOutcome => 'positioned'),
        timedOut,
      ]);
    } catch (error: unknown) {
      // Keep the cause: openPopover only sees the 'failed' outcome and logs
      // the fallback it takes, not why positioning rejected.
      if (isDevMode()) {
        console.error('ptah-native-popover: positioning rejected:', error);
      }
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Repositions the open panel (flip, shift) after the next render, for a
   * parent whose projected content just changed size (it may grow past the
   * side it was placed on).
   */
  reposition(): void {
    afterNextRender(() => this.floatingUI.update(), {
      injector: this.injector,
    });
  }

  /**
   * Close the popover: cleanup positioning, restore focus.
   */
  private closePopover(): void {
    this.openGeneration++;
    this.hideLayer();
    this.floatingUI.cleanup();
    if (this.previousActiveElement?.isConnected) {
      this.previousActiveElement.focus();
    }
    this.previousActiveElement = null;
  }

  /**
   * Handle backdrop click events.
   * Emits backdropClicked and closed events.
   */
  handleBackdropClick(): void {
    this.backdropClicked.emit();
    this.closed.emit();
  }

  /**
   * Handle keyboard events on host element.
   * Escape key closes the popover.
   */
  handleHostKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.openGeneration++;
    this.hideLayer();
    this.floatingUI.cleanup();
    if (this.previousActiveElement?.isConnected) {
      this.previousActiveElement.focus();
    }
    this.previousActiveElement = null;
  }
}
