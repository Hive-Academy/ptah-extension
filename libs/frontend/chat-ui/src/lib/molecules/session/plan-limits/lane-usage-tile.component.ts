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
  ROW_PANEL,
  chipClass,
  laneRowClass,
  newPanelId,
  sourceChipClass,
} from './stats-tile.styles';
import type { LaneUsageTileModel } from './stats-limit-view-model.types';

/**
 * One CLI lane (CLI + role) as a row of the expanded stats card's Lanes
 * section (design §3.3).
 *
 * Lane usage is outside the session totals (Req 8): the row has a dashed
 * accent and its own fill, and the caption "lane · not in totals" is shown
 * once in the section header (`captionShared`), or on the row when the
 * section cannot share it. The row shows the summed known tokens and cost
 * (unknown is never 0), the run state and the limit state aggregated over
 * the owner + model-scope subgroups. The panel shows each subgroup: its runs,
 * how its owner relates to the session owner (A1), "see plan tiles" chips
 * only for windows a session plan row renders (A2), and the full window
 * detail for every other window.
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
    <button
      type="button"
      [class]="faceClass()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      data-testid="lane-usage-tile"
      (click)="toggled.emit()"
    >
      <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span
          class="min-w-16 max-w-[50%] shrink-0 truncate text-xs text-base-content"
          [attr.title]="t.label"
          >{{ t.label }}</span
        >
        <span
          class="text-xs font-semibold tabular-nums"
          data-testid="lane-tokens"
          >{{ t.tokensText }}
          @if (t.tokensUnknownText) {
            <span class="text-[10px] font-normal text-base-content-muted">{{
              t.tokensUnknownText
            }}</span>
          }
        </span>
        <span [class]="chipClass(t.runChip.tone)" data-testid="lane-run-chip">
          @if (t.runChip.tone === 'live') {
            <span
              class="inline-block w-1.5 h-1.5 rounded-full bg-success motion-safe:animate-pulse"
              aria-hidden="true"
            ></span>
          }
          @if (t.runChip.glyph) {
            <span aria-hidden="true">{{ t.runChip.glyph }}</span>
          }
          {{ t.runChip.text }}
        </span>
        @for (face of t.limitChips; track $index) {
          <span
            [class]="chipClass(face.chip.tone)"
            data-testid="lane-limit-chip"
          >
            @if (face.chip.glyph) {
              <span aria-hidden="true">{{ face.chip.glyph }}</span>
            }
            {{ face.chip.text }}
          </span>
          @for (source of face.sourceChips; track source) {
            <span [class]="sourceChipClass(source)">{{ source }}</span>
          }
        }
      </span>
      <span
        class="flex min-w-0 gap-1 pl-[4.5rem] text-[11px] leading-tight text-base-content-muted"
      >
        <span class="shrink-0" data-testid="lane-cost">{{ t.costLine }}</span>
        @if (!captionShared()) {
          <span
            class="min-w-0"
            [class.truncate]="!open()"
            [attr.title]="t.caption"
            data-testid="lane-caption"
            >{{ t.caption }}</span
          >
        }
      </span>
      <lucide-angular
        [img]="open() ? ChevronUpIcon : ChevronDownIcon"
        class="absolute top-1.5 right-1 w-3 h-3 text-base-content-muted"
        aria-hidden="true"
      />
    </button>
    <div
      [id]="panelId"
      [class]="panelClass"
      [hidden]="!open()"
      data-testid="lane-usage-panel"
    >
      @if (open()) {
        @for (group of t.subgroups; track group.key; let first = $first) {
          <section
            [class]="first ? 'py-1' : subgroupDivider"
            [attr.data-owner-status]="group.ownerStatus"
            data-testid="lane-subgroup"
          >
            <h4 class="text-xs font-semibold">{{ group.heading }}</h4>
            @for (run of group.runs; track run.runId) {
              <p class="text-xs mt-0.5" data-testid="lane-run-row">
                <span class="font-semibold">{{ run.label }}</span>
                · Model {{ run.model }} · Tokens {{ run.tokensText }} · Cost
                {{ run.costText }} · {{ run.stateText }}
                @if (run.startedText) {
                  · {{ run.startedText }}
                }
              </p>
            }
            <p class="text-xs mt-1 font-semibold" data-testid="lane-owner-text">
              {{ group.ownerText }}
            </p>
            <div class="flex flex-wrap gap-1 mt-1">
              <span [class]="chipClass(group.stateChip.tone)">
                @if (group.stateChip.glyph) {
                  <span aria-hidden="true">{{ group.stateChip.glyph }}</span>
                }
                {{ group.stateChip.text }}
              </span>
              @for (
                planChip of group.planTileChips;
                track planChip.planTileId
              ) {
                <span
                  [class]="chipClass(planChip.chip.tone)"
                  data-testid="lane-plan-tile-chip"
                >
                  @if (planChip.chip.glyph) {
                    <span aria-hidden="true">{{ planChip.chip.glyph }}</span>
                  }
                  {{ planChip.chip.text }}
                </span>
              }
            </div>
            @for (window of group.windows; track window.windowKey) {
              <ptah-plan-window-detail [window]="window" />
            }
            @for (line of group.evidenceLines; track $index) {
              <p class="text-[11px] text-base-content-muted mt-0.5">
                {{ line }}
              </p>
            }
            @if (group.cooldownLine) {
              <p class="text-[11px] text-base-content-muted mt-0.5">
                {{ group.cooldownLine }}
              </p>
            }
            @for (note of group.notes; track $index) {
              <p
                [class]="note.tone === 'info' ? infoNote : neutralNote"
                [attr.data-note-tone]="note.tone"
                data-testid="lane-note"
              >
                {{ note.text }}
              </p>
            }
          </section>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaneUsageTileComponent {
  readonly tile = input.required<LaneUsageTileModel>();
  readonly open = input<boolean>(false);
  /** The section header already shows this row's caption. */
  readonly captionShared = input<boolean>(false);
  readonly toggled = output<void>();

  protected readonly panelId = newPanelId();
  protected readonly panelClass = `${ROW_PANEL} border-dashed`;
  protected readonly subgroupDivider =
    'py-1 mt-1 border-t border-dashed border-base-content/30';
  /** Explanatory notes are informational, never warnings. */
  protected readonly infoNote =
    'text-[11px] text-base-content-muted mt-1 pl-1.5 border-l-2 border-info';
  protected readonly neutralNote =
    'text-[11px] text-base-content-muted mt-1 pl-1.5 border-l-2 border-base-content/30';
  protected readonly chipClass = chipClass;
  protected readonly sourceChipClass = sourceChipClass;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronUpIcon = ChevronUp;

  protected readonly faceClass = computed(() => laneRowClass(this.tile().tone));
}
