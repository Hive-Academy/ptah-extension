import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import {
  LucideAngularModule,
  User,
  FileText,
  Image,
  Folder,
  Paperclip,
} from 'lucide-angular';
import { ExecutionNodeComponent } from './execution-node.component';
import { TypingCursorComponent } from '../atoms/typing-cursor.component';
import { StreamingQuotesComponent } from '../atoms/streaming-quotes.component';
import { CopyButtonComponent } from '../atoms/copy-button.component';
import { TokenBadgeComponent } from '../atoms/token-badge.component';
import { CostBadgeComponent } from '../atoms/cost-badge.component';
import { DurationBadgeComponent } from '../atoms/duration-badge.component';
import type {
  ExecutionChatMessage,
  PermissionRequest,
  PermissionResponse,
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
    StreamingQuotesComponent,
    CopyButtonComponent,
    TokenBadgeComponent,
    CostBadgeComponent,
    DurationBadgeComponent,
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
  readonly UserIcon = User;
  readonly FileTextIcon = FileText;
  readonly ImageIcon = Image;
  readonly FolderIcon = Folder;
  readonly PaperclipIcon = Paperclip;
  readonly ptahIconUri = this.vscode.getPtahIconUri();
  readonly ptahUserIconUri = this.vscode.getPtahUserIconUri();

  /**
   * User message display content with <system-reminder> tags stripped.
   * The backend wraps attachment instructions in <system-reminder> XML
   * so the frontend can hide them from the user bubble while keeping
   * them visible to the LLM. Matches the stripping pattern used in
   * CodeOutputComponent and ToolInputDisplayComponent.
   */
  readonly userDisplayContent = computed(() => {
    const raw = this.message().rawContent || '';
    return raw
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  });

  /**
   * Permission lookup function to pass to execution tree
   * Enables tool cards to check if they have pending permissions
   */
  protected getPermissionForTool = (
    toolCallId: string
  ): PermissionRequest | null => {
    return this.chatStore.getPermissionForTool(toolCallId);
  };

  /**
   * Handle permission response from execution tree
   * Delegates to ChatStore for state management
   */
  protected onPermissionResponse(response: PermissionResponse): void {
    this.chatStore.handlePermissionResponse(response);
  }

  // TASK_2025_109: onResumeRequested removed - now uses context injection

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

  /**
   * Extract file name from a full path
   */
  protected getFileName(filePath: string): string {
    // Handle both Windows and Unix paths
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
  }

  /**
   * Determine the appropriate icon for a file based on its extension
   * Returns the icon reference for lucide-angular
   */
  protected getFileIcon(
    filePath: string
  ): typeof FileText | typeof Image | typeof Folder {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const imageExts = [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'svg',
      'webp',
      'bmp',
      'ico',
    ];
    const isDirectory =
      !filePath.includes('.') ||
      filePath.endsWith('/') ||
      filePath.endsWith('\\');

    if (isDirectory) return Folder;
    if (imageExts.includes(ext)) return Image;
    return FileText;
  }

  /**
   * Check if the file path represents a folder
   */
  protected isFolder(filePath: string): boolean {
    return (
      !filePath.includes('.') ||
      filePath.endsWith('/') ||
      filePath.endsWith('\\')
    );
  }
}
