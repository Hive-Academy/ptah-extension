import {
  Component,
  input,
  signal,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { TypewriterService } from '../../services/typewriter.service';
import { TypingCursorComponent } from './typing-cursor.component';

/**
 * StreamingTextComponent - Display text with typewriter effect and blinking cursor
 *
 * Complexity Level: 1 (Simple atom with lifecycle)
 * Patterns: RxJS subscription, composition with TypingCursorComponent
 *
 * Features:
 * - Character-by-character reveal when animate=true
 * - Immediate full text display when animate=false
 * - Blinking cursor at end of text
 * - Proper subscription cleanup
 */
@Component({
  selector: 'ptah-streaming-text',
  standalone: true,
  imports: [TypingCursorComponent],
  template: `
    <span class="streaming-text">
      {{ displayText() }}<ptah-typing-cursor [colorClass]="cursorColor()" />
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamingTextComponent implements OnInit, OnDestroy {
  private readonly typewriterService = inject(TypewriterService);
  private subscription?: Subscription;

  /** The full text to display with typewriter effect */
  readonly text = input.required<string>();

  /** Speed in ms per character (default: 50ms) */
  readonly speed = input<number>(50);

  /** Whether to show typewriter effect or display full text immediately */
  readonly animate = input<boolean>(true);

  /** Cursor color class */
  readonly cursorColor = input<string>('text-info');

  /** Currently displayed text (progressive reveal) */
  readonly displayText = signal<string>('');

  ngOnInit() {
    if (this.animate()) {
      this.startTypewriter();
    } else {
      this.displayText.set(this.text());
    }
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }

  private startTypewriter() {
    const fullText = this.text();
    this.subscription = this.typewriterService
      .type({ word: fullText, speed: this.speed() })
      .subscribe((partialText) => {
        this.displayText.set(partialText);
      });
  }
}
