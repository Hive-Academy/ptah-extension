import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ChevronDown, ChevronUp, LucideAngularModule } from 'lucide-angular';
import { PlanWindowDetailComponent } from './plan-window-detail.component';
import { sameSources } from './stats-limit-sections';
import {
  ROW_PANEL,
  chipClass,
  newPanelId,
  planCardClass,
  planRowClass,
  sourceChipClass,
  usageBarFillClass,
} from './stats-tile.styles';
import type { PlanLimitTileModel } from './stats-limit-view-model.types';

/**
 * One session plan-limit row in the expanded stats card (design §3.2): a
 * plan window, owner-level evidence, a cooldown, local usage, or a usage
 * status ("No usage source", "Stale", "Unavailable").
 *
 * A window with a known percent reads label, linear usage bar, value and
 * state chip, with its reset line underneath; every other kind is one line.
 * The caption and source chips the whole section shares are shown once in
 * the section header (`captionShared`, `sharedSources`), so the row shows
 * its own only when they differ.
 *
 * The whole row is a disclosure button; its detail panel is the next sibling
 * and is `hidden` while closed. The open state is owned by the host
 * (`StatsTileExpansionState`, keyed by session and stable tile id), so a
 * re-render or a snapshot push never closes it.
 *
 * `variant="inspector"` renders the same data as a card (TASK_2026_699
 * design §3): a container holding a header (label, chip, chevron), a
 * full-width centre row (bar + value, or wrapping status text), a footer
 * (caption, source chips) and, for expandable kinds, the detail panel as a
 * sibling of the disclosure button. `status` and `local-usage` cards are a
 * plain `div` face with no button, chevron or panel.
 */
