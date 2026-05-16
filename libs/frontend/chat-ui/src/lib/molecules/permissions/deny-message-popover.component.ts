/**
 * DenyMessagePopoverComponent - Popover for deny-with-message input
 *
 * Provides inline text input for users to send a message to Claude when denying
 * a permission request, allowing execution to continue with feedback.
 *
 * Patterns: NativePopoverComponent, signal inputs/outputs
 *
 * Accessibility:
 * - Input has aria-label="Message to Claude"
 * - Focus moves to input on open
 * - Focus returns to trigger on close (via NativePopoverComponent)
 * - Escape closes popover (via NativePopoverComponent)
 *
 * Key Features:
 * - Uses NativePopoverComponent from @ptah-extension/ui for positioning
 * - DaisyUI btn-warning classes matching existing Deny button style
 * - Default message "User denied without explanation" if empty
 * - Enter key submits, Escape closes
 */

import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Send, MessageSquare } from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';

@Component({
  selector: 'ptah-deny-message-popover',
  imports: [FormsModule, LucideAngularModule, NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-popover
      [isOpen]="_isOpen()"
      [placement]="'top'"
      [hasBackdrop]="true"
      [backdropClass]="'transparent'"
      (closed)="handleClose()"
      (opened)="handleOpened()"
    >
      <!-- Trigger Button - click opens popover -->
      <button
        trigger
        class="btn btn-xs btn-warning btn-outline gap-0.5 px-2"
        type="button"
        aria-label="Deny with a message to Claude"
        [disabled]="disabled()"
        (click)="openPopover()"
      >
        <lucide-angular [img]="MessageSquareIcon" class="w-3 h-3" />
        Deny...
      </button>

      <!-- Popover Content -->
      <div content class="p-2 w-64">
        <div class="flex gap-1.5 items-center">
          <input
            #messageInput
            type="text"
            class="input input-xs input-bordered flex-1 text-xs"
            placeholder="Explain why or suggest alternatives..."
            aria-label="Message to Claude"
            [(ngModel)]="messageText"
            (keydown.enter)="handleSubmit()"
            maxlength="500"
          />
          <button
            class="btn btn-xs btn-warning gap-0.5"
            type="button"
            (click)="handleSubmit()"
            [disabled]="_isSubmitting()"
            aria-label="Send message and deny"
          >
            <lucide-angular [img]="SendIcon" class="w-3 h-3" />
          </button>
        </div>
      </div>
    </ptah-native-popover>
  `,
})
export class DenyMessagePopoverComponent {
  // Inputs
  readonly disabled = input<boolean>(false);

  // Internal state - component manages its own open state
  protected readonly _isOpen = signal(false);
  protected readonly _isSubmitting = signal(false);

  // Outputs
  readonly opened = output<void>();
  readonly messageSent = output<string>();
  readonly closed = output<void>();

  // Icons
  protected readonly SendIcon = Send;
  protected readonly MessageSquareIcon = MessageSquare;

  // Local state for ngModel binding
  protected messageText = '';

  // ViewChild for focus management
  private readonly messageInputRef =
    viewChild<ElementRef<HTMLInputElement>>('messageInput');

  /**
   * Open the popover - called by trigger button click
   */
  openPopover(): void {
    if (!this.disabled()) {
      this._isOpen.set(true);
      this.opened.emit();
    }
  }

  /**
   * Handle popover opened - focus input
   */
  handleOpened(): void {
    // Small delay to ensure DOM is ready after @if renders content
    setTimeout(() => {
      this.messageInputRef()?.nativeElement?.focus();
    }, 50);
  }

  /**
   * Handle submit - emit message and close
   * Uses default message if empty per requirement
   * Includes double-submit protection
   */
  handleSubmit(): void {
    // Double-submit protection
    if (this._isSubmitting()) {
      return;
    }

    this._isSubmitting.set(true);

    // Use default message if empty
    const message =
      this.messageText.trim() || 'User denied without explanation';
    this.messageSent.emit(message);

    // Reset state
    this.messageText = '';
    this._isOpen.set(false);
    this._isSubmitting.set(false);
  }

  /**
   * Handle close - clear text and close popover
   */
  handleClose(): void {
    this.messageText = '';
    this._isOpen.set(false);
    this.closed.emit();
  }
}
