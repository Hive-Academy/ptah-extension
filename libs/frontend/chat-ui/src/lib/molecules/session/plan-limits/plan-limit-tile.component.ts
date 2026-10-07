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
    '[class.col-span-full]': 'open()',
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
        @if (progressPercent() !== null) {
          <span class="mt-1 flex min-w-0 items-center gap-2">
            <span
              [class]="radialClass()"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="progressPercent()!"
              [attr.aria-label]="t.label + ' plan usage'"
              [attr.title]="t.value + '. ' + t.resetLine"
              [style.--value]="progressPercent()!"
              style="--size: 2.75rem; --thickness: 4px"
              data-testid="plan-limit-radial-progress"
              >{{ roundedProgressPercent() }}%</span
            >
            <span class="min-w-0 text-left">
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
                class="block text-sm font-semibold leading-tight"
                data-testid="plan-limit-tile-value"
                >{{ t.value }}</span
              >
              @if (t.resetLine) {
                <span
                  class="block text-[11px] text-base-content-muted leading-tight mt-0.5"
                  >{{ t.resetLine }}</span
                >
              }
            </span>
          </span>
        } @else {
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
            class="block text-sm font-semibold leading-tight mt-0.5"
            data-testid="plan-limit-tile-value"
            >{{ t.value }}</span
          >
          @if (t.resetLine) {
            <span
              class="block text-[11px] text-base-content-muted leading-tight mt-0.5"
              >{{ t.resetLine }}</span
            >
          }
        }
        @if (t.chip; as chip) {
          <span class="flex flex-wrap gap-1 mt-1">
            <span [class]="chipClass(chip.tone)" data-testid="plan-limit-chip">
              @if (chip.glyph) {
                <span aria-hidden="true">{{ chip.glyph }}</span>
              }
              {{ chip.text }}
            </span>
          </span>
        }
        @if (t.sourceChips.length > 0) {
          <span class="flex flex-wrap gap-1 mt-1">
            @for (source of t.sourceChips; track source) {
              <span [class]="sourceChipClass(source)">{{ source }}</span>
            }
          </span>
        }
      }
      @if (expandable()) {
        <lucide-angular
          [img]="open() ? ChevronUpIcon : ChevronDownIcon"
          class="absolute top-1.5 right-1 w-3 h-3 text-base-content-muted"
          aria-hidden="true"
        />
      }
    </button>
    <div
      [id]="panelId"
      [class]="panelClass"
      [hidden]="!open()"
      data-testid="plan-limit-panel"
    >
      @if (open()) {
        @if (t.window; as window) {
          <ptah-plan-window-detail [window]="window" [showSummary]="false" />
        }
        @for (line of t.detailLines; track $index) {
          <p class="text-[11px] text-base-content-muted mt-0.5">{{ line }}</p>
        }
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
  protected readonly expandable = computed(() =>
    this.tile().kind !== 'status' && this.tile().kind !== 'local-usage',
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
  protected readonly radialClass = computed(() => {
    const percent = this.progressPercent();
    return this.tile().tone === 'error'
      ? 'radial-progress bg-base-300 text-error'
      : percent !== null && percent >= 75
        ? 'radial-progress bg-base-300 text-warning'
        : 'radial-progress bg-base-300 text-success';
  });
}
