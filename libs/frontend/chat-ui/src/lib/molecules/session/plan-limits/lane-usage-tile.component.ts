import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { Info, LucideAngularModule } from 'lucide-angular';
import { PlanWindowDetailComponent } from './plan-window-detail.component';
import {
  LANE_COLLAPSE_TITLE,
  LANE_ROW_GRID,
  badgeClass,
  chipClass,
  laneCollapseClass,
  newPanelId,
  sourceChipClass,
} from './stats-tile.styles';
import { STATS_EMPTY } from '../session-stats-view';
import { LANE_EMPTY } from './lane-tiles';
import type { LaneUsageTileModel } from './stats-limit-view-model.types';

/**
 * One CLI lane (CLI + role) as a row of the expanded stats card's Lanes
 * section (design §3.3; chat layout declutter Revision 2 item 9).
 *
 * The row is a DaisyUI `collapse collapse-arrow`. Its title sits on the
 * section's shared grid (`LANE_ROW_GRID`): lane name, known usage or `—`,
 * and the run status as a `badge badge-xs badge-ghost`, so the columns line
 * up across lanes and the subtotal. An at- or near-limit lane adds its limit
 * badge under the status so the alert reads while closed.
 *
 * Lane usage is outside the session totals (Req 8): the row has a dashed
 * accent and its own fill, and the caption "lane · not in totals" is shown
 * once in the section header (`captionShared`), or on the row when the
 * section cannot share it.
 *
 * The open body states the lane's usage and limit once (`summary`), then per
 * owner + model-scope subgroup a `table table-xs` of runs (a column whose
 * every value is unknown is dropped), the plan-tile links and window detail,
 * and one footnote line for the owner and limit explanation.
 *
 * The open state is owned by the host (`StatsTileExpansionState`, A3).
 */
