import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import {
  LucideAngularModule,
  MessageSquare,
  Square,
  Moon,
} from 'lucide-angular';

/**
 * Presentational status buckets for a strip chip. Mapped from the richer
 * `SubagentRecord` / `BackgroundAgentEntry` lifecycle states by the smart
 * wrapper — the dumb component never sees the source models.
 */
export type BackgroundAgentStripStatus =
  | 'running'
  | 'background'
  | 'completed'
  | 'error'
  | 'stopped';

/**
 * View-model for a single chip in the {@link BackgroundAgentStripComponent}.
 *
 * Deliberately minimal: display fields plus capability flags. The mapping from
 * `SubagentRecord` / `BackgroundAgentEntry` (and the id bookkeeping needed to
 * dispatch actions) lives in the smart wrapper, keeping this component free of
 * store or backend coupling.
 */
export interface BackgroundAgentStripEntry {
  /** Stable identity — the subagent/background `toolCallId`. Also the `@for` key
   * and the value echoed back through every output. */
  readonly id: string;
  /** Agent type or name, e.g. `software-architect`, `Explore`. */
  readonly name: string;
  /** One-line description / rolling summary. Truncated in the template. */
  readonly description?: string;
  /** Presentational lifecycle bucket driving the status dot color. */
  readonly status: BackgroundAgentStripStatus;
  /** Whether a steer input should be offered (running or background agents). */
  readonly steerable: boolean;
  /** Whether a stop action applies (running or background agents). */
  readonly stoppable: boolean;
  /** Whether the "send to background" action applies — foreground running
   * subagents only. */
  readonly canBackground: boolean;
}

/**
 * BackgroundAgentStripComponent — persistent horizontal strip of agent chips
 * rendered at the bottom of the chat layout.
 *
 * Purely presentational: takes a readonly list of {@link BackgroundAgentStripEntry}
 * and emits an id for each action. The strip hides itself when the list is
 * empty. Each chip exposes a focus button (opens the monitor panel) plus
 * contextual steer / stop / send-to-background actions.
 */
@Component({
  selector: 'ptah-background-agent-strip',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entries().length > 0) {
      <div
        class="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto border-t border-base-content/10 bg-base-200/60 flex-shrink-0"
        role="list"
        aria-label="Background agents"
      >
        @for (entry of entries(); track entry.id) {
          <div
            role="listitem"
            class="flex items-center gap-1 rounded-full border border-base-300 bg-base-100 pl-2 pr-1 py-0.5 shrink-0"
          >
            <!-- Focus button: status dot + name + description -->
            <button
              type="button"
              class="flex items-center gap-1.5 text-xs cursor-pointer hover:text-primary transition-colors max-w-[220px]"
              [attr.aria-label]="'Focus agent ' + entry.name"
              [title]="entry.description || entry.name"
              (click)="focusAgent.emit(entry.id)"
            >
              <span
                class="inline-block w-2 h-2 rounded-full shrink-0"
                [class.bg-info]="
                  entry.status === 'running' || entry.status === 'background'
                "
                [class.bg-success]="entry.status === 'completed'"
                [class.bg-error]="
                  entry.status === 'error' || entry.status === 'stopped'
                "
                [class.animate-pulse]="entry.status === 'running'"
                aria-hidden="true"
              ></span>
              <span class="font-medium truncate max-w-[110px]">{{
                entry.name
              }}</span>
              @if (entry.description) {
                <span class="text-base-content/40 truncate hidden sm:inline">
                  {{ entry.description }}
                </span>
              }
            </button>

            <!-- Contextual actions -->
            @if (entry.steerable) {
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square h-5 min-h-0 w-5 text-base-content/50 hover:text-primary"
                [attr.aria-label]="'Steer agent ' + entry.name"
                title="Steer"
                (click)="steer.emit(entry.id)"
              >
                <lucide-angular
                  [img]="SteerIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              </button>
            }
            @if (entry.canBackground) {
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square h-5 min-h-0 w-5 text-base-content/50 hover:text-info"
                [attr.aria-label]="
                  'Send agent ' + entry.name + ' to background'
                "
                title="Send to background"
                (click)="sendToBackground.emit(entry.id)"
              >
                <lucide-angular
                  [img]="BackgroundIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              </button>
            }
            @if (entry.stoppable) {
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square h-5 min-h-0 w-5 text-base-content/50 hover:text-error"
                [attr.aria-label]="'Stop agent ' + entry.name"
                title="Stop"
                (click)="stop.emit(entry.id)"
              >
                <lucide-angular
                  [img]="StopIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              </button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class BackgroundAgentStripComponent {
  /** Chips to render. Strip hides when empty. */
  readonly entries = input.required<readonly BackgroundAgentStripEntry[]>();

  /** Emits the entry id when its focus (open output) button is clicked. */
  readonly focusAgent = output<string>();
  /** Emits the entry id when its steer button is clicked. */
  readonly steer = output<string>();
  /** Emits the entry id when its stop button is clicked. */
  readonly stop = output<string>();
  /** Emits the entry id when its send-to-background button is clicked. */
  readonly sendToBackground = output<string>();

  protected readonly SteerIcon = MessageSquare;
  protected readonly StopIcon = Square;
  protected readonly BackgroundIcon = Moon;

  /** Convenience for consumers that want to know if anything will render. */
  readonly hasEntries = computed(() => this.entries().length > 0);
}
