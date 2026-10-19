import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { LucideAngularModule, Copy, Check } from 'lucide-angular';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { extractMessageText } from './message-text';

/**
 * CopyButtonComponent - Reusable copy button for chat messages
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: CDK Clipboard, Signal-based state, OnPush change detection
 *
 * Handles clipboard operations with visual feedback.
 * Extracts text content from ExecutionNode tree for assistant messages.
 */
@Component({
  selector: 'ptah-copy-button',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button
      [class]="turnActionSize()
        ? 'inline-grid h-7 w-7 place-items-center rounded-md text-base-content-muted hover:bg-base-content/[.08] hover:text-base-content'
        : 'btn btn-xs btn-ghost btn-square'"
      [class.text-success]="isCopied()"
      type="button"
      aria-label="Copy message"
      [title]="isCopied() ? 'Copied!' : 'Copy'"
      (click)="copyMessage()"
    >
      <lucide-angular
        [img]="isCopied() ? CheckIcon : CopyIcon"
        class="w-3.5 h-3.5"
      />
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyButtonComponent {
  private readonly clipboard = inject(Clipboard);

  /** The message to copy content from */
  readonly message = input.required<ExecutionChatMessage>();
  /** Match the 28 px turn actions; other copy buttons retain their current size. */
  readonly turnActionSize = input<boolean>(false);

  /** Lucide icons */
  readonly CopyIcon = Copy;
  readonly CheckIcon = Check;

  /** Tracks copy button state for visual feedback */
  protected readonly isCopied = signal(false);

  /**
   * Copy message content to clipboard with visual feedback
   * Uses Angular CDK Clipboard for better compatibility in VS Code webviews
   * For assistant messages, extracts text from the streamingState execution tree
   */
  protected copyMessage(): void {
    const content = extractMessageText(this.message());

    if (!content) {
      console.warn('No content to copy');
      return;
    }

    const success = this.clipboard.copy(content);
    if (success) {
      this.isCopied.set(true);
      setTimeout(() => {
        this.isCopied.set(false);
      }, 2000);
    } else {
      console.warn('Failed to copy to clipboard');
    }
  }
}
