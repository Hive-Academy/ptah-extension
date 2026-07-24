import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, AlarmClock, CircleStop } from 'lucide-angular';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * ScheduleWakeupChipComponent — compact chip for the SDK `ScheduleWakeup` tool
 * used to pace an autonomous `/loop`.
 *
 * Complexity Level: 1 (single-line presentational chip).
 *
 * Renders "Scheduled wakeup in <delaySeconds>s — <reason>", or "Loop stopped"
 * when the tool signals the loop should end (`stop: true`). Input is read
 * defensively because the tool_use may be partial while streaming.
 */
@Component({
  selector: 'ptah-schedule-wakeup-chip',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center gap-2 my-1.5 px-3 py-1.5 rounded-lg border border-warning/30 bg-warning/5"
    >
      <lucide-angular
        [img]="icon()"
        class="w-3.5 h-3.5 shrink-0 text-warning"
        aria-hidden="true"
      />
      <span class="text-xs font-semibold text-base-content/80 shrink-0">
        {{ headline() }}
      </span>
      @if (reason(); as r) {
        <span
          class="text-[11px] text-base-content/50 truncate min-w-0"
          [title]="r"
        >
          {{ r }}
        </span>
      }
    </div>
  `,
})
export class ScheduleWakeupChipComponent {
  readonly node = input.required<ExecutionNode>();

  private readonly AlarmClockIcon = AlarmClock;
  private readonly CircleStopIcon = CircleStop;

  private readonly toolInput = computed<Record<string, unknown>>(
    () => this.node().toolInput ?? {},
  );

  /** Whether this invocation stops the loop rather than scheduling a wakeup. */
  private readonly isStop = computed<boolean>(
    () => this.toolInput()['stop'] === true,
  );

  readonly icon = computed(() =>
    this.isStop() ? this.CircleStopIcon : this.AlarmClockIcon,
  );

  /** Primary label: "Loop stopped" or "Scheduled wakeup in Ns". */
  readonly headline = computed<string>(() => {
    if (this.isStop()) return 'Loop stopped';
    const delay = this.toolInput()['delaySeconds'];
    return typeof delay === 'number' && delay > 0
      ? `Scheduled wakeup in ${delay}s`
      : 'Scheduled wakeup';
  });

  readonly reason = computed<string | undefined>(() =>
    this.isStop() ? undefined : readString(this.toolInput()['reason']),
  );
}

/** Returns the value when it is a non-empty string, otherwise undefined. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}