@Component({
  selector: 'ptah-plan-limit-tile',
  standalone: true,
  imports: [LucideAngularModule, NgTemplateOutlet, PlanWindowDetailComponent],
  host: {
    class: 'block min-w-0',
    '[attr.data-tile-id]': 'tile().id',
  },
  template: `
    @let t = tile();
    @if (variant() === 'inspector') {
      <div [class]="cardClass()" data-testid="plan-limit-card">
        @if (expandable()) {
          <button
            type="button"
            class="block w-full text-left p-2.5 border-0 bg-transparent transition-colors hover:bg-base-content/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-base-content"
            [attr.aria-expanded]="open()"
            [attr.aria-controls]="panelId"
            data-testid="plan-limit-tile"
            (click)="toggled.emit()"
          >
            <ng-container [ngTemplateOutlet]="cardFace" />
          </button>
          <div
            [id]="panelId"
            class="border-t border-surface-border px-2.5 pt-2 pb-2.5 text-xs"
            [hidden]="!open()"
            data-testid="plan-limit-panel"
          >
            @if (open()) {
              @if (t.window; as window) {
                <ptah-plan-window-detail [window]="window" [showSummary]="false" />
              }
              @for (line of t.detailLines; track $index) {
                <p class="text-[11px] text-base-content-muted mt-0.5 break-words">
                  {{ line }}
                </p>
              }
            }
          </div>
        } @else {
          <div class="p-2.5" data-testid="plan-limit-tile">
            <ng-container [ngTemplateOutlet]="cardFace" />
          </div>
        }
      </div>
      <!-- Face rows are phrasing spans with block/flex classes, valid inside a button. -->
      <ng-template #cardFace>
        <span
          class="flex min-w-0 items-center gap-2"
          data-testid="plan-limit-card-header"
        >
          <span
            class="min-w-0 flex-1 truncate text-xs text-base-content"
            [attr.title]="t.label"
            data-testid="plan-limit-label"
            >{{ t.label }}</span
          >
          @if (t.chip; as chip) {
            <span
              [class]="chipClass(chip.tone) + ' shrink-0'"
              data-testid="plan-limit-chip"
            >
              @if (chip.glyph) {
                <span aria-hidden="true">{{ chip.glyph }}</span>
              }
              {{ chip.text }}
            </span>
          }
          @if (expandable()) {
            <lucide-angular
              [img]="open() ? ChevronUpIcon : ChevronDownIcon"
              class="size-3 shrink-0 text-base-content-muted"
              aria-hidden="true"
            />
          }
        </span>
        @if (t.kind === 'status') {
          <span
            class="mt-2 block text-[11px] leading-snug text-base-content-muted break-words"
            [attr.title]="statusTitle()"
            data-testid="plan-limit-status"
            >{{ t.value }} · {{ t.resetLine }}</span
          >
        } @else if (hasBar()) {
          <span
            class="mt-2 flex min-w-0 items-center gap-2"
            data-testid="plan-limit-card-centre"
          >
            <span
              class="relative h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-base-content/10"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="progressPercent()"
              [attr.aria-valuetext]="t.value"
              [attr.aria-label]="t.label + ' plan usage'"
              [attr.title]="t.value + '. ' + t.resetLine"
              data-testid="plan-limit-progress"
            >
              <span
                [class]="barFillClass()"
                [style.width.%]="progressPercent()"
                data-testid="plan-limit-progress-fill"
              ></span>
            </span>
            <span
              class="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums"
              data-testid="plan-limit-tile-value"
              >{{ t.value }}</span
            >
          </span>
          @if (t.resetLine) {
            <span
              class="mt-1 block text-[11px] leading-tight text-base-content-muted break-words"
              data-testid="plan-limit-reset"
              >{{ t.resetLine }}</span
            >
          }
        } @else {
          <span
            class="mt-2 block text-[11px] leading-snug text-base-content-muted break-words"
            data-testid="plan-limit-card-centre"
          >
            <span class="font-semibold tabular-nums" data-testid="plan-limit-tile-value">{{
              t.value
            }}</span>
            @if (t.resetLine) {
              · {{ t.resetLine }}
            }
          </span>
        }
        @if (!captionShared() || ownSources().length > 0) {
          <span
            class="mt-1.5 flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-base-content-muted"
            data-testid="plan-limit-card-footer"
          >
            @if (!captionShared()) {
              <span
                class="flex min-w-0 max-w-full gap-1 leading-tight"
                [attr.title]="t.caption"
                data-testid="plan-limit-caption"
              >
                <span
                  class="min-w-0"
                  [class.truncate]="!open()"
                  [class.break-words]="open()"
                  >{{ t.captionLead }}</span
                >
                @if (t.captionTail; as tail) {
                  <span class="shrink-0 whitespace-nowrap">{{ tail }}</span>
                }
              </span>
            }
            @for (source of ownSources(); track source) {
              <span [class]="sourceChipClass(source) + ' max-w-full break-words'">{{
                source
              }}</span>
            }
          </span>
        }
      </ng-template>
    } @else {
      <button
        type="button"
        [class]="faceClass()"
        [class.cursor-default]="!expandable()"
        [disabled]="!expandable()"
        [attr.aria-expanded]="expandable() ? open() : null"
        [attr.aria-controls]="expandable() ? panelId : null"
        data-testid="plan-limit-tile"
        (click)="toggled.emit()"
      >
        <span class="flex min-w-0 items-center gap-2">
          <span
            class="min-w-16 max-w-[50%] shrink-0 truncate text-xs text-base-content"
            [attr.title]="t.label"
            >{{ t.label }}</span
          >
          @if (t.kind === 'status') {
            <span
              class="min-w-0 flex-1 text-[11px] text-base-content-muted"
              [attr.title]="statusTitle()"
              data-testid="plan-limit-status"
              >{{ t.value }} · {{ t.resetLine }}</span
            >
          } @else if (hasBar()) {
            <span
              class="relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-base-content/10"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="progressPercent()"
              [attr.aria-valuetext]="t.value"
              [attr.aria-label]="t.label + ' plan usage'"
              [attr.title]="t.value + '. ' + t.resetLine"
              data-testid="plan-limit-progress"
            >
              <span
                [class]="barFillClass()"
                [style.width.%]="progressPercent()"
                data-testid="plan-limit-progress-fill"
              ></span>
            </span>
            <span
              class="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums"
              data-testid="plan-limit-tile-value"
              >{{ t.value }}</span
            >
          } @else {
            <span class="min-w-0 flex-1 text-xs">
              <span
                class="font-semibold tabular-nums"
                data-testid="plan-limit-tile-value"
                >{{ t.value }}</span
              >
              @if (t.resetLine) {
                <span class="text-[11px] text-base-content-muted">
                  · {{ t.resetLine }}</span
                >
              }
            </span>
          }
          @if (t.chip; as chip) {
            <span
              [class]="chipClass(chip.tone) + ' shrink-0'"
              data-testid="plan-limit-chip"
            >
              @if (chip.glyph) {
                <span aria-hidden="true">{{ chip.glyph }}</span>
              }
              {{ chip.text }}
            </span>
          }
        </span>
        @if (hasBar() && t.resetLine) {
          <span
            class="block pl-[4.5rem] text-[11px] leading-tight text-base-content-muted"
            >{{ t.resetLine }}</span
          >
        }
        @if (!captionShared() || ownSources().length > 0) {
          <span
            class="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 pl-[4.5rem]"
          >
            @if (!captionShared()) {
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
            }
            @for (source of ownSources(); track source) {
              <span [class]="sourceChipClass(source)">{{ source }}</span>
            }
          </span>
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
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanLimitTileComponent {
  readonly tile = input.required<PlanLimitTileModel>();
  readonly variant = input<'strip' | 'inspector'>('strip');
  readonly open = input<boolean>(false);
  /** The section header already shows this row's caption. */
  readonly captionShared = input<boolean>(false);
  /** Source chips the section header shows; an equal list is omitted here. */
  readonly sharedSources = input<readonly string[]>([]);
  readonly toggled = output<void>();

  protected readonly panelId = newPanelId();
  protected readonly panelClass = ROW_PANEL;
  protected readonly chipClass = chipClass;
  protected readonly sourceChipClass = sourceChipClass;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronUpIcon = ChevronUp;

  /** Strip row face; the inspector card uses `cardClass` instead. */
  protected readonly faceClass = computed(() => planRowClass(this.tile().tone));
  protected readonly cardClass = computed(() => planCardClass(this.tile().tone));
  protected readonly expandable = computed(
    () => this.tile().kind !== 'status' && this.tile().kind !== 'local-usage',
  );
  protected readonly statusTitle = computed(() =>
    this.tile().detailLines.join(' '),
  );
  protected readonly ownSources = computed(() => {
    const own = this.tile().sourceChips;
    return sameSources(own, this.sharedSources()) ? [] : own;
  });
  /** Clamped to 0-100; `null` (no bar) when the used value is unknown. */
  protected readonly progressPercent = computed<number | null>(() => {
    const percent = this.tile().window?.percent;
    return typeof percent === 'number' && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : null;
  });
  protected readonly hasBar = computed(
    () => this.tile().kind !== 'status' && this.progressPercent() !== null,
  );
  protected readonly barFillClass = computed(
    () =>
      `block h-full rounded-full ${usageBarFillClass(this.tile().tone, this.progressPercent() ?? 0)}`,
  );
}
