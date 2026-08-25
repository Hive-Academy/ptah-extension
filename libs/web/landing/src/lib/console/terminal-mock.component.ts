import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * TerminalMockComponent — a coded session-log terminal (design spec §4 S2).
 *
 * 100% coded (no AI-simulated screenshot), fully legible at any size. Prompt
 * lines (`$ …`) render in the amber accent, output lines (`> …`) in muted ink.
 * A blinking cursor closes the log. Illustrative content → `role="img"` +
 * `aria-label`; the blink keyframe carries an explicit reduced-motion guard.
 */
@Component({
  selector: 'ptah-terminal-mock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="h-full w-full p-5 sm:p-6 overflow-hidden"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <div class="font-mono text-xs sm:text-sm leading-relaxed space-y-1">
        @for (line of lines(); track $index) {
          @if (line.startsWith('$')) {
            <p class="text-ink-100">
              <span class="text-amber-500">$</span>{{ stripPrefix(line) }}
            </p>
          } @else {
            <p class="text-ink-400">
              <span class="text-ink-500">></span>{{ stripPrefix(line) }}
            </p>
          }
        }
        <p class="text-ink-100" aria-hidden="true">
          <span class="text-amber-500">$</span
          ><span class="cursor ml-1">▍</span>
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .cursor {
        display: inline-block;
        animation: terminal-blink 1.1s step-end infinite;
      }
      @keyframes terminal-blink {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.15;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .cursor {
          animation: none;
        }
      }
    `,
  ],
})
export class TerminalMockComponent {
  /** Terminal log lines. `$ …` = prompt, everything else = output. */
  public readonly lines = input<string[]>([
    '$ new-agent-session --tool cursor',
    '> no context loaded. starting cold.',
    '$ ptah session --resume',
    '> loaded 1,425 memories.',
    '> continuing from yesterday\'s decision: "memory format → JSONB"',
  ]);

  /** Accessible description of the illustrative terminal. */
  public readonly ariaLabel = input<string>(
    "Terminal illustration: a cold agent session with no context, then a Ptah session resuming with 1,425 memories loaded and yesterday's decision restored.",
  );

  public stripPrefix(line: string): string {
    return line.slice(1);
  }
}
