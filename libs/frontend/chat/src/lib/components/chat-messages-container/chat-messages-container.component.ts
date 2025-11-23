import { Component, input, output } from '@angular/core';
import { ChatMessagesListComponent } from '../chat-messages-list/chat-messages-list.component';
import { ChatEmptyStateComponent } from '../chat-empty-state/chat-empty-state.component';
import type { SessionId } from '@ptah-extension/shared';
import type { ProcessedClaudeMessage } from '@ptah-extension/core';

/**
 * ChatMessagesContainerComponent - Unified Message Display Orchestrator
 *
 * **Responsibility**: Orchestrates between message list and empty state display
 * **Pattern**: Pure presentation orchestrator using Angular 20 signals
 * **Change Detection**: OnPush for optimal performance
 *
 * **Migration Notes**:
 * - Migrated from: apps/ptah-extension-webview/src/app/features/chat/components/chat-messages-container.component.ts
 * - Modernized with signal-based APIs (input(), output())
 * - Removed legacy message display (useEnhancedDisplay flag removed)
 * - Simplified to single message list component (ChatMessagesListComponent)
 * - All modern control flow (@if/@else) already present
 * - OnPush change detection enforced
 * - Selector: vscode-chat-messages-container → ptah-chat-messages-container
 *
 * @example
 * ```html
 * <ptah-chat-messages-container
 *   [hasMessages]="hasMessages()"
 *   [messages]="messages()"
 *   [sessionId]="sessionId()"
 *   [isLoading]="isLoading()"
 *   (messageClicked)="onMessageClick($event)"
 *   (fileClicked)="onFileClick($event)"
 *   (quickHelp)="onQuickHelp()"
 *   (orchestration)="onOrchestration()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-chat-messages-container',
  standalone: true,

  imports: [ChatMessagesListComponent, ChatEmptyStateComponent],
  template: `
    @if (hasMessages()) {
    <!-- Message List Display -->
    <ptah-chat-messages-list
      [messages]="messages()"
      [sessionId]="sessionId()"
      [loading]="loading()"
      [autoScroll]="autoScroll()"
      [showGroupHeaders]="showGroupHeaders()"
      [showMessageActions]="showMessageActions()"
      [enableImagePreviews]="enableImagePreviews()"
      (messageClicked)="messageClicked.emit($event)"
      (fileClicked)="fileClicked.emit($event)"
      (toolActionRequested)="toolActionRequested.emit($event)"
      (messageActioned)="messageActioned.emit($event)"
      (scrolledToTop)="scrolledToTop.emit()"
    />
    } @else {
    <!-- Empty State -->
    <ptah-chat-empty-state
      (quickHelp)="quickHelp.emit()"
      (orchestration)="orchestration.emit()"
    />
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
        background-color: var(--vscode-editor-background);
      }

      ptah-chat-messages-list,
      ptah-chat-empty-state {
        flex: 1;
        min-height: 0;
      }
    `,
  ],
})
export class ChatMessagesContainerComponent {
  // State inputs
  readonly hasMessages = input<boolean>(false);
  readonly messages = input<readonly ProcessedClaudeMessage[]>([]);
  readonly sessionId = input<SessionId | null>(null);
  readonly loading = input<boolean>(false);

  // Display configuration inputs
  readonly autoScroll = input<boolean>(true);
  readonly showGroupHeaders = input<boolean>(true);
  readonly showMessageActions = input<boolean>(true);
  readonly enableImagePreviews = input<boolean>(true);

  // Message interaction outputs
  readonly messageClicked = output<ProcessedClaudeMessage>();
  readonly fileClicked = output<string>();
  readonly toolActionRequested = output<{
    readonly tool: string;
    readonly action: string;
    readonly data?: unknown;
  }>();
  readonly messageActioned = output<{
    readonly action: string;
    readonly message: ProcessedClaudeMessage;
  }>();
  readonly scrolledToTop = output<void>();

  // Empty state outputs
  readonly quickHelp = output<void>();
  readonly orchestration = output<void>();
}
