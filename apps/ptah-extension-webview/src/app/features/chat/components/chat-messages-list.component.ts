import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
  AfterViewChecked,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, UserIcon, BotIcon } from 'lucide-angular';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  isStreaming?: boolean;
  agent?: string;
  files?: readonly string[];
  isError?: boolean;
}

/**
 * VS Code Chat Messages List - Pure Presentation Component
 * - Displays conversation messages with proper formatting
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 * - Accessible message list with proper ARIA roles
 * - Auto-scrolling support
 */
@Component({
  selector: 'vscode-chat-messages-list',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],

  template: `
    <main class="vscode-messages-container" #messagesContainer>
      @if (isLoading) {
        <!-- Loading State -->
        <div class="vscode-loading-container">
          <div class="vscode-loading-spinner"></div>
          <p class="vscode-loading-text">Initializing Claude...</p>
        </div>
      } @else if (messages.length === 0) {
        <!-- Empty State -->
        <div class="vscode-empty-container">
          <ng-content></ng-content>
        </div>
      } @else {
        <!-- Messages List -->
        <div
          class="vscode-messages-list"
          role="log"
          aria-label="Chat conversation"
          aria-live="polite"
        >
          @for (message of messages; track message.id) {
            <div
              class="vscode-message"
              [class.vscode-message-user]="message.role === 'user'"
              [class.vscode-message-assistant]="message.role === 'assistant'"
              [class.vscode-message-streaming]="message.isStreaming"
              role="article"
              [attr.aria-label]="getMessageAriaLabel(message)"
            >
              <!-- Message Header -->
              <div class="vscode-message-header">
                <div class="vscode-message-avatar">
                  @if (message.role === 'user') {
                    <lucide-angular [img]="UserIcon" class="vscode-avatar-icon"></lucide-angular>
                  } @else {
                    <lucide-angular [img]="BotIcon" class="vscode-avatar-icon"></lucide-angular>
                  }
                </div>
                <div class="vscode-message-meta">
                  <span class="vscode-message-role">
                    {{ message.role === 'user' ? 'You' : message.agent || 'Claude' }}
                  </span>
                  @if (message.timestamp) {
                    <span class="vscode-message-time">
                      {{ formatTimestamp(message.timestamp) }}
                    </span>
                  }
                </div>
              </div>

              <!-- Message Content -->
              <div class="vscode-message-content">
                <div
                  class="vscode-message-text"
                  [class.vscode-message-error]="message.isError"
                  [innerHTML]="formatMessageContent(message.content)"
                ></div>

                <!-- File Attachments -->
                @if (message.files && message.files.length > 0) {
                  <div class="vscode-message-attachments">
                    @for (file of message.files; track file) {
                      <div class="vscode-attachment" [attr.data-file-path]="file">
                        @if (isImageFile(file)) {
                          <div class="vscode-attachment-image">
                            <img
                              [src]="getImagePath(file)"
                              [alt]="getFileName(file)"
                              class="vscode-image-preview"
                              (error)="onImageError($event)"
                              loading="lazy"
                            />
                            <div class="vscode-image-caption">{{ getFileName(file) }}</div>
                          </div>
                        } @else {
                          <div class="vscode-attachment-file">
                            <div class="vscode-file-icon">📄</div>
                            <div class="vscode-file-info">
                              <div class="vscode-file-name">{{ getFileName(file) }}</div>
                              <div class="vscode-file-path">{{ file }}</div>
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }

                @if (message.isStreaming) {
                  <div class="vscode-streaming-indicator">
                    <span class="vscode-streaming-dot"></span>
                    <span class="vscode-streaming-dot"></span>
                    <span class="vscode-streaming-dot"></span>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }
    </main>
  `,
  styles: [
    `
      .vscode-messages-container {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 16px;
        min-height: 0;
        max-height: 100%;
        background-color: var(--vscode-editor-background);
        box-sizing: border-box;
      }

      .vscode-loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 16px;
      }

      .vscode-loading-spinner {
        width: 32px;
        height: 32px;
        border: 2px solid var(--vscode-progressBar-background);
        border-top: 2px solid var(--vscode-button-background);
        border-radius: 50%;
        animation: vscode-spin 1s linear infinite;
      }

      @keyframes vscode-spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .vscode-loading-text {
        margin: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }

      .vscode-empty-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .vscode-messages-list {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 100%;
        width: 100%;
        box-sizing: border-box;
      }

      .vscode-message {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 4px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        position: relative;
        width: 100%;
        box-sizing: border-box;
        flex-shrink: 0;
        min-height: fit-content;
      }

      .vscode-message-user {
        background-color: var(--vscode-textBlockQuote-background);
        border-left: 4px solid var(--vscode-button-background);
      }

      .vscode-message-assistant {
        background-color: var(--vscode-input-background);
        border-left: 4px solid var(--vscode-button-secondaryBackground);
      }

      .vscode-message-streaming {
        animation: vscode-message-pulse 1.5s ease-in-out infinite;
      }

      @keyframes vscode-message-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.8;
        }
      }

      .vscode-message-header {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .vscode-message-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: var(--vscode-button-secondaryBackground);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .vscode-message-user .vscode-message-avatar {
        background-color: var(--vscode-button-background);
      }

      .vscode-avatar-icon {
        width: 14px;
        height: auto;
        display: flex;
        color: var(--vscode-button-foreground);
      }

      .vscode-message-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .vscode-message-role {
        font-size: 12px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .vscode-message-time {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }

      .vscode-message-content {
        padding-left: 32px;
        position: relative;
      }

      .vscode-message-text {
        color: var(--vscode-foreground);
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .vscode-message-error {
        background-color: var(--vscode-inputValidation-errorBackground);
        border-left: 3px solid var(--vscode-inputValidation-errorBorder);
        padding: 8px;
        border-radius: 4px;
        margin-top: 4px;
        color: var(--vscode-inputValidation-errorForeground);
      }

      .vscode-message-attachments {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .vscode-attachment {
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        overflow: hidden;
        background-color: var(--vscode-input-background);
      }

      .vscode-attachment-image {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px;
      }

      .vscode-image-preview {
        max-width: 100%;
        max-height: 300px;
        width: auto;
        height: auto;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .vscode-image-caption {
        margin-top: 4px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
      }

      .vscode-attachment-file {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        gap: 8px;
      }

      .vscode-file-icon {
        font-size: 16px;
        opacity: 0.7;
      }

      .vscode-file-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .vscode-file-name {
        font-size: 12px;
        font-weight: 500;
        color: var(--vscode-foreground);
      }

      .vscode-file-path {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family, 'Monaco', 'Courier New', monospace);
      }

      .vscode-streaming-indicator {
        display: flex;
        gap: 4px;
        margin-top: 8px;
        align-items: center;
      }

      .vscode-streaming-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: var(--vscode-button-background);
        animation: vscode-dot-bounce 1.4s ease-in-out infinite;
      }

      .vscode-streaming-dot:nth-child(2) {
        animation-delay: 0.2s;
      }

      .vscode-streaming-dot:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes vscode-dot-bounce {
        0%,
        80%,
        100% {
          transform: scale(0.8);
          opacity: 0.5;
        }
        40% {
          transform: scale(1);
          opacity: 1;
        }
      }

      /* Scrollbar styling for better UX */
      .vscode-messages-container::-webkit-scrollbar {
        width: 8px;
      }

      .vscode-messages-container::-webkit-scrollbar-track {
        background: var(--vscode-scrollbar-shadow);
      }

      .vscode-messages-container::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 4px;
      }

      .vscode-messages-container::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-hoverBackground);
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-message {
          border-width: 2px;
        }

        .vscode-message-avatar {
          border: 1px solid var(--vscode-contrastBorder);
        }
      }

      /* Reduced Motion */
      @media (prefers-reduced-motion: reduce) {
        .vscode-loading-spinner,
        .vscode-message-streaming,
        .vscode-streaming-dot {
          animation: none;
        }
      }

    `,
  ],
})
export class VSCodeChatMessagesListComponent implements AfterViewChecked, OnChanges {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLElement>;

