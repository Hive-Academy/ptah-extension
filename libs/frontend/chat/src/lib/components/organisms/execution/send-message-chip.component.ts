import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Send, Check } from 'lucide-angular';
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
      <span class="text-xs font-semibold text-base-content-muted shrink-0">
        Message
      </span>
      <span class="text-xs text-base-content-muted shrink-0">&rarr;</span>
      <span
        class="text-xs font-medium text-info truncate shrink-0 max-w-[8rem]"
        [title]="recipient()"
      >
        {{ recipient() }}
      </span>
      @if (preview(); as p) {
        <span
          class="text-[11px] text-base-content-muted truncate min-w-0"
          [title]="p"
        >
          {{ p }}
        </span>
      }
      @switch (resumedAgentStatus()) {
        @case ('running') {
          <span
            class="badge badge-xs badge-info gap-1 shrink-0 ml-auto"
            data-testid="resumed-agent-status"
            data-status="running"
            role="status"
          >
            <span
              class="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse"
              aria-hidden="true"
            ></span>
            <span class="text-[9px]">running</span>
          </span>
        }
        @case ('done') {
          <span
            class="badge badge-xs badge-success gap-1 shrink-0 ml-auto"
            data-testid="resumed-agent-status"
            data-status="done"
            role="status"
          >
            <lucide-angular
              [img]="CheckIcon"
              class="w-2.5 h-2.5"
              aria-hidden="true"
            />
            <span class="text-[9px]">done</span>
          </span>
        }
      }
    </div>
  `,
})
export class SendMessageChipComponent {
  readonly node = input.required<ExecutionNode>();

  readonly SendIcon = Send;
  readonly CheckIcon = Check;

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

  /**
   * Status of the subagent this message resumed. The SDK streams a resumed
   * subagent under the SendMessage tool_use id, so its agent node is a child
   * of this tool node. `null` (no agent child, or an error/interrupted state
   * the agent bubble already shows) renders no badge.
   */
  readonly resumedAgentStatus = computed<'running' | 'done' | null>(() => {
    const agents = this.node().children.filter(
      (child) => child.type === 'agent',
    );
    const latest = agents[agents.length - 1];
    if (!latest) return null;
    if (latest.status === 'pending' || latest.status === 'streaming') {
      return 'running';
    }
    return latest.status === 'complete' ? 'done' : null;
  });
}

/** Returns the value when it is a non-empty string, otherwise undefined. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}
