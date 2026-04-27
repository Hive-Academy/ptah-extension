/**
 * NativePopoverComponent - Native Popover with Focus Management
 *
 * Modal-like popover using Floating UI for positioning, replacing CDK Overlay + FocusTrap.
 * Provides native focus management: stores previous focus and restores on close.
 *
 * Key differences from CDK PopoverComponent:
 * - Uses Floating UI instead of CDK Overlay for positioning
 * - Native focus management instead of CDK FocusTrap
 * - No portal rendering (content stays in component DOM)
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
  OnDestroy,
} from '@angular/core';
import { Placement } from '@floating-ui/dom';
import { DEFAULT_OVERLAY_OFFSET, FloatingUIService } from '../shared';

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

    <!-- Popover panel (conditionally rendered) -->
    @if (isOpen()) {
      <!-- Backdrop (optional) -->
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
        class="popover-panel bg-base-200 border border-base-300 rounded-lg shadow-xl z-50"
        style="visibility: hidden;"
        tabindex="-1"
      >
        <ng-content select="[content]" />
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
    `,
  ],
})
export class NativePopoverComponent implements OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);

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

  /**
   * Stores the element that had focus before popover opened.
   * Used to restore focus when popover closes.
   */
  private previousActiveElement: HTMLElement | null = null;

  constructor() {
    // Effect to handle open/close state changes
    effect(() => {
      const isOpen = this.isOpen();
      if (isOpen) {
        // Schedule opening for next microtask to ensure DOM is ready
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
    // Store current focus for restoration on close
    this.previousActiveElement = document.activeElement as HTMLElement;

    const trigger = this.triggerRef()?.nativeElement;
    const floating = this.floatingRef()?.nativeElement;

    if (trigger && floating) {
      await this.floatingUI.position(trigger, floating, {
        placement: this.placement(),
        offset: this.offset(),
        flip: true,
        shift: true,
      });

      // Focus the popover content for keyboard accessibility
      floating.focus();
      this.opened.emit();
    }
  }

  /**
   * Close the popover: cleanup positioning, restore focus.
   */
  private closePopover(): void {
    this.floatingUI.cleanup();

    // Restore focus to the element that had focus before opening
    // Check isConnected to ensure element is still in DOM before focusing
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
    this.floatingUI.cleanup();
    // Ensure focus restoration if component destroyed while open
    // Check isConnected to ensure element is still in DOM before focusing
    if (this.previousActiveElement?.isConnected) {
      this.previousActiveElement.focus();
    }
    this.previousActiveElement = null;
  }
}