  @Input() messages: ChatMessage[] = [];
  @Input() isLoading: boolean = false;
  @Input() autoScroll: boolean = true;

  @Output() messageClick = new EventEmitter<ChatMessage>();

  readonly UserIcon = UserIcon;
  readonly BotIcon = BotIcon;

  private shouldScrollToBottom = false;
  private previousMessageCount = 0;

  ngOnChanges(changes: SimpleChanges): void {
    // Auto-scroll when new messages are added
    if (changes['messages'] && this.messages.length > this.previousMessageCount) {
      this.markForAutoScroll();
      this.previousMessageCount = this.messages.length;
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom && this.autoScroll) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  scrollToBottom(): void {
    if (this.messagesContainer) {
      const element = this.messagesContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  markForAutoScroll(): void {
    this.shouldScrollToBottom = true;
  }

  formatTimestamp(timestamp: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return timestamp.toLocaleDateString();
  }

  formatMessageContent(content: string): string {
    if (!content) return '';

    // Basic HTML escaping and simple formatting
    let formatted = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');

    // Simple markdown-like formatting
    formatted = formatted
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
      .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
      .replace(/`([^`]+)`/g, '<code>$1</code>'); // Inline code

    return formatted;
  }

  /**
   * Check if file is an image based on extension
   */
  isImageFile(filePath: string): boolean {
    if (!filePath) return false;

    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'];
    const extension = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
    return imageExtensions.includes(extension);
  }

  /**
   * Get image path for display
   */
  getImagePath(filePath: string): string {
    if (!filePath) return '';

    // Convert Windows paths to VSCode webview compatible paths
    if (filePath.includes(':\\') || filePath.includes(':/')) {
      // For Windows paths like d:/projects/Ptah/docs/screenshots/image.png
      // Convert to vscode-file:// protocol if available
      // For now, try to use the file path directly with file:// protocol
      return `file://${filePath.replace(/\\/g, '/')}`;
    }

    return filePath;
  }

  /**
   * Extract filename from full path
   */
  getFileName(filePath: string): string {
    if (!filePath) return '';

    const path = filePath.replace(/\\/g, '/');
    return path.substring(path.lastIndexOf('/') + 1);
  }

  /**
   * Handle image loading errors
   */
  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    const attachment = img.closest('.vscode-attachment');
    const filePath = attachment?.getAttribute('data-file-path');

    console.warn('Failed to load image:', filePath);

    // Replace with error indicator
    img.style.display = 'none';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'vscode-image-error';
    errorDiv.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--vscode-errorForeground); background-color: var(--vscode-inputValidation-errorBackground); border-radius: 4px;">
        <div style="font-size: 24px; margin-bottom: 8px;">🖼️</div>
        <div>Image could not be loaded</div>
        <div style="font-size: 10px; margin-top: 4px; opacity: 0.7;">${this.getFileName(filePath || '')}</div>
      </div>
    `;

    img.parentNode?.insertBefore(errorDiv, img);
  }

  getMessageAriaLabel(message: ChatMessage): string {
    const role = message.role === 'user' ? 'You' : message.agent || 'Claude';
    const time = message.timestamp ? this.formatTimestamp(message.timestamp) : '';
    return `Message from ${role} ${time}`;
  }
}
