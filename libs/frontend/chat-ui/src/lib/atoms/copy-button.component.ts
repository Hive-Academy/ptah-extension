import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { LucideAngularModule, Copy, Check } from 'lucide-angular';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';

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
      class="btn btn-xs btn-ghost btn-square"
      [class.text-success]="isCopied()"
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
    const msg = this.message();
    let content = '';

    // For assistant messages, extract text from streamingState tree
    if (msg.role === 'assistant' && msg.streamingState) {
      content = this.extractTextFromNode(msg.streamingState);
    } else {
      // For user messages, use rawContent
      content = msg.rawContent || '';
    }

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

  /**
   * Recursively extract text content from an ExecutionNode tree
   * Collects content from 'text' and 'message' type nodes
   */
  private extractTextFromNode(node: ExecutionNode): string {
    const parts: string[] = [];

    // Add this node's content if it's a text or message type with content
    if (node.content && (node.type === 'text' || node.type === 'message')) {
      parts.push(node.content);
    }

    // Recursively process children
    for (const child of node.children) {
      const childContent = this.extractTextFromNode(child);
      if (childContent) {
        parts.push(childContent);
      }
    }

    return parts.join('\n\n');
  }
}
