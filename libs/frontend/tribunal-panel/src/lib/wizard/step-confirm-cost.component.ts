import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { LucideAngularModule, Info } from 'lucide-angular';
import { EffortStateService } from '@ptah-extension/core';
import type { EffortLevel } from '@ptah-extension/shared';
import type { TribunalMove, VendorLane } from '../types/tribunal-ui.types';

const TURNS_PER_VENDOR: Record<TribunalMove, number> = {
  council: 2,
  forge: 3,
  race: 3,
};

const EFFORT_LEVELS: readonly EffortLevel[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

@Component({
  selector: 'ptah-step-confirm-cost',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col gap-4" data-testid="tribunal-step-confirm-cost">
      <header class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-base-content">Confirm & run</h3>
        <p class="text-sm text-base-content/55">
          Review the panel and effort, then convene.
        </p>
      </header>

      <div
        class="flex items-center gap-4 rounded-lg border border-base-300 bg-base-200/40 px-4 py-3"
      >
        <div class="flex flex-col">
          <span class="text-lg font-semibold tabular-nums text-base-content">{{
            laneCount()
          }}</span>
          <span class="text-[10px] uppercase tracking-wide text-base-content/45"
            >Lanes</span
          >
        </div>
        <div class="h-8 w-px bg-base-300"></div>
        <div class="flex flex-col">
          <span class="text-lg font-semibold tabular-nums text-base-content"
            >~{{ estimatedTurns() }}</span
          >
          <span class="text-[10px] uppercase tracking-wide text-base-content/45"
            >Est. turns</span
          >
        </div>
        <div class="h-8 w-px bg-base-300"></div>
        <div class="flex flex-col">
          <span class="text-sm font-medium capitalize text-base-content">{{
            move()
          }}</span>
          <span class="text-[10px] uppercase tracking-wide text-base-content/45"
            >Move</span
          >
        </div>
      </div>

      <div class="flex flex-col gap-2" data-testid="tribunal-lane-summary">
        <span class="text-[10px] uppercase tracking-wide text-base-content/45"
          >Panelists</span
        >
        @for (lane of lanes(); track lane.laneId) {
          <div
            class="flex items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-200/30 px-3 py-2"
          >
            <span class="truncate text-sm font-medium text-base-content">{{
              lane.displayName
            }}</span>
            <span class="badge badge-ghost badge-sm font-mono">{{
              lane.model ?? 'default'
            }}</span>
          </div>
        }
      </div>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium text-base-content/70">Effort</span>
        <select
          class="select select-bordered select-sm"
          aria-label="Effort"
          [value]="currentEffort() ?? ''"
          (change)="onEffortChange($event)"
        >
          <option value="">Default</option>
          @for (level of effortLevels; track level) {
            <option [value]="level">{{ level }}</option>
          }
        </select>
      </label>

      <div
        class="flex items-start gap-2 rounded-lg border border-info/20 bg-info/5 px-3 py-2 text-xs text-base-content/60"
      >
        <lucide-angular
          [img]="InfoIcon"
          class="mt-0.5 h-3.5 w-3.5 shrink-0 text-info"
          aria-hidden="true"
        />
        <span>
          Turn counts are a rough estimate, not a guarantee. Actual cost depends
          on each vendor's reasoning and tool use.
        </span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StepConfirmCostComponent {
  readonly move = input<TribunalMove>('council');
  readonly lanes = input<readonly VendorLane[]>([]);

  private readonly effortState = inject(EffortStateService);

  protected readonly InfoIcon = Info;
  protected readonly effortLevels = EFFORT_LEVELS;

  protected readonly currentEffort = this.effortState.currentEffort;

  protected readonly laneCount = computed(() => this.lanes().length);

  protected readonly estimatedTurns = computed(() => {
    const count = Math.max(1, this.lanes().length);
    return count * TURNS_PER_VENDOR[this.move()] + 1;
  });

  protected onEffortChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    void this.effortState.setEffort(value ? (value as EffortLevel) : undefined);
  }
}
