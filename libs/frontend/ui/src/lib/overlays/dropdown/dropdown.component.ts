import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { DROPDOWN_POSITIONS } from '../shared/overlay-positions';

/**
 * DropdownComponent - CDK Overlay Dropdown Wrapper
 *
 * Wraps cdkConnectedOverlay for simple dropdown use cases.
 * Renders dropdown in portal at document body level.
 * Supports backdrop click-outside detection.
 *
 * @deprecated Use NativeDropdownComponent from '@ptah-extension/ui' instead.
 * This component uses CDK Overlay which has conflicts with VS Code webview sandboxing.
 * Migration: Replace <ptah-dropdown> with <ptah-native-dropdown>.
 *
 * @example
 * <ptah-dropdown
 *   [isOpen]="isOpen()"
 *   [closeOnBackdropClick]="true"
 *   [positions]="dropdownPositions"
 *   (opened)="onOpen()"
 *   (closed)="onClose()"
 *   (backdropClicked)="onBackdropClick()">
 *
 *   <button trigger (click)="toggleDropdown()">
 *     Open Menu
 *   </button>
 *
 *   <div content class="dropdown-panel">
 *     <ptah-option *ngFor="let item of items" [value]="item">
 *       {{ item.name }}
 *     </ptah-option>
 *   </div>
 * </ptah-dropdown>
 */
@Component({
  selector: 'ptah-dropdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OverlayModule],
  template: `
    <div cdkOverlayOrigin #trigger="cdkOverlayOrigin">
      <ng-content select="[trigger]" />
    </div>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="trigger"
      [cdkConnectedOverlayOpen]="isOpen()"
      [cdkConnectedOverlayPositions]="positions()"
      [cdkConnectedOverlayHasBackdrop]="hasBackdrop()"
      [cdkConnectedOverlayBackdropClass]="backdropClass()"
      (backdropClick)="handleBackdropClick()"
      (attach)="opened.emit()"
      (detach)="handleDetach()"
    >
      <div
        class="dropdown-panel bg-base-200 border border-base-300 rounded-lg shadow-lg"
      >
        <ng-content select="[content]" />
      </div>
    </ng-template>
  `,
})
export class DropdownComponent {
  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly positions = input<ConnectedPosition[]>(DROPDOWN_POSITIONS);
  readonly hasBackdrop = input(true);
  readonly backdropClass = input('cdk-overlay-transparent-backdrop');
  readonly closeOnBackdropClick = input(true);

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();

  /**
   * Tracks whether the current close is being driven by a backdrop click,
   * so `handleDetach()` knows a `closed` event has already been emitted
   * and can suppress the duplicate.
   */
  private closingViaBackdrop = false;

  /**
   * Handles backdrop click events.
   * Always emits `backdropClicked`. When `closeOnBackdropClick` is true,
   * also emits `closed` so the parent can close the dropdown (e.g. by
   * setting its `isOpen` signal to `false`). We set an internal flag so
   * the ensuing `cdkConnectedOverlay` detach does not re-emit `closed`.
   */
  handleBackdropClick(): void {
    this.backdropClicked.emit();
    if (this.closeOnBackdropClick()) {
      this.closingViaBackdrop = true;
      this.closed.emit();
    }
  }

  /**
   * Handles overlay detach event.
   * Emits `closed` when the overlay programmatically closes. If the
   * detach was caused by a backdrop click (which already emitted
   * `closed` via `handleBackdropClick`), the flag suppresses the
   * duplicate event.
   */
  protected handleDetach(): void {
    if (this.closingViaBackdrop) {
      this.closingViaBackdrop = false;
      return;
    }
    this.closed.emit();
  }
}
