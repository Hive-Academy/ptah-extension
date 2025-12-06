import { Component, input, output } from '@angular/core';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { DROPDOWN_POSITIONS } from '../shared/overlay-positions';

/**
 * DropdownComponent - CDK Overlay Dropdown Wrapper
 *
 * Wraps cdkConnectedOverlay for simple dropdown use cases.
 * Renders dropdown in portal at document body level.
 * Supports backdrop click-outside detection.
 *
 * @example
 * <lib-dropdown
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
 *     <lib-option *ngFor="let item of items" [value]="item">
 *       {{ item.name }}
 *     </lib-option>
 *   </div>
 * </lib-dropdown>
 */
@Component({
  selector: 'lib-dropdown',
  standalone: true,
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
      (attach)="opened.emit()">
      <div class="dropdown-panel bg-base-200 border border-base-300 rounded-lg shadow-lg">
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
   * Handles backdrop click events.
   * Always emits backdropClicked output.
   * If closeOnBackdropClick is true, emits closed output to signal
   * that the parent should close the dropdown.
   */
  handleBackdropClick(): void {
    this.backdropClicked.emit();
    if (this.closeOnBackdropClick()) {
      // Signal parent to close dropdown (parent sets isOpen to false)
      // This is a semantic "please close" signal, distinct from the
      // overlay detach event which happens when actually closing
      this.closed.emit();
    }
  }
}
