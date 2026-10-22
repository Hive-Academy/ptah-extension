/**
 * NativeDropdownComponent - Native Dropdown with Floating UI
 *
 * Dropdown container using Floating UI for positioning, replacing CDK Overlay.
 * Renders content in-place (not in portal) but positions using Floating UI
 * to avoid VS Code webview sandboxing conflicts.
 *
 * Key differences from CDK DropdownComponent:
 * - Uses Floating UI instead of CDK Overlay for positioning
 * - No portal rendering (content stays in component DOM)
 * - Native backdrop element for click-outside detection
 *
 * @example
 * ```typescript
 * <ptah-native-dropdown
 *   [isOpen]="isOpen()"
 *   [placement]="'bottom-start'"
 *   [closeOnBackdropClick]="true"
 *   (opened)="onOpen()"
 *   (closed)="onClose()">
 *
 *   <button trigger (click)="toggleDropdown()">
 *     Open Menu
 *   </button>
 *
 *   <div content class="dropdown-panel">
 *     <ptah-native-option
 *       *ngFor="let item of items; let i = index"
 *       [optionId]="'item-' + i"
 *       [value]="item"
 *       [isActive]="i === activeIndex()"
 *       (selected)="selectItem($event)">
 *       {{ item.name }}
 *     </ptah-native-option>
 *   </div>
 * </ptah-native-dropdown>
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
  OnDestroy,
} from '@angular/core';
import { Placement } from '@floating-ui/dom';
import { DEFAULT_OVERLAY_OFFSET, FloatingUIService } from '../shared';

/** Longest wait for the first position before the trigger-anchored fallback. */
export const DROPDOWN_POSITION_TIMEOUT_MS = 1000;

/**
 * Native dropdown component using Floating UI for positioning.
 *
 * Unlike CDK DropdownComponent which renders in a portal at document body level,
 * this component renders content in-place but uses Floating UI for positioning.
 * This avoids CDK Overlay's portal rendering conflicts with VS Code webview sandboxing.
 */
