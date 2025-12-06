import {
  Component,
  input,
  output,
  ViewChild,
  ElementRef,
  inject,
  AfterViewInit,
} from '@angular/core';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { A11yModule, FocusTrap, FocusTrapFactory } from '@angular/cdk/a11y';
import { POPOVER_POSITION_MAP } from '../shared/overlay-positions';

/**
 * PopoverComponent - Modal-like Popover with Focus Trap
 *
 * Similar to DropdownComponent but with modal behavior:
 * - Dark/transparent backdrop blocks background interaction
 * - Focus trapped within popover content
 * - Escape key closes and returns focus to trigger
 *
 * @example
 * <lib-popover
 *   [isOpen]="isOpen()"
 *   [position]="'below'"
 *   [hasBackdrop]="true"
 *   [backdropClass]="'cdk-overlay-dark-backdrop'"
 *   (closed)="onClose()">
 *
 *   <button trigger (click)="togglePopover()">
 *     Open Settings
 *   </button>
 *
 *   <div content class="popover-panel">
 *     <h3>Settings</h3>
 *     <button (click)="save()">Save</button>
 *     <button (click)="cancel()">Cancel</button>
 *   </div>
 * </lib-popover>
 */
@Component({
  selector: 'lib-popover',
  standalone: true,
  imports: [OverlayModule, A11yModule],
  template: `
    <div cdkOverlayOrigin #trigger="cdkOverlayOrigin">
      <ng-content select="[trigger]" />
    </div>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="trigger"
      [cdkConnectedOverlayOpen]="isOpen()"
      [cdkConnectedOverlayPositions]="getPositions()"
      [cdkConnectedOverlayHasBackdrop]="hasBackdrop()"
      [cdkConnectedOverlayBackdropClass]="backdropClass()"
      (backdropClick)="handleBackdropClick()"
      (attach)="handleAttach()"
      (detach)="handleDetach()">
      <div
        #popoverContent
        class="popover-panel bg-base-200 border border-base-300 rounded-lg shadow-xl"
        (keydown.escape)="handleEscape()">
        <ng-content select="[content]" />
      </div>
    </ng-template>
  `,
})
export class PopoverComponent implements AfterViewInit {
  private readonly focusTrapFactory = inject(FocusTrapFactory);
  private focusTrap: FocusTrap | null = null;

  @ViewChild('popoverContent') popoverContent!: ElementRef<HTMLElement>;

  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly position = input<'above' | 'below' | 'before' | 'after'>('below');
  readonly hasBackdrop = input(true);
  readonly backdropClass = input('cdk-overlay-transparent-backdrop');

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();

  ngAfterViewInit(): void {
    // FocusTrap setup happens when overlay attaches (handleAttach)
    // This lifecycle hook exists for potential future initialization needs
  }

  /**
   * Returns position configurations for the popover based on the selected position input.
   * Defaults to 'below' position if invalid position provided.
   */
  getPositions(): ConnectedPosition[] {
    const position = this.position();
    return POPOVER_POSITION_MAP[position] || POPOVER_POSITION_MAP['below'];
  }

  /**
   * Handles overlay attach event - creates focus trap and focuses first element.
   * Called automatically when cdkConnectedOverlay opens.
   */
  handleAttach(): void {
    // Create focus trap when popover opens
    if (this.popoverContent) {
      this.focusTrap = this.focusTrapFactory.create(
        this.popoverContent.nativeElement
      );
      this.focusTrap.focusInitialElementWhenReady();
    }
    this.opened.emit();
  }

  /**
   * Handles overlay detach event - destroys focus trap and returns focus to trigger.
   * Called automatically when cdkConnectedOverlay closes.
   */
  handleDetach(): void {
    // Destroy focus trap when popover closes
    // Focus automatically returns to trigger element via CDK
    this.focusTrap?.destroy();
    this.focusTrap = null;
    this.closed.emit();
  }

  /**
   * Handles backdrop click event.
   * Emits backdropClicked event and signals parent to close popover.
   */
  handleBackdropClick(): void {
    this.backdropClicked.emit();
    this.closed.emit();
  }

  /**
   * Handles Escape key press when popover is open.
   * Signals parent to close popover.
   */
  handleEscape(): void {
    this.closed.emit();
  }
}
