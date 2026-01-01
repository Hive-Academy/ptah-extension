/**
 * DenyMessagePopoverComponent - Popover for deny-with-message input
 *
 * TASK_2025_102 Batch 3 Task 3.1: Provides inline text input for users to send
 * a message to Claude when denying a permission request, allowing execution to
 * continue with feedback.
 *
 * Complexity Level: 2 (Signal-based with focus management)
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
      [isOpen]="isOpen()"
      [placement]="'top'"
      [hasBackdrop]="true"
      [backdropClass]="'transparent'"
      (closed)="handleClose()"
      (opened)="handleOpened()"
    >
      <!-- Trigger Button -->
      <button
        trigger
        class="btn btn-xs btn-warning btn-outline gap-0.5 px-2"
        type="button"
        aria-label="Deny with a message to Claude"
        [disabled]="disabled()"
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
          />
          <button
            class="btn btn-xs btn-warning gap-0.5"
            type="button"
            (click)="handleSubmit()"
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
  readonly isOpen = input.required<boolean>();
  readonly disabled = input<boolean>(false);

  // Outputs
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
   */
  handleSubmit(): void {
    // Use default message if empty (per TASK_2025_102 requirement)
    const message =
      this.messageText.trim() || 'User denied without explanation';
    this.messageSent.emit(message);
    this.messageText = '';
  }

  /**
   * Handle close - clear text and emit closed event
   */
  handleClose(): void {
    this.messageText = '';
    this.closed.emit();
  }
}
