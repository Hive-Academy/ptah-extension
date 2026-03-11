import {
  Component,
  ChangeDetectionStrategy,
  signal,
  OnInit,
  OnDestroy,
} from '@angular/core';

/**
 * StreamingQuotesComponent - Displays rotating quotes with typeahead animation
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: CSS typewriter animation, Signal-based state, OnPush change detection
 *
 * Shows inspirational quotes with a typewriter effect that cycles through different quotes.
 */
@Component({
  selector: 'ptah-streaming-quotes',
  standalone: true,
  template: `
    <div class="flex items-center gap-1.5 text-xs text-base-content/50 italic">
      <span class="opacity-60">"</span>
      <span class="typewriter-text overflow-hidden whitespace-nowrap">{{
        displayedText()
      }}</span>
      <span class="typing-cursor">|</span>
      <span class="opacity-60">"</span>
    </div>
  `,
  styles: [
    `
      @keyframes blink {
        0%,
        49% {
          opacity: 1;
        }
        50%,
        100% {
          opacity: 0;
        }
      }

      .typing-cursor {
        animation: blink 0.7s step-end infinite;
        font-weight: 300;
        color: oklch(var(--bc) / 0.4);
      }

      .typewriter-text {
        max-width: 200px;
        font-weight: 400;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamingQuotesComponent implements OnInit, OnDestroy {
  private readonly quotes = [
    'Let me think about this...',
    'Analyzing the patterns...',
    'Building something great...',
    'Crafting the solution...',
    'Almost there...',
    'Making it perfect...',
  ];

  readonly displayedText = signal('');

  private currentQuoteIndex = 0;
  private currentCharIndex = 0;
  private isDeleting = false;
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private pauseTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.startTyping();
  }

  ngOnDestroy(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
    }
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
    }
  }

  private startTyping(): void {
    const typeSpeed = 50; // ms per character when typing
    const deleteSpeed = 30; // ms per character when deleting
    const pauseDuration = 2000; // pause before deleting

    this.typingInterval = setInterval(
      () => {
        const currentQuote = this.quotes[this.currentQuoteIndex];

        if (!this.isDeleting) {
          // Typing phase
          if (this.currentCharIndex < currentQuote.length) {
            this.currentCharIndex++;
            this.displayedText.set(
              currentQuote.slice(0, this.currentCharIndex)
            );
          } else {
            // Finished typing, pause then start deleting
            if (this.typingInterval !== null) {
              clearInterval(this.typingInterval);
            }
            this.pauseTimeout = setTimeout(() => {
              this.isDeleting = true;
              this.startTyping();
            }, pauseDuration);
          }
        } else {
          // Deleting phase
          if (this.currentCharIndex > 0) {
            this.currentCharIndex--;
            this.displayedText.set(
              currentQuote.slice(0, this.currentCharIndex)
            );
          } else {
            // Finished deleting, move to next quote
            this.isDeleting = false;
            this.currentQuoteIndex =
              (this.currentQuoteIndex + 1) % this.quotes.length;
          }
        }
      },
      this.isDeleting ? deleteSpeed : typeSpeed
    );
  }
}
