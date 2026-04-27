import {
  Component,
  input,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  effect,
} from '@angular/core';
import { TypingCursorComponent } from './typing-cursor.component';

/**
 * StreamingTextRevealComponent - Progressive character-by-character text reveal
 *
 * Complexity Level: 2 (Atom with lifecycle and effects)
 * Patterns: Signal-based state, interval animation, effect for input changes
 *
 * This component creates a true typewriter effect for streaming text:
 * - Characters are revealed one at a time at a configurable speed
 * - When new content arrives (delta), reveal continues from current position
 * - When streaming completes, remaining content is shown immediately
 * - Proper cleanup of intervals on destroy
 *
 * Key Features:
 * - Progressive reveal: Characters appear one-by-one, not in bulk chunks
 * - Smooth streaming: Handles content growing while reveal is in progress
 * - Immediate completion: Shows all text when streaming stops
 * - Configurable speed: Default 20ms per character (50 chars/second)
 *
 * @example
 * ```html
 * <ptah-streaming-text-reveal
 *   [content]="node().content || ''"
 *   [isStreaming]="isStreaming()"
 *   [revealSpeed]="15"
 * />
 * ```
 */
@Component({
  selector: 'ptah-streaming-text-reveal',
  standalone: true,
  imports: [TypingCursorComponent],
  template: `
    <span class="streaming-text-reveal">
      <span class="whitespace-pre-wrap">{{ revealedText() }}</span>
      @if (showCursor()) {
        <ptah-typing-cursor [colorClass]="cursorColor()" />
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline;
      }
      .streaming-text-reveal {
        display: inline;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamingTextRevealComponent implements OnInit, OnDestroy {
  /** Full accumulated content to reveal */
  readonly content = input.required<string>();

  /** Whether more content may arrive (streaming active) */
  readonly isStreaming = input<boolean>(true);

  /** Milliseconds per character reveal (default: 20ms = 50 chars/sec) */
  readonly revealSpeed = input<number>(20);

  /** Cursor color class */
  readonly cursorColor = input<string>('text-neutral-content/70');

  // Internal state: how many characters have been revealed
  private readonly revealedLength = signal(0);
  private revealInterval: ReturnType<typeof setInterval> | null = null;

  /** Currently revealed portion of the text */
  readonly revealedText = computed(() => {
    const content = this.content();
    const length = this.revealedLength();
    return content.substring(0, length);
  });

  /** Whether we're still revealing (not caught up to content) */
  readonly isRevealing = computed(
    () => this.revealedLength() < this.content().length,
  );

  /** Show cursor when streaming or actively revealing */
  readonly showCursor = computed(
    () => this.isStreaming() || this.isRevealing(),
  );

  constructor() {
    // Effect to handle streaming state changes
    effect(() => {
      const streaming = this.isStreaming();
      const content = this.content();

      if (!streaming) {
        // Streaming stopped - show all content immediately
        this.stopReveal();
        this.revealedLength.set(content.length);
      } else if (this.isRevealing() && !this.revealInterval) {
        // New content arrived and we're not revealing - start reveal
        this.startReveal();
      }
    });
  }

  ngOnInit(): void {
    // Start reveal animation if there's content
    if (this.content().length > 0 && this.isStreaming()) {
      this.startReveal();
    } else if (!this.isStreaming()) {
      // Not streaming - show all content immediately
      this.revealedLength.set(this.content().length);
    }
  }

  ngOnDestroy(): void {
    this.stopReveal();
  }

  private startReveal(): void {
    if (this.revealInterval) return;

    this.revealInterval = setInterval(() => {
      const current = this.revealedLength();
      const total = this.content().length;

      if (current < total) {
        // Reveal next character
        this.revealedLength.set(current + 1);
      } else if (!this.isStreaming()) {
        // Caught up and streaming is done - stop interval
        this.stopReveal();
      }
      // If streaming but caught up, keep interval alive to catch new content
    }, this.revealSpeed());
  }

  private stopReveal(): void {
    if (this.revealInterval) {
      clearInterval(this.revealInterval);
      this.revealInterval = null;
    }
  }
}
