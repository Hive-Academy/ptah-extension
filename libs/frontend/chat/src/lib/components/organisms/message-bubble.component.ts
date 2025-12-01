import {
  Component,
  input,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import {
  LucideAngularModule,
  Copy,
  ThumbsUp,
  ThumbsDown,
  User,
} from 'lucide-angular';
import { ExecutionNodeComponent } from './execution-node.component';
import { TypingCursorComponent } from '../atoms/typing-cursor.component';
import type {
  ExecutionChatMessage,
  PermissionRequest,
} from '@ptah-extension/shared';
import { VSCodeService } from '@ptah-extension/core';
import { ChatStore } from '../../services/chat.store';

/**
 * MessageBubbleComponent - Chat message with DaisyUI styling
 *
 * Complexity Level: 2 (Organism with composition)
 * Patterns: DaisyUI chat component, Role-based rendering
 *
 * Renders user messages as right-aligned bubbles (chat-end) with rawContent.
 * Renders assistant messages as left-aligned bubbles (chat-start) with ExecutionNode tree.
 *
 * Uses DaisyUI chat classes for consistent message styling.
 */
@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  imports: [
    MarkdownModule,
    ExecutionNodeComponent,
    TypingCursorComponent,
    LucideAngularModule,
    NgOptimizedImage,
  ],
  templateUrl: './message-bubble.component.html',
  styleUrl: './message-bubble.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBubbleComponent {
  /**
   * VS Code service for webview utilities
   */
  private readonly vscode = inject(VSCodeService);
  private readonly chatStore = inject(ChatStore);

  readonly message = input.required<ExecutionChatMessage>();

  /** Indicates if this message is currently streaming */
  readonly isStreaming = input<boolean>(false);

  // Lucide icons
  readonly CopyIcon = Copy;
  readonly ThumbsUpIcon = ThumbsUp;
  readonly ThumbsDownIcon = ThumbsDown;
  readonly UserIcon = User;
  readonly ptahIconUri = this.vscode.getPtahIconUri();

  /**
   * Permission lookup function to pass to execution tree
   * Enables tool cards to check if they have pending permissions
   */
  protected getPermissionForTool = (
    toolCallId: string
  ): PermissionRequest | null => {
    return this.chatStore.getPermissionForTool(toolCallId);
  };

  protected formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  protected formatDateTime(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }
}
