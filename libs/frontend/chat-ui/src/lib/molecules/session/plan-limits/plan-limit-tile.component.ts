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
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      data-testid="plan-limit-tile"
      (click)="toggled.emit()"
    >
      <span
        class="block text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
        >{{ t.label }}</span
      >
      <span
        class="block text-[10px] text-base-content-muted leading-tight"
        [class.truncate]="!open()"
        [attr.title]="t.caption"
        data-testid="plan-limit-caption"
        >{{ t.caption }}</span
      >
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
}