@Component({
  selector: 'ptah-native-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FloatingUIService],
  template: `
    <!-- Trigger element (always rendered) -->
    <div #triggerRef class="dropdown-trigger inline-block">
      <ng-content select="[trigger]" />
    </div>

    <!-- Dropdown panel (conditionally rendered) -->
    @if (isOpen()) {
      <!-- Open shell only. manual popover: top layer, no light dismiss, so a
           sibling pane's stacking context cannot paint over the panel. -->
      <div #layerRef popover="manual" class="ptah-dropdown-layer">
        <!-- Backdrop for click-outside detection -->
        @if (hasBackdrop()) {
          <div
            class="fixed inset-0 z-40"
            [class]="backdropClass() === 'dark' ? 'bg-black/20' : ''"
            (click)="handleBackdropClick()"
            tabindex="-1"
            role="presentation"
            aria-hidden="true"
          ></div>
        }

        <!-- Floating content - starts hidden until positioned -->
        <div
          #floatingRef
          class="dropdown-panel surface-3 z-50 rounded-xl p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
          style="visibility: hidden;"
          [attr.role]="panelRole()"
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
        position: relative;
      }

      /* Full-viewport top-layer shell. No transform, filter, contain, or
         will-change: any of those would make Floating UI's fixed coordinates miss. */
      .ptah-dropdown-layer {
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

      .ptah-dropdown-layer::backdrop {
        background: transparent !important;
        pointer-events: none !important;
      }

      .ptah-dropdown-layer > .dropdown-panel,
      .ptah-dropdown-layer > [role='presentation'] {
        pointer-events: auto;
      }
    `,
  ],
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class NativeDropdownComponent implements OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);

  /**
   * Flag to track pending microtask positioning.
   * Used to cancel positioning if dropdown closes before microtask executes.
   */
  private positioningPending = false;

  /**
   * Whether the dropdown is open.
   * Parent controls this state.
   */
  readonly isOpen = input.required<boolean>();

  /**
   * Placement of the dropdown relative to trigger.
   * Uses Floating UI Placement type.
   * @default 'bottom-start'
   */
  readonly placement = input<Placement>('bottom-start');

  /**
   * Offset distance from trigger element in pixels.
   * @default DEFAULT_OVERLAY_OFFSET
   */
  readonly offset = input<number>(DEFAULT_OVERLAY_OFFSET);

  /**
   * Whether to show a backdrop for click-outside detection.
   * @default true
   */
  readonly hasBackdrop = input<boolean>(true);

  /**
   * Backdrop appearance: 'transparent' or 'dark'.
   * @default 'transparent'
   */
  readonly backdropClass = input<'transparent' | 'dark'>('transparent');

  /**
   * Whether clicking backdrop should emit closed event.
   * @default true
   */
  readonly closeOnBackdropClick = input<boolean>(true);

  /**
   * ARIA role of the floating panel. Keep 'listbox' for option lists; pass
   * null for a panel of plain action buttons so it is not announced as a
   * listbox that contains no options.
   * @default 'listbox'
   */
  readonly panelRole = input<'listbox' | null>('listbox');

  /**
   * Emitted when dropdown opens and is positioned.
   */
  readonly opened = output<void>();

  /**
   * Emitted when dropdown should close.
   * Parent should set isOpen to false.
   */
  readonly closed = output<void>();

  /**
   * Emitted when backdrop is clicked.
   * Always emitted regardless of closeOnBackdropClick.
   */
  readonly backdropClicked = output<void>();

  private readonly triggerRef =
    viewChild<ElementRef<HTMLElement>>('triggerRef');
  private readonly floatingRef =
    viewChild<ElementRef<HTMLElement>>('floatingRef');
  private readonly layerRef = viewChild<ElementRef<HTMLElement>>('layerRef');

  /** Layer element of the current open. Survives the @if teardown. */
  private layerElement: HTMLElement | null = null;

  /** Whether showPopover succeeded for layerElement. */
  private layerShowing = false;

  /** Bumped on every open, close and destroy; a stale open reports nothing. */
  private openGeneration = 0;

  private destroyed = false;

  /** Bound on the first positioning; cleared on settle, close and destroy. */
  private positionTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const isOpen = this.isOpen();
      if (isOpen) {
        this.positioningPending = true;
        queueMicrotask(() => {
          if (this.positioningPending && this.isOpen()) {
            this.positionDropdown();
          }
          this.positioningPending = false;
        });
      } else {
        this.positioningPending = false;
        this.openGeneration++;
        this.clearPositionTimer();
        this.hideLayer();
        this.floatingUI.cleanup();
      }
    });
  }

  /**
   * Position the dropdown content using Floating UI.
   * Called automatically when isOpen becomes true.
   */
  private async positionDropdown(): Promise<void> {
    if (this.destroyed || !this.isOpen()) return;
    const generation = ++this.openGeneration;
    const trigger = this.triggerRef()?.nativeElement;
    const floating = this.floatingRef()?.nativeElement;
    if (!trigger || !floating) return;

    // A hidden [popover] is display:none: promote before measuring.
    this.showLayer();
    const positioned = await this.positionPanel(trigger, floating);
    // Closed, reopened or destroyed while positioning ran: the close path
    // already hid the shell and cancelled the request, so report nothing.
    if (this.destroyed || generation !== this.openGeneration || !this.isOpen()) {
      return;
    }
    if (!positioned) {
      // Never leave a hidden panel behind the viewport-wide backdrop: pin it
      // under the trigger without flip or shift.
      this.revealUnderTrigger(floating, trigger);
    }
    this.opened.emit();
  }

  /**
   * First positioning, bounded by DROPDOWN_POSITION_TIMEOUT_MS. Resolves
   * false on rejection or timeout. A late success still applies through the
   * service while the dropdown stays open; after a close the service drops it.
   */
  private async positionPanel(
    trigger: HTMLElement,
    floating: HTMLElement,
  ): Promise<boolean> {
    this.clearPositionTimer();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), DROPDOWN_POSITION_TIMEOUT_MS);
      this.positionTimer = timer;
    });
    try {
      return await Promise.race([
        this.floatingUI
          .position(trigger, floating, {
            placement: this.placement(),
            offset: this.offset(),
            flip: true,
            shift: true,
          })
          .then(() => true),
        timedOut,
      ]);
    } catch {
      // Intentionally swallowed: the caller reveals the trigger-anchored
      // fallback, which is the only recovery a rejected compute allows.
      return false;
    } finally {
      // A stale call must not clear the timer of a newer open.
      if (this.positionTimer === timer) this.clearPositionTimer();
    }
  }

  private clearPositionTimer(): void {
    if (this.positionTimer !== undefined) {
      clearTimeout(this.positionTimer);
      this.positionTimer = undefined;
    }
  }

  /** Make the panel visible under the trigger without a position pass. */
  private revealUnderTrigger(floating: HTMLElement, trigger: HTMLElement): void {
    if (trigger.isConnected) {
      const rect = trigger.getBoundingClientRect();
      floating.style.position = 'fixed';
      floating.style.left = `${rect.left}px`;
      floating.style.top = `${rect.bottom}px`;
    }
    floating.style.visibility = 'visible';
  }

  /** Promote the shell to the top layer. Without the Popover API the shell stays in place. */
  private showLayer(): void {
    const layer = this.layerRef()?.nativeElement;
    if (!layer || this.destroyed) return;
    this.layerElement = layer;
    if (this.layerShowing) return;
    if (typeof layer.showPopover !== 'function') {
      this.keepLayerInPlace(layer);
      return;
    }
    try {
      layer.showPopover();
      this.layerShowing = true;
    } catch {
      // Intentionally swallowed (not connected or already open): the shell
      // stays in the page layer, made visible below.
      this.keepLayerInPlace(layer);
    }
  }

  /** Undo a non-open popover's display:none when promotion did not happen. */
  private keepLayerInPlace(layer: HTMLElement): void {
    layer.style.display = 'block';
  }

  /** Leave the top layer. A shell the view already removed is hidden by the engine. */
  private hideLayer(): void {
    const layer = this.layerElement;
    const showing = this.layerShowing;
    this.layerElement = null;
    this.layerShowing = false;
    if (layer) layer.style.display = '';
    if (!layer || !showing || !layer.isConnected || typeof layer.hidePopover !== 'function') {
      return;
    }
    try {
      layer.hidePopover();
    } catch {
      // Intentionally swallowed: the shell is already hidden.
    }
  }

  /**
   * Handle backdrop click events.
   * Always emits backdropClicked.
   * If closeOnBackdropClick is true, also emits closed.
   */
  handleBackdropClick(): void {
    this.backdropClicked.emit();
    if (this.closeOnBackdropClick()) {
      this.closed.emit();
    }
  }

  /**
   * Handle outside clicks when hasBackdrop is false.
   * Closes dropdown if click is outside trigger and floating panel.
   */
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen() || this.hasBackdrop()) return;

    const target = event.target as HTMLElement;
    const trigger = this.triggerRef()?.nativeElement;
    const floating = this.floatingRef()?.nativeElement;

    if (
      trigger &&
      !trigger.contains(target) &&
      floating &&
      !floating.contains(target)
    ) {
      this.closed.emit();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.openGeneration++;
    this.clearPositionTimer();
    this.hideLayer();
    this.floatingUI.cleanup();
  }
}
