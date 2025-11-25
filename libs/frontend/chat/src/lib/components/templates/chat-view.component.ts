import {
  Component,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { ChatInputComponent } from '../molecules/chat-input.component';
import { ChatStore } from '../../services/chat.store';

/**
 * ChatViewComponent - Main chat view with message list and welcome screen
 *
 * Complexity Level: 2 (Template with auto-scroll and mode selection)
 * Patterns: Signal-based state, Auto-scroll behavior, Composition
 *
 * Features:
 * - Scrollable message list with auto-scroll
 * - "Let's build" welcome screen with Vibe/Spec mode selection
 * - Mode selection state management
 *
 * SOLID Principles:
 * - Single Responsibility: Chat view display and mode selection
 * - Composition: Uses MessageBubble and ChatInput components
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

  // Welcome screen mode selection (Vibe/Spec)
  private readonly _selectedMode = signal<'vibe' | 'spec'>('vibe');
  readonly selectedMode = this._selectedMode.asReadonly();

  ngAfterViewChecked(): void {
    if (this.shouldAutoScroll) {
      this.scrollToBottom();
    }
  }

  selectMode(mode: 'vibe' | 'spec'): void {
    this._selectedMode.set(mode);
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
