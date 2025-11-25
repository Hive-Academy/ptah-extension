import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ChatViewComponent } from './chat-view.component';
import { ChatStore } from '../../services/chat.store';

/**
 * AppShellComponent - Main application layout with sidebar
 *
 * Complexity Level: 2 (Template with DaisyUI drawer)
 * Patterns: DaisyUI drawer pattern, Session list
 *
 * Uses DaisyUI drawer for responsive sidebar (always visible on desktop,
 * hamburger menu on mobile).
 *
 * Displays session list in sidebar with active session highlighting.
 */
@Component({
  selector: 'ptah-app-shell',
  standalone: true,
  imports: [ChatViewComponent, DatePipe],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  readonly chatStore = inject(ChatStore);
}
