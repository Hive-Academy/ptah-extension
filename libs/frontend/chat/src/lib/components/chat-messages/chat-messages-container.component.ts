/**
 * Chat Messages Container Component
 *
 * Orchestrator component that manages message display:
 * - Shows ChatMessagesListComponent when messages exist
 * - Shows ChatEmptyStateComponent when no messages
 * - Delegates all message interactions to child components
 *
 * ARCHITECTURE:
 * - Level 3 component (orchestrator - coordinates Level 2 and Level 0)
 * - Modern Angular 20 patterns (input/output signals)
 * - OnPush change detection for performance
 * - NO dual-version logic (modern only)
 *
 * DEPENDENCIES:
 * - ChatMessagesListComponent (Level 2) ✅
 * - ChatEmptyStateComponent (Level 0) ✅
 */

import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ChatMessagesListComponent } from './components/chat-messages-list/chat-messages-list.component';
import { ChatEmptyStateComponent } from '../chat-empty-state/chat-empty-state.component';
import { type ProcessedClaudeMessage } from '@ptah-extension/core';

/**
 * Chat Messages Container - Orchestrator Component
 *
 * Manages the display of messages or empty state based on message availability.
 * All message interaction logic is delegated to ChatMessagesListComponent.
 */
@Component({
  selector: 'ptah-chat-messages-container',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatMessagesListComponent, ChatEmptyStateComponent],
  template: `
    @if (hasMessages()) {
    <ptah-chat-messages-list
      [messages]="messages()"
      [autoScroll]="autoScroll()"
      (messageClicked)="messageClicked.emit($event)"
      (fileClicked)="fileClicked.emit($event)"
      (toolActionRequested)="toolActionRequested.emit($event)"
      (messageActioned)="messageActioned.emit($event)"
      (scrolledToTop)="scrolledToTop.emit()"
    />
    } @else {
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
  // === ANGULAR 20 PATTERN: Modern input signals ===
  readonly messages = input<readonly ProcessedClaudeMessage[]>([]);
  readonly autoScroll = input(true);

  // === ANGULAR 20 PATTERN: Computed signal for derived state ===
  readonly hasMessages = computed(() => this.messages().length > 0);

  // === ANGULAR 20 PATTERN: Modern output signals ===
  // Message list events (delegated from ChatMessagesListComponent)
  readonly messageClicked = output<ProcessedClaudeMessage>();
  readonly fileClicked = output<string>();
  readonly toolActionRequested = output<{
    tool: string;
    action: string;
    data?: unknown;
  }>();
  readonly messageActioned = output<{
    action: string;
    message: ProcessedClaudeMessage;
  }>();
  readonly scrolledToTop = output<void>();

  // Empty state events (delegated from ChatEmptyStateComponent)
  readonly quickHelp = output<void>();
  readonly orchestration = output<void>();
}
