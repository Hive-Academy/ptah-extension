import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { Clock, Coins, Cpu, Hash, Info, LucideAngularModule } from 'lucide-angular';
import { LaneBoundValueComponent } from './lane-bound-value.component';
import { PlanWindowDetailComponent } from './plan-window-detail.component';
import {
  LANE_COLLAPSE_TITLE,
  LANE_DETAIL_LINE,
  LANE_DETAIL_TOGGLE,
  LANE_ROW_GRID,
  badgeClass,
  chipClass,
  laneCollapseClass,
  newPanelId,
  sourceChipClass,
} from './stats-tile.styles';
import { STATS_EMPTY } from '../session-stats-view';
import { LANE_EMPTY, splitLowerBound } from './lane-tiles';
import type { LaneUsageTileModel, StatsChipTone } from './stats-limit-view-model.types';

/** Status dot fill of the compact face; a fill is non-text, so tone colour is allowed. */
const STATUS_DOT: Readonly<Record<StatsChipTone, string>> = {
  live: 'bg-success motion-safe:animate-pulse',
  success: 'bg-success',
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
  neutral: 'bg-base-content/40',
};

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
 * The `inspector` variant (Electron session sidebar) is the compact form:
 * name, icon + number for tokens and cost, and a status dot with one word.
 * Every sentence the strip variant shows (usage and limit summary, "Restored
 * · …", the owner footnote, the "not in totals" caption) moves into a
 * tooltip plus either the face's accessible name or a keyboard-reachable
 * toggle that shows the sentence as a visible line, so nothing is lost.
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
  imports: [LucideAngularModule, PlanWindowDetailComponent, LaneBoundValueComponent],
  host: {
    class: 'block min-w-0',
    '[attr.data-tile-id]': 'tile().id',
  },
  template: `
    @let t = tile();
    @let small = compact();
    <div [class]="collapseClass()" data-testid="lane-usage-collapse">
      <button
        type="button"
        [class]="small ? compactTitleClass : titleClass"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="panelId"
        [attr.aria-label]="small ? accessibleName() : null"
        data-testid="lane-usage-tile"
        (click)="toggled.emit()"
      >
        @if (small) {
          <span class="flex min-w-0 items-center gap-2" data-testid="lane-row-grid">
            <span
              class="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-base-content"
              [attr.title]="nameTitle()"
              data-testid="lane-name"
              >{{ t.label }}</span
            >
            <span
              class="inline-flex shrink-0 items-center gap-0.5 text-[10.5px]"
              [attr.title]="tokensTitle()"
              data-testid="lane-tokens"
            >
              <lucide-angular [img]="HashIcon" class="size-3 text-base-content-muted" aria-hidden="true" />
              <span class="sr-only">Tokens </span>
              <ptah-lane-bound-value [text]="t.tokensValue" [unknownLabel]="empty.usage" />
            </span>
            <span
              class="inline-flex shrink-0 items-center gap-0.5 text-[10.5px]"
              [attr.title]="t.costLine || costUnknown"
              data-testid="lane-cost"
            >
              <lucide-angular [img]="CoinsIcon" class="size-3 text-base-content-muted" aria-hidden="true" />
              <span class="sr-only">Cost </span>
              <ptah-lane-bound-value [text]="t.costValue" [unknownLabel]="costUnknown" />
            </span>
            <span
              class="inline-flex min-w-0 max-w-[6.5rem] items-center gap-1 text-[10.5px] text-base-content-muted"
              [attr.title]="t.runChip.text"
              data-testid="lane-run-chip"
            >
              <span [class]="'inline-block size-1.5 shrink-0 rounded-full ' + statusDot()" aria-hidden="true"></span>
              <span class="min-w-0 truncate" aria-hidden="true">{{ t.runStatusText }}</span>
              <span class="sr-only">{{ t.runChip.text }}</span>
            </span>
            @if (alertChip(); as alert) {
              <span
                [class]="badgeClass(alert.chip.tone)"
                [attr.title]="alert.chip.text"
                data-testid="lane-limit-chip"
              >
                <span aria-hidden="true">{{ alert.chip.glyph ?? '!' }}</span>
                <span class="sr-only">{{ alert.chip.text }}</span>
              </span>
            }
          </span>
        } @else {
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
        }
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
        [class]="small ? 'collapse-content px-2 pb-1.5 text-[10.5px]' : 'collapse-content px-2 pb-1.5 text-xs'"
        [hidden]="!open()"
        data-testid="lane-usage-panel"
      >
        @if (open()) {
          @if (!small) {
            <p
              class="flex flex-wrap items-center gap-1 pt-0.5 text-xs text-base-content-muted"
              data-testid="lane-summary"
            >
              <span>{{ t.summary }}</span>
              @for (source of summarySources(); track source) {
                <span [class]="sourceChipClass(source)">{{ source }}</span>
              }
            </p>
          } @else if (summarySources().length) {
            <p class="flex flex-wrap items-center gap-1 pt-0.5" data-testid="lane-sources">
              @for (source of summarySources(); track source) {
                <span [class]="sourceChipClass(source)">{{ source }}</span>
              }
            </p>
          }
          @let several = t.subgroups.length > 1;
          @for (group of t.subgroups; track group.key; let first = $first) {
            <section
              [class]="first ? 'pt-1' : subgroupDivider"
              [attr.data-owner-status]="group.ownerStatus"
              data-testid="lane-subgroup"
            >
              @if (several) {
                <h4 [class]="small ? 'flex flex-wrap items-center gap-1 text-[10.5px] font-semibold' : 'flex flex-wrap items-center gap-1 text-xs font-semibold'">
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
              <table [class]="small ? 'table table-xs mt-0.5 !w-auto text-[10.5px]' : 'table table-xs mt-0.5'" data-testid="lane-run-table">
                <thead>
                  <tr class="text-base-content-muted">
                    <th scope="col" class="w-6 text-right">#</th>
                    @if (cols.model) {
                      <th scope="col" title="Model">
                        @if (small) {
                          <lucide-angular [img]="CpuIcon" class="size-3" aria-hidden="true" /><span class="sr-only">Model</span>
                        } @else { Model }
                      </th>
                    }
                    @if (cols.tokens) {
                      <th scope="col" class="text-right" title="Tokens">
                        @if (small) {
                          <lucide-angular [img]="HashIcon" class="ml-auto size-3" aria-hidden="true" /><span class="sr-only">Tokens</span>
                        } @else { Tokens }
                      </th>
                    }
                    @if (cols.cost) {
                      <th scope="col" class="text-right" title="Cost">
                        @if (small) {
                          <lucide-angular [img]="CoinsIcon" class="ml-auto size-3" aria-hidden="true" /><span class="sr-only">Cost</span>
                        } @else { Cost }
                      </th>
                    }
                    <th scope="col">@if (small) { <span class="sr-only">Status</span> } @else { Status }</th>
                    @if (cols.started) {
                      <th scope="col" title="Started">
                        @if (small) {
                          <lucide-angular [img]="ClockIcon" class="size-3" aria-hidden="true" /><span class="sr-only">Started</span>
                        } @else { Started }
                      </th>
                    }
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
                        @if (small) {
                          <td class="text-right" data-testid="lane-run-tokens" [attr.title]="lowerBoundTitle(run.tokensText, 'tokens')">
                            <ptah-lane-bound-value [text]="run.tokensText" [unknownLabel]="statsEmpty.tokens" />
                          </td>
                        } @else {
                          <td class="text-right tabular-nums" data-testid="lane-run-tokens"
                            [class.text-base-content-muted]="run.tokensText === empty.value"
                            [attr.aria-label]="run.tokensText === empty.value ? statsEmpty.tokens : null">{{ run.tokensText }}</td>
                        }
                      }
                      @if (cols.cost) {
                        @if (small) {
                          <td class="text-right" data-testid="lane-run-cost" [attr.title]="lowerBoundTitle(run.costText, 'cost')">
                            <ptah-lane-bound-value [text]="run.costText" [unknownLabel]="statsEmpty.cost" />
                          </td>
                        } @else {
                          <td class="text-right tabular-nums" data-testid="lane-run-cost"
                            [class.text-base-content-muted]="run.costText === empty.value"
                            [attr.aria-label]="run.costText === empty.value ? statsEmpty.cost : null">{{ run.costText }}</td>
                        }
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
                <p [class]="small ? 'text-[10.5px] text-base-content-muted mt-0.5' : 'text-[11px] text-base-content-muted mt-0.5'">{{ line }}</p>
              }
              @if (group.cooldownLine) {
                <p [class]="small ? 'text-[10.5px] text-base-content-muted mt-0.5' : 'text-[11px] text-base-content-muted mt-0.5'">{{ group.cooldownLine }}</p>
              }
              @if (group.footnote) {
                @if (small) {
                  @let noteOpen = isNoteOpen(group.key);
                  <div class="mt-1" data-testid="lane-footnote">
                    <button
                      type="button"
                      [class]="detailToggleClass"
                      [attr.title]="group.footnote"
                      [attr.aria-label]="group.ownerLabel + ' details'"
                      [attr.aria-expanded]="noteOpen"
                      [attr.aria-controls]="noteOpen ? noteId(group.key) : null"
                      data-testid="lane-footnote-toggle"
                      (click)="toggleNote(group.key)"
                      (keydown.escape)="closeNoteOnEscape($event, group.key)"
                    >
                      <lucide-angular [img]="InfoIcon" class="size-3 shrink-0" aria-hidden="true" />
                      <span class="min-w-0 truncate">{{ group.ownerLabel }}</span>
                    </button>
                    @if (noteOpen) {
                      <p [id]="noteId(group.key)" [class]="'mt-0.5 ' + detailLineClass" data-testid="lane-footnote-detail">{{ group.footnote }}</p>
                    }
                  </div>
                } @else {
                  <p class="mt-1 flex items-start gap-1 text-xs text-base-content-muted" data-testid="lane-footnote">
                    <lucide-angular [img]="InfoIcon" class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    <span class="min-w-0">{{ group.footnote }}</span>
                  </p>
                }
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
  protected readonly costUnknown = 'Cost unavailable';

  readonly tile = input.required<LaneUsageTileModel>();
  /** `inspector`: the compact icon + number face of the Electron session sidebar. */
  readonly variant = input<'strip' | 'inspector'>('strip');
  readonly linkPlanTiles = input<boolean>(false);
  readonly planTileRequested = output<string>();
  readonly open = input<boolean>(false);
  /** The section header already shows this row's caption. */
  readonly captionShared = input<boolean>(false);
  readonly toggled = output<void>();

  protected readonly panelId = newPanelId();
  protected readonly titleClass = LANE_COLLAPSE_TITLE;
  /** Compact face: a fixed 2rem slot on the right for the chevron, so the status never runs into it. */
  protected readonly compactTitleClass = `${LANE_COLLAPSE_TITLE} !pr-8`;
  protected readonly detailToggleClass = LANE_DETAIL_TOGGLE;
  protected readonly detailLineClass = LANE_DETAIL_LINE;
  /** Subgroup keys whose owner footnote is open (compact variant). */
  private readonly openNotes = signal<ReadonlySet<string>>(new Set());
  protected readonly rowGrid = LANE_ROW_GRID;
  protected readonly statusBadgeClass = badgeClass('neutral');
  protected readonly subgroupDivider =
    'pt-1 mt-1 border-t border-dashed border-base-content/30';
  protected readonly badgeClass = badgeClass;
  protected readonly chipClass = chipClass;
  protected readonly sourceChipClass = sourceChipClass;
  protected readonly InfoIcon = Info;
  protected readonly HashIcon = Hash;
  protected readonly CoinsIcon = Coins;
  protected readonly ClockIcon = Clock;
  protected readonly CpuIcon = Cpu;

  protected readonly compact = computed(() => this.variant() === 'inspector');
  protected readonly collapseClass = computed(() =>
    laneCollapseClass(this.tile().tone, this.open()),
  );
  /** Known tokens, else the known cost, else `—`. */
  protected readonly usageText = computed(() => {
    const t = this.tile();
    return t.tokensText || t.costLine || LANE_EMPTY.value;
  });
  /** Compact face tooltip of the name: the label, the usage + limit summary, the run status. */
  protected readonly nameTitle = computed(() => {
    const t = this.tile();
    return `${t.label}\n${t.summary}\n${t.runChip.text}`;
  });
  /** Compact face tooltip of the tokens: the full sentence, with the lower bound named. */
  protected readonly tokensTitle = computed(() => {
    const t = this.tile();
    if (!t.tokensValue) return LANE_EMPTY.usage;
    const unknown = t.tokensUnknownText ? ` (${t.tokensUnknownText})` : '';
    const bound = splitLowerBound(t.tokensValue).atLeast ? ' · lower bound' : '';
    return `${t.tokensText}${unknown}${bound}`;
  });
  protected readonly statusDot = computed(() => STATUS_DOT[this.tile().runChip.tone]);
  /** The face's limit alert: only at or near the limit. */
  protected readonly alertChip = computed(() =>
    this.tile().limitChips.find(
      (face) => face.chip.tone === 'error' || face.chip.tone === 'warning',
    ),
  );
  protected readonly summarySources = computed(() => [
    ...new Set(this.tile().limitChips.flatMap((face) => face.sourceChips)),
  ]);

  /**
   * The compact face's accessible name: everything the strip variant prints
   * (usage, limit state, run status, caption), with "≥" read as "at least".
   * It replaces the face's visible text, so nothing is announced twice.
   */
  protected readonly accessibleName = computed(() => {
    const t = this.tile();
    const tokens = t.tokensValue
      ? `${t.tokensText}${t.tokensUnknownText ? ` (${t.tokensUnknownText})` : ''}`
      : LANE_EMPTY.usage;
    const limit = t.limitChips.length
      ? t.limitChips.map((face) => face.chip.text).join(' · ')
      : LANE_EMPTY.limit;
    return [t.label, tokens, t.costLine || this.costUnknown, limit, t.runChip.text, this.captionShared() ? '' : t.caption]
      .filter(Boolean)
      .join(', ')
      .replace(/≥/g, 'at least ');
  });

  protected isNoteOpen(key: string): boolean {
    return this.openNotes().has(key);
  }
  protected noteId(key: string): string {
    return `${this.panelId}-note-${encodeURIComponent(key)}`;
  }
  protected toggleNote(key: string): void {
    this.openNotes.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  protected closeNoteOnEscape(event: Event, key: string): void {
    if (!this.isNoteOpen(key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.toggleNote(key);
  }

  /** Run-cell tooltip: the value with its unit, and "lower bound" when it is one. */
  protected lowerBoundTitle(text: string, unit: 'tokens' | 'cost'): string | null {
    if (text === LANE_EMPTY.value) return null;
    const bound = splitLowerBound(text).atLeast ? ' · lower bound' : '';
    return unit === 'tokens' ? `${text} tokens${bound}` : `cost ${text}${bound}`;
  }
}