@Component({
  selector: 'ptah-lane-usage-tile',
  standalone: true,
  imports: [LucideAngularModule, PlanWindowDetailComponent],
  host: {
    class: 'block min-w-0',
    '[attr.data-tile-id]': 'tile().id',
  },
  template: `
    @let t = tile();
    <div [class]="collapseClass()" data-testid="lane-usage-collapse">
      <button
        type="button"
        [class]="titleClass"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="panelId"
        data-testid="lane-usage-tile"
        (click)="toggled.emit()"
      >
        <span [class]="rowGrid" data-testid="lane-row-grid">
          <span
            class="min-w-0 truncate text-xs text-base-content"
            [attr.title]="t.label"
            data-testid="lane-name"
            >{{ t.label }}</span
          >
          <span
            class="min-w-0 truncate text-xs font-semibold tabular-nums"
            data-testid="lane-tokens"
            [class.text-base-content-muted]="usageText() === empty.value"
            [attr.aria-label]="usageText() === empty.value ? empty.usage : null"
            [attr.title]="usageText() === empty.value ? null : usageText()"
            >{{ usageText() }}</span
          >
          <span class="flex min-w-0 flex-col items-end gap-0.5">
            <span
              [class]="statusBadgeClass"
              [attr.title]="t.runChip.text"
              data-testid="lane-run-chip"
            >
              @if (t.runChip.tone === 'live') {
                <span
                  class="inline-block w-1.5 h-1.5 shrink-0 rounded-full bg-success motion-safe:animate-pulse"
                  aria-hidden="true"
                ></span>
              }
              {{ t.runChip.text }}
            </span>
            @if (alertChip(); as alert) {
              <span
                [class]="badgeClass(alert.chip.tone)"
                [attr.title]="alert.chip.text"
                data-testid="lane-limit-chip"
              >
                @if (alert.chip.glyph) {
                  <span aria-hidden="true">{{ alert.chip.glyph }}</span>
                }
                {{ alert.chip.text }}
              </span>
            }
          </span>
        </span>
        @if (!captionShared()) {
          <span
            class="block text-[10px] leading-tight text-base-content-muted"
            [class.truncate]="!open()"
            [attr.title]="t.caption"
            data-testid="lane-caption"
            >{{ t.caption }}</span
          >
        }
      </button>
      <div
        [id]="panelId"
        class="collapse-content px-2 pb-1.5 text-xs"
        [hidden]="!open()"
        data-testid="lane-usage-panel"
      >
        @if (open()) {
          <p
            class="flex flex-wrap items-center gap-1 pt-0.5 text-xs text-base-content-muted"
            data-testid="lane-summary"
          >
            <span>{{ t.summary }}</span>
            @for (source of summarySources(); track source) {
              <span [class]="sourceChipClass(source)">{{ source }}</span>
            }
          </p>
          @let several = t.subgroups.length > 1;
          @for (group of t.subgroups; track group.key; let first = $first) {
            <section
              [class]="first ? 'pt-1' : subgroupDivider"
              [attr.data-owner-status]="group.ownerStatus"
              data-testid="lane-subgroup"
            >
              @if (several) {
                <h4 class="flex flex-wrap items-center gap-1 text-xs font-semibold">
                  {{ group.heading }}
                  <!-- With no known limit the summary already says "Limit unavailable": state it once. -->
                  @if (t.limitChips.length || group.stateChip.text !== empty.limit) {
                    <span [class]="badgeClass(group.stateChip.tone)" data-testid="lane-subgroup-state">
                      @if (group.stateChip.glyph) {
                        <span aria-hidden="true">{{ group.stateChip.glyph }}</span>
                      }
                      {{ group.stateChip.text }}
                    </span>
                  }
                </h4>
              }
              @let cols = group.columns;
              <table class="table table-xs mt-0.5" data-testid="lane-run-table">
                <thead>
                  <tr class="text-base-content-muted">
                    <th scope="col" class="w-6 text-right">#</th>
                    @if (cols.model) { <th scope="col">Model</th> }
                    @if (cols.tokens) { <th scope="col" class="text-right">Tokens</th> }
                    @if (cols.cost) { <th scope="col" class="text-right">Cost</th> }
                    <th scope="col">Status</th>
                    @if (cols.started) { <th scope="col">Started</th> }
                  </tr>
                </thead>
                <tbody>
                  @for (run of group.runs; track run.runId) {
                    <tr data-testid="lane-run-row">
                      <td class="text-right tabular-nums">{{ run.index }}</td>
                      @if (cols.model) {
                        <td class="max-w-[8rem] truncate" data-testid="lane-run-model"
                          [class.text-base-content-muted]="run.model === null"
                          [attr.title]="run.model">{{ run.model ?? empty.value }}</td>
                      }
                      @if (cols.tokens) {
                        <td class="text-right tabular-nums" data-testid="lane-run-tokens"
                          [class.text-base-content-muted]="run.tokensText === empty.value"
                          [attr.aria-label]="run.tokensText === empty.value ? statsEmpty.tokens : null">{{ run.tokensText }}</td>
                      }
                      @if (cols.cost) {
                        <td class="text-right tabular-nums" data-testid="lane-run-cost"
                          [class.text-base-content-muted]="run.costText === empty.value"
                          [attr.aria-label]="run.costText === empty.value ? statsEmpty.cost : null">{{ run.costText }}</td>
                      }
                      <td>
                        <span [class]="badgeClass(run.status.tone)" data-testid="lane-run-status">{{ run.status.text }}</span>
                      </td>
                      @if (cols.started) {
                        <td class="whitespace-nowrap tabular-nums" data-testid="lane-run-started"
                          [attr.title]="run.started?.full ?? null">{{ run.started?.short ?? empty.value }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
              @if (group.planTileChips.length) {
                <div class="flex flex-wrap gap-1 mt-1">
                  @for (planChip of group.planTileChips; track planChip.planTileId) {
                    @if (linkPlanTiles()) {
                      <button type="button"
                        [class]="'h-6 min-w-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content ' + chipClass(planChip.chip.tone)"
                        data-testid="lane-plan-tile-chip"
                        (click)="planTileRequested.emit(planChip.planTileId)">
                        @if (planChip.chip.glyph) { <span aria-hidden="true">{{ planChip.chip.glyph }}</span> }
                        {{ planChip.chip.text }}
                      </button>
                    } @else {
                      <span [class]="chipClass(planChip.chip.tone)" data-testid="lane-plan-tile-chip">
                        @if (planChip.chip.glyph) { <span aria-hidden="true">{{ planChip.chip.glyph }}</span> }
                        {{ planChip.chip.text }}
                      </span>
                    }
                  }
                </div>
              }
              @for (window of group.windows; track window.windowKey) {
                <ptah-plan-window-detail [window]="window" />
              }
              @for (line of group.evidenceLines; track $index) {
                <p class="text-[11px] text-base-content-muted mt-0.5">{{ line }}</p>
              }
              @if (group.cooldownLine) {
                <p class="text-[11px] text-base-content-muted mt-0.5">{{ group.cooldownLine }}</p>
              }
              @if (group.footnote) {
                <p class="mt-1 flex items-start gap-1 text-xs text-base-content-muted" data-testid="lane-footnote">
                  <lucide-angular [img]="InfoIcon" class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span class="min-w-0">{{ group.footnote }}</span>
                </p>
              }
            </section>
          }
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaneUsageTileComponent {
  protected readonly statsEmpty = STATS_EMPTY;
  protected readonly empty = LANE_EMPTY;

  readonly tile = input.required<LaneUsageTileModel>();
  readonly linkPlanTiles = input<boolean>(false);
  readonly planTileRequested = output<string>();
  readonly open = input<boolean>(false);
  /** The section header already shows this row's caption. */
  readonly captionShared = input<boolean>(false);
  readonly toggled = output<void>();

  protected readonly panelId = newPanelId();
  protected readonly titleClass = LANE_COLLAPSE_TITLE;
  protected readonly rowGrid = LANE_ROW_GRID;
  protected readonly statusBadgeClass = badgeClass('neutral');
  protected readonly subgroupDivider =
    'pt-1 mt-1 border-t border-dashed border-base-content/30';
  protected readonly badgeClass = badgeClass;
  protected readonly chipClass = chipClass;
  protected readonly sourceChipClass = sourceChipClass;
  protected readonly InfoIcon = Info;

  protected readonly collapseClass = computed(() =>
    laneCollapseClass(this.tile().tone, this.open()),
  );
  /** Known tokens, else the known cost, else `—`. */
  protected readonly usageText = computed(() => {
    const t = this.tile();
    return t.tokensText || t.costLine || LANE_EMPTY.value;
  });
  /** The face's limit alert: only at or near the limit. */
  protected readonly alertChip = computed(() =>
    this.tile().limitChips.find(
      (face) => face.chip.tone === 'error' || face.chip.tone === 'warning',
    ),
  );
  protected readonly summarySources = computed(() => [
    ...new Set(this.tile().limitChips.flatMap((face) => face.sourceChips)),
  ]);
}
