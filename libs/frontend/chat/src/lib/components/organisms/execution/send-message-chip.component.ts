import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Send } from 'lucide-angular';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * SendMessageChipComponent — compact chip for the SDK `SendMessage` tool
 * (agent-to-agent / teammate messaging).
 *
 * Complexity Level: 1 (single-line presentational chip).
 *
 * Renders "Message → <to>" plus the short summary the sender attached (falling
 * back to the raw message body). Input is read defensively because the
 * tool_use may be partial while streaming.
 */
@Component({
  selector: 'ptah-send-message-chip',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center gap-2 my-1.5 px-3 py-1.5 rounded-lg border border-info/30 bg-info/5"
    >
      <lucide-angular
        [img]="SendIcon"
        class="w-3.5 h-3.5 shrink-0 text-info"
        aria-hidden="true"
      />
      <span class="text-xs font-semibold text-base-content/80 shrink-0">
        Message
      </span>
      <span class="text-xs text-base-content/40 shrink-0">&rarr;</span>
      <span
        class="text-xs font-medium text-info truncate shrink-0 max-w-[8rem]"
        [title]="recipient()"
      >
        {{ recipient() }}
      </span>
      @if (preview(); as p) {
        <span
          class="text-[11px] text-base-content/50 truncate min-w-0"
          [title]="p"
        >
          {{ p }}
        </span>
      }
    </div>
  `,
})
export class SendMessageChipComponent {
  readonly node = input.required<ExecutionNode>();

  readonly SendIcon = Send;

  private readonly toolInput = computed<Record<string, unknown>>(
    () => this.node().toolInput ?? {},
  );

  /** Recipient teammate name; a dash placeholder until the SDK surfaces it. */
  readonly recipient = computed<string>(
    () => readString(this.toolInput()['to']) ?? '—',
  );

  /** Summary preview, falling back to the raw message body. */
  readonly preview = computed<string | undefined>(() => {
    const input = this.toolInput();
    return readString(input['summary']) ?? readString(input['message']);
  });
}

/** Returns the value when it is a non-empty string, otherwise undefined. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}
