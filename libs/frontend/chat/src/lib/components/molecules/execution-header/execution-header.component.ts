import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
} from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
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
 * show one), a Details toggle for the projected facts, and the lane actions
 * (`[executionHeaderActions]`).
 */
@Component({
  selector: 'ptah-execution-header',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-kind]': 'kind()', class: 'block' },
  template: `
    <div [class]="columnClass">
      <div
        class="flex min-h-[30px] min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-surface-border pb-1 text-[12px] text-base-content-muted"
        data-test="execution-header-row"
      >
        <ng-content select="[executionHeaderStats]" />
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
        <button
          type="button"
          class="inline-flex h-6 shrink-0 items-center gap-0.5 rounded px-1 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content"
          data-test="execution-header-details"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="controlsId()"
          [attr.aria-label]="label() + ' details'"
          (click)="open.set(!open())"
        >
          <span>Details</span>
          <lucide-angular
            [img]="ChevronRightIcon"
            class="h-3.5 w-3.5 transition-transform motion-reduce:transition-none"
            [class.rotate-90]="open()"
            aria-hidden="true"
          />
        </button>
        <ng-content select="[executionHeaderActions]" />
      </div>
      @if (open()) {
        <div
          [id]="controlsId()"
          role="region"
          [attr.aria-label]="label() + ' details'"
          class="text-[11px] text-base-content-muted"
        >
          <ng-content />
        </div>
      }
    </div>
  `,
})
export class ExecutionHeaderComponent {
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly separator = META_SEPARATOR;
  protected readonly columnClass = LANE_COLUMN_CLASS;

  readonly kind = input.required<'cli' | 'subagent'>();
  /** Lane run label; names the details toggle and region. */
  readonly label = input.required<string>();
  readonly live = input(false);
  /** Newest progress line, shown only while live. */
  readonly peek = input<string | null>(null);
  /** Tool count; a lane passes it only when no message bubble shows one. */
  readonly toolCount = input(0);
  readonly extraMeta = input<readonly string[]>([]);
  readonly metaTone = input<'muted' | 'warning'>('muted');
  readonly controlsId = input.required<string>();
  readonly open = model(false);

  protected readonly metaParts = computed(() => {
    const tools = this.toolCount();
    return [
      ...(tools > 0 ? [`${tools} ${tools === 1 ? 'tool' : 'tools'}`] : []),
      ...this.extraMeta().filter(Boolean),
    ];
  });
}
