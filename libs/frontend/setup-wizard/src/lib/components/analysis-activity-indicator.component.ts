import {
  ChangeDetectionStrategy,
  Component,
  input,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';

/**
 * AnalysisActivityIndicatorComponent - Rotating typewriter activity messages
 *
 * Displays analysis-specific rotating messages with a typewriter effect,
 * keeping the UI feeling alive during dead zones where no stream messages arrive.
 *
 * Modeled after StreamingQuotesComponent but with analysis-specific messages.
 */
@Component({
  selector: 'ptah-analysis-activity-indicator',
  standalone: true,
  template: `
    <div
      class="flex items-center gap-1.5 text-sm text-base-content/60 italic min-h-[1.5em]"
    >
      <span class="typewriter-text overflow-hidden whitespace-nowrap">{{
        displayedText()
      }}</span>
      <span class="typing-cursor">|</span>
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
        font-weight: 400;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisActivityIndicatorComponent implements OnInit, OnDestroy {
  /**
   * Optional context prefix for phase-aware messages.
   * E.g. "Phase 2" will produce "Phase 2: Reading architecture patterns..."
   */
  readonly context = input<string | undefined>(undefined);

  readonly displayedText = signal('');

  private readonly baseMessages = [
    'Scanning project structure...',
    'Reading configuration files...',
    'Analyzing dependencies...',
    'Detecting frameworks and libraries...',
    'Mapping code architecture...',
    'Evaluating code patterns...',
  ];

  private currentIndex = 0;
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

  private get messages(): string[] {
    const ctx = this.context();
    if (ctx) {
      return this.baseMessages.map((msg) => `${ctx}: ${msg}`);
    }
    return this.baseMessages;
  }

  private startTyping(): void {
    const typeSpeed = 45;
    const deleteSpeed = 25;
    const pauseDuration = 2000;

    this.typingInterval = setInterval(
      () => {
        const currentMessage = this.messages[this.currentIndex];

        if (!this.isDeleting) {
          if (this.currentCharIndex < currentMessage.length) {
            this.currentCharIndex++;
            this.displayedText.set(
              currentMessage.slice(0, this.currentCharIndex)
            );
          } else {
            // Finished typing — pause then delete
            if (this.typingInterval !== null) {
              clearInterval(this.typingInterval);
            }
            this.pauseTimeout = setTimeout(() => {
              this.isDeleting = true;
              this.startTyping();
            }, pauseDuration);
          }
        } else {
          if (this.currentCharIndex > 0) {
            this.currentCharIndex--;
            this.displayedText.set(
              currentMessage.slice(0, this.currentCharIndex)
            );
          } else {
            // Finished deleting — next message
            this.isDeleting = false;
            this.currentIndex = (this.currentIndex + 1) % this.messages.length;
          }
        }
      },
      this.isDeleting ? deleteSpeed : typeSpeed
    );
  }
}
