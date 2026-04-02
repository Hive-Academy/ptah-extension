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
import { FloatingUIService } from '../shared';

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
        class="dropdown-panel bg-base-200 border border-base-300 rounded-lg shadow-lg z-50"
        style="visibility: hidden;"
        role="listbox"
      >
        <ng-content select="[content]" />
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
        position: relative;
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
   * @default 8
   */
  readonly offset = input<number>(8);

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

  constructor() {
    // Effect to position dropdown when opened
    effect(() => {
      const isOpen = this.isOpen();
      if (isOpen) {
        // Schedule positioning for next microtask to ensure DOM is ready
        this.positioningPending = true;
        queueMicrotask(() => {
          if (this.positioningPending && this.isOpen()) {
            this.positionDropdown();
          }
          this.positioningPending = false;
        });
      } else {
        this.positioningPending = false;
        this.floatingUI.cleanup();
      }
    });
  }

  /**
   * Position the dropdown content using Floating UI.
   * Called automatically when isOpen becomes true.
   */
  private async positionDropdown(): Promise<void> {
    const trigger = this.triggerRef()?.nativeElement;
    const floating = this.floatingRef()?.nativeElement;

    if (trigger && floating) {
      await this.floatingUI.position(trigger, floating, {
        placement: this.placement(),
        offset: this.offset(),
        flip: true,
        shift: true,
      });
      this.opened.emit();
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
    this.floatingUI.cleanup();
  }
}
