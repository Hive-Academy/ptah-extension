import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import { LucideAngularModule, Zap, CheckCircle, Circle } from 'lucide-angular';
import type { SessionStatus } from '@ptah-extension/chat-types';

/**
 * CompactSessionHeaderComponent - Title bar for the compact session card.
 *
 * Shows session title and a status indicator (streaming, complete, draft).
 *
 * Complexity Level: 1 (Atom-level presentational)
 * Patterns: Signal inputs, OnPush, DaisyUI styling
 */
@Component({
  selector: 'ptah-compact-session-header',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div
      class="flex items-center gap-2 px-3 py-2 border-b border-base-content/10"
    >
      <!-- Status dot -->
      <span
        class="flex-shrink-0 w-2 h-2 rounded-full"
        [class.bg-primary]="isStreaming()"
        [class.animate-pulse]="isStreaming()"
        [class.bg-success]="isComplete()"
        [class.bg-base-content/30]="isDraft()"
      ></span>

      <!-- Session title -->
      <span
        class="flex-1 min-w-0 truncate text-sm font-medium"
        [title]="title()"
      >
        {{ title() || 'New Chat' }}
      </span>

      <!-- Status label -->
      @if (isStreaming()) {
        <span
          class="inline-flex items-center gap-1 text-[10px] text-primary font-medium"
        >
          <span class="loading loading-spinner loading-xs"></span>
          Streaming
        </span>
      } @else if (isComplete()) {
        <span
          class="inline-flex items-center gap-1 text-[10px] text-success/70"
        >
          <lucide-angular [img]="CheckCircleIcon" class="w-3 h-3" />
          Complete
        </span>
      } @else {
        <span
          class="inline-flex items-center gap-1 text-[10px] text-base-content/40"
        >
          <lucide-angular [img]="CircleIcon" class="w-3 h-3" />
          Draft
        </span>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionHeaderComponent {
  readonly title = input.required<string>();
  readonly status = input.required<SessionStatus>();

  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly CircleIcon = Circle;

  readonly isStreaming = computed(() => {
    const s = this.status();
    return s === 'streaming' || s === 'resuming';
  });

  readonly isComplete = computed(() => this.status() === 'loaded');
  readonly isDraft = computed(() => {
    const s = this.status();
    return s === 'fresh' || s === 'draft';
  });
}
