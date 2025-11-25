import {
  Component,
  inject,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { ChatInputComponent } from '../molecules/chat-input.component';
import { ChatStore } from '../../services/chat.store';

/**
 * ChatViewComponent - Main chat view with message list
 *
 * Complexity Level: 2 (Template with auto-scroll)
 * Patterns: Signal-based state, Auto-scroll behavior
 *
 * Displays scrollable message list with empty state.
 * Auto-scrolls to bottom when new messages arrive.
 *
 * Note: Input area not included yet (will be added in integration phase).
 */
@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  imports: [MessageBubbleComponent, ChatInputComponent],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatViewComponent implements AfterViewChecked {
  readonly chatStore = inject(ChatStore);

  @ViewChild('messageContainer') messageContainer?: ElementRef;

  private shouldAutoScroll = true;

  ngAfterViewChecked(): void {
    if (this.shouldAutoScroll) {
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    if (!this.messageContainer) return;

    const container = this.messageContainer.nativeElement;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }
}
