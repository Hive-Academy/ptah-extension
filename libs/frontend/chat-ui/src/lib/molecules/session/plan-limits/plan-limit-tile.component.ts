import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ChevronDown, ChevronUp, LucideAngularModule } from 'lucide-angular';
import { PlanWindowDetailComponent } from './plan-window-detail.component';
import {
  TILE_PANEL,
  chipClass,
  newPanelId,
  planFaceClass,
  sourceChipClass,
} from './stats-tile.styles';
import type { PlanLimitTileModel } from './stats-limit-view-model.types';

/**
 * One session plan-limit tile in the stats card grid (design §3.2): a plan
 * window, owner-level evidence, a cooldown, or a usage status ("No usage
 * source", "Stale", "Unavailable").
 *
 * The whole face is a disclosure button; its detail panel is the next
 * sibling and is `hidden` while closed. The open state is owned by the host
 * (`StatsTileExpansionState`, keyed by session and stable tile id), so a
 * re-render or a snapshot push never closes it. An open tile spans both grid
 * columns.
 */
@Component({
  selector: 'ptah-plan-limit-tile',
  standalone: true,
  imports: [LucideAngularModule, PlanWindowDetailComponent],
  host: {
    class: 'block min-w-0',
    '[class.col-span-full]': 'open() && tile().kind !== "status"',
    '[attr.data-tile-id]': 'tile().id',
  },
  template: `
    @let t = tile();
    <button
      type="button"
      [class]="faceClass()"
      [class.rounded-b-none]="open()"
      [class.cursor-default]="!expandable()"
      [disabled]="!expandable()"
      [attr.aria-expanded]="expandable() ? open() : null"
      [attr.aria-controls]="expandable() ? panelId : null"
      data-testid="plan-limit-tile"
      (click)="toggled.emit()"
    >
      @if (t.kind === 'status') {
        <span
          class="block text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
          >{{ t.label }}</span
        >
        <span
          class="flex min-w-0 gap-1 text-[10px] text-base-content-muted leading-tight"
          [attr.title]="t.caption"
          data-testid="plan-limit-caption"
        >
          <span [class.truncate]="!open()">{{ t.captionLead }}</span>
          @if (t.captionTail; as tail) {
            <span class="shrink-0 whitespace-nowrap">{{ tail }}</span>
          }
        </span>
        <span
          [class]="chipClass('neutral')"
          [attr.title]="statusTitle()"
          data-testid="plan-limit-status"
          >{{ t.value }} · {{ t.resetLine }}</span
        >
      } @else {
        <span
          class="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)_4rem_1rem] items-center gap-1"
          [attr.title]="t.caption + '. ' + t.resetLine"
        >
          <span
            class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
            >{{ t.label }}</span
          >
          <span class="min-w-0">
            @if (progressPercent() !== null) {
              <span
                class="block h-1.5 overflow-hidden rounded bg-base-content/10"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="progressPercent()"
                [attr.aria-valuetext]="
                  roundedProgressPercent() + '% used, ' + t.resetLine
                "
                [attr.aria-label]="t.label + ' plan usage'"
                data-testid="plan-limit-progress"
              >
                <span
                  class="block h-full rounded"
                  [class.bg-error]="t.tone === 'error'"
                  [class.bg-warning]="t.tone === 'warning'"
                  [class.bg-base-content]="
                    t.tone !== 'error' && t.tone !== 'warning'
                  "
                  [style.width.%]="progressPercent()"
                ></span>
              </span>
            }
            <span
              class="block text-[11px] text-base-content-muted leading-tight mt-0.5 break-words"
              >{{ t.shortReset ?? t.resetLine }}
              @if (faceStatus(); as status) {
                <span
                  class="font-semibold text-base-content"
                  data-testid="plan-limit-face-status"
                  >· {{ status }}</span
                >
              }
            </span>
          </span>
          <span
            class="text-right text-sm font-semibold tabular-nums whitespace-nowrap"
            data-testid="plan-limit-tile-value"
            >{{
              progressPercent() !== null ? roundedProgressPercent() + '%' : '—'
            }}</span
          >
          @if (expandable()) {
            <lucide-angular
              [img]="open() ? ChevronUpIcon : ChevronDownIcon"
              class="w-3 h-3 text-base-content-muted"
              aria-hidden="true"
            />
          }
        </span>
      }
    </button>
    <div
      [id]="panelId"
      [class]="panelClass"
      [hidden]="!open()"
      data-testid="plan-limit-panel"
    >
      @if (open()) {
        <div
          class="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)_4.5rem] gap-x-2 gap-y-1 break-words"
        >
          <span class="text-base-content-muted">Account</span
          ><span class="col-span-2 min-w-0">{{ t.caption }}</span>
          @if (t.window; as window) {
            <ptah-plan-window-detail [window]="window" [showSummary]="false" />
          }
          <span class="text-base-content-muted">Status</span
          ><span class="col-span-2">{{ t.chip?.text ?? 'Available' }}</span>
          <span class="text-base-content-muted">Source</span
          ><span class="col-span-2 flex flex-wrap gap-1">
            @for (source of t.sourceChips; track source) {
              <span [class]="sourceChipClass(source)">{{ source }}</span>
            }
          </span>
          @for (line of t.detailLines; track $index) {
            <p class="col-span-full text-[11px] text-base-content-muted mt-0.5">
              {{ line }}
            </p>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanLimitTileComponent {
  readonly tile = input.required<PlanLimitTileModel>();
  readonly open = input<boolean>(false);
  readonly toggled = output<void>();

  protected readonly panelId = newPanelId();
  protected readonly panelClass = TILE_PANEL;
  protected readonly chipClass = chipClass;
  protected readonly sourceChipClass = sourceChipClass;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronUpIcon = ChevronUp;

  protected readonly faceClass = computed(() =>
    planFaceClass(this.tile().tone),
  );
  protected readonly expandable = computed(
    () => this.tile().kind !== 'status' && this.tile().kind !== 'local-usage',
  );
  protected readonly statusTitle = computed(() =>
    this.tile().detailLines.join(' '),
  );
  protected readonly progressPercent = computed<number | null>(() => {
    const percent = this.tile().window?.percent;
    return typeof percent === 'number' && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : null;
  });
  protected readonly roundedProgressPercent = computed(() =>
    Math.round(this.progressPercent() ?? 0),
  );
  protected readonly faceStatus = computed(() => {
    const state = this.tile().window?.state;
    if (state === 'near-limit') return 'Near limit';
    if (state === 'limit-reached') return 'Limit reached';
    return this.tile().tone === 'warning' && this.tile().chip?.text === 'Stale'
      ? 'Stale'
      : null;
  });
}
