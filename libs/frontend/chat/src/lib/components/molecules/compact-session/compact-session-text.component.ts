import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import type { StreamingState } from '../../../services/chat.types';

/**
 * CompactSessionTextComponent - Shows the latest assistant text output (truncated).
 *
 * Reads text accumulators from streaming state and shows the most recent text chunk.
 * Falls back to the last message content for non-streaming sessions.
 *
 * Complexity Level: 1 (Atom-level presentational)
 * Patterns: Signal inputs, computed signals, OnPush
 */
@Component({
  selector: 'ptah-compact-session-text',
  standalone: true,
  template: `
    @if (displayText()) {
      <div class="px-3 py-1.5 border-b border-base-content/10">
        <p
          class="text-xs text-base-content/60 italic line-clamp-2 leading-relaxed"
        >
          " {{ displayText() }} "
        </p>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionTextComponent {
  readonly streamingState = input<StreamingState | null>(null);
  readonly lastMessageContent = input<string | null>(null);

  readonly displayText = computed(() => {
    const state = this.streamingState();

    if (state && state.textAccumulators.size > 0) {
      // Get the latest accumulated text
      let latest = '';
      for (const text of state.textAccumulators.values()) {
        latest = text; // Last entry is the most recent
      }
      return latest.substring(0, 200);
    }

    // Fall back to last message content
    const last = this.lastMessageContent();
    return last ? last.substring(0, 200) : null;
  });
}
