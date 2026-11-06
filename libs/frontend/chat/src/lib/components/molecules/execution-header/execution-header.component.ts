import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { LANE_COLUMN_CLASS } from './lane-column';

/** Separator between meta parts, as in the turn disclosure row. */
const META_SEPARATOR = ' · ';

/**
 * Compact control row of a sub-agent or CLI lane, in the main chat's column.
 *
 * The transcript's message bubbles carry the turn label (`Worked for …`) and
 * the tool and file counts, so this row repeats neither. It holds the lane
 * stats chips (`[executionHeaderStats]`), the live progress peek, stable meta
 * (end status, guard reason, run mode, or a tool count when no bubble can
 * show one), and the lane actions
 * (`[executionHeaderActions]`).
 */
@Component({
  selector: 'ptah-execution-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-kind]': 'kind()', class: 'block' },
  template: `
    <div [class]="columnClass">
      <div
        class="flex min-h-[30px] min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-surface-border pb-1 text-[12px] text-base-content-muted"
        data-test="execution-header-row"
      >
        @if (showStats()) {
          <ng-content select="[executionHeaderStats]" />
        }
        @if (live() && peek(); as text) {
          <span
            class="min-w-0 flex-1 truncate"
            data-test="execution-header-peek"
            >{{ text }}</span
          >
        } @else {
          <span class="flex-1" aria-hidden="true"></span>
        }
        @if (metaParts().length > 0) {
          <span
            class="shrink-0 text-[11px] tabular-nums"
            [class.!text-warning]="metaTone() === 'warning'"
            data-test="execution-header-meta"
            >{{ metaParts().join(separator) }}</span
          >
        }
        @if (account(); as accountText) {
          <span
            class="badge badge-sm badge-ghost text-[9px] text-base-content-muted max-w-[10rem] min-w-0 flex-shrink-0"
            data-testid="lane-account"
            [title]="accountText"
          >
            <span class="truncate">{{ accountText }}</span>
          </span>
        }
        <ng-content select="[executionHeaderActions]" />
      </div>
    </div>
  `,
})
export class ExecutionHeaderComponent {
  readonly showStats = input(true);
  protected readonly separator = META_SEPARATOR;
  protected readonly columnClass = LANE_COLUMN_CLASS;

  readonly kind = input.required<'cli' | 'subagent'>();
  readonly live = input(false);
  /** Newest progress line, shown only while live. */
  readonly peek = input<string | null>(null);
  /** Tool count; a lane passes it only when no message bubble shows one. */
  readonly toolCount = input(0);
  readonly extraMeta = input<readonly string[]>([]);
  readonly metaTone = input<'muted' | 'warning'>('muted');
  /** Resolved lane account text (a label, never an ID); null shows nothing. */
  readonly account = input<string | null>(null);

  protected readonly metaParts = computed(() => {
    const tools = this.toolCount();
    return [
      ...(tools > 0 ? [`${tools} ${tools === 1 ? 'tool' : 'tools'}`] : []),
      ...this.extraMeta().filter(Boolean),
    ];
  });
}
