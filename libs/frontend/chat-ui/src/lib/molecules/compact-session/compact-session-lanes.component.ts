import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { formatDuration } from '../session/session-stats-format';
import type {
  CompactLaneKind,
  CompactLaneRow,
  CompactLaneStatus,
  CompactLaneSummary,
} from './compact-lane.types';

const KIND_ICON: Readonly<Record<CompactLaneKind, string>> = {
  subagent: '◇',
  cli: '›_',
  background: '≋',
};
const KIND_LABEL: Readonly<Record<CompactLaneKind, string>> = {
  subagent: 'Sub-agent',
  cli: 'CLI lane',
  background: 'Background',
};
const STATUS_TEXT_BASE = 'inline-flex items-center gap-1 text-[11px]';
const STATUS_TEXT_CLASS: Readonly<Record<CompactLaneStatus, string>> = {
  waiting: `${STATUS_TEXT_BASE} text-warning`,
  error: `${STATUS_TEXT_BASE} text-error`,
  running: `${STATUS_TEXT_BASE} text-info`,
  done: `${STATUS_TEXT_BASE} text-success`,
  stopped: `${STATUS_TEXT_BASE} text-base-content-muted`,
};
const STATUS_DOT_BASE = 'inline-block h-1.5 w-1.5 shrink-0 rounded-full';
const STATUS_DOT_CLASS: Readonly<Record<CompactLaneStatus, string>> = {
  waiting: `${STATUS_DOT_BASE} bg-warning`,
  error: `${STATUS_DOT_BASE} bg-error`,
  running: `${STATUS_DOT_BASE} bg-info`,
  done: `${STATUS_DOT_BASE} bg-success`,
  stopped: `${STATUS_DOT_BASE} bg-base-content/40`,
};
const SUMMARY_ORDER: readonly (readonly [CompactLaneStatus, string])[] = [
  ['running', 'running'],
  ['waiting', 'waiting'],
  ['error', 'failed'],
  ['done', 'done'],
  ['stopped', 'stopped'],
];

/** Board duration uses the shared formatter, with the prototype's whole-second padding. */
export function formatBoardDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) {
    return `${hours}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`;
  }
  if (seconds === 0) return '0s';
  const formatted = formatDuration(seconds * 1000);
  return formatted
    .replace(
      /(\d+m )(\d)s$/,
      (_match, prefix: string, second: string) => `${prefix}0${second}s`,
    )
    .replace(/\.0s$/, 's');
}

@Component({
  selector: 'ptah-compact-session-lanes',
  standalone: true,
  host: { class: 'contents' },
  styles: [
    `
      .cs-lane-row {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) 72px 76px 54px;
        align-items: center;
        gap: 6px;
        width: 100%;
        text-align: left;
      }
    `,
  ],
  template: `
    <div
      class="flex shrink-0 items-center justify-between gap-2 text-[11px] text-base-content-muted"
      data-testid="cs-lanes-summary"
    >
      <span
        class="inline-block w-10 shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em]"
        >Lanes</span
      >
      <span class="truncate">{{ summaryLine() }}</span>
    </div>
    @if (showRows()) {
      <ul class="m-0 grid list-none gap-px p-0" aria-label="Lanes">
        @for (row of lanes().rows.slice(0, 3); track row.id) {
          <li>
            <button
              type="button"
              class="cs-lane-row rounded px-1 py-px text-xs hover:bg-base-300/40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
              [attr.data-lane-id]="row.id"
              [attr.aria-label]="'Open ' + row.name + ' output, ' + row.status"
              (click)="laneSelected.emit(row.id)"
            >
              <span class="text-base-content-muted" aria-hidden="true">{{
                kindIcon[row.kind]
              }}</span>
              <span class="truncate">{{ row.name }}</span>
              <span class="truncate text-[10px] text-base-content-muted">{{
                kindLabel[row.kind]
              }}</span>
              <span [class]="statusTextClass[row.status]">
                <span
                  [class]="statusDotClass[row.status]"
                  aria-hidden="true"
                ></span>
                {{ row.status }}
              </span>
              <span
                class="text-right text-[11px] tabular-nums text-base-content-muted"
                >{{ elapsedLabel(row) }}</span
              >
            </button>
          </li>
        } @empty {
          <li
            class="px-1 py-0.5 text-xs text-base-content-muted"
            data-testid="cs-lanes-placeholder"
          >
            —
          </li>
        }
      </ul>
      @if (remainingLanes() > 0) {
        <span
          class="shrink-0 text-[11px] text-base-content-muted"
          data-testid="cs-lanes-more"
          >+{{ remainingLanes() }} more lanes</span
        >
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionLanesComponent {
  readonly lanes = input.required<CompactLaneSummary>();
  readonly now = input<number>(0);
  readonly showRows = input<boolean>(true);
  readonly laneSelected = output<string>();

  protected readonly kindIcon = KIND_ICON;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly statusTextClass = STATUS_TEXT_CLASS;
  protected readonly statusDotClass = STATUS_DOT_CLASS;

  readonly remainingLanes = computed(() =>
    Math.max(
      0,
      this.lanes().moreCount + Math.max(0, this.lanes().rows.length - 3),
    ),
  );
  readonly summaryLine = computed(() => {
    const lanes = this.lanes();
    if (lanes.total === 0) return 'No lanes';
    const parts = SUMMARY_ORDER.filter(
      ([status]) => lanes.counts[status] > 0,
    ).map(([status, label]) => `${lanes.counts[status]} ${label}`);
    return parts.length > 0 ? parts.join(' · ') : `${lanes.total} lanes`;
  });

  protected elapsedLabel(row: CompactLaneRow): string {
    if (row.startedAt === null) return '—';
    const end = row.endedAt ?? (this.now() > 0 ? this.now() : null);
    return end === null ? '—' : formatBoardDuration(end - row.startedAt);
  }
}
