import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Radar } from 'lucide-angular';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * MonitorCardComponent — compact card for the SDK `Monitor` tool.
 *
 * Complexity Level: 1 (simple presentational card).
 *
 * The `Monitor` tool arms a background watch whose stdout lines stream in as
 * chat events. This card surfaces what is being watched — the human
 * description, the underlying command, and whether the watch is persistent
 * (session-length) or bounded by a timeout. Input is read defensively because
 * the tool_use may be partial while streaming.
 */
@Component({
  selector: 'ptah-monitor-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-start gap-2 my-1.5 px-3 py-2 rounded-lg border border-accent/30 bg-accent/5"
    >
      <lucide-angular
        [img]="RadarIcon"
        class="w-4 h-4 shrink-0 mt-0.5 text-accent"
        aria-hidden="true"
      />
      <div class="flex flex-col min-w-0 flex-1 gap-0.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs font-semibold text-base-content/80">
            Monitoring
          </span>
          <span class="badge badge-xs badge-ghost">{{ lifespanLabel() }}</span>
        </div>
        @if (description(); as d) {
          <span class="text-[11px] text-base-content/60 truncate" [title]="d">
            {{ d }}
          </span>
        }
        @if (command(); as c) {
          <code
            class="text-[10px] font-mono text-base-content/40 truncate"
            [title]="c"
            >{{ c }}</code
          >
        }
      </div>
    </div>
  `,
})
export class MonitorCardComponent {
  readonly node = input.required<ExecutionNode>();

  readonly RadarIcon = Radar;

  private readonly toolInput = computed<Record<string, unknown>>(
    () => this.node().toolInput ?? {},
  );

  readonly description = computed<string | undefined>(() =>
    readString(this.toolInput()['description']),
  );

  readonly command = computed<string | undefined>(() =>
    readString(this.toolInput()['command']),
  );

  /** "Persistent" for session-length watches, otherwise the timeout window. */
  readonly lifespanLabel = computed<string>(() => {
    const input = this.toolInput();
    if (input['persistent'] === true) return 'Persistent';
    const timeout = input['timeout_ms'];
    if (typeof timeout === 'number' && timeout > 0) {
      return `${Math.round(timeout / 1000)}s`;
    }
    return 'Watching';
  });
}

/** Returns the value when it is a non-empty string, otherwise undefined. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}
