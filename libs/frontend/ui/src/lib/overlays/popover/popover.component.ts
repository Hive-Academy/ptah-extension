import { A11yModule, FocusTrap, FocusTrapFactory } from '@angular/cdk/a11y';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import {
  Component,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  ViewChild,
} from '@angular/core';
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
 * <ptah-popover
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
 * </ptah-popover>
 */
@Component({
  selector: 'ptah-popover',
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
      (detach)="handleDetach()"
    >
      <div
        #popoverContent
        class="popover-panel bg-base-200 border border-base-300 rounded-lg shadow-xl"
        tabindex="-1"
        (keydown.escape)="handleEscape()"
      >
        <ng-content select="[content]" />
      </div>
    </ng-template>
  `,
})
export class PopoverComponent implements OnDestroy {
  private readonly focusTrapFactory = inject(FocusTrapFactory);
  private focusTrap: FocusTrap | null = null;

  @ViewChild('popoverContent') popoverContent!: ElementRef<HTMLElement>;

  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly position = input<'above' | 'below' | 'before' | 'after'>('below');
  readonly positions = input<ConnectedPosition[]>(); // Custom positions override
  readonly hasBackdrop = input(true);
  readonly backdropClass = input('cdk-overlay-transparent-backdrop');

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();

  ngOnDestroy(): void {
    // Clean up focus trap if component destroyed while popover is open
    if (this.focusTrap) {
      this.focusTrap.destroy();
      this.focusTrap = null;
    }
  }

  /**
   * Returns position configurations for the popover based on the selected position input.
   * If custom positions are provided via input, uses those instead.
   * Defaults to 'below' position if invalid position provided and no custom positions.
   */
  getPositions(): ConnectedPosition[] {
    // Use custom positions if provided
    const customPositions = this.positions();
    if (customPositions && customPositions.length > 0) {
      return customPositions;
    }

    // Otherwise use position map
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
