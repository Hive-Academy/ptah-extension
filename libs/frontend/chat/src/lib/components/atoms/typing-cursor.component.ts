import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * TypingCursorComponent - Animated blinking cursor for streaming text
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: CSS keyframe animation, OnPush change detection
 *
 * Displays a blinking cursor (▌) at the end of streaming text.
 * Uses CSS animation for 60fps performance.
 */
@Component({
  selector: 'ptah-typing-cursor',
  standalone: true,
  template: `
    <span [class]="'typing-cursor inline-block ml-0.5 ' + colorClass()">▌</span>
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
        animation: blink 1s step-end infinite;
        font-weight: 400;
        line-height: 1;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TypingCursorComponent {
  /** Color class for cursor (default: inherit from parent) */
  readonly colorClass = input<string>('text-current');
}
