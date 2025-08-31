import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { VSCodeChatMessagesListComponent } from './chat-messages-list.component';
import { EnhancedChatMessagesListComponent } from './enhanced-chat-messages-list.component';
import { VSCodeChatEmptyStateComponent } from './chat-empty-state.component';
import { ProcessedClaudeMessage } from '@ptah-extension/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  agent?: string;
}

/**
 * Chat Messages Container - Unified Message Display Logic
 * Handles the choice between enhanced and legacy message display
 * Encapsulates dual message system complexity
 */
@Component({
  selector: 'vscode-chat-messages-container',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    VSCodeChatMessagesListComponent,
    EnhancedChatMessagesListComponent,
    VSCodeChatEmptyStateComponent,
  ],
  template: `
    @if (hasAnyMessages) {
      <!-- Enhanced Claude CLI Messages (preferred for rich content) -->
      @if (useEnhancedDisplay) {
        <app-enhanced-chat-messages-list
          [messages]="enhancedMessages"
          [sessionId]="sessionId"
          [loading]="isLoading"
          [autoScroll]="true"
          [showGroupHeaders]="true"
          [showMessageActions]="true"
          [enableImagePreviews]="true"
          (messageClicked)="enhancedMessageClicked.emit($event)"
          (fileClicked)="fileClicked.emit($event)"
          (toolActionRequested)="toolActionRequested.emit($event)"
          (messageActioned)="messageActioned.emit($event)"
          (scrolledToTop)="scrolledToTop.emit()"
        >
        </app-enhanced-chat-messages-list>
      } @else {
        <!-- Legacy message display for compatibility -->
        <vscode-chat-messages-list
          [messages]="legacyMessages"
          [isLoading]="isLoading"
          [autoScroll]="true"
          (messageClick)="legacyMessageClicked.emit($event)"
        >
        </vscode-chat-messages-list>
      }
    } @else {
      <!-- Empty State Content -->
      <vscode-chat-empty-state
        (quickHelp)="quickHelp.emit()"
        (orchestration)="orchestration.emit()"
      >
      </vscode-chat-empty-state>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      vscode-chat-messages-list,
      app-enhanced-chat-messages-list,
      vscode-chat-empty-state {
        flex: 1;
        min-height: 0;
      }
    `,
  ],
})
export class VSCodeChatMessagesContainerComponent {
  @Input() hasAnyMessages = false;
  @Input() useEnhancedDisplay = false;
  @Input() enhancedMessages: ProcessedClaudeMessage[] = [];
  @Input() legacyMessages: ChatMessage[] = [];
  @Input() sessionId: string | null = null;
  @Input() isLoading = false;

  // Enhanced message events
  @Output() enhancedMessageClicked = new EventEmitter<ProcessedClaudeMessage>();
  @Output() fileClicked = new EventEmitter<string>();
  @Output() toolActionRequested = new EventEmitter<{ tool: string; action: string; data?: any }>();
  @Output() messageActioned = new EventEmitter<{
    action: string;
    message: ProcessedClaudeMessage;
  }>();
  @Output() scrolledToTop = new EventEmitter<void>();

  // Legacy message events
  @Output() legacyMessageClicked = new EventEmitter<ChatMessage>();

  // Empty state events
  @Output() quickHelp = new EventEmitter<void>();
  @Output() orchestration = new EventEmitter<void>();
}
